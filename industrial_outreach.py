"""Закрытый раздел коммерческих выездов по промпаркам.

Самостоятельная подсистема на существующих users/session/CSRF и SQLite.
Не затрагивает проекты клиентов, документы и «Прораб+».
"""
from datetime import date
import json
import math
import re
import secrets
import sqlite3
import click

from flask import abort, flash, g, jsonify, redirect, request, url_for
from werkzeug.security import generate_password_hash
from yandex_park_routes import park_yandex_links

ZONES = ('СЕВЕР / ЗАПАД', 'ВОСТОК / СЕВЕРО-ВОСТОК', 'ЮГ / ЮГО-ЗАПАД')
STATUSES = ('Не посещён', 'Запланирован', 'Выезд выполнен', 'Контакт найден',
            'Переговоры', 'Запрошен расчёт', 'КП отправлено', 'Повторный визит',
            'Нет перспективы')


def register(app, db, protected, render, issue_token):
    """Зарегистрировать внутренние страницы. db/protected/render — из app.py."""
    app.add_template_filter(park_yandex_links, "park_yandex_links")
    with app.app_context():
        db().executescript("""
        CREATE TABLE IF NOT EXISTS sales_parks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            zone TEXT NOT NULL CHECK (zone IN
                ('СЕВЕР / ЗАПАД', 'ВОСТОК / СЕВЕРО-ВОСТОК', 'ЮГ / ЮГО-ЗАПАД')),
            category TEXT NOT NULL DEFAULT '',
            stage TEXT NOT NULL DEFAULT '',
            area_ha REAL,
            buildings_m2 REAL,
            lat REAL,
            lon REAL,
            radius_km REAL,
            radius_flag TEXT NOT NULL DEFAULT '',
            focus_rank TEXT NOT NULL DEFAULT 'C — вторичный обход',
            target_fit TEXT NOT NULL DEFAULT '',
            operator TEXT NOT NULL DEFAULT '',
            operator_phone TEXT NOT NULL DEFAULT '',
            source_url TEXT NOT NULL DEFAULT '',
            accuracy TEXT NOT NULL DEFAULT '',
            public_note TEXT NOT NULL DEFAULT '',
            visit_status TEXT NOT NULL DEFAULT 'Не посещён',
            next_action TEXT NOT NULL DEFAULT '',
            next_date TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sales_staff_zones (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            zone TEXT NOT NULL CHECK (zone IN
                ('СЕВЕР / ЗАПАД', 'ВОСТОК / СЕВЕРО-ВОСТОК', 'ЮГ / ЮГО-ЗАПАД'))
        );
        CREATE TABLE IF NOT EXISTS sales_contacts (
            id INTEGER PRIMARY KEY,
            park_id TEXT NOT NULL REFERENCES sales_parks(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            phone TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT '',
            organization TEXT NOT NULL DEFAULT '',
            is_owner INTEGER NOT NULL DEFAULT 0 CHECK(is_owner IN (0,1)),
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sales_visits (
            id INTEGER PRIMARY KEY,
            park_id TEXT NOT NULL REFERENCES sales_parks(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            visit_date TEXT NOT NULL,
            status TEXT NOT NULL,
            owner_name TEXT NOT NULL DEFAULT '',
            cadastral_number TEXT NOT NULL DEFAULT '',
            building_type TEXT NOT NULL DEFAULT '',
            building_m2 REAL,
            project_stage TEXT NOT NULL DEFAULT '',
            contractor TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            next_action TEXT NOT NULL DEFAULT '',
            next_date TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_sales_parks_zone ON sales_parks(zone);
        CREATE INDEX IF NOT EXISTS idx_sales_contacts_park ON sales_contacts(park_id);
        CREATE INDEX IF NOT EXISTS idx_sales_visits_park ON sales_visits(park_id);
        """)
        db().commit()

    def text_field(field, length):
        return request.form.get(field, '').strip()[:length]

    def employee():
        if g.user['role'] not in ('field', 'admin'):
            abort(403)
        return g.user

    def user_zone():
        row = db().execute('SELECT zone FROM sales_staff_zones WHERE user_id=?',
                           (g.user['id'],)).fetchone()
        return row['zone'] if row else None

    def park_for_user(park_id):
        employee()
        park = db().execute('SELECT * FROM sales_parks WHERE id=?', (park_id,)).fetchone()
        if park is None:
            abort(404)
        if g.user['role'] != 'admin' and park['zone'] != user_zone():
            abort(404)
        return park

    def numeric(value, maximum):
        if value is None or value == '':
            return None
        if isinstance(value, bool):
            raise ValueError('Ожидается число, а не логическое значение')
        result = float(value)
        if not math.isfinite(result) or result < 0 or result > maximum:
            raise ValueError('Некорректное числовое значение')
        return result

    def valid_date(value):
        if not value:
            return ''
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError:
            raise ValueError('Дата должна быть в формате ГГГГ-ММ-ДД')

    def filtered_parks():
        """Use the same normalized, role-scoped selection for map and table."""
        employee()
        clauses, params = [], []
        zone = user_zone() if g.user['role'] == 'field' else request.args.get('zone', '')
        if g.user['role'] == 'field' and not zone:
            clauses.append('1=0')
        elif zone:
            if zone not in ZONES:
                abort(400)
            clauses.append('p.zone=?')
            params.append(zone)
        rank = request.args.get('rank', 'A')
        if rank in ('A', 'B', 'C', 'X', '?'):
            clauses.append('p.focus_rank LIKE ?')
            params.append(rank + '%')
        else:
            rank = ''
        query = request.args.get('q', '').strip()[:100]
        if query:
            # casefold also handles Cyrillic (SQLite LOWER/LIKE only fold ASCII).
            clauses.append('(instr(casefold(p.name), ?) OR '
                           'instr(casefold(p.address), ?) OR instr(casefold(p.id), ?))')
            params.extend([query.casefold()] * 3)
            db().create_function('casefold', 1, lambda value: value.casefold())
        where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
        parks = db().execute(
            'SELECT p.* FROM sales_parks p' + where +
            """ ORDER BY CASE
            WHEN p.focus_rank LIKE 'A%' THEN 0
            WHEN p.focus_rank LIKE 'B%' THEN 1
            WHEN p.focus_rank LIKE 'C%' THEN 2 ELSE 3 END,
            p.zone, p.name""", params).fetchall()
        return parks, zone, rank, query

    @app.get('/parks')
    @protected(roles=('admin', 'field'))
    def sales_parks_index():
        parks, zone, rank, query = filtered_parks()
        counts_where = ' WHERE zone=?' if g.user['role'] == 'field' and zone else (
            ' WHERE 1=0' if g.user['role'] == 'field' else '')
        counts_params = (zone,) if g.user['role'] == 'field' and zone else ()
        counts = db().execute(
            'SELECT COUNT(*) AS total, '
            "SUM(CASE WHEN visit_status!='Не посещён' THEN 1 ELSE 0 END) AS touched, "
            "SUM(CASE WHEN focus_rank LIKE 'A%' THEN 1 ELSE 0 END) AS priority "
            'FROM sales_parks' + counts_where, counts_params).fetchone()
        return render('parks_index.html', 'Объезд промпарков — Металл-Каркас',
                      parks=parks, zones=ZONES, statuses=STATUSES,
                      selected_zone=zone or '', selected_rank=rank, query=query,
                      map_url=url_for('sales_parks_map_data', zone=zone or '',
                                      rank=rank, q=query),
                      counts=counts, is_admin=g.user['role'] == 'admin')

    @app.get('/parks/map-data')
    @protected(roles=('admin', 'field'))
    def sales_parks_map_data():
        parks, _, _, _ = filtered_parks()
        fields = ('id', 'name', 'address', 'zone', 'category', 'focus_rank',
                  'lat', 'lon', 'radius_km', 'accuracy', 'visit_status')
        return jsonify([{**{key: p[key] for key in fields}, **park_yandex_links(p)}
                        for p in parks])

    @app.get('/parks/<park_id>')
    @protected(roles=('admin', 'field'))
    def sales_park_detail(park_id):
        park = park_for_user(park_id)
        contacts = db().execute(
            'SELECT c.*,u.name AS entered_by FROM sales_contacts c '
            'JOIN users u ON u.id=c.user_id WHERE c.park_id=? '
            'ORDER BY c.id DESC', (park_id,)).fetchall()
        visits = db().execute(
            'SELECT v.*,u.name AS entered_by FROM sales_visits v '
            'JOIN users u ON u.id=v.user_id WHERE v.park_id=? '
            'ORDER BY v.id DESC', (park_id,)).fetchall()
        return render('parks_detail.html', park['name'] + ' — Металл-Каркас',
                      park=park, contacts=contacts, visits=visits,
                      statuses=STATUSES, today=date.today().isoformat())

    @app.post('/parks/<park_id>/contacts')
    @protected(roles=('admin', 'field'))
    def sales_park_add_contact(park_id):
        park_for_user(park_id)
        name = text_field('name', 180)
        phone = text_field('phone', 60)
        if not name:
            abort(422, 'Введите имя контактного лица')
        db().execute(
            'INSERT INTO sales_contacts(park_id,user_id,name,phone,role,organization,is_owner,note)'
            ' VALUES(?,?,?,?,?,?,?,?)',
            (park_id, g.user['id'], name, phone, text_field('role', 120),
             text_field('organization', 200), int(request.form.get('is_owner') == 'on'),
             text_field('note', 3000)))
        db().commit()
        flash('Контакт сохранён.')
        return redirect(url_for('sales_park_detail', park_id=park_id))

    @app.post('/parks/<park_id>/visits')
    @protected(roles=('admin', 'field'))
    def sales_park_add_visit(park_id):
        park_for_user(park_id)
        status = text_field('status', 60)
        if status not in STATUSES:
            abort(422, 'Неизвестный статус выезда')
        try:
            visit_date = valid_date(request.form.get('visit_date', '').strip())
            next_date = valid_date(request.form.get('next_date', '').strip())
            building_m2 = numeric(text_field('building_m2', 25).replace(',', '.'), 100000000)
        except ValueError as exc:
            abort(422, str(exc))
        if not visit_date:
            abort(422, 'Укажите дату')
        next_action = text_field('next_action', 1200)
        db().execute(
            'INSERT INTO sales_visits(park_id,user_id,visit_date,status,owner_name,'
            'cadastral_number,building_type,building_m2,project_stage,contractor,'
            'note,next_action,next_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (park_id, g.user['id'], visit_date, status,
             text_field('owner_name', 220), text_field('cadastral_number', 120),
             text_field('building_type', 240), building_m2,
             text_field('project_stage', 240), text_field('contractor', 240),
             text_field('note', 5000), next_action, next_date))
        db().execute(
            'UPDATE sales_parks SET visit_status=?,next_action=?,next_date=?,'
            'updated_at=CURRENT_TIMESTAMP WHERE id=?',
            (status, next_action, next_date, park_id))
        db().commit()
        flash('Отчёт о выезде сохранён.')
        return redirect(url_for('sales_park_detail', park_id=park_id))

    @app.route('/parks/staff', methods=['GET', 'POST'])
    @protected(admin=True)
    def sales_parks_staff():
        invitation = None
        if request.method == 'POST':
            action = text_field('action', 30)
            zone = text_field('zone', 80)
            if action in ('create', 'assign') and zone not in ZONES:
                abort(422, 'Неизвестная географическая зона')
            if action == 'create':
                name = text_field('name', 160)
                email = text_field('email', 200).lower()
                if not name or not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
                    abort(422, 'Укажите имя и действительный email')
                try:
                    cursor = db().execute(
                        "INSERT INTO users(email,name,password,role) VALUES(?,?,?,'field')",
                        (email, name, generate_password_hash(secrets.token_urlsafe(48))))
                    user_id = cursor.lastrowid
                    db().execute(
                        'INSERT INTO sales_staff_zones(user_id,zone) VALUES(?,?)',
                        (user_id, zone))
                    db().commit()
                    invitation = issue_token(user_id)
                except sqlite3.IntegrityError:
                    db().rollback()
                    abort(422, 'Email уже существует: нельзя перезаписать чужую учётную запись')
            elif action in ('assign', 'invite'):
                try:
                    user_id = int(request.form.get('user_id', ''))
                except ValueError:
                    abort(422)
                existing = db().execute(
                    "SELECT id FROM users WHERE id=? AND role='field'", (user_id,)).fetchone()
                if not existing:
                    abort(404)
                if action == 'invite':
                    invitation = issue_token(user_id)
                else:
                    db().execute(
                        'INSERT INTO sales_staff_zones(user_id,zone) VALUES(?,?) '
                        'ON CONFLICT(user_id) DO UPDATE SET zone=excluded.zone',
                        (user_id, zone))
                    db().commit()
                    flash('Географическая зона сотрудника изменена.')
            else:
                abort(400)
        staff = db().execute(
            "SELECT u.id,u.email,u.name,z.zone FROM users u "
            "LEFT JOIN sales_staff_zones z ON z.user_id=u.id "
            "WHERE u.role='field' ORDER BY u.name"
        ).fetchall()
        return render('parks_staff.html', 'Сотрудники — Металл-Каркас',
                      zones=ZONES, staff=staff, invitation=invitation)

    def import_registry(raw):
        if len(raw) > 2_000_000:
            raise ValueError('Размер реестра превышает 2 МБ')
        try:
            data = json.loads(raw.decode('utf-8'))
        except (UnicodeError, ValueError):
            raise ValueError('Некорректный JSON')
        records = data.get('parks') if isinstance(data, dict) else None
        if not isinstance(records, list) or not (1 <= len(records) <= 800):
            raise ValueError('Ожидается объект с массивом parks (1–800 записей)')
        query = """INSERT INTO sales_parks
            (id,name,address,zone,category,stage,area_ha,buildings_m2,lat,lon,
             radius_km,radius_flag,focus_rank,target_fit,operator,operator_phone,
             source_url,accuracy,public_note)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
             name=excluded.name,address=excluded.address,zone=excluded.zone,
             category=excluded.category,stage=excluded.stage,
             area_ha=excluded.area_ha,buildings_m2=excluded.buildings_m2,
             lat=excluded.lat,lon=excluded.lon,radius_km=excluded.radius_km,
             radius_flag=excluded.radius_flag,focus_rank=excluded.focus_rank,
             target_fit=excluded.target_fit,operator=excluded.operator,
             operator_phone=excluded.operator_phone,source_url=excluded.source_url,
             accuracy=excluded.accuracy,public_note=excluded.public_note,
             updated_at=CURRENT_TIMESTAMP"""
        seen = set()
        try:
            # Validate the WHOLE file before writing any row.
            normalized = []
            for item in records:
                if not isinstance(item, dict):
                    raise ValueError('Запись должна быть объектом')
                park_id = str(item.get('id', ''))
                if not re.fullmatch(r'IP-\d{3,5}', park_id) or park_id in seen:
                    raise ValueError('Некорректный или повторяющийся ID: ' + park_id[:40])
                seen.add(park_id)
                zone = item.get('zone', '')
                if zone not in ZONES:
                    raise ValueError('Неизвестная зона у ' + park_id)
                name = str(item.get('name') or '').strip()
                address = str(item.get('address') or '').strip()
                if not name or not address or len(name) > 200 or len(address) > 600:
                    raise ValueError('Пустой или слишком длинный адрес/название у ' + park_id)
                lat = numeric(item.get('lat'), 90)
                lon = numeric(item.get('lon'), 180)
                if (lat is None) != (lon is None):
                    raise ValueError('Координаты должны идти парой у ' + park_id)
                url = str(item.get('source') or '')[:700]
                if url and not re.match(r'^https?://', url):
                    url = ''
                normalized.append((
                    park_id, name, address, zone,
                    str(item.get('category') or '')[:150],
                    str(item.get('stage') or '')[:150],
                    numeric(item.get('area'), 100000),
                    numeric(item.get('buildings_m2'), 1000000000),
                    lat, lon, numeric(item.get('radius_km'), 30000),
                    str(item.get('radius_flag') or '')[:100],
                    str(item.get('focus_rank') or 'C — вторичный обход')[:100],
                    str(item.get('target_fit') or '')[:200],
                    str(item.get('pub_company') or '')[:200],
                    str(item.get('pub_phone') or '')[:100],
                    url, str(item.get('accuracy') or '')[:240],
                    str(item.get('note') or '')[:4000]))
            db().executemany(query, normalized)
            db().commit()
        except (ValueError, TypeError, sqlite3.Error) as exc:
            db().rollback()
            raise ValueError('Ошибка импорта: ' + str(exc)[:150]) from exc
        return len(normalized)

    @app.cli.command('import-parks')
    @click.argument('registry', type=click.File('rb'))
    def import_parks_command(registry):
        """Import the public parks registry, retaining contacts and visit history."""
        try:
            count = import_registry(registry.read(2_000_001))
        except ValueError as exc:
            raise click.ClickException(str(exc)) from exc
        click.echo(f'Imported {count} parks; contacts and visits retained.')

    @app.post('/parks/import')
    @protected(admin=True)
    def sales_parks_import():
        uploaded = request.files.get('file')
        if not uploaded or not uploaded.filename.lower().endswith('.json'):
            abort(422, 'Загрузите JSON из реестра промпарков')
        raw = uploaded.read(2_000_001)
        if len(raw) > 2_000_000:
            abort(413)
        try:
            count = import_registry(raw)
        except ValueError as exc:
            abort(422, str(exc))
        flash('Реестр обновлён: ' + str(count) +
              ' записей. Контакты и история выездов сохранены.')
        return redirect(url_for('sales_parks_index'))
