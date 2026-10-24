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
  let clock = 0;
  const stamp = () => (clock = Math.max(Date.now() * 1000, clock + 1));
  function validateParticipants(d) {
    if (!d || d.version !== 1 || !Array.isArray(d.orgs) || !Array.isArray(d.reps) || !d.defaults || typeof d.defaults !== 'object' || Array.isArray(d.defaults)) throw new Error('Повреждён файл участников. Запись остановлена, прежний файл сохранён.');
    for (const rows of [d.orgs, d.reps]) {
      const ids = new Set();
      for (const r of rows) {
        if (!r || typeof r.id !== 'string' || ids.has(r.id) || !Number.isSafeInteger(r.updatedAt) || r.updatedAt < 0) throw new Error('Повреждены записи участников. Запись остановлена.');
        ids.add(r.id); clock = Math.max(clock, r.updatedAt);
      }
    }
    if (d.defaultsAt !== undefined) {
      if (!Number.isSafeInteger(d.defaultsAt) || d.defaultsAt < 0) throw new Error('Повреждены настройки участников.');
      clock = Math.max(clock, d.defaultsAt);
    }
    return d;
  }
  /** Действующие записи (удалённые хранятся пометкой — чтобы не «воскресали» при объединении версий). */
  const orgs = (d, role) => d.orgs.filter((o) => !o.deleted && (!role || o.role === role));
  const reps = (d, role) => d.reps.filter((r) => !r.deleted && (!role || r.role === role));
  const newId = () => (root.crypto || globalThis.crypto).randomUUID();

  function saveOrg(data, o) {
    const name = String(o.name || '').trim();
    if (!name) throw new Error('Укажите наименование организации или ФИО предпринимателя');
    const row = { id: o.id || newId(), role: o.role, name, ogrn: s(o.ogrn), inn: s(o.inn), address: s(o.address), phone: s(o.phone),
      sro: s(o.sro), sroOgrn: s(o.sroOgrn), sroInn: s(o.sroInn), okpo: s(o.okpo), updatedAt: stamp() };
    if (row.inn && !/^\d{10}(\d{2})?$/.test(row.inn)) throw new Error('ИНН — 10 цифр (организация) или 12 (предприниматель)');
    if (row.ogrn && !/^\d{13}(\d{2})?$/.test(row.ogrn)) throw new Error('ОГРН — 13 цифр (ОГРНИП — 15)');
    if (row.okpo && !/^\d{8}(\d{2})?$/.test(row.okpo)) throw new Error('ОКПО — 8 цифр (у предпринимателя — 10)');
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
    const title = entries.length ? (item ? P.itemName(item.id) : entries[0].name || 'Работы') : '';
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
      works, project: d.project || '', materials: '', documents: d.documents || '', norms: d.norms || '', next,
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
      { p: [{ t: value || ' ', u: !!value }], size: 11, after: 0, keepNext: true },
      { p: [{ t: '(' + caption + ')', i: true, size: 8 }], align: 'center', after: 4 },
    ];
    const out = [];
    out.push({ p: [{ t: 'Объект капитального строительства', b: true }], size: 10, after: 0, keepNext: true });
    out.push(...field([project.name, project.address].filter(Boolean).join(', '), 'наименование, почтовый или строительный адрес объекта капитального строительства'));
    for (const [role, title] of ORG_ROLES) {
      out.push({ p: [{ t: title, b: true }], size: 10, after: 0, keepNext: true });
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
        out.push({ p: [{ t: title, b: true }], size: 10, after: 0, keepNext: true });
        out.push(...field(repLine(r, participants.orgs.find((o) => o.id === r.orgId)), 'должность, фамилия, инициалы' + (REP_ROLES.find((x) => x[0] === role)[2] ? ', идентификационный номер в национальном реестре специалистов в области строительства' : '') + ', реквизиты распорядительного документа, подтверждающего полномочия'));
      }
    }
    out.push({ p: ['произвели осмотр работ, выполненных ', { t: performer ? performer.name : '________________', u: !!performer }], size: 11, after: 0 });
    out.push({ p: [{ t: '(наименование лица, выполнившего работы, подлежащие освидетельствованию)', i: true, size: 8 }], align: 'center', after: 2 });
    out.push({ p: ['и составили настоящий акт о нижеследующем:'], size: 11, after: 4 });
    const item = (n, label, value, caption) => [{ p: [{ t: n + '. ' + label, b: true }], size: 11, after: 0, keepNext: true }, ...field(value, caption)];
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

  // ───────── общий журнал работ ─────────
  const weatherLine = (w) => {
    if (!w) return '';
    const t = [w.tMin, w.tMax].every((v) => v !== null && v !== undefined) ? Math.round(w.tMin) + '…' + Math.round(w.tMax) + ' °C' : '';
    return [t, w.precip ? 'осадки ' + num(Math.round(w.precip * 10) / 10) + ' мм' : 'без осадков', w.wind ? 'ветер до ' + Math.round(w.wind) + ' м/с' : ''].filter(Boolean).join(', ');
  };

  /** Строки раздела 3 — по дням журнала: работы с объёмами и местом, погода, исполнители. */
  function ojrWorkRows(P, from, to) {
    return P.days(from, to).filter((d) => d.works.length).sort((a, b) => a.day - b.day).map((d) => ({
      day: d.day,
      works: d.works.map((x) => x.title + (x.qty ? ' — ' + num(x.qty) + (x.unit ? ' ' + x.unit : '') : '') + (x.note ? ' (' + x.note + ')' : '')).join(';\n'),
      weather: weatherLine(d.weather),
      who: Array.from(new Set(d.works.map((x) => x.who).filter(Boolean))).join(', '),
      people: d.people.reduce((sum, x) => sum + (Number(x.people) || 0), 0),
    }));
  }

  /** Строки раздела 4 — замечания строительного контроля (журнал замечаний и пометки на чертежах). */
  function ojrControlRows(P, from, to) {
    const ok = (d) => (from === null || from === undefined || d >= from) && (to === null || to === undefined || d <= to);
    const names = P.names();
    const rows = P.remarks().filter((r) => ok(r.date)).map((r) => ({
      day: r.date, text: (r.text || '') + (r.place ? ' (' + r.place + ')' : ''), due: r.dueDate || null, done: r.status === 'DONE' ? r.doneDate || null : null,
      doneNote: r.doneNote || '', who: names.contractors[r.contractorId] || '',
    }));
    const drawings = Object.fromEntries(P.drawings().map((x) => [x.id, x.name]));
    for (const n of P.rows('drawing_notes')) {
      if (drawings[n.drawingId] === undefined) continue;
      const day = Math.floor((n.createdAt || 0) / 86400000);
      if (!ok(day)) continue;
      rows.push({ day, text: (n.text || '') + ' (чертёж «' + drawings[n.drawingId] + '», пометка № ' + n.number + ')', due: n.dueDate || null, done: n.status === 'DONE' ? n.doneDate || null : null, doneNote: '', who: names.contractors[n.contractorId] || '' });
    }
    return rows.sort((a, b) => a.day - b.day);
  }

  /**
   * Общий журнал работ: титульный лист и разделы 1–6 (по принятой структуре общего журнала; форму сверять
   * с действующей редакцией приказа Минстроя России № 1026/пр). opts: { from, to, today, settings, acts }.
   * settings: { number, permit, expertise, journals: [{ name, keeper, date }] }.
   */
  function ojrBlocks(P, participants, opts) {
    const st = opts.settings || {};
    const p = P.project;
    const org = (role) => orgs(participants, role)[0] || null;
    const out = [];
    const line = (label, value) => out.push({ p: [{ t: label + ': ', b: true }, { t: value || '________________________________', u: !!value }], size: 11, after: 4 });
    out.push({ p: [{ t: 'ОБЩИЙ ЖУРНАЛ № ' + (st.number || '____'), b: true, size: 16 }], align: 'center', before: 24, after: 2 });
    out.push({ p: [{ t: 'учёта выполнения работ при строительстве, реконструкции, капитальном ремонте объекта капитального строительства', b: true, size: 12 }], align: 'center', after: 14 });
    line('Объект капитального строительства', p.name);
    line('Почтовый или строительный адрес', p.address);
    line('Застройщик (технический заказчик)', orgLine(org('customer')));
    line('Лицо, осуществляющее строительство', orgLine(org('builder')));
    line('Лицо, осуществляющее подготовку проектной документации', orgLine(org('designer')));
    line('Разрешение на строительство', st.permit);
    line('Заключение экспертизы проектной документации', st.expertise);
    const ctrl = reps(participants, 'customerControl').map((r) => repLine(r, participants.orgs.find((o) => o.id === r.orgId))).join('; ');
    line('Строительный контроль застройщика (технического заказчика)', ctrl);
    line('Начало строительства', p.startDate ? dmy(p.startDate) : '');
    line('Окончание строительства', p.deadline ? dmy(p.deadline) + ' (по плану)' : '');
    line('Журнал сформирован за период', (opts.from ? 'с ' + dmy(opts.from) : 'с начала') + ' по ' + dmy(opts.to || opts.today));
    out.push({ p: ['В настоящем журнале ____ страниц, прошнуровано и пронумеровано.'], size: 11, before: 10 });
    const head = (n, title) => { out.push({ pageBreak: true }); out.push({ p: [{ t: 'Раздел ' + n + '. ' + title, b: true, size: 12 }], align: 'center', after: 6 }); };
    const table = (cols, widths, rows, empty) => out.push({ header: true, borders: true, widths,
      table: [cols.map((c) => ({ p: [{ t: c, b: true, size: 9 }], align: 'center' }))].concat(rows.length ? rows.map((r) => r.map((c) => ({ p: [{ t: c === null || c === undefined ? '' : String(c), size: 9 }] })))
        : Array.from({ length: empty || 3 }, () => cols.map(() => ({ p: [' '] })))) });

    head(1, 'Список инженерно-технического персонала лица, осуществляющего строительство, занятого при строительстве объекта капитального строительства');
    const staff = ['builder', 'builderControl', 'performer'].flatMap((role) => reps(participants, role)).map((r, i) => {
      const o = participants.orgs.find((x) => x.id === r.orgId) || org('builder') || {};
      return [i + 1, o.name || '', r.fio + (r.nrs ? ', НРС ' + r.nrs : ''), r.position || '', roleTitle(REP_ROLES, r.role), '', '', r.order || ''];
    });
    table(['№ п/п', 'Наименование лица, осуществляющего строительство (подрядчика)', 'Фамилия, инициалы, идентификационный номер в НРС', 'Должность', 'Роль на объекте', 'Дата начала работ на объекте', 'Дата окончания работ', 'Документ о полномочиях'],
      [700, 2700, 2700, 1800, 2400, 1300, 1300, 2000], staff);

    head(2, 'Перечень специальных журналов, в которых ведётся учёт выполнения работ, а также журналов авторского надзора');
    table(['№ п/п', 'Наименование специального журнала (журнала авторского надзора)', 'Кто ведёт журнал (наименование, ФИО, должность)', 'Дата передачи застройщику'],
      [700, 6200, 5800, 2200], (st.journals || []).map((j, i) => [i + 1, j.name, j.keeper, j.date ? dmy(j.date) : '']));

    head(3, 'Сведения о выполнении работ в процессе строительства объекта капитального строительства');
    const works = ojrWorkRows(P, opts.from, opts.to);
    table(['№ п/п', 'Дата выполнения работ', 'Наименование работ, их объём и место выполнения', 'Условия производства работ (погода)', 'Исполнитель работ', 'Людей на объекте', 'Представитель лица, осуществляющего строительство (ФИО, подпись)'],
      [700, 1300, 6000, 2200, 2100, 1000, 1600], works.map((r, i) => [i + 1, dmy(r.day), r.works, r.weather, r.who, r.people || '', '']), 5);

    head(4, 'Сведения о строительном контроле в процессе строительства');
    const ctrlRows = ojrControlRows(P, opts.from, opts.to);
    table(['№ п/п', 'Дата', 'Выявленные недостатки и замечания', 'Кто устраняет', 'Срок устранения', 'Дата устранения, что сделано', 'Представитель строительного контроля (ФИО, подпись)'],
      [700, 1300, 5200, 2100, 1400, 2400, 1800], ctrlRows.map((r, i) => [i + 1, dmy(r.day), r.text, r.who, r.due ? dmy(r.due) : '', r.done ? dmy(r.done) + (r.doneNote ? ' — ' + r.doneNote : '') : '', '']), 5);

    head(5, 'Перечень исполнительной документации');
    const acts = registry(opts.acts || []).filter((a) => (!opts.from || !a.date || a.date >= opts.from) && (!opts.to || !a.date || a.date <= opts.to));
    table(['№ п/п', 'Наименование исполнительной документации', 'Дата подписания', 'Отметка о подписании', 'Примечание'],
      [700, 8200, 1800, 1800, 2400], acts.map((a, i) => [i + 1, 'Акт освидетельствования скрытых работ № ' + a.number + ': ' + String(a.works || '').split('\n')[0], a.signed && a.date ? dmy(a.date) : '', a.signed ? 'подписан' : 'не подписан', a.next ? 'далее: ' + a.next : '']), 3);

    head(6, 'Сведения о государственном строительном надзоре при строительстве объекта капитального строительства');
    table(['№ п/п', 'Дата проверки', 'Сведения о проверке, выявленные нарушения', 'Срок устранения', 'Должностное лицо органа государственного строительного надзора (ФИО, подпись)'],
      [700, 1500, 7200, 1800, 3700], [], 6);
    return out;
  }

  // ───────── КС-2 и КС-3 ─────────
  /** Деньги: копейки → «1 234 567,89». */
  const rub = (cents) => (Math.round(cents) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u00a0/g, ' ');
  /** Сумма в копейках: количество × цена (копейки), с округлением до копейки. */
  const cost = (qty, priceCents) => {
    const units = Math.round(Number(qty) * 1e6), price = Number(priceCents);
    if (!Number.isSafeInteger(units) || !Number.isSafeInteger(price) || price < 0) throw new Error('Недопустимые объём или цена в ведомости.');
    const n = BigInt(units) * BigInt(price);
    const value = Number(n < 0n ? -((-n + 500000n) / 1000000n) : (n + 500000n) / 1000000n);
    if (!Number.isSafeInteger(value)) throw new Error('Сумма выходит за допустимый диапазон.');
    return value;
  };
  function validPeriod(from, to) {
    const day = (d) => Number.isSafeInteger(d) && d >= 0 && d <= 2932896;
    if ((from != null && !day(from)) || !day(to) || (from != null && from > to)) throw new Error('Проверьте период: начало должно быть не позже окончания.');
  }

  /**
   * Строки КС-2: позиции ведомости с ценой и объёмом за период (из журнала). Позиции без цены
   * возвращаются отдельно (noPrice) — их нельзя включить в акт, пока не задана цена.
   */
  function ksRows(P, from, to) {
    validPeriod(from, to);
    const names = P.names();
    const ok = (d) => (from === null || from === undefined || d >= from) && (to === null || to === undefined || d <= to);
    const items = P.rows('boq_items').sort((a, b) => (a.position || 0) - (b.position || 0));
    const rows = [], noPrice = [];
    items.forEach((i, k) => {
      const qty = Math.round(P.rows('volumes').filter((v) => v.itemId === i.id && ok(v.date)).reduce((sum, v) => sum + (Number(v.quantity) || 0), 0) * 1e6) / 1e6;
      if (!qty) return;
      const row = { itemId: i.id, pos: k + 1, name: P.itemName(i.id, names), unit: names.units[i.unitId] || '', qty, price: Number(i.priceCents) || 0 };
      if (i.priceCents === null || i.priceCents === undefined || i.priceCents === '' || !Number.isSafeInteger(Number(i.priceCents)) || Number(i.priceCents) < 0) { noPrice.push(row); return; }
      row.sum = cost(qty, row.price);
      rows.push(row);
    });
    const ids = new Set(items.map((i) => i.id));
    if (P.rows('volumes').some((v) => ok(v.date) && Number(v.quantity) && !ids.has(v.itemId))) throw new Error('В журнале есть объёмы без действующей позиции ведомости. Свяжите их с ведомостью перед формированием КС.');
    const total = rows.reduce((sum, r) => sum + r.sum, 0);
    if (!Number.isSafeInteger(total)) throw new Error('Сумма выходит за допустимый диапазон.');
    return { rows, noPrice, total };
  }

  /** НДС: явная ставка или null (без НДС); included — цены ведомости уже с НДС. */
  function vat(total, rate, included) {
    if (rate != null && ![0, 5, 7, 10, 20, 22].includes(rate)) throw new Error('Выберите ставку НДС.');
    if (!Number.isSafeInteger(total)) throw new Error('Недопустимая сумма.');
    if (!rate) return { base: total, vat: 0, all: total };
    const denom = BigInt(included ? 100 + rate : 100), n = BigInt(total) * BigInt(rate);
    const v = Number(n < 0n ? -((-n + denom / 2n) / denom) : (n + denom / 2n) / denom);
    const all = included ? total : total + v;
    if (!Number.isSafeInteger(all)) throw new Error('Сумма с НДС выходит за допустимый диапазон.');
    return { base: included ? total - v : total, vat: v, all };
  }

  /** КС-3: стоимость выполненного с начала работ, с начала года и за период (по ценам ведомости). */
  function ks3Rows(P, from, to) {
    const year = new Date((to || 0) * 86400000).getUTCFullYear();
    const yearStart = Math.round(Date.UTC(year, 0, 1) / 86400000);
    const all = ksRows(P, null, to);
    const byId = (r) => Object.fromEntries(r.rows.map((x) => [x.itemId, x.sum]));
    const yearly = ksRows(P, yearStart, to), period = ksRows(P, from, to);
    const a = byId(all), y = byId(yearly), p = byId(period);
    const combined = Array.from(new Map([...all.rows, ...yearly.rows, ...period.rows].map((r) => [r.itemId, r])).values());
    const rows = combined.map((r) => ({ name: r.name, total: a[r.itemId] || 0, year: y[r.itemId] || 0, period: p[r.itemId] || 0 }));
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
    return { rows, total: sum('total'), year: sum('year'), period: sum('period'), noPrice: Array.from(new Map([...all.noPrice, ...yearly.noPrice, ...period.noPrice].map((r) => [r.itemId, r])).values()) };
  }

  // КС-3 строится из сохранённых предъявленных КС-2. Журнал не переписывает прошлые суммы.
  const contractKey = (opts) => JSON.stringify([s(opts.contractNo), opts.contractDate || null]);
  function validateCertificate(r) {
    if (!r || r.version !== 1 || typeof r.id !== 'string' || !r.id || /[\\/\x00-\x1f]/.test(r.id) || !s(r.number) || !['draft', 'issued'].includes(r.status) || !Array.isArray(r.rows) || !r.totals || typeof r.contractKey !== 'string') throw new Error('Повреждён реестр КС. Формирование остановлено.');
    validPeriod(r.from, r.to);
    if (r.from == null) throw new Error('Укажите начало отчётного периода.');
    validPeriod(r.date, r.date);
    if (new Date(r.from * 86400000).getUTCFullYear() !== new Date(r.to * 86400000).getUTCFullYear()) throw new Error('Разделите КС-2 на периоды по календарным годам, чтобы правильно заполнить итог с начала года.');
    for (const k of ['base', 'vat', 'all']) if (!Number.isSafeInteger(r.totals[k]) || r.totals[k] < 0) throw new Error('Некорректные суммы КС-2.');
    if (r.totals.base + r.totals.vat !== r.totals.all) throw new Error('Суммы КС-2 не сходятся.');
    return r;
  }
  function certificatePrevious(records, current) {
    validateCertificate(current);
    const ids = new Set();
    for (const r of records) { validateCertificate(r); if (ids.has(r.id)) throw new Error('Повтор записи в реестре КС.'); ids.add(r.id); }
    const prior = records.filter((r) => r.status === 'issued' && r.contractKey === current.contractKey && r.id !== current.id);
    if (prior.some((r) => String(r.number) === String(current.number))) throw new Error('КС-2 с этим номером уже предъявлена по договору.');
    if (prior.some((r) => r.to >= current.from)) throw new Error('Есть предъявленная КС-2 за пересекающийся или более поздний период. Чтобы не задвоить объёмы, выберите следующий период.');
    return prior.sort((a, b) => a.to - b.to || String(a.number).localeCompare(String(b.number)));
  }
  function certificate(P, participants, opts) {
    validPeriod(opts.from, opts.to);
    if (opts.from == null) throw new Error('Укажите начало отчётного периода.');
    if (new Date(opts.from * 86400000).getUTCFullYear() !== new Date(opts.to * 86400000).getUTCFullYear()) throw new Error('Разделите КС-2 на периоды по календарным годам, чтобы правильно заполнить итог с начала года.');
    if (!s(opts.contractNo)) throw new Error('Сначала укажите номер договора.');
    if (opts.vatRate === undefined) throw new Error('Сначала выберите НДС в настройках договора.');
    const k = ksRows(P, opts.from, opts.to);
    if (k.noPrice.length) throw new Error('Есть работы без цены. Заполните цены перед формированием КС.');
    if (!k.rows.length) throw new Error('Нет работ за выбранный период.');
    const parts = k.rows.map((row) => vat(row.sum, opts.vatRate, opts.vatIncluded));
    const base = opts.vatIncluded ? parts.reduce((sum, v) => sum + v.base, 0) : k.total;
    const totals = opts.vatIncluded ? { base, vat: k.total - base, all: k.total } : vat(k.total, opts.vatRate, false);
    return validateCertificate({ version: 1, id: newId(), number: s(opts.number), status: 'draft', from: opts.from, to: opts.to, date: opts.date,
      contractKey: contractKey(opts), contractNo: opts.contractNo, contractDate: opts.contractDate || null, vatRate: opts.vatRate, vatIncluded: !!opts.vatIncluded,
      rows: JSON.parse(JSON.stringify(k.rows)), totals, participantsSnapshot: JSON.parse(JSON.stringify(participants)), projectSnapshot: JSON.parse(JSON.stringify(P.project)) });
  }
  function certificateLedger(records, current) {
    const previous = certificatePrevious(records, current);
    const year = new Date(current.to * 86400000).getUTCFullYear();
    const zero = () => ({ base: 0, vat: 0, all: 0 });
    const sum = (rows) => rows.reduce((t, r) => { for (const k of ['base', 'vat', 'all']) { t[k] += r.totals[k]; if (!Number.isSafeInteger(t[k])) throw new Error('Накопленная сумма выходит за допустимый диапазон.'); } return t; }, zero());
    const prior = sum(previous), period = Object.assign({}, current.totals);
    const total = sum(previous.concat([current]));
    const byYear = previous.concat([current]).filter((r) => new Date(r.to * 86400000).getUTCFullYear() === year);
    return { previousIds: previous.map((r) => r.id), previousNumbers: previous.map((r) => r.number), prior, period, total, year: sum(byYear) };
  }

  /** Шапка КС-2/КС-3: инвестор, заказчик, подрядчик, стройка, объект, договор. */
  function ksHeader(P, participants, opts, title, subtitle) {
    const org = (role) => orgs(participants, role)[0] || null;
    const line = (o) => (o ? [o.name, o.address, o.phone ? 'тел. ' + o.phone : ''].filter(Boolean).join(', ') : '');
    const p = P.project;
    const cell = (t, o) => Object.assign({ p: [t === null || t === undefined ? '' : String(t)] }, o || {});
    const small = (t) => ({ p: [{ t, size: 8 }] });
    const customer = org('customer'), builder = org('builder');
    const out = [];
    out.push({ p: [{ t: subtitle, size: 8, i: true }], align: 'right', after: 2 });
    out.push({ borders: true, widths: [2600, 9200, 1400, 1500], table: [
      [small('Инвестор'), cell(''), small('по ОКПО'), cell('')],
      [small('Заказчик (генподрядчик)'), cell(line(customer)), small('по ОКПО'), cell((customer && customer.okpo) || '')],
      [small('Подрядчик (субподрядчик)'), cell(line(builder)), small('по ОКПО'), cell((builder && builder.okpo) || '')],
      [small('Стройка'), cell(opts.stroyka || p.name || ''), small(''), cell('')],
      [small('Объект'), cell([p.name, p.address].filter(Boolean).join(', ')), small(''), cell('')],
      [small('Договор подряда (контракт)'), cell([opts.contractNo ? '№ ' + opts.contractNo : '', opts.contractDate ? 'от ' + dmy(opts.contractDate) : ''].filter(Boolean).join(' ')), small(''), cell('')],
    ] });
    out.push({ borders: true, widths: [3000, 3000, 2500, 2500], table: [
      [small('Номер документа'), small('Дата составления'), small('Отчётный период: с'), small('по')],
      [cell(opts.number || ''), cell(dmy(opts.date)), cell(opts.from ? dmy(opts.from) : ''), cell(dmy(opts.to))],
    ] });
    out.push({ p: [{ t: title, b: true, size: 13 }], align: 'center', before: 6, after: 4 });
    return out;
  }

  function ksSigns(out, left, leftRep, right, rightRep) {
    const who = (r) => (r ? [r.position, r.fio].filter(Boolean).join(' ') : '');
    out.push({ widths: [7500, 7500], table: [
      [{ p: [{ t: left + ': ', b: true }, who(leftRep) + '   ____________'] }, { p: [{ t: right + ': ', b: true }, who(rightRep) + '   ____________'] }],
      [{ p: [{ t: '(должность, расшифровка подписи, подпись)', i: true, size: 8 }] }, { p: [{ t: '(должность, расшифровка подписи, подпись)', i: true, size: 8 }] }],
      [{ p: ['М. П.'] }, { p: ['М. П.'] }],
    ] });
  }

  /** КС-2 «Акт о приёмке выполненных работ» (унифицированная форма). opts: { number, date, from, to, contractNo, contractDate, stroyka, contractValue, signFrom, signTo }. */
  function ks2Blocks(P, participants, opts) {
    const record = opts.certificate;
    const k = record ? { rows: record.rows, total: record.rows.reduce((t, r) => t + r.sum, 0), noPrice: [] } : ksRows(P, opts.from, opts.to);
    if (k.noPrice.length) throw new Error('Есть работы без цены. Заполните цены перед формированием КС.');
    if (record) { validateCertificate(record); P = { project: record.projectSnapshot }; participants = record.participantsSnapshot; }
    const out = ksHeader(P, participants, opts, 'АКТ О ПРИЁМКЕ ВЫПОЛНЕННЫХ РАБОТ', 'Форма № КС-2');
    out.push({ p: [opts.vatRate == null ? 'Без НДС.' : opts.vatIncluded ? 'Цены и суммы включают НДС ' + opts.vatRate + '%.' : 'Цены и суммы без НДС; ставка НДС ' + opts.vatRate + '% учитывается в КС-3.'], size: 9 });
    if (opts.contractValue) out.push({ p: ['Сметная (договорная) стоимость в соответствии с договором подряда (субподряда): ', { t: rub(opts.contractValue) + ' руб.', u: true }], size: 10, after: 4 });
    const h = (t) => ({ p: [{ t, b: true, size: 9 }], align: 'center' });
    const c = (t, align) => ({ p: [{ t: String(t), size: 9 }], align: align || 'left' });
    const rows = [[h('№ п/п'), h('№ позиции по смете'), h('Наименование работ'), h('№ единичной расценки'), h('Единица измерения'), h('Выполнено работ: количество'), h('цена за единицу, руб.'), h('стоимость, руб.')]];
    k.rows.forEach((r, i) => rows.push([c(i + 1, 'center'), c(r.pos, 'center'), c(r.name), c(''), c(r.unit, 'center'), c(num(r.qty), 'right'), c(rub(r.price), 'right'), c(rub(r.sum), 'right')]));
    rows.push([c(''), c(''), { p: [{ t: 'Итого', b: true, size: 9 }], align: 'right' }, c(''), c(''), c(''), c(''), { p: [{ t: rub(k.total), b: true, size: 9 }], align: 'right' }]);
    out.push({ borders: true, header: true, widths: [800, 1100, 6400, 1300, 1200, 1400, 1500, 1600], table: rows });
    ksSigns(out, 'Сдал', opts.signFrom, 'Принял', opts.signTo);
    return { blocks: out, ks: k };
  }

  /** КС-3 «Справка о стоимости выполненных работ и затрат». opts как у КС-2 + vatRate, vatIncluded. */
  function ks3Blocks(P, participants, opts) {
    const record = opts.certificate;
    if (!record || !record.ledger) throw new Error('КС-3 формируется только из сохранённой КС-2 и реестра предъявленных актов.');
    validateCertificate(record);
    P = { project: record.projectSnapshot }; participants = record.participantsSnapshot;
    const k = record.ledger;
    const out = ksHeader(P, participants, opts, 'СПРАВКА О СТОИМОСТИ ВЫПОЛНЕННЫХ РАБОТ И ЗАТРАТ', 'Форма № КС-3');
    const h = (t) => ({ p: [{ t, b: true, size: 9 }], align: 'center' });
    const c = (t, bold) => ({ p: [{ t: String(t), size: 9, b: !!bold }] });
    const rows = [[h('№'), h('Наименование работ и затрат'), h('Код'), h('С начала проведения работ, включая текущий период'), h('С начала года'), h('В том числе за отчётный период')]];
    rows.push([c(1), c(P.project.name || 'Работы по договору'), c(''), c(rub(k.total.base)), c(rub(k.year.base)), c(rub(k.period.base))]);
    rows.push([c(''), c('Итого', true), c(''), c(rub(k.total.base), true), c(rub(k.year.base), true), c(rub(k.period.base), true)]);
    rows.push([c(''), c(record.vatRate === null ? 'Без НДС (текущий период)' : 'НДС (текущий период ' + record.vatRate + '%)'), c(''), c(rub(k.total.vat)), c(rub(k.year.vat)), c(rub(k.period.vat))]);
    rows.push([c(''), c('Всего', true), c(''), c(rub(k.total.all), true), c(rub(k.year.all), true), c(rub(k.period.all), true)]);
    out.push({ borders: true, header: true, widths: [700, 6300, 600, 2500, 2200, 2500], table: rows });
    out.push({ p: ['Ранее предъявлено по КС-2: ' + rub(k.prior.all) + ' руб. Текущая КС-2 № ' + record.number + ': ' + rub(k.period.all) + ' руб. Накоплено с текущей: ' + rub(k.total.all) + ' руб.'], size: 10 });
    out.push({ p: ['Основание накопления: ' + (k.previousNumbers.length ? 'ранее предъявленные КС-2 № ' + k.previousNumbers.join(', ') : 'ранее предъявленных КС-2 нет') + '; текущая КС-2 № ' + record.number + '.'], size: 9 });
    ksSigns(out, 'Заказчик', opts.signTo, 'Подрядчик', opts.signFrom);
    return { blocks: out, ks: k, vat: k.period };
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

  const api = { contractKey, validateCertificate, certificate, certificatePrevious, certificateLedger, validateParticipants, validPeriod, ksRows, ks3Rows, ks2Blocks, ks3Blocks, vat, rub, ojrBlocks, ojrWorkRows, ojrControlRows, weatherLine, orgLine, repLine, longDate, ORG_ROLES, REP_ROLES, roleTitle, emptyParticipants, orgs, reps, setDefaults, saveOrg, saveRep, remove, mergeParticipants, draft, defaultReps, nextNumber, missing, blocks, registry, fileName, placeOf, dmy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabId = api;
})(typeof window !== 'undefined' ? window : globalThis);
