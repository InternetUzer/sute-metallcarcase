// Экономика собственника: шифрование кодом и расчёты по объекту.
// Запуск: node --test tests/prorab
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../../static/prorab/sync.js');
const M = require('../../static/prorab/model.js');
const V = require('../../static/prorab/vault.js');
const E = require('../../static/prorab/economy.js');

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../static/prorab/schema.js'), 'utf8'), ctx);
const SCHEMA = ctx.window.PRORAB_SCHEMA;
const P = 'p1';
const project = (tables) => new M.Project(S.mergeFiles([{ device: 'phone', projectId: P, tables }], P, new S.Clock()), SCHEMA, P, 'web-1', new S.Clock());
const FAST = { iterations: 1000 }; // в браузере 600 000

test('шифр: открывается только кодом или кодом восстановления, подмену видно', async () => {
  await assert.rejects(V.create('1234567', FAST), /не короче 8/);
  const { vault, recovery } = await V.create('секрет-2026', FAST);
  assert.match(recovery, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);
  const data = E.empty();
  E.setFields(data, P, { contractCents: 1000000000 });
  const file = JSON.parse(JSON.stringify(await V.seal(vault, data, 3)));
  // В файле нет ни суммы, ни названий
  assert.ok(!JSON.stringify(file).includes('1000000000'));
  assert.equal(file.rev, 3);
  await assert.rejects(V.unlock(file, 'не тот код'), /Неверный код/);
  const byCode = await V.unlock(file, 'секрет-2026');
  assert.equal((await V.open(byCode, file)).projects[P].contractCents, 1000000000);
  const byRecovery = await V.unlock(file, recovery.toLowerCase().replace(/-/g, ' '), true);
  assert.equal((await V.open(byRecovery, file)).projects[P].contractCents, 1000000000);
  // Смена кода: старый не подходит, данные те же
  await V.changeCode(byCode, 'новый-код-2027');
  const file2 = await V.seal(byCode, data, 4);
  await assert.rejects(V.unlock(file2, 'секрет-2026'), /Неверный код/);
  assert.ok(await V.unlock(file2, 'новый-код-2027'));
  // Подмена шифра
  const bad = JSON.parse(JSON.stringify(file2));
  bad.payload.data = Buffer.from(Buffer.from(bad.payload.data, 'base64').map((b, i) => (i === 5 ? b ^ 1 : b))).toString('base64');
  await assert.rejects(V.open(await V.unlock(bad, 'новый-код-2027'), bad), /повреждены/);
});

test('объединение двух версий: поздняя правка поля и записи побеждает, удаление не воскресает', () => {
  const a = E.empty(), b = E.empty();
  E.setFields(a, P, { contractCents: 100, note: 'а' });
  const pay = E.saveItem(a, P, 'payments', { date: 10, amountCents: 50 });
  const b2 = JSON.parse(JSON.stringify(a));
  E.setFields(b2, P, { contractCents: 200 });
  E.deleteItem(b2, P, 'payments', pay.id);
  E.setFields(a, P, { note: 'б' });
  const m = E.merge(a, b2);
  assert.equal(m.projects[P].contractCents, 200);
  assert.equal(m.projects[P].note, 'б');
  assert.equal(E.items(m.projects[P], 'payments').length, 0);
  assert.deepEqual(E.merge(b2, a), m);
  void b;
});

test('расчёт по объекту: выполнено, долг заказчика, прогноз, маржа, отставание', () => {
  const day = 20500;
  const p = project({
    projects: [{ id: P, name: 'Ангар', startDate: day - 50, deadline: day + 50, updatedAt: 1 }],
    boq_items: [{ id: 'a', projectId: P, name: 'Бетон', planQty: 100, priceCents: 1000000, position: 0, updatedAt: 1 }],
    volumes: [{ id: 'v', projectId: P, itemId: 'a', date: day - 1, quantity: 25, updatedAt: 1 }],
    finance: [
      { id: 'f1', projectId: P, type: 'EXPENSE', date: day - 5, amountCents: 30000000, category: 'MATERIALS', updatedAt: 1 },
      { id: 'f2', projectId: P, type: 'INCOME', date: day - 4, amountCents: 10000000, updatedAt: 1 },
    ],
  });
  const data = E.empty();
  E.setFields(data, P, { contractCents: 120000000, budget: { MATERIALS: 60000000, CONTRACTOR: 30000000 } });
  E.saveItem(data, P, 'payments', { date: day - 3, amountCents: 5000000 });
  E.saveItem(data, P, 'stages', { date: day - 10, amountCents: 40000000, title: 'Аванс' });
  const s = E.summary(p, data.projects[P], day);
  assert.equal(s.earned, 25000000); // 25 м³ × 10 000 ₽
  assert.equal(s.progress, 0.25);
  assert.equal(s.received, 15000000); // из «Финансов» + видимое только собственнику
  assert.equal(s.workUnpaid, 10000000);
  assert.equal(s.customerDebt, 25000000); // только просроченный график оплат
  assert.equal(s.budget, 90000000);
  assert.equal(s.forecast, 120000000); // 300 000 ₽ при 25% → 1 200 000 ₽
  assert.equal(s.marginForecast, 0);
  assert.equal(s.marginPlan, 30000000);
  assert.equal(s.stagesLate, 25000000);
  assert.ok(Math.abs(s.lag - 0.25) < 1e-9);
  assert.ok(s.alerts.includes('готовность ниже равномерного темпа на 25 п.п.'));
  assert.ok(s.alerts.includes('прогноз выше бюджета'));
  assert.ok(s.alerts.includes('заказчик задерживает оплату'));
  const t = E.total([s, E.summary(project({ projects: [{ id: P, name: 'Пусто', updatedAt: 1 }] }), undefined, day)]);
  assert.equal(t.contract, 120000000);
  assert.equal(t.spent, 30000000);
});

test('overruns and unplanned work cannot hide unfinished planned work', () => {
  const p = project({
    projects: [{ id: P, name: 'Объект', updatedAt: 1 }],
    boq_items: [
      { id: 'a', projectId: P, planQty: 10, priceCents: 100, updatedAt: 1 },
      { id: 'b', projectId: P, planQty: 10, priceCents: 100, updatedAt: 1 },
      { id: 'extra', projectId: P, planQty: null, priceCents: 1000, updatedAt: 1 },
    ],
    volumes: [
      { id: 'v1', projectId: P, itemId: 'a', quantity: 20, date: 10, updatedAt: 1 },
      { id: 'v2', projectId: P, itemId: 'extra', quantity: 100, date: 10, updatedAt: 1 },
    ],
  });
  const s = E.summary(p, undefined, 11);
  assert.equal(s.progress, 0.5); assert.equal(s.customerDebt, null);
  assert.equal(s.earned, 102000);
});

test('partial acceptance counts; later work does not change earlier whole-item acceptance', () => {
  const p = project({
    projects: [{ id: P, name: 'Объект', updatedAt: 1 }],
    boq_items: [{ id: 'a', projectId: P, planQty: 10, priceCents: 100, updatedAt: 1 }],
    volumes: [
      { id: 'v1', projectId: P, itemId: 'a', quantity: 3, date: 10, updatedAt: 1 },
      { id: 'v2', projectId: P, itemId: 'a', quantity: 5, date: 20, updatedAt: 1 },
    ],
    acceptances: [{ id: 'acc1', projectId: P, itemId: 'a', entryId: 'v1', qty: 3, readyDate: 10, result: 'ACCEPTED', updatedAt: 1 }],
  });
  assert.equal(E.summary(p, undefined, 25).handedOver, 300);
  p.put('acceptances', 'acc2', { projectId: P, itemId: 'a', readyDate: 10, result: 'ACCEPTED' });
  assert.equal(E.summary(p, undefined, 25).handedOver, 300); // v1 counted once, v2 not accepted
});

test('payment due today is not overdue; future stages are not debt', () => {
  const p = project({ projects: [{ id: P, name: 'Объект', updatedAt: 1 }] });
  const data = E.empty();
  E.saveItem(data, P, 'stages', { date: 20, amountCents: 500 });
  assert.equal(E.summary(p, data.projects[P], 20).customerDebt, 0);
  assert.equal(E.summary(p, data.projects[P], 21).customerDebt, 500);
});

test('malformed KDF and missing ciphertext fail before loading data', async () => {
  const { vault } = await V.create('long-test-code', FAST);
  const file = await V.seal(vault, E.empty());
  file.kdf.iterations = 4294967295;
  await assert.rejects(V.unlock(file, 'long-test-code'), /повреждён/);
  await assert.rejects(V.open(vault, { ...file, payload: undefined }), /повреждены/);
  assert.throws(() => E.validate({ version: 2, projects: {} }), /версия/);
});
