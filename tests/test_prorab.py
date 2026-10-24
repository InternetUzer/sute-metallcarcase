"""Журнал «Прораб+» (/admin/prorab): только владельцу; браузеру разрешён только Яндекс Диск."""
import sqlite3
import subprocess
from pathlib import Path
import pytest
from werkzeug.security import generate_password_hash
from app import create_app

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def app(tmp_path):
    app = create_app({'TESTING': True, 'SECRET_KEY': 'test-secret-not-for-production', 'DATA_DIR': str(tmp_path), 'SITE_URL': 'https://example.com'})
    with sqlite3.connect(app.config['DATABASE']) as db:
        for email, role in [('owner@example.com', 'admin'), ('client@example.com', 'client')]:
            db.execute('INSERT INTO users(email,name,password,role) VALUES(?,?,?,?)', (email, email, generate_password_hash('correct-password-123'), role))
    return app


def login(client, user_id):
    with client.session_transaction() as s:
        s['user_id'] = user_id
        s['user_version'] = 1


def test_only_owner_opens_journal(app):
    client = app.test_client()
    assert client.get('/admin/prorab').status_code == 302
    login(client, 2)
    assert client.get('/admin/prorab').status_code == 403
    login(client, 1)
    r = client.get('/admin/prorab')
    assert r.status_code == 200
    html = r.get_data(as_text=True)
    for name in ['schema.js', 'sync.js', 'persistence.js', 'model.js', 'vault.js', 'economy.js', 'economy-store.js', 'disk.js', 'office.js', 'app.js', 'prorab.css']:
        assert '/static/prorab/' + name in html
        assert (ROOT / 'static/prorab' / name).is_file()
    assert 'style=' not in html and '<script>' not in html  # без встроенных скриптов и стилей (CSP)
    assert r.headers['X-Robots-Tag'] == 'noindex, nofollow'
    assert 'no-store' in r.headers['Cache-Control']


def test_disk_allowed_only_for_journal(app):
    client = app.test_client()
    login(client, 1)
    csp = client.get('/admin/prorab').headers['Content-Security-Policy']
    assert "connect-src 'self' https://cloud-api.yandex.net" in csp
    assert "script-src 'self' 'wasm-unsafe-eval';" in csp  # только WebAssembly для перевода DWG
    # Место объекта по адресу и «Где я сейчас» — только в журнале
    assert "img-src 'self' data: blob:" in csp  # local photo decoding uses blob URLs
    assert 'https://nominatim.openstreetmap.org' in csp and 'https://geocoding-api.open-meteo.com' in csp
    assert 'geolocation=(self)' in client.get('/admin/prorab').headers['Permissions-Policy']
    other = client.get('/admin').headers['Content-Security-Policy']
    assert 'yandex' not in other.split('connect-src')[1].split(';')[0]
    assert 'blob:' not in other
    assert 'openstreetmap' not in other and 'wasm-unsafe-eval' not in other
    assert 'geolocation=()' in client.get('/admin').headers['Permissions-Policy']
    assert 'href="/admin/prorab"' in client.get('/admin').get_data(as_text=True)


def test_client_id_for_yandex_login(app, monkeypatch):
    client = app.test_client()
    login(client, 1)
    assert 'data-client-id="637047bceacd46c9b55023e0658d2a6e"' in client.get('/admin/prorab').get_data(as_text=True)
    monkeypatch.setenv('YANDEX_CLIENT_ID', 'abc123')
    assert 'data-client-id="abc123"' in client.get('/admin/prorab').get_data(as_text=True)


def test_browser_core_tests_pass():
    """Ядро объединения данных (как у телефона) — тесты Node, если Node есть."""
    try:
        r = subprocess.run(['node', '--test', *map(str, sorted((ROOT / 'tests/prorab').glob('*.test.js')))], cwd=ROOT, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        pytest.skip('Node.js не установлен')
    assert r.returncode == 0, r.stdout + r.stderr


def test_shared_page_for_invited_people(app):
    """Открытый адрес для тех, с кем поделились папкой на Диске: без входа на сайт, закрыт от поиска."""
    client = app.test_client()
    r = client.get('/prorab')
    assert r.status_code == 200
    html = r.get_data(as_text=True)
    assert '/static/prorab/app.js' in html and 'href="/admin"' not in html
    assert r.headers['X-Robots-Tag'] == 'noindex, nofollow'
    assert "connect-src 'self' https://cloud-api.yandex.net" in r.headers['Content-Security-Policy']
    assert 'Disallow: /prorab' in client.get('/robots.txt').get_data(as_text=True)


def test_signed_download_requires_csrf_and_keeps_url_out_of_response(app, monkeypatch):
    import io
    import prorab_transfer
    client = app.test_client()
    page = client.get('/prorab')
    assert b'data-download-url="/prorab/download"' in page.data
    with client.session_transaction() as session:
        token = session['csrf']
    assert client.post('/prorab/download', data={'href': 'private-link'}).status_code == 400
    seen = []
    monkeypatch.setattr(prorab_transfer, 'download', lambda href: seen.append(href) or io.BytesIO(b'phone-data'))
    result = client.post('/prorab/download', data={'href': 'signed-link', 'csrf_token': token})
    assert result.status_code == 200 and result.data == b'phone-data'
    assert seen == ['signed-link']
    assert 'no-store' in result.headers['Cache-Control']
    assert result.headers['X-Robots-Tag'] == 'noindex, nofollow'
    assert result.headers['X-Content-Type-Options'] == 'nosniff'
    assert 'attachment' in result.headers['Content-Disposition']
    assert client.post('/prorab/download', data={'href': 'signed-link', 'csrf_token': token},
                       headers={'Authorization': 'OAuth test-token'}).status_code == 400
    assert seen == ['signed-link']


def test_relay_rejects_unrelated_url_without_network(app):
    client = app.test_client()
    client.get('/prorab')
    with client.session_transaction() as session:
        token = session['csrf']
    response = client.post('/prorab/download', data={'href': 'http://127.0.0.1', 'csrf_token': token})
    assert response.status_code == 400 and response.is_json


def test_owner_pins_desktop_folder_for_everyone(app):
    """Папка рабочего стола закрепляется владельцем на сайте и подставляется всем (и приглашённым на /prorab)."""
    client = app.test_client()
    assert 'data-root="/Прораб+"' in client.get('/prorab').get_data(as_text=True)
    assert 'data-root-save' not in client.get('/prorab').get_data(as_text=True)
    login(client, 2)
    assert client.post('/admin/prorab/root', data={'root': '/x'}).status_code == 400  # без формы CSRF
    login(client, 1)
    html = client.get('/admin/prorab').get_data(as_text=True)
    assert 'data-root-save="/admin/prorab/root"' in html
    with client.session_transaction() as s:
        token = s['csrf']
    assert client.post('/admin/prorab/root', data={'csrf_token': token, 'root': '../x'}).status_code == 400
    assert client.post('/admin/prorab/root', data={'csrf_token': token, 'root': '/'}).status_code == 400
    r = client.post('/admin/prorab/root', data={'csrf_token': token, 'root': ' /Технадзор/ '})
    assert r.status_code == 200 and r.get_json() == {'ok': True, 'root': '/Технадзор'}
    other = app.test_client()
    assert 'data-root="/Технадзор"' in other.get('/prorab').get_data(as_text=True)
    login(other, 2)  # клиент сайта не может менять папку
    other.get('/request')  # страница с формой — в сессии появится CSRF
    with other.session_transaction() as s:
        t2 = s.get('csrf', '')
    assert other.post('/admin/prorab/root', data={'csrf_token': t2, 'root': '/Чужое'}).status_code == 403


def test_drawing_viewer_files_are_served(app):
    """Чертежи: разбор DXF, просмотр и pdf.js (Mozilla) — свои файлы сайта, без сторонних адресов."""
    client = app.test_client()
    login(client, 1)
    html = client.get('/admin/prorab').get_data(as_text=True)
    for name in ('catalog.js', 'dxf.js', 'viewer.js'):
        assert f'src="/static/prorab/{name}?v=' in html
        assert client.get(f'/static/prorab/{name}').status_code == 200
    assert 'data-pdfjs="/static/prorab/vendor/pdf.min.js?v=' in html
    assert 'data-dwg="/static/prorab/vendor/libredwg/libredwg-web.js?v=' in html
    assert client.get('/static/prorab/vendor/libredwg/libredwg-web.wasm').status_code == 200
    for name in ('pdf.min.js', 'pdf.worker.min.js', 'libredwg/libredwg-web.js'):
        r = client.get(f'/static/prorab/vendor/{name}')
        assert r.status_code == 200 and 'javascript' in r.mimetype
        assert b'sourceMappingURL' not in r.data
