from bs4 import BeautifulSoup
import pytest

from test_site import app, client, connection, csrf, login_as, seed


def save(client, **values):
    return client.post('/admin', data={'csrf_token': csrf(client, '/admin'), 'action': 'messengers',
        'max_url': 'https://max.ru/u/owner-test-profile', 'telegram': 'https://t.me/owner_test',
        'whatsapp_phone': '', 'whatsapp_enabled': '1', **values}, follow_redirects=True)


def test_messenger_settings_propagate_to_contacts_and_can_be_disabled(app, client):
    home = BeautifulSoup(client.get('/').text, 'html.parser')
    assert home.select_one('.header-contact a[href="https://wa.me/79054433259"]')
    assert not home.select_one('.messenger-link[href^="https://max.ru/"]')
    seed(app); login_as(client, 1)
    assert save(client).status_code == 200
    for path, selector in [('/', '.header-contact'), ('/kontakty', '.contact-hero'), ('/request', '.contact-stack')]:
        html = BeautifulSoup(app.test_client().get(path).text, 'html.parser')
        links = html.select(selector + ' .messenger-link')
        assert [link.text for link in links] == ['MAX', 'Telegram', 'WhatsApp']
        assert all(link.get('target') == '_blank' and 'noopener' in link.get('rel', []) for link in links)
    with connection(app) as db:
        db.execute("INSERT INTO settings VALUES('phone','+7 (999) 123-45-67')")
    assert 'https://wa.me/79991234567' in client.get('/').text
    assert save(client, whatsapp_phone='8 (905) 111-22-33').status_code == 200
    assert 'https://wa.me/79051112233' in client.get('/').text
    assert save(client, max_url='', telegram='', whatsapp_enabled='0').status_code == 200
    html = BeautifulSoup(client.get('/kontakty').text, 'html.parser')
    assert not html.select('.messenger-link')
    assert html.select_one('a[href^="tel:"]')


@pytest.mark.parametrize('invalid', [
    {'max_url': 'javascript:alert(1)'}, {'max_url': 'https://max.ru.evil.test/u/x'},
    {'max_url': 'https://max.ru@evil.test/u/x'}, {'telegram': 'https://evil.test/owner'},
    {'whatsapp_phone': 'phone number'},
])
def test_invalid_messenger_settings_leave_previous_values(app, client, invalid):
    seed(app); login_as(client, 1)
    save(client)
    with connection(app) as db:
        original = list(db.execute('SELECT key,value FROM settings ORDER BY key'))
    response = save(client, **invalid)
    assert 'Кнопки мессенджеров обновлены.' not in response.text
    with connection(app) as db:
        assert list(db.execute('SELECT key,value FROM settings ORDER BY key')) == original


def test_only_owner_can_change_links_and_click_goals_work(app, client):
    seed(app); login_as(client, 2)
    csrf(client)
    assert save(client).status_code == 403
    login_as(client, 1)
    assert client.post('/admin', data={'action': 'messengers', 'max_url': ''}).status_code == 400
    public = app.test_client()
    for goal in ['max_click', 'whatsapp_click', 'telegram_click']:
        assert public.post('/analytics/event', data={'csrf_token': csrf(public), 'event': goal, 'path': '/'}).status_code == 204
