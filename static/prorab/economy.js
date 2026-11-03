/*
 * «Прораб+» — экономика объектов для собственника: договор, бюджет, поступления (данные собственника, шифруются)
 * и расчёт по данным объекта (расходы из «Финансов», выполненное — из ведомости и журнала).
 * Без DOM — проверяется тестами в Node.
 */
(function (root) {
  'use strict';

  let lastStamp = 0;
  const stamp = () => (lastStamp = Math.max(Date.now() * 1000, lastStamp + 1));
  const newId = () => (root.crypto || globalThis.crypto).randomUUID();
  const FIELDS = ['contractCents', 'contractNo', 'contractDate', 'budget', 'note', 'name'];

  const empty = () => ({ version: 1, projects: {} });

  function validate(data) {
    const object = (x) => x && typeof x === 'object' && !Array.isArray(x);
    const safe = (s) => !['__proto__', 'prototype', 'constructor'].includes(s);
    if (!object(data) || data.version !== 1 || !object(data.projects)) throw new Error('Неизвестная версия данных экономики.');
    for (const [id, r] of Object.entries(data.projects)) {
      if (!safe(id) || !object(r) || !object(r.t) || !object(r.payments) || !object(r.stages)) throw new Error('Повреждена запись экономики.');
      for (const t of [...Object.values(r.t), ...Object.values(r.payments).map((x) => x.t), ...Object.values(r.stages).map((x) => x.t)]) {
        if (!Number.isSafeInteger(t) || t < 0) throw new Error('Повреждена версия записи экономики.');
        lastStamp = Math.max(lastStamp, t);
      }
      if (r.contractCents != null && (!Number.isSafeInteger(r.contractCents) || r.contractCents < 0)) throw new Error('Повреждена сумма договора.');
      if (r.budget && (!object(r.budget) || Object.entries(r.budget).some(([k, v]) => !safe(k) || !Number.isSafeInteger(v) || v < 0))) throw new Error('Повреждён бюджет.');
      for (const list of ['payments', 'stages']) for (const [k, x] of Object.entries(r[list])) {
        if (!safe(k) || !object(x) || x.id !== k || !Number.isSafeInteger(x.amountCents) || x.amountCents <= 0 || !Number.isSafeInteger(x.date)) throw new Error('Повреждена запись оплаты.');
      }
    }
    return data;
  }

  /** Запись объекта (создаётся при первой правке). */
  function record(data, projectId) {
    if (['__proto__', 'prototype', 'constructor'].includes(projectId)) throw new Error('Неверный идентификатор объекта.');
    if (!Object.prototype.hasOwnProperty.call(data.projects, projectId)) data.projects[projectId] = { t: {}, payments: {}, stages: {} };
    return data.projects[projectId];
  }

  /** Поля договора и бюджета: budget — { статья: копейки }. */
  function setFields(data, projectId, changes) {
    const r = record(data, projectId);
    for (const k of FIELDS) {
      if (!(k in changes)) continue;
      const v = changes[k] === undefined ? null : changes[k];
      if (JSON.stringify(r[k] === undefined ? null : r[k]) === JSON.stringify(v)) continue;
      r[k] = v; r.t[k] = stamp();
    }
    return r;
  }
  /** Поступление от заказчика (видно только собственнику) или этап оплаты по договору. */
  function saveItem(data, projectId, list, item) {
    const r = record(data, projectId);
    const id = item.id || newId();
    r[list][id] = { id, date: item.date, amountCents: item.amountCents, title: String(item.title || '').trim(), deleted: 0, t: stamp() };
    return r[list][id];
  }
  function deleteItem(data, projectId, list, id) {
    const r = record(data, projectId);
    if (r[list][id]) r[list][id] = Object.assign({}, r[list][id], { deleted: 1, t: stamp() });
  }
  const items = (r, list) => Object.values((r && r[list]) || {}).filter((x) => !x.deleted).sort((a, b) => a.date - b.date);

  /** Объединить две версии (две вкладки или два компьютера): по каждому полю и записи побеждает более поздняя. */
  function merge(a, b) {
    if (a) validate(a); if (b) validate(b);
    const out = empty();
    const ids = new Set(Object.keys((a && a.projects) || {}).concat(Object.keys((b && b.projects) || {})));
    for (const id of ids) {
      const x = (a && a.projects[id]) || { t: {}, payments: {}, stages: {} }, y = (b && b.projects[id]) || { t: {}, payments: {}, stages: {} };
      const r = { t: {}, payments: {}, stages: {} };
      for (const k of FIELDS) {
        const tx = (x.t || {})[k] || 0, ty = (y.t || {})[k] || 0;
        const src = ty > tx || (ty === tx && JSON.stringify(y[k]) > JSON.stringify(x[k])) ? y : x;
        if (k in src) { r[k] = src[k]; r.t[k] = Math.max(tx, ty); }
      }
      for (const list of ['payments', 'stages']) {
        const keys = new Set(Object.keys(x[list] || {}).concat(Object.keys(y[list] || {})));
        for (const k of keys) {
          const p = (x[list] || {})[k], q = (y[list] || {})[k];
          r[list][k] = !p ? q : !q ? p : (q.t > p.t || (q.t === p.t && JSON.stringify(q) > JSON.stringify(p)) ? q : p);
        }
      }
      out.projects[id] = r;
    }
    return out;
  }

  const sum = (list, f) => list.reduce((s, x) => s + (f ? f(x) : x), 0);

  /**
   * Расчёт по объекту. P — объект (ProrabModel.Project), r — запись собственника (или undefined), day — сегодня.
   * Деньги — в копейках.
   */
  function summary(P, r, day) {
    r = r || {};
    const finance = P.rows('finance');
    const expenses = finance.filter((f) => f.type !== 'INCOME');
    const spent = sum(expenses, (f) => f.amountCents || 0);
    const byCategory = {};
    expenses.forEach((f) => { const k = f.category || 'OTHER'; byCategory[k] = (byCategory[k] || 0) + (f.amountCents || 0); });
    const incomeShared = sum(finance.filter((f) => f.type === 'INCOME'), (f) => f.amountCents || 0);
    const incomePrivate = sum(items(r, 'payments'), (p) => p.amountCents || 0);
    const received = incomeShared + incomePrivate;

    // Выполнено в деньгах — по ценам ведомости; сдано — по принятым позициям
    const boq = P.boq();
    const prices = Object.fromEntries(P.rows('boq_items').map((i) => [i.id, Number(i.priceCents) || 0]));
    const priced = boq.filter((b) => prices[b.id] > 0);
    const earned = Math.round(sum(priced, (b) => b.fact * prices[b.id]));
    const planValue = Math.round(sum(priced.filter((b) => b.plan !== null), (b) => b.plan * prices[b.id]));
    const acceptances = P.acceptancesCurrent().filter((a) => a.result === 'ACCEPTED');
    const volumes = P.rows('volumes');
    let acceptedValue = 0;
    for (const b of priced) {
      const whole = acceptances.find((a) => !a.entryId && a.itemId === b.id);
      const included = new Set();
      if (whole) {
        const done = volumes.filter((v) => v.itemId === b.id && v.date <= whole.readyDate);
        done.forEach((v) => included.add(v.id));
        acceptedValue += (whole.qty == null ? sum(done, (v) => Number(v.quantity) || 0) : whole.qty) * prices[b.id];
      }
      for (const a of acceptances.filter((a) => a.entryId && a.itemId === b.id && !included.has(a.entryId))) {
        const entry = volumes.find((v) => v.id === a.entryId);
        acceptedValue += (a.qty == null ? (entry ? Number(entry.quantity) || 0 : 0) : a.qty) * prices[b.id];
        included.add(a.entryId);
      }
    }
    const handedOver = Math.round(acceptedValue);
    const withPlan = boq.filter((b) => b.plan > 0);
    const allPriced = withPlan.length > 0 && withPlan.every((b) => prices[b.id] > 0);
    // Extra/unplanned work and overruns on one item cannot finish other items.
    const progress = allPriced ? sum(withPlan, (b) => Math.min(b.plan, Math.max(0, b.fact)) * prices[b.id]) / planValue
      : withPlan.length ? sum(withPlan, (b) => Math.min(1, Math.max(0, b.fact / b.plan))) / withPlan.length : null;

    const contract = Number.isFinite(r.contractCents) ? r.contractCents : null;
    const budgetMap = r.budget || {};
    const budget = Object.keys(budgetMap).length ? sum(Object.values(budgetMap), (v) => v || 0) : null;
    // Прогноз затрат: по темпу (потрачено / готовность), если готовность заметная; иначе — бюджет
    const forecast = progress && progress >= 0.1 ? Math.round(spent / progress) : budget !== null ? Math.max(budget, spent) : null;
    const marginPlan = contract !== null && budget !== null ? contract - budget : null;
    const marginForecast = contract !== null && forecast !== null ? contract - forecast : null;
    const cash = received - spent;
    const workUnpaid = Math.max(0, earned - received);
    const contractLeft = contract !== null ? contract - received : null;
    // Этапы оплат: сколько уже должны были заплатить по графику
    const stagesDue = sum(items(r, 'stages').filter((s) => s.date <= day), (s) => s.amountCents || 0);
    const overdueAmount = sum(items(r, 'stages').filter((s) => s.date < day), (s) => s.amountCents || 0);
    const stagesLate = Math.max(0, overdueAmount - received);
    // A work diary alone does not establish a customer's payment obligation.
    const customerDebt = items(r, 'stages').length ? stagesLate : null;

    const p = P.project;
    let timeShare = null, lag = null;
    if (p.startDate && p.deadline && p.deadline > p.startDate) {
      timeShare = Math.max(0, Math.min(1, (day - p.startDate) / (p.deadline - p.startDate)));
      if (progress !== null) lag = timeShare - progress;
    }
    const today = P.todayView(day);
    const alerts = [];
    if (p.deadline && p.deadline < day && (progress === null || progress < 1)) alerts.push('срок сдачи прошёл');
    else if (lag !== null && lag > 0.1) alerts.push('готовность ниже равномерного темпа на ' + Math.round(lag * 100) + ' п.п.');
    if (budget !== null && spent > budget) alerts.push('перерасход бюджета');
    else if (forecast !== null && budget !== null && forecast > budget * 1.05) alerts.push('прогноз выше бюджета');
    if (stagesLate > 0) alerts.push('заказчик задерживает оплату');
    if (marginForecast !== null && marginForecast < 0) alerts.push('объект в минус');
    if (today.overdueTasks.length) alerts.push('просрочено задач: ' + today.overdueTasks.length);
    if (today.acceptancesPending.length) alerts.push('ждут приёмки: ' + today.acceptancesPending.length);
    if (today.remarksOpen) alerts.push('открытых замечаний: ' + today.remarksOpen);

    return {
      name: p.name || 'Объект', contract, budget, budgetMap, spent, byCategory, received, incomeShared, incomePrivate,
      earned, handedOver, planValue, progress, progressByPrice: allPriced, forecast, marginPlan, marginForecast, cash, customerDebt, contractLeft, workUnpaid,
      stagesDue, stagesLate, timeShare, lag, deadline: p.deadline || null, startDate: p.startDate || null, alerts,
      payments: items(r, 'payments'), stages: items(r, 'stages'), contractNo: r.contractNo || '', contractDate: r.contractDate || null, note: r.note || '',
    };
  }

  /** Итог по всем объектам. */
  function total(list) {
    const add = (k) => (list.some((s) => s[k] !== null) ? sum(list, (s) => s[k] || 0) : null);
    return { contract: add('contract'), budget: add('budget'), spent: add('spent'), received: add('received'), earned: add('earned'),
      customerDebt: add('customerDebt'), marginForecast: add('marginForecast'), cash: add('cash') };
  }

  const api = { empty, validate, record, setFields, saveItem, deleteItem, items, merge, summary, total };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabEconomy = api;
})(typeof window !== 'undefined' ? window : globalThis);
