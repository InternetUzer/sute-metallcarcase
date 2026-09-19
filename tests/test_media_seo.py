import io
import sqlite3
from pathlib import Path
from bs4 import BeautifulSoup
from test_site import app, client, connection, csrf, login_as, seed
from test_owner_tools import photo_bytes


def owner(app, client):
    seed(app)
    login_as(client, 1)


def save_media(client, path, **values):
    return client.post(path, data={'csrf_token': csrf(client, path), 'title': 'Новый снимок',
        'alt': 'Стальной каркас на площадке', 'description': 'Работы по монтажу', **values})


def test_asset_replace_tree_reset_and_original_preserved(app, client):
    owner(app, client)
    path = '/admin/photos/edit/asset/hero'
    source = Path('static/images/web/hero.webp').read_bytes()
    response = save_media(client, path, photo=(photo_bytes(), 'new.jpg'))
    assert response.status_code == 302
    with connection(app) as db:
        photo = db.execute('SELECT * FROM photos').fetchone()
    url = '/media/' + photo['storage_name']
    home = BeautifulSoup(client.get('/').data, 'html.parser')
    image = home.select_one('.hero-image img')
    assert image['src'] == url
    assert image['alt'] == 'Стальной каркас на площадке'
    assert image['title'] == 'Работы по монтажу'
    assert not image.has_attr('srcset')
    assert client.get(url).status_code == 200
    tree = client.get('/admin/photos').text
    assert 'Главная · первый экран' in tree and 'Галерея · Ангар' in tree
    assert '/admin/photos/1/image' in tree
    assert url in client.get('/produkciya').text
    assert Path('static/images/web/hero.webp').read_bytes() == source
    assert save_media(client, path, action='reset').status_code == 302
    assert BeautifulSoup(client.get('/').data, 'html.parser').select_one('.hero-image img')['src'] == '/static/images/web/hero.webp'
    assert client.get(url).status_code == 404
    assert client.get('/admin/photos/1/image').status_code == 200


def test_gallery_independent_caption_alt_and_escape(app, client):
    owner(app, client)
    assert save_media(client, '/admin/photos/edit/gallery/source-0', title='<script>x</script>',
                      alt='Новый ALT', description='Новая подпись', photo=(photo_bytes(), 'a.jpg')).status_code == 302
    page = BeautifulSoup(client.get('/produkciya').data, 'html.parser')
    card = page.select_one('#source-0')
    assert card.select_one('h2').text == '<script>x</script>'
    assert card.select_one('script') is None
    assert card.select_one('img')['alt'] == 'Новый ALT'
    assert 'Новая подпись' in card.text
    hero = BeautifulSoup(client.get('/').data, 'html.parser').select_one('.hero-image img')
    assert hero['src'] == '/static/images/web/hero.webp'


def test_private_unused_replacement_and_invalid_file_rollback(app, client):
    owner(app, client)
    path = '/admin/photos/edit/asset/frame'
    assert save_media(client, path, photo=(photo_bytes(), 'new.jpg')).status_code == 302
    with connection(app) as db:
        photo = dict(db.execute('SELECT * FROM photos').fetchone())
        previous = dict(db.execute('SELECT * FROM media_edits').fetchone())
    assert client.get('/media/' + photo['storage_name']).status_code == 404
    assert '/admin/photos/1/image' in client.get(path).text
    assert save_media(client, path, photo=(io.BytesIO(b'bad'), 'bad.jpg')).status_code == 422
    with connection(app) as db:
        assert dict(db.execute('SELECT * FROM media_edits').fetchone()) == previous
    assert len(list((Path(app.config['DATA_DIR'])/'media').iterdir())) == 1
    assert save_media(client, path, photo_id='9999').status_code == 422


def test_edit_uploaded_photo_updates_active_references(app, client):
    owner(app, client)
    token = csrf(client, '/admin/photos')
    client.post('/admin/photos', data={'csrf_token': token, 'title': 'Фото', 'photo': (photo_bytes(), 'a.jpg')})
    with connection(app) as db: old = db.execute('SELECT storage_name FROM photos').fetchone()[0]
    client.post('/admin', data={'csrf_token': token, 'action': 'showcase', 'image': '/media/'+old, 'title': 'Публикация', 'description': 'Описание'})
    assert save_media(client, '/admin/photos/edit/photo/1', photo=(photo_bytes(), 'b.jpg')).status_code == 302
    with connection(app) as db:
        new = db.execute('SELECT storage_name FROM photos').fetchone()[0]
        assert db.execute('SELECT image FROM showcases').fetchone()[0] == '/media/'+new
    assert new != old
    assert client.get('/media/'+old).status_code == 404
    assert client.get('/media/'+new).status_code == 200
    assert 'Стальной каркас на площадке' in client.get('/produkciya').text
    assert (Path(app.config['DATA_DIR'])/'media'/old).exists()


def test_media_and_seo_owner_only_csrf(app, client):
    owner(app, client)
    paths = ['/admin/seo','/admin/seo/page?path=/','/admin/photos/edit/asset/hero']
    for path in paths: assert client.post(path, data={'title':'bad'}).status_code == 400
    login_as(client, 2)
    for path in paths:
        assert client.get(path).status_code == 403
        assert client.post(path,data={'csrf_token':csrf(client)}).status_code == 403


def save_seo(client, path='/', **values):
    endpoint = '/admin/seo/page?path=' + path
    return client.post(endpoint, data={'csrf_token':csrf(client,endpoint),'sitemap':'1',**values})


def test_seo_metadata_h1_preview_sitemap_reset(app, client):
    owner(app, client)
    assert save_seo(client,title='Уникальный title',description='Точное описание',h1='Новый заголовок').status_code == 302
    html = BeautifulSoup(client.get('/?utm_source=test').data,'html.parser')
    assert html.title.text == 'Уникальный title'
    assert html.h1.text == 'Новый заголовок'
    assert html.select_one('meta[name=description]')['content'] == 'Точное описание'
    assert html.select_one('meta[property="og:title"]')['content'] == 'Уникальный title'
    assert html.select_one('link[rel=canonical]')['href'] == 'https://example.com/'
    assert 'Уникальный title' in client.get('/admin/seo').text
    assert save_seo(client, '/uslugi', noindex='1').status_code == 302
    page = client.get('/uslugi')
    assert 'noindex' in page.headers['X-Robots-Tag']
    assert BeautifulSoup(page.data,'html.parser').select_one('meta[name=robots]')['content'].startswith('noindex')
    assert '<loc>https://example.com/uslugi</loc>' not in client.get('/sitemap.xml').text
    assert save_seo(client, action='reset').status_code == 302
    assert BeautifulSoup(client.get('/').data,'html.parser').title.text != 'Уникальный title'
    assert save_seo(client, '/admin', title='No').status_code == 404
    assert save_seo(client, title='x'*201).status_code == 422


def test_verification_pause_staging_lock_and_xss(app, client):
    owner(app, client)
    token = csrf(client,'/admin/seo')
    assert client.post('/admin/seo',data={'csrf_token':token,'google':'google_test_token','yandex':'abc12345deadbeef','paused':'1'}).status_code == 302
    page = client.get('/')
    assert 'noindex' in page.headers['X-Robots-Tag']
    html = BeautifulSoup(page.data,'html.parser')
    assert html.select_one('meta[name=google-site-verification]')['content']=='google_test_token'
    assert html.select_one('meta[name=yandex-verification]')['content']=='abc12345deadbeef'
    assert 'Sitemap:' not in client.get('/robots.txt').text
    assert 'Allow: /' in client.get('/robots.txt').text
    assert client.post('/admin/seo',data={'csrf_token':token,'google':'<script>x</script>'}).status_code==422
    app.config.update(SITE_URL='https://test.metalcarcase.ru',SITE_INDEXABLE=True)
    client.post('/admin/seo',data={'csrf_token':token})
    assert 'noindex' in client.get('/').headers['X-Robots-Tag']
    assert 'Тестовый сайт: индексация закрыта' in client.get('/admin/seo').text
    app.config.update(SITE_URL='https://metalcarcase.ru')
    assert 'X-Robots-Tag' not in client.get('/').headers
    assert 'Sitemap: https://metalcarcase.ru/sitemap.xml' in client.get('/robots.txt').text
    assert 'noindex' in client.get('/',base_url='https://test.metalcarcase.ru').headers['X-Robots-Tag']
