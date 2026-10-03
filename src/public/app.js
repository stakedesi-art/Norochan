'use strict';
(function () {
  const app = document.getElementById('app');
  const state = { config: null, me: null };
  let timer = null;
  let referralPoll = null;

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  async function api(path, body) {
    const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    return data;
  }
  const usd = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd0 = (n) => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const UI = window.NoroUI || {};
  const prizePoolTotal = (c) => {
    if (!c || !c.prizes) return null;
    let sum = 0;
    for (const v of Object.values(c.prizes)) sum += Number(v) || 0;
    return sum > 0 ? sum : null;
  };
  function svgIcon(paths, viewBox, className) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add(className || 'social-icon');
    for (const path of paths) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', path.d);
      if (path.fill) p.setAttribute('fill', path.fill);
      if (path.fillRule) p.setAttribute('fill-rule', path.fillRule);
      if (path.clipRule) p.setAttribute('clip-rule', path.clipRule);
      if (path.stroke) p.setAttribute('stroke', path.stroke);
      if (path.strokeWidth) p.setAttribute('stroke-width', String(path.strokeWidth));
      svg.appendChild(p);
    }
    return svg;
  }
  function socialIconForKey(key, label) {
    const imageName = `${key}.png`;
    const image = h('img', {
      src: `/${imageName}`,
      alt: label || key,
      class: 'social-logo',
      loading: 'lazy',
      decoding: 'async'
    });
    return image;
  }
  function socialButton(key, label, href) {
    const icon = socialIconForKey(key, label);
    const labelNode = h('span', { class: 'social-label' }, label);
    const content = [icon ? h('span', { class: 'social-icon' }, icon) : null, labelNode];
    return h('a', { class: `btn secondary social-btn ${key}`, href, target: '_blank', rel: 'noopener noreferrer' }, ...content);
  }
  const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };

  async function refreshMe() {
    try { state.me = (await api('/api/me')).user; } catch { state.me = null; }
    document.getElementById('nav-account').textContent = state.me ? 'My account' : 'Log in';
    return state.me;
  }

  function stopReferralPolling() {
    if (referralPoll) { clearInterval(referralPoll); referralPoll = null; }
  }

  function startReferralPolling() {
    stopReferralPolling();
    if (!state.me || !state.me.stakeUsername || !state.me.referral || state.me.referral === 'found' || state.me.referral === 'not_found') return;
    referralPoll = setInterval(async () => {
      if (!state.me || !state.me.stakeUsername) { stopReferralPolling(); return; }
      try {
        const me = await refreshMe();
        if (!me || !me.stakeUsername || me.referral === 'found' || me.referral === 'not_found') stopReferralPolling();
        else if (location.hash.replace(/^#\/?/, '') === 'account') {
          app.replaceChildren(accountView());
        }
      } catch { /* ignore transient polling errors */ }
    }, 2500);
  }

  // ---------- theme ----------
  const root = document.documentElement;
  try { const t = localStorage.getItem('theme'); if (t) root.dataset.theme = t; } catch (e) { /* storage blocked */ }
  function toggleTheme() {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) { /* ignore */ }
  }
  const themeBtn = document.getElementById('theme');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  const themeMobile = document.getElementById('theme-mobile');
  if (themeMobile) themeMobile.addEventListener('click', toggleTheme);

  const mobileNav = document.getElementById('mobile-nav');
  const navToggle = document.getElementById('nav-toggle');
  const mobileNavClose = document.getElementById('mobile-nav-close');
  function setMobileNav(open) {
    if (!mobileNav || !navToggle) return;
    mobileNav.classList.toggle('open', open);
    mobileNav.setAttribute('aria-hidden', open ? 'false' : 'true');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
  }
  if (navToggle) navToggle.addEventListener('click', () => setMobileNav(!mobileNav.classList.contains('open')));
  if (mobileNavClose) mobileNavClose.addEventListener('click', () => setMobileNav(false));
  if (mobileNav) {
    mobileNav.addEventListener('click', (ev) => { if (ev.target === mobileNav) setMobileNav(false); });
    mobileNav.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', () => setMobileNav(false));
    });
  }

  // ---------- countdown ----------
  function countdownBox(race) {
    const cells = {};
    const wrap = h('div', { class: 'countdown', role: 'timer' });
    for (const [key, label] of [['d', 'days'], ['h', 'hours'], ['m', 'minutes'], ['s', 'seconds']]) {
      cells[key] = h('b', {}, '0');
      wrap.append(h('div', {}, cells[key], h('span', {}, label)));
    }
    const caption = h('p', { class: 'muted' });
    function tick() {
      const now = Date.now();
      let target, text;
      if (now < race.startsAt) { target = race.startsAt; text = 'Race starts in'; }
      else if (now <= race.endsAt) { target = race.endsAt + 1; text = 'Race ends in'; }
      else { target = now; text = 'The race has ended. Final standings below.'; }
      const s = Math.max(0, Math.floor((target - now) / 1000));
      cells.d.textContent = Math.floor(s / 86400);
      cells.h.textContent = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
      cells.m.textContent = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      cells.s.textContent = String(s % 60).padStart(2, '0');
      caption.textContent = text;
    }
    tick();
    stopTimer();
    timer = setInterval(tick, 1000);
    return h('div', {}, caption, wrap);
  }

  function leaderboardCountdown(targetTime, captionText) {
    const cells = {};
    const wrap = h('div', { class: 'countdown', role: 'timer' });
    for (const [key, label] of [['d', 'days'], ['h', 'hours'], ['m', 'minutes'], ['s', 'seconds']]) {
      cells[key] = h('b', {}, '0');
      wrap.append(h('div', {}, cells[key], h('span', {}, label)));
    }
    function tick() {
      const now = Date.now();
      const totalSeconds = Math.max(0, Math.ceil((targetTime - now) / 1000));
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      cells.d.textContent = String(days);
      cells.h.textContent = String(hours).padStart(2, '0');
      cells.m.textContent = String(minutes).padStart(2, '0');
      cells.s.textContent = String(seconds).padStart(2, '0');
    }
    tick();
    stopTimer();
    timer = setInterval(tick, 1000);
    return h('div', { class: 'leaderboard-countdown-wrap' }, h('div', { class: 'leaderboard-rule' }, captionText), wrap);
  }

  // ---------- views ----------
  function kickLivePreview() {
    const card = h('div', { class: 'kick-live-card', 'data-live': 'false' });
    const badgeSlot = h('div', {});
    const mediaWrap = h('div', { class: 'kick-live-media' });
    const title = h('div', { class: 'kick-live-title' }, 'Loading stream status…');
    const meta = h('div', { class: 'kick-live-meta' });
    const actions = h('div', { class: 'kick-live-actions' });
    const errorSlot = h('div', {});
    let pollTimer = null;

    const thumbPlaceholder = h('div', { class: 'kick-live-placeholder' }, 'Stream preview');

    function renderSkeleton() {
      badgeSlot.replaceChildren(UI.skeletonBlock ? UI.skeletonBlock('', 'width:88px;height:28px;border-radius:9999px') : h('span', { class: 'muted' }, '…'));
      mediaWrap.replaceChildren(UI.skeletonBlock ? UI.skeletonBlock('', 'width:100%;min-height:160px') : thumbPlaceholder.cloneNode(true));
      title.textContent = 'Loading live status…';
      meta.textContent = '';
      actions.replaceChildren();
      errorSlot.replaceChildren();
    }

    function render(data, failed) {
      loading = false;
      const safeData = data || {
        status: 'unavailable',
        channel: (state.config && state.config.kickChannel) || 'norochan',
        url: (state.config && state.config.kickChannelUrl) || 'https://kick.com',
        title: null,
        viewers: null,
        thumbnail: null,
        message: 'Status unavailable',
      };
      const channelName = safeData.channel || 'norochan';
      const live = safeData.status === 'live';
      const offline = safeData.status === 'offline';
      card.setAttribute('data-live', live ? 'true' : 'false');

      badgeSlot.replaceChildren(
        UI.liveBadge
          ? UI.liveBadge(live ? 'live' : offline ? 'offline' : 'unavailable')
          : h('span', { class: 'ui-badge' }, live ? 'Live now' : 'Offline')
      );

      mediaWrap.replaceChildren();
      if (live && safeData.thumbnail) {
        mediaWrap.append(h('img', { src: safeData.thumbnail, alt: `${channelName} live stream preview`, class: 'kick-live-thumb', loading: 'lazy' }));
      } else if (live) {
        mediaWrap.append(thumbPlaceholder.cloneNode(true));
      } else if (offline) {
        mediaWrap.append(h('div', { class: 'kick-live-offline' }, h('p', {}, 'Channel is offline. Follow for the next stream.')));
      } else {
        mediaWrap.append(thumbPlaceholder.cloneNode(true));
      }

      title.textContent = live
        ? (safeData.title || 'Live now')
        : offline
          ? channelName.toUpperCase()
          : 'Unable to load live status';

      meta.replaceChildren();
      if (live) {
        if (safeData.viewers != null) {
          meta.append(
            h('span', { class: 'viewers' }, '👥 ' + safeData.viewers.toLocaleString() + ' viewers'),
            document.createTextNode(' · @' + channelName)
          );
        } else {
          meta.textContent = '@' + channelName;
        }
      } else {
        meta.textContent = '@' + channelName + (safeData.message && !offline ? ' · ' + safeData.message : '');
      }

      actions.replaceChildren();
      const openUrl = safeData.url || `https://kick.com/${channelName}`;
      actions.append(h('a', { class: 'btn small', href: openUrl, target: '_blank', rel: 'noopener noreferrer' }, live ? 'Watch live' : 'View channel'));

      errorSlot.replaceChildren();
      if (failed || safeData.status === 'unavailable') {
        const retryUi = UI.errorState
          ? UI.errorState('Unable to load live status.', 'Check your connection or try again in a moment.', () => poll(true))
          : h('div', { class: 'ui-error' },
            h('p', { class: 'ui-empty-title' }, 'Unable to load live status.'),
            h('button', { class: 'btn small secondary', type: 'button', onclick: () => poll(true) }, 'Retry'));
        errorSlot.append(retryUi);
      }
    }

    async function poll(manual) {
      if (manual) renderSkeleton();
      try {
        const data = await api('/api/kick-live');
        render(data, false);
      } catch (err) {
        render(null, true);
      }
    }

    const header = h('div', { class: 'kick-live-header' },
      h('div', { class: 'kick-live-label' }, 'Kick live'),
      badgeSlot
    );
    const body = h('div', { class: 'kick-live-body' },
      mediaWrap,
      h('div', { class: 'kick-live-copy' }, title, meta, actions, errorSlot)
    );
    card.append(header, body);
    renderSkeleton();
    poll(false);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => poll(false), 45000);
    return card;
  }

  function kickTopViewersSection() {
    const panel = h('section', { class: 'block ui-card', 'aria-labelledby': 'kick-viewers-heading' });
    const body = h('div', {});
    const tabs = h('div', { class: 'ui-tabs', role: 'tablist', 'aria-label': 'Viewer month' });
    const currentTab = h('button', { type: 'button', class: 'ui-tab active', role: 'tab', 'aria-selected': 'true', id: 'kick-tab-current' }, 'Current month');
    const prevTab = h('button', { type: 'button', class: 'ui-tab', role: 'tab', 'aria-selected': 'false', id: 'kick-tab-previous' }, 'Previous month');
    tabs.append(currentTab, prevTab);
    let activePeriod = 'current';

    function setPeriod(period) {
      activePeriod = period;
      const isCurrent = period === 'current';
      currentTab.classList.toggle('active', isCurrent);
      prevTab.classList.toggle('active', !isCurrent);
      currentTab.setAttribute('aria-selected', String(isCurrent));
      prevTab.setAttribute('aria-selected', String(!isCurrent));
      load();
    }
    currentTab.addEventListener('click', () => setPeriod('current'));
    prevTab.addEventListener('click', () => setPeriod('previous'));

    async function load() {
      body.replaceChildren(UI.skeletonBlock ? UI.skeletonBlock('skeleton-row', 'height:120px;width:100%') : h('p', { class: 'muted' }, 'Loading…'));
      try {
        const res = await fetch(`/api/kick/top-viewers?period=${encodeURIComponent(activePeriod)}`);
        const data = await res.json().catch(() => ({}));
        if (res.status === 501 || data.available === false) {
          body.replaceChildren(
            UI.emptyState
              ? UI.emptyState(
                'Viewer watch time unavailable',
                'Kick’s official API does not expose per-viewer watch time. This section will populate only when supported data exists—never with fake stats.',
                h('a', { class: 'btn small secondary', href: 'https://docs.kick.com/', target: '_blank', rel: 'noopener noreferrer' }, 'Kick API docs')
              )
              : h('p', { class: 'muted' }, data.message || 'Viewer data not available from Kick.')
          );
          return;
        }
        const entries = data.entries || [];
        if (!entries.length) {
          body.replaceChildren(UI.emptyState ? UI.emptyState('No viewer data yet.', 'When Kick provides viewer analytics, rankings will appear here.') : h('p', { class: 'note' }, 'No viewer data yet.'));
          return;
        }
        body.replaceChildren(h('p', { class: 'note warn' }, 'Unexpected viewer data shape.'));
      } catch (err) {
        body.replaceChildren(
          UI.errorState
            ? UI.errorState('Leaderboard couldn\'t be loaded.', 'Unable to reach the server.', () => load())
            : h('p', { class: 'note warn' }, 'Leaderboard couldn\'t be loaded.')
        );
      }
    }

    panel.append(
      h('div', { class: 'section-head' },
        h('div', {},
          h('h2', { id: 'kick-viewers-heading' }, 'Top viewers'),
          h('p', { class: 'muted' }, 'Monthly watch time (when supported by Kick)')),
        tabs),
      body
    );
    load();
    return panel;
  }

  function homeView() {
    const c = state.config || {};
    const prizePool = prizePoolTotal(c);
    const race = c.race || { title: 'Wager Race', top: 10 };
    const copyMsg = h('span', { class: 'muted', role: 'status' });
    const copyBtn = h('button', {
      class: 'btn small secondary', type: 'button',
      onclick: async () => {
        try { await navigator.clipboard.writeText(c.code || 'Norochan'); copyMsg.textContent = 'Copied'; }
        catch { copyMsg.textContent = 'Press and hold the code to copy'; }
        setTimeout(() => (copyMsg.textContent = ''), 2500);
      },
    }, 'Copy code');
    const names = { discord: 'Discord', telegram: 'Telegram', x: 'X', youtube: 'YouTube', kick: 'Kick', instagram: 'Instagram' };
    const links = Object.entries(names).map(([k, label]) => {
      const link = c.links && c.links[k];
      if (!link) {
        const icon = socialIconForKey(k, label);
        return h('span', { class: 'btn secondary social-btn disabled-social', 'aria-disabled': 'true', title: 'Link coming soon' },
          icon ? h('span', { class: 'social-icon' }, icon) : null,
          h('span', { class: 'social-label' }, label));
      }
      return socialButton(k, label, link);
    });
    return h('div', { class: 'page-shell' },
      h('section', { class: 'hero-shell' },
        h('div', { class: 'hero-copy' },
          h('span', { class: 'eyebrow' }, 'VIP race club'),
          h('h1', {}, 'Play smarter. Win bigger.'),
          h('p', { class: 'lead' }, 'Join the Norochan wager race and unlock premium rewards with a trusted Stake code built for serious players.'),
          h('div', { class: 'cta-row' },
            h('a', { class: 'btn', href: c.referralUrl || '#/', target: '_blank', rel: 'noopener sponsored' }, 'Play on Stake'),
            h('a', { class: 'btn secondary', href: '#/leaderboard' }, 'See leaderboard')),
          h('div', { class: 'stat-grid' },
            h('div', { class: 'stat-card' }, h('span', { class: 'stat-label' }, 'Prize pool'), h('strong', {}, prizePool != null ? usd0(prizePool) + '+' : '—')),
            h('div', { class: 'stat-card' }, h('span', { class: 'stat-label' }, 'Top 10'), h('strong', {}, String(race.top || 10))),
            h('div', { class: 'stat-card' }, h('span', { class: 'stat-label' }, 'Season'), h('strong', {}, 'Oct 2026')))),
        h('div', { class: 'promo-panel' },
          h('div', { class: 'promo-top' },
            h('span', { class: 'chip glow' }, 'Live promo code')),
          h('div', { class: 'promo-code-box' },
            h('span', { class: 'label' }, 'My Stake code'),
            h('span', { class: 'code' }, c.code || 'Norochan')),
          h('div', { class: 'promo-actions' },
            copyBtn,
            h('a', { class: 'btn small', href: c.referralUrl || '#/', target: '_blank', rel: 'noopener sponsored' }, 'Open Stake')),
          copyMsg)),
      h('section', { class: 'info-strip' },
        h('div', { class: 'mini-card' }, h('strong', {}, 'Top rewards'), h('span', { class: 'muted' }, 'Cash prizes for the top performers')),
        h('div', { class: 'mini-card' }, h('strong', {}, 'Fast access'), h('span', { class: 'muted' }, 'Use code instantly on Stake')),
        h('div', { class: 'mini-card' }, h('strong', {}, 'Race mode'), h('span', { class: 'muted' }, 'Oct 1 to Oct 31, 2026'))),
      h('section', { class: 'dashboard-grid block-full' },
        kickLivePreview(),
        kickTopViewersSection()),
      h('section', { class: 'block' },
        h('div', { class: 'race-strip' },
          h('div', {}, h('strong', {}, race.title || 'Wager Race'), h('div', { class: 'muted' }, 'Top ' + (race.top || 10) + ' players win prizes')),
          h('a', { class: 'btn small', href: '#/leaderboard' }, 'View leaderboard'))),
      h('section', { class: 'block' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Community'), h('p', { class: 'muted' }, 'Official channels')),
        h('div', { class: 'links' }, links)));
  }

  async function leaderboardView() {
    const c = state.config;
    const out = h('div', { class: 'leaderboard-page' });
    const skeleton = h('div', { class: 'leaderboard-panel skeleton-leaderboard' },
      UI.skeletonBlock ? UI.skeletonBlock('skeleton-row', 'height:48px') : null,
      UI.skeletonBlock ? UI.skeletonBlock('skeleton-row', 'height:200px') : null,
      UI.skeletonBlock ? UI.skeletonBlock('skeleton-row', 'height:320px') : null
    );
    const body = h('div', { class: 'leaderboard-body' }, skeleton);
    out.append(body);
    app.replaceChildren(out);

    let data;
    try { data = await api('/api/leaderboard'); }
    catch (err) {
      body.replaceChildren(
        UI.errorState
          ? UI.errorState('Leaderboard couldn\'t be loaded.', err.message, () => leaderboardView())
          : h('p', { class: 'note warn' }, err.message)
      );
      return;
    }

    const formatMonthEndDate = (monthOffset = 0) => {
      const now = new Date();
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1, 0, 0, 0, 0));
      const lastDay = new Date(Date.UTC(startOfMonth.getUTCFullYear(), startOfMonth.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      return `${lastDay.getUTCDate()} ${new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(lastDay)} ${lastDay.getUTCFullYear()}`;
    };

    const leaderboardEndTimestamp = (monthOffset = 0) => {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1, 0, 0, 0, 0));
      const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      return monthEnd.getTime();
    };

    const buildPodium = (entries, monthOffset = 0) => {
      const ranked = [...(entries || [])].sort((a, b) => a.rank - b.rank).slice(0, 3);
      const podiumOrder = [2, 1, 3];
      const podiumMap = new Map(ranked.map((entry) => [entry.rank, entry]));
      const podium = h('div', { class: 'monthly-podium' });

      podiumOrder.forEach((rank) => {
        const entry = podiumMap.get(rank);
        const column = h('div', { class: 'podium-column rank-' + rank });
        if (entry) {
          const infoCard = h('div', { class: 'info-card ' + (rank === 1 ? 'first' : rank === 2 ? 'second' : 'third') },
            h('div', { class: 'info-name' }, entry.name),
            h('div', { class: 'info-boxes' },
              h('div', { class: 'info-box' }, h('div', { class: 'info-wagered' }, h('span', { class: 'info-icon' }, '$'), usd(entry.weighted))),
              h('div', { class: 'info-box' }, h('div', { class: 'info-prize' }, h('span', { class: 'info-icon' }, '🏆'), (entry.prize != null ? usd0(entry.prize) : '-')))));
          column.append(infoCard);
          const stand = h('div', { class: 'podium-stand' }, h('span', { class: 'podium-rank' }, rank));
          column.append(stand);
        }
        podium.append(column);
      });

      const watermark = h('div', { class: 'podium-watermark' }, 'Stake');
      podium.append(watermark);

      const endDateLabel = formatMonthEndDate(monthOffset);
      const footer = h('div', { class: 'leaderboard-footer' });
      if (monthOffset === 0) {
        footer.append(leaderboardCountdown(leaderboardEndTimestamp(0), 'LEADERBOARD ENDS IN'));
      } else {
        footer.append(
          h('div', { class: 'leaderboard-rule' }, 'LEADERBOARD ENDED'),
          h('div', { class: 'leaderboard-rules' }, endDateLabel)
        );
      }
      podium.append(footer);
      return podium;
    };

    const rankLabel = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank));

    const buildLeaderboardList = (entries) => {
      const list = h('div', { class: 'leaderboard-list', role: 'list' });
      for (const e of (entries || [])) {
        list.append(h('div', {
          class: ['leaderboard-row', e.rank <= 3 ? 'top3' : '', e.you ? 'you' : ''].filter(Boolean).join(' '),
          role: 'listitem',
        },
        h('span', { class: 'rank-num' + (e.rank <= 3 ? ' rank-medal' : '') }, rankLabel(e.rank)),
        h('div', { class: 'leaderboard-player' },
          UI.initialsAvatar ? UI.initialsAvatar(e.name) : null,
          h('span', { class: 'leaderboard-name' }, e.name, e.you ? ' (you)' : '')),
        h('span', { class: 'leaderboard-wagered' }, usd(e.weighted)),
        h('span', { class: 'leaderboard-prize' }, e.prize != null ? usd0(e.prize) : '—')));
      }
      return list;
    };

    const buildMonthContent = (entries, monthOffset, extraHint) => {
      const frag = h('div', {});
      if (entries && entries.length) {
        frag.append(buildPodium(entries, monthOffset), buildLeaderboardList(entries));
      } else {
        frag.append(UI.emptyState
          ? UI.emptyState('No wager data yet.', 'Rankings appear once players wager under the code.')
          : h('p', { class: 'note' }, 'No wagers recorded yet.'));
      }
      if (extraHint) frag.append(extraHint);
      return frag;
    };

    const pool = prizePoolTotal(c);
    const kids = [];
    kids.push(h('div', { class: 'monthly-header' },
      h('h1', {}, (c && c.race && c.race.title) || 'Stake leaderboard'),
      h('p', { class: 'muted' }, pool != null ? ('Prize pool ' + usd0(pool) + ' USD · Top ' + (c.race.top || 10)) : 'All prizes in USD')));
    if (data.stale) kids.push(h('p', { class: 'note warn' }, 'The latest refresh failed, so these numbers may be a little behind.'));
    if (data.status !== 'ok') {
      kids.push(h('p', { class: 'note warn' }, data.message || 'Leaderboard temporarily unavailable'));
    }

    const currentView = h('div', { class: 'leaderboard-view active', role: 'tabpanel', id: 'lb-panel-current' });
    const previousView = h('div', { class: 'leaderboard-view', role: 'tabpanel', id: 'lb-panel-previous', hidden: true });
    const monthTabs = h('div', { class: 'ui-tabs leaderboard-tabs', role: 'tablist', 'aria-label': 'Leaderboard month' });

    const hasAny = (data.entries && data.entries.length) || (data.previous && data.previous.entries && data.previous.entries.length);
    if (!state.me && hasAny) {
      kids.push(h('p', { class: 'muted' }, h('a', { href: '#/account' }, 'Log in'), ' and add your Stake username to highlight your row.'));
    }

    const currentBtn = h('button', { type: 'button', class: 'ui-tab active', role: 'tab', 'aria-selected': 'true', 'aria-controls': 'lb-panel-current', id: 'lb-tab-current' }, 'Current month');
    const previousBtn = h('button', { type: 'button', class: 'ui-tab', role: 'tab', 'aria-selected': 'false', 'aria-controls': 'lb-panel-previous', id: 'lb-tab-previous' }, 'Previous month');

    const syncTabs = (view) => {
      const isCurrent = view === 'current';
      currentBtn.classList.toggle('active', isCurrent);
      previousBtn.classList.toggle('active', !isCurrent);
      currentBtn.setAttribute('aria-selected', String(isCurrent));
      previousBtn.setAttribute('aria-selected', String(!isCurrent));
      currentView.classList.toggle('active', isCurrent);
      previousView.classList.toggle('active', !isCurrent);
      currentView.hidden = !isCurrent;
      previousView.hidden = isCurrent;
    };

    currentBtn.addEventListener('click', () => syncTabs('current'));
    previousBtn.addEventListener('click', () => syncTabs('previous'));
    monthTabs.append(currentBtn, previousBtn);

    currentView.append(buildMonthContent(data.entries, 0));
    if (data.previous && data.previous.entries && data.previous.entries.length) {
      previousView.append(buildMonthContent(data.previous.entries, -1, h('p', { class: 'muted hint' }, 'Historical standings for the previous month.')));
    } else if (data.previous && data.previous.status === 'pending') {
      previousView.append(h('p', { class: 'muted' }, 'Previous month leaderboard is loading…'));
    } else {
      previousView.append(UI.emptyState
        ? UI.emptyState('No previous month data', 'Check back after the prior period completes.')
        : h('p', { class: 'note' }, 'No previous month data yet.'));
    }

    const viewport = h('div', { class: 'leaderboard-viewport' }, currentView, previousView);
    const panel = h('div', { class: 'leaderboard-panel' },
      h('div', { class: 'leaderboard-panel-head' },
        h('h2', { class: 'muted', style: 'font-size:var(--text-label);letter-spacing:0.14em;text-transform:uppercase;margin:0' }, 'Top players'),
        monthTabs),
      viewport
    );
    kids.push(panel);
    body.replaceChildren(...kids);
  }

  function accountView() {
    return state.me ? profileView() : authView();
  }

  function authView() {
    let mode = 'signup';
    const msg = h('p', { class: 'msg', role: 'alert' });
    const email = h('input', { type: 'email', id: 'email', autocomplete: 'email', required: true, maxlength: '254' });
    const pw = h('input', { type: 'password', id: 'pw', required: true, minlength: '8', maxlength: '128' });
    const submit = h('button', { class: 'btn', type: 'submit' }, 'Create account');
    const tabSign = h('button', { type: 'button', role: 'tab', 'aria-selected': 'true' }, 'Sign up');
    const tabLog = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false' }, 'Log in');
    function setMode(m) {
      mode = m;
      tabSign.setAttribute('aria-selected', String(m === 'signup'));
      tabLog.setAttribute('aria-selected', String(m === 'login'));
      submit.textContent = m === 'signup' ? 'Create account' : 'Log in';
      pw.setAttribute('autocomplete', m === 'signup' ? 'new-password' : 'current-password');
      msg.textContent = '';
    }
    tabSign.addEventListener('click', () => setMode('signup'));
    tabLog.addEventListener('click', () => setMode('login'));
    setMode('signup');
    const googleButton = h('button', {
      class: 'btn secondary',
      type: 'button',
      onclick: () => { window.location.href = '/auth/google'; },
    }, 'Continue with Google');
    const kickButton = h('button', {
      class: 'btn secondary',
      type: 'button',
      onclick: () => { window.location.href = '/auth/kick'; },
    }, 'Continue with Kick');
    const form = h('form', {
      novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault();
        msg.className = 'msg'; msg.textContent = '';
        submit.disabled = true;
        try {
          await api(mode === 'signup' ? '/api/signup' : '/api/login', { email: email.value, password: pw.value });
          await refreshMe();
          route();
        } catch (err) { msg.className = 'msg error'; msg.textContent = err.message; }
        finally { submit.disabled = false; }
      },
    },
      h('label', { for: 'email' }, 'Email'), email,
      h('label', { for: 'pw' }, 'Password'), pw,
      h('p', { class: 'hint' }, 'At least 8 characters.'),
      submit, msg);
    return h('div', {}, h('h1', {}, 'Account'),
      h('p', { class: 'muted' }, 'Make an account to link your Stake and Kick usernames and find yourself on the leaderboard.'),
      h('div', { class: 'card' },
        h('div', { class: 'tabs', role: 'tablist' }, tabSign, tabLog),
        h('div', { class: 'actions' }, googleButton, kickButton),
        form));
  }

  function profileView() {
    const me = state.me;
    const msg = h('p', { class: 'msg', role: 'status' });
    const stake = h('input', { id: 'stake', value: me.stakeUsername || '', autocomplete: 'off', maxlength: '40', autocapitalize: 'off' });
    const save = h('button', { class: 'btn', type: 'submit' }, 'Save username');
    const statusBox = h('div');
    const kickField = h('input', {
      id: 'kick',
      value: me.kickUsername || '',
      autocomplete: 'off',
      maxlength: '25',
      autocapitalize: 'off',
      readonly: true,
      disabled: !me.kickVerified,
    });
    const kickButton = h('button', {
      class: 'btn secondary',
      type: 'button',
      onclick: () => { window.location.href = '/auth/kick'; },
    }, me.kickVerified ? 'Reconnect Kick' : 'Connect Kick');
    function renderStatus() {
      const m = state.me;
      const bits = [];
      if (!m.stakeUsername) {
        bits.push(h('p', { class: 'muted' }, 'Add your Stake username to check it against code ' + state.config.code + '.'));
      } else {
        const label = m.referral === 'found'
          ? 'code verified'
          : m.referral === 'not_found'
            ? 'not under code'
            : 'coming soon';
        const statusClass = m.referral === 'found' ? 'found' : 'unknown';
        bits.push(h('p', {}, 'Referral status: ', h('span', { class: 'status ' + statusClass }, label)));
        if (m.referral === 'found') {
          bits.push(h('p', { class: 'hint' }, 'This username is linked to code ' + state.config.code + '.'));
        } else if (m.referral === 'not_found') {
          bits.push(h('p', { class: 'hint' }, 'This username is not under code ' + state.config.code + '.'));
        } else {
          bits.push(h('p', { class: 'hint' }, 'Referral checks are coming soon.'));
        }
        bits.push(m.leaderboardRank
          ? h('p', {}, 'You are #' + m.leaderboardRank + ' on the ', h('a', { href: '#/leaderboard' }, 'leaderboard'), '.')
          : h('p', { class: 'muted' }, 'You are not in the top ' + state.config.race.top + ' yet.'));
      }
      statusBox.replaceChildren(...bits);
    }
    renderStatus();
    const stakeBlock = me.stakeUsername
      ? h('div', { class: 'card slim' },
          h('label', {}, 'Stake username'),
          h('div', { class: 'status read-only' }, me.stakeUsername),
          h('p', { class: 'hint' }, 'This Stake username is locked after first save. Contact Support to request a change.'))
      : h('div', { class: 'card slim' },
          h('label', { for: 'stake' }, 'Stake username'), stake,
          h('p', { class: 'hint' }, 'Add your Stake username to check it against code ' + state.config.code + '.'));
    const form = h('form', {
      novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault();
        msg.className = 'msg'; msg.textContent = '';
        save.disabled = true;
        try {
          state.me = (await api('/api/profile', { stakeUsername: stake.value })).user;
          renderStatus();
          msg.className = 'msg ok'; msg.textContent = 'Saved';
        } catch (err) { msg.className = 'msg error'; msg.textContent = err.message; }
        finally { save.disabled = false; }
      },
    },
      stakeBlock,
      h('div', { class: 'card slim' },
        h('label', { for: 'kick' }, 'Kick username'), kickField,
        h('p', { class: 'hint' }, me.kickVerified ? 'Verified from Kick and read-only here.' : 'Connect Kick to verify your username.'),
        kickButton),
      !me.stakeUsername && save,
      msg);
    const logout = h('button', {
      class: 'btn secondary small', type: 'button',
      onclick: async () => { try { await api('/api/logout', {}); } catch (e) { /* ignore */ } state.me = null; await refreshMe(); route(); },
    }, 'Log out');
    startReferralPolling();
    return h('div', {}, h('h1', {}, 'My account'),
      h('p', { class: 'muted' }, 'Signed in as ' + (me.email || 'No email on file')),
      h('div', { class: 'card' }, form),
      h('div', { class: 'card' }, h('h2', {}, 'Status'), statusBox),
      logout);
  }

  // ---------- router ----------
  async function route() {
    stopTimer();
    const name = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
    for (const a of document.querySelectorAll('[data-route]')) {
      if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    if (name === 'leaderboard') { await leaderboardView(); }
    else if (name === 'account') { await refreshMe(); app.replaceChildren(accountView()); }
    else { app.replaceChildren(homeView()); }
    window.scrollTo(0, 0);
  }

  async function init() {
    try { state.config = await api('/api/config'); }
    catch (err) { app.replaceChildren(h('p', { class: 'note warn' }, 'Could not load the site. Refresh the page.')); return; }
    document.title = state.config.name;
    await refreshMe();
    window.addEventListener('hashchange', route);
    route();
  }
  init();
})();
