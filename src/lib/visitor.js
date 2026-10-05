'use strict';
// Visitor session cookie (`sid=`). Separate from the staff `studio=` cookie.
const crypto = require('crypto');
const { HSTS } = require('../config');

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

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
  return `sid=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}` + (secure ? '; Secure' : '');
}

function mintCookie(req, token) {
  return cookieHeader(req, token, SESSION_MS / 1000);
}

function clearCookie(req) {
  return cookieHeader(req, '', 0);
}

function tokenFrom(req) {
  return parseCookies(req).sid || '';
}

module.exports = { sha256, mintCookie, clearCookie, tokenFrom, SESSION_MS, parseCookies };
