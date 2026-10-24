"""Restricted relay for signed Yandex Disk transfers that do not allow browser CORS.

OAuth stays in the browser. Signed URLs arrive in POST bodies, never access-log
query strings. Only the Yandex file service is reachable; every redirect and DNS
answer is checked, and TLS connects to the checked IP with the original hostname.
"""
import http.client
import ipaddress
import json
import re
import socket
import ssl
import tempfile
import time
from urllib.parse import urljoin, urlsplit

from flask import jsonify, request, send_file

MAX_BYTES = 200 * 1024 * 1024
MAX_SECONDS = 90
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # Below the site's existing 25 MiB request limit.
DOWNLOAD_HOSTS = frozenset(('downloader.disk.yandex.ru', 'downloader.disk.yandex.net'))
UPLOAD_HOST = re.compile(r'uploader[a-z0-9-]*\.(?:disk\.yandex\.(?:net|ru)|dst\.yandex\.net)\Z')


class TransferError(Exception):
    def __init__(self, message, status=502, code=''):
        super().__init__(message)
        self.status = status
        self.code = code


def checked_url(href, initial=False):
    """Do not accept arbitrary proxy targets, credentials, ports or IP literals."""
    if not isinstance(href, str) or len(href) > 16384 or any(ord(c) < 33 or ord(c) == 127 for c in href):
        raise TransferError('Некорректная ссылка на файл Яндекс Диска.', 400)
    try:
        url = urlsplit(href)
        host = url.hostname or ''
        allowed = host in DOWNLOAD_HOSTS or (not initial and host.endswith('.storage.yandex.net'))
        if (url.scheme != 'https' or not allowed or url.username is not None or url.password is not None
                or url.port not in (None, 443) or url.fragment or '\\' in href
                or (initial and not url.path.startswith('/disk/'))):
            raise ValueError()
    except ValueError:
        raise TransferError('Разрешены только ссылки скачивания Яндекс Диска.', 400) from None
    return url


def public_address(host):
    answers = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    addresses = list(dict.fromkeys(answer[4][0] for answer in answers))
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise TransferError('Недопустимый адрес файлового сервера.', 400)
    return addresses[0]


def checked_upload_url(href):
    """A signed PUT target, never a general-purpose proxy or Yandex API endpoint."""
    if not isinstance(href, str) or len(href) > 16384 or any(ord(c) < 33 or ord(c) == 127 for c in href):
        raise TransferError('Некорректная ссылка загрузки Яндекс Диска.', 400)
    try:
        url = urlsplit(href)
        if (url.scheme != 'https' or not UPLOAD_HOST.fullmatch(url.hostname or '')
                or url.username is not None or url.password is not None or url.port not in (None, 443)
                or url.fragment or '\\' in href or not url.path.startswith('/upload-target/')
                or len(url.path) <= len('/upload-target/') or re.search(r'%(?:2e|2f|5c)', url.path, re.I)
                or any(part in ('.', '..') for part in url.path.split('/'))):
            raise ValueError()
    except ValueError:
        raise TransferError('Разрешены только временные ссылки загрузки Яндекс Диска.', 400) from None
    return url


def upload(href, source):
    """One bounded PUT; no redirects, automatic retry, cookies or OAuth forwarding."""
    url = checked_upload_url(href)
    source.seek(0, 2)
    size = source.tell()
    source.seek(0)
    if size > MAX_UPLOAD_BYTES:
        raise TransferError('Файл больше 20 МБ. Загрузите его через сайт Яндекс Диска.', 413)
    deadline = time.monotonic() + MAX_SECONDS
    conn = response = None
    try:
        address = public_address(url.hostname)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TransferError('Яндекс Диск не ответил вовремя. Сохранение не подтверждено.', 504)
        conn = PinnedHTTPSConnection(url.hostname, address, min(20, remaining))

        def chunks():
            remaining_bytes = size
            while remaining_bytes:
                if time.monotonic() >= deadline:
                    raise TransferError('Время загрузки истекло. Сохранение на Диске не подтверждено.', 504)
                block = source.read(min(65536, remaining_bytes))
                if not block:
                    raise TransferError('Не удалось прочитать файл полностью. Сохранение не подтверждено.')
                remaining_bytes -= len(block)
                yield block

        target = url.path + ('?' + url.query if url.query else '')
        conn.request('PUT', target, body=chunks(), headers={
            'Content-Length': str(size), 'Content-Type': 'application/octet-stream',
            'Accept': 'application/json', 'Accept-Encoding': 'identity'})
        response = conn.getresponse()
        status = response.status
        if status in (200, 201, 202, 204):
            return status  # Client still verifies the file by reading it back.
        try:
            detail = json.loads(response.read(16384))
        except (ValueError, UnicodeError, OSError, http.client.HTTPException):
            detail = {}
        detail = detail if isinstance(detail, dict) else {}
        reasons = ' '.join(str(detail.get(key, '')) for key in ('error', 'reason', 'description', 'message'))
        quota = re.search(r'UploadTrafficLimitExceeded|UPLOAD_TRAFFIC_LIMIT_EXCEEDED', reasons, re.I)
        # Do not echo upstream bodies, headers or exception strings: they can contain signed URLs.
        if status == 423:
            if quota:
                raise TransferError('Яндекс Диск сообщил об исчерпанном лимите загрузки (423). Проверьте ограничения в своём аккаунте Диска.', 423, 'UploadTrafficLimitExceeded')
            raise TransferError('Яндекс Диск заблокировал запись (423). Повторите позже; если ошибка остаётся, откройте Диск и проверьте его уведомления и ограничения.', 423, 'DiskResourceLocked')
        if status == 507:
            raise TransferError('На Яндекс Диске недостаточно свободного места (507).', 507)
        if status in (401, 403, 404, 410):
            raise TransferError('Яндекс Диск отклонил ссылку загрузки (' + str(status) + '). Обновите объект и повторите сохранение.', status)
        if status == 409:
            raise TransferError('Яндекс Диск сообщил о конфликте файла (409). Обновите список документов перед повторной записью.', 409)
        if status == 429:
            raise TransferError('Слишком много запросов к Яндекс Диску (429). Подождите и повторите сохранение.', 429)
        if 300 <= status < 400:
            raise TransferError('Яндекс Диск изменил адрес загрузки. Обновите объект и повторите сохранение.')
        raise TransferError('Яндекс Диск не подтвердил загрузку файла (' + str(status) + '). Повторите позже.')
    except TransferError:
        raise
    except (OSError, ValueError, http.client.HTTPException):
        raise TransferError('Связь с Яндекс Диском прервалась. Сохранение файла не подтверждено.') from None
    finally:
        if response is not None:
            response.close()
        if conn is not None:
            conn.close()


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, address, timeout):
        super().__init__(host, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        # No second DNS lookup between validation and connect (DNS rebinding).
        sock = socket.create_connection((self.address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except Exception:
            sock.close()
            raise


def download(href):
    deadline = time.monotonic() + MAX_SECONDS
    output = tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode='w+b')
    try:
        for hop in range(4):
            url = checked_url(href, initial=hop == 0)
            address = public_address(url.hostname)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TransferError('Яндекс Диск не успел передать файл. Повторите загрузку.', 504)
            conn = PinnedHTTPSConnection(url.hostname, address, min(20, remaining))
            response = None
            try:
                target = url.path + ('?' + url.query if url.query else '')
                conn.request('GET', target, headers={'Accept': '*/*', 'Accept-Encoding': 'identity'})
                response = conn.getresponse()
                if response.status in (301, 302, 303, 307, 308):
                    location = response.getheader('Location')
                    if not location:
                        raise TransferError('Яндекс Диск не вернул адрес файла.')
                    href = urljoin(href, location)
                    continue
                if response.status != 200:
                    raise TransferError('Яндекс Диск не отдал файл. Обновите объект и повторите загрузку.')
                length = response.getheader('Content-Length')
                if length is not None:
                    try:
                        size = int(length)
                    except ValueError:
                        raise TransferError('Некорректный размер файла в ответе Яндекс Диска.') from None
                    if size < 0 or size > MAX_BYTES:
                        raise TransferError('Файл больше 200 МБ. Скачайте его через Яндекс Диск.', 413)
                else:
                    size = None
                total = 0
                while True:
                    if time.monotonic() >= deadline:
                        raise TransferError('Яндекс Диск не успел передать файл. Повторите загрузку.', 504)
                    chunk = response.read(min(65536, MAX_BYTES - total + 1))
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_BYTES:
                        raise TransferError('Файл больше 200 МБ. Скачайте его через Яндекс Диск.', 413)
                    output.write(chunk)
                if size is not None and total != size:
                    raise TransferError('Файл передан не полностью. Повторите загрузку.')
                output.seek(0)
                return output
            finally:
                if response is not None:
                    response.close()
                conn.close()
        raise TransferError('Слишком много перенаправлений при скачивании файла.')
    except TransferError:
        output.close()
        raise
    except (OSError, ValueError, http.client.HTTPException):
        output.close()
        # Do not expose exception strings: they can contain a signed download URL.
        raise TransferError('Не удалось получить файл с Яндекс Диска. Повторите загрузку.') from None
    except Exception:
        output.close()
        raise


def register_transfer(app, limited):
    @app.post('/prorab/upload')
    def prorab_upload():
        # Existing POST CSRF and 25 MiB request limits also apply to this route.
        limited('prorab-upload-minute', 60, 60)
        limited('prorab-upload-hour', 500, 3600)
        if request.headers.get('Authorization'):
            return jsonify(error='Ключ Яндекса не требуется для загрузки по временной ссылке.'), 400
        file = request.files.get('file')
        if file is None:
            return jsonify(error='Не получен файл для загрузки.'), 400
        try:
            status = upload(request.form.get('href', ''), file.stream)
            return jsonify(ok=True, upstream_status=status)
        except TransferError as error:
            return jsonify(error=str(error), code=error.code), error.status
        finally:
            file.close()

    @app.post('/prorab/download')
    def prorab_download():
        # The site's existing POST CSRF check applies to invited users as well.
        limited('prorab-download-minute', 120, 60)
        limited('prorab-download-hour', 1000, 3600)
        if request.headers.get('Authorization'):
            return jsonify(error='Ключ Яндекса не требуется для скачивания по временной ссылке.'), 400
        try:
            file = download(request.form.get('href', ''))
        except TransferError as error:
            return jsonify(error=str(error)), error.status
        try:
            response = send_file(file, mimetype='application/octet-stream', as_attachment=True,
                                 download_name='prorab-download.bin', conditional=False, max_age=0)
            response.headers['Cache-Control'] = 'no-store, private'
            response.call_on_close(file.close)
            return response
        except Exception:
            file.close()
            raise
