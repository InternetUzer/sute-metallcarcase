/*
 * «Прораб+» в браузере — ядро объединения данных. Тот же формат и те же правила, что в приложении
 * для телефона (cloud/SyncCore.kt, cloud/CloudSync.kt):
 *
 *  - в папке объекта на Яндекс Диске каждое устройство пишет только свой файл data/<устройство>.json —
 *    все записи объекта и версию каждого поля («время:устройство»);
 *  - при чтении файлы объединяются по полям: побеждает значение с большей версией;
 *  - удаление — пометка deleted = 1, она тоже расходится по всем.
 *
 * Веб-версия — ещё одно устройство: читает все файлы, правит записи (новая версия у изменённых
 * полей) и пишет свой файл data/web-<id>.json. Без DOM — проверяется тестами в Node.
 */
(function (root) {
  'use strict';

  /** Версия поля: { h: число (гибридное время), d: устройство }. */
  function parseVer(s) {
    if (typeof s !== 'string') return null;
    const i = s.indexOf(':');
    if (i <= 0) return null;
    const h = Number(s.slice(0, i));
    if (!Number.isFinite(h)) return null;
    return { h, d: s.slice(i + 1) };
  }
  const encodeVer = (v) => v.h + ':' + v.d;
  /** Как Ver.compareTo в Kotlin: сначала время, затем устройство (строкой). */
  function cmpVer(a, b) {
    if (a.h !== b.h) return a.h < b.h ? -1 : 1;
    return a.d < b.d ? -1 : a.d > b.d ? 1 : 0;
  }
  const EMPTY = { h: 0, d: '' };

  const META = new Set(['id', 'updatedAt']);
  /** Поля, которые объединяются: не id и не время; у самого объекта признак «удалён» не расходится. */
  const isField = (table, col) => !META.has(col) && !(table === 'projects' && col === 'deleted');

  function same(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return (a === null || a === undefined) && (b === null || b === undefined);
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      const n = (x) => (typeof x === 'boolean' ? (x ? 1 : 0) : Number(x));
      return n(a) === n(b);
    }
    return String(a) === String(b);
  }

  function isEmptyValue(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') return v === '';
    if (typeof v === 'number') return v === 0;
    if (typeof v === 'boolean') return !v;
    return false;
  }

  /** Гибридные часы: не меньше реального времени и всегда больше всех увиденных версий. */
  class Clock {
    constructor(last) { this.last = last || 0; }
    tick(now) { const t = Math.max(now === undefined ? Date.now() : now, this.last + 1); this.last = t; return t; }
    observe(v) { if (v && v.h > this.last) this.last = v.h; }
  }

  /**
   * Объединить файлы устройств. files: [{ device, tables: { таблица: [строки] } }].
   * Берутся только строки этого объекта. Результат: { таблица: { id: { values, vers } } }.
   */
  function mergeFiles(files, projectId, clock) {
    const state = {};
    for (const f of files) {
      const device = f.device || 'remote';
      for (const table of Object.keys(f.tables || {})) {
        const rows = f.tables[table];
        if (!Array.isArray(rows)) continue;
        const t = state[table] || (state[table] = {});
        for (const o of rows) {
          if (!o || typeof o !== 'object') continue;
          const id = o.id === undefined || o.id === null ? '' : String(o.id);
          if (!id) continue;
          if (table === 'projects' ? id !== projectId : o.projectId !== projectId) continue;
          const values = {};
          for (const k of Object.keys(o)) if (k !== '_v') values[k] = o[k];
          const at = Number(values.updatedAt) || 0;
          const raw = o._v || {};
          const vers = {};
          for (const col of Object.keys(values)) {
            if (!isField(table, col)) continue;
            // У файлов прежних версий приложения версий нет — время изменения записи
            vers[col] = parseVer(raw[col]) || { h: at, d: '~' + device };
            if (clock) clock.observe(vers[col]);
          }
          const cur = t[id];
          if (!cur) { t[id] = { values, vers }; continue; }
          for (const col of Object.keys(vers)) {
            const lv = cur.vers[col];
            if (!lv || cmpVer(vers[col], lv) > 0) {
              cur.vers[col] = vers[col];
              cur.values[col] = values[col];
            }
          }
          cur.values.updatedAt = Math.max(Number(cur.values.updatedAt) || 0, at);
        }
      }
    }
    return state;
  }

  function today(now) {
    const d = now ? new Date(now) : new Date();
    return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  }

  function newId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /** Новая строка таблицы со значениями по умолчанию, как в приложении. */
  function blankRow(schema, table, now) {
    const spec = schema[table];
    if (!spec) throw new Error('Неизвестная таблица ' + table);
    const row = {};
    for (const [col, c] of Object.entries(spec.cols)) {
      const d = c.def;
      if (d && typeof d === 'object') row[col] = d.fn === 'id' ? newId() : d.fn === 'now' ? now : today(now);
      else row[col] = d === undefined ? null : d;
    }
    return row;
  }

  /**
   * Правка записи: изменённые поля получают новую версию этого устройства. Новая запись — все
   * заполненные поля с новой версией, пустые — с самой слабой (как у телефона, чтобы не затереть
   * ту же запись, созданную на другом устройстве). Возвращает строку или null, если ничего не изменилось.
   */
  function edit(state, schema, table, id, changes, me, clock, now) {
    now = now === undefined ? Date.now() : now;
    const t = state[table] || (state[table] = {});
    let row = t[id];
    if (!row) {
      const values = Object.assign(blankRow(schema, table, now), { id }, changes, { updatedAt: now });
      const vers = {};
      let fresh = null;
      for (const col of Object.keys(values)) {
        if (!isField(table, col)) continue;
        vers[col] = isEmptyValue(values[col]) ? EMPTY : (fresh || (fresh = { h: clock.tick(now), d: me }));
      }
      row = t[id] = { values, vers };
      return row;
    }
    let fresh = null;
    let changed = false;
    for (const [col, v] of Object.entries(changes)) {
      if (col === 'id' || !isField(table, col)) continue;
      if (same(row.values[col], v) && row.vers[col]) continue;
      row.values[col] = v;
      row.vers[col] = fresh || (fresh = { h: clock.tick(now), d: me });
      changed = true;
    }
    if (!changed) return null;
    row.values.updatedAt = now;
    return row;
  }

  /** Свой файл data/<me>.json — в формате телефона (format 1, версии полей). */
  function toFile(state, projectId, projectName, me, now) {
    const tables = {};
    for (const table of Object.keys(state).sort()) {
      const rows = state[table];
      tables[table] = Object.keys(rows).sort().map((id) => {
        const r = rows[id];
        const o = {};
        for (const k of Object.keys(r.values).sort()) o[k] = r.values[k] === undefined ? null : r.values[k];
        if (table === 'projects' && id === projectId) o.deleted = 0;
        const v = {};
        for (const k of Object.keys(r.vers).sort()) v[k] = encodeVer(r.vers[k]);
        o._v = v;
        return o;
      });
    }
    return {
      format: 1, app: 'technadzor', fieldVersions: 1,
      projectId, projectName: projectName || '', device: me, deviceName: 'Веб-версия',
      savedAt: now === undefined ? Date.now() : now, tables,
    };
  }

  /** Проверка файла устройства — как у телефона. */
  function validFile(j) {
    return j && j.format === 1 && j.app === 'technadzor' && j.tables && typeof j.tables === 'object';
  }

  const api = { parseVer, encodeVer, cmpVer, isField, same, isEmptyValue, Clock, mergeFiles, blankRow, edit, toFile, validFile, today, newId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
