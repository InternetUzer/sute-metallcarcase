const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../../static/prorab/grid.js'), D = require('../../static/prorab/dxf.js');

test('новый DXF содержит размерную сетку, подписи и узлы пересечения осей', () => {
  const p = { length: 24, width: 12, xCount: 5, yCount: 3, axes: true };
  const text = G.dxf(p), d = D.parse(new TextEncoder().encode(text));
  assert.deepEqual(G.read(text), p);
  assert.equal(d.units, 4); assert.deepEqual(d.warnings, []);
  assert.equal(d.layers.PRORAB_SHEET.visible, false);
  assert.ok(d.texts.some((t) => t.text === 'А'));
  assert.ok(d.texts.some((t) => t.text === '5'));
  const x = 12000 - d.originX, y = 6000 - d.originY;
  assert.deepEqual(D.snap(d, x + 1, y + 1, 10, new Set(['PRORAB_SHEET'])), [x, y]);
  const next = G.read(G.dxf({ ...p, length: 30, width: 18, xCount: 6 }));
  assert.equal(next.length, 30); assert.equal(next.width, 18); assert.equal(next.xCount, 6);
});

test('чистое поле не содержит видимой геометрии; оси можно добавить позже', () => {
  const text = G.dxf({ length: 10, width: 8, axes: false }), d = D.parse(new TextEncoder().encode(text));
  assert.equal(d.texts.length, 0);
  assert.equal(d.lines.filter((l) => d.layers[l.layer].visible).length, 0);
  assert.deepEqual(d.fitBox, [0, 0, 10000, 8000]);
  assert.equal(D.snap(d, 0, 0, 100, new Set(['PRORAB_SHEET'])), null);
  assert.ok(G.read(text));
  const withAxes = D.parse(new TextEncoder().encode(G.dxf({ ...G.read(text), axes: true })));
  assert.ok(withAxes.lines.some((l) => withAxes.layers[l.layer].visible));
});

test('параметры ограничены; чужой или изменённый DXF нельзя случайно пересоздать', () => {
  assert.equal(G.settings({ length: '12,5' }).length, 12.5);
  assert.equal(G.settings({ axes: false, xCount: '' }).xCount, G.DEFAULTS.xCount);
  for (const length of [0, -2, 'нет', Infinity, 10001]) assert.throws(() => G.dxf({ length }));
  for (const xCount of [1, 52, 2.5, NaN]) assert.throws(() => G.dxf({ xCount }));
  assert.equal(G.read('0\nEOF\n'), null);
  assert.equal(G.read(G.dxf({}).replace('PRORAB_AXES\n', 'OTHER_AXES\n')), null);
  assert.equal(G.read('999\nPRORAB_GRID_V1:{oops}\n'), null);
  const max = D.parse(new TextEncoder().encode(G.dxf({ xCount: 51, yCount: 51 })));
  assert.equal(max.texts.length, 102);
});
