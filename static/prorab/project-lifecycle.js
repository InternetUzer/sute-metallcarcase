/* Shared soft deletion, independent of the phone's deliberately local projects.deleted field.
 * Immutable events survive old clients' data/*.json writes. See docs/PRORAB-SYNC.md. */
(function (root) {
  'use strict';
  const DIR = '.prorab-lifecycle';
  const validId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
  function validate(e, projectId) {
    if (!e || e.format !== 1 || !validId(e.id) || !validId(e.projectId) || (projectId && e.projectId !== projectId) ||
        !Number.isSafeInteger(e.revision) || e.revision < 1 || !['delete', 'restore'].includes(e.action) ||
        !Number.isSafeInteger(e.at) || e.at < 0 || typeof e.device !== 'string') throw new Error('Повреждена история удаления объекта. Запись остановлена; откройте «Логи».');
    return e;
  }
  function latest(events) {
    if (!events.length) return null;
    const projectId = events[0].projectId;
    return events.map((e) => validate(e, projectId)).sort((a, b) => a.revision - b.revision || Number(a.action === 'delete') - Number(b.action === 'delete') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).at(-1);
  }
  /** cache (Map) — уже прочитанные события: они неизменяемые, повторно по сети не читаются (ключ — путь и md5). */
  async function read(disk, path, projectId, cache) {
    const items = (await disk.list(path + '/' + DIR)) || [];
    const files = items.filter((i) => i.type === 'file' && i.name.endsWith('.json'));
    if (files.length > 10000) throw new Error('История удаления слишком велика. Нужна проверка.');
    const events = [];
    for (let i = 0; i < files.length; i += 6) {
      events.push(...await Promise.all(files.slice(i, i + 6).map(async (f) => {
        if (!validId(f.name.slice(0, -5))) throw new Error('Непонятное имя в истории удаления объекта.');
        const key = path + '/' + DIR + '/' + f.name + ':' + (f.md5 || '');
        let e;
        try {
          let text = f.md5 && cache ? cache.get(key) : undefined;
          if (text === undefined) { text = await disk.getText(path + '/' + DIR + '/' + f.name); if (f.md5 && cache && typeof text === 'string') cache.set(key, text); }
          e = JSON.parse(text);
        } catch (_) { throw new Error('Не удалось прочитать историю удаления объекта.'); }
        validate(e, projectId);
        if (e.id + '.json' !== f.name) throw new Error('Имя события удаления не совпадает с содержимым.');
        return e;
      })));
    }
    return latest(events);
  }
  async function assertActive(disk, path, projectId) {
    // A missing marker directory also occurs when the whole project is in Trash.
    // Fail before any mkdir/upload instead of treating that as an active project.
    if (await disk.list(path) === null) {
      const error = new Error('Папка объекта отсутствует на Диске: она удалена или перемещена. Запись остановлена; проверьте Корзину Диска и восстановите объект.');
      error.code = 'PROJECT_DELETED'; throw error;
    }
    const e = await read(disk, path, projectId);
    if (e && e.action === 'delete') {
      const error = new Error('Объект удалён из активных. Он находится в «Удалённых объектах»; сначала восстановите его.');
      error.code = 'PROJECT_DELETED'; throw error;
    }
    return e;
  }
  async function change(disk, path, projectId, action, device, id) {
    const prev = await read(disk, path, projectId);
    if (prev && prev.action === action) return prev;
    const event = validate({ format: 1, id, projectId, revision: (prev ? prev.revision : 0) + 1, action, device, at: Date.now() }, projectId);
    const dir = path + '/' + DIR, text = JSON.stringify(event);
    await disk.mkdir(dir);
    await disk.putBlob(dir + '/' + id + '.json', new Blob([text], { type: 'application/json' }), false);
    if (await disk.getText(dir + '/' + id + '.json') !== text) throw new Error('Диск не подтвердил изменение состояния объекта. Обновите список.');
    const current = await read(disk, path, projectId);
    if (!current || current.action !== action) throw new Error('Состояние объекта одновременно изменено на другом устройстве. Обновите список.');
    return current;
  }
  const api = { DIR, validate, latest, read, assertActive, change };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ProrabLifecycle = api;
})(typeof window !== 'undefined' ? window : globalThis);
