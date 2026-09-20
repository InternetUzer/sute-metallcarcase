"""Owner-managed project stories, process stages and explicitly public files."""
import re
import secrets
import sqlite3
from pathlib import Path

from flask import abort, flash, g, redirect, request, send_file, url_for
from photo_library import convert_photo

CATEGORIES = {'buildings': 'Здания', 'metal': 'Металлоконструкции', 'concrete': 'Бетон и монолит',
              'panels': 'Сэндвич-панели', 'roofing': 'Кровля', 'construction': 'Другие работы'}
STATES = ['Запланирован', 'В работе', 'Выполнен']


class CaseStudies:
    def __init__(self, app, db, protected, render, data):
        self.db, self.folder = db, data / 'case-files'
        self.folder.mkdir(exist_ok=True)
        with app.app_context():
            db().executescript('''
                CREATE TABLE IF NOT EXISTS case_studies(
                    id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
                    summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '',
                    category TEXT NOT NULL DEFAULT 'construction', location TEXT NOT NULL DEFAULT '',
                    scope TEXT NOT NULL DEFAULT '', period TEXT NOT NULL DEFAULT '', cover_id INTEGER,
                    published INTEGER NOT NULL DEFAULT 0, published_at TEXT,
                    revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE IF NOT EXISTS case_stages(
                    id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES case_studies(id),
                    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', period TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'В работе', position INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS case_files(
                    id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES case_studies(id),
                    stage_id INTEGER REFERENCES case_stages(id) ON DELETE SET NULL,
                    storage TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
                    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', alt TEXT NOT NULL DEFAULT '',
                    public INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
                    width INTEGER, height INTEGER, size INTEGER NOT NULL);
                CREATE INDEX IF NOT EXISTS case_files_case ON case_files(case_id,stage_id);
                CREATE INDEX IF NOT EXISTS case_stages_case ON case_stages(case_id,position);
            ''')
            db().commit()

        @app.context_processor
        def case_context():
            groups = []
            if request.endpoint == 'photos':
                groups = self.db().execute('''SELECT c.id,c.title,c.published,count(f.id) count
                    FROM case_studies c JOIN case_files f ON f.case_id=c.id AND f.kind='photo'
                    GROUP BY c.id ORDER BY c.id DESC''').fetchall()
            return dict(case_categories=CATEGORIES, case_photo_groups=groups)

        @app.route('/admin/cases', methods=['GET', 'POST'])
        @protected(admin=True)
        def cases_admin():
            error = None
            if request.method == 'POST':
                title = request.form.get('title', '').strip()
                if not title or len(title) > 180:
                    error = 'Укажите название объекта длиной до 180 символов.'
                else:
                    cursor = db().execute('INSERT INTO case_studies(slug,title) VALUES(?,?)', ('object-' + secrets.token_hex(5), title))
                    db().commit()
                    return redirect(url_for('case_editor', case_id=cursor.lastrowid))
            cases = db().execute('''SELECT c.*, (SELECT count(*) FROM case_stages s WHERE s.case_id=c.id) stage_count,
                (SELECT count(*) FROM case_files f WHERE f.case_id=c.id) file_count FROM case_studies c ORDER BY c.id DESC''').fetchall()
            return render('cases_admin.html', 'Объекты и этапы работ — Металл-Каркас', cases=cases, error=error), 422 if error else 200

        @app.route('/admin/cases/<int:case_id>', methods=['GET', 'POST'])
        @protected(admin=True)
        def case_editor(case_id):
            case = self.get(case_id)
            error, written, removed = None, [], []
            form_case = None
            if request.method == 'POST':
                form, action = request.form, request.form.get('action', '')
                try:
                    # Serialize edits and reject stale forms before touching files or rows.
                    db().execute('BEGIN IMMEDIATE')
                    case = self.get(case_id)
                    if form.get('revision') != str(case['revision']):
                        raise ValueError('Объект уже изменён в другой вкладке. Обновите страницу перед сохранением.')
                    if action in ('save', 'publish'):
                        values = {key: form.get(key, '').strip() for key in ('title','summary','body','result','category','location','scope','period','slug')}
                        form_case = {**case, **values}
                        limits = dict(title=180, summary=600, body=12000, result=6000, location=160, scope=1000, period=160)
                        for key, limit in limits.items():
                            if len(values[key]) > limit:
                                raise ValueError(f'Слишком длинное поле: допустимо до {limit} символов.')
                        if not values['title']:
                            raise ValueError('Укажите название объекта.')
                        if values['category'] not in CATEGORIES:
                            raise ValueError('Выберите направление работ.')
                        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', values['slug']) or len(values['slug']) > 100:
                            raise ValueError('Адрес: латинские буквы в нижнем регистре, цифры и дефисы, до 100 символов.')
                        if case['published_at'] and values['slug'] != case['slug']:
                            raise ValueError('После первой публикации адрес объекта сохраняется, чтобы не ломать ссылки.')
                        cover_id = form.get('cover_id') or None
                        cover = db().execute("SELECT * FROM case_files WHERE id=? AND case_id=? AND kind='photo' AND public=1", (cover_id, case_id)).fetchone() if cover_id else None
                        if cover_id and not cover:
                            raise ValueError('Выберите общедоступную фотографию этого объекта для обложки.')
                        if (action == 'publish' or case['published']) and (not values['summary'] or not values['body'] or not cover):
                            raise ValueError('Для публикации нужны краткое описание, задача / состав работ и обложка. Сначала сохраните черновик и загрузите фотографии.')
                        db().execute('''UPDATE case_studies SET title=?,summary=?,body=?,result=?,category=?,location=?,scope=?,period=?,slug=?,cover_id=? WHERE id=?''',
                            (*values.values(), cover_id, case_id))
                        if action == 'publish':
                            db().execute('UPDATE case_studies SET published=1,published_at=COALESCE(published_at,CURRENT_TIMESTAMP) WHERE id=?', (case_id,))
                    elif action == 'unpublish':
                        db().execute('UPDATE case_studies SET published=0 WHERE id=?', (case_id,))
                    elif action in ('stage_save', 'stage_delete'):
                        stage_id = form.get('stage_id') or None
                        if stage_id and not db().execute('SELECT 1 FROM case_stages WHERE id=? AND case_id=?', (stage_id, case_id)).fetchone():
                            abort(404)
                        if action == 'stage_delete':
                            db().execute('DELETE FROM case_stages WHERE id=? AND case_id=?', (stage_id, case_id))
                        else:
                            title = form.get('stage_title', '').strip()
                            description = form.get('stage_description', '').strip()
                            period = form.get('stage_period', '').strip()
                            status = form.get('stage_status', '')
                            if not title or len(title) > 180 or len(description) > 6000 or len(period) > 160 or status not in STATES:
                                raise ValueError('Укажите название этапа, статус и описание до 6000 символов.')
                            position = self.position(form.get('position', '0'))
                            if stage_id:
                                db().execute('UPDATE case_stages SET title=?,description=?,period=?,status=?,position=? WHERE id=? AND case_id=?',
                                    (title, description, period, status, position, stage_id, case_id))
                            else:
                                db().execute('INSERT INTO case_stages(case_id,title,description,period,status,position) VALUES(?,?,?,?,?,?)',
                                    (case_id, title, description, period, status, position))
                    elif action == 'upload':
                        stage_id = form.get('stage_id') or None
                        if stage_id and not db().execute('SELECT 1 FROM case_stages WHERE id=? AND case_id=?', (stage_id, case_id)).fetchone():
                            raise ValueError('Выберите этап этого объекта.')
                        kind = form.get('kind')
                        if kind not in ('photo', 'document'):
                            raise ValueError('Выберите фотографии или документы.')
                        uploads = [f for f in request.files.getlist('files') if f.filename]
                        if not 1 <= len(uploads) <= 3:
                            raise ValueError('Выберите от одного до трёх файлов.')
                        prepared = []
                        for upload in uploads:
                            name = upload.filename.replace('\\', '/').rsplit('/', 1)[-1][:160]
                            payload = upload.read(10 * 1024 * 1024 + 1)
                            ext, width, height = Path(name).suffix.lower(), None, None
                            if kind == 'photo':
                                payload, width, height = convert_photo(payload)
                                ext = '.webp'
                            elif ext not in ('.pdf', '.docx', '.xlsx', '.dwg', '.dxf', '.zip') or not payload or len(payload) > 10 * 1024 * 1024:
                                raise ValueError('Документы: PDF, DOCX, XLSX, DWG, DXF или ZIP до 10 МБ.')
                            storage = secrets.token_hex(24) + ext
                            prepared.append((name, storage, payload, width, height))
                        for name, storage, payload, width, height in prepared:
                            target = self.folder / storage
                            written.append(target)
                            target.write_bytes(payload)
                            db().execute('''INSERT INTO case_files(case_id,stage_id,storage,name,kind,title,public,width,height,size)
                                VALUES(?,?,?,?,?,?,?,?,?,?)''',
                                (case_id, stage_id, storage, name, kind, Path(name).stem[:180], int(kind == 'photo'), width, height, len(payload)))
                    elif action in ('file_save', 'file_delete'):
                        file_id = form.get('file_id')
                        item = db().execute('SELECT * FROM case_files WHERE id=? AND case_id=?', (file_id, case_id)).fetchone()
                        if not item:
                            abort(404)
                        if action == 'file_delete':
                            if case['cover_id'] == item['id']:
                                raise ValueError('Сначала выберите другую обложку и сохраните объект.')
                            db().execute('DELETE FROM case_files WHERE id=?', (item['id'],))
                            removed.append(self.folder / item['storage'])
                        else:
                            title, alt, description = (form.get(key, '').strip() for key in ('file_title', 'alt', 'file_description'))
                            public = int(form.get('public') == '1')
                            stage_id = form.get('stage_id') or None
                            if not title or len(title) > 180 or len(alt) > 300 or len(description) > 2000:
                                raise ValueError('Укажите название до 180 символов, ALT до 300 и описание до 2000.')
                            if case['cover_id'] == item['id'] and not public:
                                raise ValueError('Обложка должна быть доступна посетителям.')
                            if stage_id and not db().execute('SELECT 1 FROM case_stages WHERE id=? AND case_id=?', (stage_id, case_id)).fetchone():
                                raise ValueError('Выберите этап этого объекта.')
                            db().execute('UPDATE case_files SET title=?,alt=?,description=?,public=?,stage_id=?,position=? WHERE id=?',
                                (title, alt, description, public, stage_id, self.position(form.get('position', '0')), item['id']))
                    else:
                        abort(400)
                    db().execute('UPDATE case_studies SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?', (case_id,))
                    db().commit()
                    for target in removed:
                        target.unlink(missing_ok=True)
                    flash('Объект опубликован.' if action == 'publish' else 'Изменения сохранены.')
                    anchor = 'stages' if action.startswith('stage') else 'materials' if action.startswith('file') or action == 'upload' else ''
                    return redirect(url_for('case_editor', case_id=case_id, _anchor=anchor))
                except (ValueError, sqlite3.IntegrityError) as exc:
                    db().rollback()
                    for target in written:
                        target.unlink(missing_ok=True)
                    error = str(exc) if isinstance(exc, ValueError) else 'Этот адрес уже занят. Выберите другой адрес объекта.'
                except Exception:
                    db().rollback()
                    for target in written:
                        target.unlink(missing_ok=True)
                    raise
            stages, files = self.materials(case_id)
            return render('case_editor.html', 'Редактор объекта — Металл-Каркас',
                case=form_case or self.get(case_id), stages=stages, case_files=files,
                stage_states=STATES, error=error), 422 if error else 200

        @app.get('/admin/cases/<int:case_id>/preview')
        @protected(admin=True)
        def case_preview(case_id):
            case = self.get(case_id)
            stages, files = self.materials(case_id, public=True)
            return render('case_detail.html', case['title'] + ' — Металл-Каркас', case['summary'],
                          case=case, stages=stages, case_files=files, preview=True)

        @app.get('/obekty/<slug>')
        def case_public(slug):
            case = db().execute('SELECT * FROM case_studies WHERE slug=? AND published=1', (slug,)).fetchone()
            if not case:
                abort(404)
            stages, files = self.materials(case['id'], public=True)
            return render('case_detail.html', case['title'] + ' — Металл-Каркас', case['summary'],
                          case=case, stages=stages, case_files=files, preview=False)

        @app.get('/case-files/<int:file_id>')
        def case_file(file_id):
            item = db().execute('''SELECT f.*,c.published FROM case_files f JOIN case_studies c ON c.id=f.case_id WHERE f.id=?''', (file_id,)).fetchone()
            if not item or not (item['published'] and item['public'] or g.user and g.user['role'] == 'admin'):
                abort(404)
            target = self.folder / item['storage']
            if not target.is_file():
                abort(404)
            response = send_file(target, mimetype='image/webp' if item['kind'] == 'photo' else 'application/octet-stream',
                                 as_attachment=item['kind'] != 'photo', download_name=item['name'])
            response.headers['Cache-Control'] = 'no-store'
            response.headers['X-Robots-Tag'] = 'noindex, nofollow'
            return response

    def get(self, case_id):
        row = self.db().execute('SELECT * FROM case_studies WHERE id=?', (case_id,)).fetchone()
        if not row:
            abort(404)
        return dict(row)

    @staticmethod
    def position(value):
        if not re.fullmatch(r'[0-9]{1,4}', value):
            raise ValueError('Порядок — целое число от 0 до 9999.')
        return int(value)

    def materials(self, case_id, public=False):
        stages = [dict(r) for r in self.db().execute('SELECT * FROM case_stages WHERE case_id=? ORDER BY position,id', (case_id,))]
        files = [dict(r) for r in self.db().execute('SELECT * FROM case_files WHERE case_id=?' + (' AND public=1' if public else '') + ' ORDER BY position,id', (case_id,))]
        return stages, files

    def gallery(self):
        return [dict(id='case-' + str(r['id']), title=r['title'], description=r['summary'],
                     location=r['location'], category=r['category'], image='/case-files/' + str(r['cover_id']),
                     alt=r['title'], url='/obekty/' + r['slug'])
                for r in self.db().execute('SELECT * FROM case_studies WHERE published=1 ORDER BY published_at DESC,id DESC')]
