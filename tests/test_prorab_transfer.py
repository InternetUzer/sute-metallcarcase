import io
import socket

import pytest

import prorab_transfer as transfer

LINK = 'https://downloader.disk.yandex.ru/disk/signed-test-path?filename=data.json'


@pytest.mark.parametrize('url', [
    'http://downloader.disk.yandex.ru/disk/file',
    'https://downloader.disk.yandex.ru.evil.test/disk/file',
    'https://user:password@downloader.disk.yandex.ru/disk/file',
    'https://downloader.disk.yandex.ru:8443/disk/file',
    'https://downloader.disk.yandex.ru/disk/file#fragment',
    'https://downloader.disk.yandex.ru/other/file',
    'https://cloud-api.yandex.net/v1/disk',
    'https://s1.storage.yandex.net/file',  # only permitted as a checked redirect
    'https://127.0.0.1/disk/file', 'file:///etc/passwd',
    'https://downloader.disk.yandex.ru/disk/file\r\nInjected:header',
])
def test_initial_target_is_only_yandex_downloader(url):
    with pytest.raises(transfer.TransferError):
        transfer.checked_url(url, initial=True)


@pytest.mark.parametrize('addresses', [
    ['127.0.0.1'], ['10.0.0.2'], ['169.254.169.254'], ['::1'], ['fc00::1'],
    ['87.250.250.50', '192.168.1.1'], [],
])
def test_dns_must_contain_only_public_addresses(monkeypatch, addresses):
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **k: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, '', (address, 443)) for address in addresses])
    with pytest.raises(transfer.TransferError):
        transfer.public_address('downloader.disk.yandex.ru')


class Reply:
    def __init__(self, status=200, data=b'data', **headers):
        self.status = status
        self.headers = headers
        self.file = io.BytesIO(data)
        self.closed = False

    def getheader(self, name):
        return self.headers.get(name)

    def read(self, limit):
        return self.file.read(limit)

    def close(self):
        self.closed = True


def connection_mock(monkeypatch, replies):
    calls = []

    class Connection:
        def __init__(self, host, address, timeout):
            self.host = host
            self.closed = False
            calls.append(self)

        def request(self, method, target, headers, body=None):
            self.method, self.target, self.headers = method, target, headers
            self.body = b''.join(body) if body is not None else None

        def getresponse(self):
            return replies.pop(0)

        def close(self):
            self.closed = True

    monkeypatch.setattr(transfer, 'public_address', lambda host: '87.250.250.50')
    monkeypatch.setattr(transfer, 'PinnedHTTPSConnection', Connection)
    return calls


def test_download_follows_checked_storage_redirect_without_credentials(monkeypatch):
    first = Reply(302, Location='https://s123.storage.yandex.net/rdisk/file')
    second = Reply(data=b'{"phone":true}', **{'Content-Length': '14'})
    calls = connection_mock(monkeypatch, [first, second])
    with transfer.download(LINK) as result:
        assert result.read() == b'{"phone":true}'
    assert [c.host for c in calls] == ['downloader.disk.yandex.ru', 's123.storage.yandex.net']
    assert all(c.method == 'GET' and c.closed for c in calls)
    assert all(set(c.headers) == {'Accept', 'Accept-Encoding'} for c in calls)
    assert first.closed and second.closed


@pytest.mark.parametrize('destination', ['http://127.0.0.1/private', 'https://evil.test/file',
    'https://s1.storage.yandex.net.evil.test/file', 'https://cloud-api.yandex.net/v1/disk'])
def test_redirect_to_other_services_is_rejected_before_connection(monkeypatch, destination):
    calls = connection_mock(monkeypatch, [Reply(302, Location=destination)])
    with pytest.raises(transfer.TransferError):
        transfer.download(LINK)
    assert len(calls) == 1 and calls[0].closed


@pytest.mark.parametrize('headers,data', [({'Content-Length': '9'}, b'data'), ({}, b'123456789')])
def test_download_size_limit_applies_with_and_without_content_length(monkeypatch, headers, data):
    monkeypatch.setattr(transfer, 'MAX_BYTES', 8)
    reply = Reply(data=data, **headers)
    calls = connection_mock(monkeypatch, [reply])
    with pytest.raises(transfer.TransferError) as error:
        transfer.download(LINK)
    assert error.value.status == 413
    assert reply.closed and calls[0].closed


def test_partial_file_is_never_returned_as_success(monkeypatch):
    connection_mock(monkeypatch, [Reply(data=b'123', **{'Content-Length': '10'})])
    with pytest.raises(transfer.TransferError, match='не полностью'):
        transfer.download(LINK)


def test_network_exception_does_not_reveal_signed_url(monkeypatch):
    def failed(host):
        raise OSError('failed ' + LINK)
    monkeypatch.setattr(transfer, 'public_address', failed)
    with pytest.raises(transfer.TransferError) as error:
        transfer.download(LINK)
    assert LINK not in str(error.value) and 'signed-test-path' not in str(error.value)


def test_tls_uses_checked_ip_and_original_hostname(monkeypatch):
    calls = []
    sock = object()
    monkeypatch.setattr(socket, 'create_connection', lambda address, timeout: calls.append(address) or sock)
    connection = transfer.PinnedHTTPSConnection('downloader.disk.yandex.ru', '87.250.250.50', 20)
    assert connection._context.check_hostname
    class Context:
        def wrap_socket(self, value, server_hostname):
            calls.append((value, server_hostname))
            return value
    connection._context = Context()
    connection.connect()
    assert calls == [('87.250.250.50', 443), (sock, 'downloader.disk.yandex.ru')]


UPLOAD = 'https://uploader1d.dst.yandex.net:443/upload-target/signed-test?token=temporary'


@pytest.mark.parametrize('url', [
    'http://uploader1d.dst.yandex.net/upload-target/test',
    'https://uploader1d.dst.yandex.net.evil.test/upload-target/test',
    'https://uploader1d.evil.dst.yandex.net/upload-target/test',
    'https://user:pass@uploader1d.dst.yandex.net/upload-target/test',
    'https://uploader1d.dst.yandex.net:8080/upload-target/test',
    'https://uploader1d.dst.yandex.net/upload-target/test#fragment',
    'https://cloud-api.yandex.net/v1/disk',
    'https://uploader1d.dst.yandex.net/other/test',
    'https://uploader1d.dst.yandex.net/upload-target/',
    'https://uploader1d.dst.yandex.net/upload-target/../other',
    'https://uploader1d.dst.yandex.net/upload-target/%2e%2e/other',
    'https://uploader1d.dst.yandex.net/upload-target/test\\other',
    'https://127.0.0.1/upload-target/test', 'file:///etc/passwd',
    'https://uploader1d.dst.yandex.net/upload-target/test\r\nInjected:header',
])
def test_upload_target_rejects_unrelated_or_ambiguous_urls(url):
    with pytest.raises(transfer.TransferError):
        transfer.checked_upload_url(url)


@pytest.mark.parametrize('status', [200, 201, 202, 204])
def test_upload_exact_binary_bytes_without_credentials_or_filename(monkeypatch, status):
    reply = Reply(status)
    calls = connection_mock(monkeypatch, [reply])
    data = b'PK\x00\xff\r\n' + 'Журнал'.encode()
    assert transfer.upload(UPLOAD, io.BytesIO(data)) == status
    assert len(calls) == 1
    c = calls[0]
    assert c.host == 'uploader1d.dst.yandex.net' and c.method == 'PUT'
    assert c.target == '/upload-target/signed-test?token=temporary'
    assert c.body == data and c.headers['Content-Length'] == str(len(data))
    assert set(c.headers) == {'Content-Length', 'Content-Type', 'Accept', 'Accept-Encoding'}
    assert c.closed and reply.closed


def test_upload_size_limit_is_checked_before_any_connection(monkeypatch):
    monkeypatch.setattr(transfer, 'MAX_UPLOAD_BYTES', 8)
    calls = connection_mock(monkeypatch, [])
    with pytest.raises(transfer.TransferError) as error:
        transfer.upload(UPLOAD, io.BytesIO(b'123456789'))
    assert error.value.status == 413 and calls == []


@pytest.mark.parametrize('status,body,code', [
    (423, b'{"error":"DiskResourceLockedError"}', 'DiskResourceLocked'),
    (423, b'{"error":"DiskUploadTrafficLimitExceeded","description":"signed-secret"}', 'UploadTrafficLimitExceeded'),
    (423, b'<html>private error signed-secret</html>', 'DiskResourceLocked'),
    (403, b'signed-secret', ''), (409, b'', ''), (429, b'', ''), (507, b'', ''),
])
def test_upload_error_preserves_status_but_not_raw_upstream_details(monkeypatch, status, body, code):
    reply = Reply(status, body)
    calls = connection_mock(monkeypatch, [reply])
    with pytest.raises(transfer.TransferError) as error:
        transfer.upload(UPLOAD, io.BytesIO(b'document'))
    assert error.value.status == status and error.value.code == code
    assert 'signed-secret' not in str(error.value) and UPLOAD not in str(error.value)
    assert len(calls) == 1 and calls[0].closed and reply.closed


@pytest.mark.parametrize('destination', ['https://evil.test/file', UPLOAD])
def test_upload_never_follows_redirects_or_sends_data_twice(monkeypatch, destination):
    calls = connection_mock(monkeypatch, [Reply(307, Location=destination)])
    with pytest.raises(transfer.TransferError):
        transfer.upload(UPLOAD, io.BytesIO(b'document'))
    assert len(calls) == 1 and calls[0].closed


def test_upload_network_error_is_safe_and_not_a_success(monkeypatch):
    def failed(host):
        raise OSError('failed ' + UPLOAD)
    monkeypatch.setattr(transfer, 'public_address', failed)
    with pytest.raises(transfer.TransferError) as error:
        transfer.upload(UPLOAD, io.BytesIO(b'document'))
    assert 'не подтверждено' in str(error.value) and 'signed-test' not in str(error.value)


def test_upload_rejects_private_dns_before_connecting(monkeypatch):
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **k: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 443))])
    monkeypatch.setattr(transfer, 'PinnedHTTPSConnection', lambda *a: pytest.fail('Unexpected connection'))
    with pytest.raises(transfer.TransferError, match='Недопустимый адрес'):
        transfer.upload(UPLOAD, io.BytesIO(b'document'))
