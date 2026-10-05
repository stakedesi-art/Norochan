'use strict';
const { AUTH_TEST, OWNER_CODES } = require('../config');
const { HttpError, sendJson, redirect, readJson, checkOrigin } = require('../lib/http');
const staff = require('../lib/staff');
const accounts = require('../services/accounts');
const oauth = require('../services/oauth');
const verify = require('../services/verify');
const mailer = require('../services/mailer');

function authPublic() {
  return { email: true, password: true, google: oauth.googleOn(), kick: oauth.kickOn() };
}

function mePayload(req) {
  const row = accounts.accountFromReq(req);
  return {
    account: accounts.publicAccount(row),
    auth: authPublic(),
    ownerCodes: OWNER_CODES,
  };
}

function gateAuth(req, action) {
  const ip = staff.clientIp(req);
  const key = action + ':' + ip;
  const max = action === 'verify' ? 20 : 8;
  if (staff.isBlocked(key, max)) throw new HttpError(429, 'Too many tries. Wait a few minutes.', { 'Retry-After': String(staff.retryAfter(key)) });
  staff.addHit(key);
}

async function sendSignupMail(email, verifyPath) {
  try {
    await mailer.sendVerifyEmail(email, verifyPath);
  } catch (err) {
    console.error('[mail] ' + err.message);
    if (!AUTH_TEST) throw new HttpError(502, 'Could not send the confirmation email. Try again in a minute.');
  }
}

async function handleAccount(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/me') return sendJson(res, 200, mePayload(req));

  if (route === 'POST /api/auth/signup') {
    checkOrigin(req);
    gateAuth(req, 'signup');
    const body = await readJson(req);
    const out = accounts.signup(body.email, body.password);
    await sendSignupMail(out.row.email, out.verifyPath);
    const payload = { ok: true, sent: true };
    if (AUTH_TEST) payload.verifyPath = out.verifyPath;
    return sendJson(res, 200, payload);
  }

  if (route === 'POST /api/auth/login') {
    checkOrigin(req);
    gateAuth(req, 'login');
    const body = await readJson(req);
    const row = accounts.login(body.email, body.password);
    return sendJson(res, 200, { account: accounts.publicAccount(row) }, { 'Set-Cookie': accounts.startSession(req, row) });
  }

  if (route === 'POST /api/auth/email') {
    checkOrigin(req);
    gateAuth(req, 'email');
    const body = await readJson(req);
    if (!accounts.emailOk(body.email)) throw new HttpError(400, 'Enter a valid email.');
    const existing = accounts.byEmail(body.email);
    const payload = { ok: true, sent: true };
    if (existing && !existing.emailVerified) {
      const token = accounts.createVerifyLink(existing.email);
      const verifyPath = '/auth/email?token=' + encodeURIComponent(token);
      await sendSignupMail(existing.email, verifyPath);
      if (AUTH_TEST) payload.verifyPath = verifyPath;
    }
    return sendJson(res, 200, payload);
  }

  if (route === 'POST /api/auth/logout') {
    checkOrigin(req);
    if (/application\/json/i.test(req.headers['content-type'] || '')) await readJson(req);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': accounts.endSession(req) });
  }

  if (route === 'GET /auth/email') {
    const token = String(url.searchParams.get('token') || '');
    try {
      const email = accounts.consumeVerifyLink(token);
      const row = accounts.markVerified(email);
      return redirect(res, '/#/account', { 'Set-Cookie': accounts.startSession(req, row) });
    } catch {
      return redirect(res, '/#/account?auth=expired');
    }
  }

  if (route === 'GET /auth/google') {
    return redirect(res, oauth.googleAuthUrl());
  }
  if (route === 'GET /auth/google/callback') {
    try {
      const row = await oauth.googleFinish(url.searchParams.get('code'), url.searchParams.get('state'));
      return redirect(res, '/#/account', { 'Set-Cookie': accounts.startSession(req, row) });
    } catch {
      return redirect(res, '/#/account?auth=google-error');
    }
  }
  if (route === 'GET /auth/kick/connect') {
    const row = accounts.accountFromReq(req);
    if (!row) return redirect(res, '/#/account');
    return redirect(res, oauth.kickAuthUrl({ accountId: row.id }, req));
  }
  if (route === 'GET /auth/kick') {
    return redirect(res, oauth.kickAuthUrl({}, req));
  }
  if (route === 'GET /auth/kick/callback') {
    try {
      const out = await oauth.kickFinish(url.searchParams.get('code'), url.searchParams.get('state'));
      const row = out.row || out;
      const dest = out.connected ? '/#/account?auth=kick-ok' : '/#/account';
      return redirect(res, dest, { 'Set-Cookie': accounts.startSession(req, row) });
    } catch (err) {
      const flag = err && err.status === 409 ? 'kick-taken' : 'kick-error';
      return redirect(res, '/#/account?auth=' + flag);
    }
  }
  if (route === 'POST /api/auth/kick/test-link' && AUTH_TEST) {
    checkOrigin(req);
    const row = accounts.requireAccount(req);
    const body = await readJson(req);
    return sendJson(res, 200, { account: accounts.publicAccount(accounts.linkKick(row, body)) });
  }

  if (route === 'POST /api/verify/claim') {
    checkOrigin(req);
    gateAuth(req, 'verify');
    const row = accounts.requireAccount(req);
    const body = await readJson(req);
    const account = verify.claimStake(row, body.stakeUser || body.username, body.code);
    return sendJson(res, 200, { account });
  }

  return null;
}

module.exports = { handleAccount, authPublic };
