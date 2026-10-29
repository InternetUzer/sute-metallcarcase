const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const S = require('../../static/prorab/sync.js'), M = require('../../static/prorab/model.js');
const ROOT = '/Диск Прораб+', delay = ms => new Promise(r => setTimeout(r, ms));
function application(fakeDisk) {
  const raw = new Map(), notices = [];
  const localStorage = { getItem: k => raw.get(k) ?? null, setItem: (k,v) => raw.set(k,v), removeItem: k => raw.delete(k), key: i => [...raw.keys()][i], get length() { return raw.size; } };
  const window = { ProrabSync: S, ProrabModel: M, ProrabPersistence: require('../../static/prorab/persistence.js'),
    ProrabVault: require('../../static/prorab/vault.js'), ProrabEconomy: require('../../static/prorab/economy.js'), ProrabEconomyStore: require('../../static/prorab/economy-store.js'),
    ProrabLifecycle: require('../../static/prorab/project-lifecycle.js'), ProrabDisk: { normalize: p => p }, addEventListener() {} };
  const app = { dataset: { root: ROOT }, classList: { remove() {} } };
  const ctx = { window, localStorage, navigator: {}, location: {}, history: {}, Blob, URLSearchParams, queueMicrotask,
    document: { getElementById: id => id === 'prorab' ? app : null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, confirm: () => true };
  vm.runInNewContext(fs.readFileSync('static/prorab/schema.js', 'utf8'), ctx);
  let code = fs.readFileSync('static/prorab/app.js', 'utf8');
  code = code.replace(/  start\(\);\s*\}\)\(\);\s*$/, `
    render = () => {}; notify = (text) => window.notices.push(text);
    store = R.accountStorage(rawStorage, PREFIX, 'fixture');
    projects = []; home.items = []; me = 'web-fixture';
    window.review = { loadProjects, reloadFolder, readFiles, saveDesk, flushDesk, loadDesk, setLinks, changeProjectState,
      setup(d) { disk = d; }, context(path, c) { ctxs[path] = c; },
      state() { return { projects, home, status, deskPending, links: linkList }; },
      cache() { return store.json(CACHE_KEY, null); },
      pending() { return store.get(deskDraftKey()); },
      restartDesk() { deskPending = null; linkList = []; },
      loadCached() { projects = null; home.items = null; cachedProjects(); }
    };
  })();`);
  window.notices = notices; vm.runInNewContext(code, ctx); window.review.setup(fakeDisk);
  return { api: window.review, schema: window.PRORAB_SCHEMA, notices };
}

test('simultaneous desktop refreshes share one scan; a mutation queues only one follow-up', async () => {
  let roots = 0, active = 0, max = 0;
  const paths = Array.from({length:20}, (_,i) => ({ name: 'Объект ' + i, type:'dir' }));
  const d = { async list(p) { active++; max = Math.max(max,active); await delay(3); active--; if (p === ROOT) { roots++; return paths; } return [{name:'data',type:'dir'}]; } };
  const { api } = application(d);
  await Promise.all([api.loadProjects(),api.loadProjects(),api.loadProjects()]);
  assert.equal(roots,1); assert.equal(api.state().projects.length,20); assert.ok(max<=8);
  const first=api.loadProjects(); await Promise.all([first,api.loadProjects(true),api.loadProjects(true)]);
  assert.equal(roots,3); // first shared scan + second scan + one rescan
});

test('confirmed shortcut edits are instant local changes, do not scan projects, and survive an older in-flight scan', async () => {
  let release, entered; const gate=new Promise(r=>entered=r); const wait=new Promise(r=>release=r); let reads=0;
  const { api } = application({ async list(p) { reads++; if(p===ROOT) return [{name:'Объект',type:'dir'}]; entered(); await wait; return [{name:'data',type:'dir'}]; } });
  const scan=api.loadProjects(); await gate;
  const before=reads; api.reloadFolder(ROOT,'',{add:{name:'Новый.url',type:'file'}}); assert.equal(reads,before);
  assert.equal(api.state().home.items[0].name,'Новый.url'); release(); await scan;
  assert.equal(api.state().home.items[0].name,'Новый.url');
  api.reloadFolder(ROOT,'',{remove:'Новый.url',add:{name:'Переименован.url',type:'file'}});
  api.loadCached(); assert.equal(api.state().home.items[0].name,'Переименован.url');
  api.reloadFolder(ROOT,'',{remove:'Переименован.url'}); assert.equal(api.state().home.items.length,0); assert.equal(reads,before);
});

test('device files load in parallel, reuse only matching md5, and fetch changed content', async () => {
  let active=0,max=0,reads=0, changed=false;
  const { api,schema }=application({ async list(){return Array.from({length:8},(_,i)=>({name:i+'.json',type:'file',md5:changed&&i===0?'changed':'same'+i}));},
    async getText(path){reads++;active++;max=Math.max(max,active);await delay(4);active--;return JSON.stringify(file);} });
  const p=new M.Project({},schema,'project','phone',new S.Clock());p.put('projects','project',{name:'Объект'});let file=S.toFile(p.state,'project','Объект','phone');
  await api.readFiles(ROOT+'/Объект');assert.equal(reads,8);assert.equal(max,4);
  const first=await api.readFiles(ROOT+'/Объект');assert.equal(reads,8);
  first[0].tables.projects[0].name='local mutation';
  const next=await api.readFiles(ROOT+'/Объект');assert.equal(next[0].tables.projects[0].name,'Объект');
  changed=true;p.put('projects','project',{name:'Изменён на телефоне'});file=S.toFile(p.state,'project','Объект','phone');
  const result=await api.readFiles(ROOT+'/Объект');assert.equal(reads,9);assert.equal(result[0].tables.projects[0].name,'Изменён на телефоне');
});

test('desktop settings serialize uploads and keep the latest change when a prior save is still in flight', async () => {
  let stored=null, release, entered, uploads=0,active=0,max=0;
  const gate=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
  const {api}=application({async mkdir(){}, async getText(){return stored;}, async putText(path,text){active++;max=Math.max(max,active);uploads++;if(uploads===1){entered();await wait;}stored=text;active--;}});
  api.setLinks([{path:'/one',name:'Первый'}]);await gate;
  api.setLinks([{path:'/one',name:'Первый'},{path:'/two',name:'Второй'}]);
  assert.ok(api.pending());release();await api.flushDesk();assert.equal(max,1);assert.equal(uploads,2);
  assert.equal(JSON.parse(stored).links.length,2);assert.equal(api.pending(),null);
});

test('desktop settings failure remains pending across restart and late startup data cannot erase a new shortcut', async () => {
  let stored=JSON.stringify({version:1,links:[]}),fail=true;
  const {api}=application({async mkdir(){},async getText(){return stored;},async putText(path,text){if(fail)throw new Error('423');stored=text;}});
  api.setLinks([{path:'/keep',name:'Сохранить'}]);await api.flushDesk();assert.ok(api.pending());
  api.restartDesk();fail=false;await api.loadDesk();await api.flushDesk();assert.equal(api.state().links[0].path,'/keep');assert.equal(api.pending(),null);
  let release,entered;const gate=new Promise(r=>entered=r),wait=new Promise(r=>release=r);let first=true;
  api.setup({async mkdir(){},async getText(){if(first){first=false;entered();await wait;return JSON.stringify({version:1,links:[]});}return stored;},async putText(path,text){stored=text;}});
  const loading=api.loadDesk();await gate;api.setLinks([{path:'/new',name:'Новый'}]);release();await loading;await api.flushDesk();
  assert.equal(api.state().links[0].path,'/new');
});

test('deleting an old open card refuses a different project now occupying that cloud path', async () => {
  let changes=0; const path=ROOT+'/Объект';
  const {api,schema,notices}=application({async list(){return [{name:'phone.json',type:'file'}];},async getText(){return JSON.stringify(file);},async putBlob(){changes++;},async mkdir(){changes++;},async remove(){changes++;}});
  const p=new M.Project({},schema,'replacement','phone',new S.Clock());p.put('projects','replacement',{name:'Замена'});const file=S.toFile(p.state,p.projectId,'Замена','phone');
  api.context(path,{project:{projectId:'previous',dirty:false}});await api.changeProjectState({path,name:'Объект'},'delete');
  assert.equal(changes,0);assert.ok(notices[0].includes('состав файлов изменился'));
});
