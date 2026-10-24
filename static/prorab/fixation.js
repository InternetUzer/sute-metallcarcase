/*
 * «Прораб+» — фиксация данных объекта (защищённый журнал изменений).
 * Каждое устройство ведёт свою цепочку файлов фиксации: «<объект>/.prorab-fixation/<устройство>/000001.json», …
 * В файле — записи, изменившиеся с прошлой фиксации (полностью, с отпечатком SHA-256), отпечаток всего состояния
 * объекта и отпечаток предыдущего файла. Правка задним числом, удаление или подмена файла рвёт цепочку — это видно
 * при проверке. Время подтверждается квитанцией сервера сайта (и меткой времени независимой службы, если настроена)
 * — файл «000001.anchor.json» рядом.
 * Без DOM — проверяется тестами в Node (crypto.subtle).
 */
(function (root) {
  'use strict';
  const subtle = (root.crypto || globalThis.crypto).subtle;
  const enc = new TextEncoder();
  const FORMAT = 'prorab-seal';
  const DIR = '.prorab-fixation';

  /** Каноническая запись JSON: ключи по алфавиту — одинаковый текст на любом устройстве. */
  function canonical(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  async function sha256(text) {
    const buf = new Uint8Array(await subtle.digest('SHA-256', typeof text === 'string' ? enc.encode(text) : text));
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Отпечатки всех записей объекта: Map('таблица/id' → { t, id, h, row }). */
  async function leaves(state) {
    const out = new Map();
    for (const t of Object.keys(state).sort()) {
      for (const id of Object.keys(state[t] || {}).sort()) {
        const row = state[t][id].values;
        out.set(t + '/' + id, { t, id, h: await sha256(canonical(row)), row });
      }
    }
    return out;
  }
  const rootOf = (map) => sha256(Array.from(map.keys()).sort().map((k) => k + ':' + map.get(k).h).join('\n'));

  /** Отпечаток файла фиксации (всё, кроме самого поля hash). */
  function sealHash(seal) { const copy = Object.assign({}, seal); delete copy.hash; return sha256(canonical(copy)); }

  /**
   * Новая фиксация. prev — предыдущий файл этого устройства (или null), prevLeaves — состояние на нём (Map t/id → h),
   * state — текущее состояние объекта, info — { project, device, now, files: [{ name, sha256 }] }.
   * Возвращает { seal, leaves } или null, если с прошлой фиксации ничего не изменилось.
   */
  async function makeSeal(prev, prevLeaves, state, info) {
    const cur = await leaves(state);
    const changes = [];
    for (const [k, v] of cur) if (!prevLeaves || !prevLeaves.has(k) || prevLeaves.get(k) !== v.h) changes.push({ t: v.t, id: v.id, h: v.h, row: v.row });
    const files = (info.files || []).filter((f) => f && f.name && /^[0-9a-f]{64}$/.test(f.sha256));
    if (prev && !changes.length && !files.length) return null;
    const seal = {
      format: FORMAT, version: 1, project: info.project, device: info.device, seq: prev ? prev.seq + 1 : 1, prev: prev ? prev.hash : null,
      createdAt: info.now, count: cur.size, root: await rootOf(cur), changes, files,
    };
    seal.hash = await sealHash(seal);
    const map = new Map(Array.from(cur, ([k, v]) => [k, v.h]));
    return { seal, leaves: map };
  }

  /** Состояние после цепочки фиксаций одного устройства (Map t/id → h) — для следующей фиксации. */
  function replay(seals) {
    const map = new Map();
    for (const s of seals) for (const c of s.changes) map.set(c.t + '/' + c.id, c.h);
    return map;
  }

  /**
   * Проверка цепочки одного устройства. anchors — Map(seq → квитанция). Возвращает
   * { device, seals, first, last, anchored, problems: [строка] }.
   */
  async function verifyChain(seals, anchors) {
    const problems = [];
    const list = seals.slice().sort((a, b) => a.seq - b.seq);
    const map = new Map();
    let prev = null, anchored = 0;
    for (const s of list) {
      const where = 'фиксация № ' + s.seq + (s.createdAt ? ' от ' + new Date(s.createdAt).toLocaleString('ru-RU') : '');
      if (s.format !== FORMAT) { problems.push(where + ': неизвестный формат'); continue; }
      if (s.seq !== (prev ? prev.seq + 1 : 1)) problems.push('Пропущены фиксации перед № ' + s.seq + ' — файлы удалены или не загружены');
      if (s.hash !== await sealHash(s)) problems.push(where + ': содержимое изменено после фиксации (отпечаток не совпадает)');
      if (prev && s.prev !== prev.hash) problems.push(where + ': не связана с предыдущей (цепочка разорвана)');
      if (!prev && s.prev !== null && s.seq === 1) problems.push(where + ': первая фиксация ссылается на несуществующую');
      for (const c of s.changes) {
        if (c.h !== await sha256(canonical(c.row))) problems.push(where + ': запись ' + c.t + '/' + c.id + ' изменена (отпечаток не совпадает)');
        map.set(c.t + '/' + c.id, c.h);
      }
      const r = await sha256(Array.from(map.keys()).sort().map((k) => k + ':' + map.get(k)).join('\n'));
      if (r !== s.root || map.size !== s.count) problems.push(where + ': общий отпечаток состояния не сходится');
      const a = anchors && anchors.get(s.seq);
      if (a) {
        if (a.hash !== s.hash) problems.push(where + ': квитанция сервера относится к другому отпечатку');
        else if (a.time && Date.parse(a.time) + 10 * 60 * 1000 < s.createdAt) problems.push(where + ': время квитанции раньше времени фиксации');
        else anchored++;
      }
      prev = s;
    }
    return { device: list[0] ? list[0].device : '', seals: list.length, first: list[0] ? list[0].createdAt : null, last: prev ? prev.createdAt : null, anchored, problems };
  }

  /** История записи по всем цепочкам: [{ at, device, seq, row, h, anchored }] — что было записано и когда зафиксировано. */
  function history(chains, table, id) {
    const out = [];
    for (const { seals, anchors } of chains) {
      for (const s of seals) for (const c of s.changes) if (c.t === table && c.id === id) {
        const a = anchors && anchors.get(s.seq);
        out.push({ at: s.createdAt, device: s.device, seq: s.seq, row: c.row, h: c.h, anchor: a && a.hash === s.hash ? a : null });
      }
    }
    return out.sort((x, y) => x.at - y.at);
  }

  const name = (seq) => String(seq).padStart(6, '0') + '.json';
  const anchorName = (seq) => String(seq).padStart(6, '0') + '.anchor.json';

  const api = { DIR, canonical, sha256, leaves, makeSeal, replay, verifyChain, history, sealHash, name, anchorName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabFixation = api;
})(typeof window !== 'undefined' ? window : globalThis);
