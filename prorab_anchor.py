"""Квитанции времени для фиксаций «Прораб+» (защищённый журнал изменений).

Браузер присылает только отпечаток SHA-256 (64 hex) — без данных объекта. Сервер отвечает квитанцией:
своё время (UTC) и подпись HMAC-SHA256 ключом сервера. Квитанцию нельзя подделать без ключа, сервер может
её проверить позже (/prorab/anchor/verify). Каждая квитанция дописывается в журнал data/prorab-anchors.log.

Приложение на телефоне получает квитанции по адресам /prorab/anchor/app и /prorab/anchor/app/verify — без проверки
CSRF (APP_PATHS): у приложения нет страницы с формой и входа на сайт. Эти адреса ничего не меняют на сервере, кроме
строки журнала, и ограничены теми же лимитами; данные объекта сюда не передаются.

Если задан PRORAB_TSA_URL — дополнительно запрашивается метка времени независимой службы по RFC 3161
(ответ возвращается целиком, base64; проверка: openssl ts -verify). Адрес службы задаёт только администратор
сервера (переменная окружения), из запроса он не берётся.
"""
import base64
import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path

import requests
from flask import current_app, jsonify, request

HEX64 = re.compile(r'^[0-9a-f]{64}$')
# SHA-256 AlgorithmIdentifier: OID 2.16.840.1.101.3.4.2.1 + NULL
SHA256_ALG = bytes.fromhex('300d06096086480165030402010500')


def anchor_key():
    explicit = os.environ.get('PRORAB_ANCHOR_KEY')
    if explicit:
        return explicit.encode()
    # Ключ из SECRET_KEY сайта: смена SECRET_KEY делает старые квитанции непроверяемыми — задайте PRORAB_ANCHOR_KEY
    return hmac.new(current_app.config['SECRET_KEY'].encode(), b'prorab-anchor-v1', hashlib.sha256).digest()


def key_id():
    return hashlib.sha256(anchor_key()).hexdigest()[:12]


def sign(digest, at):
    return hmac.new(anchor_key(), ('prorab-anchor-v1|' + digest + '|' + at).encode(), hashlib.sha256).hexdigest()


def der_len(n):
    if n < 0x80:
        return bytes([n])
    body = n.to_bytes((n.bit_length() + 7) // 8, 'big')
    return bytes([0x80 | len(body)]) + body


def der(tag, body):
    return bytes([tag]) + der_len(len(body)) + body


def tsa_request(digest, nonce=None):
    """TimeStampReq (RFC 3161): version 1, messageImprint SHA-256, nonce, certReq TRUE."""
    nonce = nonce if nonce is not None else secrets.token_bytes(8)
    nonce = b'\x00' + nonce if nonce[0] & 0x80 else nonce
    imprint = der(0x30, SHA256_ALG + der(0x04, bytes.fromhex(digest)))
    return der(0x30, der(0x02, b'\x01') + imprint + der(0x02, nonce) + der(0x01, b'\xff'))


def tsa_status(reply):
    """PKIStatus из TimeStampResp: 0 — выдано, 1 — выдано с изменениями; иначе отказ."""
    try:
        if reply[0] != 0x30:
            return None
        i = 2 if reply[1] < 0x80 else 2 + (reply[1] & 0x7f)
        if reply[i] != 0x30:
            return None
        j = i + (2 if reply[i + 1] < 0x80 else 2 + (reply[i + 1] & 0x7f))
        if reply[j] != 0x02:
            return None
        n = reply[j + 1]
        return int.from_bytes(reply[j + 2:j + 2 + n], 'big')
    except IndexError:
        return None


def request_tsa(digest):
    url = os.environ.get('PRORAB_TSA_URL')
    if not url:
        return None, None
    try:
        r = requests.post(url, data=tsa_request(digest), headers={'Content-Type': 'application/timestamp-query'}, timeout=15)
        if r.status_code != 200 or tsa_status(r.content) not in (0, 1):
            return None, 'Служба меток времени отказала (' + str(r.status_code) + ')'
        return base64.b64encode(r.content).decode(), None
    except requests.RequestException:
        return None, 'Служба меток времени недоступна'


# Адреса для приложения на телефоне — без CSRF (см. protect() в app.py)
APP_PATHS = frozenset({'/prorab/anchor/app', '/prorab/anchor/app/verify'})


def log_path():
    return Path(current_app.config['DATABASE']).with_name('prorab-anchors.log')


def register_anchor(app, limited):
    def issue():
        # Проверка CSRF для POST — общая для сайта (before_request); адреса приложения — без неё (APP_PATHS)
        limited('prorab-anchor-minute', 60, 60)
        limited('prorab-anchor-day', 3000, 86400)
        digest = (request.form.get('hash') or '').strip().lower()
        if not HEX64.match(digest):
            return jsonify(error='Нужен отпечаток SHA-256 (64 шестнадцатеричных знака).'), 400
        at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        tsa, tsa_error = request_tsa(digest)
        with open(log_path(), 'a', encoding='utf-8') as log:
            log.write(at + ' ' + digest + ' ' + key_id() + (' tsa' if tsa else '') + (' app' if request.path in APP_PATHS else '') + '\n')
        return jsonify(format='prorab-anchor', version=1, hash=digest, time=at, alg='HMAC-SHA256', key=key_id(), sig=sign(digest, at),
                       tsa=tsa, tsa_url=os.environ.get('PRORAB_TSA_URL') if tsa else None, tsa_error=tsa_error)

    def verify():
        limited('prorab-anchor-verify', 120, 60)
        digest = (request.form.get('hash') or '').strip().lower()
        at = (request.form.get('time') or '').strip()
        sig = (request.form.get('sig') or '').strip().lower()
        if not HEX64.match(digest) or not re.match(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$', at) or not re.match(r'^[0-9a-f]{64}$', sig):
            return jsonify(valid=False, error='Неполная квитанция.'), 400
        return jsonify(valid=hmac.compare_digest(sign(digest, at), sig), key=key_id())

    app.add_url_rule('/prorab/anchor', 'prorab_anchor', issue, methods=['POST'])
    app.add_url_rule('/prorab/anchor/verify', 'prorab_anchor_verify', verify, methods=['POST'])
    app.add_url_rule('/prorab/anchor/app', 'prorab_anchor_app', issue, methods=['POST'])
    app.add_url_rule('/prorab/anchor/app/verify', 'prorab_anchor_app_verify', verify, methods=['POST'])
