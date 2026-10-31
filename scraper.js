/* Scraper de mercado bajo demanda (agente scraper-mercado). Node >= 18, sin dependencias.
 * Uso CLI: node scraper.js SPY BTC-USD GC=F
 */
'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CalculadoraFinancieraPersonal/1.0 (uso personal)';
const TIMEOUT_MS = 10000;
const CONCURRENCIA = 4;

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'tiempo de espera agotado' : e.message);
  } finally {
    clearTimeout(t);
  }
}

/** Yahoo Finance: cierres mensuales ajustados de 10 años (host principal y espejo). */
const yahoo = (ticker) => yahooHost('query1', ticker);
const yahooEspejo = (ticker) => yahooHost('query2', ticker);
async function yahooHost(host, ticker) {
  const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1mo&includeAdjustedClose=true`;
  const j = JSON.parse(await get(url));
  const res = j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error((j.chart && j.chart.error && j.chart.error.description) || 'sin datos');
  const ts = res.timestamp || [];
  const adj = (res.indicators.adjclose && res.indicators.adjclose[0].adjclose) || res.indicators.quote[0].close;
  const serie = ts.map((t, k) => ({ t: t * 1000, c: adj[k] })).filter((p) => p.c != null && isFinite(p.c));
  if (serie.length < 2) throw new Error('serie insuficiente');
  return { serie, precio: res.meta.regularMarketPrice ?? serie[serie.length - 1].c, moneda: res.meta.currency || 'USD', fuente: 'Yahoo Finance' };
}

/** Stooq (respaldo): CSV mensual. */
function simboloStooq(t) {
  if (/^[A-Z]{3,4}-USD$/.test(t)) return t.replace('-', '').toLowerCase();
  if (t.endsWith('=F')) return t.replace('=F', '.f').toLowerCase();
  if (t.startsWith('^')) return null;
  return t.toLowerCase() + '.us';
}
async function stooq(ticker) {
  const sym = simboloStooq(ticker);
  if (!sym) throw new Error('sin símbolo stooq');
  const csv = await get(`https://stooq.com/q/d/l/?s=${sym}&i=m`);
  if (/^\s*</.test(csv)) throw new Error('stooq devolvió HTML (requiere navegador)');
  const filas = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
  const serie = filas.map((f) => ({ t: Date.parse(f[0]), c: parseFloat(f[4]) })).filter((p) => isFinite(p.c) && isFinite(p.t)).slice(-121);
  if (serie.length < 2) throw new Error('stooq sin datos');
  return { serie, precio: serie[serie.length - 1].c, moneda: 'USD', fuente: 'Stooq' };
}

/** Métricas a partir de cierres mensuales. */
function metricas(serie) {
  const ult = serie[serie.length - 1];
  const cagr = (anios) => {
    const objetivo = ult.t - anios * 365.25 * 864e5;
    const ini = serie.find((p) => p.t >= objetivo - 20 * 864e5);
    if (!ini || ini === ult) return null;
    const a = (ult.t - ini.t) / (365.25 * 864e5);
    if (a < anios * 0.9) return null;
    return (Math.pow(ult.c / ini.c, 1 / a) - 1) * 100;
  };
  const ult5 = serie.slice(-61);
  const rets = ult5.slice(1).map((p, k) => Math.log(p.c / ult5[k].c));
  const media = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const varianza = rets.reduce((a, r) => a + (r - media) ** 2, 0) / Math.max(1, rets.length - 1);
  let pico = -Infinity, dd = 0;
  serie.forEach((p) => { pico = Math.max(pico, p.c); dd = Math.min(dd, p.c / pico - 1); });
  const anioInicio = new Date(serie[0].t).getFullYear();
  return {
    cagr_1a: cagr(1), cagr_3a: cagr(3), cagr_5a: cagr(5), cagr_10a: cagr(10),
    volatilidad_5a: Math.sqrt(varianza * 12) * 100,
    max_drawdown_10a: dd * 100,
    desde: anioInicio,
    chispa: serie.slice(-60).map((p) => +p.c.toPrecision(5)), // mini serie para sparkline
  };
}

async function activo(ticker) {
  const intentos = [];
  for (const fuente of [yahoo, yahooEspejo, stooq]) {
    try {
      const d = await fuente(ticker);
      return { ticker, precio: d.precio, moneda: d.moneda, fuente: d.fuente, ...metricas(d.serie), fecha: new Date().toISOString() };
    } catch (e) {
      intentos.push(`${fuente.name}: ${e.message}`);
    }
  }
  throw new Error(intentos.join(' · '));
}

/** Macro desde FRED (CSV público). */
async function fred(id) {
  const csv = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  return csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(',')).map(([d, v]) => ({ d, v: parseFloat(v) })).filter((p) => isFinite(p.v));
}
async function macro() {
  const out = { fuente: 'FRED (St. Louis Fed)', fecha: new Date().toISOString() };
  const errores = [];
  try {
    const cpi = await fred('CPIAUCSL');
    const u = cpi[cpi.length - 1], a = cpi[cpi.length - 13];
    out.inflacion_usa = +((u.v / a.v - 1) * 100).toFixed(2);
    out.inflacion_fecha = u.d;
  } catch (e) { errores.push('CPI: ' + e.message); }
  try {
    const b = await fred('DGS10');
    out.bono_10a = b[b.length - 1].v;
    out.bono_fecha = b[b.length - 1].d;
  } catch (e) { errores.push('DGS10: ' + e.message); }
  try {
    const f = await fred('DFF');
    out.tasa_fed = f[f.length - 1].v;
  } catch (e) { errores.push('DFF: ' + e.message); }
  if (errores.length) out.errores = errores;
  return out;
}

/** items: [{id, ticker}] → {actualizado, resultados, errores, macro} */
async function actualizar(items, { conMacro = true } = {}) {
  const resultados = {}, errores = {};
  const cola = items.filter((i) => i.ticker);
  async function trabajador() {
    while (cola.length) {
      const it = cola.shift();
      try { resultados[it.id] = await activo(it.ticker); } catch (e) { errores[it.id] = e.message; }
    }
  }
  const tareas = Array.from({ length: CONCURRENCIA }, trabajador);
  const m = conMacro ? macro().catch((e) => ({ errores: [e.message] })) : Promise.resolve(null);
  await Promise.all(tareas);
  return { actualizado: new Date().toISOString(), resultados, errores, macro: await m };
}

module.exports = { actualizar, activo, macro, metricas };

if (require.main === module) {
  const tickers = process.argv.slice(2);
  if (!tickers.length) { console.log('Uso: node scraper.js SPY BTC-USD GC=F'); process.exit(0); }
  actualizar(tickers.map((t) => ({ id: t, ticker: t }))).then((r) => {
    for (const [id, d] of Object.entries(r.resultados)) {
      const f = (v) => (v == null ? '  n/d ' : v.toFixed(1).padStart(6) + '%');
      console.log(`${id.padEnd(9)} ${String(d.precio.toFixed(2)).padStart(10)} ${d.moneda}  1a${f(d.cagr_1a)}  5a${f(d.cagr_5a)}  10a${f(d.cagr_10a)}  vol${f(d.volatilidad_5a)}  [${d.fuente}]`);
    }
    for (const [id, e] of Object.entries(r.errores)) console.log(`${id.padEnd(9)} ERROR ${e}`);
    console.log('Macro:', JSON.stringify(r.macro));
  });
}
