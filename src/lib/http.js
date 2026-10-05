'use strict';
// JSON responses and the security headers shared by every response.

class HttpError extends Error {
  constructor(status, message, headers) { super(message); this.status = status; this.headers = headers; }
}
const { HSTS } = require('../config');
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://kick.com https://*.kick.com https://images.kick.com; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
function withSec(headers = {}) {
  const out = { ...SEC_HEADERS, ...headers };
  if (HSTS && !out['Strict-Transport-Security']) out['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return out;
}
function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...withSec(headers) });
  res.end(JSON.stringify(body));
}
function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...withSec(headers) });
  res.end();
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'Send JSON.'));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 16 * 1024) { reject(new HttpError(413, 'Request too large.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new HttpError(400, 'Invalid JSON.')); }
    });
    req.on('error', reject);
  });
}
function originHost(value) {
  try { return new URL(value).host; } catch { return ''; }
}
function checkOrigin(req, opts = {}) {
  const origin = req.headers.origin;
  if (origin) {
    const host = originHost(origin);
    if (!host || host !== req.headers.host) throw new HttpError(403, 'Bad origin.');
    return;
  }
  if (opts.required) {
    const referer = req.headers.referer;
    const host = referer ? originHost(referer) : '';
    if (!host || host !== req.headers.host) throw new HttpError(403, 'Bad origin.');
  }
}

module.exports = { HttpError, SEC_HEADERS, sendJson, redirect, readJson, checkOrigin };
