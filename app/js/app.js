/* The Oracle of Omaha — controlador: estado único → vistas. Ver skill widgets-dinamicos. */
(function () {
  'use strict';
  const { h, fmt } = W;
  const $ = (s, r = document) => r.querySelector(s);
  const cv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SERIES = ['--s0', '--s1', '--s2', '--s3', '--s4'];
  /** Ningún activo sostiene más de esto por décadas: techo al proyectar con retornos pasados. */
  const TECHO_PASADO = 15;

  /* ---------------- Estado ---------------- */
  const DEF = {
    tab: 'proyeccion', tema: 'dark', vista: 'nominal', configurado: false,
    capitales: [0], anios: 20, tasa: 0, varianza: 0, capitalizacion: 12,
    aporte: 0, frecuenciaAporte: 12, crecimientoAporte: 0, tramos: [], inflacion: 0, comision: 0,
    porAnio: {},
    port: { pesos: {}, escenario: 'base', base: 'esperado' },
    propios: [],
    filtroCat: 'todas', busqueda: '', orden: 'esperado', seguidos: [],
  };
  const CLAVE = 'oracle-omaha-v1';
  const CLAVE_MERCADO = 'oracle-omaha-mercado';
  const guardarMercado = () => { try { localStorage.setItem(CLAVE_MERCADO, JSON.stringify(MERCADO)); } catch { /* sin almacenamiento */ } };
  try { localStorage.removeItem('cc-state'); } catch { /* clave de la versión anterior */ }
  let state = (() => {
    try {
      const s = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      return s ? { ...structuredClone(DEF), ...s, port: { ...DEF.port, ...(s.port || {}) } } : structuredClone(DEF);
    } catch { return structuredClone(DEF); }
  })();
  const save = () => { try { localStorage.setItem(CLAVE, JSON.stringify(state)); } catch { /* sin almacenamiento */ } };

  let DATA = { activos: [], categorias: [], correlaciones: null, escenarios: [], macro: {} };
  let MERCADO = { resultados: {} };
  const activo = (id) => DATA.activos.find((a) => a.id === id);
  const categoria = (id) => (DATA.categorias.find((c) => c.id === id) || { nombre: id }).nombre;
  const escenario = (id) => DATA.escenarios.find((e) => e.id === id) || null;
  const porTicker = (alts) => alts.map((t) => DATA.activos.find((a) => (a.ticker || '').toUpperCase() === t)).find(Boolean);
  const aniosVista = () => (state.configurado ? state.anios : 20);

  /* ---------------- Render ---------------- */
  let raf = 0, mcTimer = 0;
  function render() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      save();
      renderVeredicto();
      const v = VISTAS[state.tab];
      if (v.pesado) { clearTimeout(mcTimer); mcTimer = setTimeout(v.update, 120); } else v.update();
    });
  }
  function set(patch) { Object.assign(state, patch); render(); }

  function mostrarTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const main = $('#vista');
    main.replaceChildren();
    if (!DATA.activos.length && tab !== 'proyeccion') {
      main.append(h('div', { class: 'panel error-box' }, 'No se pudo cargar la base de activos. Inicia la app con ', h('b', {}, 'Iniciar.bat'), ' (servidor local).'));
      renderVeredicto();
      return;
    }
    VISTAS[tab].build(main);
    save();
    renderVeredicto();
    VISTAS[tab].update(); // primer pintado inmediato, sin debounce
  }

  /* ---------------- Modales ---------------- */
  let nivelModal = 0;
  function abrirModal(contenido, { clase = '', alCerrar } = {}) {
    nivelModal++;
    const caja = h('div', { class: 'modal ' + clase, role: 'dialog', 'aria-modal': 'true' });
    const fondo = h('div', { class: 'modal-bg', style: `z-index:${100 + nivelModal}` }, caja);
    const cerrar = () => {
      if (!fondo.isConnected) return;
      fondo.classList.add('saliendo');
      document.removeEventListener('keydown', tecla);
      setTimeout(() => fondo.remove(), 140);
      nivelModal--;
      if (!nivelModal) document.body.classList.remove('con-modal');
      alCerrar && alCerrar();
    };
    const tecla = (e) => { if (e.key === 'Escape' && fondo.style.zIndex == 100 + nivelModal) cerrar(); };
    fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) cerrar(); });
    document.addEventListener('keydown', tecla);
    caja.append(h('button', { class: 'modal-x', 'aria-label': 'Cerrar', title: 'Cerrar (Esc)', onclick: cerrar }, '×'), ...[].concat(contenido(cerrar)));
    document.body.append(fondo);
    document.body.classList.add('con-modal');
    const foco = caja.querySelector('input, select, button:not(.modal-x)');
    foco && setTimeout(() => foco.focus(), 30);
    return cerrar;
  }

  /* ---------------- Asistente de configuración ---------------- */
  function abrirAsistente() {
    const sp = porTicker(['SPY', 'VOO', 'IVV']);
    const bono = porTicker(['IEF', 'AGG']);
    const ahorro = DATA.activos.find((a) => a.categoria === 'efectivo');
    const inflHoy = (MERCADO.macro && MERCADO.macro.inflacion_usa) ?? DATA.macro.inflacion_usa;
    const inflLP = DATA.macro.inflacion_largo_plazo_supuesta;
    const c = state.configurado;
    const campos = {};
    const campo = (k, { label, ayuda, placeholder, unidad, min, max, step = 'any', valor, sugerencias = [], requerido = true, entero = false }) => {
      const inp = h('input', { type: 'number', id: 'cfg-' + k, min, max, step, placeholder, value: valor ?? '', 'aria-describedby': 'cfg-' + k + '-a' });
      const err = h('div', { class: 'cfg-err' });
      campos[k] = { inp, err, requerido, min, max, label, entero };
      inp.addEventListener('input', () => { err.textContent = ''; inp.classList.remove('mal'); });
      return h('div', { class: 'cfg-campo' },
        h('label', { for: 'cfg-' + k }, label, requerido ? null : h('span', { class: 'muted' }, ' (opcional)')),
        h('div', { class: 'cfg-input', 'data-unidad': unidad || '' }, inp),
        h('div', { class: 'w-hint', id: 'cfg-' + k + '-a' }, ayuda),
        sugerencias.length ? h('div', { class: 'cfg-sug' }, sugerencias.filter(Boolean).map(([t, v]) =>
          h('button', { type: 'button', class: 'cat-chip', onclick: () => { inp.value = v; inp.dispatchEvent(new Event('input')); } }, t))) : null,
        err);
    };
    let frecuencia = state.frecuenciaAporte;

    abrirModal((cerrar) => {
      const enviar = (e) => {
        e.preventDefault();
        let ok = true;
        const v = {};
        for (const [k, f] of Object.entries(campos)) {
          const raw = f.inp.value.trim();
          if (raw === '') {
            if (f.requerido) { f.err.textContent = 'Completa este dato.'; f.inp.classList.add('mal'); ok = false; }
            v[k] = 0;
            continue;
          }
          const n = Number(raw);
          if (!isFinite(n) || (f.min != null && n < f.min) || (f.max != null && n > f.max)) {
            f.err.textContent = `Debe estar entre ${f.min ?? '−∞'} y ${f.max ?? '∞'}.`; f.inp.classList.add('mal'); ok = false; continue;
          }
          if (f.entero && !Number.isInteger(n)) { f.err.textContent = 'Usa un número entero de años.'; f.inp.classList.add('mal'); ok = false; continue; }
          v[k] = n;
        }
        if (!ok) { const m = $('.cfg .mal'); m && m.focus(); return; }
        Object.assign(state, {
          capitales: [v.capital], aporte: v.aporte, frecuenciaAporte: frecuencia, crecimientoAporte: v.crecimiento,
          anios: Math.round(v.anios), tasa: v.tasa, inflacion: v.inflacion, comision: v.comision, configurado: true,
        });
        if (!c) { state.porAnio = {}; state.tramos = []; state.varianza = 0; }
        cerrar();
        mostrarTab(state.tab);
        toast('Plan listo. Ajusta cualquier dato con los controles o personaliza año por año.');
      };
      return h('form', { class: 'cfg', onsubmit: enviar, novalidate: true },
        h('div', { class: 'cfg-head' },
          h('div', { class: 'cfg-logo', html: LOGO_SVG }),
          h('div', {}, h('h2', {}, c ? 'Mi plan de inversión' : 'Configura tu plan de inversión'),
            h('p', { class: 'muted' }, 'Tú defines los datos: la app no asume nada por ti. Los botones son solo sugerencias basadas en la investigación de mercado.'))),
        h('div', { class: 'cfg-grid' },
          h('fieldset', {}, h('legend', {}, '1 · Tu dinero'),
            campo('capital', { label: '¿Con cuánto empiezas?', unidad: '$', min: 0, placeholder: 'Ej. 10000', valor: c ? state.capitales[0] : '', ayuda: 'Capital inicial. Luego puedes comparar varios capitales.' }),
            campo('aporte', { label: '¿Cuánto aportarás cada periodo?', unidad: '$', placeholder: 'Ej. 300 · 0 si no aportarás', valor: c ? state.aporte : '', ayuda: 'Negativo = retiros periódicos.' }),
            h('div', { class: 'cfg-campo' }, W.segmented({ label: 'Frecuencia del aporte', value: frecuencia, options: [{ value: 12, label: 'Mensual' }, { value: 1, label: 'Anual' }], onChange: (x) => { frecuencia = x; } })),
            campo('crecimiento', { label: 'Crecimiento anual del aporte', unidad: '%', min: 0, max: 50, placeholder: '0', valor: c ? state.crecimientoAporte : '', requerido: false, ayuda: 'Ej. subir el aporte con tu salario.', sugerencias: [['0%', 0], ['Con la inflación ~3%', 3], ['5%', 5]] })),
          h('fieldset', {}, h('legend', {}, '2 · Horizonte y rentabilidad'),
            campo('anios', { label: '¿Por cuántos años?', unidad: 'años', min: 1, max: 60, step: 1, entero: true, placeholder: 'Ej. 25', valor: c ? state.anios : '', ayuda: 'Entre 1 y 60 años.', sugerencias: [['10', 10], ['20', 20], ['30', 30], ['Jubilación ~40', 40]] }),
            campo('tasa', { label: '¿Qué rentabilidad anual esperas?', unidad: '%', min: -50, max: 50, placeholder: 'Ej. 6', valor: c ? state.tasa : '', ayuda: 'Nominal, antes de inflación y comisiones. Luego puedes variarla año por año.',
              sugerencias: [sp && [`S&P 500 consenso ${fmt.pct(sp.retorno_esperado_10a)}`, sp.retorno_esperado_10a], bono && [`Bonos ${fmt.pct(bono.retorno_esperado_10a)}`, bono.retorno_esperado_10a],
                ahorro && [`Ahorro ${fmt.pct(ahorro.retorno_esperado_10a)}`, ahorro.retorno_esperado_10a], sp && [`S&P histórico ${fmt.pct(sp.retorno_historico)} (no garantizado)`, sp.retorno_historico]] })),
          h('fieldset', {}, h('legend', {}, '3 · Realidad: inflación y costos'),
            campo('inflacion', { label: 'Inflación anual esperada', unidad: '%', min: -5, max: 50, placeholder: 'Ej. 3', valor: c ? state.inflacion : '', ayuda: 'Para ver tu dinero en poder adquisitivo de hoy.',
              sugerencias: [inflLP != null && [`Largo plazo ${fmt.pct(inflLP)}`, inflLP], inflHoy != null && [`Actual EE.UU. ${fmt.pct(inflHoy)}`, inflHoy], ['Meta Fed 2%', 2]] }),
            campo('comision', { label: 'Comisión anual de tu fondo/gestor', unidad: '%', min: 0, max: 10, placeholder: 'Ej. 0.1', valor: c ? state.comision : '', ayuda: 'Lo que cobra el fondo o asesor cada año sobre tu saldo.',
              sugerencias: [['ETF indexado 0,05%', 0.05], ['Fondo activo 1%', 1], ['Asesor + fondo 2%', 2], ['Sin comisión', 0]] }))),
        h('div', { class: 'cfg-pie' },
          h('span', { class: 'muted' }, 'Herramienta educativa: no es asesoría financiera.'),
          c ? h('button', { type: 'button', class: 'btn', onclick: cerrar }, 'Cancelar') : null,
          h('button', { type: 'submit', class: 'btn btn-primary' }, c ? 'Actualizar mi plan' : 'Calcular mi proyección')));
    }, { clase: 'modal-cfg' });
  }

  /* ---------------- Veredicto ---------------- */
  const paramsProy = () => ({
    capitales: state.capitales, anios: state.anios, tasa: state.tasa, varianza: state.varianza, capitalizacion: state.capitalizacion,
    aporte: state.aporte, frecuenciaAporte: state.frecuenciaAporte, crecimientoAporte: state.crecimientoAporte, tramos: state.tramos,
    inflacion: state.inflacion, comision: state.comision, porAnio: state.porAnio,
  });
  const ultimo = (f) => f[f.length - 1];
  const numAjustes = () => Object.entries(state.porAnio).filter(([y, o]) => +y <= state.anios && Object.keys(o).length).length;

  /** Tasas medias geométricas del plan (con ajustes por año): bruta, neta de comisión y real neta. */
  function tasasMedias() {
    const p = paramsProy();
    let bruta = 1, neta = 1, real = 1, retenido = 1;
    const n = Math.max(1, state.anios);
    for (let y = 1; y <= n; y++) {
      const q = Engine.parametrosDelAnio(p, y);
      const ef = 1 + Engine.tasaEfectiva(q.tasa, q.capitalizacion);
      bruta *= ef; neta *= ef * (1 - q.comision / 100); real *= (ef * (1 - q.comision / 100)) / (1 + q.inflacion / 100);
      retenido *= 1 - q.comision / 100;
    }
    const g = (x) => (Math.pow(x, 1 / n) - 1) * 100;
    return { bruta: g(bruta), neta: g(neta), real: g(real), inflacion: g(real ? neta / real : 1), comision: (1 - Math.pow(retenido, 1 / n)) * 100 };
  }

  function renderVeredicto() {
    const box = $('#veredicto');
    if (!state.configurado) {
      box.replaceChildren(h('div', { class: 'bienvenida' },
        h('div', { class: 'bienvenida-logo', html: LOGO_SVG }),
        h('div', {},
          h('h2', {}, 'Bienvenido a The Oracle of Omaha'),
          h('p', {}, 'Aún no hay proyección. Empieza indicando ', h('b', {}, 'tu capital, tus aportes, el horizonte, la rentabilidad que esperas, la inflación y las comisiones'),
            '. Con eso verás tu valor final, su equivalente en dinero de hoy y cuánto se llevan los costos.')),
        h('button', { class: 'btn btn-primary btn-lg', onclick: abrirAsistente }, 'Configurar mi plan →')));
      return;
    }
    const p = paramsProy();
    const [e] = Engine.escenarios({ ...p, capitales: [state.capitales[0]] });
    const f = ultimo(e.filas), sc = ultimo(e.sinComision);
    const costo = sc.saldo - f.saldo;
    const t = tasasMedias();
    const dup = Engine.duplicar(t.neta);
    const mult = f.aportado > 0 ? f.saldo / f.aportado : 0;
    const ajustes = numAjustes();
    const flags = [];
    const sp = porTicker(['SPY', 'VOO', 'IVV']);
    if (sp && t.bruta > sp.retorno_esperado_10a + 1.5 && t.bruta <= 12)
      flags.push(`Tu tasa (${fmt.pct(t.bruta)}) supera el consenso a 10 años para el S&P 500 (${fmt.pct(sp.retorno_esperado_10a)}) con valuaciones actuales.`);
    if (t.bruta > 12) flags.push('Una tasa >12% sostenida es excepcional: el S&P 500 promedió ~10% nominal en casi un siglo.');
    if (t.comision >= 1) flags.push(`Comisión media de ${fmt.pct(t.comision, 2)}: se come ${fmt.pct((costo / sc.saldo) * 100, 0)} del resultado. Un fondo indexado cuesta ~0,05%.`);
    if (t.real < 1) flags.push(`Rendimiento real de ${fmt.pct(t.real)}: tras inflación y costos casi no ganas poder adquisitivo.`);
    if (state.anios < 5 && t.bruta > 6) flags.push('Horizonte corto: con activos de riesgo, la volatilidad domina al interés compuesto.');

    box.replaceChildren(
      W.kpi({ label: `Valor final · ${state.anios} años`, value: fmt.compact(f.saldo), sub: fmt.money(f.saldo), tone: 'pos' }),
      W.kpi({ label: 'Valor real (dinero de hoy)', value: fmt.compact(f.real), sub: `inflación media ${fmt.pct(t.inflacion)}`, tone: 'gold' }),
      W.kpi({ label: 'Total aportado', value: fmt.compact(f.aportado), sub: `capital ${fmt.compact(state.capitales[0])}` }),
      W.kpi({ label: 'Interés compuesto', value: fmt.compact(f.interes), sub: `saldo = ${fmt.num(mult, 1)}× lo aportado`, tone: f.interes >= 0 ? 'pos' : 'neg' }),
      W.kpi({ label: 'Costo de comisiones', value: fmt.compact(costo), sub: `${fmt.pct(t.comision, 2)} anual${ajustes && Math.abs(t.comision - state.comision) > 0.005 ? ' (media)' : ''}`, tone: costo > 0 ? 'neg' : 'neutral' }),
      W.kpi({ label: 'Se duplica cada', value: fmt.years(dup.exacto), sub: `regla del 72: ${fmt.years(dup.regla72)}` }),
      h('div', { class: 'verdict-text' },
        h('span', { class: 'tag' }, 'Veredicto del Oráculo'),
        h('span', { html: `Con <b>${fmt.money(state.capitales[0])}</b> y aportes ${state.frecuenciaAporte === 12 ? 'mensuales' : 'anuales'} de <b>${fmt.money(state.aporte)}</b>` +
          `${state.crecimientoAporte ? ` (+${fmt.pct(state.crecimientoAporte)}/año)` : ''} al <b>${fmt.pct(t.bruta)}</b>${ajustes ? ' medio' : ''}, en ${state.anios} años tendrías <b>${fmt.compact(f.saldo)}</b>, ` +
          `equivalentes a <b>${fmt.compact(f.real)}</b> de hoy. Rendimiento real neto: <b>${fmt.pct(t.real)}</b>.` +
          (ajustes ? ` <span class="muted">(${ajustes} año${ajustes > 1 ? 's' : ''} personalizado${ajustes > 1 ? 's' : ''})</span>` : '') }),
        flags.map((x) => h('span', { class: 'flag' }, '⚠ ' + x))),
    );
  }

  function vacio(main, titulo, texto) {
    main.append(h('section', { class: 'panel vacio' },
      h('div', { class: 'vacio-logo', html: LOGO_SVG }),
      h('h2', {}, titulo), h('p', {}, texto),
      h('ol', { class: 'pasos' },
        h('li', {}, h('b', {}, 'Configura tu plan'), ': capital, aportes, años, rentabilidad, inflación y comisión.'),
        h('li', {}, h('b', {}, 'Explora'), ': mueve los sliders y personaliza cualquier año (tasa, aportes, capitalización…).'),
        h('li', {}, h('b', {}, 'Diversifica'), ': arma tu portafolio con el universo de activos o tus propios activos.')),
      h('button', { class: 'btn btn-primary btn-lg', onclick: abrirAsistente }, 'Configurar mi plan →')));
  }

  /* ---------------- Proyección ---------------- */
  const CAMPOS_ANIO = [
    { k: 'tasa', label: 'Tasa %', step: 0.1, fmt: (v) => +v.toFixed(2) },
    { k: 'capitalizacion', label: 'Capitalización', opciones: [[1, 'Anual'], [4, 'Trimestral'], [12, 'Mensual'], [365, 'Diaria']] },
    { k: 'aporte', label: 'Aporte/periodo $', step: 10, fmt: (v) => Math.round(v * 100) / 100 },
    { k: 'extra', label: 'Extra único $', step: 100, fmt: (v) => Math.round(v), title: 'Aporte (o retiro, si es negativo) puntual al inicio del año' },
    { k: 'comision', label: 'Comisión %', step: 0.05, fmt: (v) => +v.toFixed(2) },
    { k: 'inflacion', label: 'Inflación %', step: 0.1, fmt: (v) => +v.toFixed(2) },
  ];

  const proy = { refs: {} };
  proy.build = (main) => {
    if (!state.configurado) return vacio(main, 'Tu proyección aparecerá aquí', 'Primero cuéntale al Oráculo tu situación: todos los valores los defines tú.');
    const r = proy.refs;
    const selActivo = h('select', { 'aria-label': 'Usar retorno de un activo', onchange: (e) => {
      const a = activo(e.target.value);
      if (!a) return;
      r.tasa.set(+a.retorno_esperado_10a.toFixed(2));
      toast(`Tasa base fijada en el retorno esperado a 10 años de ${a.nombre}: ${fmt.pct(a.retorno_esperado_10a)} (volatilidad ${fmt.pct(a.volatilidad)}).`);
      e.target.value = '';
    } }, h('option', { value: '' }, 'Usar retorno esperado de un activo…'),
    DATA.categorias.map((c) => h('optgroup', { label: c.nombre }, DATA.activos.filter((a) => a.categoria === c.id)
      .map((a) => h('option', { value: a.id }, `${a.nombre} · ${fmt.pct(a.retorno_esperado_10a)}`)))));
    const inflLP = DATA.macro.inflacion_largo_plazo_supuesta, inflHoy = (MERCADO.macro && MERCADO.macro.inflacion_usa) ?? DATA.macro.inflacion_usa;

    const controles = h('aside', { class: 'panel controls' },
      h('div', { class: 'plan-head' }, h('h3', {}, 'Capital inicial'), h('button', { class: 'btn btn-sm', onclick: abrirAsistente }, '⚙ Editar plan')),
      W.chips({ label: 'Capitales a comparar', values: state.capitales, fmt: fmt.money, placeholder: 'Ej. 100000', onChange: (v) => set({ capitales: v }) }),
      h('h3', {}, 'Horizonte y rendimiento base'),
      r.anios = W.slider({ label: 'Años de inversión', min: 1, max: 60, step: 1, value: state.anios, fmt: (v) => v + ' años', onInput: (v) => { set({ anios: Math.round(v) }); } }),
      r.tasa = W.slider({ label: 'Tasa de interés anual (base)', min: -10, max: 30, step: 0.1, value: state.tasa, fmt: (v) => fmt.pct(v), onInput: (v) => set({ tasa: v }) }),
      DATA.activos.length ? h('div', { class: 'w' }, selActivo) : null,
      W.slider({ label: 'Rango de variación de la tasa (±)', min: 0, max: 10, step: 0.5, value: state.varianza, fmt: (v) => '± ' + fmt.pct(v), hint: 'Dibuja una banda con la tasa baja y alta.', onInput: (v) => set({ varianza: v }) }),
      W.segmented({ label: 'Capitalización base', value: state.capitalizacion, options: [{ value: 1, label: 'Anual' }, { value: 4, label: 'Trimestral' }, { value: 12, label: 'Mensual' }, { value: 365, label: 'Diaria' }], onChange: (v) => set({ capitalizacion: v }) }),
      h('h3', {}, 'Aportes dinámicos'),
      W.segmented({ label: 'Frecuencia del aporte', value: state.frecuenciaAporte, options: [{ value: 12, label: 'Mensual' }, { value: 1, label: 'Anual' }], onChange: (v) => set({ frecuenciaAporte: v }) }),
      W.slider({ label: 'Aporte por periodo (base)', min: -5000, max: 10000, step: 10, value: state.aporte, unit: '$', fmt: fmt.money, hint: 'Negativo = retiros periódicos.', onInput: (v) => set({ aporte: v }) }),
      W.slider({ label: 'Crecimiento anual del aporte', min: 0, max: 20, step: 0.5, value: state.crecimientoAporte, fmt: (v) => '+' + fmt.pct(v), hint: 'Ej. subir el aporte con tu salario o la inflación.', onInput: (v) => set({ crecimientoAporte: v }) }),
      W.tramos({ label: 'Cambios de aporte por etapas', rows: state.tramos, onChange: (v) => set({ tramos: v }) }),
      h('h3', {}, 'Ajustes de realidad (base)'),
      W.slider({ label: 'Inflación anual', min: 0, max: 15, step: 0.1, value: state.inflacion, fmt: (v) => fmt.pct(v),
        hint: inflHoy != null ? `Actual EE.UU.: ${fmt.pct(inflHoy)} · supuesto largo plazo: ${fmt.pct(inflLP ?? 2.5)}` : null, onInput: (v) => set({ inflacion: v }) }),
      W.slider({ label: 'Comisión anual (gestión/ETF)', min: 0, max: 3, step: 0.05, value: state.comision, fmt: (v) => fmt.pct(v, 2), hint: 'ETF indexado 0,03–0,2% · fondo activo 1–2%.', onInput: (v) => set({ comision: v }) }),
      h('div', { class: 'w-hint', style: 'margin-top:8px' }, '¿Un año distinto? Personalízalo en «Plan año por año», debajo de las gráficas.'),
    );

    r.legend = h('div', { class: 'legend' });
    r.chart = h('div');
    r.stack = h('div');
    r.heat = h('div');
    r.stackTitle = h('small');
    r.gridSum = h('span', { class: 'muted' });
    r.grid = h('div', { class: 'tabla-wrap tabla-anual' });
    main.append(h('div', { class: 'layout' }, controles, h('div', { class: 'stack' },
      h('section', { class: 'panel' },
        h('h2', {}, 'Crecimiento proyectado', W.segmented({ value: state.vista, options: [{ value: 'nominal', label: 'Nominal' }, { value: 'real', label: 'Real (hoy)' }], onChange: (v) => set({ vista: v }) })),
        r.legend, r.chart),
      h('div', { class: 'row2' },
        h('section', { class: 'panel' }, h('h2', {}, 'Composición del saldo', r.stackTitle), r.stack),
        h('section', { class: 'panel' }, h('h2', {}, 'Sensibilidad: tasa base × años', h('small', {}, 'valor final nominal')), r.heat)),
      h('section', { class: 'panel' },
        h('h2', {}, 'Plan año por año', r.gridSum),
        h('p', { class: 'w-hint', style: 'margin:0 0 8px' }, 'Cada celda muestra el valor vigente ese año. Escribe otro valor para cambiar ', h('b', {}, 'solo ese año'),
          ' (queda resaltado). ↧ copia los cambios de la fila a todos los años siguientes; ↺ la devuelve al valor base. «Extra único» es un aporte o retiro puntual.'),
        h('div', { class: 'presets', style: 'margin-bottom:8px' },
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { state.porAnio = {}; proy.dibujarGrid(true); render(); } }, '↺ Restablecer todos los años')),
        r.grid),
    )));
    proy.dibujarGrid(true);
  };

  /** Tabla editable año por año. Se reconstruye solo si cambia el número de años; si no, se sincroniza. */
  proy.dibujarGrid = (forzar) => {
    const r = proy.refs;
    if (!r.grid) return;
    if (!forzar && r.gridFilas === state.anios) return;
    r.gridFilas = state.anios;
    const filas = [];
    for (let y = 1; y <= state.anios; y++) {
      filas.push(h('tr', { 'data-y': y },
        h('td', {}, h('b', {}, y)),
        CAMPOS_ANIO.map((c) => h('td', {}, c.opciones
          ? h('select', { 'data-k': c.k, 'aria-label': `${c.label} año ${y}` }, c.opciones.map(([v, l]) => h('option', { value: v }, l)))
          : h('input', { type: 'number', step: c.step, 'data-k': c.k, title: c.title, 'aria-label': `${c.label} año ${y}` }))),
        h('td', { class: 'saldo' }), h('td', { class: 'saldo-real' }),
        h('td', { class: 'acc' },
          h('button', { class: 'mini', 'data-acc': 'prop', title: 'Copiar los cambios de este año a los siguientes' }, '↧'),
          h('button', { class: 'mini', 'data-acc': 'reset', title: 'Volver a los valores base' }, '↺'))));
    }
    const tabla = h('table', { class: 'anual editable' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Año'), CAMPOS_ANIO.map((c) => h('th', { title: c.title }, c.label)), h('th', {}, 'Saldo fin de año'), h('th', {}, 'Saldo real'), h('th', {}, ''))),
      h('tbody', {}, filas));
    const valorDe = (el) => (el.value === '' ? null : Number(el.value));
    const editar = (ev) => {
      const el = ev.target, k = el.dataset.k;
      if (!k) return;
      const y = +el.closest('tr').dataset.y;
      const v = valorDe(el);
      const ov = { ...(state.porAnio[y] || {}) };
      const base = Engine.parametrosDelAnio({ ...paramsProy(), porAnio: {} }, y)[k];
      if (v == null || !isFinite(v) || Math.abs(v - base) < 1e-9) delete ov[k]; else ov[k] = v;
      if (Object.keys(ov).length) state.porAnio[y] = ov; else delete state.porAnio[y];
      render();
    };
    tabla.addEventListener('change', editar);
    tabla.addEventListener('input', (ev) => { if (ev.target.tagName === 'INPUT') { clearTimeout(proy.tEd); proy.tEd = setTimeout(() => editar(ev), 250); } });
    tabla.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-acc]');
      if (!b) return;
      const y = +b.closest('tr').dataset.y;
      if (b.dataset.acc === 'reset') delete state.porAnio[y];
      else {
        const ov = { ...(state.porAnio[y] || {}) };
        delete ov.extra; // un aporte único no se repite
        if (!Object.keys(ov).length) { toast('Este año no tiene cambios para copiar (el «extra único» no se copia).'); return; }
        for (let z = y + 1; z <= state.anios; z++) state.porAnio[z] = { ...(state.porAnio[z] || {}), ...ov };
        toast(`Cambios del año ${y} aplicados a los años ${y + 1}–${state.anios}.`);
      }
      render();
    });
    r.grid.replaceChildren(tabla);
  };
  proy.sincronizarGrid = (filasProy) => {
    const r = proy.refs;
    if (!r.grid) return;
    proy.dibujarGrid(false);
    const p = paramsProy();
    r.grid.querySelectorAll('tbody tr').forEach((tr) => {
      const y = +tr.dataset.y;
      const ef = Engine.parametrosDelAnio(p, y);
      const ov = state.porAnio[y] || {};
      tr.classList.toggle('con-ajuste', Object.keys(ov).length > 0);
      tr.querySelectorAll('[data-k]').forEach((el) => {
        const c = CAMPOS_ANIO.find((x) => x.k === el.dataset.k);
        el.classList.toggle('ov', c.k in ov);
        if (document.activeElement === el) return;
        el.value = c.opciones ? String(ef[c.k]) : (c.k === 'extra' && !ef.extra ? '' : c.fmt(ef[c.k]));
        if (c.k === 'extra') el.placeholder = '0';
      });
      const f = filasProy[y];
      tr.querySelector('.saldo').textContent = f ? fmt.money(f.saldo) : '';
      tr.querySelector('.saldo-real').textContent = f ? fmt.money(f.real) : '';
    });
    const n = numAjustes();
    r.gridSum.textContent = n ? `${n} año${n > 1 ? 's' : ''} personalizado${n > 1 ? 's' : ''}` : 'todos los años usan los valores base';
  };

  proy.update = () => {
    if (!state.configurado) return;
    const r = proy.refs;
    const p = paramsProy();
    const esc0 = Engine.escenarios(p);
    const real = state.vista === 'real';
    const e0 = esc0[0];
    const defl = e0.filas.map((f) => f.deflactor || 1); // deflactor acumulado por año (inflación variable)
    const def = (y, anio) => (real ? y / (defl[anio] || 1) : y);
    const series = [];
    esc0.forEach((e, k) => {
      series.push({
        name: `Capital ${fmt.compact(e.capital)}`, color: cv(SERIES[k % 5]),
        data: e.filas.map((f) => ({ x: f.anio, y: def(f.saldo, f.anio) })),
        band: e.bajo ? e.filas.map((f, i) => ({ x: f.anio, lo: def(e.bajo[i].saldo, f.anio), hi: def(e.alto[i].saldo, f.anio) })) : null,
        bandLabel: `Tasa ± ${fmt.pct(state.varianza)}`,
      });
    });
    series.push({ name: 'Total aportado', color: cv('--ink-3'), dash: '5 4', width: 1.5, data: e0.filas.map((f) => ({ x: f.anio, y: def(f.aportado, f.anio) })) });
    if (e0.sinComision.some((f, i) => i && f.saldo !== e0.filas[i].saldo)) series.push({ name: 'Sin comisiones', color: cv('--gold'), dash: '2 4', width: 1.5, data: e0.sinComision.map((f) => ({ x: f.anio, y: def(f.saldo, f.anio) })) });

    r.legend.innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('') +
      (state.varianza ? `<span><i class="band" style="background:${cv('--s0')}"></i>Banda ± ${fmt.pct(state.varianza)}</span>` : '');
    Charts.line(r.chart, { series, yFmt: fmt.compact, xLabel: 'años', height: 330, tipTitle: (x) => {
      const q = e0.filas[x] && e0.filas[x].params;
      return `Año ${x}` + (q ? ` · tasa ${fmt.pct(q.tasa)}${state.porAnio[x] ? ' ✎' : ''}` : '');
    }, aria: 'Proyección del saldo por año' });

    r.stackTitle.textContent = `capital ${fmt.compact(e0.capital)}`;
    Charts.stacked(r.stack, {
      x: e0.filas.map((f) => f.anio), yFmt: fmt.compact, height: 230,
      layers: [
        { name: 'Capital inicial', color: cv('--s1'), values: e0.filas.map(() => e0.capital) },
        { name: 'Aportes acumulados', color: cv('--c-aporte'), values: e0.filas.map((f) => f.aportado - e0.capital) },
        { name: 'Interés compuesto', color: cv('--c-interes'), values: e0.filas.map((f) => f.interes) },
      ],
    });

    const offs = [-4, -2, -1, 0, 1, 2, 4];
    const tasas = [...new Set(offs.map((o) => +(state.tasa + o).toFixed(1)).filter((t) => t >= 0))];
    const anios = [...new Set([5, 10, 15, 20, 25, 30, 40, state.anios])].sort((a, b) => a - b);
    const base = { ...p, inicial: e0.capital };
    const cache = {};
    Charts.heatmap(r.heat, {
      corner: 'Años \\ Tasa',
      rows: anios.map((n) => ({ label: n + ' a', value: n })),
      cols: tasas.map((t) => ({ label: fmt.pct(t), value: t })),
      // la columna desplaza todas las tasas (también las personalizadas por año) en la misma cantidad
      cell: (rw, c) => (cache[rw.value + '|' + c.value] ??= ultimo(Engine.proyectar({ ...base, ajusteTasa: c.value - state.tasa, anios: rw.value })).saldo),
      fmt: fmt.compact,
      highlight: (rw, c) => rw.value === state.anios && c.value === +state.tasa.toFixed(1),
    });
    proy.sincronizarGrid(e0.filas);
  };

  /* ---------------- Portafolio ---------------- */
  const PRESETS = [
    { nombre: 'Buffett 90/10', nota: 'La instrucción de Buffett para su herencia: 90% índice S&P 500 de bajo costo, 10% bonos del Tesoro a corto plazo.', slots: [[['SPY', 'VOO', 'IVV'], 90], [['BIL', 'SHV', 'SGOV'], 10]] },
    { nombre: '100% S&P 500', slots: [[['SPY', 'VOO', 'IVV'], 100]] },
    { nombre: '60/40 clásico', slots: [[['SPY', 'VOO'], 60], [['IEF', 'AGG', 'BND'], 40]] },
    { nombre: 'Todo clima', slots: [[['SPY', 'VOO'], 30], [['TLT', 'IEF'], 40], [['TIP'], 15], [['GLD', 'GC=F', 'IAU'], 7.5], [['DBC', 'GSG'], 7.5]] },
    { nombre: 'Global diversificado', slots: [[['SPY', 'VOO'], 35], [['VEA', 'EFA'], 15], [['VWO', 'EEM'], 10], [['IEF', 'AGG'], 20], [['VNQ'], 10], [['GLD', 'GC=F'], 10]] },
    { nombre: 'Agresivo tech + cripto', slots: [[['QQQ'], 50], [['SMH', 'SOXX'], 20], [['BTC-USD'], 20], [['ETH-USD'], 10]] },
  ];
  function aplicarPreset(p) {
    const pesos = {};
    p.slots.forEach(([alts, w]) => { const a = porTicker(alts); if (a) pesos[a.id] = (pesos[a.id] || 0) + w; });
    state.port.pesos = pesos;
    if (p.nota) toast(p.nota);
  }

  /** Origen del retorno usado: 'esperado' | 'propio' | 'historico' | 'mercado10' | 'mercado5' (sin 10 años) | 'esperado*' (sin dato de mercado). */
  function origenRetorno(a, base) {
    const m = MERCADO.resultados[a.id];
    if (a.propio) return 'propio';
    if (base === 'historico') return 'historico';
    if (base === 'mercado') return m && m.cagr_10a != null ? 'mercado10' : m && m.cagr_5a != null ? 'mercado5' : 'esperado*';
    return 'esperado';
  }
  const ETIQUETA_ORIGEN = { esperado: '', propio: 'supuesto propio', historico: 'hist.', mercado10: 'CAGR 10a', mercado5: 'CAGR 5a (sin 10a)', 'esperado*': 'esperado (sin dato de mercado)' };
  /**
   * Retorno a usar en el portafolio. El techo de sensatez se aplica al valor FINAL
   * (después del ajuste del escenario macro) y a todos los orígenes, incluidos los activos propios.
   */
  function retornoInfo(a, base, esc) {
    const m = MERCADO.resultados[a.id];
    const origen = origenRetorno(a, base);
    const bruto = { historico: a.retorno_historico, mercado10: m && m.cagr_10a, mercado5: m && m.cagr_5a }[origen] ?? a.retorno_esperado_10a;
    const original = bruto + ((esc && esc.ajuste && esc.ajuste[a.categoria]) || 0);
    const limitado = original > TECHO_PASADO;
    return { r: limitado ? TECHO_PASADO : original, original, limitado, origen };
  }
  const retornoDe = (a, base, esc) => retornoInfo(a, base, esc).r;
  function volDe(a, base) {
    const m = MERCADO.resultados[a.id];
    return base === 'mercado' && m && m.volatilidad_5a ? m.volatilidad_5a : a.volatilidad;
  }

  /** Estadísticas + Monte Carlo para un conjunto de pesos y escenario. */
  function analizar(pesos, escId, sims = 2000) {
    const esc = escenario(escId);
    const base = state.port.base;
    const items = Object.entries(pesos).map(([id, peso]) => ({ a: activo(id), peso })).filter((x) => x.a && x.peso > 0)
      .map(({ a, peso }) => ({ peso, retorno: retornoDe(a, base, esc), volatilidad: volDe(a, base), categoria: a.categoria }));
    if (!items.length) return null;
    const st = Engine.portafolio(items, DATA.correlaciones);
    const infl = esc && esc.id !== 'base' && esc.inflacion != null ? esc.inflacion : state.inflacion;
    const mc = Engine.monteCarlo({ ...paramsProy(), inicial: state.capitales[0], retorno: st.retornoGeom, volatilidad: st.volatilidad, inflacion: infl, sims });
    return { st, mc, infl };
  }

  /** Alertas de honestidad compartidas por Portafolio y Macro. */
  function pintarAvisos(el, retornoMax) {
    const avisos = [];
    const es = escenario(state.port.escenario);
    const limitados = Object.keys(state.port.pesos).map(activo).filter((a) => a && retornoInfo(a, state.port.base, es).limitado);
    const propios = Object.keys(state.port.pesos).map(activo).filter((a) => a && a.propio && state.port.pesos[a.id] > 0);
    if (propios.length) avisos.push(`Incluyes activos propios (${propios.map((a) => esc(a.nombre)).join(', ')}): sus retornos son <b>tus supuestos, sin verificar</b> por la investigación de la app.`);
    if (state.port.base !== 'esperado') avisos.push(`Estás proyectando con retornos <b>pasados</b> (${state.port.base === 'historico' ? 'históricos de largo plazo' : 'CAGR reciente del mercado'}). ` +
      'Rentabilidad pasada ≠ esperada: perseguir lo que más subió es el error clásico del inversor. Usa «Esperado 10a» para planificar.');
    if (limitados.length) avisos.push(`Techo de sensatez: ${limitados.map((a) => `${esc(a.nombre)} (${fmt.pct(retornoInfo(a, state.port.base, es).original)})`).join(', ')} ${limitados.length > 1 ? 'se limitaron' : 'se limitó'} a ${fmt.pct(TECHO_PASADO)} anual` +
      `${es && es.id !== 'base' ? `, ya incluido el ajuste del escenario «${esc(es.nombre)}»` : ''}. Sostener más durante décadas es excepcional y produce cifras imposibles (miles de millones).`);
    if (retornoMax > 12) avisos.push(`Retorno de ${fmt.pct(retornoMax)} anual sostenido ${state.anios} años es excepcional (el S&P 500 promedió ~10% nominal en casi un siglo). Trata este resultado como un techo, no un plan.`);
    el.replaceChildren(...avisos.map((t) => h('div', { class: 'alerta', html: '⚠ ' + t })));
  }
  const NOMBRE_BASE = { esperado: 'Esperado 10a', historico: 'Histórico', mercado: 'Mercado 10a' };

  const port = { refs: {}, pesado: true };
  port.build = (main) => {
    if (!state.configurado) return vacio(main, 'Tu portafolio usa tu plan', 'El portafolio proyecta tu capital, tus aportes y tu horizonte: configúralos primero.');
    const r = port.refs;
    r.lista = h('div');
    r.total = h('div', { class: 'total-peso' });
    function dibujarPesos() {
      const ids = Object.keys(state.port.pesos);
      r.lista.replaceChildren(...(ids.length ? ids.map((id) => {
        const a = activo(id);
        if (!a) return '';
        const info = retornoInfo(a, state.port.base, escenario(state.port.escenario));
        const etiqueta = ETIQUETA_ORIGEN[info.origen];
        return h('div', { class: 'peso' },
          h('button', { class: 'nombre link', title: 'Ver ficha', onclick: () => abrirFicha(a) }, a.nombre, a.propio ? h('span', { class: 'badge badge-propio' }, 'propio') : null,
            h('small', {}, info.limitado ? `${fmt.pct(info.original)}${etiqueta ? ' ' + etiqueta : ''} → se usa ${fmt.pct(info.r)} (techo)` : `${fmt.pct(info.r)}${etiqueta ? ' ' + etiqueta : ''}`, ` · vol ${fmt.pct(volDe(a, state.port.base), 0)}`)),
          h('button', { class: 'chip-x', title: 'Quitar', 'aria-label': 'Quitar ' + a.nombre, onclick: () => { delete state.port.pesos[id]; dibujarPesos(); render(); } }, '×'),
          W.slider({ label: 'Peso de ' + a.nombre, min: 0, max: 100, step: 0.5, value: state.port.pesos[id], fmt: (v) => fmt.pct(v), onInput: (v) => { state.port.pesos[id] = v; render(); } }));
      }) : [h('div', { class: 'w-hint' }, 'Sin activos todavía. Elige una cartera modelo o añade activos desde el catálogo.')]));
    }
    port.redibujarPesos = dibujarPesos;
    dibujarPesos();

    const controles = h('aside', { class: 'panel controls' },
      h('h3', {}, 'Carteras modelo'),
      h('div', { class: 'presets' }, PRESETS.map((p) => h('button', { class: 'btn btn-sm', title: p.nota || '', onclick: () => { aplicarPreset(p); dibujarPesos(); render(); } }, p.nombre))),
      h('h3', {}, 'Supuestos'),
      W.segmented({ label: 'Base del retorno', value: state.port.base, options: [{ value: 'esperado', label: 'Esperado 10a' }, { value: 'historico', label: 'Histórico' }, { value: 'mercado', label: 'Mercado 10a' }],
        onChange: (v) => { state.port.base = v; dibujarPesos(); render(); if (v === 'mercado' && !Object.keys(MERCADO.resultados).length) toast('Pulsa «Actualizar mercado» para traer los CAGR reales de 10 años.'); } }),
      h('div', { class: 'w' }, h('div', { class: 'w-head' }, h('label', {}, 'Escenario macro')),
        h('select', { style: 'width:100%', onchange: (e) => { state.port.escenario = e.target.value; dibujarPesos(); render(); } },
          DATA.escenarios.map((e) => h('option', { value: e.id, selected: e.id === state.port.escenario }, `${e.nombre} (${e.probabilidad}%)`)))),
      h('div', { class: 'w-hint' }, 'Capital, aportes (y sus ajustes por año), horizonte, inflación y comisión vienen de tu plan.'),
      h('h3', {}, 'Tus activos y pesos'),
      r.lista, r.total,
      h('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:6px', onclick: () => abrirCatalogo(() => { dibujarPesos(); render(); }) }, '+ Añadir activos (ver universo)'),
    );
    r.alerta = h('div');
    r.kpis = h('div', { class: 'kpis' });
    r.fan = h('div'); r.fanLegend = h('div', { class: 'legend' });
    r.comp = h('div'); r.cats = h('div'); r.nota = h('div', { class: 'w-hint' });
    r.cuerpo = h('div', { class: 'stack' },
      r.alerta, r.kpis,
      h('section', { class: 'panel' }, h('h2', {}, 'Monte Carlo · 2.000 trayectorias', W.segmented({ value: state.vista, options: [{ value: 'nominal', label: 'Nominal' }, { value: 'real', label: 'Real (hoy)' }], onChange: (v) => set({ vista: v }) })), r.fanLegend, r.fan, r.nota),
      h('div', { class: 'row2' },
        h('section', { class: 'panel' }, h('h2', {}, 'Mismo plan, otro activo', h('small', {}, 'mediana a ' + state.anios + ' años')), r.comp),
        h('section', { class: 'panel' }, h('h2', {}, 'Asignación por categoría'), r.cats)));
    main.append(h('div', { class: 'layout' }, controles, r.cuerpo));
  };
  port.update = () => {
    if (!state.configurado) return;
    const r = port.refs;
    const total = Object.values(state.port.pesos).reduce((a, b) => a + b, 0);
    r.total.className = 'total-peso' + (Math.abs(total - 100) > 0.5 ? ' mal' : '');
    r.total.replaceChildren(h('span', {}, 'Total ', h('b', {}, fmt.pct(total))),
      total > 0 && Math.abs(total - 100) > 0.5 ? h('button', { class: 'btn btn-sm', onclick: () => {
        for (const k in state.port.pesos) state.port.pesos[k] = +((state.port.pesos[k] / total) * 100).toFixed(1);
        port.redibujarPesos(); render();
      } }, 'Normalizar a 100%') : h('span', { class: 'muted' }, total > 0 ? 'se normaliza al calcular' : ''));
    const res = analizar(state.port.pesos, state.port.escenario);
    if (!res) {
      r.alerta.replaceChildren(); r.kpis.replaceChildren(h('div', { class: 'panel vacio-mini' }, h('b', {}, 'Tu portafolio está vacío. '), 'Elige una cartera modelo a la izquierda o pulsa «+ Añadir activos» para ver el universo completo y crear tus propios activos.'));
      r.fan.innerHTML = ''; r.fanLegend.innerHTML = ''; r.comp.innerHTML = ''; r.cats.innerHTML = ''; r.nota.textContent = '';
      return;
    }
    const { st, mc, infl } = res;
    const real = state.vista === 'real';
    const d = (b, v) => (real ? v / b.d : v);
    const fin = mc.bandas[mc.bandas.length - 1];
    const beneficio = st.volatilidadSinDiversificar - st.volatilidad;
    const conRetiros = state.aporte < 0 || (state.tramos || []).some((t) => t.monto < 0) || Object.values(state.porAnio).some((o) => o.aporte < 0 || o.extra < 0);
    pintarAvisos(r.alerta, st.retornoGeom);
    r.kpis.replaceChildren(
      W.kpi({ label: 'Retorno esperado (geom.)', value: fmt.pct(st.retornoGeom), sub: `incl. rebalanceo +${fmt.num(st.bonoRebalanceo, 2)} pp`, tone: 'pos',
        title: `Media ponderada de los retornos de cada activo más un bono de rebalanceo limitado a 0,5 pp (el teórico sería ${fmt.num(st.bonoTeorico, 1)} pp, pero supone rebalanceo perfecto y sin costos).` }),
      W.kpi({ label: 'Volatilidad anual', value: fmt.pct(st.volatilidad), sub: `sin diversificar ${fmt.pct(st.volatilidadSinDiversificar)}` }),
      W.kpi({ label: 'Beneficio diversificación', value: '−' + fmt.pct(beneficio), sub: 'de volatilidad', tone: beneficio > 0.5 ? 'pos' : 'neutral' }),
      W.kpi({ label: `Mediana P50 · ${state.anios} a`, value: fmt.compact(d(fin, fin.p50)), sub: real ? 'en dinero de hoy' : `real ${fmt.compact(fin.p50 / fin.d)}`, tone: 'gold' }),
      W.kpi({ label: 'Rango P10 – P90', value: `${fmt.compact(d(fin, fin.p10))} – ${fmt.compact(d(fin, fin.p90))}`, sub: '80% de los casos', small: true }),
      conRetiros
        ? W.kpi({ label: 'Prob. de agotar el capital', value: fmt.pct(mc.probAgotar * 100, 0), sub: `con retiros, en ${state.anios} años`, tone: mc.probAgotar > 0.1 ? 'neg' : 'pos' })
        : W.kpi({ label: 'Prob. valor real < aportado', value: fmt.pct(mc.probPerdida * 100, 0), sub: `aportado ${fmt.compact(mc.aportadoReal)} en dinero de hoy`, tone: mc.probPerdida > 0.15 ? 'neg' : 'pos',
          title: 'Fracción de trayectorias cuyo valor final, en dinero de hoy, queda por debajo de lo que aportaste (cada aporte deflactado a su fecha).' }),
      W.kpi({ label: 'Año malo (≈1 de 20)', value: fmt.pctSigned(st.retornoArit - 1.65 * st.volatilidad), sub: 'retorno − 1,65σ', tone: 'neg' }),
    );
    const c0 = cv('--s0'), c1 = cv('--s1');
    const det = Engine.proyectar({ ...paramsProy(), inicial: state.capitales[0], tasa: st.retornoGeom, capitalizacion: 1 });
    const series = [
      { name: 'Mediana (P50)', color: c0, data: mc.bandas.map((b) => ({ x: b.anio, y: d(b, b.p50) })), band: mc.bandas.map((b) => ({ x: b.anio, lo: d(b, b.p10), hi: d(b, b.p90) })), bandLabel: 'P10–P90', bandOpacity: 0.18 },
      { name: 'P90 (optimista)', color: c1, width: 1.2, dash: '3 3', data: mc.bandas.map((b) => ({ x: b.anio, y: d(b, b.p90) })) },
      { name: 'P10 (pesimista)', color: cv('--neg'), width: 1.2, dash: '3 3', data: mc.bandas.map((b) => ({ x: b.anio, y: d(b, b.p10) })) },
      { name: 'Total aportado', color: cv('--ink-3'), width: 1.5, dash: '6 4', data: det.map((f) => ({ x: f.anio, y: real ? f.aportado / mc.bandas[f.anio].d : f.aportado })) },
    ];
    r.fanLegend.innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
    Charts.line(r.fan, { series, yFmt: fmt.compact, xLabel: 'años', height: 320, tipTitle: (x) => `Año ${x}` });
    const es = escenario(state.port.escenario);
    r.nota.textContent = `Escenario: ${es ? es.nombre : 'base'} · inflación ${fmt.pct(infl)} · comisión ${fmt.pct(state.comision, 2)} · base «${NOMBRE_BASE[state.port.base]}» · retornos lognormales con correlaciones entre categorías. ` +
      'La dispersión real puede ser mayor (colas gruesas, crisis simultáneas).';

    const bench = [['SPY', 'VOO'], ['IEF', 'AGG'], ['BIL', 'SGOV'], ['GLD', 'GC=F'], ['VNQ'], ['BTC-USD']].map(porTicker).filter(Boolean);
    const items = [{ label: '<b>▶ Tu portafolio</b>', sub: `vol ${fmt.pct(st.volatilidad, 0)} · P10 ${fmt.compact(d(fin, fin.p10))}`, value: d(fin, fin.p50), color: c0 }];
    bench.forEach((a, k) => {
      const m = analizar({ [a.id]: 100 }, state.port.escenario, 700);
      const f = m.mc.bandas[m.mc.bandas.length - 1];
      items.push({ label: esc(a.nombre), sub: `${fmt.pct(m.st.retornoGeom)} · vol ${fmt.pct(m.st.volatilidad, 0)} · P10 ${fmt.compact(d(f, f.p10))}`, value: d(f, f.p50), color: cv(SERIES[(k + 1) % 5]) });
    });
    Charts.bars(r.comp, { items: items.sort((a, b) => b.value - a.value), fmt: fmt.compact });

    const porCat = {};
    Object.entries(state.port.pesos).forEach(([id, w]) => { const a = activo(id); if (a) porCat[a.categoria] = (porCat[a.categoria] || 0) + w; });
    Charts.bars(r.cats, { items: Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([c, w], k) => ({ label: esc(categoria(c)), value: (w / (total || 1)) * 100, color: cv(SERIES[k % 5]) })), fmt: (v) => fmt.pct(v) });
  };

  /* ---------------- Catálogo de activos + activos propios ---------------- */
  function riesgoHTML(n) { return `<span class="riesgo r${n}" title="Riesgo ${n}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`; }

  function abrirCatalogo(alCambiar) {
    let filtro = 'todas', q = '';
    abrirModal((cerrar) => {
      const lista = h('div', { class: 'cat-lista' });
      const chips = h('div', { class: 'toolbar', style: 'margin:0' });
      const contador = h('span', { class: 'muted' });
      const dibujar = () => {
        const ql = q.trim().toLowerCase();
        const vis = DATA.activos.filter((a) => (filtro === 'todas' || (filtro === 'propios' ? a.propio : a.categoria === filtro)) &&
          (!ql || [a.nombre, a.ticker, a.subtipo, a.tendencia, categoria(a.categoria)].join(' ').toLowerCase().includes(ql)));
        const n = Object.keys(state.port.pesos).length;
        contador.textContent = `${vis.length} activos · ${n} en tu portafolio`;
        const chip = (id, label) => h('button', { class: 'cat-chip' + (filtro === id ? ' on' : ''), onclick: () => { filtro = id; dibujar(); } }, label);
        chips.replaceChildren(chip('todas', 'Todas'), ...DATA.categorias.map((c) => chip(c.id, c.nombre)), chip('propios', `Mis activos (${state.propios.length})`));
        const grupos = DATA.categorias.map((c) => [c, vis.filter((a) => a.categoria === c.id)]).filter(([, l]) => l.length);
        lista.replaceChildren(...(grupos.length ? grupos.map(([c, l]) => h('div', { class: 'cat-grupo' },
          h('h4', {}, c.nombre, h('small', { class: 'muted' }, ' · ' + (c.descripcion || ''))),
          l.map((a) => {
            const en = a.id in state.port.pesos;
            return h('div', { class: 'cat-fila' + (en ? ' en' : '') },
              h('div', { class: 'cat-nom' }, h('b', {}, a.nombre), a.propio ? h('span', { class: 'badge badge-propio' }, 'propio') : null,
                h('small', {}, [a.ticker, a.subtipo, a.tendencia].filter(Boolean).join(' · '))),
              h('div', { class: 'cat-m', html: `<span>Esperado</span><b>${fmt.pct(a.retorno_esperado_10a)}</b>` }),
              h('div', { class: 'cat-m', html: `<span>Histórico</span><b>${fmt.pct(a.retorno_historico)}</b>` }),
              h('div', { class: 'cat-m', html: `<span>Volatilidad</span><b>${fmt.pct(a.volatilidad, 0)}</b>` }),
              h('div', { class: 'cat-m', html: `<span>Riesgo</span>${riesgoHTML(a.riesgo)}` }),
              h('div', { class: 'cat-acc' },
                h('button', { class: 'btn btn-sm btn-ghost', onclick: () => abrirFicha(a) }, 'Ficha'),
                a.propio ? h('button', { class: 'btn btn-sm btn-ghost', title: 'Eliminar activo propio', onclick: () => {
                  state.propios = state.propios.filter((x) => x.id !== a.id); DATA.activos = DATA.activos.filter((x) => x.id !== a.id);
                  delete state.port.pesos[a.id]; state.seguidos = state.seguidos.filter((x) => x !== a.id); delete MERCADO.resultados[a.id];
                  guardarMercado(); save(); actualizarBoton(); dibujar(); alCambiar && alCambiar();
                } }, 'Eliminar') : null,
                h('button', { class: 'btn btn-sm' + (en ? ' on' : ' btn-primary'), onclick: () => {
                  if (en) delete state.port.pesos[a.id]; else state.port.pesos[a.id] = 10;
                  save(); dibujar(); alCambiar && alCambiar();
                } }, en ? '✓ En cartera' : '+ Añadir')));
          }))) : [h('div', { class: 'w-hint', style: 'padding:20px' }, filtro === 'propios' ? 'Aún no creaste activos propios: usa el formulario de arriba.' : 'Sin resultados.')]));
      };

      // formulario de activo propio
      const f = {};
      const inp = (k, attrs) => (f[k] = h('input', { ...attrs, id: 'np-' + k }));
      const err = h('div', { class: 'cfg-err' });
      const form = h('form', { class: 'nuevo-activo', novalidate: true, onsubmit: (e) => {
        e.preventDefault();
        const nombre = f.nombre.value.trim(), ret = Number(f.ret.value), vol = Number(f.vol.value), ticker = f.ticker.value.trim().toUpperCase();
        if (!nombre || f.ret.value === '' || f.vol.value === '' || !isFinite(ret) || !isFinite(vol) || vol < 0 || vol > 200 || ret < -30 || ret > 25) {
          err.textContent = 'Indica nombre, retorno esperado (−30 a 25% anual; Berkshire promedió ~20% en 60 años) y volatilidad (0 a 200%).'; return;
        }
        if (ticker && !/^[A-Z0-9.^=\-]{1,15}$/.test(ticker)) { err.textContent = 'Ticker no válido (usa el símbolo de Yahoo Finance, p. ej. AAPL, BRK-B, ^GSPC).'; return; }
        const a = {
          id: 'propio_' + Date.now().toString(36), propio: true, nombre, categoria: f.cat.value, subtipo: 'Activo definido por ti', ticker: ticker || null,
          retorno_historico: ret, retorno_esperado_10a: ret, volatilidad: vol, periodo_historico: 'supuesto propio',
          peor_anio: +(ret - 2 * vol).toFixed(1), mejor_anio: +(ret + 2 * vol).toFixed(1), max_drawdown: -Math.min(95, +(2.5 * vol).toFixed(0)), rendimiento_flujo: 0,
          liquidez: 'n/d', riesgo: Math.max(1, Math.min(5, Math.ceil(vol / 12))), horizonte_min: vol > 25 ? 10 : 5, tendencia: 'Tu activo',
          supuestos: ['Retorno y volatilidad definidos por el inversor.', f.nota.value.trim()].filter(Boolean), riesgos: ['Supuestos sin verificar por la investigación de la app.'], catalizadores: [],
          fuente: 'Supuestos propios del inversor',
        };
        state.propios.push(a); DATA.activos.push(a); state.port.pesos[a.id] = 10;
        save(); form.reset(); err.textContent = ''; filtro = 'propios'; dibujar(); alCambiar && alCambiar();
        toast(`«${nombre}» creado y añadido a tu portafolio con 10%.`);
      } },
      h('div', { class: 'np-grid' },
        h('label', {}, 'Nombre', inp('nombre', { placeholder: 'Ej. Mi negocio, Acción Apple, Depósito a plazo' })),
        h('label', {}, 'Categoría (para correlaciones)', f.cat = h('select', {}, DATA.categorias.map((c) => h('option', { value: c.id }, c.nombre)))),
        h('label', {}, 'Retorno esperado anual %', inp('ret', { type: 'number', step: 'any', placeholder: 'Ej. 7' })),
        h('label', {}, 'Volatilidad anual %', inp('vol', { type: 'number', step: 'any', placeholder: 'Ej. 20 (acciones ~15–30)' })),
        h('label', {}, 'Ticker Yahoo (opcional)', inp('ticker', { placeholder: 'Ej. AAPL — para actualizar precio' })),
        h('label', {}, 'Nota (opcional)', inp('nota', { placeholder: 'Tu tesis o supuesto' }))),
      h('div', { class: 'np-pie' }, err, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Crear y añadir')));

      const buscador = h('input', { type: 'search', placeholder: 'Buscar por nombre, ticker o tema…', 'aria-label': 'Buscar activo', oninput: (e) => { q = e.target.value; dibujar(); } });
      dibujar();
      return [
        h('div', { class: 'modal-head' }, h('h2', {}, 'Universo de activos'), h('p', { class: 'muted' }, 'Todo lo que puedes añadir a tu portafolio, con su retorno esperado, histórico, volatilidad y riesgo. Abre la ficha para ver el análisis y las fuentes.')),
        h('details', { class: 'np-box' }, h('summary', {}, '＋ Crear un activo propio (cualquier inversión que no esté en la lista)'), form),
        h('div', { class: 'toolbar' }, buscador, contador), chips,
        lista,
        h('div', { class: 'cfg-pie' }, h('button', { class: 'btn btn-primary', onclick: cerrar }, 'Listo')),
      ];
    }, { clase: 'modal-grande' });
  }

  /* ---------------- Ficha ampliada de activo ---------------- */
  const FUENTES = [
    [/J\.?\s?P\.?\s?Morgan|\bJPM\b/i,'J.P. Morgan — Long-Term Capital Market Assumptions', 'https://am.jpmorgan.com/us/en/asset-management/adv/insights/portfolio-insights/ltcma/'],
    [/Vanguard|VCMM/i, 'Vanguard — Pronósticos de retorno (VEMO)', 'https://corporate.vanguard.com/content/corporatesite/us/en/corp/vemo/vemo-return-forecasts.html'],
    [/Damodaran/i, 'Damodaran (NYU Stern) — Retornos históricos', 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html'],
    [/Research Affiliates/i, 'Research Affiliates — Asset Allocation Interactive', 'https://interactive.researchaffiliates.com/asset-allocation'],
    [/BlackRock/i, 'BlackRock — Capital market assumptions', 'https://www.blackrock.com/institutions/en-us/insights/charts/capital-market-assumptions'],
    [/GMO/i, 'GMO — Research library', 'https://www.gmo.com/americas/research-library/'],
    [/Shiller|CAPE/i, 'Robert Shiller (Yale) — Datos de mercado', 'http://www.econ.yale.edu/~shiller/data.htm'],
    [/Nareit/i, 'Nareit — Datos de REITs', 'https://www.reit.com/data-research'],
    [/Case-Shiller/i, 'S&P CoreLogic Case-Shiller (FRED)', 'https://fred.stlouisfed.org/series/CSUSHPINSA'],
    [/Cambridge Associates/i, 'Cambridge Associates — Benchmarks', 'https://www.cambridgeassociates.com/benchmarks/'],
    [/HFR/i, 'HFR — Índices de hedge funds', 'https://www.hfr.com/'],
    [/MSCI/i, 'MSCI — Índices', 'https://www.msci.com/indexes'],
    [/Jord/i, 'Jordà et al. — The Rate of Return on Everything', 'https://www.frbsf.org/research-and-insights/publications/working-papers/2017/12/the-rate-of-return-on-everything-1870-2015/'],
    [/World Gold|WGC/i, 'World Gold Council — Datos', 'https://www.gold.org/goldhub/data'],
    [/FRED|St\.? Louis/i, 'FRED — Federal Reserve Bank of St. Louis', 'https://fred.stlouisfed.org/'],
    [/CBOE|BXM/i, 'Cboe — Índice BXM', 'https://www.cboe.com/us/indices/dashboard/bxm/'],
    [/Morningstar/i, 'Morningstar', 'https://www.morningstar.com/'],
  ];
  function enlacesDe(a) {
    const out = [];
    if (a.ticker) out.push([`Cotización y gráfico de ${a.ticker} — Yahoo Finance`, `https://finance.yahoo.com/quote/${encodeURIComponent(a.ticker)}`]);
    if (a.categoria === 'cripto') out.push(['CoinGecko — Datos de mercado cripto', 'https://www.coingecko.com/']);
    const txt = [a.fuente, ...(a.supuestos || [])].join(' ');
    FUENTES.forEach(([re, t, u]) => { if (re.test(txt) && !out.some((x) => x[1] === u)) out.push([t, u]); });
    if (a.fuente && !a.propio) out.push([`Buscar la fuente citada: «${a.fuente.slice(0, 80)}${a.fuente.length > 80 ? '…' : ''}»`, 'https://www.google.com/search?q=' + encodeURIComponent(a.fuente)]);
    return out;
  }
  const enlace = ([t, u]) => h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', class: 'fuente-link' }, t, h('span', { 'aria-hidden': 'true' }, ' ↗'));

  function lecturaOraculo(a) {
    const out = [];
    const infl = state.configurado ? state.inflacion : (DATA.macro.inflacion_largo_plazo_supuesta ?? 2.5);
    const sp = porTicker(['SPY', 'VOO', 'IVV']);
    const realEsp = ((1 + a.retorno_esperado_10a / 100) / (1 + infl / 100) - 1) * 100;
    out.push([realEsp > 2 ? 'pos' : realEsp > 0 ? 'neutral' : 'neg', `Rendimiento real esperado ≈ <b>${fmt.pct(realEsp)}</b> anual tras una inflación de ${fmt.pct(infl)}.`]);
    if (sp && a.id !== sp.id) {
      const dif = a.retorno_esperado_10a - sp.retorno_esperado_10a;
      const efA = a.retorno_esperado_10a / Math.max(1, a.volatilidad), efS = sp.retorno_esperado_10a / Math.max(1, sp.volatilidad);
      out.push([efA >= efS ? 'pos' : 'neg', `Frente al S&P 500: ${dif >= 0 ? '+' : ''}${fmt.num(dif, 1)} pp de retorno esperado con ${a.volatilidad > sp.volatilidad ? 'más' : 'menos'} volatilidad (${fmt.pct(a.volatilidad, 0)} vs ${fmt.pct(sp.volatilidad, 0)}). ` +
        `Retorno por unidad de riesgo: ${fmt.num(efA, 2)} vs ${fmt.num(efS, 2)}.`]);
    }
    const gap = a.retorno_historico - a.retorno_esperado_10a;
    if (gap > 3) out.push(['neg', `El pasado rindió <b>${fmt.num(gap, 1)} pp más</b> que lo esperado (${fmt.pct(a.retorno_historico)} vs ${fmt.pct(a.retorno_esperado_10a)}, periodo ${esc(a.periodo_historico || 'n/d')}). No lo extrapoles: los analistas esperan menos.`]);
    if (a.max_drawdown) {
      const x = Math.abs(a.max_drawdown) / 100;
      if (x < 1) out.push([x > 0.4 ? 'neg' : 'neutral', `Peor caída histórica ${fmt.pct(a.max_drawdown, 0)}: recuperarse exige <b>+${fmt.pct((1 / (1 - x) - 1) * 100, 0)}</b>. ¿Podrías aguantarla sin vender?`]);
    }
    if (a.volatilidad > 40) out.push(['neg', `Volatilidad de ${fmt.pct(a.volatilidad, 0)}: la mediana de largo plazo queda muy por debajo del promedio de los años buenos, y un mal año puede borrar varios buenos.`]);
    if (a.horizonte_min) out.push(['neutral', `Horizonte mínimo sugerido: <b>${a.horizonte_min} años</b> · liquidez ${esc(a.liquidez)}.`]);
    if (a.categoria === 'derivados') out.push(['neg', 'Producto con derivados: entiende cómo gana y pierde antes de invertir («nunca inviertas en un negocio que no entiendes»).']);
    if (a.categoria === 'cripto' || a.categoria === 'especulativo') out.push(['neg', 'Activo especulativo: dimensiona la posición para poder perderla entera sin cambiar tu plan.']);
    if (a.propio) out.push(['neutral', 'Activo propio: sus cifras son tus supuestos, no datos verificados.']);
    return out;
  }

  function abrirFicha(a) {
    abrirModal((cerrar) => {
      const m = MERCADO.resultados[a.id];
      const n = aniosVista();
      const seguido = () => state.seguidos.includes(a.id);
      const estrella = h('button', { class: 'btn btn-sm' + (seguido() ? ' on' : ''), onclick: () => {
        state.seguidos = seguido() ? state.seguidos.filter((x) => x !== a.id) : [...state.seguidos, a.id];
        estrella.classList.toggle('on', seguido()); estrella.textContent = seguido() ? '★ Siguiendo' : '☆ Seguir'; save(); actualizarBoton();
        if (state.tab === 'activos') render();
      } }, seguido() ? '★ Siguiendo' : '☆ Seguir');
      const met = (l, v, cls = '') => `<div class="metric"><span>${l}</span><b class="${cls}">${v}</b></div>`;
      const grafProy = h('div'), grafMercado = h('div'), resumenProy = h('div', { class: 'w-hint' });
      const cuerpo = [
        h('div', { class: 'ficha-head' },
          h('div', {},
            h('div', { class: 'ficha-badges' }, h('span', { class: 'badge' }, categoria(a.categoria)), a.ticker ? h('span', { class: 'badge' }, a.ticker) : null,
              a.propio ? h('span', { class: 'badge badge-propio' }, 'propio') : null, a.tendencia ? h('span', { class: 'badge' }, a.tendencia) : null),
            h('h2', {}, a.nombre), h('div', { class: 'muted' }, a.subtipo || '', ' · ', h('span', { html: 'Riesgo ' + riesgoHTML(a.riesgo) }))),
          h('div', { class: 'presets' }, estrella,
            h('button', { class: 'btn btn-sm', onclick: () => {
              state.tasa = +a.retorno_esperado_10a.toFixed(2); save(); cerrar(); document.querySelectorAll('.modal-bg').forEach((x) => x.remove()); nivelModal = 0; document.body.classList.remove('con-modal');
              if (!state.configurado) { abrirAsistente(); toast(`Sugerencia: tasa ${fmt.pct(a.retorno_esperado_10a)} (${a.nombre}). Completa tu plan.`); return; }
              toast(`Tasa base fijada en ${fmt.pct(state.tasa)} (${a.nombre}).`); mostrarTab('proyeccion');
            } }, 'Proyectar con este retorno'),
            h('button', { class: 'btn btn-sm btn-primary', onclick: (e) => {
              state.port.pesos[a.id] = state.port.pesos[a.id] || 10; save(); e.currentTarget.textContent = '✓ En el portafolio'; toast(`${a.nombre} añadido al portafolio (10%).`);
              if (state.tab === 'portafolio') mostrarTab('portafolio');
            } }, a.id in state.port.pesos ? '✓ En el portafolio' : '+ Añadir al portafolio'))),
        h('div', { class: 'metrics metrics-8', html:
          met('Retorno esperado 10a', fmt.pct(a.retorno_esperado_10a), 'pos') + met(`Histórico (${esc(a.periodo_historico || 'n/d')})`, fmt.pct(a.retorno_historico)) +
          met('Volatilidad anual', fmt.pct(a.volatilidad, 0)) + met('Peor año', fmt.pct(a.peor_anio, 0), 'neg') + met('Mejor año', fmt.pctSigned(a.mejor_anio, 0), 'pos') +
          met('Máx. caída', a.max_drawdown != null ? fmt.pct(a.max_drawdown, 0) : 'n/d', 'neg') + met('Flujo / rendimiento', fmt.pct(a.rendimiento_flujo || 0)) + met('Liquidez · horizonte', `${esc(a.liquidez)} · ${a.horizonte_min}a`) }),
        h('div', { class: 'ficha-cols' },
          h('section', {}, h('h3', {}, `Qué serían $10.000 en ${n} años`, h('small', { class: 'muted' }, ' · retorno esperado, 1.500 escenarios')), grafProy, resumenProy),
          h('section', {}, h('h3', {}, 'Lectura del Oráculo'),
            h('ul', { class: 'insights' }, lecturaOraculo(a).map(([t, x]) => h('li', { class: 'ins-' + t, html: x }))))),
        m ? h('section', { class: 'ficha-mercado' }, h('h3', {}, 'Mercado en vivo', h('small', { class: 'muted' }, ` · ${m.fuente} · ${new Date(m.fecha).toLocaleString('es-ES')}`)),
          h('div', { class: 'vivo', html: `Precio <b>${m.precio.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${m.moneda}</b> · 1a ${pctCls(m.cagr_1a)} · 3a ${pctCls(m.cagr_3a)} · 5a ${pctCls(m.cagr_5a)} · 10a ${pctCls(m.cagr_10a)} · vol 5a ${fmt.pct(m.volatilidad_5a, 0)} · máx. caída 10a ${fmt.pct(m.max_drawdown_10a, 0)}` }),
          grafMercado) : (a.ticker ? h('div', { class: 'w-hint' }, 'Pulsa «Actualizar mercado» (o sigue este activo con ★) para ver su precio y rentabilidades reales.') : null),
        h('div', { class: 'ficha-cols3' },
          h('section', {}, h('h3', {}, 'Supuestos'), h('ul', {}, (a.supuestos || []).map((t) => h('li', {}, t)))),
          h('section', {}, h('h3', {}, 'Riesgos'), h('ul', {}, (a.riesgos || []).map((t) => h('li', {}, t)))),
          h('section', {}, h('h3', {}, 'Catalizadores'), h('ul', {}, (a.catalizadores || []).length ? a.catalizadores.map((t) => h('li', {}, t)) : h('li', { class: 'muted' }, 'n/d')))),
        h('section', { class: 'ficha-fuentes' }, h('h3', {}, 'Fuentes y sustento'),
          h('p', { class: 'muted' }, a.fuente || 'n/d'),
          h('div', { class: 'links' }, enlacesDe(a).map(enlace))),
      ];
      setTimeout(() => {
        const mc = Engine.monteCarlo({ inicial: 10000, anios: n, retorno: a.retorno_esperado_10a, volatilidad: a.volatilidad, aporte: 0, inflacion: 0, sims: 1500 });
        Charts.line(grafProy, { height: 220, yFmt: fmt.compact, xLabel: 'años', tipTitle: (x) => `Año ${x}`, series: [
          { name: 'Mediana', color: cv('--s0'), data: mc.bandas.map((b) => ({ x: b.anio, y: b.p50 })), band: mc.bandas.map((b) => ({ x: b.anio, lo: b.p25, hi: b.p75 })), bandLabel: '50% central (P25–P75)', bandOpacity: 0.2 },
          { name: 'Pesimista (P10)', color: cv('--neg'), dash: '3 3', width: 1.2, data: mc.bandas.map((b) => ({ x: b.anio, y: b.p10 })) },
          { name: 'Capital', color: cv('--ink-3'), dash: '5 4', width: 1.2, data: mc.bandas.map((b) => ({ x: b.anio, y: 10000 })) },
        ] });
        const fb = mc.bandas[n];
        resumenProy.innerHTML = `Mediana <b>${fmt.compact(fb.p50)}</b> · 50% central ${fmt.compact(fb.p25)}–${fmt.compact(fb.p75)} · pesimista (P10) ${fmt.compact(fb.p10)} · optimista (P90) ${fmt.compact(fb.p90)} · ` +
          `${fmt.pct(mc.probPerdida * 100, 0)} de probabilidad de terminar con menos de lo invertido (nominal, sin inflación).`;
        if (m && m.chispa && m.chispa.length > 1) {
          const k0 = m.chispa.length;
          Charts.line(grafMercado, { height: 170, yFmt: (v) => v.toLocaleString('es-ES', { maximumFractionDigits: v < 10 ? 2 : 0 }), xFmt: (x) => (x - k0 + 1) + 'm',
            tipTitle: (x) => `Hace ${k0 - 1 - x} meses`, series: [{ name: 'Cierre mensual', color: cv('--s1'), data: m.chispa.map((y, x) => ({ x, y })) }] });
        }
      }, 20);
      return cuerpo;
    }, { clase: 'modal-grande modal-ficha' });
  }

  /* ---------------- Activos ---------------- */
  const ORDEN = {
    esperado: ['Retorno esperado', (a) => -a.retorno_esperado_10a],
    historico: ['Retorno histórico', (a) => -a.retorno_historico],
    eficiencia: ['Retorno / riesgo', (a) => -(a.retorno_esperado_10a / Math.max(1, a.volatilidad))],
    volatilidad: ['Menor volatilidad', (a) => a.volatilidad],
    riesgo: ['Menor riesgo', (a) => a.riesgo],
    nombre: ['Nombre', (a) => a.nombre],
  };
  function sparkline(vals, w = 90, hgt = 28) {
    if (!vals || vals.length < 2) return '';
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const pts = vals.map((v, k) => `${((k / (vals.length - 1)) * w).toFixed(1)},${(hgt - ((v - mn) / (mx - mn || 1)) * hgt).toFixed(1)}`).join(' ');
    const col = vals[vals.length - 1] >= vals[0] ? cv('--pos') : cv('--neg');
    return `<svg width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6"/></svg>`;
  }
  const pctCls = (v) => (v == null ? '<b>n/d</b>' : `<b class="${v >= 0 ? 'pos' : 'neg'}">${fmt.pctSigned(v)}</b>`);

  const act = { refs: {} };
  act.build = (main) => {
    const r = act.refs;
    r.cats = h('div', { class: 'toolbar' });
    r.grid = h('div', { class: 'grid-activos' });
    r.bars = h('div');
    r.barsTitle = h('small');
    const busc = h('input', { type: 'search', placeholder: 'Buscar activo, ticker o tema…', value: state.busqueda, 'aria-label': 'Buscar activo', oninput: (e) => set({ busqueda: e.target.value }) });
    const orden = h('select', { 'aria-label': 'Ordenar', onchange: (e) => set({ orden: e.target.value }) },
      Object.entries(ORDEN).map(([k, [l]]) => h('option', { value: k, selected: k === state.orden }, 'Ordenar: ' + l)));
    main.append(h('div', { class: 'stack' },
      h('section', { class: 'panel' }, h('div', { class: 'toolbar' }, busc, orden,
        h('button', { class: 'btn btn-sm', onclick: () => { const vis = filtrados().map((a) => a.id); state.seguidos = [...new Set([...state.seguidos, ...vis])]; render(); actualizarBoton(); } }, '★ Seguir visibles'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { state.seguidos = []; render(); actualizarBoton(); } }, 'Limpiar seguidos'),
        h('button', { class: 'btn btn-sm', onclick: () => abrirCatalogo(() => { if (state.tab === 'activos') render(); }) }, '＋ Crear activo propio')), r.cats),
      h('section', { class: 'panel' }, h('h2', {}, 'Qué serían $10.000 invertidos hoy', r.barsTitle), r.bars),
      h('p', { class: 'w-hint' }, 'Haz clic en cualquier activo para abrir su ficha completa: análisis, riesgos, datos en vivo y fuentes.'),
      r.grid));
  };
  function filtrados() {
    const q = state.busqueda.trim().toLowerCase();
    return DATA.activos.filter((a) => (state.filtroCat === 'todas' || (state.filtroCat === 'seguidos' ? state.seguidos.includes(a.id) : a.categoria === state.filtroCat)) &&
      (!q || [a.nombre, a.ticker, a.subtipo, a.tendencia, categoria(a.categoria)].join(' ').toLowerCase().includes(q)))
      .sort((x, y) => { const f = ORDEN[state.orden][1]; const a = f(x), b = f(y); return typeof a === 'string' ? a.localeCompare(b) : a - b; });
  }
  act.update = () => {
    const r = act.refs;
    const chip = (id, label) => h('button', { class: 'cat-chip' + (state.filtroCat === id ? ' on' : ''), onclick: () => set({ filtroCat: id }) }, label);
    r.cats.replaceChildren(chip('todas', `Todas (${DATA.activos.length})`), chip('seguidos', `★ Seguidos (${state.seguidos.length})`),
      ...DATA.categorias.map((c) => chip(c.id, `${c.nombre} (${DATA.activos.filter((a) => a.categoria === c.id).length})`)));
    const lista = filtrados();
    const n = aniosVista();
    r.barsTitle.textContent = `a ${n} años · retorno esperado nominal${state.configurado ? ' · horizonte de tu plan' : ' · configura tu plan para usar tu horizonte'}`;
    Charts.bars(r.bars, {
      items: lista.slice(0, 18).map((a) => ({ label: esc(a.nombre), sub: `${fmt.pct(a.retorno_esperado_10a)} · vol ${fmt.pct(a.volatilidad, 0)}`, value: 10000 * Math.pow(1 + a.retorno_esperado_10a / 100, n), color: a.retorno_esperado_10a >= (state.inflacion || 2.5) ? cv('--accent') : cv('--neg') }))
        .sort((a, b) => b.value - a.value),
      fmt: fmt.compact,
    });
    r.grid.replaceChildren(...lista.map(tarjeta));
  };
  function tarjeta(a) {
    const m = MERCADO.resultados[a.id];
    const seguido = state.seguidos.includes(a.id);
    return h('article', { class: 'activo', tabindex: 0, role: 'button', 'aria-label': 'Abrir ficha de ' + a.nombre, onclick: () => abrirFicha(a), onkeydown: (e) => e.key === 'Enter' && abrirFicha(a) },
      h('div', { class: 'activo-head' },
        h('div', {}, h('h4', {}, a.nombre), h('div', { class: 'sub' }, [a.ticker, a.subtipo].filter(Boolean).join(' · '))),
        h('div', { style: 'display:flex;gap:6px;align-items:center' }, h('span', { class: 'badge' + (a.propio ? ' badge-propio' : '') }, a.propio ? 'propio' : categoria(a.categoria)),
          h('button', { class: 'star' + (seguido ? ' on' : ''), title: a.ticker ? 'Seguir (se actualiza con el botón de mercado)' : 'Sin ticker: no se actualiza automáticamente', 'aria-label': 'Seguir ' + a.nombre,
            onclick: (e) => { e.stopPropagation(); state.seguidos = seguido ? state.seguidos.filter((x) => x !== a.id) : [...state.seguidos, a.id]; render(); actualizarBoton(); } }, seguido ? '★' : '☆'))),
      h('div', { class: 'metrics', html:
        `<div class="metric"><span>Esperado 10a</span><b>${fmt.pct(a.retorno_esperado_10a)}</b></div>` +
        `<div class="metric"><span>Histórico</span><b>${fmt.pct(a.retorno_historico)}</b></div>` +
        `<div class="metric"><span>Volatilidad</span><b>${fmt.pct(a.volatilidad, 0)}</b></div>` +
        `<div class="metric"><span>Peor año</span><b class="neg">${fmt.pct(a.peor_anio, 0)}</b></div>` }),
      h('div', { class: 'sub muted', style: 'font-size:12px', html:
        `Riesgo ${riesgoHTML(a.riesgo)} · liquidez ${esc(a.liquidez)} · horizonte ≥ ${a.horizonte_min} años` + (a.tendencia ? ` · <i>${esc(a.tendencia)}</i>` : '') }),
      m ? h('div', { class: 'vivo', html: `${sparkline(m.chispa)}<div>Precio <b>${m.precio.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${m.moneda}</b> · 1a ${pctCls(m.cagr_1a)} · 5a ${pctCls(m.cagr_5a)} · 10a ${pctCls(m.cagr_10a)}<br><span class="muted">${m.fuente} · ${new Date(m.fecha).toLocaleString('es-ES')}</span></div>` }) : null,
      h('div', { class: 'ver-ficha' }, 'Ver ficha completa →'));
  }

  /* ---------------- Macro ---------------- */
  const mac = { refs: {}, pesado: true };
  mac.build = (main) => {
    const r = mac.refs;
    r.kpis = h('div', { class: 'kpis' });
    r.alerta = h('div');
    r.esc = h('div'); r.bars = h('div'); r.esperado = h('div', { class: 'w-hint' });
    const M = DATA.macro;
    const links = [];
    (M.fuentes || []).forEach((f) => FUENTES.forEach(([re, t, u]) => { if (re.test(f) && !links.some((x) => x[1] === u)) links.push([t, u]); }));
    [['FRED — Inflación (CPI)', 'https://fred.stlouisfed.org/series/CPIAUCSL'], ['FRED — Bono del Tesoro 10 años', 'https://fred.stlouisfed.org/series/DGS10'], ['FRED — Tasa de fondos federales', 'https://fred.stlouisfed.org/series/DFF'],
      ['Shiller CAPE — multpl', 'https://www.multpl.com/shiller-pe']].forEach((l) => { if (!links.some((x) => x[1] === l[1])) links.push(l); });
    main.append(h('div', { class: 'stack' },
      r.kpis,
      r.alerta,
      h('section', { class: 'panel' }, h('h2', {}, 'Aseveraciones económicas que pueden distorsionar la proyección', h('small', {}, `${M.fecha || ''}`)),
        h('div', { class: 'notas' }, (M.notas || []).map((n) => h('div', { class: 'nota' }, n))),
        h('div', { class: 'links', style: 'margin-top:10px' }, links.map(enlace))),
      h('div', { class: 'row2' },
        h('section', { class: 'panel' }, h('h2', {}, 'Escenarios macro'), r.esc),
        h('section', { class: 'panel' }, h('h2', {}, 'Tu portafolio en cada escenario', h('small', {}, `mediana a ${aniosVista()} años, dinero de hoy`)), r.bars, r.esperado)),
    ));
  };
  mac.update = () => {
    const r = mac.refs, M = DATA.macro, L = MERCADO.macro || {};
    const vivo = (k) => (L[k] != null ? h('span', { class: 'badge-live' }, 'EN VIVO') : null);
    const val = (k) => L[k] ?? M[k];
    const infl = val('inflacion_usa'), bono = val('bono_10a');
    const ey = M.cape_sp500 ? 100 / M.cape_sp500 : null;
    r.kpis.replaceChildren(
      W.kpi({ label: 'Inflación EE.UU. (a/a)', value: h('span', {}, fmt.pct(infl), vivo('inflacion_usa')), sub: L.inflacion_fecha ? 'CPI ' + L.inflacion_fecha : M.fecha, tone: infl > 3 ? 'neg' : 'neutral' }),
      W.kpi({ label: 'Tasa Fed', value: h('span', {}, fmt.pct(val('tasa_fed'), 2), vivo('tasa_fed')), sub: 'fondos federales' }),
      W.kpi({ label: 'Bono Tesoro 10 años', value: h('span', {}, fmt.pct(bono, 2), vivo('bono_10a')), sub: `real ≈ ${fmt.pct(bono - infl)}` }),
      W.kpi({ label: 'PIB real', value: fmt.pct(M.pib_real), sub: 'crecimiento anual' }),
      W.kpi({ label: 'CAPE S&P 500', value: M.cape_sp500 ? fmt.num(M.cape_sp500, 1) : 'n/d', sub: 'media histórica ≈ 17', tone: M.cape_sp500 > 30 ? 'neg' : 'neutral' }),
      W.kpi({ label: 'Prima de riesgo acciones', value: ey ? fmt.pctSigned(ey - bono) : 'n/d', sub: ey ? `1/CAPE ${fmt.pct(ey)} vs bono ${fmt.pct(bono)}` : '', tone: ey && ey - bono < 1 ? 'neg' : 'pos',
        title: 'Rendimiento de beneficios ajustado al ciclo menos el bono a 10 años. Bajo = acciones caras frente a bonos.' }),
    );
    r.esc.innerHTML = `<table class="anual esc"><thead><tr><th>Escenario</th><th>Prob.</th><th>Inflación</th><th>Ajuste al retorno (pp/año)</th></tr></thead><tbody>` +
      DATA.escenarios.map((e) => `<tr><td><b>${esc(e.nombre)}</b><br><small class="muted">${esc(e.descripcion)}</small></td><td>${e.probabilidad}%</td><td>${fmt.pct(e.inflacion ?? state.inflacion)}</td><td>` +
        Object.entries(e.ajuste || {}).filter(([, v]) => v).map(([c, v]) => `<span class="badge ${v > 0 ? 'pos' : 'neg'}">${esc(categoria(c))} ${fmt.pctSigned(v, 1).replace('%', '')}</span>`).join(' ') + '</td></tr>').join('') + '</tbody></table>';
    if (!state.configurado || !Object.keys(state.port.pesos).length) {
      r.bars.innerHTML = ''; r.alerta.replaceChildren();
      r.esperado.innerHTML = state.configurado ? 'Arma tu portafolio en la pestaña «Portafolio y diversificación» para compararlo en cada escenario.' : 'Configura tu plan y arma un portafolio para ver cómo le iría en cada escenario.';
      return;
    }
    let esperado = 0, retornoMax = -Infinity;
    const items = DATA.escenarios.map((e, k) => {
      const res = analizar(state.port.pesos, e.id, 1000);
      if (!res) return null;
      retornoMax = Math.max(retornoMax, res.st.retornoGeom);
      const f = res.mc.bandas[res.mc.bandas.length - 1];
      esperado += (f.p50 / f.d) * (e.probabilidad / 100);
      return { label: esc(e.nombre), sub: `${e.probabilidad}% · ret. ${fmt.pct(res.st.retornoGeom)}`, value: f.p50 / f.d, color: cv(SERIES[k % 5]) };
    }).filter(Boolean);
    Charts.bars(r.bars, { items, fmt: fmt.compact });
    pintarAvisos(r.alerta, retornoMax);
    r.esperado.innerHTML = items.length ? `Valor esperado ponderado por probabilidad: <b>${fmt.compact(esperado)}</b> (dinero de hoy). Portafolio actual, base de retorno «${NOMBRE_BASE[state.port.base]}».` : '';
  };

  const VISTAS = { proyeccion: proy, portafolio: port, activos: act, macro: mac };

  /* ---------------- Mercado (scraping bajo demanda) ---------------- */
  function actualizarBoton() {
    const n = state.seguidos.filter((id) => (activo(id) || {}).ticker).length;
    $('#btn-actualizar .lbl').textContent = n ? `Actualizar (${n} ★)` : 'Actualizar mercado';
    $('#btn-actualizar').title = n ? `Actualiza los ${n} activos que sigues (★)` : 'Actualiza todos los activos con ticker (marca ★ para limitar)';
  }
  function pintarEstado() {
    const pill = $('#estado-mercado');
    if (MERCADO.actualizado) {
      const n = Object.keys(MERCADO.resultados).length;
      pill.classList.add('live');
      pill.textContent = new Date(MERCADO.actualizado).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      pill.title = `Datos de mercado de ${n} activos · Fuentes: Yahoo Finance (precios), FRED (macro)`;
    } else {
      pill.classList.remove('live');
      pill.textContent = 'Sin datos de mercado';
    }
  }
  async function actualizarMercado() {
    const btn = $('#btn-actualizar');
    btn.disabled = true; btn.classList.add('cargando');
    const seguidosConTicker = state.seguidos.filter((id) => (activo(id) || {}).ticker);
    const ids = seguidosConTicker.filter((id) => !activo(id).propio);
    const propios = state.propios.filter((a) => a.ticker && (!seguidosConTicker.length || seguidosConTicker.includes(a.id))).map((a) => ({ id: a.id, ticker: a.ticker }));
    try {
      const r = await fetch('/api/actualizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: seguidosConTicker.length && !ids.length ? ['__ninguno__'] : ids, propios }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      // se combina en el navegador: en la nube el servidor no puede guardar caché en disco
      Object.assign(MERCADO.resultados, j.resultados);
      if (Object.keys(j.resultados).length) MERCADO.actualizado = j.actualizado;
      if (j.macro && (j.macro.inflacion_usa != null || j.macro.bono_10a != null)) MERCADO.macro = j.macro;
      guardarMercado();
      const ok = Object.keys(j.resultados).length, err = Object.keys(j.errores).length;
      if (!ok && j.solicitados) {
        toast(`Sin conexión con las fuentes de mercado: se mantienen los datos ${MERCADO.actualizado ? 'del ' + new Date(MERCADO.actualizado).toLocaleString('es-ES') : 'de la base investigada'}.`);
        return;
      }
      toast(`Actualizados ${ok} de ${j.solicitados} activos${err ? ` · ${err} sin respuesta (${Object.keys(j.errores).slice(0, 3).join(', ')})` : ''}${j.macro && j.macro.inflacion_usa != null ? ` · inflación ${fmt.pct(j.macro.inflacion_usa)}, bono 10a ${fmt.pct(j.macro.bono_10a, 2)}` : ''}`);
      pintarEstado();
      mostrarTab(state.tab);
    } catch (e) {
      toast('No se pudo actualizar: ' + e.message + '. Se mantienen los últimos datos guardados.');
    } finally {
      btn.disabled = false; btn.classList.remove('cargando');
    }
  }

  let toastT = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 5200);
  }

  /* ---------------- Arranque ---------------- */
  const LOGO_SVG = document.getElementById('logo-oraculo').innerHTML;
  async function cargar() {
    const intentar = async (urls) => { for (const u of urls) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch { /* siguiente */ } } return null; };
    const d = await intentar(['/api/activos', 'data/activos.json']);
    if (d && d.activos) DATA = { ...DATA, ...d };
    DATA.activos = [...DATA.activos, ...state.propios];
    // caché del servidor (local) + caché del navegador (nube): gana el dato más reciente por activo
    const servidor = (await intentar(['/api/mercado'])) || {};
    let local = {};
    try { local = JSON.parse(localStorage.getItem(CLAVE_MERCADO) || '{}') || {}; } catch { /* sin almacenamiento */ }
    const res = { ...(servidor.resultados || {}) };
    for (const [id, v] of Object.entries(local.resultados || {})) if (!res[id] || new Date(v.fecha) > new Date(res[id].fecha)) res[id] = v;
    const masReciente = (a, b) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b);
    MERCADO = {
      resultados: res,
      actualizado: masReciente(servidor.actualizado, local.actualizado),
      macro: !servidor.macro ? local.macro : !local.macro ? servidor.macro : new Date(local.macro.fecha) > new Date(servidor.macro.fecha) ? local.macro : servidor.macro,
    };
    $('#aviso').textContent = DATA.aviso || '';
    state.seguidos = state.seguidos.filter((id) => activo(id));
    for (const id of Object.keys(state.port.pesos)) if (!activo(id)) delete state.port.pesos[id];
  }

  document.documentElement.dataset.theme = state.tema;
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => mostrarTab(b.dataset.tab)));
  $('#btn-actualizar').addEventListener('click', actualizarMercado);
  $('#btn-plan').addEventListener('click', abrirAsistente);
  $('#btn-tema').addEventListener('click', () => { state.tema = state.tema === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = state.tema; mostrarTab(state.tab); });
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 120); });
  cargar().then(() => {
    pintarEstado(); actualizarBoton(); mostrarTab(state.tab);
    if (!state.configurado) setTimeout(abrirAsistente, 350);
  });
})();
