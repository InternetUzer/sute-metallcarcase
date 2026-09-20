"""Owner-managed services, seeded once from the original catalogue."""
import copy
import json
import re
import secrets
import sqlite3

from flask import abort, flash, g, redirect, request, url_for

from content import SERVICES, BUILDINGS, EXTRA
from enquiry_fields import GROUPS
from photo_library import convert_photo


def encode(value):
    return json.dumps(value, ensure_ascii=False)


def slugify(value):
    alphabet = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
                        ['a','b','v','g','d','e','yo','zh','z','i','y','k','l','m','n','o','p','r',
                         's','t','u','f','kh','ts','ch','sh','sch','','y','','e','yu','ya']))
    value = ''.join(alphabet.get(char, char) for char in value.lower())
    return re.sub(r'[^a-z0-9]+', '-', value).strip('-')[:80].rstrip('-') or 'usluga'


class ServiceCatalog:
    def __init__(self, app, db, media, data):
        self.app, self.db, self.media, self.folder = app, db, media, data / 'media'
        with app.app_context():
            db().executescript('''
                CREATE TABLE IF NOT EXISTS service_pages(
                    id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, content TEXT NOT NULL,
                    position INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0,
                    published_at TEXT, revision INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE IF NOT EXISTS service_pictures(
                    id INTEGER PRIMARY KEY, service_id INTEGER NOT NULL REFERENCES service_pages(id),
                    photo_id INTEGER NOT NULL REFERENCES photos(id), title TEXT NOT NULL DEFAULT '',
                    alt TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
                    position INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS service_fields(
                    id INTEGER PRIMARY KEY, service_id INTEGER NOT NULL REFERENCES service_pages(id),
                    label TEXT NOT NULL, kind TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]',
                    maximum INTEGER NOT NULL DEFAULT 10000000, active INTEGER NOT NULL DEFAULT 1,
                    position INTEGER NOT NULL DEFAULT 0);
                CREATE INDEX IF NOT EXISTS service_pictures_owner ON service_pictures(service_id);
                CREATE INDEX IF NOT EXISTS service_fields_owner ON service_fields(service_id);
            ''')
            # The marker prevents an archived or edited original from being recreated on restart.
            db().execute('BEGIN IMMEDIATE')
            if not db().execute("SELECT 1 FROM settings WHERE key='service_catalog_seeded'").fetchone():
                for position, original in enumerate(SERVICES, 1):
                    content = copy.deepcopy(original)
                    content['parameter_profile'] = next((group['key'] for group in GROUPS if original['slug'] in group['services']), '')
                    db().execute('''INSERT OR IGNORE INTO service_pages(slug,content,position,published,published_at)
                        VALUES(?,?,?,1,CURRENT_TIMESTAMP)''', (original['slug'], encode(content), position * 10))
                db().execute("INSERT INTO settings(key,value) VALUES('service_catalog_seeded','1')")
            db().commit()

    def invalidate(self):
        g.pop('service_catalog_rows', None)
        g.pop('seo_page_defaults', None)
        g.pop('media_snapshot', None)

    def all(self, published=False):
        if not hasattr(g, 'service_catalog_rows'):
            g.service_catalog_rows = [{**json.loads(row['content']), **dict(row)}
                for row in self.db().execute('SELECT * FROM service_pages ORDER BY position,id')]
            for number, item in enumerate(g.service_catalog_rows, 1):
                item['image'] = 'service-' + str(item['id'])
                item['number'] = str(number).zfill(2)
        return [item for item in g.service_catalog_rows if item['published'] or not published]

    def get(self, service_id):
        item = next((item for item in self.all() if item['id'] == service_id), None)
        if not item:
            abort(404)
        return item

    def by_slug(self, slug, published=False):
        return next((item for item in self.all(published) if item['slug'] == slug), None)

    def reserved(self):
        return ({rule.rule.strip('/').split('/')[0] for rule in self.app.url_map.iter_rules()
                 if '<' not in rule.rule.split('/')[1]} |
                {item['slug'] for item in BUILDINGS} | set(EXTRA) | {'building', 'robots', 'sitemap'})

    def unique_slug(self, name):
        base, slug, suffix = slugify(name), slugify(name), 2
        used = {item['slug'] for item in self.all()} | self.reserved()
        while slug in used:
            slug, suffix = base + '-' + str(suffix), suffix + 1
        return slug

    def pictures(self, service_id):
        return [dict(row) for row in self.db().execute('''SELECT sp.*,p.storage_name,p.width,p.height
            FROM service_pictures sp JOIN photos p ON p.id=sp.photo_id
            WHERE sp.service_id=? ORDER BY sp.position,sp.id''', (service_id,))]

    def fields(self, service_id, active=False):
        return [{**dict(row), 'options': json.loads(row['options']), 'key': 'service_field_' + str(row['id']),
                 'type': row['kind']} for row in self.db().execute(
                     'SELECT * FROM service_fields WHERE service_id=? ORDER BY position,id', (service_id,))
                if row['active'] or not active]

    def parameter_groups(self):
        result = []
        services = self.all(published=True)
        for original in GROUPS:
            selected = [item['slug'] for item in services if item.get('parameter_profile') == original['key']]
            if original['key'] == 'building':
                selected.insert(0, 'building')
            if selected:
                result.append({**original, 'services': selected})
        for item in services:
            fields = self.fields(item['id'], active=True)
            if fields:
                result.append(dict(key='service-' + str(item['id']), title=item['name'], services=[item['slug']], fields=fields))
        return result

    def field_labels(self):
        return {'service_field_' + str(row['id']): row['label'] for row in self.db().execute('SELECT id,label FROM service_fields')}

    def assets(self, base, preview=False):
        result = {}
        for item in self.all():
            content = json.loads(item['content'])
            cover = content.get('cover', 'asset:' + content.get('image', ''))
            if cover.startswith('photo:'):
                photo = self.db().execute('SELECT * FROM photos WHERE id=?', (cover[6:],)).fetchone()
                asset = dict(src=('/admin/photos/' + str(photo['id']) + '/image' if preview else '/media/' + photo['storage_name']),
                             small='', width=photo['width'], height=photo['height']) if photo else {}
            else:
                asset = dict(base.get(cover.removeprefix('asset:'), {}))
                if preview and asset.get('preview_src'):
                    asset['src'], asset['small'] = asset['preview_src'], ''
            if asset:
                asset.update(alt=content.get('image_alt') or asset.get('alt') or item['name'],
                             description=content.get('image_description') or asset.get('description', ''))
                result[item['image']] = asset
        return result

    def photo_usage(self, photo):
        result = []
        for item in self.all():
            content = json.loads(item['content'])
            cover = content.get('cover', '') == 'photo:' + str(photo['id'])
            gallery = any(p['photo_id'] == photo['id'] for p in self.pictures(item['id']))
            if cover or gallery:
                places = [('/' + item['slug'], item['name'])] if item['published'] else []
                if cover and item['published']:
                    places += [('/', 'Главная · услуги'), ('/uslugi', 'Список услуг')]
                result.append(('service:' + str(item['id']), item['name'], places))
        return result

    def is_public(self, storage):
        photo = self.db().execute('SELECT id FROM photos WHERE storage_name=?', (storage,)).fetchone()
        return bool(photo and any(places for _, _, places in self.photo_usage(photo)))

    def asset_services(self, key):
        return [item for item in self.all(published=True) if
                json.loads(item['content']).get('cover', 'asset:' + json.loads(item['content']).get('image', '')) == 'asset:' + key]

    @staticmethod
    def position(value):
        if not re.fullmatch(r'\d{1,5}', value) or int(value) > 10000:
            raise ValueError('Порядок: целое число от 0 до 10000.')
        return int(value)

    @staticmethod
    def lines(value, maximum=30):
        lines = [line.strip() for line in value.splitlines() if line.strip()]
        if len(lines) > maximum or any(len(line) > 500 for line in lines):
            raise ValueError(f'В списке допустимо до {maximum} строк, каждая до 500 символов.')
        return lines

    def content_from_form(self, form, item):
        fields = dict(name=180, short=100, intro=1200, body=12000, title=200, description=600,
                      image_alt=300, image_description=1000, h1=200)
        values = {key: form.get(key, '').strip() for key in fields}
        for key, limit in fields.items():
            if len(values[key]) > limit:
                raise ValueError(f'Слишком длинное поле: допустимо до {limit} символов.')
        if not values['name']:
            raise ValueError('Укажите название вида работ.')
        values['short'] = values['short'] or values['name'][:100]
        values['title'] = values['title'] or values['name'] + ' — Металл-Каркас'
        values['description'] = values['description'] or values['intro'][:600]
        values['includes'] = self.lines(form.get('includes', ''))
        values['inputs'] = self.lines(form.get('inputs', ''), 20)
        for key, first, second, count in [('sections', 'section_title', 'section_text', 20), ('faq', 'question', 'answer', 12)]:
            left, right = form.getlist(first), form.getlist(second)
            if len(left) != len(right) or len(left) > count:
                raise ValueError(f'Допустимо до {count} блоков. Проверьте заполнение пар полей.')
            values[key] = []
            for heading, body in zip(left, right):
                heading, body = heading.strip(), body.strip()
                if not heading and not body:
                    continue
                if not heading or not body or len(heading) > 250 or len(body) > 6000:
                    raise ValueError('Заполните оба поля блока: заголовок до 250 символов, текст до 6000.')
                values[key].append([heading, body])
        profile = form.get('parameter_profile', '')
        if profile and profile not in [group['key'] for group in GROUPS]:
            raise ValueError('Выберите набор параметров заявки из списка.')
        values['parameter_profile'] = profile
        cover = form.get('cover', '')
        if cover.startswith('asset:') and cover[6:] in self.media.originals():
            pass
        elif cover.startswith('photo:') and self.db().execute('SELECT 1 FROM photos WHERE id=?', (cover[6:],)).fetchone():
            pass
        elif cover:
            raise ValueError('Выберите фотографию из списка.')
        values['cover'] = cover
        values['slug'] = form.get('slug', '').strip()
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', values['slug']) or len(values['slug']) > 100:
            raise ValueError('Адрес: латинские буквы в нижнем регистре, цифры и дефисы, до 100 символов.')
        if item['published_at'] and item['slug'] != values['slug']:
            raise ValueError('После первой публикации адрес сохраняется, чтобы не ломать ссылки.')
        if values['slug'] in self.reserved():
            raise ValueError('Этот адрес занят другой страницей сайта. Выберите другой.')
        return values

    def register(self, protected, render):
        app, db = self.app, self.db

        @app.route('/admin/services', methods=['GET', 'POST'])
        @protected(admin=True)
        def services_admin():
            error = None
            if request.method == 'POST':
                try:
                    db().execute('BEGIN IMMEDIATE')
                    self.invalidate()
                    source = self.get(int(request.form['source_id'])) if request.form.get('source_id', '').isdigit() else None
                    name = request.form.get('name', '').strip() or (source['name'] + ' — копия' if source else '')
                    if not name or len(name) > 180:
                        raise ValueError('Укажите название вида работ до 180 символов.')
                    content = json.loads(source['content']) if source else dict(short='', intro='', body='', includes=[], inputs=[], sections=[], faq=[], cover='', parameter_profile='')
                    slug = self.unique_slug(name)
                    content.update(name=name, short=name[:100], slug=slug, title=name + ' — Металл-Каркас')
                    if source:
                        source_seo = db().execute('SELECT description FROM seo_pages WHERE path=?', ('/' + source['slug'],)).fetchone()
                        if source_seo and source_seo['description']:
                            content['description'] = source_seo['description']
                    position = db().execute('SELECT COALESCE(MAX(position),0)+10 FROM service_pages').fetchone()[0]
                    cursor = db().execute('INSERT INTO service_pages(slug,content,position) VALUES(?,?,?)', (slug, encode(content), min(position, 10000)))
                    service_id = cursor.lastrowid
                    if source:
                        db().execute('''INSERT INTO service_pictures(service_id,photo_id,title,alt,description,position)
                            SELECT ?,photo_id,title,alt,description,position FROM service_pictures WHERE service_id=?''', (service_id, source['id']))
                        db().execute('''INSERT INTO service_fields(service_id,label,kind,options,maximum,active,position)
                            SELECT ?,label,kind,options,maximum,active,position FROM service_fields WHERE service_id=?''', (service_id, source['id']))
                    db().commit()
                    flash('Черновик создан. Проверьте тексты, фотографии и SEO перед публикацией.')
                    return redirect(url_for('service_editor', service_id=service_id))
                except ValueError as exc:
                    db().rollback()
                    error = str(exc)
                finally:
                    self.invalidate()
            return render('services_admin.html', 'Виды работ — Металл-Каркас', catalog=self.all(), error=error), 422 if error else 200

        @app.route('/admin/services/<int:service_id>', methods=['GET', 'POST'])
        @protected(admin=True)
        def service_editor(service_id):
            item = self.get(service_id)
            error, form_item, written = None, None, []
            if request.method == 'POST':
                form, action = request.form, request.form.get('action', '')
                try:
                    db().execute('BEGIN IMMEDIATE')
                    self.invalidate()
                    item = self.get(service_id)
                    if form.get('revision') != str(item['revision']):
                        raise ValueError('Вид работ уже изменён в другой вкладке. Обновите страницу перед сохранением.')
                    if action in ('save', 'publish'):
                        values = self.content_from_form(form, item)
                        position = self.position(form.get('position', '0'))
                        if (item['published'] or action == 'publish') and not all(values.get(key) for key in ('intro', 'body', 'includes', 'cover')):
                            raise ValueError('Для публикации нужны краткое и полное описание, состав работ и обложка.')
                        db().execute('UPDATE service_pages SET slug=?,content=?,position=? WHERE id=?', (values['slug'], encode(values), position, service_id))
                        if values['slug'] != item['slug']:
                            db().execute('DELETE FROM seo_pages WHERE path=?', ('/' + item['slug'],))
                        db().execute('''INSERT INTO seo_pages(path,title,description,h1,noindex,sitemap) VALUES(?,?,?,?,?,?)
                            ON CONFLICT(path) DO UPDATE SET title=excluded.title,description=excluded.description,h1=excluded.h1,
                            noindex=excluded.noindex,sitemap=excluded.sitemap,updated_at=CURRENT_TIMESTAMP''',
                            ('/' + values['slug'], values['title'], values['description'], values['h1'],
                             int(form.get('noindex') == '1'), int(form.get('sitemap') == '1')))
                        if action == 'publish':
                            db().execute('UPDATE service_pages SET published=1,published_at=COALESCE(published_at,CURRENT_TIMESTAMP) WHERE id=?', (service_id,))
                    elif action == 'unpublish':
                        db().execute('UPDATE service_pages SET published=0 WHERE id=?', (service_id,))
                    elif action == 'upload':
                        uploads = [upload for upload in request.files.getlist('photos') if upload.filename]
                        if not 1 <= len(uploads) <= 3:
                            raise ValueError('Выберите от одной до трёх фотографий.')
                        prepared = [convert_photo(upload.read(10 * 1024 * 1024 + 1)) for upload in uploads]
                        new_photo_ids = []
                        for upload, (payload, width, height) in zip(uploads, prepared):
                            storage = secrets.token_hex(24) + '.webp'
                            target = self.folder / storage
                            written.append(target)
                            target.write_bytes(payload)
                            name = upload.filename.replace('\\', '/').rsplit('/', 1)[-1][:160]
                            photo_id = db().execute('INSERT INTO photos(storage_name,title,width,height) VALUES(?,?,?,?)', (storage, name, width, height)).lastrowid
                            new_photo_ids.append(photo_id)
                            db().execute('INSERT INTO service_pictures(service_id,photo_id,title) VALUES(?,?,?)', (service_id, photo_id, name))
                        content = json.loads(item['content'])
                        if not content.get('cover') and not content.get('image'):
                            content['cover'] = 'photo:' + str(new_photo_ids[0])
                            db().execute('UPDATE service_pages SET content=? WHERE id=?', (encode(content), service_id))
                    elif action == 'picture_add':
                        photo = db().execute('SELECT * FROM photos WHERE id=?', (form.get('photo_id'),)).fetchone()
                        if not photo:
                            raise ValueError('Выберите фотографию из библиотеки.')
                        db().execute('INSERT INTO service_pictures(service_id,photo_id,title) VALUES(?,?,?)', (service_id, photo['id'], photo['title']))
                    elif action in ('picture_save', 'picture_remove'):
                        photo = db().execute('SELECT * FROM service_pictures WHERE id=? AND service_id=?', (form.get('picture_id'), service_id)).fetchone()
                        if not photo:
                            abort(404)
                        if action == 'picture_remove':
                            db().execute('DELETE FROM service_pictures WHERE id=?', (photo['id'],))
                        else:
                            values = [form.get(key, '').strip() for key in ('picture_title', 'picture_alt', 'picture_description')]
                            if any(len(value) > limit for value, limit in zip(values, (180, 300, 2000))):
                                raise ValueError('Подпись: до 180 символов, ALT: до 300, описание: до 2000.')
                            db().execute('UPDATE service_pictures SET title=?,alt=?,description=?,position=? WHERE id=?', (*values, self.position(form.get('position', '0')), photo['id']))
                    elif action in ('field_save', 'field_toggle'):
                        field_id = form.get('field_id')
                        field = db().execute('SELECT * FROM service_fields WHERE id=? AND service_id=?', (field_id, service_id)).fetchone() if field_id else None
                        if field_id and not field:
                            abort(404)
                        if action == 'field_toggle':
                            if not field:
                                abort(400)
                            db().execute('UPDATE service_fields SET active=1-active WHERE id=?', (field['id'],))
                        else:
                            label, kind = form.get('label', '').strip(), form.get('kind', '')
                            options = self.lines(form.get('options', ''), 30)
                            if not label or len(label) > 120 or kind not in ('text', 'number', 'select'):
                                raise ValueError('Укажите название поля до 120 символов и выберите его тип.')
                            if kind == 'select' and (not options or any(len(option) > 160 for option in options) or len(options) != len(set(options))):
                                raise ValueError('Добавьте разные варианты выбора, каждый до 160 символов.')
                            maximum = form.get('maximum', '10000000').strip() or '10000000'
                            if not re.fullmatch(r'\d{1,10}', maximum) or not 1 <= int(maximum) <= 1000000000:
                                raise ValueError('Максимальное число: от 1 до 1000000000.')
                            position = self.position(form.get('position', '0'))
                            if field:
                                db().execute('UPDATE service_fields SET label=?,kind=?,options=?,maximum=?,position=? WHERE id=?', (label, kind, encode(options), int(maximum), position, field['id']))
                            else:
                                if len(self.fields(service_id)) >= 12:
                                    raise ValueError('Можно добавить до 12 собственных полей на вид работ.')
                                db().execute('INSERT INTO service_fields(service_id,label,kind,options,maximum,position) VALUES(?,?,?,?,?,?)', (service_id, label, kind, encode(options), int(maximum), position))
                    else:
                        abort(400)
                    db().execute('UPDATE service_pages SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?', (service_id,))
                    db().commit()
                    flash('Вид работ опубликован.' if action == 'publish' else 'Изменения сохранены.')
                    anchor = 'photos' if action.startswith('picture') or action == 'upload' else 'parameters' if action.startswith('field') else ''
                    return redirect(url_for('service_editor', service_id=service_id, _anchor=anchor))
                except (ValueError, sqlite3.IntegrityError) as exc:
                    db().rollback()
                    for path in written:
                        path.unlink(missing_ok=True)
                    error = str(exc) if isinstance(exc, ValueError) else 'Этот адрес уже занят. Выберите другой адрес услуги.'
                    if action in ('save', 'publish'):
                        form_item = {**item, **form.to_dict(), 'published': item['published'], 'published_at': item['published_at'],
                                     'revision': form.get('revision', item['revision']), 'id': item['id'],
                                     'includes': form.get('includes', '').splitlines(), 'inputs': form.get('inputs', '').splitlines(),
                                     'sections': list(zip(form.getlist('section_title'), form.getlist('section_text'))),
                                     'faq': list(zip(form.getlist('question'), form.getlist('answer'))),
                                     'noindex': form.get('noindex') == '1', 'sitemap': form.get('sitemap') == '1'}
                except Exception:
                    db().rollback()
                    for path in written:
                        path.unlink(missing_ok=True)
                    raise
                finally:
                    self.invalidate()
            item = dict(self.get(service_id))
            original = json.loads(item['content'])
            item['cover'] = original.get('cover', 'asset:' + original.get('image', ''))
            seo = db().execute('SELECT * FROM seo_pages WHERE path=?', ('/' + item['slug'],)).fetchone()
            item.update(h1=seo['h1'] if seo else '', noindex=seo['noindex'] if seo else 0, sitemap=seo['sitemap'] if seo else 1)
            if seo:
                item['title'] = seo['title'] or item.get('title', '')
                item['description'] = seo['description'] or item.get('description', '')
            return render('service_editor.html', 'Редактор вида работ — Металл-Каркас', service=form_item or item,
                          service_pictures=self.pictures(service_id), service_fields=self.fields(service_id),
                          library_photos=self.media.photos(), original_assets=self.media.assets(), profiles=GROUPS, error=error), 422 if error else 200

        @app.get('/admin/services/<int:service_id>/preview')
        @protected(admin=True)
        def service_preview(service_id):
            item = self.get(service_id)
            seo = db().execute('SELECT h1 FROM seo_pages WHERE path=?', ('/' + item['slug'],)).fetchone()
            return render('detail.html', item.get('title', item['name']), item.get('description', ''),
                          item=item, faqs=item.get('faq', []), service_pictures=self.pictures(service_id),
                          preview=True, preview_h1=seo['h1'] if seo else '')
