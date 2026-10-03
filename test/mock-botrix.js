'use strict';
// Test fixture standing in for the BotRix leaderboard endpoint. Only used by test/smoke.js.
//   MOCK_BOTRIX_PORT=4200 node test/mock-botrix.js
// Flip behaviour while running: GET /__mode/ok, /__mode/429, /__mode/garbage
const http = require('http');

const PORT = Number(process.env.MOCK_BOTRIX_PORT) || 4200;
const KEY = process.env.MOCK_BOTRIX_KEY || 'test-key';
let mode = 'ok';

const fixture = [
  { name: 'chatty_cat', points: 5200, watchtime: 610, level: 12, avatar: 'https://files.kick.com/images/user/1/profile_image/a.webp' },
  { name: 'night_owl', points: 9100, watchtime: 1500, level: 18, avatar: 'https://evil.example/tracker.png' },
  { name: 'lurker42', points: 300, watchtime: 45, level: 2 },
  { name: 'night_owl', points: 1, watchtime: 1 },
  { points: 999, watchtime: 999 },
  { name: 'mod_mika', points: 7000, watchtime: 900, level: 15 },
];

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, body, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(body); };
  if (url.pathname.startsWith('/__mode/')) { mode = url.pathname.split('/').pop(); return send(200, JSON.stringify({ mode })); }
  if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, '{"error":"unauthorized"}');
  if (url.pathname !== '/v1/kick/norochan/leaderboard') return send(404, '{"error":"not found"}');
  if (mode === '429') return send(429, '{"error":"slow down"}', { 'Retry-After': '120' });
  if (mode === 'garbage') return send(200, '{"message":"no list here"}');
  return send(200, JSON.stringify({ data: fixture }));
}).listen(PORT, '127.0.0.1', () => console.log(`Mock BotRix on http://127.0.0.1:${PORT}`));
