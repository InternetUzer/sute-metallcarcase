/*
 * «Прораб+» — свои шаблоны документов: любой файл Word (.docx) или Excel (.xlsx) с метками в фигурных скобках,
 * например {ОБЪЕКТ}, {ЗАСТРОЙЩИК ИНН}, {РАБОТЫ}. Кабинет подставляет данные карточки объекта, участников
 * строительства и акта; оформление шаблона не меняется.
 * Метки не зависят от регистра, «ё» и подчёркиваний: {Застройщик_ИНН} = {ЗАСТРОЙЩИК ИНН}.
 * Word часто разрезает набранный текст на куски — метка находится, даже если она разрезана.
 * Без DOM — проверяется тестами в Node.
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const O = node ? require('./office.js') : root.ProrabOffice;
  const I = node ? require('./id.js') : root.ProrabId;
  const dec = new TextDecoder(), enc = new TextEncoder();

  // ───── чтение zip (docx и xlsx — это zip) ─────
  async function inflate(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error('Это не документ Word или Excel (повреждён или старый формат .doc/.xls — сохраните как .docx/.xlsx).');
    const count = v.getUint16(end + 10, true);
    let p = v.getUint32(end + 16, true);
    const out = [];
    for (let k = 0; k < count; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Файл шаблона повреждён');
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const raw = bytes.subarray(start, start + csize);
      if (method !== 0 && method !== 8) throw new Error('Неизвестное сжатие в шаблоне');
      out.push({ name, data: method === 8 ? await inflate(raw) : raw.slice() });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  // ───── метки ─────
  const norm = (label) => String(label).toUpperCase().replace(/Ё/g, 'Е').replace(/[_\s]+/g, ' ').trim();
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /**
   * Подстановка в один XML: unit — абзац (Word) или строка (Excel), text — тег с текстом.
   * values — Map(норм. метка → значение). Неизвестные метки остаются как есть и попадают в missing.
   */
  function fillXml(xml, values, used, missing, kind) {
    const unitRe = kind === 'xlsx' ? /<si>[\s\S]*?<\/si>|<is>[\s\S]*?<\/is>/g : /<w:p(?=[\s>])[\s\S]*?<\/w:p>/g;
    const textRe = kind === 'xlsx' ? /<t(?=[\s>])([^>]*)>([\s\S]*?)<\/t>/g : /<w:t(?=[\s>])([^>]*)>([\s\S]*?)<\/w:t>/g;
    const tag = kind === 'xlsx' ? 't' : 'w:t';
    return xml.replace(unitRe, (unit) => {
      const nodes = [];
      unit.replace(textRe, (m, attrs, text, off) => { nodes.push({ m, attrs, text: unesc(text), off }); return m; });
      if (!nodes.length) return unit;
      const all = nodes.map((n) => n.text).join('');
      if (all.indexOf('{') < 0) return unit;
      const starts = [];
      let acc = 0;
      for (const n of nodes) { starts.push(acc); acc += n.text.length; }
      const at = (pos) => { let i = starts.length - 1; while (i > 0 && starts[i] > pos) i--; return i; };
      const matches = [];
      const re = /\{([^{}]{1,80})\}/g;
      let m;
      while ((m = re.exec(all))) matches.push(m);
      let changed = false;
      for (const mm of matches.reverse()) {
        const key = norm(mm[1]);
        if (!values.has(key)) { missing.add(mm[0]); continue; }
        used.add(key);
        const a = mm.index, b = mm.index + mm[0].length;
        const i = at(a), j = at(b - 1);
        const value = String(values.get(key) === null || values.get(key) === undefined ? '' : values.get(key));
        const ti = nodes[i].text;
        if (i === j) nodes[i].text = ti.slice(0, a - starts[i]) + value + ti.slice(b - starts[i]);
        else {
          nodes[i].text = ti.slice(0, a - starts[i]) + value;
          for (let k = i + 1; k < j; k++) nodes[k].text = '';
          nodes[j].text = nodes[j].text.slice(b - starts[j]);
        }
        changed = true;
      }
      if (!changed) return unit;
      let out = '', last = 0;
      for (const n of nodes) {
        out += unit.slice(last, n.off);
        const attrs = /xml:space=/.test(n.attrs) ? n.attrs : n.attrs + ' xml:space="preserve"';
        const body = kind === 'xlsx' ? esc(n.text) : esc(n.text).split('\n').join('</w:t><w:br/><w:t xml:space="preserve">');
        out += '<' + tag + attrs + '>' + body + '</' + tag + '>';
        last = n.off + n.m.length;
      }
      return out + unit.slice(last);
    });
  }

  const PARTS = { docx: /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/, xlsx: /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/ };

  /** Заполнить шаблон. bytes — файл .docx или .xlsx; values — [{ key, value }]. → { bytes, used, missing }. */
  async function fill(bytes, values, kind) {
    kind = kind || 'docx';
    const map = new Map(values.map((v) => [norm(v.key), v.value]));
    const used = new Set(), missing = new Set();
    const entries = await unzip(bytes);
    if (!entries.some((e) => (kind === 'xlsx' ? e.name === 'xl/workbook.xml' : e.name === 'word/document.xml'))) {
      throw new Error(kind === 'xlsx' ? 'В файле нет листов Excel' : 'В файле нет текста документа Word');
    }
    const out = entries.map((e) => (PARTS[kind].test(e.name) ? { name: e.name, text: enc.encode(fillXml(dec.decode(e.data), map, used, missing, kind)) } : { name: e.name, text: e.data }));
    return { bytes: O.zip(out), used: Array.from(used), missing: Array.from(missing) };
  }

  /** Метки, которые есть в шаблоне (для проверки перед заполнением). */
  async function labelsIn(bytes, kind) {
    const res = await fill(bytes, [], kind || 'docx');
    return res.missing;
  }

  // ───── значения меток ─────
  const dmy = (d) => (d ? I.dmy(d) : '');
  const ORG_KEYS = [['customer', 'ЗАСТРОЙЩИК'], ['builder', 'ГЕНПОДРЯДЧИК'], ['designer', 'ПРОЕКТИРОВЩИК'], ['performer', 'ПОДРЯДЧИК']];
  const REP_KEYS = [['customerControl', 'ПРЕДСТАВИТЕЛЬ ЗАСТРОЙЩИКА'], ['builder', 'ПРЕДСТАВИТЕЛЬ ГЕНПОДРЯДЧИКА'], ['builderControl', 'ПРЕДСТАВИТЕЛЬ СК ГЕНПОДРЯДЧИКА'],
    ['designer', 'ПРЕДСТАВИТЕЛЬ ПРОЕКТИРОВЩИКА'], ['performer', 'ПРЕДСТАВИТЕЛЬ ПОДРЯДЧИКА']];

  /**
   * Все метки с подписями и значениями: [{ group, key, title, value }].
   * P — объект (ProrabModel.Project), d — участники, act — акт (или null — документ без акта), day — сегодня.
   */
  function values(P, d, act, day) {
    const p = P.project;
    const out = [];
    const add = (group, key, title, value) => out.push({ group, key, title, value: value === null || value === undefined ? '' : String(value) });
    add('Объект', 'ОБЪЕКТ', 'Название объекта', p.name);
    add('Объект', 'АДРЕС', 'Адрес объекта', p.address);
    add('Объект', 'ЗАКАЗЧИК', 'Заказчик (из карточки)', p.customer);
    add('Объект', 'ТЕХНАДЗОР', 'Технадзор (из карточки)', p.supervisor);
    add('Объект', 'ИСПОЛНИТЕЛЬ', 'Исполнитель, генподрядчик (из карточки)', p.contractor);
    add('Объект', 'НАЧАЛО РАБОТ', 'Начало работ по объекту', dmy(p.startDate));
    add('Объект', 'СДАЧА ОБЪЕКТА', 'Сдача объекта', dmy(p.deadline));
    add('Объект', 'СЕГОДНЯ', 'Сегодняшняя дата', dmy(day));
    add('Объект', 'СЕГОДНЯ ПРОПИСЬЮ', 'Сегодня: «24» октября 2026 г.', I.longDate(day));
    const performerId = act && act.performerId;
    const org = (role) => (role === 'performer' && performerId ? I.orgs(d).find((o) => o.id === performerId) : I.orgs(d, role)[0]);
    for (const [role, k] of ORG_KEYS) {
      const o = org(role) || {};
      const t = I.roleTitle(I.ORG_ROLES, role);
      add('Организации', k, t + ' — наименование', o.name);
      add('Организации', k + ' РЕКВИЗИТЫ', t + ' — всё одной строкой', I.orgLine(o.name ? o : null));
      add('Организации', k + ' ИНН', 'ИНН', o.inn);
      add('Организации', k + ' ОГРН', 'ОГРН', o.ogrn);
      add('Организации', k + ' АДРЕС', 'Адрес', o.address);
      add('Организации', k + ' ТЕЛЕФОН', 'Телефон', o.phone);
      add('Организации', k + ' СРО', 'СРО', [o.sro, o.sroOgrn ? 'ОГРН ' + o.sroOgrn : '', o.sroInn ? 'ИНН ' + o.sroInn : ''].filter(Boolean).join(', '));
    }
    const signers = act ? act.repIds.map((id) => I.reps(d).find((r) => r.id === id)).filter(Boolean) : null;
    for (const [role, k] of REP_KEYS) {
      const pool = signers || I.reps(d);
      const r = pool.find((x) => x.role === role && (role !== 'performer' || !performerId || x.orgId === performerId)) || pool.find((x) => x.role === role) || {};
      const t = I.roleTitle(I.REP_ROLES, role);
      add('Представители', k, t + ' — фамилия, инициалы', r.fio);
      add('Представители', k + ' ДОЛЖНОСТЬ', 'Должность', r.position);
      add('Представители', k + ' НРС', 'Номер в национальном реестре специалистов', r.nrs);
      add('Представители', k + ' ПРИКАЗ', 'Документ о полномочиях', r.order);
      add('Представители', k + ' РЕКВИЗИТЫ', 'Всё одной строкой', r.fio ? I.repLine(r, I.orgs(d).find((o) => o.id === r.orgId)) : '');
    }
    if (act) {
      add('Акт', 'НОМЕР', 'Номер акта', act.number);
      add('Акт', 'ДАТА', 'Дата акта', dmy(act.date));
      add('Акт', 'ДАТА ПРОПИСЬЮ', 'Дата акта: «24» октября 2026 г.', act.date ? I.longDate(act.date) : '');
      add('Акт', 'МЕСТО', 'Место составления', act.place);
      add('Акт', 'РАБОТЫ', '1. Предъявленные работы', act.works);
      add('Акт', 'ПРОЕКТ', '2. Проектная документация', act.project);
      add('Акт', 'МАТЕРИАЛЫ', '3. Применённые материалы', act.materials);
      add('Акт', 'ДОКУМЕНТЫ', '4. Документы о соответствии', act.documents);
      add('Акт', 'НАЧАЛО', '5. Начало работ', dmy(act.start));
      add('Акт', 'ОКОНЧАНИЕ', '5. Окончание работ', dmy(act.end));
      add('Акт', 'НОРМАТИВЫ', '6. Нормативы', act.norms);
      add('Акт', 'ПОСЛЕДУЮЩИЕ РАБОТЫ', '7. Последующие работы', act.next);
      add('Акт', 'ДОПОЛНИТЕЛЬНЫЕ СВЕДЕНИЯ', 'Дополнительные сведения', act.extra);
      add('Акт', 'ЭКЗЕМПЛЯРОВ', 'Число экземпляров', act.copies);
      add('Акт', 'ПРИЛОЖЕНИЯ', 'Приложения', act.annexes);
    }
    // Свои поля карточки объекта ({НОМЕР ДОГОВОРА} и т. п.) — если не совпадают со встроенными метками
    const builtin = new Set(out.map((x) => norm(x.key)));
    for (const f of P.fields()) {
      const k = norm(f.name || '');
      if (k && !builtin.has(k)) { add('Свои поля карточки', k, 'Своё поле «' + f.name + '»', f.value); builtin.add(k); }
    }
    return out;
  }

  const kindOf = (name) => (/\.xlsx$/i.test(name) ? 'xlsx' : /\.docx$/i.test(name) ? 'docx' : null);

  const api = { unzip, fill, labelsIn, values, norm, kindOf, fillXml };
  if (node) module.exports = api;
  else root.ProrabTemplates = api;
})(typeof window !== 'undefined' ? window : globalThis);
