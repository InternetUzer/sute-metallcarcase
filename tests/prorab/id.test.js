// Исполнительная документация: участники и АОСР.
// Запуск: node --test tests/prorab
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../../static/prorab/sync.js');
const M = require('../../static/prorab/model.js');
const I = require('../../static/prorab/id.js');
const O = require('../../static/prorab/office.js');

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../static/prorab/schema.js'), 'utf8'), ctx);
const SCHEMA = ctx.window.PRORAB_SCHEMA;
const P = 'p1';
const project = (tables) => new M.Project(S.mergeFiles([{ device: 'phone', projectId: P, tables }], P, new S.Clock()), SCHEMA, P, 'web-1', new S.Clock());

function participants() {
  const d = I.emptyParticipants();
  I.saveOrg(d, { role: 'customer', name: 'ООО «Заказчик»', inn: '7701234567', ogrn: '1027700000000', address: 'г. Москва' });
  I.saveOrg(d, { role: 'builder', name: 'ООО «Металл-Каркас»', inn: '1655000000' });
  const perf = I.saveOrg(d, { role: 'performer', name: 'СтройМонтаж' });
  I.saveRep(d, { role: 'customerControl', fio: 'Петров П. П.', position: 'инженер ТН', nrs: 'С-77-123456', order: 'приказ № 5 от 01.02.2026' });
  I.saveRep(d, { role: 'builder', fio: 'Иванов И. И.', position: 'прораб' });
  I.saveRep(d, { role: 'performer', fio: 'Сидоров С. С.', orgId: perf.id });
  I.setDefaults(d, { project: 'Шифр 12-КЖ, л. 3–5', norms: 'СП 70.13330.2012' });
  return d;
}

test('участники: проверка ИНН/ОГРН, объединение версий', () => {
  const d = I.emptyParticipants();
  assert.throws(() => I.saveOrg(d, { role: 'customer', name: 'X', inn: '123' }), /ИНН/);
  assert.throws(() => I.saveOrg(d, { role: 'customer', name: 'X', ogrn: '12' }), /ОГРН/);
  assert.throws(() => I.saveRep(d, { role: 'builder', fio: ' ' }), /фамилию/);
  const a = participants();
  const b = JSON.parse(JSON.stringify(a));
  const r = b.reps[1];
  I.saveRep(b, Object.assign({}, r, { position: 'начальник участка' }));
  I.remove(a, 'orgs', a.orgs[2].id);
  const m = I.mergeParticipants(a, b);
  assert.equal(m.reps.find((x) => x.id === r.id).position, 'начальник участка');
  assert.equal(I.orgs(m).length, 2); // удаление на одном компьютере не «воскресает» из другой версии
  assert.equal(I.orgs(I.mergeParticipants(b, a)).length, 2);
});

test('черновик АОСР из позиции ведомости: работы с объёмом, даты, исполнитель, последующие работы, подписанты', () => {
  const p = project({
    projects: [{ id: P, name: 'Склад', address: 'г. Казань, ул. Тестовая, 1', updatedAt: 1 }],
    units: [{ id: 'u', projectId: P, name: 'м³', updatedAt: 1 }],
    contractors: [{ id: 'k', projectId: P, name: 'стройМонтаж', updatedAt: 1 }],
    boq_items: [
      { id: 'a', projectId: P, name: 'Армирование фундаментов', unitId: 'u', contractorId: 'k', position: 0, updatedAt: 1 },
      { id: 'b', projectId: P, name: 'Бетонирование фундаментов', unitId: 'u', position: 1, updatedAt: 1 },
    ],
    volumes: [
      { id: 'v1', projectId: P, itemId: 'a', date: 20400, quantity: 2.5, note: 'Ф1–Ф3', updatedAt: 1 },
      { id: 'v2', projectId: P, itemId: 'a', date: 20402, quantity: 1.5, note: '', updatedAt: 1 },
      { id: 'v3', projectId: P, itemId: 'a', date: 20410, quantity: 9, updatedAt: 1 },
    ],
  });
  const d = participants();
  const act = I.draft(p, d, { itemId: 'a', to: 20405, today: 20406 });
  assert.equal(act.works, 'Армирование фундаментов — 4 м³ (Ф1–Ф3)');
  assert.equal(act.start, 20400);
  assert.equal(act.end, 20402);
  assert.equal(act.next, 'Бетонирование фундаментов');
  assert.equal(act.place, 'г. Казань');
  assert.equal(act.project, 'Шифр 12-КЖ, л. 3–5');
  assert.equal(d.orgs.find((o) => o.id === act.performerId).name, 'СтройМонтаж');
  assert.equal(act.repIds.length, 3);
  act.number = I.nextNumber([{ number: '3' }, { number: 7 }]);
  assert.equal(act.number, 8);
  assert.deepEqual(I.missing(act, d), []);
  assert.ok(I.missing(Object.assign({}, act, { project: '', repIds: [] }), d).includes('п. 2 — проектная документация'));
  assert.equal(I.fileName(act), 'АОСР №8 от 14.11.2025 — Армирование фундаментов.docx');
});

test('АОСР в Word: правильный пакет и все пункты формы', () => {
  const p = project({ projects: [{ id: P, name: 'Склад', address: 'г. Казань', updatedAt: 1 }] });
  const d = participants();
  const act = Object.assign(I.draft(p, d, { today: 20406 }), { number: 1, works: 'Устройство гидроизоляции <фундамента> & стен', start: 20400, end: 20401, performerId: d.orgs[2].id });
  const bytes = O.richDocx(I.blocks(act, d, p.project));
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  const text = Buffer.from(bytes).toString('utf8');
  for (const s of ['освидетельствования скрытых работ', 'К освидетельствованию предъявлены', 'Разрешается производство последующих работ', 'Петров П. П.', 'С-77-123456',
    'ИНН 7701234567', 'СтройМонтаж', 'Устройство гидроизоляции &lt;фундамента&gt; &amp; стен', '«14» ноября 2025 г.', 'СП 70.13330.2012']) assert.ok(text.includes(s), s);
});

test('общий журнал работ: работы по дням с погодой, замечания, ИД, персонал', () => {
  const p = project({
    projects: [{ id: P, name: 'Склад', address: 'г. Казань', startDate: 20390, updatedAt: 1 }],
    units: [{ id: 'u', projectId: P, name: 'м³', updatedAt: 1 }],
    contractors: [{ id: 'k', projectId: P, name: 'СтройМонтаж', updatedAt: 1 }],
    boq_items: [{ id: 'a', projectId: P, name: 'Бетонирование', unitId: 'u', position: 0, updatedAt: 1 }],
    volumes: [
      { id: 'v1', projectId: P, itemId: 'a', date: 20400, quantity: 4, note: 'Ф1', contractorId: 'k', updatedAt: 1 },
      { id: 'v2', projectId: P, itemId: 'a', date: 20400, quantity: 2, contractorId: 'k', updatedAt: 1 },
      { id: 'v3', projectId: P, itemId: 'a', date: 20420, quantity: 9, updatedAt: 1 },
    ],
    day_weather: [{ id: 'w', projectId: P, date: 20400, tMin: -2.4, tMax: 4.6, precip: 1.26, wind: 7, updatedAt: 1 }],
    crew_days: [{ id: 'c:20400', projectId: P, crewId: 'c', date: 20400, people: 6, updatedAt: 1 }],
    remarks: [{ id: 'r', projectId: P, number: 1, date: 20401, text: 'Раковины', place: 'Ф1', dueDate: 20405, status: 'DONE', doneDate: 20404, doneNote: 'затёрли', updatedAt: 1 }],
  });
  const rows = I.ojrWorkRows(p, null, 20410);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].works, 'Бетонирование — 4 м³ (Ф1);\nБетонирование — 2 м³');
  assert.equal(rows[0].weather, '-2…5 °C, осадки 1,3 мм, ветер до 7 м/с');
  assert.equal(rows[0].who, 'СтройМонтаж');
  assert.equal(rows[0].people, 6);
  const ctrl = I.ojrControlRows(p, null, null);
  assert.equal(ctrl[0].text, 'Раковины (Ф1)');
  assert.equal(ctrl[0].done, 20404);
  const d = participants();
  const blocks = I.ojrBlocks(p, d, { from: null, to: 20410, today: 20410, settings: { number: '1', permit: '16-RU-123-2026', journals: [{ name: 'Журнал бетонных работ', keeper: 'Иванов И. И.' }] },
    acts: [{ number: 3, date: 20402, works: 'Армирование', signed: true }] });
  const bytes = O.richDocx(blocks, { landscape: true });
  const text = Buffer.from(bytes).toString('utf8');
  for (const s of ['ОБЩИЙ ЖУРНАЛ № 1', '16-RU-123-2026', 'Раздел 1.', 'Раздел 6.', 'Иванов И. И.', 'Журнал бетонных работ', 'Раковины (Ф1)', 'затёрли',
    'Акт освидетельствования скрытых работ № 3', 'w:orient="landscape"', '<w:tblHeader/>', 'Петров П. П.']) assert.ok(text.includes(s), s);
  assert.ok(!text.includes('— 9 м³')); // запись после периода не попала
});
