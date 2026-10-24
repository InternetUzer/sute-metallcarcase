/*
 * «Прораб+» — экономика объектов для собственника: договор, бюджет, поступления (данные собственника, шифруются)
 * и расчёт по данным объекта (расходы из «Финансов», выполненное — из ведомости и журнала).
 * Без DOM — проверяется тестами в Node.
 */
(function (root) {
  'use strict';

  let seq = 0;
  const stamp = () => Date.now() * 1000 + (seq = (seq + 1) % 1000);
  const newId = () => (root.crypto || globalThis.crypto).randomUUID();
  const FIELDS = ['contractCents', 'contractNo', 'contractDate', 'budget', 'note', 'name'];

  const empty = () => ({ version: 1, projects: {} });

  /** Запись объекта (создаётся при первой правке). */
  function record(data, projectId) {
    if (!data.projects[projectId]) data.projects[projectId] = { t: {}, payments: {}, stages: {} };
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
    const out = empty();
    const ids = new Set(Object.keys((a && a.projects) || {}).concat(Object.keys((b && b.projects) || {})));
    for (const id of ids) {
      const x = (a && a.projects[id]) || { t: {}, payments: {}, stages: {} }, y = (b && b.projects[id]) || { t: {}, payments: {}, stages: {} };
      const r = { t: {}, payments: {}, stages: {} };
      for (const k of FIELDS) {
        const tx = (x.t || {})[k] || 0, ty = (y.t || {})[k] || 0;
        const src = ty > tx ? y : x;
        if (k in src) { r[k] = src[k]; r.t[k] = Math.max(tx, ty); }
      }
      for (const list of ['payments', 'stages']) {
        const keys = new Set(Object.keys(x[list] || {}).concat(Object.keys(y[list] || {})));
        for (const k of keys) {
          const p = (x[list] || {})[k], q = (y[list] || {})[k];
          r[list][k] = !p ? q : !q ? p : (q.t > p.t ? q : p);
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
    const accepted = new Set(P.acceptancesCurrent().filter((a) => !a.entryId && a.result === 'ACCEPTED').map((a) => a.itemId));
    const handedOver = Math.round(sum(priced.filter((b) => accepted.has(b.id)), (b) => b.fact * prices[b.id]));
    const withPlan = boq.filter((b) => b.plan);
    const progress = planValue > 0 ? Math.min(1, earned / planValue)
      : withPlan.length ? sum(withPlan, (b) => Math.min(1, b.fact / b.plan)) / withPlan.length : null;

    const contract = Number.isFinite(r.contractCents) ? r.contractCents : null;
    const budgetMap = r.budget || {};
    const budget = Object.keys(budgetMap).length ? sum(Object.values(budgetMap), (v) => v || 0) : null;
    // Прогноз затрат: по темпу (потрачено / готовность), если готовность заметная; иначе — бюджет
    const forecast = progress && progress >= 0.1 ? Math.round(spent / progress) : budget !== null ? Math.max(budget, spent) : null;
    const marginPlan = contract !== null && budget !== null ? contract - budget : null;
    const marginForecast = contract !== null && forecast !== null ? contract - forecast : null;
    const cash = received - spent;
    const due = earned > 0 ? Math.min(earned, contract !== null ? contract : earned) : null;
    const customerDebt = due !== null ? Math.max(0, due - received) : null;
    const contractLeft = contract !== null ? contract - received : null;
    // Этапы оплат: сколько уже должны были заплатить по графику
    const stagesDue = sum(items(r, 'stages').filter((s) => s.date <= day), (s) => s.amountCents || 0);
    const stagesLate = stagesDue > received ? stagesDue - received : 0;

    const p = P.project;
    let timeShare = null, lag = null;
    if (p.startDate && p.deadline && p.deadline > p.startDate) {
      timeShare = Math.max(0, Math.min(1, (day - p.startDate) / (p.deadline - p.startDate)));
      if (progress !== null) lag = timeShare - progress;
    }
    const today = P.todayView(day);
    const alerts = [];
    if (p.deadline && p.deadline < day && (progress === null || progress < 1)) alerts.push('срок сдачи прошёл');
    else if (lag !== null && lag > 0.1) alerts.push('отставание от графика ' + Math.round(lag * 100) + '%');
    if (budget !== null && spent > budget) alerts.push('перерасход бюджета');
    else if (forecast !== null && budget !== null && forecast > budget * 1.05) alerts.push('прогноз выше бюджета');
    if (stagesLate > 0) alerts.push('заказчик задерживает оплату');
    if (marginForecast !== null && marginForecast < 0) alerts.push('объект в минус');
    if (today.overdueTasks.length) alerts.push('просрочено задач: ' + today.overdueTasks.length);
    if (today.acceptancesPending.length) alerts.push('ждут приёмки: ' + today.acceptancesPending.length);
    if (today.remarksOpen) alerts.push('открытых замечаний: ' + today.remarksOpen);

    return {
      name: p.name || 'Объект', contract, budget, budgetMap, spent, byCategory, received, incomeShared, incomePrivate,
      earned, handedOver, planValue, progress, forecast, marginPlan, marginForecast, cash, customerDebt, contractLeft,
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

  const api = { empty, record, setFields, saveItem, deleteItem, items, merge, summary, total };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabEconomy = api;
})(typeof window !== 'undefined' ? window : globalThis);
