# Norochan site — Software Requirements Specification

**Product:** norochan.com (Norochan Stake / Kick creator affiliate site)  
**Status:** living spec; Phase 1–3 are approved. Chat stays off-site (Discord / Telegram).  
**Date:** 5 October 2026  
**Hosting today:** AWS EC2, domain norochan.com, GitHub private repo `stakedesi-art/Norochan`

This document is the source of truth for what to build next. The live site must stay as it is until a phase is explicitly approved.

---

## 1. Purpose

Keep the current public site working, then add **staff-managed content**, **code-benefit posts by reward category**, **ticket/wheel** features that use Stake **raw wager**, and visitor **Account** (email/password, Google, Kick) with a typed Stake username and staff code check. Chat should not be built on this site if cost and risk stay the priority.

## 2. Goals and non-goals

### Goals

- Visitors can see live Kick status, BotRix top viewers, the Stake wager race, prizes, and official social links.
- Staff can publish announcements and code-benefit posts grouped by reward category, without a public “Admin” link.
- A player can attach a Stake username **once** (typed), pick a referral code, and wait for staff if it is an owner code. After save the username is **read-only**.
- Ticket eligibility uses Stake **raw wager** (`total_wagered_amount`), not the race-weighted amount.
- New features must keep monthly AWS cost close to the current single-instance bill.

### Non-goals (do not build unless this document is updated)

- Rebuild or restyle the whole site again.
- Password-based visitor signup or a public Admin panel.
- On-site logged-in chat (use Discord).
- Estimating or inventing Kick watch time.
- Showing real Stake usernames or raw wager on the public leaderboard.

---

## 3. Current system (must keep)

These already exist and must keep working in every phase.

| Area | Behaviour |
|---|---|
| Stack | Node 18+, **no npm packages**, one process |
| Public pages | Home, Streams, Leaderboard, Rewards, Community, Support (hash routes) |
| Kick | Public live/offline card; no Kick OAuth required for this |
| BotRix | Top viewers current/previous month; honest empty/coming-soon if not configured |
| Stake race | Affiliate CSV leaderboard; **weighted** amount for ranking; names masked (see FR-P4) |
| Public leaderboard payload | Only `rank`, `name`, `weighted`, `prize` |
| Campaign | **Race board:** code NOROCHAN / `Norochan` only (unless `ALL_CAMPAIGNS` is set). **Code badge:** any of the owner codes in config (norochan, divu, ipl2026, deepu). |
| October 2026 race | Title “October Wager Race”; window 1–31 Oct 2026 UTC; prize pool **$500**; 10 paid places (200 / 100 / 60 / 40 / 30 / 20 / 15 / 15 / 10 / 10) |
| Rewards file | `REWARDS_FILE`: prize pool + bonuses given (leaderboard payout, level-up, social). Edit the file on the server; no dashboard required for those numbers |
| Secrets | Env only (`STAKE_TOKEN`, BotRix key, later passwords). Never in git, HTML, or public JSON |
| Data file | `DATA_FILE` gitignored; BotRix snapshots; no visitor accounts |
| Security headers | CSP `style-src 'self'` plus Kick image hosts; no inline scripts |
| Legal copy | 18+ only; not for Indian audience; responsible-gambling footer |
| Nav | No Log in / Sign up / Admin in the public header |

**Hosting note:** docs mention Lightsail (`/opt/norochan`). The real host in use is **EC2 as `ec2-user`**. Future deploy steps must match the actual clone path and process on that instance.

---

## 4. Stakeholders and users

| Role | Who | Access |
|---|---|---|
| Visitor | Anyone on norochan.com | Public pages and public APIs only |
| Code user | Plays on Stake with code NOROCHAN | Appears on race board (masked); later may earn wheel tickets from raw wager |
| Staff | Norochan / manager | Hidden studio URL + password (or later a staff account) to publish posts and run draws |
| System | Stake affiliate API, Kick public API, BotRix | Server-to-server only; tokens never sent to the browser |

---

## 5. Constraints (always on)

1. Do not rebuild the site; extend it.
2. Do not break Kick live, BotRix, Stake leaderboard, or file-based prizes.
3. Do not expose secrets, real usernames, raw wager, or ticket counts on the public race board.
4. Do not fabricate Kick watch times.
5. Keep CSP as it is (add a new host only if a required image/API domain needs it).
6. Prefer zero new paid services. Stay on the existing EC2 box.
7. One app process until storage moves off a single JSON file.
8. Staff UI must not appear in public navigation.

---

## 6. Functional requirements

IDs are stable. “Later” means not in the first build.

### 6.1 Public site (existing)

| ID | Requirement |
|---|---|
| FR-P1 | Site serves the current pages and public JSON APIs. |
| FR-P2 | Kick live status updates without login. |
| FR-P3 | BotRix top viewers show current and previous month when configured. |
| FR-P4 | Stake race board uses **weighted** wager and masked names. Masking uses Unicode code points (`Array.from`): **first 2 letters + `***` + last 2 letters**. Example: `Alice_W` → `Al***_W`; `bobby99` → `bo***99`. If the name has **4 or fewer** characters, show the first 2 (or the whole name if shorter) + `***` only — do not also show the last 2, or a 3–4 letter name would be fully visible. Real usernames never leave the server. |
| FR-P5 | Prize pool and “bonuses given” come from `REWARDS_FILE`. |
| FR-P6 | Code, referral link, and social links come from `src/config.js`. |

### 6.2 Stake data (raw wager)

Stake’s leaderboard CSV already includes both columns:

- `total_weighted_amount` — race ranking (RTP weighting)  
- `total_wagered_amount` — **raw wager**

| ID | Requirement |
|---|---|
| FR-S1 | Server must read **both** columns from the Stake API (and from local CSV fallback if used). |
| FR-S2 | Public `/api/leaderboard` must keep sending only weighted figures. |
| FR-S3 | Raw wager is stored only in server memory/store for tickets. |
| FR-S4 | Ticket rule: **floor(raw_wager_usd / 1000) = number of tickets**. Example: $1,999.99 → 1 ticket; $2,000 → 2 tickets. |
| FR-S5 | Tickets are **not** shown on the public race leaderboard. |

### 6.3 Staff content studio (requested)

Staff-only page, URL not linked from the public site (example: `/studio.html`).

| ID | Requirement |
|---|---|
| FR-A1 | Staff log in with a long env password (`ADMIN_PASSWORD`, 8+ characters) until real staff accounts exist. |
| FR-A2 | Session cookie: HttpOnly, SameSite=Lax, Secure on HTTPS. |
| FR-A3 | POST/PATCH/DELETE from a mismatched Origin are rejected. |
| FR-A4 | Login attempts are rate-limited per IP. |
| FR-A5 | Public `app.js` must never call `/api/admin`. |

**Announcements**

| ID | Requirement |
|---|---|
| FR-N1 | Staff can create, edit, unpublish, and delete announcements (title + body). |
| FR-N2 | Only **published** announcements appear on the public home page. |
| FR-N3 | Empty feed: no fake “sample” news. Hide the section if there are none. |

**Code benefits (by reward category)**

| ID | Requirement |
|---|---|
| FR-B1 | Staff create posts with: category, title, body, optional USD amount, optional https button. |
| FR-B2 | Categories (fixed list): **wager race**, **reloads**, **level-up**, **social giveaways**, **monthly wheel**, **other**. |
| FR-B3 | Public Rewards section groups published posts **by category**. Empty categories are omitted. |
| FR-B4 | Button URLs must be `https://` only. |
| FR-B5 | Drafts stay off the public site until published. |

Prize-pool **numbers** in `rewards.json` stay file-edited. Studio is for **posts**, not for replacing that file unless a later phase says so.

### 6.4 Monthly ticket wheel (Phase 2)

Public **masked** names and **ticket counts** are shown on the wheel board. The race board stays weighted-only. The draw is **automatic** at UTC month end. Staff set the **monthly prize-pool total only**.

| ID | Requirement |
|---|---|
| FR-W1 | Period: calendar month (UTC). **3** unique winners. Staff set the prize-pool **total** (default $50). Staff cannot set per-winner amounts or pick names. |
| FR-W2 | Eligibility: Stake users under the race campaign; tickets = floor(raw wager / 1000) (FR-S4). The wheel pool is the **full** campaign list, not the race top 10. |
| FR-W3 | One person may have many tickets; draw is weighted by ticket count. |
| FR-W4 | At UTC month end the server runs a **seeded, logged** draw of 3 unique winners (catch-up on the next refresh if the process was down). If fewer than 3 eligible, take all. |
| FR-W5 | Public `/api/wheel` shows prize pool, next draw time, current entries as **masked name + ticket count**, and last month’s winners the same way. No raw wager, no real usernames, no seed. |
| FR-W6 | Visitors cannot trigger a draw. There is no public or staff “spin” button. |
| FR-W7 | Race ranking stays weighted and top 10; wheel stays raw tickets. Do not mix the two. |
| FR-W8 | Studio PATCH may change `prizePool` only. Real names of winners stay staff-only for off-site payout (Telegram / Kick). |
| FR-W9 | After the automatic UTC month-end draw the server records the **full 3-winner spin** (same ticket-weighted wheel visitors see) and posts that video plus masked winners to a Discord channel webhook (`DISCORD_WHEEL_WEBHOOK`). Visitors never trigger this. Real usernames, seed, and the webhook URL never go to the public site. |

Login is **not** required for this wheel. Login **is** required later if a player must claim tickets or see “my tickets” on the site — that path uses the verified Stake username (section 6.7).

### 6.5 Visitor login (Phase 3)

Google, Kick, and email + password.

| ID | Requirement |
|---|---|
| FR-L1 | Accounts: email + password, Google, and Kick. |
| FR-L2 | After email signup, send a confirmation link to that inbox via **Gmail SMTP** (`GMAIL_USER` + app password). `AUTH_TEST=1` returns the path in JSON for tests. Password login is blocked until the link is opened. |
| FR-L3 | No visitor admin panel. Staff stay on the studio password. |
| FR-L4 | Public nav has **Account**. Still no **Admin**. |
| FR-L5 | Store rows as `accounts` (not `users`) so migrate 001 cannot wipe them. Do not reintroduce `/api/login` or `/api/signup`. |
| FR-L6 | After login, the player may attach a Stake username (6.7). |

### 6.6 Chat (out of scope for the cheap path)

| ID | Requirement |
|---|---|
| FR-C1 | **Do not** ship on-site logged-in chat in the low-cost plan. |
| FR-C2 | Community chat stays on the existing **Discord** (and Telegram if already used). |
| FR-C3 | Site only links to those channels. |

On-site chat would need websockets, moderation, storage, abuse handling, and extra RAM. That fights the cost goal.

### 6.7 Stake username (typed) + staff code check

No Limbo bet. The player types their Stake username and picks the referral code they used.

**Player flow**

1. Signed in. If a Stake name is already saved, it is locked (staff unbind only).
2. They enter the Stake username and select a referral code: **norochan**, **divu**, **ipl2026**, **deepu**, or **Other**.
3. If they pick an owner code, status is **pending**. Studio shows the claim so staff can confirm in Stake whether that name is under the code.
4. If they pick **Other** (or any code not on the owner list), store **Not under code** immediately.
5. Public race board stays masked.

| ID | Requirement |
|---|---|
| FR-V8 | Username stored = the name the player typed (3–24 characters, letters/numbers/`_`/`.`/`-`). |
| FR-V9 | One Stake username per site account. |
| FR-V10 | After save, the Stake username is read-only for the player. Staff may unbind. |
| FR-V12 | Public pages never show the full name on the race board. |
| FR-V14 | Owner codes (staff review): `norochan`, `divu`, `ipl2026`, `deepu`. |
| FR-V16 | Staff confirm → **Code verified** (store which code). Staff reject or player chose Other → **Not under code**. |
| FR-V17 | “Not under code” does not clear the username. |
| FR-V19 | Public wager race still NOROCHAN-only. |
| FR-V20 | Player and staff see the badge. Referred-users CSV is a **staff hint only**, not an automatic badge. |

---

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | Stay on **one** EC2 instance and the current Node process. |
| NFR-2 | No new npm dependencies unless a later phase cannot avoid it. |
| NFR-3 | JSON file storage until there are real visitor accounts; then SQLite on the same disk before RDS. |
| NFR-4 | Stake refresh stays periodic (today ~hourly); do not poll Stake on every page view. |
| NFR-5 | Public APIs cache nothing sensitive; `Cache-Control: no-store` for JSON that can change. |
| NFR-6 | Studio and admin APIs: `noindex` on the HTML page. |
| NFR-7 | Smoke tests must keep proving: Account in public nav and no Admin, email+password login, staff code check, no token leaks, masked names, weighted-only race board, tickets only on the wheel. |
| NFR-8 | Brief restart outages are acceptable; no load balancer until storage is shared. |

---

## 8. Data rules

| Data | Public? | Source |
|---|---|---|
| Masked race names, weighted wager, prize | Yes | Stake CSV `total_weighted_amount` |
| Masked wheel names + ticket counts, prize-pool total, last winners | Yes (wheel board only) | Tickets from `total_wagered_amount` |
| Raw wager, real Stake usernames, wheel seed | No (staff see real winner names for payout) | Stake CSV + draw log |
| Kick live title/viewers/thumbnail | Yes | Kick public API |
| BotRix watch time / points | Yes (usernames as BotRix sends them) | BotRix |
| Announcements / benefit posts | Published only | Staff studio |
| Prize pool / bonuses given | Yes | `rewards.json` |
| Stake username on the account | Only to that logged-in player (and staff) | Typed by the player |
| Code badge (`Code verified` / `Not under code` / pending) | Only to that player (and staff) | Other code auto; owner codes staff-confirmed. Referred-users is a staff hint |
| Owner campaign codes | Not a secret; not a full public directory | Config: norochan, divu, ipl2026, deepu |
| Staff password / Stake token / BotRix key / Discord webhook / Gmail app password | Never | Environment |

---

## 9. Phased delivery (build only after approval)

| Phase | What | Extra monthly cost (typical) |
|---|---|---|
| **0** | Freeze current public site. Write this SRS. No code. | $0 |
| **1** | Staff studio: announcements + categorized code-benefit posts | $0 (same EC2) |
| **2** | Public wheel entries (masked + tickets); auto UTC month-end draw of 3; staff set prize-pool total only | $0 |
| **3** | Visitor login (email+password, Google, Kick), typed Stake name, staff code check | Gmail SMTP: $0 |
| **4** | Chat | **Skip** — Discord already paid-for-free |

Do not start **chat** on this site. Stake verify **requires** a site login so the locked username has an owner.

---

## 10. Tools for minimum cost

Use what is already running. Add a paid product only when the current box cannot do the job.

### 10.0 Language for Stake (decision)

**Use JavaScript (the existing Node 18+ app). Do not add Python for Stake.**

The Stake affiliate API is HTTPS + CSV. That is already implemented in `src/services/stake.js`. Python would mean a second process, a second runtime on EC2, extra RAM, and two deploy paths — for no extra Stake capability. Raw wager is the same CSV column either language.

### 10.1 Keep using (already paid or free)

| Tool | Job | Cost |
|---|---|---|
| **Existing EC2** | Node app + JSON/SQLite files | Current instance (do not add a second box) |
| **Caddy or nginx** on that instance | HTTPS (Let’s Encrypt) | $0 |
| **systemd** | Keep Node running | $0 |
| **GitHub private** | Code | $0 at this scale |
| **Stake affiliate API** | Weighted race + raw wager + referred-users for the code badge | $0 (already have token) |
| **Kick public API** | Live/offline | $0 |
| **BotRix** | Viewer watch-time board | $0 / existing BotRix plan |
| **Discord + Telegram** | Chat and support | $0 |
| **`rewards.json` on disk** | Prize pool numbers | $0 |

### 10.2 Add only when a phase needs it

| Phase | Tool | Why this one | Avoid |
|---|---|---|---|
| 1 Staff posts | Env `ADMIN_PASSWORD` + cookie + rows in `data.json` | No database, no Auth0 | Firebase, Cognito, paid CMS |
| 2 Wheel | Same Node process; seeded RNG; log the seed and winners in `data.json` | No extra service | Third-party raffle apps |
| 3 Stake name | Player types username; staff check owner codes | $0 | Limbo / scraping Stake |
| 3 Code badge | Staff confirm owner codes; Other → not under code | Manual, honest | Auto “verified” from leaderboard rank |
| 3 Email verify | **Gmail SMTP** app password | $0 | SendGrid, Mailgun |
| 3 Google login | Google OAuth (free tier) | Standard, $0 | Auth0 |
| 3 Kick login | Kick OAuth when that phase starts | Official, $0 | Scraping Kick |
| 3 User store | **SQLite file** on the EC2 disk | $0 until thousands of users | RDS / Firebase from day one |
| Chat | Discord invite on the site | $0, moderation already there | Custom websocket chat, Stream Chat, Firebase RTDB |

### 10.3 Do not add for cost reasons

- Second server or load balancer  
- RDS / ElastiCache / CloudFront (until traffic actually needs them)  
- Firebase (second cloud, billed per read, bad fit for search)  
- On-site chat infrastructure  
- npm-heavy rewrite (Next, React hosting, serverless per-request billing)

### 10.4 EC2 hygiene (still cheap)

- One small instance (1–2 GB RAM is enough for this app).  
- App listens on `127.0.0.1`; only 80/443 public.  
- `DATA_FILE` / `REWARDS_FILE` **outside** the git folder so `git pull` cannot wipe data.  
- Disk snapshots (or a daily copy of the JSON/SQLite files).  
- Match deploy docs to **this** EC2 path (`ec2-user`), not the unused Lightsail `/opt/norochan` layout, unless that layout is actually installed.

---

## 11. Open decisions (confirm before coding)

1. **Phase 1–3:** staff posts, wheel, and visitor Account (password + Gmail confirm + staff code check) are in.  
2. **Wheel:** **decided** — public masked entries + tickets; automatic 3-winner draw at UTC month end; staff set prize-pool total only.  
3. **Winner display:** **decided** — public masked names; staff see real names for payout.  
4. **Chat:** confirm Discord-only (recommended).  
5. **Stake verify bet size:** insist on `$0.00` only, or accept Stake’s real minimum (`$0.01` etc.) if `$0.00` is not allowed.  
6. **Stake verify hosts:** `stake.jp` only (matches the referral link) vs also `stake.com`.  
7. **Code badge:** show which code matched (`norochan` / `divu` / `ipl2026` / `deepu`) or only yes/no. Recommended: show the code.  
8. **Race vs codes:** keep the public race **NOROCHAN-only**, other codes only for the badge (current spec).  
9. **Staff access:** one shared `ADMIN_PASSWORD` vs separate staff emails later.  
10. **Deploy path:** exact EC2 directory and how Node is started today (systemd / node / something else).

---

## 12. Acceptance (when a phase is done)

- Public Kick, BotRix, and Stake race still pass `node test/smoke.js`.  
- Public nav has Account and still has no Admin.  
- Public leaderboard still has no raw wager, tickets, or real names.  
- Public wheel shows masked names + ticket counts; auto-draw of 3; staff can set prize-pool total only.  
- Staff can publish a category post and see it under Rewards; drafts stay hidden.  
- After Stake save: typed username is locked; owner codes wait for staff; Other is not under code.
- Staff can confirm/reject a pending code and unbind a Stake name. Migrate 001 must not delete `accounts`.

---

## 13. Document control

| Version | Date | Notes |
|---|---|---|
| 0.4 | 5 Oct 2026 | Code badge: norochan, divu, ipl2026, deepu via referred-users; independent of Limbo username lock. |
| 0.5 | 5 Oct 2026 | Phase 2 wheel: public masked tickets, automatic 3 winners at UTC month end, staff prize-pool total only. |
| 0.6 | 5 Oct 2026 | Auto-draw records the live 3-winner spin and posts that video to a Discord webhook. |
| 0.7 | 5 Oct 2026 | Phase 3: Account nav, email magic-link, Limbo Stake-name verify, code badge via referred-users. |
| 0.8 | 5 Oct 2026 | Phase 3 revised: email+password, Gmail confirm, Google/Kick, typed Stake name, staff code check. No Limbo. |
