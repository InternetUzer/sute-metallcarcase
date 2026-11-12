"""Transactional chat import and send. Imported history can never create executions."""
import hashlib
import json
import math
import time
from .store import Error, uid, validate


def stable(*parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()


def project_and_thread(store, project, thread=None):
    p = store.get(project)
    if not p or p['deleted'] or p['kind'] != 'project':
        raise Error('Проект не найден', 404)
    if thread:
        t = store.get(thread)
        if not t or t['deleted'] or t['kind'] != 'conversation' or t['data']['project'] != project:
            raise Error('Диалог не найден в этом проекте', 404)
    return p


def insert(store, db, ident, kind, data):
    validate(kind, data)
    rev = uid()
    store.write(db, dict(id=ident, kind=kind, data=data, rev=rev, base_rev=rev if store.cloud else '',
                         dirty=0 if store.cloud else 1, deleted=0, updated=time.time()))


def import_chat(store, body):
    project = body.get('project')
    chat = body.get('chat')
    project_and_thread(store, project)
    if not isinstance(chat, dict) or chat.get('source') not in {'chatgpt', 'claude'}:
        raise Error('Неизвестный источник чата')
    source = chat['source']
    branches=chat.get('branches',0)
    if not isinstance(branches,int) or isinstance(branches,bool) or branches<0:
        raise Error('Неверное число веток диалога')
    external = chat.get('external_id')
    title = chat.get('title')
    if not isinstance(external, str) or not external or len(external)>1000 or not isinstance(title, str) or not title.strip() or len(title)>240:
        raise Error('Неверные данные диалога')
    messages = chat.get('messages')
    if not isinstance(messages, list) or not 1 <= len(messages) <= 10000:
        raise Error('В одном диалоге должно быть от 1 до 10 000 сообщений')
    ident = stable('conversation', project, source, external)
    rows, seen = [], set()
    for index, m in enumerate(messages):
        if not isinstance(m, dict) or m.get('author') not in {'user',source}:
            raise Error('Неверный автор сообщения')
        if not isinstance(m.get('body'), str) or not m['body'].strip() or len(m['body'])>120000:
            raise Error('Пустое или слишком длинное сообщение (максимум 120 000 символов)')
        if not isinstance(m.get('external_id'), str) or len(m['external_id'])>1000:
            raise Error('Повреждён идентификатор сообщения')
        at=m.get('at',0)
        if not isinstance(at,(int,float)) or isinstance(at,bool) or not math.isfinite(at) or at<0:
            raise Error('Неверная дата сообщения')
        mid=stable('message',ident,m['external_id'])
        if mid in seen:
            raise Error('Повтор идентификатора внутри чата')
        seen.add(mid)
        data={'project':project,'conversation':ident,'author':m['author'],'body':m['body'],
              'at':at,'import_order':index,'imported':True,'source':source,'source_message':m['external_id']}
        validate('message',data)
        rows.append((mid,data))
    added=skipped=changed=0
    with store.lock, store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        project_and_thread(store, project)
        thread=store.unpack(db.execute('SELECT * FROM records WHERE id=?',(ident,)).fetchone())
        if thread and thread['deleted']:
            raise Error('Этот импортированный диалог архивирован. Восстановите его из копии или выберите другой проект.',409)
        if not thread:
            insert(store,db,ident,'conversation',{'project':project,'title':title,'source':source,
                'source_id':external,'imported':True,'branches_omitted':branches, 'created':time.time()})
        for mid,data in rows:
            old=store.unpack(db.execute('SELECT * FROM records WHERE id=?',(mid,)).fetchone())
            if old:
                skipped+=1
                if old['data'].get('body')!=data['body']: changed+=1
                continue
            insert(store,db,mid,'message',data);added+=1
        db.execute('INSERT INTO audit(at,action,title) VALUES(?,?,?)',(time.time(),'Импорт чата',title))
    return {'conversation':ident,'added':added,'skipped':skipped,'changed':changed}


def send_chat(store, body):
    p=project_and_thread(store, body.get('project'),body.get('conversation'))
    prompt=body.get('prompt');request_id=body.get('request_id');mode=body.get('mode')
    if not isinstance(prompt,str) or not prompt.strip() or len(prompt)>30000:
        raise Error('Сообщение должно содержать от 1 до 30 000 символов')
    if not isinstance(request_id,str) or not 8<=len(request_id)<=80:
        raise Error('Неверный идентификатор отправки')
    providers={'chat-codex':['codex'],'chat-claude':['claude'],'chat-both':['codex','claude']}
    roles=p['data'].get('roles',{})
    if mode in providers: steps=[{'role':'chat','provider':v} for v in providers[mode]]
    elif mode in {'lead','code','review','deploy','chain'}:
        steps=[{'role':r,'provider':roles.get(r,'codex' if r in {'lead','review'} else 'claude')} for r in (['lead','code','review'] if mode=='chain' else [mode])]
    elif mode=='message': steps=[]
    else: raise Error('Выбери получателя сообщения')
    mid=stable('send',p['id'],request_id);rid=stable('run',mid)
    fingerprint=stable(body.get('conversation'),prompt,mode)
    with store.lock, store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        old=store.unpack(db.execute('SELECT * FROM records WHERE id=?',(mid,)).fetchone())
        if old:
            if old['data'].get('request_hash')!=fingerprint: raise Error('Отправка уже использована для другого сообщения',409)
            return {'message':mid,'run':rid if steps else None,'duplicate':True}
        data={'project':p['id'],'conversation':body.get('conversation') or None}
        insert(store,db,mid,'message',{**data,'author':'user','body':prompt.strip(),'at':time.time(),'request_hash':fingerprint})
        if steps:
            insert(store,db,rid,'run',{**data,'prompt':prompt.strip(),'status':'queued','steps':steps,
                                     'created':time.time(),'origin':store.setting('device_id')})
    return {'message':mid,'run':rid if steps else None}
