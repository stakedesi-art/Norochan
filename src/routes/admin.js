'use strict';
const { AUTH_TEST } = require('../config');
const { HttpError, sendJson, readJson, checkOrigin } = require('../lib/http');
const staff = require('../lib/staff');
const content = require('../services/content');
const wheel = require('../services/wheel');
const accounts = require('../services/accounts');
const rewards = require('../services/rewards');

function fail(err) {
  if (err.status) throw new HttpError(err.status, err.message);
  throw err;
}

async function handleAdmin(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') checkOrigin(req, { required: true });

  if (route === 'POST /api/admin/login') {
    if (!staff.configured()) throw new HttpError(503, 'Staff login is not configured. Set ADMIN_PASSWORD (8+ characters) and restart.');
    const ip = staff.clientIp(req);
    const key = `studio:${ip}`;
    if (staff.isBlocked(key, 8)) throw new HttpError(429, 'Too many login tries. Wait a few minutes.', { 'Retry-After': String(staff.retryAfter(key)) });
    const body = await readJson(req);
    if (!staff.passwordOk(body.password)) {
      staff.addHit(key);
      throw new HttpError(401, 'Wrong password.');
    }
    staff.clearHits(key);
    const sess = staff.startSession(req);
    return sendJson(res, 200, { ok: true, csrf: sess.csrf }, { 'Set-Cookie': sess.cookie });
  }

  if (route === 'POST /api/admin/logout') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': staff.endSession(req) });
  }

  if (route === 'GET /api/admin/session') {
    const on = staff.isStaff(req);
    return sendJson(res, 200, {
      staff: on,
      configured: staff.configured(),
      categories: content.CATEGORIES,
      csrf: on ? staff.csrfOf(req) : null,
    });
  }

  staff.requireStaff(req);
  if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') staff.requireCsrf(req);

  if (route === 'GET /api/admin/accounts' || route === 'GET /api/admin/users') {
    return sendJson(res, 200, { items: accounts.listForStaff() });
  }
  const unbind = /^POST \/api\/admin\/accounts\/([^/]+)\/unbind$/.exec(route);
  if (unbind) {
    try {
      if (/application\/json/i.test(req.headers['content-type'] || '')) await readJson(req);
      return sendJson(res, 200, { item: accounts.publicAccount(accounts.unbindStake(decodeURIComponent(unbind[1]))) });
    } catch (err) { fail(err); }
  }
  const codeReview = /^POST \/api\/admin\/accounts\/([^/]+)\/code$/.exec(route);
  if (codeReview) {
    try {
      const body = await readJson(req);
      const verify = require('../services/verify');
      return sendJson(res, 200, { item: verify.resolveCode(decodeURIComponent(codeReview[1]), body.verdict || body.status) });
    } catch (err) { fail(err); }
  }

  if (route === 'GET /api/admin/wheel') return sendJson(res, 200, wheel.staffWheel());
  if (AUTH_TEST && route === 'POST /api/admin/wheel/test-close') {
    try {
      const body = await readJson(req);
      const row = wheel.maybeFinalize(Number(body && body.now) || Date.now());
      return sendJson(res, 200, {
        lastDraw: row
          ? { period: row.period, prizePool: row.prizePool, winners: row.winners, drawnAt: row.drawnAt }
          : null,
      });
    } catch (err) { fail(err); }
  }
  if (route === 'PATCH /api/admin/wheel') {
    try {
      const body = await readJson(req);
      wheel.setPrizePool(body.prizePool);
      return sendJson(res, 200, wheel.staffWheel());
    } catch (err) { fail(err); }
  }

  if (route === 'GET /api/admin/prizes') return sendJson(res, 200, rewards.staffRewards());
  if (route === 'PATCH /api/admin/prizes') {
    try {
      return sendJson(res, 200, rewards.setPrizePools(await readJson(req)));
    } catch (err) { fail(err); }
  }

  if (route === 'GET /api/admin/announcements') return sendJson(res, 200, { items: content.list('announcement') });
  if (route === 'GET /api/admin/benefits') return sendJson(res, 200, { items: content.list('benefit'), categories: content.CATEGORIES });

  if (route === 'POST /api/admin/announcements') {
    try { return sendJson(res, 201, { item: content.createAnnouncement(await readJson(req)) }); }
    catch (err) { fail(err); }
  }
  if (route === 'POST /api/admin/benefits') {
    try { return sendJson(res, 201, { item: content.createBenefit(await readJson(req)) }); }
    catch (err) { fail(err); }
  }

  const patchAnn = /^PATCH \/api\/admin\/announcements\/([^/]+)$/.exec(route);
  if (patchAnn) {
    try { return sendJson(res, 200, { item: content.updateRow('announcement', decodeURIComponent(patchAnn[1]), await readJson(req)) }); }
    catch (err) { fail(err); }
  }
  const patchBen = /^PATCH \/api\/admin\/benefits\/([^/]+)$/.exec(route);
  if (patchBen) {
    try { return sendJson(res, 200, { item: content.updateRow('benefit', decodeURIComponent(patchBen[1]), await readJson(req)) }); }
    catch (err) { fail(err); }
  }
  const delAnn = /^DELETE \/api\/admin\/announcements\/([^/]+)$/.exec(route);
  if (delAnn) {
    try { content.removeRow('announcement', decodeURIComponent(delAnn[1])); return sendJson(res, 200, { ok: true }); }
    catch (err) { fail(err); }
  }
  const delBen = /^DELETE \/api\/admin\/benefits\/([^/]+)$/.exec(route);
  if (delBen) {
    try { content.removeRow('benefit', decodeURIComponent(delBen[1])); return sendJson(res, 200, { ok: true }); }
    catch (err) { fail(err); }
  }

  throw new HttpError(404, 'Not found.');
}

module.exports = { handleAdmin };
