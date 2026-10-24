"""Read-only relay for signed Yandex Disk downloads that do not allow browser CORS.

OAuth stays in the browser. Signed URLs arrive in POST bodies, never access-log
query strings. Only the Yandex file service is reachable; every redirect and DNS
answer is checked, and TLS connects to the checked IP with the original hostname.
"""
import http.client
import ipaddress
import socket
import ssl
import tempfile
import time
from urllib.parse import urljoin, urlsplit

from flask import jsonify, request, send_file

MAX_BYTES = 200 * 1024 * 1024
MAX_SECONDS = 90
DOWNLOAD_HOSTS = frozenset(('downloader.disk.yandex.ru', 'downloader.disk.yandex.net'))


class TransferError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


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
