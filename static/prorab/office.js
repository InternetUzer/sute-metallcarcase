/*
 * «Прораб+» в браузере — новые пустые документы Word (.docx) и таблицы Excel (.xlsx), собранные прямо
 * в браузере (минимальный Office Open XML в zip без сжатия). Открываются в Яндекс Документах, Word и Excel.
 */
(function (root) {
  'use strict';
  const enc = new TextEncoder();

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** zip без сжатия: [{ name, text }] → Uint8Array. */
  function zip(entries) {
    const parts = [], central = [];
    let offset = 0;
    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
    const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    for (const e of entries) {
      const name = enc.encode(e.name);
      const data = typeof e.text === 'string' ? enc.encode(e.text) : e.text;
      const crc = crc32(data);
      // Время 00:00, дата 1980-01-01 — не важна; флаг 0x0800 — имена в UTF-8
      const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      parts.push(new Uint8Array(head), name, data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += head.length + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    const all = parts.concat(central, [end]);
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let i = 0;
    for (const p of all) { out.set(p, i); i += p.length; }
    return out;
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const RELS = XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="%T"/></Relationships>';

  /** Документ Word: заголовок (необязательно) и пустой абзац. */
  function docx(title) {
    const para = (t, bold) => '<w:p>' + (t ? '<w:r>' + (bold ? '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>' : '') + '</w:p>';
    return zip([
      { name: '[Content_Types].xml', text: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
      { name: '_rels/.rels', text: RELS.replace('%T', 'word/document.xml') },
      { name: 'word/document.xml', text: XML + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + (title ? para(title, true) : '') + para('') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>' },
    ]);
  }

  /** Таблица Excel: один лист; [rows] — строки текста/чисел (необязательно). */
  function xlsx(rows, sheetName) {
    const col = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    const cells = (rows || []).map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
      const ref = col(ci) + (ri + 1);
      if (typeof v === 'number' && Number.isFinite(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
      if (v === null || v === undefined || v === '') return '';
      return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
    }).join('') + '</row>').join('');
    return zip([
      { name: '[Content_Types].xml', text: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
      { name: '_rels/.rels', text: RELS.replace('%T', 'xl/workbook.xml') },
      { name: 'xl/workbook.xml', text: XML + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + esc((sheetName || 'Лист1').slice(0, 31)) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', text: XML + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + cells + '</sheetData></worksheet>' },
    ]);
  }

  const api = { zip, crc32, docx, xlsx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabOffice = api;
})(typeof window !== 'undefined' ? window : globalThis);
