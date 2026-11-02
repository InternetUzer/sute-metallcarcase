"""Security and regression tests for the private park-level CRM."""
import io
import json
import sqlite3

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
    assert client.get('/parks/map-data').json[0]['id']=='IP-101'
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


def test_admin_can_create_employee_without_exposing_password(app, client):
    users(app)
    login(client,1)
    token=csrf(client,'/parks/staff')
    result=client.post('/parks/staff',data={
        'csrf_token':token,'action':'create','name':'Новый менеджер',
        'email':'new.sales@example.com','zone':ZONES[0]})
    assert result.status_code==200
    assert '/reset/' in result.get_data(as_text=True)
    with connect(app) as db:
        user=db.execute("SELECT id,role,password FROM users WHERE email='new.sales@example.com'").fetchone()
        assert user['role']=='field'
        assert user['password'].startswith('scrypt:') or user['password'].startswith('pbkdf2:')
        assert db.execute('SELECT zone FROM sales_staff_zones WHERE user_id=?',
                          (user['id'],)).fetchone()[0]==ZONES[0]


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
