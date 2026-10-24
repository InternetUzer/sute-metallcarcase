// Свои шаблоны документов: метки в фигурных скобках в Word и Excel.
// Запуск: node --test tests/prorab
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../../static/prorab/sync.js');
const M = require('../../static/prorab/model.js');
const I = require('../../static/prorab/id.js');
const T = require('../../static/prorab/templates.js');

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../static/prorab/schema.js'), 'utf8'), ctx);
const SCHEMA = ctx.window.PRORAB_SCHEMA;
const P = 'p1';
const project = () => new M.Project(S.mergeFiles([{ device: 'phone', projectId: P, tables: {
  projects: [{ id: P, name: 'Склад', address: 'г. Казань, ул. Тестовая, 1', updatedAt: 1 }],
  project_fields: [{ id: 'f', projectId: P, name: 'Номер договора', value: '17/26', position: 0, updatedAt: 1 }],
} }], P, new S.Clock()), SCHEMA, P, 'web-1', new S.Clock());
function people() {
  const d = I.emptyParticipants();
  I.saveOrg(d, { role: 'customer', name: 'ООО «Агро & Ко»', inn: '1655123456' });
  I.saveRep(d, { role: 'customerControl', fio: 'Петров П. П.', position: 'инженер' });
  return d;
}
const fixture = (n) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', n)));
const textOf = async (bytes, part) => new TextDecoder().decode((await T.unzip(bytes)).find((e) => e.name === part).data);

test('Word (файл из LibreOffice, сжатый): метки заполняются, регистр и подчёркивания не важны, неизвестные остаются', async () => {
  const d = people();
  const act = Object.assign(I.draft(project(), d, { today: 20500 }), { number: 12, works: 'Армирование\nФ1–Ф3' });
  const res = await T.fill(fixture('template.docx'), T.values(project(), d, act, 20500));
  const xml = await textOf(res.bytes, 'word/document.xml');
  for (const s of ['АКТ № 12', 'Склад, г. Казань, ул. Тестовая, 1', 'ООО «Агро &amp; Ко»', 'ИНН 1655123456', '17/26', 'Петров П. П.', 'Армирование</w:t><w:br/>']) assert.ok(xml.includes(s), s);
  assert.deepEqual(res.missing, ['{НЕТ ТАКОЙ МЕТКИ}']);
  assert.ok(xml.includes('{НЕТ ТАКОЙ МЕТКИ}'));
  assert.ok(res.used.includes('ЗАСТРОЙЩИК ИНН'));
  // Результат снова открывается как Word
  assert.ok((await T.unzip(res.bytes)).some((e) => e.name === '[Content_Types].xml'));
});

test('Excel: метки в ячейках', async () => {
  const res = await T.fill(fixture('template.xlsx'), T.values(project(), people(), null, 20500), 'xlsx');
  const all = (await T.unzip(res.bytes)).filter((e) => e.name.startsWith('xl/')).map((e) => new TextDecoder().decode(e.data)).join('');
  assert.ok(all.includes('Склад'));
  assert.ok(all.includes('ООО «Агро &amp; Ко»'));
  assert.ok(all.includes(I.dmy(20500)));
  assert.deepEqual(res.missing, []);
});

test('метка, которую Word разрезал на части, всё равно находится', () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>Объект: {ОБ</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ЪЕ</w:t></w:r><w:r><w:t xml:space="preserve">КТ} и {АД</w:t></w:r><w:r><w:t>РЕС}.</w:t></w:r></w:p>' +
    '<w:p><w:pPr/><w:r><w:t>{нет}</w:t></w:r><w:r><w:tab/></w:r></w:p></w:body></w:document>';
  const used = new Set(), missing = new Set();
  const out = T.fillXml(xml, new Map([['ОБЪЕКТ', 'Склад <1>'], ['АДРЕС', 'Казань']]), used, missing, 'docx');
  assert.ok(out.includes('<w:t xml:space="preserve">Объект: Склад &lt;1&gt;</w:t>'));
  assert.equal(out.match(/<w:p>[\s\S]*?<\/w:p>/)[0].replace(/<[^>]+>/g, ''), 'Объект: Склад &lt;1&gt; и Казань.');
  assert.ok(out.includes('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve"></w:t>')); // оформление кусков не трогаем
  assert.ok(out.includes('<w:tab/>'));
  assert.deepEqual(Array.from(missing), ['{нет}']);
  assert.equal(T.norm(' застройщик_инн '), 'ЗАСТРОЙЩИК ИНН');
  assert.equal(T.norm('Ёмкость'), 'ЕМКОСТЬ');
});

test('список меток: без акта нет меток акта, свои поля карточки есть', () => {
  const v = T.values(project(), people(), null, 20500);
  assert.ok(!v.some((x) => x.key === 'РАБОТЫ'));
  assert.equal(v.find((x) => x.key === 'НОМЕР ДОГОВОРА').value, '17/26');
  assert.equal(v.find((x) => x.key === 'ПРЕДСТАВИТЕЛЬ ЗАСТРОЙЩИКА').value, 'Петров П. П.');
});
