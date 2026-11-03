/* One document list for the phone's executive folders and the former web-only folder. */
(function (root) {
  'use strict';
  const EXEC = 'Исполнительная документация';
  const SHARED = EXEC + '/Документы';
  function visible(name) { return !!name && !name.startsWith('.') && !name.startsWith('~$') && !/\.(json|part)$/i.test(name); }
  async function scan(disk, project) {
    const files = [], errors = [], queue = [EXEC, 'Документы'];
    for (let i = 0; i < queue.length; i++) {
      if (queue.length > 1000 || files.length > 10000) { errors.push('Слишком много файлов; откройте папку на Диске.'); break; }
      const rel = queue[i];
      try {
        for (const item of (await disk.list(project + '/' + rel)) || []) {
          if (!visible(item.name) || /[\\/\x00-\x1f]/.test(item.name) || item.name === '..') continue;
          if (item.type === 'dir') queue.push(rel + '/' + item.name);
          else files.push({ name: item.name, folder: rel, modified: item.modified || '', size: item.size || 0, path: project + '/' + rel + '/' + item.name });
        }
      } catch (e) { errors.push(rel + ': ' + e.message); }
    }
    files.sort((a, b) => b.modified.localeCompare(a.modified) || a.name.localeCompare(b.name, 'ru'));
    return { files, errors };
  }
  const api = { EXEC, SHARED, visible, scan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ProrabDocuments = api;
})(typeof window !== 'undefined' ? window : globalThis);
