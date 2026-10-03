# UI/UX Redesign Plan — Norochan Site

## Executive summary

Norochan is a **zero-dependency Node 18+ SPA**: static HTML/CSS/vanilla JS front end served by `src/server.js`, with hash-based client routing. Business logic (Stake affiliate API, auth, sessions, Kick OAuth, live status) lives entirely on the server. The redesign targets **presentation only**—tokens, layout, components, states, and micro-interactions—without altering API contracts or auth flows.

---

## 1. Existing pages

| Route | View function | Purpose |
|-------|---------------|---------|
| `#/` (home) | `homeView()` | Hero, promo code, stats strip, KICK live card, race CTA, social links |
| `#/leaderboard` | `leaderboardView()` | Stake wager race: podium, table, current/previous month tabs |
| `#/account` | `accountView()` → `authView()` or `profileView()` | Sign up / log in, OAuth buttons, profile, referral status |

**Static shell:** `index.html` — header nav, `#app` main, footer (responsible gambling, social pills).

**No separate admin UI** — admin behavior is env/config on server only.

---

## 2. Existing components (logical, in `app.js`)

| Component | Location | Data source |
|-----------|----------|-------------|
| DOM helper `h()` | `app.js` | — |
| `api()` fetch wrapper | `app.js` | All `/api/*` |
| `kickLivePreview()` | `app.js` | `GET /api/kick-live` (poll 45s) |
| `countdownBox` / `leaderboardCountdown` | `app.js` | Config race dates / month end |
| `homeView()` | `app.js` | `GET /api/config` |
| `leaderboardView()` | `app.js` | `GET /api/leaderboard` |
| `authView()` / `profileView()` | `app.js` | `/api/signup`, `/api/login`, `/api/profile`, `/api/me`, OAuth redirects |
| Social buttons | `app.js` | Config links |
| Theme toggle | `index.html` + `app.js` | `localStorage` + `data-theme` |

**Not implemented in UI (API exists):** `GET /api/kick/top-viewers` → **501** (viewer watch-time unsupported per KICK official API).

---

## 3. Components that can be reused (logic)

- `h()` — keep as lightweight vdom
- `api()`, `refreshMe()`, referral polling
- `kickLivePreview()` render/poll logic — restyle only
- Leaderboard data mapping, month tab state (`syncTabs`), podium/table builders
- Auth form submit handlers, OAuth redirect URLs
- Router `route()` and hash navigation
- Countdown tick logic

---

## 4. Components that need redesign (visual/UX)

- Global header — premium top nav, mobile menu, active/hover/focus states
- Footer — align with design system; optional compact mobile layout
- Home hero & promo panel — hierarchy, spacing, stat cards
- KICK live card — live/offline/unavailable layouts per spec
- Leaderboard — unified container, tab indicator animation, row hover, skeletons
- Account cards, tabs, forms — consistent inputs/buttons
- Social link grid — less “pill billboard,” more refined dashboard tiles
- Loading/error/empty states across all async views

---

## 5. Components to extract (reusable UI)

Proposed under `src/public/` (vanilla JS, no bundler):

```
js/ui.js          — Button/Card/Badge/Skeleton/EmptyState/ErrorState helpers (extend h())
js/layout.js      — Optional: mobile nav toggle (or keep in index + app.js)
css/tokens.css    — Design tokens (@import from style.css)
css/components.css — UI primitives (@import from style.css)
```

**Avoid duplicating:** one leaderboard viewport + tabs; one kick live module.

---

## 6. Current styling problems

- Tokens duplicated across `:root`, `prefers-color-scheme`, and `[data-theme="dark"]`; **no `[data-theme="light"]` palette** (theme toggle incomplete)
- Heavy gold/green gradients and large shadows — reads “gaming template” vs premium SaaS
- Inconsistent radii (14px, 18px, 22px, 26px, 999px) without named scale
- Leaderboard podium is tall (560px min-height) and weak on small screens
- Social buttons use oversized labels (`clamp` up to 2.1rem)
- Mixed currency copy (USD vs CAD) in leaderboard header paths
- Hard-coded `$500` prize pool on home vs config-driven prizes

---

## 7. UX problems

- Leaderboard shows “Loading…” text only — no skeleton
- KICK live: no explicit retry on error; generic unavailable copy
- No dedicated empty state component pattern
- Account OAuth on auth screen redirects to Kick/Google without session — Kick requires login first (by design); messaging could be clearer
- Theme button label “Theme” — no icon/state indication
- No skip link / landmark polish for keyboard users on mobile menu
- Kick “top viewers” not surfaced — users may expect it from product language; must show **honest unsupported** state, not fake watch times

---

## 8. Responsive problems

- Header nav wraps awkwardly; no hamburger / drawer
- Podium collapses to single column but retains large min-heights
- Table horizontal scroll only — acceptable but needs tighter mobile typography
- Kick live grid may crush on narrow widths
- Footer 3-column grid stacks at 920px — OK; social pills could use real icons

---

## 9. Proposed design system

### Color (dark-first production theme)

| Token | Role |
|-------|------|
| `--color-bg` | Page background |
| `--color-bg-elevated` | Subtle layered gradient stop |
| `--color-surface` | Cards |
| `--color-surface-raised` | Hover / elevated cards |
| `--color-border` | Default borders |
| `--color-border-subtle` | Hairlines |
| `--color-primary` | CTA, links accent |
| `--color-primary-muted` | Primary tint backgrounds |
| `--color-secondary` | Secondary actions |
| `--color-success` | Live, verified |
| `--color-warning` | Stale data, caution |
| `--color-danger` | Errors |
| `--color-text` | Primary text |
| `--color-text-secondary` | Muted |
| `--color-text-tertiary` | Labels, captions |

Accent direction: restrained **gold-amber** primary on **blue-charcoal** surfaces (creator dashboard), not neon green stacks.

### Typography

- `--font-sans`: Inter, system-ui
- `--text-display`: clamp hero
- `--text-h1` / `--text-h2` / `--text-body` / `--text-caption` / `--text-label` / `--text-stat`

### Spacing scale

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64` → `--space-1` … `--space-10`

### Radius

`--radius-sm` (6), `--radius-md` (10), `--radius-lg` (14), `--radius-xl` (20), `--radius-pill` (9999)

### Shadows

`--shadow-subtle`, `--shadow-card`, `--shadow-elevated`, `--shadow-modal`

### Motion

`--duration-fast` (120ms), `--duration-normal` (200ms), `--duration-slow` (320ms); `--ease-out`; `@media (prefers-reduced-motion: reduce)` disables nonessential animation

---

## 10. Proposed component hierarchy

```
index.html
├── layout-site-header (logo, nav, theme, mobile toggle)
├── main#app
│   ├── page-home
│   │   ├── dashboard-hero
│   │   ├── dashboard-stats
│   │   ├── dashboard-live (KickLiveCard)
│   │   ├── dashboard-race-cta
│   │   └── dashboard-social
│   ├── page-leaderboard
│   │   ├── leaderboard-header
│   │   ├── leaderboard-tabs (current | previous)
│   │   └── leaderboard-panel (single container)
│   │       ├── podium (optional)
│   │       └── table + states
│   └── page-account
│       ├── auth-card | profile-cards
│       └── status-referral
└── layout-site-footer
```

**Navigation:** Top nav only (3 routes + account) — **no sidebar** (insufficient route count).

---

## Architecture reference

| Layer | Technology |
|-------|------------|
| Framework | None — vanilla JS IIFE |
| Routing | Hash `#/`, `#/leaderboard`, `#/account` |
| CSS | Single `style.css` (+ split tokens/components) |
| Tailwind | Not used |
| State | Module `state` in `app.js`; server in-memory + `data.json` |
| Data fetching | `fetch` via `api()` |
| CSP | Strict — scripts/styles from `'self'` only; Kick thumbnails may need `img-src` update if hotlinking blocked |

---

## Implementation stages (post-plan)

1. Design tokens + base components CSS  
2. Global layout + mobile navigation  
3. Dashboard / home  
4. KICK live card + error/retry  
5. Leaderboard unified panel + skeletons  
6. Account pages  
7. Kick top-viewers **unsupported** honest UI (optional section on home)  
8. Responsive pass + a11y + reduced motion  
9. Visual QA + smoke test  

---

## Functionality preservation checklist

- [ ] All `/api/*` routes unchanged  
- [ ] OAuth `/auth/kick`, `/auth/google`, callback  
- [ ] Session cookies, signup/login/logout/profile  
- [ ] Stake leaderboard current + previous month  
- [ ] KICK live from existing endpoint  
- [ ] Referral polling on account  
- [ ] Config-driven links and race metadata  
- [ ] No fabricated viewer watch times or leaderboard rows  

---

## Notes on “Top Viewers” vs Stake leaderboard

Product copy in the user brief describes **Kick viewer watch-time** ranks. This codebase’s **primary leaderboard is Stake weighted wager** (masked names, prizes). Kick monthly viewer leaderboard is **explicitly unsupported** server-side (`501`). UI will:

- Polish **Stake** monthly tabs as the main leaderboard experience.  
- If a “Top Viewers (Kick)” block is shown, it will call the real API and display loading / unsupported / empty — **never synthetic avatars or hours**.
