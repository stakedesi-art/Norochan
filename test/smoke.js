'use strict';
// End-to-end smoke test. Starts the mock Stake API and the site on spare ports, then exercises everything.
//   node test/smoke.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = 'http://127.0.0.1:3100';
const MOCK = 'http://127.0.0.1:4100';
const TOKEN = 'test-token-DO-NOT-LEAK-123';
const dataFile = path.join(os.tmpdir(), `norochan-test-${Date.now()}.json`);
const root = path.join(__dirname, '..');

let passed = 0, failed = 0, logs = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}

async function call(method, url, { body, cookie, headers } = {}) {
  const res = await fetch(SITE + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie()[0] : null;
  return { status: res.status, json, text, setCookie, headers: res.headers };
}
const sid = (r) => r.setCookie && r.setCookie.split(';')[0];

async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(250); }
  return false;
}

function loadServerModule() {
  const fs = require('fs');
  const vm = require('vm');
  const source = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8')
    .replace(/main\(\);/, "if (process.env.RUN_SERVER !== '0') { main(); } module.exports = { state, referralStatus, mePayload, normalizeUserRecord };\n");
  const sandbox = {
    require,
    module: { exports: {} },
    exports: {},
    process: { ...process, env: { ...process.env, RUN_SERVER: '0' } },
    console,
    __dirname: path.join(root, 'src'),
    __filename: path.join(root, 'src/server.js'),
    Buffer,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, sandbox, { filename: 'server.js' });
  return sandbox.module.exports;
}

async function main() {
  const mock = spawn('node', [path.join(root, 'test/mock-stake.js')], { env: { ...process.env, MOCK_PORT: '4100' } });
  const site = spawn('node', [path.join(root, 'server.js')], {
    env: { ...process.env, PORT: '3100', DATA_FILE: dataFile, STAKE_TOKEN: TOKEN, STAKE_API_BASE: MOCK, REFRESH_MS: '1500' },
  });
  for (const p of [mock, site]) { p.stdout.on('data', (d) => (logs += d)); p.stderr.on('data', (d) => (logs += d)); }
  const cleanup = () => { mock.kill(); site.kill(); try { fs.unlinkSync(dataFile); } catch { /* ignore */ } };

  try {
    check('server starts', await waitFor(async () => { try { return (await call('GET', '/api/config')).status === 200; } catch { return false; } }));

    console.log('Config + static');
    const serverModule = loadServerModule();
    serverModule.state.referred.names = new Set(['alice_w']);
    serverModule.state.referred.updatedAt = null;
    check('referral status falls back to coming soon instead of checking',
      serverModule.referralStatus({ stakeUsername: 'ghost_player' }) === 'coming_soon' &&
      serverModule.referralStatus({ stakeUsername: 'alice_w' }) === 'coming_soon',
      JSON.stringify({ ghost: serverModule.referralStatus({ stakeUsername: 'ghost_player' }), known: serverModule.referralStatus({ stakeUsername: 'alice_w' }) }));

    const cfg = await call('GET', '/api/config');
    check('config has code and referral link', cfg.json.code === 'Norochan' && cfg.json.referralUrl.includes('c=Norochan'));
    check('config exposes prize data for the home page', cfg.json.prizes && cfg.json.prizes[1] === 200 && cfg.json.prizes[2] === 100);
    check('config exposes Kick channel name', typeof cfg.json.kickChannel === 'string' && cfg.json.kickChannel.length > 0);
    check('social links are populated with real URLs', Object.values(cfg.json.links).every((v) => typeof v === 'string' && /^https:\/\//.test(v)) && cfg.json.links.discord.includes('discord.gg/32Ww7KZQXq'));
    check('config never contains the token', !cfg.text.includes(TOKEN));
    const kickLive = await call('GET', '/api/kick-live');
    check('Kick live API endpoint responds safely', kickLive.status === 200 && ['live', 'offline', 'unavailable'].includes(kickLive.json.status), JSON.stringify(kickLive.json));
    const home = await call('GET', '/');
    check('home page served with CSP header', home.status === 200 && /<title>Norochan/.test(home.text) && !!home.headers.get('content-security-policy'));
    check('path traversal blocked', [403, 404].includes((await call('GET', '/..%2fserver.js')).status));
    check('data.json not exposed', (await call('GET', '/data.json')).status === 404);

    console.log('Leaderboard');
    check('first refresh succeeds', await waitFor(async () => (await call('GET', '/api/leaderboard')).json.status === 'ok'));
    const lb = await call('GET', '/api/leaderboard');
    check('10 entries', lb.json.entries.length === 10, lb.json.entries.length);
    check('previous month leaderboard is returned alongside current data', Array.isArray(lb.json.previous?.entries) && lb.json.previous.entries.length === 10, JSON.stringify(lb.json.previous));
    check('rank 1 masked as "Al***"', lb.json.entries[0].name === 'Al***', lb.json.entries[0].name);
    check('uses weighted amount (wagered * 0.42)', Math.abs(lb.json.entries[0].weighted - 900000 * 0.42) < 1, lb.json.entries[0].weighted);
    check('1st prize $200, 2nd prize $100', lb.json.entries[0].prize === 200 && lb.json.entries[1].prize === 100);
    check('real usernames never sent', !/Alice_W|bobby99|KaiTheGreat/.test(lb.text));
    check('race window is 2026-10-01 to 2026-10-31 UTC',
      lb.json.race.startsAt === Date.UTC(2026, 9, 1) && lb.json.race.endsAt === Date.UTC(2026, 9, 31, 23, 59, 59, 999));

    console.log('Accounts');
    const email = 'tester@example.com';
    check('bad email rejected', (await call('POST', '/api/signup', { body: { email: 'nope', password: 'longenough1' } })).status === 400);
    check('short password rejected', (await call('POST', '/api/signup', { body: { email, password: 'short' } })).status === 400);
    const su = await call('POST', '/api/signup', { body: { email, password: 'correct horse battery' } });
    check('signup works (201)', su.status === 201, su.status);
    check('cookie is HttpOnly + SameSite=Lax', /HttpOnly/i.test(su.setCookie) && /SameSite=Lax/i.test(su.setCookie), su.setCookie);
    check('new users store provider IDs', fs.readFileSync(dataFile, 'utf8').includes('"google_sub": null') && fs.readFileSync(dataFile, 'utf8').includes('"kick_id": null'));
    check('duplicate email rejected (409)', (await call('POST', '/api/signup', { body: { email: email.toUpperCase(), password: 'another long pw' } })).status === 409);
    let cookie = sid(su);
    check('/api/me with cookie', (await call('GET', '/api/me', { cookie })).json.user?.email === email);
    check('/api/me without cookie is null', (await call('GET', '/api/me')).json.user === null);
    check('profile needs login (401)', (await call('POST', '/api/profile', { body: { stakeUsername: 'x1' } })).status === 401);
    check('cross-site POST blocked (403)', (await call('POST', '/api/login', { body: { email, password: 'x' }, headers: { Origin: 'https://evil.example' } })).status === 403);
    check('non-JSON POST rejected', (await call('POST', '/api/login', { headers: { 'Content-Type': 'text/plain' } })).status === 415);

    console.log('Linking usernames');
    check('invalid Stake name rejected', (await call('POST', '/api/profile', { cookie, body: { stakeUsername: 'a b!' } })).status === 400);
    const p1 = await call('POST', '/api/profile', { cookie, body: { stakeUsername: 'alice_w', kickUsername: 'alice_live' } });
    check('link Stake + Kick usernames', p1.status === 200 && p1.json.user.kickUsername === 'alice_live');
    const p2 = await call('POST', '/api/profile', { cookie, body: { stakeUsername: 'different_user' } });
    check('saved Stake username is immutable after first save', p2.status === 409 && p1.json.user.stakeUsername === 'alice_w', JSON.stringify(p2.json));
    check('referral "found" (case-insensitive)', p1.json.user.referral === 'found', p1.json.user.referral);
    check('leaderboard rank 1 reported', p1.json.user.leaderboardRank === 1);
    const lb2 = await call('GET', '/api/leaderboard', { cookie });
    check('own row flagged you:true, others false', lb2.json.entries[0].you === true && lb2.json.entries.filter((e) => e.you).length === 1);
    const b = await call('POST', '/api/signup', { body: { email: 'second@example.com', password: 'second account pw' } });
    const cookieB = sid(b);
    const dup = await call('POST', '/api/profile', { cookie: cookieB, body: { stakeUsername: 'ALICE_W' } });
    check('same Stake username on 2nd account blocked (409)', dup.status === 409, dup.status);
    const nf = await call('POST', '/api/profile', { cookie: cookieB, body: { stakeUsername: 'ghost_player' } });
    check('referral "not_found" for unknown user', nf.json.user.referral === 'not_found');
    const c = await call('POST', '/api/signup', { body: { email: 'third@example.com', password: 'third account pw' } });
    const cookieC = sid(c);
    const f2 = await call('POST', '/api/profile', { cookie: cookieC, body: { stakeUsername: 'user7' } });
    check('referred but not on leaderboard: found, no rank', f2.json.user.referral === 'found' && f2.json.user.leaderboardRank === null, JSON.stringify(f2.json.user));
    const d = await call('POST', '/api/signup', { body: { email: 'fourth@example.com', password: 'fourth account pw' } });
    const cookieD = sid(d);
    const f3 = await call('POST', '/api/profile', { cookie: cookieD, body: { stakeUsername: 'user12' } });
    check('outside visible top-10 is not on leaderboard', f3.json.user.referral === 'not_found' && f3.json.user.leaderboardRank === null, JSON.stringify(f3.json.user));
    const blank = await call('POST', '/api/signup', { body: { email: 'fifth@example.com', password: 'fifth account pw' } });
    check('empty username stays unset for a user without a saved Stake username', (await call('POST', '/api/profile', { cookie: sid(blank), body: { stakeUsername: '' } })).json.user.stakeUsername === null);

    console.log('Log in / out + rate limit');
    check('logout works', (await call('POST', '/api/logout', { cookie, body: {} })).status === 200);
    check('old session dead after logout', (await call('GET', '/api/me', { cookie })).json.user === null);
    const li = await call('POST', '/api/login', { body: { email, password: 'correct horse battery' } });
    check('login works', li.status === 200 && !!sid(li));
    let last;
    for (let i = 0; i < 5; i++) last = await call('POST', '/api/login', { body: { email: 'second@example.com', password: 'wrong-password-' + i } });
    check('wrong password gives 401', last.status === 401);
    const limited = await call('POST', '/api/login', { body: { email: 'second@example.com', password: 'second account pw' } });
    check('6th attempt rate limited (429 + Retry-After)', limited.status === 429 && !!limited.headers.get('retry-after'), limited.status);

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

    console.log('Secrets');
    const saved = fs.readFileSync(dataFile, 'utf8');
    check('token not in logs', !logs.includes(TOKEN));
    check('token not in data.json', !saved.includes(TOKEN));
    check('passwords stored as scrypt hashes only', /"passwordHash": "scrypt\$/.test(saved) && !saved.includes('correct horse battery'));
    check('sessions stored hashed (no raw cookie value)', !saved.includes(sid(li).split('=')[1]));
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
