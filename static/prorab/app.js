/*
 * «Прораб+» в браузере — общий кабинет всех объектов в виде рабочего стола.
 *  - Рабочий стол — папка «Прораб+» на Яндекс Диске: значки объектов (папки «Прораб+/<объект>», как у
 *    телефона) и всё, что создано на рабочем столе (ярлыки, папки, документы) — в той же папке.
 *  - Окно объекта: журнал, календарь, ведомость, финансы, техника и бригады, документы объекта.
 *    Можно держать открытыми несколько объектов сразу; у каждого своя синхронизация.
 */
(function () {
  'use strict';
  const S = window.ProrabSync, M = window.ProrabModel, D = window.ProrabDisk, SCHEMA = window.PRORAB_SCHEMA, O = window.ProrabOffice;
  const R = window.ProrabPersistence;
  const app = document.getElementById('prorab');
  const CLIENT_ID = app.dataset.clientId || '';
  const DOCS = 'Документы';
  const DEFAULT_UNITS = ['м', 'п.м.', 'м²', 'м³', 'шт.', 'кг', 'т', 'компл.'];

  // ───────── хранилище браузера (только удобства; данные — на Диске) ─────────
  // data-store — отдельное хранилище (демо не трогает ключ и настройки рабочего кабинета)
  const PREFIX = 'prorab.' + (app.dataset.store ? app.dataset.store + '.' : '');
  let rawStorage;
  try { rawStorage = localStorage; } catch (_) { rawStorage = null; }
  const authStore = R.storage(rawStorage, PREFIX);
  let store = R.storage(rawStorage, PREFIX + 'signed-out:');
  // Рабочий стол — сама папка «Прораб+» (у приглашённого в общую папку она может называться иначе —
  // выбирается в меню «Папка рабочего стола»): объекты (папки с data) и всё, что создано на рабочем столе
  // Порядок: своя папка этого браузера (у приглашённого общая папка может называться иначе) → папка,
  // закреплённая владельцем на сайте (data-root) → «Прораб+»
  let ROOT = D.normalize(app.dataset.root || '/Прораб+');
  const ROOT_SAVE = app.dataset.rootSave || '';
  let HOME = ROOT;

  // ───────── форматирование ─────────
  const pad = (n) => String(n).padStart(2, '0');
  const dayToInput = (d) => { const x = new Date(d * 86400000); return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()); };
  const inputToDay = (s) => { const t = Date.parse(s + 'T00:00:00Z'); return Number.isFinite(t) ? Math.round(t / 86400000) : null; };
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const dayTitle = (d) => cap(new Date(d * 86400000).toLocaleDateString('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }));
  const shortDate = (d) => new Date(d * 86400000).toLocaleDateString('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
  const money = (c) => (c / 100).toLocaleString('ru-RU', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' ₽';
  const num = (q) => (q === null || q === undefined ? '' : Number(q).toLocaleString('ru-RU', { maximumFractionDigits: 6 }));
  const time = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  function parseMoney(s) {
    const t = String(s || '').replace(/\s/g, '').replace(',', '.');
    if (!t) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
    const c = Math.round(Number(t) * 100);
    return c > 100000000000 ? NaN : c;
  }
  function parseQty(s) {
    const t = String(s || '').replace(/\s/g, '').replace(',', '.');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 && n <= 1e12 ? n : NaN;
  }
  /** «8», «7:30», «7,5» → минуты; пусто — null; ошибка — NaN. */
  function parseHours(s) {
    const t = String(s || '').trim().replace(',', '.');
    if (!t) return null;
    let m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (m) { const v = Number(m[1]) * 60 + Number(m[2]); return Number(m[2]) < 60 && v <= 1440 ? v : NaN; }
    m = /^\d{1,2}(\.\d{1,2})?$/.exec(t);
    if (m) { const v = Math.round(Number(t) * 60); return v <= 1440 ? v : NaN; }
    return NaN;
  }
  const hoursText = (min) => (min ? (min % 60 ? Math.floor(min / 60) + ':' + pad(min % 60) : String(min / 60)) : '');

  // ───────── элементы ─────────
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const field = (label, input, note) => h('label', { class: 'pp-field' }, h('span', null, label), input, note ? h('small', null, note) : null);
  const button = (text, onclick, cls, title) => h('button', { type: 'button', class: 'pp-btn ' + (cls || ''), onclick, title }, text);
  function select(options, value, allowNone, noneText) {
    const s = h('select');
    if (allowNone) s.append(h('option', { value: '' }, noneText || '—'));
    for (const o of options) { const opt = h('option', { value: o.id }, o.name); if (o.id === value) opt.selected = true; s.append(opt); }
    if (!allowNone && !value && options[0]) s.value = options[0].id;
    return s;
  }
  /** Список с пунктом «+ Добавить…»: новое значение создаётся сразу (исполнитель, единица, вид работ). */
  function selectAdd(options, value, noneText, addLabel, onAdd) {
    const s = select(options, value, true, noneText);
    s.append(h('option', { value: '__add' }, '+ ' + addLabel + '…'));
    let prev = s.value;
    s.addEventListener('change', () => {
      if (s.value !== '__add') { prev = s.value; return; }
      const name = (prompt(addLabel, '') || '').trim();
      const row = name ? onAdd(name) : null;
      if (!row) { s.value = prev; return; }
      if (!Array.from(s.options).some((o) => o.value === row.id)) s.insertBefore(h('option', { value: row.id }, row.name), s.lastChild);
      s.value = prev = row.id;
    });
    return s;
  }
  const small = () => window.innerWidth < 720;
  const modalOpen = () => !!document.querySelector('.pp-modal');

  // ───────── состояние ─────────
  let disk = null;
  let status = { text: '', error: false };
  let me = '', writerLease = null, starting = false, leaving = false;
  let accountId = '';
  const clock = new S.Clock();
  const today = S.today();
  let projects = null; // [{ path, name }]
  let projectsError = null;
  let found = null; // объекты в других папках Диска (если в папке рабочего стола их нет): [{ parent, names }]
  const ctxs = {}; // папка объекта → { path, project, loading, error, saving, saveTimer, status }
  let wins = [];
  let zTop = 10;
  let home = { items: null, loading: false, selected: null };
  let refreshTimer = null;
  // Фон рабочего стола: готовый (класс CSS) или своя картинка. Настройка — на Диске («Прораб+/.prorab-desktop.json»),
  // картинка — там же, а в браузере её копия для быстрого показа
  const WALLS = [['default', 'Синий вечер'], ['sunset', 'Закат'], ['forest', 'Лес'], ['sea', 'Море'], ['graphite', 'Графит'], ['steel', 'Сталь'], ['sand', 'Песок'], ['night', 'Ночь']];
  // Настройки рабочего стола — общие для всех компьютеров и всех, с кем владелец поделился папкой:
  // фон и объекты из других папок Диска
  let DESK_FILE = ROOT + '/.prorab-desktop.json';
  let wall = store.json('wall', { kind: 'preset', id: 'default' });
  let extraList = store.json('extra', []);
  // Ярлыки на папки Диска (вне рабочего стола): [{ path, name }]
  let linkList = store.json('links', []);
  function setLinks(list) {
    const seen = new Set();
    linkList = list.filter((l) => l && l.path && !seen.has(l.path) && seen.add(l.path));
    store.set('links', JSON.stringify(linkList));
    saveDesk();
    render();
  }
  const extraProjects = () => extraList.slice();
  function setExtra(list) {
    extraList = Array.from(new Set(list));
    store.set('extra', JSON.stringify(extraList));
    saveDesk();
  }
  function saveDesk() {
    const conf = { version: 1, wall: wall.kind === 'image' ? { kind: 'image', file: wall.file } : { kind: 'preset', id: wall.id }, extra: extraList, links: linkList };
    return disk.mkdir(ROOT).then(() => disk.putText(DESK_FILE, JSON.stringify(conf, null, 1)))
      .then(() => setStatus('Настройки рабочего стола сохранены на Диске'), (e) => setStatus('Настройки не сохранились на Диске: ' + e.message, true));
  }

  function setStatus(text, error) {
    status = { text, error: !!error };
    const el = document.getElementById('pp-status');
    if (el) { el.textContent = text; el.className = 'pp-status' + (error ? ' pp-error' : ''); }
  }
  const lastName = (p) => p.split('/').filter(Boolean).pop() || p;
  const projName = (path) => (ctxs[path] && ctxs[path].project ? ctxs[path].project.project.name : null) || (store.json('names', {})[path]) || lastName(path);

  // ───────── вход ─────────
  function takeTokenFromUrl() {
    if (!location.hash.includes('access_token=')) return;
    const params = new URLSearchParams(location.hash.slice(1));
    const expected = authStore.json('oauth-state', null);
    const valid = expected && Date.now() - expected.at < 10 * 60 * 1000 && params.get('state') === expected.value;
    history.replaceState(null, '', location.pathname + location.search);
    if (!valid) throw new Error('Не удалось проверить возврат от Яндекса. Нажмите «Войти через Яндекс» ещё раз или вставьте ключ вручную.');
    authStore.set('oauth-state', null);
    if (params.get('access_token')) authStore.set('token', params.get('access_token'));
  }

  function beginYandexLogin(auth) {
    const state = { value: S.newId(), at: Date.now() };
    authStore.set('oauth-state', JSON.stringify(state));
    window.open(auth + '&state=' + encodeURIComponent(state.value), '_blank', 'noopener');
  }

  /** Ключ из того, что вставили: сам ключ или целая ссылка со страницы Яндекса (…#access_token=…). */
  function tokenFrom(text) {
    const t = String(text || '').trim();
    const m = /access_token=([^&\s]+)/.exec(t);
    return m ? decodeURIComponent(m[1]) : t.replace(/\s/g, '');
  }

  function loginScreen(message) {
    app.classList.remove('pp-desk-app');
    const input = h('input', { type: 'password', autocomplete: 'off', placeholder: 'y0_…' });
    const go = () => { if (starting) return; const t = tokenFrom(input.value); if (!t) return; authStore.set('token', t); start(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const auth = CLIENT_ID ? 'https://oauth.yandex.ru/authorize?response_type=token&client_id=' + encodeURIComponent(CLIENT_ID) : null;
    app.replaceChildren(h('section', { class: 'pp-card pp-narrow' },
      h('h1', null, 'Прораб+ на компьютере'),
      h('p', { class: 'pp-muted' }, 'Все объекты — те же, что в телефоне: данные берутся из папки «' + lastName(ROOT) + '» на Яндекс Диске и записываются обратно. Ключ хранится только в этом браузере.'),
      message ? h('p', { class: 'pp-error' }, message) : null,
      auth ? h('ol', { class: 'pp-steps' },
        h('li', null, button('Войти через Яндекс', () => beginYandexLogin(auth), 'pp-primary'), h('span', { class: 'pp-muted' }, ' — откроется Яндекс: войдите своим аккаунтом и нажмите «Разрешить».')),
        h('li', null, 'Яндекс покажет ключ доступа — скопируйте его и вставьте сюда:'),
        h('li', null, field('Ключ доступа', input), button('Войти', go, 'pp-primary'))) : null,
      h('details', { open: !auth },
        h('summary', null, auth ? 'Другой способ: ключ с Полигона Яндекс Диска' : 'Войти по ключу Яндекс Диска'),
        h('ol', null,
          h('li', null, 'Откройте ', h('a', { href: 'https://yandex.ru/dev/disk/poligon/', target: '_blank', rel: 'noopener' }, 'Полигон Яндекс Диска'), ' и войдите своим Яндексом.'),
          h('li', null, 'Нажмите «Получить OAuth-токен» и скопируйте строку.'),
          h('li', null, 'Вставьте её в поле ключа. Никому её не пересылайте.')),
        auth ? null : h('div', null, field('Ключ', input), button('Войти', go, 'pp-primary'))),
      h('p', { class: 'pp-muted' }, 'Ключ даёт доступ к Яндекс Диску этого аккаунта. Не вводите его на чужих сайтах и не пересылайте. Выйти — меню «Прораб+» → «Выйти».'),
    ));
  }

  function fail(e) {
    if (e && e.status === 401) { if (Object.keys(ctxs).length) return logout(); authStore.set('token', null); return loginScreen(e.message); }
    app.classList.remove('pp-desk-app');
    app.replaceChildren(h('section', { class: 'pp-card pp-narrow' }, h('p', { class: 'pp-error' }, (e && e.message) || String(e)), button('Повторить', start)));
  }

  function persistAll() {
    for (const c of Object.values(ctxs)) if (c.project && (c.project.dirty || c.saving)) persist(c);
  }

  function logout() {
    persistAll();
    authStore.set('token', null);
    leaving = true;
    location.reload(); // stops old callbacks before another account can start
  }

  // ───────── объекты на Диске ─────────
  async function hasData(path) {
    const items = await disk.list(path);
    return !!(items && items.some((i) => i.type === 'dir' && i.name === 'data'));
  }

  /** Объекты: папки «Прораб+/…» с папкой data (так их создаёт телефон) и добавленные вручную. */
  async function loadProjects() {
    projectsError = null;
    try {
      const root = (await disk.list(ROOT)) || [];
      const paths = root.filter((i) => i.type === 'dir' && !i.name.startsWith('.')).map((i) => ROOT + '/' + i.name);
      for (const p of extraProjects()) if (!paths.includes(p)) paths.push(p);
      const list = [];
      for (let i = 0; i < paths.length; i += 6) {
        const part = paths.slice(i, i + 6);
        const ok = await Promise.all(part.map((p) => hasData(p).catch(() => false)));
        part.forEach((p, k) => { if (ok[k]) list.push({ path: p, name: projName(p) }); });
      }
      projects = list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      if (!projects.length && found === null) discover();
      const isProject = new Set(list.map((p) => p.path));
      home.items = sortItems(root.filter((i) => !isProject.has(ROOT + '/' + i.name)));
    } catch (e) {
      home.items = home.items || [];
      projects = projects || [];
      projectsError = e.message;
      if (e.status === 401) return fail(e);
    }
    render();
  }

  /**
   * В папке рабочего стола объектов нет — поискать их на Диске (корень и папки первого уровня): телефон
   * мог подключить объекты к другой папке. Найденное предлагается сделать рабочим столом.
   */
  async function discover() {
    found = [];
    try {
      const root = ((await disk.list('/')) || []).filter((i) => i.type === 'dir' && !i.name.startsWith('.')).slice(0, 40);
      const groups = new Map();
      const add = (parent, name) => { if (!groups.has(parent)) groups.set(parent, []); groups.get(parent).push(name); };
      for (let i = 0; i < root.length; i += 6) {
        await Promise.all(root.slice(i, i + 6).map(async (d) => {
          const path = '/' + d.name;
          const items = (await disk.list(path).catch(() => null)) || [];
          if (items.some((x) => x.type === 'dir' && x.name === 'data')) { add('/', d.name); return; }
          const sub = items.filter((x) => x.type === 'dir' && !x.name.startsWith('.')).slice(0, 30);
          const ok = await Promise.all(sub.map((x) => hasData(path + '/' + x.name).catch(() => false)));
          sub.forEach((x, k) => { if (ok[k]) add(path, x.name); });
        }));
      }
      found = Array.from(groups.entries()).map(([parent, names]) => ({ parent, names: names.sort((a, b) => a.localeCompare(b, 'ru')) })).sort((a, b) => b.names.length - a.names.length);
    } catch (e) { found = []; }
    if (!modalOpen()) render();
  }

  /**
   * Сделать папку рабочим столом. Владелец на сайте — закрепляется для всех устройств и всех людей
   * (настройка сайта); иначе — только для этого браузера.
   */
  async function chooseRoot(path) {
    const p = D.normalize(path);
    if (ROOT_SAVE) {
      try {
        const body = new URLSearchParams({ csrf_token: app.dataset.csrf || '', root: p });
        const r = await fetch(ROOT_SAVE, { method: 'POST', body, credentials: 'same-origin' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || 'Сайт ответил ' + r.status);
        store.set('root', null);
        location.reload();
        return;
      } catch (e) {
        if (!confirm('Не получилось закрепить папку на сайте для всех (' + e.message + '). Сделать её рабочим столом только в этом браузере?')) return;
      }
    }
    store.set('root', p === D.normalize(app.dataset.root || '/Прораб+') ? null : p);
    location.reload();
  }

  async function readFiles(path) {
    const items = (await disk.list(path + '/data')) || [];
    const out = [];
    for (const it of items.filter((i) => i.type === 'file' && i.name.endsWith('.json'))) {
      const text = await disk.getText(path + '/data/' + it.name);
      if (text === null) continue;
      let j;
      try { j = JSON.parse(text); } catch (e) { throw new Error('Повреждены данные на Диске: ' + it.name + '. Повторите позже.'); }
      if (!S.validFile(j)) throw new Error('Неизвестный формат данных: ' + it.name + '. Обновите приложение на телефоне.');
      j.device = j.device || it.name.replace(/\.json$/, '');
      out.push(j);
    }
    return out;
  }

  function snapshot(c) { return S.toFile(c.project.state, c.project.projectId, c.project.project.name, me); }

  function persist(c) {
    if (!c.drafts || !c.project) return;
    if (!c.drafts.write(snapshot(c))) {
      setStatus('Браузер не смог сохранить резервную копию правок. Не закрывайте страницу до записи на Диск.', true);
    }
    store.set('clock', String(clock.last));
  }

  function watchChanges(c) {
    c.project.onChange = () => {
      // One durable checkpoint for a group of synchronous edits, including additions
      // from a form which is later cancelled. Also flush synchronously on pagehide.
      if (c.checkpointQueued) return;
      c.checkpointQueued = true;
      queueMicrotask(() => { c.checkpointQueued = false; persist(c); scheduleSave(c); });
    };
  }

  /** Загрузить объект (один раз); окна объекта показывают «Загружаю…», пока он не готов. */
  function openCtx(path) {
    if (ctxs[path]) return ctxs[path];
    const c = ctxs[path] = { path, project: null, loading: true, error: null, saving: false, saveTimer: null, status: 'Загружаю…' };
    (async () => {
      try {
        const files = await readFiles(path);
        if (!files.length) throw new Error('В папке нет данных объекта. Подключите объект к ней в телефоне и синхронизируйте.');
        const best = files.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
        const pid = best.projectId;
        if (files.some((f) => f.projectId && f.projectId !== pid)) throw new Error('В папке данные разных объектов.');
        c.drafts = new R.Drafts(store, path, pid, me);
        const drafts = c.drafts.read();
        c.project = new M.Project(S.mergeFiles(files.concat(drafts.map((d) => d.file)), pid, clock), SCHEMA, pid, me, clock);
        watchChanges(c);
        if (drafts.length) { c.project.dirty = true; persist(c); scheduleSave(c, 0); }
        const names = store.json('names', {});
        names[path] = c.project.project.name || lastName(path);
        store.set('names', JSON.stringify(names));
        if (projects) projects.forEach((p) => { if (p.path === path) p.name = names[path]; });
        c.status = 'Загружено в ' + time();
      } catch (e) {
        c.error = e.message;
        if (e.status === 401) fail(e);
      } finally {
        c.loading = false;
        if (!modalOpen()) render();
      }
    })();
    return c;
  }

  /** Забрать чужие правки (раз в минуту и по кнопке); свои несохранённые не теряются. */
  async function refreshCtx(c) {
    // Пока открыта форма, объект не подменяем: она пишет в текущий (иначе её правки потерялись бы)
    if (!c.project || c.saving || modalOpen()) return;
    try {
      const files = await readFiles(c.path);
      if (modalOpen() || c.saving) return; // форма или сохранение начались во время чтения Диска
      const mine = S.toFile(c.project.state, c.project.projectId, c.project.project.name, me);
      const dirty = c.project.dirty;
      c.project.state = S.mergeFiles(files.concat([mine]), c.project.projectId, clock);
      c.project.dirty = dirty;
      store.set('clock', String(clock.last));
      c.status = 'Обновлено в ' + time();
    } catch (e) { c.status = e.message; setStatus(projName(c.path) + ': ' + e.message, true); }
  }

  async function refreshAll() {
    const open = new Set(wins.map((w) => w.folder).filter(Boolean));
    if (econ.vault && wins.some((w) => w.kind === 'economy')) for (const p of projects || []) open.add(p.path);
    for (const path of open) if (ctxs[path]) await refreshCtx(ctxs[path]);
    if (econ.session && econ.vault && !modalOpen() && !econ.operation) {
      try { await econ.session.refresh(); } catch (e) { setStatus('Экономика: ' + e.message, true); }
    }
    if (!modalOpen()) render();
  }

  function scheduleSave(c, delay) {
    clearTimeout(c.saveTimer);
    c.saveTimer = setTimeout(() => save(c), delay === undefined ? 800 : delay);
  }

  async function save(c) {
    if (!c || !c.project || !c.project.dirty) return;
    if (c.saving) return scheduleSave(c, 1000);
    c.saving = true;
    persist(c);
    let drafts;
    try { drafts = c.drafts.read(); }
    catch (e) { c.saving = false; setStatus(e.message, true); return; }
    // Include recovery drafts, keeping the Project instance captured by open forms/uploads.
    c.project.state = S.mergeFiles(drafts.map((d) => d.file).concat([snapshot(c)]), c.project.projectId, clock);
    const text = JSON.stringify(snapshot(c));
    const revision = c.project.revision;
    const targetDisk = disk;
    c.status = 'Сохраняю на Диск…';
    setStatus(projName(c.path) + ': сохраняю…');
    try {
      await targetDisk.putText(c.path + '/data/' + me + '.json', text);
      c.drafts.acknowledge(drafts);
      c.project.dirty = c.project.revision !== revision;
      if (c.project.dirty) { persist(c); scheduleSave(c, 0); }
      c.status = 'Сохранено в ' + time() + ' — телефон получит при синхронизации';
      setStatus(projName(c.path) + ': сохранено в ' + time());
      // Фиксация не чаще раза в 30 минут; её ошибки не мешают сохранению
      fixNow(c, false).then((msg) => { if (msg && msg.startsWith('Зафиксировано')) c.status += ' · ' + msg.toLowerCase(); }, (e) => { c.fixWarning = e.message; });
    } catch (e) {
      c.project.dirty = true;
      c.status = 'Не сохранилось: ' + e.message;
      setStatus(projName(c.path) + ': не сохранилось на Диск. Не закрывайте страницу, повторю через минуту.', true);
      persist(c);
      scheduleSave(c, 60000);
    } finally { c.saving = false; if (!modalOpen()) render(); }
  }

  function changed(c) { persist(c); scheduleSave(c); render(); }

  /** Новый объект с компьютера: папка «Прораб+/<название>» и файл этого устройства; на телефоне — «Открыть из облака». */
  async function newProject() {
    const name = (prompt('Название объекта', 'Новый объект') || '').trim();
    if (!name) return;
    if (!validName(name)) return alert('В названии нельзя использовать \\ / : * ? " < > |');
    try {
      await disk.mkdir(ROOT);
      let path = ROOT + '/' + name;
      for (let i = 2; await disk.list(path) !== null; i++) path = ROOT + '/' + name + ' (' + i + ')';
      await disk.mkdir(path); await disk.mkdir(path + '/data'); await disk.mkdir(path + '/files');
      const pid = S.newId();
      const project = new M.Project({}, SCHEMA, pid, me, clock);
      project.put('projects', pid, { name });
      DEFAULT_UNITS.forEach((u) => project.put('units', S.newId(), { projectId: pid, name: u }));
      await disk.putText(path + '/data/' + me + '.json', JSON.stringify(S.toFile(project.state, pid, name, me)));
      store.set('clock', String(clock.last));
      const names = store.json('names', {}); names[path] = name; store.set('names', JSON.stringify(names));
      projects = (projects || []).concat([{ path, name }]).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      setStatus('Создан объект «' + name + '». В телефоне: «Открыть из облака» → папка ' + path);
      openWindow('project', path);
      withCtx(path, (c) => cardForm(c, { title: 'Новый объект — карточка', note: 'Заполните, что знаете: адрес, участников, сроки. Остальное можно дописать позже. Чертежи — в окне объекта «Чертежи».' }));
    } catch (e) { alert(e.message); }
  }

  // ───────── окна ─────────
  const APPS = {
    journal: { title: 'Журнал работ', icon: '📒', view: (w, c) => journalView(w, c) },
    calendar: { title: 'Календарь', icon: '📅', view: (w, c) => calendarView(w, c) },
    boq: { title: 'Ведомость', icon: '📋', view: (w, c) => boqView(w, c) },
    remarks: { title: 'Замечания', icon: '⚠️', view: (w, c) => remarksView(w, c) },
    finance: { title: 'Финансы', icon: '💰', view: (w, c) => financeView(w, c) },
    machines: { title: 'Техника и бригады', icon: '🚜', view: (w, c) => machinesView(w, c) },
    explorer: { title: 'Документы', icon: '🗂️', view: (w) => explorerView(w) },
    card: { title: 'Карточка объекта', icon: '🪪', view: (w, c) => cardView(w, c) },
    dirs: { title: 'Справочники', icon: '📇', view: (w, c) => dirsView(w, c) },
    drawings: { title: 'Чертежи', icon: '📐', view: (w, c) => drawingsView(w, c) },
    drawing: { title: 'Чертёж', icon: '📐', view: (w, c) => drawingView(w, c) },
    fileview: { title: 'Просмотр', icon: '📐', view: (w) => fileView(w) },
    today: { title: 'Сегодня', icon: '☀️', view: (w, c) => todayView(w, c) },
    extras: { title: 'Доп. работы', icon: '➕', view: (w, c) => extrasView(w, c) },
    acceptance: { title: 'Журнал приёмки', icon: '✅', view: (w, c) => acceptanceView(w, c) },
    id: { title: 'Исполнительная документация', icon: '📑', view: (w, c) => idView(w, c) },
    fixation: { title: 'Фиксация данных', icon: '🔏', view: (w, c) => fixationView(w, c) },
    project: { title: 'Объект', icon: '🏗️', view: (w, c) => projectView(w, c) },
    economy: { title: 'Экономика', icon: '💼', view: () => economyView() },
    econ: { title: 'Экономика объекта', icon: '💼', view: (w, c) => econView(w, c) },
    picker: { title: 'Добавить объект', icon: '➕', view: (w) => pickerView(w) },
  };
  const PROJECT_APPS = ['today', 'card', 'journal', 'calendar', 'boq', 'extras', 'acceptance', 'id', 'remarks', 'drawings', 'finance', 'machines', 'dirs', 'fixation', 'explorer'];

  function openWindow(kind, folder, opts) {
    opts = opts || {};
    const base = kind === 'explorer' ? opts.base || (folder ? folder + '/' + DOCS : HOME) : null;
    const key = [kind, folder || '', base || '', opts.path || '', opts.mode || ''].join('|');
    let w = wins.find((x) => x.key === key);
    if (!w) {
      const lay = store.json('layout', {})[kind] || {};
      const n = wins.length % 8;
      w = {
        id: S.newId(), key, kind, folder: folder || null, base, path: opts.path || '', items: null, mode: opts.mode || null, title: opts.title || null,
        x: lay.x !== undefined ? lay.x + n * 24 : 140 + n * 28, y: lay.y !== undefined ? lay.y + n * 20 : 24 + n * 24,
        w: lay.w || Math.min(kind === 'project' ? 620 : 980, window.innerWidth - 180), h: lay.h || Math.min(kind === 'project' ? 420 : 640, window.innerHeight - 120),
        min: false, max: small(), period: { from: today - 30, to: today }, month: null, selected: today,
      };
      w.x = Math.min(w.x, Math.max(0, window.innerWidth - 360)); w.y = Math.min(w.y, Math.max(0, window.innerHeight - 260));
      wins.push(w);
      if (kind === 'explorer' || kind === 'picker') loadFolder(w);
    }
    if (folder) openCtx(folder);
    w.min = false;
    w.z = ++zTop;
    render();
    return w;
  }
  const closeWindow = (w) => { if (w.viewer) w.viewer.destroy(); wins = wins.filter((x) => x !== w); if (w.folder && ctxs[w.folder]) save(ctxs[w.folder]); render(); };
  function winTitle(w) {
    if (w.kind === 'explorer') {
      const where = w.folder ? projName(w.folder) + ' · ' + DOCS : w.base === HOME ? 'Рабочий стол (' + lastName(ROOT) + ')' : (w.title || lastName(w.base));
      return where + (w.path ? ' › ' + w.path.split('/').join(' › ') : '');
    }
    if (w.kind === 'project') return projName(w.folder);
    if (w.kind === 'economy') return 'Экономика — все объекты';
    if (w.kind === 'fileview') return (w.title || lastName(w.path)) + ' · просмотр';
    if (w.kind === 'drawing') { const c = ctxs[w.folder]; const d = c && c.project && c.project.get('drawings', w.path); return projName(w.folder) + ' · ' + (d ? d.name : 'Чертёж'); }
    if (w.kind === 'picker') return w.mode === 'root' ? 'Папка рабочего стола' : w.mode === 'link' ? 'Ярлык на папку Диска' : APPS.picker.title;
    return projName(w.folder) + ' · ' + APPS[w.kind].title;
  }
  function rememberLayout(w) {
    if (w.max || small()) return;
    const lay = store.json('layout', {});
    lay[w.kind] = { x: w.x, y: w.y, w: w.w, h: w.h };
    store.set('layout', JSON.stringify(lay));
  }

  /** Таскание окна за заголовок (мышь и палец). */
  function dragger(w, el) {
    return (e) => {
      if (w.max || e.target.closest('button')) return;
      const sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y;
      w.z = ++zTop; el.style.zIndex = w.z;
      const move = (ev) => { w.x = Math.max(0, ox + ev.clientX - sx); w.y = Math.max(0, oy + ev.clientY - sy); el.style.left = w.x + 'px'; el.style.top = w.y + 'px'; };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); rememberLayout(w); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
  }

  function windowEl(w) {
    const el = h('section', { class: 'pp-win' + (w.max ? ' pp-max' : ''), 'data-key': w.key, onpointerdown: () => { if (w.z !== zTop) { w.z = ++zTop; el.style.zIndex = w.z; } } });
    if (!w.max) { el.style.left = w.x + 'px'; el.style.top = w.y + 'px'; el.style.width = w.w + 'px'; el.style.height = w.h + 'px'; }
    el.style.zIndex = w.z;
    const bar = h('header', { class: 'pp-winbar', ondblclick: () => { w.max = !w.max; render(); } },
      h('span', { class: 'pp-wintitle' }, APPS[w.kind].icon + ' ' + winTitle(w)),
      h('span', { class: 'pp-winbtns' },
        h('button', { type: 'button', title: 'Свернуть', onclick: () => { w.min = true; render(); } }, '–'),
        h('button', { type: 'button', title: w.max ? 'Обычный размер' : 'Развернуть', onclick: () => { w.max = !w.max; render(); } }, w.max ? '❐' : '□'),
        h('button', { type: 'button', title: 'Закрыть', class: 'pp-close', onclick: () => closeWindow(w) }, '✕')));
    bar.addEventListener('pointerdown', dragger(w, el));
    let content;
    const c = w.folder ? ctxs[w.folder] : null;
    if (w.folder && (!c || c.loading) && w.kind !== 'explorer') content = h('p', { class: 'pp-muted' }, 'Загружаю данные объекта…');
    else if (w.folder && c.error && w.kind !== 'explorer') content = h('div', null, h('p', { class: 'pp-error' }, c.error), button('Повторить', () => { delete ctxs[w.folder]; openCtx(w.folder); render(); }));
    else content = APPS[w.kind].view(w, c);
    const body = h('div', { class: 'pp-winbody' + (w.kind === 'drawing' || w.kind === 'fileview' ? ' pp-winbody-plan' : '') }, content);
    if (!w.max) {
      let t = null;
      new ResizeObserver(() => {
        if (!el.isConnected || w.max) return;
        w.w = el.offsetWidth; w.h = el.offsetHeight;
        clearTimeout(t); t = setTimeout(() => rememberLayout(w), 400);
      }).observe(el);
    }
    el.append(bar, body);
    return el;
  }

  function render() {
    if (!disk) return;
    const scroll = {};
    document.querySelectorAll('.pp-win').forEach((el) => { const b = el.querySelector('.pp-winbody'); if (b) scroll[el.dataset.key] = b.scrollTop; });
    const icons = [
      ...(projects || []).map((p) => ({ key: 'proj:' + p.path, icon: '🏗️', name: p.name, open: () => openWindow('project', p.path), menu: (x, y) => projectMenu(x, y, p) })),
      ...(econVisible() ? [{ key: 'econ', icon: '💼', name: 'Экономика', open: () => openEconomy(), menu: (x, y) => popup(x, y, [['Открыть', () => openEconomy()], econ.vault ? ['🔒 Закрыть экономику', () => lockEcon('Экономика закрыта')] : null]) }] : []),
      ...linkList.map((l) => ({ key: 'link:' + l.path, icon: '📂', badge: true, name: l.name, open: () => openLink(l), menu: (x, y) => linkMenu(x, y, l) })),
      ...(home.items || []).map((it) => ({ key: 'home:' + it.name, icon: fileIcon(it), name: shownName(it), open: () => openItem(null, it, HOME, ''), menu: (x, y) => itemMenu(x, y, null, it, HOME, '') })),
    ];
    const visible = wins.filter((w) => !w.min).sort((a, b) => a.z - b.z);
    app.classList.add('pp-desk-app');
    app.replaceChildren(
      wallEl(h('div', { class: 'pp-desktop', oncontextmenu: (e) => { if (e.target.classList.contains('pp-desktop') || e.target.classList.contains('pp-icons')) { e.preventDefault(); homeMenu(e.clientX, e.clientY); } } },
        h('div', { class: 'pp-icons', onclick: (e) => { if (e.target.classList.contains('pp-icons')) { home.selected = null; render(); } } },
          projects === null ? h('p', { class: 'pp-desk-note' }, 'Ищу объекты на Диске…') : null,
          projects && !projects.length ? h('div', { class: 'pp-desk-note' },
            h('p', null, 'Рабочий стол — папка «' + lastName(ROOT) + '» на вашем Яндекс Диске. Объектов в ней пока нет.'),
            found === null ? h('p', null, 'Ищу объекты в других папках Диска…') :
              found.length ? h('div', null, found.map((g) => h('div', { class: 'pp-found' },
                h('p', null, 'Найдены объекты в папке «' + (g.parent === '/' ? 'корень Диска' : g.parent) + '»: ' + g.names.join(', ')),
                g.parent !== '/' ? button('Сделать «' + lastName(g.parent) + '» рабочим столом' + (ROOT_SAVE ? ' для всех' : ''), () => chooseRoot(g.parent), 'pp-primary') : null,
                button('Показать эти объекты здесь', () => { setExtra(extraProjects().concat(g.names.map((n) => (g.parent === '/' ? '' : g.parent) + '/' + n))); loadProjects(); })))) :
                h('p', null, 'Объектов на Диске не нашлось. Подключите объект к облаку в телефоне (папка «' + lastName(ROOT) + '») или создайте его здесь: правый щелчок → «Новый объект».')) : null,
          projectsError ? h('p', { class: 'pp-desk-note pp-error' }, projectsError) : null,
          icons.map((ic) => h('button', {
            type: 'button', class: 'pp-icon-btn' + (home.selected === ic.key ? ' pp-selected' : ''), title: ic.name,
            onclick: () => { if (small()) ic.open(); else if (home.selected !== ic.key) { home.selected = ic.key; render(); } },
            ondblclick: ic.open,
            oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); ic.menu(e.clientX, e.clientY); },
          }, h('span', { class: 'pp-icon-img' + (ic.badge ? ' pp-shortcut' : '') }, ic.icon), h('span', { class: 'pp-icon-name' }, ic.name)))),
        visible.map(windowEl))),
      h('footer', { class: 'pp-taskbar' },
        h('button', { type: 'button', class: 'pp-start', onclick: (e) => startMenu(e) }, '▦ Прораб+'),
        h('div', { class: 'pp-tasks' }, wins.map((w) => h('button', { type: 'button', class: 'pp-task' + (!w.min && w.z === zTop ? ' pp-active' : ''), title: winTitle(w), onclick: () => { if (!w.min && w.z === zTop) w.min = true; else { w.min = false; w.z = ++zTop; } render(); } }, APPS[w.kind].icon + ' ' + winTitle(w)))),
        h('span', { id: 'pp-status', class: 'pp-status' + (status.error ? ' pp-error' : '') }, status.text),
        button('⟳', () => { refreshAll(); loadProjects(); home.items = null; render(); }, 'pp-tray', 'Обновить'),
        h('span', { class: 'pp-clock' }, time())),
    );
    document.querySelectorAll('.pp-win').forEach((el) => { const b = el.querySelector('.pp-winbody'); if (b && scroll[el.dataset.key]) b.scrollTop = scroll[el.dataset.key]; });
    if (home.items === null && !home.loading && projects !== null) loadHome();
  }

  function popup(x, y, items) {
    document.querySelectorAll('.pp-menu').forEach((m) => m.remove());
    const list = items.filter(Boolean);
    const m = h('div', { class: 'pp-menu', oncontextmenu: (e) => e.preventDefault() }, list.map(([t, f]) => (t === '-' ? h('hr') : t.startsWith('#') ? h('div', { class: 'pp-menu-head' }, t.slice(1)) : h('button', { type: 'button', onclick: () => { m.remove(); f(); } }, t))));
    document.body.append(m);
    m.style.left = Math.max(4, Math.min(x, window.innerWidth - m.offsetWidth - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(y, window.innerHeight - m.offsetHeight - 4)) + 'px';
    setTimeout(() => window.addEventListener('click', () => m.remove(), { once: true }), 0);
  }

  function startMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const open = Array.from(new Set(wins.map((w) => w.folder).filter(Boolean)));
    popup(r.left, r.top - 400, [
      ['#Объекты'],
      ...(projects || []).slice(0, 12).map((p) => ['🏗️ ' + p.name, () => openWindow('project', p.path)]),
      ['+ Новый объект', newProject], ['➕ Добавить объект из папки…', () => openWindow('picker', null)], ['📂 Ярлык на папку Диска…', () => openWindow('picker', null, { mode: 'link' })],
      econVisible() ? ['💼 Экономика (только для собственника)', () => openEconomy()] : null,
      ['-'], ['🗂️ Рабочий стол в проводнике', () => openWindow('explorer', null, { base: HOME })],
      open.length ? ['💾 Сохранить всё сейчас', () => open.forEach((p) => save(ctxs[p]))] : null,
      ['🎨 Фон рабочего стола…', wallDialog],
      ['📂 Папка рабочего стола…', () => openWindow('picker', null, { mode: 'root' })],
      ['-'], ['Выйти', logout],
    ]);
  }

  function homeMenu(x, y) {
    popup(x, y, [
      ['⟳ Обновить', () => { home.items = null; loadProjects(); }],
      ['-'], ['#Создать'],
      ['🔗 Ярлык на сайт', () => createIn(HOME, '', 'url')], ['📂 Ярлык на папку Диска…', () => openWindow('picker', null, { mode: 'link' })], ['📁 Папку', () => createIn(HOME, '', 'dir')], ['📝 Документ Word', () => createIn(HOME, '', 'docx')], ['📊 Таблицу Excel', () => createIn(HOME, '', 'xlsx')],
      ['🏗️ Новый объект', newProject],
      ['-'], ['➕ Добавить объект из папки…', () => openWindow('picker', null)], ['⬆ Загрузить файлы…', () => uploadInto(HOME, '')], ['Открыть папку на Диске', () => window.open(D.webFolder(HOME), '_blank', 'noopener')],
      ['-'], ['🎨 Фон рабочего стола…', wallDialog],
    ]);
  }

  // ───────── фон рабочего стола ─────────
  function wallEl(el) {
    if (wall.kind === 'image' && wall.data) { el.classList.add('pp-wall-image'); el.style.backgroundImage = 'url("' + wall.data + '")'; }
    else el.classList.add('pp-wall-' + (WALLS.some(([k]) => k === wall.id) ? wall.id : 'default'));
    return el;
  }

  function setWall(next, toDisk) {
    wall = next;
    try { store.set('wall', JSON.stringify(wall)); } catch (e) { /* большая картинка не влезла — покажем с Диска */ }
    render();
    if (toDisk) saveDesk();
  }

  /** Картинка → JPEG не больше 2560 px (data:, его разрешает политика безопасности страницы). */
  function shrink(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const k = Math.min(1, 2560 / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Это не картинка (нужен JPG, PNG или WebP)')); };
      img.src = url;
    });
  }
  const dataToBlob = (data) => { const [head, b64] = data.split(','); const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: head.slice(5).split(';')[0] }); };
  const blobToData = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

  /** Настройки рабочего стола с Диска: объекты из других папок и фон. */
  async function loadDesk() {
    let conf;
    try {
      const text = await disk.getText(DESK_FILE);
      if (!text) return;
      const j = JSON.parse(text);
      // Прежний формат файла — только фон
      conf = j.wall || (j.kind ? j : {});
      if (Array.isArray(j.extra)) { extraList = j.extra.filter((p) => typeof p === 'string'); store.set('extra', JSON.stringify(extraList)); }
      if (Array.isArray(j.links)) { linkList = j.links.filter((l) => l && typeof l.path === 'string').map((l) => ({ path: D.normalize(l.path), name: String(l.name || lastName(l.path)) })); store.set('links', JSON.stringify(linkList)); }
    } catch (e) { return; }
    loadWallFrom(conf);
  }

  async function loadWallFrom(conf) {
    try {
      if (conf.kind === 'preset' && conf.id !== wall.id) setWall({ kind: 'preset', id: conf.id }, false);
      if (conf.kind === 'image' && conf.file && (wall.kind !== 'image' || wall.file !== conf.file || !wall.data)) {
        const bytes = await disk.getBytes(ROOT + '/' + conf.file);
        if (bytes) setWall({ kind: 'image', file: conf.file, data: await blobToData(new Blob([bytes], { type: 'image/jpeg' })) }, false);
      }
    } catch (e) { /* нет настройки — фон по умолчанию */ }
  }

  function wallDialog() {
    const close = () => wrap.remove();
    const pick = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    const note = h('p', { class: 'pp-muted' }, 'Фон сохраняется на Диске в папке «' + lastName(ROOT) + '» — он будет одинаковым на всех компьютерах и у всех, с кем вы поделились папкой.');
    pick.addEventListener('change', async () => {
      const f = pick.files[0];
      if (!f) return;
      if (f.size > 25 * 1024 * 1024) return alert('Картинка больше 25 МБ');
      try {
        note.textContent = 'Обрабатываю и загружаю на Диск…';
        const data = await shrink(f);
        const file = '.prorab-desktop-' + Date.now().toString(36) + '.jpg';
        await disk.mkdir(ROOT);
        await disk.putBlob(ROOT + '/' + file, dataToBlob(data), true);
        const old = wall.kind === 'image' ? wall.file : null;
        setWall({ kind: 'image', file, data }, true);
        if (old && old !== file) disk.remove(ROOT + '/' + old).catch(() => {});
        close();
      } catch (e) { note.textContent = e.message; }
    });
    const wrap = h('div', { class: 'pp-modal', onclick: (e) => { if (e.target === wrap) close(); } },
      h('div', { class: 'pp-dialog' },
        h('div', { class: 'pp-row pp-between' }, h('h2', null, 'Фон рабочего стола'), button('✕', close, 'pp-icon')),
        h('div', { class: 'pp-walls' }, WALLS.map(([id, name]) => h('button', {
          type: 'button', class: 'pp-wall-swatch pp-wall-' + id + (wall.kind === 'preset' && wall.id === id ? ' pp-selected' : ''),
          onclick: () => {
            const old = wall.kind === 'image' ? wall.file : null;
            setWall({ kind: 'preset', id }, true);
            if (old) disk.remove(ROOT + '/' + old).catch(() => {});
            close();
          },
        }, h('span', null, name)))),
        h('div', { class: 'pp-row pp-wrap' }, button('🖼️ Своя картинка…', () => pick.click(), 'pp-primary')),
        note));
    document.body.append(wrap);
  }

  function projectMenu(x, y, p) {
    const extra = extraProjects().includes(p.path);
    popup(x, y, [
      ['Открыть', () => openWindow('project', p.path)],
      ['-'], ...PROJECT_APPS.map((k) => [APPS[k].icon + ' ' + APPS[k].title, () => openWindow(k, p.path)]),
      ['-'], ['+ Сделано', () => withCtx(p.path, (c) => doneForm(c, { date: today }))], ['+ Задача', () => withCtx(p.path, (c) => taskForm(c, { date: today }))],
      econVisible() ? ['-'] : null, econVisible() ? ['💼 Экономика объекта', () => openEconomy(p.path)] : null,
      ['-'], ['Открыть папку на Диске', () => window.open(D.webFolder(p.path), '_blank', 'noopener')],
      extra ? ['Убрать с рабочего стола', () => { setExtra(extraProjects().filter((x) => x !== p.path)); loadProjects(); }] : null,
    ]);
  }

  /** Ярлык на папку Диска — открывается в проводнике кабинета; сама папка остаётся на месте. */
  function openLink(l) { openWindow('explorer', null, { base: l.path, title: l.name }); }

  function linkMenu(x, y, l) {
    popup(x, y, [
      ['Открыть', () => openLink(l)],
      ['Открыть на Диске', () => window.open(D.webFolder(l.path), '_blank', 'noopener')],
      ['Переименовать ярлык', () => {
        const n = (prompt('Имя ярлыка', l.name) || '').trim();
        if (n) setLinks(linkList.map((x2) => (x2.path === l.path ? { path: l.path, name: n } : x2)));
      }],
      ['Убрать с рабочего стола', () => { if (confirm('Убрать ярлык «' + l.name + '»? Папка на Диске останется.')) setLinks(linkList.filter((x2) => x2.path !== l.path)); }],
    ]);
  }

  /** Выполнить с загруженным объектом (форма «Сделано» с рабочего стола). */
  function withCtx(path, fn) {
    const c = openCtx(path);
    if (c.project) return fn(c);
    setStatus('Загружаю ' + projName(path) + '…');
    const t = setInterval(() => { if (!c.loading) { clearInterval(t); if (c.project) fn(c); else alert(c.error || 'Объект не загрузился'); } }, 200);
  }

  // ───────── окно объекта ─────────
  function projectView(w, c) {
    const p = c.project.project;
    const days = c.project.days(today - 6, today);
    const done = days.reduce((s, d) => s + d.works.length, 0);
    const late = c.project.rows('tasks').filter((t) => !Number(t.done) && t.date < today).length;
    const plan = c.project.rows('tasks').filter((t) => !Number(t.done) && t.date === today).length;
    const openRemarks = c.project.rows('remarks').filter((r) => r.status !== 'DONE').length;
    return h('div', { class: 'pp-project' },
      h('div', { class: 'pp-row pp-between pp-wrap' },
        h('div', null, h('h2', null, p.name || 'Объект'), h('small', { class: 'pp-muted' }, [p.address, w.folder].filter(Boolean).join(' · '))),
        h('div', { class: 'pp-row' }, button('+ Задача', () => taskForm(c, { date: today })), button('+ Сделано', () => doneForm(c, { date: today }), 'pp-primary'))),
      h('p', { class: 'pp-muted' }, 'Сегодня в плане: ' + plan + (late ? ' · просрочено: ' + late : '') + ' · записей «Сделано» за 7 дней: ' + done + (openRemarks ? ' · открытых замечаний: ' + openRemarks : '') + ' · ' + c.status),
      h('div', { class: 'pp-files' }, PROJECT_APPS.map((k) => h('button', { type: 'button', class: 'pp-file', ondblclick: () => openWindow(k, w.folder), onclick: () => { if (small()) openWindow(k, w.folder); } },
        h('span', { class: 'pp-icon-img' }, APPS[k].icon), h('span', { class: 'pp-icon-name' }, APPS[k].title)))),
      h('div', { class: 'pp-row pp-wrap' }, button('📄 Отчёт за сегодня', () => reportDialog(c, today)), button('⟳ Обновить', async () => { await refreshCtx(c); render(); })));
  }

  // ───────── журнал, календарь, ведомость, финансы ─────────
  function periodBar(w) {
    const from = h('input', { type: 'date', value: w.period.from !== null ? dayToInput(w.period.from) : '' });
    const to = h('input', { type: 'date', value: w.period.to !== null ? dayToInput(w.period.to) : '' });
    const apply = () => { w.period = { from: from.value ? inputToDay(from.value) : null, to: to.value ? inputToDay(to.value) : null }; render(); };
    from.addEventListener('change', apply); to.addEventListener('change', apply);
    return h('div', { class: 'pp-row pp-wrap' }, field('С', from), field('По', to),
      button('Весь срок', () => { w.period = { from: null, to: null }; render(); }),
      button('30 дней', () => { w.period = { from: today - 30, to: today }; render(); }));
  }

  function journalView(w, c) {
    const days = c.project.days(w.period.from, w.period.to);
    return h('main', null,
      h('div', { class: 'pp-row pp-between pp-wrap' }, periodBar(w),
        h('div', { class: 'pp-row pp-wrap' }, button('⬇ Excel', () => exportJournal(c, w.period, false), '', 'Журнал за период по дням — скачать'),
          button('Excel в «Документы»', () => exportJournal(c, w.period, true), '', 'Сохранить на Диск в документы объекта'),
          button('+ Задача', () => taskForm(c, { date: today })), button('+ Сделано', () => doneForm(c, { date: today }), 'pp-primary'))),
      days.length ? days.map((d) => dayCard(c, d)) : h('p', { class: 'pp-muted pp-card' }, 'За этот период записей нет.'));
  }

  function dayCard(c, d) {
    const rows = [];
    const sub = (t) => rows.push(h('h3', null, t));
    if (d.weather) rows.push(h('p', { class: 'pp-muted' }, weatherText(d.weather)));
    if (d.tasks.length) {
      sub('План');
      d.tasks.forEach((t) => rows.push(h('button', { type: 'button', class: 'pp-line', onclick: () => taskForm(c, { taskId: t.id }) },
        h('span', null, (t.done ? '✓ ' : '○ ') + t.title), h('small', null, [t.planQty !== null && t.planQty !== undefined ? 'план ' + num(t.planQty) : '', t.who].filter(Boolean).join(' · ')))));
    }
    if (d.works.length) {
      sub('Сделано');
      d.works.forEach((x) => rows.push(h('button', { type: 'button', class: 'pp-line', onclick: () => doneForm(c, { entryId: x.id }) },
        h('span', null, x.title), h('small', null, [x.who, x.note].filter(Boolean).join(' · ')), h('strong', null, num(x.qty) + (x.unit ? ' ' + x.unit : '')))));
    }
    if (d.machines.length) {
      sub('Техника');
      d.machines.forEach((m) => rows.push(h('button', { type: 'button', class: 'pp-line', onclick: () => (m.entryId ? doneForm(c, { entryId: m.entryId }) : alert('Эта запись техники сделана в телефоне в старом виде — правьте её там.')) },
        h('span', null, m.title), h('small', null, m.minutes ? M.hm(m.minutes) : ''), h('strong', null, m.amountCents ? money(m.amountCents) : ''))));
    }
    if (d.people.length) {
      sub('Люди: ' + d.people.reduce((s, p) => s + (p.people || 0), 0));
      d.people.forEach((p) => rows.push(h('div', { class: 'pp-line' }, h('span', null, p.name), h('strong', null, p.people + ' чел.'))));
    }
    if (d.money.length) {
      sub('Финансы');
      d.money.forEach((f) => rows.push(h('button', { type: 'button', class: 'pp-line', onclick: () => financeForm(c, { id: f.id }) },
        h('span', null, f.title || typeName(f.type)), h('small', null, f.type === 'INCOME' ? 'поступление' : categoryName(f.category)), h('strong', { class: f.type === 'INCOME' ? 'pp-plus' : '' }, (f.type === 'INCOME' ? '+' : '−') + money(f.amountCents)))));
    }
    return h('section', { class: 'pp-card pp-day' },
      h('div', { class: 'pp-row pp-between pp-wrap' }, h('h2', null, dayTitle(d.day)),
        h('div', { class: 'pp-row' }, button('📄 Отчёт', () => reportDialog(c, d.day), 'pp-icon', 'Отчёт за день текстом'), button('+ Задача', () => taskForm(c, { date: d.day })), button('+ Сделано', () => doneForm(c, { date: d.day })))),
      rows);
  }

  function weatherText(wx) {
    const t = [wx.tMin, wx.tMax].every((v) => v !== null && v !== undefined) ? Math.round(wx.tMin) + '…' + Math.round(wx.tMax) + ' °C' : '';
    return 'Погода: ' + [t, wx.precip ? 'осадки ' + num(Math.round(wx.precip * 10) / 10) + ' мм' : '', wx.wind ? 'ветер до ' + Math.round(wx.wind) + ' м/с' : ''].filter(Boolean).join(', ');
  }

  function calendarView(w, c) {
    if (!w.month) { const t = new Date(today * 86400000); w.month = { y: t.getUTCFullYear(), m: t.getUTCMonth() }; }
    const first = Math.round(Date.UTC(w.month.y, w.month.m, 1) / 86400000);
    const last = Math.round(Date.UTC(w.month.y, w.month.m + 1, 0) / 86400000);
    const byDay = new Map(c.project.days(first, last).map((d) => [d.day, d]));
    const offset = (new Date(first * 86400000).getUTCDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(h('span', { class: 'pp-cal-empty' }));
    for (let d = first; d <= last; d++) {
      const x = byDay.get(d);
      const marks = [];
      if (x) {
        const open = x.tasks.filter((t) => !t.done).length;
        if (open) marks.push(h('i', { class: d < today ? 'pp-mark pp-late' : 'pp-mark pp-plan', title: 'В плане' }, '○' + open));
        if (x.works.length) marks.push(h('i', { class: 'pp-mark pp-done', title: 'Сделано' }, '✓' + x.works.length));
        if (x.machines.length) marks.push(h('i', { class: 'pp-mark', title: 'Техника' }, '🚜'));
        const ppl = x.people.reduce((s, p) => s + (p.people || 0), 0);
        if (ppl) marks.push(h('i', { class: 'pp-mark', title: 'Людей' }, '👷' + ppl));
      }
      if (!x || !x.machines.length) {
        // Нужная техника на будущее (план): вызовы на день
        if (c.project.rows('rental_calls').some((cl) => cl.date === d && cl.status !== 'CANCELLED')) marks.push(h('i', { class: 'pp-mark', title: 'Нужна техника' }, '🚜'));
      }
      cells.push(h('button', {
        type: 'button', class: 'pp-cal-day' + (d === today ? ' pp-today' : '') + (d === w.selected ? ' pp-selected' : ''),
        onclick: () => { w.selected = d; render(); }, ondblclick: () => doneForm(c, { date: Math.min(d, today) }),
      }, h('span', { class: 'pp-cal-num' }, String(d - first + 1)), h('span', { class: 'pp-cal-marks' }, marks)));
    }
    const shift = (k) => { const m = w.month.m + k; w.month = { y: w.month.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }; render(); };
    const sel = w.selected !== null && w.selected >= first && w.selected <= last ? (byDay.get(w.selected) || { day: w.selected, works: [], machines: [], people: [], tasks: [], money: [], weather: null }) : null;
    const calls = sel ? c.project.rows('rental_calls').filter((cl) => cl.date === sel.day && cl.status !== 'CANCELLED') : [];
    return h('main', null,
      h('div', { class: 'pp-row pp-between pp-wrap' },
        h('div', { class: 'pp-row' }, button('‹', () => shift(-1), 'pp-icon'), h('h2', null, cap(new Date(first * 86400000).toLocaleDateString('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' }))), button('›', () => shift(1), 'pp-icon'),
          button('Сегодня', () => { const t = new Date(today * 86400000); w.month = { y: t.getUTCFullYear(), m: t.getUTCMonth() }; w.selected = today; render(); })),
        h('span', { class: 'pp-muted' }, '○ план · ✓ сделано · 🚜 техника · 👷 люди')),
      h('div', { class: 'pp-cal' }, ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((t) => h('span', { class: 'pp-cal-head' }, t)), cells),
      sel ? h('div', null,
        calls.length ? h('section', { class: 'pp-card' }, h('h3', null, 'Нужна техника (план)'), calls.map((cl) => h('div', { class: 'pp-line' }, h('span', null, c.project.orderTitle(cl.orderId)), h('small', null, cl.comment || '')))) : null,
        dayCard(c, sel)) : null);
  }

  function boqView(w, c) {
    const rows = c.project.boq();
    const totalPlan = rows.filter((r) => r.plan).length;
    return h('main', null,
      h('div', { class: 'pp-row pp-between pp-wrap' },
        h('p', { class: 'pp-muted' }, 'Позиций: ' + rows.length + (totalPlan ? ' · с планом: ' + totalPlan : '') + '. Сделанное — сумма записей «Сделано». Нажмите на работу, чтобы изменить.'),
        button('+ Позиция', () => boqForm(c, null), 'pp-primary')),
      rows.length ? h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table' },
        h('thead', null, h('tr', null, ['Работа', 'План', 'Сделано', '%', 'Осталось', 'Срок', ''].map((t) => h('th', null, t)))),
        h('tbody', null, rows.map((r) => {
          const bar = h('span', { class: 'pp-bar-fill' + (r.percent >= 100 ? ' pp-full' : '') });
          bar.style.width = Math.max(0, Math.min(100, r.percent || 0)) + '%';
          const late = r.due && r.due < today && !r.finished && (r.remaining === null || r.remaining > 0);
          return h('tr', null,
            h('td', null, h('button', { type: 'button', class: 'pp-link', onclick: () => boqForm(c, r.id) }, r.name), r.work && r.work !== r.name ? h('small', null, r.work) : null, r.who ? h('small', null, r.who) : null),
            h('td', { class: 'pp-num' }, r.plan === null ? '—' : num(r.plan) + ' ' + r.unit),
            h('td', { class: 'pp-num' }, num(r.fact) + ' ' + r.unit),
            h('td', null, r.percent === null ? '' : h('span', { class: 'pp-progress' }, bar, h('span', null, num(r.percent) + '%'))),
            h('td', { class: 'pp-num' + (r.remaining !== null && r.remaining < 0 ? ' pp-plus' : '') }, r.remaining === null ? '' : num(r.remaining)),
            h('td', { class: late ? 'pp-error' : '' }, r.finished ? 'готово' : r.due ? shortDate(r.due) : ''),
            h('td', null, button('+ Сделано', () => doneForm(c, { date: today, itemId: r.id }))));
        })))) : h('p', { class: 'pp-card pp-muted' }, 'Ведомость пуста. Добавьте позиции кнопкой «+ Позиция» (или в приложении на телефоне).'));
  }

  const categoryName = (c) => (M.CATEGORIES.find(([k]) => k === c) || [null, 'Иное'])[1];
  const typeName = (t) => (M.TYPES.find(([k]) => k === t) || [null, 'Расход'])[1];

  function financeView(w, c) {
    const list = c.project.rows('finance').filter((f) => (w.period.from === null || f.date >= w.period.from) && (w.period.to === null || f.date <= w.period.to)).sort((a, b) => b.date - a.date || (b.createdAt || 0) - (a.createdAt || 0));
    const exp = list.filter((f) => f.type !== 'INCOME').reduce((s, f) => s + (f.amountCents || 0), 0);
    const inc = list.filter((f) => f.type === 'INCOME').reduce((s, f) => s + (f.amountCents || 0), 0);
    const byCat = {};
    list.filter((f) => f.type !== 'INCOME').forEach((f) => { byCat[f.category || 'OTHER'] = (byCat[f.category || 'OTHER'] || 0) + f.amountCents; });
    return h('main', null,
      h('div', { class: 'pp-row pp-between pp-wrap' }, periodBar(w), button('+ Запись', () => financeForm(c, {}), 'pp-primary')),
      h('section', { class: 'pp-card pp-row pp-wrap pp-totals' }, h('div', null, h('small', null, 'Расход'), h('strong', null, money(exp))), h('div', null, h('small', null, 'Поступления'), h('strong', { class: 'pp-plus' }, money(inc))), h('div', null, h('small', null, 'Разница'), h('strong', null, money(inc - exp)))),
      Object.keys(byCat).length ? h('section', { class: 'pp-card' }, h('h3', null, 'Расход по статьям'), Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('div', { class: 'pp-line' }, h('span', null, categoryName(k)), h('strong', null, money(v))))) : null,
      h('section', { class: 'pp-card' }, list.length ? list.map((f) => h('button', { type: 'button', class: 'pp-line', onclick: () => financeForm(c, { id: f.id }) },
        h('span', null, dayTitle(f.date) + ' — ' + (f.title || typeName(f.type))), h('small', null, (f.type === 'INCOME' ? 'поступление' : categoryName(f.category)) + (M.isAutoExpense(f.id) ? ' · из «Сделано»' : '')),
        h('strong', { class: f.type === 'INCOME' ? 'pp-plus' : '' }, (f.type === 'INCOME' ? '+' : '−') + money(f.amountCents)))) : h('p', { class: 'pp-muted' }, 'Записей нет.')));
  }

  function machinesView(w, c) {
    return h('main', { class: 'pp-columns' },
      h('section', { class: 'pp-card' }, h('div', { class: 'pp-row pp-between' }, h('h2', null, 'Техника'), button('+ Техника', () => equipmentForm(c, {}))),
        c.project.equipment(true).map((e) => h('button', { type: 'button', class: 'pp-line', onclick: () => equipmentForm(c, e) }, h('span', null, M.equipmentTitle(e) + (Number(e.archived) ? ' — в архиве' : '')), h('small', null, [e.supplier, e.phone].filter(Boolean).join(' · ')))),
        h('p', { class: 'pp-muted' }, 'Работа и оплата техники отмечаются в «Сделано», нужная в будущем — в «Задаче». Условия аренды — в телефоне.')),
      h('section', { class: 'pp-card' }, h('div', { class: 'pp-row pp-between' }, h('h2', null, 'Бригады'), button('+ Бригада', () => crewForm(c, {}))),
        c.project.crews(true).map((cr) => h('button', { type: 'button', class: 'pp-line', onclick: () => crewForm(c, cr) }, h('span', null, (cr.name || 'Бригада') + (Number(cr.archived) ? ' — в архиве' : '')))),
        h('p', { class: 'pp-muted' }, 'Сколько людей было — отмечается в «Сделано».')));
  }

  // ───────── замечания ─────────
  function remarksView(w, c) {
    const P = c.project;
    const names = P.names();
    w.remarkFilter = w.remarkFilter || 'open';
    // Как в телефоне: пометки с чертежей тоже в журнале замечаний («Ч№»)
    const drawingNames = Object.fromEntries(P.drawings().map((d) => [d.id, d.name]));
    const notes = P.rows('drawing_notes').filter((n) => drawingNames[n.drawingId] !== undefined).map((n) => ({
      id: n.id, isNote: true, number: n.number, text: n.text, status: n.status === 'DONE' ? 'DONE' : 'OPEN', dueDate: n.dueDate, contractorId: n.contractorId,
      date: Math.floor(((n.createdAt || 0) - new Date().getTimezoneOffset() * 60000) / 86400000), place: '📐 ' + drawingNames[n.drawingId], drawingId: n.drawingId, problem: n.status === 'PROBLEM',
    }));
    const all = P.remarks().concat(notes.sort((a, b) => b.date - a.date));
    const list = w.remarkFilter === 'open' ? all.filter((r) => r.status !== 'DONE') : all;
    return h('main', null,
      h('div', { class: 'pp-row pp-between pp-wrap' },
        h('div', { class: 'pp-row' }, button('Открытые (' + all.filter((r) => r.status !== 'DONE').length + ')', () => { w.remarkFilter = 'open'; render(); }, w.remarkFilter === 'open' ? 'pp-primary' : ''),
          button('Все (' + all.length + ')', () => { w.remarkFilter = 'all'; render(); }, w.remarkFilter === 'all' ? 'pp-primary' : '')),
        button('+ Замечание', () => remarkForm(c, null), 'pp-primary')),
      list.length ? h('section', { class: 'pp-card' }, list.map((r) => {
        const late = r.status !== 'DONE' && r.dueDate && r.dueDate < today;
        const photos = P.attachmentsOf(r.id).length;
        return h('button', { type: 'button', class: 'pp-line', onclick: () => (r.isNote ? openDrawing(c, r.drawingId, { noteId: r.id }) : remarkForm(c, r.id)) },
          h('span', null, (r.isNote ? 'Ч№' : '№') + r.number + ' — ' + (r.problem ? '❗ ' : '') + (r.text || 'без текста')),
          h('small', null, [dayTitle(r.date), r.place, names.contractors[r.contractorId], r.dueDate ? 'срок ' + shortDate(r.dueDate) : '', photos ? '📷 ' + photos : ''].filter(Boolean).join(' · ')),
          h('strong', { class: r.status === 'DONE' ? 'pp-plus' : late ? 'pp-error' : '' }, r.status === 'DONE' ? 'устранено' : late ? 'просрочено' : 'открыто'));
      })) : h('p', { class: 'pp-card pp-muted' }, w.remarkFilter === 'open' ? 'Открытых замечаний нет.' : 'Замечаний нет.'));
  }

  function remarkForm(c, id, opts) {
    opts = opts || {};
    const P = c.project;
    const r = id ? P.get('remarks', id) : null;
    const dateIn = h('input', { type: 'date', value: dayToInput(r ? r.date : today), required: true });
    const text = h('textarea', { rows: 3 }, r ? r.text : '');
    const place = h('input', { value: r ? r.place : '', placeholder: 'Ось А, Ф1–Ф6' });
    const who = selectAdd(P.rows('contractors').map((x) => ({ id: x.id, name: x.name })), r && r.contractorId, 'Не указан', 'Новый исполнитель', (n) => P.addNamed('contractors', n));
    const due = h('input', { type: 'date', value: r && r.dueDate ? dayToInput(r.dueDate) : '' });
    const photos = photoBox(c, r ? r.id : null, 'Фото замечания');
    const done = h('input', { type: 'checkbox' }); done.checked = !!(r && r.status === 'DONE');
    const doneNote = h('input', { value: r ? r.doneNote || '' : '', placeholder: 'Что сделано' });
    const donePhotos = r ? photoBox(c, r.id + ':done', 'Фото после устранения') : null;
    modal(c, r ? 'Замечание №' + r.number : 'Новое замечание', h('div', null,
      h('div', { class: 'pp-row pp-wrap' }, field('Дата', dateIn), field('Срок устранения', due, 'необязательно')),
      field('Замечание', text), h('div', { class: 'pp-row pp-wrap' }, field('Место', place), field('Кто устраняет', who)),
      photos.el,
      r ? h('div', null, h('h3', null, 'Устранение'), h('label', { class: 'pp-check' }, done, ' Устранено'), field('Комментарий', doneNote), donePhotos.el) : null,
      r ? h('div', { class: 'pp-row pp-wrap pp-between' }, h('small', { class: 'pp-muted' }, 'На чертеже замечание станет пометкой с теми же фото.'),
        button('📍 Поставить на чертёж', () => {
          document.querySelector('.pp-modal').remove();
          pickDrawing(c, (drawingId) => openDrawing(c, drawingId, { place: { kind: 'remark', remarkId: r.id, title: 'Замечание №' + r.number } }));
        })) : null), () => {
      const day = inputToDay(dateIn.value);
      if (day === null) bad('Укажите дату');
      if (!text.value.trim()) bad('Опишите замечание');
      if (photos.busy() || (donePhotos && donePhotos.busy())) bad('Подождите — фото ещё загружаются');
      const saved = P.saveRemark({ id: r ? r.id : null, acceptanceId: opts.acceptanceId || null, date: day, text: text.value.trim(), place: place.value.trim(), contractorId: who.value && who.value !== '__add' ? who.value : null, dueDate: due.value ? inputToDay(due.value) : null });
      photos.commit(saved.id);
      if (r) {
        if (done.checked !== (r.status === 'DONE') || (done.checked && doneNote.value.trim() !== (r.doneNote || ''))) P.setRemarkDone(r.id, done.checked, doneNote.value.trim(), r.doneDate || today);
        donePhotos.commit(r.id + ':done');
      }
    }, r ? { text: 'Удалить', run: () => { if (!confirm('Удалить замечание №' + r.number + '?')) return false; P.deleteRemark(r.id); } } : null);
  }

  // ───────── карточка объекта ─────────
  function cardView(w, c) {
    const P = c.project, p = P.project;
    const row = (label, value) => h('div', { class: 'pp-line' }, h('span', null, label), h('strong', { class: value ? '' : 'pp-muted' }, value || '—'));
    const fields = P.fields();
    return h('main', null,
      h('div', { class: 'pp-row pp-between pp-wrap' }, h('h2', null, p.name || 'Объект'), button('✎ Изменить карточку', () => cardForm(c), 'pp-primary')),
      h('section', { class: 'pp-card' }, h('h3', null, 'Объект'), row('Название', p.name), row('Адрес', p.address)),
      h('section', { class: 'pp-card' }, h('h3', null, 'Участники'), row('Заказчик', p.customer), row('Технадзор', p.supervisor), row('Исполнитель (генподрядчик)', p.contractor),
        h('small', { class: 'pp-muted' }, 'Подставляются в документы как {ЗАКАЗЧИК}, {ТЕХНАДЗОР}, {ИСПОЛНИТЕЛЬ}.')),
      h('section', { class: 'pp-card' }, h('h3', null, 'Сроки'), row('Начало работ', p.startDate ? shortDate(p.startDate) : ''), row('Сдача объекта', p.deadline ? shortDate(p.deadline) : ''),
        p.deadline ? h('small', { class: 'pp-muted' }, p.deadline >= today ? 'До сдачи дней: ' + (p.deadline - today) : 'Срок сдачи прошёл ' + (today - p.deadline) + ' дн. назад') : null),
      h('section', { class: 'pp-card' }, h('h3', null, 'Погода'), row('Место', p.place ? '📍 ' + p.place : ''),
        h('small', { class: 'pp-muted' }, 'По месту телефон подставляет погоду в журнал.')),
      h('section', { class: 'pp-card' }, h('h3', null, 'Свои поля'), fields.length ? fields.map((f) => row(f.name || 'Без названия', f.value)) : h('p', { class: 'pp-muted' }, 'Нет. Например «Номер договора» — в шаблоне документа {НОМЕР ДОГОВОРА}.')),
      h('section', { class: 'pp-card' }, h('h3', null, 'Папка на Диске'), h('div', { class: 'pp-row pp-between pp-wrap' }, h('span', null, w.folder),
        button('Открыть на Диске', () => window.open(D.webFolder(w.folder), '_blank', 'noopener')))));
  }

  /** Найти место по адресу: OpenStreetMap, затем город (Open-Meteo) — как в телефоне. */
  async function geocode(address) {
    const q = String(address || '').trim();
    if (!q) return null;
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'json', limit: '1', 'accept-language': 'ru' }));
      const j = r.ok ? await r.json() : [];
      if (j[0] && Number.isFinite(parseFloat(j[0].lat))) return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), label: String(j[0].display_name || '').split(',').slice(0, 3).join(',').trim() };
    } catch (e) { /* попробуем по городу */ }
    const parts = q.split(/[,;]/).map((s) => s.trim().replace(/^(г\.?|город|пос\.?|пгт|с\.|д\.)\s*/i, '')).filter((s) => s.length >= 2 && !/\d/.test(s));
    for (const part of parts) {
      try {
        const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: part, count: '1', language: 'ru' }));
        const o = r.ok ? ((await r.json()).results || [])[0] : null;
        if (o) return { lat: o.latitude, lon: o.longitude, label: [o.name, o.admin1].filter(Boolean).join(', ') };
      } catch (e) { /* следующая часть адреса */ }
    }
    return null;
  }

  function cardForm(c, opts) {
    opts = opts || {};
    const P = c.project, p = P.project;
    const input = (v, ph) => h('input', { value: v || '', placeholder: ph || '' });
    const name = input(p.name), address = h('textarea', { rows: 2 }, p.address || '');
    const customer = input(p.customer), supervisor = input(p.supervisor), contractor = input(p.contractor);
    const start = h('input', { type: 'date', value: p.startDate ? dayToInput(p.startDate) : '' });
    const deadline = h('input', { type: 'date', value: p.deadline ? dayToInput(p.deadline) : '' });
    let place = { lat: p.lat, lon: p.lon, label: p.place };
    const placeText = h('strong', null);
    const showPlace = (msg) => { placeText.textContent = msg || (place.label ? '📍 ' + place.label : 'Место не задано'); };
    showPlace();
    const byAddress = button('По адресу', async () => {
      showPlace('Ищу место…');
      const r = await geocode(address.value);
      if (!r) { showPlace(); alert('Не нашёл это место. Проверьте адрес или нажмите «Где я сейчас».'); return; }
      place = r; showPlace();
    });
    const here = button('Где я сейчас', () => {
      if (!navigator.geolocation) return alert('Браузер не умеет определять место');
      showPlace('Определяю место…');
      navigator.geolocation.getCurrentPosition((pos) => {
        place = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Место ' + pos.coords.latitude.toFixed(4) + ', ' + pos.coords.longitude.toFixed(4) };
        showPlace();
      }, () => { showPlace(); alert('Браузер не дал определить место'); }, { timeout: 15000 });
    });
    // Свои поля: правка, добавление, удаление — применяются при «Сохранить»
    const rows = P.fields().map((f) => ({ id: f.id, name: f.name, value: f.value, gone: false }));
    const list = h('div', { class: 'pp-list' });
    const drawFields = () => {
      list.replaceChildren(...rows.filter((r) => !r.gone).map((r) => {
        const n = h('input', { value: r.name, placeholder: 'Название поля' });
        const v = h('input', { value: r.value, placeholder: 'Значение' });
        n.addEventListener('input', () => { r.name = n.value; });
        v.addEventListener('input', () => { r.value = v.value; });
        return h('div', { class: 'pp-row' }, n, v, button('✕', () => { r.gone = true; drawFields(); }, 'pp-icon', 'Удалить поле'));
      }));
    };
    drawFields();
    modal(c, opts.title || 'Карточка объекта', h('div', null,
      opts.note ? h('p', { class: 'pp-muted' }, opts.note) : null,
      field('Название', name), field('Адрес', address),
      h('h3', null, 'Участники'),
      field('Заказчик', customer), field('Технадзор', supervisor), field('Исполнитель (генподрядчик)', contractor),
      h('h3', null, 'Сроки'), h('div', { class: 'pp-row pp-wrap' }, field('Начало работ', start), field('Сдача объекта', deadline)),
      h('h3', null, 'Погода'), h('div', { class: 'pp-row pp-wrap pp-between' }, placeText, h('div', { class: 'pp-row' }, byAddress, here)),
      h('small', { class: 'pp-muted' }, 'Погода по дням подставляется в журнал на телефоне (сервис Open-Meteo). Место достаточно указать один раз.'),
      h('h3', null, 'Свои поля'), list,
      button('+ Добавить поле', () => { rows.push({ id: null, name: '', value: '', gone: false }); drawFields(); }),
      h('small', { class: 'pp-muted' }, 'Например «Номер договора». В шаблоне документа метка — название поля в фигурных скобках: {НОМЕР ДОГОВОРА}.')), () => {
      if (!name.value.trim()) bad('Укажите название объекта');
      const s = start.value ? inputToDay(start.value) : null, dl = deadline.value ? inputToDay(deadline.value) : null;
      if (s !== null && dl !== null && dl < s) bad('Сдача объекта раньше начала работ');
      P.saveCard({
        name: name.value, address: address.value, customer: customer.value, supervisor: supervisor.value, contractor: contractor.value,
        startDate: s, deadline: dl, lat: place.lat === undefined ? null : place.lat, lon: place.lon === undefined ? null : place.lon, place: place.label || null,
      });
      rows.forEach((r) => {
        if (r.gone) { if (r.id) P.deleteField(r.id); return; }
        if (!r.id && !r.name.trim() && !r.value.trim()) return;
        P.saveField(r);
      });
      const names = store.json('names', {}); names[c.path] = P.project.name; store.set('names', JSON.stringify(names));
      if (projects) projects.forEach((x) => { if (x.path === c.path) x.name = P.project.name; });
    });
  }

  // ───────── справочники ─────────
  const CATALOG = window.PRORAB_CATALOG || { work: [], units: [] };
  function dirsView(w, c) {
    const P = c.project;
    w.tab = w.tab || 'contractors';
    const tabs = [['contractors', 'Исполнители'], ['work_types', 'Виды работ'], ['units', 'Единицы']];
    let body;
    if (w.tab === 'contractors') {
      const list = P.contractors();
      body = h('section', { class: 'pp-card' },
        h('div', { class: 'pp-row pp-between' }, h('h3', null, 'Исполнители'), button('+ Исполнитель', () => contractorForm(c, null), 'pp-primary')),
        list.length ? list.map((x) => h('button', { type: 'button', class: 'pp-line', onclick: () => contractorForm(c, x) },
          h('span', null, x.name || 'Без имени'), h('small', null, [x.specialty, x.phone, x.email].filter(Boolean).join(' · ')))) : h('p', { class: 'pp-muted' }, 'Пока никого нет.'),
        h('small', { class: 'pp-muted' }, 'Бригады, субподрядчики, поставщики. Нажмите, чтобы изменить.'));
    } else {
      const table = w.tab, isWork = table === 'work_types';
      const list = P.named(table);
      body = h('section', { class: 'pp-card' },
        h('div', { class: 'pp-row pp-between pp-wrap' }, h('h3', null, isWork ? 'Виды работ' : 'Единицы измерения'),
          h('div', { class: 'pp-row' }, button('Из каталога', () => catalogDialog(c, table)), button(isWork ? '+ Вид работ' : '+ Единица', () => namedForm(c, table, null), 'pp-primary'))),
        list.length ? list.map((x) => h('button', { type: 'button', class: 'pp-line', onclick: () => namedForm(c, table, x) }, h('span', null, x.name))) : h('p', { class: 'pp-muted' }, 'Пусто.'),
        isWork ? h('small', { class: 'pp-muted' }, 'Например «Монтаж бытовок», «Кладка стен 1 этажа». Используются в журнале и финансах.') : null);
    }
    return h('main', null, h('div', { class: 'pp-tabs' }, tabs.map(([k, t]) => h('button', { type: 'button', class: 'pp-tab' + (w.tab === k ? ' pp-active' : ''), onclick: () => { w.tab = k; render(); } }, t))), body);
  }

  function contractorForm(c, x) {
    const P = c.project;
    const inp = (v, attrs) => h('input', Object.assign({ value: v || '' }, attrs || {}));
    const name = inp(x && x.name), spec = inp(x && x.specialty), phone = inp(x && x.phone, { type: 'tel' }), email = inp(x && x.email, { type: 'email' });
    const note = h('textarea', { rows: 2 }, (x && x.note) || '');
    modal(c, x ? 'Исполнитель' : 'Новый исполнитель', h('div', null,
      field('Имя / организация', name), field('Специализация', spec), h('div', { class: 'pp-row pp-wrap' }, field('Телефон', phone), field('Почта', email)), field('Заметка', note)), () => {
      P.saveContractor({ id: x ? x.id : null, name: name.value, specialty: spec.value, phone: phone.value, email: email.value, note: note.value });
    }, x ? { text: 'Удалить', run: () => { if (!confirm('Удалить исполнителя? Старые записи журнала и финансов сохранятся, но без имени исполнителя.')) return false; P.deleteContractor(x.id); } } : null);
  }

  function namedForm(c, table, x) {
    const P = c.project;
    const name = h('input', { value: x ? x.name : '' });
    const what = table === 'units' ? 'Единица измерения' : 'Вид работ';
    modal(c, x ? what : (table === 'units' ? 'Новая единица' : 'Новый вид работ'), field('Название', name), () => {
      if (x) P.renameNamed(table, x.id, name.value);
      else if (!P.addNamed(table, name.value)) bad('Укажите название');
    }, x ? { text: 'Удалить', run: () => { if (!confirm('Удалить «' + x.name + '»?')) return false; P.deleteNamed(table, x.id); } } : null);
  }

  function catalogDialog(c, table) {
    const P = c.project;
    const have = new Set(P.rows(table).map((r) => String(r.name || '').trim().toLowerCase()));
    const groups = table === 'units' ? [[null, CATALOG.units]] : CATALOG.work;
    const boxes = [];
    const body = h('div', { class: 'pp-catalog' }, groups.map(([g, names]) => h('div', null, g ? h('h3', null, g) : null,
      names.map((n) => {
        const b = h('input', { type: 'checkbox' });
        if (have.has(n.toLowerCase())) { b.checked = true; b.disabled = true; } else boxes.push([b, n]);
        return h('label', { class: 'pp-check' }, b, ' ' + n + (b.disabled ? ' — уже есть' : ''));
      }))));
    modal(c, table === 'units' ? 'Единицы из каталога' : 'Виды работ из каталога', body, () => {
      const pick = boxes.filter(([b]) => b.checked).map(([, n]) => n);
      if (!pick.length) bad('Отметьте, что добавить');
      setStatus('Добавлено: ' + P.addMany(table, pick));
    });
  }

  // ───────── чертежи ─────────
  const NOTE_NAMES = Object.fromEntries(M.NOTE_STATUS.map(([k, t]) => [k, t]));
  function drawingsView(w, c) {
    const P = c.project;
    const list = P.drawings();
    const notes = P.rows('drawing_notes');
    const pick = h('input', { type: 'file', accept: '.pdf,.dxf,.dwg,application/pdf,image/vnd.dwg', multiple: true, class: 'pp-hidden' });
    pick.addEventListener('change', async () => { const files = Array.from(pick.files); pick.value = ''; for (const f of files) await addDrawing(c, f); });
    const problems = notes.filter((n) => n.status === 'PROBLEM');
    const names = Object.fromEntries(list.map((d) => [d.id, d.name]));
    return h('main', null,
      h('div', { class: 'pp-row pp-between pp-wrap' }, h('p', { class: 'pp-muted' }, 'PDF, DXF и DWG открываются прямо здесь, с пометками. DWG переводится в DXF, как в телефоне.'),
        button(w.busy ? 'Загружаю…' : '+ Добавить чертёж', () => { if (!w.busy) pick.click(); }, 'pp-primary'), pick),
      list.length ? h('section', { class: 'pp-card' }, list.map((d) => {
        const ns = notes.filter((n) => n.drawingId === d.id);
        const views = P.viewsOf(d.id);
        return h('div', null,
          h('div', { class: 'pp-line pp-drawing' },
            h('span', null, h('button', { type: 'button', class: 'pp-link', onclick: () => openDrawing(c, d.id) }, (d.kind === 'pdf' ? '📕 ' : '📐 ') + (d.name || 'Чертёж'))),
            h('small', null, [d.kind === 'pdf' ? 'PDF' + (d.pages > 1 ? ', листов: ' + d.pages : '') : 'DXF', ns.length ? 'пометок: ' + ns.length : '',
              ns.filter((n) => n.status === 'PROBLEM').length ? 'проблем: ' + ns.filter((n) => n.status === 'PROBLEM').length : '',
              ns.filter((n) => n.status === 'NOTE').length ? 'замечаний: ' + ns.filter((n) => n.status === 'NOTE').length : ''].filter(Boolean).join(' · ')),
            h('strong', null, h('span', { class: 'pp-row' }, button('Открыть', () => openDrawing(c, d.id)), button('⋯', (e) => drawingMenu(e.clientX, e.clientY, c, d), 'pp-icon', 'Ещё')))),
          views.map((v) => h('button', { type: 'button', class: 'pp-line pp-sub', onclick: () => openDrawing(c, d.id, { viewId: v.id }) },
            h('span', null, '📍 ' + (v.name || 'Вид')), h('small', null, d.kind === 'pdf' ? 'лист ' + ((v.page || 0) + 1) : 'свои слои'))));
      })) : h('p', { class: 'pp-card pp-muted' }, 'Чертежей пока нет. Нажмите «+ Добавить чертёж».'),
      problems.length ? h('section', { class: 'pp-card' }, h('h3', null, 'Проблемы (' + problems.length + ')'),
        problems.slice(0, 50).map((n) => h('button', { type: 'button', class: 'pp-line', onclick: () => openDrawing(c, n.drawingId, { noteId: n.id }) },
          h('span', null, '№' + n.number + '. ' + (n.text || 'Без текста')), h('small', null, names[n.drawingId] || '')))) : null);
  }

  function drawingMenu(x, y, c, d) {
    const P = c.project;
    popup(x, y, [
      ['Открыть', () => openDrawing(c, d.id)],
      ['Переименовать', () => { const n = (prompt('Название чертежа', d.name) || '').trim(); if (n) { P.renameDrawing(d.id, n); changed(c); } }],
      ['Скачать файл', async () => { try { window.open(await disk.downloadHref(c.path + '/files/' + d.file), '_blank', 'noopener'); } catch (e) { alert(e.message); } }],
      ['-'],
      ['Удалить чертёж', () => { if (!confirm('Удалить чертёж «' + d.name + '» из объекта?')) return; P.deleteDrawing(d.id); changed(c); }],
    ]);
  }

  // pdf.js (Mozilla) — загружается только при открытии PDF
  let pdfjs = null;
  function loadPdfJs() {
    if (!pdfjs) {
      pdfjs = import(app.dataset.pdfjs || '/static/prorab/vendor/pdf.min.js').then((m) => {
        m.GlobalWorkerOptions.workerSrc = app.dataset.pdfjsWorker || '/static/prorab/vendor/pdf.worker.min.js';
        return m;
      }, (e) => { pdfjs = null; throw new Error('Не загрузился модуль просмотра PDF: ' + e.message); });
    }
    return pdfjs;
  }
  async function openPdf(bytes) {
    const m = await loadPdfJs();
    return m.getDocument({ data: bytes, isEvalSupported: false }).promise;
  }

  // LibreDWG (та же, что в телефоне) — переводит DWG в DXF прямо в браузере; загружается только для DWG
  let dwgLib = null;
  function loadDwg() {
    if (!dwgLib) {
      dwgLib = import(app.dataset.dwg || '/static/prorab/vendor/libredwg/libredwg-web.js').then((m) => m.default())
        .catch((e) => { dwgLib = null; throw new Error('Не загрузился модуль перевода DWG: ' + e.message); });
    }
    return dwgLib;
  }
  /** DWG (байты) → DXF (байты). В приложении DWG тоже хранится как DXF. */
  async function dwgToDxf(bytes) {
    const m = await loadDwg();
    await new Promise((r) => setTimeout(r, 30)); // дать браузеру показать «Перевожу…»
    const inp = 'in' + Date.now() + '.dwg', out = inp.replace('.dwg', '.dxf');
    const exists = (f) => { try { return m.FS.analyzePath(f, false).exists; } catch (e) { return false; } };
    try {
      m.FS.writeFile(inp, bytes);
      const code = m.dwg_write_dxf(inp, out);
      const dxf = exists(out) ? m.FS.readFile(out) : null;
      if (!dxf || dxf.length < 100) throw new Error('Не получилось открыть DWG: файл повреждён или версия DWG не поддерживается' + (code ? ' (код ' + code + ')' : '') + '. Можно сохранить чертёж как DXF или PDF.');
      return dxf;
    } catch (e) {
      if (e instanceof WebAssembly.RuntimeError) { dwgLib = null; throw new Error('Не получилось открыть DWG: конвертер не справился с этим файлом. Можно сохранить чертёж как DXF или PDF.'); }
      throw e;
    } finally {
      [inp, out].forEach((f) => { if (exists(f)) { try { m.FS.unlink(f); } catch (e) { /* уже нет */ } } });
    }
  }
  /** Байты чертежа → { kind: 'pdf'|'dxf', bytes, pages }; DWG переводится в DXF. Проверяет, что файл открывается. */
  async function prepareDrawing(name, bytes) {
    let kind = window.ProrabDxf.kindOf(name, bytes);
    if (kind !== 'pdf' && kind !== 'dxf' && kind !== 'dwg') throw new Error('Не понял тип файла. Поддерживаются PDF, DXF и DWG.');
    if (kind === 'dwg') {
      setStatus('Перевожу DWG в DXF — ' + name + '…');
      bytes = await dwgToDxf(bytes);
      kind = 'dxf';
    }
    let pages = 1;
    if (kind === 'pdf') { const doc = await openPdf(bytes.slice()); pages = doc.numPages; doc.destroy(); } else window.ProrabDxf.parse(bytes);
    return { kind, bytes, pages };
  }

  async function addDrawing(c, file) {
    const P = c.project;
    const w = wins.find((x) => x.kind === 'drawings' && x.folder === c.path);
    try {
      if (w) { w.busy = true; render(); }
      setStatus('Проверяю чертёж ' + file.name + '…');
      const src = new Uint8Array(await file.arrayBuffer());
      const { kind, bytes, pages } = await prepareDrawing(file.name, src);
      const id = S.newId(), name = file.name.replace(/\.[^.]+$/, '');
      const target = c.path + '/files/' + id + '.' + kind;
      setStatus('Загружаю ' + file.name + ' на Диск…');
      await disk.mkdir(c.path + '/files');
      await disk.putBlob(target, bytes === src ? file : new Blob([bytes]), false);
      await fixFile(c, id + '.' + kind, bytes);
      bytesCache[target] = Promise.resolve(bytes.slice().buffer);
      P.addDrawing({ id, name, kind, file: id + '.' + kind, pages });
      changed(c);
      setStatus('Чертёж «' + name + '» добавлен — придёт на телефон при синхронизации');
      openDrawing(c, id);
    } catch (e) { alert(file.name + ': ' + e.message); setStatus(''); }
    finally { if (w) { w.busy = false; render(); } }
  }

  const bytesCache = {};
  const DRAWING_EXT = ['pdf', 'dxf', 'dwg'];
  /** Объект, в папке которого лежит файл. */
  const projectOfPath = (full) => (projects || []).find((p) => full.startsWith(p.path + '/')) || null;
  /** Объект, загруженный полностью (для действий из проводника и с рабочего стола). */
  const ctxReady = (path) => new Promise((resolve, reject) => {
    const c = openCtx(path);
    const t = setInterval(() => { if (!c.loading) { clearInterval(t); if (c.project) resolve(c); else reject(new Error(c.error || 'Объект не загрузился')); } }, 150);
  });

  /**
   * Файл PDF/DXF из папки Диска — чертёж объекта: если его копия уже есть в объекте (тот же файл по md5) — она,
   * иначе файл копируется в «<объект>/files/» (как у телефона) и добавляется в «Чертежи». Пометки — как у любого чертежа.
   */
  async function drawingFromFile(c, full, item) {
    const P = c.project;
    const list = P.drawings();
    const own = list.find((d) => c.path + '/files/' + d.file === full);
    if (own) return own.id;
    const name = item.name.replace(/\.[^.]+$/, '');
    // DWG хранится переведённым в DXF — его копию узнаём по названию
    if (ext(item.name) === 'dwg') { const same = list.find((d) => d.kind === 'dxf' && d.name === name); if (same) return same.id; }
    if (list.length) {
      // Тот же файл уже добавлен: по контрольной сумме Диска, а без неё — по названию и размеру
      const files = Object.fromEntries(((await disk.list(c.path + '/files')) || []).map((f) => [f.name, f]));
      const same = list.find((d) => {
        const f = files[d.file];
        if (!f) return false;
        if (item.md5 && f.md5) return f.md5 === item.md5;
        return d.name === name && item.size !== undefined && f.size === item.size;
      });
      if (same) return same.id;
    }
    setStatus('Проверяю чертёж ' + item.name + '…');
    const buf = await disk.getBytes(full);
    if (!buf) throw new Error('Файл не найден на Диске');
    const src = new Uint8Array(buf);
    const { kind, bytes, pages } = await prepareDrawing(item.name, src);
    const id = S.newId(), file = id + '.' + kind, target = c.path + '/files/' + file;
    setStatus('Добавляю чертёж в объект…');
    await disk.mkdir(c.path + '/files');
    if (bytes === src) { try { await disk.copy(full, target); } catch (e) { await disk.putBlob(target, new Blob([bytes]), false); } }
    else await disk.putBlob(target, new Blob([bytes]), false);
    await fixFile(c, file, bytes);
    bytesCache[target] = Promise.resolve(bytes === src ? buf : bytes.slice().buffer);
    P.addDrawing({ id, name, kind, file, pages });
    changed(c);
    setStatus('Чертёж «' + name + '» добавлен в объект «' + projName(c.path) + '» — придёт на телефон при синхронизации');
    return id;
  }

  async function openDrawingFile(full, item, projPath) {
    try {
      const c = await ctxReady(projPath);
      openDrawing(c, await drawingFromFile(c, full, item));
    } catch (e) { alert(item.name + ': ' + e.message); setStatus(''); }
  }

  /** Чертёж не из папки объекта: в какой объект добавить (для пометок) или только посмотреть. */
  function drawingFileDialog(full, item) {
    const list = projects || [];
    const sel = h('select', null, list.map((p) => h('option', { value: p.path }, p.name)));
    const mine = projectOfPath(full);
    if (mine) sel.value = mine.path;
    const close = () => wrap.remove();
    const wrap = h('div', { class: 'pp-modal', onclick: (e) => { if (e.target === wrap) close(); } },
      h('div', { class: 'pp-dialog' },
        h('div', { class: 'pp-row pp-between' }, h('h2', null, '📐 ' + item.name), button('✕', close, 'pp-icon')),
        list.length ? h('div', null, field('Объект', sel, 'Пометки на чертеже принадлежат объекту: файл скопируется в его «Чертежи» и придёт на телефон. Сам файл останется на месте.'),
          button('Открыть с пометками', () => { close(); openDrawingFile(full, item, sel.value); }, 'pp-primary')) :
          h('p', { class: 'pp-muted' }, 'Объектов нет — можно только посмотреть.'),
        h('div', { class: 'pp-row pp-wrap' }, button('Только посмотреть', () => { close(); openWindow('fileview', null, { path: full, title: item.name }); }),
          ext(item.name) === 'pdf' ? button('В Яндекс Документах', () => { close(); window.open(D.webEdit(full), '_blank', 'noopener'); }) : null)));
    document.body.append(wrap);
  }

  /** Просмотр чертежа из папки Диска без пометок. */
  function fileView(w) {
    const kind = ext(w.path) === 'pdf' ? 'pdf' : 'dxf';
    if (!w.load) {
      w.load = { state: 'loading' };
      (async () => {
        try {
          const buf = await fileBytes(w.path);
          if (kind === 'pdf') w.pdf = await openPdf(new Uint8Array(buf).slice());
          else { w.dxf = window.ProrabDxf.parse(ext(w.path) === 'dwg' ? await dwgToDxf(new Uint8Array(buf)) : new Uint8Array(buf)); setStatus(''); w.hidden = new Set(Object.values(w.dxf.layers).filter((l) => !l.visible).map((l) => l.name)); }
          w.load = { state: 'ready' };
        } catch (e) { w.load = { state: 'error', error: e.message }; }
        if (!modalOpen()) render();
      })();
    }
    if (w.load.state === 'loading') return h('p', { class: 'pp-muted' }, 'Загружаю чертёж с Диска…');
    if (w.load.state === 'error') return h('div', null, h('p', { class: 'pp-error' }, w.load.error), button('Повторить', () => { w.load = null; render(); }));
    if (!w.host) {
      w.host = h('div', { class: 'pp-plan' });
      w.viewer = window.ProrabViewer.create(w.host, { kind, dxf: w.dxf, pdf: w.pdf, hidden: w.hidden, notes: [],
        onChange: () => { const el = document.querySelector('.pp-win[data-key="' + CSS.escape(w.key) + '"] .pp-plan-page'); if (el && w.viewer) el.textContent = (w.viewer.page + 1) + ' / ' + w.viewer.pageCount; } });
    }
    const item = { name: lastName(w.path), md5: null };
    return h('div', { class: 'pp-planwrap' },
      h('div', { class: 'pp-row pp-wrap pp-plan-bar' },
        button('📍 Ставить пометки', () => drawingFileDialog(w.path, item), 'pp-primary', 'Добавить чертёж в объект — тогда на нём можно ставить пометки'),
        button('⤢', () => w.viewer.fit(), 'pp-icon', 'Весь чертёж'), button('−', () => w.viewer.zoom(1 / 1.5), 'pp-icon', 'Дальше'), button('+', () => w.viewer.zoom(1.5), 'pp-icon', 'Ближе'),
        w.pdf && w.pdf.numPages > 1 ? h('span', { class: 'pp-row' }, button('‹', () => w.viewer.setPage(w.viewer.page - 1), 'pp-icon', 'Предыдущий лист'),
          h('span', { class: 'pp-plan-page' }, (w.viewer.page + 1) + ' / ' + w.pdf.numPages), button('›', () => w.viewer.setPage(w.viewer.page + 1), 'pp-icon', 'Следующий лист')) : null,
        w.dxf ? button('Слои', () => layersDialog(w)) : null,
        h('small', { class: 'pp-muted' }, 'Просмотр без пометок')),
      h('div', { class: 'pp-plan-main' }, w.host));
  }
  function fileBytes(path) {
    if (!bytesCache[path]) bytesCache[path] = disk.getBytes(path).then((b) => { if (!b) throw new Error('Файла чертежа ещё нет на Диске — синхронизируйте телефон, с которого его добавили.'); return b; }).catch((e) => { delete bytesCache[path]; throw e; });
    return bytesCache[path];
  }

  function openDrawing(c, id, opts) {
    const w = openWindow('drawing', c.path, { path: id });
    opts = opts || {};
    if (opts.noteId) { w.focusNote = opts.noteId; if (w.viewer) { const n = c.project.get('drawing_notes', opts.noteId); if (n) w.viewer.focus(n); } }
    if (opts.viewId) { w.pendingView = opts.viewId; if (w.viewer) applyPlanView(w, c, opts.viewId); }
    if (opts.place) {
      // Постановка замечания или доп. работы: следующий щелчок по чертежу ставит точку
      w.placeFor = opts.place; w.placing = true;
      if (w.viewer) w.viewer.setMode('place');
      setStatus('Щёлкните по месту на чертеже: ' + opts.place.title);
      render();
    }
    return w;
  }

  function applyPlanView(w, c, viewId) {
    const v = viewId ? c.project.get('drawing_views', viewId) : null;
    w.viewId = v ? v.id : null;
    if (w.dxf) {
      w.hidden = new Set(v && v.hiddenLayers !== null && v.hiddenLayers !== undefined ? String(v.hiddenLayers).split('\n').filter(Boolean) : Object.values(w.dxf.layers).filter((l) => !l.visible).map((l) => l.name));
      w.viewer.setHidden(w.hidden);
    }
    w.viewer.applyView(v || { page: w.viewer.page }).then(() => render());
  }

  async function loadDrawing(w, c) {
    const d = c.project.get('drawings', w.path);
    w.load = { state: 'loading' };
    try {
      const buf = await fileBytes(c.path + '/files/' + d.file);
      if (d.kind === 'pdf') w.pdf = await openPdf(new Uint8Array(buf).slice());
      else {
        w.dxf = window.ProrabDxf.parse(new Uint8Array(buf));
        w.hidden = new Set(Object.values(w.dxf.layers).filter((l) => !l.visible).map((l) => l.name));
      }
      w.load = { state: 'ready' };
    } catch (e) { w.load = { state: 'error', error: e.message }; }
    if (!modalOpen()) render();
  }

  function drawingView(w, c) {
    const P = c.project;
    const d = P.get('drawings', w.path);
    if (!d || Number(d.deleted)) return h('p', { class: 'pp-muted' }, 'Чертёж удалён.');
    if (!w.load) loadDrawing(w, c);
    if (w.load.state === 'loading') return h('p', { class: 'pp-muted' }, 'Загружаю чертёж с Диска…');
    if (w.load.state === 'error') return h('div', null, h('p', { class: 'pp-error' }, w.load.error), button('Повторить', () => { w.load = null; render(); }));
    const notes = P.notesOf(d.id);
    if (!w.host) {
      w.host = h('div', { class: 'pp-plan' });
      w.viewer = window.ProrabViewer.create(w.host, {
        kind: d.kind, dxf: w.dxf, pdf: w.pdf, hidden: w.hidden, notes,
        onNote: (id) => noteForm(c, w, { id }),
        onPlace: (x, y, page) => {
          w.placing = false; w.viewer.setMode('view');
          const pf = w.placeFor;
          w.placeFor = null;
          if (!pf) { render(); noteForm(c, w, { x, y, page }); return; }
          try {
            const n = pf.kind === 'extra' ? c.project.placeExtra(pf.itemId, w.path, page, x, y, w.viewId) : c.project.placeRemark(pf.remarkId, w.path, page, x, y, w.viewId);
            changed(c);
            w.viewer.setNotes(c.project.notesOf(w.path));
            w.viewer.focus(n);
            setStatus(pf.title + ' — на чертеже, пометка №' + n.number);
          } catch (e) { alert(e.message); render(); }
        },
        onError: (e) => { w.load = { state: 'error', error: e.message }; w.viewer.destroy(); w.host = null; w.viewer = null; render(); },
        onChange: () => { const el = document.querySelector('.pp-win[data-key="' + CSS.escape(w.key) + '"] .pp-plan-page'); if (el && w.viewer) el.textContent = (w.viewer.page + 1) + ' / ' + w.viewer.pageCount; },
      });
      if (w.placing) w.viewer.setMode('place');
      if (w.pendingView) { const v = w.pendingView; w.pendingView = null; setTimeout(() => applyPlanView(w, c, v), 0); }
      if (w.focusNote) { const n = P.get('drawing_notes', w.focusNote); w.focusNote = null; if (n) setTimeout(() => w.viewer.focus(n), 0); }
    } else w.viewer.setNotes(notes);
    const views = P.viewsOf(d.id);
    const viewSel = h('select', { title: 'Сохранённые виды' }, h('option', { value: '' }, 'Весь чертёж'), views.map((v) => h('option', { value: v.id }, v.name || 'Вид')));
    viewSel.value = w.viewId || '';
    viewSel.addEventListener('change', () => applyPlanView(w, c, viewSel.value || null));
    const isPdf = d.kind === 'pdf';
    const pageBar = isPdf && w.pdf && w.pdf.numPages > 1 ? h('span', { class: 'pp-row' },
      button('‹', () => w.viewer.setPage(w.viewer.page - 1), 'pp-icon', 'Предыдущий лист'),
      h('span', { class: 'pp-plan-page' }, (w.viewer.page + 1) + ' / ' + w.pdf.numPages),
      button('›', () => w.viewer.setPage(w.viewer.page + 1), 'pp-icon', 'Следующий лист')) : null;
    const side = h('aside', { class: 'pp-plan-side' },
      h('h3', null, 'Пометки (' + notes.length + ')'),
      notes.length ? notes.map((n) => h('button', { type: 'button', class: 'pp-line', onclick: () => w.viewer.focus(n), ondblclick: () => noteForm(c, w, { id: n.id }) },
        h('span', null, h('i', { class: 'pp-dot pp-dot-' + n.status }), '№' + n.number + '. ' + (n.text || 'без текста')),
        h('small', null, [NOTE_NAMES[n.status], isPdf ? 'лист ' + ((n.page || 0) + 1) : '', n.dueDate ? 'срок ' + shortDate(n.dueDate) : ''].filter(Boolean).join(' · ')))) :
        h('p', { class: 'pp-muted' }, 'Нажмите «+ Пометка» и щёлкните по месту на чертеже.'),
      h('small', { class: 'pp-muted' }, 'Щелчок — показать, двойной — изменить.'));
    return h('div', { class: 'pp-planwrap' },
      h('div', { class: 'pp-row pp-wrap pp-plan-bar' },
        button(w.placing ? 'Щёлкните по месту' + (w.placeFor ? ' для «' + w.placeFor.title + '»' : '') + '… (отмена)' : '+ Пометка', () => { w.placing = !w.placing; if (!w.placing) w.placeFor = null; w.viewer.setMode(w.placing ? 'place' : 'view'); render(); }, w.placing ? 'pp-danger' : 'pp-primary'),
        button('⤢', () => w.viewer.fit(), 'pp-icon', 'Весь чертёж'), button('−', () => w.viewer.zoom(1 / 1.5), 'pp-icon', 'Дальше'), button('+', () => w.viewer.zoom(1.5), 'pp-icon', 'Ближе'),
        pageBar, w.dxf ? button('Слои', () => layersDialog(w)) : null,
        viewSel, button('Сохранить вид', () => saveViewDialog(w, c, d)),
        w.dxf && w.dxf.warnings.length ? h('small', { class: 'pp-muted', title: w.dxf.warnings.join('\n') }, 'ⓘ ' + w.dxf.warnings[0]) : null),
      h('div', { class: 'pp-plan-main' }, w.host, side));
  }

  function layersDialog(w) {
    const list = Object.values(w.dxf.layers).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const boxes = list.map((l) => { const b = h('input', { type: 'checkbox' }); b.checked = !w.hidden.has(l.name); return [l, b]; });
    const apply = () => { w.hidden = new Set(boxes.filter(([, b]) => !b.checked).map(([l]) => l.name)); w.viewer.setHidden(w.hidden); };
    boxes.forEach(([, b]) => b.addEventListener('change', apply));
    const wrap = h('div', { class: 'pp-modal', onclick: (e) => { if (e.target === wrap) wrap.remove(); } },
      h('div', { class: 'pp-dialog' },
        h('div', { class: 'pp-row pp-between' }, h('h2', null, 'Слои'), button('✕', () => wrap.remove(), 'pp-icon')),
        h('div', { class: 'pp-row' }, button('Все', () => { boxes.forEach(([, b]) => { b.checked = true; }); apply(); }), button('Ни одного', () => { boxes.forEach(([, b]) => { b.checked = false; }); apply(); })),
        h('div', { class: 'pp-catalog' }, boxes.map(([l, b]) => { const sw = h('i', { class: 'pp-swatch' }); sw.style.background = l.color; return h('label', { class: 'pp-check' }, b, sw, ' ' + l.name); })),
        h('div', { class: 'pp-row pp-between' }, h('small', { class: 'pp-muted' }, 'Набор слоёв можно сохранить: «Сохранить вид».'), button('Готово', () => wrap.remove(), 'pp-primary'))));
    document.body.append(wrap);
  }

  function saveViewDialog(w, c, d) {
    const P = c.project;
    const cur = w.viewId ? P.get('drawing_views', w.viewId) : null;
    const name = h('input', { value: cur ? cur.name : '', placeholder: '3 этаж, Кладка…' });
    const over = h('input', { type: 'checkbox' }); over.checked = !!cur;
    modal(c, 'Сохранить вид', h('div', null, field('Название', name),
      cur ? h('label', { class: 'pp-check' }, over, ' Заменить вид «' + cur.name + '» (иначе — новый)') : null,
      h('p', { class: 'pp-muted' }, 'Запоминается ' + (d.kind === 'pdf' ? 'лист' : 'набор слоёв') + ' и видимая часть. Вид появится в списке чертежей и в телефоне.')), () => {
      if (!name.value.trim()) bad('Укажите название вида');
      const v = w.viewer.view();
      const saved = P.saveView({ id: cur && over.checked ? cur.id : null, drawingId: d.id, name: name.value, page: v.page, cx: v.cx, cy: v.cy, span: v.span,
        hiddenLayers: w.dxf ? Array.from(w.hidden).join('\n') : null });
      w.viewId = saved.id;
    }, cur ? { text: 'Удалить вид', run: () => { if (!confirm('Удалить вид «' + cur.name + '»?')) return false; P.deleteView(cur.id); w.viewId = null; } } : null);
  }

  function noteForm(c, w, { id, x, y, page }) {
    const P = c.project;
    const n = id ? P.get('drawing_notes', id) : null;
    const noteId = n ? n.id : S.newId();
    const status = h('select', null, M.NOTE_STATUS.map(([k, t]) => h('option', { value: k }, t)));
    status.value = n ? n.status : 'NOTE';
    const text = h('textarea', { rows: 4, placeholder: 'Что не так / что сделать' }, n ? n.text : '');
    const who = selectAdd(P.contractors().map((r) => ({ id: r.id, name: r.name })), n && n.contractorId, 'Не указан', 'Новый исполнитель', (nm) => P.addNamed('contractors', nm));
    const due = h('input', { type: 'date', value: n && n.dueDate ? dayToInput(n.dueDate) : '' });
    const doneDate = h('input', { type: 'date', value: dayToInput(n && n.doneDate ? n.doneDate : today) });
    const photos = photoBox(c, n ? n.id : null, 'Фото и видео');
    const after = photoBox(c, n ? n.id + ':done' : null, 'Фото после устранения');
    const doneBox = h('div', null, field('Дата устранения', doneDate), after.el);
    const sync = () => { doneBox.style.display = status.value === 'DONE' ? '' : 'none'; };
    status.addEventListener('change', sync); sync();
    modal(c, n ? 'Пометка №' + n.number : 'Новая пометка', h('div', null,
      field('Статус', status), field('Текст', text), h('div', { class: 'pp-row pp-wrap' }, field('Кто устраняет', who), field('Срок устранения', due, 'необязательно')),
      photos.el, doneBox,
      n ? h('small', { class: 'pp-muted' }, 'Создана ' + shortDate(Math.floor(((n.createdAt || 0) - new Date().getTimezoneOffset() * 60000) / 86400000))) : null), () => {
      if (photos.busy() || after.busy()) bad('Подождите — фото ещё загружаются');
      const st = status.value;
      const saved = P.saveNote({
        id: noteId, drawingId: w.path, page, x, y, viewId: w.viewId, text: text.value, status: st,
        contractorId: who.value && who.value !== '__add' ? who.value : null, dueDate: due.value ? inputToDay(due.value) : null,
        doneDate: st === 'DONE' ? inputToDay(doneDate.value) || today : null,
      });
      photos.commit(saved.id);
      after.commit(saved.id + ':done');
      if (w.viewer) w.viewer.setNotes(P.notesOf(w.path));
    }, n ? { text: 'Удалить', run: () => { if (!confirm('Удалить пометку №' + n.number + '?')) return false; P.deleteNote(n.id); } } : null);
  }

  // ───────── сегодня ─────────
  function todayView(w, c) {
    const P = c.project;
    const v = P.todayView(today);
    const names = P.names();
    const sec = (title, list, row, empty) => (list.length || empty ? h('section', { class: 'pp-card' }, h('h3', null, title + (list.length ? ' (' + list.length + ')' : '')),
      list.length ? list.map(row) : h('p', { class: 'pp-muted' }, empty)) : null);
    const taskRow = (t) => h('button', { type: 'button', class: 'pp-line', onclick: () => taskForm(c, { taskId: t.id }) },
      h('span', null, '○ ' + (t.title || P.itemName(t.itemId) || 'Задача')), h('small', null, [t.date !== today ? dayTitle(t.date) : '', t.planQty ? 'план ' + num(t.planQty) : '', t.note].filter(Boolean).join(' · ')));
    return h('main', null,
      h('div', { class: 'pp-row pp-between pp-wrap' }, h('h2', null, dayTitle(today)),
        h('div', { class: 'pp-row' }, button('📄 Отчёт за сегодня', () => reportDialog(c, today)), button('+ Задача', () => taskForm(c, { date: today })), button('+ Сделано', () => doneForm(c, { date: today }), 'pp-primary'))),
      h('p', { class: v.attention ? 'pp-error' : 'pp-muted' }, v.attention ? 'Требует внимания: ' + v.attention : 'Просрочек нет 👍'),
      sec('Просрочено', v.overdueTasks, taskRow),
      sec('План на сегодня', v.tasks, taskRow, 'На сегодня задач нет.'),
      sec('Сроки по ведомости', v.itemsDue, (r) => h('button', { type: 'button', class: 'pp-line', onclick: () => boqForm(c, r.id) },
        h('span', null, r.name), h('small', null, 'срок ' + shortDate(r.due) + (r.plan !== null ? ' · сделано ' + num(r.fact) + ' из ' + num(r.plan) + ' ' + r.unit : '')),
        h('strong', { class: r.due < today ? 'pp-error' : '' }, r.due < today ? 'просрочено' : 'сегодня'))),
      sec('Ждут приёмки', v.acceptancesPending, (a) => h('button', { type: 'button', class: 'pp-line', onclick: () => acceptanceForm(c, a.id) },
        h('span', null, P.acceptanceTitle(a)), h('small', null, a.planDate ? 'приёмка ' + shortDate(a.planDate) : 'дата приёмки не назначена'))),
      sec('Замечания со сроком', v.remarksDue, (r) => h('button', { type: 'button', class: 'pp-line', onclick: () => remarkForm(c, r.id) },
        h('span', null, '№' + r.number + ' — ' + (r.text || 'без текста')), h('small', null, [names.contractors[r.contractorId], 'срок ' + shortDate(r.dueDate)].filter(Boolean).join(' · ')))),
      v.remarksOpen > v.remarksDue.length ? h('p', { class: 'pp-muted' }, 'Всего открытых замечаний: ' + v.remarksOpen) : null,
      sec('Техника сегодня', v.calls.concat(v.machineWork), (x) => h('div', { class: 'pp-line' },
        h('span', null, P.orderTitle(x.orderId)), h('small', null, x.minutes ? 'работала ' + M.hm(x.minutes) : x.timeMin !== undefined && x.timeMin !== null ? 'вызов к ' + pad(Math.floor(x.timeMin / 60)) + ':' + pad(x.timeMin % 60) : 'вызов'))),
      v.people ? h('section', { class: 'pp-card' }, h('h3', null, 'Людей на объекте: ' + v.people)) : null,
      sec('Сделано сегодня', v.doneToday, (e) => h('button', { type: 'button', class: 'pp-line', onclick: () => doneForm(c, { entryId: e.id }) },
        h('span', null, e.name || P.itemName(e.itemId) || 'Работа'), h('strong', null, num(e.quantity) + (names.units[e.unitId] ? ' ' + names.units[e.unitId] : '')))));
  }

  // ───────── доп. работы ─────────
  const EXTRA_KINDS = [['EXTRA_ITEM', 'Заведены заранее', 'Выполнение записывайте в журнал работ как обычно — выбрав эту позицию.'], ['OVER_PLAN', 'Сверх плана', ''],
    ['NO_PLAN', 'Не было в ведомости', 'Позиции без плана — появились по ходу работ. Если это не доп. работы, укажите план в ведомости.'], ['NO_ITEM', 'Записи без позиции', 'Записи журнала, не привязанные к позиции ведомости.']];
  const SIGNS = [['designerDate', 'Проектировщик'], ['supervisorDate', 'Технадзор'], ['contractorDate', 'Исполнитель'], ['customerDate', 'Заказчик']];

  function extraLine(P, x, names) {
    const unit = x.item && names.units[x.item.unitId] ? ' ' + names.units[x.item.unitId] : '';
    if (x.kind === 'OVER_PLAN') return 'план ' + num(x.plan) + unit + ' · сделано ' + num(x.fact) + unit + ' · +' + Math.round(x.extra / x.plan * 100) + '%' + (x.since ? ' · с ' + shortDate(x.since) : '');
    if (x.kind === 'NO_PLAN') return 'плана нет · сделано ' + num(x.fact) + unit;
    if (x.kind === 'EXTRA_ITEM') return [x.since ? 'заведена ' + shortDate(x.since) : '', x.plan ? 'план ' + num(x.plan) + unit : '', x.fact > 0 ? 'сделано ' + num(x.fact) + unit + (x.plan ? ' (' + Math.round(x.fact / x.plan * 100) + '%)' : '') : 'ещё не начата'].filter(Boolean).join(' · ');
    return 'записей: ' + x.parts.length;
  }

  function extrasView(w, c) {
    const P = c.project;
    const names = P.names();
    const list = P.extraWorks();
    const cost = list.reduce((s, x) => s + (x.cost || 0), 0);
    const waiting = list.filter((x) => { const a = P.extraApproval(x.item && x.item.id); return !a || !SIGNS.some(([k]) => a[k]); }).length;
    return h('main', null,
      h('section', { class: 'pp-card' },
        h('div', { class: 'pp-row pp-between pp-wrap' }, h('h3', null, 'Итого'),
          h('div', { class: 'pp-row' }, list.length ? button('⬇ Excel', () => exportExtras(c, list)) : null, button('+ Доп. работа', () => boqForm(c, null, { extra: true }), 'pp-primary'))),
        !list.length ? h('p', null, 'Пока всё в пределах плана 👍') : h('div', null,
          EXTRA_KINDS.map(([k, t]) => { const n = list.filter((x) => x.kind === k).length; return n ? h('div', null, t + ': ' + n) : null; }),
          cost ? h('strong', null, 'На сумму: ' + money(cost)) : null,
          h('p', { class: waiting ? 'pp-error' : 'pp-plus' }, waiting ? 'Не согласовано: ' + waiting : 'Все согласованы ✓')),
        h('small', { class: 'pp-muted' }, 'Считается само: план — из ведомости, сделанное — из журнала работ. Доп. работу можно завести заранее кнопкой «+ Доп. работа».')),
      EXTRA_KINDS.map(([k, t, note]) => {
        const part = list.filter((x) => x.kind === k);
        if (!part.length) return null;
        return h('section', { class: 'pp-card' }, h('h3', null, t), part.map((x) => {
          const a = P.extraApproval(x.item && x.item.id);
          const signed = a ? SIGNS.filter(([key]) => a[key]).map(([, nm]) => nm.toLowerCase()) : [];
          const proofs = a ? P.attachmentsOf(a.id).length + P.attachmentsOf(a.id + ':work').length : 0;
          return h('button', { type: 'button', class: 'pp-line', onclick: () => extraForm(c, x) },
            h('span', null, x.item ? P.itemName(x.item.id) : 'Без позиции'),
            h('small', null, [extraLine(P, x, names), x.cost ? 'на ' + money(x.cost) : '', signed.length ? '✓ согласовали: ' + signed.join(', ') : 'не согласовано', proofs ? '📎 ' + proofs : '', a && a.noteId ? '📍 на чертеже' : ''].filter(Boolean).join(' · ')),
            x.kind !== 'NO_ITEM' ? h('strong', { class: 'pp-error' }, '+' + num(x.extra) + (x.item && names.units[x.item.unitId] ? ' ' + names.units[x.item.unitId] : '')) : null);
        }), note ? h('small', { class: 'pp-muted' }, note) : null);
      }));
  }

  function extraForm(c, x) {
    const P = c.project;
    const itemId = x.item ? x.item.id : null;
    const a = P.extraApproval(itemId) || {};
    const id = P.extraApprovalId(itemId);
    const names = P.names();
    const desc = h('textarea', { rows: 3, placeholder: 'Что и почему нужно сделать…' }, a.description || '');
    const note = h('textarea', { rows: 2, placeholder: 'Причина, как и кем согласовано (в чате, письмом, на бумаге)…' }, a.note || '');
    const signs = SIGNS.map(([k, t]) => {
      const box = h('input', { type: 'checkbox' }); box.checked = !!a[k];
      const date = h('input', { type: 'date', value: a[k] ? dayToInput(a[k]) : '' });
      box.addEventListener('change', () => { if (box.checked && !date.value) date.value = dayToInput(today); if (!box.checked) date.value = ''; });
      date.addEventListener('change', () => { box.checked = !!date.value; });
      return { k, el: h('div', { class: 'pp-row pp-between' }, h('label', { class: 'pp-check' }, box, ' ' + t), date), date };
    });
    const work = photoBox(c, id + ':work', 'Фото работы');
    const proof = photoBox(c, id, 'Подтверждение (фото подписанной бумаги или скриншот из чата)');
    const placed = a.noteId ? P.get('drawing_notes', a.noteId) : null;
    const where = placed && !Number(placed.deleted) ? (P.get('drawings', placed.drawingId) || {}).name + ', пометка №' + placed.number : null;
    const save = () => {
      if (work.busy() || proof.busy()) bad('Подождите — фото ещё загружаются');
      const ch = { description: desc.value.trim(), note: note.value.trim() };
      signs.forEach((s) => { ch[s.k] = s.date.value ? inputToDay(s.date.value) : null; });
      P.saveExtraApproval(itemId, ch);
      work.commit(id + ':work'); proof.commit(id);
    };
    modal(c, 'Доп. работа', h('div', null,
      h('h3', null, x.item ? P.itemName(itemId) : 'Записи без позиции'), h('p', null, extraLine(P, x, names) + (x.cost ? ' · на сумму ' + money(x.cost) : '')),
      x.parts.length ? h('details', null, h('summary', null, 'Записи журнала (' + x.parts.length + ')'), x.parts.map((p) => h('div', { class: 'pp-line' },
        h('span', null, dayTitle(p.entry.date) + (p.entry.note ? ' · ' + p.entry.note : '')), h('strong', null, '+' + num(p.qty))))) : null,
      field('Пояснение', desc), work.el,
      h('h3', null, 'Место на чертеже'),
      h('div', { class: 'pp-row pp-wrap pp-between' }, h('span', { class: 'pp-muted' }, where ? '📍 «' + where + '»' : 'Не отмечено (необязательно)'),
        h('div', { class: 'pp-row' }, where ? button('Показать', () => { document.querySelector('.pp-modal').remove(); openDrawing(c, placed.drawingId, { noteId: placed.id }); }) : null,
          button(where ? 'Перенести' : 'Отметить на чертеже', () => {
            try { save(); } catch (e) { alert(e.message); return; }
            document.querySelector('.pp-modal').remove(); changed(c);
            pickDrawing(c, (drawingId) => openDrawing(c, drawingId, { place: { kind: 'extra', itemId, title: 'Доп. работа: ' + (x.item ? P.itemName(itemId) : 'без позиции') } }));
          }))),
      h('h3', null, 'Кто согласовал'), signs.map((s) => s.el), h('small', { class: 'pp-muted' }, 'Галочка — сегодняшняя дата; дату можно поменять.'),
      field('Примечание', note), proof.el,
      x.item ? button('Открыть позицию ведомости', () => { document.querySelector('.pp-modal').remove(); boqForm(c, itemId); }) : null), save);
  }

  /** Выбрать чертёж объекта (для постановки замечания или доп. работы). */
  function pickDrawing(c, onPick) {
    const list = c.project.drawings();
    if (!list.length) return alert('В объекте пока нет чертежей. Добавьте их в окне «Чертежи».');
    if (list.length === 1) return onPick(list[0].id);
    const wrap = h('div', { class: 'pp-modal', onclick: (e) => { if (e.target === wrap) wrap.remove(); } },
      h('div', { class: 'pp-dialog' }, h('div', { class: 'pp-row pp-between' }, h('h2', null, 'Какой чертёж открыть?'), button('✕', () => wrap.remove(), 'pp-icon')),
        h('div', { class: 'pp-list' }, list.map((d) => h('button', { type: 'button', class: 'pp-item', onclick: () => { wrap.remove(); onPick(d.id); } }, (d.kind === 'pdf' ? '📕 ' : '📐 ') + (d.name || 'Чертёж'))))));
    document.body.append(wrap);
  }

  function exportExtras(c, list) {
    const P = c.project, names = P.names();
    const rows = [['Вид', 'Работа', 'Ед.', 'План', 'Сделано', 'Доп. объём', 'Сумма, ₽', 'С какого дня', 'Согласовали', 'Пояснение', 'Примечание']];
    for (const x of list) {
      const a = P.extraApproval(x.item && x.item.id) || {};
      rows.push([(EXTRA_KINDS.find(([k]) => k === x.kind) || [])[1], x.item ? P.itemName(x.item.id) : 'Без позиции', x.item ? names.units[x.item.unitId] || '' : '', x.plan, Math.round(x.fact * 1e6) / 1e6, x.extra,
        x.cost ? x.cost / 100 : null, x.since ? { date: x.since } : null, SIGNS.filter(([k]) => a[k]).map(([k, t]) => t + ' ' + shortDate(a[k])).join(', '), a.description || '', a.note || '']);
    }
    const bytes = O.book([{ name: 'Доп. работы', header: true, widths: [20, 44, 8, 10, 10, 12, 14, 14, 36, 40, 30], rows }]);
    const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: ('Доп. работы ' + (P.project.name || '') + ' ' + shortDate(today)).replace(/[\\/:*?"<>|]/g, '_') + '.xlsx' });
    document.body.append(a); a.click(); a.remove();
  }

  // ───────── журнал приёмки ─────────
  const ACCEPT = { PENDING: ['Ждёт приёмки', ''], ACCEPTED: ['Выполнено', 'pp-plus'], REJECTED: ['Не принято', 'pp-error'], CANCELLED: ['Отменено', 'pp-muted'] };
  function acceptanceView(w, c) {
    const P = c.project;
    const cur = P.acceptancesCurrent();
    const names = P.names();
    const groups = [['Ждут приёмки', 'PENDING'], ['Не принято — устранить замечания', 'REJECTED'], ['Принято — выполнено', 'ACCEPTED']];
    return h('main', null,
      h('section', { class: 'pp-card' },
        h('div', { class: 'pp-row pp-between pp-wrap' }, h('h3', null, 'Итого'),
          h('div', { class: 'pp-row' }, cur.length ? button('⬇ Excel', () => exportAcceptances(c, cur)) : null, button('Предъявить работу к приёмке', () => submitPicker(c), 'pp-primary'))),
        groups.map(([t, k]) => h('div', { class: ACCEPT[k][1] }, t.split(' —')[0] + ': ' + cur.filter((a) => a.result === k).length)),
        h('small', { class: 'pp-muted' }, 'Работу ставят на приёмку здесь или кнопкой «Закончено — на приёмку» в позиции ведомости.')),
      groups.map(([t, k]) => {
        const part = cur.filter((a) => a.result === k).sort((a, b) => (b.readyDate - a.readyDate));
        if (!part.length) return null;
        return h('section', { class: 'pp-card' }, h('h3', null, t), part.map((a) => {
          const item = P.get('boq_items', a.itemId);
          const rc = P.acceptanceRemarks(a.id);
          return h('button', { type: 'button', class: 'pp-line', onclick: () => acceptanceForm(c, a.id) },
            h('span', null, P.acceptanceTitle(a)),
            h('small', null, [item && names.contractors[item.contractorId] ? '👷 ' + names.contractors[item.contractorId] : '', 'закончено ' + shortDate(a.readyDate),
              a.result === 'PENDING' ? (a.planDate ? 'приёмка ' + shortDate(a.planDate) : 'дата приёмки не назначена') : a.resultDate ? (a.result === 'ACCEPTED' ? 'принято ' : 'не принято ') + shortDate(a.resultDate) : '',
              a.acceptedBy, rc.total ? (rc.open ? 'замечаний открыто: ' + rc.open + ' из ' + rc.total : 'замечания устранены (' + rc.total + ')') : ''].filter(Boolean).join(' · ')),
            h('strong', { class: ACCEPT[a.result][1] }, ACCEPT[a.result][0]));
        }));
      }),
      cur.length ? null : h('p', { class: 'pp-card pp-muted' }, 'Пока ничего не предъявлено к приёмке.'));
  }

  function acceptorSelect(P, value) {
    const s = h('input', { value: value || '', list: 'pp-acceptors-' + P.projectId, placeholder: 'Кто принимает' });
    const dl = h('datalist', { id: 'pp-acceptors-' + P.projectId }, P.acceptors().map((n) => h('option', { value: n })));
    return { el: h('span', null, s, dl), input: s };
  }

  function submitPicker(c) {
    const P = c.project;
    const busy = new Set(P.acceptancesCurrent().filter((a) => !a.entryId && a.result !== 'REJECTED').map((a) => a.itemId));
    const items = P.boq().filter((r) => !busy.has(r.id));
    if (!items.length) return alert('Все позиции ведомости уже на приёмке или приняты.');
    const sel = h('select', null, items.map((r) => h('option', { value: r.id }, r.name + (r.plan !== null ? ' — ' + num(r.fact) + ' из ' + num(r.plan) + ' ' + r.unit : ''))));
    readyDialog(c, sel, null);
  }

  /** «Готово к приёмке»: дата окончания, дата приёмки, кто принимает. */
  function readyDialog(c, sel, itemId) {
    const P = c.project;
    const finish = h('input', { type: 'date', value: dayToInput(today) });
    const plan = h('input', { type: 'date', value: dayToInput(today) });
    const who = acceptorSelect(P, P.acceptors()[0]);
    modal(c, 'Готово к приёмке', h('div', null, sel ? field('Работа', sel) : h('h3', null, P.itemName(itemId)),
      h('div', { class: 'pp-row pp-wrap' }, field('Закончено', finish), field('Дата приёмки', plan, 'необязательно')), field('Кто принимает', who.el),
      h('small', { class: 'pp-muted' }, 'Работа попадёт в «Журнал приёмки». Там отмечается «Принято / Не принято» и замечания.')), () => {
      const f = inputToDay(finish.value);
      if (f === null) bad('Укажите, когда закончено');
      P.submitAcceptance(sel ? sel.value : itemId, f, plan.value ? inputToDay(plan.value) : null, who.input.value);
      setStatus('Работа предъявлена к приёмке');
    });
  }

  function acceptanceForm(c, id) {
    const P = c.project;
    const a = P.get('acceptances', id);
    const item = P.get('boq_items', a.itemId);
    const names = P.names();
    const ready = h('input', { type: 'date', value: dayToInput(a.readyDate) });
    const plan = h('input', { type: 'date', value: a.planDate ? dayToInput(a.planDate) : '' });
    const result = h('select', null, [['PENDING', 'Ждёт'], ['ACCEPTED', 'Принято'], ['REJECTED', 'Не принято']].map(([k, t]) => h('option', { value: k }, t)));
    result.value = a.result === 'CANCELLED' ? 'PENDING' : a.result;
    const who = acceptorSelect(P, a.acceptedBy);
    const resDate = h('input', { type: 'date', value: dayToInput(a.resultDate || today) });
    const resField = field('Дата проверки', resDate);
    const note = h('textarea', { rows: 2, placeholder: 'Примечание (акт №, что проверили)' }, a.note || '');
    const rc = P.acceptanceRemarks(a.id);
    const sync = () => { resField.style.display = result.value === 'PENDING' ? 'none' : ''; resField.firstChild.textContent = result.value === 'ACCEPTED' ? 'Дата приёмки (принято)' : 'Дата проверки'; };
    result.addEventListener('change', sync); sync();
    const closeAnd = (fn) => () => { document.querySelector('.pp-modal').remove(); fn(); };
    const progress = item ? P.boq().find((r) => r.id === item.id) : null;
    const history = P.acceptanceHistory(a);
    const cancelled = a.result === 'CANCELLED';
    modal(c, 'Приёмка', h('div', null,
      h('h3', null, P.acceptanceTitle(a)),
      item && names.contractors[item.contractorId] ? h('p', null, 'Исполнитель: ' + names.contractors[item.contractorId]) : null,
      !a.entryId && progress ? h('p', { class: 'pp-muted' }, 'Сделано ' + num(progress.fact) + ' ' + progress.unit + (progress.plan !== null ? ' из ' + num(progress.plan) + ' ' + progress.unit : '')) : null,
      cancelled ? h('p', { class: 'pp-error' }, 'Это предъявление отменено. Предъявить снова — «Предъявить работу к приёмке».') : null,
      h('div', { class: 'pp-row pp-wrap' }, field('Закончено', ready), field('Дата приёмки', plan, 'необязательно')),
      h('div', { class: 'pp-row pp-wrap' }, field('Результат', result), field('Кто принимал', who.el)), resField, field('Примечание', note),
      rc.open ? h('p', { class: 'pp-error' }, 'Есть неустранённые замечания: ' + rc.open + '. Обычно сначала их устраняют.') : null,
      h('h3', null, 'Замечания по приёмке' + (rc.total ? ' (' + rc.open + ' открыто из ' + rc.total + ')' : '')),
      rc.remarks.map((r) => h('button', { type: 'button', class: 'pp-line', onclick: closeAnd(() => remarkForm(c, r.id)) }, h('span', null, '№' + r.number + ' — ' + (r.text || 'без текста')), h('strong', { class: r.status === 'DONE' ? 'pp-plus' : 'pp-error' }, r.status === 'DONE' ? 'устранено' : 'открыто'))),
      rc.notes.map((n) => h('button', { type: 'button', class: 'pp-line', onclick: closeAnd(() => openDrawing(c, n.drawingId, { noteId: n.id })) }, h('span', null, 'Ч№' + n.number + ' — ' + (n.text || 'без текста')), h('strong', { class: n.status === 'DONE' ? 'pp-plus' : 'pp-error' }, n.status === 'DONE' ? 'устранено' : 'открыто'))),
      h('div', { class: 'pp-row pp-wrap' }, button('+ Замечание', closeAnd(() => remarkForm(c, null, { acceptanceId: a.id, text: '' }))),
        a.result === 'REJECTED' && !rc.open ? button('Замечания устранены — предъявить снова', closeAnd(() => { P.resubmitAcceptance(a.id, today); changed(c); }), 'pp-primary') : null,
        button('📑 Оформить АОСР', closeAnd(() => { openWindow('id', c.path); aosrForm(c, null, { itemId: a.itemId, entryIds: a.entryId ? [a.entryId] : null, to: a.readyDate }); }))),
      history.length ? h('details', null, h('summary', null, 'Раньше по этой работе (' + history.length + ')'), history.map((x) => h('div', { class: 'pp-line' },
        h('span', null, 'закончено ' + shortDate(x.readyDate) + (x.acceptedBy ? ' · ' + x.acceptedBy : '')), h('strong', { class: ACCEPT[x.result][1] }, ACCEPT[x.result][0])))) : null), () => {
      if (cancelled) return;
      const rd = inputToDay(ready.value);
      if (rd === null) bad('Укажите, когда закончено');
      P.saveAcceptance(a.id, { readyDate: rd, planDate: plan.value ? inputToDay(plan.value) : null, result: result.value, resultDate: inputToDay(resDate.value) || today, acceptedBy: who.input.value, note: note.value });
    }, cancelled ? null : { text: 'Отменить предъявление', run: () => { if (!confirm('Отменить предъявление? Позиция снова будет «в работе».')) return false; P.cancelAcceptance(a.id, today); } });
  }

  function exportAcceptances(c, list) {
    const P = c.project, names = P.names();
    const rows = [['№', 'Работа', 'Исполнитель', 'Закончено', 'Приёмка', 'Результат', 'Дата результата', 'Кто принимал', 'Замечания', 'Примечание']];
    list.slice().sort((a, b) => a.readyDate - b.readyDate).forEach((a, i) => {
      const item = P.get('boq_items', a.itemId), rc = P.acceptanceRemarks(a.id);
      rows.push([i + 1, P.acceptanceTitle(a), item ? names.contractors[item.contractorId] || '' : '', { date: a.readyDate }, a.planDate ? { date: a.planDate } : null, ACCEPT[a.result][0],
        a.resultDate ? { date: a.resultDate } : null, a.acceptedBy || '', rc.total ? 'замечаний ' + rc.total + ', открыто ' + rc.open : '', a.note || '']);
    });
    const bytes = O.book([{ name: 'Журнал приёмки', header: true, widths: [5, 48, 24, 12, 12, 14, 14, 24, 22, 36], rows }]);
    const el = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: ('Журнал приёмки ' + (P.project.name || '') + ' ' + shortDate(today)).replace(/[\\/:*?"<>|]/g, '_') + '.xlsx' });
    document.body.append(el); el.click(); el.remove();
  }

  // ───────── экономика собственника (зашифрована кодом) ─────────
  // Папка — рядом с рабочим столом, а не внутри: «Прораб+» открыта прорабам, экономика — нет.
  // На Диске и на сервере сайта — только шифр; код и расшифрованные данные — в памяти этой вкладки.
  const V = window.ProrabVault, E = window.ProrabEconomy, ES = window.ProrabEconomyStore;
  const econ = { exists: null, session: null, release: null, opening: false, closing: false, operation: null, timer: null, lockTimer: null };
  Object.defineProperties(econ, {
    vault: { get: () => !econ.closing && econ.session ? econ.session.vault : null },
    data: { get: () => econ.session ? econ.session.data : null },
  });
  const ECON_LOCK_MS = 15 * 60 * 1000;
  const parentOf = (p) => { const s = D.normalize(p); return s.slice(0, s.lastIndexOf('/')) || '/'; };
  // Always outside any shared ancestor of the workspace, directly in Disk root.
  const econDir = () => '/' + lastName(ROOT) + ' Экономика';
  const econFile = () => econDir() + '/economy.prorab.json';
  const econVisible = () => !!ROOT_SAVE || econ.exists === true;

  async function checkEcon() {
    try {
      econ.exists = !!new ES.Session(disk, store, econFile()).pending() || await disk.getText(econFile()) !== null;
    } catch (e) { econ.exists = null; setStatus('Не удалось проверить экономику: ' + e.message, true); }
    if (!modalOpen()) render();
  }

  /** Окно с асинхронным «Сохранить» (шифрование и Диск). */
  function asyncDialog(title, body, onSave, opts) {
    opts = opts || {};
    const err = h('p', { class: 'pp-error' });
    const ok = h('button', { type: 'submit', class: 'pp-btn pp-primary' }, opts.okText || 'Сохранить');
    let working = false;
    const close = (saved) => { if (working && !saved) return; wrap.remove(); if (opts.onClose) opts.onClose(); };
    const wrap = h('div', { class: 'pp-modal', onclick: (e) => { if (e.target === wrap && !opts.sticky) close(); } },
      h('form', { class: 'pp-dialog', onsubmit: async (e) => {
        e.preventDefault();
        if (ok.disabled) return;
        working = true; ok.disabled = true; err.textContent = opts.busyText || '';
        try { if ((await onSave()) !== false) close(true); else err.textContent = ''; } catch (x) { err.textContent = x.message; }
        working = false; ok.disabled = false;
      } },
        h('div', { class: 'pp-row pp-between' }, h('h2', null, title), opts.sticky ? h('span') : button('✕', () => close(false), 'pp-icon')),
        body, err,
        h('div', { class: 'pp-row pp-between' }, opts.extra || h('span'), h('div', { class: 'pp-row' }, opts.sticky ? null : button('Отмена', () => close(false)), ok))));
    document.body.append(wrap);
    const first = wrap.querySelector('input, select, textarea');
    if (first) first.focus();
    return wrap;
  }

  function econActivity() {
    if (!econ.vault) return;
    clearTimeout(econ.lockTimer);
    econ.lockTimer = setTimeout(() => lockEcon('Экономика закрыта: 15 минут без действий.'), ECON_LOCK_MS);
  }
  window.addEventListener('pointerdown', econActivity, true);
  window.addEventListener('keydown', econActivity, true);

  async function lockEcon(message) {
    if (econ.closing) return;
    econ.closing = true;
    clearTimeout(econ.lockTimer); clearTimeout(econ.timer);
    econ.timer = null;
    wins = wins.filter((w) => w.kind !== 'economy' && w.kind !== 'econ');
    document.querySelectorAll('.pp-modal[data-econ]').forEach((m) => m.remove());
    render();
    if (econ.operation) await econ.operation.catch(() => {});
    const session = econ.session;
    if (session) await session.close();
    econ.session = null;
    releaseEcon(); econ.closing = false;
    if (message) setStatus(message + (session && session.pending() ? ' Несинхронизированные правки сохранены зашифрованными в этом браузере. После входа повторю отправку.' : ''));
    render();
  }

  function releaseEcon() {
    if (econ.release) econ.release();
    econ.release = null; econ.opening = false;
  }
  function cancelEconOpen() { if (!econ.session) releaseEcon(); }

  async function openEconomy(folder) {
    if (econ.closing || econ.opening) return;
    const go = () => { if (econ.vault) folder ? openWindow('econ', folder) : openWindow('economy', null); };
    if (econ.vault) return go();
    econ.opening = true;
    try {
      econ.release = await ES.acquire(navigator.locks, PREFIX + accountId + ':' + econFile());
      await checkEcon();
      if (econ.exists === false) setupEcon(go); else unlockEcon(go);
    } catch (e) { releaseEcon(); setStatus(e.message, true); }
  }

  function setupEcon(then) {
    const code = h('input', { type: 'password', autocomplete: 'new-password' });
    const again = h('input', { type: 'password', autocomplete: 'new-password' });
    const d = asyncDialog('💼 Экономика: новый код', h('div', null,
      h('p', null, 'Экономика будет лежать в отдельной папке «' + econDir() + '» в корне вашего Диска. Не открывайте к ней общий доступ. Зашифрованный черновик также хранится на этом компьютере до отправки.'),
      h('p', null, 'Данные шифруются в браузере, код никуда не отправляется. Используйте длинный уникальный код — лучше случайный пароль от 12 знаков или несколько случайных слов. Простой цифровой код можно подобрать.'),
      field('Код (не короче ' + V.MIN_CODE + ' знаков)', code), field('Код ещё раз', again),
      h('p', { class: 'pp-muted' }, 'Не используйте пароль от Яндекса. Код лучше хранить там же, где пароли.')), async () => {
      if (code.value !== again.value) bad('Коды не совпадают');
      const { vault, recovery } = await V.create(code.value);
      await disk.mkdir(econDir());
      if (await disk.getText(econFile()) !== null) bad('Экономика уже создана на другом компьютере — обновите страницу и войдите кодом.');
      const session = new ES.Session(disk, store, econFile());
      if (session.pending()) bad('В этом браузере уже есть черновик экономики. Закройте окно и войдите своим кодом.');
      await session.initialize(vault);
      econ.session = session; econ.exists = true; econ.opening = false;
      code.value = ''; again.value = '';
      saveEcon();
      econActivity();
      showRecovery(recovery, then);
    }, { okText: 'Создать', busyText: 'Шифрую…', onClose: cancelEconOpen });
    d.dataset.econ = '1';
  }

  function showRecovery(recovery, then) {
    const box = h('input', { type: 'checkbox' });
    const d = asyncDialog('🔑 Код восстановления', h('div', null,
      h('p', null, 'Если забудете код, войти можно только этим кодом восстановления. Сбросить код иначе нельзя — так устроена защита.'),
      h('p', { class: 'pp-recovery' }, recovery),
      h('div', { class: 'pp-row' }, button('Копировать', async () => { try { await navigator.clipboard.writeText(recovery); setStatus('Код восстановления скопирован'); } catch (e) { /* выделите вручную */ } })),
      h('p', { class: 'pp-muted' }, 'Запишите его на бумаге или в менеджер паролей и храните отдельно от компьютера. Больше он показан не будет.'),
      h('label', { class: 'pp-check' }, box, ' Я записал код восстановления')), async () => {
      if (!box.checked) bad('Отметьте, что код восстановления записан');
      then();
    }, { okText: 'Готово', sticky: true });
    d.dataset.econ = '1';
  }

  function unlockEcon(then) {
    let recovery = false;
    const code = h('input', { type: 'password', autocomplete: 'current-password' });
    const label = h('span', null, 'Код экономики');
    const toggle = h('button', { type: 'button', class: 'pp-link', onclick: () => {
      recovery = !recovery; label.textContent = recovery ? 'Код восстановления (XXXX-XXXX-…)' : 'Код экономики';
      code.type = 'password'; toggle.textContent = recovery ? 'Ввести обычный код' : 'Забыли код? Ввести код восстановления';
      code.value = ''; code.focus();
    } }, 'Забыли код? Ввести код восстановления');
    const d = asyncDialog('💼 Экономика', h('div', null,
      h('p', { class: 'pp-muted' }, 'Суммы договоров, бюджет, маржа и поступления — только для собственника.'),
      h('label', { class: 'pp-field' }, label, code), toggle), async () => {
      const session = new ES.Session(disk, store, econFile());
      if (!await session.unlock(code.value, recovery)) { econ.exists = false; bad('Экономика ещё не создана. Закройте окно и откройте «Экономику» снова.'); }
      econ.session = session; econ.exists = true; econ.opening = false;
      code.value = '';
      econActivity();
      if (session.pending()) saveEcon();
      if (recovery) newEconCode(then, 'Вход по коду восстановления. Задайте новый код.'); else then();
    }, { okText: 'Открыть', busyText: 'Проверяю код…', onClose: cancelEconOpen });
    d.dataset.econ = '1';
  }

  function newEconCode(then, note) {
    const code = h('input', { type: 'password', autocomplete: 'new-password' });
    const again = h('input', { type: 'password', autocomplete: 'new-password' });
    const d = asyncDialog('🔑 Новый код экономики', h('div', null, note ? h('p', null, note) : null,
      field('Новый код (не короче ' + V.MIN_CODE + ' знаков)', code), field('Ещё раз', again),
      h('p', { class: 'pp-muted' }, 'Код восстановления остаётся прежним.')), async () => {
      if (code.value !== again.value) bad('Коды не совпадают');
      if (!econ.vault) bad('Экономика закрыта. Войдите снова.');
      const session = econ.session;
      clearTimeout(econ.timer); econ.timer = null;
      econ.operation = session.changeCode(code.value);
      try { await econ.operation; } finally { econ.operation = null; }
      code.value = ''; again.value = '';
      setStatus('Код экономики изменён');
      if (then) then();
    }, { busyText: 'Шифрую…' });
    d.dataset.econ = '1';
  }

  /** Правка экономики → через полсекунды на Диск (с объединением, если файл менялся на другом компьютере). */
  async function changedEcon(change) {
    if (!econ.vault) bad('Экономика закрыта. Войдите снова.');
    await econ.session.edit(change);
    clearTimeout(econ.timer); econ.timer = setTimeout(() => saveEcon(), 500);
    setStatus('Правка сохранена зашифрованной на этом компьютере. Отправляю на Диск…');
    render();
  }

  async function saveEcon() {
    clearTimeout(econ.timer); econ.timer = null;
    if (!econ.vault || econ.operation) return;
    const session = econ.session;
    try {
      await session.sync();
      if (econ.session === session && !econ.closing) setStatus('Экономика сохранена на Диске в ' + time());
    } catch (e) {
      if (econ.session === session && !econ.closing) {
        setStatus('Не отправлено на Диск: ' + e.message + ' Зашифрованный черновик сохранён на этом компьютере. Повторю через минуту.', true);
        econ.timer = setTimeout(() => saveEcon(), 60000);
      }
    } finally {
      if (!modalOpen()) render();
    }
  }

  const pct = (v) => (v === null || v === undefined ? '—' : Math.round(v * 100) + '%');
  const moneyOr = (v) => (v === null || v === undefined ? '—' : money(v));
  const econLocked = () => h('div', { class: 'pp-card' }, h('p', null, '🔒 Экономика закрыта.'), button('Открыть по коду', () => openEconomy(), 'pp-primary'));

  function econSummaries() {
    const out = [];
    let loading = 0;
    for (const p of projects || []) {
      const c = openCtx(p.path);
      if (c.loading) { loading++; continue; }
      if (!c.project) continue;
      out.push({ path: p.path, s: E.summary(c.project, econ.data.projects[c.project.projectId], today) });
    }
    return { list: out, loading };
  }

  function economyView() {
    if (!econ.vault) return econLocked();
    const { list, loading } = econSummaries();
    if (loading) setTimeout(() => { if (!modalOpen()) render(); }, 700);
    const t = E.total(list.map((x) => x.s));
    const cls = (v) => (v !== null && v < 0 ? 'pp-num pp-error' : 'pp-num');
    return h('main', null,
      h('div', { class: 'pp-row pp-between pp-wrap' },
        h('p', { class: 'pp-muted' }, 'Все объекты. Договор, бюджет и поступления, внесённые здесь, видите только вы. Нажмите на объект, чтобы заполнить.' + (loading ? ' Загружаю объектов: ' + loading + '…' : '')),
        h('div', { class: 'pp-row' }, button('⬇ Excel', () => exportEconomy(list)), button('🔑 Сменить код', () => newEconCode()), button('🔒 Закрыть', () => lockEcon('Экономика закрыта'), 'pp-danger'))),
      h('section', { class: 'pp-card pp-row pp-wrap pp-totals' },
        h('div', null, h('small', null, 'Договоры'), h('strong', null, moneyOr(t.contract))),
        h('div', null, h('small', null, 'Потрачено'), h('strong', null, moneyOr(t.spent))),
        h('div', null, h('small', null, 'Получено'), h('strong', { class: 'pp-plus' }, moneyOr(t.received))),
        h('div', null, h('small', null, 'Просрочка по графику оплат'), h('strong', null, moneyOr(t.customerDebt))),
        h('div', null, h('small', null, 'Маржа (прогноз)'), h('strong', { class: t.marginForecast < 0 ? 'pp-error' : '' }, moneyOr(t.marginForecast)))),
      list.length ? h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table' },
        h('thead', null, h('tr', null, ['Объект', 'Готовность', 'Срок', 'Договор', 'Потрачено / бюджет', 'Получено', 'Просрочка по графику', 'Маржа (прогноз)', 'Внимание'].map((x) => h('th', null, x)))),
        h('tbody', null, list.map(({ path, s }) => h('tr', { class: 'pp-click', onclick: () => openWindow('econ', path) },
          h('td', null, h('button', { type: 'button', class: 'pp-link' }, s.name)),
          h('td', null, pct(s.progress) + (s.timeShare !== null ? ' из ' + pct(s.timeShare) + ' срока' : '')),
          h('td', { class: s.deadline && s.deadline < today ? 'pp-error' : '' }, s.deadline ? shortDate(s.deadline) : '—'),
          h('td', { class: 'pp-num' }, moneyOr(s.contract)),
          h('td', { class: 'pp-num' + (s.budget !== null && s.spent > s.budget ? ' pp-error' : '') }, money(s.spent) + (s.budget !== null ? ' / ' + money(s.budget) : '')),
          h('td', { class: 'pp-num' }, money(s.received)),
          h('td', { class: 'pp-num' }, moneyOr(s.customerDebt)),
          h('td', { class: cls(s.marginForecast) }, moneyOr(s.marginForecast)),
          h('td', null, s.alerts.length ? h('small', { class: 'pp-error' }, s.alerts.slice(0, 3).join(' · ')) : h('small', { class: 'pp-plus' }, 'в порядке'))))))) :
        h('p', { class: 'pp-card pp-muted' }, loading ? 'Загружаю объекты…' : 'Объектов нет.'),
      h('small', { class: 'pp-muted' }, 'Готовность — по плановым позициям ведомости, с весом по цене; если цены заполнены не везде — позиции имеют равный вес. Дополнительные объёмы не повышают готовность других работ. Прогноз затрат — ориентир по текущему темпу расходов; до 10% готовности — по бюджету. Сравнение со сроком предполагает равномерное выполнение. Просрочка считается только по введённому графику оплат.'));
  }

  function econView(w, c) {
    if (!econ.vault) return econLocked();
    const P = c.project, pid = P.projectId;
    const r = econ.data.projects[pid];
    const s = E.summary(P, r, today);
    const card = (label, value, cls, note) => h('div', null, h('small', null, label), h('strong', { class: cls || '' }, value), note ? h('small', { class: 'pp-muted' }, note) : null);
    const cats = M.CATEGORIES.filter(([k]) => (s.budgetMap[k] || 0) || (s.byCategory[k] || 0));
    return h('main', null,
      h('div', { class: 'pp-row pp-between pp-wrap' }, h('h2', null, s.name + (s.contractNo ? ' · договор № ' + s.contractNo : '') + (s.contractDate ? ' от ' + shortDate(s.contractDate) : '')),
        h('div', { class: 'pp-row' }, button('✎ Договор и бюджет', () => econForm(c), 'pp-primary'), button('💼 Все объекты', () => openWindow('economy', null)))),
      s.alerts.length ? h('p', { class: 'pp-error' }, '⚠ ' + s.alerts.join(' · ')) : null,
      h('section', { class: 'pp-card pp-row pp-wrap pp-totals' },
        card('Договор', moneyOr(s.contract)), card('Бюджет затрат', moneyOr(s.budget)),
        card('Потрачено', money(s.spent), s.budget !== null && s.spent > s.budget ? 'pp-error' : ''),
        card('Прогноз затрат', moneyOr(s.forecast)),
        card('Маржа по плану', moneyOr(s.marginPlan), s.marginPlan < 0 ? 'pp-error' : ''),
        card('Маржа (прогноз)', moneyOr(s.marginForecast), s.marginForecast < 0 ? 'pp-error' : 'pp-plus')),
      h('section', { class: 'pp-card pp-row pp-wrap pp-totals' },
        card('Выполнено (по ценам ведомости)', s.earned ? money(s.earned) : '—', '', 'готовность ' + pct(s.progress) + (s.timeShare !== null ? ', прошло ' + pct(s.timeShare) + ' срока' : '')),
        card('Принято по журналу', s.handedOver ? money(s.handedOver) : '—', '', 'оценка по ценам ведомости; не сумма подписанных КС-2'),
        card('Получено от заказчика', money(s.received), 'pp-plus', s.incomePrivate ? 'в т. ч. видно только вам: ' + money(s.incomePrivate) : null),
        card('Просрочка по графику', moneyOr(s.customerDebt), s.customerDebt ? 'pp-error' : '', 'этапы с прошедшим сроком минус поступления'),
        card('Выполнено сверх оплаты', money(s.workUnpaid), '', 'оценка по ведомости; срок оплаты определяется договором'),
        s.contractLeft !== null && s.contractLeft < 0 ? card('Получено сверх договора', money(-s.contractLeft), '', 'проверьте сумму договора или доп. соглашения') : card('Осталось получить по договору', moneyOr(s.contractLeft)),
        card('Деньги сейчас', money(s.cash), s.cash < 0 ? 'pp-error' : '', 'получено минус потрачено')),
      cats.length ? h('section', { class: 'pp-card' }, h('h3', null, 'Бюджет по статьям'), h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table' },
        h('thead', null, h('tr', null, ['Статья', 'Бюджет', 'Потрачено', 'Осталось'].map((x) => h('th', null, x)))),
        h('tbody', null, cats.map(([k, t]) => {
          const b = s.budgetMap[k] || 0, f = s.byCategory[k] || 0;
          return h('tr', null, h('td', null, t), h('td', { class: 'pp-num' }, b ? money(b) : '—'), h('td', { class: 'pp-num' }, money(f)), h('td', { class: 'pp-num' + (b && f > b ? ' pp-error' : '') }, b ? money(b - f) : '—'));
        }))))) : null,
      h('section', { class: 'pp-card' }, h('div', { class: 'pp-row pp-between' }, h('h3', null, 'График оплат по договору'), button('+ Этап', () => econItemForm(c, 'stages', null))),
        s.stages.length ? s.stages.map((x) => h('button', { type: 'button', class: 'pp-line', onclick: () => econItemForm(c, 'stages', x) },
          h('span', null, shortDate(x.date) + ' — ' + (x.title || 'этап')), h('strong', { class: x.date <= today ? '' : 'pp-muted' }, money(x.amountCents)))) : h('p', { class: 'pp-muted' }, 'Этапов нет — например «Аванс 30%», «После фундамента».'),
        s.stagesLate ? h('p', { class: 'pp-error' }, 'По графику уже должны были заплатить ещё ' + money(s.stagesLate)) : null),
      h('section', { class: 'pp-card' }, h('div', { class: 'pp-row pp-between' }, h('h3', null, 'Поступления, которые видите только вы'), button('+ Поступление', () => econItemForm(c, 'payments', null))),
        s.payments.length ? s.payments.map((x) => h('button', { type: 'button', class: 'pp-line', onclick: () => econItemForm(c, 'payments', x) },
          h('span', null, shortDate(x.date) + (x.title ? ' — ' + x.title : '')), h('strong', { class: 'pp-plus' }, '+' + money(x.amountCents)))) : null,
        h('small', { class: 'pp-muted' }, 'Поступления из «Финансов» объекта (' + money(s.incomeShared) + ') видит и прораб. Если прорабу не нужно знать об оплате — вносите её здесь, а не в «Финансах».')),
      s.note ? h('section', { class: 'pp-card' }, h('h3', null, 'Заметки'), h('p', null, s.note)) : null);
  }

  function econForm(c) {
    const P = c.project, pid = P.projectId;
    const r = econ.data.projects[pid] || {};
    const mIn = (cents) => h('input', { inputmode: 'decimal', value: cents ? String(cents / 100).replace('.', ',') : '' });
    const contract = mIn(r.contractCents), no = h('input', { value: r.contractNo || '' });
    const date = h('input', { type: 'date', value: r.contractDate ? dayToInput(r.contractDate) : '' });
    const note = h('textarea', { rows: 2 }, r.note || '');
    const budget = M.CATEGORIES.map(([k, t]) => ({ k, t, el: mIn((r.budget || {})[k]) }));
    const d = asyncDialog('Договор и бюджет', h('div', null,
      h('p', { class: 'pp-muted' }, '🏗️ ' + projName(c.path) + ' · видно только вам'),
      h('div', { class: 'pp-row pp-wrap' }, field('Сумма договора, ₽', contract), field('Номер договора', no), field('Дата', date)),
      h('h3', null, 'Бюджет затрат по статьям, ₽'), h('div', { class: 'pp-row pp-wrap' }, budget.map((b) => field(b.t, b.el))),
      field('Заметки', note)), async () => {
      const cc = parseMoney(contract.value);
      if (Number.isNaN(cc)) bad('Сумма договора — число, например 1500000 или 1500000,50');
      const map = {};
      for (const b of budget) { const v = parseMoney(b.el.value); if (Number.isNaN(v)) bad('Бюджет «' + b.t + '» — число'); if (v) map[b.k] = v; }
      await changedEcon((data) => E.setFields(data, pid, { name: P.project.name, contractCents: cc, contractNo: no.value.trim(), contractDate: date.value ? inputToDay(date.value) : null, note: note.value.trim(), budget: map }));
    });
    d.dataset.econ = '1';
  }

  function econItemForm(c, list, x) {
    const pid = c.project.projectId;
    const itemId = x ? x.id : S.newId();
    const date = h('input', { type: 'date', value: dayToInput(x ? x.date : today) });
    const amount = h('input', { inputmode: 'decimal', value: x ? String(x.amountCents / 100).replace('.', ',') : '' });
    const title = h('input', { value: x ? x.title : '', placeholder: list === 'stages' ? 'Аванс 30%' : 'Платёжное поручение №' });
    const d = asyncDialog(list === 'stages' ? 'Этап оплаты по договору' : 'Поступление (видно только вам)', h('div', null,
      h('div', { class: 'pp-row pp-wrap' }, field(list === 'stages' ? 'Срок оплаты' : 'Дата', date), field('Сумма, ₽', amount)), field(list === 'stages' ? 'Этап' : 'Комментарий', title)), async () => {
      const day = inputToDay(date.value), cents = parseMoney(amount.value);
      if (day === null) bad('Укажите дату');
      if (!cents || Number.isNaN(cents)) bad('Сумма — число больше нуля');
      await changedEcon((data) => E.saveItem(data, pid, list, { id: itemId, date: day, amountCents: cents, title: title.value }));
    }, { extra: x ? button('Удалить', async () => {
      if (!confirm('Удалить?')) return;
      try { await changedEcon((data) => E.deleteItem(data, pid, list, x.id)); d.remove(); } catch (e) { setStatus(e.message, true); }
    }, 'pp-danger') : null });
    d.dataset.econ = '1';
  }

  function exportEconomy(list) {
    const rows = [['Объект', 'Договор, ₽', 'Бюджет, ₽', 'Потрачено, ₽', 'Прогноз затрат, ₽', 'Выполнено, ₽', 'Получено, ₽', 'Просрочка по графику, ₽', 'Маржа по плану, ₽', 'Маржа (прогноз), ₽', 'Готовность, %', 'Срок сдачи', 'Внимание']];
    const rub = (v) => (v === null || v === undefined ? null : v / 100);
    for (const { s } of list) rows.push([s.name, rub(s.contract), rub(s.budget), rub(s.spent), rub(s.forecast), rub(s.earned), rub(s.received), rub(s.customerDebt), rub(s.marginPlan), rub(s.marginForecast),
      s.progress === null ? null : Math.round(s.progress * 100), s.deadline ? { date: s.deadline } : null, s.alerts.join('; ')]);
    const bytes = O.book([{ name: 'Экономика', header: true, widths: [30, 14, 14, 14, 14, 14, 14, 14, 14, 14, 10, 12, 40], rows }]);
    const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: 'Экономика ' + shortDate(today) + '.xlsx' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  // ───────── исполнительная документация (АОСР) ─────────
  // Лежит в папке объекта: «Исполнительная документация/участники.json», «…/АОСР/<id>.json» и документы Word рядом.
  const I = window.ProrabId;
  const DS = window.ProrabDocumentStore;
  const ID_DIR = 'Исполнительная документация';
  const idDir = (c) => c.path + '/' + ID_DIR;
  const idActs = (c) => idDir(c) + '/АОСР';

  /** Участники и акты объекта (загружаются при первом открытии окна). */
  function idState(c) {
    if (c.id) return c.id;
    const st = c.id = { loading: true, error: null, participants: I.emptyParticipants(), acts: [], certificates: [], templates: [], storage: new DS.Store(disk, idDir(c)), root: ROOT };
    st.storage.onVerified = (path, bytes) => fixFile(c, path.slice(c.path.length + 1), bytes);
    (async () => {
      try {
        const text = await st.storage.disk.getText(idDir(c) + '/участники.json');
        if (text !== null) st.participants = I.validateParticipants(JSON.parse(text));
        st.acts = await st.storage.records('АОСР');
        st.certificates = (await st.storage.records('КС')).map(I.validateCertificate);
        st.templates = await listTemplates(c);
      } catch (e) { st.error = e.message; }
      st.loading = false;
      if (!modalOpen()) render();
    })();
    return st;
  }

  async function saveParticipants(c, value) {
    const st = c.id;
    const saved = await st.storage.participants(value || st.participants);
    st.participants = saved;
    afterDocument(c);
  }

  async function saveAct(c, act, filled, participants) {
    const st = c.id;
    const d = participants || act.participantsSnapshot || st.participants;
    const project = act.projectSnapshot || c.project.project;
    const bytes = filled || O.richDocx(I.blocks(act, d, project));
    const saved = await st.storage.act(act, d, project, bytes);
    st.acts = st.acts.filter((a) => a.id !== saved.id).concat([saved]);
    Object.assign(act, saved);
    afterDocument(c);
    return saved.docx;
  }

  function idView(w, c) {
    const st = idState(c);
    if (st.loading) return h('p', { class: 'pp-muted' }, 'Загружаю исполнительную документацию…');
    if (st.error) return h('div', null, h('p', { class: 'pp-error' }, st.error), button('Повторить', () => { c.id = null; render(); }));
    w.tab = w.tab || 'acts';
    const tabs = [['acts', 'Акты скрытых работ (АОСР)'], ['ojr', 'Общий журнал работ'], ['ks', 'КС-2 и КС-3'], ['people', 'Участники строительства'], ['templates', 'Свои шаблоны']];
    const d = st.participants;
    let body;
    if (w.tab === 'acts') {
      const acts = st.acts.slice().sort((a, b) => (parseInt(b.number, 10) || 0) - (parseInt(a.number, 10) || 0));
      const ready = I.orgs(d, 'customer').length && I.orgs(d, 'builder').length;
      body = h('div', null,
        h('div', { class: 'pp-row pp-between pp-wrap' },
          h('p', { class: 'pp-muted' }, 'Работы, объёмы и даты берутся из журнала, участники — из вкладки «Участники строительства». Акт сохраняется документом Word в «' + ID_DIR + '/АОСР» и открывается в Яндекс Документах для печати.'),
          h('div', { class: 'pp-row' }, acts.length ? button('⬇ Реестр Excel', () => exportActs(c)) : null, button('+ АОСР', () => aosrForm(c, null, {}), 'pp-primary'))),
        !ready ? h('p', { class: 'pp-card pp-error' }, 'Сначала заполните участников: застройщика (заказчика) и лицо, осуществляющее строительство, и их представителей.') : null,
        acts.length ? h('section', { class: 'pp-card' }, acts.map((a) => h('button', { type: 'button', class: 'pp-line', onclick: () => aosrForm(c, a, {}) },
          h('span', null, 'АОСР № ' + a.number + ' от ' + (a.date ? shortDate(a.date) : '—') + ' — ' + (String(a.works || '').split('\n')[0] || 'без названия')),
          h('small', null, [a.start && a.end ? 'работы ' + shortDate(a.start) + '–' + shortDate(a.end) : '', a.next ? 'далее: ' + a.next : ''].filter(Boolean).join(' · ')),
          h('strong', { class: a.signed ? 'pp-plus' : 'pp-muted' }, a.signed ? 'подписан' : 'черновик')))) :
          h('p', { class: 'pp-card pp-muted' }, 'Актов пока нет. Нажмите «+ АОСР» или «Оформить АОСР» в журнале приёмки.'));
    } else if (w.tab === 'templates') {
      body = templatesTab(c);
    } else if (w.tab === 'ojr') {
      body = ojrTab(w, c);
    } else if (w.tab === 'ks') {
      body = ksTab(w, c);
    } else {
      body = h('div', { class: 'pp-columns' },
        h('section', { class: 'pp-card' }, h('div', { class: 'pp-row pp-between' }, h('h3', null, 'Организации'), button('+ Организация', () => orgForm(c, null))),
          I.ORG_ROLES.map(([role, title]) => h('div', null, h('small', { class: 'pp-muted' }, title),
            I.orgs(d, role).length ? I.orgs(d, role).map((o) => h('button', { type: 'button', class: 'pp-line', onclick: () => orgForm(c, o) }, h('span', null, o.name), h('small', null, [o.inn ? 'ИНН ' + o.inn : '', o.sro ? 'СРО' : ''].filter(Boolean).join(' · ')))) :
              h('p', { class: 'pp-muted' }, '—')))),
        h('section', { class: 'pp-card' }, h('div', { class: 'pp-row pp-between' }, h('h3', null, 'Представители (подписывают акты)'), button('+ Представитель', () => repForm(c, null))),
          I.REP_ROLES.map(([role, title]) => {
            const list = I.reps(d, role);
            return list.length ? h('div', null, h('small', { class: 'pp-muted' }, title), list.map((r) => h('button', { type: 'button', class: 'pp-line', onclick: () => repForm(c, r) },
              h('span', null, r.fio + (r.position ? ', ' + r.position : '')), h('small', null, [r.nrs ? 'НРС ' + r.nrs : '', r.order].filter(Boolean).join(' · '))))) : null;
          }),
          h('small', { class: 'pp-muted' }, 'Для представителей по строительному контролю нужен идентификационный номер в национальном реестре специалистов (НРС). Реквизиты документа о полномочиях — например «приказ № 12 от 10.01.2026».')));
    }
    return h('main', null, h('div', { class: 'pp-row pp-wrap' }, button('📁 Открыть файлы на Диске', () => window.open(D.webFolder(idDir(c)), '_blank', 'noopener')), button('⟳ Обновить', () => { if (st.storage.busy || st.generating) return; c.id = null; render(); })), h('div', { class: 'pp-tabs' }, tabs.map(([k, t]) => h('button', { type: 'button', class: 'pp-tab' + (w.tab === k ? ' pp-active' : ''), onclick: () => { w.tab = k; render(); } }, t))), body);
  }

  function orgForm(c, o) {
    const d = JSON.parse(JSON.stringify(c.id.participants));
    const role = h('select', null, I.ORG_ROLES.map(([k, t]) => h('option', { value: k }, t)));
    role.value = o ? o.role : 'performer';
    const inp = (v, ph) => h('input', { value: v || '', placeholder: ph || '' });
    const name = inp(o && o.name, 'ООО «СтройМонтаж»'), ogrn = inp(o && o.ogrn), inn = inp(o && o.inn), okpo = inp(o && o.okpo), address = inp(o && o.address), phone = inp(o && o.phone);
    const sro = inp(o && o.sro), sroOgrn = inp(o && o.sroOgrn), sroInn = inp(o && o.sroInn);
    // Подсказка из справочника исполнителей объекта
    const known = h('datalist', { id: 'pp-org-names' }, c.project.contractors().map((x) => h('option', { value: x.name })));
    name.setAttribute('list', 'pp-org-names');
    asyncDialog(o ? 'Организация' : 'Новая организация', h('div', null, field('Роль в актах', role), field('Наименование (или ФИО предпринимателя)', name), known,
      h('div', { class: 'pp-row pp-wrap' }, field('ОГРН / ОГРНИП', ogrn), field('ИНН', inn), field('ОКПО', okpo, 'для КС-2 и КС-3')), field('Адрес (место нахождения)', address), field('Телефон', phone),
      h('h3', null, 'Саморегулируемая организация (если член СРО)'), field('Наименование СРО', sro), h('div', { class: 'pp-row pp-wrap' }, field('ОГРН СРО', sroOgrn), field('ИНН СРО', sroInn))), async () => {
      I.saveOrg(d, { id: o ? o.id : null, role: role.value, name: name.value, ogrn: ogrn.value.replace(/\s/g, ''), inn: inn.value.replace(/\s/g, ''), okpo: okpo.value.replace(/\s/g, ''), address: address.value, phone: phone.value, sro: sro.value, sroOgrn: sroOgrn.value.replace(/\s/g, ''), sroInn: sroInn.value.replace(/\s/g, '') });
      await saveParticipants(c, d);
      render();
    }, { extra: o ? button('Удалить', async () => { if (!confirm('Удалить организацию «' + o.name + '»? В уже сохранённых актах она останется.')) return; I.remove(d, 'orgs', o.id); await saveParticipants(c, d); document.querySelector('.pp-modal').remove(); render(); }, 'pp-danger') : null });
  }

  function repForm(c, r) {
    const d = JSON.parse(JSON.stringify(c.id.participants));
    const role = h('select', null, I.REP_ROLES.map(([k, t]) => h('option', { value: k }, t)));
    role.value = r ? r.role : 'builder';
    const org = h('select', null, h('option', { value: '' }, '—'), I.orgs(d).map((o) => h('option', { value: o.id }, o.name)));
    org.value = r && r.orgId ? r.orgId : '';
    const inp = (v, ph) => h('input', { value: v || '', placeholder: ph || '' });
    const fio = inp(r && r.fio, 'Иванов И. И.'), position = inp(r && r.position, 'начальник участка'), nrs = inp(r && r.nrs, 'С-16-123456'), order = inp(r && r.order, 'приказ № 12 от 10.01.2026');
    asyncDialog(r ? 'Представитель' : 'Новый представитель', h('div', null, field('Кого представляет в акте', role), field('Организация', org),
      h('div', { class: 'pp-row pp-wrap' }, field('Фамилия, инициалы', fio), field('Должность', position)),
      field('Идентификационный номер в НРС', nrs, 'для представителей по строительному контролю'), field('Документ о полномочиях', order)), async () => {
      I.saveRep(d, { id: r ? r.id : null, role: role.value, orgId: org.value || null, fio: fio.value, position: position.value, nrs: nrs.value, order: order.value });
      await saveParticipants(c, d);
      render();
    }, { extra: r ? button('Удалить', async () => { if (!confirm('Удалить представителя ' + r.fio + '? В уже сохранённых актах он останется.')) return; I.remove(d, 'reps', r.id); await saveParticipants(c, d); document.querySelector('.pp-modal').remove(); render(); }, 'pp-danger') : null });
  }

  /** Форма АОСР. a — сохранённый акт или null (новый); opts.itemId — из позиции ведомости / приёмки. */
  function aosrForm(c, a, opts) {
    const st = idState(c);
    if (st.loading) { setStatus('Загружаю исполнительную документацию…'); const t = setInterval(() => { if (!st.loading) { clearInterval(t); aosrForm(c, a, opts); } }, 200); return; }
    if (st.error) { alert(st.error); return; }
    const P = c.project, d = JSON.parse(JSON.stringify(a && a.participantsSnapshot || st.participants));
    const act = a ? JSON.parse(JSON.stringify(a)) : Object.assign(I.draft(P, d, { itemId: opts.itemId, entryIds: opts.entryIds, to: opts.to, today }), { id: S.newId(), number: I.nextNumber(st.acts) });
    const items = P.boq();
    const itemSel = h('select', null, h('option', { value: '' }, '— не из ведомости —'), items.map((r) => h('option', { value: r.id }, r.name + (r.fact ? ' (сделано ' + num(r.fact) + ' ' + r.unit + ')' : ''))));
    itemSel.value = act.itemId || '';
    const from = h('input', { type: 'date', value: act.start ? dayToInput(act.start) : '' });
    const to = h('input', { type: 'date', value: act.end ? dayToInput(act.end) : '' });
    const ta = (v, rows) => h('textarea', { rows: rows || 2 }, v || '');
    const number = h('input', { value: String(act.number || ''), inputmode: 'numeric' });
    const date = h('input', { type: 'date', value: act.date ? dayToInput(act.date) : dayToInput(today) });
    const place = h('input', { value: act.place || '', placeholder: 'г. Казань' });
    const works = ta(act.works, 3), project = ta(act.project), materials = ta(act.materials), documents = ta(act.documents), norms = ta(act.norms), next = ta(act.next), extra = ta(act.extra), annexes = ta(act.annexes);
    const copies = h('input', { value: String(act.copies || 3), inputmode: 'numeric' });
    const performer = h('select', null, h('option', { value: '' }, '—'), I.orgs(d, 'performer').map((o) => h('option', { value: o.id }, o.name)));
    performer.value = act.performerId || '';
    const repBoxes = I.reps(d).map((r) => { const b = h('input', { type: 'checkbox' }); b.checked = act.repIds.includes(r.id); return [r, b]; });
    const signed = h('input', { type: 'checkbox' }); signed.checked = !!act.signed;
    const forms = (st.templates || []).filter((t) => t.kind === 'docx');
    const form = h('select', null, h('option', { value: '' }, 'Встроенная форма АОСР'), forms.map((t) => h('option', { value: t.path }, '📝 ' + t.title + (t.scope === 'common' ? ' (общий)' : ''))));
    form.value = forms.some((t) => t.path === (act.template || d.defaults.aosrTemplate)) ? act.template || d.defaults.aosrTemplate : '';
    const fill = () => {
      const dr = I.draft(P, d, { itemId: itemSel.value || null, from: from.value ? inputToDay(from.value) : null, to: to.value ? inputToDay(to.value) : null, today });
      if (!dr.works) return alert('В журнале нет записей по этой позиции за выбранные даты.');
      works.value = dr.works; act.entryIds = dr.entryIds; if (dr.next) next.value = dr.next;
      from.value = dr.start ? dayToInput(dr.start) : ''; to.value = dr.end ? dayToInput(dr.end) : '';
      if (dr.performerId) { performer.value = dr.performerId; repBoxes.forEach(([r, b]) => { if (r.role === 'performer') b.checked = r.orgId === dr.performerId; }); }
    };
    const collect = () => {
      const n = parseInt(number.value, 10);
      if (!n || n < 1) bad('Номер акта — число');
      if (st.acts.some((x) => x.id !== act.id && parseInt(x.number, 10) === n)) bad('Акт № ' + n + ' уже есть на этом объекте');
      return Object.assign(act, {
        number: n, date: inputToDay(date.value) || today, place: place.value.trim(), itemId: itemSel.value || null, works: works.value.trim(), project: project.value.trim(),
        materials: materials.value.trim(), documents: documents.value.trim(), norms: norms.value.trim(), next: next.value.trim(), extra: extra.value.trim(), annexes: annexes.value.trim(),
        start: from.value ? inputToDay(from.value) : null, end: to.value ? inputToDay(to.value) : null, copies: parseInt(copies.value, 10) || 3,
        performerId: performer.value || null, repIds: repBoxes.filter(([, b]) => b.checked).map(([r]) => r.id), signed: signed.checked,
      });
    };
    const warn = h('p', { class: 'pp-error' });
    const showMissing = () => { try { const m = I.missing(collect(), d); warn.textContent = m.length ? 'Не заполнено: ' + m.join('; ') + '. Акт можно сохранить черновиком.' : ''; } catch (e) { warn.textContent = e.message; } };
    const dlg = asyncDialog((a ? 'АОСР № ' + a.number : 'Новый АОСР') + ' · ' + projName(c.path), h('div', { class: 'pp-aosr' },
      a && a.docx ? button('Открыть сохранённый документ Word', () => window.open(D.webEdit(idActs(c) + '/' + a.docx), '_blank', 'noopener')) : null,
      h('div', { class: 'pp-row pp-wrap' }, field('№ акта', number), field('Дата акта', date), field('Место составления', place)),
      field('Форма документа', form, forms.length ? 'свои шаблоны — во вкладке «Свои шаблоны»' : 'можно загрузить свою форму во вкладке «Свои шаблоны»'),
      h('h3', null, 'Откуда работы'),
      h('div', { class: 'pp-row pp-wrap' }, field('Позиция ведомости', itemSel), field('С', from), field('По', to)),
      button('Заполнить из журнала', fill), h('small', { class: 'pp-muted' }, ' — работы с объёмом, даты начала и окончания, исполнитель и следующая позиция ведомости.'),
      field('1. Предъявленные работы', works), field('2. Проектная документация (шифр, листы, разработчик)', project), field('3. Применённые материалы (с документами о качестве)', materials),
      field('4. Документы, подтверждающие соответствие (исполнительные схемы, испытания)', documents),
      field('6. Работы выполнены в соответствии с (СП, ГОСТ, разделы проекта)', norms), field('7. Разрешается производство последующих работ', next),
      field('Дополнительные сведения', extra), h('div', { class: 'pp-row pp-wrap' }, field('Экземпляров', copies), field('Приложения', annexes)),
      h('h3', null, 'Участники'), field('Лицо, выполнившее работы', performer),
      h('div', { class: 'pp-catalog' }, repBoxes.length ? repBoxes.map(([r, b]) => h('label', { class: 'pp-check' }, b, ' ' + r.fio + ' — ' + I.roleTitle(I.REP_ROLES, r.role).toLowerCase())) : h('p', { class: 'pp-muted' }, 'Представителей нет — добавьте их во вкладке «Участники строительства».')),
      h('label', { class: 'pp-check' }, signed, ' Акт подписан всеми сторонами'), warn), async () => {
      collect();
      act.template = form.value || null;
      let filled = null, missingLabels = [];
      if (act.template) {
        const buf = await st.storage.disk.getBytes(act.template);
        if (!buf) bad('Шаблон не найден на Диске: ' + act.template);
        const res = await T.fill(new Uint8Array(buf), T.values(P, d, act, today), 'docx');
        filled = res.bytes; missingLabels = res.missing;
      }
      const missing = I.missing(act, d);
      if (act.signed && (missing.length || missingLabels.length)) bad('Проверьте обязательные поля и метки перед отметкой о подписании: ' + missing.concat(missingLabels).join('; '));
      const name = await saveAct(c, act, filled, d);
      // Запомнить общие значения для следующих актов
      I.setDefaults(d, { place: act.place, project: act.project, norms: act.norms, documents: act.documents, copies: act.copies, aosrTemplate: act.template });
      await saveParticipants(c, d).catch(() => {}); // акт уже подтверждён; настройки следующих актов вторичны
      setStatus('Акт сохранён: ' + ID_DIR + '/АОСР/' + name + (missingLabels.length ? ' · в шаблоне незнакомые метки: ' + missingLabels.join(', ') : ''), missingLabels.length > 0);
      window.open(D.webEdit(idActs(c) + '/' + name), '_blank', 'noopener');
      render();
    }, { okText: 'Сохранить и открыть в Word', busyText: 'Сохраняю на Диск…', extra: a && !a.signed ? button('Удалить черновик', async () => {
      if (!confirm('Удалить АОСР № ' + a.number + '? Документ Word уйдёт в корзину Яндекс Диска.')) return;
      try {
        await st.storage.run(async () => {
          const latest = (await st.storage.records('АОСР')).find((x) => x.id === a.id);
          if (!latest || latest.signed || latest.updatedAt !== a.updatedAt) throw new Error('Акт изменился. Обновите список.');
          await st.storage.disk.remove(idActs(c) + '/' + a.id + '.json');
          if (a.docx) await st.storage.disk.remove(idActs(c) + '/' + a.docx);
        });
        st.acts = st.acts.filter((x) => x.id !== a.id);
        dlg.remove(); render();
      } catch (e) { alert(e.message); }
    }, 'pp-danger') : null });
    dlg.addEventListener('input', showMissing); dlg.addEventListener('change', showMissing);
    showMissing();
  }

  // ───────── КС-2 и КС-3 ─────────
  function monthStart(day) { const x = new Date(day * 86400000); return Math.round(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1) / 86400000); }

  function ksTab(w, c) {
    const st = c.id, d = st.participants, P = c.project;
    const set = (d.defaults && d.defaults.ks) || {};
    w.ks = w.ks || { from: monthStart(today), to: today };
    const from = h('input', { type: 'date', value: w.ks.from !== null ? dayToInput(w.ks.from) : '' });
    const to = h('input', { type: 'date', value: dayToInput(w.ks.to) });
    const apply = () => { w.ks.from = from.value ? inputToDay(from.value) : null; w.ks.to = to.value ? inputToDay(to.value) : today; render(); };
    from.addEventListener('change', apply); to.addEventListener('change', apply);
    let k;
    try { k = I.ksRows(P, w.ks.from, w.ks.to); } catch (e) { k = { rows: [], noPrice: [], total: 0, error: e.message }; }
    const vat = I.vat(k.total, set.vatRate === undefined ? null : set.vatRate, !!set.vatIncluded);
    return h('div', null,
      h('section', { class: 'pp-card' },
        h('p', null, 'КС-2 — объёмы за период из журнала по ценам ведомости. КС-3 — сохранённые суммы ранее предъявленных КС-2 и текущего акта. Прежние суммы не меняются при редактировании журнала или цен. Перед подачей проверьте комплект у ПТО и бухгалтера.'),
        h('div', { class: 'pp-row pp-wrap' }, field('Отчётный период с', from), field('по', to),
          button('Этот месяц', () => { w.ks = { from: monthStart(today), to: today }; render(); }),
          button('Прошлый месяц', () => { const e = monthStart(today) - 1; w.ks = { from: monthStart(e), to: e }; render(); })),
        h('div', { class: 'pp-row pp-wrap' }, button('⚙ Договор и НДС', () => ksSettings(c)), button('📑 Сформировать КС-2 и КС-3', () => ksMake(c, w), 'pp-primary'), button('⬇ Объёмы КС-2 в Excel', () => ksExcel(c, w))),
        h('small', { class: 'pp-muted' }, (set.contractNo ? 'Договор № ' + set.contractNo + (set.contractDate ? ' от ' + shortDate(set.contractDate) : '') : 'Номер договора не указан') + ' · ' +
          (set.vatRate === undefined ? 'НДС ещё не выбран' : set.vatRate === null ? 'без НДС' : 'НДС ' + (set.vatRate === undefined ? null : set.vatRate) + '%' + (set.vatIncluded ? ' (в ценах)' : ' сверху')))),
      k.error ? h('p', { class: 'pp-error' }, k.error) : null,
      ksRegistry(c),
      k.noPrice.length ? h('section', { class: 'pp-card' }, h('p', { class: 'pp-error' }, 'Нет цены — формирование остановлено до заполнения цен:'),
        k.noPrice.map((r) => h('button', { type: 'button', class: 'pp-line', onclick: () => boqForm(c, r.itemId) }, h('span', null, r.name), h('strong', null, num(r.qty) + ' ' + r.unit)))) : null,
      h('section', { class: 'pp-card' }, h('h3', null, 'За период'),
        k.rows.length ? h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table' },
          h('thead', null, h('tr', null, ['№', 'Работа', 'Кол-во', 'Ед.', 'Цена', 'Стоимость'].map((t) => h('th', null, t)))),
          h('tbody', null, k.rows.map((r, i) => h('tr', null, h('td', null, String(i + 1)), h('td', null, r.name), h('td', { class: 'pp-num' }, num(r.qty)), h('td', null, r.unit), h('td', { class: 'pp-num' }, money(r.price)), h('td', { class: 'pp-num' }, money(r.sum))))),
          h('tfoot', null, h('tr', null, h('td', null, ''), h('th', null, 'Итого'), h('td', null, ''), h('td', null, ''), h('td', null, ''), h('th', { class: 'pp-num' }, money(k.total))),
            vat.vat ? h('tr', null, h('td', null, ''), h('td', null, set.vatIncluded ? 'В том числе НДС' : 'НДС сверху'), h('td', null, ''), h('td', null, ''), h('td', null, ''), h('td', { class: 'pp-num' }, money(vat.vat))) : null,
            vat.vat ? h('tr', null, h('td', null, ''), h('th', null, 'Всего с НДС'), h('td', null, ''), h('td', null, ''), h('td', null, ''), h('th', { class: 'pp-num' }, money(vat.all))) : null))) :
          h('p', { class: 'pp-muted' }, 'За этот период в журнале нет работ по позициям с ценой.')));
  }

  function ksSettings(c) {
    const d = JSON.parse(JSON.stringify(c.id.participants)), P = c.project;
    const set = (d.defaults && d.defaults.ks) || {};
    const cardNo = (P.fields().find((f) => T.norm(f.name) === 'НОМЕР ДОГОВОРА') || {}).value || '';
    const no = h('input', { value: set.contractNo || cardNo });
    const date = h('input', { type: 'date', value: set.contractDate ? dayToInput(set.contractDate) : '' });
    const stroyka = h('input', { value: set.stroyka || '', placeholder: 'если отличается от названия объекта' });
    const value = h('input', { inputmode: 'decimal', value: set.contractValue ? String(set.contractValue / 100).replace('.', ',') : '', placeholder: 'необязательно' });
    const rate = h('select', null, [['choose', 'Выберите режим НДС'], ['22', 'НДС 22%'], ['20', 'НДС 20%'], ['10', 'НДС 10%'], ['7', 'НДС 7%'], ['5', 'НДС 5%'], ['0', 'НДС 0%'], ['', 'Без НДС']].map(([v, t]) => h('option', { value: v }, t)));
    rate.value = set.vatRate === undefined ? 'choose' : set.vatRate === null ? '' : String(set.vatRate);
    const incl = h('input', { type: 'checkbox' }); incl.checked = !!set.vatIncluded;
    const reps = I.reps(d);
    const sel = (role, value) => { const s2 = h('select', null, h('option', { value: '' }, '—'), reps.map((r) => h('option', { value: r.id }, r.fio + ' — ' + I.roleTitle(I.REP_ROLES, r.role).toLowerCase()))); s2.value = value || ((reps.find((r) => r.role === role) || {}).id || ''); return s2; };
    const from = sel('builder', set.signFrom), toR = sel('customerControl', set.signTo);
    asyncDialog('КС-2 и КС-3: договор и НДС', h('div', null,
      h('div', { class: 'pp-row pp-wrap' }, field('Номер договора подряда', no), field('Дата договора', date)), field('Стройка', stroyka), field('Сметная (договорная) стоимость, ₽', value),
      h('div', { class: 'pp-row pp-wrap' }, field('НДС', rate), h('label', { class: 'pp-check' }, incl, ' Цены в ведомости уже с НДС')),
      h('p', { class: 'pp-muted' }, 'Ставку НДС проверьте у бухгалтера: с 2026 года основная ставка — 22%.'),
      h('div', { class: 'pp-row pp-wrap' }, field('Сдал (подрядчик)', from), field('Принял (заказчик)', toR)),
      h('p', { class: 'pp-muted' }, 'Подписантов добавляют во вкладке «Участники строительства» → «+ Представитель»: ФИО, должность и организация. Затем выберите их здесь.')), async () => {
      if (rate.value === 'choose') bad('Выберите НДС по вашему договору.');
      const v = parseMoney(value.value);
      if (Number.isNaN(v)) bad('Стоимость — число');
      I.setDefaults(d, { ks: Object.assign({}, set, { contractNo: no.value.trim(), contractDate: date.value ? inputToDay(date.value) : null, stroyka: stroyka.value.trim(), contractValue: v,
        vatRate: rate.value === '' ? null : Number(rate.value), vatIncluded: incl.checked, signFrom: from.value || null, signTo: toR.value || null }) });
      await saveParticipants(c, d);
      render();
    });
  }

  function ksOpts(c, w, number) {
    const d = c.id.participants, set = (d.defaults && d.defaults.ks) || {};
    const rep = (id) => I.reps(d).find((r) => r.id === id) || null;
    return { number, date: today, from: w.ks.from, to: w.ks.to, contractNo: set.contractNo, contractDate: set.contractDate, stroyka: set.stroyka, contractValue: set.contractValue,
      vatRate: set.vatRate === undefined ? null : set.vatRate, vatIncluded: !!set.vatIncluded,
      signFrom: rep(set.signFrom) || I.reps(d, 'builder')[0] || null, signTo: rep(set.signTo) || I.reps(d, 'customerControl')[0] || null };
  }

  async function ksMake(c, w) {
    const st = c.id, P = c.project;
    if (st.storage.busy || st.generating) return;
    const d = JSON.parse(JSON.stringify(st.participants));
    const set = (d.defaults && d.defaults.ks) || {};
    if (set.vatRate === undefined || !set.contractNo) { alert('Сначала заполните договор и выберите НДС.'); ksSettings(c); return; }
    const n = (prompt('Номер новой КС-2 и КС-3', String((set.lastNumber || 0) + 1)) || '').trim();
    if (!n) return;
    st.generating = true;
    try {
      setStatus('Собираю КС-2 и КС-3…');
      const opts = ksOpts(c, w, n);
      const record = I.certificate(P, d, opts);
      const existing = await st.storage.records('КС');
      record.ledger = I.certificateLedger(existing, record);
      opts.certificate = record;
      const period = shortDate(record.from) + '–' + shortDate(record.to);
      const suffix = ' — ' + record.id;
      const safe = (name) => name.replace(/[\\/:*?"<>|]/g, '_');
      record.docx = safe('КС-2 №' + n + ' за ' + period + suffix) + '.docx';
      record.ks3 = safe('КС-3 №' + n + ' за ' + period + suffix) + '.docx';
      const files = [
        { name: record.docx, bytes: O.richDocx(I.ks2Blocks(P, d, opts).blocks, { landscape: true }) },
        { name: record.ks3, bytes: O.richDocx(I.ks3Blocks(P, d, opts).blocks, { landscape: true }) },
      ];
      await st.storage.generated('КС', files, record);
      st.certificates = existing.concat([record]);
      I.setDefaults(d, { ks: Object.assign({}, set, { lastNumber: Math.max(parseInt(n, 10) || 0, set.lastNumber || 0) }) });
      await saveParticipants(c, d).catch(() => {});
      setStatus('КС-2 и КС-3 сохранены. После фактической подачи отметьте КС-2 как предъявленную в реестре.');
      render();
      window.open(D.webEdit(idDir(c) + '/КС/' + record.docx), '_blank', 'noopener');
    } catch (e) { alert(e.message); setStatus('Документы не завершены: ' + e.message, true); }
    finally { st.generating = false; }
  }

  function ksRegistry(c) {
    const st = c.id;
    return h('section', { class: 'pp-card' }, h('div', { class: 'pp-row pp-between pp-wrap' }, h('h3', null, 'Реестр КС-2'), button('+ Ранее предъявленная КС-2', () => importCertificate(c))),
      h('p', { class: 'pp-muted' }, 'В накопление входят только предъявленные КС-2 по этому договору. Суммы сохранены на дату формирования. Отметка не отправляет документы заказчику. КС-3 показывает ранее предъявленное, текущую сумму и общий итог. Если меняли суммы в Word, внесите окончательные суммы через «Ранее предъявленная КС-2», оставив исходный комплект черновиком.'),
      st.certificates.length ? st.certificates.slice().sort((a, b) => a.to - b.to).map((r) => h('div', { class: 'pp-line' },
        h('span', null, 'КС-2 № ' + r.number + ' · ' + shortDate(r.from) + '–' + shortDate(r.to)),
        h('strong', null, money(r.totals.all)), h('small', null, r.status === 'issued' ? 'предъявлена' : 'черновик'),
        h('span', { class: 'pp-row pp-wrap' },
          r.docx ? button('КС-2', () => window.open(D.webEdit(idDir(c) + '/КС/' + r.docx), '_blank', 'noopener')) : null,
          r.ks3 ? button('КС-3', () => window.open(D.webEdit(idDir(c) + '/КС/' + r.ks3), '_blank', 'noopener')) : null,
          r.status === 'draft' ? button('Отметить предъявленной', async () => {
            if (!confirm('КС-2 № ' + r.number + ' на ' + money(r.totals.all) + ' уже подана заказчику? Она войдёт в накопление следующих КС-3.')) return;
            try {
              const saved = await st.storage.issue(r);
              st.certificates = st.certificates.map((x) => x.id === saved.id ? saved : x);
              afterDocument(c);
              setStatus('КС-2 № ' + saved.number + ' учтена как предъявленная.'); render();
            } catch (e) { alert(e.message); }
          }) : null))) : h('p', { class: 'pp-muted' }, 'Предыдущие КС-2 ещё не внесены. Если подавали их раньше — добавьте перед формированием новой КС.'));
  }

  function importCertificate(c) {
    const st = c.id, settings = st.participants.defaults.ks || {};
    if (!settings.contractNo) { alert('Сначала укажите договор в настройках КС.'); return; }
    const number = h('input'), from = h('input', { type: 'date' }), to = h('input', { type: 'date' }), date = h('input', { type: 'date', value: dayToInput(today) });
    const amount = h('input', { inputmode: 'decimal' }), tax = h('input', { inputmode: 'decimal', value: '0' });
    asyncDialog('Ранее предъявленная КС-2', h('div', null,
      h('p', null, 'Вносите прежние КС-2 по порядку: от первой к последней. Перенесите суммы из документа по договору № ' + settings.contractNo + '. Эти суммы не будут пересчитываться из журнала.'),
      field('Номер КС-2', number), field('Дата КС-2', date), field('Период с', from), field('Период по', to),
      field('Всего с НДС, ₽', amount), field('В том числе НДС, ₽', tax, 'точная сумма из прежней КС; при освобождении — 0')), async () => {
      const all = parseMoney(amount.value), vat = parseMoney(tax.value);
      if (!number.value.trim() || all == null || !Number.isSafeInteger(all) || !Number.isSafeInteger(vat) || vat < 0 || vat > all) bad('Проверьте номер и суммы.');
      const record = { version: 1, id: S.newId(), number: number.value.trim(), status: 'issued', imported: true, issuedAt: Date.now(),
        date: inputToDay(date.value), from: inputToDay(from.value), to: inputToDay(to.value), contractKey: I.contractKey(settings), contractNo: settings.contractNo,
        rows: [], totals: { base: all - vat, vat, all } };
      if (!from.value || !to.value || !date.value) bad('Укажите даты и период.');
      I.validateCertificate(record);
      const existing = await st.storage.records('КС');
      I.certificatePrevious(existing, record);
      await st.storage.generated('КС', [], record);
      st.certificates = existing.concat([record]); afterDocument(c); render();
    }, { okText: 'Внести в накопление' });
  }

  function ksExcel(c, w) {
    let k;
    try { k = I.ksRows(c.project, w.ks.from, w.ks.to); if (k.noPrice.length) throw new Error('Сначала заполните цены всех работ.'); } catch (e) { alert(e.message); return; }
    const rows = [['№ по порядку', '№ позиции', 'Наименование работ', 'Ед. изм.', 'Количество', 'Цена за ед., ₽', 'Стоимость, ₽']]
      .concat(k.rows.map((r, i) => [i + 1, r.pos, r.name, r.unit, r.qty, r.price / 100, r.sum / 100]), [[null, null, 'Итого', null, null, null, k.total / 100]]);
    const bytes = O.book([{ name: 'КС-2', header: true, widths: [8, 10, 60, 10, 12, 16, 18], rows }]);
    const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: ('Расшифровка КС-2 ' + (c.project.project.name || '') + ' ' + shortDate(w.ks.to)).replace(/[\\/:*?"<>|]/g, '_') + '.xlsx' });
    document.body.append(a); a.click(); a.remove();
  }

  // ───────── общий журнал работ ─────────
  function ojrTab(w, c) {
    const st = c.id, d = st.participants;
    const set = (d.defaults && d.defaults.ojr) || {};
    const p = c.project.project;
    w.ojr = w.ojr || { from: null, to: today };
    const from = h('input', { type: 'date', value: w.ojr.from !== null ? dayToInput(w.ojr.from) : '' });
    const to = h('input', { type: 'date', value: dayToInput(w.ojr.to || today) });
    from.addEventListener('change', () => { w.ojr.from = from.value ? inputToDay(from.value) : null; });
    to.addEventListener('change', () => { w.ojr.to = to.value ? inputToDay(to.value) : today; });
    const rows = I.ojrWorkRows(c.project, w.ojr.from, w.ojr.to);
    return h('div', null,
      h('section', { class: 'pp-card' },
        h('p', null, 'Общий журнал собирается из того, что уже ведётся: титульный лист — из карточки объекта и участников строительства; раздел 3 (выполнение работ) — из журнала по дням с объёмами, погодой и исполнителями; раздел 4 (строительный контроль) — из замечаний и пометок на чертежах; раздел 5 — из АОСР.'),
        h('p', { class: 'pp-muted' }, 'Заполняемая заготовка общего журнала: титульный лист и разделы 1–6. Перед сдачей ПТО должен проверить состав и форму по действующей редакции приказа № 1026/пр. Документ можно дописать в Word и распечатать.'),
        h('div', { class: 'pp-row pp-wrap' }, field('С', from, 'пусто — с начала'), field('По', to), button('Весь срок', () => { w.ojr = { from: null, to: today }; render(); })),
        h('div', { class: 'pp-row pp-wrap' }, button('⚙ Титульный лист и специальные журналы', () => ojrSettings(c), ''), button('📑 Сформировать общий журнал (Word)', () => makeOjr(c, w), 'pp-primary')),
        h('small', { class: 'pp-muted' }, 'В разделе 3 за выбранный период дней с работами: ' + rows.length + (set.number ? ' · журнал № ' + set.number : '') + (set.permit ? '' : ' · разрешение на строительство не указано'))),
      !p.address || !I.orgs(d, 'builder').length ? h('p', { class: 'pp-card pp-error' }, 'Для титульного листа заполните адрес в карточке объекта и участников строительства.') : null,
      w.ojrDownload ? h('section', { class: 'pp-card' },
        h('p', { class: 'pp-error' }, 'Сохранение на Диске не подтверждено. Готовый Word можно скачать на устройство.'),
        h('p', { class: 'pp-muted' }, w.ojrDownload.name),
        button('⬇ Скачать сформированный журнал', () => downloadOjr(w), 'pp-primary'),
        h('small', { class: 'pp-muted' }, 'Скачайте файл до закрытия или обновления страницы. Это документ на момент последнего формирования.')) : null);
  }

  function ojrSettings(c) {
    const d = JSON.parse(JSON.stringify(c.id.participants));
    const set = (d.defaults && d.defaults.ojr) || {};
    const number = h('input', { value: set.number || '' });
    const permit = h('input', { value: set.permit || '', placeholder: '№ 16-RU…-2026 от 10.01.2026, кем выдано' });
    const expertise = h('input', { value: set.expertise || '', placeholder: '№ … от …, кем выдано' });
    const journals = (set.journals || []).map((j) => Object.assign({}, j));
    const list = h('div', { class: 'pp-list' });
    const draw = () => list.replaceChildren(...journals.map((j, i) => {
      const n = h('input', { value: j.name || '', placeholder: 'Журнал бетонных работ' });
      const k = h('input', { value: j.keeper || '', placeholder: 'Кто ведёт (ФИО, должность)' });
      const dt = h('input', { type: 'date', value: j.date ? dayToInput(j.date) : '' });
      n.addEventListener('input', () => { j.name = n.value; }); k.addEventListener('input', () => { j.keeper = k.value; });
      dt.addEventListener('change', () => { j.date = dt.value ? inputToDay(dt.value) : null; });
      return h('div', { class: 'pp-row pp-wrap' }, n, k, dt, button('✕', () => { journals.splice(i, 1); draw(); }, 'pp-icon', 'Убрать'));
    }));
    draw();
    asyncDialog('Общий журнал: титульный лист', h('div', null,
      field('Номер журнала', number), field('Разрешение на строительство', permit), field('Заключение экспертизы проектной документации', expertise),
      h('h3', null, 'Раздел 2. Специальные журналы'), list, button('+ Журнал', () => { journals.push({ name: '', keeper: '', date: null }); draw(); }),
      h('p', { class: 'pp-muted' }, 'Объект, адрес, застройщик, генподрядчик, проектировщик и строительный контроль берутся из карточки объекта и участников строительства.')), async () => {
      I.setDefaults(d, { ojr: { number: number.value.trim(), permit: permit.value.trim(), expertise: expertise.value.trim(), journals: journals.filter((j) => String(j.name || '').trim()) } });
      await saveParticipants(c, d);
      render();
    });
  }

  async function makeOjr(c, w) {
    const st = c.id, d = st.participants;
    if (st.storage.busy || st.generating) return;
    const set = (d.defaults && d.defaults.ojr) || {};
    st.generating = true;
    w.ojrDownload = null;
    let prepared = null;
    try {
      I.validPeriod(w.ojr.from, w.ojr.to || today);
      setStatus('Собираю общий журнал…');
      const bytes = O.richDocx(I.ojrBlocks(c.project, d, { from: w.ojr.from, to: w.ojr.to || today, today, settings: set, acts: st.acts }), { landscape: true });
      const name = ('Общий журнал работ' + (set.number ? ' № ' + set.number : '') + ' на ' + shortDate(w.ojr.to || today) + ' — ' + S.newId()).replace(/[\\/:*?"<>|]/g, '_') + '.docx';
      prepared = { name, bytes };
      await st.storage.generated('Общий журнал', [{ name, bytes }]);
      afterDocument(c);
      setStatus('Общий журнал сохранён: ' + ID_DIR + '/Общий журнал/' + name);
      window.open(D.webEdit(idDir(c) + '/Общий журнал/' + name), '_blank', 'noopener');
    } catch (e) {
      w.ojrDownload = prepared;
      const message = e.message + (prepared ? ' Готовый журнал можно скачать кнопкой «Скачать сформированный журнал».' : '');
      setStatus(message, true); alert(message);
    } finally { st.generating = false; render(); }
  }

  function downloadOjr(w) {
    const file = w.ojrDownload;
    if (!file) return;
    const href = URL.createObjectURL(new Blob([file.bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    const a = h('a', { href, download: file.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }

  // ───────── свои шаблоны документов ─────────
  const T = window.ProrabTemplates;
  const TPL = 'Шаблоны';
  const tplDirs = (c) => [[idDir(c) + '/' + TPL, 'object'], [(c.id ? c.id.root : ROOT) + '/' + TPL, 'common']];

  async function listTemplates(c) {
    const out = [];
    for (const [dir, scope] of tplDirs(c)) {
      const items = (await c.id.storage.disk.list(dir)) || [];
      for (const it of items) {
        const kind = it.type === 'file' ? T.kindOf(it.name) : null;
        if (kind && !it.name.startsWith('~$')) out.push({ name: it.name, title: it.name.replace(/\.(docx|xlsx)$/i, ''), path: dir + '/' + it.name, scope, kind });
      }
    }
    return out.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  }

  function templatesTab(c) {
    const st = c.id;
    const pickFor = (scope) => {
      const input = h('input', { type: 'file', accept: '.docx,.xlsx', multiple: true });
      input.addEventListener('change', () => uploadTemplates(c, scope, Array.from(input.files)));
      input.click();
    };
    const list = st.templates || [];
    return h('div', null,
      h('section', { class: 'pp-card' },
        h('p', null, 'Возьмите любой свой документ Word или таблицу Excel (форму акта, бланк, письмо, КС-2) и в нужных местах напишите метки в фигурных скобках, например ', h('code', null, '{ОБЪЕКТ}'), ', ', h('code', null, '{ЗАСТРОЙЩИК ИНН}'), ', ', h('code', null, '{РАБОТЫ}'), '. Кабинет подставит данные карточки объекта, участников строительства и акта, а оформление останется вашим.'),
        h('p', { class: 'pp-muted' }, 'Регистр, «ё» и подчёркивания не важны: {Застройщик_ИНН} = {ЗАСТРОЙЩИК ИНН}. Свои поля карточки объекта тоже работают: поле «Номер договора» → {НОМЕР ДОГОВОРА}.'),
        h('div', { class: 'pp-row pp-wrap' }, button('📋 Список меток', () => labelsDialog(c), 'pp-primary'), button('⬆ Шаблон для этого объекта', () => pickFor('object')), button('⬆ Общий шаблон (для всех объектов)', () => pickFor('common')))),
      h('section', { class: 'pp-card' }, h('h3', null, 'Шаблоны'),
        list.length ? list.map((t) => h('div', { class: 'pp-line' },
          h('span', null, (t.kind === 'xlsx' ? '📊 ' : '📝 ') + t.title),
          h('small', null, t.scope === 'common' ? 'общий — папка «' + lastName(ROOT) + '/' + TPL + '»' : 'этого объекта — «' + ID_DIR + '/' + TPL + '»'),
          h('strong', null, h('span', { class: 'pp-row' }, button('Создать документ', () => fromTemplate(c, t), 'pp-primary'), button('Открыть', () => window.open(D.webEdit(t.path), '_blank', 'noopener')),
            button('✕', async () => { if (!confirm('Удалить шаблон «' + t.title + '»? Он уйдёт в корзину Яндекс Диска.')) return; try { await disk.remove(t.path); st.templates = await listTemplates(c); render(); } catch (e) { alert(e.message); } }, 'pp-icon', 'Удалить шаблон'))))) :
          h('p', { class: 'pp-muted' }, 'Шаблонов пока нет. Форма АОСР по умолчанию — встроенная; свою можно загрузить кнопками выше.'),
        h('small', { class: 'pp-muted' }, 'Шаблон Word можно выбрать в форме АОСР («Форма документа») — тогда акт выйдет в вашем виде. «Создать документ» — документ без акта: данные объекта и участников.')));
  }

  async function uploadTemplates(c, scope, files) {
    const st = c.id, disk = st.storage.disk;
    const known = new Set(T.values(c.project, st.participants, I.draft(c.project, st.participants, { today }), today).map((v) => T.norm(v.key)));
    const notes = [];
    for (const f of files) {
      const kind = T.kindOf(f.name);
      if (!kind) { notes.push(f.name + ': нужен .docx или .xlsx (старые .doc/.xls сохраните в новом формате)'); continue; }
      try {
        if (f.size > 20 * 1024 * 1024) throw new Error('Шаблон должен быть не больше 20 МБ.');
        const bytes = new Uint8Array(await f.arrayBuffer());
        const labels = await T.labelsIn(bytes, kind);
        const unknown = labels.filter((l) => !known.has(T.norm(l.slice(1, -1))));
        const dir = tplDirs(c).find(([, s2]) => s2 === scope)[0];
        await st.storage.run(async () => {
          await disk.mkdir(scope === 'object' ? idDir(c) : st.root); await disk.mkdir(dir);
          await st.storage.file(dir + '/' + DS.leaf(f.name), bytes);
        });
        notes.push(f.name + ': меток ' + labels.length + (unknown.length ? ', незнакомые (проверьте написание): ' + unknown.join(', ') : ', все знакомые ✓'));
      } catch (e) { notes.push(f.name + ': ' + e.message); }
    }
    st.templates = await listTemplates(c);
    render();
    alert(notes.join('\n'));
  }

  async function fromTemplate(c, t) {
    const st = c.id, disk = st.storage.disk;
    const base = t.title + ' ' + shortDate(today);
    const name = (prompt('Название документа', base) || '').trim();
    if (!name) return;
    if (!validName(name)) return alert('В названии нельзя использовать \\ / : * ? " < > |');
    try {
      setStatus('Заполняю шаблон…');
      const buf = await disk.getBytes(t.path);
      if (!buf) throw new Error('Шаблон не найден на Диске');
      const res = await T.fill(new Uint8Array(buf), T.values(c.project, st.participants, null, today), t.kind);
      const dir = idDir(c) + '/Документы';
      const file = dir + '/' + name + '.' + t.kind;
      await st.storage.generated('Документы', [{ name: name + '.' + t.kind, bytes: res.bytes }]);
      afterDocument(c);
      setStatus('Документ создан: ' + ID_DIR + '/Документы/' + name + '.' + t.kind + (res.missing.length ? ' · не заполнены метки: ' + res.missing.join(', ') : ''), res.missing.length > 0);
      window.open(D.webEdit(file), '_blank', 'noopener');
    } catch (e) { alert(e.message); setStatus(''); }
  }

  function labelsDialog(c) {
    const st = c.id;
    const act = st.acts.length ? st.acts.slice().sort((a, b) => (parseInt(b.number, 10) || 0) - (parseInt(a.number, 10) || 0))[0] : I.draft(c.project, st.participants, { today });
    const list = T.values(c.project, st.participants, act, today);
    const groups = Array.from(new Set(list.map((x) => x.group)));
    const copy = async (text) => { try { await navigator.clipboard.writeText(text); setStatus('Скопировано: ' + text); } catch (e) { /* выделите вручную */ } };
    const wrap = h('div', { class: 'pp-modal', onclick: (e) => { if (e.target === wrap) wrap.remove(); } },
      h('div', { class: 'pp-dialog pp-wide' },
        h('div', { class: 'pp-row pp-between' }, h('h2', null, 'Метки для шаблонов'), button('✕', () => wrap.remove(), 'pp-icon')),
        h('p', { class: 'pp-muted' }, 'Нажмите на метку — она скопируется; вставьте её в документ Word или Excel. Справа — что подставится сейчас' + (st.acts.length ? ' (метки акта — по последнему АОСР).' : '.')),
        h('div', { class: 'pp-catalog' }, groups.map((g) => h('div', null, h('h3', null, g), h('table', { class: 'pp-table' }, h('tbody', null, list.filter((x) => x.group === g).map((x) => h('tr', null,
          h('td', null, button('{' + x.key + '}', () => copy('{' + x.key + '}'), 'pp-link')), h('td', null, h('small', null, x.title)), h('td', null, h('small', { class: x.value ? '' : 'pp-muted' }, x.value || '— пусто —')))))))))));
    document.body.append(wrap);
  }

  function exportActs(c) {
    const rows = [['№', 'Дата акта', 'Предъявленные работы', 'Начало работ', 'Окончание работ', 'Последующие работы', 'Статус', 'Документ']];
    for (const r of I.registry(c.id.acts)) rows.push([r.number, r.date ? { date: r.date } : null, r.works, r.start ? { date: r.start } : null, r.end ? { date: r.end } : null, r.next, r.signed ? 'подписан' : 'черновик', r.file]);
    const bytes = O.book([{ name: 'Реестр АОСР', header: true, widths: [6, 12, 60, 12, 12, 40, 12, 50], rows }]);
    const el = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: ('Реестр АОСР ' + (c.project.project.name || '') + ' ' + shortDate(today)).replace(/[\\/:*?"<>|]/g, '_') + '.xlsx' });
    document.body.append(el); el.click(); el.remove();
  }

  // ───────── фиксация данных ─────────
  const F = window.ProrabFixation, FS = window.ProrabFixationStore;
  function fixState(c) {
    if (!c.fix) c.fix = new FS.Journal({ disk, path: c.path, device: me, project: c.project.projectId, storage: store,
      request: async (suffix, fields) => {
        const url = app.dataset.anchorUrl;
        if (!url) throw new Error('Сервер квитанций не подключён.');
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
        try {
          const r = await fetch(url + suffix, { method: 'POST', credentials: 'same-origin', signal: controller.signal, body: new URLSearchParams({ ...fields, csrf_token: app.dataset.csrf || '' }) });
          const value = await r.json();
          if (!r.ok) throw new Error(value.error || 'Сервер квитанций недоступен (' + r.status + ')');
          return value;
        } finally { clearTimeout(timer); }
      } });
    return c.fix;
  }
  async function fixFile(c, name, data) {
    try {
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      await fixState(c).queueFile(name.startsWith('files/') || name.startsWith(ID_DIR + '/') ? name : 'files/' + name, bytes);
    } catch (e) { c.fixWarning = e.message; }
  }
  async function fixNow(c, force) {
    if (!c.project) return null;
    try { const result = await fixState(c).capture(c.project.state, { force }); c.fixWarning = null; return result; }
    catch (e) { c.fixWarning = e.message; throw e; }
  }
  function afterDocument(c) { fixNow(c, false).catch((e) => { c.fixWarning = e.message; }); }
  function fixationView(w, c) {
    const st = fixState(c);
    if (!st.loaded && !st.loading && !st.loadFailed) { st.loading = true; st.load().catch((e) => { st.loadFailed = true; c.fixWarning = e.message; }).finally(() => { st.loading = false; if (!modalOpen()) render(); }); }
    const last = st.seals.at(-1), rep = w.fixReport;
    const result = (r) => r.problems ? '⚠ Найдены расхождения' : r.incomplete ? 'Проверка не завершена' : '✓ Проверка завершена, расхождений не найдено';
    return h('main', null,
      h('section', { class: 'pp-card' },
        h('p', null, 'После сохранения кабинет делает снимок данных объекта не чаще раза в 30 минут. Можно зафиксировать изменения сразу. В снимке — записи журнала, приёмка, замечания, финансы объекта и отпечатки файлов, загруженных или созданных в этом кабинете после обновления.'),
        h('p', { class: 'pp-muted' }, 'Снимки лежат в папке объекта «' + F.DIR + '». На сервер передаются только отпечатки и номера, без текстов, сумм и изображений. Серверный реестр позволяет заметить удаление последних подтверждённых снимков и целой цепочки.'),
        h('p', { class: 'pp-muted' }, 'Квитанция подтверждает время получения отпечатка этим сайтом. Независимая служба времени и электронная подпись автора не подключены. Кабинет также проверяет цепочки телефона. Для старого протокола телефона проверка полноты ограничена — это будет указано в отчёте.'),
        c.fixWarning ? h('p', { class: 'pp-error' }, c.fixWarning) : null,
        h('p', null, st.loading ? 'Загружаю…' : last ? 'Это устройство: снимков ' + st.seals.length + ', последняя фиксация ' + new Date(last.createdAt).toLocaleString('ru-RU') + ', квитанций ' + st.anchored.size : 'С этого устройства фиксаций ещё не было.'),
        h('div', { class: 'pp-row pp-wrap' },
          button('🔏 Зафиксировать сейчас', async () => { try { setStatus('Фиксирую…'); setStatus(await fixNow(c, true)); w.fixReport = null; } catch (e) { setStatus(e.message, true); alert(e.message); } render(); }, 'pp-primary'),
          button('✔ Проверить целостность', async () => { w.fixReport = null; try { setStatus('Проверяю снимки, квитанции и файлы…'); w.fixReport = await st.report(c.project.state); setStatus(result(w.fixReport), w.fixReport.problems || w.fixReport.incomplete); } catch (e) { c.fixWarning = e.message; setStatus('Проверка не завершена: ' + e.message, true); } render(); }),
          button('⬇ Выгрузить для эксперта', () => exportFixation(c)))),
      rep ? h('section', { class: 'pp-card' }, h('h3', null, result(rep)),
        h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table' },
          h('thead', null, h('tr', null, ['Устройство', 'Снимков', 'Последний', 'Квитанций', 'Расхождения'].map((t) => h('th', null, t)))),
          h('tbody', null, rep.chains.map((r) => h('tr', null, h('td', null, r.label), h('td', null, String(r.seals)), h('td', null, r.last ? new Date(r.last).toLocaleString('ru-RU') : ''), h('td', null, String(r.anchored)), h('td', null, r.problems.join('; ') || 'нет')))))),
        rep.issues.map((t) => h('p', { class: 'pp-error' }, t)), rep.notes.map((t) => h('p', { class: 'pp-error' }, t)),
        h('p', null, 'Файлов с совпадающим отпечатком: ' + rep.verifiedFiles + ' из ' + rep.fileCount + '. Подписей квитанций проверено: ' + rep.anchors.valid + ', неверных: ' + rep.anchors.invalid + (rep.anchors.checked ? '.' : '. Серверная проверка не завершена.'))) : null);
  }
  async function exportFixation(c) {
    try {
      setStatus('Собираю архив фиксаций…');
      const rep = await fixState(c).report(c.project.state), entries = [];
      for (const ch of rep.raw) {
        for (const seal of ch.seals) entries.push({ name: F.DIR + '/' + ch.device + '/' + F.name(seal.seq), text: JSON.stringify(seal) });
        for (const a of ch.anchors.values()) entries.push({ name: F.DIR + '/' + ch.device + '/' + F.anchorName(a.seq), text: JSON.stringify(a, null, 1) });
      }
      const summary = rep.problems ? 'Есть расхождения' : rep.incomplete ? 'Проверка не завершена' : 'Проверка завершена, расхождений не найдено';
      const lines = ['Архив фиксаций Прораб+', 'Объект: ' + c.project.project.name, 'Проверка: ' + new Date(rep.at).toISOString(), summary,
        ...rep.chains.map((r) => r.label + ' (папка ' + r.device + '): снимков ' + r.seals + ', квитанций ' + r.anchored + '. ' + r.problems.join('; ')), ...rep.issues, ...rep.notes,
        'Файлы: совпало ' + rep.verifiedFiles + ' из ' + rep.fileCount + '. Проверено квитанций: ' + rep.anchors.valid + ', неверных: ' + rep.anchors.invalid + '.',
        'Отсутствие расхождений не подтверждает достоверность описанных работ или авторство записей. Квитанции выданы сервером сайта, независимой метки времени нет.'];
      const readme = ['Фиксации v2: hash — SHA-256 канонического JSON снимка без hash; prev — предыдущий hash. Ключи объектов сортируются, массивы сохраняют порядок.',
        'changes содержит строки row и их SHA-256 (h); removed=true исключает строку из состояния. root — SHA-256 строк таблица/id:отпечаток, отсортированных по ключу и разделённых переводами строки.',
        'files содержит пути относительно папки объекта и SHA-256. Исходные фото, чертежи и документы нужно отдельно сохранить с Диска; в архиве только их отпечатки.',
        'Квитанции HMAC-SHA256 v2 проверяются сервером POST /prorab/anchor/verify (receipts — JSON-массив до 100, csrf_token). Подписаны format, version, project, chain, seq, prev, hash, time, alg, key в каноническом JSON.',
        'Полнота сверяется с приватным серверным реестром POST /prorab/anchor/heads. Локальная цепочка сама по себе не доказывает отсутствие удалённых последних снимков.',
        'Квитанция означает получение отпечатка сервером в указанное время, не подпись автора и не независимую метку времени. Ключ и серверный реестр нужно сохранять в резервных копиях.'];
      entries.push({ name: 'Отчёт о проверке.txt', text: lines.join('\r\n') }, { name: 'Как проверить.txt', text: readme.join('\r\n') });
      const a = h('a', { href: URL.createObjectURL(new Blob([O.zip(entries)], { type: 'application/zip' })), download: ('Фиксации ' + c.project.project.name + ' ' + shortDate(today)).replace(/[\\/:*?"<>|]/g, '_') + '.zip' });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      setStatus('Архив выгружен. ' + summary, rep.problems || rep.incomplete);
    } catch (e) { alert(e.message); setStatus('Архив не завершён: ' + e.message, true); }
  }

  // ───────── позиция ведомости ─────────
  function boqForm(c, id, opts) {
    opts = opts || {};
    const P = c.project;
    const it = id ? P.get('boq_items', id) : null;
    const isExtra = it ? it.extraDate !== null && it.extraDate !== undefined : !!opts.extra;
    const extra = h('input', { type: 'checkbox' }); extra.checked = isExtra;
    const cur = it ? P.acceptancesCurrent().find((a) => !a.entryId && a.itemId === it.id) : null;
    const name = h('input', { value: it ? it.name : '', placeholder: 'Бетонирование фундаментов Ф1–Ф6' });
    const work = selectAdd(P.rows('work_types').map((x) => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name, 'ru')), it && it.workTypeId, 'Не указан', 'Новый вид работ', (n) => P.addNamed('work_types', n));
    const unit = selectAdd(P.rows('units').map((x) => ({ id: x.id, name: x.name })), it && it.unitId, '—', 'Новая единица', (n) => P.addNamed('units', n));
    const plan = h('input', { inputmode: 'decimal', value: it && it.planQty !== null && it.planQty !== undefined ? String(it.planQty).replace('.', ',') : '' });
    const price = h('input', { inputmode: 'decimal', value: it && it.priceCents ? String(it.priceCents / 100).replace('.', ',') : '' });
    const start = h('input', { type: 'date', value: it && it.startDate ? dayToInput(it.startDate) : '' });
    const due = h('input', { type: 'date', value: it && it.dueDate ? dayToInput(it.dueDate) : '' });
    const who = selectAdd(P.rows('contractors').map((x) => ({ id: x.id, name: x.name })), it && it.contractorId, 'Не указан', 'Новый исполнитель', (n) => P.addNamed('contractors', n));
    const fin = h('input', { type: 'checkbox' }); fin.checked = !!(it && it.finishedDate);
    const history = it ? P.itemHasHistory(it.id) : false;
    modal(c, it ? 'Позиция ведомости' : opts.extra ? 'Новая доп. работа' : 'Новая позиция', h('div', null,
      field('Наименование работ', name), h('div', { class: 'pp-row pp-wrap' }, field('Вид работ', work), field('Ед. изм.', unit)),
      h('div', { class: 'pp-row pp-wrap' }, field('Объём по плану', plan), field('Цена за ед., ₽', price, 'необязательно')),
      h('div', { class: 'pp-row pp-wrap' }, field('Начало работ', start), field('Срок окончания', due)), field('Исполнитель', who),
      h('label', { class: 'pp-check' }, extra, ' Доп. работа (вне основного объёма) — видна в «Доп. работах» сразу'),
      it ? h('label', { class: 'pp-check' }, fin, ' Работы по позиции завершены') : null,
      it ? h('div', { class: 'pp-row pp-wrap' }, cur ? h('span', { class: 'pp-muted' }, 'Приёмка: ' + ACCEPT[cur.result][0]) : null,
        cur ? button('Открыть приёмку', () => { document.querySelector('.pp-modal').remove(); acceptanceForm(c, cur.id); }) :
          button('Закончено — на приёмку', () => { document.querySelector('.pp-modal').remove(); readyDialog(c, null, it.id); })) : null,
      history ? h('p', { class: 'pp-muted' }, 'По позиции есть записи в журнале — удалить её нельзя, только изменить.') : null), () => {
      const nm = name.value.trim();
      const wt = work.value && work.value !== '__add' ? work.value : null;
      if (!nm && !wt) bad('Укажите наименование или вид работ');
      const q = parseQty(plan.value);
      if (Number.isNaN(q)) bad('Объём — число');
      const pc = parseMoney(price.value);
      if (Number.isNaN(pc)) bad('Цена — число, например 1500 или 1500,50');
      const saved = P.saveBoqItem({
        id: it ? it.id : null, name: nm, workTypeId: wt, unitId: unit.value && unit.value !== '__add' ? unit.value : null, planQty: q, priceCents: pc,
        startDate: start.value ? inputToDay(start.value) : null, dueDate: due.value ? inputToDay(due.value) : null,
        contractorId: who.value && who.value !== '__add' ? who.value : null, finishedDate: fin.checked ? (it && it.finishedDate) || today : null,
      });
      const had = !!it && it.extraDate !== null && it.extraDate !== undefined;
      if (extra.checked !== had) P.put('boq_items', saved.id, { extraDate: extra.checked ? today : null });
    }, it && !history ? { text: 'Удалить позицию', run: () => { if (!confirm('Удалить позицию?')) return false; P.deleteBoqItem(it.id); } } : null);
  }

  // ───────── фото ─────────
  const hrefCache = {};
  async function fileHref(c, file) {
    const key = c.path + '/files/' + file;
    if (!hrefCache[key]) hrefCache[key] = disk.downloadHref(key).catch((e) => { delete hrefCache[key]; throw e; });
    return hrefCache[key];
  }

  /**
   * Фото записи: показ (с Диска) и добавление с компьютера. Файл загружается сразу в «<объект>/files/»
   * (имя как у телефона — случайное), запись о фото — при сохранении формы (commit).
   */
  function photoBox(c, ownerId, title) {
    const P = c.project;
    const existing = ownerId ? P.attachmentsOf(ownerId) : [];
    const removed = new Set();
    const added = [];
    let uploading = 0;
    const grid = h('div', { class: 'pp-photos' });
    const note = h('small', { class: 'pp-muted' });
    const tile = (file, kind, onRemove) => {
      const img = h('img', { alt: '', loading: 'lazy' });
      const el = h('div', { class: 'pp-photo' }, kind === 'video' ? h('span', { class: 'pp-photo-video' }, '🎬') : img,
        h('button', { type: 'button', class: 'pp-photo-x', title: 'Убрать', onclick: () => { el.remove(); onRemove(); } }, '✕'));
      // Просмотр в Яндекс Диске: фото листаются, видео играет
      el.addEventListener('dblclick', () => window.open(D.webView(c.path + '/files/' + file), '_blank', 'noopener'));
      if (kind !== 'video') fileHref(c, file).then((u) => { img.src = u; }, () => { img.replaceWith(h('span', { class: 'pp-photo-video', title: 'Файл ещё не загружен с телефона' }, '⏳')); });
      return el;
    };
    existing.forEach((a) => grid.append(tile(a.file, a.kind, () => removed.add(a.id))));
    const pick = h('input', { type: 'file', accept: 'image/*', multiple: true });
    pick.addEventListener('change', async () => {
      for (const f of Array.from(pick.files)) {
        uploading++; note.textContent = 'Загружаю фото…';
        try {
          const data = await shrink(f);
          const file = S.newId() + '.jpg';
          await disk.mkdir(c.path + '/files');
          const blob = dataToBlob(data);
          await disk.putBlob(c.path + '/files/' + file, blob, false);
          await fixFile(c, file, blob);
          hrefCache[c.path + '/files/' + file] = Promise.resolve(data);
          const item = { file };
          added.push(item);
          grid.append(tile(file, 'photo', () => added.splice(added.indexOf(item), 1)));
        } catch (e) { alert(f.name + ': ' + e.message); }
        uploading--;
      }
      note.textContent = uploading ? 'Загружаю фото…' : '';
      pick.value = '';
    });
    const el = h('div', { class: 'pp-photobox' }, h('h3', null, title || 'Фото'), grid,
      h('div', { class: 'pp-row' }, button('📷 Добавить фото', () => pick.click()), note),
      h('small', { class: 'pp-muted' }, 'Фото хранятся в папке объекта на Диске и придут на телефон при синхронизации. Двойной щелчок — открыть.'));
    return {
      el,
      busy: () => uploading > 0,
      commit(owner) {
        removed.forEach((id) => P.removeAttachment(id));
        added.forEach((a) => P.addAttachment(owner, a.file, 'photo'));
      },
    };
  }

  // ───────── отчёты ─────────
  function reportDialog(c, day) {
    const text = c.project.dayReport(day, dayTitle(day));
    const area = h('textarea', { rows: 14, readonly: true }, text);
    const wrap = h('div', { class: 'pp-modal', onclick: (e) => { if (e.target === wrap) wrap.remove(); } },
      h('div', { class: 'pp-dialog' },
        h('div', { class: 'pp-row pp-between' }, h('h2', null, 'Отчёт за ' + dayTitle(day)), button('✕', () => wrap.remove(), 'pp-icon')),
        area,
        h('div', { class: 'pp-row pp-between' }, h('span', { class: 'pp-muted' }, 'Скопируйте и отправьте в мессенджер.'),
          button('Копировать', async () => {
            try { await navigator.clipboard.writeText(text); setStatus('Отчёт скопирован'); } catch (e) { area.select(); document.execCommand('copy'); }
            wrap.remove();
          }, 'pp-primary'))));
    document.body.append(wrap);
  }

  function journalBook(c, period) {
    const { byDay, totals } = c.project.exportRows(period.from, period.to);
    const done = new Map();
    for (const r of byDay.filter((r) => r[1] === 'Работы')) {
      const k = r[2] + '|' + r[4];
      const v = done.get(k) || { name: r[2], unit: r[4], qty: 0, first: r[0], last: r[0] };
      v.qty = Math.round((v.qty + (Number(r[3]) || 0)) * 1e6) / 1e6; v.first = Math.min(v.first, r[0]); v.last = Math.max(v.last, r[0]);
      done.set(k, v);
    }
    const p = c.project.project;
    const periodText = period.from === null && period.to === null ? 'весь срок' : 'с ' + (period.from !== null ? shortDate(period.from) : 'начала') + ' по ' + (period.to !== null ? shortDate(period.to) : shortDate(today));
    return O.book([
      { name: 'По дням', header: true, widths: [12, 11, 44, 10, 8, 26, 36, 14], rows: [['Дата', 'Раздел', 'Наименование', 'Кол-во', 'Ед.', 'Исполнитель / работа', 'Комментарий', 'Сумма, ₽']].concat(byDay.map((r) => [{ date: r[0] }].concat(r.slice(1)))) },
      { name: 'Итоги по дням', header: true, widths: [12, 14, 10, 16, 14, 16, 14, 14], rows: [['Дата', 'Записей работ', 'Людей', 'Техника, маш.-ч', 'Задач в плане', 'Выполнено задач', 'Расход, ₽', 'Приход, ₽']].concat(totals.map((r) => [{ date: r[0] }].concat(r.slice(1)))) },
      { name: 'Выполнено за период', header: true, widths: [50, 10, 14, 14, 14], rows: [['Работа', 'Ед.', 'Объём', 'Первый день', 'Последний день']].concat(Array.from(done.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((v) => [v.name, v.unit, v.qty, { date: v.first }, { date: v.last }])) },
      { name: 'Объект', rows: [['Журнал работ'], ['Объект', p.name || ''], ['Адрес', p.address || ''], ['Период', periodText], ['Сформирован', shortDate(today)]] },
    ]);
  }

  async function exportJournal(c, period, toDisk) {
    const bytes = journalBook(c, period);
    const p = c.project.project;
    const tag = period.from === null && period.to === null ? 'весь срок' : (period.from !== null ? shortDate(period.from) : 'начало') + '–' + (period.to !== null ? shortDate(period.to) : shortDate(today));
    const name = ('Журнал ' + (p.name || 'объект') + ' ' + tag.replace('–', ' - ')).replace(/[\\/:*?"<>|]/g, '_') + '.xlsx';
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (!toDisk) {
      const a = h('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      return;
    }
    const dir = c.path + '/' + DOCS + '/Отчёты';
    try {
      await disk.mkdir(c.path + '/' + DOCS); await disk.mkdir(dir);
      await disk.putBlob(dir + '/' + name, blob, true);
      setStatus('Журнал сохранён: ' + DOCS + '/Отчёты/' + name);
      reloadFolder(c.path + '/' + DOCS, 'Отчёты');
      window.open(D.webEdit(dir + '/' + name), '_blank', 'noopener');
    } catch (e) { alert(e.message); }
  }

  // ───────── документы: папки и файлы на Диске (Word, Excel, ярлыки, свои файлы) ─────────
  const EXT_ICON = { url: '🔗', docx: '📝', doc: '📝', xlsx: '📊', xls: '📊', csv: '📊', pdf: '📕', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', webp: '🖼️', dwg: '📐', dxf: '📐', zip: '🗜️', txt: '📄', pptx: '📽️', gif: '🖼️', heic: '🖼️', bmp: '🖼️', mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬', webm: '🎬', '3gp': '🎬', m4v: '🎬', wmv: '🎬', mp3: '🎵', m4a: '🎵', wav: '🎵', ogg: '🎵' };
  /** Фото и видео открываются в просмотрщике Яндекс Диска. */
  const MEDIA = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'm4v', 'wmv', 'mp3', 'm4a', 'wav', 'ogg'];
  const ext = (n) => (n.includes('.') ? n.split('.').pop().toLowerCase() : '');
  const fileIcon = (it) => (it.type === 'dir' ? '📁' : EXT_ICON[ext(it.name)] || '📄');
  /** Как в Windows: у ярлыка «.url» не показывается. */
  const shownName = (it) => (it.type === 'file' && ext(it.name) === 'url' ? it.name.slice(0, -4) : it.name);
  /** Ярлык на сайт — файл Windows «Интернет-ярлык» (.url): открывается и в Windows двойным щелчком. */
  const shortcutText = (url) => '[InternetShortcut]\r\nURL=' + url + '\r\n';
  function parseShortcut(text) {
    const m = /^URL=(.+)$/m.exec(String(text || ''));
    return m ? m[1].trim() : null;
  }
  function cleanUrl(input) {
    let u = String(input || '').trim();
    if (!u) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch (e) { return null; }
  }
  const sortItems = (items) => items.filter((i) => !i.name.startsWith('.')).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ru') : a.type === 'dir' ? -1 : 1));
  const validName = (n) => n && !/[\\/:*?"<>|]/.test(n) && n !== '.' && n !== '..' && n.length <= 120;
  const dirOf = (base, rel) => base + (rel ? '/' + rel : '');

  async function loadHome() {
    home.loading = true;
    await loadProjects();
    home.loading = false;
  }

  async function loadFolder(w) {
    w.items = null; w.error = null;
    try {
      const items = await disk.list(w.kind === 'picker' ? w.path || '/' : dirOf(w.base, w.path));
      w.items = sortItems(items || []);
    } catch (e) { w.items = []; w.error = e.message; }
    if (!modalOpen()) render();
  }

  /** Папка изменилась — обновить рабочий стол и открытые окна этой папки. */
  function reloadFolder(base, rel) {
    if (base === HOME && !rel) loadHome();
    wins.filter((w) => w.kind === 'explorer' && w.base === base && w.path === rel).forEach(loadFolder);
    render();
  }

  async function ensureBase(base) {
    if (base !== HOME) await disk.mkdir(ROOT);
    await disk.mkdir(base);
  }

  /** Ярлык на сайт: адрес и имя → файл «Имя.url» в папке. */
  async function createShortcut(base, rel, old) {
    const oldUrl = old ? parseShortcut(await disk.getText(dirOf(base, rel) + '/' + old.name)) : '';
    const url = cleanUrl(prompt('Адрес сайта', oldUrl || 'https://'));
    if (!url) { if (!old) alert('Нужен адрес сайта, например metalcarcase.ru или https://disk.yandex.ru'); return; }
    const name = old ? old.name.slice(0, -4) : (prompt('Имя ярлыка', new URL(url).hostname.replace(/^www\./, '')) || '').trim();
    if (!name) return;
    if (!validName(name)) return alert('В имени нельзя использовать \\ / : * ? " < > |');
    try {
      await ensureBase(base);
      await disk.putBlob(dirOf(base, rel) + '/' + name + '.url', new Blob([shortcutText(url)], { type: 'text/plain' }), !!old);
      setStatus((old ? 'Ярлык изменён: ' : 'Создан ярлык: ') + name);
      reloadFolder(base, rel);
    } catch (e) { alert(e.message); }
  }

  async function createIn(base, rel, kind) {
    if (kind === 'url') return createShortcut(base, rel, null);
    const label = { dir: 'Имя новой папки', docx: 'Название документа Word', xlsx: 'Название таблицы Excel' }[kind];
    const def = { dir: 'Новая папка', docx: 'Новый документ', xlsx: 'Новая таблица' }[kind];
    let name = (prompt(label, def) || '').trim();
    if (!name) return;
    if (!validName(name)) return alert('В имени нельзя использовать \\ / : * ? " < > |');
    const dir = dirOf(base, rel);
    try {
      await ensureBase(base);
      if (kind === 'dir') await disk.mkdir(dir + '/' + name);
      else {
        if (!name.toLowerCase().endsWith('.' + kind)) name += '.' + kind;
        const bytes = kind === 'docx' ? O.docx(name.replace(/\.docx$/i, '')) : O.xlsx([], 'Лист1');
        await disk.putBlob(dir + '/' + name, new Blob([bytes]), false);
        setStatus('Создан ' + name + ' — открываю в Яндекс Документах');
        window.open(D.webEdit(dir + '/' + name), '_blank', 'noopener');
      }
      reloadFolder(base, rel);
    } catch (e) { alert(e.message); }
  }

  function uploadInto(base, rel) {
    const input = h('input', { type: 'file', multiple: true });
    input.addEventListener('change', async () => {
      try {
        await ensureBase(base);
        let n = 0;
        for (const f of input.files) {
          if (f.size > 200 * 1024 * 1024) { alert(f.name + ': больше 200 МБ — загрузите через сайт Диска'); continue; }
          setStatus('Загружаю ' + f.name + '…');
          await disk.putBlob(dirOf(base, rel) + '/' + f.name, f, false);
          n++;
        }
        setStatus('Загружено файлов: ' + n);
      } catch (e) { alert(e.message); }
      reloadFolder(base, rel);
    });
    input.click();
  }

  /** Папка объекта на рабочем столе («Прораб+/<объект>»). */
  const projectAt = (base, rel, it) => (base === HOME && !rel && it.type === 'dir' ? (projects || []).find((p) => p.path === ROOT + '/' + it.name) : null);

  async function openItem(w, it, base, rel) {
    const pr = projectAt(base, rel, it);
    if (pr) return openWindow('project', pr.path);
    if (it.type === 'dir') {
      const path = (rel ? rel + '/' : '') + it.name;
      if (w) { w.path = path; w.key = ['explorer', w.folder || '', base, path].join('|'); loadFolder(w); render(); }
      else openWindow('explorer', base !== HOME && base.endsWith('/' + DOCS) ? base.slice(0, -(DOCS.length + 1)) : null, { base, path });
      return;
    }
    const full = dirOf(base, rel) + '/' + it.name;
    if (ext(it.name) === 'url') {
      // Новая вкладка открывается сразу (иначе браузер её заблокирует), адрес — после чтения ярлыка
      const tab = window.open('about:blank', '_blank');
      try {
        const url = cleanUrl(parseShortcut(await disk.getText(full)));
        if (!url) throw new Error('В ярлыке нет адреса сайта');
        if (tab) { tab.opener = null; tab.location.href = url; } else window.open(url, '_blank', 'noopener');
      } catch (e) { if (tab) tab.close(); alert(e.message); }
      return;
    }
    if (DRAWING_EXT.includes(ext(it.name))) {
      // Чертёж: в папке объекта — сразу его чертёж с пометками; иначе спросим, в какой объект
      const pr = projectOfPath(full);
      if (pr) openDrawingFile(full, it, pr.path); else drawingFileDialog(full, it);
      return;
    }
    if (['docx', 'xlsx', 'pptx', 'doc', 'xls', 'csv', 'txt'].includes(ext(it.name))) window.open(D.webEdit(full), '_blank', 'noopener');
    else if (MEDIA.includes(ext(it.name))) window.open(D.webView(full), '_blank', 'noopener');
    else { try { window.open(await disk.downloadHref(full), '_blank', 'noopener'); } catch (e) { alert(e.message); } }
  }

  function itemMenu(x, y, w, it, base, rel) {
    const pr = projectAt(base, rel, it);
    if (pr) return projectMenu(x, y, pr);
    const full = dirOf(base, rel) + '/' + it.name;
    popup(x, y, [
      ['Открыть', () => openItem(w, it, base, rel)],
      ext(it.name) === 'url' ? ['Изменить адрес', () => createShortcut(base, rel, it)] : null,
      DRAWING_EXT.includes(ext(it.name)) ? ['📍 Чертёж с пометками…', () => drawingFileDialog(full, it)] : null,
      DRAWING_EXT.includes(ext(it.name)) ? ['Только посмотреть', () => openWindow('fileview', null, { path: full, title: it.name })] : null,
      ext(it.name) === 'pdf' ? ['Открыть в Яндекс Документах', () => window.open(D.webEdit(full), '_blank', 'noopener')] : null,
      it.type === 'file' && ext(it.name) !== 'url' ? ['Открыть в Яндекс Диске', () => window.open(D.webView(full), '_blank', 'noopener')] : null,
      it.type === 'dir' ? ['Открыть на Диске', () => window.open(D.webFolder(full), '_blank', 'noopener')] : null,
      it.type === 'file' && ext(it.name) !== 'url' ? ['Скачать', async () => { try { window.open(await disk.downloadHref(full), '_blank', 'noopener'); } catch (e) { alert(e.message); } }] : null,
      ['Переименовать', async () => {
        const isUrl = ext(it.name) === 'url';
        let n = (prompt('Новое имя', shownName(it)) || '').trim();
        if (isUrl && n) n += '.url';
        if (!n || n === it.name) return;
        if (!validName(n)) return alert('В имени нельзя использовать \\ / : * ? " < > |');
        try { await disk.move(full, dirOf(base, rel) + '/' + n); reloadFolder(base, rel); } catch (e) { alert(e.message); }
      }],
      ['Удалить в корзину', async () => {
        if (!confirm('Удалить «' + shownName(it) + '»? Его можно будет восстановить из корзины Яндекс Диска.')) return;
        try { await disk.remove(full); reloadFolder(base, rel); } catch (e) { alert(e.message); }
      }],
    ]);
  }

  function folderMenu(x, y, w) {
    popup(x, y, [
      ['⟳ Обновить', () => loadFolder(w)],
      ['-'], ['#Создать'],
      ['🔗 Ярлык на сайт', () => createIn(w.base, w.path, 'url')], ['📁 Папку', () => createIn(w.base, w.path, 'dir')], ['📝 Документ Word', () => createIn(w.base, w.path, 'docx')], ['📊 Таблицу Excel', () => createIn(w.base, w.path, 'xlsx')],
      ['-'], ['⬆ Загрузить файлы…', () => uploadInto(w.base, w.path)], ['Открыть папку на Диске', () => window.open(D.webFolder(dirOf(w.base, w.path)), '_blank', 'noopener')],
    ]);
  }

  function explorerView(w) {
    const up = w.path ? w.path.split('/').slice(0, -1).join('/') : null;
    const go = (p) => { w.path = p; w.key = ['explorer', w.folder || '', w.base, p].join('|'); loadFolder(w); render(); };
    return h('div', { class: 'pp-explorer', oncontextmenu: (e) => { if (e.target.closest('.pp-file')) return; e.preventDefault(); folderMenu(e.clientX, e.clientY, w); } },
      h('div', { class: 'pp-row pp-wrap pp-toolbar' },
        button('←', () => { if (up !== null) go(up); }, 'pp-icon', 'Наверх'),
        h('span', { class: 'pp-crumbs' }, winTitle(w)),
        button('🔗 Ярлык', () => createIn(w.base, w.path, 'url')), button('📁 Папка', () => createIn(w.base, w.path, 'dir')), button('📝 Word', () => createIn(w.base, w.path, 'docx')), button('📊 Excel', () => createIn(w.base, w.path, 'xlsx')),
        button('⬆ Загрузить', () => uploadInto(w.base, w.path)), button('⟳', () => loadFolder(w), 'pp-icon', 'Обновить')),
      w.error ? h('p', { class: 'pp-error' }, w.error) : null,
      w.items === null ? h('p', { class: 'pp-muted' }, 'Загружаю…') :
        w.items.length ? h('div', { class: 'pp-files' }, w.items.map((it) => h('button', {
          type: 'button', class: 'pp-file', title: it.name, ondblclick: () => openItem(w, it, w.base, w.path),
          onclick: () => { if (small()) openItem(w, it, w.base, w.path); },
          oncontextmenu: (e) => { e.preventDefault(); itemMenu(e.clientX, e.clientY, w, it, w.base, w.path); },
        }, h('span', { class: 'pp-icon-img' }, projectAt(w.base, w.path, it) ? '🏗️' : fileIcon(it)), h('span', { class: 'pp-icon-name' }, projectAt(w.base, w.path, it) ? projectAt(w.base, w.path, it).name : shownName(it)),
          h('small', null, projectAt(w.base, w.path, it) ? 'объект' : it.type === 'dir' ? 'папка' : ext(it.name) === 'url' ? 'ярлык' : (it.size ? Math.max(1, Math.round(it.size / 1024)) + ' КБ' : ''))))) :
          h('p', { class: 'pp-muted' }, 'Пусто. Создайте ярлык на сайт, папку, документ Word, таблицу Excel или загрузите файлы — они хранятся на вашем Яндекс Диске.'),
      h('p', { class: 'pp-muted' }, 'Двойной щелчок — открыть (Word и Excel — в Яндекс Документах, ярлык — сайт), правая кнопка — меню.'));
  }

  /** Добавить объект из любой папки Диска (если он лежит не в «Прораб+»). */
  function pickerView(w) {
    const path = w.path || '/';
    if (w.mode === 'link') {
      const upL = path === '/' ? null : path.split('/').slice(0, -1).join('/') || '/';
      const goL = (p) => { w.path = p; loadFolder(w); render(); };
      const exists = linkList.some((l) => l.path === path);
      return h('div', null,
        h('p', { class: 'pp-muted' }, 'Выберите любую папку на Диске — на рабочем столе появится её ярлык. Папка останется на своём месте.'),
        h('div', { class: 'pp-row pp-wrap pp-toolbar' }, button('←', () => { if (upL) goL(upL); }, 'pp-icon'), h('span', { class: 'pp-crumbs' }, path),
          path !== '/' && path !== ROOT ? button(exists ? 'Уже на рабочем столе' : 'Добавить на рабочий стол', () => {
            if (exists) return;
            const n = (prompt('Имя ярлыка', lastName(path)) || '').trim();
            if (!n) return;
            setLinks(linkList.concat([{ path, name: n }]));
            closeWindow(w);
          }, 'pp-primary') : null),
        w.items === null ? h('p', { class: 'pp-muted' }, 'Загружаю…') : h('div', { class: 'pp-list' },
          w.items.filter((i) => i.type === 'dir').map((d) => h('button', { type: 'button', class: 'pp-item', onclick: () => goL(path.replace(/\/$/, '') + '/' + d.name) }, '📁 ' + d.name))));
    }
    if (w.mode === 'root') {
      const up0 = path === '/' ? null : path.split('/').slice(0, -1).join('/') || '/';
      const go0 = (p) => { w.path = p; loadFolder(w); render(); };
      return h('div', null,
        h('p', { class: 'pp-muted' }, 'Сейчас рабочий стол — папка «' + ROOT + '»' + (store.get('root') ? ' (выбрана в этом браузере)' : app.dataset.root ? ' (закреплена владельцем на сайте)' : '') + '. ' +
          (ROOT_SAVE ? 'Выбранная здесь папка закрепится для всех ваших устройств и всех, с кем вы поделились папкой.' : 'Если вас пригласили в общую папку и она у вас называется иначе, выберите её здесь — только для этого браузера.')),
        h('div', { class: 'pp-row pp-wrap pp-toolbar' }, button('←', () => { if (up0) go0(up0); }, 'pp-icon'), h('span', { class: 'pp-crumbs' }, path),
          path !== '/' ? button(ROOT_SAVE ? 'Сделать рабочим столом для всех' : 'Сделать рабочим столом', () => chooseRoot(path), 'pp-primary') : null,
          store.get('root') ? button('Вернуть общую папку «' + lastName(D.normalize(app.dataset.root || '/Прораб+')) + '»', () => { store.set('root', null); location.reload(); }) : null),
        w.items === null ? h('p', { class: 'pp-muted' }, 'Загружаю…') : h('div', { class: 'pp-list' },
          w.items.filter((i) => i.type === 'dir').map((d) => h('button', { type: 'button', class: 'pp-item', onclick: () => go0(path.replace(/\/$/, '') + '/' + d.name) }, '📁 ' + d.name))));
    }
    const up = path === '/' ? null : path.split('/').slice(0, -1).join('/') || '/';
    const isObject = (w.items || []).some((i) => i.type === 'dir' && i.name === 'data');
    const go = (p) => { w.path = p; loadFolder(w); render(); };
    return h('div', null,
      h('p', { class: 'pp-muted' }, 'Найдите папку объекта (в ней есть папка data) — она появится на рабочем столе.'),
      h('div', { class: 'pp-row pp-wrap pp-toolbar' }, button('←', () => { if (up) go(up); }, 'pp-icon'), h('span', { class: 'pp-crumbs' }, path),
        isObject ? button('Добавить этот объект', () => {
          setExtra(extraProjects().concat([path]));
          closeWindow(w); loadProjects();
        }, 'pp-primary') : null),
      w.items === null ? h('p', { class: 'pp-muted' }, 'Загружаю…') : h('div', { class: 'pp-list' },
        w.items.filter((i) => i.type === 'dir' && !(isObject && (i.name === 'data' || i.name === 'files'))).map((d) => h('button', { type: 'button', class: 'pp-item', onclick: () => go(path.replace(/\/$/, '') + '/' + d.name) }, '📁 ' + d.name))));
  }

  // ───────── окна правки ─────────
  function modal(c, title, body, onSave, extra) {
    const err = h('p', { class: 'pp-error' });
    const close = () => wrap.remove();
    const wrap = h('div', { class: 'pp-modal', onclick: (e) => { if (e.target === wrap) close(); } },
      h('form', { class: 'pp-dialog', onsubmit: (e) => { e.preventDefault(); try { if (onSave() !== false) { close(); changed(c); } } catch (x) { err.textContent = x.message; } } },
        h('div', { class: 'pp-row pp-between' }, h('h2', null, title), button('✕', close, 'pp-icon')),
        h('p', { class: 'pp-muted' }, '🏗️ ' + projName(c.path)),
        body, err,
        h('div', { class: 'pp-row pp-between' }, extra ? button(extra.text, () => { if (extra.run() !== false) { close(); changed(c); } }, 'pp-danger') : h('span'), h('div', { class: 'pp-row' }, button('Отмена', close), h('button', { type: 'submit', class: 'pp-btn pp-primary' }, 'Сохранить')))));
    document.body.append(wrap);
    const first = wrap.querySelector('input, select, textarea');
    if (first) first.focus();
  }
  const bad = (msg) => { throw new Error(msg); };

  function doneForm(c, { entryId, date, itemId }) {
    const P = c.project;
    const e = entryId ? P.get('volumes', entryId) : null;
    const d0 = e ? e.date : Math.min(date, today);
    const dateIn = h('input', { type: 'date', value: dayToInput(d0), required: true });
    const item = select(P.itemOptions(), e ? e.itemId : itemId, true, 'Без работы — только техника и люди');
    const qty = h('input', { inputmode: 'decimal', value: e ? num(e.quantity).replace(/\s/g, '') : '' });
    const who = selectAdd(P.rows('contractors').map((x) => ({ id: x.id, name: x.name })), e && e.contractorId, 'Не указан', 'Новый исполнитель', (n) => P.addNamed('contractors', n));
    const note = h('textarea', { rows: 2 }, e ? e.note : '');
    const equip = P.equipment().map((x) => ({ id: x.id, name: M.equipmentTitle(x) }));
    const mBox = h('div', { class: 'pp-sub' });
    const rows = [];
    const addMachine = (m) => {
      const eq = select(equip.concat(m.equipmentId && !equip.some((x) => x.id === m.equipmentId) ? [{ id: m.equipmentId, name: 'Техника (в архиве)' }] : []), m.equipmentId, false);
      const amount = h('input', { inputmode: 'decimal', placeholder: '15000', value: m.amountCents ? String(m.amountCents / 100).replace('.', ',') : '' });
      const hours = h('input', { placeholder: '8 или 7:30', value: hoursText(m.minutes) });
      const row = { workId: m.workId, eq, amount, hours };
      const el = h('div', { class: 'pp-row pp-wrap pp-machine' }, field('Техника', eq), field('Заплатили, ₽', amount), field('Часы', hours, 'необязательно'),
        button('Убрать', () => { el.remove(); rows.splice(rows.indexOf(row), 1); }, 'pp-icon'));
      rows.push(row);
      mBox.append(el);
    };
    if (e) P.machinesOfEntry(e.id).forEach(addMachine);
    const photos = photoBox(c, e ? e.id : null, 'Фото и видео');
    const crews = P.crews();
    const people0 = P.peopleOn(d0);
    const pInputs = crews.map((cr) => ({ cr, input: h('input', { inputmode: 'numeric', value: people0[cr.id] !== undefined ? String(people0[cr.id]) : '' }) }));
    let peopleTouched = false;
    pInputs.forEach((p) => p.input.addEventListener('input', () => { peopleTouched = true; }));
    dateIn.addEventListener('change', () => {
      if (peopleTouched) return;
      const pp = P.peopleOn(inputToDay(dateIn.value));
      pInputs.forEach((p) => { p.input.value = pp[p.cr.id] !== undefined ? String(pp[p.cr.id]) : ''; });
    });
    const body = h('div', null,
      field('Дата', dateIn), field('Работа (позиция ведомости)', item), h('div', { class: 'pp-row pp-wrap' }, field('Объём', qty), field('Исполнитель', who)), field('Примечание', note),
      photos.el,
      h('h3', null, 'Техника'), h('p', { class: 'pp-muted' }, 'Сколько заплатили — сразу расход в финансах («Аренда техники»).'), mBox,
      equip.length ? button('+ Техника', () => addMachine({ equipmentId: equip.length === 1 ? equip[0].id : null })) : h('p', { class: 'pp-muted' }, 'Техника не заведена — добавьте в окне «Техника и бригады».'),
      h('h3', null, 'Люди на объекте'),
      crews.length ? h('div', { class: 'pp-people' }, pInputs.map((p) => field(p.cr.name || 'Бригада', p.input))) : h('p', { class: 'pp-muted' }, 'Бригады не заведены — добавьте в окне «Техника и бригады».'),
      h('p', { class: 'pp-muted' }, 'Численность — на весь день, одна запись на бригаду.'));
    modal(c, e ? 'Запись журнала' : 'Что сделано', body, () => {
      const day = inputToDay(dateIn.value);
      if (day === null) bad('Укажите дату');
      if (day > today) bad('«Сделано» — только за прошедшие дни и сегодня. План на будущее — в «Задаче».');
      const q = parseQty(qty.value);
      if (item.value && (q === null || Number.isNaN(q) || q <= 0)) bad('Объём — число больше нуля');
      const machines = rows.map((r) => {
        const cents = parseMoney(r.amount.value), min = parseHours(r.hours.value);
        if (!r.eq.value) bad('Выберите технику');
        if (cents === null || Number.isNaN(cents) || cents <= 0) bad('Укажите, сколько заплатили за технику');
        if (Number.isNaN(min)) bad('Часы — как 8 или 7:30');
        return { workId: r.workId, equipmentId: r.eq.value, amountCents: cents, minutes: min };
      });
      let people = null;
      if (peopleTouched) {
        people = {};
        for (const p of pInputs) {
          const t = p.input.value.trim();
          if (t && !/^\d{1,4}$/.test(t)) bad('Число людей — целое от 0 до 1000');
          people[p.cr.id] = t ? Number(t) : null;
        }
      }
      if (!item.value && !machines.length && !people) bad('Выберите работу или отметьте технику / людей');
      if (!item.value && e) bad('У записи должна остаться работа');
      if (photos.busy()) bad('Подождите — фото ещё загружаются');
      const contractorId = who.value && who.value !== '__add' ? who.value : null;
      const id = P.saveDone({ entryId: e ? e.id : null, date: day, itemId: item.value || null, qty: q, contractorId, note: note.value.trim(), machines, people });
      if (item.value) photos.commit(id);
    }, e ? { text: 'Удалить запись', run: () => { if (!confirm('Удалить запись? Техника этой записи и её расход тоже удалятся.')) return false; P.deleteDone(e.id); } } : null);
  }

  function taskForm(c, { taskId, date }) {
    const P = c.project;
    const t = taskId ? P.get('tasks', taskId) : null;
    const tm = t ? P.taskMachines(t.id) : { equipment: [], remind: true };
    const dateIn = h('input', { type: 'date', value: dayToInput(t ? t.date : date), required: true });
    const item = select(P.itemOptions(), t && t.itemId, true, 'Без позиции — свой текст');
    const title = h('input', { value: t ? t.title : '', placeholder: 'Что сделать' });
    const qty = h('input', { inputmode: 'decimal', value: t && t.planQty !== null && t.planQty !== undefined ? String(t.planQty).replace('.', ',') : '' });
    const who = selectAdd(P.rows('contractors').map((x) => ({ id: x.id, name: x.name })), t && t.contractorId, 'Не указан', 'Новый исполнитель', (n) => P.addNamed('contractors', n));
    const note = h('textarea', { rows: 2 }, t ? t.note : '');
    const done = h('input', { type: 'checkbox' }); done.checked = !!(t && Number(t.done));
    const checks = P.equipment().map((e) => { const cb = h('input', { type: 'checkbox' }); cb.checked = tm.equipment.includes(e.id); return { e, cb }; });
    const remind = h('input', { type: 'checkbox' }); remind.checked = tm.remind || !t;
    modal(c, t ? 'Задача' : 'Новая задача', h('div', null,
      field('Дата', dateIn), field('Позиция ведомости', item), field('Что сделать', title), h('div', { class: 'pp-row pp-wrap' }, field('Объём по плану', qty), field('Исполнитель', who)), field('Примечание', note),
      h('label', { class: 'pp-check' }, done, ' Выполнено'),
      h('h3', null, 'Нужна техника'), h('p', { class: 'pp-muted' }, 'План: в финансах ничего не появится. На телефоне будет напоминание.'),
      checks.length ? h('div', { class: 'pp-checks' }, checks.map(({ e, cb }) => h('label', { class: 'pp-check' }, cb, ' ' + M.equipmentTitle(e)))) : h('p', { class: 'pp-muted' }, 'Техника не заведена.'),
      h('label', { class: 'pp-check' }, remind, ' Напомнить накануне в 18:00')), () => {
      const day = inputToDay(dateIn.value);
      if (day === null) bad('Укажите дату');
      const q = parseQty(qty.value);
      if (Number.isNaN(q)) bad('Объём — число');
      const machines = checks.filter((x) => x.cb.checked).map((x) => x.e.id);
      if (!item.value && !title.value.trim() && !machines.length) bad('Выберите позицию, напишите задачу или отметьте технику');
      P.saveTask({ taskId: t ? t.id : null, date: day, itemId: item.value || null, title: title.value, planQty: q, contractorId: who.value && who.value !== '__add' ? who.value : null, note: note.value.trim(), done: done.checked, machines, remind: remind.checked });
    }, t ? { text: 'Удалить задачу', run: () => { if (!confirm('Удалить задачу?')) return false; P.deleteTask(t.id); } } : null);
  }

  function financeForm(c, { id }) {
    const P = c.project;
    const f = id ? P.get('finance', id) : null;
    const auto = f && M.isAutoExpense(f.id);
    const note = h('textarea', { rows: 2 }, f ? f.note : '');
    if (auto) {
      return modal(c, 'Расход по технике', h('div', null,
        h('p', null, h('strong', null, money(f.amountCents)), ' · ', dayTitle(f.date)), h('p', null, f.title),
        h('p', { class: 'pp-muted' }, 'Записан сам по технике в «Сделано». Сумма и дата меняются там.'), field('Заметка', note)),
      () => { P.saveFinance({ id: f.id, note: note.value.trim() }); });
    }
    const type = select(M.TYPES.map(([k, t]) => ({ id: k, name: t })), f ? f.type : 'EXPENSE', false);
    const dateIn = h('input', { type: 'date', value: dayToInput(f ? f.date : today), required: true });
    const title = h('input', { value: f ? f.title : '' });
    const amount = h('input', { inputmode: 'decimal', value: f ? String(f.amountCents / 100).replace('.', ',') : '' });
    const cat = select(M.CATEGORIES.map(([k, t]) => ({ id: k, name: t })), f ? f.category || 'OTHER' : 'OTHER', false);
    modal(c, f ? 'Запись финансов' : 'Новая запись', h('div', null, field('Вид', type), h('div', { class: 'pp-row pp-wrap' }, field('Сумма, ₽', amount), field('Дата', dateIn)), field('Что / кому / от кого', title), field('Статья (для расходов)', cat), field('Заметка', note)), () => {
      const cents = parseMoney(amount.value);
      if (cents === null || Number.isNaN(cents) || cents <= 0) bad('Сумма — число больше нуля, например 1500 или 1500,50');
      const day = inputToDay(dateIn.value);
      if (day === null) bad('Укажите дату');
      P.saveFinance({ id: f ? f.id : null, type: type.value, date: day, title: title.value.trim(), amountCents: cents, category: cat.value, note: note.value.trim(), contractorId: f ? f.contractorId : null });
    }, f ? { text: 'Удалить', run: () => { if (!confirm('Удалить запись из финансов?')) return false; P.deleteFinance(f.id); } } : null);
  }

  function equipmentForm(c, e) {
    const name = h('input', { value: e.name || '', placeholder: 'JCB 3CX' });
    const kind = h('input', { value: e.kind || '', placeholder: 'Экскаватор' });
    const plate = h('input', { value: e.plate || '' });
    const supplier = h('input', { value: e.supplier || '' });
    const phone = h('input', { value: e.phone || '', type: 'tel' });
    const archived = h('input', { type: 'checkbox' }); archived.checked = !!Number(e.archived);
    modal(c, e.id ? 'Техника' : 'Новая техника', h('div', null, h('div', { class: 'pp-row pp-wrap' }, field('Тип', kind), field('Название / модель', name)), h('div', { class: 'pp-row pp-wrap' }, field('Номер', plate, 'необязательно'), field('Поставщик', supplier), field('Телефон', phone)),
      e.id ? h('label', { class: 'pp-check' }, archived, ' В архиве (не показывать при выборе)') : null), () => {
      if (!name.value.trim() && !kind.value.trim()) bad('Укажите тип или название');
      c.project.saveEquipment({ id: e.id, name: name.value.trim(), kind: kind.value.trim(), plate: plate.value.trim(), supplier: supplier.value.trim(), phone: phone.value.trim(), archived: archived.checked });
    });
  }

  function crewForm(c, cr) {
    const name = h('input', { value: cr.name || '', placeholder: 'Бетонщики' });
    const archived = h('input', { type: 'checkbox' }); archived.checked = !!Number(cr.archived);
    modal(c, cr.id ? 'Бригада' : 'Новая бригада', h('div', null, field('Название', name), cr.id ? h('label', { class: 'pp-check' }, archived, ' В архиве') : null), () => {
      if (!name.value.trim()) bad('Укажите название');
      c.project.saveCrew({ id: cr.id, name: name.value.trim(), archived: archived.checked });
    });
  }

  // ───────── запуск ─────────
  async function start() {
    if (starting || disk) return;
    starting = true;
    try { takeTokenFromUrl(); } catch (e) { starting = false; return loginScreen(e.message); }
    const token = authStore.get('token');
    if (!token) { starting = false; return loginScreen(); }
    const candidate = new D.Disk(token, { downloadUrl: app.dataset.downloadUrl, uploadUrl: app.dataset.uploadUrl, csrf: app.dataset.csrf });
    try {
      const user = await candidate.user();
      accountId = user.uid;
      store = R.accountStorage(rawStorage, PREFIX, user.uid);
      writerLease = await R.acquireWriter(store, navigator.locks);
      me = writerLease.id;
      ROOT = D.normalize(store.get('root') || app.dataset.root || '/Прораб+');
      HOME = ROOT;
      DESK_FILE = ROOT + '/.prorab-desktop.json';
      wall = store.json('wall', { kind: 'preset', id: 'default' });
      extraList = store.json('extra', []);
      linkList = store.json('links', []);
      clock.last = Number(store.get('clock')) || 0;
      disk = candidate;
    } catch (e) { starting = false; return fail(e); }
    starting = false;
    render();
    home.loading = true;
    // Сначала настройки стола с Диска (в них объекты из других папок), затем объекты
    loadDesk().finally(() => loadProjects().then(() => { home.loading = false; checkEcon(); }));
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshAll, 60000);
    setInterval(() => { const el = document.querySelector('.pp-clock'); if (el) el.textContent = time(); }, 30000);
  }

  window.addEventListener('storage', (e) => {
    if (e.key === PREFIX + 'token') { persistAll(); leaving = true; location.reload(); }
  });
  window.addEventListener('pagehide', persistAll);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistAll(); });
  window.addEventListener('beforeunload', (e) => {
    const busy = Object.values(ctxs).some((c) => (c.project && (c.project.dirty || c.saving)) || (c.id && (c.id.generating || c.id.storage.busy)) || (c.fix && c.fix.busy)) || econ.operation ||
      (econ.session && econ.session.editing) || (econ.vault && document.querySelector('.pp-modal[data-econ]'));
    if (busy) { persistAll(); if (!leaving) { e.preventDefault(); e.returnValue = ''; } }
  });
  start();
})();
