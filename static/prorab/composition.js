/*
 * «Прораб+» — состав объекта в кабинете: конструкции (project_nodes) и привязанные к ним работы
 * (work_bindings → позиции ведомости boq_items). Правила — как в приложении (CompositionTree.kt,
 * PlanningRepository.kt, WorkSelection.kt):
 *  - работа — это позиция ведомости; привязка хранит конструкцию, шаблон и его снимок, одна на позицию;
 *  - позиции с историей (есть «Сделано», приёмка, согласование доп. работы или «Закончено») не меняются
 *    и не удаляются из состава;
 *  - нельзя выбрать одну операцию дважды на одном участке конструкции и смешать «комплекс» с отдельными
 *    операциями одной группы;
 *  - вид конструкции после создания не меняется; удалённая конструкция уходит в архив.
 * Без DOM — проверяется тестами в Node.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const S = isNode ? require('./sync.js') : root.ProrabSync;
  const LIB = isNode ? require('./work-templates.js') : root.PRORAB_WORK_TEMPLATES;

  const WHOLE = 'whole';
  const OTHER = '_other';
  const ARCHIVED = '_archived';
  const MAX_QTY = 1e12;
  const MAX_CENTS = 100000000000000;

  class Catalog {
    constructor(data) {
      this.version = data.version; this.units = data.units; this.categories = data.categories;
      this.nodeKinds = data.nodeKinds; this.templates = data.templates;
      this.kindByKey = new Map(this.nodeKinds.map((k) => [k.key, k]));
      this.byKey = new Map(this.templates.map((t) => [t.key, t]));
    }
    nodeKind(key) { return this.kindByKey.get(key) || null; }
    template(key) { return this.byKey.get(key) || null; }
    category(key) { return this.categories.find((c) => c.key === key) || null; }
    offeredKinds(category) { return this.nodeKinds.filter((k) => k.category === category && !k.retired); }
    offeredFor(kind) { return this.templates.filter((t) => t.nodeKinds.includes(kind) && !t.retired); }
    unitName(code) { return this.units[code] || null; }
  }
  const catalog = new Catalog(LIB);

  const normalizeName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  /** Название позиции ведомости: «Бетонирование — Ф1» (+ участок, если не вся конструкция). */
  const workItemName = (title, label, segment) => title + ' — ' + String(label).trim() + (segment === WHOLE ? '' : ' (' + String(segment).trim() + ')');
  /** Снимок шаблона для привязки (поля и порядок — как WorkTemplate.snapshotJson в приложении). */
  const snapshot = (t) => JSON.stringify({ key: t.key, revision: t.revision, category: t.category, title: t.title, unitCode: t.unitCode,
    alternativeGroup: t.alternativeGroup || null, variantMode: t.variantMode || null });

  /** Позиции с историей — как itemsWithHistory в приложении. */
  function historyOf(P) {
    const out = new Set();
    P.rows('volumes').forEach((v) => { if (v.itemId) out.add(v.itemId); });
    P.rows('acceptances').forEach((a) => { if (a.itemId) out.add(a.itemId); });
    P.rows('extra_approvals').forEach((a) => { if (a.itemId) out.add(a.itemId); });
    P.rows('boq_items').forEach((i) => { if (i.finishedDate !== null && i.finishedDate !== undefined) out.add(i.id); });
    return out;
  }

  /** Действующие привязки: на не удалённые позиции этого объекта. */
  function bindings(P) {
    const items = new Set(P.rows('boq_items').map((i) => i.id));
    return P.rows('work_bindings').filter((b) => items.has(b.itemId));
  }
  const nodes = (P) => P.rows('project_nodes').sort((a, b) => (a.position || 0) - (b.position || 0) || String(a.label).toLowerCase().localeCompare(String(b.label).toLowerCase()));

  /** Работы для дерева: план, факт, цена, приёмка всей позиции, срок. */
  function treeWorks(P) {
    const names = P.names();
    const fact = {};
    P.rows('volumes').forEach((v) => { if (v.itemId) fact[v.itemId] = (fact[v.itemId] || 0) + (Number(v.quantity) || 0); });
    const accept = {};
    P.acceptancesCurrent().filter((a) => !a.entryId).forEach((a) => { accept[a.itemId] = a.result; });
    const history = historyOf(P);
    return bindings(P).map((b) => {
      const i = P.get('boq_items', b.itemId);
      return {
        itemId: i.id, nodeId: b.nodeId, title: String(i.name || '').trim() || 'Без названия', unit: names.units[i.unitId] || '',
        plan: i.planQty === null || i.planQty === undefined ? null : Number(i.planQty), fact: Math.round((fact[i.id] || 0) * 1e6) / 1e6,
        priceCents: i.priceCents === null || i.priceCents === undefined ? null : Number(i.priceCents),
        finished: i.finishedDate !== null && i.finishedDate !== undefined, due: i.dueDate || null,
        accept: ['PENDING', 'ACCEPTED', 'REJECTED'].includes(accept[i.id]) ? accept[i.id] : null,
        templateKey: b.templateKey, segmentKey: b.segmentKey || WHOLE, history: history.has(i.id),
      };
    });
  }
  const done = (w) => (w.plan > 0 ? Math.min(w.fact / w.plan, 1) : null);

  /** Итоги ветки — как CompositionTree.stats. */
  function stats(works) {
    const withPlan = works.filter((w) => done(w) !== null);
    const priced = withPlan.filter((w) => w.priceCents !== null);
    const planCostPriced = priced.reduce((s, w) => s + Math.round(w.plan * w.priceCents), 0);
    let percent = null, byCost = false;
    if (planCostPriced > 0) { percent = priced.reduce((s, w) => s + done(w) * w.plan * w.priceCents, 0) / planCostPriced * 100; byCost = true; }
    else if (withPlan.length) percent = withPlan.reduce((s, w) => s + done(w), 0) / withPlan.length * 100;
    return {
      works: works.length, percent, byCost,
      planCost: works.filter((w) => w.plan !== null && w.priceCents !== null).reduce((s, w) => s + Math.round(w.plan * w.priceCents), 0),
      unpriced: works.filter((w) => w.priceCents === null).length,
      pending: works.filter((w) => w.accept === 'PENDING').length,
      rejected: works.filter((w) => w.accept === 'REJECTED').length,
    };
  }
  const allWorks = (b) => b.works.concat(...b.children.map(allWorks));

  /** Дерево: раздел → группа видов → конструкция (с вложенными) → работы; как CompositionTree.build. */
  function tree(P) {
    const ns = nodes(P), works = treeWorks(P);
    const ids = new Set(ns.map((n) => n.id));
    const byId = new Map(ns.map((n) => [n.id, n]));
    const parentOf = (n) => (n.parentId && ids.has(n.parentId) && n.parentId !== n.id ? n.parentId : null);
    const cyclic = (n) => { const seen = new Set(); let p = parentOf(n); while (p) { if (seen.has(p) || p === n.id) return true; seen.add(p); p = byId.has(p) ? parentOf(byId.get(p)) : null; } return false; };
    const top = (n) => parentOf(n) === null || cyclic(n);
    const kids = new Map();
    ns.filter((n) => !top(n)).forEach((n) => { const p = parentOf(n); if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n); });
    const worksOf = new Map();
    works.forEach((w) => { if (!worksOf.has(w.nodeId)) worksOf.set(w.nodeId, []); worksOf.get(w.nodeId).push(w); });
    function branch(n, path) {
      const children = (kids.get(n.id) || []).filter((k) => !path.has(k.id)).map((k) => branch(k, new Set([...path, n.id])));
      const own = worksOf.get(n.id) || [];
      const kind = catalog.nodeKind(n.kind);
      return { id: 'n:' + n.id, nodeId: n.id, level: 'NODE', title: n.label, subtitle: kind ? kind.title : n.kind, location: n.location || '', kind: n.kind,
        children, works: own, stats: stats(own.concat(...children.map(allWorks))) };
    }
    const out = [];
    const catKeys = catalog.categories.map((c) => c.key);
    const kindOrder = catalog.nodeKinds.map((k) => k.key);
    const tops = ns.filter(top);
    for (const cat of catKeys.concat([OTHER])) {
      const list = tops.filter((n) => { const k = catalog.nodeKind(n.kind); return (k && catKeys.includes(k.category) ? k.category : OTHER) === cat; });
      const orphans = cat === OTHER ? works.filter((w) => !ids.has(w.nodeId)) : [];
      if (!list.length && !orphans.length) continue;
      const groups = new Map();
      list.forEach((n) => { const g = (catalog.nodeKind(n.kind) || {}).group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(n); });
      const rank = (n) => { const i = kindOrder.indexOf(n.kind); return i < 0 ? Infinity : i; };
      const children = [];
      Array.from(groups.entries()).sort((a, b) => Math.min(...a[1].map(rank)) - Math.min(...b[1].map(rank))).forEach(([g, gs]) => {
        const bs = gs.map((n) => branch(n, new Set()));
        if (!g) children.push(...bs);
        else children.push({ id: 'g:' + cat + ':' + g, level: 'GROUP', title: g, subtitle: null, children: bs, works: [], stats: stats([].concat(...bs.map(allWorks))) });
      });
      if (orphans.length) children.push({ id: 'n:' + ARCHIVED, level: 'NODE', title: 'Конструкция в архиве', subtitle: null, archived: true, children: [], works: orphans, stats: stats(orphans) });
      const c = catalog.category(cat);
      out.push({ id: 'c:' + cat, level: 'CATEGORY', title: c ? c.title : 'Прочее', subtitle: null, children, works: [], stats: stats([].concat(...children.map(allWorks))) });
    }
    return out;
  }

  /** Сколько позиций ведомости не привязано к составу. */
  function unboundCount(P) {
    const bound = new Set(bindings(P).map((b) => b.itemId));
    return P.rows('boq_items').filter((i) => !bound.has(i.id)).length;
  }

  // ───────── правка ─────────
  const fail = (m) => { throw new Error(m); };

  function checkParent(P, id, parentId) {
    if (!parentId) return null;
    if (!P.get('project_nodes', parentId) || Number(P.get('project_nodes', parentId).deleted)) fail('Конструкция, в которую вкладываете, не найдена');
    let cur = parentId; const seen = new Set();
    while (cur) {
      if (cur === id || seen.has(cur)) fail('Нельзя вложить конструкцию саму в себя');
      seen.add(cur);
      const p = P.get('project_nodes', cur); cur = p && !Number(p.deleted) ? p.parentId : null;
    }
    return parentId;
  }

  /** Новая конструкция: n — { kind, label, location, parentId }. */
  function addNode(P, n) {
    const kind = catalog.nodeKind(n.kind);
    if (!kind) fail('Неизвестный вид конструкции');
    if (kind.retired) fail('Этот вид конструкции больше не предлагается');
    const label = String(n.label || '').trim();
    if (!label) fail('Укажите название конструкции, например «Ф1» или «Каркас пролёта 1»');
    const id = S.newId();
    const parentId = checkParent(P, id, n.parentId || null);
    const position = P.rows('project_nodes', true).reduce((m, x) => Math.max(m, (x.position || 0) + 1), 0);
    return P.put('project_nodes', id, { projectId: P.projectId, parentId, kind: kind.key, label: label.slice(0, 120), location: String(n.location || '').trim().slice(0, 200), position, deleted: 0 });
  }

  /**
   * Изменить конструкцию (название, место, вложенность; вид не меняется). При новом названии
   * автоназвания позиций без истории следуют за ним — как в приложении.
   */
  function updateNode(P, id, c) {
    const cur = P.get('project_nodes', id);
    if (!cur || Number(cur.deleted)) fail('Конструкция не найдена');
    const old = Object.assign({}, cur); // P.put меняет ту же запись — прежнее название нужно сохранить заранее
    const changes = {};
    if (c.label !== undefined) {
      const label = String(c.label || '').trim();
      if (!label) fail('Название конструкции не может быть пустым');
      changes.label = label.slice(0, 120);
    }
    if (c.location !== undefined) changes.location = String(c.location || '').trim().slice(0, 200);
    if (c.parentId !== undefined) changes.parentId = checkParent(P, id, c.parentId || null);
    const saved = P.put('project_nodes', id, changes);
    if (changes.label !== undefined && changes.label !== old.label) {
      const history = historyOf(P);
      bindings(P).filter((b) => b.nodeId === id && !history.has(b.itemId)).forEach((b) => {
        let title = null;
        try { title = JSON.parse(b.templateSnapshotJson).title; } catch (_) { return; }
        const item = P.get('boq_items', b.itemId);
        if (title && item.name === workItemName(title, old.label, b.segmentKey || WHOLE)) P.put('boq_items', item.id, { name: workItemName(title, changes.label, b.segmentKey || WHOLE) });
      });
    }
    return saved;
  }

  /** Убрать конструкцию: только без вложенных и без работ, которые можно убрать; работы с историей остаются (в архиве). */
  function archiveNode(P, id) {
    const n = P.get('project_nodes', id);
    if (!n || Number(n.deleted)) fail('Конструкция не найдена');
    if (P.rows('project_nodes').some((x) => x.parentId === id)) fail('Сначала уберите или перенесите вложенные конструкции');
    const history = historyOf(P);
    const free = bindings(P).filter((b) => b.nodeId === id && !history.has(b.itemId));
    if (free.length) fail('Сначала уберите работы этой конструкции (' + free.length + '). Работы с записями «Сделано» или приёмкой останутся в архиве.');
    return P.put('project_nodes', id, { deleted: 1 });
  }

  function parseQty(q) {
    if (q === null || q === undefined || q === '') return null;
    const v = Number(q);
    if (!Number.isFinite(v) || v < 0 || v > MAX_QTY) fail('Объём должен быть числом от 0 до 1 000 000 000 000');
    return v;
  }
  function parseCents(c) {
    if (c === null || c === undefined || c === '') return null;
    const v = Number(c);
    if (!Number.isSafeInteger(v) || v < 0 || v > MAX_CENTS) fail('Недопустимая цена');
    return v;
  }

  /** Что уже выбрано на конструкции: участок → шаблоны и варианты групп. */
  function chosen(P, nodeId) {
    return bindings(P).filter((b) => b.nodeId === nodeId).map((b) => ({ templateKey: b.templateKey, segmentKey: b.segmentKey || WHOLE, alternativeGroup: b.alternativeGroup || null, variantMode: b.variantMode || null }));
  }

  /**
   * Добавить работы к конструкции: list — [{ templateKey, quantity, priceCents }], segment — участок
   * («whole» — вся конструкция). Сначала всё проверяется, потом пишется — ничего не записывается наполовину.
   */
  function addWorks(P, nodeId, list, segment) {
    const node = P.get('project_nodes', nodeId);
    if (!node || Number(node.deleted)) fail('Конструкция не найдена');
    if (!list.length) fail('Отметьте хотя бы одну работу');
    const seg = String(segment || '').trim() || WHOLE;
    if (seg.length > 80) fail('Слишком длинное название участка');
    const have = chosen(P, nodeId).filter((w) => w.segmentKey === seg);
    const plan = list.map((x) => {
      const t = catalog.template(x.templateKey);
      if (!t) fail('Неизвестная операция');
      if (t.retired) fail('Операция «' + t.title + '» больше не предлагается');
      if (!t.nodeKinds.includes(node.kind)) fail('Операция «' + t.title + '» не относится к этому виду конструкции');
      if (!catalog.category(t.category) || !catalog.unitName(t.unitCode)) fail('В библиотеке нет раздела или единицы для «' + t.title + '»');
      return { t, quantity: parseQty(x.quantity), priceCents: parseCents(x.priceCents) };
    });
    const all = have.concat(plan.map((p) => ({ templateKey: p.t.key, alternativeGroup: p.t.alternativeGroup || null, variantMode: p.t.variantMode || null })));
    const keys = all.map((w) => w.templateKey);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) fail('Операция «' + catalog.template(dup).title + '» уже выбрана на ' + (seg === WHOLE ? 'этой конструкции' : 'участке «' + seg + '»'));
    const groups = {};
    all.filter((w) => w.alternativeGroup).forEach((w) => { (groups[w.alternativeGroup] = groups[w.alternativeGroup] || new Set()).add(w.variantMode); });
    if (Object.values(groups).some((s) => s.size > 1)) fail('Нельзя выбрать одновременно комплекс и отдельные операции одной группы: выберите что-то одно');

    const named = (table, name) => P.rows(table).find((r) => normalizeName(r.name) === normalizeName(name)) || P.put(table, S.newId(), { projectId: P.projectId, name, deleted: 0 });
    let position = P.rows('boq_items', true).reduce((m, r) => Math.max(m, r.position || 0), 0);
    return plan.map(({ t, quantity, priceCents }) => {
      const id = S.newId();
      P.put('boq_items', id, {
        projectId: P.projectId, workTypeId: named('work_types', catalog.category(t.category).workType).id, name: workItemName(t.title, node.label, seg),
        unitId: named('units', catalog.unitName(t.unitCode)).id, planQty: quantity, priceCents, position: ++position, deleted: 0,
      });
      P.put('work_bindings', id, {
        itemId: id, nodeId, templateKey: t.key, templateRevision: t.revision, templateSnapshotJson: snapshot(t), segmentKey: seg,
        alternativeGroup: t.alternativeGroup || null, variantMode: t.variantMode || null, projectId: P.projectId, deleted: 0,
      });
      return id;
    });
  }

  /** Объём и цена работы из состава: только без истории (как в приложении; с историей — правится в ведомости). */
  function updateWork(P, itemId, c) {
    if (historyOf(P).has(itemId)) fail('По работе уже есть записи «Сделано» или приёмка — её объём и цена меняются в ведомости');
    if (!bindings(P).some((b) => b.itemId === itemId)) fail('Работа не найдена в составе');
    const changes = {};
    if (c.quantity !== undefined) changes.planQty = parseQty(c.quantity);
    if (c.priceCents !== undefined) changes.priceCents = parseCents(c.priceCents);
    return P.put('boq_items', itemId, changes);
  }

  /** Убрать работу из состава и ведомости: только без истории. */
  function removeWork(P, itemId) {
    if (historyOf(P).has(itemId)) fail('По работе уже есть записи «Сделано», приёмка или «Закончено» — её нельзя убрать, она останется в ведомости');
    if (!bindings(P).some((b) => b.itemId === itemId)) fail('Работа не найдена в составе');
    P.put('boq_items', itemId, { deleted: 1 });
    P.put('work_bindings', itemId, { deleted: 1 });
  }

  const api = { WHOLE, catalog, Catalog, workItemName, snapshot, normalizeName, historyOf, bindings, nodes, treeWorks, stats, tree, allWorks, unboundCount,
    addNode, updateNode, archiveNode, addWorks, updateWork, removeWork, chosen };
  if (isNode) module.exports = api;
  else root.ProrabComposition = api;
})(typeof window !== 'undefined' ? window : globalThis);
