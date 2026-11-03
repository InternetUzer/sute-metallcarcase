"""Security and regression tests for the private park-level CRM."""
import io
import json
import sqlite3
from pathlib import Path
import re
from urllib.parse import urlparse, unquote

import pytest
from werkzeug.security import generate_password_hash

from app import create_app
from industrial_outreach import ZONES


@pytest.fixture
def app(tmp_path):
    return create_app({
        'TESTING': True, 'SECRET_KEY': 'outreach-tests-not-for-production',
        'DATA_DIR': str(tmp_path), 'SITE_URL': 'https://example.com',
        'SITE_INDEXABLE': True,
    })


@pytest.fixture
def client(app):
    return app.test_client()


def connect(app):
    db = sqlite3.connect(app.config['DATABASE'])
    db.row_factory = sqlite3.Row
    return db


def users(app):
    with connect(app) as db:
        for name, role in [('admin', 'admin'), ('north', 'field'), ('east', 'field'),
                           ('south', 'field'), ('client', 'client')]:
            db.execute(
                'INSERT INTO users(email,name,password,role) VALUES(?,?,?,?)',
                (name+'@example.com', name, generate_password_hash('long-safe-password-123'), role))
        db.execute('INSERT INTO sales_staff_zones(user_id,zone) VALUES (?,?)', (2,ZONES[0]))
        db.execute('INSERT INTO sales_staff_zones(user_id,zone) VALUES (?,?)', (3,ZONES[1]))
        db.execute('INSERT INTO sales_staff_zones(user_id,zone) VALUES (?,?)', (4,ZONES[2]))


def login(client, user_id):
    with client.session_transaction() as state:
        state['user_id'] = user_id
        state['user_version'] = 1


def csrf(client, path='/parks'):
    client.get(path)
    with client.session_transaction() as state:
        return state['csrf']


def park(pid, zone, name):
    return {
        'id':pid,'zone':zone,'name':name,'address':'Московская область, парк '+name,
        'category':'Промышленно-логистический парк','stage':'В развитии',
        'focus_rank':'A — целевой парк','area':30,'lat':55.75,'lon':37.75,
        'radius_km':8.0,'source':'https://example.com/parks'
    }


def import_parks(client, entries):
    token = csrf(client)
    return client.post('/parks/import', data={
        'csrf_token': token, 'file': (
            io.BytesIO(json.dumps({'parks':entries},ensure_ascii=False).encode('utf8')),
            'parks.json')
    }, content_type='multipart/form-data')


def test_roles_zones_and_map_protect_private_content(app, client):
    users(app)
    login(client,1)
    response = import_parks(client, [
        park('IP-101',ZONES[0],'Северный парк'),
        park('IP-102',ZONES[1],'Восточный парк'),
        park('IP-103',ZONES[2],'Южный парк')])
    assert response.status_code == 302
    assert {p['id'] for p in client.get('/parks/map-data').json} == {'IP-101', 'IP-102', 'IP-103'}
    assert len(client.get('/parks/map-data').json) == 3

    login(client,2)
    assert 'Северный парк' in client.get('/parks').get_data(as_text=True)
    assert 'Восточный парк' not in client.get('/parks').get_data(as_text=True)
    data = client.get('/parks/map-data').json
    assert [p['id'] for p in data] == ['IP-101']
    assert client.get('/parks/IP-101').status_code == 200
    assert client.get('/parks/IP-102').status_code == 404
    assert client.post('/parks/IP-102/contacts',
                       data={'csrf_token':csrf(client),'name':'Нельзя'}).status_code==404
    assert client.get('/parks/staff').status_code == 403
    assert client.post('/parks/import', data={'csrf_token':csrf(client)}).status_code==403
    assert 'noindex' in client.get('/parks').headers['X-Robots-Tag']
    assert 'no-store' == client.get('/parks').headers['Cache-Control']

    login(client,5)
    assert client.get('/parks').status_code == 403
    assert client.get('/parks/map-data').status_code == 403
    assert client.get('/parks/IP-101').status_code == 403


def test_yandex_tiles_configuration_is_owner_only_and_validated(app, client):
    users(app)
    login(client, 1)
    # Synthetic API key, never submitted to an external map service.
    key = 'synthetic-yandex-tiles-test-key'
    response = client.post('/parks/map-settings', data={'api_key': key})
    assert response.status_code == 400
    token = csrf(client, '/parks/map-settings')
    response = client.post('/parks/map-settings', data={'csrf_token': token, 'api_key': key})
    assert response.status_code == 302
    assert key not in client.get('/parks/map-settings').get_data(as_text=True)
    page = client.get('/parks')
    assert f'data-yandex-key="{key}"' in page.get_data(as_text=True)
    assert 'https://tiles.api-maps.yandex.ru' in page.headers['Content-Security-Policy']
    # The browser key belongs only on the private map, never on public pages.
    assert key not in client.get('/').get_data(as_text=True)
    for bad in ['', 'short', '<script>alert(1)</script>', 'x'*201]:
        assert client.post('/parks/map-settings', data={
            'csrf_token': token, 'api_key': bad}).status_code == 422
    with connect(app) as database:
        assert database.execute("SELECT value FROM settings WHERE key='parks_yandex_tiles_key'").fetchone()[0] == key
        database.execute("INSERT INTO users(email,name,password,role) VALUES('sharedqa','QA','unused','outreach')")
        shared_id = database.execute("SELECT id FROM users WHERE role='outreach'").fetchone()[0]
    for uid in [2, 5, shared_id]:
        login(client, uid)
        assert client.get('/parks/map-settings').status_code == 403
        assert client.post('/parks/map-settings', data={'csrf_token': csrf(client), 'api_key': key}).status_code == 403
    assert 'Настройка карты' not in client.get('/parks').get_data(as_text=True)


def test_visits_contacts_and_import_do_not_erase_notes(app, client):
    users(app)
    login(client,1)
    assert import_parks(client,[park('IP-101',ZONES[0],'Северный парк')]).status_code==302
    login(client,2)
    token=csrf(client,'/parks/IP-101')
    assert client.post('/parks/IP-101/contacts',data={
        'csrf_token':token,'name':'Иван Петров','phone':'+7 900 000-00-00',
        'role':'Руководитель парка','is_owner':'on','note':'Связаться в декабре'
    }).status_code==302
    assert client.post('/parks/IP-101/visits',data={
        'csrf_token':token,'visit_date':'2026-11-02','status':'Контакт найден',
        'building_type':'Ангар','building_m2':'1600',
        'note':'Есть планы расширения','next_action':'Направить портфолио',
        'next_date':'2026-11-12'
    }).status_code==302
    with connect(app) as db:
        assert db.execute('SELECT COUNT(*) FROM sales_contacts').fetchone()[0]==1
        assert db.execute('SELECT COUNT(*) FROM sales_visits').fetchone()[0]==1
        assert db.execute("SELECT visit_status FROM sales_parks WHERE id='IP-101'").fetchone()[0]=='Контакт найден'

    login(client,1)
    updated=park('IP-101',ZONES[0],'Обновлённое название парка')
    assert import_parks(client,[updated]).status_code==302
    with connect(app) as db:
        assert db.execute('SELECT COUNT(*) FROM sales_contacts').fetchone()[0]==1
        assert db.execute('SELECT COUNT(*) FROM sales_visits').fetchone()[0]==1
        row=db.execute("SELECT name,visit_status,next_action FROM sales_parks WHERE id='IP-101'").fetchone()
        assert row['name']=='Обновлённое название парка'
        assert row['visit_status']=='Контакт найден'
        assert row['next_action']=='Направить портфолио'


def test_bad_import_is_atomic_and_all_forms_require_csrf(app, client):
    users(app)
    login(client,1)
    original=park('IP-101',ZONES[0],'Первый парк')
    assert import_parks(client,[original]).status_code==302
    newer=park('IP-101',ZONES[0],'Изменить нельзя')
    invalid=park('IP-102','НЕСУЩЕСТВУЮЩАЯ ЗОНА','Некорректный')
    assert import_parks(client,[newer,invalid]).status_code==422
    with connect(app) as db:
        assert db.execute("SELECT name FROM sales_parks WHERE id='IP-101'").fetchone()[0]=='Первый парк'
        assert db.execute("SELECT COUNT(*) FROM sales_parks").fetchone()[0]==1
    assert client.post('/parks/import', data={}).status_code == 400
    login(client,2)
    assert client.post('/parks/IP-101/visits',data={
        'csrf_token':csrf(client),'visit_date':'2026-11-02','status':'Контакт найден',
        'building_m2':'Infinity'
    }).status_code==422
    with connect(app) as db:
        assert db.execute("SELECT COUNT(*) FROM sales_visits").fetchone()[0]==0


def test_admin_can_create_shared_login_without_exposing_password(app, client):
    from werkzeug.security import check_password_hash
    users(app)
    login(client, 1)
    result = client.post('/parks/staff', data={
        'csrf_token': csrf(client, '/parks/staff'), 'action': 'create',
        'login': 'shared_team', 'password': 'qa-only-pass', 'confirm': 'qa-only-pass'})
    assert result.status_code == 302 and result.location == '/parks/staff'
    page = client.get('/parks/staff').text
    assert 'shared_team' in page and 'qa-only-pass' not in page
    with connect(app) as db:
        user = db.execute("SELECT * FROM users WHERE email='shared_team'").fetchone()
        assert user['role'] == 'outreach' and user['name'] == 'Сотрудники'
        assert check_password_hash(user['password'], 'qa-only-pass')
        assert db.execute('SELECT zone FROM sales_staff_zones WHERE user_id=?', (user['id'],)).fetchone() is None


def test_yandex_maps_routes_are_universal_and_accurate(client, app):
    """No Yandex key, no native scheme; safe search when entrance is uncertain."""
    from yandex_park_routes import (
        yandex_route_url, yandex_search_url, precise_entrance, park_yandex_links,
    )
    from urllib.parse import unquote
    assert unquote(yandex_route_url(55.75, 37.62)) == (
        'https://yandex.ru/maps/?rtext=~55.7500000,37.6200000&rtt=auto'
    )
    assert yandex_route_url(None, 37.62) == ''
    assert yandex_route_url(float('nan'), 37.62) == ''
    assert yandex_route_url(555.75, 37.62) == ''
    assert '%D0%9A%D1%83%D0%BF%D0%B0%D0%B2%D0%BD%D0%B0' in yandex_search_url(
        'М7 Купавна', 'Московская область, Старая Купавна'
    )
    assert not precise_entrance('ориентир населенного пункта')
    assert not precise_entrance('по предыдущему реестру; требует проверки')
    assert precise_entrance('Точка въезда подтверждена')

    users(app)
    login(client,1)
    approximate=park('IP-101',ZONES[0],'М7 Купавна')
    approximate['accuracy']='ориентир населённого пункта'
    no_coords=park('IP-102',ZONES[1],'Парк без геометки')
    no_coords.update(lat=None,lon=None)
    assert import_parks(client,[approximate,no_coords]).status_code==302
    data={x['id']:x for x in client.get('/parks/map-data').json}
    assert data['IP-101']['route_url'].startswith('https://yandex.ru/maps/?rtext=~')
    assert data['IP-101']['entrance_confirmed'] is False
    assert data['IP-102']['route_url']==''
    assert data['IP-102']['search_url'].startswith('https://yandex.ru/maps/?text=')
    page=client.get('/parks/IP-101').text
    assert 'Маршрут к ориентиру в Яндекс Картах' in page
    assert 'Найти парк по адресу' in page
    assert 'въезд в парк не подтверждён' in page
    assert 'yandexnavi://' not in page
    assert 'rtt=auto' in page
    assert 'href="https://yandex.ru/maps/?' in page
    page_without_coords=client.get('/parks/IP-102').text
    assert 'Найти парк по адресу' in page_without_coords
    assert 'Маршрут к ориентиру' not in page_without_coords


@pytest.mark.parametrize('query,expected', [
    ('rank=&q=сЕвЕр', ['IP-101']),
    ('rank=B', ['IP-102']),
    ('rank=invalid', ['IP-101', 'IP-102']),
    ('rank=&q=%25', []),
    ('rank=&q=IP-102', ['IP-102']),
])
def test_table_and_map_use_same_filters(app, client, query, expected):
    from html import unescape
    users(app)
    login(client, 1)
    north = park('IP-101', ZONES[0], 'Северный парк')
    east = park('IP-102', ZONES[1], 'Восточный парк')
    east['focus_rank'] = 'B — новый девелопмент'
    import_parks(client, [north, east])
    page = client.get('/parks?' + query).text
    assert re.findall(r'class="outreach-name" href="/parks/(IP-\d+)"', page) == expected
    map_url = unescape(re.search(r'id="outreach-map" data-url="([^"]+)"', page)[1])
    assert [p['id'] for p in client.get(map_url).json] == expected
    assert [p['id'] for p in client.get('/parks/map-data?' + query).json] == expected


def test_field_cannot_override_zone_or_access_client_cabinet(app, client):
    users(app)
    login(client, 1)
    import_parks(client, [park('IP-101', ZONES[0], 'Северный парк'),
                          park('IP-102', ZONES[1], 'Восточный парк')])
    # Even a legacy/misassigned project must not grant this role client access.
    with connect(app) as db:
        db.execute("INSERT INTO projects(id,user_id,title) VALUES(1,2,'Private client project')")
        db.execute("INSERT INTO files(id,project_id,original_name,storage_name) VALUES(1,1,'private.txt','private.txt')")
    (Path(app.config['DATA_DIR']) / 'files/private.txt').write_text('private client content')
    login(client, 2)
    assert [p['id'] for p in client.get('/parks/map-data', query_string={'zone': ZONES[1]}).json] == ['IP-101']
    for path in ['/cabinet', '/cabinet/projects/1', '/files/1', '/admin', '/admin/prorab']:
        assert client.get(path).status_code == 403, path
    # A field user without an assigned zone has no default access.
    with connect(app) as db:
        db.execute('DELETE FROM sales_staff_zones WHERE user_id=2')
    assert client.get('/parks/map-data').json == []
    assert client.get('/parks/IP-101').status_code == 404


def test_shared_login_all_reports_two_sessions_and_password_rotation(app, client):
    users(app)
    login(client, 1)
    import_parks(client, [park('IP-101', ZONES[0], 'Северный парк'),
                          park('IP-102', ZONES[1], 'Восточный парк'),
                          park('IP-103', ZONES[2], 'Южный парк')])
    token = csrf(client)
    client.post('/parks/IP-101/visits', data={'csrf_token': token,
        'visit_date': '2026-11-02', 'status': 'Переговоры', 'note': 'Отчёт владельца'})
    assert client.post('/parks/staff', data={'csrf_token': token, 'action': 'create',
        'login': 'shared_team', 'password': 'qa-pass-1', 'confirm': 'qa-pass-1'}).status_code == 302
    employees = [app.test_client(), app.test_client()]
    for employee in employees:
        response = employee.post('/login', data={'csrf_token': csrf(employee, '/login'),
            'email': 'SHARED_TEAM', 'password': 'qa-pass-1'})
        assert response.status_code == 302 and response.location == '/parks'
        assert len(employee.get('/parks/map-data?rank=').json) == 3
        for i, zone in enumerate(ZONES):
            data = employee.get('/parks/map-data', query_string={'zone': zone, 'rank': ''}).json
            assert [p['id'] for p in data] == ['IP-' + str(101 + i)]
            assert employee.get('/parks/IP-' + str(101 + i)).status_code == 200
        assert 'Отчёт владельца' in employee.get('/parks/IP-101').text
        page = employee.get('/parks').text
        assert 'name="zone"' in page and 'href="/parks" aria-label="Личный кабинет"' in page
        assert 'href="/admin"' not in page and 'href="/parks/staff"' not in page
        assert 'action="/parks/import"' not in page
        for path in ['/admin', '/admin/prorab', '/admin/photos', '/admin/seo', '/parks/staff', '/cabinet']:
            assert employee.get(path).status_code == 403, path
        assert employee.post('/parks/import', data={'csrf_token': csrf(employee)}).status_code == 403
    a, b = employees
    assert a.post('/parks/IP-103/contacts', data={'csrf_token': csrf(a),
        'name': 'Контакт команды'}).status_code == 302
    assert a.post('/parks/IP-103/visits', data={'csrf_token': csrf(a),
        'visit_date': '2026-11-02', 'status': 'Выезд выполнен', 'note': 'Общий отчёт'}).status_code == 302
    for viewer in (b, client):
        page = viewer.get('/parks/IP-103').text
        assert 'Общий отчёт' in page and 'Контакт команды' in page and 'Сотрудники' in page
    assert client.post('/parks/staff', data={'csrf_token': token, 'action': 'password',
        'password': 'qa-pass-2', 'confirm': 'qa-pass-2'}).status_code == 302
    for employee in employees:
        response = employee.get('/parks')
        assert response.status_code == 302 and response.location == '/login'
    assert client.get('/admin').status_code == 200
    response = a.post('/login', data={'csrf_token': csrf(a, '/login'),
        'email': 'shared_team', 'password': 'qa-pass-2'})
    assert response.status_code == 302 and response.location == '/parks'


def test_shared_account_is_single_and_cannot_access_misassigned_client_files(app, client):
    users(app)
    login(client, 1)
    data = {'csrf_token': csrf(client), 'action': 'create', 'login': 'shared_team',
            'password': 'qa-pass-1', 'confirm': 'qa-pass-1'}
    assert client.post('/parks/staff', data=data).status_code == 302
    assert client.post('/parks/staff', data={**data, 'login': 'another_team'}).status_code == 409
    assert client.post('/parks/staff', data={**data, 'csrf_token': ''}).status_code == 400
    with connect(app) as db:
        shared_id = db.execute("SELECT id FROM users WHERE role='outreach'").fetchone()[0]
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("INSERT INTO users(email,name,password,role) VALUES('other','other','unusable','outreach')")
        db.execute("INSERT INTO projects(id,user_id,title) VALUES(1,?,'Private project')", (shared_id,))
        db.execute("INSERT INTO files(id,project_id,original_name,storage_name) VALUES(1,1,'private.txt','private.txt')")
    (Path(app.config['DATA_DIR']) / 'files/private.txt').write_text('private client content')
    login(client, shared_id)
    for path in ['/cabinet/projects/1', '/files/1']:
        assert client.get(path).status_code == 403
    assert client.post('/parks/staff', data={**data, 'action': 'password'}).status_code == 403


@pytest.mark.parametrize('change', [
    {'login': 'a'}, {'login': 'not a login'}, {'password': 'short', 'confirm': 'short'},
    {'confirm': 'mismatch'}, {'login': 'north@example.com'},
])
def test_invalid_shared_account_does_not_change_users(app, client, change):
    users(app)
    login(client, 1)
    data = {'csrf_token': csrf(client), 'action': 'create', 'login': 'shared_team',
            'password': 'qa-pass-1', 'confirm': 'qa-pass-1'}
    with connect(app) as db:
        before = [tuple(row) for row in db.execute('SELECT * FROM users ORDER BY id')]
    assert client.post('/parks/staff', data={**data, **change}).status_code == 422
    with connect(app) as db:
        assert [tuple(row) for row in db.execute('SELECT * FROM users ORDER BY id')] == before


def test_canonical_117_registry_cli_import_is_repeatable(app, client):
    registry = Path(__file__).resolve().parents[1] / 'docs/industrial-outreach/industrial_parks_prospecting_import.json'
    users(app)
    runner = app.test_cli_runner()
    first = runner.invoke(args=['import-parks', str(registry)])
    assert first.exit_code == 0, first.output
    login(client, 2)
    token = csrf(client)
    assert client.post('/parks/IP-001/contacts', data={
        'csrf_token': token, 'name': 'Тестовый контакт'}).status_code == 302
    assert client.post('/parks/IP-001/visits', data={
        'csrf_token': token, 'visit_date': '2026-11-02', 'status': 'Переговоры',
        'cadastral_number': '77:01:0000000:123', 'note': 'Сохранить после импорта'}).status_code == 302
    second = runner.invoke(args=['import-parks', str(registry)])
    assert second.exit_code == 0, second.output
    with connect(app) as db:
        assert db.execute('SELECT COUNT(*) FROM sales_parks').fetchone()[0] == 117
        assert db.execute('SELECT COUNT(*) FROM sales_parks WHERE lat IS NOT NULL AND lon IS NOT NULL').fetchone()[0] == 115
        assert [db.execute('SELECT COUNT(*) FROM sales_parks WHERE zone=?', (z,)).fetchone()[0] for z in ZONES] == [31, 55, 31]
        assert db.execute('SELECT COUNT(*) FROM sales_contacts').fetchone()[0] == 1
        assert db.execute('SELECT COUNT(*) FROM sales_visits').fetchone()[0] == 1
        assert db.execute("SELECT visit_status FROM sales_parks WHERE id='IP-001'").fetchone()[0] == 'Переговоры'
    assert '77:01:0000000:123' in client.get('/parks/IP-001').text


def test_private_pages_and_bundled_map(app, client):
    for path in ['/parks', '/parks/map-data', '/parks/IP-101', '/parks/staff']:
        response = client.get(path)
        assert response.status_code == 302 and response.location == '/login'
        assert response.headers['Cache-Control'] == 'no-store'
        assert 'noindex' in response.headers['X-Robots-Tag']
    users(app)
    login(client, 1)
    page = client.get('/parks')
    assert 'unpkg.com' not in page.text
    assert 'unpkg.com' not in page.headers['Content-Security-Policy']
    assert 'tile.openstreetmap.org' in page.headers['Content-Security-Policy']
    assert 'tile.openstreetmap.org' not in client.get('/').headers['Content-Security-Policy']
    js = client.get('/static/vendor/leaflet-1.9.4/leaflet.js')
    assert js.status_code == 200 and 'javascript' in js.mimetype
    assert client.get('/static/vendor/leaflet-1.9.4/leaflet.css').mimetype == 'text/css'
