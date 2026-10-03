'use strict';
(function () {
  const app = document.getElementById('app');
  const state = { config: null, rewards: null };
  let timer = null;
  let kickPollTimer = null;

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
  async function api(path) {
    const res = await fetch(path);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    return data;
  }
  const usd = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd0 = (n) => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const UI = window.NoroUI || {};
  const rewardFigure = (key) => {
    const v = state.rewards && state.rewards[key];
    return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  };
  const formatRaceWindow = (race) => {
    if (!race || !race.startsAt || !race.endsAt) return '';
    const fmt = (ts) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(ts));
    return fmt(race.startsAt) + ' – ' + fmt(race.endsAt) + ' UTC';
  };
  const formatUpdated = (ts) => {
    if (!ts) return '';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
  };

  function socialIconForKey(key, label) {
    const image = h('img', {
      src: '/' + key + '.png',
      alt: '',
      class: 'social-logo',
      loading: 'lazy',
      decoding: 'async',
    });
    image.addEventListener('error', () => {
      image.replaceWith(document.createTextNode((label || key).slice(0, 1)));
    });
    return image;
  }
  const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
  const stopKickPoll = () => { if (kickPollTimer) { clearInterval(kickPollTimer); kickPollTimer = null; } };

  const root = document.documentElement;
  try {
    const t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') root.dataset.theme = t;
  } catch (e) { /* storage blocked */ }
  function syncThemeUi() {
    const light = root.dataset.theme === 'light';
    const label = light ? 'Switch to dark theme' : 'Switch to light theme';
    const themeBtn = document.getElementById('theme');
    const themeMobile = document.getElementById('theme-mobile');
    if (themeBtn) themeBtn.setAttribute('aria-label', label);
    if (themeMobile) themeMobile.setAttribute('aria-label', label);
    const mobileLabel = document.querySelector('.theme-mobile-label');
    if (mobileLabel) mobileLabel.textContent = light ? 'Dark theme' : 'Light theme';
  }
  function toggleTheme() {
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) { /* ignore */ }
    syncThemeUi();
  }
  const themeBtn = document.getElementById('theme');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  const themeMobile = document.getElementById('theme-mobile');
  if (themeMobile) themeMobile.addEventListener('click', toggleTheme);
  syncThemeUi();

  const mobileNav = document.getElementById('mobile-nav');
  const navToggle = document.getElementById('nav-toggle');
  const mobileNavClose = document.getElementById('mobile-nav-close');
  function setMobileNav(open) {
    if (!mobileNav || !navToggle) return;
    mobileNav.classList.toggle('open', open);
    mobileNav.setAttribute('aria-hidden', open ? 'false' : 'true');
    if ('inert' in mobileNav) mobileNav.inert = !open;
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('nav-open', open);
    if (open && mobileNavClose) mobileNavClose.focus();
    else if (!open) navToggle.focus();
  }
  if (navToggle) navToggle.addEventListener('click', () => setMobileNav(!mobileNav.classList.contains('open')));
  if (mobileNavClose) mobileNavClose.addEventListener('click', () => setMobileNav(false));
  if (mobileNav) {
    mobileNav.addEventListener('click', (ev) => { if (ev.target === mobileNav) setMobileNav(false); });
    mobileNav.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', () => setMobileNav(false)));
    mobileNav.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { setMobileNav(false); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...mobileNav.querySelectorAll('a, button')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && mobileNav && mobileNav.classList.contains('open')) setMobileNav(false);
  });
  window.addEventListener('resize', () => {
    document.querySelectorAll('.ui-tabs').forEach((tabs) => { if (tabs._refreshTabs) tabs._refreshTabs(); });
  });

  function countdownBox(race) {
    const cells = {};
    const wrap = h('div', { class: 'countdown', role: 'timer', 'aria-label': 'Race countdown' });
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
      else { target = now; text = 'The race has ended. Final standings are on the leaderboard.'; }
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
    const wrap = h('div', { class: 'countdown', role: 'timer', 'aria-label': captionText });
    for (const [key, label] of [['d', 'days'], ['h', 'hours'], ['m', 'minutes'], ['s', 'seconds']]) {
      cells[key] = h('b', {}, '0');
      wrap.append(h('div', {}, cells[key], h('span', {}, label)));
    }
    function tick() {
      const now = Date.now();
      const totalSeconds = Math.max(0, Math.ceil((targetTime - now) / 1000));
      cells.d.textContent = String(Math.floor(totalSeconds / 86400));
      cells.h.textContent = String(Math.floor((totalSeconds % 86400) / 3600)).padStart(2, '0');
      cells.m.textContent = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
      cells.s.textContent = String(totalSeconds % 60).padStart(2, '0');
    }
    tick();
    stopTimer();
    timer = setInterval(tick, 1000);
    return h('div', { class: 'leaderboard-countdown-wrap' }, h('div', { class: 'leaderboard-rule' }, captionText), wrap);
  }

  function listSkeleton(rows) {
    const wrap = h('div', { class: 'skeleton-leaderboard', role: 'status', 'aria-label': 'Loading' });
    for (let i = 0; i < rows; i++) wrap.append(UI.skeletonBlock ? UI.skeletonBlock('skeleton-row') : h('div', { class: 'ui-skeleton skeleton-row' }));
    return wrap;
  }

  function podium(entries) {
    const byRank = new Map((entries || []).map((entry) => [entry.rank, entry]));
    const board = h('div', { class: 'podium', 'aria-label': 'Top three' });
    for (const rank of [2, 1, 3]) {
      const entry = byRank.get(rank);
      const col = h('div', { class: 'podium-col rank-' + rank });
      if (entry) {
        col.append(
          h('div', { class: 'podium-card' },
            h('div', { class: 'podium-name' }, entry.name),
            h('div', { class: 'podium-metrics' },
              h('span', { class: 'podium-wager' }, usd(entry.weighted)),
              h('span', { class: 'podium-prize' }, entry.prize != null ? usd0(entry.prize) : '—'))),
          h('div', { class: 'podium-stand', 'aria-hidden': 'true' }, String(rank))
        );
      }
      board.append(col);
    }
    return board;
  }

  function rankedList(entries) {
    const list = h('div', { class: 'leaderboard-list', role: 'list' });
    list.append(h('div', { class: 'leaderboard-row leaderboard-head', role: 'presentation' },
      h('span', {}, 'Rank'),
      h('span', {}, 'Player'),
      h('span', { class: 'num' }, 'Wagered')));
    for (const e of entries || []) {
      list.append(h('div', {
        class: ['leaderboard-row', e.rank <= 3 ? 'top3' : '', e.rank <= 3 ? 'rank-' + e.rank : ''].filter(Boolean).join(' '),
        role: 'listitem',
      },
      h('span', { class: 'rank-num' }, String(e.rank).padStart(2, '0')),
      h('div', { class: 'leaderboard-player' },
        UI.initialsAvatar ? UI.initialsAvatar(e.name) : null,
        h('span', { class: 'leaderboard-name' }, e.name)),
      h('div', { class: 'leaderboard-stats' },
        h('span', { class: 'leaderboard-wagered' }, usd(e.weighted)),
        h('span', { class: 'leaderboard-prize' }, e.prize != null ? usd0(e.prize) + ' prize' : 'No prize'))));
    }
    return list;
  }

  function monthTabs(idPrefix, label, onChange) {
    const tabs = h('div', { class: 'ui-tabs', role: 'tablist', 'aria-label': label });
    const currentBtn = h('button', { type: 'button', class: 'ui-tab active', role: 'tab', 'aria-selected': 'true', id: idPrefix + '-current' }, 'Current month');
    const previousBtn = h('button', { type: 'button', class: 'ui-tab', role: 'tab', 'aria-selected': 'false', id: idPrefix + '-previous', tabindex: '-1' }, 'Previous month');
    function select(period) {
      const isCurrent = period === 'current';
      currentBtn.classList.toggle('active', isCurrent);
      previousBtn.classList.toggle('active', !isCurrent);
      currentBtn.setAttribute('aria-selected', String(isCurrent));
      previousBtn.setAttribute('aria-selected', String(!isCurrent));
      currentBtn.tabIndex = isCurrent ? 0 : -1;
      previousBtn.tabIndex = isCurrent ? -1 : 0;
      if (tabs._refreshTabs) tabs._refreshTabs();
      onChange(period);
    }
    currentBtn.addEventListener('click', () => select('current'));
    previousBtn.addEventListener('click', () => select('previous'));
    tabs.append(currentBtn, previousBtn);
    if (UI.mountTabs) UI.mountTabs(tabs);
    return tabs;
  }

  function refreshTabIndicators() {
    document.querySelectorAll('.ui-tabs').forEach((tabs) => { if (tabs._refreshTabs) tabs._refreshTabs(); });
  }

  function kickLivePreview() {
    const card = h('section', { class: 'kick-live-card', 'data-live': 'false', 'aria-labelledby': 'kick-live-heading' });
    const badgeSlot = h('div', {});
    const mediaWrap = h('div', { class: 'kick-live-media' });
    const channelEl = h('p', { class: 'kick-channel-name', id: 'kick-live-heading' }, 'Kick');
    const title = h('div', { class: 'kick-live-title' }, 'Loading live status…');
    const meta = h('div', { class: 'kick-live-meta' });
    const actions = h('div', { class: 'kick-live-actions' });
    const errorSlot = h('div', {});

    function renderSkeleton() {
      card.setAttribute('aria-busy', 'true');
      badgeSlot.replaceChildren(UI.skeletonBlock ? UI.skeletonBlock('sk-badge') : h('span', { class: 'muted' }, 'Loading'));
      mediaWrap.replaceChildren(UI.skeletonBlock ? UI.skeletonBlock('sk-media') : h('div', { class: 'kick-live-placeholder' }, 'Stream preview'));
      channelEl.textContent = 'Kick';
      title.textContent = 'Loading live status…';
      meta.replaceChildren();
      actions.replaceChildren();
      errorSlot.replaceChildren();
    }

    function render(data, failed) {
      card.setAttribute('aria-busy', 'false');
      const safeData = data || {
        status: 'unavailable',
        channel: (state.config && state.config.kickChannel) || 'norochan',
        url: (state.config && state.config.kickChannelUrl) || 'https://kick.com',
        title: null,
        viewers: null,
        thumbnail: null,
      };
      const channelName = safeData.channel || 'norochan';
      const live = safeData.status === 'live';
      const offline = safeData.status === 'offline';
      const unavailable = failed || safeData.status === 'unavailable';
      card.setAttribute('data-live', live ? 'true' : 'false');
      syncNavLive(safeData);
      badgeSlot.replaceChildren(UI.liveBadge ? UI.liveBadge(live ? 'live' : offline ? 'offline' : unavailable ? 'unavailable' : 'pending') : h('span', { class: 'ui-badge' }, live ? 'Live now' : 'Offline'));

      mediaWrap.replaceChildren();
      if (live && safeData.thumbnail) {
        const img = h('img', { src: safeData.thumbnail, alt: channelName + ' live stream preview', class: 'kick-live-thumb', loading: 'lazy' });
        img.addEventListener('error', () => mediaWrap.replaceChildren(h('div', { class: 'kick-live-placeholder' }, 'Stream preview')));
        mediaWrap.append(img);
      } else if (offline) {
        const overlay = h('div', { class: 'kick-live-offline' + (safeData.thumbnail ? ' is-overlay' : '') },
          h('span', { class: 'offline-mark', 'aria-hidden': 'true' }),
          h('p', {}, 'Offline right now'),
          h('p', { class: 'muted' }, 'A stream preview appears here when the channel goes live.'));
        if (safeData.thumbnail) {
          const img = h('img', { src: safeData.thumbnail, alt: '', class: 'kick-live-thumb is-dim' });
          img.addEventListener('error', () => { img.remove(); overlay.classList.remove('is-overlay'); });
          mediaWrap.append(img, overlay);
        } else mediaWrap.append(overlay);
      } else {
        mediaWrap.append(h('div', { class: 'kick-live-placeholder' }, live ? 'Stream preview' : 'Status unavailable'));
      }

      channelEl.textContent = channelName;
      title.textContent = live ? (safeData.title || 'Live now') : offline ? 'Not streaming' : 'Status unavailable';

      meta.replaceChildren();
      if (live && safeData.viewers != null) {
        meta.append(h('span', { class: 'viewers' }, safeData.viewers.toLocaleString() + ' viewers'));
      } else if (live) {
        meta.textContent = 'Viewer count unavailable';
      } else if (offline) {
        meta.textContent = 'Kick channel';
      }

      actions.replaceChildren();
      const openUrl = safeData.url || ('https://kick.com/' + channelName);
      if (!unavailable) {
        actions.append(h('a', { class: 'btn small', href: openUrl, target: '_blank', rel: 'noopener noreferrer' }, live ? 'Watch live' : 'View channel'));
      }

      errorSlot.replaceChildren();
      if (unavailable) {
        errorSlot.append(UI.errorState
          ? UI.errorState('Unable to load live status.', 'Check your connection, then try again.', () => poll(true))
          : h('p', { class: 'note warn' }, 'Unable to load live status.'));
      }
    }

    async function poll(manual) {
      if (manual) renderSkeleton();
      try {
        render(await api('/api/kick-live'), false);
      } catch {
        render(null, true);
      }
    }

    card.append(
      h('div', { class: 'kick-live-top' }, badgeSlot),
      mediaWrap,
      h('div', { class: 'kick-live-copy' },
        channelEl,
        title,
        h('div', { class: 'kick-live-footer' }, meta, actions)),
      errorSlot
    );
    renderSkeleton();
    poll(false);
    stopKickPoll();
    kickPollTimer = setInterval(() => poll(false), 45000);
    return card;
  }

  function leaderboardPreview() {
    const panel = h('section', { id: 'home-leaderboard', class: 'board-card section-block', 'data-spy': 'leaderboard', 'aria-labelledby': 'home-board-heading' });
    const body = h('div', {});
    let cached = null;
    let period = 'current';

    function renderPeriod() {
      if (!cached) return;
      const pack = period === 'current' ? cached : (cached.previous || {});
      const entries = (pack.entries || []).slice(0, 5);
      if ((pack.status === 'pending' || !pack.status) && !entries.length) {
        body.replaceChildren(listSkeleton(5));
        return;
      }
      if (pack.status === 'error' && !entries.length) {
        body.replaceChildren(UI.errorState
          ? UI.errorState('Leaderboard couldn\'t be loaded.', 'The latest standings are unavailable right now.', load)
          : h('p', { class: 'note warn' }, 'Leaderboard couldn\'t be loaded.'));
        return;
      }
      if (!entries.length) {
        body.replaceChildren(UI.emptyState
          ? UI.emptyState('No wager data yet.', 'Rankings appear once players wager under the code.')
          : h('p', { class: 'note' }, 'No wager data yet.'));
        return;
      }
      body.replaceChildren(rankedList(entries));
    }

    async function load() {
      body.replaceChildren(listSkeleton(5));
      try {
        cached = await api('/api/leaderboard');
        renderPeriod();
      } catch {
        body.replaceChildren(UI.errorState
          ? UI.errorState('Leaderboard couldn\'t be loaded.', 'Please try again in a moment.', load)
          : h('p', { class: 'note warn' }, 'Leaderboard couldn\'t be loaded.'));
      }
    }

    const tabs = monthTabs('home-board', 'Leaderboard month', (next) => {
      period = next;
      renderPeriod();
    });
    panel.append(
      h('div', { class: 'board-card-head' },
        h('div', {},
          h('h2', { id: 'home-board-heading' }, 'Leaderboard'),
          h('p', { class: 'muted' }, 'Rewarding players who wager under the code.')),
        tabs),
      body,
      h('div', { class: 'board-foot' }, h('a', { class: 'btn small secondary', href: '#/leaderboard' }, 'View full leaderboard'))
    );
    load();
    return panel;
  }

  const watchTimeText = (secs) => {
    const mins = Math.floor(Number(secs) / 60);
    const hrs = Math.floor(mins / 60);
    return hrs ? hrs.toLocaleString('en-US') + 'h ' + String(mins % 60).padStart(2, '0') + 'm' : mins + 'm';
  };
  const pointsText = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' pts';
  const monthName = (month, year) => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));

  function viewerAvatar(e) {
    const fallback = () => (UI.initialsAvatar ? UI.initialsAvatar(e.username) : h('span', { class: 'avatar', 'aria-hidden': 'true' }, '?'));
    if (!e.avatar) return fallback();
    const img = h('img', { class: 'avatar avatar-img', src: e.avatar, alt: '', width: 36, height: 36, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
    return img;
  }

  function viewerMetrics(e, data) {
    const primary = data.watchTimeAvailable && e.watchTime != null ? watchTimeText(e.watchTime) : (e.points != null ? pointsText(e.points) : '—');
    const extra = [];
    if (data.watchTimeAvailable && e.points != null) extra.push([pointsText(e.points), '']);
    if (e.level != null) extra.push(['Lvl ' + e.level, 'viewer-level']);
    if (e.reward != null) extra.push([usd0(e.reward) + ' reward', '']);
    const secondary = extra.length
      ? extra.map(([text, cls], i) => h('span', { class: cls || null }, (i ? ' · ' : '') + text))
      : null;
    return { primary, secondary };
  }

  function viewerPodium(data) {
    const byRank = new Map(data.entries.map((e) => [e.rank, e]));
    const board = h('div', { class: 'podium viewer-podium', 'aria-label': 'Top three viewers' });
    for (const rank of [2, 1, 3]) {
      const e = byRank.get(rank);
      const col = h('div', { class: 'podium-col rank-' + rank });
      if (e) {
        const m = viewerMetrics(e, data);
        col.append(
          h('div', { class: 'podium-card' },
            h('div', { class: 'podium-avatar' }, viewerAvatar(e)),
            h('div', { class: 'podium-name' }, e.username),
            h('div', { class: 'podium-metrics' },
              h('span', { class: 'podium-wager' }, m.primary),
              m.secondary ? h('span', { class: 'podium-prize' }, m.secondary) : null)),
          h('div', { class: 'podium-stand', 'aria-hidden': 'true' }, String(rank)));
      }
      board.append(col);
    }
    return board;
  }

  function viewerList(data) {
    const list = h('div', { class: 'leaderboard-list viewer-list', role: 'list' });
    list.append(h('div', { class: 'leaderboard-row leaderboard-head', role: 'presentation' },
      h('span', {}, 'Rank'),
      h('span', {}, 'Viewer'),
      h('span', { class: 'num' }, data.watchTimeAvailable ? 'Watch time' : 'Points')));
    for (const e of data.entries) {
      const m = viewerMetrics(e, data);
      list.append(h('div', {
        class: ['leaderboard-row', e.rank <= 3 ? 'top3 rank-' + e.rank : ''].filter(Boolean).join(' '),
        role: 'listitem',
      },
      h('span', { class: 'rank-num' }, String(e.rank).padStart(2, '0')),
      h('div', { class: 'leaderboard-player' }, viewerAvatar(e), h('span', { class: 'leaderboard-name' }, e.username)),
      h('div', { class: 'leaderboard-stats' },
        h('span', { class: 'leaderboard-wagered' }, m.primary),
        m.secondary ? h('span', { class: 'leaderboard-prize' }, m.secondary) : null)));
    }
    return list;
  }

  function kickTopViewersSection() {
    const panel = h('section', { class: 'board-card viewer-board', 'aria-labelledby': 'kick-viewers-heading' });
    const body = h('div', { 'aria-live': 'polite' });
    const cache = {};
    let period = 'current';
    let request = 0;

    const empty = (title, text) => (UI.emptyState ? UI.emptyState(title, text) : h('p', { class: 'note' }, title));
    const failed = (text) => (UI.errorState
      ? UI.errorState('Top viewers couldn\'t be loaded.', text, () => { delete cache[period]; load(); })
      : h('p', { class: 'note warn' }, 'Top viewers couldn\'t be loaded.'));

    function render(data) {
      if (data.available === false) {
        body.replaceChildren(empty('Top viewers is coming soon.', 'Watch-time rankings will appear here once the BotRix leaderboard is connected.'));
        return;
      }
      if (data.status === 'error') { body.replaceChildren(failed('BotRix is unreachable right now. Please try again later.')); return; }
      if (data.status === 'pending') { body.replaceChildren(empty('Syncing with BotRix…', 'This month\'s viewer rankings will appear shortly.')); return; }
      const label = data.month && data.year ? monthName(data.month, data.year) : '';
      if (!data.entries || !data.entries.length) {
        body.replaceChildren(period === 'previous'
          ? empty('No standings saved for ' + (label || 'last month') + '.', 'Final standings are saved automatically at the end of each month.')
          : empty('No viewers ranked yet.', 'Rankings appear as viewers watch and chat during streams.'));
        return;
      }
      const meta = [label];
      if (data.final) meta.push('Final standings');
      else if (data.updatedAt) meta.push('Updated ' + formatUpdated(data.updatedAt));
      body.replaceChildren(...[
        h('p', { class: 'leaderboard-rule' }, meta.filter(Boolean).join(' · ')),
        viewerPodium(data),
        viewerList(data),
        data.stale ? h('p', { class: 'note warn' }, 'The latest BotRix sync failed, so these numbers may be a little behind.') : null,
        h('p', { class: 'muted hint' }, 'Watch time and points are tracked by BotRix for viewers active in chat.'),
      ].filter(Boolean));
    }

    async function load() {
      const mine = ++request;
      const wanted = period;
      if (cache[wanted]) { render(cache[wanted]); return; }
      body.replaceChildren(listSkeleton(3));
      try {
        const res = await fetch('/api/viewers/' + wanted);
        const data = await res.json().catch(() => null);
        if (!data || (!res.ok && data.available !== false)) throw new Error('bad response');
        if (data.status !== 'pending') cache[wanted] = data;
        if (mine === request) render(data);
      } catch {
        if (mine === request) body.replaceChildren(failed('Unable to reach the server.'));
      }
    }

    panel.append(
      h('div', { class: 'board-card-head' },
        h('div', {},
          h('h2', { id: 'kick-viewers-heading' }, 'Top viewers'),
          h('p', { class: 'muted' }, 'Monthly watch time on Kick, powered by BotRix')),
        monthTabs('kick-viewers', 'Viewer month', (next) => { period = next; load(); })),
      body
    );
    load();
    return panel;
  }

  const sticker = (name, cls) => h('img', {
    class: 'sticker ' + cls, src: '/img/stickers/' + name + '.png', alt: '',
    width: 256, height: 256, loading: 'lazy', decoding: 'async', draggable: 'false',
  });
  const decor = (cls, items) => h('div', { class: 'decor ' + cls, 'aria-hidden': 'true' }, items.map(([name, c]) => sticker(name, c)));
  const rewardStickers = { 1: 'trophy', 2: 'medal-2', 3: 'medal-3', 4: 'gem', 5: 'money-bag', 6: 'coin', 7: 'gift', 8: 'party', 9: 'die', 10: 'sparkles' };

  function rewardFiller(slots) {
    const lg = (3 - (slots % 3)) % 3;
    const md = (2 - (slots % 2)) % 2;
    if (!lg && !md) return null;
    return h('article', { class: 'reward-card reward-filler fill-lg-' + lg + ' fill-md-' + md, 'aria-hidden': 'true' },
      decor('decor-filler', [['gift', 's-gift'], ['party', 's-party'], ['die', 's-die'], ['sparkles', 's-spark'], ['coin', 's-coin']]),
      h('span', { class: 'reward-kicker' }, 'Good luck this month'),
      h('p', { class: 'muted' }, '18+ · Play responsibly'));
  }

  function homeView() {
    const c = state.config || {};
    const prizePool = rewardFigure('currentPrizePool');
    const rewardsNote = state.rewards && (state.rewards.note || (state.rewards.updatedAt ? 'Figures updated ' + state.rewards.updatedAt + '.' : null));
    const payoutRows = [
      { key: 'leaderboardPayout', label: 'Leaderboard payout' },
      { key: 'levelUpBonus', label: 'Level up bonus' },
      { key: 'socialMediaGiveaways', label: 'Social media giveaways' },
    ];
    const race = c.race || { title: 'Wager Race', top: 10 };
    const copyMsg = h('span', { class: 'muted', role: 'status' });
    const copyBtn = h('button', {
      class: 'btn small secondary', type: 'button',
      onclick: async () => {
        try { await navigator.clipboard.writeText(c.code || 'Norochan'); copyMsg.textContent = 'Copied ✓'; }
        catch { copyMsg.textContent = 'Select the code to copy it'; }
        setTimeout(() => { copyMsg.textContent = ''; }, 2500);
      },
    }, 'Copy code');
    const blurbs = {
      discord: 'Join the Norochan community.',
      telegram: 'Community messages.',
      x: 'Posts and updates.',
      youtube: 'Videos from the channel.',
      kick: 'Watch the stream on Kick.',
      instagram: 'Photos and clips.',
    };
    const names = { discord: 'Discord', telegram: 'Telegram', x: 'X', youtube: 'YouTube', kick: 'Kick', instagram: 'Instagram' };
    const links = Object.entries(names).map(([k, label]) => {
      const link = c.links && c.links[k];
      const copy = h('span', { class: 'community-copy' },
        h('span', { class: 'social-label' }, label),
        h('span', { class: 'muted' }, blurbs[k] || 'Official channel'));
      if (!link) {
        return h('span', { class: 'community-card disabled-social', 'aria-disabled': 'true', title: 'Link coming soon' },
          h('span', { class: 'social-icon' }, socialIconForKey(k, label)),
          copy);
      }
      return h('a', { class: 'community-card', href: link, target: '_blank', rel: 'noopener noreferrer' },
        h('span', { class: 'social-icon' }, socialIconForKey(k, label)),
        copy,
        h('span', { class: 'community-cta' }, 'Open'));
    });
    const kickUrl = c.kickChannelUrl || 'https://kick.com/norochan';
    const discordUrl = (c.links && c.links.discord) || '#/community';
    const prizeRanks = Object.keys(c.prizes || {}).map(Number).filter((n) => n > 0 && c.prizes[n] != null).sort((a, b) => a - b);
    return h('div', { class: 'page-shell' },
      h('section', { class: 'hero-shell', 'data-spy': 'home' },
        h('div', { class: 'hero-copy' },
          h('span', { class: 'eyebrow' }, 'Norochan'),
          h('h1', {}, 'Play.', h('br'), 'Watch.', h('br'), 'Get rewarded.'),
          h('p', { class: 'lead' }, 'The Norochan community on Stake and Kick. Use code ' + (c.code || 'Norochan') + '. Live status, standings, and prizes on this page come from the live data — nothing here is estimated.'),
          h('div', { class: 'cta-row' },
            h('a', { class: 'btn', href: '#/streams' }, 'Watch live'),
            h('a', { class: 'btn secondary', href: discordUrl, target: discordUrl.startsWith('http') ? '_blank' : null, rel: discordUrl.startsWith('http') ? 'noopener noreferrer' : null }, 'Join community'))),
        h('aside', { class: 'hero-visual' },
          decor('decor-hero', [['slot-machine', 's-main'], ['crown', 's-crown'], ['coin', 's-coin1'], ['coin', 's-coin2'], ['die', 's-die'], ['sparkles', 's-spark']]),
          h('p', { class: 'eyebrow' }, 'Creator'),
          h('p', { class: 'hero-visual-name' }, c.name || 'Norochan'),
          h('p', { class: 'muted' }, (race.title || 'Wager race') + (formatRaceWindow(race) ? ' · ' + formatRaceWindow(race) : '')),
          h('a', { class: 'btn small secondary', href: kickUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Open Kick'))),
      h('section', { id: 'streams', class: 'section-block streams-section', 'data-spy': 'streams' },
        h('div', { class: 'section-head' },
          h('div', {},
            h('span', { class: 'eyebrow' }, 'Streams'),
            h('h2', {}, 'Kick'),
            h('p', { class: 'muted' }, 'Live status from the channel. Viewer counts appear only while the stream is live.'))),
        kickLivePreview()),
      h('section', { id: 'top-viewers', class: 'section-block', 'data-spy': 'leaderboard' }, kickTopViewersSection()),
      leaderboardPreview(),
      h('section', { id: 'rewards', class: 'section-block', 'data-spy': 'rewards' },
        h('div', { class: 'section-head' },
          h('div', {},
            h('span', { class: 'eyebrow' }, 'Rewards'),
            h('h2', {}, 'Prize pool'),
            h('p', { class: 'muted' }, rewardsNote || 'Published by the Norochan team.'))),
        h('div', { class: 'stat-grid', 'aria-label': 'Reward figures' },
          h('div', { class: 'stat-card' }, h('span', { class: 'stat-label' }, 'Current prize pool'), h('strong', { class: 'stat-gold' }, prizePool != null ? usd0(prizePool) : '—')),
          h('div', { class: 'stat-card' }, h('span', { class: 'stat-label' }, 'Paid places'), h('strong', {}, String(race.top || 10)))),
        prizeRanks.length ? h('div', { class: 'reward-grid' },
          prizeRanks.map((rank) => h('article', { class: 'reward-card place-' + rank },
            sticker(rewardStickers[rank] || 'coin', 'reward-sticker'),
            h('span', { class: 'reward-kicker' }, 'Place ' + String(rank).padStart(2, '0')),
            h('strong', { class: 'reward-amount' }, usd0(c.prizes[rank])),
            h('p', { class: 'muted' }, 'Paid to rank ' + rank + ' on the wager leaderboard.'))),
          rewardFiller(prizeRanks.length + (prizeRanks.includes(1) ? 1 : 0))) : null,
        h('div', { class: 'board-card payout-board' },
          h('div', { class: 'section-head' },
            h('div', {},
              h('span', { class: 'eyebrow' }, 'Given so far'),
              h('h2', {}, 'Bonuses given'),
              h('p', { class: 'muted' }, 'Amounts published by the Norochan team. A dash means that figure has not been set yet.'))),
          h('div', { class: 'leaderboard-list', role: 'list', 'aria-label': 'Bonuses given' },
            h('div', { class: 'leaderboard-row leaderboard-head payout-row', role: 'presentation' },
              h('span', {}, 'Bonus'),
              h('span', { class: 'leaderboard-prize' }, 'Amount')),
            payoutRows.map((row, index) => {
              const amount = rewardFigure(row.key);
              return h('div', { class: 'leaderboard-row payout-row' + (index === 0 ? ' top3 rank-1' : ''), role: 'listitem' },
                h('span', { class: 'leaderboard-name' }, row.label),
                h('span', { class: 'leaderboard-prize' }, amount != null ? usd0(amount) : '—'));
            })))),
      h('section', { id: 'community', class: 'section-block', 'data-spy': 'community' },
        h('div', { class: 'section-head' },
          h('div', {},
            h('span', { class: 'eyebrow' }, 'Community'),
            h('h2', {}, 'Official channels'),
            h('p', { class: 'muted' }, 'The places Norochan actually posts.'))),
        h('div', { class: 'community-grid' }, links)),
      h('section', { class: 'dashboard-grid section-block', id: 'affiliate' },
        h('div', { class: 'promo-panel' },
          decor('decor-promo', [['money-bag', 's-bag'], ['coin', 's-coin'], ['dollar', 's-bill']]),
          h('span', { class: 'eyebrow' }, 'Support Norochan'),
          h('h2', {}, 'Use the code'),
          h('p', { class: 'muted' }, 'Wagers under this code count toward the monthly race.'),
          h('div', { class: 'promo-code-box' },
            h('span', { class: 'label' }, 'Code'),
            h('span', { class: 'code' }, c.code || 'Norochan')),
          h('div', { class: 'promo-actions' },
            copyBtn,
            h('a', { class: 'btn small', href: c.referralUrl || '#/', target: '_blank', rel: 'noopener sponsored' }, 'Join now'),
            copyMsg)),
        h('section', { class: 'race-card' },
          decor('decor-race', [['trophy', 's-trophy'], ['hourglass', 's-glass'], ['star', 's-star']]),
          h('span', { class: 'eyebrow' }, 'Race window'),
          h('h2', {}, race.title || 'Wager race'),
          h('p', { class: 'muted' }, formatRaceWindow(race) || 'Dates publish with the race config.'),
          race.startsAt ? countdownBox(race) : null,
          h('a', { class: 'btn small secondary', href: '#/leaderboard' }, 'View standings'))));
  }

  async function leaderboardView() {
    const c = state.config;
    const out = h('div', { class: 'leaderboard-page' });
    const body = h('div', { class: 'leaderboard-body' }, listSkeleton(6));
    out.append(
      h('header', { class: 'page-intro' },
        h('span', { class: 'eyebrow' }, 'Stake race'),
        h('h1', {}, (c && c.race && c.race.title) || 'Leaderboard')),
      body
    );
    app.replaceChildren(out);

    let data;
    try { data = await api('/api/leaderboard'); }
    catch {
      body.replaceChildren(UI.errorState
        ? UI.errorState('Leaderboard couldn\'t be loaded.', 'Please try again in a moment.', () => leaderboardView())
        : h('p', { class: 'note warn' }, 'Leaderboard couldn\'t be loaded.'));
      return;
    }

    const formatMonthEndDate = (monthOffset = 0) => {
      const now = new Date();
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1, 0, 0, 0, 0));
      const lastDay = new Date(Date.UTC(startOfMonth.getUTCFullYear(), startOfMonth.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      return lastDay.getUTCDate() + ' ' + new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(lastDay) + ' ' + lastDay.getUTCFullYear();
    };
    const leaderboardEndTimestamp = (monthOffset = 0) => {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1, 0, 0, 0, 0));
      return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59, 999)).getTime();
    };

    const buildMonthContent = (entries, monthOffset, extraHint) => {
      const frag = h('div', { class: 'leaderboard-view active' });
      if (monthOffset === 0) frag.append(leaderboardCountdown(leaderboardEndTimestamp(0), 'Current month ends in'));
      else frag.append(h('p', { class: 'leaderboard-rule' }, 'Ended ' + formatMonthEndDate(monthOffset)));
      if (entries && entries.length) frag.append(podium(entries), rankedList(entries));
      else {
        frag.append(UI.emptyState
          ? UI.emptyState('No wager data yet.', 'Rankings appear once players wager under the code.')
          : h('p', { class: 'note' }, 'No wagers recorded yet.'));
      }
      if (extraHint) frag.append(extraHint);
      return frag;
    };

    const pool = rewardFigure('currentPrizePool');
    const viewport = h('div', { class: 'leaderboard-viewport' });
    let period = 'current';
    const panel = h('section', { class: 'board-card' });
    const summary = h('p', { class: 'muted' }, pool != null ? ('Prize pool ' + usd0(pool) + ' USD · Top ' + ((c && c.race && c.race.top) || 10)) : 'Prizes in USD');

    function show(next) {
      period = next;
      stopTimer();
      if (next === 'current') {
        const hint = data.stale ? h('p', { class: 'note warn' }, 'The latest refresh failed, so these numbers may be a little behind.') : null;
        const statusNote = data.status !== 'ok' && !(data.entries && data.entries.length)
          ? null
          : (data.status !== 'ok' ? h('p', { class: 'note warn' }, 'Leaderboard temporarily unavailable.') : null);
        if (data.status !== 'ok' && !(data.entries && data.entries.length)) {
          viewport.replaceChildren(UI.errorState
            ? UI.errorState('Leaderboard couldn\'t be loaded.', 'Leaderboard temporarily unavailable.', () => leaderboardView())
            : h('p', { class: 'note warn' }, 'Leaderboard couldn\'t be loaded.'));
          return;
        }
        viewport.replaceChildren(buildMonthContent(data.entries, 0, statusNote || hint));
      } else if (data.previous && data.previous.entries && data.previous.entries.length) {
        viewport.replaceChildren(buildMonthContent(data.previous.entries, -1, h('p', { class: 'muted hint' }, 'Historical standings for the previous month.')));
      } else if (data.previous && data.previous.status === 'pending') {
        viewport.replaceChildren(listSkeleton(4));
      } else if (data.previous && data.previous.status === 'error') {
        viewport.replaceChildren(UI.errorState
          ? UI.errorState('Leaderboard couldn\'t be loaded.', 'Previous month standings are unavailable.', () => leaderboardView())
          : h('p', { class: 'note warn' }, 'Leaderboard couldn\'t be loaded.'));
      } else {
        viewport.replaceChildren(UI.emptyState
          ? UI.emptyState('No previous month data.', 'Check back after the prior period completes.')
          : h('p', { class: 'note' }, 'No previous month data yet.'));
      }
    }

    const updated = data.updatedAt ? h('p', { class: 'muted' }, 'Updated ' + formatUpdated(data.updatedAt)) : null;

    panel.append(
      h('div', { class: 'board-card-head' },
        h('div', {},
          h('h2', {}, 'Top players'),
          summary,
          updated),
        monthTabs('lb', 'Leaderboard month', show))
    );
    panel.append(viewport);
    body.replaceChildren(panel, kickTopViewersSection());
    show('current');
  }

  const SUPPORT = {
    telegramHandle: '@norochanmanager',
    telegramUrl: 'https://t.me/Norochanmanager',
    email: 'norochanofficial@gmail.com',
  };

  function supportView() {
    const contactCard = ({ stickerName, label, value, href, external, action }) => {
      const msg = h('span', { class: 'muted support-copy-msg', role: 'status' });
      const copy = h('button', {
        class: 'btn small secondary', type: 'button',
        onclick: async () => {
          try { await navigator.clipboard.writeText(value); msg.textContent = 'Copied ✓'; }
          catch { msg.textContent = 'Select the text to copy it'; }
          setTimeout(() => { msg.textContent = ''; }, 2500);
        },
      }, 'Copy');
      return h('article', { class: 'support-card' },
        sticker(stickerName, 'support-sticker'),
        h('span', { class: 'stat-label' }, label),
        h('a', { class: 'support-value', href, target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null }, value),
        h('div', { class: 'support-actions' },
          h('a', { class: 'btn small', href, target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null }, action),
          copy,
          msg));
    };
    return h('div', { class: 'support-page' },
      h('header', { class: 'page-intro' },
        h('span', { class: 'eyebrow' }, 'Support'),
        h('h1', {}, 'Need help?'),
        h('p', { class: 'muted' }, 'Questions about the code, the wager race or prizes? Contact the Norochan team directly.')),
      h('div', { class: 'support-grid' },
        contactCard({ stickerName: 'speech', label: 'Telegram', value: SUPPORT.telegramHandle, href: SUPPORT.telegramUrl, external: true, action: 'Message on Telegram' }),
        contactCard({ stickerName: 'email', label: 'Email', value: SUPPORT.email, href: 'mailto:' + SUPPORT.email, external: false, action: 'Send email' })),
      h('p', { class: 'note' }, 'The Norochan team will never ask for your Stake password or 2FA codes. Only trust the contacts listed on this page.'));
  }

  const pageNames = { home: 'Home', leaderboard: 'Leaderboard', support: 'Support', rewards: 'Rewards', streams: 'Streams', community: 'Community' };
  const homeSections = { rewards: 'rewards', streams: 'streams', community: 'community' };

  let currentView = null;
  let spyFrame = 0;
  const siteHeader = document.querySelector('.site-header');
  const scrollBehavior = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  const parseHash = (hash) => (String(hash || '').replace(/^#\/?/, '') || 'home').split('?')[0];

  function setActiveNav(key) {
    for (const a of document.querySelectorAll('[data-route]')) {
      if (a.dataset.route === key) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  function scrollHomeTo(name) {
    const el = homeSections[name] && document.getElementById(homeSections[name]);
    if (el) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    else window.scrollTo({ top: 0, behavior: scrollBehavior() });
    setActiveNav(homeSections[name] ? name : 'home');
  }

  const progressBar = h('div', { class: 'scroll-progress', 'aria-hidden': 'true' });
  document.body.append(progressBar);

  const revealSelector = '.hero-copy, .hero-visual, .stat-card, .promo-panel, .race-card, .section-head, .reward-card, .board-card, .payout-board, .kick-live-card, .community-card, .page-intro, .support-card';
  let revealObserver = null;
  function initReveal() {
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (revealObserver) revealObserver.disconnect();
    revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
    const perParent = new Map();
    for (const el of app.querySelectorAll(revealSelector)) {
      if (el.classList.contains('reveal')) continue;
      const n = perParent.get(el.parentElement) || 0;
      perParent.set(el.parentElement, n + 1);
      el.style.setProperty('--reveal-i', String(Math.min(n, 6)));
      el.classList.add('reveal');
      revealObserver.observe(el);
    }
  }

  // Cursor-following light on cards and a small parallax on the hero stickers (mouse only).
  const spotSelector = '.stat-card, .community-card, .reward-card, .race-card, .promo-panel, .board-card, .kick-live-card, .hero-visual, .support-card';
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let parallaxCard = null;
    document.addEventListener('pointermove', (event) => {
      const card = event.target.closest ? event.target.closest(spotSelector) : null;
      if (parallaxCard && parallaxCard !== card) {
        parallaxCard.style.setProperty('--px', '0');
        parallaxCard.style.setProperty('--py', '0');
        parallaxCard = null;
      }
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (event.clientX - r.left).toFixed(0) + 'px');
      card.style.setProperty('--my', (event.clientY - r.top).toFixed(0) + 'px');
      if (card.classList.contains('hero-visual')) {
        parallaxCard = card;
        card.style.setProperty('--px', ((event.clientX - r.left) / r.width * 2 - 1).toFixed(3));
        card.style.setProperty('--py', ((event.clientY - r.top) / r.height * 2 - 1).toFixed(3));
      }
    }, { passive: true });
  }

  // The active link follows the home section crossing a line ~30% down the viewport.
  function updateScrollSpy() {
    spyFrame = 0;
    if (siteHeader) siteHeader.classList.toggle('is-scrolled', window.scrollY > 8);
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.transform = 'scaleX(' + (maxScroll > 0 ? Math.min(1, window.scrollY / maxScroll) : 0).toFixed(4) + ')';
    if (currentView !== 'home') return;
    const marks = [...app.querySelectorAll('[data-spy]')];
    if (!marks.length) return;
    const line = (siteHeader ? siteHeader.offsetHeight : 72) + window.innerHeight * 0.3;
    let active = marks[0].dataset.spy;
    for (const el of marks) if (el.getBoundingClientRect().top <= line) active = el.dataset.spy;
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (atBottom) active = marks[marks.length - 1].dataset.spy;
    setActiveNav(active);
  }
  window.addEventListener('scroll', () => { if (!spyFrame) spyFrame = requestAnimationFrame(updateScrollSpy); }, { passive: true });

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest && event.target.closest('a[href^="#/"]');
    if (!link || currentView !== 'home') return;
    const name = parseHash(link.getAttribute('href'));
    if (name !== 'home' && !homeSections[name]) return;
    event.preventDefault();
    if (location.hash !== link.getAttribute('href')) history.pushState(null, '', link.getAttribute('href'));
    scrollHomeTo(name);
  });

  async function route() {
    const name = parseHash(location.hash);
    const section = homeSections[name];
    if (currentView === 'home' && (section || name === 'home') && app.querySelector('[data-spy]')) {
      scrollHomeTo(name);
      return;
    }
    stopTimer();
    stopKickPoll();
    setActiveNav(section || (['leaderboard', 'support'].includes(name) ? name : 'home'));
    const announcer = document.getElementById('route-announcer');
    if (announcer) announcer.textContent = pageNames[name] || pageNames.home;
    if (name === 'leaderboard') { currentView = 'leaderboard'; await leaderboardView(); }
    else if (name === 'support') { currentView = 'support'; app.replaceChildren(supportView()); }
    else { currentView = 'home'; app.replaceChildren(homeView()); }
    refreshTabIndicators();
    if (document.activeElement === document.body) {
      try { app.focus({ preventScroll: true }); } catch { app.focus(); }
    }
    initReveal();
    if (section) scrollHomeTo(name);
    else window.scrollTo(0, 0);
    if (!section) updateScrollSpy();
  }

  function syncNavLive(data) {
    const el = document.getElementById('nav-live');
    if (!el) return;
    const live = !!(data && data.status === 'live');
    const offline = !!(data && data.status === 'offline');
    el.hidden = false;
    el.classList.toggle('is-live', live);
    if (data && data.url) el.href = data.url;
    const label = el.querySelector('.nav-live-label');
    const text = live ? 'Live' : offline ? 'Offline' : 'Unavailable';
    if (label) label.textContent = text;
    const viewers = data && data.viewers != null ? data.viewers.toLocaleString() + ' viewers' : '';
    el.title = viewers;
    el.setAttribute('aria-label', viewers ? text + ', ' + viewers : 'Kick status: ' + text);
  }

  async function pollNavLive() {
    try { syncNavLive(await api('/api/kick-live')); }
    catch { syncNavLive(null); }
  }

  async function init() {
    const rewards = api('/api/rewards').catch(() => null);
    try { state.config = await api('/api/config'); }
    catch {
      app.replaceChildren(UI.errorState
        ? UI.errorState('Could not load the site.', 'Refresh the page and try again.', () => location.reload())
        : h('p', { class: 'note warn' }, 'Could not load the site. Refresh the page.'));
      return;
    }
    document.title = state.config.name;
    const discordNav = document.getElementById('nav-discord');
    if (discordNav && state.config.links && state.config.links.discord) discordNav.href = state.config.links.discord;
    state.rewards = await rewards;
    pollNavLive();
    setInterval(pollNavLive, 45000);
    window.addEventListener('hashchange', route);
    route();
  }
  init();
})();
