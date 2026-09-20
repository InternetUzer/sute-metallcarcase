import io
import json
from pathlib import Path

from bs4 import BeautifulSoup
from PIL import Image
import pytest
from werkzeug.datastructures import MultiDict

from app import create_app
from content import SERVICES
from test_site import app, client, connection, csrf, login_as, seed


def owner(app, client):
    seed(app)
    login_as(client, 1)


def create(client, name='Фасадные работы', source=''):
    response = client.post('/admin/services', data={'csrf_token': csrf(client, '/admin/services'),
        'name': name, 'source_id': str(source)})
    assert response.status_code == 302, response.text
    return int(response.location.rsplit('/', 1)[-1])


def form(client, service_id):
    response = client.get(f'/admin/services/{service_id}')
    assert response.status_code == 200
    soup = BeautifulSoup(response.data, 'html.parser').select_one('[data-service-main]')
    values = MultiDict()
    for field in soup.select('input[name],textarea[name],select[name]'):
        if field.get('type') == 'checkbox' and not field.has_attr('checked'):
            continue
        if field.name == 'select':
            option = field.select_one('option[selected]') or field.select_one('option')
            value = option.get('value', option.text)
        else:
            value = field.text if field.name == 'textarea' else field.get('value', '')
        values.add(field['name'], value)
    return values


def edit(app, client, service_id, action, **values):
    with connection(app) as db:
        revision = db.execute('SELECT revision FROM service_pages WHERE id=?', (service_id,)).fetchone()[0]
    return client.post(f'/admin/services/{service_id}', data={'csrf_token': csrf(client, f'/admin/services/{service_id}'),
        'revision': str(revision), 'action': action, **values})


def save(client, service_id, action='save', **changes):
    data = form(client, service_id)
    data['action'] = action
    for key, value in changes.items():
        data[key] = value
    return client.post(f'/admin/services/{service_id}', data=data)


def png():
    output = io.BytesIO()
    Image.new('RGB', (25, 20), 'green').save(output, 'PNG')
    output.seek(0)
    return output


def test_existing_services_seed_once_preserving_content_seo_and_archive(app, client):
    owner(app, client)
    with connection(app) as db:
        rows = db.execute('SELECT * FROM service_pages ORDER BY position').fetchall()
        assert [row['slug'] for row in rows] == [item['slug'] for item in SERVICES]
        assert json.loads(rows[0]['content'])['body'] == SERVICES[0]['body']
        db.execute("INSERT INTO seo_pages(path,title,description,h1) VALUES('/betonnye-raboty','Сохранённый title','Сохранённое описание','Сохранённый H1')")
    values = form(client, 3)
    assert values['title'] == 'Сохранённый title' and values['h1'] == 'Сохранённый H1'
    assert edit(app, client, 3, 'unpublish').status_code == 302
    restarted = create_app(dict(app.config))
    public = restarted.test_client()
    assert public.get('/betonnye-raboty').status_code == 404
    assert '/betonnye-raboty</loc>' not in public.get('/sitemap.xml').text
    with connection(app) as db:
        assert db.execute('SELECT count(*) FROM service_pages').fetchone()[0] == 5
        assert db.execute("SELECT title FROM seo_pages WHERE path='/betonnye-raboty'").fetchone()[0] == 'Сохранённый title'


def test_access_csrf_and_draft_privacy(app, client):
    assert client.get('/admin/services').status_code == 302
    assert client.post('/admin/services', data={'name': 'x'}).status_code == 400
    seed(app)
    login_as(client, 2)
    assert client.get('/admin/services').status_code == 403
    assert client.get('/admin/services/1').status_code == 403
    login_as(client, 1)
    service_id = create(client)
    assert 'noindex' in client.get(f'/admin/services/{service_id}/preview').headers['X-Robots-Tag']
    anonymous = app.test_client()
    assert anonymous.get('/fasadnye-raboty').status_code == 404
    assert anonymous.get(f'/admin/services/{service_id}/preview').status_code == 302
    assert 'fasadnye-raboty' not in anonymous.get('/sitemap.xml').text
    assert 'value="fasadnye-raboty"' not in anonymous.get('/request').text
    assert save(client, service_id, 'publish').status_code == 422
    with connection(app) as db:
        assert not db.execute('SELECT published FROM service_pages WHERE id=?', (service_id,)).fetchone()[0]


def test_copy_publish_discovery_seo_and_enquiry(app, client):
    owner(app, client)
    service_id = create(client, source=5)
    assert save(client, service_id, 'publish', name='Фасадные работы',
                title='Фасадные работы по проекту', description='Описание фасадных работ', h1='Монтаж фасадов').status_code == 302
    anonymous = app.test_client()
    for path in ('/', '/uslugi'):
        assert 'href="/fasadnye-raboty"' in anonymous.get(path).text
    html = BeautifulSoup(anonymous.get('/fasadnye-raboty').data, 'html.parser')
    assert html.h1.text == 'Монтаж фасадов' and html.title.text == 'Фасадные работы по проекту'
    assert html.select_one('link[rel="canonical"]')['href'] == 'https://example.com/fasadnye-raboty'
    assert '/fasadnye-raboty</loc>' in anonymous.get('/sitemap.xml').text
    assert 'value="fasadnye-raboty"' in anonymous.get('/request').text
    # The copied profile applies to the new slug as well as the original roofing service.
    response = anonymous.post('/request', data={'csrf_token': csrf(anonymous), 'services': 'fasadnye-raboty',
        'roof_area': '42,5', 'contact': 'test@example.com', 'consent': 'yes'})
    assert response.status_code == 302
    with connection(app) as db:
        assert json.loads(db.execute('SELECT parameters FROM leads').fetchone()[0]) == {'roof_area': '42.5'}
    assert client.get('/admin/seo/page?path=/fasadnye-raboty').location.endswith(f'/admin/services/{service_id}#seo')
    assert save(client, service_id, noindex='1').status_code == 302
    assert 'noindex' in anonymous.get('/fasadnye-raboty').headers['X-Robots-Tag']
    assert '/fasadnye-raboty</loc>' not in anonymous.get('/sitemap.xml').text
    assert edit(app, client, service_id, 'unpublish').status_code == 302
    assert anonymous.get('/fasadnye-raboty').status_code == 404
    assert 'Фасадные работы</p>' in client.get('/admin').text
    with connection(app) as db:
        assert db.execute('SELECT count(*) FROM leads').fetchone()[0] == 1


@pytest.mark.parametrize('slug', ['admin', 'login', 'media', 'obekty', 'angary', 'betonnye-raboty', '../escape', 'bad/slug'])
def test_slug_collision_and_traversal_cannot_replace_existing_pages(app, client, slug):
    owner(app, client)
    service_id = create(client, source=5)
    assert save(client, service_id, slug=slug).status_code == 422
    with connection(app) as db:
        assert db.execute('SELECT slug FROM service_pages WHERE id=?', (service_id,)).fetchone()[0] == 'fasadnye-raboty'


def test_stale_edit_and_published_slug_are_rejected_without_partial_save(app, client):
    owner(app, client)
    first = form(client, 5)
    assert save(client, 5, body='Обновлённое описание').status_code == 302
    first['body'], first['action'] = 'Устаревшее описание', 'save'
    response = client.post('/admin/services/5', data=first)
    assert response.status_code == 422 and 'другой вкладке' in response.text
    assert save(client, 5, slug='drugaya-krovlya').status_code == 422
    with connection(app) as db:
        row = db.execute('SELECT * FROM service_pages WHERE id=5').fetchone()
        assert row['slug'] == 'krovelnye-raboty'
        assert json.loads(row['content'])['body'] == 'Обновлённое описание'


def test_photo_upload_is_atomic_private_and_shared_copy_is_independent(app, client):
    owner(app, client)
    service_id = create(client)
    response = edit(app, client, service_id, 'upload', photos=[(png(), 'good.png'), (io.BytesIO(b'bad'), 'bad.png')])
    assert response.status_code == 422
    assert not list((Path(app.config['DATA_DIR']) / 'media').iterdir())
    with connection(app) as db:
        assert db.execute('SELECT count(*) FROM photos').fetchone()[0] == 0
    assert edit(app, client, service_id, 'upload', photos=(png(), 'photo.png')).status_code == 302
    with connection(app) as db:
        photo = dict(db.execute('SELECT * FROM photos').fetchone())
        picture = dict(db.execute('SELECT * FROM service_pictures').fetchone())
    anonymous = app.test_client()
    assert anonymous.get('/media/' + photo['storage_name']).status_code == 404
    preview = client.get(f'/admin/services/{service_id}/preview')
    assert f'/admin/photos/{photo["id"]}/image' in preview.text
    assert client.get(f'/admin/photos/{photo["id"]}/image').status_code == 200
    assert edit(app, client, service_id, 'picture_save', picture_id=picture['id'], picture_title='<script>alert(1)</script>',
                picture_alt='Монтаж фасада', picture_description='Подпись', position='5').status_code == 302
    assert save(client, service_id, 'publish', intro='Фасады зданий', body='Описание работ', includes='Подготовка\nМонтаж').status_code == 302
    assert anonymous.get('/media/' + photo['storage_name']).status_code == 200
    page = anonymous.get('/fasadnye-raboty').text
    assert '&lt;script&gt;' in page and '<script>alert(1)</script>' not in page and 'alt="Монтаж фасада"' in page
    second = create(client, 'Вторая услуга', source=service_id)
    assert save(client, second, 'publish').status_code == 302
    assert edit(app, client, service_id, 'unpublish').status_code == 302
    assert anonymous.get('/media/' + photo['storage_name']).status_code == 200
    assert edit(app, client, second, 'unpublish').status_code == 302
    assert anonymous.get('/media/' + photo['storage_name']).status_code == 404
    assert 'Фотографии видов работ' in client.get('/admin/photos').text


def test_custom_parameters_optional_validated_scoped_and_retained(app, client):
    owner(app, client)
    service_id = create(client, source=5)
    assert edit(app, client, service_id, 'field_save', label='Площадь фасада, м²', kind='number', maximum='100', position='0').status_code == 302
    assert edit(app, client, service_id, 'field_save', label='Материал', kind='select', options='Панели\nМеталл', position='1').status_code == 302
    with connection(app) as db:
        fields = [dict(row) for row in db.execute('SELECT * FROM service_fields ORDER BY id')]
    area, material = ['service_field_' + str(field['id']) for field in fields]
    assert save(client, service_id, 'publish', parameter_profile='').status_code == 302
    anonymous = app.test_client()
    def lead(**extra):
        return anonymous.post('/request', data={'csrf_token': csrf(anonymous), 'services': 'fasadnye-raboty',
                    'contact': 'test@example.com', 'consent': 'yes', **extra})
    assert lead().status_code == 302
    assert lead(**{area: '12,5', material: 'Металл', 'roof_area': 'invalid unselected field'}).status_code == 302
    assert lead(**{area: '101'}).status_code == 422
    assert lead(**{material: 'Invalid'}).status_code == 422
    assert lead(services='betonnye-raboty', **{area: 'ignore unselected field'}).status_code == 302
    with connection(app) as db:
        params = [json.loads(row[0]) for row in db.execute('SELECT parameters FROM leads ORDER BY id')]
        assert params == [{}, {area: '12.5', material: 'Металл'}, {}]
    assert edit(app, client, service_id, 'field_toggle', field_id=fields[0]['id']).status_code == 302
    assert f'name="{area}"' not in anonymous.get('/request').text
    assert 'Площадь фасада, м²' in client.get('/admin').text
    # IDs are new when copying, so independently changing fields cannot affect the original.
    second = create(client, 'Копия фасадов', source=service_id)
    with connection(app) as db:
        copied = db.execute('SELECT id FROM service_fields WHERE service_id=?', (second,)).fetchall()
        assert {row[0] for row in copied}.isdisjoint({field['id'] for field in fields})
    assert edit(app, client, second, 'field_toggle', field_id=fields[0]['id']).status_code == 404
