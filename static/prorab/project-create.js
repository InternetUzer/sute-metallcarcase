/* Recoverable creation of a phone-compatible cloud project. No existing data is overwritten. */
(function (root) {
  'use strict';
  const S = typeof module !== 'undefined' && module.exports ? require('./sync.js') : root.ProrabSync;
  const M = typeof module !== 'undefined' && module.exports ? require('./model.js') : root.ProrabModel;
  const L = typeof module !== 'undefined' && module.exports ? require('./project-lifecycle.js') : root.ProrabLifecycle;
  const KEY = 'project-creation.v1';
  const validName = (n) => typeof n === 'string' && n === n.trim() && n.length > 0 && n.length <= 120 && !n.startsWith('.') && !/[\\/:*?"<>|\x00-\x1f]/.test(n);
  function validate(task) {
    if (!task || task.format !== 1 || !validName(task.name) || typeof task.root !== 'string' || !task.root.startsWith('/') ||
        task.root.includes('//') || task.root.split('/').some((x) => x === '.' || x === '..') ||
        typeof task.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(task.projectId) || typeof task.device !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(task.device) ||
        typeof task.text !== 'string') throw new Error('Не удалось прочитать незавершённое создание объекта. Откройте «Логи».');
    const parent = task.root === '/' ? '' : task.root;
    if (task.path !== null && (typeof task.path !== 'string' || !task.path.startsWith(parent + '/') || !validName(task.path.slice(parent.length + 1)))) throw new Error('Некорректная папка нового объекта.');
    const file = JSON.parse(task.text);
    if (!S.validFile(file) || file.projectId !== task.projectId || file.device !== task.device || !Array.isArray(file.tables.projects) || !file.tables.projects.some((p) => p.id === task.projectId && p.name === task.name)) throw new Error('Данные нового объекта не совпадают с его карточкой.');
    return task;
  }
  function prepare(rootPath, name, device, schema, clock, units) {
    if (!validName(name)) throw new Error('Введите название до 120 знаков, без начальной точки и символов \\ / : * ? " < > |.');
    const id = S.newId(), p = new M.Project({}, schema, id, device, clock);
    p.put('projects', id, { name });
    for (const unit of units || []) p.put('units', S.newId(), { projectId: id, name: unit });
    return validate({ format: 1, root: rootPath, name, projectId: id, device, path: null, text: JSON.stringify(S.toFile(p.state, id, name, device)) });
  }
  async function commit(disk, task, checkpoint) {
    validate(task);
    // Persist the identity before any remote write. A retry must use this task again.
    checkpoint(task);
    if (!task.path) {
      await disk.mkdir(task.root);
      const parent = task.root === '/' ? '' : task.root;
      for (let n = 1; n <= 1000; n++) {
        const suffix = n === 1 ? '' : ' (' + n + ')';
        const path = parent + '/' + task.name.slice(0, 120 - suffix.length) + suffix;
        if (await disk.mkdirExclusive(path)) { task.path = path; checkpoint(task); break; }
      }
      if (!task.path) throw new Error('Слишком много объектов с этим названием. Выберите другое имя.');
    }
    await L.assertActive(disk, task.path, task.projectId);
    await disk.mkdir(task.path + '/data'); await disk.mkdir(task.path + '/files');
    const path = task.path + '/data/' + task.device + '.json';
    const current = await disk.getText(path);
    if (current !== null && current !== task.text) throw new Error('Данные объекта уже изменились. Обновите рабочий стол и откройте существующий объект.');
    if (current === null) await disk.putBlob(path, new Blob([task.text], { type: 'application/json' }), false);
    if (await disk.getText(path) !== task.text) throw new Error('Диск пока не подтвердил создание объекта. Нажмите «Повторить создание»: второй объект не появится.');
    await L.assertActive(disk, task.path, task.projectId);
    return { path: task.path, name: task.name, projectId: task.projectId };
  }
  const api = { KEY, validName, validate, prepare, commit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ProrabProjectCreate = api;
})(typeof window !== 'undefined' ? window : globalThis);
