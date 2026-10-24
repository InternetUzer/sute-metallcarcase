// Фиксация данных: цепочка отпечатков, проверка подмены, удаления и времени.
// Запуск: node --test tests/prorab
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../static/prorab/fixation.js');

const row = (id, extra) => ({ values: Object.assign({ id, projectId: 'p', updatedAt: 1, deleted: 0 }, extra) });
const info = (now) => ({ project: 'p', device: 'web-1', now });

test('цепочка: первая фиксация — всё, следующая — только изменения; без изменений — не создаётся', async () => {
  const st = { volumes: { a: row('a', { quantity: 5 }), b: row('b', { quantity: 7 }) } };
  const one = await F.makeSeal(null, null, st, info(1000));
  assert.equal(one.seal.seq, 1);
  assert.equal(one.seal.changes.length, 2);
  assert.equal(await F.makeSeal(one.seal, one.leaves, st, info(2000)), null);
  st.volumes.b = row('b', { quantity: 8 });
  st.remarks = { r: row('r', { text: 'Трещина' }) };
  const two = await F.makeSeal(one.seal, one.leaves, st, info(3000));
  assert.deepEqual(two.seal.changes.map((c) => c.t + '/' + c.id).sort(), ['remarks/r', 'volumes/b']);
  assert.equal(two.seal.prev, one.seal.hash);
  assert.deepEqual(F.replay([one.seal, two.seal]), two.leaves);
  const anchors = new Map([[1, { hash: one.seal.hash, time: new Date(1500).toISOString() }]]);
  const ok = await F.verifyChain([two.seal, one.seal], anchors);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.seals, 2);
  assert.equal(ok.anchored, 1);
  // История записи: оба значения с временем фиксации
  const hist = F.history([{ seals: [one.seal, two.seal], anchors }], 'volumes', 'b');
  assert.deepEqual(hist.map((x) => x.row.quantity), [7, 8]);
  assert.ok(hist[0].anchor && !hist[1].anchor);
  // Канонический вид не зависит от порядка ключей
  assert.equal(F.canonical({ b: 1, a: [2, { d: null, c: 'x' }] }), '{"a":[2,{"c":"x","d":null}],"b":1}');
});

test('проверка ловит правку задним числом, удалённый файл, чужую квитанцию', async () => {
  const st = { volumes: { a: row('a', { quantity: 5 }) } };
  const one = await F.makeSeal(null, null, st, info(1000));
  st.volumes.a = row('a', { quantity: 6 });
  const two = await F.makeSeal(one.seal, one.leaves, st, info(2000));
  st.volumes.a = row('a', { quantity: 7 });
  const three = await F.makeSeal(two.seal, two.leaves, st, info(3000));
  // Подменили объём в первой фиксации
  const forged = JSON.parse(JSON.stringify(one.seal));
  forged.changes[0].row.quantity = 50;
  let r = await F.verifyChain([forged, two.seal, three.seal], new Map());
  assert.ok(r.problems.some((p) => p.includes('изменена')));
  // Пересчитали отпечаток подделки — тогда рвётся связь со следующей
  forged.changes[0].h = await F.sha256(F.canonical(forged.changes[0].row));
  forged.hash = await F.sealHash(forged);
  r = await F.verifyChain([forged, two.seal, three.seal], new Map());
  assert.ok(r.problems.some((p) => p.includes('цепочка разорвана')));
  // Удалили среднюю фиксацию
  r = await F.verifyChain([one.seal, three.seal], new Map());
  assert.ok(r.problems.some((p) => p.includes('Пропущены фиксации перед № 3')));
  // Квитанция от другого отпечатка и время раньше фиксации
  r = await F.verifyChain([one.seal], new Map([[1, { hash: 'x'.repeat(64), time: new Date(5000).toISOString() }]]));
  assert.ok(r.problems.some((p) => p.includes('другому отпечатку')));
  r = await F.verifyChain([one.seal], new Map([[1, { hash: one.seal.hash, time: new Date(1000 - 3600 * 1000).toISOString() }]]));
  assert.ok(r.problems.some((p) => p.includes('раньше времени фиксации')));
});

test('снимок не меняется при последующем изменении строки; физическое удаление записано явно', async () => {
  const state = { volumes: { a: row('a', { quantity: 5 }) } };
  const pending = F.makeSeal(null, null, state, info(1000));
  state.volumes.a.values.quantity = 99;
  const first = await pending;
  assert.equal(first.seal.changes[0].row.quantity, 5);
  delete state.volumes.a;
  const second = await F.makeSeal(first.seal, first.leaves, state, info(2000));
  assert.equal(second.seal.changes[0].removed, true);
  assert.equal(F.replay([first.seal, second.seal]).size, 0);
  assert.deepEqual((await F.verifyChain([first.seal, second.seal])).problems, []);
  assert.ok((await F.verifyChain([first.seal], new Map([[2, { hash: second.seal.hash }]]))).problems.length);
  assert.ok((await F.verifyChain([{}])).problems.length);
  for (const name of ['../secret', 'files/../secret', '/files/a', 'files/a\\b']) assert.throws(() => F.filePath(name));
});
