'use strict';
const crypto = require('crypto');
const {
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
  KICK_CLIENT_ID, KICK_CLIENT_SECRET, KICK_REDIRECT_URI, BASE_URL,
} = require('../config');
const { HttpError } = require('../lib/http');
const accounts = require('./accounts');

const pending = new Map();

function googleOn() { return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET); }
function kickOn() { return !!(KICK_CLIENT_ID && KICK_CLIENT_SECRET); }

function putState(extra) {
  const state = crypto.randomBytes(24).toString('base64url');
  pending.set(state, { ...extra, expires: Date.now() + 10 * 60 * 1000 });
  return state;
}

function takeState(state) {
  const row = pending.get(state);
  pending.delete(state);
  if (!row || row.expires <= Date.now()) throw new HttpError(400, 'Sign-in expired. Try again.');
  return row;
}

function googleAuthUrl() {
  if (!googleOn()) throw new HttpError(503, 'Google sign-in is not configured.');
  const state = putState({ provider: 'google' });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('state', state);
  return url.toString();
}

async function googleFinish(code, state) {
  takeState(state);
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) throw new HttpError(400, 'Google sign-in failed.');
  const meRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + token.access_token },
    signal: AbortSignal.timeout(15000),
  });
  const me = await meRes.json().catch(() => ({}));
  if (!me.sub) throw new HttpError(400, 'Google did not return a user.');
  let row = accounts.byGoogle(me.sub);
  if (!row && me.email) row = accounts.byEmail(me.email);
  if (!row) row = accounts.create({ email: me.email || null, googleId: me.sub, emailVerified: true });
  else {
    row.googleId = me.sub;
    if (me.email && !row.email) row.email = String(me.email).toLowerCase();
    row.emailVerified = true;
    accounts.saveRow();
  }
  return row;
}

function kickCallbackUri(req) {
  const host = String((req && req.headers && req.headers.host) || '');
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return 'http://' + host + '/auth/kick/callback';
  return KICK_REDIRECT_URI || BASE_URL + '/auth/kick/callback';
}

function kickAuthUrl(extra = {}, req) {
  if (!kickOn()) throw new HttpError(503, 'Kick sign-in is not configured.');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = extra.redirectUri || kickCallbackUri(req);
  const state = putState({ provider: 'kick', verifier, accountId: extra.accountId || null, redirectUri });
  const url = new URL('https://id.kick.com/oauth/authorize');
  url.searchParams.set('client_id', KICK_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user:read');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function kickFinish(code, state) {
  const st = takeState(state);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: KICK_CLIENT_ID,
    client_secret: KICK_CLIENT_SECRET,
    redirect_uri: st.redirectUri || KICK_REDIRECT_URI || BASE_URL + '/auth/kick/callback',
    code,
    code_verifier: st.verifier,
  });
  const tokenRes = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) throw new HttpError(400, 'Kick sign-in failed.');
  const meRes = await fetch('https://api.kick.com/public/v1/users', {
    headers: { Authorization: 'Bearer ' + token.access_token, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const me = await meRes.json().catch(() => ({}));
  const user = me.data?.[0] || me.user || me;
  const kickId = String(user.id || user.user_id || '');
  const kickName = user.name || user.username || user.slug || null;
  if (!kickId) throw new HttpError(400, 'Kick did not return a user.');
  if (st.accountId) {
    const row = accounts.byId(st.accountId);
    if (!row) throw new HttpError(400, 'Sign in and try Kick again.');
    accounts.linkKick(row, { kickId, kickName });
    return { row, connected: true };
  }
  let row = accounts.byKick(kickId);
  if (!row) row = accounts.create({ kickId, kickName, emailVerified: true });
  else {
    row.kickId = kickId;
    if (kickName) row.kickName = kickName;
    row.emailVerified = true;
    accounts.saveRow();
  }
  return { row, connected: false };
}

module.exports = { googleOn, kickOn, googleAuthUrl, googleFinish, kickAuthUrl, kickFinish };
