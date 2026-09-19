import json
from bs4 import BeautifulSoup
from test_site import app, client, connection, csrf


def test_roofing_is_discoverable_and_can_be_requested(app, client, monkeypatch):
    monkeypatch.delenv('SMTP_HOST', raising=False)
    for path in ('/', '/uslugi'):
        html = BeautifulSoup(client.get(path).data, 'html.parser')
        assert html.select_one('a[href="/krovelnye-raboty"]')
    assert '/krovelnye-raboty</loc>' in client.get('/sitemap.xml').text
    page = client.get('/krovelnye-raboty').text
    assert 'Наплавляемая кровля' in page and 'Мембранная кровля' in page
    assert 'Монолитные конструкции для разных задач' in client.get('/betonnye-raboty').text
    response = client.post('/request', data={
        'csrf_token': csrf(client), 'contact': 'qa@example.com',
        'services': ['krovelnye-raboty', 'betonnye-raboty'], 'consent': 'yes'})
    assert response.status_code == 302
    with connection(app) as db:
        lead = db.execute('SELECT * FROM leads').fetchone()
    assert set(json.loads(lead['services'])) == {'krovelnye-raboty', 'betonnye-raboty'}
