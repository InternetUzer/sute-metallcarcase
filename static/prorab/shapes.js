/*
 * «Прораб+» — свои линии на чертеже (этап 1 «упрощённого автокада»): линия, ломаная, прямоугольник, размер, текст, площадь.
 * Тот же формат, что в приложении (ShapeCore.kt): таблица drawing_shapes, точки «x,y;x,y» в настоящих координатах
 * (у DXF — координаты чертежа, у PDF — точки листа), value — длина размера в метрах или площадь в м²
 * по масштабу на момент построения. Без DOM — проверяется тестами в Node.
 */
(function (root) {
  'use strict';
  const KINDS = [
    { code: 'line', title: 'Линия', min: 2, max: 2 },
    { code: 'polyline', title: 'Ломаная', min: 2, max: null },
    { code: 'rect', title: 'Прямоугольник', min: 2, max: 2 },
    { code: 'dim', title: 'Размер', min: 2, max: 2 },
    { code: 'text', title: 'Текст', min: 1, max: 1 },
    { code: 'area', title: 'Площадь', min: 3, max: null },
  ];
  const COLORS = [
    { hex: '#FF3B30', title: 'Красный', aci: 1 },
    { hex: '#007AFF', title: 'Синий', aci: 5 },
    { hex: '#34C759', title: 'Зелёный', aci: 3 },
    { hex: '#FF9500', title: 'Оранжевый', aci: 30 },
    { hex: '#AF52DE', title: 'Фиолетовый', aci: 6 },
    { hex: '#1C1C1E', title: 'Чёрный', aci: 7 },
  ];
  const kindOf = (code) => KINDS.find((k) => k.code === code) || KINDS[0];
  const TOOLS = KINDS.concat([{ code: 'angle', title: 'Замер угла', min: 3, max: 3 }]);
  const toolOf = (code) => TOOLS.find((k) => k.code === code) || KINDS[0];
  const colorOf = (hex) => COLORS.find((c) => c.hex.toLowerCase() === String(hex || '').toLowerCase()) || COLORS[0];

  function num(v) {
    let s = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s;
  }
  const encode = (pts) => pts.map((p) => num(p[0]) + ',' + num(p[1])).join(';');
  function decode(text) {
    const out = [];
    for (const part of String(text || '').split(';')) {
      const xy = part.split(',');
      if (xy.length !== 2) continue;
      const x = Number(xy[0].trim()), y = Number(xy[1].trim());
      if (xy[0].trim() === '' || xy[1].trim() === '' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      out.push([x, y]);
      if (out.length >= 10000) break;
    }
    return out;
  }
  const complete = (kind, pts) => { const k = toolOf(kind); return pts.length >= k.min && (k.max === null || pts.length <= k.max); };
  const rect = (a, b) => [a, [b[0], a[1]], b, [a[0], b[1]]];
  function segments(kind, pts) {
    if (kind === 'text') return [];
    if (kind === 'rect') { if (pts.length < 2) return []; const r = rect(pts[0], pts[1]); return r.map((p, i) => [p, r[(i + 1) % 4]]); }
    if (kind === 'area') { if (pts.length < 2) return []; const s = pts.map((p, i) => [p, pts[(i + 1) % pts.length]]); return pts.length === 2 ? s.slice(0, 1) : s; }
    const s = [];
    for (let i = 1; i < pts.length; i++) s.push([pts[i - 1], pts[i]]);
    return s;
  }
  const length = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };
  function area(pts) {
    if (pts.length < 3) return 0;
    let s = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(s) / 2;
  }
  function value(kind, pts, k) {
    if (k === null || k === undefined || !(k > 0)) return null;
    if (kind === 'dim') return pts.length >= 2 ? length(pts.slice(0, 2)) * k : null;
    if (kind === 'area') return area(pts) * k * k;
    return null;
  }
  const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const comma = (v, d) => v.toFixed(d).replace('.', ',');
  function formatMeters(m) {
    if (m < 10) return group(Math.round(m * 1000)) + ' мм';
    if (m < 10000) return comma(m, 2) + ' м';
    return comma(m / 1000, 2) + ' км';
  }
  function label(s) {
    const v = s.value;
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
    if (s.kind === 'dim') return formatMeters(Number(v));
    if (s.kind === 'area') return Number(v) < 10000 ? comma(Number(v), 2) + ' м²' : comma(Number(v), 0) + ' м²';
    if (s.kind === 'angle') return formatAngle(Number(v));
    return null;
  }
  function toSegment(x, y, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
    return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
  }
  /** s — { kind, points: [[x,y]], text, size } */
  function distance(s, x, y) {
    const p = s.points;
    if (!p.length) return Infinity;
    if (s.kind === 'text') {
      const h = s.size || 0, w = h * 0.6 * Math.max(1, String(s.text || '').length);
      const dx = x < p[0][0] ? p[0][0] - x : x > p[0][0] + w ? x - (p[0][0] + w) : 0;
      const dy = y < p[0][1] - h ? p[0][1] - h - y : y > p[0][1] + h ? y - (p[0][1] + h) : 0;
      return Math.hypot(dx, dy);
    }
    const segs = segments(s.kind, p);
    if (!segs.length) return Math.hypot(x - p[0][0], y - p[0][1]);
    return Math.min(...segs.map(([a, b]) => toSegment(x, y, a, b)));
  }
  function pick(shapes, x, y, tolerance) {
    let best = -1, bd = tolerance;
    shapes.forEach((s, i) => { const d = distance(s, x, y); if (d <= bd) { best = i; bd = d; } });
    return best;
  }
  const ortho = (from, to) => (Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]) ? [to[0], from[1]] : [from[0], to[1]]);
  const ANGLE_STEPS = [15, 30, 45, 90];
  const angleStep = (cfg) => {
    if (!cfg || !['line', 'polyline', 'dim', 'area'].includes(cfg.kind)) return 0;
    const step = Number(cfg.angleStep);
    return ANGLE_STEPS.includes(step) ? step : cfg.ortho ? 90 : 0;
  };
  /** Project onto the nearest allowed direction from the last point, relative to drawing axes. */
  function constrainAngle(from, to, step) {
    if (!ANGLE_STEPS.includes(step)) return to.slice();
    if (step === 90) return ortho(from, to);
    const dx = to[0] - from[0], dy = to[1] - from[1], increment = step * Math.PI / 180;
    const a = Math.round(Math.atan2(dy, dx) / increment) * increment;
    const clean = (v) => Math.abs(v) < 1e-12 ? 0 : v;
    const ux = clean(Math.cos(a)), uy = clean(Math.sin(a)), distance = dx * ux + dy * uy;
    return [from[0] + distance * ux, from[1] + distance * uy];
  }
  function onAngle(from, to, step) {
    const p = constrainAngle(from, to, step);
    const tolerance = 1e-8 * Math.max(1, Math.hypot(to[0] - from[0], to[1] - from[1]));
    return Math.hypot(p[0] - to[0], p[1] - to[1]) <= tolerance;
  }
  /** Three points: first arm, vertex, second arm. Returns the smaller angle (0–180°). */
  function measureAngle(pts) {
    if (pts.length !== 3) return null;
    const [a, v, b] = pts, ax = a[0] - v[0], ay = a[1] - v[1], bx = b[0] - v[0], by = b[1] - v[1];
    const al = Math.hypot(ax, ay), bl = Math.hypot(bx, by);
    if (!(al > 1e-9) || !(bl > 1e-9)) return null;
    const cross = ax / al * (by / bl) - ay / al * (bx / bl);
    const dot = ax / al * (bx / bl) + ay / al * (by / bl);
    return Math.atan2(Math.abs(cross), dot) * 180 / Math.PI;
  }
  const formatAngle = (degrees) => Number(degrees.toFixed(2)).toString().replace('.', ',') + '°';
  function angleLabelPoint(pts) {
    const [a, v, b] = pts, al = Math.hypot(a[0] - v[0], a[1] - v[1]), bl = Math.hypot(b[0] - v[0], b[1] - v[1]);
    if (!al || !bl) return v.slice();
    let x = (a[0] - v[0]) / al + (b[0] - v[0]) / bl, y = (a[1] - v[1]) / al + (b[1] - v[1]) / bl;
    if (Math.hypot(x, y) < 1e-9) { x = -(a[1] - v[1]) / al; y = (a[0] - v[0]) / al; }
    const r = Math.min(al, bl) * 0.3 / Math.hypot(x, y);
    return [v[0] + x * r, v[1] + y * r];
  }
  const center = (pts) => (pts.length ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] : [0, 0]);
  /** Запись таблицы → фигура для расчётов и рисования. */
  const fromRow = (r) => ({ id: r.id, kind: kindOf(r.kind).code, points: decode(r.points), text: r.text || '', color: colorOf(r.color).hex, size: r.size === null || r.size === undefined ? null : Number(r.size), value: r.value === null || r.value === undefined ? null : Number(r.value), width: Number(r.width) || 2, page: r.page || 0 });

  /** Сколько метров в единице чертежа: DXF — по $INSUNITS (по умолчанию мм), PDF — по масштабу листа 1:N. */
  function metersPerUnit(isPdf, units, pdfScaleN) {
    if (isPdf) return pdfScaleN > 0 ? 0.0254 / 72 * pdfScaleN : null;
    return { 1: 0.0254, 2: 0.3048, 5: 0.01, 6: 1, 7: 1000, 14: 0.1 }[units] || 0.001;
  }

  // ───────── DXF (R12, ASCII; русский текст — \U+XXXX) ─────────
  function dxfText(s) {
    let out = '';
    for (const ch of String(s).replace(/\r/g, '').replace(/\n/g, ' ')) {
      const c = ch.codePointAt(0);
      if (c >= 32 && c <= 126) out += ch;
      else if (c > 0xffff) out += '?';
      else out += '\\U+' + c.toString(16).toUpperCase().padStart(4, '0');
    }
    return out;
  }
  function bounds(shapes) {
    const all = shapes.flatMap((s) => s.points);
    if (!all.length) return null;
    return [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
  }
  const defaultTextHeight = (shapes) => { const b = bounds(shapes); const h = b ? Math.max(b[2] - b[0], b[3] - b[1]) * 0.015 : 0; return h > 0 ? h : 2.5; };
  function dxf(shapes, defaultHeight, insUnits) {
    const out = [];
    const g = (code, v) => { out.push(String(code), typeof v === 'number' && !Number.isInteger(v) ? num(v) : typeof v === 'number' ? String(v) : String(v)); };
    const f = (code, v) => g(code, num(v));
    const layer = 'PRORAB_MARKUP';
    g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1251');
    if (insUnits) { g(9, '$INSUNITS'); g(70, insUnits); }
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, 1);
    g(0, 'LAYER'); g(2, layer); g(70, 0); g(62, 1); g(6, 'CONTINUOUS'); g(0, 'ENDTAB'); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    const line = (a, b, aci) => { g(0, 'LINE'); g(8, layer); g(62, aci); f(10, a[0]); f(20, a[1]); f(30, 0); f(11, b[0]); f(21, b[1]); f(31, 0); };
    const poly = (pts, closed, aci) => {
      g(0, 'POLYLINE'); g(8, layer); g(62, aci); g(66, 1); f(10, 0); f(20, 0); f(30, 0); g(70, closed ? 1 : 0);
      for (const p of pts) { g(0, 'VERTEX'); g(8, layer); f(10, p[0]); f(20, p[1]); f(30, 0); }
      g(0, 'SEQEND'); g(8, layer);
    };
    const text = (at, h, v, aci, centered) => {
      if (!String(v || '').trim()) return;
      g(0, 'TEXT'); g(8, layer); g(62, aci); f(10, at[0]); f(20, at[1]); f(30, 0); f(40, h); g(1, dxfText(v));
      if (centered) { g(72, 1); f(11, at[0]); f(21, at[1]); f(31, 0); }
    };
    for (const s of shapes) {
      const p = s.points, aci = colorOf(s.color).aci, h = s.size > 0 ? s.size : defaultHeight;
      if (s.kind === 'line' && p.length >= 2) line(p[0], p[1], aci);
      else if (s.kind === 'polyline' && p.length >= 2) poly(p, false, aci);
      else if (s.kind === 'rect' && p.length >= 2) poly(rect(p[0], p[1]), true, aci);
      else if (s.kind === 'area' && p.length >= 3) { poly(p, true, aci); text(center(p), h, label(s) || '', aci, true); }
      else if (s.kind === 'dim' && p.length >= 2) {
        const a = p[0], b = p[1], t = h * 0.5;
        line(a, b, aci);
        line([a[0] - t, a[1] - t], [a[0] + t, a[1] + t], aci);
        line([b[0] - t, b[1] - t], [b[0] + t, b[1] + t], aci);
        text([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + h * 0.6], h, label(s) || s.text, aci, true);
      } else if (s.kind === 'text' && p.length) text(p[0], h, s.text, aci, false);
    }
    g(0, 'ENDSEC'); g(0, 'EOF');
    return out.join('\n') + '\n';
  }

  // ───────── этап 2: правка фигур и объём в ведомость (как ShapeCore.kt) ─────────
  const translate = (pts, dx, dy) => pts.map((p) => [p[0] + dx, p[1] + dy]);
  /** Точки, за которые можно взяться: у прямоугольника — 4 угла. */
  const vertices = (kind, pts) => (kind === 'rect' && pts.length >= 2 ? rect(pts[0], pts[1]) : pts);
  function nearestVertex(kind, pts, x, y, tolerance) {
    let best = -1, bd = tolerance;
    vertices(kind, pts).forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d <= bd) { best = i; bd = d; } });
    return best;
  }
  /** Перенести точку index (из vertices) в to; у прямоугольника противоположный угол остаётся на месте. */
  function moveVertex(kind, pts, index, to) {
    if (kind === 'rect' && pts.length >= 2) { const r = rect(pts[0], pts[1]); if (index < 0 || index > 3) return pts; return [r[(index + 2) % 4], to]; }
    if (index < 0 || index >= pts.length) return pts;
    return pts.map((p, i) => (i === index ? to : p));
  }
  /** Значение после правки: по масштабу, если он известен, иначе в той же пропорции к прежнему. */
  function revalue(kind, old, pts, oldValue, k) {
    if (kind !== 'dim' && kind !== 'area') return null;
    if (k !== null && k !== undefined && k > 0) return value(kind, pts, k);
    if (oldValue === null || oldValue === undefined) return null;
    if (kind === 'dim') { const l = length(old.slice(0, 2)); return l > 0 ? oldValue * length(pts.slice(0, 2)) / l : null; }
    const a = area(old); return a > 0 ? oldValue * area(pts) / a : null;
  }
  function unitOf(name) {
    const u = String(name || '').toLowerCase().replace(/[ .]/g, '').replace('²', '2').replace('³', '3');
    if (['м', 'пм', 'мп', 'погм', 'пог', 'метр', 'м1'].includes(u)) return 'M';
    if (u === 'мм') return 'MM';
    if (['м2', 'квм', 'кв', 'мкв'].includes(u)) return 'M2';
    if (['м3', 'кубм', 'куб', 'мкуб'].includes(u)) return 'M3';
    return 'OTHER';
  }
  const fix = (v, d) => v.toFixed(d).replace('.', ',');
  const trimNum = (v, d) => { let s = v.toFixed(d).replace(/0+$/, '').replace(/\.$/, ''); return s.replace('.', ','); };
  /** Перевод значения фигуры (м или м²) в единицу позиции ведомости: { qty, note }; qty === null — нельзя. */
  function toBoq(kind, v, unitName, thickness) {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return { qty: null, note: 'У фигуры нет значения: задайте масштаб чертежа и постройте её заново' };
    v = Number(v);
    const u = unitOf(unitName), unit = String(unitName || '').trim() || 'без единицы';
    if (kind === 'dim') {
      if (u === 'M') return { qty: v, note: 'длина ' + formatMeters(v) };
      if (u === 'MM') return { qty: v * 1000, note: 'длина ' + formatMeters(v) };
      if (u === 'M2' || u === 'M3') return { qty: null, note: 'Размер — это длина, а у позиции единица «' + unit + '». Для площади постройте «Площадь»' };
      return { qty: v, note: 'длина в метрах; у позиции единица «' + unit + '» — проверьте' };
    }
    if (kind === 'area') {
      if (u === 'M2') return { qty: v, note: 'площадь ' + fix(v, 2) + ' м²' };
      if (u === 'M3') {
        if (!(thickness > 0) || !Number.isFinite(thickness)) return { qty: null, note: 'Для м³ укажите толщину в метрах, например 0,2' };
        return { qty: v * thickness, note: 'площадь ' + fix(v, 2) + ' м² × толщина ' + trimNum(thickness, 3) + ' м' };
      }
      if (u === 'M' || u === 'MM') return { qty: null, note: 'Площадь — это м², а у позиции единица «' + unit + '». Для длины постройте «Размер»' };
      return { qty: v, note: 'площадь в м²; у позиции единица «' + unit + '» — проверьте' };
    }
    return { qty: null, note: 'В ведомость переносятся размер (длина) и площадь' };
  }

  const api = { translate, vertices, nearestVertex, moveVertex, revalue, unitOf, toBoq, KINDS, TOOLS, COLORS, kindOf, toolOf, colorOf, encode, decode, complete, rect, segments, length, area, value, label, formatMeters,
    measureAngle, formatAngle, angleLabelPoint,
    distance, pick, ortho, ANGLE_STEPS, angleStep, constrainAngle, onAngle, center, fromRow, metersPerUnit, dxf, defaultTextHeight, bounds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabShapes = api;
})(typeof window !== 'undefined' ? window : globalThis);
