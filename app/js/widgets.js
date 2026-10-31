/* Librería de widgets dinámicos (ver skill widgets-dinamicos). Sin dependencias. */
(function () {
  'use strict';

  const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
  const fmt = {
    money: (v) => (v < 0 ? '−$' : '$') + nf0.format(Math.abs(Math.round(v))),
    compact: (v) => {
      const a = Math.abs(v), s = v < 0 ? '−$' : '$';
      if (a >= 1e9) return s + nf2.format(a / 1e9) + ' B';
      if (a >= 1e6) return s + nf2.format(a / 1e6) + ' M';
      if (a >= 1e4) return s + nf0.format(a / 1e3) + ' k';
      return s + nf0.format(a);
    },
    pct: (v, d = 1) => (v > 0 ? '' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d).replace('.', ',') + '%',
    pctSigned: (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d).replace('.', ',') + '%',
    num: (v, d = 1) => nf2.format(+v.toFixed(d)),
    years: (v) => (isFinite(v) ? nf2.format(+v.toFixed(1)) + ' años' : '∞'),
  };

  let uid = 0;
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }

  /** Slider enlazado a un input numérico. */
  function slider({ label, min, max, step = 1, value, unit = '', fmt: f, onInput, hint }) {
    const id = 'w' + ++uid;
    const range = h('input', { type: 'range', id, min, max, step, value, 'aria-label': label });
    const num = h('input', { type: 'number', class: 'w-num', min: unit === '$' ? null : min, step, value, 'aria-label': label + ' (valor exacto)' });
    const out = h('span', { class: 'w-out' });
    const paint = (v) => {
      const p = ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
      range.style.setProperty('--p', p + '%');
      out.textContent = f ? f(v) : v + (unit ? ' ' + unit : '');
    };
    const set = (v, from) => {
      v = Number(v);
      if (!isFinite(v)) return;
      if (from !== range) range.value = v;
      if (from !== num) num.value = +v.toFixed(4);
      paint(v);
      onInput && onInput(v);
    };
    range.addEventListener('input', () => set(range.value, range));
    num.addEventListener('input', () => num.value !== '' && set(num.value, num));
    paint(value);
    const el = h('div', { class: 'w w-slider' },
      h('div', { class: 'w-head' }, h('label', { for: id }, label), out),
      h('div', { class: 'w-row' }, range, h('span', { class: 'w-unit-wrap', 'data-unit': unit }, num)),
      hint ? h('div', { class: 'w-hint' }, hint) : null);
    el.set = (v) => set(v);
    return el;
  }

  /** Lista de valores numéricos editables (chips). */
  function chips({ label, values, fmt: f = (v) => v, onChange, placeholder = 'Añadir…', max = 5 }) {
    const vals = [...values];
    const list = h('div', { class: 'chips' });
    const input = h('input', { type: 'number', class: 'w-num chip-input', placeholder, 'aria-label': label + ': añadir valor' });
    const draw = () => {
      list.replaceChildren(...vals.map((v, k) => h('span', { class: 'chip', 'data-k': k, style: `--c: var(--s${k})` },
        h('i', { class: 'dot' }), f(v),
        vals.length > 1 ? h('button', { class: 'chip-x', title: 'Quitar', 'aria-label': 'Quitar ' + f(v), onclick: () => { vals.splice(k, 1); draw(); onChange([...vals]); } }, '×') : null)));
      input.disabled = vals.length >= max;
    };
    const add = () => {
      const v = Number(input.value);
      if (input.value === '' || !isFinite(v) || v < 0 || vals.length >= max) return;
      vals.push(v); input.value = ''; draw(); onChange([...vals]);
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    draw();
    return h('div', { class: 'w w-chips' },
      h('div', { class: 'w-head' }, h('label', {}, label), h('span', { class: 'w-out muted' }, `hasta ${max}`)),
      list, h('div', { class: 'w-row' }, input, h('button', { class: 'btn btn-sm', onclick: add }, '+ Añadir')));
  }

  /** Control segmentado. */
  function segmented({ label, options, value, onChange }) {
    const btns = options.map((o) => h('button', {
      class: 'seg' + (o.value === value ? ' on' : ''), role: 'radio', 'aria-checked': String(o.value === value),
      onclick: (e) => {
        btns.forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); });
        e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-checked', 'true');
        onChange(o.value);
      },
    }, o.label));
    return h('div', { class: 'w w-seg' }, label ? h('div', { class: 'w-head' }, h('label', {}, label)) : null,
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label || '' }, btns));
  }

  /** Tarjeta KPI. */
  function kpi({ label, value, sub, tone = 'neutral', title, small }) {
    return h('div', { class: 'kpi tone-' + tone + (small ? ' small' : ''), title: title || label },
      h('div', { class: 'kpi-label' }, label),
      h('div', { class: 'kpi-value' }, value),
      sub ? h('div', { class: 'kpi-sub' }, sub) : null);
  }

  /** Editor de tramos de contribución {desde, monto}. */
  function tramos({ label, rows, onChange, unidad = 'por periodo' }) {
    const data = rows.map((r) => ({ ...r }));
    const body = h('div', { class: 'tramos' });
    const emit = () => onChange(data.map((r) => ({ ...r })));
    const draw = () => {
      body.replaceChildren(...data.map((r, k) => h('div', { class: 'tramo' },
        h('span', { class: 'muted' }, 'Desde año'),
        h('input', { type: 'number', class: 'w-num', min: 1, value: r.desde, 'aria-label': 'Desde año', oninput: (e) => { r.desde = Math.max(1, +e.target.value || 1); emit(); } }),
        h('span', { class: 'muted' }, 'aportar $'),
        h('input', { type: 'number', class: 'w-num', value: r.monto, 'aria-label': 'Monto', oninput: (e) => { r.monto = +e.target.value || 0; emit(); } }),
        h('button', { class: 'chip-x', title: 'Quitar tramo', 'aria-label': 'Quitar tramo', onclick: () => { data.splice(k, 1); draw(); emit(); } }, '×'))));
      if (!data.length) body.append(h('div', { class: 'w-hint' }, 'Sin tramos: el aporte base crece con el % anual.'));
    };
    draw();
    return h('div', { class: 'w w-tramos' },
      h('div', { class: 'w-head' }, h('label', {}, label), h('span', { class: 'w-out muted' }, unidad)),
      body,
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => {
        const last = data[data.length - 1];
        data.push({ desde: last ? last.desde + 5 : 5, monto: last ? last.monto * 1.5 : 500 });
        draw(); emit();
      } }, '+ Añadir tramo (cambio de aporte)'));
  }

  window.W = { h, slider, chips, segmented, kpi, tramos, fmt };
})();
