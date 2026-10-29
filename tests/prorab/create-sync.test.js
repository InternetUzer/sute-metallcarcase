const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const S = require('../../static/prorab/sync.js'), M = require('../../static/prorab/model.js');
const C = require('../../static/prorab/project-create.js'), L = require('../../static/prorab/project-lifecycle.js');
const DOC = require('../../static/prorab/document-index.js');
const scope = { window: {} }; vm.runInNewContext(fs.readFileSync('static/prorab/schema.js', 'utf8'), scope);
const schema = scope.window.PRORAB_SCHEMA, root = '/Прораб+', copy = (x) => JSON.parse(JSON.stringify(x));
class Cloud {
  constructor() { this.files = new Map(); this.dirs = new Set(['/']); this.hidden = false; this.fail = false; this.lostReply = false; }
  async mkdir(path) { this.dirs.add(path); }
  async mkdirExclusive(path) { if (this.dirs.has(path) || this.files.has(path)) return false; this.dirs.add(path); return true; }
  async list(path) {
    const items = new Map();
    for (const p of [...this.dirs, ...this.files.keys()]) if (p.startsWith(path + '/')) {
      const rel = p.slice(path.length + 1), name = rel.split('/')[0];
      items.set(name, { name, type: rel.includes('/') || this.dirs.has(p) ? 'dir' : 'file' });
    }
    return items.size || this.dirs.has(path) ? [...items.values()] : null;
  }
  async getText(path) { return this.hidden && path.includes('/data/') ? null : this.files.get(path) ?? null; }
  async putBlob(path, blob, overwrite) {
    if (this.fail) throw Object.assign(new Error('Locked'), { status: 423 });
    if (this.files.has(path) && !overwrite) throw Object.assign(new Error('Exists'), { status: 409 });
    this.files.set(path, await blob.text());
    if (this.lostReply) throw new Error('Connection lost after write');
  }
}
const prepare = (device = 'web-a', name = 'Склад') => C.prepare(root, name, device, schema, new S.Clock(), ['м', 'м²', 'м³', 'шт.']);
const noop = () => {};
const open = (files, pid, device) => { const clock = new S.Clock(); return new M.Project(S.mergeFiles(files, pid, clock), schema, pid, device, clock); };
const file = (p) => S.toFile(p.state, p.projectId, p.project.name, p.me);

test('web creates a complete phone-compatible project and confirms the actual cloud file', async () => {
  const d = new Cloud(), task = prepare(); let checkpoint;
  const result = await C.commit(d, task, t => checkpoint = copy(t));
  const data = JSON.parse(await d.getText(result.path + '/data/web-a.json'));
  assert.ok(S.validFile(data)); assert.equal(data.projectId, task.projectId); assert.equal(data.tables.projects[0].deleted, 0);
  assert.equal(data.tables.units.length, 4); assert.equal(data.fieldVersions, 1);
  for (const table of Object.keys(data.tables)) for (const row of data.tables[table]) assert.deepEqual(Object.keys(row).filter(k => k !== '_v').sort(), Object.keys(schema[table].cols).sort());
  assert.equal(open([data], task.projectId, 'phone').project.name, 'Склад');
  assert.equal(checkpoint.path, result.path); assert.ok(d.dirs.has(result.path + '/files'));
});

test('two concurrent same-name creations reserve different folders and project identities', async () => {
  const d = new Cloud(), a = prepare('web-a'), b = prepare('web-b');
  const both = await Promise.all([C.commit(d, a, noop), C.commit(d, b, noop)]);
  assert.notEqual(both[0].path, both[1].path); assert.notEqual(a.projectId, b.projectId);
  assert.deepEqual(both.map(p => p.path).sort(), [root + '/Склад', root + '/Склад (2)']);
  assert.equal(d.files.size, 2);
});

test('existing data and deleted project folders are not reused by a new object', async () => {
  const d = new Cloud(), a = prepare(); await C.commit(d, a, noop);
  await L.change(d, a.path, a.projectId, 'delete', 'web-a', 'event-1');
  const old = [...d.files.entries()], b = prepare(); await C.commit(d, b, noop);
  assert.notEqual(a.path, b.path); for (const [path, text] of old) assert.equal(d.files.get(path), text);
});

test('423 and reload resume the saved creation without another identity or folder', async () => {
  const d = new Cloud(), task = prepare(); let pending;
  d.fail = true; await assert.rejects(C.commit(d, task, t => pending = copy(t)), e => e.status === 423);
  const reserved = task.path; d.fail = false;
  const result = await C.commit(d, pending, noop);
  assert.equal(result.path, reserved); assert.equal(result.projectId, task.projectId); assert.equal(d.files.size, 1);
});

test('lost success response and unconfirmed readback never create a duplicate on retry', async () => {
  for (const failure of ['lostReply', 'hidden']) {
    const d = new Cloud(), task = prepare(); d[failure] = true;
    await assert.rejects(C.commit(d, task, noop));
    const path = task.path; d[failure] = false; await C.commit(d, copy(task), noop);
    assert.equal(d.files.size, 1); assert.equal(task.path, path);
  }
});

test('pending creation cannot overwrite changed data or revive a deleted object', async () => {
  const d = new Cloud(), task = prepare(); await C.commit(d, task, noop);
  const path = task.path + '/data/web-a.json'; d.files.set(path, 'changed');
  await assert.rejects(C.commit(d, task, noop), /уже изменились/); assert.equal(d.files.get(path), 'changed');
  await L.change(d, task.path, task.projectId, 'delete', 'web-b', 'event-1');
  await assert.rejects(C.commit(d, task, noop), /удалён/);
});

test('invalid or hidden names and unavailable recovery storage are rejected before cloud writes', async () => {
  for (const name of ['', '.hidden', '../object', 'a/b', 'a\n', 'x'.repeat(121)]) assert.throws(() => prepare('web-a', name));
  const d = new Cloud(); await assert.rejects(C.commit(d, prepare(), () => { throw new Error('Storage full'); }), /Storage full/);
  assert.equal(d.dirs.size, 1); assert.equal(d.files.size, 0);
});

test('two client files converge after additions, independent edits, deletions and stale replays', async () => {
  const task = prepare(), initial = JSON.parse(task.text), pid = task.projectId;
  const web = open([initial], pid, 'web-a'), phone = open([initial], pid, 'phone');
  web.put('remarks', 'r', { projectId: pid, text: 'Замечание из веба', number: 1 });
  phone.saveTask({ date: 20760, title: 'Задача с телефона' });
  const first = [file(web), file(phone)];
  const a = open(first, pid, 'web-a'), b = open(first, pid, 'phone');
  a.put('remarks', 'r', { text: 'Текст исправлен в вебе' }); b.put('remarks', 'r', { status: 'DONE' });
  const second = [file(a), file(b)];
  const c = open(second, pid, 'web-a'), e = open(second.slice().reverse(), pid, 'phone');
  assert.equal(c.get('remarks', 'r').text, 'Текст исправлен в вебе'); assert.equal(c.get('remarks', 'r').status, 'DONE');
  assert.deepEqual(c.rows('remarks'), e.rows('remarks')); assert.equal(c.rows('tasks').length, 1);
  c.put('remarks', 'r', { deleted: 1 });
  const merged = open([initial, ...first, ...second, file(c)], pid, 'phone');
  assert.equal(merged.rows('remarks').length, 0); assert.equal(merged.rows('tasks').length, 1);
});

test('shared deletion blocks another web writer; restore retains data and shared documents', async () => {
  const d = new Cloud(), task = prepare(); await C.commit(d, task, noop);
  d.files.set(task.path + '/' + DOC.SHARED + '/report.pdf', 'test-document');
  const before = [...d.files.entries()];
  await L.change(d, task.path, task.projectId, 'delete', 'web-a', 'event-1');
  await assert.rejects(L.assertActive(d, task.path, task.projectId), /удалён/);
  await L.change(d, task.path, task.projectId, 'restore', 'web-b', 'event-2');
  await L.assertActive(d, task.path, task.projectId);
  for (const [path, text] of before) assert.equal(d.files.get(path), text);
  assert.equal((await DOC.scan(d, task.path)).files[0].name, 'report.pdf');
});
