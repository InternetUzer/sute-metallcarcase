import http.cookiejar
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from kontur.desktop import make_server
from kontur.runner import Runner, command, parse_output
from kontur.service import Service
from kontur.store import Error, Store, uid


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.a = Store(root / 'a.sqlite3')
        self.b = Store(root / 'b.sqlite3')
        self.cloud = Store(root / 'cloud.sqlite3', True)

    def tearDown(self):
        self.temp.cleanup()

    def sync(self, store):
        result = self.cloud.accept_sync([r for r in store.all(True) if r['dirty']])
        store.merge_sync(result)
        return result

    def project(self):
        return self.a.save(uid(), 'project', {'title': 'Тест', 'description': 'Начало'}, '')

    def test_offline_round_trip_and_idempotency(self):
        p = self.project()
        self.assertTrue(self.a.get(p['id'])['dirty'])
        packet = [p]
        first = self.cloud.accept_sync(packet)
        second = self.cloud.accept_sync(packet)
        self.assertEqual(first['accepted'], second['accepted'])
        self.a.merge_sync(second)
        self.sync(self.b)
        self.assertEqual(self.b.get(p['id'])['data']['title'], 'Тест')
        self.assertFalse(self.a.get(p['id'])['dirty'])

    def test_conflict_preserves_both_versions(self):
        p = self.project()
        self.sync(self.a)
        self.sync(self.b)
        self.a.change(p['id'], {'description': 'На ноутбуке'})
        self.b.change(p['id'], {'description': 'В облаке'})
        self.sync(self.b)
        self.sync(self.a)
        c = self.a.conflicts()[0]
        self.assertEqual(c['local']['data']['description'], 'На ноутбуке')
        self.assertEqual(c['remote']['data']['description'], 'В облаке')
        self.a.resolve(c['id'], 'local')
        self.sync(self.a)
        self.assertEqual(self.cloud.get(p['id'])['data']['description'], 'На ноутбуке')
        self.assertEqual(self.a.conflicts(), [])

    def test_edit_during_network_request_stays_pending(self):
        p = self.project()
        reply = self.cloud.accept_sync([p])
        self.a.change(p['id'], {'title': 'Изменено во время отправки'})
        self.a.merge_sync(reply)
        self.assertTrue(self.a.get(p['id'])['dirty'])
        self.assertEqual(self.a.get(p['id'])['base_rev'], p['rev'])
        self.sync(self.a)
        self.assertEqual(self.cloud.get(p['id'])['data']['title'], 'Изменено во время отправки')

    def test_stale_edit_is_rejected(self):
        p = self.project()
        self.a.change(p['id'], {'title': 'Новый'})
        with self.assertRaises(Error) as e:
            self.a.save(p['id'], 'project', {'title': 'Старый'}, p['rev'])
        self.assertEqual(e.exception.status, 409)

    def test_tombstone_syncs(self):
        p = self.project()
        self.sync(self.a)
        self.sync(self.b)
        p = self.a.get(p['id'])
        self.a.save(p['id'], 'project', p['data'], p['rev'], True)
        self.sync(self.a)
        self.sync(self.b)
        self.assertEqual(self.b.all(), [])
        self.assertTrue(self.b.get(p['id'])['deleted'])

    def test_import_is_atomic_and_does_not_replay_jobs(self):
        p = self.project()
        self.a.save(uid(), 'run', {'project': p['id'], 'prompt': 'test', 'status': 'queued', 'steps': [{'role':'code','provider':'codex'}]}, '')
        data = self.a.export()
        broken = json.loads(json.dumps(data))
        broken['records'].append({'id':'bad','kind':'project','data':{}})
        with self.assertRaises(Error):
            self.b.import_data(broken)
        self.assertEqual(self.b.all(), [])
        self.b.import_data(data)
        rows = self.b.all()
        project = next(r for r in rows if r['kind'] == 'project')
        run = next(r for r in rows if r['kind'] == 'run')
        self.assertNotEqual(project['id'], p['id'])
        self.assertEqual(run['data']['project'], project['id'])
        self.assertEqual(run['data']['status'], 'interrupted')


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = Service(Path(self.temp.name) / 'desktop')
        self.cloud = Service(Path(self.temp.name) / 'cloud', True)

    def tearDown(self):
        self.temp.cleanup()

    def test_device_key_only_shown_once_and_revocable(self):
        result = self.cloud.handle('POST', '/devices', {'name':'Laptop'})
        self.assertTrue(self.cloud.device_auth(result['token']))
        self.assertNotIn(result['token'], json.dumps(self.cloud.store.export()))
        self.assertNotIn(result['token'], json.dumps(self.cloud.handle('POST','/devices/list',{})))
        self.cloud.handle('POST','/devices/revoke',{'id':result['id']})
        self.assertFalse(self.cloud.device_auth(result['token']))

    def test_cloud_claim_once(self):
        run = self.cloud.store.save(uid(), 'run', {'project':'p','prompt':'test','status':'queued','steps':[{'role':'code','provider':'claude'}]}, '')
        request = {'id':run['id'],'rev':run['rev'],'device':'one'}
        claimed = self.cloud.handle('POST','/claim',request)
        self.assertEqual(claimed['record']['data']['status'], 'running')
        with self.assertRaises(Error):
            self.cloud.handle('POST','/claim',{**request, 'device':'two'})

    def test_cloud_cannot_open_local_paths(self):
        with self.assertRaises(Error):
            self.cloud.handle('POST','/local/open',{'project':'p'})

    def test_local_state_never_returns_pairing_secret(self):
        self.service.store.set_setting('cloud_token','secret-value')
        state = self.service.handle('GET','/state')
        self.assertNotIn('secret-value', json.dumps(state))

    def test_subscription_commands_no_shell_and_structured_results(self):
        with patch('kontur.runner.executable',return_value=['/usr/bin/codex']):
            args = command('codex','lead')
        self.assertIn('read-only',args)
        self.assertEqual(args[-1],'-')
        self.assertEqual(parse_output('codex',json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'Готово'}})), 'Готово')
        self.assertEqual(parse_output('claude','{"result":"OK","is_error":false}'),'OK')
        with self.assertRaises(Error):
            parse_output('claude','{"result":"not logged in","is_error":true}')

    def test_runner_handoff_uses_prior_answer(self):
        s = self.service.store
        p = s.save(uid(),'project',{'title':'P'},'')
        s.set_setting('paths',{p['id']:self.temp.name})
        run = s.save(uid(),'run',{'project':p['id'],'prompt':'Build','status':'queued','steps':[{'role':'lead','provider':'codex'},{'role':'code','provider':'claude'}]},'')
        runner = Runner(self.service)
        prompts = []
        def invoke(args,prompt,folder,run_id,provider):
            prompts.append(prompt)
            return 'Решение руководителя' if provider=='codex' else 'Сделано'
        with patch('kontur.runner.command',return_value=['fake']), patch.object(runner,'invoke',side_effect=invoke):
            runner.execute(run)
        self.assertIn('Решение руководителя',prompts[1])
        self.assertEqual(s.get(run['id'])['data']['status'],'done')
        self.assertEqual(len([r for r in s.all() if r['kind']=='message']),2)


class HTTPTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = Service(self.temp.name)
        self.server,self.launch = make_server(self.service)
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.base = self.launch.split('/?')[0]
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def test_loopback_auth_and_csrf(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.opener.open(self.base+'/api/state')
        self.assertEqual(e.exception.code,401)
        self.opener.open(self.launch).close()
        csrf=json.load(self.opener.open(self.base+'/bootstrap'))['csrf']
        body=json.dumps({'id':uid(),'kind':'project','data':{'title':'HTTP'},'expected':''}).encode()
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.opener.open(urllib.request.Request(self.base+'/api/record',body,{'Content-Type':'application/json'}))
        self.assertEqual(e.exception.code,403)
        r=self.opener.open(urllib.request.Request(self.base+'/api/record',body,{'Content-Type':'application/json','X-Kontur-CSRF':csrf}))
        self.assertEqual(json.load(r)['record']['data']['title'],'HTTP')

    def test_bad_host_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.opener.open(urllib.request.Request(self.launch,headers={'Host':'evil.example'}))
        self.assertEqual(e.exception.code,403)


if __name__=='__main__':
    unittest.main()
