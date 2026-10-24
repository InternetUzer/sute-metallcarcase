// Real view/action functions with a minimal DOM and in-memory Disk. No live account.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const S = require('../../static/prorab/sync.js'), M = require('../../static/prorab/model.js');
const I = require('../../static/prorab/id.js'), DS = require('../../static/prorab/document-store.js');
class Node {
  constructor(tag) { this.tag = tag; this.nodeType = 1; this.children = []; this.events = {}; this.dataset = {}; this.value = ''; this.classList = { add() {}, remove() {} }; }
  append(...children) { this.children.push(...children); }
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
  const window = { ProrabSync: S, ProrabModel: M, ProrabId: I, ProrabDocumentStore: DS, addEventListener() {},
    open: (url) => opened.push(url), innerWidth: 1200 };
  for (const [name, file] of Object.entries({ ProrabPersistence: 'persistence', ProrabOffice: 'office', ProrabTemplates: 'templates', ProrabVault: 'vault', ProrabEconomy: 'economy', ProrabEconomyStore: 'economy-store', ProrabFixation: 'fixation', ProrabFixationStore: 'fixation-store' })) window[name] = require('../../static/prorab/' + file + '.js');
  const ctx = { window, document: { body, createElement: (t) => new Node(t), getElementById: () => app, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    navigator: {}, location: {}, history: {}, localStorage, fetch, AbortController, setTimeout: () => 1, setInterval: () => 1, clearTimeout() {}, clearInterval() {}, queueMicrotask, URLSearchParams, Blob, URL,
    prompt: () => '1', confirm: () => true, alert: (msg) => alerts.push(msg), console };
  vm.runInNewContext(fs.readFileSync('static/prorab/schema.js', 'utf8'), ctx);
  vm.runInNewContext(fs.readFileSync('static/prorab/disk.js', 'utf8'), ctx);
  let source = fs.readFileSync('static/prorab/app.js', 'utf8');
  source = source.replace(/  start\(\);\s*\}\)\(\);\s*$/, "  render = () => {}; afterDocument = () => {}; window.review = { idView, dirsView, ksMake, makeOjr, repForm, fixationView, setSession(d) { disk = d; me = 'web-test'; store = R.storage(rawStorage, 'mock:'); } }; })();");
  vm.runInNewContext(source, ctx);
  const p = new M.Project({}, window.PRORAB_SCHEMA, 'p', 'web-test', new S.Clock());
  p.put('projects', 'p', { name: 'Учебный объект' });
  p.put('boq_items', 'a', { projectId: 'p', name: 'Монтаж', priceCents: 10000 });
  p.put('volumes', 'v', { projectId: 'p', itemId: 'a', date: S.today(), quantity: 1 });
  const files = new Map();
  const disk = { mkdir: async () => { if (options.failFolder) throw new Error('Яндекс Диск заблокировал запись (423)'); }, list: async (path) => [...new Map([...files.keys()].filter((x) => x.startsWith(path + '/')).map((x) => { const rest = x.slice(path.length + 1), name = rest.split('/')[0]; return [name, { name, type: rest.includes('/') ? 'dir' : 'file' }]; })).values()],
    getText: async (path) => files.has(path) ? typeof files.get(path) === 'string' ? files.get(path) : new TextDecoder().decode(files.get(path)) : null, putText: async (path, text) => files.set(path, text),
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
  assert.equal(modal.removed, undefined); assert.equal(fio.value, 'Петров П. П.');
  options.failFolder = false;
  await form.events.submit({ preventDefault() {} });
  assert.equal(modal.removed, true);
  assert.equal(I.reps(c.id.participants)[0].fio, 'Петров П. П.');
  assert.equal(I.reps(JSON.parse(files.get(path)))[0].fio, 'Петров П. П.');
});
