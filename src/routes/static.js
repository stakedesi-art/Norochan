'use strict';
// Serves src/public/. Unknown extensionless paths serve the SPA shell so clean URLs can refresh.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PUBLIC_DIR, HSTS } = require('../config');
const { SEC_HEADERS, sendJson } = require('../lib/http');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2',
};
const SPA_PATHS = new Set([
  '/', '/leaderboard', '/viewers', '/wheel', '/bonus-hunts', '/winners', '/code-benefits', '/benefits',
  '/community', '/support', '/account',
]);
const INDEX = path.join(PUBLIC_DIR, 'index.html');
const STUDIO = path.join(PUBLIC_DIR, 'studio.html');
const SITE_CSS_PARTS = [
  'css/tokens.css', 'css/components.css', 'style.css', 'css/theme.css', 'css/decor.css', 'css/fx.css', 'css/identity.css',
];
const LONG_CACHE_EXT = new Set(['.css', '.js', '.woff2', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico']);

function wantsStudio(rel) {
  const p = rel.length > 1 && rel.endsWith('/') ? rel.slice(0, -1) : rel;
  if (p === '/studio' || p === '/studio.html') return true;
  if (p.startsWith('/studio/')) {
    const rest = p.slice('/studio/'.length);
    return rest.length > 0 && !rest.includes('.');
  }
  return false;
}

function cacheControl(rel, ext, versioned) {
  if (/(?:^|\/)studio\.(html|js)$/.test(rel) || rel === '/css/studio.css') return 'no-store';
  if (ext === '.html' || rel === '/index.html') return 'no-cache';
  if (versioned && LONG_CACHE_EXT.has(ext)) return 'public, max-age=31536000, immutable';
  if (ext === '.css' || ext === '.js') return 'no-cache';
  if (LONG_CACHE_EXT.has(ext)) return 'public, max-age=2592000';
  return 'no-cache';
}

function assetStamp() {
  const files = [...SITE_CSS_PARTS, 'age.js', 'ui.js', 'app.js', 'studio.js', 'css/studio.css', 'img/norochan-logo.png', 'fonts/fredoka-latin.woff2'];
  const parts = [];
  for (const rel of files) {
    try { parts.push(rel + ':' + fs.statSync(path.join(PUBLIC_DIR, rel)).mtimeMs); }
    catch { parts.push(rel + ':0'); }
  }
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}

function versionHtml(html, stamp) {
  return html.replace(/(href|src)="(\/(?:css|fonts|img)\/[^"]+|\/(?:age|ui|app|studio)\.js)"/g, (match, attr, url) => {
    if (url.includes('?')) return match;
    return attr + '="' + url + '?v=' + stamp + '"';
  });
}

function readSiteCss() {
  return SITE_CSS_PARTS.map((rel) => fs.readFileSync(path.join(PUBLIC_DIR, rel))).join('\n');
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
    const versioned = typeof req.url === 'string' && /(?:\?|&)v=/.test(req.url);
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl(rel, ext, versioned),
      ETag: '"' + stat.size.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"',
      ...SEC_HEADERS,
    };
    if (HSTS) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    if (/(?:^|\/)studio\.(html|js)$/.test(rel) || rel === '/css/studio.css') {
      headers['X-Robots-Tag'] = 'noindex, nofollow';
    }
    const htmlShell = ext === '.html' && (rel === '/index.html' || rel === '/studio.html');
    if (!htmlShell && req.headers['if-none-match'] === headers.ETag) {
      res.writeHead(304, headers);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'Not found.' });
      let body = data;
      if (htmlShell) {
        const stamp = assetStamp();
        body = Buffer.from(versionHtml(data.toString('utf8'), stamp));
        headers.ETag = '"' + stamp + '-' + stat.size.toString(16) + '"';
        if (req.headers['if-none-match'] === headers.ETag) {
          res.writeHead(304, headers);
          return res.end();
        }
      }
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  });
}

function sendSiteCss(req, res) {
  let body;
  try { body = readSiteCss(); }
  catch { return sendJson(res, 404, { error: 'Not found.' }); }
  const versioned = /(?:\?|&)v=/.test(req.url || '');
  const headers = {
    'Content-Type': TYPES['.css'],
    'Cache-Control': cacheControl('/css/site.css', '.css', versioned),
    ETag: '"' + assetStamp() + '"',
    ...SEC_HEADERS,
  };
  if (HSTS) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  if (req.headers['if-none-match'] === headers.ETag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { error: 'Bad URL.' }); }
  if (rel === '/css/site.css') return sendSiteCss(req, res);
  if (rel === '/') rel = '/index.html';
  else if (wantsStudio(rel)) rel = '/studio.html';
  else if (wantsSpa(rel)) rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Forbidden.' });
  return sendFile(req, res, file, rel);
}

module.exports = { serveStatic };
