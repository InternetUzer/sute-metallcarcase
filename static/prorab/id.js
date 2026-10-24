/*
 * «Прораб+» — исполнительная документация: участники строительства и акты освидетельствования скрытых работ (АОСР).
 * Структура акта — по форме АОСР из состава исполнительной документации Минстроя России (приказ № 344/пр);
 * перед использованием сверяйте с действующей редакцией формы.
 * Хранение (в папке объекта на Диске): «Исполнительная документация/участники.json» и «…/АОСР/<id>.json» + документ Word.
 * Без DOM — проверяется тестами в Node.
 */
(function (root) {
  'use strict';

  /** Организации-участники (роль в акте). */
  const ORG_ROLES = [
    ['customer', 'Застройщик или технический заказчик'],
    ['builder', 'Лицо, осуществляющее строительство'],
    ['designer', 'Лицо, осуществляющее подготовку проектной документации'],
    ['performer', 'Лицо, выполнившее работы, подлежащие освидетельствованию'],
  ];
  /** Представители, подписывающие акт. needsNrs — нужен идентификационный номер в национальном реестре специалистов. */
  const REP_ROLES = [
    ['customerControl', 'Представитель застройщика или технического заказчика по вопросам строительного контроля', true],
    ['builder', 'Представитель лица, осуществляющего строительство', false],
    ['builderControl', 'Представитель лица, осуществляющего строительство, по вопросам строительного контроля', true],
    ['designer', 'Представитель лица, осуществляющего подготовку проектной документации', false],
    ['performer', 'Представитель лица, выполнившего работы, подлежащие освидетельствованию', false],
    ['other', 'Иной представитель', false],
  ];
  const roleTitle = (list, k) => (list.find((r) => r[0] === k) || [k, k])[1];

  const emptyParticipants = () => ({ version: 1, orgs: [], reps: [], defaults: {} });
  let seq = 0;
  const stamp = () => Date.now() * 1000 + (seq = (seq + 1) % 1000);
  /** Действующие записи (удалённые хранятся пометкой — чтобы не «воскресали» при объединении версий). */
  const orgs = (d, role) => d.orgs.filter((o) => !o.deleted && (!role || o.role === role));
  const reps = (d, role) => d.reps.filter((r) => !r.deleted && (!role || r.role === role));
  const newId = () => (root.crypto || globalThis.crypto).randomUUID();

  function saveOrg(data, o) {
    const name = String(o.name || '').trim();
    if (!name) throw new Error('Укажите наименование организации или ФИО предпринимателя');
    const row = { id: o.id || newId(), role: o.role, name, ogrn: s(o.ogrn), inn: s(o.inn), address: s(o.address), phone: s(o.phone),
      sro: s(o.sro), sroOgrn: s(o.sroOgrn), sroInn: s(o.sroInn), updatedAt: stamp() };
    if (row.inn && !/^\d{10}(\d{2})?$/.test(row.inn)) throw new Error('ИНН — 10 цифр (организация) или 12 (предприниматель)');
    if (row.ogrn && !/^\d{13}(\d{2})?$/.test(row.ogrn)) throw new Error('ОГРН — 13 цифр (ОГРНИП — 15)');
    data.orgs = data.orgs.filter((x) => x.id !== row.id).concat([row]);
    return row;
  }
  function saveRep(data, r) {
    const fio = String(r.fio || '').trim();
    if (!fio) throw new Error('Укажите фамилию и инициалы');
    const row = { id: r.id || newId(), role: r.role, orgId: r.orgId || null, fio, position: s(r.position), nrs: s(r.nrs), order: s(r.order), updatedAt: stamp() };
    data.reps = data.reps.filter((x) => x.id !== row.id).concat([row]);
    return row;
  }
  const s = (v) => String(v || '').trim();
  const remove = (data, list, id) => { data[list] = data[list].map((x) => (x.id === id ? Object.assign({}, x, { deleted: 1, updatedAt: stamp() }) : x)); };
  const setDefaults = (data, changes) => { data.defaults = Object.assign({}, data.defaults, changes); data.defaultsAt = stamp(); };

  /** Две версии файла участников (два компьютера): по каждой записи — более поздняя. */
  function mergeParticipants(a, b) {
    const pick = (x, y) => {
      const m = new Map();
      for (const r of (x || []).concat(y || [])) { const was = m.get(r.id); if (!was || (r.updatedAt || 0) > (was.updatedAt || 0)) m.set(r.id, r); }
      return Array.from(m.values());
    };
    const dt = ((a && a.defaultsAt) || 0) >= ((b && b.defaultsAt) || 0) ? a : b;
    return { version: 1, orgs: pick(a && a.orgs, b && b.orgs), reps: pick(a && a.reps, b && b.reps), defaults: (dt && dt.defaults) || {}, defaultsAt: (dt && dt.defaultsAt) || 0 };
  }

  const dmy = (d) => { const x = new Date(d * 86400000); const p = (n) => String(n).padStart(2, '0'); return p(x.getUTCDate()) + '.' + p(x.getUTCMonth() + 1) + '.' + x.getUTCFullYear(); };
  const num = (q) => String(Math.round(Number(q) * 1e6) / 1e6).replace('.', ',');
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const longDate = (d) => { const x = new Date(d * 86400000); return '«' + String(x.getUTCDate()).padStart(2, '0') + '» ' + MONTHS[x.getUTCMonth()] + ' ' + x.getUTCFullYear() + ' г.'; };

  /**
   * Черновик акта по позиции ведомости и/или записям журнала за период (P — ProrabModel.Project).
   * Подставляет: работы с объёмом, даты начала и окончания, исполнителя, последующие работы, значения по умолчанию.
   */
  function draft(P, participants, opts) {
    opts = opts || {};
    const names = P.names();
    const item = opts.itemId ? P.get('boq_items', opts.itemId) : null;
    let entries = P.rows('volumes').filter((v) => (opts.entryIds ? opts.entryIds.includes(v.id) : item ? v.itemId === item.id : false));
    if (opts.from !== undefined && opts.from !== null) entries = entries.filter((v) => v.date >= opts.from);
    if (opts.to !== undefined && opts.to !== null) entries = entries.filter((v) => v.date <= opts.to);
    entries.sort((a, b) => a.date - b.date);
    const qty = entries.reduce((sum, v) => sum + (Number(v.quantity) || 0), 0);
    const unit = item ? names.units[item.unitId] || '' : entries[0] ? names.units[entries[0].unitId] || '' : '';
    const title = item ? P.itemName(item.id) : entries[0] ? (entries[0].name || 'Работы') : '';
    const notes = Array.from(new Set(entries.map((v) => s(v.note)).filter(Boolean)));
    const works = title ? title + (qty ? ' — ' + num(qty) + (unit ? ' ' + unit : '') : '') + (notes.length ? ' (' + notes.join('; ') + ')' : '') : '';
    // Последующие работы — следующая позиция ведомости
    let next = '';
    if (item) {
      const list = P.rows('boq_items').sort((a, b) => (a.position || 0) - (b.position || 0));
      const k = list.findIndex((i) => i.id === item.id);
      if (k >= 0 && list[k + 1]) next = P.itemName(list[k + 1].id);
    }
    // Исполнитель: организация «выполнившая работы» с тем же названием, что у исполнителя позиции
    const who = item && item.contractorId ? names.contractors[item.contractorId] : null;
    const performers = orgs(participants, 'performer');
    const performer = (who && performers.find((o) => o.name.toLowerCase() === who.toLowerCase())) || (performers.length === 1 ? performers[0] : null);
    const d = participants.defaults || {};
    const p = P.project;
    return {
      id: null, number: null, date: opts.today, place: d.place || placeOf(p.address), itemId: item ? item.id : null, entryIds: entries.map((v) => v.id),
      works, project: d.project || '', materials: '', documents: d.documents || 'Исполнительная схема', norms: d.norms || '', next,
      start: entries.length ? entries[0].date : null, end: entries.length ? entries[entries.length - 1].date : null,
      extra: '', copies: d.copies || 3, annexes: '', performerId: performer ? performer.id : null, repIds: defaultReps(participants, performer ? performer.id : null), signed: false,
    };
  }
  /** Город из адреса: «г. Казань, ул…» → «г. Казань». */
  function placeOf(address) {
    const part = s(address).split(',').map((x) => x.trim()).find((x) => /^(г\.|город|пос\.|пгт|с\.|д\.|ст-ца)/i.test(x));
    return part || '';
  }
  /** Подписанты по умолчанию: по одному на роль; представитель исполнителя — от выбранной организации. */
  function defaultReps(participants, performerId) {
    const out = [];
    for (const [role] of REP_ROLES) {
      if (role === 'other') continue;
      const list = reps(participants, role).filter((r) => role !== 'performer' || !performerId || r.orgId === performerId);
      if (list.length) out.push(list[0].id);
    }
    return out;
  }

  /** Следующий номер акта на объекте. */
  const nextNumber = (acts) => acts.reduce((m, a) => Math.max(m, parseInt(a.number, 10) || 0), 0) + 1;

  /** Проверка перед формированием: что не заполнено (акт можно сохранить черновиком). */
  function missing(act, participants) {
    const out = [];
    const org = (role) => orgs(participants, role)[0];
    if (!org('customer')) out.push('застройщик или технический заказчик');
    if (!org('builder')) out.push('лицо, осуществляющее строительство');
    if (!s(act.works)) out.push('п. 1 — предъявленные работы');
    if (!s(act.project)) out.push('п. 2 — проектная документация');
    if (!act.start || !act.end) out.push('п. 5 — даты начала и окончания работ');
    if (!s(act.norms)) out.push('п. 6 — нормативы');
    const signers = act.repIds.map((id) => reps(participants).find((r) => r.id === id)).filter(Boolean);
    if (!signers.some((r) => r.role === 'customerControl')) out.push('представитель заказчика по строительному контролю');
    if (!signers.some((r) => r.role === 'builder')) out.push('представитель лица, осуществляющего строительство');
    if (act.start && act.end && act.end < act.start) out.push('дата окончания раньше даты начала');
    return out;
  }

  const orgLine = (o) => (o ? [o.name, o.ogrn ? 'ОГРН ' + o.ogrn : '', o.inn ? 'ИНН ' + o.inn : '', o.address, o.phone ? 'тел. ' + o.phone : '',
    o.sro ? 'СРО: ' + [o.sro, o.sroOgrn ? 'ОГРН ' + o.sroOgrn : '', o.sroInn ? 'ИНН ' + o.sroInn : ''].filter(Boolean).join(', ') : ''].filter(Boolean).join(', ') : '');
  const repLine = (r, org) => (r ? [r.position, r.fio, r.nrs ? 'идентификационный номер в НРС ' + r.nrs : '', r.order, org ? org.name : ''].filter(Boolean).join(', ') : '');

  /** Блоки документа Word по акту (ProrabOffice.richDocx). */
  function blocks(act, participants, project) {
    const org = (role, id) => (id ? orgs(participants).find((o) => o.id === id) : orgs(participants, role)[0]);
    const performer = org('performer', act.performerId);
    const signers = act.repIds.map((id) => reps(participants).find((r) => r.id === id)).filter(Boolean);
    const field = (value, caption) => [
      { p: [{ t: value || ' ', u: !!value }], size: 11, after: 0 },
      { p: [{ t: '(' + caption + ')', i: true, size: 8 }], align: 'center', after: 4 },
    ];
    const out = [];
    out.push({ p: [{ t: 'Объект капитального строительства', b: true }], size: 10, after: 0 });
    out.push(...field([project.name, project.address].filter(Boolean).join(', '), 'наименование, почтовый или строительный адрес объекта капитального строительства'));
    for (const [role, title] of ORG_ROLES) {
      out.push({ p: [{ t: title, b: true }], size: 10, after: 0 });
      out.push(...field(orgLine(role === 'performer' ? performer : org(role)), 'наименование, ОГРН, ИНН, место нахождения, телефон; для членов СРО — наименование, ОГРН, ИНН саморегулируемой организации'));
    }
    out.push({ p: [{ t: 'АКТ', b: true, size: 14 }], align: 'center', before: 8, after: 0 });
    out.push({ p: [{ t: 'освидетельствования скрытых работ', b: true, size: 12 }], align: 'center', after: 4 });
    out.push({ table: [[{ p: ['№ ' + (act.number || '___')], align: 'left' }, { p: [act.place || ''], align: 'center' }, { p: [act.date ? longDate(act.date) : ''], align: 'right' }]], widths: [3400, 3400, 3400] });
    out.push({ p: ['Представители, участвующие в освидетельствовании:'], size: 10, after: 2 });
    for (const [role, title] of REP_ROLES) {
      const list = signers.filter((r) => r.role === role);
      if (!list.length) continue;
      for (const r of list) {
        out.push({ p: [{ t: title, b: true }], size: 10, after: 0 });
        out.push(...field(repLine(r, participants.orgs.find((o) => o.id === r.orgId)), 'должность, фамилия, инициалы' + (REP_ROLES.find((x) => x[0] === role)[2] ? ', идентификационный номер в национальном реестре специалистов в области строительства' : '') + ', реквизиты распорядительного документа, подтверждающего полномочия'));
      }
    }
    out.push({ p: ['произвели осмотр работ, выполненных ', { t: performer ? performer.name : '________________', u: !!performer }], size: 11, after: 0 });
    out.push({ p: [{ t: '(наименование лица, выполнившего работы, подлежащие освидетельствованию)', i: true, size: 8 }], align: 'center', after: 2 });
    out.push({ p: ['и составили настоящий акт о нижеследующем:'], size: 11, after: 4 });
    const item = (n, label, value, caption) => [{ p: [{ t: n + '. ' + label, b: true }], size: 11, after: 0 }, ...field(value, caption)];
    out.push(...item(1, 'К освидетельствованию предъявлены следующие работы:', act.works, 'наименование скрытых работ'));
    out.push(...item(2, 'Работы выполнены по проектной документации:', act.project, 'номер, другие реквизиты чертежа, наименование проектной и (или) рабочей документации, сведения о лицах, осуществляющих подготовку раздела'));
    out.push(...item(3, 'При выполнении работ применены:', act.materials, 'наименование строительных материалов (изделий) со ссылкой на сертификаты или другие документы, подтверждающие их качество и безопасность'));
    out.push(...item(4, 'Предъявлены документы, подтверждающие соответствие работ предъявляемым к ним требованиям:', act.documents, 'исполнительные схемы и чертежи, результаты экспертиз, обследований, лабораторных и иных испытаний выполненных работ'));
    out.push({ p: [{ t: '5. Даты: ', b: true }, 'начала работ ', { t: act.start ? dmy(act.start) : '___________', u: !!act.start }, '   окончания работ ', { t: act.end ? dmy(act.end) : '___________', u: !!act.end }], size: 11, after: 4 });
    out.push(...item(6, 'Работы выполнены в соответствии с:', act.norms, 'наименования и структурные единицы технических регламентов, иных нормативных правовых актов, разделы проектной и (или) рабочей документации'));
    out.push(...item(7, 'Разрешается производство последующих работ:', act.next, 'наименование работ, конструкций, участков сетей инженерно-технического обеспечения'));
    out.push({ p: [{ t: 'Дополнительные сведения: ', b: true }, act.extra || ''], size: 11, after: 2 });
    out.push({ p: ['Акт составлен в ' + (act.copies || 3) + ' экземплярах.'], size: 11, after: 2 });
    out.push({ p: [{ t: 'Приложения: ', b: true }, act.annexes || ''], size: 11, after: 6 });
    // Подписи
    const rows = [];
    for (const [role, title] of REP_ROLES) {
      for (const r of signers.filter((x) => x.role === role)) {
        rows.push([{ p: [{ t: title, size: 9 }] }, { p: [r.fio], align: 'center' }, { p: ['________________'], align: 'center' }]);
        rows.push([{ p: [''] }, { p: [{ t: '(фамилия, инициалы)', i: true, size: 8 }], align: 'center' }, { p: [{ t: '(подпись)', i: true, size: 8 }], align: 'center' }]);
      }
    }
    if (rows.length) out.push({ table: rows, widths: [5200, 2900, 2100] });
    return out;
  }

  /** Строки реестра актов (для Excel). */
  function registry(acts) {
    return acts.slice().sort((a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0)).map((a) => ({
      number: a.number, date: a.date, works: a.works, start: a.start, end: a.end, next: a.next, signed: !!a.signed, file: a.docx || '',
    }));
  }

  /** Имя файла акта: «АОСР №12 от 24.10.2026 — Бетонирование…». */
  function fileName(act) {
    const title = s(act.works).split(/[—(\n]/)[0].trim().slice(0, 60);
    return ('АОСР №' + act.number + ' от ' + (act.date ? dmy(act.date) : '') + (title ? ' — ' + title : '')).replace(/[\\/:*?"<>|]/g, '_').trim() + '.docx';
  }

  const api = { ORG_ROLES, REP_ROLES, roleTitle, emptyParticipants, orgs, reps, setDefaults, saveOrg, saveRep, remove, mergeParticipants, draft, defaultReps, nextNumber, missing, blocks, registry, fileName, placeOf, dmy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabId = api;
})(typeof window !== 'undefined' ? window : globalThis);
