"""Run on REG.RU: surgical integration, backup, syntax validation, Passenger restart."""
import argparse
import ast
import datetime
import hashlib
import os
from pathlib import Path
import shutil
import sys

OLD_CSRF = "if request.method == 'POST' and request.path not in ANCHOR_APP_PATHS:"
NEW_CSRF = "if request.method == 'POST' and request.path not in ANCHOR_APP_PATHS and not request.path.startswith('/kontur/'):"
REGISTER = "    # Контур owns JSON CSRF and paired-device authentication for its isolated routes.\n    from kontur.flask_adapter import register as register_kontur\n    register_kontur(app, csrf_token)\n\n"


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--production',required=True)
    parser.add_argument('--webroot',required=True)
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    root=Path(args.production).resolve()
    webroot=Path(args.webroot).resolve()
    if not (webroot/'passenger_wsgi.py').is_file():
        raise SystemExit('Expected an existing Passenger webroot. No changes made.')
    source=Path(__file__).resolve().parent
    app=root/'app.py'
    original=app.read_text(encoding='utf-8')
    admin=root/'templates'/'admin.html'
    original_admin=admin.read_text(encoding='utf-8')
    nav_anchor='<a href="/admin/prorab">Журнал работ (Прораб+)</a>'
    nav_link='<a href="/kontur/">Контур</a>'
    updated_admin=original_admin
    if nav_link not in updated_admin:
        if updated_admin.count(nav_anchor)!=1:
            raise SystemExit('Unrecognized admin navigation. Production was not modified.')
        updated_admin=updated_admin.replace(nav_anchor,nav_anchor+nav_link)
    if str(root) == str(source.parent):
        raise SystemExit('Deploy from a separate release directory, not the production checkout.')
    updated=original
    if NEW_CSRF not in updated:
        if updated.count(OLD_CSRF)!=1:
            raise SystemExit('Unrecognized CSRF guard. Production was not modified.')
        updated=updated.replace(OLD_CSRF,NEW_CSRF)
    if 'register_kontur(app, csrf_token)' not in updated:
        if updated.count('    return app\n')!=1:
            raise SystemExit('Unrecognized app factory. Production was not modified.')
        updated=updated.replace('    return app\n',REGISTER+'    return app\n')
    ast.parse(updated)
    for f in source.rglob('*.py'):
        ast.parse(f.read_text(encoding='utf-8'))
    if args.check:
        print('Check OK: exact CSRF hook and app factory found; Python sources parse. No changes made.')
        return
    # Refuse concurrent change between review and replacement.
    digest=hashlib.sha256(original.encode()).digest()
    backup=root/'backups'/('kontur-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(parents=True)
    shutil.copy2(app,backup/'app.py')
    shutil.copy2(admin,backup/'admin.html')
    if (root/'kontur').exists():
        shutil.copytree(root/'kontur',backup/'kontur',ignore=shutil.ignore_patterns('__pycache__'))
    stage=root/'kontur-next'
    if stage.exists():
        raise SystemExit('kontur-next already exists; inspect it before retrying.')
    shutil.copytree(source,stage,ignore=shutil.ignore_patterns('__pycache__','tests','packaging','*.cmd'))
    if hashlib.sha256(app.read_bytes()).digest()!=digest or admin.read_text(encoding='utf-8')!=original_admin:
        shutil.rmtree(stage)
        raise SystemExit('Production app.py changed during deploy. No app.py replacement performed.')
    previous=root/'kontur-previous'
    if previous.exists():
        raise SystemExit('kontur-previous exists; inspect previous deployment before proceeding.')
    installed=False
    try:
        if (root/'kontur').exists():
            (root/'kontur').rename(previous)
        stage.rename(root/'kontur')
        installed=True
        temp=root/'app.py.kontur-new'
        temp.write_text(updated,encoding='utf-8')
        shutil.copymode(app,temp)
        os.replace(temp,app)
        temp_admin=admin.with_suffix('.html.kontur-new')
        temp_admin.write_text(updated_admin,encoding='utf-8')
        shutil.copymode(admin,temp_admin)
        os.replace(temp_admin,admin)
        (webroot/'tmp').mkdir(exist_ok=True)
        (webroot/'tmp'/'restart.txt').touch()
    except Exception:
        shutil.copy2(backup/'app.py',app)
        shutil.copy2(backup/'admin.html',admin)
        if installed:
            shutil.rmtree(root/'kontur')
        if previous.exists():
            previous.rename(root/'kontur')
        raise
    if previous.exists():
        shutil.rmtree(previous)
    print('Installed /kontur/. Backup:',backup)
    print('Verify /login and /kontur/ as the owner. Existing user databases were not changed.')


if __name__=='__main__':
    main()
