const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../../static/prorab/sync.js');
const M = require('../../static/prorab/model.js');
const R = require('../../static/prorab/persistence.js');

function memory() {
  const data = new Map();
  return { get length() { return data.size; }, key: (i) => [...data.keys()][i],
    getItem: (k) => data.has(k) ? data.get(k) : null,
    setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}
function locks() {
  const held = new Set();
  return { async request(name, opts, callback) {
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name }); } finally { held.delete(name); }
  } };
}
const file = (text) => ({ format: 1, app: 'technadzor', projectId: 'p', tables: { projects: [{ id: 'p', name: text }] } });

test('same folder and project id under another Yandex account cannot read or upload old drafts', () => {
  const raw = memory();
  const a = R.accountStorage(raw, 'prorab.', 'alice');
  const b = R.accountStorage(raw, 'prorab.', 'bob');
  const da = new R.Drafts(a, '/Прораб+/Объект', 'p', 'web-A');
  da.write(file('private'));
  a.set('extra', '["/private"]');
  assert.equal(new R.Drafts(b, '/Прораб+/Объект', 'p', 'web-B').read().length, 0);
  assert.equal(b.get('extra'), null);
  assert.equal(new R.Drafts(R.accountStorage(raw, 'prorab.', 'alice'), '/Прораб+/Объект', 'p', 'web-C').read()[0].file.tables.projects[0].name, 'private');
  assert.throws(() => R.accountStorage(raw, 'prorab.', ''));
});

test('two tabs reserve distinct writer files, closed slot is reused without an ever-growing file per reload', async () => {
  const store = R.accountStorage(memory(), 'prorab.', 'alice');
  const manager = locks();
  const a = await R.acquireWriter(store, manager);
  const b = await R.acquireWriter(store, manager);
  assert.notEqual(a.id, b.id);
  a.release();
  await new Promise((r) => setImmediate(r));
  const c = await R.acquireWriter(store, manager);
  assert.equal(c.id, a.id);
  b.release(); c.release();
  const d = await R.acquireWriter(store, null), e = await R.acquireWriter(store, null);
  assert.notEqual(d.id, e.id);
});

test('successful old upload cannot erase a newer draft or a draft from another project', () => {
  const store = R.accountStorage(memory(), 'prorab.', 'alice');
  const a = new R.Drafts(store, '/object', 'p', 'web-A');
  const b = new R.Drafts(store, '/object', 'p', 'web-B');
  const other = new R.Drafts(store, '/object', 'other', 'web-A');
  a.write(file('old')); b.write(file('second tab'));
  other.write({ ...file('elsewhere'), projectId: 'other' });
  const sending = a.read();
  a.write(file('new while uploading'));
  a.acknowledge(sending);
  assert.equal(a.read().length, 1);
  assert.equal(a.read()[0].file.tables.projects[0].name, 'new while uploading');
  assert.equal(other.read().length, 1);
});

test('quota and corrupt drafts are reported, never silently discarded', () => {
  const raw = memory();
  const store = R.accountStorage(raw, 'prorab.', 'alice');
  const draft = new R.Drafts(store, '/object', 'p', 'web-A');
  store.set(draft.key, '{broken');
  assert.throws(() => draft.read(), /сохранённые правки/);
  raw.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(draft.write(file('new')), false);
  assert.equal(store.get(draft.key), '{broken');
});

// Exercise the real application save/refresh functions with a delayed Disk. No live
// API, tokens, DOM, or production records are used. Only rendering and timers are stubbed.
function application() {
  const raw = memory();
  const window = { ProrabSync: S, ProrabModel: M, ProrabPersistence: R,
    ProrabDisk: { normalize: (p) => p }, addEventListener() {} };
  const root = { dataset: {}, classList: { remove() {} } };
  const ctx = { window, localStorage: raw, navigator: {}, location: {}, history: {},
    document: { getElementById: (id) => id === 'prorab' ? root : null, querySelector: () => null, addEventListener() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, queueMicrotask,
    URLSearchParams, console };
  vm.runInNewContext(fs.readFileSync('static/prorab/schema.js', 'utf8'), ctx);
  let source = fs.readFileSync('static/prorab/app.js', 'utf8');
  source = source.replace(/  start\(\);\s*\}\)\(\);\s*$/, `
    render = () => {};
    window.review = { save, refreshCtx, persistAll, changed, takeTokenFromUrl, beginYandexLogin,
      setup(c, fakeDisk) {
        disk = fakeDisk; me = 'web-test';
        store = R.accountStorage(rawStorage, PREFIX, 'test-account');
        c.drafts = new R.Drafts(store, c.path, c.project.projectId, me);
        ctxs[c.path] = c; watchChanges(c);
      }
    };
  })();`);
  vm.runInNewContext(source, ctx);
  const p = new M.Project({}, window.PRORAB_SCHEMA, 'p', 'web-test', new S.Clock());
  p.put('projects', 'p', { name: 'Объект' });
  const c = { path: '/object', project: p, saving: false };
  return { api: window.review, c, p, ctx, raw };
}

test('edit while upload is in flight remains durable after the earlier upload succeeds', async () => {
  const { api, c, p } = application();
  let complete, uploaded;
  api.setup(c, { putText: async (path, text) => { uploaded = JSON.parse(text); await new Promise((r) => { complete = r; }); } });
  const saving = api.save(c);
  p.put('projects', 'p', { address: 'Added during upload' });
  await Promise.resolve();
  complete(); await saving;
  assert.equal(uploaded.tables.projects[0].address, '');
  assert.equal(p.dirty, true);
  assert.equal(c.drafts.read()[0].file.tables.projects[0].address, 'Added during upload');
});

test('network error retains draft and retry acknowledges it only after success', async () => {
  const { api, c, p } = application();
  let failing = true;
  api.setup(c, { putText: async () => { if (failing) throw new Error('offline'); } });
  await api.save(c);
  assert.equal(p.dirty, true); assert.equal(c.drafts.read().length, 1);
  failing = false; await api.save(c);
  assert.equal(p.dirty, false); assert.equal(c.drafts.read().length, 0);
});

test('refresh preserves Project reference captured by an ongoing drawing upload', async () => {
  const { api, c, p } = application();
  const phone = S.toFile(p.state, 'p', 'Объект', 'phone');
  api.setup(c, { list: async () => [{ type: 'file', name: 'phone.json' }], getText: async () => JSON.stringify(phone) });
  await api.refreshCtx(c);
  assert.equal(c.project, p);
  p.addDrawing({ id: 'drawing', name: 'План', kind: 'pdf', file: 'drawing.pdf', pages: 1 });
  await Promise.resolve();
  assert.equal(c.drafts.read()[0].file.tables.drawings[0].id, 'drawing');
});


test('OAuth callback requires a recent state created by this browser, preserves current account on unsolicited token', () => {
  const { api, ctx, raw } = application();
  ctx.history.replaceState = () => {};
  ctx.location.pathname = '/prorab'; ctx.location.search = '';
  ctx.location.hash = '#access_token=unrequested-token';
  raw.setItem('prorab.token', 'existing-account');
  assert.throws(() => api.takeTokenFromUrl(), /проверить возврат/);
  assert.equal(raw.getItem('prorab.token'), 'existing-account');
  let opened;
  ctx.window.open = (url, target, features) => { opened = { url, target, features }; };
  api.beginYandexLogin('https://oauth.yandex.ru/authorize?client_id=public');
  const state = JSON.parse(raw.getItem('prorab.oauth-state'));
  assert.equal(opened.features, 'noopener');
  ctx.location.hash = '#access_token=requested-token&state=' + encodeURIComponent(state.value);
  api.takeTokenFromUrl();
  assert.equal(raw.getItem('prorab.token'), 'requested-token');
  assert.equal(raw.getItem('prorab.oauth-state'), null);
});
