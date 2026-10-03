'use strict';
// Norochan site: zero-dependency Node 18+ server.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// CONFIG: edit everything you want to change right here.
// ============================================================
const CONFIG = {
  name: 'Norochan',
  code: 'Norochan',
  referralUrl: 'https://stake.jp/?c=Norochan&offer=norochan',
  // Replace each value with your full link (must start with https://).
  links: {
    discord: 'https://discord.gg/32Ww7KZQXq',
    telegram: 'https://t.me/norochanstakecommunity',
    x: 'https://x.com/Norochanplay',
    youtube: 'https://youtube.com/@norochanplays?si=RbAgoKeuxu-jfyE2',
    kick: 'https://kick.com/norochan',
    instagram: 'https://www.instagram.com/norochanplay',
  },
  race: {
    title: 'October Wager Race',
    startsAt: Date.UTC(2026, 9, 1, 0, 0, 0, 0), // Oct 1 2026 00:00:00 UTC
    endsAt: Date.UTC(2026, 9, 31, 23, 59, 59, 999), // Oct 31 2026 23:59:59 UTC
    top: 10,
  },
  // Prizes in USD. Add single ranks here:
  prizes: {
    1: 200,
    2: 100,
    3: 60,
    4: 40,
    5: 30,
    6: 20,
  },
  // ...or ranges, for example { from: 11, to: 20, amount: 100 }
  prizeRanges: [
    { from: 7, to: 8, amount: 15 },
    { from: 9, to: 10, amount: 10 },
  ],
};

// ============================================================
// Settings from environment variables (token is NEVER stored in a file)
// ============================================================
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // use 0.0.0.0 when hosting online
const BASE_URL = (process.env.BASE_URL || `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`).replace(/\/+$/, '');
const KICK_REDIRECT_URI = (process.env.KICK_REDIRECT_URI || `${BASE_URL}/auth/kick/callback`).replace(/\/+$/, '');
const RAW_STAKE_BASE = process.env.STAKE_API_BASE || 'https://api.stake.com/affiliate';
const STAKE_BASE = RAW_STAKE_BASE.replace(/\/api\/?$/i, '').replace(/\/+$/, '');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const REFRESH_MS = Math.max(1000, Number(process.env.REFRESH_MS) || 60 * 60 * 1000);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const USE_CSV_FILES = ['1', 'true', 'yes'].includes(String(process.env.USE_CSV_FILES || '').toLowerCase());
const STAKE_EXCLUSIVE = ['1', 'true', 'yes'].includes(String(process.env.STAKE_EXCLUSIVE || '').toLowerCase());
const ALL_CAMPAIGNS = ['1', 'true', 'yes'].includes(String(process.env.ALL_CAMPAIGNS || '').toLowerCase());
const RACE_CAMPAIGN_CODE = String(process.env.RACE_CAMPAIGN_CODE || 'Norochan').trim() || 'Norochan';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const LEADERBOARD_CSV = path.join(DATA_DIR, 'leaderboard.csv');
const REFERRED_USERS_CSV = path.join(DATA_DIR, 'referred-users.csv');
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const KICK_CLIENT_ID = String(process.env.KICK_CLIENT_ID || '').trim();
const KICK_CLIENT_SECRET = String(process.env.KICK_CLIENT_SECRET || '').trim();
const KICK_CHANNEL = String(process.env.KICK_CHANNEL_USERNAME || process.env.KICK_CHANNEL || 'norochan').trim() || 'norochan';
const KICK_AUTH_URL = 'https://id.kick.com/oauth/authorize';
const KICK_TOKEN_URL = 'https://id.kick.com/oauth/token';
const KICK_USERS_URL = 'https://api.kick.com/public/v1/users';
const KICK_OAUTH_TTL_MS = 10 * 60 * 1000;
const KICK_PUBLIC_TIMEOUT_MS = 12000;

// ============================================================
// Tiny CSV parser + header matching
// ============================================================
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function parseNumericCsvValue(value) {
  if (value == null) return Number.NaN;
  let cleaned = String(value).trim();
  if (!cleaned) return Number.NaN;
  cleaned = cleaned.replace(/[$,\s]/g, '');
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : Number.NaN;
}

function loadedCsvFallbackState() {
  return {
    leaderboard: { data: [], mtimeMs: null, updatedAt: null },
    referred: { data: new Set(), mtimeMs: null, updatedAt: null },
  };
}

const csvFallbackState = loadedCsvFallbackState();

function normalizeCampaignCode(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').replace(/\s+/g, ' ').trim();
}

function parseLeaderboardCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map(normHeader);
  const rankIdx = headers.indexOf('rank');
  const userIdx = headers.indexOf('user_name');
  let weightedIdx = headers.indexOf('total_weighted_amount');
  if (weightedIdx === -1) weightedIdx = headers.indexOf('total_wagered_amount');
  const campaignIdx = headers.indexOf('campaign_code');
  if (rankIdx === -1 || userIdx === -1 || weightedIdx === -1) {
    throw new StakeError(`Leaderboard CSV missing required columns: rank, user_name, total_weighted_amount (found: ${rows[0].join(', ') || 'none'}).`, 'bad_columns');
  }
  const entries = [];
  for (const row of rows.slice(1)) {
    const rank = parseInt(row[rankIdx], 10);
    const user = (row[userIdx] || '').trim();
    const weighted = parseNumericCsvValue(row[weightedIdx]);
    const campaign = campaignIdx === -1 ? null : normalizeCampaignCode(row[campaignIdx]);
    if (!user || !Number.isFinite(rank) || !Number.isFinite(weighted)) continue;
    entries.push({ rank, user, weighted, campaign: campaign || null });
  }
  entries.sort((a, b) => a.rank - b.rank);
  if (!ALL_CAMPAIGNS) {
    const wanted = normalizeCampaignCode(RACE_CAMPAIGN_CODE).toLowerCase();
    const filtered = entries.filter((entry) => {
      if (!entry.campaign) return false;
      return normalizeCampaignCode(entry.campaign).toLowerCase() === wanted;
    });
    return filtered.map((entry, index) => ({ ...entry, rank: index + 1 }));
  }
  return entries.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function parseReferredUsersCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return new Set();
  const headers = rows[0].map(normHeader);
  const userIdx = headers.indexOf('user');
  if (userIdx === -1) {
    throw new StakeError(`Referred users CSV missing required column: user (found: ${rows[0].join(', ') || 'none'}).`, 'bad_columns');
  }
  const names = new Set();
  for (const row of rows.slice(1)) {
    const user = (row[userIdx] || '').trim().toLowerCase();
    if (user) names.add(user);
  }
  return names;
}

function readCsvFallbacks(force = false) {
  const files = [
    ['leaderboard', LEADERBOARD_CSV, parseLeaderboardCsv],
    ['referred', REFERRED_USERS_CSV, parseReferredUsersCsv],
  ];
  let changed = false;
  for (const [key, filePath, parser] of files) {
    try {
      const stat = fs.statSync(filePath);
      const mtimeMs = stat.mtimeMs;
      if (force || mtimeMs !== csvFallbackState[key].mtimeMs) {
        const text = fs.readFileSync(filePath, 'utf8');
        csvFallbackState[key].data = key === 'leaderboard' ? parser(text) : parser(text);
        csvFallbackState[key].mtimeMs = mtimeMs;
        csvFallbackState[key].updatedAt = mtimeMs;
        changed = true;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[csv-fallback] ${key} file unreadable: ${err.message}`);
      }
    }
  }
  return changed;
}

// "total_weighted_amount (USD)" -> "total_weighted_amount"
const normHeader = (h) =>
  String(h).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function columnIndexes(headerRow, wanted, label) {
  const norm = headerRow.map(normHeader);
  const out = {};
  for (const name of wanted) {
    const idx = norm.indexOf(name);
    if (idx === -1) {
      throw new StakeError(
        `${label}: column "${name}" is missing from Stake's response (columns found: ${headerRow.join(', ') || 'none'}).`,
        'bad_columns'
      );
    }
    out[name] = idx;
  }
  return out;
}

// ============================================================
// Stake affiliate API client (read-only)
// ============================================================
class StakeError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

async function stakeGet(pathname, params) {
  const token = process.env.STAKE_TOKEN;
  if (!token) throw new StakeError('STAKE_TOKEN environment variable is not set.', 'no_token');
  const url = new URL(STAKE_BASE + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  console.log(`[stake] GET ${url.pathname}${url.search}`);
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'x-access-token': token,
        Accept: 'text/csv',
        'User-Agent': 'NorochanSite/1.0',
      },
      signal: AbortSignal.timeout(20000),
      redirect: 'error', // never forward the token to a redirect target
    });
  } catch (err) {
    throw new StakeError(`Could not reach Stake API (${err.cause?.code || err.name}).`, 'network');
  }
  const body = await res.text();
  const looksLikeHtml = /^\s*</.test(body);
  if (res.status === 403 && looksLikeHtml) {
    throw new StakeError('Blocked by Cloudflare or wrong host (status 403)', 'blocked');
  }
  if (res.status === 401 || (res.status === 403 && !looksLikeHtml)) {
    throw new StakeError(`Token rejected (status ${res.status}). Check STAKE_TOKEN and set STAKE_API_BASE to the correct host if needed.`, 'auth');
  }
  if (!res.ok) {
    throw new StakeError(`Stake API returned HTTP ${res.status}: ${body.slice(0, 200).replace(/\s+/g, ' ')}`, 'http');
  }
  return body;
}

function monthRangeForOffset(monthOffset = 0) {
  const target = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth() + monthOffset,
    1,
    0,
    0,
    0,
    0
  ));
  return {
    startDate: Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), 1, 0, 0, 0, 0),
    endDate: Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  };
}

function leaderboardRequestConfig(monthOffset = 0) {
  const now = new Date();
  const inRaceMonth = now.getUTCFullYear() === 2026 && now.getUTCMonth() === 9;
  if (monthOffset === 0 && inRaceMonth) {
    return {
      timePeriod: 'currentMonth',
      isStakeExclusive: String(STAKE_EXCLUSIVE),
      limit: 100,
      offset: 0,
    };
  }
  const range = monthRangeForOffset(monthOffset);
  return {
    timePeriod: 'customRange',
    isStakeExclusive: String(STAKE_EXCLUSIVE),
    limit: 100,
    offset: 0,
    startDate: range.startDate,
    endDate: range.endDate,
  };
}

async function fetchLeaderboard(monthOffset = 0) {
  const base = leaderboardRequestConfig(monthOffset);
  const entries = [];
  const seen = new Set();
  const allDistinctCampaignCodes = new Set();
  let totalRowsBeforeFilter = 0;
  for (let page = 0; page < 3; page++) {
    const csv = await stakeGet('/leaderboard', { ...base, offset: page * 100, limit: 100 });
    const rows = parseCsv(csv);
    if (!rows.length) break;
    const dataRows = rows.slice(1);
    const headers = rows[0].map(normHeader);
    const rankIdx = headers.indexOf('rank');
    const userIdx = headers.indexOf('user_name');
    const weightedIdx = headers.indexOf('total_weighted_amount');
    const campaignIdx = headers.indexOf('campaign_code');
    if (rankIdx === -1 || userIdx === -1 || weightedIdx === -1) {
      throw new StakeError(`Leaderboard CSV missing required columns: rank, user_name, total_weighted_amount (found: ${rows[0].join(', ') || 'none'}).`, 'bad_columns');
    }
    const pageEntries = [];
    for (const r of dataRows) {
      const rank = parseInt(r[rankIdx], 10);
      const weighted = parseNumericCsvValue(r[weightedIdx]);
      const user = (r[userIdx] || '').trim();
      const campaign = campaignIdx === -1 ? null : normalizeCampaignCode(r[campaignIdx]);
      if (!user || !Number.isFinite(rank) || !Number.isFinite(weighted)) continue;
      pageEntries.push({ rank, user, weighted, campaign: campaign || null });
    }
    totalRowsBeforeFilter += pageEntries.length;
    for (const entry of pageEntries) {
      if (entry.campaign) allDistinctCampaignCodes.add(normalizeCampaignCode(entry.campaign));
    }
    const distinctCampaignCodes = [...new Set(pageEntries.map((entry) => normalizeCampaignCode(entry.campaign)).filter(Boolean))];
    const rowsAfterFilter = [];
    for (const entry of pageEntries) {
      if (!ALL_CAMPAIGNS) {
        if (!entry.campaign) continue;
        if (normalizeCampaignCode(entry.campaign).toLowerCase() !== normalizeCampaignCode(RACE_CAMPAIGN_CODE).toLowerCase()) continue;
      }
      const key = `${entry.user.toLowerCase()}|${entry.rank}|${entry.weighted}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rowsAfterFilter.push({ ...entry });
    }
    console.log(`[leaderboard-refresh] page=${page} rowsFetched=${dataRows.length} rowsBeforeFilter=${pageEntries.length} distinctCampaignCodes=${distinctCampaignCodes.length ? distinctCampaignCodes.join('|') : '(none)'} rowsAfterFilter=${rowsAfterFilter.length}`);
    entries.push(...rowsAfterFilter);
    if (dataRows.length < 100) break;
  }
  entries.sort((a, b) => a.rank - b.rank);
  const finalEntries = entries.slice(0, CONFIG.race.top).map((entry, index) => ({ ...entry, rank: index + 1 }));
  console.log(`[leaderboard-refresh] totalRowsBeforeFilter=${totalRowsBeforeFilter} distinctCampaignCodes=${[...allDistinctCampaignCodes].length ? [...allDistinctCampaignCodes].join('|') : '(none)'} totalRowsAfterFilter=${finalEntries.length}`);
  return finalEntries;
}

async function fetchReferredUsers() {
  // Stake currently rejects the filtered report for this token/account, so the site
  // must tolerate the report being unavailable without failing the rest of the app.
  const base = { sort: 'createdAtDesc' };
  const names = new Set();
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    let csv;
    try {
      csv = await stakeGet('/referred-users', page === 0 ? base : { ...base, offset });
    } catch (err) {
      if (page === 0) throw err;
      break; // later pages are best-effort
    }
    const rows = parseCsv(csv);
    if (!rows.length) break;
    const ix = columnIndexes(rows[0], ['user'], 'Referred users');
    const before = names.size;
    for (const r of rows.slice(1)) {
      const u = (r[ix.user] || '').trim().toLowerCase();
      if (u) names.add(u);
    }
    const got = rows.length - 1;
    // Only keep paging if the API gave us a full-looking page and we are still finding new names.
    if (got < 100 || names.size === before) break;
    offset += got;
  }
  return names;
}

// Last good data is kept in memory. Real usernames never leave the server.
const state = {
  leaderboard: { entries: [], updatedAt: null, error: null },
  previousLeaderboard: { entries: [], updatedAt: null, error: null },
  referred: { names: new Set(), updatedAt: null, error: null },
};
let refreshing = false;

async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  try {
    const csvFallbackEnabled = USE_CSV_FILES || !fs.existsSync(LEADERBOARD_CSV) || !fs.existsSync(REFERRED_USERS_CSV);
    if (USE_CSV_FILES || csvFallbackEnabled) {
      try {
        readCsvFallbacks(true);
        const leaderboardData = csvFallbackState.leaderboard.data;
        const referredData = csvFallbackState.referred.data;
        if (leaderboardData.length || referredData.size) {
          state.leaderboard.entries = leaderboardData;
          state.leaderboard.updatedAt = csvFallbackState.leaderboard.updatedAt || Date.now();
          state.leaderboard.error = null;
          state.previousLeaderboard.entries = leaderboardData;
          state.previousLeaderboard.updatedAt = csvFallbackState.leaderboard.updatedAt || Date.now();
          state.previousLeaderboard.error = null;
          state.referred.names = referredData;
          state.referred.updatedAt = csvFallbackState.referred.updatedAt || Date.now();
          state.referred.error = null;
          console.log(`[csv-fallback] Loaded local CSV data (leaderboard: ${leaderboardData.length} rows, referred: ${referredData.size} users).`);
          return;
        }
      } catch (err) {
        console.error(`[csv-fallback] Failed to load local CSV data: ${err.message}`);
      }
    }

    for (const [key, fn, label] of [
      ['leaderboard', () => fetchLeaderboard(0), 'Leaderboard'],
      ['previousLeaderboard', () => fetchLeaderboard(-1), 'Previous month leaderboard'],
      ['referred', fetchReferredUsers, 'Referred users'],
    ]) {
      try {
        const data = await fn();
        if (key === 'leaderboard') state.leaderboard.entries = data;
        else if (key === 'previousLeaderboard') state.previousLeaderboard.entries = data;
        else state.referred.names = data;
        state[key].updatedAt = Date.now();
        state[key].error = null;
        console.log(`[stake] ${label} refreshed (${key === 'leaderboard' || key === 'previousLeaderboard' ? data.length + ' rows' : data.size + ' users'}).`);
      } catch (err) {
        const fallbackChanged = readCsvFallbacks(false);
        if (fallbackChanged) {
          state.leaderboard.entries = csvFallbackState.leaderboard.data;
          state.leaderboard.updatedAt = csvFallbackState.leaderboard.updatedAt || Date.now();
          state.leaderboard.error = null;
          state.previousLeaderboard.entries = csvFallbackState.leaderboard.data;
          state.previousLeaderboard.updatedAt = csvFallbackState.leaderboard.updatedAt || Date.now();
          state.previousLeaderboard.error = null;
          state.referred.names = csvFallbackState.referred.data;
          state.referred.updatedAt = csvFallbackState.referred.updatedAt || Date.now();
          state.referred.error = null;
          console.warn(`[stake] ${label} refresh FAILED: ${err.message}. Serving CSV fallback data instead.`);
          continue;
        }
        state[key].error = err.message;
        const keeping = state[key].updatedAt ? 'Still serving last good data.' : 'No data yet.';
        console.error(`[stake] ${label} refresh FAILED: ${err.message} ${keeping}`);
      }
    }
  } finally {
    refreshing = false;
  }
}

// ============================================================
// Storage: local data.json (fine for starting, replace with a real DB before launch)
// ============================================================
let db = { users: [], sessions: {} };
function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db.users = db.users || [];
    db.sessions = db.sessions || {};
    for (const user of db.users) normalizeUserRecord(user);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    console.error(`Cannot read ${DATA_FILE}: ${err.message}. Fix or move the file, then restart.`);
    process.exit(1); // never overwrite a file we could not parse
  }
}
function saveDb() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE);
}

// ============================================================
// Passwords, sessions, rate limiting
// ============================================================
const scrypt = (pw, salt, len, p) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(pw, salt, len, { N: p.N, r: p.r, p: p.p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k)))
  );

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const params = { N: 16384, r: 8, p: 1 };
  const key = await scrypt(pw, salt, 64, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, salt, hash] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const key = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(key, expected);
  } catch { return false; }
}
let DUMMY_HASH; // used so unknown emails take as long as real ones

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const toBase64Url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

function isSecure(req) {
  return process.env.COOKIE_SECURE === '1' || !!req.socket.encrypted ||
    (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
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
  return `sid=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}` + (isSecure(req) ? '; Secure' : '');
}
function cookieFor(req, name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}` + (isSecure(req) ? '; Secure' : '');
}
function startSession(req, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.sessions[sha256(token)] = { userId: user.id, expires: Date.now() + SESSION_MS };
  saveDb();
  return cookieHeader(req, token, SESSION_MS / 1000);
}
function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const s = db.sessions[sha256(token)];
  if (!s || s.expires < Date.now()) return null;
  return db.users.find((u) => u.id === s.userId) || null;
}
function purgeSessions() {
  const now = Date.now();
  let changed = false;
  for (const [k, s] of Object.entries(db.sessions)) if (s.expires < now) { delete db.sessions[k]; changed = true; }
  if (changed) saveDb();
}

const buckets = new Map();
function addHit(key, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
  b.count++;
}
function isBlocked(key, max) {
  const b = buckets.get(key);
  return !!b && b.resetAt > Date.now() && b.count >= max;
}
const retryAfter = (key) => Math.max(1, Math.ceil(((buckets.get(key)?.resetAt || 0) - Date.now()) / 1000));

function clientIp(req) {
  if (TRUST_PROXY) {
    const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]; // the address our proxy saw
  }
  return req.socket.remoteAddress || 'unknown';
}

// ============================================================
// HTTP helpers
// ============================================================
class HttpError extends Error {
  constructor(status, message, headers) { super(message); this.status = status; this.headers = headers; }
}
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://kick.com https://*.kick.com https://images.kick.com; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...headers });
  res.end(JSON.stringify(body));
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
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Bad origin.'); }
  if (host !== req.headers.host) throw new HttpError(403, 'Bad origin.');
}

// ============================================================
// Domain helpers
// ============================================================
const mask = (name) => Array.from(name).slice(0, 2).join('') + '***';
function prizeFor(rank) {
  if (CONFIG.prizes[rank] != null) return CONFIG.prizes[rank];
  const r = CONFIG.prizeRanges.find((x) => rank >= x.from && rank <= x.to);
  return r ? r.amount : null;
}
const isRealLink = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);

function referralStatus(user) {
  const stakeUsername = user && user.stakeUsername ? user.stakeUsername.toLowerCase() : null;
  if (!stakeUsername) return null;
  if (!state.referred.updatedAt) return 'coming_soon';
  return state.referred.names.has(stakeUsername) ? 'found' : 'not_found';
}
function rankOf(user) {
  if (!user || !user.stakeUsername) return null;
  const me = user.stakeUsername.toLowerCase();
  const e = state.leaderboard.entries.find((x) => x.user.toLowerCase() === me);
  return e ? e.rank : null;
}
function mePayload(user) {
  const normalized = normalizeUserRecord(user);
  return {
    email: normalized.email,
    stakeUsername: normalized.stakeUsername,
    google_sub: normalized.google_sub || null,
    kick_id: normalized.kick_id || normalized.kickUserId || null,
    kickUserId: normalized.kick_id || normalized.kickUserId || null,
    kickUsername: normalized.kickUsername,
    kickVerified: !!normalized.kickVerified,
    referral: referralStatus(normalized),
    leaderboardRank: rankOf(normalized),
  };
}

function normalizeUserRecord(user) {
  if (!user || typeof user !== 'object') return user;
  if (user.google_sub == null && user.googleSub != null) user.google_sub = user.googleSub;
  if (user.kick_id == null && user.kickUserId != null) user.kick_id = user.kickUserId;
  if (user.kickUserId == null && user.kick_id != null) user.kickUserId = user.kick_id;
  if (user.google_sub === '') user.google_sub = null;
  if (user.kick_id === '') user.kick_id = null;
  return user;
}

function getUserProviderId(user, provider) {
  normalizeUserRecord(user);
  if (provider === 'google') return user.google_sub || null;
  if (provider === 'kick') return user.kick_id || user.kickUserId || null;
  return null;
}

function setUserProviderId(user, provider, value) {
  const id = value == null || value === '' ? null : String(value).trim();
  if (provider === 'google') {
    user.google_sub = id;
    user.googleSub = id;
  }
  if (provider === 'kick') {
    user.kick_id = id;
    user.kickUserId = id;
  }
  return id;
}

function findUserByProvider(provider, providerId, ignoreUserId = null) {
  const id = providerId == null ? null : String(providerId).trim();
  if (!id) return null;
  return db.users.find((u) => u.id !== ignoreUserId && getUserProviderId(u, provider) === id) || null;
}

async function readKickIdentity(accessToken) {
  const res = await fetch(KICK_USERS_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'NorochanSite/1.0',
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!res.ok) {
    const message = payload?.error || payload?.message || text.slice(0, 160).replace(/\s+/g, ' ');
    throw new Error(`Kick user lookup failed (${res.status}): ${message}`);
  }
  const data = payload && typeof payload === 'object' ? (Array.isArray(payload.data) ? payload.data[0] : (payload.data ?? payload)) : null;
  const user = data && typeof data === 'object' ? (data.user ?? data) : null;
  const kickId = user?.id ?? user?.user_id ?? user?.userId ?? null;
  const username = user?.username ?? user?.name ?? user?.slug ?? null;
  const email = user?.email ?? user?.user?.email ?? null;
  if (!kickId || !username) {
    throw new Error('Kick user identity response did not include a user id and username.');
  }
  return { kickUserId: String(kickId), kickUsername: String(username), email: email ? String(email) : null };
}

function extractKickUser(payload, expectedUsername) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [];
  if (Array.isArray(payload.data)) candidates.push(...payload.data);
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) candidates.push(payload.data);
  if (payload.user && typeof payload.user === 'object') candidates.push(payload.user);
  if (payload.userId && typeof payload.userId === 'object') candidates.push(payload.userId);
  if (payload.results && Array.isArray(payload.results)) candidates.push(...payload.results);
  const normalizedExpected = String(expectedUsername || '').trim().toLowerCase();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const username = String(candidate.username || candidate.slug || candidate.name || '').trim();
    if (!username) continue;
    if (!normalizedExpected || username.toLowerCase() === normalizedExpected) return candidate;
  }
  return candidates[0] || null;
}

class KickViewerTrackingProvider {
  async getMonthlyLeaderboard(period = 'current') {
    const normalized = String(period || 'current').trim().toLowerCase();
    if (!['current', 'previous'].includes(normalized)) {
      throw new Error('Invalid period. Use "current" or "previous".');
    }
    throw new Error(
      'Exact individual viewer watch-time leaderboard cannot currently be calculated from the official KICK API data. ' +
      'The official docs expose public livestream status and channel metadata, but they do not expose a documented per-viewer session/watch-time analytics API or event stream that can identify individual viewers and their session durations.'
    );
  }
}

const kickViewerTrackingProvider = new KickViewerTrackingProvider();

async function fetchKickChannelStatus(channelName = KICK_CHANNEL) {
  const normalized = String(channelName || '').trim();
  if (!normalized) {
    return { status: 'unavailable', channel: '', title: null, viewers: null, thumbnail: null, url: 'https://kick.com', message: 'Kick channel is not configured.' };
  }

  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(normalized)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'NorochanSite/1.0' },
      signal: AbortSignal.timeout(KICK_PUBLIC_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Kick API returned ${res.status}`);
    }

    const payload = await res.json().catch(() => ({}));
    const stream = payload && typeof payload === 'object' && payload.livestream ? payload.livestream : null;
    const isLive = !!(stream && (stream.is_live === true || stream.isLive === true));
    const username = String(payload?.user?.username || payload?.slug || normalized).trim();
    const title = stream && (stream.session_title || stream.title || stream.name || null);
    const viewerCount = stream && Number.isFinite(Number(stream.viewer_count))
      ? Number(stream.viewer_count)
      : (stream && Number.isFinite(Number(stream.viewers)) ? Number(stream.viewers) : null);
    const thumbnail = stream && (stream.thumbnail || stream.thumbnail_url || stream.image || stream.image_url || null)
      || (payload && payload.banner_image && payload.banner_image.url)
      || null;

    return {
      status: isLive ? 'live' : 'offline',
      channel: username,
      title: title || (isLive ? 'Live now' : 'Offline right now'),
      viewers: viewerCount,
      thumbnail: thumbnail || null,
      url: `https://kick.com/${username}`,
      message: isLive ? null : 'Offline right now',
      updatedAt: Date.now(),
    };
  } catch (error) {
    return {
      status: 'unavailable',
      channel: normalized,
      title: null,
      viewers: null,
      thumbnail: null,
      url: `https://kick.com/${normalized}`,
      message: 'Status unavailable',
      updatedAt: Date.now(),
      error: error.message,
    };
  }
}

async function handleGoogleAuth(req, res) {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
  const user = currentUser(req);
  if (!user) {
    res.writeHead(302, { Location: '/#/account' });
    res.end();
    return;
  }
  const googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!googleClientId) {
    res.writeHead(302, { Location: '/#/account?google_error=' + encodeURIComponent('Google sign-in is not configured yet.') });
    res.end();
    return;
  }
  res.writeHead(302, { Location: '/#/account?google_error=' + encodeURIComponent('Google sign-in is enabled in the provider setup flow after this project is configured.') });
  res.end();
}

async function handleKickAuth(req, res) {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
  const user = currentUser(req);
  if (!user) {
    res.writeHead(302, { Location: '/#/account' });
    res.end();
    return;
  }
  if (!KICK_CLIENT_ID) throw new HttpError(500, 'KICK_CLIENT_ID is not configured.');
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = toBase64Url(crypto.randomBytes(32));
  const codeChallenge = toBase64Url(crypto.createHash('sha256').update(verifier).digest());
  const params = new URLSearchParams({
    client_id: KICK_CLIENT_ID,
    redirect_uri: KICK_REDIRECT_URI,
    response_type: 'code',
    scope: 'user:read',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  const location = `${KICK_AUTH_URL}?${params.toString()}`;
  res.writeHead(302, {
    Location: location,
    'Set-Cookie': [
      cookieFor(req, 'kick_oauth_state', state, KICK_OAUTH_TTL_MS / 1000),
      cookieFor(req, 'kick_oauth_verifier', verifier, KICK_OAUTH_TTL_MS / 1000),
    ],
  });
  res.end();
}

async function handleKickCallback(req, res, url) {
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(req);
  const savedState = cookies.kick_oauth_state;
  const verifier = cookies.kick_oauth_verifier;
  if (error) {
    res.writeHead(302, { Location: '/#/account?kick_error=' + encodeURIComponent(String(error)) });
    res.end();
    return;
  }
  if (!code || !state || !savedState || state !== savedState || !verifier) {
    res.writeHead(302, { Location: '/#/account?kick_error=' + encodeURIComponent('Kick login expired or was cancelled.') });
    res.end();
    return;
  }
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: KICK_CLIENT_ID,
    code,
    redirect_uri: KICK_REDIRECT_URI,
    code_verifier: verifier,
  });
  if (KICK_CLIENT_SECRET) tokenBody.set('client_secret', KICK_CLIENT_SECRET);
  const tokenRes = await fetch(KICK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NorochanSite/1.0' },
    body: tokenBody.toString(),
    signal: AbortSignal.timeout(20000),
  });
  const tokenText = await tokenRes.text();
  let tokenPayload = {};
  try { tokenPayload = JSON.parse(tokenText); } catch { tokenPayload = { raw: tokenText }; }
  if (!tokenRes.ok) {
    const message = tokenPayload?.error_description || tokenPayload?.error || tokenText.slice(0, 160).replace(/\s+/g, ' ');
    throw new Error(`Kick token exchange failed (${tokenRes.status}): ${message}`);
  }
  const accessToken = tokenPayload.access_token;
  if (!accessToken) {
    throw new Error('Kick token exchange completed without an access token.');
  }
  const identity = await readKickIdentity(accessToken);
  const user = currentUser(req);
  if (!user) {
    throw new HttpError(401, 'Log in first.');
  }
  const duplicate = findUserByProvider('kick', identity.kickUserId, user.id);
  if (duplicate) throw new HttpError(409, 'That Kick account is already linked to another account.');
  setUserProviderId(user, 'kick', identity.kickUserId);
  user.kickUsername = identity.kickUsername;
  user.kickVerified = true;
  if (identity.email) user.kickEmail = identity.email;
  saveDb();
  res.writeHead(302, {
    Location: '/#/account',
    'Set-Cookie': [
      cookieFor(req, 'kick_oauth_state', '', 0),
      cookieFor(req, 'kick_oauth_verifier', '', 0),
    ],
  });
  res.end();
}

// ============================================================
// API routes
// ============================================================
async function handleApi(req, res, url) {
  if (req.method === 'POST') checkOrigin(req);
  const route = `${req.method} ${url.pathname}`;

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
        supported: false,
        reason: 'Exact individual viewer watch-time and monthly viewer leaderboard cannot be calculated from the official KICK API. The official docs expose livestream status and channel metadata, but not a documented per-viewer session/watch-time analytics API or event stream.',
        docs: 'https://docs.kick.com/',
      },
      links,
      prizes: { ...CONFIG.prizes },
      race: { title: CONFIG.race.title, startsAt: CONFIG.race.startsAt, endsAt: CONFIG.race.endsAt, top: CONFIG.race.top },
    });
  }

  if (route === 'GET /api/kick/leaderboard' || route === 'GET /api/kick/top-viewers') {
    const period = String(url.searchParams.get('period') || 'current').trim().toLowerCase();
    if (!['current', 'previous'].includes(period)) {
      return sendJson(res, 400, { error: 'Invalid period. Use "current" or "previous".' });
    }
    try {
      await kickViewerTrackingProvider.getMonthlyLeaderboard(period);
      return sendJson(res, 200, { period, entries: [] });
    } catch (err) {
      return sendJson(res, 501, {
        ok: false,
        period,
        available: false,
        code: 'KICK_VIEWER_TRACKING_UNSUPPORTED',
        message: err.message,
        docs: 'https://docs.kick.com/',
      });
    }
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
    const user = currentUser(req);
    const me = user && user.stakeUsername ? user.stakeUsername.toLowerCase() : null;
    const mapEntries = (lb) => lb.entries.map((e) => ({
      rank: e.rank,
      name: mask(e.user),
      weighted: Math.round(e.weighted * 100) / 100,
      prize: prizeFor(e.rank),
      you: !!me && e.user.toLowerCase() === me,
    }));
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

  if (route === 'POST /api/signup') {
    const ip = clientIp(req);
    const key = `signup:${ip}`;
    if (isBlocked(key, 10)) throw new HttpError(429, 'Too many sign-ups from this network. Try again later.', { 'Retry-After': retryAfter(key) });
    addHit(key, 60 * 60 * 1000);
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email) || email.length > 254) throw new HttpError(400, 'Enter a valid email address.');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    if (password.length > 128) throw new HttpError(400, 'Password must be 128 characters or fewer.');
    if (db.users.some((u) => u.email === email)) throw new HttpError(409, 'An account with this email already exists. Log in instead.');
    const passwordHash = await hashPassword(password);
    if (db.users.some((u) => u.email === email)) throw new HttpError(409, 'An account with this email already exists. Log in instead.');
    const user = {
      id: crypto.randomUUID(),
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
      stakeUsername: null,
      google_sub: null,
      kick_id: null,
      kickUserId: null,
      kickUsername: null,
      kickVerified: false,
    };
    db.users.push(user);
    saveDb();
    return sendJson(res, 201, { ok: true }, { 'Set-Cookie': startSession(req, user) });
  }

  if (route === 'POST /api/login') {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const ipKey = `login-ip:${clientIp(req)}`;
    const emailKey = `login-email:${email}`;
    for (const [k, max] of [[ipKey, 20], [emailKey, 5]]) {
      if (isBlocked(k, max)) throw new HttpError(429, 'Too many failed log-ins. Try again in a few minutes.', { 'Retry-After': retryAfter(k) });
    }
    const user = db.users.find((u) => u.email === email);
    const ok = password.length <= 128 && (await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH)) && !!user;
    if (!ok) {
      addHit(ipKey, WINDOW_MS);
      addHit(emailKey, WINDOW_MS);
      throw new HttpError(401, 'Wrong email or password.');
    }
    buckets.delete(emailKey);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': startSession(req, user) });
  }

  if (route === 'POST /api/connect-provider') {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Log in first.');
    const body = await readJson(req);
    const provider = String(body.provider || '').trim().toLowerCase();
    const providerId = String(body.providerId || '').trim();
    if (!['google', 'kick'].includes(provider)) throw new HttpError(400, 'Unsupported sign-in method.');
    if (!providerId) throw new HttpError(400, 'Missing provider id.');
    const duplicate = findUserByProvider(provider, providerId, user.id);
    if (duplicate) throw new HttpError(409, `That ${provider === 'google' ? 'Google' : 'Kick'} account is already linked to another account.`);
    setUserProviderId(user, provider, providerId);
    if (provider === 'kick') {
      const kickUsername = String(body.kickUsername || '').trim();
      if (kickUsername) user.kickUsername = kickUsername;
      user.kickVerified = true;
    }
    saveDb();
    return sendJson(res, 200, { ok: true, user: mePayload(user) });
  }

  if (route === 'POST /api/logout') {
    const token = parseCookies(req).sid;
    if (token && db.sessions[sha256(token)]) { delete db.sessions[sha256(token)]; saveDb(); }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
  }

  if (route === 'GET /api/me') {
    const user = currentUser(req);
    return sendJson(res, 200, { user: user ? mePayload(user) : null });
  }

  if (route === 'POST /api/profile') {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Log in first.');
    const body = await readJson(req);
    const stake = String(body.stakeUsername ?? '').trim();
    const hasSavedStake = !!user.stakeUsername;
    if (hasSavedStake) {
      if (stake && stake.toLowerCase() !== user.stakeUsername.toLowerCase()) {
        throw new HttpError(409, 'Stake username is locked after first save. Contact Support to request a change.');
      }
      return sendJson(res, 200, { user: mePayload(user) });
    }
    if (stake && !/^[A-Za-z0-9_.-]{2,40}$/.test(stake)) throw new HttpError(400, 'Stake username can use letters, numbers, _ . - (2 to 40 characters).');
    if (stake && db.users.some((u) => u.id !== user.id && u.stakeUsername && u.stakeUsername.toLowerCase() === stake.toLowerCase())) {
      throw new HttpError(409, 'That Stake username is already linked to another account.');
    }
    user.stakeUsername = stake || null;
    if (!user.kickVerified) {
      const kick = String(body.kickUsername ?? '').trim();
      if (kick && !/^[A-Za-z0-9_-]{2,25}$/.test(kick)) throw new HttpError(400, 'Kick username can use letters, numbers, _ - (2 to 25 characters).');
      if (kick) {
        const duplicateKick = db.users.some((u) => u.id !== user.id && u.kickUsername && u.kickUsername.toLowerCase() === kick.toLowerCase());
        if (duplicateKick) throw new HttpError(409, 'That Kick username is already linked to another account.');
      }
      user.kickUsername = kick || null;
      user.kickVerified = user.kickVerified || false;
    }
    saveDb();
    return sendJson(res, 200, { user: mePayload(user) });
  }

  throw new HttpError(404, 'Not found.');
}

// ============================================================
// Static files
// ============================================================
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { error: 'Bad URL.' }); }
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Forbidden.' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Not found.' });
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC_HEADERS };
    if (process.env.COOKIE_SECURE === '1') headers['Strict-Transport-Security'] = 'max-age=31536000';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/auth/google') return await handleGoogleAuth(req, res);
    if (url.pathname === '/auth/kick') return await handleKickAuth(req, res);
    if (url.pathname === '/auth/kick/callback') return await handleKickCallback(req, res, url);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
    return serveStatic(req, res, url);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message }, err.headers || {});
    console.error('Request error:', err.message);
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong. Try again.' });
    else res.end();
  }
});

// ============================================================
// Start
// ============================================================
async function main() {
  loadDb();
  DUMMY_HASH = await hashPassword('dummy-password-for-timing');
  purgeSessions();
  setInterval(purgeSessions, 60 * 60 * 1000).unref();
  setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.resetAt <= n) buckets.delete(k); }, 10 * 60 * 1000).unref();
  server.listen(PORT, HOST, () => {
    console.log(`Norochan site running at http://localhost:${PORT}`);
    console.log(`Stake API: ${STAKE_BASE} | token set: ${process.env.STAKE_TOKEN ? 'yes' : 'NO (set STAKE_TOKEN, see README)'}`);
  });
  refreshAll();
  setInterval(refreshAll, REFRESH_MS);
  // If the very first fetch failed, retry sooner than the hourly cycle.
  setInterval(() => { if (!state.leaderboard.updatedAt) refreshAll(); }, Math.min(REFRESH_MS, 2 * 60 * 1000));
}
main();
