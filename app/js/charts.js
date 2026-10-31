/* Gráficas SVG ligeras con tooltip. Sin dependencias. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function s(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    if (parent) parent.appendChild(el);
    return el;
  }

  function niceTicks(min, max, n = 5) {
    if (max === min) max = min + 1;
    const raw = (max - min) / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw);
    const t = [];
    for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) t.push(+v.toFixed(10));
    return t;
  }

  function frame(container, height) {
    container.innerHTML = '';
    container.classList.add('chart');
    const W = Math.max(280, container.clientWidth || 600), H = height || 300;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img' }, container);
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    container.appendChild(tip);
    return { svg, W, H, tip };
  }

  function placeTip(tip, container, x, y, html) {
    tip.innerHTML = html;
    tip.style.display = 'block';
    const cw = container.clientWidth, tw = tip.offsetWidth;
    tip.style.left = Math.min(cw - tw - 4, Math.max(4, x + 14)) + 'px';
    tip.style.top = Math.max(4, y - 10) + 'px';
  }

  /**
   * Líneas con bandas opcionales.
   * opts: {series:[{name, data:[{x,y}], color, dash, width, band:[{x,lo,hi}]}], yFmt, xFmt, xLabel, height, aria}
   */
  function line(container, opts) {
    const { svg, W, H, tip } = frame(container, opts.height);
    const m = { l: 64, r: 16, t: 14, b: 30 };
    const all = opts.series.flatMap((se) => [...se.data.map((d) => d.y), ...(se.band || []).flatMap((b) => [b.lo, b.hi])]);
    const xs = opts.series.flatMap((se) => se.data.map((d) => d.x));
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(0, ...all), yMax = Math.max(...all) * 1.04 || 1;
    const yt = niceTicks(yMin, yMax);
    const y0 = yt[0], y1 = yt[yt.length - 1];
    const X = (x) => m.l + ((x - xMin) / (xMax - xMin || 1)) * (W - m.l - m.r);
    const Y = (y) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b);
    const yFmt = opts.yFmt || ((v) => v);
    const xFmt = opts.xFmt || ((v) => v);
    if (opts.aria) svg.setAttribute('aria-label', opts.aria);

    yt.forEach((v) => {
      s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'grid' }, svg);
      s('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end', class: 'axis' }, svg).textContent = yFmt(v);
    });
    niceTicks(xMin, xMax, Math.min(10, xMax - xMin || 1)).filter((v) => v >= xMin && v <= xMax && Number.isInteger(v)).forEach((v) => {
      s('text', { x: X(v), y: H - 10, 'text-anchor': 'middle', class: 'axis' }, svg).textContent = xFmt(v);
    });
    if (opts.xLabel) s('text', { x: W - m.r, y: H - 10, 'text-anchor': 'end', class: 'axis axis-label' }, svg).textContent = opts.xLabel;

    opts.series.forEach((se) => {
      if (se.band && se.band.length) {
        const top = se.band.map((b) => `${X(b.x)},${Y(b.hi)}`);
        const bot = se.band.slice().reverse().map((b) => `${X(b.x)},${Y(b.lo)}`);
        s('polygon', { points: top.concat(bot).join(' '), fill: se.color, opacity: se.bandOpacity || 0.14 }, svg);
      }
    });
    opts.series.forEach((se) => {
      const d = se.data.map((p, k) => (k ? 'L' : 'M') + X(p.x).toFixed(1) + ',' + Y(p.y).toFixed(1)).join('');
      s('path', { d, fill: 'none', stroke: se.color, 'stroke-width': se.width || 2.25, 'stroke-dasharray': se.dash, 'stroke-linejoin': 'round', class: 'draw' }, svg);
    });

    const cross = s('line', { y1: m.t, y2: H - m.b, class: 'cross', visibility: 'hidden' }, svg);
    const dots = opts.series.map((se) => s('circle', { r: 4, fill: se.color, stroke: 'var(--panel)', 'stroke-width': 2, visibility: 'hidden' }, svg));
    const hit = s('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const xv = Math.round(xMin + ((px - m.l) / (W - m.l - m.r)) * (xMax - xMin));
      const x = Math.max(xMin, Math.min(xMax, xv));
      cross.setAttribute('x1', X(x)); cross.setAttribute('x2', X(x)); cross.setAttribute('visibility', 'visible');
      let rows = '';
      opts.series.forEach((se, k) => {
        const p = se.data.find((d) => d.x === x);
        if (!p) { dots[k].setAttribute('visibility', 'hidden'); return; }
        dots[k].setAttribute('cx', X(x)); dots[k].setAttribute('cy', Y(p.y)); dots[k].setAttribute('visibility', 'visible');
        const b = se.band && se.band.find((d) => d.x === x);
        rows += `<div class="tip-row"><i style="background:${se.color}"></i><span>${se.name}</span><b>${yFmt(p.y)}</b></div>` +
          (b && se.bandLabel ? `<div class="tip-sub">${se.bandLabel}: ${yFmt(b.lo)} – ${yFmt(b.hi)}</div>` : '');
      });
      placeTip(tip, container, (X(x) / W) * r.width, ((ev.clientY - r.top)), `<div class="tip-h">${opts.tipTitle ? opts.tipTitle(x) : xFmt(x)}</div>${rows}`);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); });
  }

  /** Área apilada (aportes vs. interés). opts: {x:[...], layers:[{name, values, color}], yFmt, height} */
  function stacked(container, opts) {
    const { svg, W, H, tip } = frame(container, opts.height || 220);
    const m = { l: 64, r: 16, t: 10, b: 30 };
    const n = opts.x.length;
    const tot = opts.x.map((_, k) => opts.layers.reduce((a, l) => a + Math.max(0, l.values[k]), 0));
    const yt = niceTicks(0, Math.max(...tot) * 1.04 || 1);
    const y1 = yt[yt.length - 1];
    const X = (k) => m.l + (k / (n - 1 || 1)) * (W - m.l - m.r);
    const Y = (v) => H - m.b - (v / y1) * (H - m.t - m.b);
    const yFmt = opts.yFmt || ((v) => v);
    yt.forEach((v) => {
      s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'grid' }, svg);
      s('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end', class: 'axis' }, svg).textContent = yFmt(v);
    });
    const step = Math.max(1, Math.ceil(n / 10));
    opts.x.forEach((x, k) => { if (k % step === 0 || k === n - 1) s('text', { x: X(k), y: H - 10, 'text-anchor': 'middle', class: 'axis' }, svg).textContent = x; });
    const base = new Array(n).fill(0);
    opts.layers.forEach((l) => {
      const top = l.values.map((v, k) => base[k] + Math.max(0, v));
      const pts = top.map((v, k) => `${X(k)},${Y(v)}`).concat(base.slice().reverse().map((v, k) => `${X(n - 1 - k)},${Y(v)}`));
      s('polygon', { points: pts.join(' '), fill: l.color, opacity: 0.85 }, svg);
      top.forEach((v, k) => (base[k] = v));
    });
    const cross = s('line', { y1: m.t, y2: H - m.b, class: 'cross', visibility: 'hidden' }, svg);
    const hit = s('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const k = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1))));
      cross.setAttribute('x1', X(k)); cross.setAttribute('x2', X(k)); cross.setAttribute('visibility', 'visible');
      const rows = opts.layers.map((l) => `<div class="tip-row"><i style="background:${l.color}"></i><span>${l.name}</span><b>${yFmt(l.values[k])}</b></div>`).join('');
      placeTip(tip, container, (X(k) / W) * r.width, ev.clientY - r.top, `<div class="tip-h">Año ${opts.x[k]}</div>${rows}<div class="tip-sub">Total ${yFmt(tot[k])}</div>`);
    });
    hit.addEventListener('pointerleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); });
  }

  /** Barras horizontales. opts: {items:[{label, value, color, sub}], fmt} */
  function bars(container, opts) {
    container.innerHTML = '';
    container.classList.add('bars');
    const max = Math.max(...opts.items.map((i) => Math.abs(i.value)), 1);
    opts.items.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.title = it.title || '';
      row.innerHTML = `<div class="bar-label">${it.label}${it.sub ? `<small>${it.sub}</small>` : ''}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(Math.abs(it.value) / max) * 100}%;background:${it.color || 'var(--accent)'}"></div></div>
        <div class="bar-val">${(opts.fmt || String)(it.value)}</div>`;
      container.appendChild(row);
    });
  }

  /** Heatmap como tabla. opts: {rows:[{label,value}], cols:[{label,value}], cell(r,c)->number, fmt, highlight:{r,c}} */
  function heatmap(container, opts) {
    const vals = opts.rows.flatMap((r) => opts.cols.map((c) => opts.cell(r, c)));
    const lo = Math.log(Math.max(1, Math.min(...vals))), hi = Math.log(Math.max(...vals, 2));
    let html = `<table class="heat"><thead><tr><th>${opts.corner || ''}</th>${opts.cols.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>`;
    opts.rows.forEach((r) => {
      html += `<tr><th>${r.label}</th>`;
      opts.cols.forEach((c) => {
        const v = opts.cell(r, c);
        const t = hi > lo ? (Math.log(Math.max(1, v)) - lo) / (hi - lo) : 0;
        const on = opts.highlight && opts.highlight(r, c);
        html += `<td class="${on ? 'on' : ''}" style="--t:${t.toFixed(3)}" title="${r.label} · ${c.label}: ${opts.fmt(v)}">${opts.fmt(v)}</td>`;
      });
      html += '</tr>';
    });
    container.innerHTML = html + '</tbody></table>';
  }

  window.Charts = { line, stacked, bars, heatmap };
})();
