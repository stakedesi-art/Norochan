'use strict';
// End-to-end smoke test. Starts the mock Stake and BotRix APIs and the site on spare ports, then exercises everything.
//   node test/smoke.js
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const SITE = 'http://127.0.0.1:3100';
const MOCK = 'http://127.0.0.1:4100';
const MOCK_BOTRIX = 'http://127.0.0.1:4200';
const TOKEN = 'test-token-DO-NOT-LEAK-123';
const BOTRIX_KEY = 'botrix-key-DO-NOT-LEAK-456';
const ADMIN_PASS = 'studio-pass-DO-NOT-LEAK';
const stamp = Date.now();
const dataFile = path.join(os.tmpdir(), `norochan-test-${stamp}.json`);
const rewardsFile = path.join(os.tmpdir(), `norochan-rewards-${stamp}.json`);
const root = path.join(__dirname, '..');
const LEGACY_EMAIL = 'legacy-visitor@example.com';

let passed = 0, failed = 0, logs = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}

async function call(method, url, { body, headers, cookie } = {}) {
  const mutating = ['POST', 'PATCH', 'DELETE', 'PUT'].includes(method);
  const res = await fetch(SITE + url, {
    method,
    headers: {
      ...(mutating ? { Origin: SITE } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}

async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(250); }
  return false;
}

// A data file written by the old version: visitor accounts next to the BotRix store.
const legacyData = () => ({
  users: [{ id: 'u1', email: LEGACY_EMAIL, passwordHash: 'scrypt$16384$8$1$c2FsdA==$aGFzaA==', role: 'admin', lastLoginIp: '203.0.113.9' }],
  sessions: { abc: { userId: 'u1', expires: Date.now() + 60000, ip: '203.0.113.9' } },
  auditLog: [{ type: 'auth.login', userId: 'u1', ip: '203.0.113.9' }],
});

async function main() {
  fs.writeFileSync(dataFile, JSON.stringify(legacyData()));
  fs.writeFileSync(rewardsFile, JSON.stringify({ currentPrizePool: 1234, leaderboardPayout: 800, levelUpBonus: 150, socialMediaGiveaways: 200, updatedAt: '1 Oct 2026' }));
  const mock = spawn('node', [path.join(root, 'test/mock-stake.js')], { env: { ...process.env, MOCK_PORT: '4100' } });
  const mockBotrix = spawn('node', [path.join(root, 'test/mock-botrix.js')], { env: { ...process.env, MOCK_BOTRIX_PORT: '4200', MOCK_BOTRIX_KEY: BOTRIX_KEY } });
  const discordHits = [];
  const mockDiscord = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      discordHits.push({
        url: req.url,
        type: String(req.headers['content-type'] || ''),
        size: buf.length,
        text: buf.toString('utf8'),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'discord-msg-1' }));
    });
  });
  await new Promise((resolve) => mockDiscord.listen(4300, '127.0.0.1', resolve));
  await sleep(400);
  const site = spawn('node', [path.join(root, 'server.js')], {
    env: {
      ...process.env, PORT: '3100', DATA_FILE: dataFile, REWARDS_FILE: rewardsFile, STAKE_TOKEN: TOKEN, STAKE_API_BASE: MOCK, REFRESH_MS: '1500',
      BOTRIX_LEADERBOARD_URL: MOCK_BOTRIX + '/v1/{platform}/{channel}/leaderboard', BOTRIX_API_KEY: BOTRIX_KEY, BOTRIX_WATCHTIME_UNIT: 'minutes',
      KICK_CHANNEL_USERNAME: 'norochan',
      KICK_CLIENT_ID: '',
      KICK_CLIENT_SECRET: '',
      ADMIN_PASSWORD: ADMIN_PASS,
      DISCORD_WHEEL_WEBHOOK: 'http://127.0.0.1:4300/api/webhooks/1/testdiscordtoken',
      WHEEL_VIDEO_FAST: '1',
      PUBLIC_SITE_URL: 'http://127.0.0.1:3100',
      BASE_URL: 'http://127.0.0.1:3100',
      AUTH_TEST: '1',
    },
  });
  for (const p of [mock, mockBotrix, site]) { p.stdout.on('data', (d) => (logs += d)); p.stderr.on('data', (d) => (logs += d)); }
  const cleanup = () => {
    mock.kill(); mockBotrix.kill(); site.kill(); mockDiscord.close();
    for (const f of [dataFile, rewardsFile]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  };
  const responses = [];
  const record = (r) => { responses.push(r); return r; };

  try {
    check('server starts', await waitFor(async () => { try { return (await call('GET', '/api/config')).status === 200; } catch { return false; } }));

    console.log('Config + static');
    const cfg = record(await call('GET', '/api/config'));
    check('config has code and referral link', cfg.json.code === 'Norochan' && cfg.json.referralUrl.includes('c=Norochan'));
    check('config exposes prize data for the home page', cfg.json.prizes && cfg.json.prizes[1] === 200 && cfg.json.prizes[2] === 100);
    check('config lists all 10 paid places', Object.keys(cfg.json.prizes || {}).length === 10 && cfg.json.prizes[10] === 10 && cfg.json.race.top === 10);
    check('config exposes Kick channel name', typeof cfg.json.kickChannel === 'string' && cfg.json.kickChannel.length > 0);
    check('social links are populated with real URLs', Object.values(cfg.json.links).every((v) => typeof v === 'string' && /^https:\/\//.test(v)) && cfg.json.links.discord.includes('discord.gg/32Ww7KZQXq'));
    check('config never contains the token', !cfg.text.includes(TOKEN));
    check('config says email login is on and OAuth is off until env is set', cfg.json.auth && cfg.json.auth.email === true && cfg.json.auth.password === true && cfg.json.auth.google === false && cfg.json.auth.kick === false);
    const kickLive = record(await call('GET', '/api/kick-live'));
    check('Kick live API endpoint responds safely', kickLive.status === 200 && ['live', 'offline', 'unavailable'].includes(kickLive.json.status), JSON.stringify(kickLive.json));
    check('Kick live payload has the fields the live card uses', ['status', 'channel', 'title', 'viewers', 'thumbnail', 'url'].every((k) => k in kickLive.json));
    const home = record(await call('GET', '/'));
    check('home page served with CSP header', home.status === 200 && /<title>Norochan/.test(home.text) && !!home.headers.get('content-security-policy'));
    check('path traversal blocked', [403, 404].includes((await call('GET', '/..%2fserver.js')).status));
    check('data.json not exposed', (await call('GET', '/data.json')).status === 404);

    console.log('Visitor account (Phase 3)');
    check('navigation has Wheel, Account chip, code benefits and announcements, not Streams, Rewards, Discord, or Kick offline', /data-route="wheel"/.test(home.text) && /id="nav-account"/.test(home.text) && /data-route="account"/.test(home.text) && /Code benefits/.test(home.text) && /Announcement/.test(home.text) && !/data-route="streams"/.test(home.text) && !/data-route="rewards"/.test(home.text) && !/data-route="discord"/.test(home.text) && !/id="nav-live"|id="nav-discord"/.test(home.text) && !/data-nav-admin|#\/admin|Sign up/i.test(home.text));
    check('home page does not link to the staff studio', !/studio\.html|studio\.js/.test(home.text));
    const appJs = record(await call('GET', '/app.js'));
    check('public site has no dark/light theme button', !/id="theme"|theme-mobile|Switch to light theme/.test(home.text) && !/toggleTheme|theme-desktop/.test(appJs.text));
    check('front end never calls old signup or staff-admin APIs', appJs.status === 200 && !/\/api\/(login|signup|profile|connect-provider)|NoroAdmin|#\/admin/.test(appJs.text) && /\/api\/me/.test(appJs.text) && /\/api\/auth\/signup/.test(appJs.text) && /\/api\/verify\/claim/.test(appJs.text) && !/\/api\/verify\/challenge/.test(appJs.text));
    check('public feed is wired', /\/api\/feed/.test(appJs.text));
    check('public wheel is a live canvas fed by /api/wheel, not hardcoded players', /\/api\/wheel/.test(appJs.text) && /getContext/.test(appJs.text) && /Live draw/.test(appJs.text) && /wheel-countdown/.test(appJs.text) && /strokeText\(label/.test(appJs.text) && !/Alice_W|bobby99|KaiTheGreat/.test(appJs.text) && !/ticketsFromWager/.test(appJs.text));
    check('viewer board keeps podium animation and never fetches BotRix from the browser', /viewerPodium/.test(appJs.text) && /\/api\/viewers\//.test(appJs.text) && /listSkeleton\(3\)/.test(appJs.text) && !/botrix\.live/.test(appJs.text) && !/BOTRIX_API_KEY|BOTRIX_KEY/.test(appJs.text));
    check('leaderboard UI can mark the signed-in row as (you)', /you-tag/.test(appJs.text) && /\(you\)/.test(appJs.text));
    check('account page can connect Kick', /\/auth\/kick\/connect/.test(appJs.text) && /Connect Kick/.test(appJs.text));
    check('Account chip uses the Stake username and first letter', /paintNavAccount/.test(appJs.text) && /nav-account-mark/.test(appJs.text) && /stakeUser/.test(appJs.text));
    check('public home does not render the prize-place rewards grid', !/reward-grid/.test(appJs.text) && !/Place ' \+ String\(rank\)/.test(appJs.text) && !/rewardFiller/.test(appJs.text));
    check('public home shows bonuses given so far after Community', /Bonuses given so far/.test(appJs.text) && /leaderboardPayout/.test(appJs.text) && /levelUpBonus/.test(appJs.text) && /socialMediaGiveaways/.test(appJs.text) && appJs.text.indexOf("id: 'community'") < appJs.text.indexOf('bonusesGivenSection()') && appJs.text.indexOf('bonusesGivenSection()') < appJs.text.indexOf('supportSection()'));
    check('old admin bundle is gone', (await call('GET', '/admin.js')).status === 404 && (await call('GET', '/css/admin.css')).status === 404);
    const studioPage = record(await call('GET', '/studio.html'));
    check('staff studio page is served off the public nav', studioPage.status === 200 && /Norochan studio/.test(studioPage.text) && /noindex/.test(studioPage.text));
    check('GET /api/me is empty when signed out', (await call('GET', '/api/me')).status === 200 && (await call('GET', '/api/me')).json.account === null);
    check('unknown staff paths require a session', (await call('GET', '/api/admin/users')).status === 401);
    for (const p of ['/api/login', '/api/signup', '/api/logout', '/api/profile', '/api/connect-provider']) {
      const r = await call('POST', p, { body: { email: 'a@example.com', password: 'longenough1' } });
      check(`POST ${p} rejected (405)`, r.status === 405, r.status);
    }
    check('old staff user-role route is not a public write', (await call('POST', '/api/admin/users/x/role', { body: { role: 'admin' } })).status === 401);
    check('Google OAuth is off until GOOGLE_CLIENT_ID is set', (await call('GET', '/auth/google')).status === 503);
    check('Kick OAuth is off until KICK_CLIENT_ID is set', (await call('GET', '/auth/kick')).status === 503);
    const kickConnect = await call('GET', '/auth/kick/connect');
    check('Kick connect without a session goes to Account', kickConnect.status === 302 && /#\/account/.test(String(kickConnect.headers.get('location') || '')));

    console.log('Staff studio (announcements + code benefits)');
    const sess = await call('GET', '/api/admin/session');
    check('staff session endpoint reports login state only', sess.status === 200 && sess.json.staff === false && sess.json.configured === true);
    check('wrong studio password rejected', (await call('POST', '/api/admin/login', { body: { password: 'wrong-password-xx' } })).status === 401);
    const login = await call('POST', '/api/admin/login', { body: { password: ADMIN_PASS } });
    const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
    const setCookie = String(login.headers.get('set-cookie') || '');
    const csrf = login.json && login.json.csrf;
    const staffOpts = (body, extra = {}) => ({ cookie, body, headers: { 'X-Studio-CSRF': csrf, ...extra } });
    check('studio login sets an HttpOnly SameSite=Strict admin-path cookie', login.status === 200 && /^studio=/.test(cookie) && /httponly/i.test(setCookie) && /samesite=strict/i.test(setCookie) && /path=\/api\/admin/i.test(setCookie));
    check('studio login returns a CSRF token', typeof csrf === 'string' && csrf.length >= 16);
    check('staff writes reject a mismatched Origin', (await call('POST', '/api/admin/announcements', staffOpts({ title: 'x' }, { Origin: 'https://evil.example' }))).status === 403);
    check('staff writes reject a missing CSRF token', (await call('POST', '/api/admin/announcements', { cookie, body: { title: 'x' } })).status === 403);
    const madeAnn = await call('POST', '/api/admin/announcements', staffOpts({ title: 'October race is live', body: 'Use the code.', published: true }));
    check('staff can post an announcement', madeAnn.status === 201 && madeAnn.json.item.title === 'October race is live');
    const madeBen = await call('POST', '/api/admin/benefits', staffOpts({ category: 'race', title: '$500 wager race', amount: 500, published: true }));
    check('staff can post a code benefit by category', madeBen.status === 201 && madeBen.json.item.category === 'race');
    const madeCodeBen = await call('POST', '/api/admin/benefits', staffOpts({ category: 'code_benefit', title: 'Code extra', published: false }));
    check('staff can post under the Code benefit category', madeCodeBen.status === 201 && madeCodeBen.json.item.category === 'code_benefit');
    const updatedBen = await call('PATCH', '/api/admin/benefits/' + madeBen.json.item.id, staffOpts({
      title: '$750 wager race',
      body: 'Updated copy',
      category: 'race',
      amount: 750,
    }));
    check('staff can update a code benefit', updatedBen.status === 200 && updatedBen.json.item.title === '$750 wager race' && updatedBen.json.item.body === 'Updated copy' && updatedBen.json.item.amount === 750 && updatedBen.json.item.category === 'race');
    check('drafts stay off the public feed', (await call('POST', '/api/admin/benefits', staffOpts({ category: 'wheel', title: 'Hidden wheel', published: false }))).json.item.published === false);
    const feed = record(await call('GET', '/api/feed'));
    check('public feed shows published posts only', feed.json.announcements.length === 1 && feed.json.categories[0].id === 'race' && /Updated copy/.test(feed.text) && !/Hidden wheel/.test(feed.text));
    check('staff can unpublish a benefit', (await call('PATCH', '/api/admin/benefits/' + madeBen.json.item.id, staffOpts({ published: false }))).status === 200 && (await call('GET', '/api/feed')).json.categories.length === 0);

    console.log('Prize pool + bonuses (rewards file)');
    const rw = record(await call('GET', '/api/rewards'));
    check('prize pool and payout breakdown come from the rewards file', rw.status === 200 && rw.json.currentPrizePool === 1234 && rw.json.leaderboardPayout === 800 && rw.json.levelUpBonus === 150 && rw.json.socialMediaGiveaways === 200 && rw.json.prizePoolSource === 'file', JSON.stringify(rw.json));
    check('total bonuses given is no longer a rewards field', !('totalBonusesGiven' in rw.json));
    await sleep(20);
    fs.writeFileSync(rewardsFile, JSON.stringify({ currentPrizePool: '2500', leaderboardPayout: 900, note: 'Paid weekly.' }));
    fs.utimesSync(rewardsFile, new Date(), new Date(Date.now() + 5000));
    const rw2 = record(await call('GET', '/api/rewards'));
    check('edits to the rewards file show up without a restart', rw2.json.currentPrizePool === 2500 && rw2.json.leaderboardPayout === 900 && rw2.json.note === 'Paid weekly.', JSON.stringify(rw2.json));
    fs.writeFileSync(rewardsFile, '{ "currentPrizePool": 99');
    fs.utimesSync(rewardsFile, new Date(), new Date(Date.now() + 10000));
    const rw3 = await call('GET', '/api/rewards');
    check('a half-edited (invalid) rewards file keeps the last good figures', rw3.json.currentPrizePool === 2500 && /not valid JSON/.test(logs), JSON.stringify(rw3.json));
    fs.writeFileSync(rewardsFile, JSON.stringify({ currentPrizePool: -5, leaderboardPayout: 'lots', levelUpBonus: -1, socialMediaGiveaways: 'x' }));
    fs.utimesSync(rewardsFile, new Date(), new Date(Date.now() + 15000));
    const rw4 = await call('GET', '/api/rewards');
    check('invalid amounts are never shown: pool falls back to race prizes, payouts blank', rw4.json.currentPrizePool === 500 && rw4.json.prizePoolSource === 'race-config' && rw4.json.leaderboardPayout === null && rw4.json.levelUpBonus === null && rw4.json.socialMediaGiveaways === null, JSON.stringify(rw4.json));
    fs.unlinkSync(rewardsFile);
    const rw5 = await call('GET', '/api/rewards');
    check('no rewards file: race prize total, no invented payout figures', rw5.json.currentPrizePool === 500 && rw5.json.leaderboardPayout === null && rw5.json.levelUpBonus === null && rw5.json.socialMediaGiveaways === null, JSON.stringify(rw5.json));

    console.log('Leaderboard');
    check('first refresh succeeds', await waitFor(async () => (await call('GET', '/api/leaderboard')).json.status === 'ok'));
    const lb = record(await call('GET', '/api/leaderboard'));
    check('10 entries', lb.json.entries.length === 10, lb.json.entries.length);
    check('previous month leaderboard is returned alongside current data', Array.isArray(lb.json.previous?.entries) && lb.json.previous.entries.length === 10, JSON.stringify(lb.json.previous));
    check('rank 1 masked as "Al***_W"', lb.json.entries[0].name === 'Al***_W', lb.json.entries[0].name);
    check('uses weighted amount (wagered * 0.42)', Math.abs(lb.json.entries[0].weighted - 900000 * 0.42) < 1, lb.json.entries[0].weighted);
    check('1st prize $200, 2nd prize $100', lb.json.entries[0].prize === 200 && lb.json.entries[1].prize === 100);
    check('entries carry no per-visitor fields', lb.json.entries.every((e) => Object.keys(e).sort().join() === 'name,prize,rank,weighted'));
    check('raw wager and tickets stay off the public leaderboard', lb.json.entries.every((e) => !('wagered' in e) && !('tickets' in e)));
    const { ticketsFromWager, mask } = require('../src/services/stake');
    check('raw Stake wager of $1000 is 1 wheel ticket', ticketsFromWager(1000) === 1 && ticketsFromWager(2000) === 2);
    check('short names do not leak last letters', mask('Kai') === 'Ka***' && mask('Ab') === 'Ab***');
    check('real usernames never sent', !/Alice_W|bobby99|KaiTheGreat/.test(lb.text));
    check('race window is 2026-10-01 to 2026-10-31 UTC',
      lb.json.race.startsAt === Date.UTC(2026, 9, 1) && lb.json.race.endsAt === Date.UTC(2026, 9, 31, 23, 59, 59, 999));
    check('Stake referred-users report is requested so staff can see a hint', await waitFor(() => /Referred-users refreshed/.test(logs) || /GET \/referred-users/.test(logs)));

    console.log('Account signup + Stake username + staff code check');
    const beforeVerify = await call('POST', '/api/auth/login', { body: { email: 'player@example.com', password: 'longenough1' } });
    check('password login fails before the email is confirmed', beforeVerify.status === 401 || beforeVerify.status === 403, beforeVerify.status);
    const emailReq = await call('POST', '/api/auth/signup', { body: { email: 'player@example.com', password: 'longenough1' } });
    check('email signup is accepted', emailReq.status === 200 && emailReq.json.sent === true && /^\/auth\/email\?token=/.test(emailReq.json.verifyPath));
    const stillClosed = await call('POST', '/api/auth/login', { body: { email: 'player@example.com', password: 'longenough1' } });
    check('unconfirmed email cannot sign in', stillClosed.status === 403, stillClosed.status);
    const magic = await call('GET', emailReq.json.verifyPath);
    const sid = String(magic.headers.get('set-cookie') || '').split(';')[0];
    check('confirm link sets an HttpOnly visitor session', magic.status === 302 && /^sid=/.test(sid) && /httponly/i.test(String(magic.headers.get('set-cookie') || '')) && /#\/account/.test(String(magic.headers.get('location') || '')));
    const me = await call('GET', '/api/me', { cookie: sid });
    check('signed-in /api/me shows email and no Stake name yet', me.json.account && me.json.account.email === 'player@example.com' && me.json.account.stakeUser === null);
    const passLogin = await call('POST', '/api/auth/login', { body: { email: 'player@example.com', password: 'longenough1' } });
    check('password login works after confirm', passLogin.status === 200 && passLogin.json.account && passLogin.json.account.email === 'player@example.com');
    const sidLogin = String(passLogin.headers.get('set-cookie') || '').split(';')[0] || sid;
    const claimed = await call('POST', '/api/verify/claim', { cookie: sidLogin, body: { stakeUser: 'Alice_W', code: 'norochan' } });
    check('owner-code claim waits for staff', claimed.status === 200 && claimed.json.account && claimed.json.account.stakeUser === 'Alice_W' && claimed.json.account.codeStatus === 'pending', JSON.stringify(claimed.json));
    check('locked name rejects a second claim', (await call('POST', '/api/verify/claim', { cookie: sidLogin, body: { stakeUser: 'bobby99', code: 'other' } })).status === 409);
    check('public leaderboard still masks Alice_W', !(await call('GET', '/api/leaderboard')).text.includes('Alice_W'));
    check('pending owner-code claim does not get you on the board', (await call('GET', '/api/leaderboard', { cookie: sidLogin })).json.entries.every((e) => !e.you));
    check('limbo challenge route is gone', (await call('POST', '/api/verify/challenge', { cookie: sidLogin, body: {} })).status === 404);

    const email2 = await call('POST', '/api/auth/signup', { body: { email: 'two@example.com', password: 'longenough1' } });
    const mag2 = await call('GET', email2.json.verifyPath);
    const sid2 = String(mag2.headers.get('set-cookie') || '').split(';')[0];
    check('another account cannot steal Alice_W', (await call('POST', '/api/verify/claim', { cookie: sid2, body: { stakeUser: 'Alice_W', code: 'other' } })).status === 409);
    const other = await call('POST', '/api/verify/claim', { cookie: sid2, body: { stakeUser: 'KaiTheGreat', code: 'other' } });
    check('other referral code is stored as not under code', other.status === 200 && other.json.account && other.json.account.stakeUser === 'KaiTheGreat' && other.json.account.codeStatus === 'not_under_code', JSON.stringify(other.json));

    const staffAcc = await call('GET', '/api/admin/accounts', { cookie });
    check('staff can list visitor accounts', staffAcc.status === 200 && (staffAcc.json.items || []).some((a) => a.stakeUser === 'Alice_W' && a.codeStatus === 'pending'));
    const accId = ((staffAcc.json.items || []).find((a) => a.email === 'player@example.com') || {}).id;
    const approved = await call('POST', '/api/admin/accounts/' + accId + '/code', staffOpts({ verdict: 'verified' }));
    check('staff can confirm an owner code', approved.status === 200 && approved.json.item && approved.json.item.codeStatus === 'verified', JSON.stringify(approved.json));
    const unbound = await call('POST', '/api/admin/accounts/' + accId + '/unbind', staffOpts({}));
    check('staff can unbind a Stake name', unbound.status === 200 && unbound.json.item && unbound.json.item.stakeUser === null);
    check('unbound account can set a name again', (await call('GET', '/api/me', { cookie: sidLogin })).json.account && (await call('GET', '/api/me', { cookie: sidLogin })).json.account.stakeUser === null);
    const reclaim = await call('POST', '/api/verify/claim', { cookie: sidLogin, body: { stakeUser: 'Alice_W', code: 'norochan' } });
    check('after unbind, owner-code claim waits for staff again', reclaim.status === 200 && reclaim.json.account && reclaim.json.account.codeStatus === 'pending', JSON.stringify(reclaim.json));
    const staffAgain = await call('GET', '/api/admin/accounts', { cookie });
    check('staff still see a pending check after the second submit', (staffAgain.json.items || []).some((a) => a.email === 'player@example.com' && a.codeStatus === 'pending' && a.stakeUser === 'Alice_W'));
    check('staff can confirm the second pending check', (await call('POST', '/api/admin/accounts/' + accId + '/code', staffOpts({ verdict: 'verified' }))).json.item.codeStatus === 'verified');
    const mine = await call('GET', '/api/leaderboard', { cookie: sidLogin });
    check('verified under-code player sees you on their masked race row', mine.json.entries[0].you === true && mine.json.entries[0].name === 'Al***_W' && !/Alice_W/.test(mine.text), JSON.stringify(mine.json.entries[0]));
    check('other race rows do not get you', mine.json.entries.slice(1).every((e) => !e.you));
    check('not-under-code account does not see you', (await call('GET', '/api/leaderboard', { cookie: sid2 })).json.entries.every((e) => !e.you));
    const linked = await call('POST', '/api/auth/kick/test-link', { cookie: sidLogin, body: { kickId: 'kick-alice', kickName: 'alicekick' } });
    check('signed-in account can connect a Kick username', linked.status === 200 && linked.json.account && linked.json.account.kickName === 'alicekick', JSON.stringify(linked.json));
    check('/api/me shows the connected Kick username', (await call('GET', '/api/me', { cookie: sidLogin })).json.account.kickName === 'alicekick');
    check('another account cannot steal that Kick username', (await call('POST', '/api/auth/kick/test-link', { cookie: sid2, body: { kickId: 'kick-alice', kickName: 'otherkick' } })).status === 409);
    const users = await call('GET', '/api/admin/users', { cookie });
    check('staff Users list shows email, Stake, verified code, and Kick', (users.json.items || []).some((a) => a.email === 'player@example.com' && a.stakeUser === 'Alice_W' && a.codeStatus === 'verified' && a.kickName === 'alicekick'), JSON.stringify(users.json.items));
    check('staff Users list shows not-under-code for the other account', (users.json.items || []).some((a) => a.email === 'two@example.com' && a.stakeUser === 'KaiTheGreat' && a.codeStatus === 'not_under_code'));
    check('visitor logout clears the session', (await call('POST', '/api/auth/logout', { cookie: sidLogin, body: {} })).status === 200 && (await call('GET', '/api/me', { cookie: sidLogin })).json.account === null);
    check('logged-out session does not keep you on the board', (await call('GET', '/api/leaderboard', { cookie: sidLogin })).json.entries.every((e) => !e.you));

    console.log('Monthly wheel');
    const { drawWeighted, periodKey, isExcluded, splitPrize } = require('../src/services/wheel');
    const drawn = drawWeighted([{ user: 'a', tickets: 10 }, { user: 'b', tickets: 1 }, { user: 'c', tickets: 1 }], 3, 'fixed-seed');
    check('weighted draw returns 3 unique winners', drawn.length === 3 && new Set(drawn.map((w) => w.user)).size === 3);
    check('short pools take every eligible player', drawWeighted([{ user: 'solo', tickets: 4 }], 3, 'x').map((w) => w.user).join() === 'solo');
    check('house account YASH001KG is excluded from the wheel', isExcluded('YASH001KG') && isExcluded('yash001kg') && drawWeighted([{ user: 'YASH001KG', tickets: 900 }, { user: 'player2', tickets: 2 }], 3, 's').every((w) => w.user !== 'YASH001KG'));
    const parts = splitPrize(50, 3);
    check('prize pool of $50 splits equally across 3 winners', parts.length === 3 && Math.abs(parts.reduce((a, b) => a + b, 0) - 50) < 0.001 && parts[0] === parts[1] && parts[2] <= parts[0]);
    check('wheel period is YYYY-MM UTC', /^\d{4}-\d{2}$/.test(periodKey(0)));
    check('wheel entries load after Stake refresh', await waitFor(async () => {
      const w = (await call('GET', '/api/wheel')).json;
      return Array.isArray(w.entries) && w.entries.length > 10;
    }));
    const wh = record(await call('GET', '/api/wheel'));
    check('public wheel uses the full campaign list, not the race top 10', wh.json.entries.length > 10, wh.json.entries.length);
    check('top wheel entry is the full Stake username with ticket count from raw wager', wh.json.entries[0].name === 'Alice_W' && wh.json.entries[0].tickets === 900, JSON.stringify(wh.json.entries[0]));
    check('wheel tickets come from the current-month Stake board', wh.json.status === 'ok' && wh.json.totalTickets >= 900 && wh.json.period && /^\d{4}-\d{2}$/.test(wh.json.period), JSON.stringify({ status: wh.json.status, total: wh.json.totalTickets, period: wh.json.period }));
    check('public wheel has no raw wager, user key, or draw seed', !('wagered' in (wh.json.entries[0] || {})) && !('user' in (wh.json.entries[0] || {})) && !('seed' in wh.json));
    check('default prize pool is $50 and next draw is UTC month start', wh.json.prizePool === 50 && wh.json.winnersCount === 3 && Number.isFinite(wh.json.nextDrawAt));
    check('start month has no last-month draw', wh.json.lastDraw == null, JSON.stringify(wh.json.lastDraw));
    const closed = await call('POST', '/api/admin/wheel/test-close', staffOpts({ now: Date.UTC(2026, 10, 1, 0, 0, 1) }));
    check('closed month auto-drew 3 winners after UTC month end', closed.status === 200 && (closed.json.lastDraw?.winners || []).length === 3 && closed.json.lastDraw.winners.every((w) => w.user && !String(w.user).includes('***')), JSON.stringify(closed.json));
    const drawnPrizes = (closed.json.lastDraw.winners || []).map((w) => w.prize);
    check('drawn prizes split the pool equally', drawnPrizes.length === 3 && Math.abs(drawnPrizes.reduce((a, b) => a + b, 0) - (closed.json.lastDraw.prizePool || 50)) < 0.001 && drawnPrizes.every((p) => p >= 16.66 && p <= 16.67), JSON.stringify(drawnPrizes));
    check('visitors cannot POST a draw', (await call('POST', '/api/wheel', { body: { spin: true } })).status === 405);
    check('staff wheel prize pool rejects anonymous PATCH', (await call('PATCH', '/api/admin/wheel', { body: { prizePool: 75 } })).status === 401);
    const staffWheel = await call('GET', '/api/admin/wheel', { cookie });
    check('staff wheel has no last-month draw during the start month', staffWheel.status === 200 && staffWheel.json.lastDraw == null, JSON.stringify(staffWheel.json.lastDraw));
    check('staff cannot change winner count via prize-pool PATCH', (await call('PATCH', '/api/admin/wheel', staffOpts({ prizePool: 80, winnersCount: 99 }))).json.winnersCount === 3);
    const poolSet = await call('PATCH', '/api/admin/wheel', staffOpts({ prizePool: 75 }));
    check('staff can set the monthly prize pool total only', poolSet.status === 200 && poolSet.json.prizePool === 75);
    check('invalid prize pool is rejected', (await call('PATCH', '/api/admin/wheel', staffOpts({ prizePool: -1 }))).status === 400);
    check('public wheel shows the new prize pool and full names', (await call('GET', '/api/wheel')).json.prizePool === 75 && (await call('GET', '/api/wheel')).text.includes('Alice_W'));
    const studioJs = await call('GET', '/studio.js');
    check('studio UI edits prize pool, not a staff draw button', /\/api\/admin\/wheel/.test(studioJs.text) && /prizePool/.test(studioJs.text) && !/staff-run|spin the/i.test(studioJs.text));
    check('studio sends a CSRF header on staff writes', /X-Studio-CSRF/.test(studioJs.text));
    check('studio has a Users list and code-check actions', /\/api\/admin\/users/.test(studioJs.text) && /Users/.test(studioJs.text) && /Kick username/.test(studioJs.text) && /Stake username/.test(studioJs.text) && /\/api\/admin\/accounts/.test(studioJs.text) && /Unbind/.test(studioJs.text) && /Code checks/.test(studioJs.text) && /reviewActions/.test(studioJs.text) && /Under code/.test(studioJs.text));
    check('studio can update existing code-benefit posts', /Update code benefit/.test(studioJs.text) && /editingBenefitId/.test(studioJs.text));
    check('studio splits each feature onto its own page', /studio-nav/.test(studioJs.text) && /id: 'users'/.test(studioJs.text) && /id: 'checks'/.test(studioJs.text) && /id: 'wheel'/.test(studioJs.text) && /id: 'prizes'/.test(studioJs.text) && /id: 'announcements'/.test(studioJs.text) && /id: 'benefits'/.test(studioJs.text) && /'#\/' \+ page\.id/.test(studioJs.text));
    check('studio copy says the draw video posts to Discord', /DISCORD_WHEEL_WEBHOOK/.test(studioJs.text) && /3-winner spin/.test(studioJs.text));
    check('studio Prizes page sets race and Kick viewer pools', /\/api\/admin\/prizes/.test(studioJs.text) && /Wager race prize pool/.test(studioJs.text) && /Kick viewer board prize pool/.test(studioJs.text) && /racePrizes/.test(studioJs.text) && /viewerRewards/.test(studioJs.text) && /Place amounts/.test(studioJs.text) && /Bonuses given so far/.test(studioJs.text) && /leaderboardPayout/.test(studioJs.text) && /levelUpBonus/.test(studioJs.text) && /socialMediaGiveaways/.test(studioJs.text));
    check('staff prize pools reject anonymous PATCH', (await call('PATCH', '/api/admin/prizes', { body: { racePrizePool: 900 } })).status === 401);
    const prizeSet = await call('PATCH', '/api/admin/prizes', staffOpts({ racePrizePool: 800, viewerPrizePool: 150 }));
    check('staff can set monthly race and Kick viewer prize pools', prizeSet.status === 200 && prizeSet.json.racePrizePool === 800 && prizeSet.json.viewerPrizePool === 150, JSON.stringify(prizeSet.json));
    const publicPools = await call('GET', '/api/rewards');
    check('public rewards show the staff-set race and viewer pools', publicPools.json.currentPrizePool === 800 && publicPools.json.prizePoolSource === 'file' && publicPools.json.viewerPrizePool === 150, JSON.stringify(publicPools.json));
    check('public viewers payload includes the viewer prize pool', (await call('GET', '/api/viewers/current')).json.prizePool === 150);
    check('invalid prize pool is rejected for race and viewers', (await call('PATCH', '/api/admin/prizes', staffOpts({ racePrizePool: -1 }))).status === 400 && (await call('PATCH', '/api/admin/prizes', staffOpts({ viewerPrizePool: 'nope' }))).status === 400);
    const placeSet = await call('PATCH', '/api/admin/prizes', staffOpts({
      racePrizes: { 1: 250, 2: 120, 3: 70, 4: 40, 5: 30, 6: 20, 7: 15, 8: 15, 9: 10, 10: 10 },
      viewerRewards: { 1: 80, 2: 45, 3: 25 },
    }));
    check('staff can set race top 10 and Kick top 3 place amounts', placeSet.status === 200 && placeSet.json.racePrizes[1] === 250 && placeSet.json.racePrizes[10] === 10 && placeSet.json.viewerRewards[1] === 80 && placeSet.json.viewerRewards[3] === 25, JSON.stringify(placeSet.json));
    check('public race leaderboard uses the staff-set place prizes', (await call('GET', '/api/leaderboard')).json.entries[0].prize === 250 && (await call('GET', '/api/leaderboard')).json.entries[1].prize === 120);
    check('public config exposes race and Kick viewer place prizes', (await call('GET', '/api/config')).json.prizes[1] === 250 && (await call('GET', '/api/config')).json.viewerRewards[2] === 45);
    check('public Kick viewer rows include top-3 rewards', (await call('GET', '/api/viewers/current')).json.entries[0].reward === 80 && (await call('GET', '/api/viewers/current')).json.entries[2].reward === 25);
    check('invalid place amount is rejected', (await call('PATCH', '/api/admin/prizes', staffOpts({ racePrizes: { 1: -5 } }))).status === 400);
    const bonusSet = await call('PATCH', '/api/admin/prizes', staffOpts({ leaderboardPayout: 1200, levelUpBonus: 400, socialMediaGiveaways: 75 }));
    check('staff can set bonuses given so far totals', bonusSet.status === 200 && bonusSet.json.leaderboardPayout === 1200 && bonusSet.json.levelUpBonus === 400 && bonusSet.json.socialMediaGiveaways === 75, JSON.stringify(bonusSet.json));
    check('public rewards expose the staff-set bonus totals', (await call('GET', '/api/rewards')).json.leaderboardPayout === 1200 && (await call('GET', '/api/rewards')).json.levelUpBonus === 400 && (await call('GET', '/api/rewards')).json.socialMediaGiveaways === 75);
    check('invalid bonus total is rejected', (await call('PATCH', '/api/admin/prizes', staffOpts({ levelUpBonus: -2 }))).status === 400);
    check('blank bonus total hides that figure', (await call('PATCH', '/api/admin/prizes', staffOpts({ socialMediaGiveaways: '' }))).json.socialMediaGiveaways == null);
    const { renderDrawGif } = require('../src/services/wheel-video');
    const sampleGif = renderDrawGif({
      period: '2026-09',
      prizePool: 50,
      winners: [{ name: 'Al***_W', tickets: 10, prize: 16.67 }, { name: 'bo***99', tickets: 4, prize: 16.67 }, { name: 'Ka***at', tickets: 2, prize: 16.66 }],
      board: [{ name: 'Al***_W', tickets: 10 }, { name: 'bo***99', tickets: 4 }, { name: 'Ka***at', tickets: 2 }],
    }, { fast: true });
    check('draw recorder writes a GIF of the 3-winner spin', Buffer.isBuffer(sampleGif) && sampleGif.slice(0, 6).toString() === 'GIF89a' && sampleGif.length > 400);
    check('closed-month draw was posted to Discord with the spin video', await waitFor(() => discordHits.some((h) => /GIF89a/.test(h.text) && /monthly wheel/.test(h.text) && /norochan-wheel-/.test(h.text)), 12000), String(discordHits.length));
    const discordBody = (discordHits[0] && discordHits[0].text) || '';
    const discordText = discordBody.split('filename="')[0];
    check(
      'Discord post uses masked names and never real Stake usernames',
      /\*\*\*/.test(discordText) && /monthly wheel/.test(discordText) && !/Alice_W|bobby99|KaiTheGreat/.test(discordText),
      discordText.slice(0, 600)
    );
    check('public APIs never include the Discord webhook URL', responses.every((r) => !String(r.text || '').includes('testdiscordtoken') && !String(r.text || '').includes('DISCORD_WHEEL_WEBHOOK')));
    const staffAfter = await call('GET', '/api/admin/wheel', { cookie });
    check('staff wheel reports Discord configured', staffAfter.json.discord && staffAfter.json.discord.configured === true);

    console.log('Stake failures keep last good data');
    await fetch(MOCK + '/__mode/401');
    await sleep(3500);
    const stale = await call('GET', '/api/leaderboard');
    check('401 from Stake: still 10 rows, flagged stale', stale.json.entries.length === 10 && stale.json.stale === true);
    check('401 logged with clear hint about host', /Token rejected \(status 401\)/.test(logs) && /STAKE_API_BASE/.test(logs));
    await fetch(MOCK + '/__mode/badcols');
    await sleep(3500);
    check('missing column reported clearly in log', /user_name.*missing|required columns: rank, user_name, total_weighted_amount/.test(logs));
    check('still serving last good data', (await call('GET', '/api/leaderboard')).json.entries.length === 10);
    await fetch(MOCK + '/__mode/ok');
    check('recovers when Stake is healthy again', await waitFor(async () => (await call('GET', '/api/leaderboard')).json.stale === false, 6000));

    console.log('BotRix top viewers (API)');
    check('BotRix sync runs at startup', await waitFor(async () => (await call('GET', '/api/viewers/current')).json.status === 'ok'));
    const vc = record(await call('GET', '/api/viewers/current'));
    check('viewers ranked by watch time, duplicates and nameless rows dropped',
      vc.json.entries.map((e) => e.username).join(',') === 'night_owl,mod_mika,chatty_cat,lurker42', JSON.stringify(vc.json.entries));
    check('watch time converted to seconds', vc.json.entries[0].watchTime === 1500 * 60 && vc.json.watchTimeAvailable === true);
    check('response has period, month, year and entry fields', vc.json.period === 'current' && vc.json.month >= 1 && vc.json.year >= 2026 &&
      ['rank', 'username', 'watchTime', 'points', 'avatar'].every((k) => k in vc.json.entries[0]));
    check('off-site avatars dropped, Kick avatars kept', vc.json.entries[0].avatar === null && /^https:\/\/files\.kick\.com\//.test(vc.json.entries[2].avatar));
    const vp = record(await call('GET', '/api/viewers/previous'));
    check('previous month without a snapshot is empty, not invented', vp.status === 200 && vp.json.status === 'empty' && vp.json.entries.length === 0);
    check('legacy /api/kick/top-viewers serves the same data', (await call('GET', '/api/kick/top-viewers?period=current')).json.entries.length === 4);
    check('invalid viewer period rejected', (await call('GET', '/api/kick/top-viewers?period=forever')).status === 400);
    check('config reports BotRix as the viewer provider', (await call('GET', '/api/config')).json.kickViewerTracking.provider === 'botrix');
    check('public payload names the BotRix watchtime metric', vc.json.source === 'botrix' && vc.json.channel === 'norochan' && vc.json.metric === 'watchtime');
    check('watchtime is the ranked field with a display string', vc.json.entries[0].rank === 1 && vc.json.entries[0].watchtimeMinutes === 1500 && typeof vc.json.entries[0].watchtimeDisplay === 'string');
    check('/api/botrix/leaderboard serves the same snapshot', (await call('GET', '/api/botrix/leaderboard')).json.entries[0].username === 'night_owl');
    check('BotRix key never sent to the browser', !vc.text.includes(BOTRIX_KEY) && !(await call('GET', '/api/config')).text.includes(BOTRIX_KEY) && !(await call('GET', '/api/botrix/leaderboard')).text.includes(BOTRIX_KEY));

    console.log('BotRix service (unit)');
    const { BotrixLeaderboardService, parseHtmlLeaderboard, parseWatchtimeToSeconds, formatWatchtimeDisplay } = require('../src/services/botrix');
    const fixture = { data: [{ name: 'b', points: 50, watchtime: 10 }, { name: 'a', points: 90, watchtime: 30 }] };
    const okFetch = async () => new Response(JSON.stringify(fixture), { status: 200 });
    const env = { BOTRIX_LEADERBOARD_URL: 'https://botrix.example/lb/{channel}', BOTRIX_WATCHTIME_UNIT: 'minutes' };
    check('public fallback is on without an issued BotRix URL', new BotrixLeaderboardService({ env: {} }).configured === true);
    check('public fallback can be turned off', new BotrixLeaderboardService({ env: { BOTRIX_PUBLIC: '0' } }).configured === false);
    check('plain http endpoint refused', !!new BotrixLeaderboardService({ env: { BOTRIX_LEADERBOARD_URL: 'http://botrix.example/x', BOTRIX_PUBLIC: '0' } }).configError);
    let clock = Date.UTC(2026, 8, 30, 23, 55);
    const svc = new BotrixLeaderboardService({ env, channel: 'norochan', fetchImpl: okFetch, now: () => clock });
    const store = svc.ensureStore({});
    await svc.syncLeaderboard(store);
    check('stored entries keep provider metadata', store.current.key === '2026-09' && store.current.entries[0].id === 'botrix:a' && store.current.entries[0].provider === 'botrix');
    clock = Date.UTC(2026, 9, 1, 0, 5);
    svc.rollover(store);
    const prev = svc.publicPeriod(store, 'previous');
    check('month rollover freezes September as previous month', prev.status === 'ok' && prev.final === true && prev.month === 9 && prev.entries[0].username === 'a');
    check('new month starts pending until the next sync', svc.publicPeriod(store, 'current').status === 'pending');
    svc.createMonthlySnapshot(store, { ...store.snapshots['2026-09'], entries: [] });
    check('frozen snapshots are never overwritten', store.snapshots['2026-09'].entries.length === 2);
    await svc.syncLeaderboard(store);
    svc.fetch = async () => new Response('{}', { status: 429, headers: { 'Retry-After': '600' } });
    clock += 60 * 1000;
    let rateErr = null;
    try { await svc.syncLeaderboard(store); } catch (err) { rateErr = err; }
    check('429 respected: backs off at least Retry-After', rateErr && rateErr.kind === 'rate_limit' && svc.nextDelay() >= 600 * 1000);
    const staleCur = svc.publicPeriod(store, 'current');
    check('failed sync keeps last good data and flags it stale', staleCur.entries.length === 2 && staleCur.stale === true);
    svc.fetch = async () => new Response('{"message":"nope"}', { status: 200 });
    let schemaErr = null;
    try { await svc.syncLeaderboard(store); } catch (err) { schemaErr = err; }
    check('unexpected response shape rejected', schemaErr && schemaErr.kind === 'schema' && store.current.entries.length === 2);
    const noUnit = new BotrixLeaderboardService({ env: { BOTRIX_LEADERBOARD_URL: env.BOTRIX_LEADERBOARD_URL }, fetchImpl: okFetch });
    const nu = noUnit.normalizeEntries(fixture);
    check('without BOTRIX_WATCHTIME_UNIT watch time is hidden, BotRix order kept', nu.rankedBy === 'botrix' && nu.entries[0].watchTime === null && nu.entries[0].username === 'b');
    let sentHeaders = null;
    const keyed = new BotrixLeaderboardService({ env: { ...env, BOTRIX_API_KEY: 'k1' }, fetchImpl: async (u, o) => { sentHeaders = o; return new Response('[]'); } });
    await keyed.fetchLeaderboard();
    check('API key sent as Bearer header and redirects refused', sentHeaders.headers.Authorization === 'Bearer k1' && sentHeaders.redirect === 'error');

    const htmlTable = '<table><tr><th>Position</th><th>Name</th><th>Points</th><th>Watchtime</th></tr>'
      + '<tr><td>1</td><td>low</td><td>99999</td><td>1h 0m</td></tr>'
      + '<tr><td>2</td><td>high</td><td>10</td><td>8h 10m</td></tr></table>';
    check('watchtime strings parse to seconds', parseWatchtimeToSeconds('8d 13h 45min') === ((8 * 24 + 13) * 60 + 45) * 60);
    check('watchtime display keeps days and minutes', formatWatchtimeDisplay(((8 * 24 + 13) * 60 + 45) * 60) === '8d 13h 45min');
    const parsedHtml = parseHtmlLeaderboard('<html><body>' + htmlTable + '</body></html>');
    check('public HTML table is parsed', Array.isArray(parsedHtml && parsedHtml.data) && parsedHtml.data[1].username === 'high');
    const htmlSvc = new BotrixLeaderboardService({
      env: { BOTRIX_PUBLIC_URL: 'http://127.0.0.1/k/norochan/leaderboard', BOTRIX_API_KEY: 'secret-key' },
      fetchImpl: async (u, o) => { sentHeaders = o; return new Response(htmlTable, { status: 200, headers: { 'Content-Type': 'text/html' } }); },
      now: () => clock,
    });
    const htmlStore = htmlSvc.ensureStore({});
    await htmlSvc.syncLeaderboard(htmlStore);
    check('HTML watchtime ranking beats points and assigns ranks after sort',
      htmlStore.current.entries.map((e) => e.username + ':' + e.rank).join(',') === 'high:1,low:2'
      && htmlStore.current.entries[0].watchTime === 8 * 3600 + 10 * 60);
    check('public page fetch never sends the API key', !sentHeaders.headers.Authorization && sentHeaders.redirect === 'follow');
    const emptySvc = new BotrixLeaderboardService({ env: { ...env }, fetchImpl: async () => new Response('{"data":[]}', { status: 200 }), now: () => clock });
    const emptyNorm = emptySvc.normalizeEntries({ data: [] });
    check('empty BotRix list is accepted without invented names', emptyNorm.entries.length === 0);
    clock += 60 * 1000;
    htmlSvc.fetch = async () => { const err = new Error('aborted'); err.name = 'TimeoutError'; throw err; };
    let timeoutErr = null;
    try { await htmlSvc.syncLeaderboard(htmlStore); } catch (err) { timeoutErr = err; }
    check('timeout keeps the last snapshot', timeoutErr && timeoutErr.kind === 'network' && htmlStore.current.entries.length === 2);
    htmlSvc.fetch = async () => new Response('nope', { status: 502 });
    let httpErr = null;
    try { await htmlSvc.syncLeaderboard(htmlStore); } catch (err) { httpErr = err; }
    check('HTTP error keeps the last snapshot', httpErr && httpErr.kind === 'http' && htmlStore.current.entries.length === 2);
    htmlSvc.fetch = async () => new Response('<html><app-root></app-root></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    let malErr = null;
    try { await htmlSvc.syncLeaderboard(htmlStore); } catch (err) { malErr = err; }
    check('malformed BotRix HTML is rejected and cache is kept', malErr && malErr.kind === 'schema' && htmlStore.current.entries[0].username === 'high');
    const pub = htmlSvc.publicPeriod(htmlStore, 'current');
    check('stale public payload has no secrets', pub.stale === true && pub.source === 'botrix' && !JSON.stringify(pub).includes('secret-key'));
    check('getBotrixLeaderboard matches publicPeriod', htmlSvc.getBotrixLeaderboard(htmlStore, 'current').entries[0].username === 'high');

    console.log('Old account data');
    check('startup warns that the data file still holds account data', /still holds old visitor-account data/.test(logs));
    check('recorded public responses never set a studio cookie', responses.every((r) => !/studio=/.test(String(r.headers.get('set-cookie') || ''))));
    check('old account data never reaches the browser', responses.every((r) => !r.text.includes(LEGACY_EMAIL) && !r.text.includes('203.0.113.9') && !/passwordHash/.test(r.text)));
    check('studio password never sent to the browser', responses.every((r) => !r.text.includes(ADMIN_PASS)));

    console.log('Secrets');
    const saved = fs.readFileSync(dataFile, 'utf8');
    check('BotRix leaderboard persisted to the data file', saved.includes('"viewerLeaderboard"') && saved.includes('night_owl'));
    check('monthly wheel draw persisted to the data file', /"wheel"/.test(saved) && /"draws"/.test(saved) && /"prizePool"/.test(saved));
    check('visitor accounts persisted under accounts, not users', /"accounts"/.test(saved) && saved.includes('player@example.com') && saved.includes('two@example.com') && /"visitorSessions"/.test(saved));
    check('BotRix key not in logs or data file', !logs.includes(BOTRIX_KEY) && !saved.includes(BOTRIX_KEY));
    check('token not in logs', !logs.includes(TOKEN));
    check('token not in data.json', !saved.includes(TOKEN));

    console.log('Migration 001-remove-accounts');
    site.kill();
    await sleep(300);
    const migrate = (...args) => execFileSync('node', [path.join(root, 'scripts/migrations/001-remove-accounts.js'), ...args], { env: { ...process.env, DATA_FILE: dataFile }, encoding: 'utf8' });
    const dry = migrate('--dry-run');
    check('dry run lists what would go and changes nothing', /would remove "users" \(1 entries\)/.test(dry) && fs.readFileSync(dataFile, 'utf8') === saved);
    check('dry run prints counts only, no personal data', !dry.includes(LEGACY_EMAIL) && !dry.includes('203.0.113.9'));
    const out = migrate();
    const migrated = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    check('users, sessions and auditLog removed', !('users' in migrated) && !('sessions' in migrated) && !('auditLog' in migrated));
    check('BotRix snapshots kept intact', JSON.stringify(migrated.viewerLeaderboard) === JSON.stringify(JSON.parse(saved).viewerLeaderboard));
    check('wheel draws kept intact', JSON.stringify(migrated.wheel) === JSON.stringify(JSON.parse(saved).wheel));
    check('Phase 3 visitor accounts kept intact', Array.isArray(migrated.accounts) && migrated.accounts.some((a) => a.email === 'two@example.com') && migrated.accounts.some((a) => a.stakeUser === 'KaiTheGreat'));
    check('migration recorded in the data file', Array.isArray(migrated.migrations) && migrated.migrations.includes('001-remove-accounts'));
    const backup = (/backup written to (.+)/.exec(out) || [])[1];
    check('backup of the original written first', !!backup && fs.existsSync(backup.trim()) && fs.readFileSync(backup.trim(), 'utf8') === saved);
    if (backup) fs.unlinkSync(backup.trim());
    const again = migrate();
    check('running it again is a no-op', /no account data/.test(again) && /Already applied/.test(again) && !/backup written/.test(again));
  } catch (err) {
    failed++;
    console.log('  FAIL test crashed: ' + err.stack);
  } finally {
    cleanup();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('\n--- server log ---\n' + logs); process.exit(1); }
}
main();
