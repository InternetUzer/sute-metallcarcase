/*
 * «Прораб+» в браузере — просмотр чертежа (DXF или лист PDF) с пометками, как в приложении.
 * Колесо — масштаб, перетаскивание — сдвиг, двойной щелчок — ближе, два пальца — масштаб.
 * Координаты пометок «настоящие»: у DXF — координаты чертежа, у PDF — точки листа (1/72 дюйма, от левого верхнего угла).
 */
(function (root) {
  'use strict';
  const PIN_R = 13;
  const COLORS = { NOTE: '#ff9500', PROBLEM: '#ff3b30', DONE: '#34c759' };

  /**
   * opts: { kind: 'dxf'|'pdf', dxf, pdf (документ pdf.js), page, hidden: Set, notes, focusId,
   *         onNote(id), onPlace(x, y, page), onChange() }
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
      page = Math.max(0, Math.min(opts.pdf.numPages - 1, n));
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
      click(e.offsetX, e.offsetY);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAt(e.offsetX, e.offsetY, Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 30 : 1)));
    }, { passive: false });
    canvas.addEventListener('dblclick', (e) => { if (mode === 'view' && !hitNote(e.offsetX, e.offsetY)) zoomAt(e.offsetX, e.offsetY, 2); });

    function click(sx, sy) {
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
      if (n && opts.onNote) opts.onNote(n.id);
    }

    const ro = new ResizeObserver(() => resize());
    ro.observe(host);
    resize();
    if (isPdf) loadPage(page).catch((e) => { if (opts.onError) opts.onError(e); });

    return {
      get page() { return page; },
      get pageCount() { return isPdf ? opts.pdf.numPages : 1; },
      setNotes(list) { notes = list || []; changed(); },
      setHidden(set) { hidden = set; paths = null; changed(); },
      setMode(m) { mode = m; canvas.style.cursor = m === 'place' ? 'crosshair' : 'grab'; },
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
