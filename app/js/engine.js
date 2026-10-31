/* Motor financiero — funciones puras, sin DOM. Navegador: window.Engine · Node: module.exports */
(function (root) {
  'use strict';

  const pct = (x) => (Number(x) || 0) / 100;

  /** Tasa efectiva anual a partir de una nominal con m capitalizaciones por año. */
  function tasaEfectiva(nominalPct, m) {
    const r = pct(nominalPct);
    if (!m || m >= 365 * 24) return Math.exp(r) - 1; // continua
    return Math.pow(1 + r / m, m) - 1;
  }

  /** Tasa mensual equivalente, neta de comisión anual sobre activos. */
  function tasaMensualNeta(nominalPct, m, comisionPct) {
    const efectivaNeta = (1 + tasaEfectiva(nominalPct, m)) * (1 - pct(comisionPct)) - 1;
    return Math.pow(1 + efectivaNeta, 1 / 12) - 1;
  }

  /**
   * Aporte por periodo vigente en el año y (1-based).
   * Base = último tramo con desde <= y (o el aporte base). Crece g% anual desde el inicio del tramo.
   */
  function aporteDelAnio(o, y) {
    let base = Number(o.aporte) || 0;
    let inicio = 1;
    (o.tramos || [])
      .filter((t) => Number(t.desde) <= y)
      .sort((a, b) => a.desde - b.desde)
      .forEach((t) => { base = Number(t.monto) || 0; inicio = Number(t.desde); });
    return base * Math.pow(1 + pct(o.crecimientoAporte), y - inicio);
  }

  const valor = (v, def) => (v === undefined || v === null || v === '' || !isFinite(Number(v)) ? def : Number(v));

  /**
   * Parámetros efectivos del año y: valores base salvo que o.porAnio[y] los sobrescriba.
   * porAnio: {[año]: {tasa, capitalizacion, aporte, extra, comision, inflacion}} — cualquier campo es opcional.
   * ajusteTasa se suma a la tasa de todos los años (banda ±); ignorarComision fuerza comisión 0.
   */
  function parametrosDelAnio(o, y) {
    const ov = (o.porAnio && o.porAnio[y]) || {};
    return {
      tasa: valor(ov.tasa, Number(o.tasa) || 0) + (Number(o.ajusteTasa) || 0),
      capitalizacion: valor(ov.capitalizacion, Number(o.capitalizacion) || 12),
      comision: o.ignorarComision ? 0 : valor(ov.comision, Number(o.comision) || 0),
      inflacion: valor(ov.inflacion, Number(o.inflacion) || 0),
      aporte: valor(ov.aporte, aporteDelAnio(o, y)),
      extra: valor(ov.extra, 0),
    };
  }

  /**
   * Proyección determinista mes a mes.
   * o: {inicial, anios, tasa, capitalizacion (1|4|12|365), aporte, frecuenciaAporte (12|1),
   *     crecimientoAporte, tramos:[{desde,monto}], inflacion, comision, porAnio}
   * El aporte extra (único) de un año entra al inicio de ese año; negativo = retiro puntual.
   * Devuelve filas anuales {anio, saldo, aportado, interes, real, aporteAnual, params}.
   */
  function proyectar(o) {
    const anios = Math.max(0, Math.round(Number(o.anios) || 0));
    const freq = Number(o.frecuenciaAporte) === 1 ? 1 : 12;
    let saldo = Math.max(0, Number(o.inicial) || 0);
    let aportado = saldo;
    let deflactor = 1;
    const filas = [{ anio: 0, saldo, aportado, interes: 0, real: saldo, deflactor: 1, aporteAnual: 0 }];

    for (let y = 1; y <= anios; y++) {
      const p = parametrosDelAnio(o, y);
      const i = tasaMensualNeta(p.tasa, p.capitalizacion, p.comision);
      const aporte = p.aporte;
      deflactor *= 1 + pct(p.inflacion);
      let aporteAnual = 0;
      if (p.extra) {
        const efectivo = p.extra < 0 ? -Math.min(-p.extra, saldo) : p.extra;
        saldo += efectivo; aportado += efectivo; aporteAnual += efectivo;
      }
      for (let mes = 1; mes <= 12; mes++) {
        saldo *= 1 + i;
        const toca = freq === 12 || mes === 12;
        if (toca) {
          const efectivo = aporte < 0 ? -Math.min(-aporte, saldo) : aporte; // retiros sin saldo negativo
          saldo += efectivo;
          aportado += efectivo;
          aporteAnual += efectivo;
        }
      }
      filas.push({
        anio: y,
        saldo,
        aportado,
        interes: saldo - aportado,
        real: saldo / deflactor,
        deflactor,
        aporteAnual,
        params: p,
      });
    }
    return filas;
  }

  /** Proyección para varios capitales iniciales + banda por rango de variación de tasa. */
  function escenarios(o) {
    const capitales = (o.capitales && o.capitales.length ? o.capitales : [o.inicial || 0]);
    const v = Number(o.varianza) || 0;
    const t = Number(o.tasa) || 0;
    return capitales.map((cap) => {
      const base = { ...o, tasa: t, inicial: Number(cap) || 0 };
      return {
        capital: Number(cap) || 0,
        filas: proyectar(base),
        bajo: v ? proyectar({ ...base, ajusteTasa: -v }) : null,
        alto: v ? proyectar({ ...base, ajusteTasa: v }) : null,
        sinComision: proyectar({ ...base, ignorarComision: true }),
      };
    });
  }

  /** Matriz de sensibilidad: valor final para cada (tasa, años). */
  function sensibilidad(o, tasas, anios) {
    return tasas.map((t) => anios.map((n) => {
      const f = proyectar({ ...o, tasa: t, anios: n });
      return f[f.length - 1].saldo;
    }));
  }

  /* ---------------- Portafolio ---------------- */

  const CORR_MISMA_CATEGORIA = 0.85;
  const BONO_REBALANCEO_MAX = 0.005; // 0,5 pp anual como máximo

  /**
   * items: [{peso (0-100), retorno (geom %), volatilidad (%), categoria}]
   * corr: {categorias:[ids], matriz:[[...]]}
   * Devuelve retorno geométrico esperado (con bono de diversificación), aritmético y volatilidad.
   */
  function portafolio(items, corr) {
    const activos = items.map((a) => ({ ...a, peso: Number(a.peso) || 0 })).filter((a) => a.peso > 0);
    const total = activos.reduce((s, a) => s + a.peso, 0) || 1;
    const w = activos.map((a) => a.peso / total);
    const sig = activos.map((a) => pct(a.volatilidad));
    const arit = activos.map((a, k) => pct(a.retorno) + sig[k] * sig[k] / 2);
    const idx = (c) => (corr && corr.categorias ? corr.categorias.indexOf(c) : -1);

    let varianza = 0;
    for (let a = 0; a < activos.length; a++) {
      for (let b = 0; b < activos.length; b++) {
        let rho;
        if (a === b) rho = 1;
        else {
          const ia = idx(activos[a].categoria), ib = idx(activos[b].categoria);
          if (ia < 0 || ib < 0) rho = 0.3;
          else rho = ia === ib ? CORR_MISMA_CATEGORIA : corr.matriz[ia][ib];
        }
        varianza += w[a] * w[b] * rho * sig[a] * sig[b];
      }
    }
    const aritP = w.reduce((s, wk, k) => s + wk * arit[k], 0);
    const vol = Math.sqrt(Math.max(0, varianza));
    const volPonderada = w.reduce((s, wk, k) => s + wk * sig[k], 0);
    // El "bono de rebalanceo" teórico (aritP − σ²/2 − Σw·g) explota con activos muy volátiles
    // (p. ej. cripto al 70%) y supone rebalanceo perfecto sin costos: lo limitamos por prudencia.
    const geomPonderado = w.reduce((s, wk, k) => s + wk * pct(activos[k].retorno), 0);
    const bonoTeorico = aritP - varianza / 2 - geomPonderado;
    const bono = Math.min(Math.max(bonoTeorico, 0), BONO_REBALANCEO_MAX);
    return {
      retornoGeom: (geomPonderado + bono) * 100,
      bonoRebalanceo: bono * 100,
      bonoTeorico: bonoTeorico * 100,
      retornoArit: aritP * 100,
      volatilidad: vol * 100,
      volatilidadSinDiversificar: volPonderada * 100,
      pesos: w,
    };
  }

  /* ---------------- Monte Carlo ---------------- */

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function percentil(ordenado, p) {
    if (!ordenado.length) return 0;
    const k = (ordenado.length - 1) * p;
    const lo = Math.floor(k), hi = Math.ceil(k);
    return ordenado[lo] + (ordenado[hi] - ordenado[lo]) * (k - lo);
  }

  /**
   * Monte Carlo anual lognormal.
   * o: {inicial, anios, retorno (geom %), volatilidad (%), aporte, frecuenciaAporte, crecimientoAporte, tramos,
   *     inflacion, comision, porAnio, sims, semilla}
   * De porAnio se aplican aporte, extra, comisión e inflación por año (el retorno lo fija el portafolio).
   * probPerdida: fracción de trayectorias cuyo valor REAL final queda por debajo de lo aportado en dinero de hoy.
   * probAgotar: fracción de trayectorias que agotan el capital (relevante con retiros).
   */
  function monteCarlo(o) {
    const anios = Math.max(1, Math.round(Number(o.anios) || 1));
    const inicial = Math.max(0, Number(o.inicial) || 0);
    const sims = o.sims || 2000;
    const rnd = mulberry32(o.semilla || 42);
    const g = pct(o.retorno), s = pct(o.volatilidad);
    const a = g + s * s / 2;
    const sLn = Math.sqrt(Math.log(1 + (s * s) / ((1 + a) * (1 + a))));
    const freq = Number(o.frecuenciaAporte) === 1 ? 1 : 12;
    const aportes = [], extras = [], mLn = [], d = [1];
    for (let y = 1; y <= anios; y++) {
      const p = parametrosDelAnio(o, y);
      aportes.push(p.aporte * freq);
      extras.push(p.extra);
      mLn.push(Math.log(1 + g) + Math.log(1 - pct(p.comision)));
      d.push(d[y - 1] * (1 + pct(p.inflacion)));
    }

    const porAnio = Array.from({ length: anios + 1 }, () => new Float64Array(sims));
    let perdidas = 0, agotadas = 0;
    const positivos = (k) => Math.max(0, aportes[k]) + Math.max(0, extras[k]);
    const aportadoTotal = inicial + aportes.reduce((s, _, k) => s + positivos(k), 0);
    // aportes en dinero de hoy: cada aporte se deflacta a la fecha en que se hizo
    const aportadoReal = inicial + aportes.reduce((s, x, k) =>
      s + Math.max(0, x) / (freq === 12 ? Math.sqrt(d[k] * d[k + 1]) : d[k + 1]) + Math.max(0, extras[k]) / d[k], 0);
    for (let k = 0; k < sims; k++) {
      let saldo = inicial;
      let agotado = false;
      porAnio[0][k] = saldo;
      for (let y = 1; y <= anios; y++) {
        const u1 = rnd() || 1e-12, u2 = rnd();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const factor = Math.exp(mLn[y - 1] + sLn * z);
        saldo += extras[y - 1]; // aporte/retiro único al inicio del año, como proyectar()
        if (saldo < 0) { saldo = 0; agotado = true; }
        // aportes mensuales ≈ a mitad de año (medio año de crecimiento); anuales a fin de año, como proyectar()
        saldo = saldo * factor + aportes[y - 1] * (freq === 12 ? Math.sqrt(factor) : 1);
        if (saldo <= 0) { if (saldo < 0 || aportes[y - 1] < 0) agotado = true; saldo = 0; }
        porAnio[y][k] = saldo;
      }
      if (agotado) agotadas++;
      if (saldo / d[anios] < aportadoReal) perdidas++;
    }
    const bandas = porAnio.map((arr, y) => {
      const ord = Array.from(arr).sort((x, z) => x - z);
      return { anio: y, p10: percentil(ord, 0.1), p25: percentil(ord, 0.25), p50: percentil(ord, 0.5), p75: percentil(ord, 0.75), p90: percentil(ord, 0.9), d: d[y] };
    });
    return { bandas, probPerdida: perdidas / sims, probAgotar: agotadas / sims, aportadoTotal, aportadoReal };
  }

  /** Años para duplicar (regla exacta y regla del 72). */
  function duplicar(tasaPct) {
    const r = pct(tasaPct);
    if (r <= 0) return { exacto: Infinity, regla72: Infinity };
    return { exacto: Math.log(2) / Math.log(1 + r), regla72: 72 / tasaPct };
  }

  const Engine = { tasaEfectiva, tasaMensualNeta, aporteDelAnio, parametrosDelAnio, proyectar, escenarios, sensibilidad, portafolio, monteCarlo, duplicar, percentil };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
