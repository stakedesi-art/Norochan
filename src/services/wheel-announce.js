'use strict';
// After UTC month-end finalize: record the 3-winner spin and post it to the Discord webhook.
const crypto = require('crypto');
const { DISCORD_WHEEL_WEBHOOK, PUBLIC_SITE_URL, CONFIG } = require('../config');
const storage = require('../storage');
const { mask } = require('./stake');
const { renderDrawGif, periodLabel } = require('./wheel-video');

const POST_WINDOW_MS = 72 * 60 * 60 * 1000;
const pending = new Set();

function webhookOk(url) {
  try {
    const u = new URL(String(url || ''));
    const local = u.hostname === '127.0.0.1' && u.protocol === 'http:';
    if (u.protocol !== 'https:' && !local) return false;
    if (!local && u.hostname !== 'discord.com' && u.hostname !== 'discordapp.com') return false;
    return /\/api\/webhooks\/[^/]+\/[^/]+/.test(u.pathname);
  } catch {
    return false;
  }
}

function configured() {
  return webhookOk(DISCORD_WHEEL_WEBHOOK);
}

function usd(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function publicWinners(row) {
  return (row.winners || []).map((w) => ({
    name: w.name && String(w.name).includes('***') ? w.name : mask(w.user || w.name),
    tickets: Number(w.tickets) || 0,
    prize: w.prize,
  }));
}

function publicBoard(row) {
  return (row.board || []).map((e) => ({
    name: e.name && String(e.name).includes('***') ? e.name : mask(e.user || e.name),
    tickets: Number(e.tickets) || 0,
  }));
}

function messageText(row, winners) {
  const site = String(PUBLIC_SITE_URL || 'https://norochan.com').replace(/\/+$/, '');
  const lines = [
    '**' + CONFIG.name + ' monthly wheel — ' + periodLabel(row.period) + '**',
    'Live draw of ' + winners.length + ' winners. Pool ' + usd(row.prizePool) + ' split equally.',
    '',
  ];
  winners.forEach((w, i) => {
    lines.push((i + 1) + '. **' + w.name + '** — ' + Number(w.tickets).toLocaleString('en-US') + ' tickets' + (w.prize != null ? ' — ' + usd(w.prize) : ''));
  });
  lines.push('', 'Watch on the site: ' + site + '/');
  return lines.join('\n');
}

function multipart(fields, file) {
  const boundary = '----noro' + crypto.randomBytes(12).toString('hex');
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\nContent-Type: application/json\r\n\r\n' + value + '\r\n'
    ));
  }
  if (file) {
    parts.push(Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="files[0]"; filename="' + file.filename + '"\r\nContent-Type: ' + file.type + '\r\n\r\n'
    ));
    parts.push(file.body);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from('--' + boundary + '--\r\n'));
  return { boundary, body: Buffer.concat(parts) };
}

async function postWebhook(content, gif) {
  const payload = JSON.stringify({
    content,
    allowed_mentions: { parse: [] },
    flags: 0,
  });
  const { boundary, body } = multipart({ payload_json: payload }, gif
    ? { filename: gif.filename, type: 'image/gif', body: gif.body }
    : null);
  const res = await fetch(DISCORD_WHEEL_WEBHOOK + (DISCORD_WHEEL_WEBHOOK.includes('?') ? '&' : '?') + 'wait=true', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Discord webhook HTTP ' + res.status + (text ? ': ' + text.slice(0, 180) : ''));
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return json;
}

function stillOpen(row, now) {
  const at = Date.parse(row.drawnAt);
  if (!Number.isFinite(at)) return false;
  return now - at <= POST_WINDOW_MS;
}

let warnedNoHook = false;

async function postDraw(row, now = Date.now()) {
  if (!row || (row.discord && row.discord.postedAt)) return row.discord || null;
  if (!configured()) return null;
  if (!stillOpen(row, now)) return null;
  const winners = publicWinners(row);
  if (!winners.length) return null;
  const content = messageText(row, winners);
  let gif = null;
  try {
    const body = renderDrawGif({
      period: row.period,
      prizePool: row.prizePool,
      winners,
      board: publicBoard(row),
    });
    if (body && body.length) gif = { filename: 'norochan-wheel-' + row.period + '.gif', body };
  } catch (err) {
    console.error('[wheel] draw video failed:', err.message);
  }
  const posted = await postWebhook(content, gif);
  row.discord = {
    postedAt: new Date(now).toISOString(),
    hasVideo: !!(gif && gif.body && gif.body.length),
    messageId: posted && posted.id ? String(posted.id) : null,
  };
  storage.save();
  console.log('[wheel] Discord post for ' + row.period + (row.discord.hasVideo ? ' with video' : ' (text only)'));
  return row.discord;
}

function queue(row, now = Date.now()) {
  if (!row || !row.period) return;
  if (row.discord && row.discord.postedAt) return;
  if (!configured()) {
    if (!warnedNoHook) {
      warnedNoHook = true;
      console.warn('[wheel] Discord webhook not set; skip draw post (set DISCORD_WHEEL_WEBHOOK).');
    }
    return;
  }
  if (pending.has(row.period)) return;
  pending.add(row.period);
  setImmediate(() => {
    postDraw(row, now)
      .catch((err) => console.error('[wheel] Discord post failed:', err.message))
      .finally(() => pending.delete(row.period));
  });
}

module.exports = { configured, queue, postDraw, webhookOk, messageText, publicWinners };
