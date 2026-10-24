// Окно «Состав объекта»: настоящие функции окна и форм на простом DOM, без Диска.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const S = require('../../static/prorab/sync.js'), M = require('../../static/prorab/model.js');
class Node {
  constructor(tag) { this.tag = tag; this.nodeType = 1; this.children = []; this.events = {}; this.dataset = {}; this.style = {}; this.value = ''; this.checked = false; this.disabled = false; this.classList = { add() {}, remove() {} }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, fn) { this.events[type] = fn; }
  setAttribute(k, v) { this[k] = v; }
  focus() {}
  remove() { this.removed = true; }
  get textContent() { return this.children.map((c) => c.nodeType ? c.textContent : c).join(''); }
  set textContent(text) { this.children = [text]; }
  querySelector() { return null; }
}
const all = (n) => [n, ...n.children.filter((c) => c.nodeType).flatMap(all)];
function setup() {
  const app = new Node('main'), body = new Node('body'), alerts = [];
  const raw = new Map();
  const localStorage = { getItem: (k) => raw.get(k) || null, setItem: (k, v) => raw.set(k, v), removeItem: (k) => raw.delete(k), key: (i) => [...raw.keys()][i], get length() { return raw.size; } };
  const window = { ProrabSync: S, ProrabModel: M, addEventListener() {}, open() {}, innerWidth: 1200, innerHeight: 800 };
  for (const [name, file] of Object.entries({ ProrabPersistence: 'persistence', ProrabOffice: 'office', ProrabTemplates: 'templates', ProrabVault: 'vault', ProrabEconomy: 'economy', ProrabEconomyStore: 'economy-store', ProrabFixation: 'fixation', ProrabFixationStore: 'fixation-store', ProrabId: 'id', ProrabDocumentStore: 'document-store', ProrabGrid: 'grid', ProrabShapes: 'shapes', ProrabDxf: 'dxf', ProrabComposition: 'composition' })) window[name] = require('../../static/prorab/' + file + '.js');
  window.PRORAB_WORK_TEMPLATES = require('../../static/prorab/work-templates.js');
  const ctx = { window, TextEncoder, TextDecoder, document: { body, createElement: (t) => new Node(t), getElementById: () => app, querySelector: (sel) => (sel === '.pp-modal' ? body.children.filter((x) => !x.removed).at(-1) : null), querySelectorAll: () => [], addEventListener() {} },
    navigator: {}, location: {}, history: {}, localStorage, setTimeout: () => 1, setInterval: () => 1, clearTimeout() {}, clearInterval() {}, queueMicrotask, URLSearchParams, Blob, URL,
    prompt: () => null, confirm: () => true, alert: (m) => alerts.push(m), console };
  vm.runInNewContext(fs.readFileSync('static/prorab/schema.js', 'utf8'), ctx);
  vm.runInNewContext(fs.readFileSync('static/prorab/disk.js', 'utf8'), ctx);
  let source = fs.readFileSync('static/prorab/app.js', 'utf8');
  source = source.replace(/  start\(\);\s*\}\)\(\);\s*$/, "  render = () => {}; persist = () => {}; scheduleSave = () => {}; window.review = { compositionView, nodeForm, worksForm, workForm, APPS, PROJECT_APPS }; })();");
  vm.runInNewContext(source, ctx);
  const p = new M.Project({}, window.PRORAB_SCHEMA, 'p', 'web-test', new S.Clock());
  p.put('projects', 'p', { name: 'Учебный объект' });
  const c = { path: '/Прораб+/Учебный объект', project: p };
  return { api: window.review, c, body, alerts, C: window.ProrabComposition };
}
const modalOf = (body) => body.children.filter((x) => !x.removed).at(-1);
const submit = (body) => { const form = all(modalOf(body)).find((n) => n.tag === 'form'); form.events.submit({ preventDefault() {} }); return all(form).find((n) => n.className === 'pp-error').textContent; };

test('окно есть в меню объекта; пустой состав подсказывает, с чего начать', () => {
  const { api, c } = setup();
  assert.ok(api.PROJECT_APPS.includes('composition'));
  assert.equal(api.APPS.composition.title, 'Состав объекта');
  const view = api.compositionView({}, c);
  assert.ok(view.textContent.includes('Состав пока пуст'));
});

test('конструкция → работы с объёмом и ценой → дерево с итогами; правка и удаление работы', () => {
  const { api, c, body, C } = setup();
  api.nodeForm(c, null, null);
  const m = modalOf(body);
  const [kind] = all(m).filter((n) => n.tag === 'select');
  kind.value = 'foundation_monolith';
  const inputs = all(m).filter((n) => n.tag === 'input');
  inputs[0].value = 'Ф1'; inputs[1].value = 'оси 1–3';
  assert.equal(submit(body), '');
  const node = c.project.rows('project_nodes')[0];
  assert.equal(node.label, 'Ф1');
  assert.equal(node.location, 'оси 1–3');

  api.worksForm(c, node.id);
  const w = modalOf(body);
  const lines = all(w).filter((n) => n.tag === 'label' && n.className === 'pp-check');
  const pouring = lines.find((l) => l.textContent.includes('Бетонирование') || l.textContent.includes('бетон'));
  assert.ok(pouring, lines.map((l) => l.textContent).join('\n'));
  const row = all(w).find((n) => n.children.includes(pouring));
  all(pouring).find((n) => n.tag === 'input').checked = true;
  const [qty, price] = all(row).filter((n) => n.tag === 'input' && n.placeholder);
  qty.value = '12,5'; price.value = '6 500';
  assert.equal(submit(body), '');
  const item = c.project.rows('boq_items')[0];
  assert.equal(item.planQty, 12.5);
  assert.equal(item.priceCents, 650000);
  assert.ok(item.name.endsWith(' — Ф1'));

  // Дерево: раздел развёрнут, конструкция свёрнута, итог по плану
  const w0 = {};
  let view = api.compositionView(w0, c);
  assert.ok(view.textContent.includes('Ф1'));
  assert.ok(view.textContent.replace(/\s/g, ' ').includes('план 81 250 ₽'), view.textContent);
  assert.ok(view.textContent.includes('0% по стоимости'));
  const toggle = all(view).find((n) => n.tag === 'button' && n.className === 'pp-tree-toggle' && n['aria-expanded'] === 'false');
  toggle.events.click();
  view = api.compositionView(w0, c);
  assert.ok(view.textContent.includes(item.name));

  // Правка без истории — объём и цена; с историей — только просмотр
  api.workForm(c, item.id);
  const f = modalOf(body);
  const [q2] = all(f).filter((n) => n.tag === 'input');
  q2.value = '10';
  assert.equal(submit(body), '');
  assert.equal(c.project.get('boq_items', item.id).planQty, 10);
  c.project.put('volumes', 'v', { projectId: 'p', itemId: item.id, quantity: 1, date: 1, deleted: 0 });
  api.workForm(c, item.id);
  assert.ok(modalOf(body).textContent.includes('Из состава её убрать нельзя'));
  assert.ok(C.historyOf(c.project).has(item.id));
});

test('ошибки показываются в форме и ничего не пишут', () => {
  const { api, c, body } = setup();
  api.nodeForm(c, null, null);
  all(modalOf(body)).find((n) => n.tag === 'select').value = 'foundation_monolith'; // в браузере выбран первый вид
  assert.match(submit(body), /название/);
  assert.equal(c.project.rows('project_nodes').length, 0);
});
