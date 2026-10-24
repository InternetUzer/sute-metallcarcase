/*
 * «Прораб+» в браузере — разбор чертежа DXF (текстовый формат AutoCAD), как в приложении (DxfParser.kt).
 * Всё переводится в ломаные и тексты. Поддерживается: LINE, LWPOLYLINE/POLYLINE (с дугами), CIRCLE, ARC,
 * ELLIPSE, SPLINE, TEXT, MTEXT, INSERT (блоки, вложенные, массивы), DIMENSION, SOLID/TRACE/3DFACE, LEADER,
 * HATCH (контуры), ATTRIB.
 * Координаты сдвинуты на origin (настоящие = сдвинутые + origin) — как в телефоне; пометки хранят настоящие.
 * Без DOM — проверяется тестами в Node.
 */
(function (root) {
  'use strict';

  // ───── цвета AutoCAD (ACI) → '#rrggbb' ─────
  const BASE = [0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0];
  function hsv(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const ch = (f) => Math.max(0, Math.min(255, Math.round((f + m) * 255)));
    return (ch(r) << 16) | (ch(g) << 8) | ch(b);
  }
  function aciRgb(index) {
    const i = Math.abs(index);
    if (i <= 9) return BASE[i];
    if (i <= 249) {
      const v = i % 10;
      return hsv((Math.floor(i / 10) - 1) * 15, v % 2 === 0 ? 1 : 0.5, [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][v]);
    }
    if (i <= 255) { const g = Math.max(0, Math.min(255, Math.round(51 + (i - 250) * 40.8))); return (g << 16) | (g << 8) | g; }
    return 0xffffff;
  }
  const hex = (rgb) => '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');
  const aci = (i) => hex(aciRgb(i));

  // ───── преобразования: x' = a x + b y + e; y' = c x + d y + f ─────
  const X = {
    ID: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    MIRROR_X: { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    move: (x, y) => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y }),
    rot(deg) { const r = deg * Math.PI / 180; return { a: Math.cos(r), b: -Math.sin(r), c: Math.sin(r), d: Math.cos(r), e: 0, f: 0 }; },
    scale: (sx, sy) => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }),
    /** t ∘ o: сначала o, потом t. */
    then: (t, o) => ({
      a: t.a * o.a + t.b * o.c, b: t.a * o.b + t.b * o.d, c: t.c * o.a + t.d * o.c, d: t.c * o.b + t.d * o.d,
      e: t.a * o.e + t.b * o.f + t.e, f: t.c * o.e + t.d * o.f + t.f,
    }),
    det: (t) => t.a * t.d - t.b * t.c,
  };

  // ───── чтение текста ─────
  function decode(bytes) {
    const head = latin1(bytes.subarray(0, Math.min(bytes.length, 40000)));
    const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d+)/.exec(head);
    const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(head);
    if (ver && ver[1] >= 'AC1021') return new TextDecoder('utf-8').decode(bytes);
    if (cp) {
      const num = /(\d{3,4})/.exec(cp[1]);
      if (num) { try { return new TextDecoder('windows-' + num[1]).decode(bytes); } catch (e) { /* неизвестная кодировка */ } }
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('windows-1251').decode(bytes); }
  }
  function latin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return s;
  }

  const unicodeEscapes = (s) => s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  function special(raw) {
    return unicodeEscapes(raw).replace(/%%c/gi, 'Ø').replace(/%%d/gi, '°').replace(/%%p/gi, '±')
      .replace(/%%u/gi, '').replace(/%%o/gi, '').replace(/%%%/g, '%');
  }
  function mtextClean(raw) {
    let s = raw.split('\\P').join('\n').split('\\~').join(' ');
    s = s.replace(/\\S([^;^/#]*)[\^/#]([^;]*);/g, '$1/$2');
    s = s.replace(/\\[fFcCHhTtQqWwAap][^;]*;/g, '');
    s = s.replace(/\\[LlOoKkNX]/g, '');
    s = s.replace(/[{}]/g, '').split('\\\\').join('\\');
    return special(s);
  }

  /** Объект DXF: тип и пары «код — значение». */
  class Ent {
    constructor(type, g) { this.type = type; this.g = g; }
    str(code) { for (const x of this.g) if (x[0] === code) return x[1]; return null; }
    dbl(code, def) { const s = this.str(code); const v = s === null ? NaN : parseFloat(s); return Number.isFinite(v) ? v : (def === undefined ? 0 : def); }
    int(code, def) { const s = this.str(code); const v = s === null ? NaN : Math.trunc(parseFloat(s)); return Number.isFinite(v) ? v : (def === undefined ? 0 : def); }
    all(code) { return this.g.filter((x) => x[0] === code).map((x) => x[1]); }
    nums(code) { return this.all(code).map((s) => parseFloat(s)).filter(Number.isFinite); }
    get layer() { const s = this.str(8); return s === null ? '0' : s.trim() || '0'; }
    get paper() { return this.int(67) === 1; }
  }

  function readEntities(text) {
    const out = [];
    let type = null, groups = [];
    const lines = text.split('\n');
    for (let k = 0; k + 1 < lines.length; k += 2) {
      const codeLine = lines[k].trim();
      if (!/^-?\d+$/.test(codeLine)) { k--; continue; } // сбилась пара — ищем следующую строку с кодом
      const code = parseInt(codeLine, 10);
      let v = lines[k + 1];
      if (v.endsWith('\r')) v = v.slice(0, -1);
      if (code === 0) {
        if (type !== null) out.push(new Ent(type, groups));
        type = v.trim(); groups = [];
        if (type === 'EOF') { type = null; break; }
      } else {
        v = code === 1 || code === 3 ? v.replace(/ +$/, '') : v.trim();
        if (v.indexOf('\\U+') >= 0) v = unicodeEscapes(v);
        groups.push([code, v]);
      }
    }
    if (type !== null) out.push(new Ent(type, groups));
    return out;
  }

  /** POLYLINE+VERTEX…SEQEND и INSERT+ATTRIB…SEQEND → { e, kids }. */
  function group(list) {
    const out = [];
    for (let i = 0; i < list.length;) {
      const e = list[i];
      if (e.type === 'POLYLINE' || (e.type === 'INSERT' && e.int(66) === 1)) {
        const kids = [];
        let j = i + 1;
        while (j < list.length && list[j].type !== 'SEQEND' && (list[j].type === 'VERTEX' || list[j].type === 'ATTRIB')) kids.push(list[j++]);
        if (j < list.length && list[j].type === 'SEQEND') j++;
        out.push({ e, kids });
        i = j;
      } else { out.push({ e, kids: [] }); i++; }
    }
    return out;
  }

  function arcPoints(cx, cy, r, a0, sweep) {
    const n = Math.max(8, Math.ceil(Math.abs(sweep) / (2 * Math.PI) * 72));
    const xs = [], ys = [];
    for (let k = 0; k <= n; k++) { const a = a0 + sweep * k / n; xs.push(cx + r * Math.cos(a)); ys.push(cy + r * Math.sin(a)); }
    return [xs, ys];
  }

  function bulgePath(px, py, bulges, closed) {
    const n = Math.min(px.length, py.length);
    if (!n) return [[], []];
    const xs = [px[0]], ys = [py[0]];
    const segs = closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const x1 = px[k], y1 = py[k], x2 = px[(k + 1) % n], y2 = py[(k + 1) % n];
      const b = bulges[k] || 0;
      if (Math.abs(b) < 1e-9) { xs.push(x2); ys.push(y2); continue; }
      const theta = 4 * Math.atan(b);
      const dx = x2 - x1, dy = y2 - y1, c = Math.hypot(dx, dy);
      if (c < 1e-12) continue;
      const r = c / (2 * Math.sin(theta / 2)), hh = r * Math.cos(theta / 2);
      const cx = (x1 + x2) / 2 - dy / c * hh, cy = (y1 + y2) / 2 + dx / c * hh;
      const [ax, ay] = arcPoints(cx, cy, Math.abs(r), Math.atan2(y1 - cy, x1 - cx), theta);
      for (let m = 1; m < ax.length; m++) { xs.push(ax[m]); ys.push(ay[m]); }
    }
    return [xs, ys];
  }

  /**
   * Разобрать DXF. bytes — Uint8Array. Результат:
   * { layers: { имя: { name, color, visible } }, lines: [{ layer, color, pts: Float64Array, closed }],
   *   texts: [{ layer, color, x, y, height, rotation, text, align }], originX, originY, minX, minY, maxX, maxY,
   *   units, has3d, warnings }
   */
  function parse(bytes) {
    if (bytes.length > 18 && latin1(bytes.subarray(0, 18)) === 'AutoCAD Binary DXF') {
      throw new Error('Это двоичный DXF. Сохраните чертёж как DXF в текстовом (ASCII) формате.');
    }
    const layers = {}, lines = [], texts = [], warnings = [], blocks = {}, unsupported = new Set();
    let oX = NaN, oY = NaN, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, has3d = false, units = 0;

    const ents = readEntities(decode(bytes));
    let section = '', curBlock = null, curBase = [0, 0], blockEnts = [];
    const entities = [];
    const readHeader = (e) => { for (let k = 0; k + 1 < e.g.length; k++) if (e.g[k][0] === 9 && e.g[k][1] === '$INSUNITS') units = parseInt(e.g[k + 1][1], 10) || 0; };
    for (const e of ents) {
      if (e.type === 'SECTION') { section = (e.str(2) || '').trim(); if (section === 'HEADER') readHeader(e); }
      else if (e.type === 'ENDSEC') section = '';
      else if (section === 'HEADER') readHeader(e);
      else if (section === 'TABLES' && e.type === 'LAYER') {
        const name = (e.str(2) || '').trim();
        if (!name) continue;
        const idx = e.int(62, 7), flags = e.int(70), tc = e.str(420);
        const color = tc !== null && Number.isFinite(parseInt(tc, 10)) ? hex(parseInt(tc, 10)) : aci(idx === 0 ? 7 : idx);
        layers[name] = { name, color, visible: idx >= 0 && (flags & 1) === 0 };
      } else if (section === 'BLOCKS') {
        if (e.type === 'BLOCK') { curBlock = ((e.str(2) || e.str(3) || '').trim()) || null; curBase = [e.dbl(10), e.dbl(20)]; blockEnts = []; }
        else if (e.type === 'ENDBLK') { if (curBlock) blocks[curBlock.toUpperCase()] = { bx: curBase[0], by: curBase[1], items: group(blockEnts) }; curBlock = null; }
        else if (curBlock) blockEnts.push(e);
      } else if (section === 'ENTITIES') entities.push(e);
    }

    const ensureLayer = (name) => { if (!layers[name]) layers[name] = { name, color: aci(7), visible: true }; };
    const layerOf = (e, parent) => (e.layer === '0' && parent ? parent : e.layer);
    const colorOf = (e, layer, parentColor) => {
      const tc = e.str(420);
      if (tc !== null && Number.isFinite(parseInt(tc, 10))) return hex(parseInt(tc, 10));
      const idx = e.int(62, 256);
      if (idx === 256) return layers[layer] ? layers[layer].color : aci(7);
      if (idx === 0) return parentColor || (layers[layer] ? layers[layer].color : aci(7));
      return aci(idx);
    };
    const point = (x, y) => {
      if (Number.isNaN(oX)) { oX = Math.floor(x); oY = Math.floor(y); }
      const fx = x - oX, fy = y - oY;
      if (fx < minX) minX = fx; if (fx > maxX) maxX = fx;
      if (fy < minY) minY = fy; if (fy > maxY) maxY = fy;
      return [fx, fy];
    };
    const emit = (layer, color, xs, ys, closed, t) => {
      const n = Math.min(xs.length, ys.length);
      if (n < 2) return;
      ensureLayer(layer);
      const pts = new Float64Array(n * 2);
      for (let k = 0; k < n; k++) {
        const x = xs[k], y = ys[k];
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const p = point(t.a * x + t.b * y + t.e, t.c * x + t.d * y + t.f);
        pts[k * 2] = p[0]; pts[k * 2 + 1] = p[1];
      }
      lines.push({ layer, color, pts, closed });
    };
    const emitText = (layer, color, x, y, hgt, rotDeg, s, align, t) => {
      if (!s || !s.trim()) return;
      ensureLayer(layer);
      const p = point(t.a * x + t.b * y + t.e, t.c * x + t.d * y + t.f);
      let rot = rotDeg + Math.atan2(t.c, t.a) * 180 / Math.PI;
      if (X.det(t) < 0) rot = 180 - rot;
      texts.push({ layer, color, x: p[0], y: p[1], height: hgt * Math.sqrt(Math.abs(X.det(t))), rotation: rot, text: s, align });
    };
    const ocs = (e) => (e.dbl(230, 1) < 0 ? X.MIRROR_X : X.ID);

    function spline(e, layer, color, t) {
      const deg = e.int(71, 3), knots = e.nums(40), cx = e.nums(10), cy = e.nums(20), w = e.nums(41);
      const n = Math.min(cx.length, cy.length);
      if (n >= 2 && knots.length === n + deg + 1 && deg >= 1) {
        const wt = w.length === n ? w : new Array(n).fill(1);
        const t0 = knots[deg], t1 = knots[n], samples = Math.max(24, n * 10);
        const xs = [], ys = [];
        for (let s = 0; s <= samples; s++) {
          const u = s === samples ? t1 - 1e-9 * (t1 - t0) : t0 + (t1 - t0) * s / samples;
          let k = deg;
          while (k < n - 1 && u >= knots[k + 1]) k++;
          const dx = [], dy = [], dw = [];
          for (let j = 0; j <= deg; j++) { const q = k - deg + j; dx.push(cx[q] * wt[q]); dy.push(cy[q] * wt[q]); dw.push(wt[q]); }
          for (let rr = 1; rr <= deg; rr++) for (let j = deg; j >= rr; j--) {
            const i = k - deg + j, den = knots[i + deg - rr + 1] - knots[i], a = den === 0 ? 0 : (u - knots[i]) / den;
            dx[j] = (1 - a) * dx[j - 1] + a * dx[j]; dy[j] = (1 - a) * dy[j - 1] + a * dy[j]; dw[j] = (1 - a) * dw[j - 1] + a * dw[j];
          }
          xs.push(dx[deg] / dw[deg]); ys.push(dy[deg] / dw[deg]);
        }
        emit(layer, color, xs, ys, false, t);
        return;
      }
      const fx = e.nums(11), fy = e.nums(21);
      if (fx.length >= 2) {
        const m = Math.min(fx.length, fy.length), xs = [], ys = [];
        for (let i = 0; i < m - 1; i++) {
          const x0 = fx[Math.max(i - 1, 0)], y0 = fy[Math.max(i - 1, 0)], x1 = fx[i], y1 = fy[i], x2 = fx[i + 1], y2 = fy[i + 1];
          const x3 = fx[Math.min(i + 2, m - 1)], y3 = fy[Math.min(i + 2, m - 1)];
          for (let s2 = 0; s2 < 16; s2++) {
            const u = s2 / 16, u2 = u * u, u3 = u2 * u;
            xs.push(0.5 * (2 * x1 + (-x0 + x2) * u + (2 * x0 - 5 * x1 + 4 * x2 - x3) * u2 + (-x0 + 3 * x1 - 3 * x2 + x3) * u3));
            ys.push(0.5 * (2 * y1 + (-y0 + y2) * u + (2 * y0 - 5 * y1 + 4 * y2 - y3) * u2 + (-y0 + 3 * y1 - 3 * y2 + y3) * u3));
          }
        }
        xs.push(fx[m - 1]); ys.push(fy[m - 1]);
        emit(layer, color, xs, ys, false, t);
      } else if (n >= 2) emit(layer, color, cx.slice(0, n), cy.slice(0, n), false, t);
    }

    function hatch(e, layer, color, t) {
      const g = e.g;
      let k = g.findIndex((x) => x[0] === 91);
      if (k < 0) return;
      const loops = parseInt(g[k][1], 10) || 0;
      k++;
      const num = (code) => { while (k < g.length && g[k][0] !== code) k++; const v = k < g.length ? parseFloat(g[k][1]) || 0 : 0; k++; return v; };
      const tt = X.then(t, ocs(e));
      for (let l = 0; l < loops; l++) {
        while (k < g.length && g[k][0] !== 92) k++;
        if (k >= g.length) return;
        const type = parseInt(g[k][1], 10) || 0;
        k++;
        if (type & 2) {
          let hasBulge = false, closed = false;
          while (k < g.length && g[k][0] !== 93) { if (g[k][0] === 72) hasBulge = g[k][1] === '1'; if (g[k][0] === 73) closed = g[k][1] === '1'; k++; }
          let count = 0;
          if (k < g.length) { count = parseInt(g[k][1], 10) || 0; k++; }
          const px = [], py = [], pb = [];
          for (let c = 0; c < count; c++) {
            while (k < g.length && g[k][0] !== 10) k++;
            if (k >= g.length) break;
            px.push(parseFloat(g[k][1]) || 0); k++;
            py.push(num(20));
            let bulge = 0;
            if (hasBulge && k < g.length && g[k][0] === 42) { bulge = parseFloat(g[k][1]) || 0; k++; }
            pb.push(bulge);
          }
          void closed;
          const [xs, ys] = bulgePath(px, py, pb, true);
          emit(layer, color, xs, ys, false, tt);
        } else {
          while (k < g.length && g[k][0] !== 93) k++;
          if (k >= g.length) return;
          const edges = parseInt(g[k][1], 10) || 0;
          k++;
          for (let c = 0; c < edges; c++) {
            while (k < g.length && g[k][0] !== 72) k++;
            if (k >= g.length) return;
            const et = parseInt(g[k][1], 10) || 1;
            k++;
            if (et === 1) {
              const x1 = num(10), y1 = num(20), x2 = num(11), y2 = num(21);
              emit(layer, color, [x1, x2], [y1, y2], false, tt);
            } else if (et === 2) {
              const cx = num(10), cy = num(20), r = num(40), a0 = num(50) * Math.PI / 180, a1 = num(51) * Math.PI / 180, ccw = num(73) !== 0;
              let sweep = a1 - a0;
              while (sweep <= 0) sweep += 2 * Math.PI;
              const [xs, ys] = ccw ? arcPoints(cx, cy, r, a0, sweep) : arcPoints(cx, cy, r, -a0, -sweep);
              emit(layer, color, xs, ys, false, tt);
            }
          }
        }
      }
    }

    function draw(item, t, parentLayer, parentColor, depth) {
      const e = item.e;
      const layer = layerOf(e, parentLayer), color = colorOf(e, layer, parentColor);
      switch (e.type) {
        case 'LINE':
          if (Math.abs(e.dbl(30) - e.dbl(31)) > 1e-6) has3d = true;
          emit(layer, color, [e.dbl(10), e.dbl(11)], [e.dbl(20), e.dbl(21)], false, t);
          break;
        case 'LWPOLYLINE': {
          const xs = [], ys = [], bulges = [];
          let idx = -1;
          for (const [code, v] of e.g) {
            if (code === 10) { idx++; xs.push(parseFloat(v) || 0); bulges.push(0); }
            else if (code === 20) ys.push(parseFloat(v) || 0);
            else if (code === 42 && idx >= 0) bulges[idx] = parseFloat(v) || 0;
          }
          const [px, py] = bulgePath(xs, ys.slice(0, xs.length), bulges, (e.int(70) & 1) === 1);
          emit(layer, color, px, py, false, X.then(t, ocs(e)));
          break;
        }
        case 'POLYLINE': {
          const flags = e.int(70);
          if (flags & (8 | 16 | 64)) has3d = true;
          if (!(flags & 64)) {
            const verts = item.kids.filter((v) => v.type === 'VERTEX' && (v.int(70) & 128) === 0);
            const [xs, ys] = bulgePath(verts.map((v) => v.dbl(10)), verts.map((v) => v.dbl(20)), verts.map((v) => v.dbl(42)), (flags & 1) === 1);
            emit(layer, color, xs, ys, false, flags & 8 ? t : X.then(t, ocs(e)));
          } else {
            const all = item.kids.filter((v) => v.type === 'VERTEX');
            const pos = all.filter((v) => v.int(70) & 64);
            all.filter((v) => (v.int(70) & 128) && !(v.int(70) & 64)).forEach((f) => {
              const ids = [71, 72, 73, 74].map((c) => Math.abs(f.int(c))).filter((i) => i > 0 && i <= pos.length);
              if (ids.length >= 3) emit(layer, color, ids.map((i) => pos[i - 1].dbl(10)), ids.map((i) => pos[i - 1].dbl(20)), true, t);
            });
          }
          break;
        }
        case 'CIRCLE': {
          const [xs, ys] = arcPoints(e.dbl(10), e.dbl(20), e.dbl(40), 0, 2 * Math.PI);
          emit(layer, color, xs, ys, true, X.then(t, ocs(e)));
          break;
        }
        case 'ARC': {
          const a0 = e.dbl(50) * Math.PI / 180;
          let a1 = e.dbl(51) * Math.PI / 180;
          while (a1 <= a0) a1 += 2 * Math.PI;
          const [xs, ys] = arcPoints(e.dbl(10), e.dbl(20), e.dbl(40), a0, a1 - a0);
          emit(layer, color, xs, ys, false, X.then(t, ocs(e)));
          break;
        }
        case 'ELLIPSE': {
          const cx = e.dbl(10), cy = e.dbl(20), mx = e.dbl(11), my = e.dbl(21), ratio = e.dbl(40, 1), t0 = e.dbl(41, 0);
          let t1 = e.dbl(42, 2 * Math.PI);
          while (t1 <= t0) t1 += 2 * Math.PI;
          const n = Math.max(16, Math.ceil((t1 - t0) / (2 * Math.PI) * 96));
          const xs = [], ys = [];
          for (let k = 0; k <= n; k++) {
            const u = t0 + (t1 - t0) * k / n;
            xs.push(cx + mx * Math.cos(u) - my * ratio * Math.sin(u)); ys.push(cy + my * Math.cos(u) + mx * ratio * Math.sin(u));
          }
          emit(layer, color, xs, ys, false, X.then(t, ocs(e)));
          break;
        }
        case 'SPLINE': spline(e, layer, color, t); break;
        case 'TEXT': case 'ATTRIB': {
          if (e.type === 'ATTRIB' && (e.int(70) & 1)) break;
          const hh = e.dbl(40, 2.5), hAl = e.int(72), vAl = e.int(e.type === 'ATTRIB' ? 74 : 73);
          const useAlign = hAl !== 0 || vAl !== 0;
          let x = useAlign && e.str(11) !== null ? e.dbl(11) : e.dbl(10);
          let y = useAlign && e.str(21) !== null ? e.dbl(21) : e.dbl(20);
          const rot = e.dbl(50), shift = vAl === 2 ? -hh / 2 : vAl === 3 ? -hh : 0, r = rot * Math.PI / 180;
          x += -Math.sin(r) * shift; y += Math.cos(r) * shift;
          const align = hAl === 1 || hAl === 4 ? 1 : hAl === 2 ? 2 : 0;
          const o = ocs(e);
          emitText(layer, color, o.a * x + o.b * y, o.c * x + o.d * y, hh, X.det(o) < 0 ? 180 - rot : rot, special(e.str(1) || ''), align, t);
          break;
        }
        case 'MTEXT': {
          const hh = e.dbl(40, 2.5);
          const rows = mtextClean(e.all(3).join('') + (e.str(1) || '')).split('\n');
          const rot = e.str(11) !== null ? Math.atan2(e.dbl(21), e.dbl(11)) * 180 / Math.PI : e.dbl(50);
          const att = Math.max(1, Math.min(9, e.int(71, 1)));
          const align = (att - 1) % 3, row = Math.floor((att - 1) / 3), step = hh * 1.6;
          const total = hh + step * (rows.length - 1), top = row === 0 ? 0 : row === 1 ? total / 2 : total, r = rot * Math.PI / 180;
          rows.forEach((s, k) => {
            const down = top - hh - step * k;
            emitText(layer, color, e.dbl(10) - Math.sin(r) * down, e.dbl(20) + Math.cos(r) * down, hh, rot, s, align, t);
          });
          break;
        }
        case 'INSERT': {
          if (depth > 12) break;
          const block = blocks[(e.str(2) || '').trim().toUpperCase()];
          if (block) {
            const sx = e.dbl(41, 1), sy = e.dbl(42, 1), cols = Math.max(1, e.int(70, 1)), rws = Math.max(1, e.int(71, 1));
            const colSp = e.dbl(44), rowSp = e.dbl(45), rot = e.dbl(50);
            for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rws; ri++) {
              const local = X.then(X.rot(rot), X.move(ci * colSp, ri * rowSp));
              let m = X.then(X.then(X.then(t, ocs(e)), X.move(e.dbl(10), e.dbl(20))), local);
              m = X.then(X.then(m, X.scale(sx, sy)), X.move(-block.bx, -block.by));
              for (const it of block.items) draw(it, m, layer, color, depth + 1);
            }
          }
          item.kids.filter((k) => k.type === 'ATTRIB').forEach((k) => draw({ e: k, kids: [] }, t, parentLayer, parentColor, depth));
          break;
        }
        case 'DIMENSION': {
          if (depth > 12) break;
          const block = blocks[(e.str(2) || '').trim().toUpperCase()];
          if (block) for (const it of block.items) draw(it, X.then(t, X.move(-block.bx, -block.by)), layer, color, depth + 1);
          break;
        }
        case 'SOLID': case 'TRACE': case '3DFACE': {
          if (e.type === '3DFACE') has3d = true;
          const p = [[10, 20], [11, 21], [12, 22], [13, 23]].map(([a, b]) => [e.dbl(a), e.dbl(b)]);
          const order = e.type === '3DFACE' ? [0, 1, 2, 3] : [0, 1, 3, 2];
          const q = [];
          order.forEach((i) => { if (!q.some((v) => v[0] === p[i][0] && v[1] === p[i][1])) q.push(p[i]); });
          emit(layer, color, q.map((v) => v[0]), q.map((v) => v[1]), true, X.then(t, ocs(e)));
          break;
        }
        case 'LEADER': {
          const xs = e.nums(10), ys = e.nums(20);
          emit(layer, color, xs, ys.slice(0, xs.length), false, t);
          break;
        }
        case 'HATCH': hatch(e, layer, color, t); break;
        case 'POINT': case 'VIEWPORT': case 'ATTDEF': case 'SEQEND': case 'VERTEX': case 'IMAGE': case 'WIPEOUT': case 'XLINE': case 'RAY': case 'OLE2FRAME': break;
        case '3DSOLID': case 'BODY': case 'REGION': case 'SURFACE': case 'MESH': case 'PLANESURFACE': case 'EXTRUDEDSURFACE':
          has3d = true; unsupported.add(e.type); break;
        default: unsupported.add(e.type);
      }
    }

    let broken = 0;
    for (const item of group(entities)) {
      if (item.e.paper) continue;
      try { draw(item, X.ID, null, null, 0); } catch (err) { broken++; }
    }
    if (broken) warnings.push('Пропущено повреждённых объектов: ' + broken);
    if (unsupported.size) warnings.push('Не показаны объекты: ' + Array.from(unsupported).sort().join(', '));
    if (!lines.length && !texts.length) {
      minX = 0; minY = 0; maxX = 1; maxY = 1;
      warnings.push('В чертеже не найдено объектов для показа (пространство модели пустое).');
    }
    const d = {
      layers, lines, texts, originX: Number.isNaN(oX) ? 0 : oX, originY: Number.isNaN(oY) ? 0 : oY,
      minX, minY, maxX, maxY, units, has3d, warnings,
    };
    d.fitBox = fitBox(d);
    return d;
  }

  /** Рамка «весь чертёж» без одиночных далёких объектов (как в приложении). */
  function fitBox(d) {
    const { lines, texts } = d;
    if (lines.length + texts.length < 10) return [d.minX, d.minY, d.maxX, d.maxY];
    const boxes = lines.map((pl) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < pl.pts.length; i += 2) {
        const x = pl.pts[i], y = pl.pts[i + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return [x0, y0, x1, y1];
    });
    const cx = boxes.map((b) => (b[0] + b[2]) / 2).concat(texts.map((t) => t.x)).sort((a, b) => a - b);
    const cy = boxes.map((b) => (b[1] + b[3]) / 2).concat(texts.map((t) => t.y)).sort((a, b) => a - b);
    const q = (a, f) => a[Math.floor((a.length - 1) * f)];
    const c0 = q(cx, 0.05), c1 = q(cx, 0.95), d0 = q(cy, 0.05), d1 = q(cy, 0.95);
    const w = Math.max(c1 - c0, d1 - d0, 1e-3) * 3;
    const ax0 = c0 - w, ax1 = c1 + w, ay0 = d0 - w, ay1 = d1 + w;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes) {
      if (b[0] >= ax0 && b[2] <= ax1 && b[1] >= ay0 && b[3] <= ay1) {
        if (b[0] < x0) x0 = b[0]; if (b[2] > x1) x1 = b[2]; if (b[1] < y0) y0 = b[1]; if (b[3] > y1) y1 = b[3];
      }
    }
    for (const t of texts) {
      if (t.x >= ax0 && t.x <= ax1 && t.y >= ay0 && t.y <= ay1) {
        if (t.x < x0) x0 = t.x; if (t.x > x1) x1 = t.x; if (t.y < y0) y0 = t.y; if (t.y > y1) y1 = t.y;
      }
    }
    return x0 > x1 || y0 > y1 ? [c0, d0, c1, d1] : [x0, y0, x1, y1];
  }

  /** Ближайший узел видимых слоёв в радиусе (координаты со сдвигом) — для привязки пометки. */
  function snap(d, x, y, radius, hidden) {
    let best = radius * radius, bx = 0, by = 0, found = false;
    for (const pl of d.lines) {
      if (hidden && hidden.has(pl.layer)) continue;
      for (let k = 0; k < pl.pts.length; k += 2) {
        const dx = pl.pts[k] - x, dy = pl.pts[k + 1] - y, dd = dx * dx + dy * dy;
        if (dd < best) { best = dd; bx = pl.pts[k]; by = pl.pts[k + 1]; found = true; }
      }
    }
    return found ? [bx, by] : null;
  }

  const unitsName = (u) => ({ 1: 'дюйм', 2: 'фут', 4: 'мм', 5: 'см', 6: 'м', 7: 'км' }[u] || 'ед.');

  /** Тип чертежа по имени и первым байтам: 'pdf', 'dxf', 'dwg' или null. */
  function kindOf(name, head) {
    const ext = String(name).includes('.') ? String(name).split('.').pop().toLowerCase() : '';
    if (ext === 'pdf' || ext === 'dxf' || ext === 'dwg') return ext;
    const t = head ? latin1(head.subarray(0, 256)) : '';
    if (t.startsWith('%PDF')) return 'pdf';
    if (t.startsWith('AC10')) return 'dwg';
    if (t.includes('SECTION')) return 'dxf';
    return null;
  }

  const api = { parse, fitBox, snap, aci, unitsName, kindOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabDxf = api;
})(typeof window !== 'undefined' ? window : globalThis);
