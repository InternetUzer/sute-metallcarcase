const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../../static/prorab/id.js');
const O = require('../../static/prorab/office.js');
const makeProject = (days = [20500, 20510, 20520]) => {
  const tables = { boq_items: [{ id: 'a', name: 'Монтаж', unitId: 'u', priceCents: 10000 }],
    volumes: days.map((date, i) => ({ id: 'v' + i, itemId: 'a', date, quantity: i + 1 })) };
  return { project: { name: 'Учебный объект' }, names: () => ({ units: { u: 'м²' } }),
    rows: (name) => tables[name] || [], itemName: () => 'Монтаж', tables };
};
const opts = (n, day, more = {}) => ({ number: String(n), contractNo: 'Д-1', contractDate: 20455, from: day, to: day, date: day + 1, vatRate: null, ...more });
const make = (p, n, day, more) => I.certificate(p, I.emptyParticipants(), opts(n, day, more));
const xml = (blocks) => Buffer.from(O.richDocx(blocks, { landscape: true })).toString('utf8');

test('пример владельца: 100 ранее + 200 сейчас; третья КС видит 300 ранее; черновики не учитываются', () => {
  const p = makeProject();
  const first = make(p, 1, 20500); first.status = 'issued';
  const second = make(p, 2, 20510);
  const unrelated = make(p, 9, 20500, { contractNo: 'Другой договор' }); unrelated.status = 'issued';
  second.ledger = I.certificateLedger([first, unrelated], second);
  assert.equal(second.ledger.prior.all, 10000);
  assert.equal(second.ledger.period.all, 20000);
  assert.equal(second.ledger.total.all, 30000);
  const third = make(p, 3, 20520);
  assert.equal(I.certificateLedger([first, second], third).prior.all, 10000);
  second.status = 'issued';
  assert.equal(I.certificateLedger([first, second, unrelated], third).prior.all, 30000);
  p.tables.boq_items[0].priceCents = 90000;
  p.tables.volumes[0].quantity = 999;
  assert.equal(I.certificateLedger([first, second], third).prior.all, 30000);
  const doc = xml(I.ks3Blocks(p, I.emptyParticipants(), { ...opts(2, 20510), certificate: second }).blocks);
  for (const t of ['Ранее предъявлено по КС-2: 100,00', 'Текущая КС-2 № 2: 200,00', 'Накоплено с текущей: 300,00']) assert.ok(doc.includes(t), t);
  assert.equal(first.rows[0].price, 10000);
  const k2 = xml(I.ks2Blocks(p, I.emptyParticipants(), { ...opts(1, 20500), certificate: first }).blocks);
  assert.ok(k2.includes('100,00'));
  assert.ok(!k2.includes('999'));
});

test('накопление по году и разным ставкам берётся из замороженных сумм, без нового расчёта НДС', () => {
  const p = makeProject([20453, 20455, 20500]);
  const first = make(p, 1, 20453, { vatRate: 20 }); first.status = 'issued';
  const second = make(p, 2, 20455, { vatRate: 22 }); second.status = 'issued';
  const third = make(p, 3, 20500, { vatRate: 5 });
  const ledger = I.certificateLedger([first, second], third);
  assert.deepEqual(ledger.prior, { base: 30000, vat: 6400, all: 36400 });
  assert.deepEqual(ledger.year, { base: 50000, vat: 5900, all: 55900 });
  assert.deepEqual(ledger.total, { base: 60000, vat: 7900, all: 67900 });
});

test('НДС в цене: сумма без НДС + НДС равна сохранённому итогу; 0% отличается от без НДС', () => {
  const p = makeProject(); p.tables.boq_items[0].priceCents = 12200;
  const c = make(p, 1, 20500, { vatRate: 22, vatIncluded: true });
  c.ledger = I.certificateLedger([], c);
  assert.deepEqual(c.totals, { base: 10000, vat: 2200, all: 12200 });
  const out = xml(I.ks3Blocks(p, I.emptyParticipants(), { ...opts(1, 20500), certificate: c }).blocks);
  for (const amount of ['100,00', '22,00', '122,00']) assert.ok(out.includes(amount));
  for (const rate of [0, null]) {
    const r = make(p, 1, 20500, { vatRate: rate }); r.ledger = I.certificateLedger([], r);
    const text = xml(I.ks3Blocks(p, I.emptyParticipants(), { ...opts(1, 20500), certificate: r }).blocks);
    assert.ok(text.includes(rate === 0 ? 'НДС (текущий период 0%)' : 'Без НДС (текущий период)'));
  }
});

test('период, повтор номера, пересечение, отсутствующая цена и договор не проходят молча', () => {
  const p = makeProject();
  assert.throws(() => make(p, 1, 20500, { from: null }), /начало/);
  assert.throws(() => make(p, 1, 20500, { to: 20400 }), /период/);
  assert.throws(() => make(p, 1, 20500, { from: 20453, to: 20455 }), /годам/);
  assert.throws(() => make(p, 1, 20500, { contractNo: '' }), /договора/);
  assert.throws(() => make(p, 1, 20500, { vatRate: undefined }), /НДС/);
  const first = make(p, 1, 20500); first.status = 'issued';
  assert.throws(() => I.certificateLedger([first], make(p, 1, 20510)), /номером/);
  assert.throws(() => I.certificateLedger([first], make(p, 2, 20500)), /пересекающийся/);
  assert.throws(() => I.certificateLedger([first, first], make(p, 2, 20510)), /Повтор/);
  p.tables.boq_items[0].priceCents = null;
  assert.throws(() => make(p, 2, 20510), /без цены/);
  p.tables.boq_items[0].priceCents = 0;
  assert.equal(make(p, 2, 20510).totals.all, 0);
  p.tables.volumes[0].itemId = 'deleted';
  assert.throws(() => make(p, 1, 20500), /без действующей позиции/);
});

test('округление до копейки и защита от переполнения', () => {
  const p = makeProject();
  p.tables.boq_items[0].priceCents = 100;
  p.tables.volumes[0].quantity = 0.575;
  assert.equal(make(p, 1, 20500).totals.all, 58);
  assert.throws(() => I.vat(Number.MAX_SAFE_INTEGER, 22, false), /диапазон/);
});

test('таблица Word помещается в печатную область альбомного и обычного листа', () => {
  for (const [landscape, max] of [[true, 14853], [false, 10205]]) {
    const text = Buffer.from(O.richDocx([{ table: [['A', 'B']], widths: [10000, 10000] }], { landscape })).toString('utf8');
    const sizes = [...text.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
    assert.ok(sizes.reduce((a, b) => a + b, 0) <= max);
  }
});
