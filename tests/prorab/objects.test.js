// Карточка объекта, справочники, чертежи и пометки в браузере — те же записи, что пишет телефон.
// Запуск: node --test tests/prorab
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../../static/prorab/sync.js');
const M = require('../../static/prorab/model.js');
const X = require('../../static/prorab/dxf.js');

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../static/prorab/schema.js'), 'utf8'), ctx);
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../static/prorab/catalog.js'), 'utf8'), ctx);
const SCHEMA = ctx.window.PRORAB_SCHEMA;
const P = 'p1';
const project = (tables) => new M.Project(S.mergeFiles([{ device: 'phone', projectId: P, tables }], P, new S.Clock()), SCHEMA, P, 'web-1', new S.Clock());

test('карточка: меняются только исправленные поля, правка коллеги в другом поле не теряется', () => {
  const p = project({ projects: [{ id: P, name: 'Ангар', address: 'старый', customer: 'А', updatedAt: 10 }] });
  const out = p.saveCard({ name: ' Ангар ', address: 'Казань, ул. 1', customer: 'А', deadline: 20818 });
  assert.deepEqual(out, { address: 'Казань, ул. 1', deadline: 20818 });
  const file = S.toFile(p.state, P, p.project.name, 'web-1');
  const row = file.tables.projects[0];
  assert.equal(row.address, 'Казань, ул. 1');
  // Телефон позже поменял заказчика — объединение оставляет обе правки
  const phoneLater = { device: 'phone', projectId: P, tables: { projects: [{ id: P, name: 'Ангар', address: 'старый', customer: 'Б', updatedAt: 10, _v: { customer: '99999999999999:phone' } }] } };
  const merged = S.mergeFiles([file, phoneLater], P, new S.Clock());
  assert.equal(merged.projects[P].values.address, 'Казань, ул. 1');
  assert.equal(merged.projects[P].values.customer, 'Б');
});

test('свои поля: порядок, правка и удаление', () => {
  const p = project({ projects: [{ id: P, name: 'Ангар', updatedAt: 1 }] });
  const a = p.saveField({ name: 'Номер договора', value: '17' });
  const b = p.saveField({ name: 'Дата договора', value: '01.02.2026' });
  assert.deepEqual(p.fields().map((f) => f.name), ['Номер договора', 'Дата договора']);
  assert.equal(b.position, 1);
  p.saveField({ id: a.id, name: 'Номер договора', value: '18' });
  p.deleteField(b.id);
  assert.deepEqual(p.fields().map((f) => [f.name, f.value]), [['Номер договора', '18']]);
});

test('справочники: исполнитель, переименование, каталог без повторов', () => {
  const p = project({ units: [{ id: 'u', projectId: P, name: 'м³', updatedAt: 1 }] });
  assert.throws(() => p.saveContractor({ name: ' ' }));
  const c = p.saveContractor({ name: 'Бригада', phone: ' +7 900 ' });
  assert.equal(c.phone, '+7 900');
  assert.equal(p.addMany('units', ['М³', 'смена', 'смена']), 1);
  p.renameNamed('units', 'u', 'куб. м');
  assert.deepEqual(p.named('units').map((u) => u.name), ['куб. м', 'смена']);
  assert.ok(ctx.window.PRORAB_CATALOG.units.includes('маш.-ч'));
  assert.ok(ctx.window.PRORAB_CATALOG.work.length > 10);
});

test('чертёж и пометки: номера по чертежу с учётом удалённых, статус «Сделано» с датой', () => {
  const p = project({ drawing_notes: [{ id: 'old', projectId: P, drawingId: 'd', number: 3, deleted: 1, updatedAt: 1 }] });
  p.addDrawing({ id: 'd', name: 'План', kind: 'pdf', file: 'd.pdf', pages: 4 });
  assert.throws(() => p.addDrawing({ id: 'x', kind: 'dwg', file: 'x.dwg' }));
  const n = p.saveNote({ drawingId: 'd', page: 2, x: 100.5, y: 200, text: ' Трещина ', status: 'PROBLEM' });
  assert.equal(n.number, 4);
  assert.equal(n.text, 'Трещина');
  assert.equal(n.doneDate, null);
  const done = p.saveNote({ id: n.id, text: 'Трещина', status: 'DONE', doneDate: 20500 });
  assert.equal(done.status, 'DONE');
  assert.equal(done.doneDate, 20500);
  assert.equal(done.page, 2); // место не меняется при правке
  const other = p.saveNote({ drawingId: 'e', x: 1, y: 1, status: 'странный' });
  assert.equal(other.number, 1);
  assert.equal(other.status, 'NOTE');
  const v = p.saveView({ drawingId: 'd', name: '3 этаж', page: 2, cx: 300, cy: 400, span: 200 });
  assert.equal(p.viewsOf('d')[0].name, '3 этаж');
  assert.equal(v.rotation, 0);
  const file = S.toFile(p.state, P, 'Объект', 'web-1');
  assert.equal(file.tables.drawings[0].file, 'd.pdf');
  assert.equal(file.tables.drawing_notes.length, 3);
});

const DXF = [
  '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'TABLES', '0', 'LAYER', '2', 'Стены', '62', '1', '70', '0', '0', 'LAYER', '2', 'Скрытый', '62', '-3', '70', '0', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '2', 'КОЛ', '10', '0', '20', '0', '0', 'CIRCLE', '8', '0', '10', '0', '20', '0', '40', '5', '0', 'ENDBLK', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES',
  '0', 'LINE', '8', 'Стены', '10', '1000', '20', '2000', '11', '7000', '21', '2000',
  '0', 'LWPOLYLINE', '8', 'Скрытый', '70', '1', '10', '1000', '20', '2000', '10', '1000', '20', '5000', '42', '1', '10', '2000', '20', '5000',
  '0', 'TEXT', '8', 'Стены', '10', '1500', '20', '2500', '40', '250', '1', 'Ось %%c20',
  '0', 'INSERT', '8', 'Стены', '2', 'КОЛ', '10', '3000', '20', '3000', '41', '2', '42', '2',
  '0', 'ENDSEC', '0', 'EOF', '',
].join('\r\n');

test('DXF: слои, блоки, тексты и сдвиг координат — как в телефоне', () => {
  const d = X.parse(new TextEncoder().encode(DXF));
  assert.equal(d.units, 4);
  assert.equal(X.unitsName(d.units), 'мм');
  assert.equal(d.layers['Стены'].color, '#ff0000');
  assert.equal(d.layers['Скрытый'].visible, false);
  assert.equal(d.texts[0].text, 'Ось Ø20');
  assert.equal(d.originX, 1000);
  // Окружность блока: радиус 5 × масштаб 2, центр 3000;3000 (в координатах со сдвигом — 2000;1000)
  const circle = d.lines.find((l) => l.closed);
  const xs = Array.from(circle.pts).filter((_, i) => i % 2 === 0);
  assert.ok(Math.abs(Math.max(...xs) - (2000 + 10)) < 1e-6);
  // Дуга в полилинии превратилась в много точек
  assert.ok(d.lines.find((l) => l.layer === 'Скрытый').pts.length > 10);
  // Привязка к ближайшему узлу видимых слоёв
  assert.deepEqual(X.snap(d, 5, 3, 20, new Set(['Скрытый'])), [0, 0]);
  assert.equal(X.snap(d, 5, 3, 1, new Set()), null);
});

test('DXF: кириллица в старой кодировке Windows и двоичный DXF', () => {
  const head = '0\r\nSECTION\r\n2\r\nHEADER\r\n9\r\n$DWGCODEPAGE\r\n3\r\nANSI_1251\r\n0\r\nENDSEC\r\n0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nTEXT\r\n8\r\n0\r\n10\r\n0\r\n20\r\n0\r\n40\r\n1\r\n1\r\n';
  const tail = '\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n';
  const word = Uint8Array.from([0xcf, 0xeb, 0xe0, 0xed]); // «План» в windows-1251
  const bytes = new Uint8Array([...new TextEncoder().encode(head), ...word, ...new TextEncoder().encode(tail)]);
  assert.equal(X.parse(bytes).texts[0].text, 'План');
  assert.throws(() => X.parse(new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1a\x00')), /двоичный/);
  assert.equal(X.kindOf('a.PDF'), 'pdf');
  assert.equal(X.kindOf('чертёж', new TextEncoder().encode('AC1032....')), 'dwg');
});

test('доп. работы считаются сами: сверх плана (часть записи), без плана, без позиции, заведённые заранее', () => {
  const p = project({
    boq_items: [
      { id: 'a', projectId: P, name: 'Бетон', planQty: 100, priceCents: 500000, position: 0, updatedAt: 1 },
      { id: 'b', projectId: P, name: 'Новая работа', position: 1, updatedAt: 1 },
      { id: 'c', projectId: P, name: 'Навес', planQty: 20, extraDate: 20400, position: 2, updatedAt: 1 },
    ],
    volumes: [
      { id: 'v1', projectId: P, itemId: 'a', date: 20401, quantity: 90, createdAt: 1, updatedAt: 1 },
      { id: 'v2', projectId: P, itemId: 'a', date: 20402, quantity: 25, createdAt: 2, updatedAt: 1 },
      { id: 'v3', projectId: P, itemId: 'b', date: 20403, quantity: 3, createdAt: 3, updatedAt: 1 },
      { id: 'v4', projectId: P, itemId: null, name: 'Уборка', date: 20404, quantity: 1, createdAt: 4, updatedAt: 1 },
    ],
  });
  const list = p.extraWorks();
  const by = Object.fromEntries(list.map((x) => [x.kind, x]));
  assert.equal(by.OVER_PLAN.extra, 15);
  assert.equal(by.OVER_PLAN.parts.length, 1);
  assert.equal(by.OVER_PLAN.parts[0].qty, 15); // из записи 25 сверх плана только 15
  assert.equal(by.OVER_PLAN.since, 20402);
  assert.equal(by.OVER_PLAN.cost, 15 * 500000);
  assert.equal(by.NO_PLAN.extra, 3);
  assert.equal(by.EXTRA_ITEM.extra, 20); // ещё не сделано — объём по плану
  assert.equal(by.NO_ITEM.parts.length, 1);
  // Согласование: постоянный id, только нужные поля
  const a = p.saveExtraApproval('a', { description: 'Перерасход', supervisorDate: 20410, bogus: 1 });
  assert.equal(a.id, 'extra:a');
  assert.equal(p.extraApproval('a').supervisorDate, 20410);
  assert.equal(p.extraApproval(null), null);
  assert.equal(p.saveExtraApproval(null, {}).id, 'extra:loose:' + P);
  // На чертёж: пометка с текстом, повторная постановка убирает старую
  const n1 = p.placeExtra('a', 'd', 0, 1, 2, null);
  assert.equal(n1.text, 'Доп. работа: Бетон\nПерерасход');
  const n2 = p.placeExtra('a', 'd', 0, 3, 4, null);
  assert.equal(p.notesOf('d').length, 1);
  assert.equal(n2.number, 2);
  assert.equal(p.extraApproval('a').noteId, n2.id);
});

test('приёмка: предъявить, не принять, предъявить снова, отменить — как в приложении', () => {
  const p = project({
    projects: [{ id: P, name: 'Ангар', supervisor: 'Петров', updatedAt: 1 }],
    boq_items: [{ id: 'a', projectId: P, name: 'Кладка', unitId: 'u', planQty: 10, position: 0, updatedAt: 1 }],
    units: [{ id: 'u', projectId: P, name: 'м³', updatedAt: 1 }],
  });
  assert.deepEqual(p.acceptors(), ['Петров (технадзор)']);
  const a = p.submitAcceptance('a', 20500, 20502, 'Петров (технадзор)');
  assert.equal(p.get('boq_items', 'a').finishedDate, 20500);
  assert.equal(a.workName, 'Кладка');
  assert.equal(p.acceptancesCurrent().length, 1);
  p.saveAcceptance(a.id, { readyDate: 20501, result: 'REJECTED', resultDate: 20503, acceptedBy: 'Петров', note: 'трещины' });
  assert.equal(p.get('boq_items', 'a').finishedDate, 20501); // дата «Закончено» — дата окончания позиции
  const r = p.saveRemark({ acceptanceId: a.id, date: 20503, text: 'Трещина' });
  assert.deepEqual([p.acceptanceRemarks(a.id).open, p.acceptanceRemarks(a.id).total], [1, 1]);
  p.setRemarkDone(r.id, true, '', 20504);
  assert.equal(p.acceptanceRemarks(a.id).open, 0);
  // Чтобы порядок предъявлений не зависел от одной миллисекунды
  p.put('acceptances', a.id, { createdAt: 1 });
  const b = p.resubmitAcceptance(a.id, 20505);
  assert.equal(p.acceptancesCurrent().map((x) => x.id).join(), b.id);
  assert.equal(p.acceptanceHistory(b).length, 1);
  p.cancelAcceptance(b.id, 20506);
  assert.equal(p.acceptancesCurrent().length, 0);
  assert.equal(p.get('boq_items', 'a').finishedDate, null);
});

test('замечание на чертёж: становится пометкой с фото, само замечание убирается', () => {
  const p = project({ remarks: [{ id: 'r', projectId: P, number: 5, date: 20500, text: 'Скол', place: 'ось 3', status: 'DONE', doneDate: 20501, doneNote: 'заделали', updatedAt: 1 }],
    attachments: [{ id: 'f1', projectId: P, ownerId: 'r', file: 'a.jpg', updatedAt: 1 }, { id: 'f2', projectId: P, ownerId: 'r:done', file: 'b.jpg', updatedAt: 1 }] });
  const n = p.placeRemark('r', 'd', 1, 10, 20, null);
  assert.equal(n.text, 'Скол (ось 3)\nУстранено 17.02.2026: заделали');
  assert.equal(n.status, 'DONE');
  assert.equal(p.get('remarks', 'r').deleted, 1);
  assert.equal(p.attachmentsOf(n.id).length, 1);
  assert.equal(p.attachmentsOf(n.id + ':done').length, 1);
});

test('«Сегодня»: просрочки, сроки ведомости, приёмки, замечания, люди', () => {
  const day = 20500;
  const p = project({
    tasks: [{ id: 't1', projectId: P, date: day, title: 'Бетон', done: 0, updatedAt: 1 }, { id: 't2', projectId: P, date: day - 2, title: 'Арматура', done: 0, updatedAt: 1 }, { id: 't3', projectId: P, date: day - 1, title: 'Готово', done: 1, updatedAt: 1 }],
    boq_items: [{ id: 'a', projectId: P, name: 'Кладка', dueDate: day - 1, position: 0, updatedAt: 1 }],
    remarks: [{ id: 'r', projectId: P, number: 1, date: day - 3, dueDate: day, status: 'OPEN', updatedAt: 1 }, { id: 'r2', projectId: P, number: 2, date: day - 3, status: 'OPEN', updatedAt: 1 }],
    crew_days: [{ id: 'c:' + day, projectId: P, crewId: 'c', date: day, people: 7, updatedAt: 1 }],
  });
  const v = p.todayView(day);
  assert.deepEqual(v.tasks.map((t) => t.id), ['t1']);
  assert.deepEqual(v.overdueTasks.map((t) => t.id), ['t2']);
  assert.equal(v.itemsDue.length, 1);
  assert.equal(v.remarksDue.length, 1);
  assert.equal(v.remarksOpen, 2);
  assert.equal(v.people, 7);
  assert.equal(v.attention, 3);
});
