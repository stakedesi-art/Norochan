# UI redesign plan — Norochan

Presentation-only redesign (historical). Visitor accounts, login, and the admin panel were later removed; see `docs/AUTH_REMOVAL_REPORT.md`. Kick live status, Stake leaderboard, and BotRix top viewers stayed.

## Architecture

Zero-dependency Node 18+ server (`src/server.js`, entry `server.js`). Static front end in `src/public`: `index.html`, `app.js` (hash router and views), `ui.js` (shared builders), `css/tokens.css`, `css/components.css`, `style.css`. No framework, no bundler. CSP is `style-src 'self'`, so fonts are self-hosted.

## Routes and data

| Surface | Source | What it shows |
|---|---|---|
| `#/` home | `GET /api/config`, `GET /api/rewards`, `GET /api/kick-live`, `GET /api/leaderboard`, `GET /api/viewers/*` | Hero, Kick live, top viewers, wager preview, prize pool, bonuses, socials |
| `#/leaderboard` | `GET /api/leaderboard` | One board, current and previous month, podium + rows |
| `#/rewards`, `#/streams`, `#/community` | Same home view | In-page sections, not new APIs |

`GET /api/kick/top-viewers` (alias of `/api/viewers/:period`) serves BotRix data once configured, and returns 501 with an honest empty state until then. Watch hours are never invented.

Real home metrics only: prize pool, paid places, season window. Community size, stream hours, and viewer totals are not in the API, so they are not displayed.

The Stake board metric is weighted wager plus prize. It is not labeled as watch time.

## What stays

Server logic, leaderboard weighting, prize calculation, Kick live polling, month tabs, copy-code, theme toggle, mobile drawer, and masked names.

## Visual system

Luxury dark creator site, original to Norochan. Reference is inspiration only.

- Canvas `#07060A`, secondary `#0C0A11`, cards `#111019`, elevated `#15131D`
- Borders `rgba(255,255,255,0.07)`
- Accent `#7C5CFF` / `#8B6CFF` / `#A78BFA`, used sparingly
- Type: Plus Jakarta Sans, self-hosted
- Floating translucent nav, wide measure (~1280px), large section rhythm
- Rank 1–3 are quieter metal highlights, not cartoon medals

## Nav

Center: Home, Leaderboard, Rewards, Streams, Community, Support. Right: Kick status, Discord, theme. Rewards, Streams, and Community scroll to home sections.
