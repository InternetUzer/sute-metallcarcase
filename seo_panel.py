"""Owner SEO controls with a deployment-level staging lock."""
from collections import Counter
import json
import re
from urllib.parse import urlparse
from xml.sax.saxutils import escape

from flask import abort, flash, g, redirect, request, url_for
from content import SERVICES, BUILDINGS, EXTRA

NAMES = {'/': 'Главная', '/uslugi': 'Услуги', '/angary-i-sklady': 'Ангары и склады',
         '/produkciya': 'Галерея', '/prays-list': '3D-модели', '/about': 'Вопросы и ответы',
         '/o-kompanii': 'О компании', '/kontakty': 'Контакты', '/sotrydnichestvo': 'Сотрудничество'}


class SEOPanel:
    def __init__(self, app, db, root, services):
        self.app, self.db, self.services = app, db, services
        self.base_defaults = json.loads((root / 'content/seo-defaults.json').read_text())
        for item in SERVICES:
            self.base_defaults.pop('/' + item['slug'], None)
        for item in BUILDINGS:
            self.base_defaults['/' + item['slug']] = {'title': item['title'], 'description': item['description'], 'name': item['name']}
        for slug, (name, body) in EXTRA.items():
            self.base_defaults['/' + slug] = {'title': name + ' — Металл-Каркас', 'description': body, 'name': name}
        with app.app_context():
            db().executescript('''
                CREATE TABLE IF NOT EXISTS seo_pages(
                    path TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
                    h1 TEXT NOT NULL DEFAULT '', noindex INTEGER NOT NULL DEFAULT 0,
                    sitemap INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE IF NOT EXISTS seo_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            ''')
            db().commit()

    @property
    def defaults(self):
        if hasattr(g, 'seo_page_defaults'):
            return g.seo_page_defaults
        cases = {'/obekty/' + row['slug']: {'title': row['title'] + ' — Металл-Каркас',
                 'description': row['summary'], 'name': row['title']}
                 for row in self.db().execute('SELECT slug,title,summary FROM case_studies WHERE published=1')}
        services = {'/' + item['slug']: {'title': item.get('title') or item['name'] + ' — Металл-Каркас',
                    'description': item.get('description') or item.get('intro', ''), 'name': item['name']}
                    for item in self.services.all(published=True)}
        g.seo_page_defaults = {**self.base_defaults, **cases, **services}
        return g.seo_page_defaults

    def settings(self):
        return {r['key']: r['value'] for r in self.db().execute('SELECT * FROM seo_settings')}

    def staging(self):
        hosts = [urlparse(self.app.config['SITE_URL']).hostname or '', request.host.split(':')[0]]
        return not self.app.config['SITE_INDEXABLE'] or any(h.startswith(('test.', 'staging.', 'preview.')) for h in hosts)

    def enabled(self):
        return not self.staging() and self.settings().get('paused') != '1'

    def get(self, path):
        if path not in self.defaults: return None
        override = self.db().execute('SELECT * FROM seo_pages WHERE path=?', (path,)).fetchone()
        values = dict(override) if override else dict(title='', description='', h1='', noindex=0, sitemap=1)
        return {**values, 'path': path, 'name': NAMES.get(path, self.defaults[path].get('name', path)),
                'effective_title': values['title'] or self.defaults[path]['title'],
                'effective_description': values['description'] or self.defaults[path]['description'],
                'canonical': self.app.config['SITE_URL'] + path}

    def metadata(self, path, title, description):
        page = self.get(path)
        return dict(title=page['effective_title'] if page else title,
                    description=page['effective_description'] if page else description,
                    seo_h1=page['h1'] if page else '',
                    seo_noindex=not self.enabled() or not page or bool(page['noindex']),
                    seo_verification=self.settings())

    def sitemap(self):
        items = [self.get(path) for path in self.defaults]
        nodes = ''.join('<url><loc>' + escape(item['canonical']) + '</loc></url>' for item in items
                        if item['sitemap'] and not item['noindex'])
        return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + nodes + '</urlset>'

    def robots(self):
        # Crawlers must be able to see noindex; robots disallow is not an indexing guarantee.
        text = 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /cabinet\nDisallow: /files\nDisallow: /reset\n'
        if self.enabled(): text += 'Sitemap: ' + self.app.config['SITE_URL'] + '/sitemap.xml\n'
        return text

    def register(self, app, protected, render):
        @app.route('/admin/seo', methods=['GET', 'POST'])
        @protected(admin=True)
        def seo_panel():
            error = None
            if request.method == 'POST':
                try:
                    values = {key: request.form.get(key, '').strip() for key in ('google', 'yandex')}
                    for value in values.values():
                        if value and not re.fullmatch(r'[A-Za-z0-9_-]{8,256}', value):
                            raise ValueError('Вставьте только код подтверждения из content, без HTML-тега.')
                    values['paused'] = '1' if request.form.get('paused') == '1' else '0'
                    for key, value in values.items():
                        self.db().execute('INSERT INTO seo_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, value))
                    self.db().commit()
                    flash('SEO-настройки сохранены. Ограничение тестового домена остаётся в силе.' if self.staging() else 'SEO-настройки сохранены.')
                    return redirect(url_for('seo_panel'))
                except ValueError as exc:
                    self.db().rollback()
                    error = str(exc)
            pages = [self.get(path) for path in self.defaults]
            titles = Counter(p['effective_title'].strip().casefold() for p in pages)
            descriptions = Counter(p['effective_description'].strip().casefold() for p in pages)
            for page in pages:
                page['issues'] = []
                if titles[page['effective_title'].strip().casefold()] > 1: page['issues'].append('Повторяется title')
                if descriptions[page['effective_description'].strip().casefold()] > 1: page['issues'].append('Повторяется описание')
                if len(page['effective_title']) > 75: page['issues'].append('Длинный title')
                if len(page['effective_description']) > 200: page['issues'].append('Длинное описание')
            return render('seo_panel.html', 'SEO-панель — Металл-Каркас', pages=pages,
                          seo_settings=self.settings(), staging=self.staging(), indexing=self.enabled(), error=error), 422 if error else 200

        @app.route('/admin/seo/page', methods=['GET', 'POST'])
        @protected(admin=True)
        def seo_page():
            path = request.args.get('path', '')
            service = self.services.by_slug(path.removeprefix('/'))
            if service and path == '/' + service['slug']:
                return redirect(url_for('service_editor', service_id=service['id'], _anchor='seo'), code=303)
            page = self.get(path)
            if not page: abort(404)
            error = None
            if request.method == 'POST':
                try:
                    if request.form.get('action') == 'reset':
                        self.db().execute('DELETE FROM seo_pages WHERE path=?', (path,))
                    else:
                        values = {k: request.form.get(k, '').strip() for k in ('title', 'description', 'h1')}
                        if len(values['title']) > 200 or len(values['description']) > 600 or len(values['h1']) > 200:
                            raise ValueError('Title и H1 — до 200 символов, описание — до 600.')
                        self.db().execute('''INSERT INTO seo_pages(path,title,description,h1,noindex,sitemap) VALUES(?,?,?,?,?,?)
                            ON CONFLICT(path) DO UPDATE SET title=excluded.title,description=excluded.description,h1=excluded.h1,
                            noindex=excluded.noindex,sitemap=excluded.sitemap,updated_at=CURRENT_TIMESTAMP''',
                            (path, values['title'], values['description'], values['h1'], int(request.form.get('noindex') == '1'),
                             int(request.form.get('sitemap') == '1')))
                    self.db().commit()
                    flash('Настройки страницы сохранены.')
                    return redirect(url_for('seo_page', path=path))
                except ValueError as exc:
                    self.db().rollback()
                    error = str(exc)
            return render('seo_page.html', 'SEO страницы — Металл-Каркас', page=page,
                          defaults=self.defaults[path], staging=self.staging(), error=error), 422 if error else 200
