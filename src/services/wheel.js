'use strict';
// Monthly ticket wheel. Public: full Stake names + ticket counts. Draw is automatic at UTC month end.
const crypto = require('crypto');
const storage = require('../storage');
const { CONFIG, WHEEL_EXCLUDE } = require('../config');
const { state, ticketsFromWager, TICKET_WAGER_USD } = require('./stake');
const announce = require('./wheel-announce');

const WINNERS = 3;
const excluded = new Set((WHEEL_EXCLUDE || []).map((n) => String(n).toLowerCase()));

function isExcluded(user) {
  return excluded.has(String(user || '').toLowerCase());
}

function periodKey(offset = 0, now = Date.now()) {
  const d = new Date(now);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

function wheelStartPeriod() {
  const stamp = Number(CONFIG.race && CONFIG.race.startsAt);
  const d = Number.isFinite(stamp) ? new Date(stamp) : new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function periodStarted(period) {
  return String(period || '') >= wheelStartPeriod();
}

function poolRows(slot) {
  if (!slot) return [];
  if (Array.isArray(slot)) return slot;
  return Array.isArray(slot.rows) ? slot.rows : [];
}

function poolForPeriod(period) {
  for (const slot of [state.wheelPool.current, state.wheelPool.previous]) {
    if (slot && !Array.isArray(slot) && slot.period === period) return poolRows(slot);
  }
  if (period === periodKey(0)) return poolRows(state.wheelPool.current);
  if (period === periodKey(-1)) return poolRows(state.wheelPool.previous);
  return [];
}

function ensureStore() {
  if (!storage.db.wheel || typeof storage.db.wheel !== 'object') {
    storage.db.wheel = { prizePool: 50, draws: [] };
  }
  if (!Array.isArray(storage.db.wheel.draws)) storage.db.wheel.draws = [];
  if (storage.db.wheel.prizePool == null || !Number.isFinite(Number(storage.db.wheel.prizePool))) {
    storage.db.wheel.prizePool = 50;
  }
  return storage.db.wheel;
}

function eligibleFrom(pool) {
  return poolRows(pool)
    .map((e) => ({
      user: e.user,
      tickets: e.tickets != null ? e.tickets : ticketsFromWager(e.wagered),
    }))
    .filter((e) => e.user && e.tickets > 0 && !isExcluded(e.user))
    .sort((a, b) => b.tickets - a.tickets || a.user.localeCompare(b.user));
}

function rngFromSeed(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return function next() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function drawWeighted(entries, count, seed) {
  const remaining = eligibleFrom(entries).map((e) => ({ ...e }));
  const winners = [];
  const rand = rngFromSeed(seed);
  const take = Math.min(count, remaining.length);
  for (let n = 0; n < take; n++) {
    const total = remaining.reduce((sum, e) => sum + e.tickets, 0);
    if (total <= 0) break;
    let pick = rand() * total;
    let idx = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      pick -= remaining[i].tickets;
      if (pick < 0) { idx = i; break; }
    }
    winners.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return winners;
}

function publicEntry(e) {
  return { name: e.user, tickets: e.tickets };
}

function splitPrize(total, n) {
  const count = Math.max(0, Number(n) || 0);
  if (!count) return [];
  const cents = Math.max(0, Math.round(Number(total) * 100) || 0);
  const base = Math.floor(cents / count);
  const rem = cents - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < rem ? 1 : 0)) / 100);
}

function withPrizes(winners, total) {
  const shares = splitPrize(total, (winners || []).length);
  return (winners || []).map((w, i) => ({ ...w, prize: shares[i] }));
}

function findDraw(period) {
  return ensureStore().draws.find((d) => d.period === period) || null;
}

function setPrizePool(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0 || n > 99999999) {
    throw Object.assign(new Error('Prize pool must be a number from 0 to 99,999,999.'), { status: 400 });
  }
  ensureStore().prizePool = Math.round(n * 100) / 100;
  storage.save();
  return ensureStore();
}

function publicLastDraw(last) {
  if (!last) return null;
  const winners = withPrizes(last.winners || [], last.prizePool);
  return {
    period: last.period,
    prizePool: last.prizePool,
    winners: winners.map((w) => ({ name: w.user, tickets: w.tickets, prize: w.prize })),
    board: (last.board || []).map((w) => ({ name: w.user, tickets: w.tickets })),
    drawnAt: last.drawnAt,
  };
}

function publicWheel() {
  maybeFinalize();
  const store = ensureStore();
  const currentPeriod = periodKey(0);
  const previousPeriod = periodKey(-1);
  const current = eligibleFrom(poolForPeriod(currentPeriod).length ? poolForPeriod(currentPeriod) : state.wheelPool.current);
  const last = findDraw(previousPeriod);
  return {
    prizePool: store.prizePool,
    prizeEach: splitPrize(store.prizePool, WINNERS)[0] || 0,
    winnersCount: WINNERS,
    ticketUsd: TICKET_WAGER_USD,
    period: currentPeriod,
    nextDrawAt: Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
    entries: current.map(publicEntry),
    lastDraw: last && periodStarted(last.period) ? publicLastDraw(last) : null,
    status: state.leaderboard.updatedAt ? 'ok' : state.leaderboard.error ? 'error' : 'pending',
    stale: !!(state.leaderboard.updatedAt && state.leaderboard.error),
    updatedAt: state.leaderboard.updatedAt,
    totalTickets: current.reduce((sum, e) => sum + e.tickets, 0),
  };
}

function staffWheel() {
  maybeFinalize();
  const store = ensureStore();
  const previousPeriod = periodKey(-1);
  const last = findDraw(previousPeriod);
  const eligible = eligibleFrom(state.wheelPool.current);
  return {
    prizePool: store.prizePool,
    prizeEach: splitPrize(store.prizePool, WINNERS)[0] || 0,
    winnersCount: WINNERS,
    ticketUsd: TICKET_WAGER_USD,
    period: periodKey(0),
    nextDrawAt: Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
    eligibleCount: eligible.length,
    excluded: WHEEL_EXCLUDE,
    lastDraw: last && periodStarted(last.period)
      ? {
        period: last.period,
        seed: last.seed,
        prizePool: last.prizePool,
        winners: withPrizes(last.winners || [], last.prizePool),
        drawnAt: last.drawnAt,
        discord: last.discord
          ? { postedAt: last.discord.postedAt, hasVideo: !!last.discord.hasVideo }
          : null,
      }
      : null,
    discord: { configured: announce.configured() },
  };
}

function maybeFinalize(now = Date.now()) {
  ensureStore();
  const previousPeriod = periodKey(-1, now);
  if (!periodStarted(previousPeriod)) return null;
  const existing = findDraw(previousPeriod);
  if (existing) return existing;
  const pool = poolForPeriod(previousPeriod);
  const hasPool = pool.length > 0 || state.previousLeaderboard.updatedAt || (state.wheelPool.current && state.wheelPool.current.period === previousPeriod);
  if (!hasPool) return null;
  if (!pool.length && !(state.wheelPool.current && state.wheelPool.current.period === previousPeriod) && !state.previousLeaderboard.updatedAt) return null;
  const seed = crypto.randomBytes(16).toString('hex');
  const eligible = eligibleFrom(pool.length ? pool : state.wheelPool.current);
  const winners = drawWeighted(eligible, WINNERS, seed);
  const prizePool = ensureStore().prizePool;
  const row = {
    period: previousPeriod,
    seed,
    prizePool,
    winners: withPrizes(winners.map((w) => ({ user: w.user, tickets: w.tickets })), prizePool),
    board: eligible.map((w) => ({ user: w.user, tickets: w.tickets })),
    drawnAt: new Date(now).toISOString(),
  };
  ensureStore().draws.unshift(row);
  storage.save();
  console.log(`[wheel] closed ${previousPeriod} with ${winners.length} winner(s); pool split equally.`);
  announce.queue(row, now);
  return row;
}

function announcePending(now = Date.now()) {
  const last = ensureStore().draws[0];
  if (last && periodStarted(last.period)) announce.queue(last, now);
}

module.exports = {
  WINNERS, ensureStore, setPrizePool, publicWheel, staffWheel, maybeFinalize, announcePending, drawWeighted, periodKey, isExcluded, splitPrize,
};
