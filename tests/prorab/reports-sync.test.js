const test = require('node:test');
const assert = require('node:assert/strict');
const REPORT = require('../../static/prorab/remarks-report.js');
const LIFE = require('../../static/prorab/project-lifecycle.js');
const DOCS = require('../../static/prorab/document-index.js');
const { Log } = require('../../static/prorab/diagnostics.js');
const { Project } = require('../../static/prorab/model.js');
const S = require('../../static/prorab/sync.js');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const scope = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../static/prorab/schema.js'), 'utf8'), scope);
const schema = scope.window.PRORAB_SCHEMA;

function project() {
  const p = new Project({}, schema, 'project-1', 'web-1', new S.Clock());
  p.put('projects', 'project-1', { name: 'Склад' });
  p.put('contractors', 'person-1', { projectId: p.projectId, name: 'Подрядчик' });
  p.put('remarks', 'remark-1', { projectId: p.projectId, number: 1, date: 20750, text: 'Трещина', contractorId: 'person-1', status: 'OPEN', dueDate: 20760 });
  p.put('remarks', 'remark-2', { projectId: p.projectId, number: 2, date: 20750, text: 'Заделка', status: 'DONE', contractorId: 'person-1', doneDate: 20751 });
  p.addDrawing({ id: 'drawing-1', name: 'План', kind: 'pdf', file: 'plan.pdf', pages: 2 });
  p.saveNote({ id: 'note-1', drawingId: 'drawing-1', page: 1, x: 120, y: 240, text: 'Зазор', contractorId: 'person-1' });
  for (const [id, owner] of [['before', 'note-1'], ['after', 'remark-2:done']]) p.put('attachments', id, { projectId: p.projectId, ownerId: owner, kind: 'photo', file: id + '.jpg' });
  return p;
}
class Disk {
  constructor() { this.files = new Map(); this.dirs = new Set(); }
  async mkdir(path) { this.dirs.add(path); }
  async list(path) {
    const out = new Map();
    for (const f of [...this.files.keys(), ...this.dirs]) if (f.startsWith(path + '/')) {
      const rel = f.slice(path.length + 1), name = rel.split('/')[0];
      out.set(name, { name, type: rel.includes('/') || this.dirs.has(f) ? 'dir' : 'file' });
    }
    return [...out.values()];
  }
  async getText(path) { return this.files.get(path) || null; }
  async putBlob(path, blob, overwrite) { assert.equal(overwrite, false); assert.ok(!this.files.has(path)); this.files.set(path, await blob.text()); }
}
test('отчёт объединяет журнал и пометки, не теряет владельцев фотографий до/после', () => {
  const p = project(), rows = REPORT.rows(p), note = rows.find((r) => r.key === 'note:note-1');
  assert.equal(rows.length, 3); assert.equal(note.before[0].file, 'before.jpg');
  assert.equal(note.page, 1); assert.equal(note.drawing.name, 'План');
  assert.equal(rows.find((r) => r.id === 'remark-2').after[0].file, 'after.jpg');
  // Captured report rows must not drift while the project keeps synchronizing.
  p.put('drawing_notes', 'note-1', { text: 'Поздняя правка' }); assert.equal(note.text, 'Зазор');
});
test('предписание включает только выбранные открытые замечания своего исполнителя', () => {
  const all = REPORT.rows(project());
  assert.throws(() => REPORT.selectRows(all, { kind: 'prescription' }), /исполнителя/);
  assert.equal(REPORT.selectRows(all, { kind: 'prescription', contractorId: 'person-1' }).length, 2);
  assert.deepEqual(REPORT.selectRows(all, { kind: 'prescription', contractorId: 'person-1', selected: ['remark:remark-2', 'note:note-1'] }).map((r) => r.id), ['note-1']);
  assert.equal(REPORT.selectRows(all, { status: 'done' }).length, 1);
});
test('место DXF учитывает origin, PDF - номер листа и координаты без переворота', () => {
  const d = { originX: 5000, originY: 6000, minX: 0, minY: 0, maxX: 100, maxY: 200, lines: [], texts: [] };
  const g = REPORT.geometry(d, null, { x: 5050, y: 6100 }); assert.equal(g.x, 50); assert.equal(g.y, 100);
  assert.equal((g.zoom[0] + g.zoom[2]) / 2, 50);
  const p = REPORT.geometry(null, [595, 842], { x: 100, y: 200 }); assert.deepEqual(p.whole, [0, 0, 595, 842]);
  assert.throws(() => REPORT.geometry(null, [595, 842], { x: 1000, y: 200 }), /вне листа/);
});
test('нет вложения: PDF получает заметное предупреждение вместо молчаливого пропуска', async () => {
  const texts = [], context = { scale() {}, fillRect() {}, fillText(t) { texts.push(t); }, measureText(t) { return { width: String(t).length * 5 }; } };
  const canvas = () => ({ width: 1190, height: 1684, getContext: () => context });
  const row = REPORT.rows(project()).find((r) => r.id === 'note-1');
  const result = await REPORT.build({ project: { name: 'Объект' }, rows: [row], date: 20750, canvas, jpeg: async () => new Uint8Array([255, 216, 255, 217]), readFile: async () => null });
  assert.equal(result.warnings.length, 2); assert.equal(result.pages, 2);
  assert.ok(texts.some((t) => t.includes('Отчёт сформирован не полностью')));
  assert.ok(texts.some((t) => t.includes('before.jpg')));
  assert.equal(new TextDecoder().decode(result.bytes.slice(0, 8)), '%PDF-1.4');
});
test('файлы в общих исполнительных и старых папках видны вместе; служебные записи скрыты', async () => {
  const d = new Disk();
  for (const path of ['/p/' + DOCS.SHARED + '/phone.pdf', '/p/Исполнительная документация/АОСР/act.docx', '/p/Документы/Отчёты/old.xlsx', '/p/Исполнительная документация/АОСР/act.json', '/p/' + DOCS.SHARED + '/unfinished.part']) d.files.set(path, 'x');
  const result = await DOCS.scan(d, '/p'); assert.equal(result.files.length, 3); assert.deepEqual(result.errors, []);
  d.list = async () => { throw new Error('423'); };
  assert.equal((await DOCS.scan(d, '/p')).errors.length, 2);
});
test('удаление и восстановление общие; запись старого телефона не оживляет объект', async () => {
  const d = new Disk();
  await LIFE.change(d, '/p', 'project-1', 'delete', 'web-1', 'event-1');
  await assert.rejects(LIFE.assertActive(d, '/p', 'project-1'), /удалён/);
  d.files.set('/p/data/phone.json', '{"projects":[{"deleted":0}]}');
  assert.equal((await LIFE.read(d, '/p')).action, 'delete');
  await LIFE.change(d, '/p', 'project-1', 'restore', 'phone-1', 'event-2');
  assert.equal((await LIFE.assertActive(d, '/p', 'project-1')).revision, 2);
  assert.ok(d.files.has('/p/.prorab-lifecycle/event-1.json'));
});
test('одновременное удаление выигрывает у восстановления; чужие и повреждённые события блокируют запись', async () => {
  const event = { format: 1, id: 'a', projectId: 'p', revision: 5, action: 'restore', at: 10, device: 'web' };
  const del = { ...event, id: 'b', action: 'delete' };
  assert.equal(LIFE.latest([event, del]).action, 'delete'); assert.equal(LIFE.latest([del, event]).action, 'delete');
  assert.throws(() => LIFE.latest([event, { ...del, projectId: 'other' }]), /история/);
  const d = new Disk(); d.files.set('/p/.prorab-lifecycle/a.json', '{broken');
  await assert.rejects(LIFE.assertActive(d, '/p'), /историю/);
});
test('неподтверждённое событие удаления не выдаётся за успех', async () => {
  const d = new Disk(); d.putBlob = async () => {};
  await assert.rejects(LIFE.change(d, '/p', 'p', 'delete', 'web', 'a'), /не подтвердил/);
});
test('логи переживают перезапуск, ограничены и не содержат токенов, URL подписей или тел запросов', async () => {
  const memory = new Map(), store = { json: (k, v) => memory.has(k) ? JSON.parse(memory.get(k)) : v, set: (k, v) => memory.set(k, v) };
  const secret = 'short-test-secret', log = new Log(store, [secret]);
  for (let i = 0; i < 502; i++) log.add('info', 'sync', 'event ' + i);
  const e = new Error('OAuth token-value ' + secret + ' https://example.test/file?signature=PRIVATE&token=x'); e.status = 423;
  const disk = log.watch({ putBlob: async () => { throw e; } });
  await assert.rejects(disk.putBlob('/p/file', { body: 'PRIVATE DOCUMENT CONTENT' }), /OAuth/);
  const restored = new Log(store, [secret]), text = restored.export();
  assert.equal(restored.rows().length, 500); assert.equal(restored.rows().at(-1).status, 423);
  for (const value of [secret, 'token-value', 'PRIVATE', 'signature=']) assert.ok(!text.includes(value));
  assert.ok(text.includes('https://example.test/file'));
});
