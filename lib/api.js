/* Lógica de la API compartida por el servidor local (server.js) y las funciones serverless de Vercel (api/*.js).
 * GET  /api/activos     → base de activos investigada
 * GET  /api/mercado     → caché de datos de mercado (en Vercel el disco es de solo lectura: el navegador guarda su propia caché)
 * POST /api/actualizar  → {ids:[...], propios:[{id, ticker}]} scraping bajo demanda
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { actualizar } = require('../scraper');

const RAIZ = path.join(__dirname, '..');
const ACTIVOS = path.join(RAIZ, 'app', 'data', 'activos.json');
const CACHE = path.join(RAIZ, 'data', 'mercado-cache.json');
const MAX_CUERPO = 1e5;
const ESPERA_POR_IP_MS = 20000; // protección básica en despliegues públicos

const leerJSON = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };

function enviar(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/** Cuerpo JSON: Vercel ya lo entrega parseado en req.body; en Node puro se lee del stream. */
async function leerCuerpo(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > MAX_CUERPO) throw Object.assign(new Error('cuerpo demasiado grande'), { status: 413 }); }
  return body;
}

function activos(req, res) {
  if (req.method !== 'GET') return enviar(res, 405, { error: 'método no permitido' });
  return enviar(res, 200, leerJSON(ACTIVOS, { activos: [], error: 'activos.json no encontrado' }));
}

function mercado(req, res) {
  if (req.method !== 'GET') return enviar(res, 405, { error: 'método no permitido' });
  return enviar(res, 200, leerJSON(CACHE, { resultados: {} }));
}

let enCurso = null; // evita scraping simultáneo en la misma instancia
const ultimaPorIp = new Map();

async function actualizarMercado(req, res) {
  if (req.method !== 'POST') return enviar(res, 405, { error: 'método no permitido' });
  let j;
  try { j = JSON.parse((await leerCuerpo(req)) || '{}'); } catch (e) { return enviar(res, e.status || 400, { error: e.status ? e.message : 'JSON inválido' }); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return enviar(res, 400, { error: 'se espera un objeto {ids:[...]}' });
  const ids = j.ids || [];
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) return enviar(res, 400, { error: 'ids debe ser una lista de textos' });
  // activos propios del inversor: {id: 'propio_*', ticker} con símbolo de Yahoo válido
  if (j.propios !== undefined && !Array.isArray(j.propios)) return enviar(res, 400, { error: 'propios debe ser una lista' });
  const propios = (j.propios || []).slice(0, 50);
  if (propios.some((p) => !p || typeof p.id !== 'string' || !/^propio_[a-z0-9]{1,20}$/.test(p.id) || typeof p.ticker !== 'string' || !/^[A-Z0-9.^=\-]{1,15}$/.test(p.ticker)))
    return enviar(res, 400, { error: 'propios debe ser una lista de {id: "propio_…", ticker}' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
  const ahora = Date.now();
  if (process.env.VERCEL && ahora - (ultimaPorIp.get(ip) || 0) < ESPERA_POR_IP_MS)
    return enviar(res, 429, { error: 'Espera unos segundos antes de volver a actualizar.' });
  if (enCurso) return enviar(res, 409, { error: 'Ya hay una actualización en curso' });
  ultimaPorIp.set(ip, ahora);

  const base = leerJSON(ACTIVOS, { activos: [] });
  const items = base.activos.filter((a) => a.ticker && (!ids.length || ids.includes(a.id))).map((a) => ({ id: a.id, ticker: a.ticker }))
    .concat(propios.map((p) => ({ id: p.id, ticker: p.ticker })));
  try {
    enCurso = actualizar(items);
    const r = await enCurso;
    guardarCache(r);
    return enviar(res, 200, { ...r, solicitados: items.length });
  } catch (e) {
    return enviar(res, 502, { error: e.message });
  } finally {
    enCurso = null;
  }
}

/** Persiste la caché en disco cuando se puede (local). En Vercel el disco es de solo lectura y se omite. */
function guardarCache(r) {
  try {
    const cache = leerJSON(CACHE, { resultados: {} });
    Object.assign(cache.resultados, r.resultados);
    if (Object.keys(r.resultados).length) cache.actualizado = r.actualizado; // la fecha solo avanza si hubo datos nuevos
    if (r.macro && (r.macro.inflacion_usa != null || r.macro.bono_10a != null)) cache.macro = r.macro;
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  } catch { /* sistema de archivos de solo lectura */ }
}

const conErrores = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => enviar(res, 500, { error: e.message }));

module.exports = {
  activos: conErrores(activos),
  mercado: conErrores(mercado),
  actualizar: conErrores(actualizarMercado),
  enviar,
};
