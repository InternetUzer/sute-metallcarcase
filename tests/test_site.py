import hashlib
import io
import sqlite3
import time
from pathlib import Path
from urllib.parse import urlparse
import xml.etree.ElementTree as ET
import pytest
from bs4 import BeautifulSoup
from werkzeug.security import generate_password_hash
from app import create_app

@pytest.fixture
def app(tmp_path):
    return create_app({'TESTING':True,'SECRET_KEY':'test-secret-not-for-production','DATA_DIR':str(tmp_path),'SITE_URL':'https://example.com','SITE_INDEXABLE':True})

@pytest.fixture
def client(app):
    return app.test_client()

def connection(app):
    db=sqlite3.connect(app.config['DATABASE']); db.row_factory=sqlite3.Row
    return db

def csrf(client, path='/request'):
    client.get(path)
    with client.session_transaction() as s:
        return s['csrf']

def login_as(client, user_id):
    with client.session_transaction() as s:
        s['user_id']=user_id; s['user_version']=1

def seed(app):
    with connection(app) as db:
        for email,role in [('owner@example.com','admin'),('a@example.com','client'),('b@example.com','client')]:
            db.execute('INSERT INTO users(email,name,password,role) VALUES(?,?,?,?)',(email,email,generate_password_hash('correct-password-123'),role))
        db.execute("INSERT INTO projects(user_id,title) VALUES(2,'Private project A')")
        db.execute("INSERT INTO projects(user_id,title) VALUES(3,'Private project B')")


def test_public_pages_and_assets(client):
    sitemap=ET.fromstring(client.get('/sitemap.xml').data)
    titles=[]
    for location in sitemap.iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc'):
        path=urlparse(location.text).path
        response=client.get(path)
        assert response.status_code==200,path
        html=BeautifulSoup(response.data,'html.parser')
        assert len(html.select('h1'))==1,path
        assert html.select_one('meta[name="description"]')['content'],path
        assert html.select_one('link[rel="canonical"]')['href']==location.text
        titles.append(html.title.text)
        for image in html.select('img[src^="/static/"]'):
            assert client.get(image['src']).status_code==200,image['src']
    assert len(titles)==len(set(titles))
    assert client.get('/does-not-exist').status_code==404


def test_staging_and_private_noindex(app,client):
    assert 'noindex' in client.get('/login').headers['X-Robots-Tag']
    assert '/cabinet' not in client.get('/sitemap.xml').text
    app.config['SITE_INDEXABLE']=False
    assert 'Disallow: /\n' in client.get('/robots.txt').text
    assert 'noindex' in client.get('/').headers['X-Robots-Tag']


def test_lead_saved_with_private_attachment(app,client):
    token=csrf(client)
    response=client.post('/request',data={'csrf_token':token,'contact':'client@example.com','services':'building','city':'Тестовый город','consent':'yes','files':(io.BytesIO(b'%PDF-1.4 test'),'project.pdf')})
    assert response.status_code==302
    with connection(app) as db:
        lead=db.execute('SELECT * FROM leads').fetchone(); file=db.execute('SELECT * FROM files').fetchone()
    assert lead['city']=='Тестовый город'
    assert (Path(app.config['DATA_DIR'])/'files'/file['storage_name']).read_bytes()==b'%PDF-1.4 test'
    assert client.get('/files/'+str(file['id'])).status_code==302
    assert client.get('/static/files/'+file['storage_name']).status_code==404
    assert lead['number'] in client.get('/request/success').text

@pytest.mark.parametrize('override',[{'consent':''},{'contact':'bad'},{'width':'nan'},{'services':'unknown'}])
def test_invalid_request_not_saved(app,client,override):
    data={'csrf_token':csrf(client),'contact':'a@example.com','services':'building','consent':'yes',**override}
    assert client.post('/request',data=data).status_code==422
    with connection(app) as db: assert db.execute('SELECT count(*) FROM leads').fetchone()[0]==0


def test_csrf_and_bad_file(app,client):
    assert client.post('/request',data={'contact':'a@example.com'}).status_code==400
    data={'csrf_token':csrf(client),'contact':'a@example.com','services':'building','consent':'yes','files':(io.BytesIO(b'bad'),'script.html')}
    assert client.post('/request',data=data).status_code==422
    assert list((Path(app.config['DATA_DIR'])/'files').iterdir())==[]


def test_document_workflow_and_client_isolation(app,client):
    seed(app); login_as(client,1)
    token=csrf(client,'/admin')
    response=client.post('/admin/projects/1',data={'csrf_token':token,'status':'Монтаж','body':'Документ готов','version':'2','files':(io.BytesIO(b'private drawing'),'drawing.dwg')})
    assert response.status_code==302
    with connection(app) as db: file=db.execute('SELECT * FROM files').fetchone()
    login_as(client,2)
    assert 'Документ готов' in client.get('/cabinet/projects/1').text
    download=client.get('/files/'+str(file['id']))
    assert download.data==b'private drawing'
    assert 'attachment' in download.headers['Content-Disposition']
    assert client.get('/cabinet/projects/2').status_code==404
    assert client.get('/admin').status_code==403
    login_as(client,3)
    assert client.get('/cabinet/projects/1').status_code==404
    assert client.get('/files/'+str(file['id'])).status_code==404
    assert 'Private project A' not in client.get('/cabinet').text


def test_login_and_one_time_password_reset(app,client):
    seed(app)
    assert client.post('/login',data={'csrf_token':csrf(client,'/login'),'email':'a@example.com','password':'correct-password-123'}).location=='/cabinet'
    old_session=app.test_client(); login_as(old_session,2)
    token='one-time-token'
    with connection(app) as db:
        db.execute('INSERT INTO tokens VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),2,int(time.time())+60))
    path='/reset/'+token
    assert client.post(path,data={'csrf_token':csrf(client,path),'password':'new-long-password-123','confirm':'new-long-password-123'}).status_code==302
    assert client.get(path).status_code==410
    assert old_session.get('/cabinet').location=='/login'
    assert client.post('/login',data={'csrf_token':csrf(client,'/login'),'email':'a@example.com','password':'new-long-password-123'}).location=='/cabinet'


def test_admin_invitation_and_publication(app,client):
    seed(app); login_as(client,1)
    response=client.post('/admin',data={'csrf_token':csrf(client,'/admin'),'action':'client','name':'New client','email':'new@example.com'})
    assert response.status_code==200
    assert '/reset/' in response.text
    import json
    assets=json.loads((Path(__file__).resolve().parents[1]/'content/assets.json').read_text())
    response=client.post('/admin',data={'csrf_token':csrf(client,'/admin'),'action':'showcase','title':'Test object','description':'Actual work','image':assets['hero']['src']})
    assert response.status_code==302
    assert 'Test object' in client.get('/produkciya').text


def test_legacy_redirects(client):
    for old,new in {'/nashi-raboty':'/produkciya','/ustanovka-konstruktsii':'/montaj-konstruktsii','/zakazat':'/request'}.items():
        response=client.get(old)
        assert response.status_code==301
        assert response.location==new


def test_request_rate_limit(client):
    token=csrf(client)
    for _ in range(10): client.post('/request',data={'csrf_token':token})
    assert client.post('/request',data={'csrf_token':token}).status_code==429
