const test = require('node:test');
const assert = require('node:assert/strict');
const { Store, leaf } = require('../../static/prorab/document-store.js');
const I = require('../../static/prorab/id.js');
const ROOT = 'Прораб+/Учебный объект/Исполнительная документация';
const copy = (x) => JSON.parse(JSON.stringify(x));
class Disk {
  constructor() { this.files = new Map(); this.failMetadata = false; this.truncate = false; this.writes = 0; }
  async mkdir() {}
  async list(path) { return [...this.files.keys()].filter((p) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')).map((p) => ({ name: p.slice(path.length + 1), type: 'file' })); }
  async getText(path) { const v = this.files.get(path); return v === undefined ? null : v; }
  async putText(path, text) { if (this.failMetadata) throw new Error('offline'); this.files.set(path, text); this.writes++; }
  async putBlob(path, blob, overwrite) {
    assert.equal(overwrite, false);
    if (this.files.has(path)) throw new Error('exists');
    const data = new Uint8Array(await blob.arrayBuffer());
    this.files.set(path, this.truncate ? data.slice(0, 1) : data); this.writes++;
  }
  async getBytes(path) { return this.files.get(path) || null; }
}
function record(n, day, status = 'draft') {
  return { version: 1, id: 'ks-' + n, number: String(n), date: day + 1, from: day, to: day, status, imported: status === 'issued',
    contractKey: I.contractKey({ contractNo: 'Д1' }), rows: [], totals: { base: n * 10000, vat: 0, all: n * 10000 } };
}
test('повреждённый файл участников не заменяется пустым или исправленным наугад', async () => {
  const disk = new Disk(), store = new Store(disk, ROOT);
  for (const value of ['{broken', '{}', '{"version":1,"orgs":[],"reps":[]}']) {
    disk.files.set(ROOT + '/участники.json', value);
    await assert.rejects(store.participants(I.emptyParticipants()));
    assert.equal(disk.files.get(ROOT + '/участники.json'), value);
    assert.equal(disk.writes, 0);
  }
});
test('подтверждённый акт замораживает участников; новая версия сохраняет прежний Word', async () => {
  const disk = new Disk(), store = new Store(disk, ROOT), participants = I.emptyParticipants();
  I.saveOrg(participants, { name: 'Заказчик 1', role: 'customer' });
  const a = { id: 'act-1', number: 1, date: 20500, works: 'Монтаж', signed: false };
  const saved = await store.act(a, participants, { name: 'Склад' }, new Uint8Array([1, 2, 3]));
  const oldFile = ROOT + '/АОСР/' + saved.docx;
  participants.orgs[0].name = 'Изменено позже';
  assert.equal(saved.participantsSnapshot.orgs[0].name, 'Заказчик 1');
  const next = await store.act({ ...saved, works: 'Монтаж 2' }, participants, { name: 'Склад' }, new Uint8Array([4, 5]));
  assert.notEqual(saved.docx, next.docx);
  assert.deepEqual(disk.files.get(oldFile), new Uint8Array([1, 2, 3]));
  assert.equal(JSON.parse(disk.files.get(ROOT + '/АОСР/act-1.json')).docx, next.docx);
  await assert.rejects(store.act(a, participants, {}, new Uint8Array([1])), /уже изменён/);
});
test('ошибка записи или неполный файл не меняют прежние метаданные акта', async () => {
  const disk = new Disk(), store = new Store(disk, ROOT), people = I.emptyParticipants();
  const a = await store.act({ id: 'act-1', number: 1, works: 'Монтаж', date: 20500 }, people, {}, new Uint8Array([1, 2]));
  const prior = disk.files.get(ROOT + '/АОСР/act-1.json');
  disk.truncate = true;
  await assert.rejects(store.act({ ...a, works: 'Поправка' }, people, {}, new Uint8Array([3, 4])), /не подтвердил/);
  assert.equal(disk.files.get(ROOT + '/АОСР/act-1.json'), prior);
  disk.truncate = false; disk.failMetadata = true;
  await assert.rejects(store.act({ ...a, works: 'Поправка' }, people, {}, new Uint8Array([3, 4])), /offline/);
  assert.equal(disk.files.get(ROOT + '/АОСР/act-1.json'), prior);
  assert.equal(store.busy, false);
});
test('подписанный акт не переписывается и битая запись не игнорируется', async () => {
  const disk = new Disk(), store = new Store(disk, ROOT), people = I.emptyParticipants();
  const a = await store.act({ id: 'act-1', number: 1, works: 'Монтаж', signed: true, date: 20500 }, people, {}, new Uint8Array([1, 2]));
  const writes = disk.writes;
  await assert.rejects(store.act({ ...a, works: 'Поправка' }, people, {}, new Uint8Array([3])), /Подписанный/);
  assert.equal(disk.writes, writes);
  disk.files.set(ROOT + '/АОСР/broken.json', '{broken');
  await assert.rejects(store.records('АОСР'), /Повреждён/);
});
test('КС: документы подтверждаются до реестра; отметка предъявления идемпотентна', async () => {
  const disk = new Disk(), store = new Store(disk, ROOT), r = record(1, 20500);
  r.ledger = I.certificateLedger([], r);
  await store.generated('КС', [{ name: 'КС-2.docx', bytes: new Uint8Array([1, 2]) }], r);
  const issued = await store.issue(r);
  assert.equal(issued.status, 'issued');
  const writes = disk.writes;
  assert.deepEqual(await store.issue(r), issued);
  assert.equal(disk.writes, writes);
  const second = record(2, 20510); second.ledger = I.certificateLedger([issued], second);
  disk.truncate = true;
  await assert.rejects(store.generated('КС', [{ name: 'КС-2_2.docx', bytes: new Uint8Array([3, 4]) }], second), /не подтвердил/);
  assert.equal(await disk.getText(ROOT + '/КС/ks-2.json'), null);
});
test('реестр изменился между формированием и предъявлением: устаревший комплект не учитывается', async () => {
  const disk = new Disk(), store = new Store(disk, ROOT), a = record(1, 20500), b = record(2, 20510);
  a.ledger = I.certificateLedger([], a); b.ledger = I.certificateLedger([], b);
  await store.generated('КС', [], a); await store.generated('КС', [], b);
  await store.issue(a);
  await assert.rejects(store.issue(b), /Накопление изменилось/);
  assert.equal(JSON.parse(await disk.getText(ROOT + '/КС/ks-2.json')).status, 'draft');
  const obsolete = record(3, 20520); obsolete.ledger = I.certificateLedger([], obsolete);
  await assert.rejects(store.generated('КС', [], obsolete), /Реестр КС изменился/);
  const dup = { ...record(1, 20510, 'issued'), id: 'import-duplicate' };
  await assert.rejects(store.generated('КС', [], dup), /номером/);
});
test('сохранение остаётся в исходном аккаунте и повторный запуск блокируется', async () => {
  const original = new Disk(), other = new Disk(); let disk = original;
  const store = new Store(disk, ROOT); disk = other;
  let release;
  const pending = store.run(() => new Promise((resolve) => { release = resolve; }));
  await assert.rejects(store.participants(I.emptyParticipants()), /Дождитесь/);
  release(); await pending;
  await store.participants(I.emptyParticipants());
  assert.equal(original.writes, 1); assert.equal(other.writes, 0);
  for (const name of ['..', '../a', 'a/b', 'a\\b', 'a\u0000b']) assert.throws(() => leaf(name), /имя/);
});
