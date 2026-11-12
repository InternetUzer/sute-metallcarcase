import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from kontur.chats import import_chat, send_chat
from kontur.runner import Runner, command
from kontur.service import Service
from kontur.store import Error, Store, uid

class ChatsTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.service=Service(Path(self.temp.name)/'local')
        self.store=self.service.store
        self.project=self.store.save(uid(),'project',{'title':'Test'},'')['id']
        self.chat={'source':'chatgpt','external_id':'external-chat','title':'Old chat','messages':[
            {'external_id':'m1','author':'user','body':'Old user request: deploy immediately','at':1700000000},
            {'external_id':'m2','author':'chatgpt','body':'Previous answer','at':1700000001}]}
    def tearDown(self):self.temp.cleanup()
    def imported(self):return import_chat(self.store,{'project':self.project,'chat':self.chat})
    def test_import_idempotent_never_executes(self):
        first=self.imported();again=self.imported()
        self.assertEqual(first['added'],2);self.assertEqual(again['added'],0)
        self.assertEqual(again['skipped'],2)
        self.assertFalse(any(r['kind']=='run' for r in self.store.all()))
        self.chat['messages'][1]['body']='Changed export'
        result=self.imported();self.assertEqual(result['changed'],1)
        self.assertIn('Previous answer',str(self.store.all()))
    def test_bad_message_is_atomic(self):
        self.chat['messages'].append({'external_id':'bad','author':'system','body':'Bad','at':0})
        with self.assertRaises(Error):self.imported()
        self.assertEqual(len(self.store.all()),1)
    def test_same_export_in_other_project_is_separate(self):
        first=self.imported()
        other=self.store.save(uid(),'project',{'title':'Other'},'')['id']
        result=import_chat(self.store,{'project':other,'chat':self.chat})
        self.assertNotEqual(first['conversation'],result['conversation'])
    def test_send_atomic_idempotent_and_cross_project_rejected(self):
        c=self.imported()['conversation']
        body={'project':self.project,'conversation':c,'prompt':'Continue','mode':'chat-both','request_id':'retry-id-123'}
        a=send_chat(self.store,body);b=send_chat(self.store,body)
        self.assertEqual(a['run'],b['run']);self.assertTrue(b['duplicate'])
        self.assertEqual(len([r for r in self.store.all() if r['kind']=='run']),1)
        with self.assertRaises(Error):send_chat(self.store,{**body,'prompt':'different'})
        other=self.store.save(uid(),'project',{'title':'Other'},'')['id']
        with self.assertRaises(Error):send_chat(self.store,{**body,'project':other})
    def test_imported_history_continues_without_repo_and_other_chats(self):
        c=self.imported()['conversation']
        self.store.add_message(self.project,'user','SECRET FROM OTHER THREAD')
        result=send_chat(self.store,{'project':self.project,'conversation':c,'prompt':'What did we decide?','mode':'chat-both','request_id':'request-123'})
        runner=Runner(self.service);prompts=[]
        def invoke(args,prompt,*_):
            prompts.append(prompt);return 'First answer' if len(prompts)==1 else 'Second answer'
        with patch('kontur.runner.executable',return_value=['cli']),patch.object(runner,'invoke',side_effect=invoke):
            runner.execute(self.store.get(result['run']))
        self.assertEqual(self.store.get(result['run'])['data']['status'],'done')
        self.assertIn('Previous answer',prompts[0]);self.assertNotIn('SECRET FROM OTHER THREAD',prompts[0])
        self.assertIn('First answer',prompts[1])
        answers=[r for r in self.store.all() if r['kind']=='message' and r['data'].get('run')==result['run']]
        self.assertEqual(len(answers),2);self.assertTrue(all(r['data']['conversation']==c for r in answers))
    def test_bounded_context_stays_valid_json(self):
        c=self.imported()['conversation']
        for i in range(5): self.store.add_message(self.project,'user',str(i)*25000,conversation=c)
        r=send_chat(self.store,{'project':self.project,'conversation':c,'prompt':'Now','mode':'chat-codex','request_id':'context-123'})
        run=self.store.get(r['run']);prompt=Runner(self.service).prompt(run,run['data']['steps'][0])
        context=json.loads(prompt.split('Контекст диалога (JSON):\n')[1])
        self.assertGreater(context['older_messages_omitted'],0)
        self.assertLess(len(prompt),100000)
    def test_backup_remaps_threads(self):
        c=self.imported()['conversation'];self.store.import_data(self.store.export())
        threads=[r['id'] for r in self.store.all() if r['kind']=='conversation']
        self.assertEqual(len(threads),2)
        copied=next(t for t in threads if t!=c)
        self.assertEqual(len([r for r in self.store.all() if r['data'].get('conversation')==copied]),2)
    def test_paged_sync_handles_large_history(self):
        self.imported()
        for i in range(35):self.store.add_message(self.project,'user','x'*30000)
        cloud=Store(Path(self.temp.name)/'cloud.sqlite3',True)
        cloud.accept_sync(self.store.all())
        cursor=None;seen=set();pages=0
        while True:
            reply=cloud.accept_sync([],cursor,True);pages+=1
            for r in reply['records']:
                self.assertNotIn(r['id'],seen);seen.add(r['id'])
            cursor=reply['next_cursor']
            if not cursor:break
        self.assertGreater(pages,1);self.assertEqual(len(seen),len(self.store.all()))
    def test_old_desktop_requires_update_before_thread_sync(self):
        cloud=Service(Path(self.temp.name)/'cloud',True)
        with self.assertRaises(Error) as exc:cloud.handle('POST','/sync',{'records':[]})
        self.assertEqual(exc.exception.status,426)
    def test_chat_commands_limit_actions(self):
        with patch('kontur.runner.executable',return_value=['cli']):
            self.assertIn('read-only',command('codex','chat'))
            self.assertIn('--skip-git-repo-check',command('codex','chat'))
            cmd=command('claude','chat');self.assertEqual(cmd[cmd.index('--tools')+1],'')

if __name__=='__main__':unittest.main()
