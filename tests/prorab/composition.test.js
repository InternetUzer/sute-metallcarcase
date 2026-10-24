// «Состав объекта» в кабинете: дерево и правила — как в приложении (CompositionTree, PlanningRepository).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../../static/prorab/sync.js');
const M = require('../../static/prorab/model.js');
const C = require('../../static/prorab/composition.js');

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../static/prorab/schema.js'), 'utf8'), ctx);
const SCHEMA = ctx.window.PRORAB_SCHEMA;
const PID = 'p1';

function project(tables = {}) {
  const clock = new S.Clock();
  const st = S.mergeFiles([{ device: 'phone', projectId: PID, tables }], PID, clock);
  return new M.Project(st, SCHEMA, PID, 'web-1', clock);
}

test('библиотека — та же, что в приложении: версия 2, ключи уникальны, ссылки целы', () => {
  const cat = C.catalog;
  assert.equal(cat.version, 2);
  const keys = cat.templates.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const t of cat.templates) {
    assert.ok(cat.category(t.category), t.key);
    assert.ok(cat.unitName(t.unitCode), t.key);
    t.nodeKinds.forEach((k) => assert.ok(cat.nodeKind(k), t.key + ' → ' + k));
    assert.equal(!t.alternativeGroup, !t.variantMode, t.key);
  }
  assert.equal(C.workItemName('Бетонирование', ' Ф1 ', 'whole'), 'Бетонирование — Ф1');
  assert.equal(C.workItemName('Бетонирование', 'Ф1', 'оси 1-3'), 'Бетонирование — Ф1 (оси 1-3)');
});

test('конструкция и работы: позиции ведомости, справочники и привязки как у телефона', () => {
  const P = project({ units: [{ id: 'u', projectId: PID, name: 'М³ ', updatedAt: 1 }] });
  const n = C.addNode(P, { kind: 'foundation_monolith', label: ' Ф1 ', location: 'оси А-Б' });
  assert.equal(n.label, 'Ф1');
  assert.equal(n.kind, 'foundation_monolith');
  const offered = C.catalog.offeredFor('foundation_monolith');
  assert.ok(offered.length > 0);
  const concrete = offered.find((t) => t.unitCode === 'm3');
  const ids = C.addWorks(P, n.id, [{ templateKey: concrete.key, quantity: 12.5, priceCents: 650000 }], '');
  assert.equal(ids.length, 1);
  const item = P.get('boq_items', ids[0]);
  assert.equal(item.name, concrete.title + ' — Ф1');
  assert.equal(item.planQty, 12.5);
  assert.equal(item.priceCents, 650000);
  assert.equal(item.unitId, 'u'); // «М³ » совпало с «м³» без учёта регистра и пробелов
  assert.equal(P.get('work_types', item.workTypeId).name, C.catalog.category(concrete.category).workType);
  const b = P.get('work_bindings', ids[0]);
  assert.equal(b.itemId, ids[0]);
  assert.equal(b.id, ids[0]);
  assert.equal(b.nodeId, n.id);
  assert.equal(b.segmentKey, 'whole');
  assert.equal(b.templateRevision, concrete.revision);
  assert.equal(JSON.parse(b.templateSnapshotJson).title, concrete.title);
  assert.deepEqual(Object.keys(JSON.parse(b.templateSnapshotJson)), ['key', 'revision', 'category', 'title', 'unitCode', 'alternativeGroup', 'variantMode']);
  // Повтор той же операции на той же конструкции — нельзя; на другом участке — можно
  assert.throws(() => C.addWorks(P, n.id, [{ templateKey: concrete.key }], 'whole'), /уже выбрана/);
  const more = C.addWorks(P, n.id, [{ templateKey: concrete.key }], 'захватка 2');
  assert.equal(P.get('boq_items', more[0]).name, concrete.title + ' — Ф1 (захватка 2)');
  assert.throws(() => C.addWorks(P, n.id, [{ templateKey: 'нет.такого' }]), /Неизвестная операция/);
  const steel = C.catalog.templates.find((t) => !t.nodeKinds.includes('foundation_monolith'));
  assert.throws(() => C.addWorks(P, n.id, [{ templateKey: steel.key }]), /не относится/);
  assert.throws(() => C.addWorks(P, n.id, [{ templateKey: offered[1].key, quantity: -1 }]), /Объём/);
});

test('комплекс и отдельные операции одной группы вместе не выбираются', () => {
  const P = project();
  const frame = C.addNode(P, { kind: 'steel_frame', label: 'Каркас' });
  const group = C.catalog.templates.filter((t) => t.alternativeGroup === 'steel.frame.fabrication-erection');
  const combined = group.find((t) => t.variantMode === 'COMBINED');
  const separate = group.filter((t) => t.variantMode === 'SEPARATE');
  assert.throws(() => C.addWorks(P, frame.id, [{ templateKey: combined.key }, { templateKey: separate[0].key }]), /комплекс/);
  assert.equal(P.rows('boq_items').length, 0); // ничего не записано наполовину
  C.addWorks(P, frame.id, separate.map((t) => ({ templateKey: t.key })));
  assert.throws(() => C.addWorks(P, frame.id, [{ templateKey: combined.key }]), /комплекс/);
});

test('дерево: раздел → группа → конструкция → работы, итоги по стоимости, приёмка, архив', () => {
  const P = project();
  const f1 = C.addNode(P, { kind: 'foundation_monolith', label: 'Ф1' });
  const f2 = C.addNode(P, { kind: 'foundation_monolith', label: 'Ф2', parentId: f1.id });
  const t = C.catalog.offeredFor('foundation_monolith').find((x) => x.unitCode === 'm3');
  const [a] = C.addWorks(P, f1.id, [{ templateKey: t.key, quantity: 10, priceCents: 1000 }]);
  const [b] = C.addWorks(P, f2.id, [{ templateKey: t.key, quantity: 10, priceCents: 3000 }]);
  P.put('volumes', 'v1', { projectId: PID, itemId: a, quantity: 5, date: 100, deleted: 0 });
  P.put('volumes', 'v2', { projectId: PID, itemId: b, quantity: 10, date: 100, deleted: 0 });
  P.put('acceptances', 'x', { projectId: PID, itemId: b, entryId: null, result: 'PENDING', readyDate: 100, createdAt: 1, deleted: 0 });
  const tree = C.tree(P);
  assert.equal(tree.length, 1);
  const cat = tree[0];
  assert.equal(cat.level, 'CATEGORY');
  assert.equal(cat.title, C.catalog.category(C.catalog.nodeKind('foundation_monolith').category).title);
  const all = C.allWorks(cat);
  assert.equal(all.length, 2);
  // По стоимости: (0,5·10·1000 + 1·10·3000) / (10·1000 + 10·3000) = 35000 / 40000
  assert.equal(Math.round(cat.stats.percent * 10) / 10, 87.5);
  assert.equal(cat.stats.byCost, true);
  assert.equal(cat.stats.planCost, 40000);
  assert.equal(cat.stats.pending, 1);
  const findNode = (bs, id) => { for (const x of bs) { if (x.nodeId === id) return x; const r = findNode(x.children, id); if (r) return r; } return null; };
  const n1 = findNode(tree, f1.id);
  assert.equal(n1.children[0].nodeId, f2.id); // Ф2 вложена в Ф1
  assert.equal(n1.works.length, 1);
  // Работы с историей не меняются и не удаляются; без истории — можно
  assert.throws(() => C.removeWork(P, a), /нельзя убрать/);
  assert.throws(() => C.updateWork(P, a, { quantity: 1 }), /в ведомости/);
  // Конструкцию с вложенной — не убрать; работы без истории — сначала убрать
  assert.throws(() => C.archiveNode(P, f1.id), /вложенные/);
  // Работа b с приёмкой — история; Ф2 можно убрать, работа уходит в «Конструкция в архиве»
  C.archiveNode(P, f2.id);
  const after = C.tree(P);
  const other = after.find((x) => x.id === 'c:_other');
  assert.equal(other.children[0].title, 'Конструкция в архиве');
  assert.equal(other.children[0].works[0].itemId, b);
});

test('переименование: автоназвания работ без истории следуют за конструкцией; вложенность без циклов', () => {
  const P = project();
  const n = C.addNode(P, { kind: 'foundation_monolith', label: 'Ф1' });
  const kids = C.addNode(P, { kind: 'foundation_monolith', label: 'Ф1.1', parentId: n.id });
  const offered = C.catalog.offeredFor('foundation_monolith');
  const [a, b, c] = C.addWorks(P, n.id, offered.slice(0, 3).map((t) => ({ templateKey: t.key })));
  P.put('boq_items', b, { name: 'Своё название' }); // переименовано вручную — не трогаем
  P.put('volumes', 'v', { projectId: PID, itemId: c, quantity: 1, date: 1, deleted: 0 }); // с историей — не трогаем
  const before = P.get('boq_items', c).name;
  C.updateNode(P, n.id, { label: 'Ф-1' });
  assert.equal(P.get('boq_items', a).name, offered[0].title + ' — Ф-1');
  assert.equal(P.get('boq_items', b).name, 'Своё название');
  assert.equal(P.get('boq_items', c).name, before);
  assert.throws(() => C.updateNode(P, n.id, { parentId: kids.id }), /саму в себя/);
  assert.throws(() => C.updateNode(P, n.id, { label: '  ' }), /пустым/);
  assert.throws(() => C.addNode(P, { kind: 'нет', label: 'x' }), /Неизвестный вид/);
  assert.throws(() => C.addNode(P, { kind: 'foundation_monolith', label: '' }), /название/);
  // Убрать работу без истории: позиция и привязка помечены удалёнными
  C.removeWork(P, a);
  assert.equal(P.get('boq_items', a).deleted, 1);
  assert.equal(P.get('work_bindings', a).deleted, 1);
  C.updateWork(P, b, { quantity: '7.5', priceCents: 100 });
  assert.equal(P.get('boq_items', b).planQty, 7.5);
});

test('строки уходят в файл устройства в формате телефона: привязка с id = itemId', () => {
  const P = project();
  const n = C.addNode(P, { kind: 'foundation_monolith', label: 'Ф1' });
  const [a] = C.addWorks(P, n.id, [{ templateKey: C.catalog.offeredFor('foundation_monolith')[0].key }]);
  const file = S.toFile(P.state, PID, 'Объект', 'web-1', 5);
  const row = file.tables.work_bindings.find((r) => r.itemId === a);
  assert.equal(row.id, a);
  assert.equal(row.projectId, PID);
  assert.equal(row.deleted, 0);
  assert.ok(row._v.nodeId);
  const node = file.tables.project_nodes.find((r) => r.id === n.id);
  assert.equal(node.kind, 'foundation_monolith');
  assert.equal(C.unboundCount(P), 0);
});
