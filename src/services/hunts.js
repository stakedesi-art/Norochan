'use strict';
// Bonus hunts. Connected players submit one Only on Stake slot and it joins the hunt immediately. Staff record the total win and multiplier.
const crypto = require('crypto');
const storage = require('../storage');
const onlyOnStake = require('../data/only-on-stake.json');

const START_BALANCE = 800;
const BET = 0.4;
const SPINS = 50;
const HUNT_STATUSES = new Set(['current', 'previous', 'draft']);
const slotBySlug = new Map();
for (const game of onlyOnStake) {
  if (!game || !game.slug || !game.name) continue;
  slotBySlug.set(String(game.slug).toLowerCase(), {
    slug: String(game.slug),
    name: String(game.name).replace(/\s+/g, ' ').trim(),
  });
}

function ensureStore() {
  if (!Array.isArray(storage.db.bonusHunts)) storage.db.bonusHunts = [];
  for (const hunt of storage.db.bonusHunts) {
    if (!Array.isArray(hunt.entries)) hunt.entries = [];
    if (!Array.isArray(hunt.predictions)) hunt.predictions = [];
    if (hunt.accepting !== false) hunt.accepting = true;
    hunt.startBalance = START_BALANCE;
  }
  return storage.db.bonusHunts;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function money(v, { allowBlank = false, allowNegative = false } = {}) {
  if (v == null || v === '') return allowBlank ? null : undefined;
  const n = Number(v);
  const floor = allowNegative ? -99999999 : 0;
  if (!Number.isFinite(n) || n < floor || n > 99999999) return undefined;
  return round2(n);
}

function cleanDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const parsed = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== s) return undefined;
  return s;
}

function streamTitle(date) {
  const day = cleanDate(date);
  if (!day) return null;
  const formatted = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(day + 'T00:00:00Z'));
  return 'Kick stream on ' + formatted;
}

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function cleanText(v, max) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function findSlot(slug) {
  return slotBySlug.get(cleanText(slug, 120).toLowerCase()) || null;
}

function searchSlots(q) {
  const query = cleanText(q, 40).toLowerCase();
  if (!query) return [];
  const out = [];
  for (const game of slotBySlug.values()) {
    if (game.name.toLowerCase().includes(query) || game.slug.toLowerCase().includes(query)) {
      out.push({ slug: game.slug, name: game.name });
      if (out.length >= 12) break;
    }
  }
  return out;
}

function codeVerifiedOnly() {
  const rules = storage.db.huntRules;
  if (!rules || rules.codeVerifiedOnly == null) return true;
  return rules.codeVerifiedOnly !== false;
}

function eligibility(account) {
  if (!account) return { eligible: false, reason: 'Sign in to enter this hunt.' };
  if (!account.stakeUser) return { eligible: false, reason: 'Connect a Stake username before you enter.' };
  if (codeVerifiedOnly() && account.codeStatus !== 'verified') {
    return { eligible: false, reason: 'Your Stake code has to be verified before you enter.' };
  }
  if (!account.kickName) return { eligible: false, reason: 'Connect your Kick username before you enter.' };
  return { eligible: true, reason: null };
}

function displayMulti(entry) {
  if (!entry) return null;
  if (entry.multi != null) return entry.multi;
  if (entry.result != null) return round2(entry.result / BET);
  return null;
}

function stats(hunt) {
  const entries = hunt.entries || [];
  const called = entries.filter((entry) => entry.result != null);
  const winnings = round2(called.reduce((sum, entry) => sum + entry.result, 0));
  const multis = entries
    .map((entry) => ({ name: entry.slotName, multi: displayMulti(entry) }))
    .filter((row) => row.multi != null);
  const avgMulti = multis.length ? multis.reduce((sum, row) => sum + row.multi, 0) / multis.length : null;
  let best = null;
  for (const row of multis) if (!best || row.multi > best.multi) best = row;
  let biggestWin = null;
  for (const entry of called) if (biggestWin == null || entry.result > biggestWin) biggestWin = entry.result;
  return {
    winnings,
    profit: winnings,
    endBalance: round2(START_BALANCE + winnings),
    avgMulti,
    bestMulti: best ? best.multi : null,
    bestSlot: best ? best.name : null,
    biggestWin,
    opened: called.length,
    total: entries.length,
  };
}

function publicQueue(hunt, summary) {
  return (hunt.entries || [])
    .map((entry, index) => {
      const multi = displayMulti(entry);
      return {
        id: entry.id,
        position: index + 1,
        name: entry.slotName,
        bet: BET,
        result: entry.result,
        multi,
        pending: entry.result == null && entry.multi == null,
        best: multi != null && summary.bestMulti != null && Math.abs(multi - summary.bestMulti) < 0.000001,
      };
    });
}

function rankedPredictions(hunt) {
  const summary = stats(hunt);
  const actualBalance = summary.endBalance;
  const actualMulti = summary.bestMulti;
  return (hunt.predictions || []).map((row) => {
    const balanceGap = Math.abs(row.finalBalance - actualBalance);
    const multiGap = actualMulti == null || row.bestMulti == null ? null : Math.abs(row.bestMulti - actualMulti);
    return {
      id: row.id,
      accountId: row.accountId,
      stakeUser: row.stakeUser,
      kickName: row.kickName,
      finalBalance: row.finalBalance,
      bestMulti: row.bestMulti,
      createdAt: row.createdAt,
      balanceGap: round2(balanceGap),
      multiGap: multiGap == null ? null : round2(multiGap),
    };
  }).sort((a, b) => {
    if (a.balanceGap !== b.balanceGap) return a.balanceGap - b.balanceGap;
    const left = a.multiGap == null ? Number.POSITIVE_INFINITY : a.multiGap;
    const right = b.multiGap == null ? Number.POSITIVE_INFINITY : b.multiGap;
    if (left !== right) return left - right;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

function publicPredictions(hunt) {
  const ranked = rankedPredictions(hunt);
  return ranked.map((row, index) => ({
    id: row.id,
    name: row.stakeUser,
    finalBalance: row.finalBalance,
    bestMulti: row.bestMulti,
    balanceGap: row.balanceGap,
    multiGap: row.multiGap,
    place: index + 1,
    winner: hunt.winnerPredictionId === row.id,
  }));
}

function publicHunt(hunt) {
  const summary = stats(hunt);
  return {
    id: hunt.id,
    title: hunt.title,
    status: hunt.status === 'current' ? 'current' : 'previous',
    startBalance: START_BALANCE,
    bet: BET,
    spins: SPINS,
    endBalance: summary.endBalance,
    streamDate: hunt.streamDate || null,
    streamTitle: streamTitle(hunt.streamDate),
    accepting: hunt.accepting !== false,
    predictions: publicPredictions(hunt),
    prize: hunt.prize,
    winnerName: hunt.winnerName || null,
    winnings: summary.winnings,
    profit: summary.profit,
    avgMulti: summary.avgMulti,
    bestMulti: summary.bestMulti,
    bestSlot: summary.bestSlot,
    biggestWin: summary.biggestWin,
    opened: summary.opened,
    total: summary.total,
    queue: publicQueue(hunt, summary),
    updatedAt: hunt.updatedAt,
  };
}

function ownEntry(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    status: entry.status,
    slug: entry.slug,
    slotName: entry.slotName,
  };
}

function publishedRows() {
  return ensureStore().filter((hunt) => hunt.published);
}

function pageStats(hunts) {
  const scored = hunts.filter((hunt) => hunt.opened > 0);
  if (!hunts.length) return { hunts: 0, profitRate: null, bestMulti: null, bestSlot: null };
  const wins = scored.filter((hunt) => hunt.profit > 0).length;
  let best = null;
  for (const hunt of hunts) {
    if (hunt.bestMulti == null) continue;
    if (!best || hunt.bestMulti > best.bestMulti) best = hunt;
  }
  return {
    hunts: hunts.length,
    profitRate: scored.length ? Math.round((wins / scored.length) * 1000) / 10 : null,
    bestMulti: best ? best.bestMulti : null,
    bestSlot: best ? best.bestSlot : null,
  };
}

function publicBoard(account) {
  const rows = publishedRows().slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const currentRaw = rows.find((hunt) => hunt.status === 'current') || null;
  const previous = rows.filter((hunt) => hunt !== currentRaw).map(publicHunt);
  const mine = currentRaw && account
    ? (currentRaw.entries || []).find((entry) => entry.accountId === account.id) || null
    : null;
  const minePrediction = currentRaw && account
    ? (currentRaw.predictions || []).find((row) => row.accountId === account.id) || null
    : null;
  const gate = eligibility(account);
  return {
    bet: BET,
    startBalance: START_BALANCE,
    spins: SPINS,
    current: currentRaw ? publicHunt(currentRaw) : null,
    previous,
    page: pageStats(previous),
    viewer: {
      eligible: gate.eligible,
      reason: gate.reason,
      entry: ownEntry(mine),
      prediction: minePrediction ? {
        finalBalance: minePrediction.finalBalance,
        bestMulti: minePrediction.bestMulti,
      } : null,
    },
    codeVerifiedOnly: codeVerifiedOnly(),
  };
}

function publicWinners() {
  const items = publishedRows()
    .filter((hunt) => hunt.winnerName && hunt.prize != null)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map((hunt) => ({
      id: hunt.id,
      name: hunt.winnerName,
      prize: hunt.prize,
      huntTitle: hunt.title,
      date: hunt.updatedAt,
      streamTitle: streamTitle(hunt.streamDate),
    }));
  return {
    totalGiven: round2(items.reduce((sum, item) => sum + item.prize, 0)),
    items,
  };
}

function readBody(body, existing) {
  const title = body.title != null ? cleanText(body.title, 120) : (existing ? existing.title : '');
  if (!title) throw bad('Add a hunt title.');
  let prize = existing ? existing.prize : null;
  if (body.prize != null || !existing) {
    prize = money(body.prize, { allowBlank: true });
    if (body.prize != null && body.prize !== '' && prize == null) throw bad('Prize must be 0 or more, or blank.');
  }
  const winnerName = body.winnerName != null
    ? (cleanText(body.winnerName, 40) || null)
    : (existing ? existing.winnerName : null);
  const status = body.status != null ? String(body.status) : (existing ? existing.status : 'draft');
  if (!HUNT_STATUSES.has(status)) throw bad('Status must be current, previous, or draft.');
  const published = body.published != null ? body.published !== false : (existing ? existing.published !== false : true);
  let streamDate = existing ? (existing.streamDate || null) : null;
  if (body.streamDate != null || !existing) {
    streamDate = cleanDate(body.streamDate);
    if (streamDate === undefined) throw bad('Stream day must be a date.');
  }
  return { title, startBalance: START_BALANCE, prize, winnerName, status, published, streamDate };
}

function demoteOthers(id) {
  for (const row of ensureStore()) {
    if (row.id !== id && row.status === 'current') row.status = 'previous';
  }
}

function createHunt(body) {
  const fields = readBody(body || {}, null);
  const row = {
    id: crypto.randomUUID(),
    ...fields,
    entries: [],
    predictions: [],
    winnerPredictionId: null,
    accepting: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (row.published && row.status === 'current') demoteOthers(row.id);
  ensureStore().unshift(row);
  storage.save();
  return row;
}

function updateHunt(id, body) {
  const row = ensureStore().find((hunt) => hunt.id === id);
  if (!row) throw bad('Not found.', 404);
  const fields = readBody(body || {}, row);
  Object.assign(row, fields, { updatedAt: new Date().toISOString() });
  if (!Array.isArray(row.entries)) row.entries = [];
  if (!Array.isArray(row.predictions)) row.predictions = [];
  if (row.published && row.status === 'current') demoteOthers(row.id);
  if (row.status === 'previous') applyWinner(row);
  storage.save();
  return row;
}

function removeHunt(id) {
  const rows = ensureStore();
  const index = rows.findIndex((hunt) => hunt.id === id);
  if (index < 0) throw bad('Not found.', 404);
  rows.splice(index, 1);
  storage.save();
}

function currentOpen() {
  return publishedRows().find((hunt) => hunt.status === 'current') || null;
}

function closeHunt(id) {
  const row = ensureStore().find((hunt) => hunt.id === id);
  if (!row) throw bad('Not found.', 404);
  if (row.status !== 'current') throw bad('Only the current hunt can be closed.');
  row.status = 'previous';
  row.accepting = false;
  row.published = true;
  applyWinner(row);
  row.updatedAt = new Date().toISOString();
  storage.save();
  return row;
}

function setAccepting(id, accepting) {
  const row = ensureStore().find((hunt) => hunt.id === id);
  if (!row) throw bad('Not found.', 404);
  if (row.status !== 'current') throw bad('Only the current hunt can stop entries.');
  row.accepting = accepting !== false;
  row.updatedAt = new Date().toISOString();
  storage.save();
  return row;
}

function submitEntry(account, body) {
  const gate = eligibility(account);
  if (!gate.eligible) throw bad(gate.reason, 403);
  const hunt = currentOpen();
  if (!hunt) throw bad('No bonus hunt is open for entries.', 404);
  if (hunt.accepting === false) throw bad('Slot entries are closed for this hunt.');
  const game = findSlot(body && body.slug);
  if (!game) throw bad('Pick a slot from the Only on Stake list.');
  if (!Array.isArray(hunt.entries)) hunt.entries = [];
  const existing = hunt.entries.find((entry) => entry.accountId === account.id);
  const now = new Date().toISOString();
  if (existing) throw bad('You already have an entry in this hunt.', 409);
  const entry = {
    id: crypto.randomUUID(),
    accountId: account.id,
    stakeUser: account.stakeUser,
    kickName: account.kickName,
    slug: game.slug,
    slotName: game.name,
    result: null,
    multi: null,
    createdAt: now,
    updatedAt: now,
  };
  hunt.entries.push(entry);
  hunt.updatedAt = now;
  storage.save();
  return { entry, created: true };
}

function huntEntry(huntId, entryId) {
  const hunt = ensureStore().find((row) => row.id === huntId);
  if (!hunt) throw bad('Not found.', 404);
  const entry = (hunt.entries || []).find((row) => row.id === entryId);
  if (!entry) throw bad('Not found.', 404);
  return { hunt, entry };
}

function reviewEntry(huntId, entryId, body) {
  const { hunt, entry } = huntEntry(huntId, entryId);
  const source = body || {};
  let result = entry.result;
  let multi = entry.multi;
  if (source.result !== undefined) {
    result = money(source.result, { allowBlank: true, allowNegative: true });
    if (source.result != null && source.result !== '' && result == null) throw bad('Total win must be a number, or blank.');
  }
  if (source.multi !== undefined) {
    multi = money(source.multi, { allowBlank: true, allowNegative: true });
    if (source.multi != null && source.multi !== '' && multi == null) throw bad('Multiplier must be a number, or blank.');
  }
  const now = new Date().toISOString();
  entry.result = result;
  entry.multi = multi;
  entry.updatedAt = now;
  hunt.updatedAt = now;
  storage.save();
  return hunt;
}

function removeEntry(huntId, entryId) {
  const { hunt } = huntEntry(huntId, entryId);
  hunt.entries = hunt.entries.filter((entry) => entry.id !== entryId);
  hunt.updatedAt = new Date().toISOString();
  storage.save();
  return hunt;
}

function applyWinner(hunt) {
  const ranked = rankedPredictions(hunt);
  if (!ranked.length) return hunt;
  hunt.winnerName = ranked[0].stakeUser;
  hunt.winnerPredictionId = ranked[0].id;
  return hunt;
}

function pickWinner(id) {
  const hunt = ensureStore().find((row) => row.id === id);
  if (!hunt) throw bad('Not found.', 404);
  if (!(hunt.predictions || []).length) throw bad('Nobody has predicted this hunt yet.');
  applyWinner(hunt);
  hunt.updatedAt = new Date().toISOString();
  storage.save();
  return hunt;
}

function submitPrediction(account, body) {
  const gate = eligibility(account);
  if (!gate.eligible) throw bad(gate.reason, 403);
  const hunt = currentOpen();
  if (!hunt) throw bad('No bonus hunt is open for predictions.', 404);
  if (hunt.accepting === false) throw bad('Predictions are closed for this hunt.');
  if (!hunt.streamDate) throw bad('The stream day is not set yet.');
  if (!Array.isArray(hunt.predictions)) hunt.predictions = [];
  if (hunt.predictions.some((row) => row.accountId === account.id)) throw bad('You already predicted this hunt.', 409);
  const source = body || {};
  const finalBalance = money(source.finalBalance, { allowNegative: true });
  if (finalBalance == null) throw bad('Predict a final balance.');
  const bestMulti = money(source.bestMulti, { allowNegative: true });
  if (bestMulti == null) throw bad('Predict a biggest multiplier.');
  const now = new Date().toISOString();
  const prediction = {
    id: crypto.randomUUID(),
    accountId: account.id,
    stakeUser: account.stakeUser,
    kickName: account.kickName,
    finalBalance,
    bestMulti,
    createdAt: now,
    updatedAt: now,
  };
  hunt.predictions.push(prediction);
  hunt.updatedAt = now;
  storage.save();
  return { prediction, created: true };
}

function setRules(body) {
  if (!storage.db.huntRules || typeof storage.db.huntRules !== 'object') storage.db.huntRules = {};
  const source = body || {};
  if (source.codeVerifiedOnly != null) storage.db.huntRules.codeVerifiedOnly = source.codeVerifiedOnly !== false;
  storage.save();
  return { codeVerifiedOnly: codeVerifiedOnly() };
}

function listForStaff() {
  return ensureStore().slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

module.exports = {
  START_BALANCE,
  BET,
  SPINS,
  ensureStore,
  searchSlots,
  publicBoard,
  publicWinners,
  createHunt,
  updateHunt,
  removeHunt,
  submitEntry,
  submitPrediction,
  reviewEntry,
  removeEntry,
  pickWinner,
  closeHunt,
  setAccepting,
  codeVerifiedOnly,
  setRules,
  listForStaff,
  ownEntry,
};
