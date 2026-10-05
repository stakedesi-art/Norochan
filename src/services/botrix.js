'use strict';
// BotRix "Top viewers" leaderboard.
// Official JSON endpoint (BOTRIX_LEADERBOARD_URL) is used when BotRix support issued one.
// Otherwise the server fetches the public channel leaderboard page and parses it.
// Visitors never call BotRix; credentials never leave this process.

const PROVIDER = 'botrix';
const MAX_BODY_BYTES = 1024 * 1024;
const MIN_SYNC_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const WATCH_UNITS = { seconds: 1, minutes: 60, hours: 3600 };
const DEFAULT_PUBLIC_URL = 'https://botrix.live/k/{channel}/leaderboard';
const LIST_KEYS = ['data', 'leaderboard', 'users', 'entries', 'results', 'items', 'viewers'];
const NAME_KEYS = ['username', 'name', 'user_name', 'displayName', 'display_name', 'nick', 'slug'];
const ID_KEYS = ['userId', 'user_id', 'platformId', 'platform_id', 'uid', 'id'];
const AVATAR_KEYS = ['avatar', 'avatarUrl', 'avatar_url', 'profilePic', 'profile_pic', 'image'];
const WATCH_SEC_KEYS = ['watchtimeSeconds', 'watchTimeSeconds', 'watch_seconds'];
const WATCH_KEYS = ['watchtime', 'watchTime', 'watch_time', 'watchTimeFormatted'];
const POINT_KEYS = ['points', 'balance'];
const MESSAGE_KEYS = ['messages', 'msg', 'chat_messages'];
const LEVEL_KEYS = ['level', 'lvl'];
const RANK_KEYS = ['rank', 'position'];

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
function parseEndpoint(raw, vars, name = 'BOTRIX_LEADERBOARD_URL') {
  const value = String(raw || '').trim();
  if (!value) return { url: null, error: null };
  let url;
  try {
    url = new URL(value.replace(/\{(channel|platform)\}/g, (_, k) => encodeURIComponent(vars[k])));
  } catch { return { url: null, error: `${name} is not a valid URL.` }; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    return { url: null, error: `${name} must use https://.` };
  }
  return { url: url.href, error: null };
}
function publicEnabledFromEnv(env) {
  return !['0', 'false', 'off', 'no'].includes(String(env.BOTRIX_PUBLIC == null ? '1' : env.BOTRIX_PUBLIC).trim().toLowerCase());
}

function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWatchtimeToSeconds(v) {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? null : null;
  const s = String(v).trim().toLowerCase().replace(/,/g, '');
  if (!s) return null;
  let sec = 0;
  let matched = false;
  const take = (re, mul) => {
    const m = s.match(re);
    if (!m) return;
    sec += Number(m[1]) * mul;
    matched = true;
  };
  take(/(\d+(?:\.\d+)?)\s*d(?:ays?)?/, 86400);
  take(/(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?/, 3600);
  take(/(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?/, 60);
  take(/(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?(?![a-z])/, 1);
  return matched && Number.isFinite(sec) ? Math.round(sec) : null;
}

function formatWatchtimeDisplay(secs) {
  if (secs == null || !Number.isFinite(Number(secs)) || Number(secs) < 0) return null;
  const totalMin = Math.floor(Number(secs) / 60);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days) return mins ? `${days}d ${hours}h ${mins}min` : `${days}d ${hours}h`;
  if (hours) return `${hours}h ${String(mins).padStart(2, '0')}m`;
  return `${mins}m`;
}

function mapHeader(h) {
  const x = String(h || '').trim().toLowerCase();
  if (!x) return null;
  if (/^(#|pos|position|rank)$/.test(x) || /\b(pos|position|rank)\b/.test(x)) return 'rank';
  if (/\b(name|user|viewer)\b/.test(x) || x === 'username') return 'username';
  if (/watch/.test(x)) return 'watchtime';
  if (/point/.test(x)) return 'points';
  if (/message/.test(x)) return 'messages';
  if (/level/.test(x)) return 'level';
  return null;
}

function looksLikeEntry(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const name = pick(item, NAME_KEYS) ?? (typeof item.user === 'string' ? item.user : undefined) ?? pick(item.user, NAME_KEYS);
  if (name == null || name === '') return false;
  return pick(item, WATCH_KEYS.concat(WATCH_SEC_KEYS, POINT_KEYS, RANK_KEYS)) != null;
}

function findLeaderboardArray(node, depth = 0) {
  if (!node || depth > 8) return null;
  if (Array.isArray(node)) {
    if (node.length && node.some(looksLikeEntry)) return node;
    for (const item of node) {
      const found = findLeaderboardArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  for (const key of LIST_KEYS) {
    if (Array.isArray(node[key]) && node[key].some(looksLikeEntry)) return node[key];
  }
  for (const value of Object.values(node)) {
    const found = findLeaderboardArray(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractJsonBlobs(html) {
  const out = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const body = String(m[1] || '').trim();
    if (!body) continue;
    const candidates = [];
    if (body.startsWith('{') || body.startsWith('[')) candidates.push(body);
    const assign = /=\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*;?\s*$/.exec(body);
    if (assign) candidates.push(assign[1]);
    for (const candidate of candidates) {
      try { out.push(JSON.parse(candidate)); } catch { /* skip non-JSON scripts */ }
    }
  }
  return out;
}

function parseHtmlTables(html) {
  const tables = String(html).match(/<table\b[\s\S]*?<\/table>/gi) || [];
  for (const table of tables) {
    const rows = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
    if (!rows.length) continue;
    const cellsOf = (row) => [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
    const headerCells = cellsOf(rows[0]);
    const headers = headerCells.map(mapHeader);
    if (!headers.includes('username') || !(headers.includes('watchtime') || headers.includes('points') || headers.includes('rank'))) continue;
    const data = [];
    for (const row of rows.slice(1)) {
      const cells = cellsOf(row);
      if (cells.length < 2) continue;
      const item = {};
      headers.forEach((key, i) => { if (key && cells[i] != null && cells[i] !== '') item[key] = cells[i]; });
      if (!item.username) continue;
      if (item.watchtime) {
        const sec = parseWatchtimeToSeconds(item.watchtime);
        if (sec != null) item.watchtimeSeconds = sec;
      }
      data.push(item);
    }
    return data;
  }
  return null;
}

function parseHtmlLeaderboard(html) {
  if (!html || typeof html !== 'string') return null;
  const trimmed = html.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { /* fall through to HTML */ }
  }
  for (const blob of extractJsonBlobs(html)) {
    const list = findLeaderboardArray(blob);
    if (list) return { data: list };
  }
  const tableRows = parseHtmlTables(html);
  return tableRows ? { data: tableRows } : null;
}

class BotrixLeaderboardService {
  constructor({ env = process.env, channel = '', fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    const platform = String(env.BOTRIX_PLATFORM || 'kick').trim().toLowerCase() || 'kick';
    this.channelName = String(env.BOTRIX_CHANNEL || channel).trim() || 'norochan';
    const vars = { channel: this.channelName, platform };
    const endpoint = parseEndpoint(env.BOTRIX_LEADERBOARD_URL, vars, 'BOTRIX_LEADERBOARD_URL');
    const publicOn = publicEnabledFromEnv(env);
    const publicEndpoint = publicOn
      ? parseEndpoint(env.BOTRIX_PUBLIC_URL || DEFAULT_PUBLIC_URL, vars, 'BOTRIX_PUBLIC_URL')
      : { url: null, error: null };
    this.endpoint = endpoint.url;
    this.publicUrl = this.endpoint ? null : publicEndpoint.url;
    this.configError = endpoint.error || (!this.endpoint ? publicEndpoint.error : null);
    this.apiKey = String(env.BOTRIX_API_KEY || '').trim();
    this.apiKeyHeader = String(env.BOTRIX_API_KEY_HEADER || 'Authorization').trim() || 'Authorization';
    const unitEnv = String(env.BOTRIX_WATCHTIME_UNIT || '').trim().toLowerCase();
    this.watchUnit = WATCH_UNITS[unitEnv] || (this.endpoint ? null : WATCH_UNITS.minutes);
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

  get configured() { return !!(this.endpoint || this.publicUrl); }

  ensureStore(db) {
    const s = db.viewerLeaderboard && typeof db.viewerLeaderboard === 'object' ? db.viewerLeaderboard : {};
    if (!s.current || typeof s.current !== 'object' || !Array.isArray(s.current.entries)) s.current = null;
    if (!s.snapshots || typeof s.snapshots !== 'object') s.snapshots = {};
    s.lastError = s.lastError || null;
    s.lastSuccessAt = s.lastSuccessAt || null;
    db.viewerLeaderboard = s;
    return s;
  }

  parseBody(text, { htmlOk }) {
    const trimmed = String(text || '').trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return JSON.parse(trimmed); }
      catch { throw new BotrixError('BotRix returned a response that is not JSON.', 'schema'); }
    }
    if (htmlOk) {
      const parsed = parseHtmlLeaderboard(text);
      if (parsed) return parsed;
      throw new BotrixError('BotRix public page did not include leaderboard data.', 'schema');
    }
    throw new BotrixError('BotRix returned a response that is not JSON.', 'schema');
  }

  async fetchFrom(url, { official }) {
    const headers = {
      Accept: official ? 'application/json' : 'application/json, text/html;q=0.9',
      'User-Agent': 'norochan-site/1.0 (BotRix leaderboard)',
    };
    if (official && this.apiKey) {
      headers[this.apiKeyHeader] = /^authorization$/i.test(this.apiKeyHeader) && !/\s/.test(this.apiKey)
        ? `Bearer ${this.apiKey}`
        : this.apiKey;
    }
    let res;
    try {
      res = await this.fetch(url, {
        headers,
        redirect: official ? 'error' : 'follow',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new BotrixError(err && err.name === 'TimeoutError' ? 'BotRix did not respond in time.' : 'Could not reach BotRix.', 'network');
    }
    if (res.status === 429) throw new BotrixError('BotRix rate limit reached.', 'rate_limit', retryAfterMs(res.headers.get('retry-after')));
    if (official && (res.status === 401 || res.status === 403)) {
      throw new BotrixError(`BotRix rejected the request (status ${res.status}). Check BOTRIX_API_KEY and BOTRIX_API_KEY_HEADER.`, 'auth');
    }
    if (!res.ok) throw new BotrixError(`BotRix returned status ${res.status}.`, 'http');
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) throw new BotrixError('BotRix response was unexpectedly large.', 'schema');
    return this.parseBody(text, { htmlOk: !official });
  }

  async fetchLeaderboard() {
    if (this.endpoint) return this.fetchFrom(this.endpoint, { official: true });
    if (this.publicUrl) return this.fetchFrom(this.publicUrl, { official: false });
    throw new BotrixError('BotRix is not configured.', 'not_configured');
  }

  coerceWatchSeconds(item) {
    const nested = item && item.user && typeof item.user === 'object' ? item.user : null;
    const watchSec = toCount(pick(item, WATCH_SEC_KEYS) ?? pick(nested, WATCH_SEC_KEYS));
    if (watchSec != null) return Math.round(watchSec);
    const raw = pick(item, WATCH_KEYS) ?? pick(nested, WATCH_KEYS);
    if (raw == null || raw === '') return null;
    const fromLabel = parseWatchtimeToSeconds(raw);
    if (fromLabel != null) return fromLabel;
    const n = toCount(raw);
    return n != null && this.watchUnit ? Math.round(n * this.watchUnit) : null;
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
      rows.push({
        providerUserId,
        username,
        avatarUrl: safeAvatar(pick(item, AVATAR_KEYS) ?? pick(user, AVATAR_KEYS)),
        watchTime: this.coerceWatchSeconds(item),
        points: toCount(pick(item, POINT_KEYS)),
        messages: toCount(pick(item, MESSAGE_KEYS)),
        level: toCount(pick(item, LEVEL_KEYS)),
        sourceRank: toCount(pick(item, RANK_KEYS)) ?? index + 1,
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
          messages: e.messages,
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

  publicEntry(e) {
    return {
      rank: e.rank,
      username: e.username,
      watchTime: e.watchTime,
      watchtimeMinutes: e.watchTime != null ? Math.round(e.watchTime / 60) : null,
      watchtimeDisplay: formatWatchtimeDisplay(e.watchTime),
      points: e.points,
      messages: e.messages,
      level: e.level,
      avatar: e.avatarUrl,
    };
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
    const rankedBy = pack ? pack.rankedBy : 'watchTime';
    return {
      period,
      source: PROVIDER,
      channel: this.channelName,
      metric: rankedBy === 'watchTime' ? 'watchtime' : rankedBy,
      interval: pack && pack.final ? 'previous-month-snapshot' : 'current-leaderboard',
      provider: PROVIDER,
      month: target.month,
      year: target.year,
      status,
      stale: failedSinceUpdate,
      updatedAt: pack ? pack.updatedAt : null,
      final: !!(pack && pack.final),
      rankedBy,
      watchTimeAvailable: !!(pack && pack.entries.some((e) => e.watchTime != null)),
      entries: (pack ? pack.entries : []).map((e) => ({
        ...this.publicEntry(e),
        reward: rewardFor(e.rank),
      })),
    };
  }

  getBotrixLeaderboard(store, period = 'current', rewardFor = () => null, at = this.now()) {
    return this.publicPeriod(store, period, rewardFor, at);
  }
}

module.exports = {
  BotrixLeaderboardService,
  BotrixError,
  monthOf,
  previousMonthOf,
  safeAvatar,
  parseHtmlLeaderboard,
  parseWatchtimeToSeconds,
  formatWatchtimeDisplay,
};
