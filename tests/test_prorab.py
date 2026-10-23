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
    for name in ['schema.js', 'sync.js', 'model.js', 'disk.js', 'office.js', 'app.js', 'prorab.css']:
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
    assert "script-src 'self';" in csp
    other = client.get('/admin').headers['Content-Security-Policy']
    assert 'yandex' not in other.split('connect-src')[1].split(';')[0]
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
