#!/usr/bin/env node
/* ============================================================
   LifeOS — lokalny serwer statyczny + proxy do football-data.co.uk

   Po co proxy: football-data.co.uk nie wysyła nagłówka
   Access-Control-Allow-Origin, więc przeglądarka blokuje pobranie
   plików CSV bezpośrednio ze strony. Ten serwer pobiera je po
   stronie Node i oddaje z poprawnym CORS + cache na dysku.

   Uruchomienie:  node server.js         (domyślnie http://localhost:8787)
                  PORT=9000 node server.js
   Wymaga Node 18+ (globalny fetch). Zero zależności.
   ============================================================ */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const CACHE_DIR = path.join(ROOT, '.stats-cache');
const UPSTREAM = 'https://www.football-data.co.uk';

/* Terminarz odświeżamy często, archiwalne sezony rzadko. */
const TTL_FIXTURES = 30 * 60 * 1000;
const TTL_SEASON = 6 * 60 * 60 * 1000;

/* Wpuszczamy wyłącznie ścieżki, o które faktycznie prosi aplikacja. */
const ALLOWED_PATH = /^(fixtures\.csv|mmz4281\/\d{4}\/[A-Z]{1,3}\d\.csv|new\/[A-Z]{3}\.csv)$/;

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

const cacheFile = target => path.join(CACHE_DIR, `${target.replace(/[^a-z0-9]/gi, '_')}.csv`);

async function readCache(target, ttl) {
  try {
    const file = cacheFile(target);
    const stat = await fsp.stat(file);
    if (Date.now() - stat.mtimeMs > ttl) return null;
    return await fsp.readFile(file, 'utf8');
  } catch { return null; }
}

async function writeCache(target, body) {
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(cacheFile(target), body, 'utf8');
  } catch { /* cache jest opcjonalny — brak zapisu nie psuje odpowiedzi */ }
}

function sendCors(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

async function handleCsv(req, res, url) {
  const target = url.searchParams.get('path') || '';
  if (!ALLOWED_PATH.test(target)) {
    return sendCors(res, 400, `Niedozwolona ścieżka: ${target}`);
  }
  const ttl = target === 'fixtures.csv' ? TTL_FIXTURES : TTL_SEASON;
  const fresh = url.searchParams.get('fresh') === '1';

  if (!fresh) {
    const hit = await readCache(target, ttl);
    if (hit !== null) {
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Fd-Cache': 'hit'
      });
      return res.end(hit);
    }
  }

  try {
    const upstream = await fetch(`${UPSTREAM}/${target}`, {
      headers: { 'User-Agent': 'LifeOS-stats/1.0', Accept: 'text/csv,*/*' },
      signal: AbortSignal.timeout(30000)
    });
    if (!upstream.ok) {
      /* Sezon jeszcze nieopublikowany zwraca 404 — to normalny stan, nie awaria. */
      const stale = await readCache(target, Infinity);
      if (stale !== null) {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'X-Fd-Cache': 'stale'
        });
        return res.end(stale);
      }
      return sendCors(res, upstream.status, `football-data.co.uk: HTTP ${upstream.status} dla ${target}`);
    }
    const body = await upstream.text();
    await writeCache(target, body);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'X-Fd-Cache': 'miss'
    });
    res.end(body);
  } catch (error) {
    const stale = await readCache(target, Infinity);
    if (stale !== null) {
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Fd-Cache': 'stale'
      });
      return res.end(stale);
    }
    sendCors(res, 502, `Nie udało się pobrać ${target}: ${error.message}`);
  }
}

async function handleStatic(req, res, url) {
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return sendCors(res, 403, 'Poza katalogiem aplikacji');
  try {
    const stat = await fsp.stat(file);
    if (stat.isDirectory()) return handleStatic(req, res, new URL(`${url.pathname.replace(/\/$/, '')}/index.html`, 'http://x'));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch {
    sendCors(res, 404, `Nie znaleziono: ${rel}`);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') return sendCors(res, 204, '');
  if (url.pathname === '/api/fd/health') {
    return sendCors(res, 200, JSON.stringify({ ok: true, upstream: UPSTREAM }), 'application/json; charset=utf-8');
  }
  if (url.pathname === '/api/fd/csv') return handleCsv(req, res, url);
  if (url.pathname === '/api/fd/purge') {
    await fsp.rm(CACHE_DIR, { recursive: true, force: true }).catch(() => {});
    return sendCors(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
  }
  return handleStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`LifeOS działa na http://localhost:${PORT}`);
  console.log(`Statystyki:      http://localhost:${PORT}/stats.html`);
  console.log(`Proxy CSV:       /api/fd/csv?path=mmz4281/2526/E0.csv`);
  console.log(`Cache na dysku:  ${CACHE_DIR}`);
});
