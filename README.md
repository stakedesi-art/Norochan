# Norochan site

Node 18+ only, no npm packages.

## 1. Edit your settings
Open `server.js` and fill in the `CONFIG` block at the top:
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

## Settings (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `STAKE_TOKEN` | none | Your affiliate token (required for real data) |
| `STAKE_API_BASE` | `https://api.stake.com/affiliate` | API host |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Use `HOST=0.0.0.0` on a server |
| `COOKIE_SECURE` | off | Set `1` once you serve over HTTPS |
| `TRUST_PROXY` | off | Set `1` behind a reverse proxy (reads X-Forwarded-For/Proto) |
| `DATA_FILE` | `./data.json` | Where users are stored |
| `REFRESH_MS` | `3600000` | Stake refresh interval |

## KICK API limitation: exact viewer watch-time leaderboard is not officially supported
The official KICK public docs provide OAuth 2.1 flows, public channel/livestream endpoints, and webhook event payloads for chat, follows, subscriptions, rewards, and livestream status. They do not provide an official documented endpoint or webhook for:
- individual viewer identity per live session
- viewer join/leave events with precise duration
- per-user watch time analytics
- monthly top viewer leaderboard by accumulated watch time

This means the requirement “Top Viewers / Monthly Viewer Leaderboard by verified watch time” is blocked by the official KICK API as currently documented. The app now exposes that limitation through the API instead of inventing fake viewer stats.

Official KICK docs:
- https://docs.kick.com/
- https://docs.kick.com/getting-started/generating-tokens-oauth2-flow.md
- https://docs.kick.com/apis/channels.md
- https://docs.kick.com/apis/livestreams.md
- https://docs.kick.com/events/event-types.md
- https://docs.kick.com/events/webhook-security.md

## Before putting it online
1. HTTPS: put it behind Caddy, nginx or your host's TLS, then set `COOKIE_SECURE=1` and `TRUST_PROXY=1`.
2. Move `data.json` to a real database (SQLite or Postgres) and back it up. `data.json` is rewritten on every change and has no locking across multiple server processes.
3. Add password reset and email verification (needs an email service).
4. Remember that a Stake username is self-claimed. The "(you)" highlight and "found under code" check do not prove ownership, so do not pay prizes based on them alone.
5. Run one instance only (rate limits and data are in one process).
6. Check the rules for affiliate/gambling advertising in your country and on each platform you post on.
7. Hosting: a small VPS (Hetzner, DigitalOcean, Vultr) with Caddy is the simplest fit for this app. Render, Railway or Fly.io also work if you add a persistent volume or a database.
