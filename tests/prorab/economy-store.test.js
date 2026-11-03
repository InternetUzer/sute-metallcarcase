const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../static/prorab/vault.js');
const E = require('../../static/prorab/economy.js');
const R = require('../../static/prorab/persistence.js');
const { Session, acquire } = require('../../static/prorab/economy-store.js');
const CODE = 'test-only-long-passphrase';
const PATH = '/Прораб+ Экономика/economy.prorab.json';
function storage() {
  const m = new Map();
  return { get: (k) => m.get(k) ?? null, set(k, v) { v == null ? m.delete(k) : m.set(k, v); return true; }, m };
}
function disk() {
  return { file: null, offline: false, uploads: [],
    async getText() { if (this.offline) throw new Error('offline'); return this.file; },
    async putText(path, text) { if (this.offline) throw new Error('offline'); this.uploads.push(text); this.file = text; },
    async putBlob(path, blob, overwrite) { assert.equal(overwrite, false); if (this.file) throw new Error('already exists'); return this.putText(path, await blob.text()); },
  };
}
async function fixture() {
  const d = disk(), store = storage(), s = new Session(d, store, PATH);
  const { vault, recovery } = await V.create(CODE, { iterations: 1000 });
  await s.initialize(vault); await s.sync();
  return { d, store, s, recovery };
}

test('offline edit survives lock, reload and retry, only ciphertext is stored', async () => {
  const { d, store, s } = await fixture();
  d.offline = true;
  await s.edit((data) => E.setFields(data, 'p', { contractCents: 987654321, note: 'confidential-example' }));
  assert.ok(s.pending());
  assert.ok(!s.pending().includes('987654321')); assert.ok(!s.pending().includes('confidential-example'));
  assert.ok(!s.pending().includes(CODE));
  await assert.rejects(s.sync(), /offline/);
  await s.close(); assert.equal(s.data, null); assert.equal(s.vault, null);
  const next = new Session(d, store, PATH);
  await assert.rejects(next.unlock('wrong'), /Неверный код/);
  assert.equal(await next.unlock(CODE), true);
  assert.equal(next.data.projects.p.contractCents, 987654321);
  d.offline = false; await next.sync();
  assert.equal(next.pending(), null);
  const result = await V.open(await V.unlock(JSON.parse(d.file), CODE), JSON.parse(d.file));
  assert.equal(result.projects.p.note, 'confidential-example');
});

test('a completed older upload does not erase a newer encrypted draft', async () => {
  const { d, store, s } = await fixture();
  await s.edit((data) => E.setFields(data, 'p', { note: 'first' }));
  let release, started;
  const gate = new Promise((r) => { started = r; });
  const put = d.putText.bind(d);
  d.putText = async (path, text) => { started(); await new Promise((r) => { release = r; }); await put(path, text); };
  const upload = s.sync(); await gate;
  await s.edit((data) => E.setFields(data, 'p', { note: 'second' }));
  const newer = s.pending();
  const closing = s.close(); await s.queue;
  release(); await upload; await closing;
  assert.equal(store.get(s.draftKey), newer);
  d.putText = put;
  const next = new Session(d, store, PATH); await next.unlock(CODE); await next.sync();
  assert.equal(next.data.projects.p.note, 'second');
  assert.equal(next.pending(), null);
});

test('save merges cloud edits even if local and remote revision counters are equal', async () => {
  const { d, s } = await fixture();
  await s.edit((data) => E.setFields(data, 'p', { note: 'local' }));
  const theirs = E.empty(); E.setFields(theirs, 'p', { contractCents: 12300 });
  d.file = JSON.stringify(await V.seal(s.vault, theirs, s.rev));
  await s.sync();
  assert.equal(s.data.projects.p.note, 'local');
  assert.equal(s.data.projects.p.contractCents, 12300);
});

test('quota failure does not accept edit, previous encrypted draft and form values remain usable', async () => {
  const { store, s } = await fixture();
  await s.edit((data) => E.setFields(data, 'p', { note: 'saved' }));
  const before = s.pending(); store.set = () => false;
  await assert.rejects(s.edit((data) => E.setFields(data, 'p', { note: 'not accepted' })), /черновик/);
  assert.equal(s.data.projects.p.note, 'saved'); assert.equal(s.pending(), before);
});

test('failed password change keeps an encrypted copy under old code and reports failure', async () => {
  const { d, store, s } = await fixture();
  await s.edit((data) => E.setFields(data, 'p', { contractCents: 3400 })); await s.sync();
  d.putText = async () => { throw new Error('network failure'); };
  await assert.rejects(s.changeCode('another-long-code'), /network failure/);
  const next = new Session(d, store, PATH);
  await assert.rejects(next.unlock('another-long-code'), /Неверный код/);
  await next.unlock(CODE); assert.equal(next.data.projects.p.contractCents, 3400);
});

test('password change waits for actual upload confirmation and keeps recovery working', async () => {
  const { d, store, s, recovery } = await fixture();
  await s.changeCode('new-long-test-code');
  assert.equal(s.pending(), null);
  const next = new Session(d, store, PATH);
  await assert.rejects(next.unlock(CODE), /Неверный код/);
  await next.unlock('new-long-test-code');
  const recovered = new Session(d, store, PATH); await recovered.unlock(recovery, true);
  assert.deepEqual(recovered.data, E.empty());
});

test('upload accepted but not visible never clears local draft or reports success', async () => {
  const { d, s } = await fixture();
  await s.edit((data) => E.setFields(data, 'p', { note: 'keep' }));
  d.putText = async () => {};
  await assert.rejects(s.sync(), /не подтвердил/); assert.ok(s.pending());
});

test('autosave and another code change cannot overwrite an in-flight password change', async () => {
  const { d, s } = await fixture();
  let release, entered;
  const gate = new Promise((r) => { entered = r; });
  const put = d.putText.bind(d);
  d.putText = async (path, text) => { entered(); await new Promise((r) => { release = r; }); await put(path, text); };
  const changing = s.changeCode('new-password-confirmed'); await gate;
  await assert.rejects(s.sync(), /смены кода/);
  await assert.rejects(s.changeCode('third-code'), /смены кода/);
  await assert.rejects(s.edit((data) => E.setFields(data, 'p', { note: 'during change' })), /смены кода/);
  release(); await changing;
  assert.equal(s.pending(), null);
  assert.ok(await V.unlock(JSON.parse(d.file), 'new-password-confirmed'));
  await assert.rejects(V.unlock(JSON.parse(d.file), CODE), /Неверный код/);
});

test('corrupt cloud payload cannot become an empty economy or overwrite a valid file', async () => {
  const { d, store, s } = await fixture();
  await s.edit((data) => E.setFields(data, 'p', { note: 'keep' }));
  const bad = JSON.parse(d.file); delete bad.payload; d.file = JSON.stringify(bad);
  await assert.rejects(s.sync(), /формат/); assert.ok(s.pending());
  const local = new Session(d, store, PATH); await local.unlock(CODE);
  assert.equal(local.data.projects.p.note, 'keep');
});

test('one computer: two tabs cannot edit the same vault until it is closed', async () => {
  const held = new Set();
  const locks = { async request(name, opts, cb) {
    if (held.has(name)) return cb(null);
    held.add(name); try { await cb({ name }); } finally { held.delete(name); }
  } };
  const release = await acquire(locks, 'account-a:/vault');
  await assert.rejects(acquire(locks, 'account-a:/vault'), /другой вкладке/);
  const other = await acquire(locks, 'account-b:/vault'); other();
  release(); await new Promise((r) => setImmediate(r));
  (await acquire(locks, 'account-a:/vault'))();
  await assert.rejects(acquire(null, 'anything'), /Web Locks/);
});

test('drafts are scoped to both Yandex account and vault path', async () => {
  const map = new Map();
  const raw = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
  const a = R.accountStorage(raw, 'prorab.', 'alice'), b = R.accountStorage(raw, 'prorab.', 'bob');
  const s = new Session(disk(), a, PATH), v = await V.create(CODE, { iterations: 1000 });
  await s.initialize(v.vault);
  assert.ok(s.pending());
  assert.equal(new Session(disk(), b, PATH).pending(), null);
  assert.equal(new Session(disk(), a, '/other').pending(), null);
});
