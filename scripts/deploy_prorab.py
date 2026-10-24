"""Checked REG.RU update: dry run by default; never replaces live application data."""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
import secrets
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def replace_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix='.prorab-', dir=target.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--production', type=Path, required=True)
    parser.add_argument('--webroot', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1]
    production, webroot = args.production.resolve(), args.webroot.resolve()
    if source == production or not (webroot / 'passenger_wsgi.py').is_file():
        raise SystemExit('Expected a separate release directory and an existing Passenger site.')
    manifest = json.loads((source / 'docs/prorab-manifest.json').read_text())
    config_file = production / 'instance/hosting.json'
    if not config_file.is_file():
        raise SystemExit('Existing hosting configuration was not found.')
    config = json.loads(config_file.read_text())
    database = Path(config.get('DATA_DIR', production / 'instance')) / 'site.sqlite3'
    if database.resolve() != production / 'instance/site.sqlite3' or not database.is_file():
        raise SystemExit('Unexpected database location; review the deployment manually.')
    python = production / '.venv/bin/python'
    if not python.is_file():
        raise SystemExit('Existing production Python environment was not found.')
    targets = []
    for entry in manifest['files']:
        path = entry['path']
        if Path(path).is_absolute() or '..' in Path(path).parts:
            raise SystemExit('Invalid manifest path.')
        release = source / path
        if digest(release) != entry['sha256']:
            raise SystemExit('Release checksum mismatch: ' + path)
        if path.endswith('.py'):
            ast.parse(release.read_text())
        targets.append((release, production / path, entry['base_sha256']))
        if path.startswith('static/'):
            targets.append((release, webroot / path, entry['base_sha256']))
    if all(digest(target) == digest(release) for release, target, _ in targets):
        print('This release is already installed.')
        return
    for release, target, expected in targets:
        boundary = production if target.is_relative_to(production) else webroot
        if any(part.is_symlink() for part in [target, *target.parents] if part != boundary and part.is_relative_to(boundary)) or digest(target) != expected:
            raise SystemExit('Current file differs from the checked base; nothing changed: ' + str(target))
    if not args.apply:
        print(f'Check passed: {len(targets)} files; existing database and uploads will be retained.')
        return

    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    backup = Path(tempfile.mkdtemp(prefix='metalcarcase-prorab-' + stamp + '-', dir=production.parent))
    backup.chmod(0o700)
    with sqlite3.connect(database) as live, sqlite3.connect(backup / 'site.sqlite3') as snapshot:
        live.backup(snapshot)
    shutil.copy2(config_file, backup / 'hosting.json')
    shutil.copy2(webroot / 'passenger_wsgi.py', backup / 'passenger_wsgi.py')
    anchor_db = production / 'instance/prorab-anchors.sqlite3'
    if anchor_db.is_file():
        with sqlite3.connect(anchor_db) as live, sqlite3.connect(backup / anchor_db.name) as snapshot:
            live.backup(snapshot)
    anchor_key = production / 'instance/prorab-anchor.key'
    if anchor_key.is_file():
        shutil.copy2(anchor_key, backup / anchor_key.name)
    originals = []
    for index, (_, target, _) in enumerate(targets):
        saved = backup / 'source' / str(index)
        if target.exists():
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, saved)
        originals.append((target, saved if saved.exists() else None))
    (backup / 'restore-map.json').write_text(json.dumps([{'target': str(target), 'saved': str(saved) if saved else None}
                                                     for target, saved in originals], indent=2))
    validation = backup / 'validation'
    validation.mkdir()
    shutil.copy2(backup / 'site.sqlite3', validation / 'site.sqlite3')
    env = {**os.environ, **{k: str(v) for k, v in config.items()}}
    # Checks run against an isolated SQLite copy and cannot send notifications.
    for key in list(env):
        if key.startswith('SMTP_'):
            env.pop(key)
    env['DATA_DIR'] = str(validation)
    check = '''
import os, sqlite3
from app import create_app
app=create_app({'TESTING':True})
client=app.test_client()
base=app.config['SITE_URL']
for path in ['/', '/uslugi', '/request', '/produkciya', '/sitemap.xml', '/betonnye-raboty', '/krovelnye-raboty', '/o-kompanii', '/kontakty', '/robots.txt', '/prorab']:
    response=client.get(path,base_url=base)
    assert response.status_code==200, (path,response.status_code)
with sqlite3.connect(app.config['DATABASE']) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    owner=db.execute("SELECT id,version FROM users WHERE role='admin' LIMIT 1").fetchone()
assert owner, 'No existing administrator'
with client.session_transaction(base_url=base) as session:
    session['user_id'],session['user_version']=owner
for path in ['/admin/prorab','/admin','/admin/analytics','/admin/cases','/admin/photos','/admin/seo','/admin/services','/admin/services/1','/admin/services/1/preview','/admin/content','/admin/content/sections/home','/admin/content/sections/home/preview','/admin/content/sections/company','/admin/content/sections/contacts','/admin/content/sections/enquiry']:
    response=client.get(path,base_url=base)
    assert response.status_code==200, (path,response.status_code)
journal=client.get('/admin/prorab',base_url=base)
assert journal.headers['X-Robots-Tag']=='noindex, nofollow'
assert 'no-store' in journal.headers['Cache-Control']
assert b'/static/prorab/persistence.js' in journal.data
assert b'/admin/prorab' in client.get('/admin',base_url=base).data
assert b'Disallow: /prorab' in client.get('/robots.txt',base_url=base).data
for name in ['app.js', 'persistence.js', 'vault.js', 'economy.js', 'economy-store.js', 'id.js', 'document-store.js', 'templates.js', 'fixation.js', 'fixation-store.js', 'office.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/libredwg/libredwg-web.js']:
    response=client.get('/static/prorab/'+name,base_url=base)
    assert response.status_code==200 and 'javascript' in response.mimetype, (name,response.status_code,response.mimetype)
response=client.get('/static/prorab/vendor/libredwg/libredwg-web.wasm',base_url=base)
assert response.status_code==200 and len(response.data)==10810696
assert 'wasm-unsafe-eval' not in client.get('/',base_url=base).headers['Content-Security-Policy']
assert b'messenger-links' in client.get('/',base_url=base).data
with client.session_transaction(base_url=base) as session:
    csrf=session['csrf']
assert b'data-upload-url="/prorab/upload"' in journal.data
import io
rejected=client.post('/prorab/upload',base_url=base,data=dict(csrf_token=csrf,href='http://127.0.0.1',file=(io.BytesIO(b'test'),'test.docx')))
assert rejected.status_code==400 and rejected.is_json
fields=dict(csrf_token=csrf,project='a'*64,chain='b'*64,seq='1',prev='',hash='c'*64)
r=client.post('/prorab/anchor',base_url=base,data=fields)
assert r.status_code==200, r.status_code
receipt=r.get_json()
import json
verified=client.post('/prorab/anchor/verify',base_url=base,data=dict(csrf_token=csrf,receipts=json.dumps([receipt])))
assert verified.get_json()['valid']==[True]
assert len(client.post('/prorab/anchor/heads',base_url=base,data=dict(csrf_token=csrf,project='a'*64)).get_json()['heads'])==1
print('Isolated database, public/admin routes, Prorab assets and receipt endpoints passed.')
'''
    subprocess.run([str(python), '-c', check], cwd=source, env=env, check=True)
    if not os.environ.get('PRORAB_ANCHOR_KEY') and not config.get('PRORAB_ANCHOR_KEY'):
        if not anchor_key.exists():
            if anchor_db.is_file():
                with sqlite3.connect(anchor_db) as db:
                    if any(db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone() and db.execute('SELECT 1 FROM ' + t + ' LIMIT 1').fetchone() for t in ('receipts', 'legacy_receipts')):
                        raise RuntimeError('Receipt key is missing; restore the original key from backup.')
            descriptor = os.open(anchor_key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'w') as stream:
                stream.write(secrets.token_hex(32))
                stream.flush()
                os.fsync(stream.fileno())
        if len(anchor_key.read_bytes().strip()) < 32:
            raise RuntimeError('Receipt key is incomplete; restore the existing key from backup.')
        shutil.copy2(anchor_key, backup / anchor_key.name)
    installed = []
    try:
        for release, target, _ in targets:
            replace_file(release, target)
            installed.append(target)
        # No schema changes in this release; the live database is not modified by deployment.
        for release, target, _ in targets:
            if digest(release) != digest(target):
                raise RuntimeError('Installed file checksum mismatch: ' + str(target))
        (production / 'instance/prorab-release.json').write_text(json.dumps({'backup': str(backup), 'installed_at': stamp,
            'base_commit': manifest['base_commit'], 'files': manifest['files']}, ensure_ascii=False, indent=2))
    except Exception:
        for target, saved in reversed(originals):
            if target not in installed:
                continue
            if saved:
                replace_file(saved, target)
            else:
                target.unlink(missing_ok=True)
        (webroot / 'tmp').mkdir(exist_ok=True)
        (webroot / 'tmp/restart.txt').touch()
        raise
    (webroot / 'tmp').mkdir(exist_ok=True)
    (webroot / 'tmp/restart.txt').touch()
    print('Installed. Backup: ' + str(backup))
    print('Check the live public pages and owner interfaces after Passenger restarts.')


if __name__ == '__main__':
    main()
