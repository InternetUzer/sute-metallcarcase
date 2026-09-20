"""Editable image placements; repository originals remain available for reset."""
import json
from pathlib import Path

from flask import abort, flash, g, redirect, request, url_for
from content import SERVICES, BUILDINGS, MODELS

LABELS = {'hero': 'Главный экран', 'hangar': 'Ангар', 'warehouse': 'Склад',
          'fabrication': 'Изготовление металлоконструкций', 'assembly': 'Монтаж каркаса',
          'concrete': 'Бетонные работы', 'panels': 'Сэндвич-панели', 'frame': 'Каркас',
          'drawing': 'Чертёж', 'storage': 'Системы хранения', 'agriculture': 'Сельхозздание',
          'modular': 'Модульное здание', **{m['image']: m['name'] for m in MODELS}}


class MediaCatalog:
    def __init__(self, app, db, root):
        self.db, self.root = db, root
        with app.app_context():
            db().executescript('''
                CREATE TABLE IF NOT EXISTS media_edits(
                    slot TEXT PRIMARY KEY, title TEXT NOT NULL, alt TEXT NOT NULL,
                    description TEXT NOT NULL, photo_id INTEGER REFERENCES photos(id),
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE IF NOT EXISTS photo_text(
                    photo_id INTEGER PRIMARY KEY REFERENCES photos(id), alt TEXT NOT NULL,
                    description TEXT NOT NULL);
            ''')
            db().commit()

    def snapshot(self):
        if not hasattr(g, 'media_snapshot'):
            g.media_snapshot = {
                'originals': json.loads((self.root / 'content/assets.json').read_text()),
                'archived': json.loads((self.root / 'content/gallery.json').read_text()),
                'curated': [dict(r) for r in self.db().execute('SELECT * FROM showcases ORDER BY id DESC')],
                'photos': [dict(r) for r in self.db().execute('SELECT p.*,t.alt,t.description FROM photos p LEFT JOIN photo_text t ON t.photo_id=p.id ORDER BY p.id DESC')],
                'edits': {r['slot']: dict(r) for r in self.db().execute('SELECT * FROM media_edits')},
                'case_count': self.db().execute('SELECT count(*) FROM case_studies WHERE published=1').fetchone()[0],
            }
        return g.media_snapshot

    def originals(self):
        return self.snapshot()['originals']

    def photos(self):
        return self.snapshot()['photos']

    def photo(self, photo_id):
        return next((p for p in self.photos() if p['id'] == photo_id), None)

    def edit(self, slot):
        return self.snapshot()['edits'].get(slot)

    def resolve(self, slot, base):
        item = dict(base)
        edit = self.edit(slot)
        item.update(slot=slot, photo_id=None, modified=bool(edit))
        if edit:
            item.update(edit)
            if edit['photo_id']:
                photo = self.photo(edit['photo_id'])
                item.update(src='/media/' + photo['storage_name'], small='', width=photo['width'], height=photo['height'], alt=edit['alt'] or photo['alt'] or '')
        photo = next((p for p in self.photos() if '/media/' + p['storage_name'] == item['src']), None)
        item['preview_src'] = '/admin/photos/' + str(photo['id']) + '/image' if photo else item['src']
        return item

    def assets(self):
        return {key: self.resolve('asset:' + key, {**asset, 'title': LABELS.get(key, key),
                'alt': '', 'description': ''}) for key, asset in self.originals().items()}

    def gallery(self, include_unpublished=False):
        curated = [r for r in self.snapshot()['curated'] if r['published'] or include_unpublished]
        archived = self.snapshot()['archived']
        assets = self.assets()
        original_by_src = {a['src']: k for k, a in self.originals().items()}
        result = []
        for source in curated + archived:
            kind = 'showcase' if isinstance(source['id'], int) else 'gallery'
            slot = kind + ':' + str(source['id'])
            base = {**source, 'source_image': source['image'], 'src': source['image'], 'alt': source['title'], 'published': source.get('published', 1)}
            if source['image'] in original_by_src:
                asset = assets[original_by_src[source['image']]]
                base.update(src=asset['src'], alt=asset['alt'] or source['title'])
            else:
                photo = next((p for p in self.photos() if '/media/' + p['storage_name'] == source['image']), None)
                if photo:
                    base['alt'] = photo['alt'] or photo['title']
            item = self.resolve(slot, base)
            item['image'] = item['src']
            item['alt'] = item['alt'] or item['title']
            result.append(item)
        return result

    def asset_usage(self, key):
        usage = []
        if key == 'hero': usage.append(('/', 'Главная · первый экран'))
        for item in SERVICES:
            if item['image'] == key:
                usage += [('/', 'Главная · услуги'), ('/uslugi', 'Список услуг'), ('/' + item['slug'], item['name'])]
        for item in BUILDINGS:
            if item['image'] == key:
                usage += [('/', 'Главная · здания'), ('/angary-i-sklady', 'Ангары и склады'), ('/' + item['slug'], item['name'])]
        if key == 'fabrication': usage.append(('/o-kompanii', 'О компании'))
        if key == 'warehouse': usage += [('/login', 'Вход и восстановление пароля')]
        if key.startswith('model-'):
            usage.append(('/prays-list', '3D-модели · превью'))
            if key == 'model-arch': usage.append(('/', 'Главная · блок 3D'))
        original = self.originals()[key]['src']
        # Only inherited placements follow an asset; independently replaced gallery cards do not.
        for item in self.gallery():
            source_slot = item['slot']
            override = self.edit(source_slot)
            if item['source_image'] == original and not (override and override['photo_id']):
                if item['published']:
                    usage.append(('/produkciya#' + str(item['id']), 'Галерея · ' + item['title']))
                    if item in self.home_gallery(): usage.append(('/', 'Главная · ' + item['title']))
        return list(dict.fromkeys(usage))

    def usage(self, slot):
        kind, key = slot.split(':', 1)
        if kind == 'asset': return self.asset_usage(key)
        item = next((r for r in self.gallery(True) if r['slot'] == slot), None)
        if not item or not item['published']: return []
        links = [('/produkciya#' + str(item['id']), 'Галерея · ' + item['title'])]
        if any(r['slot'] == slot for r in self.home_gallery()): links.append(('/', 'Главная · последние объекты'))
        return links

    def home_gallery(self):
        return self.gallery()[:max(0, 3 - self.snapshot()['case_count'])]

    def slots(self):
        return list(self.assets().values()) + self.gallery(True)

    def slot(self, slot):
        return next((s for s in self.slots() if s['slot'] == slot), None)

    def photo_usage(self, photo):
        src = '/media/' + photo['storage_name']
        return [(s['slot'], s['title'], self.usage(s['slot'])) for s in self.slots() if s['src'] == src]

    def is_public(self, storage):
        src = '/media/' + storage
        return any(a['src'] == src and self.asset_usage(key) for key, a in self.assets().items()) or any(g['image'] == src for g in self.gallery())

    def tree(self):
        assets = self.assets()
        groups = [('Главная и общие фотографии', [k for k in assets if not k.startswith('model-')]),
                  ('Превью 3D-моделей', [k for k in assets if k.startswith('model-')])]
        result = []
        for name, keys in groups:
            result.append((name, [{**assets[k], 'usage': self.asset_usage(k)} for k in keys]))
        result.append(('Галерея и публикации', [{**g, 'usage': self.usage(g['slot'])} for g in self.gallery(True)]))
        return result

    def register(self, app, protected, render, data, convert_photo):
        @app.route('/admin/photos/edit/<kind>/<key>', methods=['GET', 'POST'])
        @protected(admin=True)
        def photo_edit(kind, key):
            slot = kind + ':' + key
            photo = self.photo(int(key)) if kind == 'photo' and key.isdigit() else None
            item = {**photo, 'src': '/media/' + photo['storage_name'], 'alt': photo['alt'] or photo['title'],
                    'description': photo['description'] or ''} if photo else self.slot(slot)
            if not item or kind not in ('photo', 'asset', 'gallery', 'showcase'): abort(404)
            error, target = None, None
            if request.method == 'POST':
                try:
                    if request.form.get('action') == 'reset' and kind != 'photo':
                        self.db().execute('DELETE FROM media_edits WHERE slot=?', (slot,))
                        self.db().commit()
                        flash('Исходная фотография и подписи восстановлены.')
                        return redirect(url_for('photos'))
                    title = request.form.get('title', '').strip()
                    alt = request.form.get('alt', '').strip()
                    description = request.form.get('description', '').strip()
                    if not title or len(title) > 160 or len(alt) > 300 or len(description) > 3000:
                        raise ValueError('Укажите название до 160 символов, ALT до 300 и описание до 3000.')
                    chosen = request.form.get('photo_id', '')
                    chosen_id = int(chosen) if chosen.isdigit() else None
                    if chosen and (not chosen_id or not self.photo(chosen_id)):
                        raise ValueError('Выберите фотографию из библиотеки.')
                    upload = request.files.get('photo')
                    if upload and upload.filename:
                        payload, width, height = convert_photo(upload.read(10 * 1024 * 1024 + 1))
                        import secrets
                        storage = secrets.token_hex(24) + '.webp'
                        target = data / 'media' / storage
                        target.write_bytes(payload)
                        if kind == 'photo':
                            self.db().execute('UPDATE photos SET storage_name=?,width=?,height=? WHERE id=?', (storage, width, height, photo['id']))
                            self.db().execute('UPDATE showcases SET image=? WHERE image=?', ('/media/' + storage, item['src']))
                        else:
                            chosen_id = self.db().execute('INSERT INTO photos(storage_name,title,width,height) VALUES(?,?,?,?)', (storage, title, width, height)).lastrowid
                    if kind == 'photo':
                        self.db().execute('UPDATE photos SET title=? WHERE id=?', (title, photo['id']))
                        self.db().execute('INSERT INTO photo_text VALUES(?,?,?) ON CONFLICT(photo_id) DO UPDATE SET alt=excluded.alt,description=excluded.description', (photo['id'], alt, description))
                    else:
                        self.db().execute('''INSERT INTO media_edits(slot,title,alt,description,photo_id) VALUES(?,?,?,?,?)
                            ON CONFLICT(slot) DO UPDATE SET title=excluded.title,alt=excluded.alt,
                            description=excluded.description,photo_id=excluded.photo_id,updated_at=CURRENT_TIMESTAMP''',
                            (slot, title, alt, description, chosen_id))
                    self.db().commit()
                    flash('Фотография и подписи сохранены.')
                    return redirect(url_for('photos'))
                except ValueError as exc:
                    self.db().rollback()
                    if target: target.unlink(missing_ok=True)
                    error = str(exc)
                except Exception:
                    self.db().rollback()
                    if target: target.unlink(missing_ok=True)
                    raise
            uses = self.photo_usage(photo) if photo else [(slot, item['title'], self.usage(slot))]
            return render('photo_edit.html', 'Редактирование фотографии — Металл-Каркас',
                          item=item, kind=kind, photos=self.photos(), uses=uses, error=error), 422 if error else 200
