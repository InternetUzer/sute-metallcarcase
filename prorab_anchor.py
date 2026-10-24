"""Private, durable receipt ledger for Prorab snapshots.

Only opaque project/chain digests, sequence numbers and SHA-256 hashes reach the
server. Receipts attest receipt time by this site, not authorship or an independent
trusted timestamp. The private key and ledger must be backed up together.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import current_app, jsonify, request

HEX64 = re.compile(r'^[0-9a-f]{64}$')
APP_PATHS = frozenset({'/prorab/anchor/app', '/prorab/anchor/app/verify', '/prorab/anchor/app/heads'})


def has_receipts(db):
    for table in ('receipts', 'legacy_receipts'):
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() and db.execute('SELECT 1 FROM ' + table + ' LIMIT 1').fetchone():
            return True
    return False


def private_dir():
    return Path(current_app.config['DATABASE']).parent


def anchor_key():
    explicit = os.environ.get('PRORAB_ANCHOR_KEY') or current_app.config.get('PRORAB_ANCHOR_KEY')
    if explicit:
        if len(explicit) < 32:
            raise RuntimeError('PRORAB_ANCHOR_KEY must contain at least 32 characters.')
        return explicit.encode()
    path = private_dir() / 'prorab-anchor.key'
    ledger = private_dir() / 'prorab-anchors.sqlite3'
    if not path.exists() and ledger.is_file():
        with sqlite3.connect(ledger) as db:
            if has_receipts(db):
                raise RuntimeError('Receipt key is missing; restore the original key from backup.')
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(secrets.token_hex(32).encode())
            stream.flush()
            os.fsync(stream.fileno())
    value = path.read_bytes().strip()
    if len(value) < 32:
        raise RuntimeError('Receipt key is incomplete; restore it from backup, do not replace it.')
    return value


def key_id():
    return hashlib.sha256(anchor_key()).hexdigest()[:12]


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def signed_payload(receipt):
    return {k: receipt[k] for k in ('format', 'version', 'project', 'chain', 'seq', 'prev', 'hash', 'time', 'alg', 'key')}


def signature(receipt):
    return hmac.new(anchor_key(), canonical(signed_payload(receipt)).encode(), hashlib.sha256).hexdigest()


def database():
    path = private_dir() / 'prorab-anchors.sqlite3'
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        os.close(fd)
    db = sqlite3.connect(path, timeout=10)
    db.execute('PRAGMA synchronous=FULL')
    db.execute('CREATE TABLE IF NOT EXISTS receipts (project TEXT NOT NULL, chain TEXT NOT NULL, seq INTEGER NOT NULL, hash TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(chain,seq))')
    db.execute('CREATE INDEX IF NOT EXISTS receipts_project ON receipts(project,chain,seq)')
    db.execute('CREATE TABLE IF NOT EXISTS legacy_receipts (hash TEXT PRIMARY KEY, receipt TEXT NOT NULL)')
    return db


def legacy_signature(digest, at):
    return hmac.new(anchor_key(), ('prorab-anchor-v1|' + digest + '|' + at).encode(), hashlib.sha256).hexdigest()


def recorded_receipt(db, r):
    if not isinstance(r, dict):
        return False
    if r.get('version') == 1:
        digest, at, sig = (r.get(k) for k in ('hash', 'time', 'sig'))
        if not all(isinstance(v, str) for v in (digest, at, sig)) or not HEX64.fullmatch(digest) or not HEX64.fullmatch(sig):
            return False
        stored = db.execute('SELECT receipt FROM legacy_receipts WHERE hash=?', (digest,)).fetchone()
        return bool(stored and json.loads(stored[0])['time'] == at and hmac.compare_digest(legacy_signature(digest, at), sig))
    ok = valid_receipt(r)
    stored = db.execute('SELECT receipt FROM receipts WHERE chain=? AND seq=?', (r['chain'], r['seq'])).fetchone() if ok else None
    return bool(ok and stored and signed_payload(json.loads(stored[0])) == signed_payload(r))


def valid_receipt(r):
    try:
        return (r['format'] == 'prorab-anchor' and r['version'] == 2 and isinstance(r['seq'], int) and not isinstance(r['seq'], bool)
                and 1 <= r['seq'] <= 999999999999 and all(isinstance(r[k], str) and HEX64.fullmatch(r[k]) for k in ('project', 'chain', 'hash', 'sig'))
                and (r['prev'] is None if r['seq'] == 1 else isinstance(r['prev'], str) and HEX64.fullmatch(r['prev']))
                and r['alg'] == 'HMAC-SHA256' and r['key'] == key_id()
                and bool(re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', r['time']))
                and hmac.compare_digest(signature(r), r['sig']))
    except (KeyError, TypeError, ValueError):
        return False


def register_anchor(app, limited):
    def small_request():
        return (request.content_length or 0) <= 100000

    @app.post('/prorab/anchor/app')
    @app.post('/prorab/anchor')
    def prorab_anchor():
        limited('prorab-anchor-minute', 60, 60)
        limited('prorab-anchor-day', 3000, 86400)
        if not small_request():
            return jsonify(error='Слишком большой запрос.'), 413
        # Older mobile releases only send a hash. Preserve receipt verification,
        # but do not pretend this protocol can attest chain completeness.
        if request.path == '/prorab/anchor/app' and not any(k in request.form for k in ('project', 'chain', 'seq', 'prev')):
            digest = request.form.get('hash', '').strip().lower()
            if not HEX64.fullmatch(digest):
                return jsonify(error='Нужен отпечаток SHA-256.'), 400
            db = database()
            try:
                db.execute('BEGIN IMMEDIATE')
                old = db.execute('SELECT receipt FROM legacy_receipts WHERE hash=?', (digest,)).fetchone()
                if old:
                    return jsonify(json.loads(old[0]))
                at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
                receipt = dict(format='prorab-anchor', version=1, hash=digest, time=at, alg='HMAC-SHA256', key=key_id(), sig=legacy_signature(digest, at), tsa=None, tsa_url=None, tsa_error=None)
                db.execute('INSERT INTO legacy_receipts VALUES (?,?)', (digest, canonical(receipt)))
                db.commit()
                return jsonify(receipt)
            finally:
                db.close()
        project, chain, digest = [request.form.get(k, '').strip().lower() for k in ('project', 'chain', 'hash')]
        seq_text = request.form.get('seq', '')
        prev = request.form.get('prev', '').strip().lower() or None
        if not all(HEX64.fullmatch(v) for v in (project, chain, digest)) or not re.fullmatch(r'[1-9]\d{0,11}', seq_text):
            return jsonify(error='Нужны идентификаторы цепочки, номер и отпечаток SHA-256.'), 400
        seq = int(seq_text)
        if (seq == 1 and prev is not None) or (seq > 1 and (prev is None or not HEX64.fullmatch(prev))):
            return jsonify(error='Некорректная ссылка на предыдущую фиксацию.'), 400
        db = database()
        try:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT receipt FROM receipts WHERE chain=? AND seq=?', (chain, seq)).fetchone()
            if old:
                receipt = json.loads(old[0])
                if receipt['project'] == project and receipt['hash'] == digest and receipt['prev'] == prev:
                    return jsonify(receipt)
                return jsonify(error='Этот номер уже зафиксирован с другим отпечатком.'), 409
            latest = db.execute('SELECT receipt FROM receipts WHERE chain=? ORDER BY seq DESC LIMIT 1', (chain,)).fetchone()
            head = json.loads(latest[0]) if latest else None
            if (head and (head['project'] != project or seq != head['seq'] + 1 or prev != head['hash'])) or (not head and seq != 1):
                return jsonify(error='Цепочка не совпадает с серверным реестром. Проверьте удалённые или неподтверждённые снимки.'), 409
            receipt = dict(format='prorab-anchor', version=2, project=project, chain=chain, seq=seq, prev=prev, hash=digest,
                           time=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), alg='HMAC-SHA256', key=key_id())
            receipt['sig'] = signature(receipt)
            receipt.update(tsa=None, tsa_url=None, tsa_error=None)
            db.execute('INSERT INTO receipts VALUES (?,?,?,?,?)', (project, chain, seq, digest, canonical(receipt)))
            db.commit()
            return jsonify(receipt)
        finally:
            db.close()

    @app.post('/prorab/anchor/app/verify')
    @app.post('/prorab/anchor/verify')
    def prorab_anchor_verify():
        limited('prorab-anchor-verify', 120, 60)
        if not small_request():
            return jsonify(error='Слишком большой запрос.'), 413
        if request.path == '/prorab/anchor/app/verify' and 'receipts' not in request.form:
            receipt = dict(version=1, **{k: request.form.get(k, '') for k in ('hash', 'time', 'sig')})
            db = database()
            try:
                return jsonify(valid=recorded_receipt(db, receipt), key=key_id())
            finally:
                db.close()
        try:
            receipts = json.loads(request.form.get('receipts', '[]'))
        except (ValueError, TypeError):
            return jsonify(error='Некорректные квитанции.'), 400
        if not isinstance(receipts, list) or not 1 <= len(receipts) <= 100:
            return jsonify(error='Нужно от 1 до 100 квитанций.'), 400
        db = database()
        try:
            valid = []
            for r in receipts:
                valid.append(recorded_receipt(db, r))
            return jsonify(valid=valid, key=key_id())
        finally:
            db.close()

    @app.post('/prorab/anchor/app/heads')
    @app.post('/prorab/anchor/heads')
    def prorab_anchor_heads():
        limited('prorab-anchor-heads', 60, 60)
        project = request.form.get('project', '').strip().lower()
        if not small_request() or not HEX64.fullmatch(project):
            return jsonify(error='Нужен отпечаток идентификатора объекта.'), 400
        db = database()
        try:
            rows = db.execute('SELECT r.receipt FROM receipts r JOIN (SELECT chain, MAX(seq) seq FROM receipts WHERE project=? GROUP BY chain) h ON r.chain=h.chain AND r.seq=h.seq ORDER BY r.chain', (project,)).fetchall()
            return jsonify(heads=[json.loads(r[0]) for r in rows])
        finally:
            db.close()
