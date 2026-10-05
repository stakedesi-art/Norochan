'use strict';
// Fake Stake affiliate API for local testing. Returns CSV shaped like the real one.
//   node test/mock-stake.js
//   STAKE_API_BASE=http://localhost:4000 STAKE_TOKEN=test node server.js
// Flip behaviour while running: GET /__mode/401 (reject token), /__mode/ok, /__mode/badcols
const http = require('http');

const PORT = Number(process.env.MOCK_PORT) || 4000;
let mode = 'ok';

const named = ['Alice_W', 'bobby99', 'KaiTheGreat', 'luna.x', 'ZedRunner', 'mochi_77', 'Ryo-San', 'sakura_bet', 'tanuki', 'haru_k'];
const players = Array.from({ length: 130 }, (_, i) => (i < named.length ? named[i] : `user${i + 1}`));

function leaderboardCsv(limit) {
  const header = mode === 'badcols'
    ? 'rank,player,total_wagered_amount (USD)'
    : 'rank,user_name,campaign_code,total_wagered_amount (USD),total_weighted_amount (USD)';
  const lines = [header];
  players.slice(0, limit).forEach((name, i) => {
    const wagered = 900000 / Math.pow(i + 1, 0.85);
    const weighted = wagered * 0.42;
    const money = (n) => `"$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}"`;
    lines.push(mode === 'badcols' ? `${i + 1},${name},${money(wagered)}` : `${i + 1},${name},"Norochan",${money(wagered)},${money(weighted)}`);
  });
  return lines.join('\n') + '\n';
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, body, type = 'text/csv') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };

  if (url.pathname.startsWith('/__mode/')) { mode = url.pathname.split('/').pop(); return send(200, 'mode=' + mode, 'text/plain'); }
    if (url.pathname.startsWith('/__bet/')) {
      const iid = decodeURIComponent(url.pathname.split('/').pop() || 'bet');
      const hidden = url.searchParams.get('ghost') === '1';
      const payload = {
        user: hidden ? null : { name: url.searchParams.get('user') || 'Alice_W' },
        game: { slug: url.searchParams.get('game') || 'limbo' },
        payoutMultiplier: Number(url.searchParams.get('m') || '2.847291'),
        amount: Number(url.searchParams.get('amount') || '0.01'),
        hidden,
        iid,
      };
      return send(200, `<!doctype html><script id="noro-bet" type="application/json">${JSON.stringify(payload)}</script>`, 'text/html');
    }
    if (!req.headers['x-access-token'] || mode === '401') return send(401, '{"error":"unauthorized"}', 'application/json');
  if (!/text\/csv/.test(req.headers.accept || '')) return send(406, 'need text/csv', 'text/plain');

    if (url.pathname === '/referred-users') {
      const lines = ['user_name,campaign_code', 'Alice_W,Norochan', 'bobby99,divu', 'luna.x,ipl2026', 'haru_k,deepu'];
      return send(200, lines.join('\n') + '\n');
    }
    if (url.pathname === '/leaderboard') {
    const q = url.searchParams;
    if (q.get('timePeriod') === 'currentMonth') return send(200, leaderboardCsv(Math.min(Number(q.get('limit')) || 100, 100)));
    for (const k of ['startDate', 'endDate']) {
      if (!/^\d{13}$/.test(q.get(k) || '')) return send(400, `${k} must be epoch milliseconds`, 'text/plain');
    }
    if (q.get('timePeriod') !== 'customRange') return send(400, 'timePeriod must be currentMonth or customRange', 'text/plain');
    return send(200, leaderboardCsv(Math.min(Number(q.get('limit')) || 100, 100)));
  }
  return send(404, 'not found', 'text/plain');
}).listen(PORT, '127.0.0.1', () => console.log(`Mock Stake API on http://127.0.0.1:${PORT}`));
