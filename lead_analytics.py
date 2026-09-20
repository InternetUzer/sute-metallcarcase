"""First-party lead attribution and optional Yandex Metrica configuration."""
from datetime import datetime, timedelta, timezone
import re
import time
from urllib.parse import urlsplit

from flask import abort, flash, g, redirect, request, session

EVENTS = {'phone_click': 'Нажатия на телефон', 'email_click': 'Нажатия на email',
          'telegram_click': 'Переходы в Telegram'}
PUBLIC_ENDPOINTS = {'home', 'services_page', 'buildings_page', 'detail', 'projects_page',
                    'models_page', 'faq_page', 'company_page', 'contacts', 'cooperation',
                    'enquiry', 'request_success', 'case_public'}


class LeadAnalytics:
    def __init__(self, app, db, protected, render, limited):
        self.app, self.db = app, db
        with app.app_context():
            db().executescript('''
                CREATE TABLE IF NOT EXISTS analytics_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS lead_attribution(
                    lead_id INTEGER PRIMARY KEY REFERENCES leads(id), source TEXT NOT NULL,
                    medium TEXT NOT NULL, campaign TEXT NOT NULL, content TEXT NOT NULL,
                    term TEXT NOT NULL, landing TEXT NOT NULL, referrer TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS analytics_clicks(
                    day TEXT NOT NULL, event TEXT NOT NULL, source TEXT NOT NULL, path TEXT NOT NULL,
                    count INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(day,event,source,path));
                CREATE INDEX IF NOT EXISTS leads_created_at ON leads(created_at);
            ''')
            db().commit()

        @app.before_request
        def capture_source():
            if request.method != 'GET' or request.endpoint not in PUBLIC_ENDPOINTS or not self.allowed():
                return
            now = int(time.time())
            prior = session.get('attribution', {})
            # Preserve the entry source across navigation; a new campaign starts a new visit.
            campaign = {k: self.clean(request.args.get('utm_' + k, '')) for k in ('source', 'medium', 'campaign', 'content', 'term')}
            if prior and now - prior.get('touched', 0) < 1800 and not any(campaign.values()):
                prior['touched'] = now
                session['attribution'] = prior
                return
            try:
                referrer = (urlsplit(request.referrer or '').hostname or '').lower()[:160]
            except ValueError:
                referrer = ''
            own = (urlsplit(app.config['SITE_URL']).hostname or '').removeprefix('www.')
            if referrer.removeprefix('www.') in (own, request.host.split(':')[0].removeprefix('www.')):
                referrer = ''
            source, medium = 'Прямой переход', 'direct'
            if referrer:
                source, medium = referrer, 'referral'
                if re.search(r'(^|\.)yandex\.(ru|com|by|kz|uz|com\.tr)$', referrer) or referrer == 'ya.ru':
                    source, medium = 'Яндекс', 'organic'
                elif re.search(r'(^|\.)google\.[a-z.]+$', referrer):
                    source, medium = 'Google', 'organic'
                elif referrer in ('bing.com', 'www.bing.com'):
                    source, medium = 'Bing', 'organic'
            session['attribution'] = {**campaign, 'source': campaign['source'] or source,
                'medium': campaign['medium'] or medium, 'landing': request.path[:200],
                'referrer': referrer, 'touched': now}

        @app.context_processor
        def analytics_context():
            allowed = self.allowed() and request.endpoint in PUBLIC_ENDPOINTS
            settings = self.settings()
            return dict(analytics_public=allowed, metrica_id=settings.get('counter_id', '') if allowed and settings.get('enabled') == '1' else '')

        @app.post('/analytics/event')
        def analytics_event():
            if not self.allowed():
                return '', 204
            event = request.form.get('event', '')
            path = request.form.get('path', '')
            if event not in EVENTS or not re.fullmatch(r'/[a-zA-Z0-9/_-]{0,199}', path):
                abort(400)
            if path.startswith(('/admin', '/cabinet', '/reset', '/files', '/login')):
                abort(400)
            limited('analytics', 120, 3600)
            source = self.current()['source']
            self.db().execute('''INSERT INTO analytics_clicks(day,event,source,path) VALUES(?,?,?,?)
                ON CONFLICT(day,event,source,path) DO UPDATE SET count=count+1''',
                (datetime.now(timezone.utc).date().isoformat(), event, source, path))
            self.db().commit()
            return '', 204

        @app.route('/admin/analytics', methods=['GET', 'POST'])
        @protected(admin=True)
        def analytics_panel():
            error = None
            settings = self.settings()
            if request.method == 'POST':
                counter = request.form.get('counter_id', '').strip()
                enabled = request.form.get('enabled') == '1'
                if (counter and not re.fullmatch(r'[1-9][0-9]{0,11}', counter)) or (enabled and not counter):
                    error = 'Укажите числовой номер счётчика Метрики. Код HTML вставлять не нужно.'
                    settings = {'counter_id': counter, 'enabled': '1' if enabled else '0'}
                else:
                    for key, value in {'counter_id': counter, 'enabled': '1' if enabled else '0'}.items():
                        self.db().execute('INSERT INTO analytics_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, value))
                    self.db().commit()
                    flash('Настройки аналитики сохранены.')
                    return redirect('/admin/analytics')
            days = request.args.get('days', '30')
            days = int(days) if days in ('7', '30', '90', '365') else 30
            since = (datetime.now(timezone.utc).date() - timedelta(days=days - 1)).isoformat()
            stats = self.db().execute('''SELECT count(*) total,
                COALESCE(sum(status='Новая'),0) new FROM leads WHERE created_at>=?''', (since,)).fetchone()
            sources = self.db().execute('''SELECT COALESCE(a.source,'Не определён (ранее)') source,
                COALESCE(a.medium,'') medium, count(*) count FROM leads l LEFT JOIN lead_attribution a ON a.lead_id=l.id
                WHERE l.created_at>=? GROUP BY 1,2 ORDER BY count DESC''', (since,)).fetchall()
            pages = self.db().execute('''SELECT a.landing, count(*) count FROM leads l JOIN lead_attribution a ON a.lead_id=l.id
                WHERE l.created_at>=? GROUP BY a.landing ORDER BY count DESC LIMIT 20''', (since,)).fetchall()
            clicks = {r['event']: r['count'] for r in self.db().execute('SELECT event,sum(count) count FROM analytics_clicks WHERE day>=? GROUP BY event', (since,))}
            leads = self.db().execute('''SELECT l.number,l.created_at,l.status,a.* FROM leads l LEFT JOIN lead_attribution a ON a.lead_id=l.id
                WHERE l.created_at>=? ORDER BY l.id DESC LIMIT 100''', (since,)).fetchall()
            return render('analytics.html', 'Аналитика обращений — Металл-Каркас',
                settings=settings, days=days, since=since, stats=stats, sources=sources, pages=pages,
                clicks=clicks, events=EVENTS, recent_leads=leads, error=error), 422 if error else 200

    @staticmethod
    def clean(value):
        return ''.join(c for c in value if c.isprintable())[:100].strip()

    def allowed(self):
        host = (urlsplit(self.app.config['SITE_URL']).hostname or '')
        return bool(self.app.config['SITE_INDEXABLE'] and not g.user and
                    not host.startswith(('test.', 'staging.', 'preview.')) and
                    not request.host.startswith(('test.', 'staging.', 'preview.')))

    def settings(self):
        return {r['key']: r['value'] for r in self.db().execute('SELECT * FROM analytics_settings')}

    def current(self):
        values = session.get('attribution', {})
        if int(time.time()) - values.get('touched', 0) >= 1800:
            values = {}
        return {key: values.get(key, default) for key, default in dict(source='Не определён', medium='', campaign='', content='', term='', landing='/request', referrer='').items()}

    def save_lead(self, lead_id):
        values = self.current()
        self.db().execute('INSERT INTO lead_attribution(lead_id,source,medium,campaign,content,term,landing,referrer) VALUES(?,?,?,?,?,?,?,?)',
                         (lead_id, *values.values()))
