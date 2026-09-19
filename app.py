from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from email.message import EmailMessage
import hashlib
import json
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import time
import uuid

import click
from flask import Flask, abort, flash, g, redirect, render_template, request, send_file, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.middleware.proxy_fix import ProxyFix
from content import COMPANY, SERVICES, BUILDINGS, MODELS, FAQ, EXTRA
from project_sheets import HEADERS, register_sheets
from photo_library import register_photos
from seo_panel import SEOPanel

ROOT = Path(__file__).resolve().parent

def create_app(test_config=None):
    app = Flask(__name__)
    production = os.environ.get('APP_ENV') == 'production'
    app.config.update(
        SECRET_KEY=os.environ.get('SECRET_KEY'),
        DATA_DIR=os.environ.get('DATA_DIR', str(ROOT / 'instance')),
        SITE_URL=os.environ.get('SITE_URL', 'http://localhost:8000').rstrip('/'),
        SITE_INDEXABLE=os.environ.get('SITE_INDEXABLE') == '1',
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=production, PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        MAX_CONTENT_LENGTH=25*1024*1024, MAX_FORM_PARTS=40, MAX_FORM_MEMORY_SIZE=100_000,
    )
    if test_config:
        app.config.update(test_config)
    if os.environ.get('TRUST_PROXY') == '1':
        # Enable only behind one trusted reverse proxy; never expose Gunicorn directly.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
    if not app.config['SECRET_KEY']:
        if production:
            raise RuntimeError('Set a strong SECRET_KEY before production deployment.')
        app.config['SECRET_KEY'] = secrets.token_hex(32)
    if production and len(app.config['SECRET_KEY']) < 32:
        raise RuntimeError('SECRET_KEY must contain at least 32 characters.')
    data = Path(app.config['DATA_DIR'])
    data.mkdir(parents=True, exist_ok=True)
    (data / 'files').mkdir(exist_ok=True)
    app.config['DATABASE'] = str(data / 'site.sqlite3')
    if os.environ.get('TRUSTED_HOSTS'):
        app.config['TRUSTED_HOSTS'] = [s.strip() for s in os.environ['TRUSTED_HOSTS'].split(',')]

    def db():
        if 'db' not in g:
            g.db = sqlite3.connect(app.config['DATABASE'], timeout=20)
            g.db.row_factory = sqlite3.Row
            g.db.execute('PRAGMA foreign_keys=ON')
        return g.db

    @app.teardown_appcontext
    def close_db(error=None):
        connection = g.pop('db', None)
        if connection:
            connection.close()

    with app.app_context():
        db().executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'client', version INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Обсуждение проекта', model_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS updates(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL, contact TEXT NOT NULL, body TEXT NOT NULL, city TEXT NOT NULL DEFAULT '', services TEXT NOT NULL, model_id TEXT NOT NULL DEFAULT '', parameters TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'Новая', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects(id), lead_id INTEGER REFERENCES leads(id), original_name TEXT NOT NULL, storage_name TEXT NOT NULL UNIQUE, label TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '1', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK ((project_id IS NULL) != (lead_id IS NULL)));
            CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS showcases(id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, image TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'construction', location TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 1);
        ''')
        db().commit()

    def assets():
        return media.assets()

    def csrf_token():
        if 'csrf' not in session:
            session['csrf'] = secrets.token_urlsafe(32)
        return session['csrf']

    def limited(bucket, limit, seconds):
        ip = request.remote_addr or 'unknown'
        key = hashlib.sha256((bucket + ip).encode()).hexdigest()
        now = int(time.time())
        connection = db()
        connection.execute('DELETE FROM rate_limits WHERE expires < ?', (now,))
        connection.execute('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key,now+seconds))
        row = connection.execute('SELECT count FROM rate_limits WHERE key=?',(key,)).fetchone()
        connection.commit()
        if row['count'] > limit:
            abort(429)

    @app.before_request
    def protect():
        g.user = None
        if session.get('user_id'):
            user = db().execute('SELECT * FROM users WHERE id=?',(session['user_id'],)).fetchone()
            if user and user['version'] == session.get('user_version'):
                g.user = user
            else:
                session.clear()
        if request.method == 'POST':
            token = request.form.get('csrf_token', '')
            if not token or not secrets.compare_digest(token, session.get('csrf','')):
                abort(400, 'Сессия формы истекла. Обновите страницу и повторите отправку.')

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        # Only the intentionally activated Sketchfab viewer may load third-party content.
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; frame-src https://sketchfab.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
        if production:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        private = request.path.startswith(('/cabinet', '/admin', '/files', '/request', '/reset', '/login', '/forgot'))
        page_seo = seo.get(request.path)
        if private or not seo.enabled() or (page_seo and page_seo['noindex']) or response.status_code >= 400:
            response.headers['X-Robots-Tag'] = 'noindex, nofollow'
        if private or response.mimetype == 'text/html':
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.context_processor
    def context():
        settings = {r['key']:r['value'] for r in db().execute('SELECT * FROM settings')}
        company = {**COMPANY, **settings}
        company['phone_link'] = '+' + re.sub(r'\D','',company['phone'])
        return dict(company=company, services=SERVICES, buildings=BUILDINGS, models=MODELS,
                    assets=assets(), csrf_token=csrf_token, year=datetime.now().year,
                    canonical=app.config['SITE_URL'] + request.path,
                    site_url=app.config['SITE_URL'], indexable=app.config['SITE_INDEXABLE'],
                    contact_email=company['email'])

    def protected(admin=False):
        def decorator(f):
            @wraps(f)
            def wrapper(*args, **kwargs):
                if not g.user:
                    return redirect(url_for('login'))
                if admin and g.user['role'] != 'admin':
                    abort(403)
                return f(*args, **kwargs)
            return wrapper
        return decorator

    def render(name, title, description='', **kwargs):
        return render_template(name, **seo.metadata(request.path, title, description), **kwargs)

    def public_gallery():
        return media.gallery()

    @app.get('/')
    def home():
        return render('home.html', 'Строительство ангаров и складов — Металл-Каркас',
                      'Строительство ангаров и складов, изготовление и монтаж металлоконструкций, бетонные работы и сэндвич-панели. Отправьте проект для расчёта.', gallery=public_gallery()[:3], faqs=FAQ[:4])

    @app.get('/uslugi')
    def services_page():
        return render('listing.html', 'Изготовление и монтаж металлоконструкций: услуги — Металл-Каркас',
                      'Отдельные строительные работы: изготовление металлоконструкций, монтаж каркаса, бетонные работы и монтаж сэндвич-панелей.', kind='services', extra=EXTRA)

    @app.get('/angary-i-sklady')
    def buildings_page():
        return render('listing.html', 'Ангары и склады из металлоконструкций — Металл-Каркас',
                      'Холодные и утеплённые ангары и склады. Выбор конструкции, комплектации и состава работ по вашему проекту.', kind='buildings')

    @app.get('/<slug>')
    def detail(slug):
        for item in SERVICES + BUILDINGS:
            if slug == item['slug']:
                return render('detail.html', item['title'], item['description'], item=item, faqs=item.get('faq', FAQ[:3]))
        if slug in EXTRA:
            name, body = EXTRA[slug]
            return render('info.html', name + ' — Металл-Каркас', body, heading=name, body=body)
        abort(404)

    @app.get('/produkciya')
    @app.get('/nashi-raboty')
    def projects_page():
        if request.path == '/nashi-raboty':
            return redirect('/produkciya',301)
        return render('gallery.html', 'Объекты и фотографии работ — Металл-Каркас',
                      'Фотографии металлоконструкций и строительных работ. Посмотрите примеры и отправьте задачу для своего объекта.', gallery=public_gallery())

    @app.get('/prays-list')
    def models_page():
        selected = next((m for m in MODELS if m['id']==request.args.get('model')), MODELS[0])
        return render('models.html', '3D-модели ангаров, складов и зданий — Металл-Каркас',
                      'Рассмотрите 3D-модели арочного ангара, склада с офисом и других зданий. Выберите решение и отправьте заявку на расчёт.', selected=selected)

    @app.get('/about')
    def faq_page():
        return render('faq.html', 'Вопросы о строительстве ангаров и монтаже — Металл-Каркас',
                      'Что нужно для расчёта, как заказать отдельные работы, от чего зависит стоимость ангара и как получить документы по объекту.', faqs=FAQ)

    @app.get('/o-kompanii')
    def company_page():
        return render('company.html', 'О компании Металл-Каркас — производство и строительство',
                      'Металл-Каркас: изготовление и монтаж металлоконструкций, строительство ангаров и складов. Контакты и реквизиты исполнителя.')

    @app.get('/kontakty')
    def contacts():
        return render('contacts.html', 'Контакты Металл-Каркас — обсудить строительство и монтаж',
                      'Свяжитесь с Металл-Каркас для расчёта строительства ангара, склада или отдельных работ. Телефон, email и форма заявки.')

    @app.get('/sotrydnichestvo')
    def cooperation():
        return render('info.html', 'Сотрудничество — Металл-Каркас', 'Сотрудничество по строительным проектам и металлоконструкциям.',
                      heading='Обсудим совместный проект', body='Приглашаем к обсуждению строительных задач, поставок и подрядных работ. Расскажите о вашем предложении и приложите необходимые материалы.')

    @app.get('/privacy')
    def privacy():
        return render('privacy.html', 'Обработка персональных данных — Металл-Каркас')

    def contact_valid(value):
        return bool(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',value)) or 10 <= len(re.sub(r'\D','',value)) <= 15

    def notify(subject, body, recipient=None):
        host = os.environ.get('SMTP_HOST')
        if not host:
            return False
        try:
            msg = EmailMessage()
            msg['Subject'] = subject
            msg['From'] = os.environ['SMTP_FROM']
            msg['To'] = recipient or os.environ.get('NOTIFY_EMAIL', COMPANY['email'])
            msg.set_content(body)
            port = int(os.environ.get('SMTP_PORT','587'))
            transport = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
            with transport(host,port,timeout=10) as smtp:
                if port != 465:
                    smtp.starttls(context=ssl.create_default_context())
                if os.environ.get('SMTP_USER'):
                    smtp.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
                smtp.send_message(msg)
            return True
        except Exception:
            app.logger.error('SMTP notification failed; check mail configuration. Request remains in database.')
            return False

    def uploaded_files():
        items = [f for f in request.files.getlist('files') if f.filename]
        if len(items)>3:
            raise ValueError('Можно прикрепить не более трёх файлов.')
        output=[]
        allowed={'.pdf','.png','.jpg','.jpeg','.webp','.dwg','.dxf','.docx','.xlsx','.zip'}
        for f in items:
            name=f.filename.replace('\\','/').rsplit('/',1)[-1][:160]
            ext=Path(name).suffix.lower()
            payload=f.read(10*1024*1024+1)
            if ext not in allowed or not payload or len(payload)>10*1024*1024:
                raise ValueError('Допустимы PDF, JPG, PNG, WebP, DWG, DXF, DOCX, XLSX и ZIP до 10 МБ каждый.')
            # Files are never executed or served inline, including CAD/office formats.
            output.append((name,uuid.uuid4().hex+ext,payload))
        return output

    def store_files(items, project_id=None, lead_id=None):
        for name, storage, payload in items:
            (data/'files'/storage).write_bytes(payload)
            db().execute('INSERT INTO files(project_id,lead_id,original_name,storage_name,label,version) VALUES(?,?,?,?,?,?)',
                         (project_id,lead_id,name,storage,request.form.get('file_label','')[:160],request.form.get('version','1')[:40]))

    @app.route('/request',methods=['GET','POST'])
    def enquiry():
        errors=[]
        values=request.form if request.method=='POST' else request.args
        selected_services=values.getlist('services')
        if request.method=='POST':
            limited('lead',10,3600)
            contact=values.get('contact','').strip()[:200]
            body=values.get('body','').strip()[:4000]
            city=values.get('city','').strip()[:160]
            if not contact_valid(contact): errors.append('Укажите действующий телефон или email для ответа.')
            if not body and not selected_services: errors.append('Выберите работы или кратко опишите задачу.')
            if values.get('consent')!='yes': errors.append('Подтвердите согласие на обработку данных заявки.')
            if values.get('website'): errors.append('Не удалось отправить заявку.')
            if any(s not in [x['slug'] for x in SERVICES]+['building'] for s in selected_services): errors.append('Проверьте выбранные услуги.')
            try:
                files=uploaded_files()
            except ValueError as error:
                errors.append(str(error))
            parameters={k:values.get(k,'').strip()[:80] for k in ('width','length','height','insulation','purpose')}
            for key in ('width','length','height'):
                if parameters[key]:
                    try:
                        value=float(parameters[key].replace(',','.'))
                        if not 0<value<=1000: raise ValueError()
                    except ValueError:
                        errors.append('Размеры указываются числом от 0 до 1000 метров или оставляются пустыми.')
                        break
            if not errors:
                number='МК-'+datetime.now().strftime('%y%m%d')+'-'+secrets.token_hex(3).upper()
                model_id=values.get('model_id','')
                if model_id not in [m['id'] for m in MODELS]: model_id=''
                cursor=db().execute('INSERT INTO leads(number,contact,body,city,services,model_id,parameters) VALUES(?,?,?,?,?,?,?)',
                                    (number,contact,body,city,json.dumps(selected_services),model_id,json.dumps(parameters,ensure_ascii=False)))
                try:
                    store_files(files,lead_id=cursor.lastrowid)
                    db().commit()
                except Exception:
                    db().rollback()
                    for _,storage,_ in files: (data/'files'/storage).unlink(missing_ok=True)
                    raise
                notify('Новая заявка '+number, 'Новая заявка сохранена. Откройте панель управления: '+app.config['SITE_URL']+'/admin')
                session['last_request']=number
                return redirect(url_for('request_success'))
        return render('request.html','Запросить расчёт строительства или монтажа — Металл-Каркас',
                      'Опишите объект, выберите работы и приложите чертежи. Сохраним заявку и свяжемся для уточнения расчёта.',
                      errors=errors,values=values,selected_services=selected_services), (422 if errors else 200)

    @app.get('/request/success')
    def request_success():
        if not session.get('last_request'): return redirect('/request')
        return render('success.html','Заявка принята — Металл-Каркас',number=session['last_request'])

    @app.route('/login',methods=['GET','POST'])
    def login():
        error=None
        if request.method=='POST':
            limited('login',12,900)
            user=db().execute('SELECT * FROM users WHERE email=?',(request.form.get('email','').strip().lower(),)).fetchone()
            password=request.form.get('password','')
            if user and check_password_hash(user['password'],password):
                session.clear()
                session.update(user_id=user['id'],user_version=user['version'])
                session.permanent=True
                return redirect('/admin' if user['role']=='admin' else '/cabinet')
            error='Проверьте email и пароль.'
        return render('auth.html','Личный кабинет — Металл-Каркас',mode='login',error=error), (401 if error else 200)

    @app.post('/logout')
    def logout():
        session.clear()
        return redirect('/')

    def issue_token(user_id):
        token=secrets.token_urlsafe(32)
        db().execute('DELETE FROM tokens WHERE user_id=?',(user_id,))
        db().execute('INSERT INTO tokens VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),user_id,int(time.time())+86400))
        db().commit()
        return app.config['SITE_URL']+'/reset/'+token

    @app.route('/forgot',methods=['GET','POST'])
    def forgot():
        if request.method=='POST':
            limited('forgot',5,3600)
            email=request.form.get('email','').lower().strip()
            user=db().execute('SELECT id FROM users WHERE email=?',(email,)).fetchone()
            if user and os.environ.get('SMTP_HOST'):
                link=issue_token(user['id'])
                notify('Восстановление доступа — Металл-Каркас','Для установки пароля перейдите по ссылке (действует 24 часа):\n'+link,email)
            flash('Если для этого адреса есть кабинет, вы получите письмо со ссылкой. Если письмо не пришло, свяжитесь с нами для восстановления доступа.')
            return redirect('/forgot')
        return render('auth.html','Восстановление доступа — Металл-Каркас',mode='forgot',error=None)

    @app.route('/reset/<token>',methods=['GET','POST'])
    def reset(token):
        token_hash=hashlib.sha256(token.encode()).hexdigest()
        row=db().execute('SELECT * FROM tokens WHERE hash=? AND expires>?',(token_hash,int(time.time()))).fetchone()
        if not row: abort(410,'Ссылка истекла или уже использована. Запросите новую ссылку.')
        error=None
        if request.method=='POST':
            limited('reset',10,3600)
            password=request.form.get('password','')
            if len(password)<12 or len(password)>200:
                error='Используйте пароль от 12 до 200 символов.'
            elif password!=request.form.get('confirm'):
                error='Пароли не совпадают.'
            else:
                cursor=db().execute('DELETE FROM tokens WHERE hash=? AND expires>?',(token_hash,int(time.time())))
                if cursor.rowcount!=1:
                    db().rollback()
                    abort(410)
                db().execute('UPDATE users SET password=?,version=version+1 WHERE id=?',(generate_password_hash(password),row['user_id']))
                db().commit()
                session.clear()
                flash('Пароль сохранён. Войдите в кабинет.')
                return redirect('/login')
        return render('auth.html','Установить пароль — Металл-Каркас',mode='reset',error=error)

    @app.get('/cabinet')
    @protected()
    def cabinet():
        projects=db().execute('SELECT * FROM projects WHERE user_id=? ORDER BY id DESC',(g.user['id'],)).fetchall()
        return render('cabinet.html','Мои объекты — Металл-Каркас',projects=projects)

    def get_project(project_id):
        project=db().execute('SELECT * FROM projects WHERE id=?',(project_id,)).fetchone()
        if not project: abort(404)
        if g.user['role']!='admin' and project['user_id']!=g.user['id']: abort(404)
        return project

    @app.get('/cabinet/projects/<int:project_id>')
    @protected()
    def project(project_id):
        item=get_project(project_id)
        sheet=db().execute('SELECT * FROM project_sheets WHERE project_id=?', (project_id,)).fetchone()
        return render('project.html',item['title']+' — Металл-Каркас',project=item, sheet_headers=HEADERS,
                      sheet_rows=json.loads(sheet['payload']) if sheet else [],
                      sheet_updated=sheet['updated_at'] if sheet else None,
                      documents=db().execute('SELECT * FROM files WHERE project_id=? ORDER BY id DESC',(project_id,)).fetchall(),
                      updates=db().execute('SELECT * FROM updates WHERE project_id=? ORDER BY id DESC',(project_id,)).fetchall())

    @app.get('/files/<int:file_id>')
    @protected()
    def file_download(file_id):
        item=db().execute('SELECT * FROM files WHERE id=?',(file_id,)).fetchone()
        if not item: abort(404)
        if item['project_id']: get_project(item['project_id'])
        elif g.user['role']!='admin': abort(404)
        target=data/'files'/item['storage_name']
        if not target.is_file(): abort(404)
        return send_file(target,as_attachment=True,download_name=item['original_name'],mimetype='application/octet-stream')

    @app.route('/admin',methods=['GET','POST'])
    @protected(admin=True)
    def admin():
        invitation=None
        if request.method=='POST':
            action=request.form.get('action')
            try:
                if action=='client':
                    email=request.form.get('email','').strip().lower()
                    name=request.form.get('name','').strip()[:160]
                    if not name or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email): raise ValueError('Укажите имя и корректный email клиента.')
                    cursor=db().execute('INSERT INTO users(email,name,password) VALUES(?,?,?)',(email,name,generate_password_hash(secrets.token_urlsafe(40))))
                    db().commit()
                    invitation=issue_token(cursor.lastrowid)
                elif action=='invite':
                    user=db().execute("SELECT id FROM users WHERE id=? AND role='client'",(request.form.get('user_id'),)).fetchone()
                    if not user: raise ValueError('Клиент не найден.')
                    invitation=issue_token(user['id'])
                elif action=='project':
                    title=request.form.get('title','').strip()[:200]
                    owner=db().execute("SELECT id FROM users WHERE id=? AND role='client'",(request.form.get('user_id'),)).fetchone()
                    if not title or not owner: raise ValueError('Выберите клиента и укажите название объекта.')
                    model=request.form.get('model_id','')
                    if model not in [m['id'] for m in MODELS]: model=''
                    db().execute('INSERT INTO projects(user_id,title,description,model_id) VALUES(?,?,?,?)',(owner['id'],title,request.form.get('description','')[:6000],model))
                    db().commit()
                    flash('Объект создан.')
                elif action=='lead':
                    status=request.form.get('status')
                    if status not in ['Новая','В работе','Предложение отправлено','Завершена']: raise ValueError('Неверный статус.')
                    db().execute('UPDATE leads SET status=? WHERE id=?',(status,request.form.get('lead_id')))
                    db().commit()
                    flash('Статус заявки обновлён.')
                elif action=='settings':
                    for key in ('phone','email','region'):
                        value=request.form.get(key,'').strip()[:200]
                        if not value: raise ValueError('Заполните все контактные данные.')
                        if key=='email' and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',value): raise ValueError('Некорректный email.')
                        if key=='phone' and not 10<=len(re.sub(r'\D','',value))<=15: raise ValueError('Некорректный телефон.')
                        db().execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,value))
                    db().commit()
                    flash('Контакты обновлены.')
                elif action=='showcase':
                    image=request.form.get('image','')
                    if image not in [a['src'] for a in assets().values()] and not db().execute(
                        "SELECT 1 FROM photos WHERE '/media/' || storage_name=?", (image,)).fetchone():
                        raise ValueError('Выберите изображение из библиотеки сайта.')
                    title=request.form.get('title','').strip()[:160]
                    description=request.form.get('description','').strip()[:3000]
                    if not title or not description: raise ValueError('Укажите название и состав выполненных работ.')
                    db().execute('INSERT INTO showcases(title,description,image,location) VALUES(?,?,?,?)',(title,description,image,request.form.get('location','')[:160]))
                    db().commit()
                    flash('Объект опубликован.')
                elif action=='unpublish':
                    db().execute('UPDATE showcases SET published=0 WHERE id=?',(request.form.get('showcase_id'),))
                    db().commit()
                    flash('Объект снят с публикации.')
                else:
                    abort(400)
            except (ValueError,sqlite3.IntegrityError) as error:
                db().rollback()
                flash(str(error) if isinstance(error,ValueError) else 'Клиент с таким email уже существует.')
            if not invitation:
                return redirect('/admin')
        return render('admin.html','Панель управления — Металл-Каркас',invitation=invitation,
                      photos=db().execute('SELECT * FROM photos ORDER BY id DESC').fetchall(),
                      leads=db().execute('SELECT * FROM leads ORDER BY id DESC LIMIT 200').fetchall(),
                      clients=db().execute("SELECT id,name,email FROM users WHERE role='client' ORDER BY name").fetchall(),
                      projects=db().execute('SELECT p.*,u.name AS client_name FROM projects p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC').fetchall(),
                      attachments=db().execute('SELECT * FROM files WHERE lead_id IS NOT NULL').fetchall(),
                      showcases=db().execute('SELECT * FROM showcases WHERE published=1 ORDER BY id DESC').fetchall())

    @app.post('/admin/projects/<int:project_id>')
    @protected(admin=True)
    def update_project(project_id):
        get_project(project_id)
        items=[]
        try:
            items=uploaded_files()
            status=request.form.get('status','').strip()[:160]
            body=request.form.get('body','').strip()[:6000]
            if status: db().execute('UPDATE projects SET status=? WHERE id=?',(status,project_id))
            if body: db().execute('INSERT INTO updates(project_id,body) VALUES(?,?)',(project_id,body))
            store_files(items,project_id=project_id)
            db().commit()
            flash('Объект обновлён.')
        except ValueError as error:
            db().rollback()
            for _,storage,_ in items: (data/'files'/storage).unlink(missing_ok=True)
            flash(str(error))
        except Exception:
            db().rollback()
            for _,storage,_ in items: (data/'files'/storage).unlink(missing_ok=True)
            raise
        return redirect(url_for('project',project_id=project_id))

    @app.get('/robots.txt')
    def robots():
        return seo.robots(),200,{'Content-Type':'text/plain; charset=utf-8'}

    @app.get('/sitemap.xml')
    def sitemap():
        return seo.sitemap(),200,{'Content-Type':'application/xml'}

    redirects={'/on-layn-zayavka':'/sotrydnichestvo','/napishite-nam':'/request','/zakazat':'/request','/ustanovka-konstruktsii':'/montaj-konstruktsii','/regist':'/login','/regist/agreement':'/privacy','/user/agreement':'/privacy','/search':'/uslugi'}
    for i,(old,new) in enumerate(redirects.items()):
        app.add_url_rule(old,'legacy_'+str(i),lambda target=new:redirect(target,301))

    @app.errorhandler(404)
    @app.errorhandler(403)
    @app.errorhandler(400)
    @app.errorhandler(410)
    @app.errorhandler(429)
    @app.errorhandler(RequestEntityTooLarge)
    def error_page(error):
        code=error.code
        messages={404:'Такой страницы нет. Возможно, адрес изменился.',403:'Для этой страницы нужен другой уровень доступа.',400:'Не удалось обработать форму. Обновите страницу и повторите попытку.',410:'Срок действия ссылки закончился. Запросите новую.',429:'Слишком много запросов. Попробуйте позже.',413:'Размер отправки превышает 25 МБ. Уменьшите файлы и повторите.'}
        return render('error.html',str(code)+' — Металл-Каркас',code=code,message=messages[code]),code

    @app.cli.command('create-admin')
    @click.option('--email',prompt=True)
    @click.option('--name',default='Администратор')
    @click.password_option(confirmation_prompt=True)
    def create_admin(email,name,password):
        if len(password)<12: raise click.ClickException('Минимум 12 символов в пароле.')
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email): raise click.ClickException('Некорректный email.')
        try:
            db().execute("INSERT INTO users(email,name,password,role) VALUES(?,?,?,'admin')",(email.lower().strip(),name,generate_password_hash(password)))
            db().commit()
        except sqlite3.IntegrityError:
            raise click.ClickException('Пользователь уже существует.')
        click.echo('Администратор создан. Войдите через /login.')

    @app.cli.command('backup')
    @click.argument('destination',type=click.Path())
    def backup(destination):
        import tarfile
        target=Path(destination)
        if target.exists(): raise click.ClickException('Файл уже существует.')
        snapshot=data/'backup-snapshot.sqlite3'
        with sqlite3.connect(snapshot) as dest:
            db().backup(dest)
        try:
            with tarfile.open(target,'w:gz') as archive:
                archive.add(snapshot,arcname='site.sqlite3')
                archive.add(data/'files',arcname='files')
                archive.add(data/'media',arcname='media')
        finally:
            snapshot.unlink(missing_ok=True)
        click.echo('Резервная копия создана. Храните её вне публичного сайта и репозитория.')

    register_sheets(app, db, protected, get_project, render)
    media = register_photos(app, db, protected, render, data, ROOT)
    seo = SEOPanel(app, db, ROOT)
    seo.register(app, protected, render)

    return app

if __name__=='__main__':
    create_app().run(host='127.0.0.1',port=8000)
