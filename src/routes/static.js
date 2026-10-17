'use strict';
// Serves src/public/. Unknown extensionless paths serve the SPA shell so clean URLs can refresh.
const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR, HSTS } = require('../config');
const { SEC_HEADERS, sendJson } = require('../lib/http');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2',
};
const SPA_PATHS = new Set([
  '/', '/leaderboard', '/wheel', '/code-benefits', '/benefits',
  '/announcement', '/announcements', '/community', '/support', '/account',
]);
const INDEX = path.join(PUBLIC_DIR, 'index.html');
const STUDIO = path.join(PUBLIC_DIR, 'studio.html');

function wantsStudio(rel) {
  const p = rel.length > 1 && rel.endsWith('/') ? rel.slice(0, -1) : rel;
  if (p === '/studio' || p === '/studio.html') return true;
  if (p.startsWith('/studio/')) {
    const rest = p.slice('/studio/'.length);
    return rest.length > 0 && !rest.includes('.');
  }
  return false;
}

function cacheControl(rel, ext) {
  if (/(?:^|\/)studio\.(html|js)$/.test(rel) || rel === '/css/studio.css') return 'no-store';
  if (ext === '.html' || rel === '/index.html') return 'no-cache';
  if (ext === '.css' || ext === '.js') return 'no-cache';
  if (['.woff2', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico'].includes(ext)) return 'public, max-age=86400';
  return 'no-cache';
}

function wantsSpa(rel) {
  const p = rel.length > 1 && rel.endsWith('/') ? rel.slice(0, -1) : rel;
  if (wantsStudio(p) || wantsStudio(rel)) return false;
  if (SPA_PATHS.has(p) || SPA_PATHS.has(rel)) return true;
  if (p.includes('.')) return false;
  return true;
}

function sendFile(req, res, file, rel) {
  fs.stat(file, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      if (wantsStudio(rel)) return sendFile(req, res, STUDIO, '/studio.html');
      if (wantsSpa(rel)) return sendFile(req, res, INDEX, '/index.html');
      return sendJson(res, 404, { error: 'Not found.' });
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl(rel, ext),
      ETag: '"' + stat.size.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"',
      ...SEC_HEADERS,
    };
    if (HSTS) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    if (/(?:^|\/)studio\.(html|js)$/.test(rel) || rel === '/css/studio.css') {
      headers['X-Robots-Tag'] = 'noindex, nofollow';
    }
    if (req.headers['if-none-match'] === headers.ETag) {
      res.writeHead(304, headers);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'Not found.' });
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { error: 'Bad URL.' }); }
  if (rel === '/') rel = '/index.html';
  else if (wantsStudio(rel)) rel = '/studio.html';
  else if (wantsSpa(rel)) rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Forbidden.' });
  return sendFile(req, res, file, rel);
}

module.exports = { serveStatic };
