import io
import json
from urllib.parse import parse_qs, urlsplit

from bs4 import BeautifulSoup
from PIL import Image
import pytest

from app import create_app
from owner_content import SECTIONS, KINDS
from test_site import app, client, connection, csrf, login_as, seed


def image():
    data = io.BytesIO()
    Image.new('RGB', (32, 24), 'blue').save(data, 'PNG')
    data.seek(0)
    return data


def owner(app, client):
    seed(app)
    login_as(client, 1)


def new_card(client, kind):
    response = client.post('/admin/content/cards/new/' + kind,
                           data={'csrf_token': csrf(client, '/admin/content')})
    assert response.status_code == 302
    return response.location


def save(client, path, action, **values):
    html = BeautifulSoup(client.get(path).text, 'html.parser')
    return client.post(path, data={'csrf_token': csrf(client, path),
        'revision': html.select_one('[name=revision]')['value'], 'action': action, **values})


def defaults(key):
    return {f['key']: SECTIONS[key]['defaults'].get(f['key'], '') for f in SECTIONS[key]['fields']}


def test_owner_content_access_csrf_and_navigation(app, client):
    assert client.get('/admin/content').status_code == 302
    owner(app, client)
    assert client.post('/admin/content/cards/new/team').status_code == 400
    html = BeautifulSoup(client.get('/admin/content').text, 'html.parser')
    for link in html.select('a[href^="/admin/content/sections/"]'):
        assert client.get(link['href']).status_code == 200
    for kind in KINDS:
        path = new_card(client, kind)
        assert client.get(path).status_code == 200
        assert client.get(path + '/preview').status_code == 200
        login_as(client, 2)
        for target in ['/admin/content', path, path + '/preview', '/admin/content/sections/home']:
            assert client.get(target).status_code == 403
        login_as(client, 1)


@pytest.mark.parametrize('key,field,value', [
    ('home', 'benefit1', 'Подтверждённое преимущество <script>test</script>'),
    ('company', 'history', 'История для изолированной проверки'),
    ('contacts', 'hours', 'Пн–пт 09:00–18:00 МСК'),
    ('enquiry', 'response_time', 'В течение двух рабочих дней'),
])
def test_section_draft_preview_publication_and_stale_edits(app, client, key, field, value):
    owner(app, client)
    public = app.test_client()
    path = '/admin/content/sections/' + key
    target = SECTIONS[key]['path']
    values = {**defaults(key), field: value}
    assert value not in public.get(target).text
    assert save(client, path, 'save', **values).status_code == 302
    assert value.split(' <script>')[0] not in public.get(target).text
    assert public.get(path + '/preview').status_code == 302
    preview = client.get(path + '/preview')
    assert value in BeautifulSoup(preview.text, 'html.parser').get_text()
    assert 'noindex' in preview.headers['X-Robots-Tag']
    assert '<script>test</script>' not in preview.text
    assert save(client, path, 'publish', **values).status_code == 302
    assert value in BeautifulSoup(public.get(target).text, 'html.parser').get_text()
    stale = client.post(path, data={'csrf_token': csrf(client, path), 'revision': '0', 'action': 'publish',
                                    **defaults(key), field: 'Stale overwrite'})
    assert stale.status_code == 422
    assert 'Stale overwrite' not in public.get(target).text
    assert save(client, path, 'publish', **{**values, field: 'x' * 15000}).status_code == 422
    assert value in BeautifulSoup(public.get(target).text, 'html.parser').get_text()
    # Restart/migration preserves published owner facts.
    restarted = create_app({'TESTING': True, 'SECRET_KEY': 'test', 'DATA_DIR': app.config['DATA_DIR'],
                            'SITE_URL': 'https://example.com', 'SITE_INDEXABLE': True})
    assert value in BeautifulSoup(restarted.test_client().get(target).text, 'html.parser').get_text()


def test_cards_photos_stay_private_until_publish_and_draft_preserves_live(app, client):
    owner(app, client)
    public = app.test_client()
    path = new_card(client, 'team')
    values = dict(name='Тестовый специалист', role='Руководитель', body='Описание опыта', alt='Портрет', position='10')
    assert save(client, path, 'save', **values, photo=(image(), 'portrait.png')).status_code == 302
    with connection(app) as db:
        first = dict(db.execute('SELECT * FROM photos').fetchone())
    assert public.get('/media/' + first['storage_name']).status_code == 404
    preview = client.get(path + '/preview')
    assert f'/admin/photos/{first["id"]}/image' in preview.text
    assert client.get(f'/admin/photos/{first["id"]}/image').status_code == 200
    assert save(client, path, 'publish', **values, photo_id=str(first['id'])).status_code == 302
    assert values['name'] in public.get('/o-kompanii').text
    assert public.get('/media/' + first['storage_name']).status_code == 200
    assert save(client, path, 'save', **{**values, 'body': 'Только черновик'}, photo=(image(), 'new.png')).status_code == 302
    with connection(app) as db:
        second = dict(db.execute('SELECT * FROM photos ORDER BY id DESC').fetchone())
    assert 'Только черновик' not in public.get('/o-kompanii').text
    assert public.get('/media/' + first['storage_name']).status_code == 200
    assert public.get('/media/' + second['storage_name']).status_code == 404
    assert path in client.get('/admin/photos').text
    assert save(client, path, 'publish', **values, photo_id=str(second['id'])).status_code == 302
    assert public.get('/media/' + first['storage_name']).status_code == 404
    assert public.get('/media/' + second['storage_name']).status_code == 200
    assert save(client, path, 'unpublish').status_code == 302
    assert values['name'] not in public.get('/o-kompanii').text
    assert public.get('/media/' + second['storage_name']).status_code == 404


@pytest.mark.parametrize('kind,extra', [('base', {'location': 'Адрес базы'}),
                                     ('review', {'source_name': 'Письмо заказчика', 'source_url': 'https://example.com/review', 'date': '2026-09-01'})])
def test_company_repeatable_cards_validation(app, client, kind, extra):
    owner(app, client)
    path = new_card(client, kind)
    values = dict(name='Проверочная карточка', body='Подробности', position='0', **extra)
    assert save(client, path, 'publish', **values).status_code == 302
    assert 'Проверочная карточка' in app.test_client().get('/o-kompanii').text
    assert save(client, path, 'publish', **{**values, 'name': ''}).status_code == 422
    if kind == 'review':
        for url in ['javascript:alert(1)', '//example.com', 'https://user:password@example.com', 'https://example.com\\@evil.test']:
            assert save(client, path, 'publish', **{**values, 'source_url': url}).status_code == 422
    assert save(client, path, 'publish', **values, photo=(io.BytesIO(b'not image'), 'bad.png')).status_code == 422
    with connection(app) as db:
        assert db.execute('SELECT count(*) FROM photos').fetchone()[0] == 0
    assert 'Проверочная карточка' in app.test_client().get('/o-kompanii').text


def test_estimate_scope_date_and_target_publication(app, client):
    owner(app, client)
    public = app.test_client()
    path = new_card(client, 'estimate')
    values = dict(name='Пример для теста', scope='Размеры и материалы', amount='100 руб. с НДС', date='2026-09-01',
                  includes='Монтаж', excludes='Доставка', delivery='Отдельный расчёт', duration='10 дней',
                  conditions='Готовое основание', target='/betonnye-raboty')
    assert save(client, path, 'publish', **{**values, 'date': ''}).status_code == 422
    assert save(client, path, 'publish', **{**values, 'target': '/admin'}).status_code == 422
    assert save(client, path, 'publish', **values, photo=(image(), 'work.png')).status_code == 302
    assert values['name'] in public.get('/betonnye-raboty').text
    assert values['name'] not in public.get('/krovelnye-raboty').text
    for key in ['scope', 'date', 'includes', 'excludes', 'delivery', 'conditions']:
        assert values[key] in public.get('/betonnye-raboty').text
    with connection(app) as db:
        photo = db.execute('SELECT storage_name FROM photos').fetchone()[0]
        db.execute("UPDATE service_pages SET published=0 WHERE slug='betonnye-raboty'")
    assert public.get('/betonnye-raboty').status_code == 404
    assert public.get('/media/' + photo).status_code == 404


def test_gallery_categories_and_enquiry_flow_are_available(app, client):
    page = BeautifulSoup(client.get('/produkciya').text, 'html.parser')
    filters = page.select('button[data-filter]')
    assert {f['data-filter'] for f in filters} == {'all', 'buildings', 'metal', 'concrete', 'panels', 'roofing', 'construction'}
    concrete = page.select_one('[data-filter=concrete]')
    url = concrete['data-request-url']
    assert parse_qs(urlsplit(url).query)['services'] == ['betonnye-raboty']
    form = BeautifulSoup(client.get(url).text, 'html.parser')
    assert form.select_one('input[name=services][value=betonnye-raboty]').has_attr('checked')
    assert len(form.select('input[name=contact]')) == 1
    assert not form.select_one('details#files').has_attr('open')
    drawings = BeautifulSoup(client.get('/request?mode=drawings').text, 'html.parser')
    assert drawings.select_one('details#files').has_attr('open')
    assert 'Срок ответа:' not in form.get_text()
    owner(app, client)
    assert save(client, '/admin/content/sections/enquiry', 'publish', **{**defaults('enquiry'), 'responsible': 'Руководитель проекта'}).status_code == 302
    # Submit only to isolated test DB; no SMTP configured.
    response = client.post('/request', data={'csrf_token': csrf(client), 'contact': 'test@example.com',
        'body': 'Задача без параметров', 'consent': 'yes'})
    assert response.status_code == 302
    assert 'Руководитель проекта' in client.get('/request/success').text


def test_quick_gallery_publication_accepts_category(app, client):
    owner(app, client)
    form = BeautifulSoup(client.get('/admin').text, 'html.parser')
    photo = form.select_one('select[name=image] option')['value']
    response = client.post('/admin', data={'csrf_token': csrf(client, '/admin'), 'action': 'showcase',
        'title': 'Монолит', 'description': 'Реальные работы', 'image': photo, 'category': 'concrete'})
    assert response.status_code == 302
    html = BeautifulSoup(client.get('/produkciya').text, 'html.parser')
    assert 'Монолит' in html.select_one('[data-category=concrete]').text
