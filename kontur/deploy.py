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
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    root=Path(args.production).resolve()
    source=Path(__file__).resolve().parent
    app=root/'app.py'
    original=app.read_text(encoding='utf-8')
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
    if (root/'kontur').exists():
        shutil.copytree(root/'kontur',backup/'kontur',ignore=shutil.ignore_patterns('__pycache__'))
    stage=root/'kontur-next'
    if stage.exists():
        raise SystemExit('kontur-next already exists; inspect it before retrying.')
    shutil.copytree(source,stage,ignore=shutil.ignore_patterns('__pycache__','tests','packaging','*.cmd'))
    if hashlib.sha256(app.read_bytes()).digest()!=digest:
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
        (root/'tmp').mkdir(exist_ok=True)
        (root/'tmp'/'restart.txt').touch()
    except Exception:
        shutil.copy2(backup/'app.py',app)
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
