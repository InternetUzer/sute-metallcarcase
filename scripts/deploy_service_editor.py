"""Checked REG.RU update: dry run by default; never replaces live application data."""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def replace_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix='.service-editor-', dir=target.parent)
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
    manifest = json.loads((source / 'docs/service-editor-manifest.json').read_text())
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
        if target.is_symlink() or digest(target) != expected:
            raise SystemExit('Current file differs from the checked base; nothing changed: ' + str(target))
    if not args.apply:
        print(f'Check passed: {len(targets)} files; existing database and uploads will be retained.')
        return

    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    backup = Path(tempfile.mkdtemp(prefix='metalcarcase-service-editor-' + stamp + '-', dir=production.parent))
    backup.chmod(0o700)
    with sqlite3.connect(database) as live, sqlite3.connect(backup / 'site.sqlite3') as snapshot:
        live.backup(snapshot)
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
for path in ['/', '/uslugi', '/request', '/produkciya', '/sitemap.xml', '/betonnye-raboty', '/krovelnye-raboty']:
    response=client.get(path,base_url=base)
    assert response.status_code==200, (path,response.status_code)
with sqlite3.connect(app.config['DATABASE']) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    owner=db.execute("SELECT id,version FROM users WHERE role='admin' LIMIT 1").fetchone()
assert owner, 'No existing administrator'
with client.session_transaction(base_url=base) as session:
    session['user_id'],session['user_version']=owner
for path in ['/admin','/admin/analytics','/admin/cases','/admin/photos','/admin/seo','/admin/services','/admin/services/1','/admin/services/1/preview']:
    response=client.get(path,base_url=base)
    assert response.status_code==200, (path,response.status_code)
print('Isolated database, service catalogue and route checks passed.')
'''
    subprocess.run([str(python), '-c', check], cwd=source, env=env, check=True)
    installed = []
    try:
        for release, target, _ in targets:
            replace_file(release, target)
            installed.append(target)
        # Additive migrations only; existing leads, users and settings are retained.
        env['DATA_DIR'] = str(production / 'instance')
        subprocess.run([str(python), '-c', 'from app import create_app; create_app(); print("Additive migrations completed.")'],
                       cwd=production, env=env, check=True)
        for release, target, _ in targets:
            if digest(release) != digest(target):
                raise RuntimeError('Installed file checksum mismatch: ' + str(target))
        (production / 'instance/service-editor-release.json').write_text(json.dumps({'backup': str(backup), 'installed_at': stamp,
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
