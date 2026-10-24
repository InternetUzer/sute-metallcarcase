const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../../static/prorab/shapes.js');
const D = require('../../static/prorab/dxf.js');

test('точки: формат как в приложении, испорченные пары пропускаются', () => {
  const pts = [[0, 0], [2400.5, -1.25], [1e6, 3]];
  assert.equal(S.encode(pts), '0,0;2400.5,-1.25;1000000,3');
  assert.deepEqual(S.decode(S.encode(pts)), pts);
  assert.deepEqual(S.decode('1,2;x,3;4;NaN,1;'), [[1, 2]]);
  assert.deepEqual(S.decode(null), []);
});

test('размер и площадь в метрах, подписи как в приложении', () => {
  const v = S.value('dim', [[0, 0], [2400, 0]], 0.001);
  assert.ok(Math.abs(v - 2.4) < 1e-9);
  assert.equal(S.label({ kind: 'dim', value: v }), '2 400 мм');
  const a = S.value('area', [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], 0.001);
  assert.ok(Math.abs(a - 12) < 1e-9);
  assert.equal(S.label({ kind: 'area', value: a }), '12,00 м²');
  assert.equal(S.value('dim', [[0, 0], [1, 0]], null), null);
  assert.equal(S.formatMeters(12.345), '12,35 м');
  assert.ok(Math.abs(S.metersPerUnit(true, 0, 100) - 0.0254 / 72 * 100) < 1e-12);
  assert.equal(S.metersPerUnit(true, 0, null), null);
  assert.equal(S.metersPerUnit(false, 6, null), 1);
  assert.equal(S.metersPerUnit(false, 0, null), 0.001);
});

test('выбор касанием, орто, готовность фигуры', () => {
  const shapes = [
    { kind: 'line', points: [[0, 0], [100, 0]] },
    { kind: 'rect', points: [[0, 10], [50, 60]] },
    { kind: 'text', points: [[200, 200]], text: 'Ось А', size: 10 },
  ];
  assert.equal(S.pick(shapes, 50, 2, 5), 0);
  assert.equal(S.pick(shapes, 50, 30, 5), 1);
  assert.equal(S.pick(shapes, 210, 205, 5), 2);
  assert.equal(S.pick(shapes, 500, 500, 5), -1);
  assert.deepEqual(S.ortho([0, 0], [10, 2]), [10, 0]);
  assert.deepEqual(S.ortho([0, 0], [1, -7]), [0, -7]);
  assert.equal(S.complete('area', [[0, 0], [1, 1]]), false);
  assert.equal(S.complete('text', [[0, 0]]), true);
});

test('DXF: тот же файл, что даёт приложение; читается обратно с русским текстом', () => {
  const shapes = [
    { kind: 'line', points: [[1000, 2000], [5000, 2000]], color: '#FF3B30' },
    { kind: 'dim', points: [[0, 0], [2400, 0]], value: 2.4, color: '#FF3B30' },
    { kind: 'area', points: [[0, 0], [4000, 0], [4000, 3000]], value: 6, color: '#FF3B30' },
    { kind: 'text', points: [[100, 100]], text: 'Бетон B25 «Ф1»', size: 250, color: '#FF3B30' },
  ];
  const text = S.dxf(shapes, 200, 4);
  assert.ok(/^[\x09-\x7e\n]*$/.test(text));
  // Тот же набор фигур в приложении (ShapeCore.kt) — эталон из прогона Kotlin
  const kotlin = require('fs').readFileSync(__dirname + '/fixtures/markup-kotlin.dxf', 'utf8');
  assert.equal(text, kotlin);
  const d = D.parse(new TextEncoder().encode(text));
  assert.deepEqual(d.texts.map((t) => t.text).sort(), ['2 400 мм', '6,00 м²', 'Бетон B25 «Ф1»'].sort());
  assert.deepEqual(Object.keys(d.layers), ['PRORAB_MARKUP']);
});

test('запись таблицы drawing_shapes → фигура', () => {
  const s = S.fromRow({ id: 's1', kind: 'dim', points: '0,0;2400,0', text: '', color: '#007aff', size: null, value: 2.4, width: 2, page: 1 });
  assert.equal(s.kind, 'dim'); assert.equal(s.color, '#007AFF'); assert.deepEqual(s.points, [[0, 0], [2400, 0]]); assert.equal(s.page, 1);
  assert.equal(S.fromRow({ kind: 'странное' }).kind, 'line');
});

test('модель: линии с телефона видны, свои — записываются всеми полями таблицы приложения', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const SY = require('../../static/prorab/sync.js'), M = require('../../static/prorab/model.js');
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../static/prorab/schema.js'), 'utf8'), ctx);
  const SCHEMA = ctx.window.PRORAB_SCHEMA;
  assert.deepEqual(Object.keys(SCHEMA.drawing_shapes.cols).sort(), ['color', 'createdAt', 'deleted', 'drawingId', 'id', 'kind', 'page', 'points', 'projectId', 'size', 'text', 'updatedAt', 'value', 'viewId', 'width']);
  const phone = { id: 'sh1', projectId: 'p1', drawingId: 'd1', page: 0, kind: 'dim', points: '0,0;2400,0', text: '', color: '#FF3B30', width: 2, size: null, value: 2.4, viewId: null, createdAt: 1, updatedAt: 1, deleted: 0 };
  const P = new M.Project(SY.mergeFiles([{ device: 'phone', projectId: 'p1', tables: { drawing_shapes: [phone] } }], 'p1', new SY.Clock()), SCHEMA, 'p1', 'web-1', new SY.Clock());
  assert.deepEqual(P.shapesOf('d1').map((r) => r.id), ['sh1']);
  const t = P.addShape({ drawingId: 'd1', kind: 'text', points: [[10, 20]], text: '  Ось А ', size: 150, color: '#007aff' });
  assert.equal(t.text, 'Ось А'); assert.equal(t.color, '#007AFF'); assert.equal(t.points, '10,20'); assert.equal(t.width, 2); assert.equal(t.deleted, 0);
  assert.throws(() => P.addShape({ drawingId: 'd1', kind: 'area', points: [[0, 0], [1, 1]] }), /Не хватает точек/);
  assert.throws(() => P.addShape({ drawingId: 'd1', kind: 'text', points: [[0, 0]], text: ' ' }), /Пустая надпись/);
  P.updateShape('sh1', { color: '#34C759' });
  P.deleteShape(t.id);
  assert.deepEqual(P.shapesOf('d1').map((r) => [r.id, r.color]), [['sh1', '#34C759']]);
  const file = SY.toFile(P.state, 'p1', 'Ангар', 'web-1', 5);
  const rows = file.tables.drawing_shapes;
  assert.equal(rows.length, 2);
  for (const r of rows) for (const col of Object.keys(SCHEMA.drawing_shapes.cols)) assert.ok(col in r, col + ' в ' + r.id);
});

test('состав объекта и привязки приложения сохраняются при добавлении линии и обратной синхронизации', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const SY = require('../../static/prorab/sync.js'), M = require('../../static/prorab/model.js');
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync('static/prorab/schema.js', 'utf8'), ctx);
  const node = { id: 'node-1', projectId: 'p1', label: 'Фундамент', updatedAt: 1, deleted: 0 };
  const binding = { id: 'work-1', itemId: 'work-1', projectId: 'p1', nodeId: node.id, templateKey: 'foundation', templateRevision: 1,
    templateSnapshotJson: '{"label":"Фундамент"}', segmentKey: 'whole', alternativeGroup: null, variantMode: null, updatedAt: 1, deleted: 0 };
  const phone = { device: 'phone', projectId: 'p1', tables: { project_nodes: [node], work_bindings: [binding] } };
  const P = new M.Project(SY.mergeFiles([phone], 'p1', new SY.Clock()), ctx.window.PRORAB_SCHEMA, 'p1', 'web', new SY.Clock());
  for (const name of ['id', 'projectId', 'updatedAt', 'deleted']) assert.ok(name in ctx.window.PRORAB_SCHEMA.work_bindings.cols);
  P.addShape({ drawingId: 'd1', kind: 'line', points: [[0, 0], [100, 100]] });
  const saved = SY.toFile(P.state, 'p1', 'Объект', 'web', 5);
  const merged = SY.mergeFiles([phone, saved], 'p1', new SY.Clock());
  assert.deepEqual(merged.project_nodes[node.id].values, node);
  assert.deepEqual(merged.work_bindings[binding.id].values, binding);
  assert.equal(Object.keys(merged.drawing_shapes).length, 1);
  const deletion = { device: 'phone', projectId: 'p1', tables: { work_bindings: [{ ...binding, deleted: 1, updatedAt: 10 }] } };
  assert.equal(SY.mergeFiles([saved, deletion], 'p1', new SY.Clock()).work_bindings[binding.id].values.deleted, 1);
});

test('углы 15/30/45/90: направления во всех квадрантах и сохранение прежнего Орто', () => {
  const start = [123456, -789012];
  for (const step of S.ANGLE_STEPS) for (let deg = -179; deg < 180; deg += 7) {
    const a = deg * Math.PI / 180, end = [start[0] + 100 * Math.cos(a), start[1] + 100 * Math.sin(a)];
    const p = S.constrainAngle(start, end, step), dx = p[0] - start[0], dy = p[1] - start[1];
    const angle = Math.atan2(dy, dx) * 180 / Math.PI / step;
    assert.ok(Math.abs(angle - Math.round(angle)) < 1e-7, step + '/' + deg);
    assert.ok(S.onAngle(start, p, step));
    if (step === 90) assert.deepEqual(p, S.ortho(start, end));
  }
  assert.deepEqual(S.constrainAngle([0, 0], [10, 3], 0), [10, 3]);
  assert.equal(S.onAngle([0, 0], [10, 11], 45), false);
  assert.equal(S.angleStep({ kind: 'line', ortho: true }), 90);
  assert.equal(S.angleStep({ kind: 'area', angleStep: 45 }), 45);
  assert.equal(S.angleStep({ kind: 'rect', angleStep: 90 }), 0);
  assert.equal(S.angleStep({ kind: 'text', angleStep: 30 }), 0);
});

test('замер угла: острый, прямой, тупой и развёрнутый углы; нулевая сторона отклоняется', () => {
  for (const deg of [0, 30, 45, 90, 135, 180]) {
    const points = [[10, 0], [0, 0], [10 * Math.cos(deg * Math.PI / 180), 10 * Math.sin(deg * Math.PI / 180)]];
    assert.ok(Math.abs(S.measureAngle(points) - deg) < 1e-10);
    assert.ok(Math.abs(S.measureAngle(points.slice().reverse()) - deg) < 1e-10);
    assert.ok(S.angleLabelPoint(points).every(Number.isFinite));
  }
  assert.equal(S.measureAngle([[0, 0], [0, 0], [1, 1]]), null);
  assert.equal(S.measureAngle([[0, 0], [1, 1]]), null);
  assert.equal(S.formatAngle(89.99999999), '90°');
  assert.equal(S.formatAngle(30.125), '30,13°');
  assert.equal(S.angleStep({ kind: 'angle', angleStep: 90 }), 0);
});
