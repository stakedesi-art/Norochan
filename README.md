# Norochan site

Node 18+ only, no npm packages.

## 1. Edit your settings
Open `src/config.js` and fill in the `CONFIG` block at the top:
- `links`: replace each `PASTE_..._HERE` with the full link (starting with `https://`). Links still containing the placeholder show as "coming soon" buttons.
- `prizes` / `prizeRanges`: only 1st place ($65,000) is filled in. Add the rest, for example `prizes: { 1: 65000, 2: 20000 }` and `prizeRanges: [{ from: 11, to: 20, amount: 100 }]`.

## 2. Set your Stake token (in your terminal, never in a file or in chat)

macOS / Linux (type or paste when prompted, it stays hidden):
```
read -s STAKE_TOKEN; export STAKE_TOKEN
node server.js
```
Windows PowerShell:
```
$env:STAKE_TOKEN = Read-Host "Paste Stake token"
node server.js
```
Windows cmd:
```
set STAKE_TOKEN=paste-token-here
node server.js
```
The variable only lives in that terminal window. Open http://localhost:3000.

If the terminal prints `Stake rejected the token (HTTP 401/403)`, the API host may differ for stake.jp. Set `STAKE_API_BASE` to the correct host (same way as above, for example `export STAKE_API_BASE=https://...`). The default is `https://api.stake.com/affiliate`.

## Try it without a token
```
node test/mock-stake.js                      # terminal 1: fake Stake API
STAKE_API_BASE=http://localhost:4000 STAKE_TOKEN=test node server.js   # terminal 2
```
Run the automated checks with `node test/smoke.js`.

## Project layout
```
server.js              entry point (node server.js)
src/
  server.js            startup: load data, timers, listen
  config.js            CONFIG block + environment variables
  router.js            GET/HEAD only: /api/* or static files
  lib/                 http helpers and CSV parser
  storage/             data store (index.js picks the driver; file-store.js = data.json)
  services/            stake, kick (live status), botrix, viewers, rewards
  routes/              api.js, static.js
  public/              the website (HTML, JS, CSS, fonts, images)
  data/                optional Stake CSV fallback + rewards.example.json
test/                  smoke tests + mock Stake/BotRix servers
scripts/               debug-stake.js, migrations/001-remove-accounts.js
deploy/lightsail/      Caddyfile, systemd unit, setup script for AWS Lightsail
docs/                  design notes, AWS_DEPLOYMENT.md, AUTH_REMOVAL_REPORT.md
```

## Settings (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `STAKE_TOKEN` | none | Your affiliate token (required for real data) |
| `STAKE_API_BASE` | `https://api.stake.com/affiliate` | API host |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Use `HOST=0.0.0.0` on a server |
| `HSTS` | off | Set `1` once you serve over HTTPS (`COOKIE_SECURE=1` still works as the old name) |
| `DATA_FILE` | `src/data.json` | BotRix snapshots (keep it outside the code folder on a server) |
| `REWARDS_FILE` | `src/data/rewards.json` | Public prize pool and total bonuses (edit this file; no admin UI) |
| `REFRESH_MS` | `3600000` | Stake refresh interval |
| `KICK_CHANNEL_USERNAME` | `norochan` | Public Kick channel for live/offline status |
| `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` | none | Kick OAuth. Enables **Connect Kick** on Account and Kick sign-in |
| `KICK_REDIRECT_URI` | `{BASE_URL}/auth/kick/callback` | Must match a redirect URL in the Kick developer app. Localhost uses `http://localhost:PORT/auth/kick/callback` automatically |
| `BOTRIX_LEADERBOARD_URL` | none | Optional issued BotRix JSON endpoint. If unset, the public leaderboard page is fetched server-side |
| `BOTRIX_API_KEY` / `BOTRIX_API_KEY_HEADER` | none / `Authorization` | Key from BotRix, if they issue one. Server-side only |
| `BOTRIX_PUBLIC` / `BOTRIX_PUBLIC_URL` | `1` / `https://botrix.live/k/{channel}/leaderboard` | Public page fallback. Set `BOTRIX_PUBLIC=0` to disable |
| `BOTRIX_WATCHTIME_UNIT` | `minutes` on public fallback, else none | `seconds`, `minutes` or `hours`; empty hides numeric watch time from JSON |
| `BOTRIX_TOP` / `BOTRIX_SYNC_MS` | `10` / `900000` | Rows shown / sync interval (min 5 min) |

All variables are listed with placeholders in `.env.example`.

There is no public Admin panel. Visitors sign in from **Account** with email + password (Google/Kick if those env vars are set). After email signup a confirmation link is sent via Gmail (`GMAIL_USER` + `GMAIL_APP_PASSWORD`). They can **Connect Kick** on Account (same Kick app credentials). They type their Stake username and pick a referral code; norochan / divu / ipl2026 / deepu wait for staff, any other code is stored as not under code. Studio **Users** lists email, Stake username, code status (Verified / Not under code), and Kick username. Prize pool figures still come from `REWARDS_FILE`. If an old `data.json` still has `users` / `sessions` / `auditLog`, stop the site and run `npm run migrate` — that cleanup does not delete Phase 3 `accounts`.

## Prize pool and bonuses
Copy `src/data/rewards.example.json` to `src/data/rewards.json` (or the `REWARDS_FILE` path on the server) and fill in:

```
{
  "currency": "USD",
  "currentPrizePool": 500,
  "leaderboardPayout": null,
  "levelUpBonus": null,
  "socialMediaGiveaways": null,
  "note": "Paid weekly.",
  "updatedAt": "4 Oct 2026"
}
```

`currentPrizePool` is the figure on the Rewards header. The three payout fields appear in the “Bonuses given” list at the bottom of that section. Leave a number `null` to show a dash. The site re-reads the file when it changes, so no restart is needed. There is no dashboard for this.

## BotRix Top viewers leaderboard
The "Top viewers" card ranks Kick viewers by BotRix watch time. Current standings come from BotRix; previous month is a snapshot the site froze at month end. BotRix itself does not publish a history endpoint.

**Setup**
1. Restart the site. By default the server fetches `https://botrix.live/k/norochan/leaderboard` every 15 minutes and caches the result in `data.json`.
2. If BotRix support issued a JSON endpoint and key, set `BOTRIX_LEADERBOARD_URL` (and `BOTRIX_API_KEY`, `BOTRIX_WATCHTIME_UNIT` if applicable). That official source is used instead of the public page.
3. Set `BOTRIX_PUBLIC=0` to turn the board off until an issued endpoint is configured.
4. Reset BotRix rankings at the start of each month if you want "Current" to mean this calendar month. BotRix totals are cumulative since the last reset.

**How it works**: the Node process syncs on a timer and stores results in `data.json` under `viewerLeaderboard`. Visitors read `GET /api/viewers/current`, `GET /api/viewers/previous`, or `GET /api/botrix/leaderboard`. They never call BotRix. Failures keep the last good snapshot. Keys never leave the server.

**Limitations**: BotRix only counts watch time for viewers active in chat; there is no BotRix history API; the public page may be blocked by Cloudflare, in which case the last snapshot stays on screen. No data is ever estimated or invented.

## KICK API limitation: exact viewer watch-time leaderboard is not officially supported
The official KICK public docs provide OAuth 2.1 flows, public channel/livestream endpoints, and webhook event payloads for chat, follows, subscriptions, rewards, and livestream status. They do not provide an official documented endpoint or webhook for:
- individual viewer identity per live session
- viewer join/leave events with precise duration
- per-user watch time analytics
- monthly top viewer leaderboard by accumulated watch time

This means a Kick-verified watch-time leaderboard is not possible with the official KICK API. The Top viewers board therefore uses BotRix (see above), and shows an honest empty state until BotRix is configured.

Official KICK docs:
- https://docs.kick.com/
- https://docs.kick.com/getting-started/generating-tokens-oauth2-flow.md
- https://docs.kick.com/apis/channels.md
- https://docs.kick.com/apis/livestreams.md
- https://docs.kick.com/events/event-types.md
- https://docs.kick.com/events/webhook-security.md

## Before putting it online
Hosting target is AWS Lightsail; step-by-step guide in `docs/AWS_DEPLOYMENT.md`, server files in `deploy/lightsail/`.

1. HTTPS: put it behind Caddy, nginx or your host's TLS, then set `HSTS=1`.
2. Keep `data.json` and `rewards.json` outside the code folder (`DATA_FILE`, `REWARDS_FILE`) and back them up. `data.json` is rewritten on every BotRix sync and has no locking across multiple server processes. A Postgres driver (Lightsail managed database or RDS) can replace it later through `src/storage/`.
3. Run one instance only (the data file lives in one process).
4. Check the rules for affiliate/gambling advertising in your country and on each platform you post on.