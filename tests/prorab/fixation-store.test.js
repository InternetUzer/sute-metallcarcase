const test = require('node:test'), assert = require('node:assert/strict');
const { Journal } = require('../../static/prorab/fixation-store.js');
const F = require('../../static/prorab/fixation.js');
const state = (quantity) => ({ volumes: { a: { values: { id: 'a', quantity } } } });
function setup() {
  const files = new Map(), receipts = new Map(), local = new Map();
  const options = { offline: false, truncate: false, beforeList: null };
  const disk = {
    mkdir: async () => {},
    list: async (path) => {
      if (options.beforeList) { const fn = options.beforeList; options.beforeList = null; await fn(); }
      const out = new Map();
      for (const key of files.keys()) if (key.startsWith(path + '/')) { const rest = key.slice(path.length + 1), name = rest.split('/')[0]; out.set(name, { name, type: rest.includes('/') ? 'dir' : 'file' }); }
      return [...out.values()];
    },
    getText: async (p) => files.has(p) ? typeof files.get(p) === 'string' ? files.get(p) : new TextDecoder().decode(files.get(p)) : null,
    putText: async (p, text) => files.set(p, text),
    getBytes: async (p) => files.has(p) ? typeof files.get(p) === 'string' ? new TextEncoder().encode(files.get(p)) : files.get(p) : null,
    putBlob: async (p, blob, overwrite) => { assert.equal(overwrite, false); if (files.has(p)) throw new Error('exists'); const bytes = new Uint8Array(await blob.arrayBuffer()); files.set(p, options.truncate ? bytes.slice(0, 1) : bytes); },
  };
  const storage = { get: (k) => local.get(k) || null, set: (k, v) => { local.set(k, v); return true; } };
  const request = async (suffix, fields) => {
    if (options.offline) throw new Error('offline');
    if (suffix === '/heads') { const heads = new Map(); for (const r of receipts.values()) if (r.project === fields.project && (!heads.has(r.chain) || heads.get(r.chain).seq < r.seq)) heads.set(r.chain, r); return { heads: [...heads.values()] }; }
    if (suffix === '/verify') return { valid: JSON.parse(fields.receipts).map((r) => JSON.stringify(receipts.get(r.chain + '/' + r.seq)) === JSON.stringify(r)) };
    const seq = Number(fields.seq), key = fields.chain + '/' + seq;
    if (receipts.has(key)) { const old = receipts.get(key); if (old.hash !== fields.hash) throw new Error('conflict'); return old; }
    if (seq > 1 && receipts.get(fields.chain + '/' + (seq - 1))?.hash !== fields.prev) throw new Error('gap');
    const r = { ...fields, seq, version: 2, format: 'prorab-anchor', time: new Date(1700000000000 + seq * 1000).toISOString(), prev: fields.prev || null, sig: 'mock-signature' };
    receipts.set(key, r); return r;
  };
  const args = { disk, path: '/Прораб+/Склад', project: 'p', device: 'web-test', storage, request };
  const journal = new Journal(args);
  return { journal, args, files, receipts, options, disk, storage };
}
const now = 1700000000000;

test('обрыв связи после записи: снимок сохранён, квитанция повторяется до истечения 30 минут', async () => {
  const { journal: j, options, receipts, args, files } = setup();
  options.offline = true;
  await assert.rejects(j.capture(state(1), { force: true, now }), /сохранён на Диске, квитанция не получена/);
  assert.equal([...files.keys()].filter((p) => p.endsWith('000001.json')).length, 1);
  assert.equal(j.busy, false);
  options.offline = false;
  const reloaded = new Journal(args);
  assert.equal(await reloaded.capture(state(1), { now: now + 1000 }), null);
  assert.equal(receipts.size, 1); assert.equal(reloaded.anchored.size, 1);
});

test('неполная загрузка сохраняет очередь; изменение во время ожидания не изменяет снимок', async () => {
  const { journal: j, options, files } = setup();
  await j.queueFile('files/photo.jpg', new Uint8Array([1, 2]));
  options.truncate = true;
  await assert.rejects(j.capture(state(1), { force: true, now }), /не подтвердил/);
  assert.equal(j.pending().length, 1);
  for (const key of files.keys()) if (key.includes(F.DIR)) files.delete(key);
  options.truncate = false;
  const s = state(2); let release;
  options.beforeList = () => new Promise((resolve) => { release = resolve; });
  const pending = j.capture(s, { force: true, now });
  s.volumes.a.values.quantity = 999;
  release(); await pending;
  assert.equal(j.seals[0].changes[0].row.quantity, 2);
  assert.equal(j.pending().length, 0);
});

test('удаление последнего снимка с квитанцией или целой цепочки обнаруживается по серверу', async () => {
  const { journal: j, files } = setup();
  await j.capture(state(1), { force: true, now });
  await j.capture(state(2), { force: true, now: now + 1000 });
  let report = await j.report(state(2));
  assert.equal(report.problems, false); assert.equal(report.incomplete, false);
  for (const key of files.keys()) if (key.includes('000002')) files.delete(key);
  report = await j.report(state(1));
  assert.equal(report.problems, true);
  assert.ok(report.issues.some((s) => s.includes('удалённую фиксацию № 2')));
  for (const key of files.keys()) if (key.includes(F.DIR)) files.delete(key);
  report = await j.report(state(1));
  assert.equal(report.problems, true);
  assert.ok(report.issues.some((s) => s.includes('отсутствует цепочка')));
});

test('нет связи или снимков — проверка незавершённая, совпадение файлов проверяется по байтам', async () => {
  const { journal: j, options, files } = setup();
  assert.equal((await j.report(state(1))).incomplete, true);
  const file = 'files/photo.jpg', bytes = new Uint8Array([1, 2, 3]);
  files.set(j.path + '/' + file, bytes); await j.queueFile(file, bytes);
  await j.capture(state(1), { force: true, now });
  let report = await j.report(state(1));
  assert.equal(report.verifiedFiles, 1); assert.equal(report.incomplete, false);
  options.offline = true; report = await j.report(state(1));
  assert.equal(report.incomplete, true); assert.equal(report.anchors.checked, false);
  options.offline = false; files.set(j.path + '/' + file, new Uint8Array([9]));
  report = await j.report(state(1));
  assert.equal(report.problems, true); assert.ok(report.issues.some((x) => x.includes('Файл отличается')));
});

test('повреждённая цепочка не продолжается, имя файла и объект проверяются', async () => {
  const { journal: j, files, receipts } = setup();
  await j.capture(state(1), { force: true, now });
  const path = j.io.path + '/000001.json';
  const record = JSON.parse(new TextDecoder().decode(files.get(path))); record.changes[0].row.quantity = 900;
  files.set(path, JSON.stringify(record));
  await assert.rejects(j.capture(state(2), { force: true, now: now + 1000 }), /изменен/);
  assert.equal(receipts.size, 1);
  record.project = 'other'; files.set(path, JSON.stringify(record));
  await assert.rejects(j.load(), /Чужой объект/);
});

test('квитанция старого телефона проверяется, но не обещает полноту цепочки', async () => {
  const { journal: j, files } = setup();
  const { seal } = await F.makeSeal(null, new Map(), state(1), { project: 'p', device: 'phone-1', now, files: [] });
  seal.deviceName = 'Android'; seal.hash = await F.sealHash(seal);
  const receipt = { version: 1, seq: 1, hash: seal.hash, time: new Date(now).toISOString(), sig: 'legacy' };
  const dir = j.dir + '/phone-1/';
  files.set(dir + F.name(1), JSON.stringify(seal));
  files.set(dir + F.anchorName(1), JSON.stringify(receipt));
  j.request = async (suffix) => suffix === '/verify' ? { valid: [true] } : { heads: [] };
  const report = await j.report(state(1));
  assert.equal(report.anchors.valid, 1); assert.equal(report.problems, false);
  assert.equal(report.incomplete, true); assert.equal(report.chains[0].label, 'Телефон Android');
  assert.ok(report.notes.some((n) => n.includes('удаление конца цепочки')));
});

test('несколько снимков без связи сохраняются и получают квитанции по порядку при восстановлении', async () => {
  const { journal: j, options, receipts } = setup();
  options.offline = true;
  await assert.rejects(j.capture(state(1), { force: true, now }), /Снимок № 1 сохранён/);
  await assert.rejects(j.capture(state(2), { force: true, now: now + 1000 }), /Снимок № 2 сохранён/);
  assert.equal(j.seals.length, 2);
  options.offline = false;
  await j.capture(state(2), { now: now + 2000 });
  assert.equal(receipts.size, 2); assert.equal(j.anchored.size, 2);
  assert.equal((await j.report(state(2))).incomplete, false);
});
