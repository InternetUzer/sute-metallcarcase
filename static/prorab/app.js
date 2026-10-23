/* «Прораб+» в браузере — экраны: вход, выбор объекта, журнал по дням, финансы, техника и бригады. */
(function () {
  'use strict';
  const S = window.ProrabSync, M = window.ProrabModel, D = window.ProrabDisk, SCHEMA = window.PRORAB_SCHEMA;
  const app = document.getElementById('prorab');
  const CLIENT_ID = app.dataset.clientId || '';

  // ───────── хранилище браузера (только удобства; данные — на Диске) ─────────
  // data-store — отдельное хранилище (демо не трогает ключ и настройки рабочего кабинета)
  const PREFIX = 'prorab.' + (app.dataset.store ? app.dataset.store + '.' : '');
  const store = {
    get(k) { try { return localStorage.getItem(PREFIX + k); } catch (e) { return null; } },
    set(k, v) { try { if (v === null || v === undefined) localStorage.removeItem(PREFIX + k); else localStorage.setItem(PREFIX + k, v); } catch (e) { /* приватный режим */ } },
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
  const dayTitle = (d) => { const t = new Date(d * 86400000).toLocaleDateString('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
  const money = (c) => (c / 100).toLocaleString('ru-RU', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' ₽';
  const num = (q) => (q === null || q === undefined ? '' : Number(q).toLocaleString('ru-RU', { maximumFractionDigits: 6 }));
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
  const button = (text, onclick, cls) => h('button', { type: 'button', class: 'pp-btn ' + (cls || ''), onclick }, text);
  function select(options, value, allowNone, noneText) {
    const s = h('select');
    if (allowNone) s.append(h('option', { value: '' }, noneText || '—'));
    for (const o of options) { const opt = h('option', { value: o.id }, o.name); if (o.id === value) opt.selected = true; s.append(opt); }
    if (!allowNone && !value && options[0]) s.value = options[0].id;
    return s;
  }

  // ───────── состояние сессии ─────────
  let disk = null, folder = null, project = null, files = [], status = { text: '', error: false };
  const today = S.today();
  let period = { from: today - 30, to: today };
  let saveTimer = null, refreshTimer = null, saving = false;
  const me = deviceId();
  const clock = new S.Clock(Number(store.get('clock')) || 0);
  const pendingKey = () => 'pending:' + folder;

  function setStatus(text, error) { status = { text, error: !!error }; const el = document.getElementById('pp-status'); if (el) { el.textContent = text; el.className = 'pp-status' + (error ? ' pp-error' : ''); } }

  // ───────── вход ─────────
  function takeTokenFromUrl() {
    if (!location.hash.includes('access_token=')) return;
    const p = new URLSearchParams(location.hash.slice(1));
    const t = p.get('access_token');
    if (t) store.set('token', t);
    history.replaceState(null, '', location.pathname + location.search);
  }

  function loginScreen(message) {
    const input = h('input', { type: 'password', autocomplete: 'off', placeholder: 'y0_…' });
    app.replaceChildren(h('section', { class: 'pp-card pp-narrow' },
      h('h1', null, 'Прораб+ на компьютере'),
      h('p', { class: 'pp-muted' }, 'Те же объекты, что в телефоне: данные берутся из вашей папки на Яндекс Диске и записываются обратно. Ключ хранится только в этом браузере.'),
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
        button('Войти', async () => {
          const t = input.value.trim();
          if (!t) return;
          store.set('token', t);
          start();
        }, 'pp-primary')),
    ));
  }

  // ───────── выбор объекта ─────────
  async function folderScreen(path) {
    path = D.normalize(path || '/');
    app.replaceChildren(h('section', { class: 'pp-card' }, h('p', null, 'Открываю ' + path + '…')));
    let items;
    try { items = await disk.list(path); } catch (e) { return fail(e); }
    if (items === null) return folderScreen('/');
    const dirs = items.filter((i) => i.type === 'dir').sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const isObject = items.some((i) => i.type === 'dir' && i.name === 'data');
    const recent = JSON.parse(store.get('recent') || '[]');
    const up = path === '/' ? null : path.split('/').slice(0, -1).join('/') || '/';
    app.replaceChildren(h('section', { class: 'pp-card' },
      h('div', { class: 'pp-row pp-between' }, h('h1', null, 'Выберите объект'), button('Выйти', logout)),
      h('p', { class: 'pp-muted' }, 'Папка объекта — та, к которой подключён объект в телефоне (Настройки → облако). В ней лежит папка data.'),
      recent.length ? h('div', { class: 'pp-list' }, h('h2', null, 'Недавние'), recent.map((r) => h('button', { type: 'button', class: 'pp-item', onclick: () => openProject(r.path) }, h('strong', null, r.name || r.path), h('small', null, r.path)))) : null,
      h('h2', null, path),
      isObject ? button('Открыть этот объект', () => openProject(path), 'pp-primary') : null,
      h('div', { class: 'pp-list' },
        up ? h('button', { type: 'button', class: 'pp-item', onclick: () => folderScreen(up) }, '← Наверх') : null,
        dirs.filter((d) => !(isObject && (d.name === 'data' || d.name === 'files'))).map((d) => h('button', { type: 'button', class: 'pp-item', onclick: () => folderScreen(path.replace(/\/$/, '') + '/' + d.name) }, '📁 ' + d.name)),
        !dirs.length ? h('p', { class: 'pp-muted' }, 'Папок нет') : null),
    ));
  }

  function rememberRecent(path, name) {
    const list = JSON.parse(store.get('recent') || '[]').filter((r) => r.path !== path);
    list.unshift({ path, name });
    store.set('recent', JSON.stringify(list.slice(0, 8)));
  }

  // ───────── загрузка и запись ─────────
  async function readFiles() {
    const items = (await disk.list(folder + '/data')) || [];
    const out = [];
    for (const it of items.filter((i) => i.type === 'file' && i.name.endsWith('.json'))) {
      const text = await disk.getText(folder + '/data/' + it.name);
      if (text === null) continue;
      let j;
      try { j = JSON.parse(text); } catch (e) { throw new Error('Повреждены данные на Диске: ' + it.name + '. Повторите позже.'); }
      if (!S.validFile(j)) throw new Error('Неизвестный формат данных: ' + it.name + '. Обновите приложение на телефоне.');
      j.device = j.device || it.name.replace(/\.json$/, '');
      out.push(j);
    }
    return out;
  }

  async function openProject(path) {
    folder = D.normalize(path);
    app.replaceChildren(h('section', { class: 'pp-card' }, h('p', null, 'Загружаю данные объекта…')));
    try {
      files = await readFiles();
      if (!files.length) throw new Error('В этой папке нет данных объекта. Подключите объект к ней в телефоне и синхронизируйте.');
      const best = files.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
      const pid = best.projectId;
      if (files.some((f) => f.projectId && f.projectId !== pid)) throw new Error('В папке данные разных объектов — откройте папку одного объекта.');
      const pending = store.get(pendingKey());
      const extra = pending ? [JSON.parse(pending)] : [];
      const state = S.mergeFiles(files.concat(extra), pid, clock);
      project = new M.Project(state, SCHEMA, pid, me, clock);
      if (extra.length) { project.dirty = true; scheduleSave(0); }
      rememberRecent(folder, project.project.name);
      wins = []; desk = { items: null, loading: false, selected: null };
      if (!small()) openWindow('journal');
      setStatus('Загружено в ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
      render();
      clearInterval(refreshTimer);
      refreshTimer = setInterval(refresh, 60000);
    } catch (e) { fail(e, true); }
  }

  /** Забрать чужие правки (раз в минуту и по кнопке); свои несохранённые не теряются. */
  async function refresh() {
    if (!project || saving) return;
    try {
      setStatus('Обновляю…');
      files = await readFiles();
      const mine = S.toFile(project.state, project.projectId, project.project.name, me);
      const dirty = project.dirty;
      const state = S.mergeFiles(files.concat([mine]), project.projectId, clock);
      project = new M.Project(state, SCHEMA, project.projectId, me, clock);
      project.dirty = dirty;
      store.set('clock', String(clock.last));
      setStatus('Обновлено в ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
      if (!document.querySelector('.pp-modal')) render();
    } catch (e) { setStatus(e.message, true); }
  }

  function scheduleSave(delay) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, delay === undefined ? 800 : delay);
  }

  async function save() {
    if (!project || !project.dirty) return;
    if (saving) return scheduleSave(1000);
    saving = true;
    const doc = S.toFile(project.state, project.projectId, project.project.name, me);
    const text = JSON.stringify(doc);
    // До записи на Диск правки лежат в браузере: закрытая вкладка их не теряет
    store.set(pendingKey(), text);
    store.set('clock', String(clock.last));
    project.dirty = false;
    setStatus('Сохраняю на Диск…');
    try {
      await disk.putText(folder + '/data/' + me + '.json', text);
      store.set(pendingKey(), null);
      setStatus('Сохранено в ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ' — телефон получит при синхронизации');
    } catch (e) {
      project.dirty = true;
      setStatus('Не сохранилось на Диск: ' + e.message + ' Правки сохранены в браузере, повторю через минуту.', true);
      scheduleSave(60000);
    } finally { saving = false; }
  }

  function changed() { scheduleSave(); render(); }

  function fail(e, back) {
    if (e && e.status === 401) { store.set('token', null); return loginScreen(e.message); }
    app.replaceChildren(h('section', { class: 'pp-card pp-narrow' },
      h('p', { class: 'pp-error' }, (e && e.message) || String(e)),
      button(back ? 'Выбрать другую папку' : 'Повторить', () => (back ? folderScreen(folder ? folder.split('/').slice(0, -1).join('/') : '/') : start()))));
  }

  function logout() {
    store.set('token', null);
    clearInterval(refreshTimer);
    project = null; disk = null;
    loginScreen();
  }

  // ───────── рабочий стол объекта: значки, окна, панель задач ─────────
  const APPS = {
    journal: { title: 'Журнал работ', icon: '📒', view: () => journalView() },
    finance: { title: 'Финансы', icon: '💰', view: () => financeView() },
    machines: { title: 'Техника и бригады', icon: '🚜', view: () => machinesView() },
    explorer: { title: 'Документы', icon: '🗂️', view: (w) => explorerView(w) },
  };
  const DOCS = 'Документы'; // папка документов объекта: <папка объекта>/Документы
  let wins = [];
  let zTop = 10;
  let desk = { items: null, loading: false, selected: null };
  const docsRoot = () => folder + '/' + DOCS;
  const small = () => window.innerWidth < 720;

  function openWindow(kind, opts) {
    opts = opts || {};
    const key = kind + ':' + (opts.path || '');
    let w = wins.find((x) => x.key === key);
    if (!w) {
      const n = wins.length;
      w = { id: S.newId(), key, kind, path: opts.path || '', x: 140 + n * 28, y: 24 + n * 24, w: Math.min(980, window.innerWidth - 180), h: Math.min(640, window.innerHeight - 120), min: false, max: small(), items: null };
      wins.push(w);
      if (kind === 'explorer') loadFolder(w);
    }
    w.min = false;
    w.z = ++zTop;
    render();
  }
  const closeWindow = (w) => { wins = wins.filter((x) => x !== w); render(); };
  const winTitle = (w) => (w.kind === 'explorer' && w.path ? w.path.split('/').pop() : APPS[w.kind].title);

  /** Таскание окна за заголовок (мышь и палец). */
  function dragger(w, el) {
    return (e) => {
      if (w.max || e.target.closest('button')) return;
      const sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y;
      w.z = ++zTop; el.style.zIndex = w.z;
      const move = (ev) => { w.x = Math.max(0, ox + ev.clientX - sx); w.y = Math.max(0, oy + ev.clientY - sy); el.style.left = w.x + 'px'; el.style.top = w.y + 'px'; };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
  }

  function windowEl(w) {
    const el = h('section', { class: 'pp-win' + (w.max ? ' pp-max' : ''), onpointerdown: () => { if (w.z !== zTop) { w.z = ++zTop; el.style.zIndex = w.z; } } });
    if (!w.max) { el.style.left = w.x + 'px'; el.style.top = w.y + 'px'; el.style.width = w.w + 'px'; el.style.height = w.h + 'px'; }
    el.style.zIndex = w.z;
    const bar = h('header', { class: 'pp-winbar', ondblclick: () => { w.max = !w.max; render(); } },
      h('span', { class: 'pp-wintitle' }, APPS[w.kind].icon + ' ' + winTitle(w)),
      h('span', { class: 'pp-winbtns' },
        h('button', { type: 'button', title: 'Свернуть', onclick: () => { w.min = true; render(); } }, '–'),
        h('button', { type: 'button', title: w.max ? 'Обычный размер' : 'Развернуть', onclick: () => { w.max = !w.max; render(); } }, w.max ? '❐' : '□'),
        h('button', { type: 'button', title: 'Закрыть', class: 'pp-close', onclick: () => closeWindow(w) }, '✕')));
    bar.addEventListener('pointerdown', dragger(w, el));
    const body = h('div', { class: 'pp-winbody' }, APPS[w.kind].view(w));
    // Размер окна — за правый нижний угол; запоминаем
    if (!w.max) new ResizeObserver(() => { if (el.isConnected && !w.max) { w.w = el.offsetWidth; w.h = el.offsetHeight; } }).observe(el);
    el.append(bar, body);
    return el;
  }

  function render() {
    if (!project) return;
    const p = project.project;
    const scroll = Object.fromEntries(Array.from(document.querySelectorAll('.pp-win')).map((el, i) => [i, el.querySelector('.pp-winbody') ? el.querySelector('.pp-winbody').scrollTop : 0]));
    const icons = [
      ...Object.entries(APPS).map(([k, a]) => ({ key: 'app:' + k, icon: a.icon, name: a.title, open: () => openWindow(k) })),
      ...(desk.items || []).map((it) => ({ key: 'doc:' + it.name, icon: fileIcon(it), name: shownName(it), item: it, open: () => openItem(null, it, DOCS) })),
    ];
    const visible = wins.filter((w) => !w.min).sort((a, b) => a.z - b.z);
    const clock = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    app.classList.add('pp-desk-app');
    app.replaceChildren(
      h('div', { class: 'pp-desktop', oncontextmenu: (e) => { if (e.target.classList.contains('pp-desktop') || e.target.classList.contains('pp-icons')) { e.preventDefault(); createMenu(e.clientX, e.clientY, null); } }, onclick: (e) => { if (e.target.classList.contains('pp-icons')) { desk.selected = null; render(); } } },
        h('div', { class: 'pp-icons' }, icons.map((ic) => h('button', {
          type: 'button', class: 'pp-icon-btn' + (desk.selected === ic.key ? ' pp-selected' : ''), title: ic.name,
          onclick: () => { if (small() || desk.selected === ic.key) ic.open(); else { desk.selected = ic.key; render(); } },
          ondblclick: ic.open,
          oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); if (ic.item) itemMenu(e.clientX, e.clientY, null, ic.item, DOCS); else popup(e.clientX, e.clientY, [['Открыть', ic.open]]); },
        }, h('span', { class: 'pp-icon-img' }, ic.icon), h('span', { class: 'pp-icon-name' }, ic.name)))),
        visible.map(windowEl)),
      h('footer', { class: 'pp-taskbar' },
        h('button', { type: 'button', class: 'pp-start', onclick: (e) => startMenu(e) }, '▦ ' + (p.name || 'Объект')),
        h('div', { class: 'pp-tasks' }, wins.map((w) => h('button', { type: 'button', class: 'pp-task' + (!w.min && w.z === zTop ? ' pp-active' : ''), onclick: () => { if (!w.min && w.z === zTop) w.min = true; else { w.min = false; w.z = ++zTop; } render(); } }, APPS[w.kind].icon + ' ' + winTitle(w)))),
        h('span', { id: 'pp-status', class: 'pp-status' + (status.error ? ' pp-error' : '') }, status.text),
        button('⟳', refresh, 'pp-tray'),
        h('span', { class: 'pp-clock' }, clock)),
    );
    document.querySelectorAll('.pp-win .pp-winbody').forEach((b, i) => { if (scroll[i]) b.scrollTop = scroll[i]; });
    if (desk.items === null && !desk.loading) loadDesktop();
  }

  function popup(x, y, items) {
    document.querySelectorAll('.pp-menu').forEach((m) => m.remove());
    const m = h('div', { class: 'pp-menu', oncontextmenu: (e) => e.preventDefault() }, items.filter(Boolean).map(([t, f]) => (t === '-' ? h('hr') : t.startsWith('#') ? h('div', { class: 'pp-menu-head' }, t.slice(1)) : h('button', { type: 'button', onclick: () => { m.remove(); f(); } }, t))));
    m.style.left = Math.min(x, window.innerWidth - 240) + 'px';
    m.style.top = Math.max(4, Math.min(y, window.innerHeight - 36 * items.length - 60)) + 'px';
    document.body.append(m);
    setTimeout(() => window.addEventListener('click', () => m.remove(), { once: true }), 0);
  }

  function startMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    popup(r.left, r.top - 330, [
      ['📒 Журнал работ', () => openWindow('journal')], ['💰 Финансы', () => openWindow('finance')], ['🚜 Техника и бригады', () => openWindow('machines')], ['🗂️ Документы', () => openWindow('explorer')],
      ['-'], ['+ Сделано', () => doneForm({ date: today })], ['+ Задача', () => taskForm({ date: today })],
      ['-'], ['Другой объект', () => { clearInterval(refreshTimer); save(); wins = []; desk = { items: null, loading: false, selected: null }; app.classList.remove('pp-desk-app'); folderScreen(folder.split('/').slice(0, -1).join('/') || '/'); }],
      ['Выйти', logout],
    ]);
  }

  // ───────── документы: папки и файлы на Диске (Word, Excel, свои файлы) ─────────
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

  async function loadDesktop() {
    desk.loading = true;
    try {
      let items = await disk.list(docsRoot());
      if (items === null) items = [];
      desk.items = sortItems(items);
    } catch (e) { desk.items = []; setStatus(e.message, true); }
    desk.loading = false;
    if (!document.querySelector('.pp-modal')) render();
  }

  async function loadFolder(w) {
    w.items = null; w.error = null;
    try {
      const items = await disk.list(docsRoot() + (w.path ? '/' + w.path : ''));
      w.items = sortItems(items || []);
    } catch (e) { w.items = []; w.error = e.message; }
    if (!document.querySelector('.pp-modal')) render();
  }

  /** Папка изменилась — обновить рабочий стол и открытые окна этой папки. */
  function reloadFolder(rel) {
    if (!rel) { desk.items = null; }
    wins.filter((w) => w.kind === 'explorer' && w.path === rel).forEach(loadFolder);
    render();
  }

  const validName = (n) => n && !/[\\/:*?"<>|]/.test(n) && n !== '.' && n !== '..' && n.length <= 120;

  /** Ярлык на сайт: адрес и имя → файл «Имя.url» в папке. */
  async function createShortcut(rel, old) {
    const oldUrl = old ? parseShortcut(await disk.getText(docsRoot() + (rel ? '/' + rel : '') + '/' + old.name)) : '';
    const url = cleanUrl(prompt('Адрес сайта', oldUrl || 'https://'));
    if (!url) { if (url === null && !old) alert('Нужен адрес сайта, например metalcarcase.ru или https://disk.yandex.ru'); return; }
    let name = old ? old.name.slice(0, -4) : (prompt('Имя ярлыка', new URL(url).hostname.replace(/^www\./, '')) || '').trim();
    if (!name) return;
    if (!validName(name)) return alert('В имени нельзя использовать \\ / : * ? " < > |');
    const dir = docsRoot() + (rel ? '/' + rel : '');
    try {
      await disk.mkdir(folder + '/' + DOCS);
      await disk.putBlob(dir + '/' + name + '.url', new Blob([shortcutText(url)], { type: 'text/plain' }), !!old);
      setStatus((old ? 'Ярлык изменён: ' : 'Создан ярлык: ') + name);
      reloadFolder(rel);
    } catch (e) { alert(e.message); }
  }

  async function createIn(rel, kind) {
    if (kind === 'url') return createShortcut(rel, null);
    const label = { dir: 'Имя новой папки', docx: 'Название документа Word', xlsx: 'Название таблицы Excel' }[kind];
    const base = { dir: 'Новая папка', docx: 'Новый документ', xlsx: 'Новая таблица' }[kind];
    let name = (prompt(label, base) || '').trim();
    if (!name) return;
    if (!validName(name)) return alert('В имени нельзя использовать \\ / : * ? " < > |');
    const dir = docsRoot() + (rel ? '/' + rel : '');
    try {
      await disk.mkdir(folder + '/' + DOCS);
      if (kind === 'dir') await disk.mkdir(dir + '/' + name);
      else {
        if (!name.toLowerCase().endsWith('.' + kind)) name += '.' + kind;
        const bytes = kind === 'docx' ? window.ProrabOffice.docx(name.replace(/\.docx$/i, '')) : window.ProrabOffice.xlsx([], 'Лист1');
        await disk.putBlob(dir + '/' + name, new Blob([bytes]), false);
        setStatus('Создан ' + name + ' — открываю в Яндекс Документах');
        window.open(D.webEdit(dir + '/' + name), '_blank', 'noopener');
      }
      reloadFolder(rel);
    } catch (e) { alert(e.message); }
  }

  function uploadInto(rel) {
    const input = h('input', { type: 'file', multiple: true });
    input.addEventListener('change', async () => {
      const dir = docsRoot() + (rel ? '/' + rel : '');
      try {
        await disk.mkdir(folder + '/' + DOCS);
        let n = 0;
        for (const f of input.files) {
          if (f.size > 200 * 1024 * 1024) { alert(f.name + ': больше 200 МБ — загрузите через сайт Диска'); continue; }
          setStatus('Загружаю ' + f.name + '…');
          await disk.putBlob(dir + '/' + f.name, f, false);
          n++;
        }
        setStatus('Загружено файлов: ' + n);
      } catch (e) { alert(e.message); }
      reloadFolder(rel);
    });
    input.click();
  }

  async function openItem(w, it, relDir) {
    const rel = relDir === DOCS ? '' : relDir;
    if (it.type === 'dir') {
      const path = (rel ? rel + '/' : '') + it.name;
      if (w) { w.path = path; w.key = 'explorer:' + path; loadFolder(w); render(); } else openWindow('explorer', { path });
      return;
    }
    const full = docsRoot() + (rel ? '/' + rel : '') + '/' + it.name;
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
    if (['docx', 'xlsx', 'pptx', 'doc', 'xls', 'csv', 'txt', 'pdf'].includes(ext(it.name))) {
      window.open(D.webEdit(full), '_blank', 'noopener');
    } else {
      try { window.open(await disk.downloadHref(full), '_blank', 'noopener'); } catch (e) { alert(e.message); }
    }
  }

  function itemMenu(x, y, w, it, relDir) {
    const rel = relDir === DOCS ? '' : relDir;
    const full = docsRoot() + (rel ? '/' + rel : '') + '/' + it.name;
    popup(x, y, [
      ['Открыть', () => openItem(w, it, relDir)],
      ext(it.name) === 'url' ? ['Изменить адрес', () => createShortcut(rel, it)] : null,
      it.type === 'file' && ext(it.name) !== 'url' ? ['Скачать', async () => { try { window.open(await disk.downloadHref(full), '_blank', 'noopener'); } catch (e) { alert(e.message); } }] : null,
      ['Переименовать', async () => {
        const isUrl = ext(it.name) === 'url';
        let n = (prompt('Новое имя', shownName(it)) || '').trim();
        if (isUrl && n) n += '.url';
        if (!n || n === it.name) return;
        if (!validName(n)) return alert('В имени нельзя использовать \\ / : * ? " < > |');
        try { await disk.move(full, full.slice(0, -it.name.length) + n); reloadFolder(rel); } catch (e) { alert(e.message); }
      }],
      ['Удалить в корзину', async () => {
        if (!confirm('Удалить «' + it.name + '»? Его можно будет восстановить из корзины Яндекс Диска.')) return;
        try { await disk.remove(full); reloadFolder(rel); } catch (e) { alert(e.message); }
      }],
    ]);
  }

  function createMenu(x, y, w) {
    const rel = w ? w.path : '';
    popup(x, y, [
      ['⟳ Обновить', () => { if (w) loadFolder(w); else { desk.items = null; render(); } }],
      ['-'], ['#Создать'],
      ['🔗 Ярлык на сайт', () => createIn(rel, 'url')], ['📁 Папку', () => createIn(rel, 'dir')], ['📝 Документ Word', () => createIn(rel, 'docx')], ['📊 Таблицу Excel', () => createIn(rel, 'xlsx')],
      ['-'], ['⬆ Загрузить файлы…', () => uploadInto(rel)], ['Открыть папку на Диске', () => window.open(D.webFolder(docsRoot() + (rel ? '/' + rel : '')), '_blank', 'noopener')],
      w ? null : ['-'], w ? null : ['+ Сделано', () => doneForm({ date: today })], w ? null : ['+ Задача', () => taskForm({ date: today })],
    ]);
  }

  function explorerView(w) {
    const crumbs = [DOCS].concat(w.path ? w.path.split('/') : []);
    const up = w.path ? w.path.split('/').slice(0, -1).join('/') : null;
    return h('div', { class: 'pp-explorer', oncontextmenu: (e) => { if (e.target.closest('.pp-file')) return; e.preventDefault(); createMenu(e.clientX, e.clientY, w); } },
      h('div', { class: 'pp-row pp-wrap pp-toolbar' },
        button('←', () => { if (up === null) return; w.path = up; w.key = 'explorer:' + up; loadFolder(w); render(); }, 'pp-icon'),
        h('span', { class: 'pp-crumbs' }, crumbs.join(' › ')),
        button('🔗 Ярлык', () => createIn(w.path, 'url')), button('📁 Папка', () => createIn(w.path, 'dir')), button('📝 Word', () => createIn(w.path, 'docx')), button('📊 Excel', () => createIn(w.path, 'xlsx')),
        button('⬆ Загрузить', () => uploadInto(w.path)), button('⟳', () => loadFolder(w), 'pp-icon')),
      w.error ? h('p', { class: 'pp-error' }, w.error) : null,
      w.items === null ? h('p', { class: 'pp-muted' }, 'Загружаю…') :
        w.items.length ? h('div', { class: 'pp-files' }, w.items.map((it) => h('button', {
          type: 'button', class: 'pp-file', title: it.name, ondblclick: () => openItem(w, it, w.path || DOCS),
          onclick: () => { if (small()) openItem(w, it, w.path || DOCS); },
          oncontextmenu: (e) => { e.preventDefault(); itemMenu(e.clientX, e.clientY, w, it, w.path || DOCS); },
        }, h('span', { class: 'pp-icon-img' }, fileIcon(it)), h('span', { class: 'pp-icon-name' }, shownName(it)),
          h('small', null, it.type === 'dir' ? 'папка' : ext(it.name) === 'url' ? 'ярлык' : (it.size ? Math.max(1, Math.round(it.size / 1024)) + ' КБ' : ''))))) :
          h('p', { class: 'pp-muted' }, 'Пусто. Создайте ярлык на сайт, папку, документ Word, таблицу Excel или загрузите файлы — они хранятся на вашем Яндекс Диске в папке «' + DOCS + '» объекта.'),
      h('p', { class: 'pp-muted' }, 'Двойной щелчок — открыть (Word и Excel — в Яндекс Документах, ярлык — сайт), правая кнопка — меню: создать, переименовать, скачать, удалить.'));
  }

  function periodBar() {
    const from = h('input', { type: 'date', value: period.from !== null ? dayToInput(period.from) : '' });
    const to = h('input', { type: 'date', value: period.to !== null ? dayToInput(period.to) : '' });
    const apply = () => { period = { from: from.value ? inputToDay(from.value) : null, to: to.value ? inputToDay(to.value) : null }; render(); };
    from.addEventListener('change', apply); to.addEventListener('change', apply);
    return h('div', { class: 'pp-row pp-wrap' }, field('С', from), field('По', to),
      button('Весь срок', () => { period = { from: null, to: null }; render(); }),
      button('30 дней', () => { period = { from: today - 30, to: today }; render(); }));
  }

  function journalView() {
    const days = project.days(period.from, period.to);
    return h('main', null,
      h('div', { class: 'pp-row pp-between pp-wrap' }, periodBar(),
        h('div', { class: 'pp-row' }, button('+ Задача', () => taskForm({ date: today }), ''), button('+ Сделано', () => doneForm({ date: today }), 'pp-primary'))),
      days.length ? days.map(dayCard) : h('p', { class: 'pp-muted pp-card' }, 'За этот период записей нет.'));
  }

  function dayCard(d) {
    const rows = [];
    const sub = (t) => rows.push(h('h3', null, t));
    if (d.tasks.length) {
      sub('План');
      d.tasks.forEach((t) => rows.push(h('button', { type: 'button', class: 'pp-line', onclick: () => taskForm({ taskId: t.id }) },
        h('span', null, (t.done ? '✓ ' : '○ ') + t.title), h('small', null, [t.planQty !== null && t.planQty !== undefined ? 'план ' + num(t.planQty) : '', t.who].filter(Boolean).join(' · ')))));
    }
    if (d.works.length) {
      sub('Сделано');
      d.works.forEach((w) => rows.push(h('button', { type: 'button', class: 'pp-line', onclick: () => doneForm({ entryId: w.id }) },
        h('span', null, w.title), h('small', null, [w.who, w.note].filter(Boolean).join(' · ')), h('strong', null, num(w.qty) + (w.unit ? ' ' + w.unit : '')))));
    }
    if (d.machines.length) {
      sub('Техника');
      d.machines.forEach((m) => rows.push(h('button', { type: 'button', class: 'pp-line', onclick: () => (m.entryId ? doneForm({ entryId: m.entryId }) : alert('Эта запись техники сделана в телефоне в старом виде — правьте её там.')) },
        h('span', null, m.title), h('small', null, m.minutes ? M.hm(m.minutes) : ''), h('strong', null, m.amountCents ? money(m.amountCents) : ''))));
    }
    if (d.people.length) {
      sub('Люди: ' + d.people.reduce((s, p) => s + (p.people || 0), 0));
      d.people.forEach((p) => rows.push(h('div', { class: 'pp-line' }, h('span', null, p.name), h('strong', null, p.people + ' чел.'))));
    }
    if (d.money.length) {
      sub('Финансы');
      d.money.forEach((f) => rows.push(h('button', { type: 'button', class: 'pp-line', onclick: () => financeForm({ id: f.id }) },
        h('span', null, f.title || typeName(f.type)), h('small', null, f.type === 'INCOME' ? 'поступление' : categoryName(f.category)), h('strong', { class: f.type === 'INCOME' ? 'pp-plus' : '' }, (f.type === 'INCOME' ? '+' : '−') + money(f.amountCents)))));
    }
    return h('section', { class: 'pp-card pp-day' },
      h('div', { class: 'pp-row pp-between' }, h('h2', null, dayTitle(d.day)),
        h('div', { class: 'pp-row' }, button('+ Задача', () => taskForm({ date: d.day })), button('+ Сделано', () => doneForm({ date: d.day })))),
      rows);
  }

  const categoryName = (c) => (M.CATEGORIES.find(([k]) => k === c) || [null, 'Иное'])[1];
  const typeName = (t) => (M.TYPES.find(([k]) => k === t) || [null, 'Расход'])[1];

  function financeView() {
    const list = project.rows('finance').filter((f) => (period.from === null || f.date >= period.from) && (period.to === null || f.date <= period.to)).sort((a, b) => b.date - a.date || (b.createdAt || 0) - (a.createdAt || 0));
    const exp = list.filter((f) => f.type !== 'INCOME').reduce((s, f) => s + (f.amountCents || 0), 0);
    const inc = list.filter((f) => f.type === 'INCOME').reduce((s, f) => s + (f.amountCents || 0), 0);
    return h('main', null,
      h('div', { class: 'pp-row pp-between pp-wrap' }, periodBar(), button('+ Запись', () => financeForm({}), 'pp-primary')),
      h('section', { class: 'pp-card pp-row pp-wrap pp-totals' }, h('div', null, h('small', null, 'Расход'), h('strong', null, money(exp))), h('div', null, h('small', null, 'Поступления'), h('strong', { class: 'pp-plus' }, money(inc))), h('div', null, h('small', null, 'Разница'), h('strong', null, money(inc - exp)))),
      h('section', { class: 'pp-card' }, list.length ? list.map((f) => h('button', { type: 'button', class: 'pp-line', onclick: () => financeForm({ id: f.id }) },
        h('span', null, dayTitle(f.date) + ' — ' + (f.title || typeName(f.type))), h('small', null, (f.type === 'INCOME' ? 'поступление' : categoryName(f.category)) + (M.isAutoExpense(f.id) ? ' · из «Сделано»' : '')),
        h('strong', { class: f.type === 'INCOME' ? 'pp-plus' : '' }, (f.type === 'INCOME' ? '+' : '−') + money(f.amountCents)))) : h('p', { class: 'pp-muted' }, 'Записей нет.')));
  }

  function machinesView() {
    return h('main', { class: 'pp-columns' },
      h('section', { class: 'pp-card' }, h('div', { class: 'pp-row pp-between' }, h('h2', null, 'Техника'), button('+ Техника', () => equipmentForm({}))),
        project.equipment(true).map((e) => h('button', { type: 'button', class: 'pp-line', onclick: () => equipmentForm(e) }, h('span', null, M.equipmentTitle(e) + (Number(e.archived) ? ' — в архиве' : '')), h('small', null, [e.supplier, e.phone].filter(Boolean).join(' · ')))),
        h('p', { class: 'pp-muted' }, 'Работа и оплата техники отмечаются в «Сделано», нужная в будущем — в «Задаче». Условия аренды — в телефоне.')),
      h('section', { class: 'pp-card' }, h('div', { class: 'pp-row pp-between' }, h('h2', null, 'Бригады'), button('+ Бригада', () => crewForm({}))),
        project.crews(true).map((c) => h('button', { type: 'button', class: 'pp-line', onclick: () => crewForm(c) }, h('span', null, (c.name || 'Бригада') + (Number(c.archived) ? ' — в архиве' : '')))),
        h('p', { class: 'pp-muted' }, 'Сколько людей было — отмечается в «Сделано».')));
  }

  // ───────── окна правки ─────────
  function modal(title, body, onSave, extra) {
    const err = h('p', { class: 'pp-error' });
    const close = () => wrap.remove();
    const wrap = h('div', { class: 'pp-modal', onclick: (e) => { if (e.target === wrap) close(); } },
      h('form', { class: 'pp-dialog', onsubmit: (e) => { e.preventDefault(); try { if (onSave() !== false) { close(); changed(); } } catch (x) { err.textContent = x.message; } } },
        h('div', { class: 'pp-row pp-between' }, h('h2', null, title), button('✕', close, 'pp-icon')),
        body, err,
        h('div', { class: 'pp-row pp-between' }, extra ? button(extra.text, () => { if (extra.run() !== false) { close(); changed(); } }, 'pp-danger') : h('span'), h('div', { class: 'pp-row' }, button('Отмена', close), h('button', { type: 'submit', class: 'pp-btn pp-primary' }, 'Сохранить')))));
    document.body.append(wrap);
    const first = wrap.querySelector('input, select, textarea');
    if (first) first.focus();
  }
  const bad = (msg) => { throw new Error(msg); };

  function doneForm({ entryId, date }) {
    const e = entryId ? project.get('volumes', entryId) : null;
    const d0 = e ? e.date : date;
    const dateIn = h('input', { type: 'date', value: dayToInput(d0), required: true });
    const item = select(project.itemOptions(), e && e.itemId, true, 'Без работы — только техника и люди');
    const qty = h('input', { inputmode: 'decimal', value: e ? num(e.quantity).replace(/\s/g, '') : '' });
    const who = select(project.rows('contractors').map((c) => ({ id: c.id, name: c.name })), e && e.contractorId, true, 'Не указан');
    const note = h('textarea', { rows: 2 }, e ? e.note : '');
    // Техника
    const equip = project.equipment().map((x) => ({ id: x.id, name: M.equipmentTitle(x) }));
    const mBox = h('div', { class: 'pp-sub' });
    const rows = [];
    const addMachine = (m) => {
      const eq = select(equip.concat(m.equipmentId && !equip.some((x) => x.id === m.equipmentId) ? [{ id: m.equipmentId, name: project.orderTitle(null) }] : []), m.equipmentId, false);
      const amount = h('input', { inputmode: 'decimal', placeholder: '15000', value: m.amountCents ? String(m.amountCents / 100).replace('.', ',') : '' });
      const hours = h('input', { placeholder: '8 или 7:30', value: hoursText(m.minutes) });
      const row = { workId: m.workId, eq, amount, hours };
      const el = h('div', { class: 'pp-row pp-wrap pp-machine' }, field('Техника', eq), field('Заплатили, ₽', amount), field('Часы', hours, 'необязательно'),
        button('Убрать', () => { el.remove(); rows.splice(rows.indexOf(row), 1); }, 'pp-icon'));
      rows.push(row);
      mBox.append(el);
    };
    if (e) project.machinesOfEntry(e.id).forEach(addMachine);
    // Люди
    const crews = project.crews();
    const people0 = project.peopleOn(d0);
    const pInputs = crews.map((c) => ({ c, input: h('input', { inputmode: 'numeric', value: people0[c.id] !== undefined ? String(people0[c.id]) : '' }) }));
    let peopleTouched = false;
    pInputs.forEach((p) => p.input.addEventListener('input', () => { peopleTouched = true; }));
    dateIn.addEventListener('change', () => {
      if (peopleTouched) return;
      const pp = project.peopleOn(inputToDay(dateIn.value));
      pInputs.forEach((p) => { p.input.value = pp[p.c.id] !== undefined ? String(pp[p.c.id]) : ''; });
    });
    const body = h('div', null,
      field('Дата', dateIn), field('Работа (позиция ведомости)', item), h('div', { class: 'pp-row pp-wrap' }, field('Объём', qty), field('Исполнитель', who)), field('Примечание', note),
      h('h3', null, 'Техника'), h('p', { class: 'pp-muted' }, 'Сколько заплатили — сразу расход в финансах («Аренда техники»).'), mBox,
      equip.length ? button('+ Техника', () => addMachine({ equipmentId: equip.length === 1 ? equip[0].id : null })) : h('p', { class: 'pp-muted' }, 'Техника не заведена — добавьте во вкладке «Техника и бригады».'),
      h('h3', null, 'Люди на объекте'),
      crews.length ? h('div', { class: 'pp-people' }, pInputs.map((p) => field(p.c.name || 'Бригада', p.input))) : h('p', { class: 'pp-muted' }, 'Бригады не заведены — добавьте во вкладке «Техника и бригады».'),
      h('p', { class: 'pp-muted' }, 'Численность — на весь день, одна запись на бригаду.'));
    modal(e ? 'Запись журнала' : 'Что сделано', body, () => {
      const day = inputToDay(dateIn.value);
      if (day === null) bad('Укажите дату');
      const q = parseQty(qty.value);
      if (item.value && (q === null || Number.isNaN(q) || q <= 0)) bad('Объём — число больше нуля');
      const machines = rows.map((r) => {
        const c = parseMoney(r.amount.value), min = parseHours(r.hours.value);
        if (!r.eq.value) bad('Выберите технику');
        if (c === null || Number.isNaN(c) || c <= 0) bad('Укажите, сколько заплатили за технику');
        if (Number.isNaN(min)) bad('Часы — как 8 или 7:30');
        return { workId: r.workId, equipmentId: r.eq.value, amountCents: c, minutes: min };
      });
      let people = null;
      if (peopleTouched) {
        people = {};
        for (const p of pInputs) {
          const t = p.input.value.trim();
          if (t && !/^\d{1,4}$/.test(t)) bad('Число людей — целое от 0 до 1000');
          people[p.c.id] = t ? Number(t) : null;
        }
      }
      if (!item.value && !machines.length && !people) bad('Выберите работу или отметьте технику / людей');
      if (!item.value && e) bad('У записи должна остаться работа');
      project.saveDone({ entryId: e ? e.id : null, date: day, itemId: item.value || null, qty: q, contractorId: who.value || null, note: note.value.trim(), machines, people });
    }, e ? { text: 'Удалить запись', run: () => { if (!confirm('Удалить запись? Техника этой записи и её расход тоже удалятся.')) return false; project.deleteDone(e.id); } } : null);
  }

  function taskForm({ taskId, date }) {
    const t = taskId ? project.get('tasks', taskId) : null;
    const tm = t ? project.taskMachines(t.id) : { equipment: [], remind: true };
    const dateIn = h('input', { type: 'date', value: dayToInput(t ? t.date : date), required: true });
    const item = select(project.itemOptions(), t && t.itemId, true, 'Без позиции — свой текст');
    const title = h('input', { value: t ? t.title : '', placeholder: 'Что сделать' });
    const qty = h('input', { inputmode: 'decimal', value: t && t.planQty !== null && t.planQty !== undefined ? String(t.planQty).replace('.', ',') : '' });
    const who = select(project.rows('contractors').map((c) => ({ id: c.id, name: c.name })), t && t.contractorId, true, 'Не указан');
    const note = h('textarea', { rows: 2 }, t ? t.note : '');
    const done = h('input', { type: 'checkbox' }); done.checked = !!(t && Number(t.done));
    const checks = project.equipment().map((e) => { const c = h('input', { type: 'checkbox' }); c.checked = tm.equipment.includes(e.id); return { e, c }; });
    const remind = h('input', { type: 'checkbox' }); remind.checked = tm.remind || !t;
    modal(t ? 'Задача' : 'Новая задача', h('div', null,
      field('Дата', dateIn), field('Позиция ведомости', item), field('Что сделать', title), h('div', { class: 'pp-row pp-wrap' }, field('Объём по плану', qty), field('Исполнитель', who)), field('Примечание', note),
      h('label', { class: 'pp-check' }, done, ' Выполнено'),
      h('h3', null, 'Нужна техника'), h('p', { class: 'pp-muted' }, 'План: в финансах ничего не появится. На телефоне будет напоминание.'),
      checks.length ? h('div', { class: 'pp-checks' }, checks.map(({ e, c }) => h('label', { class: 'pp-check' }, c, ' ' + M.equipmentTitle(e)))) : h('p', { class: 'pp-muted' }, 'Техника не заведена.'),
      h('label', { class: 'pp-check' }, remind, ' Напомнить накануне в 18:00')), () => {
      const day = inputToDay(dateIn.value);
      if (day === null) bad('Укажите дату');
      const q = parseQty(qty.value);
      if (Number.isNaN(q)) bad('Объём — число');
      const machines = checks.filter((x) => x.c.checked).map((x) => x.e.id);
      if (!item.value && !title.value.trim() && !machines.length) bad('Выберите позицию, напишите задачу или отметьте технику');
      project.saveTask({ taskId: t ? t.id : null, date: day, itemId: item.value || null, title: title.value, planQty: q, contractorId: who.value || null, note: note.value.trim(), done: done.checked, machines, remind: remind.checked });
    }, t ? { text: 'Удалить задачу', run: () => { if (!confirm('Удалить задачу?')) return false; project.deleteTask(t.id); } } : null);
  }

  function financeForm({ id }) {
    const f = id ? project.get('finance', id) : null;
    const auto = f && M.isAutoExpense(f.id);
    const note = h('textarea', { rows: 2 }, f ? f.note : '');
    if (auto) {
      return modal('Расход по технике', h('div', null,
        h('p', null, h('strong', null, money(f.amountCents)), ' · ', dayTitle(f.date)), h('p', null, f.title),
        h('p', { class: 'pp-muted' }, 'Записан сам по технике в «Сделано». Сумма и дата меняются там.'), field('Заметка', note)),
      () => { project.saveFinance({ id: f.id, note: note.value.trim() }); });
    }
    const type = select(M.TYPES.map(([k, t]) => ({ id: k, name: t })), f ? f.type : 'EXPENSE', false);
    const dateIn = h('input', { type: 'date', value: dayToInput(f ? f.date : today), required: true });
    const title = h('input', { value: f ? f.title : '' });
    const amount = h('input', { inputmode: 'decimal', value: f ? String(f.amountCents / 100).replace('.', ',') : '' });
    const cat = select(M.CATEGORIES.map(([k, t]) => ({ id: k, name: t })), f ? f.category || 'OTHER' : 'OTHER', false);
    modal(f ? 'Запись финансов' : 'Новая запись', h('div', null, field('Вид', type), h('div', { class: 'pp-row pp-wrap' }, field('Сумма, ₽', amount), field('Дата', dateIn)), field('Что / кому / от кого', title), field('Статья (для расходов)', cat), field('Заметка', note)), () => {
      const c = parseMoney(amount.value);
      if (c === null || Number.isNaN(c) || c <= 0) bad('Сумма — число больше нуля, например 1500 или 1500,50');
      const day = inputToDay(dateIn.value);
      if (day === null) bad('Укажите дату');
      project.saveFinance({ id: f ? f.id : null, type: type.value, date: day, title: title.value.trim(), amountCents: c, category: cat.value, note: note.value.trim(), contractorId: f ? f.contractorId : null });
    }, f ? { text: 'Удалить', run: () => { if (!confirm('Удалить запись из финансов?')) return false; project.deleteFinance(f.id); } } : null);
  }

  function equipmentForm(e) {
    const name = h('input', { value: e.name || '', placeholder: 'JCB 3CX' });
    const kind = h('input', { value: e.kind || '', placeholder: 'Экскаватор' });
    const plate = h('input', { value: e.plate || '' });
    const supplier = h('input', { value: e.supplier || '' });
    const phone = h('input', { value: e.phone || '', type: 'tel' });
    const archived = h('input', { type: 'checkbox' }); archived.checked = !!Number(e.archived);
    modal(e.id ? 'Техника' : 'Новая техника', h('div', null, h('div', { class: 'pp-row pp-wrap' }, field('Тип', kind), field('Название / модель', name)), h('div', { class: 'pp-row pp-wrap' }, field('Номер', plate, 'необязательно'), field('Поставщик', supplier), field('Телефон', phone)),
      e.id ? h('label', { class: 'pp-check' }, archived, ' В архиве (не показывать при выборе)') : null), () => {
      if (!name.value.trim() && !kind.value.trim()) bad('Укажите тип или название');
      project.saveEquipment({ id: e.id, name: name.value.trim(), kind: kind.value.trim(), plate: plate.value.trim(), supplier: supplier.value.trim(), phone: phone.value.trim(), archived: archived.checked });
    });
  }

  function crewForm(c) {
    const name = h('input', { value: c.name || '', placeholder: 'Бетонщики' });
    const archived = h('input', { type: 'checkbox' }); archived.checked = !!Number(c.archived);
    modal(c.id ? 'Бригада' : 'Новая бригада', h('div', null, field('Название', name), c.id ? h('label', { class: 'pp-check' }, archived, ' В архиве') : null), () => {
      if (!name.value.trim()) bad('Укажите название');
      project.saveCrew({ id: c.id, name: name.value.trim(), archived: archived.checked });
    });
  }

  // ───────── запуск ─────────
  async function start() {
    takeTokenFromUrl();
    const token = store.get('token');
    if (!token) return loginScreen();
    disk = new D.Disk(token);
    try { await disk.user(); } catch (e) { return fail(e); }
    const last = JSON.parse(store.get('recent') || '[]')[0];
    if (last) openProject(last.path); else folderScreen('/');
  }

  window.addEventListener('beforeunload', (e) => { if (project && (project.dirty || saving)) { save(); e.preventDefault(); e.returnValue = ''; } });
  start();
})();
