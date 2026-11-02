"""Exercise the staging installer against disposable hosting directories."""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import site

from app import create_app

ROOT = Path(__file__).resolve().parents[1]


def test_staging_deploy_retains_accounts_and_never_changes_production(tmp_path):
    release = tmp_path / 'reviewed-release'
    shutil.copytree(ROOT, release, ignore=shutil.ignore_patterns('.git', '.pytest_cache', '__pycache__', 'instance'))
    staging = tmp_path / 'metalcarcase-app'
    data = staging / 'instance'
    data.mkdir(parents=True)
    app = create_app({'TESTING': True, 'SECRET_KEY': 'staging-installer-test-only', 'DATA_DIR': str(data)})
    with sqlite3.connect(app.config['DATABASE']) as db:
        db.execute("INSERT INTO users(email,name,password,role) VALUES('owner@example.com','QA','unusable','admin')")
    config = {'APP_ENV': 'production', 'SECRET_KEY': 'staging-installer-test-only-32-characters',
              'SITE_URL': 'https://test.metalcarcase.ru', 'SITE_INDEXABLE': '0', 'DATA_DIR': str(data),
              'TRUSTED_HOSTS': 'test.metalcarcase.ru'}
    (data / 'hosting.json').write_text(json.dumps(config))
    python = staging / '.venv/bin/python'
    python.parent.mkdir(parents=True)
    python.symlink_to(sys.executable)
    web = tmp_path / 'www/test.metalcarcase.ru'
    (web / 'static').mkdir(parents=True)
    (web / 'static/legacy-image.txt').write_text('preserved legacy image')
    (web / 'passenger_wsgi.py').write_text('# previous staging entry point\n')
    (data / 'files/existing.txt').write_text('preserved user upload')
    production = tmp_path / 'metalcarcase-production/instance'
    production.mkdir(parents=True)
    (production / 'site.sqlite3').write_bytes(b'production must remain unchanged')
    prod_web = tmp_path / 'www/metalcarcase.ru'
    prod_web.mkdir()
    (prod_web / 'passenger_wsgi.py').write_text('production entry point')
    env = dict(os.environ)
    # The disposable Python link has no venv metadata; inherit the test runtime's dependencies.
    env['PYTHONPATH'] = os.pathsep.join(site.getsitepackages())
    command = [str(python), str(release / 'scripts/deploy_parks_staging.py'), '--root', str(tmp_path)]
    before = (data / 'site.sqlite3').read_bytes()
    checked = subprocess.run(command, capture_output=True, text=True, env=env)
    assert checked.returncode == 0, checked.stdout + checked.stderr
    assert before == (data / 'site.sqlite3').read_bytes(), 'Dry-run changed live database'
    assert (web / 'passenger_wsgi.py').read_text().startswith('# previous')
    installed = subprocess.run(command + ['--apply'], capture_output=True, text=True, env=env)
    assert installed.returncode == 0, installed.stdout + installed.stderr
    assert str(release) in (web / 'passenger_wsgi.py').read_text()
    assert (web / 'static/industrial-outreach.js').read_bytes() == (release / 'static/industrial-outreach.js').read_bytes()
    assert (web / 'static/legacy-image.txt').read_text() == 'preserved legacy image'
    assert (data / 'files/existing.txt').read_text() == 'preserved user upload'
    with sqlite3.connect(data / 'site.sqlite3') as db:
        assert db.execute('SELECT COUNT(*) FROM sales_parks').fetchone()[0] == 117
        assert db.execute('SELECT email FROM users').fetchone()[0] == 'owner@example.com'
    info = json.loads((data / 'parks-release.json').read_text())
    with sqlite3.connect(Path(info['backup']) / 'site.sqlite3') as db:
        assert db.execute('SELECT COUNT(*) FROM sales_parks').fetchone()[0] == 0
    loaded = subprocess.run([str(python), '-c',
        'import runpy; a=runpy.run_path(' + repr(str(web / 'passenger_wsgi.py')) + ')["application"]; '
        'assert a.test_client().get("/parks",base_url="https://test.metalcarcase.ru").status_code==302'],
        capture_output=True, text=True, env=env)
    assert loaded.returncode == 0, loaded.stdout + loaded.stderr
    assert (production / 'site.sqlite3').read_bytes() == b'production must remain unchanged'
    assert (prod_web / 'passenger_wsgi.py').read_text() == 'production entry point'
    # Wrong domain/config is refused before either database or entry point changes.
    config['SITE_URL'] = 'https://metalcarcase.ru'
    (data / 'hosting.json').write_text(json.dumps(config))
    denied = subprocess.run(command + ['--apply'], capture_output=True, text=True, env=env)
    assert denied.returncode != 0 and 'staging configuration' in denied.stderr
