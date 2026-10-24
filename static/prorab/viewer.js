/*
 * «Прораб+» в браузере — просмотр чертежа (DXF или лист PDF) с пометками, как в приложении.
 * Колесо — масштаб, перетаскивание — сдвиг, двойной щелчок — ближе, два пальца — масштаб.
 * Координаты пометок «настоящие»: у DXF — координаты чертежа, у PDF — точки листа (1/72 дюйма, от левого верхнего угла).
 * Свои линии (drawing_shapes, shapes.js): рисуются поверх; режим черчения — щелчок ставит точку (с привязкой к узлам DXF),
 * двойной щелчок или Enter заканчивает ломаную и площадь, Esc — отмена, Backspace — убрать последнюю точку.
 */
(function (root) {
  'use strict';
  const PIN_R = 13;
  const COLORS = { NOTE: '#ff9500', PROBLEM: '#ff3b30', DONE: '#34c759' };

  /**
   * opts: { kind: 'dxf'|'pdf', dxf, pdf (документ pdf.js), page, hidden: Set, notes, focusId,
   *         onNote(id), onPlace(x, y, page), onChange(),
   *         shapes (записи drawing_shapes), metersPerUnit, onShape({ kind, points, page, size }), onShapeText(x, y, page, size),
   *         onShapePick(id|null), onDrawChange({ count, live }) }
   */
  function create(host, opts) {
    const isPdf = opts.kind === 'pdf';
    const canvas = document.createElement('canvas');
    canvas.className = 'pp-plan-canvas';
    host.append(canvas);
    const ctx = canvas.getContext('2d');
    const cam = { s: 1, ox: 0, oy: 0, fitted: false };
    let w = 0, hgt = 0, dpr = 1;
    let notes = opts.notes || [];
    let hidden = opts.hidden || new Set();
    let mode = 'view';
    let focusId = opts.focusId || null;
    let paths = null; // DXF: [{ color, path }]
    let page = opts.page || 0;
    let pageSize = null; // PDF: [ширина, высота] в точках
    let pdfPage = null, base = null, baseScale = 1, sharp = null, sharpTask = null, sharpTimer = null, baseTask = null;
    let frame = 0, destroyed = false;
    const d = opts.dxf;
    const SH = root.ProrabShapes;
    let shapes = (opts.shapes || []).map(SH.fromRow), selShape = null, showShapes = true;
    // Правка фигуры: { op: 'move'|'copy'|'vertex', id, base: [x,y] (настоящие координаты) | null, vertex }
    let editCfg = null;
    let drawCfg = null, dpts = [], hover = null, k = opts.metersPerUnit === undefined ? null : opts.metersPerUnit;
    let measurement = null;
    canvas.tabIndex = 0;

    // локальные координаты: DXF — со сдвигом на origin; PDF — точки листа
    const toLocal = (x, y) => (isPdf ? [x, y] : [x - d.originX, y - d.originY]);
    const toReal = (lx, ly) => (isPdf ? [lx, ly] : [lx + d.originX, ly + d.originY]);
    const toScreen = (lx, ly) => [lx * cam.s + cam.ox, (isPdf ? ly : -ly) * cam.s + cam.oy];
    const toContent = (sx, sy) => [(sx - cam.ox) / cam.s, (isPdf ? 1 : -1) * (sy - cam.oy) / cam.s];

    function buildPaths() {
      const byColor = new Map();
      for (const pl of d.lines) {
        if (hidden.has(pl.layer)) continue;
        let p = byColor.get(pl.color);
        if (!p) { p = new Path2D(); byColor.set(pl.color, p); }
        const a = pl.pts;
        p.moveTo(a[0], a[1]);
        for (let i = 2; i < a.length; i += 2) p.lineTo(a[i], a[i + 1]);
        if (pl.closed) p.closePath();
      }
      paths = Array.from(byColor, ([color, path]) => ({ color, path }));
    }

    function bounds() {
      if (isPdf) return pageSize ? [0, 0, pageSize[0], pageSize[1]] : null;
      return d.fitBox;
    }
    function fit() {
      const b = bounds();
      if (!b || !w || !hgt) return;
      const bw = Math.max(b[2] - b[0], 1e-6), bh = Math.max(b[3] - b[1], 1e-6);
      cam.s = Math.min(w / bw, hgt / bh) * 0.94;
      centerOn((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
      cam.fitted = true;
    }
    function centerOn(lx, ly) {
      cam.ox = w / 2 - lx * cam.s;
      cam.oy = hgt / 2 - (isPdf ? ly : -ly) * cam.s;
    }
    function fitScale() {
      const b = bounds();
      if (!b) return 1;
      return Math.min(w / Math.max(b[2] - b[0], 1e-6), hgt / Math.max(b[3] - b[1], 1e-6)) * 0.94;
    }
    function zoomAt(sx, sy, k) {
      const min = fitScale() / 20, max = fitScale() * (isPdf ? 40 : 5000);
      const ns = Math.max(min, Math.min(max, cam.s * k));
      const [lx, ly] = toContent(sx, sy);
      cam.s = ns;
      cam.ox = sx - lx * ns;
      cam.oy = sy - (isPdf ? ly : -ly) * ns;
      changed();
    }

    function changed() {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
      if (isPdf) scheduleSharp();
      if (opts.onChange) opts.onChange();
    }

    function resize() {
      const r = host.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return; // окно перерисовывается или свёрнуто
      dpr = window.devicePixelRatio || 1;
      const nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
      if (nw === w && nh === hgt && canvas.width === Math.round(nw * dpr)) return;
      const keep = cam.fitted && w ? toContent(w / 2, hgt / 2) : null;
      w = nw; hgt = nh;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = hgt + 'px';
      if (!cam.fitted) fit(); else if (keep) centerOn(keep[0], keep[1]);
      changed();
    }

    function draw() {
      if (destroyed) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = isPdf ? '#8a8f98' : '#1b1e24';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (isPdf) drawPdf(); else drawDxf();
      drawShapes();
      drawPins();
    }

    function drawDxf() {
      if (!paths) buildPaths();
      ctx.setTransform(dpr * cam.s, 0, 0, -dpr * cam.s, dpr * cam.ox, dpr * cam.oy);
      ctx.lineWidth = 1 / cam.s;
      ctx.lineJoin = 'round';
      for (const p of paths) { ctx.strokeStyle = p.color; ctx.stroke(p.path); }
      // Тексты — в экранных координатах, чтобы не были зеркальными
      ctx.textBaseline = 'alphabetic';
      for (const t of d.texts) {
        if (hidden.has(t.layer)) continue;
        const px = t.height * cam.s;
        if (px < 3 || px > 2000) continue;
        const [sx, sy] = toScreen(t.x, t.y);
        if (sx < -2000 || sy < -2000 || sx > w + 2000 || sy > hgt + 2000) continue;
        ctx.setTransform(dpr, 0, 0, dpr, dpr * sx, dpr * sy);
        ctx.rotate(-t.rotation * Math.PI / 180);
        ctx.font = px + 'px sans-serif';
        ctx.textAlign = t.align === 1 ? 'center' : t.align === 2 ? 'right' : 'left';
        ctx.fillStyle = t.color;
        t.text.split('\n').forEach((line, i) => ctx.fillText(line, 0, i * px * 1.6));
      }
    }

    function drawPdf() {
      if (!pageSize) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const [x0, y0] = toScreen(0, 0);
      const pw = pageSize[0] * cam.s, ph = pageSize[1] * cam.s;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x0, y0, pw, ph);
      if (base) ctx.drawImage(base, x0, y0, pw, ph);
      if (sharp && sharp.s === cam.s && sharp.ox === cam.ox && sharp.oy === cam.oy && sharp.page === page) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(sharp.canvas, 0, 0);
      }
    }

    // ───── свои линии ─────
    const realToScreen = (p) => { const [lx, ly] = toLocal(p[0], p[1]); return toScreen(lx, ly); };
    function label(ctx2, t, x, y, angle, color) {
      ctx2.save();
      ctx2.translate(x, y); ctx2.rotate(angle);
      ctx2.font = 'bold 12px sans-serif'; ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
      const tw = ctx2.measureText(t).width, pad = 4;
      ctx2.fillStyle = color; ctx2.globalAlpha = 0.92;
      ctx2.beginPath(); ctx2.roundRect ? ctx2.roundRect(-tw / 2 - pad, -8 - pad / 2, tw + pad * 2, 16 + pad, 6) : ctx2.rect(-tw / 2 - pad, -8 - pad / 2, tw + pad * 2, 16 + pad); ctx2.fill();
      ctx2.globalAlpha = 1; ctx2.fillStyle = '#fff'; ctx2.fillText(t, 0, 0.5);
      ctx2.restore();
    }
    function drawShape(sh, opt) {
      const pts = sh.points.map(realToScreen);
      if (!pts.length) return;
      const color = sh.color;
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.lineWidth = (sh.width || 2) + (opt.selected ? 1 : 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.setLineDash(opt.preview ? [6, 5] : []);
      ctx.globalAlpha = opt.preview ? 0.75 : 1;
      const path = (p, closed) => { ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); if (closed) ctx.closePath(); };
      const halo = () => { if (!opt.selected) return; ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth += 6; ctx.stroke(); ctx.restore(); };
      if (sh.kind === 'text') {
        const px = (sh.size || 0) * cam.s;
        const size = Math.max(px, 9);
        if (size > 4000) return;
        ctx.save(); ctx.font = size + 'px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        if (opt.selected) { ctx.fillStyle = 'rgba(0,122,255,0.28)'; ctx.fillRect(pts[0][0] - 2, pts[0][1] - size, ctx.measureText(sh.text || 'Текст').width + 4, size * 1.25); ctx.fillStyle = color; }
        ctx.fillText(sh.text || 'Текст', pts[0][0], pts[0][1]); ctx.restore();
      } else if (sh.kind === 'angle') {
        if (pts.length >= 2) { path(pts, false); ctx.stroke(); }
        if (pts.length === 3 && sh.value !== null) {
          const [a, v, b] = pts, radius = Math.min(Math.hypot(a[0] - v[0], a[1] - v[1]), Math.hypot(b[0] - v[0], b[1] - v[1])) * 0.2;
          const start = Math.atan2(a[1] - v[1], a[0] - v[0]), end = Math.atan2(b[1] - v[1], b[0] - v[0]);
          const sweep = ((end - start + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
          ctx.beginPath(); ctx.arc(v[0], v[1], radius, start, start + sweep, sweep < 0); ctx.stroke();
          const at = realToScreen(SH.angleLabelPoint(sh.points));
          label(ctx, SH.label(sh), at[0], at[1], 0, color);
        }
      } else if (sh.kind === 'dim') {
        if (pts.length < 2) { ctx.fillRect(pts[0][0] - 2, pts[0][1] - 2, 4, 4); }
        else {
          const [a, b] = pts;
          path([a, b], false); halo(); ctx.stroke();
          const len = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])), ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, t = 6 * 0.7071;
          const tx = (ux - uy) * t, ty = (uy + ux) * t;
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(a[0] - tx, a[1] - ty); ctx.lineTo(a[0] + tx, a[1] + ty); ctx.moveTo(b[0] - tx, b[1] - ty); ctx.lineTo(b[0] + tx, b[1] + ty); ctx.stroke();
          let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
          let nx = uy, ny = -ux; if (ny > 0) { nx = -nx; ny = -ny; }
          label(ctx, SH.label(sh) || sh.text || 'масштаб?', (a[0] + b[0]) / 2 + nx * 12, (a[1] + b[1]) / 2 + ny * 12, ang, color);
        }
      } else if (sh.kind === 'rect') {
        if (pts.length >= 2) { path(SH.rect(sh.points[0], sh.points[1]).map(realToScreen), true); halo(); ctx.stroke(); }
      } else if (sh.kind === 'area') {
        if (pts.length >= 2) {
          path(pts, pts.length >= 3); halo(); ctx.stroke();
          if (pts.length >= 3) { ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1; const t = SH.label(sh); if (t) { const c = realToScreen(SH.center(sh.points)); label(ctx, t, c[0], c[1], 0, color); } }
        }
      } else if (pts.length >= 2) { path(pts, false); halo(); ctx.stroke(); }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (opt.selected && sh.kind !== 'text') for (const q of pts) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, 2 * Math.PI); ctx.fill(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(q[0], q[1], 3.5, 0, 2 * Math.PI); ctx.fill(); }
    }
    const visibleShapes = () => shapes.filter((x) => !isPdf || (x.page || 0) === page);
    function drawShapes() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (showShapes || drawCfg) for (const sh of visibleShapes()) drawShape(sh, { selected: sh.id === selShape });
      if (measurement && drawCfg && drawCfg.kind === 'angle') drawShape(measurement, {});
      if (editCfg) {
        const sh = shapes.find((x) => x.id === editCfg.id);
        if (sh && editCfg.base && hover) { const np = editedPoints(sh, toReal(hover[0], hover[1])); drawShape(Object.assign({}, sh, { points: np, value: editCfg.op === 'vertex' ? SH.revalue(sh.kind, sh.points, np, sh.value, k) : sh.value }), { preview: true }); }
        if (hover) {
          const [sx, sy] = toScreen(hover[0], hover[1]);
          ctx.strokeStyle = hover.snapped ? '#34c759' : '#ffd60a'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(sx - 12, sy); ctx.lineTo(sx + 12, sy); ctx.moveTo(sx, sy - 12); ctx.lineTo(sx, sy + 12); ctx.stroke();
          if (hover.snapped) ctx.strokeRect(sx - 5, sy - 5, 10, 10);
        }
      }
      if (drawCfg) {
        const live = hover && drawCfg.kind !== 'text' ? dpts.concat([hover]) : dpts;
        if (live.length) {
          const real = live.map((p) => toReal(p[0], p[1]));
          drawShape({ kind: drawCfg.kind, points: real, color: drawCfg.color, value: drawCfg.kind === 'angle' ? SH.measureAngle(real) : SH.value(drawCfg.kind, real, k), width: 2 }, { preview: true });
        }
        if (hover) {
          const [sx, sy] = toScreen(hover[0], hover[1]);
          ctx.strokeStyle = hover.snapped ? '#34c759' : '#ffd60a'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(sx - 12, sy); ctx.lineTo(sx + 12, sy); ctx.moveTo(sx, sy - 12); ctx.lineTo(sx, sy + 12); ctx.stroke();
          if (hover.snapped) ctx.strokeRect(sx - 5, sy - 5, 10, 10);
        }
      }
    }
    /** Новые точки фигуры при правке: курсор в настоящих координатах [x, y]. */
    function editedPoints(sh, at) {
      if (editCfg.op === 'vertex') return SH.moveVertex(sh.kind, sh.points, editCfg.vertex, at);
      return SH.translate(sh.points, at[0] - editCfg.base[0], at[1] - editCfg.base[1]);
    }
    function editClick(sx, sy, alt) {
      const p = drawPoint(sx, sy, alt);
      if (!p) return;
      const at = toReal(p[0], p[1]);
      const sh = shapes.find((x) => x.id === editCfg.id);
      if (!sh) { editCfg = null; changed(); return; }
      if (!editCfg.base) {
        if (editCfg.op === 'vertex') {
          const i = SH.nearestVertex(sh.kind, sh.points, at[0], at[1], (PIN_R * 1.2) / cam.s);
          if (i < 0) { if (opts.onEditInfo) opts.onEditInfo('Рядом нет точки фигуры — щёлкните по углу или концу'); return; }
          editCfg.vertex = i;
        }
        editCfg.base = at;
        if (opts.onEditInfo) opts.onEditInfo(null, editCfg);
        changed();
        return;
      }
      const pts = editedPoints(sh, at);
      const done = { id: sh.id, op: editCfg.op, points: pts, value: editCfg.op === 'vertex' ? SH.revalue(sh.kind, sh.points, pts, sh.value, k) : sh.value };
      editCfg = null; hover = null; canvas.style.cursor = 'grab';
      if (opts.onShapeEdit) opts.onShapeEdit(done);
      changed();
    }
    /** Angular constraint first; snap only to vertices on an allowed direction. */
    function drawPoint(sx, sy, free) {
      const [lx, ly] = toContent(sx, sy);
      if (isPdf && (!pageSize || lx < 0 || ly < 0 || lx > pageSize[0] || ly > pageSize[1])) return null;
      const from = dpts.length ? dpts[dpts.length - 1] : null;
      const step = from ? SH.angleStep(drawCfg) : 0;
      let p = step ? SH.constrainAngle(from, [lx, ly], step) : [lx, ly], snapped = false;
      // Alt disables vertex snapping; the selected angle step still applies.
      if (!free && !isPdf && root.ProrabDxf) {
        const accept = step ? (x, y) => SH.onAngle(from, [x, y], step) : null;
        const sn = root.ProrabDxf.snap(d, lx, ly, (PIN_R * 1.2) / cam.s, hidden, accept);
        if (sn) { p = sn; snapped = true; }
      }
      if (isPdf && (p[0] < 0 || p[1] < 0 || p[0] > pageSize[0] || p[1] > pageSize[1])) return null;
      p.snapped = snapped;
      return p;
    }
    function liveText() {
      const all = hover && drawCfg.kind !== 'text' ? dpts.concat([hover]) : dpts;
      if (all.length < 2) return null;
      const L = (u) => (k ? SH.formatMeters(u * k) : (u * 25.4 / 72).toFixed(1).replace('.', ',') + ' мм на листе');
      const seg = (a, b) => L(Math.hypot(b[0] - a[0], b[1] - a[1]));
      const kind = drawCfg.kind;
      if (kind === 'angle') { const value = SH.measureAngle(all); return value === null ? null : SH.formatAngle(value); }
      if (kind === 'rect') return L(Math.abs(all[1][0] - all[0][0])) + ' × ' + L(Math.abs(all[1][1] - all[0][1]));
      if (kind === 'area' && all.length >= 3) { const v = SH.value('area', all, k); return v === null ? 'площадь — нужен масштаб' : SH.label({ kind: 'area', value: v }); }
      if (kind === 'polyline' && all.length >= 3) return seg(all[all.length - 2], all[all.length - 1]) + ' · всего ' + L(SH.length(all));
      return seg(all[all.length - 2], all[all.length - 1]);
    }
    const drawChanged = () => { if (opts.onDrawChange && drawCfg) opts.onDrawChange({ count: dpts.length, live: liveText() }); changed(); };
    function finishDraw() {
      if (!drawCfg) return false;
      // Двойной щелчок ставит лишние одинаковые точки
      const pts = dpts.filter((p, i) => i === 0 || p[0] !== dpts[i - 1][0] || p[1] !== dpts[i - 1][1]);
      if (!SH.complete(drawCfg.kind, pts)) { dpts = pts; drawChanged(); return false; }
      const real = pts.map((p) => toReal(p[0], p[1]));
      if (drawCfg.kind === 'angle') {
        const value = SH.measureAngle(real);
        if (value === null) return false;
        measurement = { kind: 'angle', points: real, value, page: isPdf ? page : 0, color: drawCfg.color, size: 14 / cam.s, width: 2 };
        dpts = []; hover = null;
        if (opts.onMeasure) opts.onMeasure(measurement);
        drawChanged();
        return true;
      }
      dpts = [];
      if (opts.onShape) opts.onShape({ kind: drawCfg.kind, points: real, page: isPdf ? page : 0, color: drawCfg.color, value: SH.value(drawCfg.kind, real, k) });
      drawChanged();
      return true;
    }
    function addDrawPoint(sx, sy, free) {
      const p = drawPoint(sx, sy, free);
      if (!p) return;
      if (drawCfg.kind === 'angle' && !dpts.length) { measurement = null; if (opts.onMeasure) opts.onMeasure(null); }
      if (drawCfg.kind === 'text') {
        const [x, y] = toReal(p[0], p[1]);
        if (opts.onShapeText) opts.onShapeText(x, y, isPdf ? page : 0, 14 / cam.s);
        return;
      }
      dpts.push(p);
      const max = SH.toolOf(drawCfg.kind).max;
      if (max !== null && dpts.length >= max) finishDraw(); else drawChanged();
    }
    canvas.addEventListener('keydown', (e) => {
      if (!drawCfg) return;
      if (e.key === 'Enter') { e.preventDefault(); finishDraw(); }
      else if (e.key === 'Escape') { e.preventDefault(); dpts = []; measurement = null; if (opts.onMeasure) opts.onMeasure(null); drawChanged(); }
      else if (e.key === 'Backspace') { e.preventDefault(); dpts.pop(); drawChanged(); }
    });

    function drawPins() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const n of visibleNotes()) {
        const [lx, ly] = toLocal(n.x, n.y);
        const [sx, sy] = toScreen(lx, ly);
        if (sx < -PIN_R || sy < -PIN_R || sx > w + PIN_R || sy > hgt + PIN_R) continue;
        const focus = n.id === focusId;
        ctx.beginPath();
        ctx.arc(sx, sy, focus ? PIN_R + 4 : PIN_R, 0, 2 * Math.PI);
        ctx.fillStyle = COLORS[n.status] || COLORS.NOTE;
        ctx.fill();
        ctx.lineWidth = focus ? 3 : 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(String(n.number), sx, sy + 0.5);
      }
    }

    const visibleNotes = () => notes.filter((n) => !isPdf || (n.page || 0) === page);

    function hitNote(sx, sy) {
      let best = null, bd = PIN_R * 1.6;
      for (const n of visibleNotes()) {
        const [lx, ly] = toLocal(n.x, n.y);
        const [px, py] = toScreen(lx, ly);
        const dd = Math.hypot(px - sx, py - sy);
        if (dd < bd) { bd = dd; best = n; }
      }
      return best;
    }

    // ───── PDF: лист целиком и чёткая дорисовка видимой части ─────
    async function loadPage(n) {
      const next = Math.max(0, Math.min(opts.pdf.numPages - 1, n));
      if (next !== page) { dpts = []; hover = null; selShape = null; measurement = null; if (opts.onMeasure) opts.onMeasure(null); }
      page = next;
      pageSize = null;
      if (drawCfg) drawChanged();
      if (baseTask) { try { baseTask.cancel(); } catch (e) { /* уже закончено */ } }
      sharp = null; base = null;
      pdfPage = await opts.pdf.getPage(page + 1);
      if (destroyed) return;
      const vp = pdfPage.getViewport({ scale: 1 });
      pageSize = [vp.width, vp.height];
      cam.fitted = false;
      fit();
      changed();
      // Основа: лист с запасом по чёткости (до 4096 точек по длинной стороне)
      baseScale = Math.min(4096 / Math.max(vp.width, vp.height), Math.max(2, cam.s * dpr * 2));
      const v2 = pdfPage.getViewport({ scale: baseScale });
      const c = document.createElement('canvas');
      c.width = Math.ceil(v2.width); c.height = Math.ceil(v2.height);
      const want = page;
      baseTask = pdfPage.render({ canvasContext: c.getContext('2d'), viewport: v2, background: '#ffffff' });
      try { await baseTask.promise; } catch (e) { if (e && e.name === 'RenderingCancelledException') return; throw e; }
      if (destroyed || want !== page) return;
      base = c;
      changed();
    }
    function scheduleSharp() {
      clearTimeout(sharpTimer);
      if (!pdfPage || !pageSize) return;
      if (cam.s * dpr <= baseScale * 1.05) { sharp = null; return; }
      sharpTimer = setTimeout(renderSharp, 250);
    }
    async function renderSharp() {
      if (!pdfPage || destroyed) return;
      if (sharpTask) { try { sharpTask.cancel(); } catch (e) { /* уже закончено */ } }
      const want = { s: cam.s, ox: cam.ox, oy: cam.oy, page };
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = canvas.height;
      const vp = pdfPage.getViewport({ scale: cam.s * dpr, offsetX: cam.ox * dpr, offsetY: cam.oy * dpr });
      sharpTask = pdfPage.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)' });
      try { await sharpTask.promise; } catch (e) { return; }
      if (destroyed || want.s !== cam.s || want.ox !== cam.ox || want.oy !== cam.oy || want.page !== page) return;
      sharp = Object.assign(want, { canvas: c });
      draw();
    }

    // ───── мышь и пальцы ─────
    const pointers = new Map();
    let drag = null, moved = false, pinch = null;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      moved = false;
      if (pointers.size === 1) drag = { x: e.offsetX, y: e.offsetY, ox: cam.ox, oy: cam.oy };
      else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), s: cam.s, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 };
        drag = null;
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) {
        if (drawCfg) { hover = drawPoint(e.offsetX, e.offsetY, e.altKey); canvas.style.cursor = 'crosshair'; drawChanged(); return; }
        if (editCfg) { hover = drawPoint(e.offsetX, e.offsetY, e.altKey); canvas.style.cursor = 'crosshair'; changed(); return; }
        canvas.style.cursor = mode === 'place' ? 'crosshair' : hitNote(e.offsetX, e.offsetY) ? 'pointer' : 'grab';
        return;
      }
      pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pinch && pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        zoomAt(pinch.cx, pinch.cy, (pinch.s * dist / Math.max(pinch.dist, 1)) / cam.s);
        moved = true;
      } else if (drag) {
        const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        if (moved) { cam.ox = drag.ox + dx; cam.oy = drag.oy + dy; canvas.style.cursor = 'grabbing'; changed(); }
      }
    });
    const up = (e) => {
      const was = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!was || pointers.size) return;
      drag = null;
      if (moved || e.type === 'pointercancel') return;
      click(e.offsetX, e.offsetY, e.altKey);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAt(e.offsetX, e.offsetY, Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 30 : 1)));
    }, { passive: false });
    canvas.addEventListener('dblclick', (e) => {
      if (drawCfg) { if (drawCfg.kind === 'polyline' || drawCfg.kind === 'area') finishDraw(); return; }
      if (mode === 'view' && !hitNote(e.offsetX, e.offsetY)) zoomAt(e.offsetX, e.offsetY, 2);
    });
    canvas.addEventListener('pointerleave', () => { if (drawCfg && hover) { hover = null; drawChanged(); } else if (editCfg && hover) { hover = null; changed(); } });

    function click(sx, sy, alt) {
      if (drawCfg) { canvas.focus(); addDrawPoint(sx, sy, alt); return; }
      if (editCfg) { editClick(sx, sy, alt); return; }
      if (mode === 'place') {
        let [lx, ly] = toContent(sx, sy);
        if (isPdf) {
          if (!pageSize || lx < 0 || ly < 0 || lx > pageSize[0] || ly > pageSize[1]) return;
        } else {
          const s = root.ProrabDxf && root.ProrabDxf.snap(d, lx, ly, (PIN_R * 1.2) / cam.s, hidden);
          if (s) [lx, ly] = s;
        }
        const [x, y] = toReal(lx, ly);
        if (opts.onPlace) opts.onPlace(x, y, isPdf ? page : 0);
        return;
      }
      const n = hitNote(sx, sy);
      if (n) { if (opts.onNote) opts.onNote(n.id); return; }
      // Своя линия под курсором — выбрать
      if (showShapes) {
        const [lx, ly] = toContent(sx, sy), [x, y] = toReal(lx, ly);
        const list = visibleShapes(), i = SH.pick(list, x, y, (PIN_R * 0.8) / cam.s);
        const id = i >= 0 ? list[i].id : null;
        if (id !== selShape) { selShape = id; changed(); if (opts.onShapePick) opts.onShapePick(id); }
      }
    }

    const ro = new ResizeObserver(() => resize());
    ro.observe(host);
    resize();
    if (isPdf) loadPage(page).catch((e) => { if (opts.onError) opts.onError(e); });

    return {
      get page() { return page; },
      get pageCount() { return isPdf ? opts.pdf.numPages : 1; },
      setNotes(list) { notes = list || []; changed(); },
      setShapes(rows, selectedId) { shapes = (rows || []).map(SH.fromRow); if (selectedId !== undefined) selShape = selectedId; if (selShape && !shapes.some((x) => x.id === selShape)) selShape = null; changed(); },
      setShapesVisible(on) { showShapes = !!on; if (!on) selShape = null; changed(); },
      /** Черчение: { kind, color, ortho } или null — выключить. */
      setDraw(cfg) { const was = drawCfg; drawCfg = cfg ? Object.assign({}, cfg) : null; if (cfg) editCfg = null; if (!cfg || !was || was.kind !== cfg.kind) { dpts = []; measurement = null; if (opts.onMeasure) opts.onMeasure(null); } if (cfg) { selShape = null; canvas.focus(); } hover = null; canvas.style.cursor = cfg ? 'crosshair' : 'grab'; drawChanged(); changed(); },
      /** Правка фигуры: { op: 'move' | 'copy' | 'vertex', id } или null — отменить. */
      setEdit(cfg) { editCfg = cfg ? { op: cfg.op, id: cfg.id, base: null, vertex: -1 } : null; if (cfg) { drawCfg = null; dpts = []; selShape = cfg.id; } hover = null; canvas.style.cursor = cfg ? 'crosshair' : 'grab'; changed(); },
      get editing() { return editCfg ? { op: editCfg.op, id: editCfg.id, step: editCfg.base ? 1 : 0 } : null; },
      setScale(v) { k = v > 0 ? v : null; drawChanged(); },
      finishDraw() { return finishDraw(); },
      clearMeasurement() { measurement = null; changed(); },
      undoPoint() { dpts.pop(); drawChanged(); },
      get selectedShape() { return selShape; },
      setHidden(set) { hidden = set; paths = null; changed(); },
      setMode(m) {
        mode = m;
        if (m === 'place') { drawCfg = null; dpts = []; hover = null; measurement = null; if (opts.onMeasure) opts.onMeasure(null); }
        canvas.style.cursor = m === 'place' || drawCfg ? 'crosshair' : 'grab';
        changed();
      },
      setPage(n) { if (isPdf && n !== page) return loadPage(n); return Promise.resolve(); },
      fit() { cam.fitted = false; fit(); changed(); },
      zoom(k) { zoomAt(w / 2, hgt / 2, k); },
      /** Видимая часть в настоящих координатах: центр и ширина — для «Сохранить вид». */
      view() {
        const [lx, ly] = toContent(w / 2, hgt / 2);
        const [cx, cy] = toReal(lx, ly);
        return { cx, cy, span: w / cam.s, page };
      },
      applyView(v) {
        const go = () => {
          if (v.cx === null || v.cx === undefined || v.cy === null || v.cy === undefined || !v.span) { fit(); changed(); return; }
          cam.s = w / v.span;
          const [lx, ly] = toLocal(v.cx, v.cy);
          centerOn(lx, ly);
          cam.fitted = true;
          changed();
        };
        if (isPdf && (v.page || 0) !== page) return loadPage(v.page || 0).then(go);
        go();
        return Promise.resolve();
      },
      async focus(note) {
        focusId = note.id;
        if (isPdf && (note.page || 0) !== page) await loadPage(note.page || 0);
        const [lx, ly] = toLocal(note.x, note.y);
        cam.s = Math.max(cam.s, fitScale() * 4);
        centerOn(lx, ly);
        cam.fitted = true;
        changed();
      },
      destroy() {
        destroyed = true; ro.disconnect(); clearTimeout(sharpTimer);
        if (frame) cancelAnimationFrame(frame);
        [baseTask, sharpTask].forEach((t) => { if (t) { try { t.cancel(); } catch (e) { /* уже закончено */ } } });
        canvas.remove();
      },
      el: canvas,
    };
  }

  root.ProrabViewer = { create, COLORS };
})(window);
