const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const api = require('../lib/api.js');

/** Simula req/res como los entrega Node puro (stream) o Vercel (req.body ya parseado). */
function llamar(fn, { method = 'GET', body, vercel = false } = {}) {
  const req = vercel
    ? Object.assign(Readable.from([]), { method, headers: {}, body })
    : Object.assign(Readable.from(body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]), { method, headers: {} });
  return new Promise((resolve) => {
    const res = {
      writeHead(code) { this.code = code; },
      end(txt) { resolve({ code: this.code, json: JSON.parse(txt) }); },
    };
    fn(req, res);
  });
}

test('GET /api/activos devuelve la base investigada', async () => {
  const r = await llamar(api.activos);
  assert.equal(r.code, 200);
  assert.ok(r.json.activos.length >= 30);
});

test('métodos no permitidos → 405', async () => {
  assert.equal((await llamar(api.activos, { method: 'POST' })).code, 405);
  assert.equal((await llamar(api.actualizar, { method: 'GET' })).code, 405);
});

test('POST /api/actualizar valida el cuerpo (Node y Vercel)', async () => {
  for (const vercel of [false, true]) {
    assert.equal((await llamar(api.actualizar, { method: 'POST', body: vercel ? null : 'no-json', vercel })).code, 400);
    assert.equal((await llamar(api.actualizar, { method: 'POST', body: { ids: 5 }, vercel })).code, 400);
    assert.equal((await llamar(api.actualizar, { method: 'POST', body: { propios: 'x' }, vercel })).code, 400);
    assert.equal((await llamar(api.actualizar, { method: 'POST', body: { propios: [{ id: '../x', ticker: 'AAPL' }] }, vercel })).code, 400);
  }
});
