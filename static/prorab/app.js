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
  const app = document.getElementById('prorab');
  const CLIENT_ID = app.dataset.clientId || '';
  const ROOT = D.normalize(app.dataset.root || '/Прораб+');
  // Рабочий стол — сама папка «Прораб+»: объекты (папки с data) и всё, что создано на рабочем столе
  const HOME = ROOT;
  const DOCS = 'Документы';
  const DEFAULT_UNITS = ['м', 'п.м.', 'м²', 'м³', 'шт.', 'кг', 'т', 'компл.'];

  // ───────── хранилище браузера (только удобства; данные — на Диске) ─────────
  // data-store — отдельное хранилище (демо не трогает ключ и настройки рабочего кабинета)
  const PREFIX = 'prorab.' + (app.dataset.store ? app.dataset.store + '.' : '');
  const store = {
    get(k) { try { return localStorage.getItem(PREFIX + k); } catch (e) { return null; } },
    set(k, v) { try { if (v === null || v === undefined) localStorage.removeItem(PREFIX + k); else localStorage.setItem(PREFIX + k, v); } catch (e) { /* приватный режим */ } },
    json(k, def) { try { return JSON.parse(this.get(k) || '') || def; } catch (e) { return def; } },
  };
  function deviceId() {
    let id = store.get('device');
    if (!id) { id = 'web-' + S.newId().slice(0, 8); store.set('device', id); }
    return id;
  }

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
  const small = () => window.innerWidth < 720;
  const modalOpen = () => !!document.querySelector('.pp-modal');

  // ───────── состояние ─────────
  let disk = null;
  let status = { text: '', error: false };
  const me = deviceId();
  const clock = new S.Clock(Number(store.get('clock')) || 0);
  const today = S.today();
  let projects = null; // [{ path, name }]
  let projectsError = null;
  const ctxs = {}; // папка объекта → { path, project, loading, error, saving, saveTimer, status }
  let wins = [];
  let zTop = 10;
  let home = { items: null, loading: false, selected: null };
  let refreshTimer = null;

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
    const p = new URLSearchParams(location.hash.slice(1));
    const t = p.get('access_token');
    if (t) store.set('token', t);
    history.replaceState(null, '', location.pathname + location.search);
  }

  function loginScreen(message) {
    app.classList.remove('pp-desk-app');
    const input = h('input', { type: 'password', autocomplete: 'off', placeholder: 'y0_…' });
    app.replaceChildren(h('section', { class: 'pp-card pp-narrow' },
      h('h1', null, 'Прораб+ на компьютере'),
      h('p', { class: 'pp-muted' }, 'Все ваши объекты — те же, что в телефоне: данные берутся из папок объектов на вашем Яндекс Диске и записываются обратно. Ключ хранится только в этом браузере.'),
      message ? h('p', { class: 'pp-error' }, message) : null,
      CLIENT_ID ? button('Войти через Яндекс', () => {
        const back = location.origin + location.pathname;
        location.href = 'https://oauth.yandex.ru/authorize?response_type=token&client_id=' + encodeURIComponent(CLIENT_ID) + '&redirect_uri=' + encodeURIComponent(back);
      }, 'pp-primary') : null,
      h('details', { open: !CLIENT_ID },
        h('summary', null, 'Войти по ключу Яндекс Диска'),
        h('ol', null,
          h('li', null, 'Откройте ', h('a', { href: 'https://yandex.ru/dev/disk/poligon/', target: '_blank', rel: 'noopener' }, 'Полигон Яндекс Диска'), ' и войдите своим Яндексом.'),
          h('li', null, 'Нажмите «Получить OAuth-токен» и скопируйте строку.'),
          h('li', null, 'Вставьте её сюда. Никому её не пересылайте.')),
        field('Ключ', input),
        button('Войти', () => { const t = input.value.trim(); if (!t) return; store.set('token', t); start(); }, 'pp-primary')),
    ));
  }

  function fail(e) {
    if (e && e.status === 401) { store.set('token', null); return loginScreen(e.message); }
    app.classList.remove('pp-desk-app');
    app.replaceChildren(h('section', { class: 'pp-card pp-narrow' }, h('p', { class: 'pp-error' }, (e && e.message) || String(e)), button('Повторить', start)));
  }

  function logout() {
    for (const c of Object.values(ctxs)) save(c);
    store.set('token', null);
    clearInterval(refreshTimer);
    wins = []; projects = null; disk = null;
    for (const k of Object.keys(ctxs)) delete ctxs[k];
    loginScreen();
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
      for (const p of store.json('extra', [])) if (!paths.includes(p)) paths.push(p);
      const found = [];
      for (let i = 0; i < paths.length; i += 6) {
        const part = paths.slice(i, i + 6);
        const ok = await Promise.all(part.map((p) => hasData(p).catch(() => false)));
        part.forEach((p, k) => { if (ok[k]) found.push({ path: p, name: projName(p) }); });
      }
      projects = found.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      const isProject = new Set(found.map((p) => p.path));
      home.items = sortItems(root.filter((i) => !isProject.has(ROOT + '/' + i.name)));
    } catch (e) {
      home.items = home.items || [];
      projects = projects || [];
      projectsError = e.message;
      if (e.status === 401) return fail(e);
    }
    render();
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

  const pendingKey = (c) => 'pending:' + c.path;

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
        const pending = store.get(pendingKey(c));
        const extra = pending ? [JSON.parse(pending)] : [];
        c.project = new M.Project(S.mergeFiles(files.concat(extra), pid, clock), SCHEMA, pid, me, clock);
        if (extra.length) { c.project.dirty = true; scheduleSave(c, 0); }
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
    if (!c.project || c.saving) return;
    try {
      const files = await readFiles(c.path);
      const mine = S.toFile(c.project.state, c.project.projectId, c.project.project.name, me);
      const dirty = c.project.dirty;
      c.project = new M.Project(S.mergeFiles(files.concat([mine]), c.project.projectId, clock), SCHEMA, c.project.projectId, me, clock);
      c.project.dirty = dirty;
      store.set('clock', String(clock.last));
      c.status = 'Обновлено в ' + time();
    } catch (e) { c.status = e.message; setStatus(projName(c.path) + ': ' + e.message, true); }
  }

  async function refreshAll() {
    const open = new Set(wins.map((w) => w.folder).filter(Boolean));
    for (const path of open) if (ctxs[path]) await refreshCtx(ctxs[path]);
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
    const text = JSON.stringify(S.toFile(c.project.state, c.project.projectId, c.project.project.name, me));
    // До записи на Диск правки лежат в браузере: закрытая вкладка их не теряет
    store.set(pendingKey(c), text);
    store.set('clock', String(clock.last));
    c.project.dirty = false;
    c.status = 'Сохраняю на Диск…';
    setStatus(projName(c.path) + ': сохраняю…');
    try {
      await disk.putText(c.path + '/data/' + me + '.json', text);
      store.set(pendingKey(c), null);
      c.status = 'Сохранено в ' + time() + ' — телефон получит при синхронизации';
      setStatus(projName(c.path) + ': сохранено в ' + time());
    } catch (e) {
      c.project.dirty = true;
      c.status = 'Не сохранилось: ' + e.message;
      setStatus(projName(c.path) + ': не сохранилось на Диск — правки в браузере, повторю через минуту', true);
      scheduleSave(c, 60000);
    } finally { c.saving = false; if (!modalOpen()) render(); }
  }

  function changed(c) { scheduleSave(c); render(); }

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
    } catch (e) { alert(e.message); }
  }

  // ───────── окна ─────────
  const APPS = {
    journal: { title: 'Журнал работ', icon: '📒', view: (w, c) => journalView(w, c) },
    calendar: { title: 'Календарь', icon: '📅', view: (w, c) => calendarView(w, c) },
    boq: { title: 'Ведомость', icon: '📋', view: (w, c) => boqView(w, c) },
    finance: { title: 'Финансы', icon: '💰', view: (w, c) => financeView(w, c) },
    machines: { title: 'Техника и бригады', icon: '🚜', view: (w, c) => machinesView(w, c) },
    explorer: { title: 'Документы', icon: '🗂️', view: (w) => explorerView(w) },
    project: { title: 'Объект', icon: '🏗️', view: (w, c) => projectView(w, c) },
    picker: { title: 'Добавить объект', icon: '➕', view: (w) => pickerView(w) },
  };
  const PROJECT_APPS = ['journal', 'calendar', 'boq', 'finance', 'machines', 'explorer'];

  function openWindow(kind, folder, opts) {
    opts = opts || {};
    const base = kind === 'explorer' ? opts.base || (folder ? folder + '/' + DOCS : HOME) : null;
    const key = [kind, folder || '', base || '', opts.path || ''].join('|');
    let w = wins.find((x) => x.key === key);
    if (!w) {
      const lay = store.json('layout', {})[kind] || {};
      const n = wins.length % 8;
      w = {
        id: S.newId(), key, kind, folder: folder || null, base, path: opts.path || '', items: null,
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
  const closeWindow = (w) => { wins = wins.filter((x) => x !== w); if (w.folder && ctxs[w.folder]) save(ctxs[w.folder]); render(); };
  function winTitle(w) {
    if (w.kind === 'explorer') {
      const where = w.folder ? projName(w.folder) + ' · ' + DOCS : 'Рабочий стол (' + lastName(ROOT) + ')';
      return where + (w.path ? ' › ' + w.path.split('/').join(' › ') : '');
    }
    if (w.kind === 'project') return projName(w.folder);
    if (w.kind === 'picker') return APPS.picker.title;
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
    const body = h('div', { class: 'pp-winbody' }, content);
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
      ...(home.items || []).map((it) => ({ key: 'home:' + it.name, icon: fileIcon(it), name: shownName(it), open: () => openItem(null, it, HOME, ''), menu: (x, y) => itemMenu(x, y, null, it, HOME, '') })),
    ];
    const visible = wins.filter((w) => !w.min).sort((a, b) => a.z - b.z);
    app.classList.add('pp-desk-app');
    app.replaceChildren(
      h('div', { class: 'pp-desktop', oncontextmenu: (e) => { if (e.target.classList.contains('pp-desktop') || e.target.classList.contains('pp-icons')) { e.preventDefault(); homeMenu(e.clientX, e.clientY); } } },
        h('div', { class: 'pp-icons', onclick: (e) => { if (e.target.classList.contains('pp-icons')) { home.selected = null; render(); } } },
          projects === null ? h('p', { class: 'pp-desk-note' }, 'Ищу объекты на Диске…') : null,
          projects && !projects.length ? h('p', { class: 'pp-desk-note' }, 'Рабочий стол — папка «' + lastName(ROOT) + '» на вашем Яндекс Диске. Объектов в ней пока нет: правый щелчок → «Новый объект» или «Добавить объект из папки».') : null,
          projectsError ? h('p', { class: 'pp-desk-note pp-error' }, projectsError) : null,
          icons.map((ic) => h('button', {
            type: 'button', class: 'pp-icon-btn' + (home.selected === ic.key ? ' pp-selected' : ''), title: ic.name,
            onclick: () => { if (small() || home.selected === ic.key) ic.open(); else { home.selected = ic.key; render(); } },
            ondblclick: ic.open,
            oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); ic.menu(e.clientX, e.clientY); },
          }, h('span', { class: 'pp-icon-img' }, ic.icon), h('span', { class: 'pp-icon-name' }, ic.name)))),
        visible.map(windowEl)),
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
      ['+ Новый объект', newProject], ['➕ Добавить объект из папки…', () => openWindow('picker', null)],
      ['-'], ['🗂️ Рабочий стол в проводнике', () => openWindow('explorer', null, { base: HOME })],
      open.length ? ['💾 Сохранить всё сейчас', () => open.forEach((p) => save(ctxs[p]))] : null,
      ['-'], ['Выйти', logout],
    ]);
  }

  function homeMenu(x, y) {
    popup(x, y, [
      ['⟳ Обновить', () => { home.items = null; loadProjects(); }],
      ['-'], ['#Создать'],
      ['🔗 Ярлык на сайт', () => createIn(HOME, '', 'url')], ['📁 Папку', () => createIn(HOME, '', 'dir')], ['📝 Документ Word', () => createIn(HOME, '', 'docx')], ['📊 Таблицу Excel', () => createIn(HOME, '', 'xlsx')],
      ['🏗️ Новый объект', newProject],
      ['-'], ['➕ Добавить объект из папки…', () => openWindow('picker', null)], ['⬆ Загрузить файлы…', () => uploadInto(HOME, '')], ['Открыть папку на Диске', () => window.open(D.webFolder(HOME), '_blank', 'noopener')],
    ]);
  }

  function projectMenu(x, y, p) {
    const extra = store.json('extra', []).includes(p.path);
    popup(x, y, [
      ['Открыть', () => openWindow('project', p.path)],
      ['-'], ...PROJECT_APPS.map((k) => [APPS[k].icon + ' ' + APPS[k].title, () => openWindow(k, p.path)]),
      ['-'], ['+ Сделано', () => withCtx(p.path, (c) => doneForm(c, { date: today }))], ['+ Задача', () => withCtx(p.path, (c) => taskForm(c, { date: today }))],
      ['-'], ['Открыть папку на Диске', () => window.open(D.webFolder(p.path), '_blank', 'noopener')],
      extra ? ['Убрать из списка', () => { store.set('extra', JSON.stringify(store.json('extra', []).filter((x) => x !== p.path))); loadProjects(); }] : null,
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
    return h('div', { class: 'pp-project' },
      h('div', { class: 'pp-row pp-between pp-wrap' },
        h('div', null, h('h2', null, p.name || 'Объект'), h('small', { class: 'pp-muted' }, [p.address, w.folder].filter(Boolean).join(' · '))),
        h('div', { class: 'pp-row' }, button('+ Задача', () => taskForm(c, { date: today })), button('+ Сделано', () => doneForm(c, { date: today }), 'pp-primary'))),
      h('p', { class: 'pp-muted' }, 'Сегодня в плане: ' + plan + (late ? ' · просрочено: ' + late : '') + ' · записей «Сделано» за 7 дней: ' + done + ' · ' + c.status),
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
      h('p', { class: 'pp-muted' }, 'Позиций: ' + rows.length + (totalPlan ? ' · с планом: ' + totalPlan : '') + '. Сделанное — сумма записей «Сделано». Позиции добавляются в телефоне.'),
      rows.length ? h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table' },
        h('thead', null, h('tr', null, ['Работа', 'План', 'Сделано', '%', 'Осталось', 'Срок', ''].map((t) => h('th', null, t)))),
        h('tbody', null, rows.map((r) => {
          const bar = h('span', { class: 'pp-bar-fill' + (r.percent >= 100 ? ' pp-full' : '') });
          bar.style.width = Math.max(0, Math.min(100, r.percent || 0)) + '%';
          const late = r.due && r.due < today && !r.finished && (r.remaining === null || r.remaining > 0);
          return h('tr', null,
            h('td', null, h('strong', null, r.name), r.work && r.work !== r.name ? h('small', null, r.work) : null, r.who ? h('small', null, r.who) : null),
            h('td', { class: 'pp-num' }, r.plan === null ? '—' : num(r.plan) + ' ' + r.unit),
            h('td', { class: 'pp-num' }, num(r.fact) + ' ' + r.unit),
            h('td', null, r.percent === null ? '' : h('span', { class: 'pp-progress' }, bar, h('span', null, num(r.percent) + '%'))),
            h('td', { class: 'pp-num' + (r.remaining !== null && r.remaining < 0 ? ' pp-plus' : '') }, r.remaining === null ? '' : num(r.remaining)),
            h('td', { class: late ? 'pp-error' : '' }, r.finished ? 'готово' : r.due ? shortDate(r.due) : ''),
            h('td', null, button('+ Сделано', () => doneForm(c, { date: today, itemId: r.id }))));
        })))) : h('p', { class: 'pp-card pp-muted' }, 'Ведомость пуста — позиции добавляются в приложении на телефоне.'));
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
  const EXT_ICON = { url: '🔗', docx: '📝', doc: '📝', xlsx: '📊', xls: '📊', csv: '📊', pdf: '📕', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', webp: '🖼️', dwg: '📐', dxf: '📐', zip: '🗜️', txt: '📄', pptx: '📽️' };
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
      else openWindow('explorer', base === HOME ? null : base.slice(0, -(DOCS.length + 1)), { base, path });
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
    if (['docx', 'xlsx', 'pptx', 'doc', 'xls', 'csv', 'txt', 'pdf'].includes(ext(it.name))) window.open(D.webEdit(full), '_blank', 'noopener');
    else { try { window.open(await disk.downloadHref(full), '_blank', 'noopener'); } catch (e) { alert(e.message); } }
  }

  function itemMenu(x, y, w, it, base, rel) {
    const pr = projectAt(base, rel, it);
    if (pr) return projectMenu(x, y, pr);
    const full = dirOf(base, rel) + '/' + it.name;
    popup(x, y, [
      ['Открыть', () => openItem(w, it, base, rel)],
      ext(it.name) === 'url' ? ['Изменить адрес', () => createShortcut(base, rel, it)] : null,
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
    const up = path === '/' ? null : path.split('/').slice(0, -1).join('/') || '/';
    const isObject = (w.items || []).some((i) => i.type === 'dir' && i.name === 'data');
    const go = (p) => { w.path = p; loadFolder(w); render(); };
    return h('div', null,
      h('p', { class: 'pp-muted' }, 'Найдите папку объекта (в ней есть папка data) — она появится на рабочем столе.'),
      h('div', { class: 'pp-row pp-wrap pp-toolbar' }, button('←', () => { if (up) go(up); }, 'pp-icon'), h('span', { class: 'pp-crumbs' }, path),
        isObject ? button('Добавить этот объект', () => {
          const list = store.json('extra', []);
          if (!list.includes(path)) list.push(path);
          store.set('extra', JSON.stringify(list));
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
    const who = select(P.rows('contractors').map((x) => ({ id: x.id, name: x.name })), e && e.contractorId, true, 'Не указан');
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
      P.saveDone({ entryId: e ? e.id : null, date: day, itemId: item.value || null, qty: q, contractorId: who.value || null, note: note.value.trim(), machines, people });
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
    const who = select(P.rows('contractors').map((x) => ({ id: x.id, name: x.name })), t && t.contractorId, true, 'Не указан');
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
      P.saveTask({ taskId: t ? t.id : null, date: day, itemId: item.value || null, title: title.value, planQty: q, contractorId: who.value || null, note: note.value.trim(), done: done.checked, machines, remind: remind.checked });
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
    takeTokenFromUrl();
    const token = store.get('token');
    if (!token) return loginScreen();
    disk = new D.Disk(token);
    try { await disk.user(); } catch (e) { disk = null; return fail(e); }
    render();
    home.loading = true;
    loadProjects().then(() => { home.loading = false; });
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshAll, 60000);
    setInterval(() => { const el = document.querySelector('.pp-clock'); if (el) el.textContent = time(); }, 30000);
  }

  window.addEventListener('beforeunload', (e) => {
    const busy = Object.values(ctxs).some((c) => c.project && (c.project.dirty || c.saving));
    if (busy) { Object.values(ctxs).forEach((c) => save(c)); e.preventDefault(); e.returnValue = ''; }
  });
  start();
})();
