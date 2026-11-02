"""Promotion preserves production business data and never mixes account IDs."""
import sqlite3
from pathlib import Path
import pytest
from werkzeug.security import generate_password_hash
from app import create_app
from scripts.promote_parks_data import transfer

ROOT = Path(__file__).resolve().parents[1]


def databases(tmp_path):
    stage = create_app({'TESTING':True,'DATA_DIR':str(tmp_path/'stage')})
    prod = create_app({'TESTING':True,'DATA_DIR':str(tmp_path/'prod')})
    result = stage.test_cli_runner().invoke(args=['import-parks',str(ROOT/'docs/industrial-outreach/industrial_parks_prospecting_import.json')])
    assert result.exit_code == 0
    hashed = generate_password_hash('synthetic-existing-password')
    with sqlite3.connect(stage.config['DATABASE']) as db:
        db.execute("INSERT INTO users(id,email,name,password,role) VALUES(1,'owner@example.com','Owner','stage-only','admin')")
        db.execute("INSERT INTO users(id,email,name,password,role) VALUES(2,'shared-qa','Team',?,'outreach')",(hashed,))
        db.execute("INSERT INTO settings VALUES('parks_yandex_tiles_key','synthetic-map-key-not-submitted')")
        db.execute("INSERT INTO sales_contacts(park_id,user_id,name) VALUES('IP-001',1,'Owner contact')")
        db.execute("INSERT INTO sales_visits(park_id,user_id,visit_date,status,note) VALUES('IP-001',2,'2026-11-02','Переговоры','Team report')")
    with sqlite3.connect(prod.config['DATABASE']) as db:
        db.execute("INSERT INTO users(id,email,name,password,role) VALUES(2,'client@example.com','Client','unchanged-client','client')")
        db.execute("INSERT INTO users(id,email,name,password,role) VALUES(9,'owner@example.com','Owner','unchanged-owner','admin')")
        db.execute("INSERT INTO projects(id,user_id,title) VALUES(1,2,'Existing project')")
        db.execute("INSERT INTO settings VALUES('company_name','Production company')")
    return Path(stage.config['DATABASE']), Path(prod.config['DATABASE']), hashed


def test_promotion_retains_credentials_authorship_and_other_production_data(tmp_path):
    stage,prod,hashed=databases(tmp_path)
    # The current production release predates the parks schema entirely.
    with sqlite3.connect(prod) as db:
        for name in ['sales_visits','sales_contacts','sales_staff_zones','sales_parks']:
            db.execute('DROP TABLE '+name)
        db.execute('DROP INDEX idx_users_outreach_shared')
    result=transfer(stage,prod)
    assert result['parks']==117 and result['visits']==1 and result['contacts']==1
    with sqlite3.connect(prod) as db:
        assert db.execute("SELECT password FROM users WHERE id=9").fetchone()[0]=='unchanged-owner'
        assert db.execute("SELECT password FROM users WHERE id=2").fetchone()[0]=='unchanged-client'
        assert db.execute("SELECT password FROM users WHERE role='outreach'").fetchone()[0]==hashed
        assert db.execute('SELECT user_id FROM sales_contacts').fetchone()[0]==9
        shared_id=db.execute("SELECT id FROM users WHERE role='outreach'").fetchone()[0]
        assert db.execute('SELECT user_id FROM sales_visits').fetchone()[0]==shared_id
        assert db.execute('SELECT user_id,title FROM projects').fetchone()==(2,'Existing project')
        assert db.execute("SELECT value FROM settings WHERE key='company_name'").fetchone()[0]=='Production company'
        db.execute("INSERT INTO sales_visits(park_id,user_id,visit_date,status,note) VALUES('IP-001',?,'2026-11-03','Выезд выполнен','New production report')",(shared_id,))
    assert transfer(stage,prod)=={'already_promoted':True}
    with sqlite3.connect(prod) as db:
        assert db.execute('SELECT count(*) FROM sales_visits').fetchone()[0]==2


@pytest.mark.parametrize('conflict', ['login','parks','author','key'])
def test_promotion_conflicts_leave_production_unchanged(tmp_path,conflict):
    stage,prod,_=databases(tmp_path)
    with sqlite3.connect(prod) as db:
        if conflict=='login': db.execute("INSERT INTO users(email,name,password,role) VALUES('shared-qa','Existing','keep','client')")
        if conflict=='parks': db.execute("INSERT INTO sales_parks(id,name,address,zone) VALUES('IP-999','Existing','Address','СЕВЕР / ЗАПАД')")
        if conflict=='author': db.execute("UPDATE users SET email='different@example.com' WHERE id=9")
        if conflict=='key': db.execute("INSERT INTO settings VALUES('parks_yandex_tiles_key','different-key')")
    with sqlite3.connect(prod) as db: before=list(db.iterdump())
    with pytest.raises(ValueError): transfer(stage,prod)
    with sqlite3.connect(prod) as db: assert before==list(db.iterdump())
