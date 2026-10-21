'use strict';
// Stake affiliate API client (read-only), local CSV fallback, and the in-memory race leaderboard.
// Last good data is kept in memory. Real usernames never leave the server.
const fs = require('fs');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const {
  CONFIG, STAKE_BASE, STAKE_EXCLUSIVE, ALL_CAMPAIGNS, RACE_CAMPAIGN_CODE, LEADERBOARD_CSV,
} = require('../config');
const { parseCsv, parseNumericCsvValue, normalizeCampaignCode, normHeader } = require('../lib/csv');

class StakeError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

// ============================================================
// Local CSV fallback (src/data/leaderboard.csv downloaded from the Stake dashboard)
// ============================================================
function loadedCsvFallbackState() {
  return {
    leaderboard: { data: [], mtimeMs: null, updatedAt: null },
  };
}

const csvFallbackState = loadedCsvFallbackState();

function parseLeaderboardCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map(normHeader);
  const rankIdx = headers.indexOf('rank');
  const userIdx = headers.indexOf('user_name');
  let weightedIdx = headers.indexOf('total_weighted_amount');
  if (weightedIdx === -1) weightedIdx = headers.indexOf('total_wagered_amount');
  const campaignIdx = headers.indexOf('campaign_code');
  const wageredIdx = headers.indexOf('total_wagered_amount');
  if (rankIdx === -1 || userIdx === -1 || weightedIdx === -1) {
    throw new StakeError(`Leaderboard CSV missing required columns: rank, user_name, total_weighted_amount (found: ${rows[0].join(', ') || 'none'}).`, 'bad_columns');
  }
  const entries = [];
  for (const row of rows.slice(1)) {
    const rank = parseInt(row[rankIdx], 10);
    const user = (row[userIdx] || '').trim();
    const weighted = parseNumericCsvValue(row[weightedIdx]);
    const campaign = campaignIdx === -1 ? null : normalizeCampaignCode(row[campaignIdx]);
    const wageredRaw = wageredIdx === -1 ? NaN : parseNumericCsvValue(row[wageredIdx]);
    if (!user || !Number.isFinite(rank) || !Number.isFinite(weighted)) continue;
    const wagered = Number.isFinite(wageredRaw) ? wageredRaw : null;
    entries.push({ rank, user, weighted, wagered, tickets: ticketsFromWager(wagered), campaign: campaign || null });
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

function readCsvFallbacks(force = false) {
  const files = [
    ['leaderboard', LEADERBOARD_CSV, parseLeaderboardCsv],
  ];
  let changed = false;
  for (const [key, filePath, parser] of files) {
    try {
      const stat = fs.statSync(filePath);
      const mtimeMs = stat.mtimeMs;
      if (force || mtimeMs !== csvFallbackState[key].mtimeMs) {
        const text = fs.readFileSync(filePath, 'utf8');
        csvFallbackState[key].data = parser(text);
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

// ============================================================
// Stake affiliate API
// Native fetch on Node 20+ adds extra Accept-Encoding values that Stake
// answers with 406. http/https.request sends only the headers below.
// Datacenter IPs often get 406 from api.stake.jp; api.stake.com still works.
// ============================================================
const STAKE_FALLBACK_BASES = [
  'https://api.stake.jp/affiliate',
  'https://api.stake.com/affiliate',
];
const STAKE_TIMEOUT_MS = 20000;
const STAKE_RETRY_STATUSES = new Set([406, 502, 503]);
let stickyStakeBase = null;

function normalizeAffiliateBase(raw) {
  let s = String(raw || '').trim().replace(/\/+$/, '');
  s = s.replace(/\/api\/?$/i, '');
  if (/^https:\/\/api\.stake\.(jp|com)$/i.test(s)) return s + '/affiliate';
  return s;
}

function isLoopbackBase(base) {
  try {
    const host = new URL(base).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function stakeBases() {
  const configured = normalizeAffiliateBase(STAKE_BASE);
  if (isLoopbackBase(configured)) return [configured];
  const out = [];
  const seen = new Set();
  for (const base of [stickyStakeBase, ...STAKE_FALLBACK_BASES, configured]) {
    const n = normalizeAffiliateBase(base);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function stakeHeaders(token) {
  return {
    'x-access-token': token,
    Accept: 'text/csv',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en',
    'User-Agent': 'norochan-web/1.0',
  };
}

function decodeStakeBody(res) {
  return new Promise((resolve, reject) => {
    const enc = String(res.headers['content-encoding'] || '').toLowerCase();
    let stream = res;
    if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
    else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function stakeRequest(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'GET',
      headers: stakeHeaders(token),
    }, async (res) => {
      try {
        const body = await decodeStakeBody(res);
        resolve({ status: res.statusCode || 0, body, url: u });
      } catch (err) {
        reject(err);
      }
    });
    req.setTimeout(STAKE_TIMEOUT_MS, () => {
      req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    });
    req.on('error', reject);
    req.end();
  });
}

function isRetryableStakeFailure(err, status) {
  if (STAKE_RETRY_STATUSES.has(status)) return true;
  const code = err && (err.code || err.cause && err.cause.code || err.name);
  return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'AbortError', 'TimeoutError'].includes(String(code));
}

function classifyStakeResponse(status, body) {
  const looksLikeHtml = /^\s*</.test(body);
  if (status === 403 && looksLikeHtml) {
    return new StakeError('Blocked by Cloudflare or wrong host (status 403)', 'blocked');
  }
  if (status === 401 || (status === 403 && !looksLikeHtml)) {
    return new StakeError(`Token rejected (status ${status}). Check STAKE_TOKEN and set STAKE_API_BASE to the correct host if needed.`, 'auth');
  }
  if (status < 200 || status >= 300) {
    return new StakeError(`Stake API returned HTTP ${status}: ${body.slice(0, 200).replace(/\s+/g, ' ')}`, 'http');
  }
  return null;
}

async function stakeGet(pathname, params) {
  const token = process.env.STAKE_TOKEN;
  if (!token) throw new StakeError('STAKE_TOKEN environment variable is not set.', 'no_token');
  const bases = stakeBases();
  let lastErr = null;
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    const url = new URL(base + pathname);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    console.log(`[stake] GET ${url.pathname}${url.search}` + (url.host ? ` host=${url.host}` : ''));
    let result;
    try {
      result = await stakeRequest(url, token);
    } catch (err) {
      lastErr = new StakeError(`Could not reach Stake API (${(err.cause && err.cause.code) || err.code || err.name}).`, 'network');
      if (i < bases.length - 1 && isRetryableStakeFailure(err, 0)) {
        console.warn(`[stake] ${url.host} failed (${err.code || err.name}); trying next host.`);
        continue;
      }
      throw lastErr;
    }
    const err = classifyStakeResponse(result.status, result.body);
    if (!err) {
      stickyStakeBase = base;
      return result.body;
    }
    lastErr = err;
    if (err.kind === 'auth') throw err;
    if (i < bases.length - 1 && isRetryableStakeFailure(err, result.status)) {
      console.warn(`[stake] HTTP ${result.status} from ${url.host}; trying next host.`);
      continue;
    }
    throw err;
  }
  throw lastErr || new StakeError('Could not reach Stake API.', 'network');
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
    const wageredIdx = headers.indexOf('total_wagered_amount');
    if (rankIdx === -1 || userIdx === -1 || weightedIdx === -1) {
      throw new StakeError(`Leaderboard CSV missing required columns: rank, user_name, total_weighted_amount (found: ${rows[0].join(', ') || 'none'}).`, 'bad_columns');
    }
    const pageEntries = [];
    for (const r of dataRows) {
      const rank = parseInt(r[rankIdx], 10);
      const weighted = parseNumericCsvValue(r[weightedIdx]);
      const user = (r[userIdx] || '').trim();
      const campaign = campaignIdx === -1 ? null : normalizeCampaignCode(r[campaignIdx]);
      const wageredRaw = wageredIdx === -1 ? NaN : parseNumericCsvValue(r[wageredIdx]);
      if (!user || !Number.isFinite(rank) || !Number.isFinite(weighted)) continue;
      const wagered = Number.isFinite(wageredRaw) ? wageredRaw : null;
      pageEntries.push({ rank, user, weighted, wagered, tickets: ticketsFromWager(wagered), campaign: campaign || null });
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
  const finalEntries = entries.map((entry, index) => ({ ...entry, rank: index + 1 }));
  console.log(`[leaderboard-refresh] totalRowsBeforeFilter=${totalRowsBeforeFilter} distinctCampaignCodes=${[...allDistinctCampaignCodes].length ? [...allDistinctCampaignCodes].join('|') : '(none)'} totalRowsAfterFilter=${finalEntries.length}`);
  return finalEntries;
}

// ============================================================
// In-memory state + refresh loop
// ============================================================
const state = {
  leaderboard: { entries: [], updatedAt: null, error: null },
  previousLeaderboard: { entries: [], updatedAt: null, error: null },
  wheelPool: {
    current: { period: null, rows: [] },
    previous: { period: null, rows: [] },
  },
  referred: { byUser: {}, updatedAt: null, error: null },
};

function utcMonthKey(offset = 0, now = Date.now()) {
  const d = new Date(now);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

function applyFullList(full, monthKey, stamp) {
  const race = full.slice(0, CONFIG.race.top).map((entry, index) => ({ ...entry, rank: index + 1 }));
  state[monthKey].entries = race;
  state[monthKey].updatedAt = stamp;
  state[monthKey].error = null;
  const slot = monthKey === 'leaderboard' ? 'current' : 'previous';
  const offset = monthKey === 'leaderboard' ? 0 : -1;
  state.wheelPool[slot] = { period: utcMonthKey(offset, stamp), rows: full };
}
let refreshing = false;

async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  try {
    // A downloaded src/data/leaderboard.csv takes priority over the API whenever it has rows.
    try {
      readCsvFallbacks(true);
      const leaderboardData = csvFallbackState.leaderboard.data;
      if (leaderboardData.length) {
        const stamp = csvFallbackState.leaderboard.updatedAt || Date.now();
        applyFullList(leaderboardData, 'leaderboard', stamp);
        applyFullList(leaderboardData, 'previousLeaderboard', stamp);
        console.log(`[csv-fallback] Loaded local CSV data (leaderboard: ${leaderboardData.length} rows).`);
        return;
      }
    } catch (err) {
      console.error(`[csv-fallback] Failed to load local CSV data: ${err.message}`);
    }

    for (const [key, fn, label] of [
      ['leaderboard', () => fetchLeaderboard(0), 'Leaderboard'],
      ['previousLeaderboard', () => fetchLeaderboard(-1), 'Previous month leaderboard'],
    ]) {
      try {
        const data = await fn();
        applyFullList(data, key, Date.now());
        console.log(`[stake] ${label} refreshed (${data.length} rows).`);
      } catch (err) {
        const fallbackChanged = readCsvFallbacks(false);
        if (fallbackChanged) {
          const stamp = csvFallbackState.leaderboard.updatedAt || Date.now();
          applyFullList(csvFallbackState.leaderboard.data, 'leaderboard', stamp);
          applyFullList(csvFallbackState.leaderboard.data, 'previousLeaderboard', stamp);
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
// Race helpers
// ============================================================
const mask = (name) => {
  const chars = Array.from(String(name || ''));
  if (chars.length <= 4) return chars.slice(0, 2).join('') + '***';
  return chars.slice(0, 2).join('') + '***' + chars.slice(-2).join('');
};
const TICKET_WAGER_USD = 1000;
const ticketsFromWager = (wagered) => (Number.isFinite(wagered) && wagered > 0 ? Math.floor(wagered / TICKET_WAGER_USD) : 0);
function prizeFor(rank) {
  return require('./rewards').racePrizeFor(rank);
}

module.exports = { StakeError, state, refreshAll, stakeGet, mask, prizeFor, ticketsFromWager, TICKET_WAGER_USD };
