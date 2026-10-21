(function () {
  'use strict';

  const gate = document.getElementById('gate');
  const board = document.getElementById('board');
  const missing = document.getElementById('missing');
  const login = document.getElementById('login');
  const loginError = document.getElementById('login-error');
  let timer = 0;
  let scrollRaf = 0;
  let setupRaf = 0;
  let paintedKey = '';

  function usd(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function multi(value) {
    if (value == null || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'x';
  }

  function callLabel(n) {
    return '#' + n;
  }

  function stopScroll() {
    cancelAnimationFrame(scrollRaf);
    cancelAnimationFrame(setupRaf);
    scrollRaf = 0;
    setupRaf = 0;
  }

  function startScroll() {
    stopScroll();
    const view = document.getElementById('scroller');
    const track = document.getElementById('track');
    const reel = document.getElementById('reel');
    if (!view || !track || !reel) return;
    track.querySelectorAll('.reel-clone').forEach((node) => node.remove());
    track.style.transform = 'translate3d(0,0,0)';

    function run() {
      if (!board.hidden && reel.offsetHeight === 0) return;
      const loopHeight = reel.offsetHeight;
      if (loopHeight <= view.clientHeight + 8) return;
      if (track.querySelector('.reel-clone')) return;
      const clone = reel.cloneNode(true);
      clone.classList.add('reel-clone');
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
      let y = 0;
      let last = 0;
      let hold = 1800;
      const speed = 24;
      function frame(now) {
        if (!last) last = now;
        const dt = Math.min(40, now - last);
        last = now;
        if (hold > 0) hold -= dt;
        else y += speed * dt / 1000;
        if (y >= loopHeight) {
          y = 0;
          hold = 1800;
        }
        track.style.transform = 'translate3d(0,' + (-y) + 'px,0)';
        scrollRaf = requestAnimationFrame(frame);
      }
      scrollRaf = requestAnimationFrame(frame);
    }

    requestAnimationFrame(() => {
      setupRaf = requestAnimationFrame(run);
    });
  }

  function cell(className, text) {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  }

  function show(el, on) {
    el.hidden = !on;
  }

  function paint(payload) {
    const hunt = payload && payload.hunt;
    show(gate, false);
    show(board, !!hunt);
    show(missing, !hunt);
    if (!hunt) {
      stopScroll();
      paintedKey = '';
      return;
    }
    const key = JSON.stringify(payload);
    if (key === paintedKey) return;
    paintedKey = key;

    document.getElementById('title').textContent = hunt.title || 'Bonus hunt';
    const status = document.getElementById('status');
    status.textContent = payload.demo ? 'Demo' : (payload.live ? 'Live' : 'Completed');
    status.classList.toggle('is-done', !payload.live && !payload.demo);

    const winner = document.getElementById('winner');
    const hasWinner = !!hunt.winnerName;
    show(winner, hasWinner);
    document.getElementById('winner-name').textContent = hunt.winnerName || '';
    document.getElementById('winner-prize').textContent = hunt.prize ? 'Prize ' + usd(hunt.prize) : '';

    document.getElementById('stat-start').textContent = usd(hunt.startBalance);
    document.getElementById('stat-end').textContent = usd(hunt.endBalance);
    document.getElementById('stat-profit').textContent = usd(hunt.profit);
    document.getElementById('stat-multi').textContent = multi(hunt.bestMulti);
    document.getElementById('stat-win').textContent = hunt.biggestWin == null ? '—' : usd(hunt.biggestWin);
    document.getElementById('stat-called').textContent = (hunt.opened || 0) + ' / ' + (hunt.total || 0);

    const calls = document.getElementById('calls');
    calls.replaceChildren();
    (hunt.queue || []).forEach((row) => {
      const loss = !row.pending && Number(row.result) < 0;
      const item = document.createElement('li');
      item.className = 'row' + (row.pending ? ' is-pending' : '') + (loss ? ' is-loss' : '') + (row.best && !loss ? ' is-best' : '');
      item.append(
        cell('call', callLabel(row.position)),
        cell('name', row.name || 'Slot'),
        cell('multi', row.pending ? 'Waiting' : multi(row.multi)),
        cell('win', row.pending ? '—' : usd(row.result))
      );
      calls.append(item);
    });
    show(document.getElementById('calls-empty'), !(hunt.queue || []).length);

    const picks = document.getElementById('picks');
    picks.replaceChildren();
    (hunt.predictions || []).forEach((row) => {
      const item = document.createElement('li');
      item.className = 'row' + (row.winner ? ' is-winner' : '');
      item.append(
        cell('place', '#' + row.place),
        cell('name', row.name || 'Player'),
        cell('guess', usd(row.finalBalance)),
        cell('guess', multi(row.bestMulti))
      );
      picks.append(item);
    });
    show(document.getElementById('picks-empty'), !(hunt.predictions || []).length);
    startScroll();
  }

  async function load() {
    const demo = new URLSearchParams(location.search).get('demo') === '1' ? '?demo=1' : '';
    const res = await fetch('/api/admin/overlay' + demo, { credentials: 'same-origin' });
    if (res.status === 401) {
      stopScroll();
      paintedKey = '';
      show(board, false);
      show(missing, false);
      show(gate, true);
      return;
    }
    if (!res.ok) return;
    paint(await res.json());
  }

  function watch() {
    clearInterval(timer);
    timer = setInterval(load, 4000);
  }

  login.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';
    const password = new FormData(login).get('password');
    const res = await fetch('/api/admin/overlay/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      loginError.textContent = res.status === 401 ? 'Wrong password.' : 'Could not open the board.';
      return;
    }
    login.reset();
    await load();
    watch();
  });

  document.getElementById('logout').addEventListener('click', async () => {
    clearInterval(timer);
    stopScroll();
    paintedKey = '';
    await fetch('/api/admin/overlay/logout', { method: 'POST', credentials: 'same-origin' });
    show(board, false);
    show(missing, false);
    show(gate, true);
  });

  load().then(() => {
    if (!gate.hidden) return;
    watch();
  }).catch(() => {
    show(gate, true);
  });
})();
