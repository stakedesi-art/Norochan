'use strict';
(function () {
  const app = document.getElementById('studio-app');
  const logoutBtn = document.getElementById('studio-logout');
  const state = { categories: [], announcements: [], benefits: [], wheel: null, prizes: null, accounts: [], page: 'users', editingBenefitId: null };
  let renderDash = null;
  let csrf = '';
  let bootGen = 0;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  async function api(path, opts = {}) {
    const method = opts.method || 'GET';
    const mutating = method !== 'GET' && method !== 'HEAD';
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(mutating && csrf ? { 'X-Studio-CSRF': csrf } : {}),
        ...opts.headers,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.csrf) csrf = data.csrf;
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    return data;
  }

  const field = (label, input) => h('label', { class: 'studio-field' }, h('span', {}, label), input);
  const note = () => h('p', { class: 'studio-note', role: 'status' });
  const setNote = (el, text, warn) => { el.textContent = text || ''; el.classList.toggle('warn', !!warn); };

  function loginView(message) {
    renderDash = null;
    if (logoutBtn) logoutBtn.hidden = true;
    const status = h('p', { class: 'studio-note' + (message ? ' warn' : ''), role: 'status' }, message || '');
    const password = h('input', {
      type: 'password',
      name: 'password',
      autocomplete: 'current-password',
      required: '',
      minlength: '8',
      placeholder: 'Staff password',
      spellcheck: 'false',
    });
    const form = h('form', { class: 'studio-login', autocomplete: 'on', novalidate: '' },
      h('span', { class: 'eyebrow' }, 'Staff'),
      h('h1', {}, 'Studio'),
      h('p', { class: 'muted' }, 'Use the ADMIN_PASSWORD from .env. This URL is not in the public navigation.'),
      field('Password', password),
      status,
      h('button', { class: 'btn', type: 'submit' }, 'Log in')
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const pass = String(password.value || '');
      if (pass.length < 8) {
        setNote(status, 'Enter the staff password (8+ characters).', true);
        password.focus();
        return;
      }
      try {
        const gen = ++bootGen;
        await api('/api/admin/login', { method: 'POST', body: { password: pass } });
        if (gen !== bootGen) return;
        const session = await api('/api/admin/session');
        if (gen !== bootGen) return;
        if (!session.staff) {
          setNote(status, 'Password accepted, but the staff cookie was not kept. Open this page at http://127.0.0.1:3000/studio.html and try again.', true);
          return;
        }
        state.categories = session.categories || [];
        await dashboard();
      } catch (err) {
        setNote(status, err.message, true);
      }
    });
    app.replaceChildren(h('div', { class: 'studio-shell' }, form));
    password.focus();
  }

  function rowActions(kind, row, onRefresh) {
    const wrap = h('div', { class: 'studio-row-actions' });
    if (kind === 'benefit') {
      wrap.append(h('button', {
        class: 'btn small secondary', type: 'button',
        onclick: () => {
          state.editingBenefitId = row.id;
          if (location.hash !== '#/benefits') location.hash = '#/benefits';
          if (renderDash) renderDash();
        },
      }, 'Edit'));
    }
    wrap.append(
      h('button', {
        class: 'btn small secondary', type: 'button',
        onclick: async () => {
          try {
            await api('/api/admin/' + (kind === 'announcement' ? 'announcements' : 'benefits') + '/' + encodeURIComponent(row.id), {
              method: 'PATCH',
              body: { published: !row.published },
            });
            await onRefresh();
          } catch (err) { window.alert(err.message); }
        },
      }, row.published ? 'Unpublish' : 'Publish'),
      h('button', {
        class: 'btn small danger', type: 'button',
        onclick: async () => {
          if (!window.confirm('Delete this post?')) return;
          try {
            if (state.editingBenefitId === row.id) state.editingBenefitId = null;
            await api('/api/admin/' + (kind === 'announcement' ? 'announcements' : 'benefits') + '/' + encodeURIComponent(row.id), { method: 'DELETE' });
            await onRefresh();
          } catch (err) { window.alert(err.message); }
        },
      }, 'Delete')
    );
    return wrap;
  }

  function announcementForm(onDone) {
    const status = note();
    const title = h('input', { type: 'text', maxlength: '120', required: '' });
    const body = h('textarea', { rows: '4', maxlength: '2000' });
    const published = h('input', { type: 'checkbox' });
    published.checked = true;
    const form = h('form', { class: 'studio-form' },
      h('h3', {}, 'New announcement'),
      field('Title', title),
      field('Body', body),
      h('label', { class: 'studio-check' }, published, h('span', {}, 'Published')),
      status,
      h('button', { class: 'btn small', type: 'submit' }, 'Publish')
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/admin/announcements', { method: 'POST', body: { title: title.value, body: body.value, published: published.checked } });
        title.value = '';
        body.value = '';
        published.checked = true;
        setNote(status, 'Saved.');
        await onDone();
      } catch (err) { setNote(status, err.message, true); }
    });
    return form;
  }

  function benefitForm(onDone) {
    const row = (state.benefits || []).find((item) => item.id === state.editingBenefitId) || null;
    const editing = !!row;
    const status = note();
    const category = h('select', { required: '' });
    for (const cat of state.categories) category.append(h('option', { value: cat.id }, cat.label));
    const title = h('input', { type: 'text', maxlength: '120', required: '' });
    const body = h('textarea', { rows: '4', maxlength: '2000' });
    const amount = h('input', { type: 'number', min: '0', step: '1', placeholder: 'Optional USD' });
    const ctaLabel = h('input', { type: 'text', maxlength: '40', placeholder: 'Optional' });
    const ctaUrl = h('input', { type: 'url', maxlength: '300', placeholder: 'https://' });
    const published = h('input', { type: 'checkbox' });
    published.checked = true;
    if (editing) {
      category.value = row.category || '';
      title.value = row.title || '';
      body.value = row.body || '';
      amount.value = row.amount != null ? String(row.amount) : '';
      ctaLabel.value = row.ctaLabel || '';
      ctaUrl.value = row.ctaUrl || '';
      published.checked = row.published !== false;
    }
    const actions = h('div', { class: 'studio-form-actions' },
      h('button', { class: 'btn small', type: 'submit' }, editing ? 'Save' : 'Publish'),
      editing ? h('button', {
        class: 'btn small secondary', type: 'button',
        onclick: () => { state.editingBenefitId = null; if (renderDash) renderDash(); },
      }, 'Cancel') : null);
    const form = h('form', { class: 'studio-form' },
      h('h3', {}, editing ? 'Update code benefit' : 'New code benefit'),
      field('Reward category', category),
      field('Title', title),
      field('Details', body),
      field('Amount (USD)', amount),
      field('Button label', ctaLabel),
      field('Button link', ctaUrl),
      h('label', { class: 'studio-check' }, published, h('span', {}, 'Published')),
      status,
      actions
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        category: category.value,
        title: title.value,
        body: body.value,
        amount: amount.value === '' ? null : amount.value,
        ctaLabel: ctaLabel.value,
        ctaUrl: ctaUrl.value,
        published: published.checked,
      };
      try {
        if (editing) {
          await api('/api/admin/benefits/' + encodeURIComponent(row.id), { method: 'PATCH', body: payload });
          state.editingBenefitId = null;
        } else {
          await api('/api/admin/benefits', { method: 'POST', body: payload });
        }
        setNote(status, 'Saved.');
        await onDone();
      } catch (err) { setNote(status, err.message, true); }
    });
    return form;
  }

  function listCard(title, rows, kind, emptyText, extra) {
    const list = h('div', { class: 'studio-list' });
    if (!rows.length) list.append(h('p', { class: 'muted' }, emptyText));
    else {
      for (const row of rows) {
        const cat = kind === 'benefit' ? (state.categories.find((c) => c.id === row.category) || { label: row.category }) : null;
        list.append(h('article', { class: 'studio-item' + (row.published ? '' : ' is-draft') + (kind === 'benefit' && state.editingBenefitId === row.id ? ' is-editing' : '') },
          h('div', {},
            h('p', { class: 'studio-item-meta' },
              row.published ? 'Published' : 'Draft',
              cat ? ' · ' + cat.label : '',
              row.amount != null ? ' · $' + Number(row.amount).toLocaleString('en-US') : ''),
            h('h4', {}, row.title),
            row.body ? h('p', { class: 'muted' }, row.body) : null),
          rowActions(kind, row, extra)));
      }
    }
    return h('section', { class: 'studio-card' }, h('h2', {}, title), list);
  }

  function wheelPanel(onRefresh) {
    const wheel = state.wheel || { prizePool: 50, eligibleCount: 0, lastDraw: null, winnersCount: 3, ticketUsd: 1000 };
    const status = note();
    const amount = h('input', { type: 'number', min: '0', max: '99999999', step: '1', value: String(wheel.prizePool ?? 50), required: '' });
    const form = h('form', { class: 'studio-form' },
      h('h3', {}, 'Monthly prize pool'),
      h('p', { class: 'muted' }, 'This is the only wheel setting. Three winners are drawn automatically at UTC month end, weighted by tickets. The prize pool is split equally among them. Visitors cannot run the draw. The site records the full 3-winner spin and posts that video to Discord if DISCORD_WHEEL_WEBHOOK is set.'),
      field('Prize pool (USD)', amount),
      status,
      h('button', { class: 'btn small', type: 'submit' }, 'Save pool')
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        state.wheel = await api('/api/admin/wheel', { method: 'PATCH', body: { prizePool: amount.value } });
        setNote(status, 'Saved.');
        await onRefresh();
      } catch (err) { setNote(status, err.message, true); }
    });
    const last = wheel.lastDraw;
    const discord = wheel.discord || {};
    const lastBlock = last
      ? h('div', { class: 'studio-wheel-last' },
        h('p', { class: 'studio-item-meta' }, 'Last draw · ' + last.period + (last.prizePool != null ? ' · $' + Number(last.prizePool).toLocaleString('en-US') : '')),
        (last.winners || []).map((w) => h('p', {}, (w.user || w.name) + ' · ' + Number(w.tickets).toLocaleString('en-US') + ' tickets' + (w.prize != null ? ' · $' + Number(w.prize).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''))),
        h('p', { class: 'muted' }, discord.configured
          ? (last.discord && last.discord.postedAt
            ? 'Discord: posted' + (last.discord.hasVideo ? ' with video' : '') + ' at ' + last.discord.postedAt
            : 'Discord: webhook is set. The spin video posts automatically after the UTC month-end draw.')
          : 'Discord: not configured. Create a channel webhook and set DISCORD_WHEEL_WEBHOOK.'))
      : h('p', { class: 'muted' }, 'No closed month has been drawn yet. The wheel starts this race month. The first automatic draw runs after UTC month end.');
    return h('section', { class: 'studio-card' },
      h('h2', {}, 'Monthly wheel'),
      h('p', { class: 'muted' }, (wheel.eligibleCount || 0) + ' eligible this month · ' + (wheel.winnersCount || 3) + ' winners · pool split equally · $' + Number(wheel.ticketUsd || 1000).toLocaleString('en-US') + ' raw = 1 ticket'),
      form,
      lastBlock);
  }

  function prizesPanel(onRefresh) {
    const prizes = state.prizes || {};
    function placeInputs(map, count) {
      const inputs = [];
      for (let rank = 1; rank <= count; rank++) {
        const value = map && map[rank] != null ? String(map[rank]) : '';
        inputs.push(h('input', {
          type: 'number', min: '0', max: '99999999', step: '1',
          value,
          placeholder: '0',
          'data-rank': String(rank),
          'aria-label': '#' + rank + ' USD',
        }));
      }
      return inputs;
    }
    function readPlaces(wrap) {
      const out = {};
      wrap.querySelectorAll('input[data-rank]').forEach((input) => {
        out[input.getAttribute('data-rank')] = input.value;
      });
      return out;
    }
    function boardCard(title, hint, poolKey, poolValue, placesKey, places, placeCount) {
      const status = note();
      const amount = h('input', {
        type: 'number', min: '0', max: '99999999', step: '1',
        value: poolValue != null ? String(poolValue) : '',
        placeholder: '0',
        required: '',
      });
      const grid = h('div', { class: 'studio-place-grid' });
      placeInputs(places, placeCount).forEach((input, i) => {
        grid.append(field('#' + (i + 1), input));
      });
      const form = h('form', { class: 'studio-form' },
        h('h3', {}, title),
        h('p', { class: 'muted' }, hint),
        field('Prize pool (USD)', amount),
        h('p', { class: 'studio-item-meta' }, 'Place amounts (USD)'),
        grid,
        status,
        h('button', { class: 'btn small', type: 'submit' }, 'Save prizes')
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          state.prizes = await api('/api/admin/prizes', {
            method: 'PATCH',
            body: { [poolKey]: amount.value, [placesKey]: readPlaces(grid) },
          });
          setNote(status, 'Saved.');
          await onRefresh();
        } catch (err) { setNote(status, err.message, true); }
      });
      return h('section', { class: 'studio-card' }, form);
    }
    function bonusesCard() {
      const status = note();
      const leaderboard = h('input', {
        type: 'number', min: '0', max: '99999999', step: '1',
        value: prizes.leaderboardPayout != null ? String(prizes.leaderboardPayout) : '',
        placeholder: '0',
      });
      const levelUp = h('input', {
        type: 'number', min: '0', max: '99999999', step: '1',
        value: prizes.levelUpBonus != null ? String(prizes.levelUpBonus) : '',
        placeholder: '0',
      });
      const social = h('input', {
        type: 'number', min: '0', max: '99999999', step: '1',
        value: prizes.socialMediaGiveaways != null ? String(prizes.socialMediaGiveaways) : '',
        placeholder: '0',
      });
      const form = h('form', { class: 'studio-form' },
        h('h3', {}, 'Bonuses given so far'),
        h('p', { class: 'muted' }, 'These running totals appear on the public home page after Community. They are amounts already paid, not this month’s prize pools. Leave a field blank to hide that figure.'),
        field('Leaderboard bonuses (USD)', leaderboard),
        field('Level-up bonuses (USD)', levelUp),
        field('Social giveaways (USD)', social),
        status,
        h('button', { class: 'btn small', type: 'submit' }, 'Save bonuses')
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          state.prizes = await api('/api/admin/prizes', {
            method: 'PATCH',
            body: {
              leaderboardPayout: leaderboard.value,
              levelUpBonus: levelUp.value,
              socialMediaGiveaways: social.value,
            },
          });
          setNote(status, 'Saved.');
          await onRefresh();
        } catch (err) { setNote(status, err.message, true); }
      });
      return h('section', { class: 'studio-card' }, form);
    }
    return h('div', { class: 'studio-page' },
      boardCard(
        'Wager race prize pool',
        'Headline pool on the public Stake race, plus how much each of the top 10 places is paid.',
        'racePrizePool',
        prizes.racePrizePool != null ? prizes.racePrizePool : prizes.fallbackRacePrizePool,
        'racePrizes',
        prizes.racePrizes || {},
        10
      ),
      boardCard(
        'Kick viewer board prize pool',
        'Headline pool on the public Top viewers card, plus how much the top 3 Kick viewers are paid. Watchtime ranking does not change.',
        'viewerPrizePool',
        prizes.viewerPrizePool,
        'viewerRewards',
        prizes.viewerRewards || {},
        3
      ),
      bonusesCard());
  }

  function accountsPanel(onRefresh) {
    const rows = state.accounts || [];
    const pending = rows.filter((row) => row.codeStatus === 'pending');
    async function setCode(id, verdict) {
      try {
        await api('/api/admin/accounts/' + encodeURIComponent(id) + '/code', { method: 'POST', body: { verdict } });
        await onRefresh();
      } catch (err) { window.alert(err.message); }
    }
    async function unbind(id) {
      if (!window.confirm('Unbind this Stake username? They must enter it again. A new owner-code pick will come back for review.')) return;
      try {
        await api('/api/admin/accounts/' + encodeURIComponent(id) + '/unbind', { method: 'POST', body: {} });
        await onRefresh();
      } catch (err) { window.alert(err.message); }
    }
    function reviewActions(row) {
      const actions = [];
      if (row.codeStatus === 'pending') {
        actions.push(h('button', { class: 'btn small', type: 'button', onclick: () => setCode(row.id, 'verified') }, 'Under code'));
        actions.push(h('button', { class: 'btn small danger', type: 'button', onclick: () => setCode(row.id, 'not_under_code') }, 'Not under code'));
      }
      if (row.stakeUser) {
        actions.push(h('button', { class: 'btn small danger', type: 'button', onclick: () => unbind(row.id) }, 'Unbind'));
      }
      return actions.length ? h('div', { class: 'studio-row-actions' }, actions) : null;
    }
    const queue = pending.length
      ? pending.map((row) => h('article', { class: 'studio-item' },
        h('div', {},
          h('h4', {}, row.email || row.id),
          h('p', { class: 'studio-item-meta' },
            (row.stakeUser || '—') + ' · claimed ' + (row.claimedCode || 'code') +
            (row.referredHint && row.referredHint.length ? ' · Stake list: ' + row.referredHint.join(', ') : ' · not on referred-users'))),
        reviewActions(row)))
      : h('p', { class: 'muted' }, 'No code checks waiting. After Unbind, when they submit an owner code again, it comes back here.');
    const refreshBtn = h('button', { class: 'btn small secondary', type: 'button', onclick: () => onRefresh() }, 'Refresh checks');
    return h('section', { class: 'studio-card' },
      h('h2', {}, 'Code checks'),
      h('p', { class: 'muted' }, 'Every owner-code submit, including after Unbind, waits here. Use Under code or Not under code. Unbind only clears the name.'),
      refreshBtn,
      queue);
  }

  function usersPanel(onRefresh) {
    const rows = state.accounts || [];
    function codeCell(row) {
      if (row.codeStatus === 'verified') return 'Verified';
      if (row.codeStatus === 'not_under_code') return 'Not under code';
      if (row.codeStatus === 'pending') return 'Needs check';
      return '—';
    }
    const body = rows.length
      ? rows.map((row) => h('tr', {},
        h('td', {}, row.email || '—'),
        h('td', {}, row.stakeUser || '—'),
        h('td', { class: row.codeStatus === 'verified' ? 'is-verified' : row.codeStatus === 'not_under_code' ? 'is-not-code' : '' }, codeCell(row)),
        h('td', {}, row.kickName || '—')))
      : [h('tr', {}, h('td', { colspan: '4' }, h('p', { class: 'muted' }, 'No registered users yet.')))];
    return h('section', { class: 'studio-card studio-users-panel' },
      h('h2', {}, 'Users'),
      h('p', { class: 'muted' }, 'Registered emails with Stake username, code status, and Kick username.'),
      h('button', { class: 'btn small secondary', type: 'button', onclick: () => onRefresh() }, 'Refresh users'),
      h('div', { class: 'studio-table-wrap' },
        h('table', { class: 'studio-users' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Email'),
            h('th', {}, 'Stake username'),
            h('th', {}, 'Code'),
            h('th', {}, 'Kick username'))),
          h('tbody', {}, body))));
  }

  function laterPanel() {
    return h('section', { class: 'studio-card studio-later' },
      h('h2', {}, 'Chat'),
      h('p', { class: 'muted' }, 'On-site chat is not built. Community stays on Discord and Telegram.'));
  }

  const PAGES = [
    { id: 'users', label: 'Users', title: 'Users', hint: 'Registered emails with Stake username, code status, and Kick username.' },
    { id: 'checks', label: 'Code checks', title: 'Code checks', hint: 'Owner-code submits wait here. Use Under code or Not under code. Unbind only clears the name.' },
    { id: 'wheel', label: 'Wheel', title: 'Monthly wheel', hint: 'Staff set the prize-pool total only. Three winners are drawn automatically at UTC month end.' },
    { id: 'prizes', label: 'Prizes', title: 'Prize pools', hint: 'Set this month’s race and Kick viewer pools and place amounts, plus the public Bonuses given so far totals.' },
    { id: 'announcements', label: 'Announcements', title: 'Announcements', hint: 'Published posts appear on the public home page. Drafts stay hidden.' },
    { id: 'benefits', label: 'Code benefits', title: 'Code benefits', hint: 'Reward-category posts. Empty categories stay off the public Rewards section.' },
    { id: 'chat', label: 'Chat', title: 'Chat', hint: 'Community stays on Discord and Telegram.' },
  ];

  function parsePage() {
    const id = String(location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return PAGES.some((page) => page.id === id) ? id : 'users';
  }

  function pageBody(id, refresh) {
    if (id === 'users') return usersPanel(refresh);
    if (id === 'checks') return accountsPanel(refresh);
    if (id === 'wheel') return wheelPanel(refresh);
    if (id === 'prizes') return prizesPanel(refresh);
    if (id === 'announcements') {
      return h('div', { class: 'studio-page' },
        announcementForm(refresh),
        listCard('Published and drafts', state.announcements, 'announcement', 'No announcements yet.', refresh));
    }
    if (id === 'benefits') {
      return h('div', { class: 'studio-page' },
        benefitForm(refresh),
        listCard('Published and drafts', state.benefits, 'benefit', 'No code-benefit posts yet.', refresh));
    }
    return laterPanel();
  }

  function studioNav(current) {
    const pending = (state.accounts || []).filter((row) => row.codeStatus === 'pending').length;
    return h('nav', { class: 'studio-nav', 'aria-label': 'Studio sections' },
      PAGES.map((page) => h('a', {
        href: '#/' + page.id,
        class: 'studio-nav-link' + (current === page.id ? ' is-active' : ''),
        'aria-current': current === page.id ? 'page' : null,
      }, page.label, page.id === 'checks' && pending > 0 ? h('span', { class: 'studio-nav-count' }, String(pending)) : null)));
  }

  async function loadLists() {
    const [ann, ben, wheel, prizes, acc] = await Promise.all([
      api('/api/admin/announcements'),
      api('/api/admin/benefits'),
      api('/api/admin/wheel'),
      api('/api/admin/prizes'),
      api('/api/admin/users'),
    ]);
    state.announcements = ann.items || [];
    state.benefits = ben.items || [];
    if (ben.categories && ben.categories.length) state.categories = ben.categories;
    state.wheel = wheel;
    state.prizes = prizes;
    state.accounts = acc.items || [];
  }

  async function dashboard() {
    logoutBtn.hidden = false;
    await loadLists();
    const refresh = async () => { await loadLists(); render(); };
    function render() {
      const id = parsePage();
      state.page = id;
      const page = PAGES.find((item) => item.id === id) || PAGES[0];
      app.replaceChildren(h('div', { class: 'studio-shell studio-dash' },
        studioNav(id),
        h('div', { class: 'studio-main' },
          h('header', { class: 'studio-intro' },
            h('span', { class: 'eyebrow' }, 'Staff'),
            h('h1', {}, page.title),
            h('p', { class: 'muted' }, page.hint)),
          pageBody(id, refresh))));
    }
    renderDash = render;
    if (!location.hash) location.hash = '#/users';
    render();
  }

  async function boot() {
    const gen = ++bootGen;
    try {
      const session = await api('/api/admin/session');
      if (gen !== bootGen) return;
      state.categories = session.categories || [];
      if (!session.configured) {
        loginView('Staff login is not configured. Set ADMIN_PASSWORD (8+ characters) and restart.');
        return;
      }
      if (!session.staff) { loginView(); return; }
      await dashboard();
    } catch (err) {
      if (gen !== bootGen) return;
      loginView(err.message);
    }
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* leave */ }
      csrf = '';
      renderDash = null;
      loginView();
    });
  }
  window.addEventListener('hashchange', () => { if (renderDash) renderDash(); });
  boot();
})();
