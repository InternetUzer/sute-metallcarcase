/*
 * «Прораб+» в браузере — записи объекта и действия журнала. Правила те же, что в приложении:
 *  - «Сделано»: работа и объём; техника — сколько заплатили (это расход в финансах, id «rw:<работа>»,
 *    статья «Аренда техники»); люди — численность бригады на день (одна запись «бригада:день»);
 *  - «Задача»: план; нужная технике — вызов «task:<задача>:<техника>», в финансах ничего;
 *  - расходы, записанные по технике (id с приставкой rw:, rx:, rf:), правятся только в записи техники.
 * Без DOM — проверяется тестами в Node.
 */
(function (root) {
  'use strict';
  const S = typeof module !== 'undefined' && module.exports ? require('./sync.js') : root.ProrabSync;

  const CATEGORIES = [
    ['CONTRACTOR', 'Оплата подрядчику'], ['MATERIALS', 'Материалы'], ['CONSUMABLES', 'Расходники'],
    ['RENTAL', 'Аренда техники'], ['DELIVERY', 'Доставка / вывоз техники'], ['IDLE', 'Оплачиваемый простой техники'], ['OTHER', 'Иное'],
  ];
  const TYPES = [['EXPENSE', 'Расход'], ['TRANSFER', 'Перевод'], ['INCOME', 'Поступление']];
  const CARD_FIELDS = ['name', 'address', 'customer', 'supervisor', 'contractor', 'startDate', 'deadline', 'lat', 'lon', 'place'];
  /** Статусы пометок на чертеже: код, название, цвет (как в приложении). */
  const NOTE_STATUS = [['NOTE', 'Замечание', '#ff9500'], ['PROBLEM', 'Проблема', '#ff3b30'], ['DONE', 'Сделано', '#34c759']];
  const AUTO = ['rw:', 'rx:', 'rf:'];
  const isAutoExpense = (id) => AUTO.some((p) => String(id).startsWith(p));
  const taskCallPrefix = (taskId) => 'task:' + taskId + ':';
  const crewDayId = (crewId, date) => crewId + ':' + date;

  function hm(minutes) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    if (h > 0 && m > 0) return h + ' ч ' + m + ' мин';
    if (h > 0) return h + ' ч';
    return m + ' мин';
  }

  const dmy = (d) => { const x = new Date(d * 86400000); const p = (n) => String(n).padStart(2, '0'); return p(x.getUTCDate()) + '.' + p(x.getUTCMonth() + 1) + '.' + x.getUTCFullYear(); };
  const numText = (q) => (q === null || q === undefined ? '' : String(Math.round(Number(q) * 1e6) / 1e6).replace('.', ','));

  function equipmentTitle(e) {
    const parts = [e.kind || '', e.name || ''].map((s) => String(s).trim()).filter((s) => s);
    const uniq = parts.filter((s, i) => parts.indexOf(s) === i);
    return (uniq.join(' ') || 'Техника') + (e.plate ? ' (' + e.plate + ')' : '');
  }

  /** Вечер накануне, 18:00 по местному времени (мс) — как «Накануне в 18:00» в приложении. */
  function eveningBefore(day) {
    const d = new Date(day * 86400000);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1, 18, 0, 0).getTime();
  }

  class Project {
    /** state — объединённые записи ({ таблица: { id: { values, vers } } }). */
    constructor(state, schema, projectId, me, clock) {
      this.state = state; this.schema = schema; this.projectId = projectId; this.me = me; this.clock = clock;
      this.dirty = false; this.revision = 0; this.onChange = null;
    }

    rows(table, all) {
      const t = this.state[table] || {};
      const out = [];
      for (const id of Object.keys(t)) {
        const v = t[id].values;
        if (all || !Number(v.deleted)) out.push(v);
      }
      return out;
    }
    get(table, id) { const r = (this.state[table] || {})[id]; return r ? r.values : null; }
    put(table, id, changes) {
      const r = S.edit(this.state, this.schema, table, id, Object.assign({}, changes), this.me, this.clock);
      if (r) { this.dirty = true; this.revision++; if (this.onChange) this.onChange(); }
      return r ? r.values : this.get(table, id);
    }
    del(table, id) { if (this.get(table, id)) this.put(table, id, { deleted: 1 }); }

    get project() { return this.get('projects', this.projectId) || { name: 'Объект' }; }

    names() {
      const map = (table) => Object.fromEntries(this.rows(table).map((r) => [r.id, r.name || '']));
      return { work: map('work_types'), units: map('units'), contractors: map('contractors') };
    }

    itemName(itemId, names) {
      const i = itemId && this.get('boq_items', itemId);
      if (!i) return null;
      names = names || this.names();
      return (i.name || '').trim() || names.work[i.workTypeId] || 'Без названия';
    }

    /** Позиции ведомости для выбора: «Бетонирование, м³». */
    itemOptions() {
      const names = this.names();
      return this.rows('boq_items')
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map((i) => ({ id: i.id, name: this.itemName(i.id, names) + (names.units[i.unitId] ? ', ' + names.units[i.unitId] : '') }));
    }

    equipment(withArchived) { return this.rows('rental_equipment').filter((e) => withArchived || !Number(e.archived)); }
    crews(withArchived) { return this.rows('crews').filter((c) => withArchived || !Number(c.archived)); }

    /** Заказ для отметки техники: действующий заказ карточки, иначе новый (условия из карточки). */
    orderFor(equipmentId, date) {
      const list = this.rows('rental_orders').filter((o) => o.equipmentId === equipmentId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const found = list.find((o) => !Number(o.archived) && !Number(o.closed)) || list.find((o) => !Number(o.archived));
      if (found) return found;
      const e = this.get('rental_equipment', equipmentId);
      if (!e) return null;
      return this.put('rental_orders', S.newId(), {
        projectId: this.projectId, equipmentId, title: e.name || '', termsJson: e.termsJson || '', startDate: date,
      });
    }

    equipmentOfOrder(orderId) {
      const o = orderId && this.get('rental_orders', orderId);
      return o ? this.get('rental_equipment', o.equipmentId) : null;
    }

    orderTitle(orderId) {
      const e = this.equipmentOfOrder(orderId);
      if (e) return equipmentTitle(e);
      const o = orderId && this.get('rental_orders', orderId);
      return (o && o.title) || 'Техника';
    }

    /** Техника записи «Сделано». */
    machinesOfEntry(entryId) {
      return this.rows('rental_work').filter((w) => w.entryId === entryId).map((w) => {
        const e = this.equipmentOfOrder(w.orderId);
        return { workId: w.id, equipmentId: e ? e.id : null, amountCents: w.amountCents, minutes: w.manualMinutes };
      });
    }

    peopleOn(date) {
      const out = {};
      for (const d of this.rows('crew_days')) if (d.date === date) out[d.crewId] = d.people;
      return out;
    }

    /** Расход по технике за день: та же запись, что пишет телефон. */
    machineExpense(work) {
      const id = 'rw:' + work.id;
      if (Number(work.deleted) || !(work.amountCents > 0)) { this.del('finance', id); return; }
      const minutes = work.manualMinutes || 0;
      this.put('finance', id, {
        projectId: this.projectId, type: 'EXPENSE', date: work.date,
        title: 'Техника: ' + this.orderTitle(work.orderId) + (minutes > 0 ? ' — ' + hm(minutes) : ''),
        amountCents: work.amountCents, category: 'RENTAL', deleted: 0,
      });
    }

    /**
     * «Сделано». d: { entryId, date, itemId, qty, contractorId, note, machines: [{ workId, equipmentId, amountCents, minutes }],
     * people: { crewId: число | null } (только если меняли). Возвращает id записи журнала.
     */
    saveDone(d) {
      const entryId = d.entryId || S.newId();
      const date = d.date;
      if (d.itemId) {
        const item = this.get('boq_items', d.itemId) || {};
        this.put('volumes', entryId, {
          projectId: this.projectId, date, itemId: d.itemId, workTypeId: item.workTypeId || null, name: item.name || '',
          unitId: item.unitId || null, quantity: d.qty, contractorId: d.contractorId || null, note: d.note || '', deleted: 0,
        });
      }
      const keep = new Set((d.machines || []).map((m) => m.workId).filter(Boolean));
      for (const w of this.rows('rental_work').filter((w) => w.entryId === entryId)) {
        if (!keep.has(w.id)) {
          this.put('rental_work', w.id, { deleted: 1 });
          this.del('finance', 'rw:' + w.id);
        }
      }
      for (const m of d.machines || []) {
        const prev = m.workId && this.get('rental_work', m.workId);
        const prevEq = prev && this.equipmentOfOrder(prev.orderId);
        const order = prev && prevEq && prevEq.id === m.equipmentId ? this.get('rental_orders', prev.orderId) : this.orderFor(m.equipmentId, date);
        if (!order) continue;
        const workId = m.workId || S.newId();
        const w = this.put('rental_work', workId, {
          projectId: this.projectId, orderId: order.id, date, intervalsJson: '', manualMinutes: m.minutes || null,
          amountCents: m.amountCents, entryId, itemId: d.itemId || (prev && prev.itemId) || null, deleted: 0,
        });
        this.machineExpense(w);
      }
      if (d.people) {
        for (const [crewId, n] of Object.entries(d.people)) {
          const id = crewDayId(crewId, date);
          const old = this.get('crew_days', id);
          if (n === null || n === undefined) { if (old && !Number(old.deleted)) this.put('crew_days', id, { deleted: 1 }); }
          else this.put('crew_days', id, { projectId: this.projectId, crewId, date, people: n, deleted: 0 });
        }
      }
      return entryId;
    }

    deleteDone(entryId) {
      this.del('volumes', entryId);
      for (const w of this.rows('rental_work').filter((w) => w.entryId === entryId)) {
        this.put('rental_work', w.id, { deleted: 1 });
        this.del('finance', 'rw:' + w.id);
      }
    }

    taskMachines(taskId) {
      const p = taskCallPrefix(taskId);
      const calls = this.rows('rental_calls').filter((c) => c.id.startsWith(p));
      return { equipment: calls.map((c) => c.id.slice(p.length)), remind: calls.some((c) => c.remindAt) };
    }

    /** «Задача» с нужной техникой — план, в финансах ничего. */
    saveTask(t) {
      const taskId = t.taskId || S.newId();
      const names = (t.machines || []).map((id) => this.get('rental_equipment', id)).filter(Boolean).map(equipmentTitle);
      const title = (t.title || '').trim() || (!t.itemId && names.length ? 'Нужна техника: ' + names.join(', ') : '');
      const task = this.put('tasks', taskId, {
        projectId: this.projectId, date: t.date, itemId: t.itemId || null, title, planQty: t.planQty === undefined ? null : t.planQty,
        contractorId: t.contractorId || null, note: t.note || '', done: t.done ? 1 : 0, deleted: t.deleted ? 1 : 0,
      });
      const p = taskCallPrefix(taskId);
      const want = task.deleted ? [] : Array.from(new Set(t.machines || []));
      for (const c of this.rows('rental_calls').filter((c) => c.id.startsWith(p))) {
        if (!want.includes(c.id.slice(p.length))) this.put('rental_calls', c.id, { deleted: 1 });
      }
      for (const eq of want) {
        const id = p + eq;
        const prev = this.get('rental_calls', id);
        const order = prev ? this.get('rental_orders', prev.orderId) : this.orderFor(eq, task.date);
        if (!order) continue;
        const status = task.done ? 'DONE' : prev && prev.status !== 'DONE' ? prev.status : 'PLANNED';
        this.put('rental_calls', id, {
          projectId: this.projectId, orderId: order.id, date: task.date, itemId: task.itemId, comment: task.title || task.note || '',
          status, remindAt: t.remind ? eveningBefore(task.date) : null, deleted: 0,
        });
      }
      return taskId;
    }

    deleteTask(taskId) {
      const t = this.get('tasks', taskId);
      if (!t) return;
      this.saveTask(Object.assign({}, t, { taskId, deleted: true, machines: [] }));
    }

    saveFinance(f) {
      if (f.id && isAutoExpense(f.id)) {
        // Расход по технике: меняются только заметка (сумма — из записи техники)
        return this.put('finance', f.id, { note: f.note || '' });
      }
      const id = f.id || S.newId();
      return this.put('finance', id, {
        projectId: this.projectId, type: f.type, date: f.date, title: f.title || '', amountCents: f.amountCents,
        contractorId: f.contractorId || null, note: f.note || '', category: f.type === 'INCOME' ? null : (f.category || 'OTHER'), deleted: 0,
      });
    }

    deleteFinance(id) { if (!isAutoExpense(id)) this.del('finance', id); }

    saveEquipment(e) {
      return this.put('rental_equipment', e.id || S.newId(), {
        projectId: this.projectId, name: e.name || '', kind: e.kind || '', plate: e.plate || '', supplier: e.supplier || '',
        phone: e.phone || '', archived: e.archived ? 1 : 0, deleted: 0,
      });
    }

    saveCrew(c) {
      return this.put('crews', c.id || S.newId(), { projectId: this.projectId, name: c.name || '', archived: c.archived ? 1 : 0, deleted: 0 });
    }

    // ───────── фото (вложения) ─────────
    /** Фото и видео записи (журнала, замечания…): файлы — в «<объект>/files/», как у телефона. */
    attachmentsOf(ownerId) {
      return this.rows('attachments').filter((x) => x.ownerId === ownerId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }
    addAttachment(ownerId, file, kind) {
      return this.put('attachments', S.newId(), { projectId: this.projectId, ownerId, kind: kind || 'photo', file, deleted: 0 });
    }
    removeAttachment(id) { this.del('attachments', id); }

    // ───────── справочники ─────────
    addNamed(table, name) {
      const n = String(name || '').trim();
      if (!n) return null;
      const same = this.rows(table).find((r) => (r.name || '').trim().toLowerCase() === n.toLowerCase());
      return same || this.put(table, S.newId(), { projectId: this.projectId, name: n, deleted: 0 });
    }

    // ───────── ведомость ─────────
    saveBoqItem(it) {
      const id = it.id || S.newId();
      const position = it.id ? undefined : this.rows('boq_items').reduce((m, r) => Math.max(m, r.position || 0), -1) + 1;
      const changes = {
        projectId: this.projectId, name: it.name || '', workTypeId: it.workTypeId || null, unitId: it.unitId || null,
        planQty: it.planQty === undefined ? null : it.planQty, priceCents: it.priceCents === undefined ? null : it.priceCents,
        startDate: it.startDate || null, dueDate: it.dueDate || null, contractorId: it.contractorId || null,
        finishedDate: it.finishedDate || null, deleted: 0,
      };
      if (position !== undefined) changes.position = position;
      return this.put('boq_items', id, changes);
    }
    /** Позицию с записями «Сделано» не удаляем — её объём уже в журнале. */
    itemHasHistory(id) { return this.rows('volumes').some((v) => v.itemId === id) || this.rows('tasks').some((t) => t.itemId === id); }
    deleteBoqItem(id) { if (!this.itemHasHistory(id)) this.del('boq_items', id); }

    // ───────── замечания ─────────
    remarks() { return this.rows('remarks').sort((a, b) => (b.number || 0) - (a.number || 0)); }
    saveRemark(r) {
      const id = r.id || S.newId();
      const changes = {
        projectId: this.projectId, date: r.date, text: r.text || '', place: r.place || '', contractorId: r.contractorId || null,
        dueDate: r.dueDate || null, deleted: 0,
      };
      if (!r.id || !this.get('remarks', r.id)) {
        changes.number = this.rows('remarks', true).reduce((m, x) => Math.max(m, x.number || 0), 0) + 1;
        changes.status = 'OPEN';
        if (r.acceptanceId) changes.acceptanceId = r.acceptanceId;
      }
      return this.put('remarks', id, changes);
    }
    setRemarkDone(id, done, note, date) {
      return this.put('remarks', id, done ? { status: 'DONE', doneDate: date, doneNote: note || '' } : { status: 'OPEN', doneDate: null, doneNote: '' });
    }
    deleteRemark(id) { this.del('remarks', id); }

    // ───────── карточка объекта ─────────
    /** Меняет только переданные и действительно изменённые поля (правки коллег в других полях не затираются). */
    saveCard(changes) {
      const cur = this.project;
      const out = {};
      for (const k of CARD_FIELDS) {
        if (!(k in changes)) continue;
        let v = changes[k];
        if (typeof v === 'string') v = v.trim();
        if (v === undefined) v = null;
        const was = cur[k] === undefined ? null : cur[k];
        if (v !== was) out[k] = v;
      }
      if (Object.keys(out).length) this.put('projects', this.projectId, out);
      return out;
    }
    /** Свои поля карточки (для шаблонов документов): по порядку. */
    fields() { return this.rows('project_fields').sort((a, b) => (a.position || 0) - (b.position || 0) || String(a.name).localeCompare(String(b.name), 'ru')); }
    saveField(f) {
      const id = f.id || S.newId();
      const changes = { projectId: this.projectId, name: String(f.name || '').trim(), value: String(f.value || ''), deleted: 0 };
      if (!f.id) changes.position = this.rows('project_fields', true).reduce((m, r) => Math.max(m, (r.position || 0) + 1), 0);
      const old = f.id ? this.get('project_fields', id) : null;
      if (old && old.name === changes.name && old.value === changes.value) return old;
      return this.put('project_fields', id, changes);
    }
    deleteField(id) { this.del('project_fields', id); }

    // ───────── справочники ─────────
    contractors() { return this.rows('contractors').sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru', { sensitivity: 'base' })); }
    saveContractor(c) {
      const name = String(c.name || '').trim();
      if (!name) throw new Error('Укажите имя или организацию');
      return this.put('contractors', c.id || S.newId(), {
        projectId: this.projectId, name, specialty: String(c.specialty || '').trim(), phone: String(c.phone || '').trim(),
        email: String(c.email || '').trim(), note: String(c.note || '').trim(), deleted: 0,
      });
    }
    deleteContractor(id) { this.del('contractors', id); }
    named(table) { return this.rows(table).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru', { sensitivity: 'base' })); }
    renameNamed(table, id, name) {
      const n = String(name || '').trim();
      if (!n) throw new Error('Название не может быть пустым');
      return this.put(table, id, { name: n });
    }
    deleteNamed(table, id) { this.del(table, id); }
    /** Добавить из каталога то, чего ещё нет (без учёта регистра). Возвращает, сколько добавлено. */
    addMany(table, names) {
      let n = 0;
      for (const name of names) {
        const before = this.rows(table).length;
        this.addNamed(table, name);
        if (this.rows(table).length > before) n++;
      }
      return n;
    }

    // ───────── чертежи ─────────
    drawings() { return this.rows('drawings').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); }
    /** Чертёж: файл уже лежит в «<объект>/files/<file>» (имя <id>.pdf или <id>.dxf — как у телефона). */
    addDrawing(d) {
      if (d.kind !== 'pdf' && d.kind !== 'dxf') throw new Error('Чертёж — PDF или DXF');
      return this.put('drawings', d.id, { projectId: this.projectId, name: String(d.name || '').trim() || 'Чертёж', kind: d.kind, file: d.file, pages: Math.max(1, d.pages || 1), deleted: 0 });
    }
    renameDrawing(id, name) { return this.put('drawings', id, { name: String(name || '').trim() || 'Чертёж' }); }
    deleteDrawing(id) { this.del('drawings', id); }
    notesOf(drawingId) { return this.rows('drawing_notes').filter((n) => n.drawingId === drawingId).sort((a, b) => (a.number || 0) - (b.number || 0)); }
    /** Пометка на чертеже. Новая — следующий номер на этом чертеже (с учётом удалённых, как в телефоне). */
    saveNote(n) {
      const status = NOTE_STATUS.some(([k]) => k === n.status) ? n.status : 'NOTE';
      const changes = {
        text: String(n.text || '').trim(), status, contractorId: n.contractorId || null, dueDate: n.dueDate || null,
        doneDate: status === 'DONE' ? n.doneDate || null : null,
      };
      if (n.id && this.get('drawing_notes', n.id)) return this.put('drawing_notes', n.id, changes);
      const number = this.rows('drawing_notes', true).filter((x) => x.drawingId === n.drawingId).reduce((m, x) => Math.max(m, x.number || 0), 0) + 1;
      return this.put('drawing_notes', n.id || S.newId(), Object.assign(changes, {
        projectId: this.projectId, drawingId: n.drawingId, page: n.page || 0, x: n.x, y: n.y, number, viewId: n.viewId || null, deleted: 0,
      }));
    }
    deleteNote(id) { this.del('drawing_notes', id); }
    viewsOf(drawingId) { return this.rows('drawing_views').filter((v) => v.drawingId === drawingId).sort((a, b) => (a.position || 0) - (b.position || 0) || (a.createdAt || 0) - (b.createdAt || 0)); }
    /** Вид чертежа: лист PDF или набор скрытых слоёв DXF, плюс место (центр в настоящих координатах) и ширина. */
    saveView(v) {
      const changes = { name: String(v.name || '').trim() || 'Вид', page: v.page || 0, hiddenLayers: v.hiddenLayers === undefined ? null : v.hiddenLayers, cx: v.cx, cy: v.cy, span: v.span };
      if (v.id && this.get('drawing_views', v.id)) return this.put('drawing_views', v.id, changes);
      const position = this.rows('drawing_views').filter((x) => x.drawingId === v.drawingId).reduce((m, x) => Math.max(m, (x.position || 0) + 1), 0);
      return this.put('drawing_views', v.id || S.newId(), Object.assign(changes, { projectId: this.projectId, drawingId: v.drawingId, position, rotation: 0, deleted: 0 }));
    }
    deleteView(id) { this.del('drawing_views', id); }

    /** Следующий номер пометки на чертеже (с удалёнными — как в телефоне). */
    nextNoteNumber(drawingId) { return this.rows('drawing_notes', true).filter((x) => x.drawingId === drawingId).reduce((m, x) => Math.max(m, x.number || 0), 0) + 1; }

    /** Замечание из журнала — на чертёж: становится пометкой с теми же фото, само замечание убирается (как в телефоне). */
    placeRemark(remarkId, drawingId, page, x, y, viewId) {
      const r = this.get('remarks', remarkId);
      if (!r) throw new Error('Замечание не найдено');
      const done = r.status === 'DONE';
      let text = r.text || '';
      if (r.place) text += ' (' + r.place + ')';
      if (done) text += '\nУстранено' + (r.doneDate ? ' ' + dmy(r.doneDate) : '') + (r.doneNote ? ': ' + r.doneNote : '');
      const id = S.newId();
      const note = this.put('drawing_notes', id, {
        projectId: this.projectId, drawingId, page: page || 0, x, y, viewId: viewId || null, number: this.nextNoteNumber(drawingId), text,
        status: done ? 'DONE' : 'NOTE', doneDate: done ? r.doneDate || null : null, contractorId: r.contractorId || null, dueDate: r.dueDate || null,
        acceptanceId: r.acceptanceId || null, deleted: 0,
      });
      for (const a of this.attachmentsOf(remarkId)) this.put('attachments', a.id, { ownerId: id });
      for (const a of this.attachmentsOf(remarkId + ':done')) this.put('attachments', a.id, { ownerId: id + ':done' });
      this.del('remarks', remarkId);
      return note;
    }

    // ───────── доп. работы ─────────
    /**
     * Доп. работы — считаются сами из ведомости и журнала (как extraWorksOf в приложении):
     * EXTRA_ITEM — заведены заранее; OVER_PLAN — сверх плана; NO_PLAN — позиции без плана (если у объекта есть план);
     * NO_ITEM — записи без позиции. parts — записи журнала (или их части) сверх плана.
     */
    extraWorks() {
      const EPS = 1e-9;
      const items = this.rows('boq_items').sort((a, b) => (a.position || 0) - (b.position || 0));
      const entries = this.rows('volumes');
      const known = new Set(items.map((i) => i.id));
      const usesPlan = items.some((i) => i.extraDate === null || i.extraDate === undefined ? (Number(i.planQty) || 0) > 0 : false);
      const sorted = (l) => l.slice().sort((a, b) => (a.date - b.date) || ((a.createdAt || 0) - (b.createdAt || 0)));
      const qty = (e) => Number(e.quantity) || 0;
      const out = [];
      for (const item of items) {
        const list = sorted(entries.filter((e) => e.itemId === item.id));
        const fact = list.reduce((s, e) => s + qty(e), 0);
        const plan = Number(item.planQty) > 0 ? Number(item.planQty) : null;
        if (item.extraDate !== null && item.extraDate !== undefined) {
          out.push({ kind: 'EXTRA_ITEM', item, plan, fact, extra: Math.max(plan || 0, fact), since: item.extraDate, parts: list.map((e) => ({ entry: e, qty: qty(e) })) });
          continue;
        }
        if (fact <= EPS) continue;
        if (plan === null) {
          if (usesPlan) out.push({ kind: 'NO_PLAN', item, plan: null, fact, extra: fact, since: list.length ? list[0].date : null, parts: list.map((e) => ({ entry: e, qty: qty(e) })) });
          continue;
        }
        if (fact <= plan + EPS) continue;
        let sum = 0;
        const parts = [];
        for (const e of list) {
          const before = sum;
          sum += qty(e);
          if (sum > plan + EPS && qty(e) > 0) parts.push({ entry: e, qty: Math.min(qty(e), sum - Math.max(before, plan)) });
        }
        out.push({ kind: 'OVER_PLAN', item, plan, fact, extra: fact - plan, since: parts.length ? parts[0].entry.date : null, parts });
      }
      const loose = sorted(entries.filter((e) => (!e.itemId || !known.has(e.itemId)) && qty(e) > EPS));
      if (loose.length) {
        const fact = loose.reduce((s, e) => s + qty(e), 0);
        out.push({ kind: 'NO_ITEM', item: null, plan: null, fact, extra: fact, since: loose[0].date, parts: loose.map((e) => ({ entry: e, qty: qty(e) })) });
      }
      for (const w of out) {
        w.extra = Math.round(w.extra * 1e6) / 1e6;
        w.cost = w.item && w.item.priceCents ? Math.round(w.extra * w.item.priceCents) : null;
      }
      return out;
    }
    /** Карточка доп. работы: постоянный id «extra:<позиция>» (или «extra:loose:<объект>»). */
    extraApprovalId(itemId) { return itemId ? 'extra:' + itemId : 'extra:loose:' + this.projectId; }
    extraApproval(itemId) { const a = this.get('extra_approvals', this.extraApprovalId(itemId)); return a && !Number(a.deleted) ? a : null; }
    saveExtraApproval(itemId, changes) {
      const id = this.extraApprovalId(itemId);
      const base = this.get('extra_approvals', id) ? {} : { projectId: this.projectId, itemId: itemId || null };
      const allowed = ['note', 'description', 'designerDate', 'supervisorDate', 'contractorDate', 'customerDate', 'noteId'];
      const out = Object.assign(base, { deleted: 0 });
      for (const k of allowed) if (k in changes) out[k] = changes[k] === undefined ? null : changes[k];
      return this.put('extra_approvals', id, out);
    }
    /** Поставить доп. работу на чертёж: пометка с номером, старая пометка этой работы убирается. */
    placeExtra(itemId, drawingId, page, x, y, viewId) {
      const a = this.extraApproval(itemId);
      const item = itemId ? this.get('boq_items', itemId) : null;
      const title = (item && String(item.name || '').trim()) || 'доп. работа';
      const desc = a && a.description && a.description.trim() ? '\n' + a.description : '';
      if (a && a.noteId && this.get('drawing_notes', a.noteId)) this.del('drawing_notes', a.noteId);
      const id = S.newId();
      const note = this.put('drawing_notes', id, {
        projectId: this.projectId, drawingId, page: page || 0, x, y, viewId: viewId || null, number: this.nextNoteNumber(drawingId),
        text: 'Доп. работа: ' + title + desc, status: 'NOTE', contractorId: (item && item.contractorId) || null, deleted: 0,
      });
      this.saveExtraApproval(itemId, { noteId: id });
      return note;
    }

    // ───────── журнал приёмки ─────────
    /** Текущие приёмки: последняя по позиции и последняя по записи журнала; отменённая — значит текущей нет. */
    acceptancesCurrent() {
      const latest = new Map();
      for (const a of this.rows('acceptances')) {
        const key = a.entryId ? 'e:' + a.entryId : 'i:' + a.itemId;
        const was = latest.get(key);
        if (!was || (a.createdAt || 0) > (was.createdAt || 0)) latest.set(key, a);
      }
      return Array.from(latest.values()).filter((a) => a.result !== 'CANCELLED');
    }
    acceptanceTitle(a) {
      const name = a.workName || this.itemName(a.itemId) || 'Позиция';
      if (!a.entryId) return name;
      const unit = a.unitName !== null && a.unitName !== undefined ? a.unitName : (this.names().units[(this.get('boq_items', a.itemId) || {}).unitId] || '');
      return name + ' — ' + numText(a.qty) + (unit ? ' ' + unit : '') + ' за ' + dmy(a.readyDate);
    }
    /** История предъявлений той же работы (вся позиция или та же запись), новые сверху. */
    acceptanceHistory(a) {
      return this.rows('acceptances').filter((x) => x.itemId === a.itemId && (x.entryId || null) === (a.entryId || null) && x.id !== a.id)
        .sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
    }
    /** Замечания по приёмке (журнал замечаний и пометки на чертежах): { open, total }. */
    acceptanceRemarks(id) {
      const rs = this.rows('remarks').filter((r) => r.acceptanceId === id);
      const ns = this.rows('drawing_notes').filter((n) => n.acceptanceId === id);
      return { remarks: rs, notes: ns, open: rs.filter((r) => r.status !== 'DONE').length + ns.filter((n) => n.status !== 'DONE').length, total: rs.length + ns.length };
    }
    /** «Закончено — готово к приёмке»: дата окончания у позиции + запись в журнале приёмки. */
    submitAcceptance(itemId, finishDate, planDate, acceptedBy) {
      const item = this.get('boq_items', itemId);
      if (!item) throw new Error('Позиция не найдена');
      this.put('boq_items', itemId, { finishedDate: finishDate });
      return this.put('acceptances', S.newId(), {
        projectId: this.projectId, itemId, readyDate: finishDate, planDate: planDate || null, result: 'PENDING', acceptedBy: String(acceptedBy || '').trim(),
        workName: this.itemName(itemId), unitName: this.names().units[item.unitId] || '', entryId: null, qty: null, note: '', deleted: 0,
      });
    }
    isCurrentForItem(a) {
      if (a.entryId || a.result === 'CANCELLED') return false;
      const list = this.rows('acceptances').filter((x) => x.itemId === a.itemId && !x.entryId);
      return list.reduce((m, x) => (!m || (x.createdAt || 0) > (m.createdAt || 0) ? x : m), null).id === a.id;
    }
    saveAcceptance(id, c) {
      const result = ['PENDING', 'ACCEPTED', 'REJECTED'].includes(c.result) ? c.result : 'PENDING';
      const a = this.put('acceptances', id, {
        readyDate: c.readyDate, planDate: c.planDate || null, result, resultDate: result === 'PENDING' ? null : c.resultDate || null,
        acceptedBy: String(c.acceptedBy || '').trim(), note: String(c.note || '').trim(),
      });
      if (this.isCurrentForItem(a)) {
        const item = this.get('boq_items', a.itemId);
        if (item && item.finishedDate !== a.readyDate) this.put('boq_items', a.itemId, { finishedDate: a.readyDate });
      }
      return a;
    }
    /** Отменить предъявление: в истории как «Отменено», позиция снова «в работе». */
    cancelAcceptance(id, day) {
      const a = this.put('acceptances', id, { result: 'CANCELLED', resultDate: day });
      if (!a.entryId && this.get('boq_items', a.itemId)) this.put('boq_items', a.itemId, { finishedDate: null });
      return a;
    }
    /** После «Не принято» и устранения замечаний — предъявить снова. */
    resubmitAcceptance(id, day) {
      const a = this.get('acceptances', id);
      const n = this.put('acceptances', S.newId(), {
        projectId: this.projectId, itemId: a.itemId, entryId: a.entryId || null, qty: a.qty === undefined ? null : a.qty, readyDate: day, planDate: null,
        result: 'PENDING', acceptedBy: a.acceptedBy || '', workName: a.workName || null, unitName: a.unitName === undefined ? null : a.unitName, note: '', deleted: 0,
      });
      if (!a.entryId && this.get('boq_items', a.itemId)) this.put('boq_items', a.itemId, { finishedDate: day });
      return n;
    }
    /** Кто может принимать: технадзор и заказчик из карточки + все, кто уже принимал. */
    acceptors() {
      const p = this.project, out = [];
      const add = (s) => { s = String(s || '').trim(); if (s && !out.includes(s)) out.push(s); };
      add(p.supervisor && p.supervisor.trim() ? p.supervisor.trim() + ' (технадзор)' : 'Технадзор');
      if (p.customer && p.customer.trim()) add(p.customer.trim() + ' (заказчик)');
      this.rows('acceptances').forEach((a) => add(a.acceptedBy));
      return out;
    }

    // ───────── сегодня ─────────
    /** «Сегодня на объекте» — как todayView в приложении (только чтение). */
    todayView(day) {
      const tasks = this.rows('tasks');
      const boq = this.boq();
      const pending = this.acceptancesCurrent().filter((a) => a.result === 'PENDING').sort((a, b) => (a.planDate || a.readyDate) - (b.planDate || b.readyDate));
      const remarks = this.rows('remarks');
      const v = {
        day,
        tasks: tasks.filter((t) => t.date === day && !Number(t.done)),
        overdueTasks: tasks.filter((t) => t.date < day && !Number(t.done)).sort((a, b) => a.date - b.date),
        itemsDue: boq.filter((r) => r.due && r.due <= day && !r.finished).sort((a, b) => a.due - b.due),
        acceptancesPending: pending,
        remarksDue: remarks.filter((r) => r.status !== 'DONE' && r.dueDate && r.dueDate <= day).sort((a, b) => a.dueDate - b.dueDate),
        remarksOpen: remarks.filter((r) => r.status !== 'DONE').length,
        calls: this.rows('rental_calls').filter((c) => c.date === day && c.status !== 'CANCELLED').sort((a, b) => (a.timeMin === null || a.timeMin === undefined ? 1e9 : a.timeMin) - (b.timeMin === null || b.timeMin === undefined ? 1e9 : b.timeMin)),
        machineWork: this.rows('rental_work').filter((w) => w.date === day),
        crewDays: this.rows('crew_days').filter((c) => c.date === day),
        doneToday: this.rows('volumes').filter((e) => e.date === day),
      };
      v.people = v.crewDays.reduce((s, c) => s + (Number(c.people) || 0), 0);
      v.attention = v.overdueTasks.length + v.itemsDue.filter((r) => r.due < day).length + v.acceptancesPending.length + v.remarksDue.length;
      return v;
    }

    /** Ведомость: позиции с планом, сделанным (сумма записей «Сделано»), процентом, остатком и сроком. */
    boq() {
      const names = this.names();
      const done = {};
      for (const v of this.rows('volumes')) if (v.itemId) done[v.itemId] = (done[v.itemId] || 0) + (Number(v.quantity) || 0);
      return this.rows('boq_items').sort((a, b) => (a.position || 0) - (b.position || 0)).map((i) => {
        const plan = i.planQty === null || i.planQty === undefined ? null : Number(i.planQty);
        const fact = Math.round((done[i.id] || 0) * 1e6) / 1e6;
        return {
          id: i.id, name: this.itemName(i.id, names), work: names.work[i.workTypeId] || '', unit: names.units[i.unitId] || '',
          plan, fact, percent: plan ? Math.round((fact / plan) * 1000) / 10 : null,
          remaining: plan === null ? null : Math.round((plan - fact) * 1e6) / 1e6,
          due: i.dueDate || null, finished: !!i.finishedDate, who: names.contractors[i.contractorId] || '',
        };
      });
    }

    /** Отчёт за день текстом (для мессенджера) — как «Отчёт за день» в приложении. */
    dayReport(day, dayTitle, money) {
      const d = this.days(day, day)[0] || { works: [], machines: [], people: [], tasks: [] };
      const num = (q) => (q === null || q === undefined ? '' : Number(q).toLocaleString('ru-RU', { maximumFractionDigits: 6 }));
      const out = ['Объект: ' + (this.project.name || ''), 'Отчёт за ' + dayTitle, ''];
      out.push('Выполненные работы:');
      if (!d.works.length) out.push('— не записаны');
      d.works.forEach((w) => out.push('• ' + w.title + ': ' + num(w.qty) + (w.unit ? ' ' + w.unit : '') + (w.who ? ' (' + w.who + ')' : '') + (w.note ? ' — ' + w.note : '')));
      out.push('', 'Техника:');
      if (!d.machines.length) out.push('— не работала');
      d.machines.forEach((m) => out.push('• ' + m.title + (m.minutes ? ': работала ' + hm(m.minutes) : '')));
      const total = d.people.reduce((s, p) => s + (p.people || 0), 0);
      out.push('', 'Люди на объекте: ' + (d.people.length ? total + ' чел.' : 'не отмечены'));
      d.people.forEach((p) => out.push('• ' + p.name + ' — ' + p.people));
      const plan = d.tasks.filter((t) => !t.done);
      if (plan.length) { out.push('', 'В плане:'); plan.forEach((t) => out.push('• ' + t.title)); }
      return out.join('\n');
    }

    /** Строки выгрузки журнала за период (Excel): по дням и итоги. */
    exportRows(from, to) {
      const days = this.days(from, to).sort((a, b) => a.day - b.day);
      const byDay = [], totals = [];
      for (const d of days) {
        for (const w of d.works) byDay.push([d.day, 'Работы', w.title, w.qty, w.unit, w.who, w.note, null]);
        for (const m of d.machines) byDay.push([d.day, 'Техника', m.title, m.minutes ? Math.round((m.minutes / 60) * 100) / 100 : null, m.minutes ? 'ч' : '', '', '', m.amountCents ? m.amountCents / 100 : null]);
        for (const p of d.people) byDay.push([d.day, 'Люди', p.name, p.people, 'чел.', '', '', null]);
        for (const t of d.tasks) byDay.push([d.day, 'Задачи', t.title, t.planQty, '', t.who, t.done ? 'выполнено' : 'не выполнено', null]);
        for (const f of d.money) byDay.push([d.day, 'Финансы', f.title, null, '', '', f.type === 'INCOME' ? 'поступление' : 'расход', (f.type === 'INCOME' ? 1 : -1) * f.amountCents / 100]);
        const exp = d.money.filter((f) => f.type !== 'INCOME').reduce((s, f) => s + f.amountCents, 0);
        const inc = d.money.filter((f) => f.type === 'INCOME').reduce((s, f) => s + f.amountCents, 0);
        totals.push([d.day, d.works.length, d.people.reduce((s, p) => s + (p.people || 0), 0), Math.round((d.machines.reduce((s, m) => s + (m.minutes || 0), 0) / 60) * 100) / 100, d.tasks.length, d.tasks.filter((t) => t.done).length, exp / 100, inc / 100]);
      }
      return { byDay, totals };
    }

    /** Журнал по дням периода [from, to] (номера дней; null — без границы), новые сверху. */
    days(from, to) {
      const ok = (d) => (from === null || from === undefined || d >= from) && (to === null || to === undefined || d <= to);
      const names = this.names();
      const byDay = new Map();
      const day = (d) => { if (!byDay.has(d)) byDay.set(d, { day: d, works: [], machines: [], people: [], tasks: [], money: [], weather: null }); return byDay.get(d); };
      for (const v of this.rows('volumes')) if (ok(v.date)) {
        day(v.date).works.push({
          id: v.id, title: this.itemName(v.itemId, names) || v.name || names.work[v.workTypeId] || 'Запись',
          qty: v.quantity, unit: names.units[(this.get('boq_items', v.itemId) || {}).unitId || v.unitId] || '',
          who: names.contractors[v.contractorId] || '', note: v.note || '',
        });
      }
      for (const w of this.rows('rental_work')) if (ok(w.date)) {
        day(w.date).machines.push({ id: w.id, entryId: w.entryId, title: this.orderTitle(w.orderId), amountCents: w.amountCents, minutes: w.manualMinutes });
      }
      for (const c of this.rows('crew_days')) if (ok(c.date)) {
        const crew = this.get('crews', c.crewId);
        day(c.date).people.push({ crewId: c.crewId, name: (crew && crew.name) || 'Бригада', people: c.people });
      }
      for (const t of this.rows('tasks')) if (ok(t.date)) {
        day(t.date).tasks.push({ id: t.id, title: this.itemName(t.itemId, names) || t.title || 'Задача', done: !!Number(t.done), planQty: t.planQty, who: names.contractors[t.contractorId] || '' });
      }
      for (const f of this.rows('finance')) if (ok(f.date)) {
        day(f.date).money.push({ id: f.id, title: f.title || '', type: f.type, amountCents: f.amountCents, category: f.category, auto: isAutoExpense(f.id) });
      }
      for (const w of this.rows('day_weather')) if (byDay.has(w.date)) byDay.get(w.date).weather = w;
      return Array.from(byDay.values()).sort((a, b) => b.day - a.day);
    }
  }

  const api = { Project, CATEGORIES, TYPES, NOTE_STATUS, isAutoExpense, taskCallPrefix, crewDayId, hm, equipmentTitle, eveningBefore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
