const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const SH = require('../../static/prorab/shapes.js');
const DXF = require('../../static/prorab/dxf.js');

function setup(kind = 'dxf', shapes = [], lines = []) {
  const strokes = [], frames = [], made = [], placed = [], picked = [], measurements = [], edits = [];
  const ctx2d = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'stroke') return () => strokes.push(true);
    if (key === 'measureText') return () => ({ width: 20 });
    return () => {};
  } });
  const canvas = () => ({ style: {}, events: {}, getContext: () => ctx2d,
    addEventListener(name, handler) { this.events[name] = handler; }, setPointerCapture() {}, focus() {}, remove() {} });
  const host = { append(c) { this.canvas = c; }, getBoundingClientRect: () => ({ width: 1000, height: 1000 }) };
  const window = { devicePixelRatio: 1, ProrabShapes: SH, ProrabDxf: DXF };
  const context = { window, document: { createElement: canvas },
    ResizeObserver: class { observe() {} disconnect() {} },
    Path2D: class { moveTo() {} lineTo() {} closePath() {} },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync('static/prorab/viewer.js', 'utf8'), context);
  const pdf = { numPages: 2, async getPage() { return {
    getViewport: ({ scale }) => ({ width: 1000 * scale, height: 1000 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel() {} })
  }; } };
  const viewer = window.ProrabViewer.create(host, { kind, pdf, shapes, notes: [], metersPerUnit: 0.001,
    dxf: { originX: 1000000, originY: 2000000, fitBox: [0, 0, 1000, 1000], lines, texts: [] },
    onShapeEdit: (edit) => edits.push(edit), onMeasure: (value) => measurements.push(value), onShape: (s) => made.push(s), onPlace: (...args) => placed.push(args), onShapePick: (id) => picked.push(id) });
  const click = (x, y, altKey = false) => {
    host.canvas.events.pointerdown({ pointerId: 1, offsetX: x, offsetY: y });
    host.canvas.events.pointerup({ pointerId: 1, offsetX: x, offsetY: y, type: 'pointerup', altKey });
  };
  const draw = () => { strokes.length = 0; while (frames.length) frames.shift()(); return strokes.length; };
  return { viewer, click, made, placed, picked, draw, measurements, edits, escape() { host.canvas.events.keydown({ key: 'Escape', preventDefault() {} }); }, move(x, y) { host.canvas.events.pointermove({ pointerId: 9, offsetX: x, offsetY: y }); }, ctx2d };
}

test('линии с телефона видны на своём листе PDF, скрываются и выбираются касанием', async () => {
  const { viewer, draw, click, picked } = setup('pdf', [{ id: 'phone-line', kind: 'line', points: '0,0;1000,1000', page: 1 }]);
  await new Promise(setImmediate);
  assert.equal(draw(), 0);
  await viewer.setPage(1);
  assert.equal(draw(), 1);
  click(500, 500);
  assert.equal(picked.at(-1), 'phone-line');
  viewer.setShapesVisible(false);
  assert.equal(draw(), 0);
});

test('переход к пометке прекращает черчение и не превращает щелчок в новую линию', () => {
  const { viewer, click, made, placed } = setup();
  viewer.setDraw({ kind: 'line', color: '#FF3B30' });
  click(400, 400);
  viewer.setMode('place');
  click(600, 600);
  assert.equal(made.length, 0);
  assert.equal(placed.length, 1);
  viewer.setMode('view');
  viewer.setDraw({ kind: 'line', color: '#FF3B30' });
  click(400, 400); click(600, 600);
  assert.equal(made.length, 1);
  assert.ok(made[0].points[0][0] > 1000000);
});

test('незаконченная фигура не переносит точки с одного листа PDF на другой', async () => {
  const { viewer, click, made } = setup('pdf');
  await new Promise(setImmediate);
  viewer.setDraw({ kind: 'line', color: '#FF3B30' });
  click(400, 400);
  await viewer.setPage(1);
  click(500, 500);
  assert.equal(made.length, 0);
  click(600, 600);
  assert.equal(made.length, 1);
  assert.equal(made[0].page, 1);
  assert.equal(made[0].points[0][0], 500);
});

test('привязка не нарушает угол: неподходящая вершина пропускается, подходящая сохраняется точно', () => {
  const lines = [{ layer: 'axes', color: '#fff', pts: [601, 390, 600, 400] }];
  const { viewer, click, made } = setup('dxf', [], lines);
  viewer.setDraw({ kind: 'line', angleStep: 45 });
  click(500, 500); // DXF local 500,500
  click(595, 603.4); // local 601.06,390: closer wrong vertex, still select 600,400
  assert.equal(made.length, 1);
  assert.deepEqual(Array.from(made[0].points[1]), [1000600, 2000400]);
  viewer.setDraw({ kind: 'line', angleStep: 45 });
  click(500, 500); click(595, 603.4, true);
  const p = made[1].points[1];
  assert.notEqual(p[0], 1000600); // Alt skips vertex snapping, but retains the 45° direction
  assert.ok(Math.abs((p[0] - 1000500) + (p[1] - 2000500)) < 1e-8);
});

test('неподходящая вершина не даёт зелёную отметку после выравнивания', () => {
  const { viewer, click, move, draw, ctx2d, made } = setup('dxf', [], [{ layer: 'axes', color: '#fff', pts: [600, 410, 600, 420] }]);
  let squares = 0;
  ctx2d.strokeRect = () => { squares++; };
  viewer.setDraw({ kind: 'line', angleStep: 45 });
  click(500, 500); move(594, 584.6); draw();
  assert.equal(squares, 0);
  click(594, 584.6);
  const [a, b] = made[0].points;
  assert.ok(Math.abs((b[0] - a[0]) + (b[1] - a[1])) < 1e-8);
});

test('углы действуют на PDF и от последней точки ломаной; 90° не вырождает прямоугольник', async () => {
  const { viewer, click, made } = setup('pdf');
  await new Promise(setImmediate);
  viewer.setDraw({ kind: 'polyline', angleStep: 45 });
  click(400, 400); click(500, 490); click(600, 480);
  viewer.finishDraw();
  const pts = made[0].points;
  assert.ok(Math.abs((pts[1][0] - pts[0][0]) - (pts[1][1] - pts[0][1])) < 1e-8);
  assert.equal(pts[2][1], pts[1][1]);
  viewer.setDraw({ kind: 'rect', angleStep: 90 });
  click(400, 400); click(600, 500);
  assert.notEqual(made[1].points[0][0], made[1].points[1][0]);
  assert.notEqual(made[1].points[0][1], made[1].points[1][1]);
});

test('замер угла использует три точки без углового ограничения и не создаёт новый тип записи', () => {
  const { viewer, click, made, measurements, draw } = setup();
  viewer.setDraw({ kind: 'angle', angleStep: 90, color: '#FF3B30' });
  click(700, 500); click(500, 500); click(700, 300);
  const m = measurements.at(-1);
  assert.ok(Math.abs(m.value - 45) < 1e-8);
  assert.equal(m.points.length, 3);
  assert.equal(made.length, 0);
  assert.doesNotThrow(draw);
  viewer.setMode('place');
  assert.equal(measurements.at(-1), null);
});


test('shape editing cancels on PDF page change, placing a note, hiding shapes or Escape', async () => {
  const row={id:'shape',kind:'line',points:'100,100;300,300',page:0};
  const {viewer,click,edits,placed,escape}=setup('pdf',[row]);await new Promise(setImmediate);
  viewer.setEdit({op:'move',id:'shape'});click(400,400);assert.equal(viewer.editing.step,1);
  await viewer.setPage(1);assert.equal(viewer.editing,null);click(600,600);assert.equal(edits.length,0);
  await viewer.setPage(0);viewer.setEdit({op:'copy',id:'shape'});click(400,400);viewer.setMode('place');click(600,600);
  assert.equal(viewer.editing,null);assert.equal(edits.length,0);assert.equal(placed.length,1);
  viewer.setMode('view');viewer.setEdit({op:'move',id:'shape'});escape();assert.equal(viewer.editing,null);
  viewer.setEdit({op:'move',id:'shape'});viewer.setShapesVisible(false);assert.equal(viewer.editing,null);
});
