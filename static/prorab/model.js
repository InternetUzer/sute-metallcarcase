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
      this.dirty = false;
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
      if (r) this.dirty = true;
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

  const api = { Project, CATEGORIES, TYPES, isAutoExpense, taskCallPrefix, crewDayId, hm, equipmentTitle, eveningBefore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
