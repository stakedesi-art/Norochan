'use strict';
// Stake affiliate API client (read-only), local CSV fallback, and the in-memory race leaderboard.
// Last good data is kept in memory. Real usernames never leave the server.
const fs = require('fs');
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
// ============================================================
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

// ============================================================
// In-memory state + refresh loop
// ============================================================
const state = {
  leaderboard: { entries: [], updatedAt: null, error: null },
  previousLeaderboard: { entries: [], updatedAt: null, error: null },
};
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
        state.leaderboard.entries = leaderboardData;
        state.leaderboard.updatedAt = csvFallbackState.leaderboard.updatedAt || Date.now();
        state.leaderboard.error = null;
        state.previousLeaderboard.entries = leaderboardData;
        state.previousLeaderboard.updatedAt = csvFallbackState.leaderboard.updatedAt || Date.now();
        state.previousLeaderboard.error = null;
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
        state[key].entries = data;
        state[key].updatedAt = Date.now();
        state[key].error = null;
        console.log(`[stake] ${label} refreshed (${data.length} rows).`);
      } catch (err) {
        const fallbackChanged = readCsvFallbacks(false);
        if (fallbackChanged) {
          state.leaderboard.entries = csvFallbackState.leaderboard.data;
          state.leaderboard.updatedAt = csvFallbackState.leaderboard.updatedAt || Date.now();
          state.leaderboard.error = null;
          state.previousLeaderboard.entries = csvFallbackState.leaderboard.data;
          state.previousLeaderboard.updatedAt = csvFallbackState.leaderboard.updatedAt || Date.now();
          state.previousLeaderboard.error = null;
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
const mask = (name) => Array.from(name).slice(0, 2).join('') + '***';
function prizeFor(rank) {
  if (CONFIG.prizes[rank] != null) return CONFIG.prizes[rank];
  const r = CONFIG.prizeRanges.find((x) => rank >= x.from && rank <= x.to);
  return r ? r.amount : null;
}

module.exports = { StakeError, state, refreshAll, mask, prizeFor };
