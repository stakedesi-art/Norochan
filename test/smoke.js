'use strict';
// End-to-end smoke test. Starts the mock Stake and BotRix APIs and the site on spare ports, then exercises everything.
//   node test/smoke.js
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = 'http://127.0.0.1:3100';
const MOCK = 'http://127.0.0.1:4100';
const MOCK_BOTRIX = 'http://127.0.0.1:4200';
const TOKEN = 'test-token-DO-NOT-LEAK-123';
const BOTRIX_KEY = 'botrix-key-DO-NOT-LEAK-456';
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

async function call(method, url, { body, headers } = {}) {
  const res = await fetch(SITE + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
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
  await sleep(400);
  const site = spawn('node', [path.join(root, 'server.js')], {
    env: {
      ...process.env, PORT: '3100', DATA_FILE: dataFile, REWARDS_FILE: rewardsFile, STAKE_TOKEN: TOKEN, STAKE_API_BASE: MOCK, REFRESH_MS: '1500',
      BOTRIX_LEADERBOARD_URL: MOCK_BOTRIX + '/v1/{platform}/{channel}/leaderboard', BOTRIX_API_KEY: BOTRIX_KEY, BOTRIX_WATCHTIME_UNIT: 'minutes',
      KICK_CHANNEL_USERNAME: 'norochan',
    },
  });
  for (const p of [mock, mockBotrix, site]) { p.stdout.on('data', (d) => (logs += d)); p.stderr.on('data', (d) => (logs += d)); }
  const cleanup = () => {
    mock.kill(); mockBotrix.kill(); site.kill();
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
    const kickLive = record(await call('GET', '/api/kick-live'));
    check('Kick live API endpoint responds safely', kickLive.status === 200 && ['live', 'offline', 'unavailable'].includes(kickLive.json.status), JSON.stringify(kickLive.json));
    check('Kick live payload has the fields the live card uses', ['status', 'channel', 'title', 'viewers', 'thumbnail', 'url'].every((k) => k in kickLive.json));
    const home = record(await call('GET', '/'));
    check('home page served with CSP header', home.status === 200 && /<title>Norochan/.test(home.text) && !!home.headers.get('content-security-policy'));
    check('path traversal blocked', [403, 404].includes((await call('GET', '/..%2fserver.js')).status));
    check('data.json not exposed', (await call('GET', '/data.json')).status === 404);

    console.log('Public site has no accounts or admin');
    check('navigation has no Log in, Account or Admin links', !/data-nav-account|data-nav-admin|#\/account|#\/admin|Log in|Sign up/i.test(home.text));
    const appJs = record(await call('GET', '/app.js'));
    check('front end never calls account endpoints', appJs.status === 200 && !/\/api\/(me|login|signup|logout|profile|connect-provider|admin)|\/auth\/(kick|google)|NoroAdmin/.test(appJs.text));
    check('rewards UI shows ten places and a payout list', /Place ' \+ String\(rank\)/.test(appJs.text) && /leaderboardPayout/.test(appJs.text) && /levelUpBonus/.test(appJs.text) && /socialMediaGiveaways/.test(appJs.text) && !/Total bonuses given/.test(appJs.text));
    check('admin bundle is gone', (await call('GET', '/admin.js')).status === 404 && (await call('GET', '/css/admin.css')).status === 404);
    for (const p of ['/api/me', '/api/admin/stats', '/api/admin/users', '/api/admin/session']) {
      check(`GET ${p} is 404`, (await call('GET', p)).status === 404);
    }
    for (const p of ['/api/login', '/api/signup', '/api/logout', '/api/profile', '/api/connect-provider', '/api/admin/users/x/role']) {
      const r = await call('POST', p, { body: { email: 'a@example.com', password: 'longenough1' } });
      check(`POST ${p} rejected (405)`, r.status === 405, r.status);
    }
    for (const p of ['/auth/kick', '/auth/google', '/auth/kick/callback?code=x&state=y']) {
      const r = await call('GET', p);
      check(`${p.split('?')[0]} no longer redirects to a sign-in flow`, r.status === 404 && !r.headers.get('location'), r.status);
    }

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
    check('rank 1 masked as "Al***"', lb.json.entries[0].name === 'Al***', lb.json.entries[0].name);
    check('uses weighted amount (wagered * 0.42)', Math.abs(lb.json.entries[0].weighted - 900000 * 0.42) < 1, lb.json.entries[0].weighted);
    check('1st prize $200, 2nd prize $100', lb.json.entries[0].prize === 200 && lb.json.entries[1].prize === 100);
    check('entries carry no per-visitor fields', lb.json.entries.every((e) => Object.keys(e).sort().join() === 'name,prize,rank,weighted'));
    check('real usernames never sent', !/Alice_W|bobby99|KaiTheGreat/.test(lb.text));
    check('race window is 2026-10-01 to 2026-10-31 UTC',
      lb.json.race.startsAt === Date.UTC(2026, 9, 1) && lb.json.race.endsAt === Date.UTC(2026, 9, 31, 23, 59, 59, 999));
    check('Stake referred-users report is no longer requested', !/\/referred-users/.test(logs));

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
    check('BotRix key never sent to the browser', !vc.text.includes(BOTRIX_KEY) && !(await call('GET', '/api/config')).text.includes(BOTRIX_KEY));

    console.log('BotRix service (unit)');
    const { BotrixLeaderboardService } = require('../src/services/botrix');
    const fixture = { data: [{ name: 'b', points: 50, watchtime: 10 }, { name: 'a', points: 90, watchtime: 30 }] };
    const okFetch = async () => new Response(JSON.stringify(fixture), { status: 200 });
    const env = { BOTRIX_LEADERBOARD_URL: 'https://botrix.example/lb/{channel}', BOTRIX_WATCHTIME_UNIT: 'minutes' };
    check('not configured without BOTRIX_LEADERBOARD_URL', new BotrixLeaderboardService({ env: {} }).configured === false);
    check('plain http endpoint refused', !!new BotrixLeaderboardService({ env: { BOTRIX_LEADERBOARD_URL: 'http://botrix.example/x' } }).configError);
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

    console.log('Old account data');
    check('startup warns that the data file still holds account data', /still holds old visitor-account data/.test(logs));
    check('no response ever sets a cookie', responses.every((r) => !r.headers.get('set-cookie')));
    check('old account data never reaches the browser', responses.every((r) => !r.text.includes(LEGACY_EMAIL) && !r.text.includes('203.0.113.9') && !/passwordHash/.test(r.text)));

    console.log('Secrets');
    const saved = fs.readFileSync(dataFile, 'utf8');
    check('BotRix leaderboard persisted to the data file', saved.includes('"viewerLeaderboard"') && saved.includes('night_owl'));
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
