'use strict';
// /api/* public, read-only JSON routes.
const storage = require('../storage');
const { CONFIG, KICK_CHANNEL } = require('../config');
const { HttpError, sendJson } = require('../lib/http');
const { state, mask, prizeFor } = require('../services/stake');
const { fetchKickChannelStatus } = require('../services/kick');
const { botrix, VIEWER_TRACKING_UNSUPPORTED, viewerRewardFor } = require('../services/viewers');
const { publicRewards, publicRacePrizes, publicViewerRewards } = require('../services/rewards');
const { publicFeed } = require('../services/content');
const { publicWheel } = require('../services/wheel');
const { handleAdmin } = require('./admin');
const { handleAccount, authPublic } = require('./account');
const accounts = require('../services/accounts');

const isRealLink = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);

async function handleApi(req, res, url) {
  if (url.pathname === '/api/admin' || url.pathname.startsWith('/api/admin/')) return await handleAdmin(req, res, url);
  await handleAccount(req, res, url);
  if (res.headersSent) return;
  const route = `${req.method} ${url.pathname}`;
  if (['POST /api/login', 'POST /api/signup', 'POST /api/logout', 'POST /api/profile', 'POST /api/connect-provider'].includes(route)) {
    return sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
  }

  if (route === 'GET /api/config') {
    const links = {};
    for (const [k, v] of Object.entries(CONFIG.links)) links[k] = isRealLink(v) ? v : null;
    return sendJson(res, 200, {
      name: CONFIG.name,
      code: CONFIG.code,
      referralUrl: CONFIG.referralUrl,
      kickChannel: KICK_CHANNEL,
      kickChannelUrl: `https://kick.com/${KICK_CHANNEL}`,
      kickViewerTracking: {
        supported: botrix.configured,
        provider: botrix.configured ? 'botrix' : null,
        reason: botrix.configured ? null : VIEWER_TRACKING_UNSUPPORTED,
        docs: 'https://botrix.live/docs/',
      },
      viewerRewards: publicViewerRewards(),
      links,
      prizes: publicRacePrizes(),
      race: { title: CONFIG.race.title, startsAt: CONFIG.race.startsAt, endsAt: CONFIG.race.endsAt, top: CONFIG.race.top },
      auth: authPublic(),
    });
  }

  if (route === 'GET /api/rewards') {
    return sendJson(res, 200, publicRewards());
  }

  if (route === 'GET /api/feed') {
    return sendJson(res, 200, publicFeed());
  }

  if (route === 'GET /api/wheel') {
    return sendJson(res, 200, publicWheel());
  }
  if (url.pathname === '/api/wheel' && req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
  }

  const viewerRoute = /^GET \/api\/viewers\/(current|previous)$/.exec(route);
  if (viewerRoute || route === 'GET /api/kick/leaderboard' || route === 'GET /api/kick/top-viewers' || route === 'GET /api/botrix/leaderboard') {
    const period = viewerRoute ? viewerRoute[1] : String(url.searchParams.get('period') || 'current').trim().toLowerCase();
    if (!['current', 'previous'].includes(period)) {
      return sendJson(res, 400, { error: 'Invalid period. Use "current" or "previous".' });
    }
    if (!botrix.configured) {
      return sendJson(res, 501, {
        ok: false,
        period,
        available: false,
        code: 'VIEWER_LEADERBOARD_NOT_CONFIGURED',
        message: VIEWER_TRACKING_UNSUPPORTED,
        entries: [],
      });
    }
    return sendJson(res, 200, { available: true, prizePool: publicRewards().viewerPrizePool, ...botrix.publicPeriod(botrix.ensureStore(storage.db), period, viewerRewardFor) });
  }

  if (route === 'GET /api/kick-live') {
    try {
      const payload = await fetchKickChannelStatus(KICK_CHANNEL);
      return sendJson(res, 200, payload);
    } catch (err) {
      return sendJson(res, 200, {
        status: 'unavailable',
        channel: KICK_CHANNEL,
        title: null,
        viewers: null,
        thumbnail: null,
        url: `https://kick.com/${KICK_CHANNEL}`,
        message: 'Status unavailable',
        error: err.message,
        updatedAt: Date.now(),
      });
    }
  }

  if (route === 'GET /api/leaderboard') {
    const me = accounts.accountFromReq(req);
    const youName = me && me.codeStatus === 'verified' && me.stakeUser ? String(me.stakeUser).toLowerCase() : '';
    const mapEntries = (lb) => lb.entries.map((e) => {
      const row = {
        rank: e.rank,
        name: mask(e.user),
        weighted: Math.round(e.weighted * 100) / 100,
        prize: prizeFor(e.rank),
      };
      if (youName && String(e.user || '').toLowerCase() === youName) row.you = true;
      return row;
    });
    const lb = state.leaderboard;
    const prev = state.previousLeaderboard;
    const message = lb.error ? 'Leaderboard temporarily unavailable' : undefined;
    const previousMessage = prev.error ? 'Previous month leaderboard temporarily unavailable' : undefined;
    return sendJson(res, 200, {
      status: lb.updatedAt ? 'ok' : lb.error ? 'error' : 'pending',
      stale: !!(lb.updatedAt && lb.error),
      updatedAt: lb.updatedAt,
      message,
      race: { title: CONFIG.race.title, startsAt: CONFIG.race.startsAt, endsAt: CONFIG.race.endsAt },
      entries: mapEntries(lb),
      previous: {
        status: prev.updatedAt ? 'ok' : prev.error ? 'error' : 'pending',
        stale: !!(prev.updatedAt && prev.error),
        updatedAt: prev.updatedAt,
        message: previousMessage,
        entries: mapEntries(prev),
      },
    });
  }

  throw new HttpError(404, 'Not found.');
}

module.exports = { handleApi };
