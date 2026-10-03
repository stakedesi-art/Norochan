'use strict';
// Public prize pool / bonus figures. They live in a JSON file (REWARDS_FILE) that the site owner edits
// on the server; the file is re-read whenever it changes, so no restart is needed. Missing or blank
// values are reported as null and the site shows a dash instead of a made-up number.
const fs = require('fs');
const { CONFIG, REWARDS_FILE } = require('../config');
const { prizeFor } = require('./stake');

let cache = { mtimeMs: null, data: {}, error: null };

const money = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function readFile() {
  let stat;
  try { stat = fs.statSync(REWARDS_FILE); }
  catch (err) {
    if (err.code !== 'ENOENT') console.error(`[rewards] Cannot read ${REWARDS_FILE}: ${err.message}`);
    cache = { mtimeMs: null, data: {}, error: null };
    return cache;
  }
  if (stat.mtimeMs === cache.mtimeMs) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(REWARDS_FILE, 'utf8'));
    cache = { mtimeMs: stat.mtimeMs, data: parsed && typeof parsed === 'object' ? parsed : {}, error: null };
  } catch (err) {
    // Keep serving the last good copy while the file is being edited.
    console.error(`[rewards] ${REWARDS_FILE} is not valid JSON: ${err.message}`);
    cache = { ...cache, mtimeMs: stat.mtimeMs, error: 'invalid' };
  }
  return cache;
}

const racePrizeTotal = () => Array.from({ length: CONFIG.race.top }, (_, i) => prizeFor(i + 1)).reduce((sum, amount) => sum + (Number(amount) || 0), 0);

function publicRewards() {
  const { data } = readFile();
  const filePool = money(data.currentPrizePool);
  const fallbackPool = racePrizeTotal();
  return {
    currency: typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency) ? data.currency : 'USD',
    currentPrizePool: filePool != null ? filePool : (fallbackPool > 0 ? fallbackPool : null),
    prizePoolSource: filePool != null ? 'file' : (fallbackPool > 0 ? 'race-config' : null),
    leaderboardPayout: money(data.leaderboardPayout),
    levelUpBonus: money(data.levelUpBonus),
    socialMediaGiveaways: money(data.socialMediaGiveaways),
    note: typeof data.note === 'string' ? data.note.slice(0, 280) : null,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt.slice(0, 40) : null,
  };
}

module.exports = { publicRewards };
