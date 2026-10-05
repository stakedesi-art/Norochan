'use strict';
// Staff session for /studio.html. One env password. No public user accounts (SRS Phase 1).
const crypto = require('crypto');
const { HSTS } = require('../config');
const { HttpError } = require('./http');

const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const SESSION_MS = 12 * 60 * 60 * 1000;
const IDLE_MS = 2 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const sessions = new Map();
const buckets = new Map();

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const configured = () => ADMIN_PASSWORD.length >= 8;

function passwordOk(given) {
  if (!configured()) return false;
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(req, value, maxAgeSec) {
  const secure = HSTS || process.env.COOKIE_SECURE === '1' || !!req.socket.encrypted;
  return `studio=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAgeSec}` + (secure ? '; Secure' : '');
}

function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}

function normalizeIp(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s === '::1' || s === '0:0:0:0:0:0:0:1') return '127.0.0.1';
  return s;
}

function sameClient(req, row) {
  return row.ua === uaFinger(req) && normalizeIp(row.ip) === normalizeIp(clientIp(req));
}

function uaFinger(req) {
  return sha256(String(req.headers['user-agent'] || '')).slice(0, 16);
}

function addHit(key) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + WINDOW_MS }; buckets.set(key, b); }
  b.count++;
}

function isBlocked(key, max) {
  const b = buckets.get(key);
  return !!b && b.resetAt > Date.now() && b.count >= max;
}

const retryAfter = (key) => Math.max(1, Math.ceil(((buckets.get(key)?.resetAt || 0) - Date.now()) / 1000));

function sweep() {
  const now = Date.now();
  for (const [id, row] of sessions) {
    if (row.expires <= now || row.idle <= now) sessions.delete(id);
  }
}

function startSession(req) {
  sweep();
  sessions.clear();
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(sha256(token), {
    expires: now + SESSION_MS,
    idle: now + IDLE_MS,
    ip: clientIp(req),
    ua: uaFinger(req),
    csrf,
  });
  return { cookie: cookieHeader(req, token, SESSION_MS / 1000), csrf };
}

function sessionFrom(req) {
  const token = parseCookies(req).studio;
  if (!token) return null;
  const id = sha256(token);
  const row = sessions.get(id);
  if (!row) return null;
  const now = Date.now();
  if (row.expires <= now || row.idle <= now) { sessions.delete(id); return null; }
  if (!sameClient(req, row)) return null;
  row.idle = now + IDLE_MS;
  return row;
}

function isStaff(req) {
  return !!sessionFrom(req);
}

function requireStaff(req) {
  if (!sessionFrom(req)) throw new HttpError(401, 'Staff login required.');
}

function csrfOf(req) {
  const row = sessionFrom(req);
  return (row && row.csrf) || '';
}

function requireCsrf(req) {
  const row = sessionFrom(req);
  if (!row) throw new HttpError(401, 'Staff login required.');
  const got = String(req.headers['x-studio-csrf'] || '');
  const a = Buffer.from(sha256(got));
  const b = Buffer.from(sha256(row.csrf));
  if (!got || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'Bad request token.');
}

function endSession(req) {
  const token = parseCookies(req).studio;
  if (token) sessions.delete(sha256(token));
  return cookieHeader(req, '', 0);
}

function clearHits(key) {
  buckets.delete(key);
}

module.exports = {
  configured, passwordOk, startSession, isStaff, requireStaff, endSession,
  clientIp, addHit, isBlocked, retryAfter, csrfOf, requireCsrf, clearHits,
};
