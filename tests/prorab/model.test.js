// Ядро «Прораб+» в браузере: объединение по полям, как у телефона, и действия журнала.
// Запуск: node --test tests/prorab
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../../static/prorab/sync.js');
const M = require('../../static/prorab/model.js');

const schemaSrc = fs.readFileSync(path.join(__dirname, '../../static/prorab/schema.js'), 'utf8');
const ctx = { window: {} };
vm.runInNewContext(schemaSrc, ctx);
const SCHEMA = ctx.window.PRORAB_SCHEMA;

const P = 'p1';
const phone = (tables, device = 'phone') => ({ device, projectId: P, tables });

test('поля объединяются по версиям: обе правки разных полей остаются, старая не откатывает новую', () => {
  const a = phone({ volumes: [{ id: 'v', projectId: P, quantity: 5, note: 'а', updatedAt: 100, _v: { quantity: '100:A', note: '100:A' } }] }, 'A');
  const b = phone({ volumes: [{ id: 'v', projectId: P, quantity: 7, note: 'б', updatedAt: 200, _v: { quantity: '200:B', note: '50:B' } }] }, 'B');
  const st = S.mergeFiles([a, b], P, new S.Clock());
  assert.equal(st.volumes.v.values.quantity, 7);
  assert.equal(st.volumes.v.values.note, 'а');
  // Порядок файлов не важен
  const st2 = S.mergeFiles([b, a], P, new S.Clock());
  assert.deepEqual(st2.volumes.v.values, st.volumes.v.values);
});

test('чужой объект и файлы без версий', () => {
  const f = phone({ volumes: [{ id: 'x', projectId: 'other', quantity: 1, updatedAt: 1 }, { id: 'y', projectId: P, quantity: 2, updatedAt: 9 }] });
  const st = S.mergeFiles([f], P, new S.Clock());
  assert.equal(st.volumes.x, undefined);
  assert.deepEqual(st.volumes.y.vers.quantity, { h: 9, d: '~phone' });
});

test('правка: новая версия больше всех увиденных, повтор ничего не меняет, файл — в формате телефона', () => {
  const clock = new S.Clock();
  const st = S.mergeFiles([phone({ finance: [{ id: 'f', projectId: P, amountCents: 100, updatedAt: 5, _v: { amountCents: '9999999999999:A' } }] })], P, clock);
  const r = S.edit(st, SCHEMA, 'finance', 'f', { amountCents: 200 }, 'web-1', clock, 1000);
  assert.ok(r.vers.amountCents.h > 9999999999999);
  assert.equal(S.edit(st, SCHEMA, 'finance', 'f', { amountCents: 200 }, 'web-1', clock, 1001), null);
  const file = S.toFile(st, P, 'Ангар', 'web-1', 5);
  assert.equal(file.format, 1); assert.equal(file.app, 'technadzor'); assert.equal(file.device, 'web-1');
  assert.ok(S.validFile(file));
  assert.match(file.tables.finance[0]._v.amountCents, /^\d+:web-1$/);
  // Новая строка — все столбцы таблицы со значениями по умолчанию
  S.edit(st, SCHEMA, 'volumes', 'n', { projectId: P, quantity: 3 }, 'web-1', clock, 2000);
  assert.deepEqual(Object.keys(st.volumes.n.values).sort(), Object.keys(SCHEMA.volumes.cols).sort());
  assert.deepEqual(st.volumes.n.vers.note, { h: 0, d: '' }); // пустое поле — самая слабая версия
});

function project() {
  const base = phone({
    projects: [{ id: P, name: 'Ангар', updatedAt: 1 }],
    boq_items: [{ id: 'i', projectId: P, name: 'Бетонирование', unitId: 'u', updatedAt: 1 }],
    units: [{ id: 'u', projectId: P, name: 'м³', updatedAt: 1 }],
    rental_equipment: [{ id: 'e', projectId: P, kind: 'Экскаватор', name: 'JCB', termsJson: '', updatedAt: 1 }],
    crews: [{ id: 'c', projectId: P, name: 'Бетонщики', updatedAt: 1 }],
  });
  const clock = new S.Clock();
  return new M.Project(S.mergeFiles([base], P, clock), SCHEMA, P, 'web-1', clock);
}

test('«Сделано»: работа, техника с суммой — расход в финансах, люди за день', () => {
  const p = project();
  const id = p.saveDone({ date: 20010, itemId: 'i', qty: 12.5, machines: [{ equipmentId: 'e', amountCents: 1500000, minutes: 450 }], people: { c: 6 } });
  assert.equal(p.get('volumes', id).quantity, 12.5);
  assert.equal(p.get('volumes', id).name, 'Бетонирование');
  const w = p.rows('rental_work').single || p.rows('rental_work')[0];
  assert.equal(w.entryId, id); assert.equal(w.amountCents, 1500000); assert.equal(w.manualMinutes, 450);
  assert.equal(p.rows('rental_orders').length, 1); // заказ создан сам
  const f = p.get('finance', 'rw:' + w.id);
  assert.equal(f.amountCents, 1500000); assert.equal(f.category, 'RENTAL'); assert.equal(f.date, 20010);
  assert.equal(f.title, 'Техника: Экскаватор JCB — 7 ч 30 мин');
  assert.equal(p.get('crew_days', 'c:20010').people, 6);
  // Исправили сумму — та же запись; убрали технику — расход удалён
  p.saveDone({ entryId: id, date: 20010, itemId: 'i', qty: 12.5, machines: [{ workId: w.id, equipmentId: 'e', amountCents: 1800000 }] });
  assert.equal(p.get('finance', 'rw:' + w.id).amountCents, 1800000);
  assert.equal(p.rows('finance').length, 1);
  p.saveDone({ entryId: id, date: 20010, itemId: 'i', qty: 12.5, machines: [] });
  assert.equal(p.rows('finance').length, 0);
  assert.equal(p.rows('rental_work').length, 0);
  // Людей стёрли — запись дня помечена удалённой
  p.saveDone({ entryId: id, date: 20010, itemId: 'i', qty: 12.5, machines: [], people: { c: null } });
  assert.equal(p.rows('crew_days').length, 0);
  const days = p.days(null, null);
  assert.equal(days[0].works[0].unit, 'м³');
});

test('«Задача» с техникой — план без расходов; удаление убирает вызовы', () => {
  const p = project();
  const t = p.saveTask({ date: 20020, title: '', machines: ['e'], remind: true });
  assert.equal(p.get('tasks', t).title, 'Нужна техника: Экскаватор JCB');
  const c = p.get('rental_calls', 'task:' + t + ':e');
  assert.equal(c.status, 'PLANNED'); assert.equal(c.date, 20020); assert.ok(c.remindAt > 0);
  assert.equal(p.rows('finance').length, 0);
  assert.deepEqual(p.taskMachines(t), { equipment: ['e'], remind: true });
  p.saveTask({ taskId: t, date: 20021, title: 'Засыпка', machines: ['e'], done: true });
  assert.equal(p.get('rental_calls', 'task:' + t + ':e').status, 'DONE');
  assert.equal(p.get('rental_calls', 'task:' + t + ':e').date, 20021);
  p.deleteTask(t);
  assert.equal(p.rows('tasks').length, 0);
  assert.equal(p.rows('rental_calls').length, 0);
});

test('расход по технике в финансах не правится как обычный', () => {
  const p = project();
  p.saveDone({ date: 20010, machines: [{ equipmentId: 'e', amountCents: 500000 }] });
  const f = p.rows('finance')[0];
  p.saveFinance({ id: f.id, amountCents: 1, note: 'чек у прораба' });
  assert.equal(p.get('finance', f.id).amountCents, 500000);
  assert.equal(p.get('finance', f.id).note, 'чек у прораба');
  p.deleteFinance(f.id);
  assert.equal(p.rows('finance').length, 1);
});

test('вечер накануне — 18:00 по местному времени', () => {
  const ms = M.eveningBefore(20020);
  const d = new Date(ms);
  assert.equal(d.getHours(), 18);
  const day = new Date(20020 * 86400000);
  assert.equal(d.getDate(), new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - 1).getDate());
});

test('новые документы Word и Excel — zip Office Open XML', () => {
  const O = require('../../static/prorab/office.js');
  for (const [bytes, part] of [[O.docx('Акт осмотра'), 'word/document.xml'], [O.xlsx([['Работа', 12.5]], 'Смета'), 'xl/worksheets/sheet1.xml']]) {
    assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 3, 4]);
    const text = Buffer.from(bytes).toString('utf8');
    assert.ok(text.includes('[Content_Types].xml') && text.includes(part));
    assert.deepEqual(Array.from(bytes.slice(-22, -18)), [0x50, 0x4b, 5, 6]); // конец центрального каталога
  }
  assert.equal(O.crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('ведомость, отчёт за день и выгрузка журнала — из тех же записей', () => {
  const p = project();
  p.put('boq_items', 'i', { planQty: 20 });
  p.saveDone({ date: 20010, itemId: 'i', qty: 12.5, machines: [{ equipmentId: 'e', amountCents: 1500000, minutes: 450 }], people: { c: 6 } });
  p.saveDone({ date: 20011, itemId: 'i', qty: 2.5 });
  const b = p.boq().find((r) => r.id === 'i');
  assert.equal(b.fact, 15); assert.equal(b.plan, 20); assert.equal(b.percent, 75); assert.equal(b.remaining, 5); assert.equal(b.unit, 'м³');
  const text = p.dayReport(20010, 'Пт, 15 октября');
  assert.match(text, /Объект: Ангар/);
  assert.match(text, /• Бетонирование: 12,5 м³/);
  assert.match(text, /• Экскаватор JCB: работала 7 ч 30 мин/);
  assert.match(text, /Люди на объекте: 6 чел\./);
  const { byDay, totals } = p.exportRows(20010, 20011);
  assert.deepEqual(byDay.filter((r) => r[1] === 'Работы').map((r) => [r[0], r[3]]), [[20010, 12.5], [20011, 2.5]]);
  assert.deepEqual(byDay.find((r) => r[1] === 'Техника').slice(3, 5), [7.5, 'ч']);
  assert.equal(byDay.find((r) => r[1] === 'Финансы')[7], -15000);
  assert.deepEqual(totals[0].slice(0, 4), [20010, 1, 6, 7.5]);
  assert.equal(totals[0][6], 15000);
});

test('книга Excel: несколько листов, даты и стили', () => {
  const O = require('../../static/prorab/office.js');
  const bytes = O.book([{ name: 'По дням', header: true, widths: [12], rows: [['Дата'], [{ date: 20749 }]] }, { name: 'Итоги/2', rows: [[1]] }]);
  const text = Buffer.from(bytes).toString('utf8');
  assert.ok(text.includes('xl/styles.xml') && text.includes('xl/worksheets/sheet2.xml'));
  assert.ok(text.includes('<v>' + (20749 + 25569) + '</v>')); // дата Excel
  assert.ok(text.includes('name="Итоги 2"')); // недопустимый символ в имени листа заменён
});
