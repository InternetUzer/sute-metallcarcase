"""Install the reviewed parks release on test.metalcarcase.ru only.

Dry run by default. Keeps the existing staging accounts, database and uploads.
The production application and webroot are never installation targets.
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
import subprocess
import tempfile


def replace_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.parks-', dir=target.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


CHECK = r'''
import os, sqlite3
from app import create_app
app = create_app({'TESTING': True})
base = app.config['SITE_URL']
assert base == 'https://test.metalcarcase.ru' and not app.config['SITE_INDEXABLE']
result = app.test_cli_runner().invoke(args=['import-parks', os.environ['PARKS_REGISTRY']])
assert result.exit_code == 0, result.output
with sqlite3.connect(app.config['DATABASE']) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    assert db.execute('SELECT COUNT(*) FROM sales_parks').fetchone()[0] >= 117
    owner = db.execute("SELECT id,version FROM users WHERE role='admin' LIMIT 1").fetchone()
assert owner, 'Existing staging administrator is required'
client = app.test_client()
for path in ['/', '/uslugi', '/request', '/produkciya', '/prorab', '/robots.txt']:
    response = client.get(path, base_url=base)
    assert response.status_code == 200, (path, response.status_code)
    assert 'noindex' in response.headers['X-Robots-Tag']
assert client.get('/parks', base_url=base).status_code == 302
with client.session_transaction(base_url=base) as session:
    session['user_id'], session['user_version'] = owner
for path in ['/admin', '/admin/prorab', '/parks', '/parks?rank=', '/parks/IP-001', '/parks/staff', '/parks/map-settings']:
    response = client.get(path, base_url=base)
    assert response.status_code == 200, (path, response.status_code)
    assert response.headers['Cache-Control'] == 'no-store'
    assert 'noindex' in response.headers['X-Robots-Tag']
assert len(client.get('/parks/map-data?rank=', base_url=base).json) >= 117
for path in ['/static/industrial-outreach.js', '/static/vendor/leaflet-1.9.4/leaflet.js']:
    response = client.get(path, base_url=base)
    assert response.status_code == 200 and 'javascript' in response.mimetype
response = client.get('/static/vendor/yandex-tiles/yandex-logo-ru.svg', base_url=base)
assert response.status_code == 200 and response.mimetype == 'image/svg+xml'
print('Staging database, 117-park import, owner pages, login protection and assets passed.')
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve()
    source = Path(__file__).resolve().parents[1]
    staging = root / 'metalcarcase-app'
    webroot = root / 'www/test.metalcarcase.ru'
    config_path = staging / 'instance/hosting.json'
    database = staging / 'instance/site.sqlite3'
    python = staging / '.venv/bin/python'
    wsgi = webroot / 'passenger_wsgi.py'
    registry = source / 'docs/industrial-outreach/industrial_parks_prospecting_import.json'
    production = root / 'metalcarcase-production'
    for path in (staging, webroot, config_path, database, wsgi):
        if not path.exists() or path.resolve() != path:
            raise SystemExit('Missing or symlinked staging path: ' + str(path))
    if (source.is_relative_to(staging) or source.is_relative_to(production)
            or not source.is_relative_to(root)):
        raise SystemExit('Extract this release into a separate directory under --root.')
    if not python.is_file():
        raise SystemExit('Staging Python is missing.')
    config = json.loads(config_path.read_text())
    if (config.get('SITE_URL', '').rstrip('/') != 'https://test.metalcarcase.ru'
            or str(config.get('SITE_INDEXABLE')) != '0'
            or Path(config.get('DATA_DIR', '')).resolve() != database.parent):
        raise SystemExit('This installer accepts only the isolated, non-indexable staging configuration.')
    prod_db = production / 'instance/site.sqlite3'
    if prod_db.exists() and database.samefile(prod_db):
        raise SystemExit('Staging and production must not share a database.')
    if hashlib.sha256(registry.read_bytes()).hexdigest() != 'f19771ff0c0dd7c8c615321e145890a9a224c8fa6b394d0b0a27be1be90d6be7':
        raise SystemExit('Unexpected initial registry. Review the new dataset before deployment.')
    files = [(p, webroot / p.relative_to(source)) for p in (source / 'static').rglob('*') if p.is_file()]
    if not files:
        raise SystemExit('Release assets are missing.')
    for _, target in files:
        if target.resolve() != target:
            raise SystemExit('Symlinked static target; review before deployment: ' + str(target))
    lock = (root / '.parks-staging-deploy.lock').open('a')
    os.chmod(lock.name, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    env = {**os.environ, **{k: str(v) for k, v in config.items()}}
    for key in list(env):
        if key.startswith('SMTP_') or key.startswith('PRORAB_ANCHOR'):
            env.pop(key)
    env['PARKS_REGISTRY'] = str(registry)
    # Read and exercise a consistent isolated snapshot, never the live DB in dry-run.
    with tempfile.TemporaryDirectory(prefix='parks-check-', dir=root) as checkdir:
        with sqlite3.connect(database) as live, sqlite3.connect(Path(checkdir) / 'site.sqlite3') as snapshot:
            live.backup(snapshot)
        subprocess.run([str(python), '-c', CHECK], cwd=source,
                       env={**env, 'DATA_DIR': checkdir}, check=True)
    if not args.apply:
        print(f'Check passed: staging only, {len(files)} static files; no live data changed.')
        return
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    backup = Path(tempfile.mkdtemp(prefix='metalcarcase-parks-backup-' + stamp + '-', dir=root))
    backup.chmod(0o700)
    shutil.copy2(config_path, backup / 'hosting.json')
    with sqlite3.connect(database) as live, sqlite3.connect(backup / 'site.sqlite3') as snapshot:
        live.backup(snapshot)
    # Full previous static tree is the simplest rollback and retains local legacy images.
    shutil.copytree(webroot / 'static', backup / 'static')
    shutil.copy2(wsgi, backup / 'passenger_wsgi.py')
    new_wsgi = backup / 'new-passenger_wsgi.py'
    new_wsgi.write_text(
        'import json, os, sys\n'
        f'PYTHON = {str(python)!r}\n'
        'if sys.executable != PYTHON:\n    os.execl(PYTHON, PYTHON, *sys.argv)\n'
        f'with open({str(config_path)!r}) as stream:\n'
        '    os.environ.update({k: str(v) for k, v in json.load(stream).items()})\n'
        f'sys.path.insert(0, {str(source)!r})\n'
        f'os.chdir({str(source)!r})\n'
        'from app import create_app\napplication = create_app()\n')
    installed = []
    try:
        # Only new sales tables/public park metadata are populated. Existing account,
        # contact and visit rows survive re-runs; never create employee passwords here.
        subprocess.run([str(python), '-c', CHECK], cwd=source, env=env, check=True)
        for release, target in files:
            replace_file(release, target)
            installed.append(target)
        replace_file(new_wsgi, wsgi)
    except Exception:
        replace_file(backup / 'passenger_wsgi.py', wsgi)
        for target in installed:
            saved = backup / target.relative_to(webroot)
            if saved.is_file():
                replace_file(saved, target)
            else:
                target.unlink(missing_ok=True)
        # Sales imports are additive: old app still works if activation failed.
        raise
    finally:
        (webroot / 'tmp').mkdir(exist_ok=True)
        (webroot / 'tmp/restart.txt').touch()
    (staging / 'instance/parks-release.json').write_text(json.dumps({
        'source': str(source), 'backup': str(backup), 'installed_at': stamp,
        'site': 'https://test.metalcarcase.ru', 'registry_sha256': hashlib.sha256(registry.read_bytes()).hexdigest()
    }, indent=2) + '\n')
    print('Installed on test.metalcarcase.ru. Backup: ' + str(backup))
    print('Keep the release directory: Passenger now imports it. Production was not targeted.')


if __name__ == '__main__':
    main()
