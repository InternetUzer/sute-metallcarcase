import sqlite3
import pytest
from app import create_app


@pytest.fixture
def app(tmp_path):
    app = create_app({'TESTING':True,'SECRET_KEY':'kontur-test-secret','DATA_DIR':str(tmp_path)})
    with sqlite3.connect(app.config['DATABASE']) as db:
        db.execute("INSERT INTO users(email,name,password,role) VALUES('owner@example.test','Owner','unused','admin')")
        db.execute("INSERT INTO users(email,name,password,role) VALUES('client@example.test','Client','unused','client')")
    return app


def login(client, user=1):
    with client.session_transaction() as s:
        s['user_id']=user
        s['user_version']=1


def test_owner_auth_and_private_assets(app):
    client=app.test_client()
    assert client.get('/kontur/').status_code==302
    assert client.get('/kontur/api/state').status_code==401
    assert client.get('/kontur/static/app.js').status_code==302
    login(client,2)
    assert client.get('/kontur/').status_code==403
    login(client)
    response=client.get('/kontur/')
    assert response.status_code==200
    assert 'no-store' in response.headers['Cache-Control']
    assert 'noindex' in response.headers['X-Robots-Tag']
    assert client.get('/kontur/static/app.js').status_code==200


def test_json_csrf_and_existing_site_csrf(app):
    client=app.test_client()
    login(client)
    body={'id':'project-test','kind':'project','expected':'','data':{'title':'Тест'}}
    assert client.post('/kontur/api/record',json=body).status_code==403
    csrf=client.get('/kontur/bootstrap').json['csrf']
    assert client.post('/kontur/api/record',json=body,headers={'X-Kontur-CSRF':csrf,'Origin':'https://evil.example'}).status_code==403
    assert client.post('/kontur/api/record',json=body,headers={'X-Kontur-CSRF':csrf}).status_code==200
    assert client.post('/admin/prorab/root',data={'root':'/test'}).status_code==400


def test_device_scope_and_revocation(app):
    client=app.test_client()
    login(client)
    csrf=client.get('/kontur/bootstrap').json['csrf']
    result=client.post('/kontur/api/devices',json={'name':'Laptop'},headers={'X-Kontur-CSRF':csrf}).json
    device=app.test_client()
    headers={'Authorization':'Bearer '+result['token']}
    assert device.get('/kontur/api/health',headers=headers).status_code==200
    assert device.post('/kontur/api/sync',json={'records':[]},headers=headers).status_code==200
    assert device.post('/kontur/api/devices',json={},headers=headers).status_code==403
    assert device.get('/kontur/api/state',headers=headers).status_code==403
    client.post('/kontur/api/devices/revoke',json={'id':result['id']},headers={'X-Kontur-CSRF':csrf})
    assert device.get('/kontur/api/health',headers=headers).status_code==401


def test_unrelated_public_pages_remain_accessible(app):
    client=app.test_client()
    assert client.get('/').status_code==200
    assert client.get('/prorab').status_code==200
    assert client.get('/login').status_code==200
