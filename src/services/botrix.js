'use strict';
// BotRix "Top viewers" leaderboard.
// BotRix hands out its public leaderboard endpoint (and, for Premium, an API key) on request through
// its Discord support. Nothing is fetched or displayed until BOTRIX_LEADERBOARD_URL is set.

const PROVIDER = 'botrix';
const MAX_BODY_BYTES = 1024 * 1024;
const MIN_SYNC_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const WATCH_UNITS = { seconds: 1, minutes: 60, hours: 3600 };
const LIST_KEYS = ['data', 'leaderboard', 'users', 'entries', 'results', 'items'];
const NAME_KEYS = ['username', 'name', 'user_name', 'displayName', 'display_name', 'nick', 'slug'];
const ID_KEYS = ['userId', 'user_id', 'platformId', 'platform_id', 'uid', 'id'];
const AVATAR_KEYS = ['avatar', 'avatarUrl', 'avatar_url', 'profilePic', 'profile_pic', 'image'];

class BotrixError extends Error {
  constructor(message, kind, retryAfterMs = 0) {
    super(message);
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

const pick = (obj, keys) => {
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  return undefined;
};
const toCount = (v) => {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
function cleanUsername(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s && s.length <= 40 ? s : null;
}
// Must stay in sync with img-src in the site CSP.
function safeAvatar(v) {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'kick.com' || host.endsWith('.kick.com')) ? u.href : null;
  } catch { return null; }
}
function monthOf(ts) {
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
}
function previousMonthOf(ts) {
  const d = new Date(ts);
  return monthOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
}
function retryAfterMs(header) {
  if (!header) return 0;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}
function parseEndpoint(raw, vars) {
  const value = String(raw || '').trim();
  if (!value) return { url: null, error: null };
  let url;
  try {
    url = new URL(value.replace(/\{(channel|platform)\}/g, (_, k) => encodeURIComponent(vars[k])));
  } catch { return { url: null, error: 'BOTRIX_LEADERBOARD_URL is not a valid URL.' }; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    return { url: null, error: 'BOTRIX_LEADERBOARD_URL must use https://.' };
  }
  return { url: url.href, error: null };
}

class BotrixLeaderboardService {
  constructor({ env = process.env, channel = '', fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    const platform = String(env.BOTRIX_PLATFORM || 'kick').trim().toLowerCase() || 'kick';
    const endpoint = parseEndpoint(env.BOTRIX_LEADERBOARD_URL, { channel: String(env.BOTRIX_CHANNEL || channel).trim(), platform });
    this.endpoint = endpoint.url;
    this.configError = endpoint.error;
    this.apiKey = String(env.BOTRIX_API_KEY || '').trim();
    this.apiKeyHeader = String(env.BOTRIX_API_KEY_HEADER || 'Authorization').trim() || 'Authorization';
    this.watchUnit = WATCH_UNITS[String(env.BOTRIX_WATCHTIME_UNIT || '').trim().toLowerCase()] || null;
    this.top = Math.min(100, Math.max(1, Math.floor(Number(env.BOTRIX_TOP)) || 10));
    this.syncMs = Math.max(MIN_SYNC_MS, Number(env.BOTRIX_SYNC_MS) || 15 * 60 * 1000);
    this.timeoutMs = 12000;
    this.maxSnapshots = 24;
    this.fetch = fetchImpl;
    this.now = now;
    this.failures = 0;
    this.retryAfterMs = 0;
    this.syncing = false;
    this.timer = null;
  }

  get configured() { return !!this.endpoint; }

  ensureStore(db) {
    const s = db.viewerLeaderboard && typeof db.viewerLeaderboard === 'object' ? db.viewerLeaderboard : {};
    if (!s.current || typeof s.current !== 'object' || !Array.isArray(s.current.entries)) s.current = null;
    if (!s.snapshots || typeof s.snapshots !== 'object') s.snapshots = {};
    s.lastError = s.lastError || null;
    s.lastSuccessAt = s.lastSuccessAt || null;
    db.viewerLeaderboard = s;
    return s;
  }

  async fetchLeaderboard() {
    if (!this.configured) throw new BotrixError('BotRix is not configured.', 'not_configured');
    const headers = { Accept: 'application/json', 'User-Agent': 'norochan-site/1.0 (BotRix leaderboard)' };
    if (this.apiKey) {
      headers[this.apiKeyHeader] = /^authorization$/i.test(this.apiKeyHeader) && !/\s/.test(this.apiKey)
        ? `Bearer ${this.apiKey}`
        : this.apiKey;
    }
    let res;
    try {
      // redirect: 'error' so the API key is never forwarded to another host.
      res = await this.fetch(this.endpoint, { headers, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new BotrixError(err && err.name === 'TimeoutError' ? 'BotRix did not respond in time.' : 'Could not reach BotRix.', 'network');
    }
    if (res.status === 429) throw new BotrixError('BotRix rate limit reached.', 'rate_limit', retryAfterMs(res.headers.get('retry-after')));
    if (res.status === 401 || res.status === 403) {
      throw new BotrixError(`BotRix rejected the request (status ${res.status}). Check BOTRIX_API_KEY and BOTRIX_API_KEY_HEADER.`, 'auth');
    }
    if (!res.ok) throw new BotrixError(`BotRix returned status ${res.status}.`, 'http');
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) throw new BotrixError('BotRix response was unexpectedly large.', 'schema');
    try { return JSON.parse(text); }
    catch { throw new BotrixError('BotRix returned a response that is not JSON.', 'schema'); }
  }

  normalizeEntries(raw) {
    const list = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' ? LIST_KEYS.map((k) => raw[k]).find(Array.isArray) : null);
    if (!list) throw new BotrixError('BotRix response did not contain a leaderboard list.', 'schema');

    const seen = new Set();
    const rows = [];
    list.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const user = item.user && typeof item.user === 'object' ? item.user : null;
      const username = cleanUsername(pick(item, NAME_KEYS) ?? (typeof item.user === 'string' ? item.user : undefined) ?? pick(user, NAME_KEYS));
      if (!username) return;
      const rawId = pick(user, ID_KEYS) ?? pick(item, ID_KEYS);
      const providerUserId = rawId != null ? String(rawId).slice(0, 64) : null;
      const dedupeKey = providerUserId || username.toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      const watchRaw = toCount(pick(item, ['watchtime', 'watchTime', 'watch_time']));
      rows.push({
        providerUserId,
        username,
        avatarUrl: safeAvatar(pick(item, AVATAR_KEYS) ?? pick(user, AVATAR_KEYS)),
        watchTime: watchRaw != null && this.watchUnit ? Math.round(watchRaw * this.watchUnit) : null,
        points: toCount(pick(item, ['points', 'balance'])),
        level: toCount(pick(item, ['level', 'lvl'])),
        sourceRank: toCount(pick(item, ['rank', 'position'])) ?? index + 1,
      });
    });
    if (list.length && !rows.length) throw new BotrixError('BotRix leaderboard entries had no recognisable usernames.', 'schema');

    const rankedBy = rows.some((e) => e.watchTime != null) ? 'watchTime' : 'botrix';
    rows.sort((a, b) => (rankedBy === 'watchTime'
      ? (b.watchTime ?? -1) - (a.watchTime ?? -1) || (b.points ?? -1) - (a.points ?? -1) || a.sourceRank - b.sourceRank
      : a.sourceRank - b.sourceRank));
    const entries = rows.slice(0, this.top).map(({ sourceRank, ...e }, i) => ({ ...e, rank: i + 1 }));
    return { entries, rankedBy };
  }

  createMonthlySnapshot(store, period) {
    if (!period || !period.key || store.snapshots[period.key]) return;
    store.snapshots[period.key] = { ...period, final: true, capturedAt: period.updatedAt };
    const keys = Object.keys(store.snapshots).sort().reverse();
    for (const k of keys.slice(this.maxSnapshots)) delete store.snapshots[k];
  }

  // Freezes the last data seen in a finished month; never overwrites an existing snapshot.
  rollover(store, at = this.now()) {
    if (store.current && store.current.key !== monthOf(at).key) {
      this.createMonthlySnapshot(store, store.current);
      store.current = null;
      return true;
    }
    return false;
  }

  storeLeaderboard(store, { entries, rankedBy }, at = this.now()) {
    this.rollover(store, at);
    const { year, month, key } = monthOf(at);
    const previous = store.current;
    const firstSeen = new Map((previous ? previous.entries : []).map((e) => [e.id, e.importedAt]));
    store.current = {
      provider: PROVIDER,
      key,
      month,
      year,
      rankedBy,
      importedAt: previous ? previous.importedAt : at,
      updatedAt: at,
      entries: entries.map((e) => {
        const id = `${PROVIDER}:${e.providerUserId || e.username.toLowerCase()}`;
        return {
          id,
          provider: PROVIDER,
          providerUserId: e.providerUserId,
          username: e.username,
          avatarUrl: e.avatarUrl,
          watchTime: e.watchTime,
          points: e.points,
          level: e.level,
          rank: e.rank,
          month,
          year,
          importedAt: firstSeen.get(id) ?? at,
          updatedAt: at,
        };
      }),
    };
    store.lastSuccessAt = at;
    store.lastError = null;
  }

  async syncLeaderboard(store) {
    if (this.syncing) return false;
    this.syncing = true;
    try {
      const normalized = this.normalizeEntries(await this.fetchLeaderboard());
      this.storeLeaderboard(store, normalized, this.now());
      this.failures = 0;
      this.retryAfterMs = 0;
      return true;
    } catch (err) {
      const e = err instanceof BotrixError ? err : new BotrixError('Unexpected BotRix sync failure.', 'internal');
      store.lastError = { kind: e.kind, at: this.now() };
      this.failures++;
      this.retryAfterMs = e.retryAfterMs || 0;
      throw e;
    } finally {
      this.syncing = false;
    }
  }

  nextDelay() {
    if (!this.failures) return this.syncMs;
    const backoff = Math.min(MAX_BACKOFF_MS, this.syncMs * 2 ** Math.min(this.failures - 1, 4));
    return Math.max(backoff, this.retryAfterMs);
  }

  start({ getStore, persist, log = console }) {
    if (!this.configured) return;
    const tick = async () => {
      const store = getStore();
      try {
        await this.syncLeaderboard(store);
        log.log(`[botrix] leaderboard synced: ${store.current ? store.current.entries.length : 0} entries.`);
      } catch (err) {
        log.error(`[botrix] sync FAILED: ${err.message} Retrying in ${Math.round(this.nextDelay() / 60000)} min.`);
      }
      try { persist(); } catch (err) { log.error(`[botrix] could not save leaderboard: ${err.message}`); }
      this.timer = setTimeout(tick, this.nextDelay());
      if (this.timer.unref) this.timer.unref();
    };
    // Snapshot the finished month even if BotRix is unreachable at rollover time.
    const rolloverTimer = setInterval(() => { if (this.rollover(getStore())) persist(); }, 60 * 1000);
    if (rolloverTimer.unref) rolloverTimer.unref();
    tick();
  }

  getCurrentMonthLeaderboard(store, at = this.now()) {
    return store.current && store.current.key === monthOf(at).key ? store.current : null;
  }

  getPreviousMonthLeaderboard(store, at = this.now()) {
    const prev = previousMonthOf(at);
    if (store.snapshots[prev.key]) return store.snapshots[prev.key];
    return store.current && store.current.key === prev.key ? store.current : null;
  }

  publicPeriod(store, period, rewardFor = () => null, at = this.now()) {
    const target = period === 'previous' ? previousMonthOf(at) : monthOf(at);
    const pack = period === 'previous' ? this.getPreviousMonthLeaderboard(store, at) : this.getCurrentMonthLeaderboard(store, at);
    let status = 'ok';
    if (!pack) {
      if (period === 'previous') status = 'empty';
      else status = store.lastError && !store.lastSuccessAt ? 'error' : 'pending';
    }
    const failedSinceUpdate = !!(store.lastError && pack && period === 'current' && store.lastError.at > pack.updatedAt);
    return {
      period,
      provider: PROVIDER,
      month: target.month,
      year: target.year,
      status,
      stale: failedSinceUpdate,
      updatedAt: pack ? pack.updatedAt : null,
      final: !!(pack && pack.final),
      rankedBy: pack ? pack.rankedBy : null,
      watchTimeAvailable: !!(pack && pack.entries.some((e) => e.watchTime != null)),
      entries: (pack ? pack.entries : []).map((e) => ({
        rank: e.rank,
        username: e.username,
        watchTime: e.watchTime,
        points: e.points,
        level: e.level,
        avatar: e.avatarUrl,
        reward: rewardFor(e.rank),
      })),
    };
  }
}

module.exports = { BotrixLeaderboardService, BotrixError, monthOf, previousMonthOf, safeAvatar };
