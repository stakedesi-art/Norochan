# Auth removal report

The site is a public creator page. Visitor accounts, login, signup, OAuth linking, and the admin panel are gone. Kick live status, BotRix top viewers, the Stake wager leaderboard, and the file-based prize/bonus figures stay.

This is a zero-dependency Node app with a JSON file, not an ORM. There were never SQL tables. The old visitor store lived as keys in `data.json`.

## What was removed

### Public login / signup / sessions
- Pages and hash routes: `#/account`, `#/admin`
- Navigation: Log in, Account, Admin, Logout (desktop, mobile, footer)
- API: `POST /api/signup`, `POST /api/login`, `POST /api/logout`, `GET /api/me`, `POST /api/profile`, `POST /api/connect-provider`
- OAuth: `GET /auth/google`, `GET /auth/kick`, `GET /auth/kick/callback`
- Modules: `src/routes/auth.js`, `src/routes/admin.js`, `src/public/admin.js`, `src/public/css/admin.css`
- Services: `src/services/users.js`, `src/services/sessions.js`, `src/services/audit.js`, `src/services/roles.js`
- Password / cookie / rate-limit helper: `src/lib/security.js` (scrypt, session cookies, dummy hash, `TRUST_PROXY` client IP)
- HTTP helpers used only by POST auth: `readJson`, `checkOrigin`
- Frontend account form, Kick/Google connect UI, `you` row on the wager board, referral-status check against Stake referred users
- Stake referred-users fetch (only existed so logged-in visitors could see "found under the code")
- Design notes that described an admin panel (`docs/ADMIN_PANEL_PLAN.md`)

### Email OTP / verification
Never existed. No OTP generation, no verify-email pages, no resend flow, no email library.

### Password reset
Never existed. No forgot-password, reset tokens, or reset emails. Public password hashing (`hashPassword` / `verifyPassword`) is gone with the account system.

### Google / Kick / Discord login
- Google sign-in was a placeholder redirect, not a working OAuth flow. Removed.
- Kick OAuth (PKCE, token exchange, account linking) removed.
- Discord was never used as a login. The public Discord community link is unchanged.

### Admin panel
Removed entirely: `#/admin`, `/api/admin/*`, roles, staff UI, audit log viewer, IP listing, role/status changes, session revoke. Prize pool and bonuses are edited in a JSON file, not in a dashboard.

## Database models removed

There is no SQL database. The retired keys in `data.json` were:

| Key | What it held |
|---|---|
| `users` | Emails, scrypt password hashes, Stake/Kick names, roles, last-login IP |
| `sessions` | Hashed `sid` cookies, expiry, IP, user agent |
| `auditLog` | Login, logout, account-link, and admin-action events |

Kept: `viewerLeaderboard` (BotRix current month + monthly snapshots).

## Migrations created

`scripts/migrations/001-remove-accounts.js` (`npm run migrate`)

- Stop the site first (it holds the file in memory and would write the old keys back).
- `--dry-run` prints counts only (no emails or IPs).
- Applies by writing a `*.pre-001-remove-accounts-*.bak` backup, deleting `users` / `sessions` / `auditLog`, and recording the id in `db.migrations`.
- Safe to run more than once.
- Does not touch `viewerLeaderboard`.

The backup still contains emails, hashes, and IPs. Delete it once the site works.

## Dependencies removed

`package.json` has no npm packages and never did. Nothing to uninstall. There is no `npm audit` / unused-dependency report to run.

Removed in-repo modules that existed only for accounts: `src/lib/security.js` and the services/routes listed above.

## Environment variables removed

Removed from `.env.example` and `deploy/lightsail/norochan.env.example` after confirming they are unused:

| Variable | Why |
|---|---|
| `ADMIN_EMAILS` | Admin promotion at startup |
| `AUDIT_LOG_MAX` | Audit log cap |
| `GOOGLE_CLIENT_ID` | Placeholder Google sign-in |
| `KICK_CLIENT_ID` | Kick OAuth login |
| `KICK_CLIENT_SECRET` | Kick OAuth login |
| `KICK_REDIRECT_URI` | Kick OAuth callback |
| `BASE_URL` | Only used to build that callback |
| `TRUST_PROXY` | Session IP / cookie Secure behind a proxy |

Kept (still used):

| Variable | Why |
|---|---|
| `STAKE_TOKEN`, `STAKE_API_BASE` | Wager leaderboard |
| `BOTRIX_*` | Top viewers |
| `KICK_CHANNEL_USERNAME` / `KICK_CHANNEL` | Public Kick live/offline card |
| `DATA_FILE` | BotRix snapshots |
| `REWARDS_FILE` | Prize pool / total bonuses |
| `PORT`, `HOST`, `REFRESH_MS` | Server |
| `HSTS` | HTTPS header (`COOKIE_SECURE=1` still accepted as the old name) |

## What was intentionally preserved

- Kick **public** channel status: live/offline, title, viewer count, thumbnail, Watch Live URL (`GET /api/kick-live`, `src/services/kick.js`)
- BotRix top viewers: current / previous month (`GET /api/viewers/*`, `src/services/botrix.js`)
- Stake wager leaderboard: current / previous month, masked names, prizes (`GET /api/leaderboard`, `src/services/stake.js`)
- Public config and social/affiliate links (`GET /api/config`)
- Prize pool and total bonuses from the rewards file (`GET /api/rewards`, `src/services/rewards.js`)
- AWS Lightsail layout, Caddy, systemd
- Existing visual design (tokens, stickers, theme, scroll-spy)

## Public data layer (no admin UI)

`src/data/rewards.example.json` is the template. Copy it to `src/data/rewards.json` locally, or `/var/lib/norochan/rewards.json` on Lightsail (`REWARDS_FILE`).

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

The homepage reads these through `/api/rewards`. Invalid or missing amounts are never invented: the prize pool can fall back to the race prize total in `src/config.js`; unset payout rows show a dash. The file is re-read when it changes.

## Remaining authentication-related words, and why they stay

| Match | Why it stays |
|---|---|
| Support copy: "never ask for your Stake password" | Warning to visitors, not a password form |
| Kick livestream `session_title` | Kick's field name for the stream title |
| BotRix plan mentions OAuth | BotRix's own streamer login, not this site |
| Kick docs links mentioning OAuth | Official Kick documentation URLs |
| `COOKIE_SECURE` | Old name for `HSTS=1`, HTTPS header only |
| Migration script and this report | Cleanup tooling |
| Smoke tests that POST `/api/login` | They assert those routes are gone (405/404) |
| `nologin` in `setup.sh` | Linux system-user shell, not website login |

## Verification

- No TypeScript and no linter in this repo (`node --check` on the server modules; `node test/smoke.js` for behaviour).
- No production bundler. `node server.js` is the production process.
- Smoke tests cover: missing account/admin routes, no cookies, rewards file (including invalid-JSON keep-last-good), Stake current/previous month, BotRix current/previous month, secrets never sent to the browser, and migration 001.

After deploy: stop the site, run `npm run migrate` against the live `DATA_FILE`, copy the rewards example to `REWARDS_FILE`, fill in the two figures, start the site.
