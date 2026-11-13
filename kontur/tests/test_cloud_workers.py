import json
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from kontur.connections import protect_secret
from kontur.runner import Runner
from kontur.service import Service
from kontur.store import Error, Store, uid
from kontur.worker import WorkerRunner, WorkerService


class CloudWorkerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.cloud = Service(self.root / 'cloud', True)
        self.key = self.cloud.handle('POST', '/workers/create', {'name': 'Server'})
        self.worker_id = self.key['id']
        self.worker = WorkerService(self.root / 'worker')
        self.worker.store.set_setting('device_id', self.worker_id)
        self.worker.store.set_setting('cloud_token', protect_secret(self.key['token']))
        self.worker.store.set_setting('cloud_url', 'https://example.test/kontur')
        self.worker.store.set_setting('heartbeat_at', time.time())
        self.worker.store.set_setting('worker_enabled', True)
        self.cloud.workers.heartbeat(self.worker_id, {'providers': {}, 'projects': []})
        self.cloud.workers.select(self.worker_id)
        self.project = self.cloud.store.save(uid(), 'project', {'title': 'Project', 'repo': 'InternetUzer/test'}, '')
        self.patch_a = patch('kontur.service.request_json', side_effect=self.request)
        self.patch_b = patch('kontur.worker.request_json', side_effect=self.request)
        self.patch_a.start()
        self.patch_b.start()

    def tearDown(self):
        self.patch_a.stop()
        self.patch_b.stop()
        self.temp.cleanup()

    def request(self, url, token=None, data=None, method=None):
        worker = self.cloud.workers.authenticate(token)
        if not worker:
            raise Error('Unauthorized', 401)
        return self.cloud.worker_request(worker, url.split('/api')[1], data)

    def run_record(self):
        return self.cloud.store.save(uid(), 'run', {'project': self.project['id'], 'prompt': 'Обсудите решение',
            'status': 'queued', 'steps': [{'provider': 'codex', 'role': 'chat'}, {'provider': 'claude', 'role': 'chat'}]}, '')

    def test_cloud_dialogue_handoff_without_desktop(self):
        run = self.run_record()
        self.worker.sync()
        runner = WorkerRunner(self.worker)
        prompts = []
        def invoke(args, prompt, folder, run_id, provider):
            prompts.append(prompt)
            return 'Ответ Codex' if provider == 'codex' else 'Ответ Claude'
        with patch('kontur.runner.command', return_value=['fake']), patch.object(runner, 'invoke', side_effect=invoke):
            runner.execute(self.worker.store.get(run['id']))
        self.worker.sync()
        self.assertIn('Ответ Codex', prompts[1])
        finished = self.cloud.store.get(run['id'])['data']
        self.assertEqual(finished['status'], 'done')
        self.assertEqual(finished['device'], self.worker_id)
        self.assertEqual(finished['executor'], 'cloud')
        self.assertEqual(len([r for r in self.cloud.store.all() if r['kind'] == 'message']), 2)

    def test_two_wsgi_processes_cannot_claim_twice(self):
        run = self.run_record()
        other = Service(self.root / 'cloud', True)
        barrier = threading.Barrier(2)
        def claim(service):
            barrier.wait()
            try:
                service.workers.claim(self.worker_id, {'id': run['id'], 'rev': run['rev']})
                return True
            except Error:
                return False
        with ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(claim, s) for s in (self.cloud, other)]
            self.assertEqual(sum(f.result() for f in futures), 1)

    def test_desktop_cannot_claim_cloud_queue(self):
        run = self.run_record()
        with self.assertRaises(Error):
            self.cloud.handle('POST', '/claim', {'id': run['id'], 'rev': run['rev'], 'device': 'laptop'})
        desktop = Service(self.root / 'desktop')
        desktop.store.set_setting('cloud_token', 'configured')
        desktop.store.set_setting('execution_worker', self.worker_id)
        self.assertFalse(Runner(desktop).can_execute())

    def test_legacy_laptop_failure_cannot_overwrite_cloud_work(self):
        run = self.run_record()
        desktop = Store(self.root / 'legacy.sqlite3')
        desktop.merge_sync({'accepted': [], 'records': [run]})
        failed = desktop.change(run['id'], {'status': 'failed', 'error': 'No local folder'})
        reply = self.cloud.handle('POST', '/sync', {'client_version': '0.2.0', 'records': [failed]})
        self.assertEqual(reply['accepted'], [])
        self.assertEqual(self.cloud.store.get(run['id'])['data']['status'], 'queued')
        desktop.merge_sync(reply)
        self.assertEqual(len(desktop.conflicts()), 1)

    def test_other_worker_cannot_change_owner_results_or_project(self):
        run = self.run_record()
        claimed = self.cloud.workers.claim(self.worker_id, {'id': run['id'], 'rev': run['rev']})['record']
        other = self.cloud.handle('POST', '/workers/create', {})['id']
        forged = {**claimed, 'base_rev': claimed['rev'], 'rev': uid(), 'data': {**claimed['data'], 'status': 'done'}}
        reply = self.cloud.worker_request(other, '/worker/sync', {'client_version': '0.2.0', 'records': [forged]})
        self.assertFalse(reply['accepted'])
        self.assertEqual(self.cloud.store.get(run['id'])['data']['status'], 'running')
        project = {**self.project, 'base_rev': self.project['rev'], 'rev': uid(), 'data': {'title': 'Hacked'}}
        reply = self.cloud.worker_request(self.worker_id, '/worker/sync', {'client_version': '0.2.0', 'records': [project]})
        self.assertFalse(reply['accepted'])

    def test_cancellation_wins_over_late_worker_result(self):
        run = self.run_record()
        self.worker.sync()
        self.worker.claim(self.worker.store.get(run['id']))
        self.worker.store.change(run['id'], {'status': 'done'})
        self.cloud.handle('POST', '/cancel', {'id': run['id']})
        self.worker.sync()
        self.assertEqual(self.cloud.store.get(run['id'])['data']['status'], 'cancelled')
        self.assertEqual(self.worker.store.get(run['id'])['data']['status'], 'cancelled')
        self.assertFalse(self.worker.store.conflicts())
        self.assertFalse(self.worker.store.get(run['id'])['dirty'])

    def test_running_task_blocks_switch(self):
        run = self.run_record()
        self.cloud.workers.claim(self.worker_id, {'id': run['id'], 'rev': run['rev']})
        with self.assertRaises(Error):
            self.cloud.workers.select('')
        self.cloud.handle('POST', '/cancel', {'id': run['id']})
        self.cloud.workers.select('')
        self.assertEqual(self.cloud.workers.active(), '')

    def test_revocation_does_not_route_cloud_queue_to_laptop(self):
        self.cloud.handle('POST', '/workers/revoke', {'id': self.worker_id})
        self.assertFalse(self.cloud.workers.authenticate(self.key['token']))
        self.assertEqual(self.cloud.workers.active(), self.worker_id)
        run = self.run_record()
        with self.assertRaises(Error):
            self.cloud.workers.claim(self.worker_id, {'id': run['id'], 'rev': run['rev']})
        with self.assertRaises(Error):
            self.worker.sync()

    def test_command_delivery_at_most_once_and_idempotent_submission(self):
        body = {'request_id': uid(), 'action': 'repos', 'args': {'owner': 'InternetUzer'}}
        first = self.cloud.handle('POST', '/workers/command', body)
        self.assertEqual(first, self.cloud.handle('POST', '/workers/command', body))
        heartbeat = self.cloud.workers.heartbeat(self.worker_id, {'providers': {}, 'projects': []})
        self.assertEqual(heartbeat['command']['id'], first['id'])
        self.assertIsNone(self.cloud.workers.heartbeat(self.worker_id, {})['command'])
        result = {'id': first['id'], 'status': 'done', 'result': {'repos': []}}
        self.cloud.workers.result(self.worker_id, result)
        self.cloud.workers.result(self.worker_id, result)
        self.assertEqual(self.cloud.handle('POST', '/workers/result', {'id': first['id']})['status'], 'done')

    def test_no_commands_delivered_while_agent_busy(self):
        self.cloud.handle('POST', '/workers/command', {'request_id': uid(), 'action': 'repos', 'args': {}})
        self.assertIsNone(self.cloud.workers.heartbeat(self.worker_id, {'busy': True})['command'])
        self.assertIsNotNone(self.cloud.workers.heartbeat(self.worker_id, {'busy': False})['command'])

    def test_clone_does_not_overwrite_or_pull_existing_files(self):
        self.worker.sync()
        args = {'project': self.project['id'], 'repo': self.project['data']['repo']}
        def clone(command, **kwargs):
            target = Path(command[-1])
            (target / '.git').mkdir(parents=True)
            (target / 'work.txt').write_text('Keep me')
            return type('Result', (), {'returncode': 0})()
        with patch('kontur.worker.executable', return_value=['gh']), patch('kontur.worker.subprocess.run', side_effect=clone) as process:
            self.worker.checkout(args)
            self.worker.checkout(args)
            self.assertEqual(process.call_count, 1)
        folder = Path(self.worker.store.setting('paths')[self.project['id']])
        self.assertEqual((folder / 'work.txt').read_text(), 'Keep me')
        self.assertTrue(folder.is_relative_to(self.worker.root / 'projects'))

    def test_keys_and_paths_never_in_cloud_export_or_provider_status(self):
        self.cloud.workers.heartbeat(self.worker_id, {'providers': {'codex': {'installed': True, 'authenticated': True, 'token': 'provider-secret'}}, 'projects': []})
        output = json.dumps(self.cloud.handle('GET', '/state')) + json.dumps(self.cloud.handle('GET', '/export'))
        self.assertNotIn(self.key['token'], output)
        self.assertNotIn('provider-secret', output)
        self.assertNotIn(str(self.worker.root), output)


if __name__ == '__main__':
    unittest.main()
