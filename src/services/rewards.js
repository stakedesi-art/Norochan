'use strict';
// Public prize pool / bonus figures. They live in a JSON file (REWARDS_FILE). Staff can set the
// monthly race and Kick viewer pools and place amounts from Studio; the file is also editable by
// hand. Missing or blank values are reported as null so the site shows a dash instead of a made-up number.
const fs = require('fs');
const path = require('path');
const { CONFIG, REWARDS_FILE } = require('../config');

let cache = { mtimeMs: null, data: {}, error: null };

const money = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

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

function requireMoney(v, label) {
  const n = money(v);
  if (n == null) badRequest(label + ' must be a number 0 or greater.');
  return Math.round(n * 100) / 100;
}

function parsePlaceMap(raw, max, label) {
  if (raw == null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) badRequest(label + ' must be an object of rank amounts.');
  const out = {};
  for (let rank = 1; rank <= max; rank++) {
    const v = raw[rank] ?? raw[String(rank)];
    out[rank] = (v == null || v === '') ? null : requireMoney(v, label + ' #' + rank);
  }
  return out;
}

function configRacePrize(rank) {
  if (CONFIG.prizes[rank] != null) return CONFIG.prizes[rank];
  const r = (CONFIG.prizeRanges || []).find((x) => rank >= x.from && rank <= x.to);
  return r ? r.amount : null;
}

function racePrizeFor(rank) {
  const { data } = readFile();
  const places = data.racePrizes && typeof data.racePrizes === 'object' ? data.racePrizes : null;
  if (places && (Object.prototype.hasOwnProperty.call(places, rank) || Object.prototype.hasOwnProperty.call(places, String(rank)))) {
    return money(places[rank] ?? places[String(rank)]);
  }
  return configRacePrize(rank);
}

function viewerRewardFor(rank) {
  const { data } = readFile();
  const places = data.viewerRewards && typeof data.viewerRewards === 'object' ? data.viewerRewards : null;
  const fromFile = places ? money(places[rank] ?? places[String(rank)]) : null;
  if (fromFile != null) return fromFile;
  return CONFIG.viewerRewards && CONFIG.viewerRewards[rank] != null ? CONFIG.viewerRewards[rank] : null;
}

function mapPlaces(max, getter) {
  const out = {};
  for (let i = 1; i <= max; i++) {
    const v = getter(i);
    if (v != null) out[i] = v;
  }
  return out;
}

const raceTop = () => Math.max(1, Math.min(20, Number(CONFIG.race && CONFIG.race.top) || 10));
const racePrizeTotal = () => Array.from({ length: raceTop() }, (_, i) => racePrizeFor(i + 1)).reduce((sum, amount) => sum + (Number(amount) || 0), 0);
const publicRacePrizes = () => mapPlaces(raceTop(), racePrizeFor);
const publicViewerRewards = () => mapPlaces(3, viewerRewardFor);

function writeFile(next) {
  fs.mkdirSync(path.dirname(REWARDS_FILE), { recursive: true });
  const text = JSON.stringify(next, null, 2) + '\n';
  const tmp = REWARDS_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, REWARDS_FILE); }
  catch {
    fs.writeFileSync(REWARDS_FILE, text);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
  cache = { mtimeMs: null, data: {}, error: null };
  return readFile();
}

function publicRewards() {
  const { data } = readFile();
  const filePool = money(data.currentPrizePool);
  const fallbackPool = racePrizeTotal();
  return {
    currency: typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency) ? data.currency : 'USD',
    currentPrizePool: filePool != null ? filePool : (fallbackPool > 0 ? fallbackPool : null),
    prizePoolSource: filePool != null ? 'file' : (fallbackPool > 0 ? 'race-config' : null),
    viewerPrizePool: money(data.viewerPrizePool),
    leaderboardPayout: money(data.leaderboardPayout),
    levelUpBonus: money(data.levelUpBonus),
    socialMediaGiveaways: money(data.socialMediaGiveaways),
    note: typeof data.note === 'string' ? data.note.slice(0, 280) : null,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt.slice(0, 40) : null,
  };
}

function staffRewards() {
  const { data } = readFile();
  const pub = publicRewards();
  return {
    racePrizePool: money(data.currentPrizePool),
    viewerPrizePool: money(data.viewerPrizePool),
    currentPrizePool: pub.currentPrizePool,
    fallbackRacePrizePool: racePrizeTotal(),
    racePrizes: publicRacePrizes(),
    viewerRewards: publicViewerRewards(),
    leaderboardPayout: pub.leaderboardPayout,
    levelUpBonus: pub.levelUpBonus,
    socialMediaGiveaways: pub.socialMediaGiveaways,
    updatedAt: pub.updatedAt,
  };
}

function optionalMoney(v, label) {
  if (v == null || v === '') return null;
  return requireMoney(v, label);
}

function setPrizePools(body) {
  const patch = {};
  if (body && Object.prototype.hasOwnProperty.call(body, 'racePrizePool')) {
    patch.currentPrizePool = requireMoney(body.racePrizePool, 'Wager race prize pool');
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'viewerPrizePool')) {
    patch.viewerPrizePool = requireMoney(body.viewerPrizePool, 'Kick viewer prize pool');
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'racePrizes')) {
    patch.racePrizes = parsePlaceMap(body.racePrizes, raceTop(), 'Race place');
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'viewerRewards')) {
    patch.viewerRewards = parsePlaceMap(body.viewerRewards, 3, 'Kick viewer place');
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'leaderboardPayout')) {
    patch.leaderboardPayout = optionalMoney(body.leaderboardPayout, 'Leaderboard bonuses');
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'levelUpBonus')) {
    patch.levelUpBonus = optionalMoney(body.levelUpBonus, 'Level-up bonuses');
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'socialMediaGiveaways')) {
    patch.socialMediaGiveaways = optionalMoney(body.socialMediaGiveaways, 'Social giveaways');
  }
  if (!Object.keys(patch).length) {
    badRequest('Send a prize pool, place amounts, or bonus totals.');
  }
  const { data, error } = readFile();
  const base = error === 'invalid' || !data ? {} : { ...data };
  writeFile({ ...base, ...patch, updatedAt: new Date().toISOString().slice(0, 10) });
  return staffRewards();
}

module.exports = {
  publicRewards,
  staffRewards,
  setPrizePools,
  viewerRewardFor,
  racePrizeFor,
  publicRacePrizes,
  publicViewerRewards,
};
