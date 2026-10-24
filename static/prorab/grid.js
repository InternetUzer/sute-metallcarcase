/* Parametric axis grid stored inside a standard DXF, without new sync tables. */
(function (root) {
  'use strict';
  const PREFIX = 'PRORAB_GRID_V1:';
  const DEFAULTS = { length: 24, width: 12, xCount: 5, yCount: 3, axes: true };
  function settings(input) {
    const p = Object.assign({}, DEFAULTS, input);
    const number = (v) => Number(String(v).trim().replace(',', '.'));
    for (const key of ['length', 'width']) {
      p[key] = number(p[key]);
      if (!Number.isFinite(p[key]) || p[key] < 0.001 || p[key] > 10000) throw new Error('Длина и ширина — от 0,001 до 10 000 м.');
    }
    for (const key of ['xCount', 'yCount']) {
      p[key] = number(p[key]);
      if (!Number.isInteger(p[key]) || p[key] < 2 || p[key] > 51) {
        if (p.axes === false) p[key] = DEFAULTS[key];
        else throw new Error('Количество осей в каждом направлении — целое число от 2 до 51.');
      }
    }
    return { length: p.length, width: p.width, xCount: p.xCount, yCount: p.yCount, axes: p.axes !== false };
  }
  function axisLetter(index) {
    const alphabet = 'АБВГДЕЖИКЛМНПРСТУФХЦЧШЭЮЯ';
    let out = '';
    do { out = alphabet[index % alphabet.length] + out; index = Math.floor(index / alphabet.length) - 1; } while (index >= 0);
    return out;
  }
  const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0) < 128 ? c : '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');
  function dxf(input) {
    const p = settings(input), out = [], g = (code, value) => out.push(String(code), String(value));
    const f = (code, value) => g(code, Number(value.toFixed(6)));
    const length = p.length * 1000, width = p.width * 1000, margin = Math.max(length, width) * 0.05;
    const height = margin * 0.25, radius = height * 1.2;
    g(999, PREFIX + JSON.stringify(p));
    g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, 2);
    for (const [name, color] of [['PRORAB_SHEET', -7], ['PRORAB_AXES', 7]]) {
      g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS');
    }
    g(0, 'ENDTAB'); g(0, 'ENDSEC'); g(0, 'SECTION'); g(2, 'ENTITIES');
    const poly = (layer, points, closed) => {
      g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(70, closed ? 1 : 0); f(10, 0); f(20, 0); f(30, 0);
      for (const [x, y] of points) { g(0, 'VERTEX'); g(8, layer); f(10, x); f(20, y); f(30, 0); }
      g(0, 'SEQEND'); g(8, layer);
    };
    const label = (x, y, value) => {
      g(0, 'CIRCLE'); g(8, 'PRORAB_AXES'); f(10, x); f(20, y); f(40, radius);
      g(0, 'TEXT'); g(8, 'PRORAB_AXES'); f(10, x); f(20, y - height * 0.35); f(40, height); g(1, ascii(value));
      g(72, 1); f(11, x); f(21, y - height * 0.35);
    };
    // Hidden frame gives an empty canvas a useful size without visible geometry or snap targets.
    poly('PRORAB_SHEET', [[0, 0], [length, 0], [length, width], [0, width]], true);
    if (p.axes) {
      const xs = Array.from({ length: p.xCount }, (_, i) => length * i / (p.xCount - 1));
      const ys = Array.from({ length: p.yCount }, (_, i) => width * i / (p.yCount - 1));
      xs.forEach((x, i) => { poly('PRORAB_AXES', [[x, -margin], ...ys.map((y) => [x, y]), [x, width + margin]], false); label(x, -margin - radius, String(i + 1)); });
      ys.forEach((y, i) => { poly('PRORAB_AXES', [[-margin, y], ...xs.map((x) => [x, y]), [length + margin, y]], false); label(-margin - radius, y, axisLetter(i)); });
    }
    g(0, 'ENDSEC'); g(0, 'EOF');
    return out.join('\n') + '\n';
  }
  function read(bytes) {
    try {
      const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
      const lines = text.split('\n');
      if (lines[0] !== '999' || !lines[1].startsWith(PREFIX)) return null;
      const p = settings(JSON.parse(lines[1].slice(PREFIX.length)));
      // Do not regenerate a DXF that was subsequently edited outside this generator.
      return dxf(p) === text ? p : null;
    } catch (_) { return null; }
  }
  const api = { DEFAULTS, settings, dxf, read, axisLetter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProrabGrid = api;
})(typeof window !== 'undefined' ? window : globalThis);
