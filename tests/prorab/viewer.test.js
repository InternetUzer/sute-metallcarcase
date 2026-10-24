const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const SH = require('../../static/prorab/shapes.js');

function setup(kind = 'dxf', shapes = []) {
  const strokes = [], frames = [], made = [], placed = [], picked = [];
  const ctx2d = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'stroke') return () => strokes.push(true);
    if (key === 'measureText') return () => ({ width: 20 });
    return () => {};
  } });
  const canvas = () => ({ style: {}, events: {}, getContext: () => ctx2d,
    addEventListener(name, handler) { this.events[name] = handler; }, setPointerCapture() {}, focus() {}, remove() {} });
  const host = { append(c) { this.canvas = c; }, getBoundingClientRect: () => ({ width: 1000, height: 1000 }) };
  const window = { devicePixelRatio: 1, ProrabShapes: SH, ProrabDxf: { snap: () => null } };
  const context = { window, document: { createElement: canvas },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync('static/prorab/viewer.js', 'utf8'), context);
  const pdf = { numPages: 2, async getPage() { return {
    getViewport: ({ scale }) => ({ width: 1000 * scale, height: 1000 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel() {} })
  }; } };
  const viewer = window.ProrabViewer.create(host, { kind, pdf, shapes, notes: [], metersPerUnit: 0.001,
    dxf: { originX: 1000000, originY: 2000000, fitBox: [0, 0, 1000, 1000], lines: [], texts: [] },
    onShape: (s) => made.push(s), onPlace: (...args) => placed.push(args), onShapePick: (id) => picked.push(id) });
  const click = (x, y) => {
    host.canvas.events.pointerdown({ pointerId: 1, offsetX: x, offsetY: y });
    host.canvas.events.pointerup({ pointerId: 1, offsetX: x, offsetY: y, type: 'pointerup' });
  };
  const draw = () => { strokes.length = 0; while (frames.length) frames.shift()(); return strokes.length; };
  return { viewer, click, made, placed, picked, draw };
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
