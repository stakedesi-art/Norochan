# BotRix Top Viewers Leaderboard: integration plan

Researched October 2026. Sources: the official BotRix documentation (https://botrix.live/docs/, "For Developers" section), the BotRix terms (Spanish, same docs), https://botrix.live/robots.txt, BotRix staff answers in their help/Discord channels, and the official Kick API docs (https://docs.kick.com/).

## 1. What BotRix officially offers

| Capability | Available? | Notes |
|---|---|---|
| Public leaderboard endpoint | Yes, on request | The docs list "Fetch the current leaderboard data" as a basic public endpoint. The URL and usage details are **not published**; they are given out through the public support channel in the BotRix Discord (https://discord.gg/aphsbfD). |
| API key / management endpoints | Premium only | Querying or changing loyalty points per user and other beta endpoints need a Premium role and a Premium support ticket. The key is issued by the BotRix team. |
| Webhooks | No | Not mentioned anywhere in the docs. |
| Data export (CSV etc.) | No | Not offered. |
| OAuth for third-party apps | No | BotRix uses OAuth only to log streamers in with Kick/Twitch/etc. |
| Embeddable widgets | OBS only | Widgets are configured on the BotRix site for streaming software. Custom CSS/JS widgets are "upcoming". There is no documented web embed for a site. |
| Watch time | Yes, tracked by BotRix | BotRix staff state watch time only accrues for viewers who are **active in chat**. It is BotRix's metric, not a Kick-verified one. |
| Points / levels | Yes | Loyalty points and levels per viewer. |
| Historical / monthly data | No | The endpoint returns the **current** leaderboard (totals since the streamer last reset rankings in BotRix). There is no history endpoint. |
| Rate limits | Not published | "Reasonable usage" is covered. High-volume use (very large channels or requests every few seconds) may carry an extra fee agreed with BotRix. |
| Response format | Not published | Field names and units must be confirmed once access is granted. |

Restrictions:
- `robots.txt` disallows `/api`, `/sync`, `/widgets*` and `/alerts*` for automated clients. The internal API behind botrix.live must not be called without permission, and the public leaderboard page (botrix.live/k/{channel}/leaderboard) must not be scraped.
- The BotRix terms require compliance with each streaming platform's terms.
- The official Kick API has no per-viewer watch time (only a KICKs gift leaderboard), so BotRix is the only supported source.

## 2. Conclusion

An official method exists: the BotRix public leaderboard endpoint, issued on request. It cannot be used until the channel owner requests it from BotRix support. This site is therefore built to stay **off by default** and to switch on as soon as the endpoint (and key, if BotRix issues one) is placed in environment variables. Until then the "Top viewers" section shows an honest "coming soon" state. No scraping, no guessed endpoints, no placeholder data.

## 3. Recommended approach (implemented)

1. Channel owner asks in the BotRix Discord public support channel for the public leaderboard endpoint for the Kick channel `norochan`. Ask them to confirm: the URL, whether a key is needed and which header carries it, the watch-time unit, the response fields, and acceptable polling frequency.
2. Put the values in environment variables (see `.env.example`).
3. The server polls BotRix on a timer (default every 15 minutes, never faster than every 5), keeps the last good result, and serves visitors only from its own stored copy. Visitors never trigger BotRix requests.
4. Monthly history is built by the site itself: the last data seen in each month is frozen as that month's final snapshot and served as "Previous month".

### Monthly behaviour, and what it depends on

BotRix totals are cumulative since the streamer's last ranking reset. For "Current month" to mean this month, the streamer should **reset BotRix rankings at the start of each month** (BotRix dashboard). The site snapshots the final standings automatically; it never subtracts or estimates numbers.

## 4. Architecture

- `src/services/botrix.js` exports `BotrixLeaderboardService`, which provides:
  - `fetchLeaderboard()`: HTTPS GET with a 12 s timeout. It refuses redirects, so the key is never forwarded elsewhere, and caps the response at 1 MB.
  - `normalizeEntries()`: tolerant field mapping, validation, de-duplication, ranking and a top-N cut.
  - `storeLeaderboard()`, `createMonthlySnapshot()` and `rollover()`: storage and monthly freezing.
  - `syncLeaderboard()`: fetch, normalise and store.
  - `getCurrentMonthLeaderboard()`, `getPreviousMonthLeaderboard()` and `publicPeriod()`: read side.
- Storage: there is no database or ORM in this project; everything lives in `data.json`. The leaderboard sits under `viewerLeaderboard`:
  - `current`: `{ provider, key: "YYYY-MM", month, year, rankedBy, importedAt, updatedAt, entries[] }`
  - `snapshots["YYYY-MM"]`: the same shape plus `final: true` and `capturedAt`. The newest 24 months are kept.
  - Each entry has the fields `id`, `provider`, `providerUserId`, `username`, `avatarUrl`, `watchTime` (seconds), `points`, `level`, `rank`, `month`, `year`, `importedAt` and `updatedAt`.
  - The `YYYY-MM` key is the month index. A snapshot is written once and never overwritten.
- API:
  - `GET /api/viewers/current` and `GET /api/viewers/previous` return `{ period, month, year, status, stale, updatedAt, final, watchTimeAvailable, entries: [{ rank, username, watchTime, points, level, avatar, reward }] }`.
  - The existing `GET /api/kick/top-viewers?period=` returns the same data.
  - `/api/leaderboard` was left untouched because it is the Stake wager race.
  - When BotRix is not configured, these routes return `501` with `available: false`.
- UI: the existing "Top viewers" card on the leaderboard page. It uses the shared Current/Previous month tabs, a top-3 podium with avatar glow, ranked rows, and loading, empty, error and stale states.

## 5. Error handling

| Situation | Behaviour |
|---|---|
| Not configured / invalid URL | Feature off, "coming soon" in the UI, a clear startup log line |
| Timeout or network failure | Last good data kept and flagged `stale`; exponential backoff up to 1 h |
| 401/403 | Logged with a hint to check the key/header; last good data kept |
| 429 | Waits at least `Retry-After`, plus backoff |
| Unexpected response shape | Rejected as a schema error, nothing stored, last good data kept |
| No previous-month snapshot yet | `status: "empty"`, honest empty state |
| Server down across month end | A once-a-minute rollover check freezes the last data seen as soon as it is back |

## 6. Security

- Secrets (`BOTRIX_API_KEY`) live only in environment variables. They are never logged, never stored in `data.json`, and never sent to the browser.
- The endpoint URL is never logged either, in case it embeds a token.
- Only `https://` endpoints are accepted (plain `http` only for localhost tests).
- Usernames are length-capped and control-character-stripped, and they are rendered as text, never HTML.
- Avatars are only passed through when hosted on `kick.com` / `*.kick.com` (matches the site CSP). Anything else falls back to initials.
- No new CSP sources and no third-party scripts.

## 7. Limitations to communicate

- Watch time is BotRix's own measure and only counts chat-active viewers. It is not Kick-verified total viewing time.
- Exact field names and the watch-time unit are unknown until BotRix shares the endpoint. The normaliser accepts the common shapes. If watch-time unit isn't configured, the board ranks by BotRix's order and shows points instead of inventing hours.
- Monthly accuracy depends on monthly ranking resets in BotRix, as explained above.
- Snapshots are taken from the last successful sync of the month, so they are at most one sync interval old.
