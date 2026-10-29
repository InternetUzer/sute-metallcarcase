/* Self-contained PDF reports: remarks + photos + drawing overview/detail. All data stays in the browser.
 * PDF pages are high-resolution JPEGs (Cyrillic does not depend on PDF font availability).
 * Missing assets are explicit in both the document and the returned warnings. */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const DXF = node ? require('./dxf.js') : root.ProrabDxf;
  const SH = node ? require('./shapes.js') : root.ProrabShapes;
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const day = (ms) => { const d = new Date(ms || 0); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); };
  const date = (d) => Number.isFinite(d) ? new Date(d * 86400000).toLocaleDateString('ru-RU', { timeZone: 'UTC' }) : 'не указан';
  function rows(P) {
    const drawings = new Map(P.rows('drawings').map((d) => [d.id, d])), people = P.names().contractors;
    const before = (id) => copy(P.attachmentsOf(id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
    return P.rows('remarks').map((r) => ({ ...copy(r), key: 'remark:' + r.id, title: '№' + r.number, done: r.status === 'DONE', before: before(r.id), after: before(r.id + ':done') }))
      .concat(P.rows('drawing_notes').filter((n) => drawings.has(n.drawingId)).map((n) => ({ ...copy(n), key: 'note:' + n.id, title: 'Ч' + n.number,
        date: day(n.createdAt), done: n.status === 'DONE', doneDate: n.doneDate == null ? day(n.updatedAt) : n.doneDate,
        before: before(n.id), after: before(n.id + ':done'), drawing: copy(drawings.get(n.drawingId)),
        shapes: copy(P.shapesOf(n.drawingId)), view: copy(P.viewsOf(n.drawingId).find((v) => v.id === n.viewId) || null) })))
      .map((r) => ({ ...r, contractorName: people[r.contractorId] || 'Не указан' }))
      .sort((a, b) => Number(a.done) - Number(b.done) || b.date - a.date || a.title.localeCompare(b.title, 'ru', { numeric: true }));
  }
  function selectRows(all, options) {
    const o = options || {}, prescription = o.kind === 'prescription';
    if (prescription && !o.contractorId) throw new Error('Выберите исполнителя предписания.');
    return all.filter((r) => (!o.selected || o.selected.includes(r.key)) && (!o.contractorId || r.contractorId === o.contractorId) &&
      (!(prescription || o.status === 'open') || !r.done) && (o.status !== 'done' || r.done))
      .sort(prescription ? (a, b) => (a.dueDate || Infinity) - (b.dueDate || Infinity) || a.date - b.date || a.title.localeCompare(b.title, 'ru', { numeric: true }) : () => 0);
  }
  function leaf(name) {
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) throw new Error('Некорректное имя вложения.');
    return name;
  }
  function filename(kind, number, dayValue, id) {
    const safe = String(number || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').slice(0, 40);
    return (kind === 'prescription' ? 'Предписание' + (safe ? ' №' + safe : '') : 'Отчёт о замечаниях') + ' ' + date(dayValue) + ' — ' + leaf(id) + '.pdf';
  }
  const encode = (s) => new TextEncoder().encode(s);
  /** Small PDF image writer. Correct byte offsets, no external fonts or remote dependencies. */
  function pdf(images, width, height) {
    width = width || 595; height = height || 842;
    const chunks = [encode('%PDF-1.4\n%prorab\n')], offsets = [0]; let size = chunks[0].length;
    const add = (b) => { chunks.push(b); size += b.length; };
    const obj = (id, text, stream) => {
      offsets[id] = size; add(encode(id + ' 0 obj\n' + text));
      if (stream) { add(encode('\nstream\n')); add(stream); add(encode('\nendstream')); }
      add(encode('\nendobj\n'));
    };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Count ' + images.length + ' /Kids [' + images.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] >>');
    images.forEach((im, i) => {
      const id = 3 + i * 3;
      obj(id, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + width + ' ' + height + '] /Resources << /XObject << /I ' + (id + 1) + ' 0 R >> >> /Contents ' + (id + 2) + ' 0 R >>');
      obj(id + 1, '<< /Type /XObject /Subtype /Image /Width ' + im.width + ' /Height ' + im.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>', im.bytes);
      const content = encode('q ' + width + ' 0 0 ' + height + ' 0 0 cm /I Do Q');
      obj(id + 2, '<< /Length ' + content.length + ' >>', content);
    });
    const start = size;
    add(encode('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n' + offsets.slice(1).map((v) => String(v).padStart(10, '0') + ' 00000 n \n').join('') +
      'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n'));
    const out = new Uint8Array(size); let p = 0; for (const b of chunks) { out.set(b, p); p += b.length; } return out;
  }
  const makeCanvas = (w, h) => { const c = root.document.createElement('canvas'); c.width = w; c.height = h; return c; };
  async function jpeg(canvas) {
    if (canvas.convertToBlob) return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 })).arrayBuffer());
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new Error('Не удалось создать страницу PDF.');
    return new Uint8Array(await blob.arrayBuffer());
  }
  async function image(bytes) {
    const blob = new Blob([bytes]);
    if (root.createImageBitmap) return root.createImageBitmap(blob);
    const url = URL.createObjectURL(blob);
    try { return await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Изображение не читается')); i.src = url; }); }
    finally { URL.revokeObjectURL(url); }
  }
  function lines(ctx, text, width) {
    const out = [];
    for (const paragraph of String(text == null ? '' : text).split(/\r?\n/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && ctx.measureText(line + ' ' + word).width > width) { out.push(line); line = ''; }
        if (ctx.measureText(word).width > width) {
          for (const letter of word) { if (ctx.measureText(line + letter).width > width) { out.push(line); line = ''; } line += letter; }
        } else line += (line ? ' ' : '') + word;
      }
      out.push(line);
    }
    return out;
  }
  const paperColor = (color) => {
    const m = /^#([0-9a-f]{6})$/i.exec(color || '');
    if (!m) return '#29313b';
    const n = parseInt(m[1], 16), r = n >> 16, g = n >> 8 & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? '#434a52' : color;
  };
  function geometry(dxf, pageSize, note) {
    const x = note.x - (dxf ? dxf.originX : 0), y = note.y - (dxf ? dxf.originY : 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Не заданы координаты пометки.');
    const whole = dxf ? DXF.fitBox(dxf) : [0, 0, pageSize[0], pageSize[1]];
    if (whole.some((v) => !Number.isFinite(v))) throw new Error('Не определены границы чертежа.');
    if (dxf) { whole[0] = Math.min(whole[0], x); whole[1] = Math.min(whole[1], y); whole[2] = Math.max(whole[2], x); whole[3] = Math.max(whole[3], y); }
    else if (x < 0 || y < 0 || x > whole[2] || y > whole[3]) throw new Error('Пометка находится вне листа PDF.');
    const half = Math.max(whole[2] - whole[0], whole[3] - whole[1], 1) * 0.09;
    return { x, y, whole, zoom: [x - half, y - half * 0.72, x + half, y + half * 0.72] };
  }
  async function drawingPanel(options, sheet, row, box) {
    const canvas = options.canvas(1000, 720), ctx = canvas.getContext('2d'), pad = 24;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const s = Math.min((1000 - 2 * pad) / Math.max(box[2] - box[0], 1e-6), (720 - 2 * pad) / Math.max(box[3] - box[1], 1e-6));
    const ox = 500 - (box[0] + box[2]) / 2 * s;
    const oy = sheet.dxf ? 360 + (box[1] + box[3]) / 2 * s : 360 - (box[1] + box[3]) / 2 * s;
    const local = (x, y) => [x * s + ox, (sheet.dxf ? -y : y) * s + oy];
    const real = (p) => local(p[0] - (sheet.dxf ? sheet.dxf.originX : 0), p[1] - (sheet.dxf ? sheet.dxf.originY : 0));
    const hidden = new Set();
    if (sheet.dxf) {
      for (const l of Object.values(sheet.dxf.layers)) if (!l.visible) hidden.add(l.name);
      if (row.view && row.view.hiddenLayers != null) {
        hidden.clear(); String(row.view.hiddenLayers).split('\n').filter(Boolean).forEach((l) => hidden.add(l));
      }
      ctx.lineWidth = 1.3;
      for (const line of sheet.dxf.lines) {
        if (hidden.has(line.layer)) continue;
        ctx.strokeStyle = paperColor(line.color); ctx.beginPath();
        for (let i = 0; i < line.pts.length; i += 2) { const p = local(line.pts[i], line.pts[i + 1]); if (i) ctx.lineTo(...p); else ctx.moveTo(...p); }
        ctx.stroke();
      }
      for (const t of sheet.dxf.texts) {
        const size = t.height * s;
        if (hidden.has(t.layer) || size < 2 || size > 3000) continue;
        ctx.save(); ctx.translate(...local(t.x, t.y)); ctx.rotate(-(t.rotation || 0) * Math.PI / 180);
        ctx.fillStyle = paperColor(t.color); ctx.font = size + 'px sans-serif'; ctx.textAlign = t.align === 1 ? 'center' : t.align === 2 ? 'right' : 'left';
        String(t.text).split('\n').forEach((line, i) => ctx.fillText(line, 0, i * size * 1.6)); ctx.restore();
      }
    } else await sheet.page.render({ canvasContext: ctx, viewport: sheet.page.getViewport({ scale: s }), transform: [1, 0, 0, 1, ox, oy] }).promise;
    for (const raw of row.shapes || []) {
      const sh = SH.fromRow(raw); if (!sh.points.length || (!sheet.dxf && sh.page !== (row.page || 0))) continue;
      const pts = (sh.kind === 'rect' && sh.points.length >= 2 ? SH.rect(sh.points[0], sh.points[1]) : sh.points).map(real);
      ctx.strokeStyle = ctx.fillStyle = paperColor(sh.color); ctx.lineWidth = 2;
      if (sh.kind === 'text') { ctx.font = Math.min(1000, Math.max(12, (sh.size || 0) * s)) + 'px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(sh.text, ...pts[0]); continue; }
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p));
      if (sh.kind === 'area' || sh.kind === 'rect') ctx.closePath(); ctx.stroke();
      if (sh.kind === 'area' || sh.kind === 'dim') {
        const label = SH.label(sh), p = real(SH.center(sh.points)); ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label || '', p[0], p[1] - 6);
      }
    }
    const p = real([row.x, row.y]);
    ctx.strokeStyle = '#b91c1c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(...p, 23, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#b91c1c'; ctx.beginPath(); ctx.arc(...p, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(row.number), ...p);
    ctx.strokeStyle = '#aeb6c1'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, 999, 719);
    return canvas;
  }
  async function build(input) {
    const o = Object.assign({ canvas: makeCanvas, jpeg, image, onProgress: () => {} }, input);
    const selected = selectRows(o.rows, o);
    if (!selected.length) throw new Error('Нет замечаний для выбранных условий.');
    const warnings = [], images = [], sheets = new Map(); let canvas, ctx, y, pageNo = 0;
    const title = o.kind === 'prescription' ? 'ПРЕДПИСАНИЕ №' + (o.number || '1') : 'ОТЧЁТ О ЗАМЕЧАНИЯХ';
    async function finish() {
      if (!canvas) return;
      ctx.fillStyle = '#657082'; ctx.font = '9px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('Прораб+ · ' + date(o.date), 36, 814);
      ctx.textAlign = 'right'; ctx.fillText('Страница ' + pageNo, 559, 814); ctx.textAlign = 'left';
      images.push({ width: canvas.width, height: canvas.height, bytes: await o.jpeg(canvas) });
      canvas.width = 1; canvas.height = 1;
      if (images.reduce((n, im) => n + im.bytes.length, 0) > 80 * 1024 * 1024) throw new Error('Отчёт слишком велик. Выберите меньше замечаний и сформируйте несколько частей.');
    }
    async function page() {
      await finish(); if (++pageNo > 200) throw new Error('Больше 200 страниц. Разделите отчёт на части.');
      canvas = o.canvas(1190, 1684); ctx = canvas.getContext('2d'); ctx.scale(2, 2);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 595, 842); y = 38;
      ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#31425a'; ctx.fillText(title, 36, y); y += 22;
    }
    async function room(h) { if (y + h > 790) await page(); }
    async function text(value, size, bold, color) {
      size = size || 11;
      ctx.font = (bold ? 'bold ' : '') + size + 'px sans-serif';
      const wrapped = lines(ctx, value, 523);
      for (const line of wrapped) {
        await room(size * 1.4); ctx.font = (bold ? 'bold ' : '') + size + 'px sans-serif'; ctx.fillStyle = color || '#172433';
        ctx.textAlign = 'left'; ctx.fillText(line, 36, y + size); y += size * 1.4;
      }
      y += 5;
    }
    const warning = async (s) => { warnings.push(s); await text(s, 10, false, '#b42318'); };
    const read = async (file) => { const b = await o.readFile(leaf(file)); if (!b || !b.byteLength) throw new Error('файл ещё не загружен на Диск'); return new Uint8Array(b); };
    async function sheet(row) {
      const key = row.drawing.id + ':' + (row.page || 0);
      if (!sheets.has(key)) {
        // Keep at most one parsed drawing in memory. Reuse it for adjacent notes.
        for (const value of sheets.values()) if (value.pdf) await value.pdf.destroy();
        sheets.clear();
        const bytes = await read(row.drawing.file);
        if (row.drawing.kind === 'dxf') sheets.set(key, { dxf: DXF.parse(bytes) });
        else {
          if (row.drawing.kind !== 'pdf') throw new Error('неподдерживаемый формат чертежа');
          const pdf = await o.openPdf(bytes);
          try { sheets.set(key, { pdf, page: await pdf.getPage((row.page || 0) + 1) }); } catch (e) { await pdf.destroy(); throw e; }
        }
      }
      return sheets.get(key);
    }
    try {
      await page();
      await text(o.project.name || 'Объект', 20, true);
      if (o.project.address) await text('Адрес: ' + o.project.address);
      await text('Дата: ' + date(o.date) + ' · Замечаний: ' + selected.length);
      if (o.kind === 'prescription') {
        await text('Кому: ' + (o.recipient || selected[0].contractorName), 12, true);
        if (o.issuer || o.project.supervisor) await text('Выдал: ' + (o.issuer || o.project.supervisor));
        await text('Необходимо устранить перечисленные замечания в указанные сроки и сообщить о выполнении с подтверждающими фотографиями.');
      } else await text('Состав: ' + ({ open: 'открытые', done: 'устранённые', all: 'все' }[o.status] || 'все') + (o.contractorId ? ' · ' + selected[0].contractorName : ' · все исполнители'));
      for (let index = 0; index < selected.length; index++) {
        const row = selected[index]; o.onProgress('Замечание ' + (index + 1) + ' из ' + selected.length);
        await room(100); y += 10;
        ctx.fillStyle = '#e9eef4'; ctx.fillRect(36, y - 3, 523, 24);
        await text(row.title + ' · ' + (row.done ? 'Устранено' : row.status === 'PROBLEM' ? 'Проблема' : 'Открыто'), 13, true);
        await text('Записано: ' + date(row.date) + ' · Исполнитель: ' + row.contractorName, 10);
        const due = row.dueDate == null && o.kind === 'prescription' ? o.commonDue : row.dueDate;
        await text('Срок устранения: ' + date(due), 10);
        if (row.place) await text('Место: ' + row.place, 10);
        await text(row.text || 'Описание не заполнено');
        if (row.done) await text('Устранено: ' + date(row.doneDate) + (row.doneNote ? '. ' + row.doneNote : ''), 10);
        if (row.drawing) {
          await text('Чертёж: ' + row.drawing.name + ' · лист ' + ((row.page || 0) + 1) + ' · пометка ' + row.number, 10, true);
          try {
            const s = await sheet(row), v = s.page && s.page.getViewport({ scale: 1 });
            const g = geometry(s.dxf, v && [v.width, v.height], row);
            const whole = await drawingPanel(o, s, row, g.whole), zoom = await drawingPanel(o, s, row, g.zoom);
            if (y + 211 > 790) { await page(); await text('Чертёж: ' + row.drawing.name + ' · лист ' + ((row.page || 0) + 1) + ' · ' + row.title, 10, true); }
            await room(211); ctx.fillStyle = '#435269'; ctx.font = '10px sans-serif';
            ctx.fillText(row.title + ': общий вид', 36, y + 10); ctx.fillText('Место замечания крупно', 303, y + 10);
            ctx.drawImage(whole, 36, y + 18, 256, 184); ctx.drawImage(zoom, 303, y + 18, 256, 184); y += 213;
            whole.width = zoom.width = 1;
          } catch (e) { await warning(row.title + ': место на чертеже не загружено - ' + e.message); }
        }
        for (const [label, media] of [['До устранения', row.before], ['После устранения', o.kind === 'prescription' ? [] : row.after]]) {
          if (!media.length) continue;
          await room(70); await text(label + ' · ' + row.title, 11, true);
          for (const attachment of media) {
            if (attachment.kind === 'video' || /^(video\/)/i.test(attachment.mime || '') || /\.(mp4|mov|webm|avi)$/i.test(attachment.file || '')) { await text('Видео (откройте в карточке): ' + attachment.file, 10); continue; }
            let picture;
            try {
              picture = await o.image(await read(attachment.file));
              await room(224);
              const k = Math.min(523 / picture.width, 195 / picture.height), w = picture.width * k, height = picture.height * k;
              if (!Number.isFinite(k) || k <= 0) throw new Error('изображение не читается');
              ctx.drawImage(picture, 36 + (523 - w) / 2, y, w, height); y += height + 4;
              await text(row.title + ' · ' + label + ' · ' + attachment.file, 9, false, '#526278'); y += 6;
            } catch (e) { await warning(row.title + ': фото ' + attachment.file + ' не загружено - ' + e.message); }
            finally { if (picture && picture.close) picture.close(); }
          }
        }
        if (!row.before.length && !row.after.length) await text('Фотографии к замечанию не приложены.', 10, false, '#657082');
      }
      if (o.kind === 'prescription') {
        await room(100); y += 18;
        await text('Выдал: ' + (o.issuer || o.project.supervisor || '________________') + '    Подпись: ______________');
        await text('Получил: __________________________    Подпись: ______________');
        await text('Дата получения: ___________________');
      }
      if (warnings.length) {
        await page(); await text('Отчёт сформирован не полностью', 17, true, '#b42318');
        await text('Недоступные вложения перечислены ниже. Синхронизируйте исходные файлы и сформируйте отчёт повторно.');
        for (const w of warnings) await text(w, 10);
      }
      await finish(); return { bytes: pdf(images), warnings, pages: pageNo, count: selected.length };
    } finally { for (const value of sheets.values()) if (value.pdf) await value.pdf.destroy(); }
  }
  const api = { rows, selectRows, filename, geometry, drawingPanel, lines, pdf, build };
  if (node) module.exports = api; else root.ProrabRemarksReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
