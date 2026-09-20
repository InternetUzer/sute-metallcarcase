import io
import json
from pathlib import Path
import tarfile
import time

from PIL import Image
from bs4 import BeautifulSoup
import pytest

from test_site import app, client, connection, csrf, login_as, seed


def post_lead(client, **values):
    return client.post('/request', data={'csrf_token': csrf(client), 'contact': 'test@example.com',
        'services': 'krovelnye-raboty', 'consent': 'yes', **values})


def photo():
    image = Image.new('RGB', (40, 30), 'blue')
    file = io.BytesIO()
    image.save(file, 'PNG')
    file.seek(0)
    return file


def new_case(app, client, title='Объект для проверки'):
    response = client.post('/admin/cases', data={'csrf_token': csrf(client, '/admin/cases'), 'title': title})
    assert response.status_code == 302
    with connection(app) as db:
        return dict(db.execute('SELECT * FROM case_studies ORDER BY id DESC LIMIT 1').fetchone())


def edit_case(app, client, case_id, action, **values):
    with connection(app) as db:
        revision = db.execute('SELECT revision FROM case_studies WHERE id=?', (case_id,)).fetchone()[0]
    return client.post(f'/admin/cases/{case_id}', data={'csrf_token': csrf(client, f'/admin/cases/{case_id}'),
        'revision': str(revision), 'action': action, **values})


def case_values(case, cover):
    return dict(title=case['title'], summary='Изготовление и монтаж каркаса', body='Задача заказчика и выполненные работы',
                result='Работы переданы заказчику', scope='Объём по проекту', period='2026', location='Ставрополь',
                category='metal', slug=case['slug'], cover_id=str(cover))


def test_optional_parameters_are_service_scoped(app, client):
    response = post_lead(client, services=['betonnye-raboty', 'krovelnye-raboty'],
        concrete_volume='12,5', concrete_type='Фундамент', roof_area='1500', roof_type='Мембранная кровля', width='not a number')
    assert response.status_code == 302
    with connection(app) as db:
        params = json.loads(db.execute('SELECT parameters FROM leads').fetchone()[0])
    assert params == {'concrete_type': 'Фундамент', 'concrete_volume': '12.5', 'roof_type': 'Мембранная кровля', 'roof_area': '1500'}
    assert post_lead(client).status_code == 302
    assert post_lead(client, services=[], body='Только описание задачи').status_code == 302


@pytest.mark.parametrize('bad', ['NaN', 'inf', '-2', '0', '10000001', '12 м2', '1e999999'])
def test_invalid_parameters_do_not_create_leads(app, client, bad):
    response = post_lead(client, roof_area=bad)
    assert response.status_code == 422
    assert bad in response.text
    with connection(app) as db:
        assert db.execute('SELECT count(*) FROM leads').fetchone()[0] == 0


def test_attribution_survives_navigation_and_goal_is_once(app, client):
    client.get('/krovelnye-raboty?utm_source=yandex&utm_medium=cpc&utm_campaign=roof-2026',
               headers={'Referer': 'https://yandex.ru/search/?text=private'})
    client.get('/uslugi', headers={'Referer': 'https://example.com/krovelnye-raboty'})
    assert post_lead(client).status_code == 302
    with connection(app) as db:
        row = dict(db.execute('SELECT * FROM lead_attribution').fetchone())
    assert row['source'] == 'yandex' and row['medium'] == 'cpc' and row['campaign'] == 'roof-2026'
    assert row['landing'] == '/krovelnye-raboty' and row['referrer'] == 'yandex.ru'
    assert 'private' not in str(row)
    assert 'data-lead-confirmed="true"' in client.get('/request/success').text
    assert 'data-lead-confirmed="false"' in client.get('/request/success').text


def test_source_expiry_and_search_detection(app, client):
    client.get('/uslugi', headers={'Referer': 'https://www.google.com/search?q=private'})
    assert post_lead(client).status_code == 302
    with connection(app) as db:
        row = dict(db.execute('SELECT * FROM lead_attribution').fetchone())
    assert row['source'] == 'Google' and row['medium'] == 'organic'
    with client.session_transaction() as session:
        session['attribution'] = {'touched': int(time.time()) - 3600, 'source': 'Expired'}
    client.get('/')
    assert post_lead(client).status_code == 302
    with connection(app) as db:
        assert db.execute('SELECT source FROM lead_attribution ORDER BY lead_id DESC LIMIT 1').fetchone()[0] == 'Прямой переход'


def test_analytics_access_settings_and_clicks(app, client):
    assert client.get('/admin/analytics').status_code == 302
    assert client.post('/analytics/event', data={'event': 'phone_click', 'path': '/'}).status_code == 400
    token = csrf(client)
    assert client.post('/analytics/event', data={'csrf_token': token, 'event': 'phone_click', 'path': '/'}).status_code == 204
    assert client.post('/analytics/event', data={'csrf_token': token, 'event': 'lead_saved', 'path': '/'}).status_code == 400
    seed(app); login_as(client, 2)
    assert client.get('/admin/analytics').status_code == 403
    login_as(client, 1)
    assert client.get('/admin/analytics').status_code == 200
    assert client.post('/admin/analytics', data={'csrf_token': csrf(client, '/admin/analytics'), 'counter_id': '<script>', 'enabled': '1'}).status_code == 422
    assert client.post('/admin/analytics', data={'csrf_token': csrf(client, '/admin/analytics'), 'counter_id': '12345678', 'enabled': '1'}).status_code == 302
    assert '/static/analytics.js' not in client.get('/').text
    public = app.test_client()
    page = public.get('/')
    assert 'data-counter="12345678"' in page.text
    assert 'https://mc.yandex.ru' in page.headers['Content-Security-Policy']
    assert '/static/analytics.js' not in public.get('/login').text
    app.config['SITE_URL'] = 'https://test.example.com'
    page = public.get('/')
    assert '/static/analytics.js' not in page.text
    assert 'https://mc.yandex.ru' not in page.headers['Content-Security-Policy']


def test_case_lifecycle_files_permissions_and_sitemap(app, client, tmp_path):
    seed(app); login_as(client, 1)
    case = new_case(app, client)
    cid, slug = case['id'], case['slug']
    public = app.test_client()
    assert public.get('/obekty/' + slug).status_code == 404
    assert f'/obekty/{slug}' not in public.get('/sitemap.xml').text
    assert edit_case(app, client, cid, 'stage_save', stage_title='Монтаж', stage_description='<script>bad</script>', stage_status='В работе', position='20').status_code == 302
    assert edit_case(app, client, cid, 'stage_save', stage_title='Подготовка', stage_description='Описание', stage_status='Выполнен', position='10').status_code == 302
    with connection(app) as db:
        stages = db.execute('SELECT * FROM case_stages ORDER BY id').fetchall()
    assert edit_case(app, client, cid, 'upload', kind='photo', stage_id=str(stages[0]['id']), files=(photo(), 'frame.png')).status_code == 302
    assert edit_case(app, client, cid, 'upload', kind='document', files=(io.BytesIO(b'%PDF private'), 'private.pdf')).status_code == 302
    with connection(app) as db:
        image = dict(db.execute("SELECT * FROM case_files WHERE kind='photo'").fetchone())
        doc = dict(db.execute("SELECT * FROM case_files WHERE kind='document'").fetchone())
    assert doc['public'] == 0
    assert public.get('/case-files/' + str(image['id'])).status_code == 404
    assert public.get('/case-files/' + str(doc['id'])).status_code == 404
    preview = client.get(f'/admin/cases/{cid}/preview')
    assert preview.status_code == 200 and 'noindex' in preview.headers['X-Robots-Tag']
    assert preview.text.index('Подготовка') < preview.text.index('Монтаж')
    assert '<script>bad</script>' not in preview.text and '&lt;script&gt;bad' in preview.text
    assert 'private.pdf' not in preview.text
    assert edit_case(app, client, cid, 'publish', **case_values(case, image['id'])).status_code == 302
    page = public.get('/obekty/' + slug)
    assert page.status_code == 200 and 'X-Robots-Tag' not in page.headers
    html = BeautifulSoup(page.text, 'html.parser')
    assert len(html.select('h1')) == 1
    assert html.select_one('link[rel="canonical"]')['href'] == 'https://example.com/obekty/' + slug
    assert '/obekty/' + slug in public.get('/sitemap.xml').text
    assert '/obekty/' + slug in public.get('/').text
    assert '/obekty/' + slug in public.get('/produkciya').text
    assert public.get('/case-files/' + str(image['id'])).status_code == 200
    assert public.get('/case-files/' + str(doc['id'])).status_code == 404
    assert edit_case(app, client, cid, 'file_save', file_id=str(doc['id']), file_title='Открытый документ', file_description='Описание', public='1', position='0').status_code == 302
    download = public.get('/case-files/' + str(doc['id']))
    assert download.status_code == 200 and 'attachment' in download.headers['Content-Disposition']
    assert edit_case(app, client, cid, 'stage_delete', stage_id=str(stages[0]['id'])).status_code == 302
    with connection(app) as db:
        assert db.execute('SELECT stage_id FROM case_files WHERE id=?', (image['id'],)).fetchone()[0] is None
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    backup = tmp_path / 'backup.tar.gz'
    result = app.test_cli_runner().invoke(args=['backup', str(backup)])
    assert result.exit_code == 0, result.output
    with tarfile.open(backup) as archive:
        assert 'case-files/' + doc['storage'] in archive.getnames()
    assert edit_case(app, client, cid, 'unpublish').status_code == 302
    assert public.get('/obekty/' + slug).status_code == 404
    assert public.get('/case-files/' + str(doc['id'])).status_code == 404
    assert '/obekty/' + slug not in public.get('/sitemap.xml').text


def test_case_validation_is_atomic_and_stale_edits_rejected(app, client):
    seed(app); login_as(client, 1)
    case = new_case(app, client)
    cid = case['id']
    assert edit_case(app, client, cid, 'upload', kind='photo', files=[(photo(), 'valid.png'), (io.BytesIO(b'bad'), 'bad.png')]).status_code == 422
    assert list((Path(app.config['DATA_DIR']) / 'case-files').iterdir()) == []
    values = case_values(case, '')
    assert edit_case(app, client, cid, 'publish', **values).status_code == 422
    assert edit_case(app, client, cid, 'save', **values).status_code == 302
    response = client.post(f'/admin/cases/{cid}', data={'csrf_token': csrf(client, f'/admin/cases/{cid}'), 'revision': '0', 'action': 'save', **values, 'title': 'Stale overwrite'})
    assert response.status_code == 422
    with connection(app) as db:
        assert db.execute('SELECT title FROM case_studies WHERE id=?', (cid,)).fetchone()[0] == case['title']
    second = new_case(app, client, 'Другой объект')
    assert edit_case(app, client, second['id'], 'stage_save', stage_title='Чужой этап', stage_status='В работе', position='0').status_code == 302
    with connection(app) as db:
        stage_id = db.execute('SELECT id FROM case_stages WHERE case_id=?', (second['id'],)).fetchone()[0]
    assert edit_case(app, client, cid, 'upload', kind='photo', stage_id=str(stage_id), files=(photo(), 'photo.png')).status_code == 422
    login_as(client, 2)
    assert client.get('/admin/cases').status_code == 403
    assert client.get(f'/admin/cases/{cid}/preview').status_code == 403
