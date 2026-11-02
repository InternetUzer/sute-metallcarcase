"""One-time staging -> production parks data promotion; dry-run by default.

Copies only parks, their contact/visit records, the existing shared employee
password hash and the browser map key. Never replaces the production database,
administrator/client accounts, uploads, mail or SEO settings. Run before the
checked deploy_prorab.py code installer, using the same reviewed release.
"""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile

TABLES = ('sales_parks', 'sales_staff_zones', 'sales_contacts', 'sales_visits')
INDEXES = ('idx_users_outreach_shared', 'idx_sales_parks_zone',
           'idx_sales_contacts_park', 'idx_sales_visits_park')
MARKER = 'parks_initial_promotion'
KEY = 'parks_yandex_tiles_key'


def snapshot(source, destination):
    with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as live:
        with sqlite3.connect(destination) as saved:
            live.backup(saved)


def transfer(source, destination):
    """Transactional, repeat-safe transfer between caller-owned SQLite files."""
    src = sqlite3.connect(f'file:{source}?mode=ro', uri=True)
    src.row_factory = sqlite3.Row
    dst = sqlite3.connect(destination, timeout=20)
    dst.row_factory = sqlite3.Row
    dst.execute('PRAGMA foreign_keys=ON')
    try:
        if dst.execute('SELECT 1 FROM settings WHERE key=?', (MARKER,)).fetchone():
            return {'already_promoted': True}
        shared = src.execute("SELECT * FROM users WHERE role='outreach'").fetchall()
        if len(shared) != 1 or len(shared[0]['password']) < 30:
            raise ValueError('Exactly one configured shared staging account is required.')
        shared = shared[0]
        rows = {t: [dict(r) for r in src.execute('SELECT * FROM ' + t)] for t in TABLES}
        if len(rows['sales_parks']) != 117:
            raise ValueError('Expected the reviewed 117-park staging registry.')
        if rows['sales_staff_zones']:
            raise ValueError('Legacy zoned accounts need a separate migration review.')
        key = src.execute('SELECT value FROM settings WHERE key=?', (KEY,)).fetchone()
        if not key or not key['value']:
            raise ValueError('Configure the staging Yandex Tiles key before promotion.')
        schema = []
        for name in TABLES + INDEXES:
            row = src.execute('SELECT sql FROM sqlite_master WHERE name=?', (name,)).fetchone()
            if not row or not row['sql'].startswith(('CREATE TABLE ', 'CREATE UNIQUE INDEX ', 'CREATE INDEX ')):
                raise ValueError('Missing or unexpected parks schema: ' + name)
            schema.append((name, row['sql']))
        dst.execute('BEGIN IMMEDIATE')
        # Never merge into an independently populated production CRM or overwrite
        # an existing account, even when its login happens to match staging.
        for table in TABLES:
            if dst.execute('SELECT 1 FROM sqlite_master WHERE name=?', (table,)).fetchone():
                if dst.execute('SELECT 1 FROM ' + table + ' LIMIT 1').fetchone():
                    raise ValueError('Production already contains parks data; automatic merge refused.')
        if dst.execute("SELECT 1 FROM users WHERE role='outreach' OR email=?", (shared['email'],)).fetchone():
            raise ValueError('Production account conflict; existing credentials were not changed.')
        existing_key = dst.execute('SELECT value FROM settings WHERE key=?', (KEY,)).fetchone()
        if existing_key and existing_key['value'] != key['value']:
            raise ValueError('Production already has a different map key.')
        for name, sql in schema:
            if not dst.execute('SELECT 1 FROM sqlite_master WHERE name=?', (name,)).fetchone():
                dst.execute(sql)
        cursor = dst.execute('INSERT INTO users(email,name,password,role,version) VALUES(?,?,?,?,?)',
                             tuple(shared[c] for c in ('email','name','password','role','version')))
        mapping = {shared['id']: cursor.lastrowid}
        authors = {r['user_id'] for table in ('sales_contacts', 'sales_visits') for r in rows[table]}
        for author_id in authors - mapping.keys():
            user = src.execute('SELECT email,role FROM users WHERE id=?', (author_id,)).fetchone()
            matched = dst.execute('SELECT id FROM users WHERE email=? AND role=?', tuple(user)).fetchone() if user else None
            if not matched:
                raise ValueError('A report author has no matching production account.')
            mapping[author_id] = matched['id']
        for table in ('sales_parks', 'sales_contacts', 'sales_visits'):
            columns = [r['name'] for r in dst.execute('PRAGMA table_info(' + table + ')')]
            for row in rows[table]:
                if 'user_id' in row:
                    row['user_id'] = mapping[row['user_id']]
                dst.execute('INSERT INTO ' + table + ' (' + ','.join(columns) + ') VALUES (' +
                            ','.join('?' for _ in columns) + ')', [row[c] for c in columns])
        dst.execute('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING', (KEY,key['value']))
        stamp = datetime.now(timezone.utc).isoformat()
        dst.execute('INSERT INTO settings(key,value) VALUES(?,?)', (MARKER,stamp))
        if dst.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Foreign key validation failed.')
        dst.commit()
        return {'parks': len(rows['sales_parks']), 'contacts': len(rows['sales_contacts']),
                'visits': len(rows['sales_visits']), 'shared_account_copied': True, 'map_key_copied': True}
    except Exception:
        dst.rollback()
        raise
    finally:
        src.close()
        dst.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    root = args.root.resolve()
    stage = root / 'metalcarcase-app/instance'
    prod = root / 'metalcarcase-production/instance'
    for path, host in ((stage,'https://test.metalcarcase.ru'), (prod,'https://metalcarcase.ru')):
        config_path = path / 'hosting.json'
        database = path / 'site.sqlite3'
        if not database.is_file() or database.resolve() != database or config_path.resolve() != config_path:
            raise SystemExit('Missing or symlinked hosting data.')
        config = json.loads(config_path.read_text())
        if config.get('SITE_URL','').rstrip('/') != host or Path(config.get('DATA_DIR','')).resolve() != path:
            raise SystemExit('Unexpected hosting configuration; nothing changed.')
    if (stage/'site.sqlite3').samefile(prod/'site.sqlite3'):
        raise SystemExit('Staging and production must be isolated.')
    lock = (root/'.parks-production-promotion.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    with tempfile.TemporaryDirectory(prefix='parks-promotion-check-',dir=root) as scratch:
        source = Path(scratch)/'source.sqlite3'
        check = Path(scratch)/'check.sqlite3'
        snapshot(stage/'site.sqlite3', source)
        snapshot(prod/'site.sqlite3', check)
        result = transfer(source, check)
        print('Isolated promotion check passed: ' + json.dumps(result))
        if not args.apply or result.get('already_promoted'):
            return
        backup = Path(tempfile.mkdtemp(prefix='metalcarcase-parks-promotion-backup-',dir=root))
        snapshot(prod/'site.sqlite3', backup/'site.sqlite3')
        shutil.copy2(prod/'hosting.json', backup/'hosting.json')
        result = transfer(source, prod/'site.sqlite3')
        (prod/'parks-promotion.json').write_text(json.dumps({
            'backup':str(backup), 'result':result,
            'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest()},indent=2)+'\n')
        print('Promoted parks data only. Existing shared password retained. Backup: ' + str(backup))


if __name__ == '__main__':
    main()
