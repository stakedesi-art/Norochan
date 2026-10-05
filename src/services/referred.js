'use strict';
// Official Stake referred-users CSV for the code badge. Not the race top 100.
const { OWNER_CODES } = require('../config');
const { parseCsv, normalizeCampaignCode, normHeader } = require('../lib/csv');
const { stakeGet, StakeError, state } = require('./stake');

state.referred = state.referred || { byUser: {}, updatedAt: null, error: null };

function ownerSet() {
  return new Set((OWNER_CODES || []).map((c) => normalizeCampaignCode(c).toLowerCase()));
}

function isOwnerCode(code) {
  return ownerSet().has(normalizeCampaignCode(code).toLowerCase());
}

function parseReferredCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map(normHeader);
  const userIdx = headers.indexOf('user_name') !== -1 ? headers.indexOf('user_name') : headers.indexOf('username');
  const codeIdx = headers.indexOf('campaign_code') !== -1 ? headers.indexOf('campaign_code') : headers.indexOf('campaign');
  if (userIdx === -1 || codeIdx === -1) {
    throw new StakeError(`Referred-users CSV missing user_name and campaign_code (found: ${rows[0].join(', ') || 'none'}).`, 'bad_columns');
  }
  const out = [];
  for (const row of rows.slice(1)) {
    const user = (row[userIdx] || '').trim();
    const campaign = normalizeCampaignCode(row[codeIdx]);
    if (user && campaign) out.push({ user, campaign });
  }
  return out;
}

async function fetchReferredUsers() {
  const entries = [];
  const seen = new Set();
  for (let page = 0; page < 20; page++) {
    const csv = await stakeGet('/referred-users', { limit: 100, offset: page * 100 });
    const rows = parseReferredCsv(csv);
    for (const row of rows) {
      const key = row.user.toLowerCase() + '|' + row.campaign.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(row);
    }
    if (rows.length < 100) break;
  }
  return entries;
}

async function refreshReferred() {
  try {
    const rows = await fetchReferredUsers();
    const byUser = {};
    for (const row of rows) {
      const key = row.user.toLowerCase();
      if (!byUser[key]) byUser[key] = [];
      const code = normalizeCampaignCode(row.campaign);
      if (!byUser[key].some((c) => c.toLowerCase() === code.toLowerCase())) byUser[key].push(code);
    }
    state.referred = { byUser, updatedAt: Date.now(), error: null };
    console.log(`[stake] Referred-users refreshed (${rows.length} rows).`);
  } catch (err) {
    state.referred = {
      byUser: state.referred.byUser || {},
      updatedAt: state.referred.updatedAt || null,
      error: err.message,
    };
    console.error(`[stake] Referred-users refresh FAILED: ${err.message} Badge will show Unknown until this report is available.`);
  }
}

function codesForUsername(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return [];
  return (state.referred.byUser && state.referred.byUser[key]) || [];
}

function badgeForUsername(name) {
  if (!name) return { codeStatus: 'none', codeMatched: [] };
  if (!state.referred.updatedAt && state.referred.error) {
    return { codeStatus: 'unknown', codeMatched: [] };
  }
  if (!state.referred.updatedAt) return { codeStatus: 'unknown', codeMatched: [] };
  const all = codesForUsername(name);
  const matched = all.filter(isOwnerCode);
  if (matched.length) return { codeStatus: 'verified', codeMatched: matched };
  return { codeStatus: 'not_under_code', codeMatched: [] };
}

module.exports = { refreshReferred, badgeForUsername, codesForUsername, isOwnerCode, parseReferredCsv };
