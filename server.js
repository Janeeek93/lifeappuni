#!/usr/bin/env node
/* ============================================================
   LifeOS — lokalny serwer statyczny

   Uruchomienie:  node server.js         (domyślnie http://localhost:8787)
                  PORT=9000 node server.js
   Wymaga Node 18+. Zero zależności.
   ============================================================ */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8'
};

function sendPlain(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

async function handleStatic(req, res, url) {
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return sendPlain(res, 403, 'Poza katalogiem aplikacji');
  try {
    const stat = await fsp.stat(file);
    if (stat.isDirectory()) return handleStatic(req, res, new URL(`${url.pathname.replace(/\/$/, '')}/index.html`, 'http://x'));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch {
    sendPlain(res, 404, `Nie znaleziono: ${rel}`);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  return handleStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`LifeOS działa na http://localhost:${PORT}`);
});
