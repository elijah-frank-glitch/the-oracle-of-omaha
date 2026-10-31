/* Servidor local de The Oracle of Omaha. Node >= 18, sin dependencias.
 * node server.js  → http://127.0.0.1:5173
 * La API vive en lib/api.js (la misma que usan las funciones de Vercel en api/).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const api = require('./lib/api');

const PORT = Number(process.env.PORT) || 5173;
const RAIZ = path.join(__dirname, 'app');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const RUTAS = { '/api/activos': api.activos, '/api/mercado': api.mercado, '/api/actualizar': api.actualizar };

function estatico(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('URL inválida'); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(RAIZ, rel));
  if (!file.startsWith(RAIZ + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const ruta = RUTAS[url.pathname];
    return ruta ? ruta(req, res) : api.enviar(res, 404, { error: 'ruta no encontrada' });
  }
  estatico(req, res, url);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.log(`El servidor ya está activo en http://127.0.0.1:${PORT}`); process.exit(0); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => console.log(`The Oracle of Omaha → http://127.0.0.1:${PORT}`));
