/* Gallery references existing records/files; never changes the cloud schema. */
(function (root) {
  'use strict';
  function collect(P) {
    const rows = (table) => P.rows(table, true).filter((r) => r.projectId === P.projectId);
    const sources = new Map();
    const names = new Map(rows('boq_items').map((r) => [r.id, r.name]));
    const types = new Map(rows('work_types').map((r) => [r.id, r.name]));
    const drawings = new Map(rows('drawings').map((r) => [r.id, r.name]));
    const work = (name, item, type) => String(name || '').trim() || names.get(item) || types.get(type) || 'Работа';
    const add = (r, id, caption, date, category) => sources.set(id, { caption, date: date == null ? null : date, category, deleted: !!Number(r.deleted) });
    rows('volumes').forEach((r) => add(r, r.id, 'Журнал работ · ' + work(r.name, r.itemId, r.workTypeId), r.date, 'Журнал'));
    rows('journal').forEach((r) => add(r, r.id, 'Журнал работ · ' + work(null, null, r.workTypeId), r.startDate, 'Журнал'));
    rows('remarks').forEach((r) => {
      const title = 'Замечание №' + r.number + ' · ' + (r.text || '');
      add(r, r.id, title + ' · До устранения', r.date, 'Замечания');
      add(r, r.id + ':done', title + ' · После устранения', r.doneDate, 'Замечания');
    });
    rows('drawing_notes').forEach((r) => {
      const title = 'Пометка №' + r.number + ' · ' + (drawings.get(r.drawingId) || 'Чертёж') + ' · ' + (r.text || '');
      add(r, r.id, title + ' · До устранения', null, 'Чертежи');
      add(r, r.id + ':done', title + ' · После устранения', r.doneDate, 'Чертежи');
    });
    rows('acceptances').forEach((r) => add(r, r.id, 'Приёмка · ' + work(r.workName, r.itemId), r.readyDate, 'Приёмка'));
    rows('extra_approvals').forEach((r) => {
      const title = 'Доп. работа · ' + work(r.description, r.itemId);
      add(r, r.id, title + ' · Подтверждение', null, 'Доп. работы');
      add(r, r.id + ':work', title + ' · Фото работы', null, 'Доп. работы');
    });
    rows('finance').forEach((r) => add(r, r.id, 'Финансы · ' + (r.title || 'Чек'), r.date, 'Финансы'));
    const attachments = rows('attachments').filter((a) => !Number(a.deleted) && a.file);
    const result = attachments.filter((a) => !sources.get(a.ownerId)?.deleted).map((a) => {
      const s = sources.get(a.ownerId);
      return { id: 'attachment:' + a.id, file: a.file, video: a.kind === 'video', caption: s?.caption || 'Источник записи недоступен', date: s?.date ?? null, category: s?.category || 'Прочее' };
    });
    rows('finance').filter((f) => !Number(f.deleted) && f.photo).forEach((f) => {
      if (!attachments.some((a) => a.ownerId === f.id && a.file === f.photo)) result.push({ id: 'finance:' + f.id, file: f.photo, video: false, caption: 'Чек · ' + (f.title || ''), date: f.date, category: 'Финансы' });
    });
    return result.sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity) || a.id.localeCompare(b.id));
  }

  // Video bytes must not pass through the JPEG encoder.
  function uploadKind(file) {
    if (file.type.startsWith('image/')) return { video: false, extension: 'jpg' };
    if (!file.type.startsWith('video/')) throw new Error('Выберите фото или видео');
    const ext = String(file.name).split('.').pop().toLowerCase();
    const known = ['mp4', 'mov', 'webm', 'm4v', '3gp', 'mkv', 'avi'];
    const fallback = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp' };
    return { video: true, extension: known.includes(ext) ? ext : fallback[file.type] || 'mp4' };
  }
  const api = { collect, uploadKind };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabGallery = api;
})(typeof window !== 'undefined' ? window : globalThis);
