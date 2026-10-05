'use strict';
(function () {
  const app = document.getElementById('app');
  const state = { config: null, rewards: null, me: null };
  let timer = null;
  let kickPollTimer = null;
  let viewerPollTimer = null;

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
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
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
  const formatUpdatedAgo = (ts) => {
    const mins = Math.max(0, Math.round((Date.now() - Number(ts)) / 60000));
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 minute ago';
    if (mins < 60) return mins + ' minutes ago';
    const hrs = Math.round(mins / 60);
    return hrs === 1 ? '1 hour ago' : hrs + ' hours ago';
  };

  function socialKindFromLink(key, url) {
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
    catch { /* keep key */ }
    if (host.includes('discord')) return 'discord';
    if (host === 't.me' || host.includes('telegram')) return 'telegram';
    if (host === 'x.com' || host.includes('twitter')) return 'x';
    if (host.includes('youtube') || host === 'youtu.be') return 'youtube';
    if (host === 'kick.com' || host.endsWith('.kick.com')) return 'kick';
    if (host.includes('instagram')) return 'instagram';
    return key;
  }

  function socialSvg(paths) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'social-logo');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const item of paths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', item.d);
      path.setAttribute('fill', item.fill);
      svg.append(path);
    }
    return svg;
  }

  const SOCIAL_MARKS = {
    discord: [{ fill: '#5865F2', d: 'M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.1.1 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.1 16.1 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09A.09.09 0 0 0 9 4c-1.5.26-2.93.71-4.27 1.33h-.03C1.98 9.4 1.23 13.36 1.6 17.28c0 .02.01.04.03.05 1.8 1.32 3.53 2.12 5.24 2.65h.07c.4-.55.76-1.13 1.07-1.74.02-.04 0-.08-.04-.09-.57-.22-1.11-.48-1.64-.78-.04-.02-.04-.08-.01-.11.11-.08.22-.17.33-.25h.07c3.44 1.57 7.15 1.57 10.55 0h.07c.11.09.22.17.33.26.04.03.04.09-.01.11-.52.31-1.07.56-1.64.78-.04.01-.05.06-.04.09.32.61.68 1.19 1.07 1.74h.09c1.72-.53 3.45-1.33 5.25-2.65.02-.01.03-.03.03-.05.44-4.53-.73-8.46-3.1-11.95h-.04zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12 0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12 0 1.17-.83 2.12-1.89 2.12z' }],
    telegram: [{ fill: '#2AABEE', d: 'M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm5.57 8.24l-1.87 8.82c-.14.63-.51.78-1.03.49l-2.85-2.1-1.37 1.32c-.15.15-.28.28-.57.28l.2-2.89 5.27-4.76c.23-.2-.05-.32-.35-.12l-6.52 4.1-2.81-.88c-.61-.19-.62-.61.13-.9l10.98-4.23c.51-.18.95.12.79.87z' }],
    x: [{ fill: '#fff', d: 'M18.24 2.25h3.31l-7.22 8.26 8.5 11.24h-6.66l-4.71-6.23-5.4 6.23H2.74l7.73-8.84L1.25 2.25H8.08l4.25 5.62 5.91-5.62zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64z' }],
    youtube: [
      { fill: '#FF0000', d: 'M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.55 12 3.55 12 3.55s-7.54 0-9.38.5A3.02 3.02 0 0 0 .5 6.19 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.84.5 9.38.5 9.38.5s7.54 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.81z' },
      { fill: '#fff', d: 'M9.75 15.02V8.98L15.5 12l-5.75 3.02z' },
    ],
    instagram: [{ fill: '#E4405F', d: 'M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.81-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.43-.36-1.06-.41-2.23-.05-1.27-.07-1.65-.07-4.85s.02-3.58.07-4.85c.05-1.17.25-1.81.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.64-.07 4.85-.07zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.91.33 4.14.63c-.79.3-1.46.72-2.13 1.38S.94 3.35.63 4.14C.33 4.91.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.14.56 2.91.3.79.72 1.46 1.38 2.13s1.34 1.08 2.13 1.38c.77.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.14-.26 2.91-.56.79-.3 1.46-.72 2.13-1.38s1.08-1.34 1.38-2.13c.3-.77.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91-.3-.79-.72-1.46-1.38-2.13S20.65.94 19.86.63c-.77-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z' }],
  };

  function socialIconForKey(key, label, url) {
    const kind = socialKindFromLink(key, url);
    if (kind === 'kick') {
      return h('img', { class: 'social-logo', src: '/img/kick-logo.png', alt: '', width: 22, height: 22 });
    }
    const mark = SOCIAL_MARKS[kind];
    if (mark) return socialSvg(mark);
    const letter = document.createElement('span');
    letter.textContent = (label || key).slice(0, 1);
    return letter;
  }
  const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
  const stopKickPoll = () => { if (kickPollTimer) { clearInterval(kickPollTimer); kickPollTimer = null; } };
  const stopViewerPoll = () => { if (viewerPollTimer) { clearInterval(viewerPollTimer); viewerPollTimer = null; } };
  let wheelPollTimer = null;
  let wheelTickTimer = null;
  let wheelRaf = null;
  let moneyRainRaf = null;
  const stopWheelPoll = () => {
    if (wheelPollTimer) { clearInterval(wheelPollTimer); wheelPollTimer = null; }
    if (wheelTickTimer) { clearInterval(wheelTickTimer); wheelTickTimer = null; }
    if (wheelRaf) { cancelAnimationFrame(wheelRaf); wheelRaf = null; }
  };
  const stopMoneyRain = () => {
    if (moneyRainRaf) { cancelAnimationFrame(moneyRainRaf); moneyRainRaf = null; }
  };

  const WHEEL_SLICE_COLORS = ['#0a3a42', '#061c22', '#0e5560', '#082830', '#125e6a', '#041418', '#0c4852', '#163e48'];

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeChampionship(t) {
    t = Math.max(0, Math.min(1, t));
    if (t < 0.055) {
      const u = t / 0.055;
      return 0.028 * u * u;
    }
    const u = (t - 0.055) / 0.945;
    return 0.028 + 0.972 * (1 - Math.pow(1 - u, 4));
  }

  function paintTicketWheel(canvas, entries, rotation, highlightName) {
    const ctx = canvas && canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssSize = Math.max(160, Math.round(canvas.clientWidth || 320));
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);
    const cx = cssSize / 2;
    const cy = cssSize / 2;
    const radius = cssSize / 2 - 4;
    const hub = Math.max(42, radius * 0.26);
    const rows = (entries || []).filter((e) => e && e.tickets > 0);
    const total = rows.reduce((sum, e) => sum + (Number(e.tickets) || 0), 0);
    const slices = [];
    const rot = rotation || 0;
    const dimOthers = !!highlightName;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#061014';
    ctx.fill();

    if (rows.length && total > 0) {
      let angle = -Math.PI / 2;
      rows.forEach((entry, i) => {
        const sweep = (Number(entry.tickets) / total) * Math.PI * 2;
        const isHit = highlightName && entry.name === highlightName;
        const base = WHEEL_SLICE_COLORS[i % WHEEL_SLICE_COLORS.length];
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius - 1.5, angle, angle + sweep);
        ctx.closePath();
        const grad = ctx.createRadialGradient(0, 0, hub, 0, 0, radius);
        if (isHit) {
          grad.addColorStop(0, '#083038');
          grad.addColorStop(0.45, '#0e7a88');
          grad.addColorStop(1, '#00d4ea');
        } else {
          grad.addColorStop(0, '#041014');
          grad.addColorStop(0.55, base);
          grad.addColorStop(1, i % 2 ? '#0a2c34' : '#0d3c44');
        }
        ctx.globalAlpha = dimOthers && !isHit ? 0.42 : 1;
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = isHit ? 'rgba(224, 184, 74, 0.85)' : 'rgba(4, 16, 20, 0.7)';
        ctx.lineWidth = isHit ? 2 : 1;
        ctx.stroke();
        slices.push({ mid: angle + sweep / 2, sweep: sweep, name: String(entry.name || ''), isHit: isHit });
        angle += sweep;
      });
    }

    ctx.beginPath();
    ctx.arc(0, 0, radius - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(8, 20, 24, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, hub + 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.22)';
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, hub, 0, Math.PI * 2);
    ctx.fillStyle = '#070d10';
    ctx.fill();
    ctx.restore();

    if (!slices.length) return;
    const rInner = hub + 12;
    const rOuter = radius - 10;
    const maxRadial = Math.max(16, rOuter - rInner);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.textBaseline = 'middle';
    slices.forEach((slice) => {
      const label = String(slice.name || '').trim();
      if (!label) return;
      const rMid = (rInner + rOuter) / 2;
      const arcW = slice.sweep * rMid;
      if (arcW < 13) return;
      const minPx = arcW < 22 ? 8 : 9;
      const maxPx = Math.min(17, arcW * 0.62, 20);
      let fontPx = Math.min(maxPx, Math.max(minPx, arcW * 0.38));
      ctx.font = '400 ' + fontPx + 'px "Norochan Digits", "Mangerica", "Fredoka", sans-serif';
      while (fontPx > minPx && ctx.measureText(label).width > maxRadial) {
        fontPx -= 0.4;
        ctx.font = '400 ' + fontPx + 'px "Norochan Digits", "Mangerica", "Fredoka", sans-serif';
      }
      if (ctx.measureText(label).width > maxRadial + 2) return;
      ctx.save();
      ctx.rotate(slice.mid);
      let a = (slice.mid + rot) % (Math.PI * 2);
      if (a < 0) a += Math.PI * 2;
      const flip = a > Math.PI / 2 && a < Math.PI * 3 / 2;
      if (flip) ctx.rotate(Math.PI);
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = Math.max(2.2, fontPx * 0.22);
      ctx.strokeStyle = slice.isHit ? 'rgba(4, 16, 20, 0.82)' : 'rgba(4, 12, 16, 0.78)';
      ctx.fillStyle = slice.isHit ? '#f4e6b2' : '#e8f4f6';
      if (flip) {
        ctx.textAlign = 'right';
        ctx.strokeText(label, -(rInner + 2), 0, maxRadial);
        ctx.fillText(label, -(rInner + 2), 0, maxRadial);
      } else {
        ctx.textAlign = 'left';
        ctx.strokeText(label, rInner + 2, 0, maxRadial);
        ctx.fillText(label, rInner + 2, 0, maxRadial);
      }
      ctx.restore();
    });
    ctx.restore();
  }

  const root = document.documentElement;
  root.dataset.theme = 'dark';
  try { localStorage.removeItem('theme'); } catch (e) { /* storage blocked */ }

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
    mobileNav.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMobileNav(false)));
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

  function podiumBadge(rank) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const add = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      svg.append(el);
    };
    if (rank === 1) {
      add('path', { fill: 'currentColor', d: 'M3 7.5 8 11l4-7 4 7 5-3.5L19 17H5L3 7.5zm2 11h14v2H5v-2z' });
    } else {
      add('path', { fill: 'currentColor', d: 'M7 2h10l-3 7H10L7 2z' });
      add('circle', { fill: 'currentColor', cx: '12', cy: '15', r: '5.2' });
    }
    return h('div', { class: 'podium-badge', 'aria-hidden': 'true' }, svg);
  }

  function podium(entries) {
    const byRank = new Map((entries || []).map((entry) => [entry.rank, entry]));
    const board = h('div', { class: 'podium', 'aria-label': 'Top three' });
    for (const rank of [1, 2, 3]) {
      const entry = byRank.get(rank);
      const prizeText = entry && entry.prize != null ? usd0(entry.prize) : '—';
      const weightedText = entry ? usd(entry.weighted) : '—';
      const col = h('div', {
        class: ['podium-col', 'rank-' + rank, entry && entry.you ? 'is-you' : '', entry ? '' : 'is-empty'].filter(Boolean).join(' '),
        'data-rank': String(rank),
      });
      col.setAttribute(
        'aria-label',
        entry
          ? 'Rank ' + rank + ', ' + entry.name + ', prize ' + prizeText + ', weighted ' + weightedText
          : 'Rank ' + rank + ', no player yet'
      );
      col.append(
        podiumBadge(rank),
        h('div', { class: 'podium-card' },
          h('div', { class: 'podium-name' }, entry ? playerLabel(entry) : 'No player yet'),
          h('div', { class: 'podium-stat' },
            h('span', { class: 'podium-stat-label' }, 'Weighted'),
            h('strong', { class: 'podium-stat-value' }, weightedText)),
          h('div', { class: 'podium-stat is-prize' },
            h('span', { class: 'podium-stat-label' }, 'Prize'),
            h('strong', { class: 'podium-prize' }, prizeText)))
      );
      board.append(col);
    }
    return board;
  }

  function playerLabel(entry) {
    if (!entry.you) return h('span', { class: 'leaderboard-name' }, entry.name);
    return h('span', { class: 'leaderboard-name' }, entry.name, ' ', h('span', { class: 'you-tag' }, '(you)'));
  }

  function rankedList(entries) {
    const list = h('div', { class: 'leaderboard-list', role: 'list' });
    list.append(h('div', { class: 'leaderboard-row leaderboard-head', role: 'presentation' },
      h('span', {}, 'Rank'),
      h('span', {}, 'Player'),
      h('span', { class: 'num' }, 'Weighted'),
      h('span', { class: 'num' }, 'Prize')));
    for (const e of entries || []) {
      list.append(h('div', {
        class: ['leaderboard-row', e.rank <= 3 ? 'top3' : '', e.rank <= 3 ? 'rank-' + e.rank : '', e.you ? 'is-you' : ''].filter(Boolean).join(' '),
        role: 'listitem',
        'data-rank': String(e.rank),
      },
      h('span', { class: 'rank-num' }, String(e.rank).padStart(2, '0')),
      h('div', { class: 'leaderboard-player' },
        UI.initialsAvatar ? UI.initialsAvatar(e.name) : null,
        playerLabel(e)),
      h('span', { class: 'leaderboard-wagered' }, usd(e.weighted)),
      h('span', { class: 'leaderboard-prize' }, e.prize != null ? usd0(e.prize) : '—')));
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

  function feedMounts() {
    const news = h('div', {});
    const benefits = h('div', {});
    async function load() {
      let feed;
      try { feed = await api('/api/feed'); }
      catch { return; }
      if (feed.announcements && feed.announcements.length) {
        news.replaceChildren(h('section', { class: 'section-block', 'aria-labelledby': 'news-heading' },
          h('div', { class: 'section-head' },
            h('div', {},
              h('span', { class: 'eyebrow' }, 'News'),
              h('h2', { id: 'news-heading' }, 'Announcements'))),
          h('div', { class: 'feed-list' },
            feed.announcements.map((row) => h('article', { class: 'feed-card' },
              h('h3', {}, row.title),
              row.body ? h('p', {}, row.body) : null)))));
      }
      if (feed.categories && feed.categories.length) {
        benefits.replaceChildren(h('div', { class: 'benefit-market', 'aria-labelledby': 'benefits-heading' },
          h('div', { class: 'section-head' },
            h('div', {},
              h('span', { class: 'eyebrow' }, 'Code benefits'),
              h('h2', { id: 'benefits-heading' }, 'What the code includes'),
              h('p', { class: 'muted' }, 'Published by the Norochan team. Empty categories are omitted.'))),
          h('nav', { class: 'benefit-nav', 'aria-label': 'Reward categories' },
            feed.categories.map((cat) => h('a', { href: '#benefit-' + cat.id }, cat.label))),
          feed.categories.map((cat) => h('div', { class: 'benefit-group', id: 'benefit-' + cat.id },
            h('h3', { class: 'benefit-cat' }, cat.label),
            cat.hint ? h('p', { class: 'muted' }, cat.hint) : null,
            h('div', { class: 'benefit-grid' },
              cat.posts.map((row) => h('article', { class: ['benefit-card', row.amount != null ? 'has-amount' : ''].filter(Boolean).join(' ') },
                row.amount != null ? h('strong', { class: 'benefit-amount' }, usd0(row.amount)) : null,
                h('h4', {}, row.title),
                row.body ? h('p', { class: 'muted' }, row.body) : null,
                row.ctaUrl ? h('a', { class: 'btn small secondary', href: row.ctaUrl, target: '_blank', rel: 'noopener noreferrer' }, row.ctaLabel || 'Open') : null)))))));
      }
      if (typeof initReveal === 'function') initReveal();
    }
    load();
    return { news, benefits };
  }

  function wheelStrip() {
    const panel = h('section', { id: 'wheel', class: 'section-block wheel-stage', 'data-spy': 'wheel', 'aria-labelledby': 'wheel-heading' });
    const canvas = h('canvas', { class: 'wheel-canvas' });
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Monthly ticket wheel. Slice size is this month’s Stake tickets.');
    const hubAmount = h('strong', { class: 'wheel-hub-amount' }, '—');
    const hubLabel = h('span', { class: 'wheel-hub-label' }, 'POOL');
    const liveFlag = h('div', { class: 'wheel-draw-banner', hidden: '' }, 'Live draw');
    const caption = h('p', { class: 'wheel-live-caption' }, 'Loading this month’s Stake board…');
    const meta = h('div', { class: 'wheel-meta' });
    const countCaption = h('p', { class: 'wheel-count-kicker' }, 'Live draw in');
    const countCells = {};
    const countWrap = h('div', { class: 'countdown wheel-countdown', role: 'timer', 'aria-label': 'Wheel draw countdown' });
    for (const [key, label] of [['d', 'days'], ['h', 'hours'], ['m', 'minutes'], ['s', 'seconds']]) {
      countCells[key] = h('b', {}, '0');
      countWrap.append(h('div', {}, countCells[key], h('span', {}, label)));
    }
    const announceKicker = h('span', { class: 'wheel-announce-kicker' }, 'WINNER');
    const announceName = h('strong', { class: 'wheel-announce-name' }, '');
    const announcePrize = h('span', { class: 'wheel-announce-prize' }, '');
    const announce = h('div', { class: 'wheel-announce' }, announceKicker, announceName, announcePrize);
    const pointer = h('div', { class: 'wheel-pointer', 'aria-hidden': 'true' }, h('span', { class: 'wheel-pointer-blade' }));
    const boardToggle = h('button', { class: 'wheel-board-toggle', type: 'button', 'aria-expanded': 'false', hidden: '' }, 'View wheel leaderboard');
    const board = h('div', { class: 'wheel-board', hidden: '' });
    let boardOpen = false;
    let painted = [];
    let rotation = 0;
    let highlightName = null;
    let spinning = false;
    let idle = true;
    let latest = null;
    let playedPeriod = null;
    let spinJob = null;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function paint() { paintTicketWheel(canvas, painted, rotation, highlightName); }

    function setSpinUi(on) {
      spinning = on;
      visual.classList.toggle('is-spinning', on);
      pointer.classList.toggle('is-armed', on);
    }

    function setHubMode(mode) {
      hubLabel.textContent = mode === 'winner' ? 'WINNER' : 'POOL';
      visual.classList.toggle('is-winner', mode === 'winner');
    }

    function showAnnounce(name, prize) {
      announceKicker.textContent = 'WINNER';
      announceName.textContent = name || '';
      announcePrize.textContent = prize != null ? usd0(prize) : (latest && latest.prizePool != null ? usd0(latest.prizePool) : '');
      announce.classList.add('is-on');
    }

    function hideAnnounce() {
      announce.classList.remove('is-on');
      announceName.textContent = '';
      announcePrize.textContent = '';
      setHubMode('pool');
    }

    function settlePointer() {
      if (reduced) return;
      pointer.classList.remove('is-settling');
      void pointer.offsetWidth;
      pointer.classList.add('is-settling');
    }

    function setCount(ms) {
      const s = Math.max(0, Math.ceil(ms / 1000));
      countCells.d.textContent = String(Math.floor(s / 86400));
      countCells.h.textContent = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
      countCells.m.textContent = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      countCells.s.textContent = String(s % 60).padStart(2, '0');
    }

    function previousPeriodKey() {
      const d = new Date();
      const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
      return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0');
    }

    function alreadyPlayed(period) {
      if (playedPeriod === period) return true;
      try { return sessionStorage.getItem('noro-wheel-live:' + period) === '1'; }
      catch { return false; }
    }
    function markPlayed(period) {
      playedPeriod = period;
      try { sessionStorage.setItem('noro-wheel-live:' + period, '1'); } catch { /* ignore */ }
    }

    function winnerMids(entries) {
      const rows = (entries || []).filter((e) => e && e.tickets > 0);
      const total = rows.reduce((sum, e) => sum + Number(e.tickets), 0) || 1;
      let angle = -Math.PI / 2;
      const map = {};
      rows.forEach((e) => {
        const sweep = (Number(e.tickets) / total) * Math.PI * 2;
        map[e.name] = angle + sweep / 2;
        angle += sweep;
      });
      return map;
    }

    function animateTo(target, ms) {
      return new Promise((resolve) => {
        spinJob = {
          start: rotation,
          target: target,
          t0: performance.now(),
          ms: ms,
          ease: reduced ? easeOutCubic : easeChampionship,
          resolve: resolve,
        };
      });
    }

    async function spinToName(name, ms) {
      const mids = winnerMids(painted);
      const mid = mids[name];
      if (mid == null) return;
      let delta = 0 - mid - (rotation % (Math.PI * 2));
      while (delta <= 0) delta += Math.PI * 2;
      const turns = reduced ? 1 : 7;
      await animateTo(rotation + delta + turns * Math.PI * 2, ms);
      highlightName = name;
      paint();
      settlePointer();
    }

    async function playLiveDraw(data) {
      const winners = (data.lastDraw && data.lastDraw.winners) || [];
      const boardRows = (data.lastDraw && data.lastDraw.board && data.lastDraw.board.length) ? data.lastDraw.board : data.entries;
      if (!winners.length || !boardRows.length) return;
      idle = false;
      liveFlag.hidden = false;
      visual.classList.add('is-drawing');
      setSpinUi(true);
      hideAnnounce();
      painted = boardRows.filter((e) => e && e.tickets > 0);
      const duration = reduced ? 400 : 5600;
      for (let i = 0; i < winners.length; i++) {
        highlightName = null;
        countCaption.textContent = 'Drawing winner ' + (i + 1) + ' of ' + winners.length;
        caption.textContent = 'Live draw — tickets still decide the odds.';
        await spinToName(winners[i].name, duration);
        setHubMode('winner');
        showAnnounce(winners[i].name, winners[i].prize != null ? winners[i].prize : data.prizePool);
        await new Promise((r) => setTimeout(r, reduced ? 200 : 1400));
      }
      markPlayed(data.lastDraw.period);
      setSpinUi(false);
      visual.classList.remove('is-drawing');
      liveFlag.hidden = true;
      idle = true;
      highlightName = null;
      hideAnnounce();
      painted = (data.entries || []).filter((e) => e && e.tickets > 0);
      renderResults(data);
    }

    function entryDetails(entries, totalTickets) {
      return h('div', { class: 'wheel-entry-details' },
        h('h3', { class: 'wheel-kicker' }, 'All ' + entries.length + ' players this month'),
        h('div', { class: 'leaderboard-list wheel-list', role: 'list' },
          h('div', { class: 'leaderboard-row leaderboard-head', role: 'presentation' },
            h('span', {}, 'Player'),
            h('span', { class: 'num' }, 'Tickets'),
            h('span', { class: 'num' }, 'Chance')),
          entries.map((e) => h('div', { class: 'leaderboard-row', role: 'listitem' },
            h('span', { class: 'leaderboard-name' }, e.name),
            h('span', { class: 'num' }, Number(e.tickets).toLocaleString('en-US')),
            h('span', { class: 'num' }, totalTickets ? ((e.tickets / totalTickets) * 100).toFixed(1) + '%' : '—')))));
    }

    function renderResults(data) {
      const kids = [];
      if (data.lastDraw && data.lastDraw.winners && data.lastDraw.winners.length) {
        kids.push(h('div', { class: 'wheel-winners' },
          h('p', { class: 'wheel-kicker' }, 'Last draw · ' + data.lastDraw.period),
          h('div', { class: 'wheel-winner-row' },
            data.lastDraw.winners.map((w, i) => {
              const prizeBit = w.prize != null ? ' · ' + usd(w.prize) : '';
              return h('article', { class: 'wheel-winner' },
                h('span', { class: 'wheel-winner-place' }, String(i + 1).padStart(2, '0')),
                h('strong', {}, w.name),
                h('span', { class: 'muted' }, Number(w.tickets).toLocaleString('en-US') + ' tickets' + prizeBit));
            }))));
      }
      const list = (data.entries || []).filter((e) => e && e.tickets > 0);
      const total = data.totalTickets || list.reduce((sum, e) => sum + e.tickets, 0);
      if (list.length) kids.push(entryDetails(list, total));
      board.replaceChildren(...kids);
      boardToggle.hidden = !kids.length;
      if (!kids.length) {
        boardOpen = false;
        board.hidden = true;
        boardToggle.setAttribute('aria-expanded', 'false');
        boardToggle.textContent = 'View wheel leaderboard';
      } else if (!boardOpen) {
        board.hidden = true;
      }
    }

    function render(data) {
      latest = data;
      hubAmount.textContent = data.prizePool != null ? usd0(data.prizePool) : '—';
      const next = data.nextDrawAt
        ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(data.nextDrawAt))
        : 'month end';
      meta.replaceChildren(
        h('span', {}, (data.winnersCount || 3) + ' winners · pool split equally'),
        h('span', {}, data.prizeEach != null ? usd(data.prizeEach) + ' each' : ''),
        h('span', {}, '$' + Number(data.ticketUsd || 1000).toLocaleString('en-US') + ' raw = 1 ticket'),
        h('span', {}, 'Draw ' + next + ' UTC')
      );
      if (!spinning) {
        painted = (data.entries || []).filter((e) => e && e.tickets > 0);
        paint();
      }
      const remain = (data.nextDrawAt || 0) - Date.now();
      if (remain > 0) {
        countCaption.textContent = 'Live draw in';
        liveFlag.hidden = true;
        visual.classList.remove('is-drawing');
      } else if (spinning) countCaption.textContent = 'Live draw';
      else countCaption.textContent = 'Draw window';
      if (!painted.length) {
        caption.textContent = data.status === 'pending'
          ? 'Waiting for this month’s Stake leaderboard…'
          : 'No ticket entries yet this month.';
      } else {
        caption.textContent = painted.length + ' players · ' + Number(data.totalTickets || 0).toLocaleString('en-US') + ' total tickets';
      }
      if (!spinning) renderResults(data);
    }

    async function maybeLiveDraw(data) {
      if (spinning || !data || !data.nextDrawAt) return;
      if (Date.now() + 400 < data.nextDrawAt) return;
      liveFlag.hidden = false;
      visual.classList.add('is-drawing');
      countCaption.textContent = 'Live draw';
      caption.textContent = 'Locking this month’s tickets and spinning…';
      idle = false;
      if (!data.lastDraw || data.lastDraw.period !== previousPeriodKey()) {
        liveFlag.hidden = true;
        visual.classList.remove('is-drawing');
        idle = true;
        return;
      }
      if (alreadyPlayed(data.lastDraw.period)) {
        liveFlag.hidden = true;
        visual.classList.remove('is-drawing');
        idle = true;
        return;
      }
      const age = Date.now() - Date.parse(data.lastDraw.drawnAt);
      if (!Number.isFinite(age) || age > 45 * 60 * 1000) {
        liveFlag.hidden = true;
        visual.classList.remove('is-drawing');
        idle = true;
        return;
      }
      await playLiveDraw(data);
    }

    async function load() {
      try {
        const data = await api('/api/wheel');
        render(data);
        await maybeLiveDraw(data);
      } catch { caption.textContent = 'Wheel entries could not be loaded.'; }
    }

    function tickClock() {
      const target = latest && latest.nextDrawAt;
      if (!target) return;
      const remain = target - Date.now();
      setCount(remain);
      if (remain <= 1000) {
        if (wheelPollTimer && wheelPollTimer._fast) return;
        if (wheelPollTimer) clearInterval(wheelPollTimer);
        wheelPollTimer = setInterval(load, 1000);
        wheelPollTimer._fast = true;
        load();
      }
    }

    function loop() {
      if (spinJob) {
        const now = performance.now();
        const t = Math.min(1, (now - spinJob.t0) / spinJob.ms);
        const e = spinJob.ease || easeChampionship;
        rotation = spinJob.start + (spinJob.target - spinJob.start) * e(t);
        paint();
        if (t >= 1) { const done = spinJob.resolve; spinJob = null; done(); }
      } else if (!spinning) {
        idle = true;
        rotation += 0.007;
        paint();
      }
      wheelRaf = requestAnimationFrame(loop);
    }

    const visual = h('div', { class: 'wheel-visual' },
      liveFlag,
      h('div', { class: 'wheel-housing' },
        h('div', { class: 'wheel-disc' }, canvas),
        h('div', { class: 'wheel-hub', 'aria-hidden': 'true' }, hubAmount, hubLabel)),
      pointer);

    boardToggle.addEventListener('click', () => {
      boardOpen = !boardOpen;
      board.hidden = !boardOpen;
      boardToggle.setAttribute('aria-expanded', boardOpen ? 'true' : 'false');
      boardToggle.textContent = boardOpen ? 'Hide wheel leaderboard' : 'View wheel leaderboard';
    });

    panel.append(
      h('div', { class: 'wheel-hero' },
        h('div', { class: 'wheel-copy' },
          h('span', { class: 'eyebrow' }, 'Championship'),
          h('h2', { id: 'wheel-heading' }, 'Monthly prize draw'),
          h('p', { class: 'muted' }, 'Every slice is a current-month code player. Slice size is ticket count from raw wager — more tickets, higher chance. At UTC month end the wheel draws live for three winners and splits the prize pool equally.')),
        h('div', { class: 'wheel-figure-col' },
          visual,
          announce,
          caption,
          countCaption, countWrap, meta,
          boardToggle)),
      board
    );
    if (window.ResizeObserver) new ResizeObserver(paint).observe(visual);
    else window.addEventListener('resize', paint);
    stopWheelPoll();
    load();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(paint);
    wheelPollTimer = setInterval(load, 60000);
    wheelTickTimer = setInterval(tickClock, 250);
    wheelRaf = requestAnimationFrame(loop);
    return panel;
  }

  const watchTimeText = (secs, display) => {
    if (display) return display;
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
    const primary = data.watchTimeAvailable && e.watchTime != null
      ? watchTimeText(e.watchTime, e.watchtimeDisplay)
      : (e.points != null ? pointsText(e.points) : '—');
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
      if (data.status === 'error') { body.replaceChildren(failed('Viewer leaderboard temporarily unavailable.')); return; }
      if (data.status === 'pending') { body.replaceChildren(empty('Syncing with BotRix…', 'Viewer rankings will appear shortly.')); return; }
      const label = data.month && data.year ? monthName(data.month, data.year) : '';
      if (!data.entries || !data.entries.length) {
        body.replaceChildren(period === 'previous'
          ? empty('No standings saved for ' + (label || 'last month') + '.', 'Final standings are saved automatically at the end of each month.')
          : empty('No viewer data yet.', 'BotRix viewer rankings will appear here once watchtime data is available.'));
        return;
      }
      const intervalNote = data.final ? 'Previous month snapshot' : 'Current BotRix leaderboard';
      const meta = [intervalNote];
      if (label) meta.push(label);
      if (data.updatedAt) meta.push('Updated ' + (data.stale ? formatUpdatedAgo(data.updatedAt) : formatUpdated(data.updatedAt)));
      body.replaceChildren(...[
        h('p', { class: 'leaderboard-rule' }, meta.filter(Boolean).join(' · ')),
        viewerPodium(data),
        viewerList(data),
        data.stale ? h('p', { class: 'note warn' }, 'Showing last available BotRix data') : null,
        data.stale && data.updatedAt ? h('p', { class: 'muted' }, 'Updated ' + formatUpdatedAgo(data.updatedAt)) : null,
        h('p', { class: 'muted hint' }, 'Ranked by watch time from BotRix. Points are secondary.'),
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
        if (mine === request) body.replaceChildren(failed('Viewer leaderboard temporarily unavailable.'));
      }
    }

    panel.append(
      h('div', { class: 'board-card-head' },
        h('div', {},
          h('h2', { id: 'kick-viewers-heading' }, 'Top viewers'),
          h('p', { class: 'muted' }, (() => {
            const pool = rewardFigure('viewerPrizePool');
            return pool != null
              ? 'Watch time on Kick, tracked by BotRix · ' + usd0(pool) + ' prize pool'
              : 'Watch time on Kick, tracked by BotRix';
          })())),
        monthTabs('kick-viewers', 'Viewer month', (next) => { period = next; load(); })),
      body
    );
    load();
    stopViewerPoll();
    viewerPollTimer = setInterval(() => {
      delete cache.current;
      delete cache.previous;
      load();
    }, 15 * 60 * 1000);
    return panel;
  }

  const sticker = (name, cls) => h('img', {
    class: 'sticker ' + cls, src: '/img/stickers/' + name + '.png', alt: '',
    width: 256, height: 256, loading: 'lazy', decoding: 'async', draggable: 'false',
  });
  const decor = (cls, items) => h('div', { class: 'decor ' + cls, 'aria-hidden': 'true' }, items.map(([name, c]) => sticker(name, c)));

  const MONEY_ICONS = ['💲', '💎', '🎁', '💶', '💸'];

  function bindMoneyCursor(layer) {
    const notes = [...layer.querySelectorAll('.norochan-money-note-push')].map((el) => ({
      el, x: 0, y: 0, vx: 0, vy: 0,
    }));
    let mx = null;
    let my = null;
    const impulse = (clientX, clientY, power) => {
      notes.forEach((note) => {
        const box = note.el.getBoundingClientRect();
        const dx = box.left + box.width / 2 - clientX;
        const dy = box.top + box.height / 2 - clientY;
        const dist = Math.hypot(dx, dy) || 1;
        const reach = power > 8 ? 320 : 170;
        if (dist > reach) return;
        const force = (1 - dist / reach) * power;
        note.vx += (dx / dist) * force;
        note.vy += (dy / dist) * force;
      });
    };
    const onMove = (event) => {
      mx = event.clientX;
      my = event.clientY;
    };
    const onDown = (event) => impulse(event.clientX, event.clientY, 32);
    const onLeave = () => { mx = null; my = null; };
    const tick = () => {
      if (!layer.isConnected) { moneyRainRaf = null; return; }
      if (mx != null) impulse(mx, my, 1.6);
      notes.forEach((note) => {
        note.vx *= 0.9;
        note.vy *= 0.9;
        note.x = note.x * 0.82 + note.vx;
        note.y = note.y * 0.82 + note.vy;
        note.x = Math.max(-90, Math.min(90, note.x));
        note.y = Math.max(-90, Math.min(90, note.y));
        note.el.style.setProperty('--push-x', note.x.toFixed(2) + 'px');
        note.el.style.setProperty('--push-y', note.y.toFixed(2) + 'px');
      });
      moneyRainRaf = requestAnimationFrame(tick);
    };
    const stage = layer.closest('.hero-stage') || layer.parentElement;
    if (stage) {
      stage.addEventListener('pointermove', onMove, { passive: true });
      stage.addEventListener('pointerdown', onDown);
      stage.addEventListener('pointerleave', onLeave);
    }
    moneyRainRaf = requestAnimationFrame(tick);
  }

  function homeMoneyRain() {
    const layer = h('div', { class: 'norochan-money-rain', 'aria-hidden': 'true' });
    const width = window.innerWidth;
    const count = width <= 720 ? 10 : width <= 1100 ? 16 : 24;
    const depths = ['bg', 'mid', 'front', 'bg', 'mid'];
    for (let i = 0; i < count; i++) {
      const face = h('span', { class: 'norochan-money-note-face' }, MONEY_ICONS[i % MONEY_ICONS.length]);
      const push = h('div', { class: 'norochan-money-note-push' }, face);
      layer.append(h('div', { class: 'norochan-money-note norochan-money-note--' + depths[i % depths.length] }, push));
    }
    queueMicrotask(() => bindMoneyCursor(layer));
    return layer;
  }

  function homeView() {
    const c = state.config || {};
    const prizePool = rewardFigure('currentPrizePool');
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
          h('span', { class: 'social-icon social-icon--' + k }, socialIconForKey(k, label)),
          copy);
      }
      return h('a', { class: 'community-card', href: link, target: '_blank', rel: 'noopener noreferrer' },
        h('span', { class: 'social-icon social-icon--' + socialKindFromLink(k, link) }, socialIconForKey(k, label, link)),
        copy,
        h('span', { class: 'community-cta' }, 'Open'));
    });
    const moneyRain = homeMoneyRain();
    const feed = feedMounts();
    const codeRace = h('section', { class: 'dashboard-grid section-block', id: 'affiliate', 'data-spy': 'home' },
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
        h('a', { class: 'btn small secondary', href: '#/leaderboard' }, 'View standings')));
    return h('div', { class: 'page-shell' },
      h('section', { class: 'hero-stage', 'data-spy': 'home' },
        moneyRain,
        h('div', { class: 'hero-welcome' },
          h('p', { class: 'hero-welcome-kicker' }, 'Welcome to'),
          h('div', { class: 'hero-welcome-collab' },
            h('img', { class: 'brand-mark hero-welcome-mark', src: '/img/norochan-logo.png', alt: '', width: 96, height: 96 }),
            h('span', { class: 'hero-welcome-x', 'aria-hidden': 'true' }, '×'),
            h('span', { class: 'hero-welcome-stake' }, 'Stake')),
          h('h1', {}, 'Norochan'),
          h('p', { class: 'hero-welcome-by' }, 'By Norochan'))),
      codeRace,
      h('section', { id: 'streams', class: 'section-block streams-section', 'data-spy': 'streams' },
        h('div', { class: 'section-head' },
          h('div', {},
            h('span', { class: 'eyebrow' }, 'Streams'),
            h('h2', {}, 'Kick'),
            h('p', { class: 'muted' }, 'Live status from the channel. Viewer counts appear only while the stream is live.'))),
        kickLivePreview()),
      h('section', { id: 'top-viewers', class: 'section-block', 'data-spy': 'streams' }, kickTopViewersSection()),
      leaderboardPreview(),
      wheelStrip(),
      h('section', { id: 'benefits', class: 'section-block', 'data-spy': 'benefits' }, feed.benefits),
      h('section', { id: 'announcements', class: 'section-block', 'data-spy': 'announcements' }, feed.news),
      h('section', { id: 'community', class: 'section-block', 'data-spy': 'community' },
        h('div', { class: 'section-head' },
          h('div', {},
            h('span', { class: 'eyebrow' }, 'Community'),
            h('h2', {}, 'Official channels'),
            h('p', { class: 'muted' }, 'The places Norochan actually posts.'))),
        h('div', { class: 'community-grid' }, links)),
      bonusesGivenSection(),
      supportSection());
  }

  function bonusesGivenSection() {
    const items = [
      { key: 'leaderboardPayout', label: 'Leaderboard bonuses', blurb: 'Paid on monthly wager-race places.' },
      { key: 'levelUpBonus', label: 'Level-up bonuses', blurb: 'Extra VIP level-up cash for code players.' },
      { key: 'socialMediaGiveaways', label: 'Social giveaways', blurb: 'Giveaways run on community channels.' },
    ];
    const values = items.map((item) => rewardFigure(item.key));
    const total = values.every((v) => v == null) ? null : values.reduce((sum, v) => sum + (Number(v) || 0), 0);
    return h('section', { id: 'bonuses', class: 'section-block' },
      h('div', { class: 'section-head' },
        h('div', {},
          h('span', { class: 'eyebrow' }, 'Payouts'),
          h('h2', {}, 'Bonuses given so far'),
          h('p', { class: 'muted' }, total != null
            ? usd0(total) + ' USD paid across these bonuses.'
            : 'Running totals for bonuses already paid.'))),
      h('div', { class: 'payout-grid' },
        items.map((item, i) => h('article', { class: 'payout-card' },
          h('span', { class: 'payout-label' }, item.label),
          h('strong', { class: 'payout-amount' }, values[i] != null ? usd0(values[i]) : '—'),
          h('p', { class: 'muted' }, item.blurb)))));
  }

  function rtpRulesPanel() {
    const rules = [
      { label: 'RTP 98% or lower', count: '100%', tone: 'gold' },
      { label: 'RTP above 98%', count: '50%', tone: 'violet' },
      { label: 'RTP 99% or higher', count: '10%', tone: 'pink' },
    ];
    return h('section', { id: 'rtp-rules', class: 'lb-rtp' },
      h('h2', {}, 'RTP rules'),
      h('p', { class: 'muted' }, 'Weighted by RTP · Stake standard. These totals already use Stake’s weighted wager rules.'),
      h('div', { class: 'lb-rtp-list' },
        rules.map((r) => h('div', { class: 'lb-rtp-row' },
          h('span', {}, r.label),
          h('span', { class: 'lb-rtp-arrow', 'aria-hidden': 'true' }, '→'),
          h('strong', { class: 'lb-rtp-count is-' + r.tone }, r.count)))));
  }

  function extraBonusPanel() {
    return h('a', { class: 'lb-bonus', href: '#/benefits' },
      h('span', { class: 'eyebrow' }, 'Extra bonus'),
      h('h2', {}, 'Code benefits'),
      h('p', {}, 'Affiliate extras on top of the race prizes. Open Code benefits for the current rewards.'),
      h('span', { class: 'lb-bonus-cta' }, 'View code benefits'));
  }

  function codeSignupCta() {
    const code = (state.config && state.config.code) || 'Norochan';
    const href = (state.config && state.config.referralUrl) || '#/';
    return h('section', { class: 'lb-code-cta' },
      h('p', { class: 'muted' }, 'Want to compete for this month’s prizes?'),
      h('a', { class: 'lb-code-btn', href, target: '_blank', rel: 'noopener sponsored' }, 'Sign up with code: ' + code));
  }

  async function leaderboardView() {
    const c = state.config;
    const pool = rewardFigure('currentPrizePool');
    const out = h('div', { class: 'leaderboard-page' });
    const body = h('div', { class: 'leaderboard-body' }, listSkeleton(6));
    out.append(
      h('header', { class: 'page-intro' },
        h('span', { class: 'eyebrow' }, 'Stake race'),
        h('h1', {}, pool != null ? (usd0(pool) + ' monthly leaderboard') : ((c && c.race && c.race.title) || 'Leaderboard')),
        h('a', {
          class: 'lb-rtp-jump',
          href: '#rtp-rules',
          onclick: (event) => {
            event.preventDefault();
            const target = document.getElementById('rtp-rules');
            if (!target) return;
            const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
          },
        }, 'RTP Rules applied')),
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

    function buildMonthContent(entries, monthOffset, extraHint) {
      const frag = h('div', { class: 'leaderboard-view active' });
      if (monthOffset === 0) frag.append(leaderboardCountdown(leaderboardEndTimestamp(0), 'Time remaining'));
      else frag.append(h('p', { class: 'leaderboard-rule' }, 'Ended ' + formatMonthEndDate(monthOffset)));
      const top = (c && c.race && c.race.top) || 10;
      const shown = (entries || []).slice(0, top);
      if (shown.length) frag.append(podium(shown), rankedList(shown));
      else {
        frag.append(UI.emptyState
          ? UI.emptyState('No wager data yet.', 'Rankings appear once players wager under the code.')
          : h('p', { class: 'note' }, 'No wagers recorded yet.'));
      }
      if (extraHint) frag.append(extraHint);
      return frag;
    }

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
          h('h2', {}, 'Top 10'),
          summary,
          updated),
        monthTabs('lb', 'Leaderboard month', show))
    );
    panel.append(viewport);
    body.replaceChildren(panel, rtpRulesPanel(), codeSignupCta(), extraBonusPanel());
    show('current');
  }

  const SUPPORT = {
    telegramHandle: '@norochanmanager',
    telegramUrl: 'https://t.me/Norochanmanager',
    email: 'norochanofficial@gmail.com',
  };

  function supportSection() {
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
    return h('section', { id: 'support', class: 'section-block support-home', 'data-spy': 'support' },
      h('div', { class: 'section-head' },
        h('div', {},
          h('span', { class: 'eyebrow' }, 'Support'),
          h('h2', {}, 'Need help?'),
          h('p', { class: 'muted' }, 'Questions about the code, the wager race or prizes? Contact the Norochan team directly.'))),
      h('div', { class: 'support-grid' },
        contactCard({ stickerName: 'speech', label: 'Telegram', value: SUPPORT.telegramHandle, href: SUPPORT.telegramUrl, external: true, action: 'Message on Telegram' }),
        contactCard({ stickerName: 'email', label: 'Email', value: SUPPORT.email, href: 'mailto:' + SUPPORT.email, external: false, action: 'Send email' })),
      h('p', { class: 'note' }, 'The Norochan team will never ask for your Stake password or 2FA codes. Only trust the contacts listed here.'));
  }

  function accountView() {
    const wrap = h('div', { class: 'account-page' });
    const authErr = new URLSearchParams(String(location.hash).split('?')[1] || '').get('auth');
    const flash = authErr === 'expired'
      ? 'That confirmation link expired. Sign up again or resend it.'
      : authErr === 'kick-ok' ? 'Kick username connected.'
      : authErr === 'kick-taken' ? 'That Kick account is already connected to another Norochan account.'
      : authErr === 'kick-error' ? 'Kick did not finish. Try again.'
      : authErr && authErr !== 'ok' ? 'Sign-in did not finish. Try email, Google, or Kick.' : '';

    function paint(me) {
      paintNavAccount(me);
      const account = me && me.account;
      const providers = (me && me.auth) || { email: true, password: true, google: false, kick: false };
      const ownerCodes = (me && me.ownerCodes) || ['norochan', 'divu', 'ipl2026', 'deepu'];
      if (!account) {
        const status = h('p', { class: 'studio-note' + (flash ? ' warn' : ''), role: 'status' }, flash);
        const email = h('input', { type: 'email', name: 'email', autocomplete: 'email', required: '', placeholder: 'you@example.com' });
        const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: '', placeholder: 'At least 8 characters' });
        const form = h('form', { class: 'account-card' },
          h('span', { class: 'eyebrow' }, 'Account'),
          h('h1', {}, 'Sign in or create an account'),
          h('p', { class: 'muted' }, 'Email and a password, or Google / Kick. After email signup we send a confirmation link to your inbox.'),
          h('label', { class: 'studio-field' }, h('span', {}, 'Email'), email),
          h('label', { class: 'studio-field' }, h('span', {}, 'Password'), password),
          status,
          h('div', { class: 'account-oauth' },
            h('button', { class: 'btn', type: 'submit', 'data-mode': 'login' }, 'Sign in'),
            h('button', { class: 'btn secondary', type: 'submit', 'data-mode': 'signup' }, 'Create account'))
        );
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const mode = event.submitter && event.submitter.getAttribute('data-mode') || 'login';
          try {
            if (mode === 'signup') {
              await api('/api/auth/signup', { method: 'POST', body: { email: email.value, password: password.value } });
              status.classList.remove('warn');
              status.textContent = 'Check your email for a confirmation link. It expires in 15 minutes.';
              return;
            }
            const out = await api('/api/auth/login', { method: 'POST', body: { email: email.value, password: password.value } });
            state.me = Object.assign({}, me, { account: out.account, auth: providers, ownerCodes });
            paint(state.me);
          } catch (err) {
            status.classList.add('warn');
            status.textContent = err.message;
          }
        });
        const oauthRow = h('div', { class: 'account-oauth' });
        if (providers.google) oauthRow.append(h('a', { class: 'btn secondary', href: '/auth/google' }, 'Continue with Google'));
        oauthRow.append(h('a', { class: 'btn secondary', href: '/auth/kick' }, 'Continue with Kick'));
        const signedOut = [
          h('header', { class: 'page-intro' }, h('span', { class: 'eyebrow' }, 'Account'), h('h1', {}, 'Your Norochan account')),
          form,
        ];
        if (oauthRow.childNodes.length) signedOut.push(oauthRow);
        wrap.replaceChildren(...signedOut);
        return;
      }
      const badge = account.stakeUser
        ? (account.codeStatus === 'verified'
          ? h('span', { class: 'verify-badge is-ok' }, 'Code verified' + (account.codeMatched && account.codeMatched[0] ? ' · ' + account.codeMatched[0] : ''))
          : account.codeStatus === 'pending'
            ? h('span', { class: 'verify-badge' }, 'Waiting for staff · ' + (account.claimedCode || 'code'))
            : account.codeStatus === 'not_under_code'
              ? h('span', { class: 'verify-badge is-warn' }, 'Not under code')
              : h('span', { class: 'verify-badge' }, 'Code unknown'))
        : h('span', { class: 'verify-badge' }, 'Stake not set');
      const status = h('p', { class: 'studio-note', role: 'status' });
      const kids = [
        h('header', { class: 'page-intro' },
          h('span', { class: 'eyebrow' }, 'Account'),
          h('h1', {}, 'Signed in'),
          h('p', { class: 'muted' }, account.email || 'Connected account')),
        flash ? h('p', { class: 'studio-note' + (authErr === 'kick-ok' ? '' : ' warn'), role: 'status' }, flash) : null,
        h('section', { class: 'account-card' },
          h('h2', {}, 'Stake username'),
          h('p', { class: 'muted' }, 'Type the Stake name on this account. The public race board stays masked.'),
          h('p', {}, account.stakeUser ? account.stakeUser : 'Not set yet.'),
          badge),
        h('section', { class: 'account-card' },
          h('h2', {}, 'Kick username'),
          h('p', { class: 'muted' }, 'Connect the Kick account you watch with. Staff can see it next to your email.'),
          account.kickName ? h('p', {}, account.kickName) : h('p', {}, 'Not connected yet.'),
          account.kickName ? h('span', { class: 'verify-badge is-ok' }, 'Connected') : null,
          account.kickName
            ? null
            : h('a', { class: 'btn', href: '/auth/kick/connect' }, 'Connect Kick')),
      ];
      if (!account.stakeUser) {
        const name = h('input', { type: 'text', name: 'stakeUser', autocomplete: 'off', placeholder: 'Your Stake username' });
        const select = h('select', { name: 'code' },
          ownerCodes.map((c) => h('option', { value: c }, c)),
          h('option', { value: 'other' }, 'Other code'));
        const submitBtn = h('button', { class: 'btn', type: 'button' }, 'Save Stake username');
        submitBtn.addEventListener('click', async () => {
          try {
            const out = await api('/api/verify/claim', { method: 'POST', body: { stakeUser: name.value, code: select.value } });
            state.me = Object.assign({}, me, { account: out.account });
            paint(state.me);
          } catch (err) {
            status.classList.add('warn');
            status.textContent = err.message;
          }
        });
        kids.push(h('section', { class: 'account-card' },
          h('h2', {}, 'Prove this Stake account'),
          h('p', { class: 'muted' }, 'If you used norochan, divu, ipl2026 or deepu, staff will check it. Any other referral code is stored as not under code.'),
          h('label', { class: 'studio-field' }, h('span', {}, 'Stake username'), name),
          h('label', { class: 'studio-field' }, h('span', {}, 'Referral code on this Stake account'), select),
          submitBtn,
          status));
      }
      const logout = h('button', { class: 'btn secondary', type: 'button' }, 'Sign out');
      logout.addEventListener('click', async () => {
        try { await api('/api/auth/logout', { method: 'POST', body: {} }); }
        catch { /* still leave */ }
        state.me = { account: null, auth: providers, ownerCodes };
        paint(state.me);
      });
      kids.push(logout);
      wrap.replaceChildren(...kids.filter(Boolean));
    }

    wrap.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    api('/api/me').then((me) => { state.me = me; paint(me); }).catch((err) => {
      wrap.replaceChildren(h('p', { class: 'note warn' }, err.message));
    });
    return wrap;
  }

  const pageNames = { home: 'Home', leaderboard: 'Leaderboard', support: 'Support', wheel: 'Wheel', benefits: 'Code benefits', announcements: 'Announcement', streams: 'Streams', community: 'Community', account: 'Account' };
  const homeSections = { wheel: 'wheel', benefits: 'benefits', announcements: 'announcements', streams: 'streams', community: 'community', support: 'support' };

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

  function revealInView() {
    for (const el of app.querySelectorAll('.reveal:not(.is-visible)')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.bottom > 0 && r.top < window.innerHeight) el.classList.add('is-visible');
    }
  }
  let revealTick = 0;
  window.addEventListener('scroll', () => {
    if (revealTick) return;
    revealTick = requestAnimationFrame(() => { revealTick = 0; revealInView(); });
  }, { passive: true });

  function scrollHomeTo(name) {
    const el = homeSections[name] && document.getElementById(homeSections[name]);
    if (el) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    else window.scrollTo({ top: 0, behavior: scrollBehavior() });
    setActiveNav(homeSections[name] ? name : 'home');
    requestAnimationFrame(() => requestAnimationFrame(revealInView));
    window.addEventListener('scrollend', revealInView, { once: true });
    setTimeout(revealInView, 480);
  }

  const progressBar = h('div', { class: 'scroll-progress', 'aria-hidden': 'true' });
  document.body.append(progressBar);

  const revealSelector = '.hero-copy, .hero-rail, .hero-stat, .stat-card, .promo-panel, .race-card, .section-head, .reward-card, .board-card, .payout-board, .payout-card, .kick-live-card, .community-card, .page-intro, .support-card, .feed-card, .benefit-card, .wheel-stage';
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
    requestAnimationFrame(() => requestAnimationFrame(revealInView));
  }

  // Cursor-following light on cards and a small parallax on the hero stickers (mouse only).
  const spotSelector = '.stat-card, .community-card, .reward-card, .payout-card, .race-card, .promo-panel, .board-card, .kick-live-card, .hero-rail, .support-card, .benefit-card';
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
    stopViewerPoll();
    stopWheelPoll();
    stopMoneyRain();
    setActiveNav(section || (['leaderboard', 'account'].includes(name) ? name : 'home'));
    const announcer = document.getElementById('route-announcer');
    if (announcer) announcer.textContent = pageNames[name] || pageNames.home;
    if (name === 'leaderboard') { currentView = 'leaderboard'; await leaderboardView(); }
    else if (name === 'account') { currentView = 'account'; app.replaceChildren(accountView()); }
    else { currentView = 'home'; app.replaceChildren(homeView()); }
    document.body.classList.toggle('is-home', currentView === 'home');
    refreshTabIndicators();
    if (document.activeElement === document.body) {
      try { app.focus({ preventScroll: true }); } catch { app.focus(); }
    }
    initReveal();
    if (section) scrollHomeTo(name);
    else window.scrollTo(0, 0);
    if (!section) updateScrollSpy();
  }

  function paintNavAccount(me) {
    const el = document.getElementById('nav-account');
    const account = me && me.account;
    const stake = account && account.stakeUser ? String(account.stakeUser).trim() : '';
    const letterSource = stake || (account && account.email) || 'A';
    const letter = (letterSource.charAt(0) || 'A').toUpperCase();
    const label = stake || 'Account';
    if (el) {
      const mark = el.querySelector('.nav-account-mark');
      const name = el.querySelector('.nav-account-name');
      if (mark) mark.textContent = letter;
      if (name) name.textContent = label;
      el.classList.toggle('is-signed-in', !!account);
      el.setAttribute('aria-label', stake ? 'Account, ' + stake : 'Account');
      el.title = stake || 'Account';
    }
    document.querySelectorAll('.mobile-nav-links a[data-route="account"]').forEach((a) => {
      a.textContent = label;
    });
  }

  function syncNavLive(data) {
    const live = !!(data && data.status === 'live');
    const offline = !!(data && data.status === 'offline');
    const text = live ? 'Live' : offline ? 'Offline' : 'Unavailable';
    const viewers = data && data.viewers != null ? data.viewers.toLocaleString() + ' viewers' : '';
    const hero = document.getElementById('hero-live');
    if (hero) {
      hero.dataset.live = live ? 'true' : 'false';
      const heroLabel = hero.querySelector('.hero-live-label');
      if (heroLabel) heroLabel.textContent = viewers ? text + ' · ' + viewers : text;
    }
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
    api('/api/me').then((me) => { state.me = me; paintNavAccount(me); }).catch(() => paintNavAccount(null));
    state.rewards = await rewards;
    pollNavLive();
    setInterval(pollNavLive, 45000);
    window.addEventListener('hashchange', route);
    route();
  }
  init();
})();
