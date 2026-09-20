"""Owner-editable factual content with separate drafts and published snapshots."""
from datetime import date
import json
import secrets
from urllib.parse import urlsplit

from flask import abort, flash, g, redirect, request

from content import BUILDINGS
from photo_library import convert_photo


def field(key, label, kind='text', limit=300):
    return dict(key=key, label=label, kind=kind, limit=limit)


SECTIONS = {
    'home': dict(title='Главная: предложение и преимущества', path='/', fields=[
        field('intro', 'Краткое предложение', 'textarea', 1000),
        field('benefit1', 'Подтверждённое преимущество 1'),
        field('benefit2', 'Подтверждённое преимущество 2'),
        field('benefit3', 'Подтверждённое преимущество 3'),
        field('caption', 'Подпись главного фото: объект и ваши работы', 'textarea', 600),
        field('caption_url', 'Куда ведёт подпись фото', 'page')], defaults={
            'intro': 'Изготовление, монтаж и строительные работы. Возьмём на себя весь объект или отдельный этап по вашему проекту.',
            'caption': 'Промышленные и складские здания', 'caption_url': '/angary-i-sklady'}),
    'company': dict(title='Компания: история, документы, гарантии', path='/o-kompanii', fields=[
        field('intro', 'Кратко о компании', 'textarea', 1500),
        field('description', 'Чем занимается компания', 'textarea', 6000),
        field('history', 'История и опыт: только подтверждённые факты', 'textarea', 6000),
        field('documents', 'Какие документы получает заказчик', 'textarea', 4000),
        field('warranty', 'Гарантии: условия, сроки и ограничения', 'textarea', 4000)], defaults={
            'intro': 'Металл-Каркас — изготовление и монтаж металлоконструкций, бетонные и монолитные работы, монтаж сэндвич-панелей и кровельных систем.',
            'description': 'Работаем с промышленными, производственными, торговыми и складскими объектами. Изготавливаем и монтируем каркасы, фермы, лестницы и площадки, выполняем бетонные и монолитные работы. Монтируем стеновые и кровельные сэндвич-панели, наплавляемую и мембранную кровлю. Состав заказа формируем под конкретный проект.'}),
    'contacts': dict(title='Контакты: часы, встреча, география', path='/kontakty', fields=[
        field('hours', 'Часы работы и часовой пояс'),
        field('address', 'Адрес для встречи — если принимаете клиентов'),
        field('meeting', 'Как договориться о встрече'),
        field('geo_title', 'Заголовок географии'),
        field('geography', 'География и условия выезда', 'textarea', 2000)], defaults={
            'meeting': 'Встречи и выезды согласуются заранее.', 'geo_title': 'Юг России и Московский регион',
            'geography': 'Ставропольский край, Краснодар и Краснодарский край, Ростов-на-Дону и Ростовская область, Москва и Московская область. Укажите населённый пункт и объём задачи: выезд, доставку и условия работы согласуем при расчёте.'}),
    'enquiry': dict(title='Заявка: кто ответит и что будет дальше', path='/request', fields=[
        field('responsible', 'Кто свяжется: имя или должность'),
        field('response_time', 'Реальный срок ответа с учётом рабочих дней'),
        field('next_step', 'Что получит клиент после обращения', 'textarea', 1500)], defaults={
            'next_step': 'Изучим задачу, уточним исходные данные и состав работ. После уточнения обсудим порядок расчёта стоимости.'}),
}

KINDS = {
    'team': dict(title='Команда и ответственные специалисты', path='/o-kompanii', fields=[
        field('name', 'Имя'), field('role', 'Роль или должность'),
        field('body', 'Опыт и ответственность', 'textarea', 4000)]),
    'base': dict(title='Производство и база', path='/o-kompanii', fields=[
        field('name', 'Название'), field('location', 'Местоположение'),
        field('body', 'Что здесь выполняется', 'textarea', 4000)]),
    'review': dict(title='Отзывы с источником', path='/o-kompanii', fields=[
        field('name', 'Клиент или организация'), field('body', 'Текст отзыва', 'textarea', 6000),
        field('source_name', 'Источник: площадка или документ'),
        field('source_url', 'Ссылка на источник — если он опубликован', 'url', 1000),
        field('date', 'Дата отзыва', 'date')]),
    'estimate': dict(title='Примеры стоимости и сроков', path='', fields=[
        field('name', 'Название примера'), field('target', 'На какой странице показать', 'target'),
        field('scope', 'Назначение, размеры, объём и материалы', 'textarea', 4000),
        field('amount', 'Стоимость, валюта и НДС — если указываете цену'),
        field('date', 'Дата оценки или выполненных работ', 'date'),
        field('includes', 'Что включено', 'textarea', 3000),
        field('excludes', 'Что не включено', 'textarea', 3000),
        field('delivery', 'Доставка и условия площадки', 'textarea', 3000),
        field('duration', 'Срок выполнения'),
        field('conditions', 'От чего зависели стоимость и сроки', 'textarea', 4000)]),
}


def encode(value):
    return json.dumps(value, ensure_ascii=False)


class OwnerContent:
    def __init__(self, app, db, catalog, data):
        self.app, self.db, self.catalog, self.folder = app, db, catalog, data / 'media'
        with app.app_context():
            db().executescript('''
                CREATE TABLE IF NOT EXISTS owner_sections(
                    key TEXT PRIMARY KEY, draft TEXT NOT NULL, published TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE IF NOT EXISTS owner_cards(
                    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, draft TEXT NOT NULL,
                    published TEXT, revision INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            ''')
            db().commit()

        @app.context_processor
        def owner_context():
            return dict(owner_sections={key: self.section(key) for key in SECTIONS},
                        owner_cards=self.cards, owner_media_cards=self.media_cards)

    def snapshot(self):
        if not hasattr(g, 'owner_content_snapshot'):
            g.owner_content_snapshot = dict(
                sections={r['key']: dict(r) for r in self.db().execute('SELECT * FROM owner_sections')},
                cards=[dict(r) for r in self.db().execute('SELECT * FROM owner_cards ORDER BY id')],
                photos={r['id']: dict(r) for r in self.db().execute('SELECT * FROM photos')})
        return g.owner_content_snapshot

    def defaults(self, key):
        return {f['key']: SECTIONS[key]['defaults'].get(f['key'], '') for f in SECTIONS[key]['fields']}

    def section(self, key, draft=False):
        preview = getattr(g, 'owner_section_preview', None)
        if not draft and preview and preview[0] == key:
            return preview[1]
        row = self.snapshot()['sections'].get(key)
        return json.loads(row['draft' if draft else 'published']) if row else self.defaults(key)

    def targets(self):
        return {'/' + item['slug']: item['name'] for item in self.catalog.all(published=True) + BUILDINGS}

    def pages(self):
        result = {'': 'Без ссылки', '/angary-i-sklady': 'Ангары и склады', '/produkciya': 'Галерея объектов',
                  '/uslugi': 'Услуги', '/request': 'Форма заявки', **self.targets()}
        result.update({'/obekty/' + row['slug']: row['title'] for row in self.db().execute(
            'SELECT slug,title FROM case_studies WHERE published=1')})
        return result

    def visible(self, row, value):
        return row['kind'] != 'estimate' or value.get('target') in self.targets()

    def decorate(self, row, value, preview=False):
        result = {**value, 'id': row['id'], 'kind': row['kind'], 'image': ''}
        photo = self.snapshot()['photos'].get(value.get('photo_id'))
        if photo:
            result.update(image=f"/admin/photos/{photo['id']}/image" if preview else '/media/' + photo['storage_name'],
                          width=photo['width'], height=photo['height'])
        return result

    def cards(self, kind, target=None):
        result = []
        for row in self.snapshot()['cards']:
            if row['kind'] != kind or not row['published']:
                continue
            value = json.loads(row['published'])
            if self.visible(row, value) and (target is None or value.get('target') == target):
                result.append(self.decorate(row, value))
        return sorted(result, key=lambda x: (x.get('position', 0), x['id']))

    def is_public(self, storage):
        photo = next((p for p in self.snapshot()['photos'].values() if p['storage_name'] == storage), None)
        return bool(photo and any(card.get('photo_id') == photo['id'] for kind in KINDS for card in self.cards(kind)))

    def photo_usage(self, photo):
        uses = []
        for row in self.snapshot()['cards']:
            draft = json.loads(row['draft'])
            public = json.loads(row['published']) if row['published'] else {}
            if photo['id'] not in (draft.get('photo_id'), public.get('photo_id')):
                continue
            links = []
            if public.get('photo_id') == photo['id'] and self.visible(row, public):
                links.append((public.get('target') or KINDS[row['kind']]['path'], public['name']))
            uses.append(('owner:' + str(row['id']), draft.get('name') or KINDS[row['kind']]['title'], links))
        return uses

    def media_cards(self):
        return [{**row, 'value': json.loads(row['draft']), 'label': KINDS[row['kind']]['title']}
                for row in self.snapshot()['cards']]

    def validate(self, spec, values):
        result = {}
        for f in spec['fields']:
            value = values.get(f['key'], '').strip()
            if len(value) > f['limit']:
                raise ValueError(f"«{f['label']}»: не более {f['limit']} символов.")
            if f['kind'] == 'url' and value:
                try:
                    parsed = urlsplit(value)
                    valid = parsed.scheme in ('https', 'http') and parsed.hostname and not parsed.username and not parsed.password
                except ValueError:
                    valid = False
                if not valid or any(c.isspace() or ord(c) < 32 for c in value) or '\\' in value:
                    raise ValueError('Для источника укажите полную ссылку https:// или http://.')
            if f['kind'] == 'date' and value:
                try:
                    value = date.fromisoformat(value).isoformat()
                except ValueError:
                    raise ValueError('Проверьте дату.') from None
            if f['kind'] == 'page' and value not in self.pages():
                raise ValueError('Выберите доступную страницу для ссылки.')
            if f['kind'] == 'target' and value and value not in self.targets():
                raise ValueError('Выберите опубликованный вид работ или здание.')
            result[f['key']] = value
        return result

    def register(self, protected, render):
        @self.app.get('/admin/content')
        @protected(admin=True)
        def content_admin():
            return render('content_admin.html', 'Содержание сайта — Металл-Каркас',
                          sections=SECTIONS, kinds=KINDS, content_rows=self.media_cards())

        @self.app.route('/admin/content/sections/<key>', methods=['GET', 'POST'])
        @protected(admin=True)
        def content_section(key):
            if key not in SECTIONS:
                abort(404)
            spec, error = SECTIONS[key], None
            row = self.snapshot()['sections'].get(key)
            revision = row['revision'] if row else 0
            values = self.section(key, draft=True)
            if request.method == 'POST':
                values = request.form
                try:
                    self.db().execute('BEGIN IMMEDIATE')
                    current = self.db().execute('SELECT revision FROM owner_sections WHERE key=?', (key,)).fetchone()
                    if request.form.get('revision') != str(current['revision'] if current else 0):
                        raise ValueError('Этот раздел уже изменён. Откройте его заново перед сохранением.')
                    action = request.form.get('action')
                    if action not in ('save', 'publish'):
                        raise ValueError('Выберите действие.')
                    value = self.validate(spec, values)
                    published = encode(value) if action == 'publish' else (row['published'] if row else encode(self.defaults(key)))
                    self.db().execute('''INSERT INTO owner_sections(key,draft,published,revision) VALUES(?,?,?,1)
                        ON CONFLICT(key) DO UPDATE SET draft=excluded.draft,published=excluded.published,
                        revision=owner_sections.revision+1,updated_at=CURRENT_TIMESTAMP''', (key, encode(value), published))
                    self.db().commit()
                    flash('Раздел опубликован.' if action == 'publish' else 'Черновик сохранён. Публичная страница не изменена.')
                    return redirect(request.path)
                except ValueError as exc:
                    self.db().rollback()
                    error = str(exc)
            return render('content_editor.html', spec['title'] + ' — Металл-Каркас', spec=spec, values=values,
                          error=error, revision=revision, is_card=False, pages=self.pages(), targets=self.targets(),
                          published=bool(row), preview_url=request.path + '/preview'), 422 if error else 200

        @self.app.get('/admin/content/sections/<key>/preview')
        @protected(admin=True)
        def content_section_preview(key):
            if key not in SECTIONS:
                abort(404)
            g.owner_section_preview = (key, self.section(key, draft=True))
            # Use the real page template with a request-local draft override.
            endpoint, args = self.app.url_map.bind('').match(SECTIONS[key]['path'], method='GET')
            return self.app.view_functions[endpoint](**args)

        @self.app.post('/admin/content/cards/new/<kind>')
        @protected(admin=True)
        def content_card_new(kind):
            if kind not in KINDS:
                abort(404)
            cursor = self.db().execute('INSERT INTO owner_cards(kind,draft) VALUES(?,?)', (kind, '{}'))
            self.db().commit()
            return redirect('/admin/content/cards/' + str(cursor.lastrowid))

        @self.app.route('/admin/content/cards/<int:card_id>', methods=['GET', 'POST'])
        @protected(admin=True)
        def content_card(card_id):
            row = self.db().execute('SELECT * FROM owner_cards WHERE id=?', (card_id,)).fetchone()
            if not row:
                abort(404)
            spec, error, written = KINDS[row['kind']], None, None
            values = json.loads(row['draft'])
            if request.method == 'POST':
                values = request.form
                try:
                    self.db().execute('BEGIN IMMEDIATE')
                    current = self.db().execute('SELECT revision FROM owner_cards WHERE id=?', (card_id,)).fetchone()
                    if values.get('revision') != str(current['revision']):
                        raise ValueError('Карточка уже изменена. Откройте её заново перед сохранением.')
                    action = values.get('action')
                    if action == 'unpublish':
                        self.db().execute('UPDATE owner_cards SET published=NULL,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?', (card_id,))
                    else:
                        if action not in ('save', 'publish'):
                            raise ValueError('Выберите действие.')
                        value = self.validate(spec, values)
                        position = values.get('position', '0').strip() or '0'
                        if not position.isdigit() or len(position) > 6:
                            raise ValueError('Порядок — целое число от 0 до 999999.')
                        value['position'] = int(position)
                        value['alt'] = values.get('alt', '').strip()
                        if len(value['alt']) > 300:
                            raise ValueError('Описание фотографии — до 300 символов.')
                        chosen = values.get('photo_id', '')
                        value['photo_id'] = int(chosen) if str(chosen).isdigit() else None
                        if chosen and not self.db().execute('SELECT 1 FROM photos WHERE id=?', (value['photo_id'],)).fetchone():
                            raise ValueError('Выберите фотографию из библиотеки.')
                        if action == 'publish':
                            required = ['name'] + (['scope', 'target', 'date', 'includes', 'excludes', 'delivery', 'conditions'] if row['kind'] == 'estimate' else ['body'])
                            if row['kind'] == 'review':
                                required.append('source_name')
                            if row['kind'] == 'team':
                                required.append('role')
                            missing = [f['label'] for f in spec['fields'] if f['key'] in required and not value[f['key']]]
                            if missing:
                                raise ValueError('Для публикации заполните: ' + '; '.join(missing) + '.')
                            if row['kind'] == 'estimate' and not (value['amount'] or value['duration']):
                                raise ValueError('Укажите стоимость или срок выполнения примера.')
                        upload = request.files.get('photo')
                        if upload and upload.filename:
                            payload, width, height = convert_photo(upload.read(10 * 1024 * 1024 + 1))
                            storage = secrets.token_hex(24) + '.webp'
                            written = self.folder / storage
                            written.write_bytes(payload)
                            cursor = self.db().execute('INSERT INTO photos(storage_name,title,width,height) VALUES(?,?,?,?)',
                                (storage, (value.get('name') or spec['title'])[:160], width, height))
                            value['photo_id'] = cursor.lastrowid
                        self.db().execute('UPDATE owner_cards SET draft=?,published=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',
                            (encode(value), encode(value) if action == 'publish' else row['published'], card_id))
                    self.db().commit()
                    flash({'save': 'Черновик сохранён. Публичная карточка не изменена.', 'publish': 'Карточка опубликована.',
                           'unpublish': 'Карточка снята с публикации; черновик сохранён.'}[action])
                    return redirect(request.path)
                except ValueError as exc:
                    self.db().rollback()
                    if written:
                        written.unlink(missing_ok=True)
                    error = str(exc)
                except Exception:
                    self.db().rollback()
                    if written:
                        written.unlink(missing_ok=True)
                    raise
            return render('content_editor.html', spec['title'] + ' — Металл-Каркас', spec=spec, values=values,
                          error=error, revision=row['revision'], is_card=True, pages=self.pages(), targets=self.targets(),
                          photos=list(self.snapshot()['photos'].values()), published=bool(row['published']),
                          preview_url=request.path + '/preview'), 422 if error else 200

        @self.app.get('/admin/content/cards/<int:card_id>/preview')
        @protected(admin=True)
        def content_card_preview(card_id):
            row = self.db().execute('SELECT * FROM owner_cards WHERE id=?', (card_id,)).fetchone()
            if not row:
                abort(404)
            return render('content_preview.html', 'Предпросмотр карточки — Металл-Каркас',
                          cards=[self.decorate(row, json.loads(row['draft']), preview=True)])
