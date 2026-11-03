// Real view/action functions with a minimal DOM and in-memory Disk. No live account.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const S = require('../../static/prorab/sync.js'), M = require('../../static/prorab/model.js');
const I = require('../../static/prorab/id.js'), DS = require('../../static/prorab/document-store.js');
class Node {
  constructor(tag) { this.tag = tag; this.nodeType = 1; this.children = []; this.events = {}; this.dataset = {}; this.style = {}; this.value = ''; this.classList = { add() {}, remove() {} }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, fn) { this.events[type] = fn; }
  setAttribute(k, v) { this[k] = v; }
  click() { this.clicked = true; }
  remove() { this.removed = true; }
  get textContent() { return this.children.map((c) => c.nodeType ? c.textContent : c).join(''); }
  set textContent(text) { this.children = [text]; }
  querySelector() { return null; }
}
function setup() {
  const app = new Node('main'), opened = [], alerts = [], body = new Node('body');
  const options = { offline: false }, anchors = new Map(), raw = new Map();
  app.dataset.anchorUrl = '/prorab/anchor'; app.dataset.csrf = 'mock-csrf';
  const localStorage = { getItem: (k) => raw.get(k) || null, setItem: (k, v) => raw.set(k, v), removeItem: (k) => raw.delete(k), key: (i) => [...raw.keys()][i], get length() { return raw.size; } };
  const fetch = async (url, init) => {
    if (options.offline) throw new Error('offline');
    const fields = Object.fromEntries(init.body.entries()); let data;
    if (url.endsWith('/heads')) data = { heads: [...anchors.values()].filter((r) => ![...anchors.values()].some((n) => n.chain === r.chain && n.seq > r.seq)) };
    else if (url.endsWith('/verify')) data = { valid: JSON.parse(fields.receipts).map((r) => anchors.get(r.chain + '/' + r.seq)?.hash === r.hash) };
    else { data = { ...fields, version: 2, seq: Number(fields.seq), time: new Date().toISOString(), sig: 'mock-signature' }; anchors.set(data.chain + '/' + data.seq, data); }
    return { ok: true, json: async () => data };
  };
  const window = { ProrabSync: S, ProrabModel: M, ProrabId: I, ProrabDocumentStore: DS, ProrabGrid: require('../../static/prorab/grid.js'), ProrabShapes: require('../../static/prorab/shapes.js'), ProrabDxf: require('../../static/prorab/dxf.js'), addEventListener() {},
    open: (url) => opened.push(url), innerWidth: 1200 };
  for (const [name, file] of Object.entries({ ProrabPersistence: 'persistence', ProrabOffice: 'office', ProrabTemplates: 'templates', ProrabVault: 'vault', ProrabEconomy: 'economy', ProrabEconomyStore: 'economy-store', ProrabFixation: 'fixation', ProrabFixationStore: 'fixation-store' })) window[name] = require('../../static/prorab/' + file + '.js');
  const ctx = { window, TextEncoder, TextDecoder, document: { body, createElement: (t) => new Node(t), getElementById: () => app, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    navigator: {}, location: {}, history: {}, localStorage, fetch, AbortController, setTimeout: () => 1, setInterval: () => 1, clearTimeout() {}, clearInterval() {}, queueMicrotask, URLSearchParams, Blob, URL,
    prompt: (_, fallback) => options.number || fallback, confirm: () => true, alert: (msg) => alerts.push(msg), console };
  vm.runInNewContext(fs.readFileSync('static/prorab/schema.js', 'utf8'), ctx);
  vm.runInNewContext(fs.readFileSync('static/prorab/disk.js', 'utf8'), ctx);
  let source = fs.readFileSync('static/prorab/app.js', 'utf8');
  ctx.reviewOptions = options;
  source = source.replace(/  start\(\);\s*\}\)\(\);\s*$/, "  render = () => { reviewOptions.renderCount = (reviewOptions.renderCount || 0) + 1; }; afterDocument = () => {}; fixFile = async () => {}; window.review = { loadDrawing, saveAngleMeasurement, saveGridDrawing, gridDrawingForm, drawBar, drawingsView, idView, dirsView, ksMake, makeOjr, repForm, orgForm, ksSettings, ojrSettings, fixationView, setSession(d) { disk = d; me = 'web-test'; store = R.storage(rawStorage, 'mock:'); } }; })();");
  vm.runInNewContext(source, ctx);
  const p = new M.Project({}, window.PRORAB_SCHEMA, 'p', 'web-test', new S.Clock());
  p.put('projects', 'p', { name: 'Учебный объект' });
  p.put('boq_items', 'a', { projectId: 'p', name: 'Монтаж', priceCents: 10000 });
  p.put('volumes', 'v', { projectId: 'p', itemId: 'a', date: S.today(), quantity: 1 });
  const files = new Map();
  const disk = { mkdir: async () => { if (options.failFolder) throw new Error('Яндекс Диск заблокировал запись (423)'); }, list: async (path) => [...new Map([...files.keys()].filter((x) => x.startsWith(path + '/')).map((x) => { const rest = x.slice(path.length + 1), name = rest.split('/')[0]; return [name, { name, type: rest.includes('/') ? 'dir' : 'file' }]; })).values()],
    getText: async (path) => files.has(path) ? typeof files.get(path) === 'string' ? files.get(path) : new TextDecoder().decode(files.get(path)) : null, putText: async (path, text) => { if (options.failParticipants && path.endsWith('/участники.json')) throw new Error('423 participants'); files.set(path, text); },
    putBlob: async (path, blob, overwrite) => { assert.equal(overwrite, false); if (files.has(path)) throw new Error('exists'); files.set(path, new Uint8Array(await blob.arrayBuffer())); }, getBytes: async (path) => files.get(path) };
  window.review.setSession(disk);
  const c = { path: '/Прораб+/Учебный объект', project: p };
  c.id = { loading: false, participants: I.emptyParticipants(), acts: [], certificates: [], templates: [], storage: new DS.Store(disk, c.path + '/Исполнительная документация'), root: '/Прораб+' };
  I.setDefaults(c.id.participants, { ks: { contractNo: 'Д-1', vatRate: null } });
  return { api: window.review, c, files, opened, alerts, options, body };
}
const nodes = (n) => [n, ...n.children.filter((c) => c.nodeType).flatMap(nodes)];
test('все вкладки документов открываются; файлы открываются в папке выбранного объекта', () => {
  const { api, c, opened } = setup();
  for (const tab of ['acts', 'people', 'ks', 'ojr', 'templates']) {
    const tree = api.idView({ tab }, c);
    const open = nodes(tree).find((n) => n.tag === 'button' && n.textContent.includes('Открыть файлы'));
    assert.ok(open, tab); open.events.click();
    assert.ok(decodeURIComponent(opened.at(-1)).includes(c.path + '/Исполнительная документация'));
  }
  const dirs = api.dirsView({}, c);
  assert.ok(!dirs.textContent.includes('Открыть файлы'));
});
test('создание КС из интерфейса сохраняет оба Word и черновик; предъявление выполняется отдельно', async () => {
  const { api, c, files, alerts } = setup();
  await api.ksMake(c, { ks: { from: S.today(), to: S.today() } });
  assert.deepEqual(alerts, []);
  assert.equal(c.id.certificates.length, 1);
  assert.equal(c.id.certificates[0].status, 'draft');
  assert.equal([...files.keys()].filter((x) => x.endsWith('.docx')).length, 2);
  const tree = api.idView({ tab: 'ks' }, c);
  await nodes(tree).find((n) => n.tag === 'button' && n.textContent === 'Отметить предъявленной').events.click();
  assert.deepEqual(alerts, []);
  assert.equal(c.id.certificates[0].status, 'issued');
  assert.equal(c.id.certificates[0].totals.all, 10000);
});

test('второй комплект получает №2 и новый период даже при недоступном файле участников', async () => {
  const { api, c, files, alerts, options } = setup();
  c.project.put('volumes', 'v', { date: S.today() - 1, quantity: 1 });
  c.project.put('volumes', 'next-volume', { projectId: 'p', itemId: 'a', date: S.today(), quantity: 2 });
  options.failParticipants = true;
  const w = { tab: 'ks', ks: { from: S.today() - 1, to: S.today() - 1 } };
  await api.ksMake(c, w);
  assert.deepEqual(alerts, []);
  assert.equal(c.id.certificates[0].number, '1');
  assert.equal(w.ks.from, S.today());
  await nodes(api.idView(w, c)).find((n) => n.tag === 'button' && n.textContent === 'Отметить предъявленной').events.click();
  await api.ksMake(c, w);
  assert.deepEqual(alerts, []);
  const second = c.id.certificates[1];
  assert.equal(second.number, '2'); assert.equal(second.rows[0].qty, 2);
  assert.equal(second.ledger.prior.all, 10000); assert.equal(second.ledger.period.all, 20000);
  assert.equal(second.ledger.total.all, 30000);
  assert.equal([...files.keys()].filter((p) => p.endsWith('.docx')).length, 4);
  assert.ok(second.ks3.includes('№2'));
  const text = Buffer.from(files.get(c.path + '/Исполнительная документация/КС/' + second.ks3)).toString('utf8');
  assert.ok(text.includes('Текущая КС-2 № 2: 200,00'));
  await api.ksMake(c, w);
  assert.ok(alerts.at(-1).includes('Нет работ'));
  assert.equal(c.id.certificates.length, 2);
});

test('повтор того же периода остановлен; ошибочный черновик можно отменить с сохранением файлов', async () => {
  const { api, c, files, alerts } = setup();
  const w = { tab: 'ks', ks: { from: S.today(), to: S.today() } };
  await api.ksMake(c, w);
  const original = c.id.certificates[0], originalFiles = [...files.keys()].filter((p) => p.endsWith('.docx'));
  w.ks = { from: S.today(), to: S.today() };
  await api.ksMake(c, w);
  assert.ok(alerts.at(-1).includes('черновик')); assert.equal(c.id.certificates.length, 1);
  const tree = api.idView(w, c);
  await nodes(tree).find((n) => n.tag === 'button' && n.textContent === 'Отменить черновик').events.click();
  assert.ok(c.id.certificates[0].cancelledAt); assert.equal(w.ks, null);
  api.idView(w, c);
  await api.ksMake(c, w);
  assert.equal(c.id.certificates.length, 2); assert.equal(c.id.certificates[1].number, '2');
  for (const path of originalFiles) assert.ok(files.has(path));
  assert.equal(c.id.certificates[0].id, original.id);
});

test('ввод дат КС не перерисовывает поля после первой цифры; применяется по кнопке', async () => {
  const { api, c, alerts, options, files } = setup();
  const w = { tab: 'ks', ks: { from: S.today(), to: S.today() } };
  const tree = api.idView(w, c), dates = nodes(tree).filter((n) => n.tag === 'input' && n.type === 'date');
  const [from, to] = dates;
  assert.equal(dates.length, 2);
  const oldTo = to.value;
  for (const partial of ['', '2026-10-0', '2026-10-01']) {
    from.value = partial; from.events.input(); from.events.change();
    assert.equal(options.renderCount || 0, 0); assert.equal(to.value, oldTo);
  }
  to.value = ''; to.events.input(); to.events.change();
  const generate = nodes(tree).find((n) => n.tag === 'button' && n.textContent.includes('Сформировать КС-2'));
  await generate.events.click();
  assert.ok(alerts.at(-1).includes('обе даты')); assert.equal(files.size, 0);
  to.value = '2026-10-24'; to.events.input(); to.events.change();
  assert.equal(options.renderCount || 0, 0);
  nodes(tree).find((n) => n.tag === 'button' && n.textContent === 'Применить период').events.click();
  assert.equal(options.renderCount, 1);
  assert.equal(w.ks.from, Math.round(Date.UTC(2026, 9, 1) / 86400000));
  assert.equal(w.ks.to, Math.round(Date.UTC(2026, 9, 24) / 86400000));
});

test('кнопки фиксации и проверки: снимок и квитанция сохранены, офлайн не показывает успех', async () => {
  const { api, c, options, alerts } = setup(), w = {};
  let view = api.fixationView(w, c);
  await c.fix.load();
  view = api.fixationView(w, c);
  await nodes(view).find((n) => n.tag === 'button' && n.textContent.includes('Зафиксировать сейчас')).events.click();
  assert.deepEqual(alerts, []);
  assert.equal(c.fix.seals.length, 1); assert.equal(c.fix.anchored.size, 1);
  await nodes(api.fixationView(w, c)).find((n) => n.tag === 'button' && n.textContent.includes('Проверить целостность')).events.click();
  assert.equal(w.fixReport.incomplete, false); assert.equal(w.fixReport.problems, false);
  options.offline = true;
  await nodes(api.fixationView(w, c)).find((n) => n.tag === 'button' && n.textContent.includes('Проверить целостность')).events.click();
  assert.equal(w.fixReport.incomplete, true);
  assert.ok(api.fixationView(w, c).textContent.includes('Проверка не завершена'));
});


test('общий журнал при 423 доступен для скачивания; повтор после восстановления сохраняет Word', async () => {
  const { api, c, files, opened, alerts, options, body } = setup();
  const w = { tab: 'ojr', ojr: { from: null, to: S.today() } };
  options.failFolder = true;
  await api.makeOjr(c, w);
  assert.equal(files.size, 0); assert.equal(opened.length, 0);
  assert.equal(c.id.generating, false); assert.equal(c.id.storage.busy, false);
  assert.ok(alerts.at(-1).includes('423'));
  assert.ok(w.ojrDownload.bytes.length > 1000);
  const tree = api.idView(w, c);
  assert.ok(tree.textContent.includes('Сохранение на Диске не подтверждено'));
  const download = nodes(tree).find((n) => n.tag === 'button' && n.textContent.includes('Скачать сформированный журнал'));
  assert.ok(download); download.events.click();
  const a = body.children.at(-1);
  assert.equal(a.download, w.ojrDownload.name); assert.equal(a.clicked, true);
  const bytes = new Uint8Array(await (await fetch(a.href)).arrayBuffer());
  assert.deepEqual(bytes, w.ojrDownload.bytes);
  URL.revokeObjectURL(a.href);
  options.failFolder = false;
  await api.makeOjr(c, w);
  assert.equal(w.ojrDownload, null);
  assert.equal(files.size, 1); assert.equal(opened.length, 1);
  assert.ok([...files.keys()][0].includes('/Исполнительная документация/Общий журнал/'));
});


test('423 при редактировании участника сохраняет прежний файл и открытую форму; повтор сохраняет правку', async () => {
  const { api, c, files, options, body } = setup();
  I.saveRep(c.id.participants, { id: 'person-1', role: 'builder', fio: 'Иванов И. И.', position: 'Прораб' });
  c.id.participants = await c.id.storage.participants(c.id.participants);
  const path = c.path + '/Исполнительная документация/участники.json';
  const original = files.get(path);
  api.repForm(c, I.reps(c.id.participants)[0]);
  const modal = body.children.at(-1), form = nodes(modal).find((n) => n.tag === 'form');
  const fio = nodes(form).find((n) => n.tag === 'input' && n.value === 'Иванов И. И.');
  assert.ok(fio); fio.value = 'Петров П. П.';
  options.failFolder = true;
  await form.events.submit({ preventDefault() {} });
  assert.equal(files.get(path), original);
  assert.equal(I.reps(c.id.participants)[0].fio, 'Иванов И. И.');
  assert.ok(modal.textContent.includes('423'));
  assert.ok(modal.textContent.includes('Не удалось сохранить'));
  assert.equal(body.children.some((n) => n.className === 'pp-notice' && !n.removed), false);
  assert.equal(modal.removed, undefined); assert.equal(fio.value, 'Петров П. П.');
  options.failFolder = false;
  await form.events.submit({ preventDefault() {} });
  assert.equal(modal.removed, true);
  assert.equal(I.reps(c.id.participants)[0].fio, 'Петров П. П.');
  assert.equal(I.reps(JSON.parse(files.get(path)))[0].fio, 'Петров П. П.');
  assert.ok(body.children.at(-1).textContent.includes('Представитель сохранён на Яндекс Диске'));
});

test('кнопка показывает ожидание, повторный клик не пишет второй раз, успех только после проверки Диска', async () => {
  const { api, c, files, body } = setup();
  const disk = c.id.storage.disk, originalGet = disk.getText;
  let release, reading, reads = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const readback = new Promise((resolve) => { reading = resolve; });
  disk.getText = async (path) => {
    reads++;
    if (files.has(path)) { reading(); await gate; }
    return originalGet(path);
  };
  api.ksSettings(c);
  const modal = body.children.at(-1), form = nodes(modal).find((n) => n.tag === 'form');
  const submit = nodes(form).find((n) => n.type === 'submit');
  const pending = form.events.submit({ preventDefault() {} });
  assert.equal(submit.disabled, true); assert.equal(submit.textContent, 'Сохраняю на Диск…');
  await form.events.submit({ preventDefault() {} });
  await readback;
  assert.equal(reads, 2);
  assert.equal(modal.removed, undefined);
  assert.equal(body.children.some((n) => n.className === 'pp-notice'), false);
  release(); await pending;
  assert.equal(modal.removed, true); assert.equal(submit.disabled, false);
  assert.equal(submit.textContent, 'Сохранить');
  const notice = body.children.at(-1);
  assert.equal(notice.className, 'pp-notice');
  assert.ok(notice.textContent.includes('Настройки КС-2 и КС-3 сохранены на Яндекс Диске'));
  assert.equal(notice.children[0].role, 'status');
  nodes(notice).find((n) => n.tag === 'button').events.click();
  assert.equal(notice.removed, true);
});

test('организация и титульный лист журнала подтверждают сохранение; при ошибке чтения успех не появляется', async () => {
  const { api, c, files, body } = setup();
  const org = I.saveOrg(c.id.participants, { id: 'org-1', role: 'builder', name: 'Монтаж' });
  api.orgForm(c, org);
  let form = nodes(body.children.at(-1)).find((n) => n.tag === 'form');
  await form.events.submit({ preventDefault() {} });
  assert.ok(body.children.at(-1).textContent.includes('Организация сохранена на Яндекс Диске'));
  api.ojrSettings(c);
  form = nodes(body.children.at(-1)).find((n) => n.tag === 'form');
  await form.events.submit({ preventDefault() {} });
  assert.ok(body.children.at(-1).textContent.includes('Настройки общего журнала сохранены на Яндекс Диске'));
  const oldSuccess = body.children.at(-1), disk = c.id.storage.disk, put = disk.putText;
  disk.putText = async (path, text) => { await put(path, text); files.set(path, '{}'); };
  api.ksSettings(c);
  const modal = body.children.at(-1);
  form = nodes(modal).find((n) => n.tag === 'form');
  await form.events.submit({ preventDefault() {} });
  assert.equal(oldSuccess.removed, true);
  assert.equal(modal.removed, undefined);
  assert.ok(form.textContent.includes('Диск не подтвердил сохранение'));
  assert.equal(body.children.some((n) => n.className === 'pp-notice' && !n.removed), false);
});

test('новый DXF и изменение осей сохраняют ID, пометки, свои линии и прежний файл', async () => {
  const { api, c, files } = setup();
  const G = require('../../static/prorab/grid.js');
  await api.saveGridDrawing(c, null, 'grid-1', 'Оси', G.DEFAULTS);
  const first = { ...c.project.get('drawings', 'grid-1') };
  const path = c.path + '/files/' + first.file;
  const firstBytes = files.get(path).slice();
  assert.equal(G.read(firstBytes).length, 24);
  c.project.put('drawing_notes', 'note-1', { projectId: 'p', drawingId: 'grid-1', x: 1000, y: 2000 });
  const shape = c.project.addShape({ drawingId: 'grid-1', kind: 'line', points: [[1000, 2000], [3000, 4000]] });
  const originalPoints = shape.points;
  await api.saveGridDrawing(c, first, 'grid-1', 'Оси', { ...G.DEFAULTS, length: 30, width: 18 });
  const second = c.project.get('drawings', 'grid-1');
  assert.notEqual(second.file, first.file);
  assert.deepEqual(files.get(path), firstBytes);
  assert.equal(G.read(files.get(c.path + '/files/' + second.file)).length, 30);
  assert.equal(c.project.get('drawing_notes', 'note-1').x, 1000);
  assert.equal(c.project.get('drawing_shapes', shape.id).points, originalPoints);
  assert.equal(c.project.drawings().length, 1);
  await assert.rejects(api.saveGridDrawing(c, first, 'grid-1', 'Устаревшая правка', G.DEFAULTS), /изменился/);
  assert.equal(c.project.get('drawings', 'grid-1').file, second.file);
});

test('ошибка загрузки/проверки DXF не создаёт запись и не подменяет прежний чертёж', async () => {
  const { api, c, options } = setup();
  options.failFolder = true;
  await assert.rejects(api.saveGridDrawing(c, null, 'new-grid', 'Оси', {}), /423/);
  assert.equal(c.project.get('drawings', 'new-grid'), null);
  options.failFolder = false;
  await api.saveGridDrawing(c, null, 'new-grid', 'Оси', {});
  const original = { ...c.project.get('drawings', 'new-grid') };
  const disk = c.id.storage.disk;
  disk.getBytes = async () => new Uint8Array([0]);
  await assert.rejects(api.saveGridDrawing(c, original, 'new-grid', 'Новые оси', { length: 40 }), /не подтвердил/);
  assert.equal(c.project.get('drawings', 'new-grid').file, original.file);
  assert.equal(c.gridSaving, false);
});

test('поля размеров допускают посимвольный ввод; угол выбирается без потери начатой фигуры', () => {
  const { api, c, body, options } = setup();
  api.gridDrawingForm(c);
  const modal = body.children.at(-1), list = nodes(modal);
  const length = list.find((n) => n.tag === 'input' && n.value === '24');
  const before = options.renderCount || 0;
  length.value = '3'; length.events.input(); length.value = '30'; length.events.input();
  assert.equal(options.renderCount || 0, before);
  assert.ok(modal.textContent.includes('7,5') || modal.textContent.includes('7.5'));
  const calls = [], w = { drawCfg: { kind: 'line', angleStep: 0 }, viewer: { setDraw(cfg) { calls.push({ ...cfg }); } } };
  const bar = api.drawBar(w, c, { id: 'd1', kind: 'dxf' }, []);
  const angles = nodes(bar).find((n) => n.tag === 'select' && n['aria-label'] === 'Шаг угла');
  assert.ok(angles);
  assert.deepEqual(angles.children.map((n) => n.value), ['0', '15', '30', '45', '90']);
  angles.value = '45'; angles.events.change();
  assert.equal(calls.at(-1).angleStep, 45);
  const rectBar = api.drawBar({ ...w, drawCfg: { kind: 'rect', angleStep: 90 } }, c, { id: 'd1', kind: 'dxf' }, []);
  assert.equal(nodes(rectBar).find((n) => n['aria-label'] === 'Шаг угла').disabled, true);
});

test('сохранённый замер угла состоит из поддерживаемых телефоном линий и текста', () => {
  const { api, c } = setup();
  const points = [[100, 0], [0, 0], [0, 100]];
  let cleared = false;
  const w = { angleMeasure: { points, value: 90, page: 0, size: 10, color: '#FF3B30' }, viewer: { clearMeasurement() { cleared = true; } } };
  api.saveAngleMeasurement(c, w, { id: 'd1' });
  const rows = c.project.shapesOf('d1');
  assert.deepEqual(rows.map((r) => r.kind), ['polyline', 'text']);
  assert.equal(rows[1].text, '90°');
  assert.equal(w.angleMeasure, null); assert.equal(cleared, true);
});


test('поздняя загрузка прежнего DXF не подменяет новую редакцию осей', async () => {
  const { api, c } = setup();
  const G = require('../../static/prorab/grid.js'), disk = c.id.storage.disk;
  const pending = new Map();
  disk.getBytes = (path) => new Promise((resolve) => pending.set(path, resolve));
  c.project.addDrawing({ id: 'race-grid', name: 'Оси', file: 'old.dxf', kind: 'dxf' });
  const w = { path: 'race-grid' }, oldLoad = api.loadDrawing(w, c);
  c.project.addDrawing({ id: 'race-grid', name: 'Оси', file: 'new.dxf', kind: 'dxf' });
  const newLoad = api.loadDrawing(w, c);
  pending.get(c.path + '/files/new.dxf')(new TextEncoder().encode(G.dxf({ length: 36 })));
  await newLoad;
  assert.equal(w.grid.length, 36);
  pending.get(c.path + '/files/old.dxf')(new TextEncoder().encode(G.dxf({ length: 24 })));
  await oldLoad;
  assert.equal(w.grid.length, 36); assert.equal(w.loadedFile, 'new.dxf');
  assert.equal(w.load.state, 'ready');
});

test('закрытие формы сетки обновляет чертёж, загруженный из кеша под диалогом', () => {
  const { api, c, body, options } = setup();
  api.gridDrawingForm(c);
  const cancel = nodes(body.children.at(-1)).find((n) => n.tag === 'button' && n.textContent === 'Отмена');
  const before = options.renderCount || 0;
  cancel.events.click();
  assert.equal(options.renderCount, before + 1);
});
