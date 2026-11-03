import copy
import json
import sqlite3
import pytest
import prorab_anchor as A
from test_prorab import anchor_token, app


def payload(token, seq=1, digest='a' * 64, prev=''):
    return dict(csrf_token=token, project='b' * 64, chain='c' * 64, seq=str(seq), hash=digest, prev=prev)


def test_receipt_is_durable_idempotent_and_uses_separate_private_key(app, monkeypatch):
    monkeypatch.delenv('PRORAB_ANCHOR_KEY', raising=False)
    client = app.test_client()
    assert client.post('/prorab/anchor', data=payload('')).status_code == 400
    token = anchor_token(client)
    r = client.post('/prorab/anchor', data=payload(token))
    assert r.status_code == 200
    receipt = r.get_json()
    assert receipt['version'] == 2 and receipt['hash'] == 'a' * 64 and receipt['tsa'] is None
    assert client.post('/prorab/anchor', data=payload(token)).get_json() == receipt
    with app.app_context():
        key = A.anchor_key()
        app.config['SECRET_KEY'] = 'different-site-cookie-secret-that-is-long'
        assert A.anchor_key() == key and A.valid_receipt(receipt)
        path = A.private_dir() / 'prorab-anchor.key'
        assert path.stat().st_mode & 0o777 == 0o600
        with A.database() as db:
            assert db.execute('SELECT COUNT(*) FROM receipts').fetchone()[0] == 1


def test_server_rejects_rewrite_gap_and_wrong_predecessor_and_keeps_head(app):
    client = app.test_client(); token = anchor_token(client)
    first = client.post('/prorab/anchor', data=payload(token)).get_json()
    assert client.post('/prorab/anchor', data=payload(token, digest='d' * 64)).status_code == 409
    assert client.post('/prorab/anchor', data=payload(token, 3, 'd' * 64, first['hash'])).status_code == 409
    assert client.post('/prorab/anchor', data=payload(token, 2, 'd' * 64, 'e' * 64)).status_code == 409
    second = client.post('/prorab/anchor', data=payload(token, 2, 'd' * 64, first['hash'])).get_json()
    heads = client.post('/prorab/anchor/heads', data={'csrf_token': token, 'project': 'b' * 64}).get_json()['heads']
    assert heads == [second]
    assert client.post('/prorab/anchor/heads', data={'project': 'b' * 64}).status_code == 400
    assert client.post('/prorab/anchor/heads', data={'csrf_token': token, 'project': 'f' * 64}).get_json()['heads'] == []


def test_batch_verification_binds_project_chain_sequence_previous_hash_and_time(app):
    client = app.test_client(); token = anchor_token(client)
    original = client.post('/prorab/anchor', data=payload(token)).get_json()
    batch = [original]
    for field, value in [('project', 'd' * 64), ('chain', 'd' * 64), ('seq', 2), ('prev', 'd' * 64), ('time', '2020-01-01T00:00:00Z'), ('hash', 'd' * 64), ('key', 'other')]:
        r = copy.deepcopy(original); r[field] = value; batch.append(r)
    batch.extend([None, {}, {'seq': True}])
    response = client.post('/prorab/anchor/verify', data={'csrf_token': token, 'receipts': json.dumps(batch)})
    assert response.status_code == 200
    assert response.get_json()['valid'] == [True] + [False] * (len(batch) - 1)
    assert client.post('/prorab/anchor/verify', data={'csrf_token': token, 'receipts': json.dumps([original] * 101)}).status_code == 400
    assert client.post('/prorab/anchor/verify', data={'receipts': json.dumps([original])}).status_code == 400


def test_failed_ledger_commit_never_returns_an_unrecorded_receipt(app, monkeypatch):
    client = app.test_client(); token = anchor_token(client)
    original = A.database
    class Failing:
        def __init__(self): self.db = original()
        def execute(self, *args): return self.db.execute(*args)
        def commit(self): raise sqlite3.OperationalError('simulated full disk')
        def close(self): self.db.close()
    monkeypatch.setattr(A, 'database', Failing)
    with pytest.raises(sqlite3.OperationalError): client.post('/prorab/anchor', data=payload(token))
    monkeypatch.setattr(A, 'database', original)
    with app.app_context(), original() as db:
        assert db.execute('SELECT COUNT(*) FROM receipts').fetchone()[0] == 0


def test_unselected_timestamp_provider_is_not_contacted(app, monkeypatch):
    monkeypatch.setenv('PRORAB_TSA_URL', 'https://should-not-be-contacted.invalid')
    client = app.test_client(); token = anchor_token(client)
    response = client.post('/prorab/anchor', data=payload(token)).get_json()
    assert response['tsa'] is None and response['tsa_url'] is None


def test_lost_key_is_not_silently_replaced_when_receipts_exist(app, monkeypatch):
    monkeypatch.delenv('PRORAB_ANCHOR_KEY', raising=False)
    client = app.test_client(); token = anchor_token(client)
    receipt = client.post('/prorab/anchor', data=payload(token)).get_json()
    with app.app_context():
        path = A.private_dir() / 'prorab-anchor.key'
        saved = path.read_bytes(); path.unlink()
        with pytest.raises(RuntimeError, match='restore the original key'): A.anchor_key()
        assert not path.exists()
        path.write_bytes(saved)
        assert A.valid_receipt(receipt)


def test_phone_legacy_receipt_stays_verifiable_but_v2_has_chain_heads(app):
    client = app.test_client()
    legacy = client.post('/prorab/anchor/app', data={'hash': 'd' * 64})
    assert legacy.status_code == 200 and 'Set-Cookie' not in legacy.headers
    receipt = legacy.get_json()
    assert receipt['version'] == 1
    assert client.post('/prorab/anchor/app', data={'hash': 'd' * 64}).get_json() == receipt
    fields = {k: receipt[k] for k in ('hash', 'time', 'sig')}
    assert client.post('/prorab/anchor/app/verify', data=fields).get_json()['valid'] is True
    assert client.post('/prorab/anchor/app/verify', data={**fields, 'time': '2000-01-01T00:00:00Z'}).get_json()['valid'] is False
    token = anchor_token(client)
    assert client.post('/prorab/anchor/verify', data={'csrf_token': token, 'receipts': json.dumps([receipt])}).get_json()['valid'] == [True]
    v2 = client.post('/prorab/anchor/app', data=payload('')).get_json()
    assert v2['version'] == 2
    assert client.post('/prorab/anchor/app/heads', data={'project': 'b' * 64}).get_json()['heads'] == [v2]
    assert client.post('/prorab/anchor/app/verify', data={'receipts': json.dumps([v2])}).get_json()['valid'] == [True]
    assert client.post('/prorab/anchor/app', data={'hash': 'bad'}).status_code == 400
    assert client.post('/prorab/anchor', data=payload('')).status_code == 400
    assert client.post('/request', data={}).status_code == 400
    assert client.post('/prorab/anchor/app/other', data={}).status_code in (400, 404)


def test_legacy_only_receipts_also_prevent_silent_key_replacement(app, monkeypatch):
    monkeypatch.delenv('PRORAB_ANCHOR_KEY', raising=False)
    client = app.test_client()
    client.post('/prorab/anchor/app', data={'hash': 'd' * 64})
    with app.app_context():
        path = A.private_dir() / 'prorab-anchor.key'
        path.unlink()
        with pytest.raises(RuntimeError, match='restore the original key'): A.anchor_key()
