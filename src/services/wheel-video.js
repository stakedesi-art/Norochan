'use strict';
// Records the monthly wheel spin as a GIF (no npm). Matches public slice colors and 3-winner live draw.
const SLICE = [0xc9a227, 0x4a2c82, 0x8a1f3d, 0xd4b36a, 0x241536, 0xb8860b, 0x6b2d5b, 0x3d2a1c];
const PALETTE = [
  0x101019, 0xe0b84a, 0x121018, 0xf6c445,
  ...SLICE,
  0xf7efe0, 0x1a1208, 0xfff4c4, 0x1c1428,
];
const I_BG = 0, I_GOLD = 1, I_HUB = 2, I_HIT = 3, I_SLICE0 = 4, I_CREAM = 12, I_DARK = 13, I_CAPTION = 15;

const { mask } = require('./stake');

function shownName(value) {
  const s = String(value || '');
  if (!s) return '';
  return s.includes('***') ? s : mask(s);
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function periodLabel(period) {
  const [y, m] = String(period || '').split('-').map(Number);
  if (!y || !m) return String(period || '');
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function usd(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function packGif(frames, size, delayCs) {
  const header = Buffer.from('GIF89a', 'ascii');
  const screen = Buffer.alloc(7);
  screen.writeUInt16LE(size, 0);
  screen.writeUInt16LE(size, 2);
  screen[4] = 0xF0 | 3; // global table, 16 colors
  screen[5] = 0;
  screen[6] = 0;
  const gct = Buffer.alloc(16 * 3);
  PALETTE.forEach((hex, i) => {
    gct[i * 3] = (hex >> 16) & 255;
    gct[i * 3 + 1] = (hex >> 8) & 255;
    gct[i * 3 + 2] = hex & 255;
  });
  const loop = Buffer.from([0x21, 0xFF, 0x0B, 0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00]);
  const parts = [header, screen, gct, loop];
  for (const pixels of frames) {
    const gce = Buffer.from([0x21, 0xF9, 0x04, 0x08, delayCs & 255, (delayCs >> 8) & 255, 0x00, 0x00]);
    const img = Buffer.alloc(10);
    img[0] = 0x2C;
    img.writeUInt16LE(size, 5);
    img.writeUInt16LE(size, 7);
    const lzw = lzwEncode(4, pixels);
    parts.push(gce, img, Buffer.from([4]), lzwBlocks(lzw));
  }
  parts.push(Buffer.from([0x3B]));
  return Buffer.concat(parts);
}

function lzwBlocks(data) {
  const chunks = [];
  for (let i = 0; i < data.length; i += 255) {
    const slice = data.subarray(i, Math.min(i + 255, data.length));
    chunks.push(Buffer.from([slice.length]), slice);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

function lzwEncode(minCodeSize, pixels) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoi + 1;
  const out = [];
  let acc = 0;
  let bits = 0;
  const emit = (code) => {
    acc |= (code & 0xFFF) << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(acc & 255);
      acc >>= 8;
      bits -= 8;
    }
  };
  const reset = () => {
    codeSize = minCodeSize + 1;
    nextCode = eoi + 1;
  };
  emit(clear);
  let havePrev = false;
  for (let i = 0; i < pixels.length; i++) {
    if (nextCode >= 4094) {
      emit(clear);
      reset();
      havePrev = false;
    }
    emit(pixels[i]);
    if (havePrev) {
      nextCode++;
      if (nextCode >= (1 << codeSize) && codeSize < 12) codeSize++;
    }
    havePrev = true;
  }
  emit(eoi);
  if (bits) out.push(acc & 255);
  return Buffer.from(out);
}

// 5x7 glyphs, bit 4 is the left pixel.
const GLYPHS = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 14, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 6, 6],
  ':': [0, 6, 6, 0, 6, 6, 0],
  '*': [0, 21, 14, 31, 14, 21, 0],
  '$': [4, 15, 20, 14, 5, 30, 4],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 6, 8, 16, 31],
  '3': [14, 17, 1, 6, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [14, 16, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 1, 14],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 19, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [1, 1, 1, 1, 17, 17, 14],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [14, 17, 16, 14, 1, 17, 14],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
};

function drawText(buf, size, text, x0, y0, color, scale) {
  const s = Math.max(1, scale | 0);
  let x = x0;
  for (const raw of String(text || '').toUpperCase()) {
    const g = GLYPHS[raw] || GLYPHS['*'];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (!((g[row] >> (4 - col)) & 1)) continue;
        for (let dy = 0; dy < s; dy++) {
          for (let dx = 0; dx < s; dx++) {
            const px = x + col * s + dx;
            const py = y0 + row * s + dy;
            if (px >= 0 && py >= 0 && px < size && py < size) buf[py * size + px] = color;
          }
        }
      }
    }
    x += 6 * s;
  }
}

function winnerMids(rows) {
  const total = rows.reduce((sum, e) => sum + e.tickets, 0) || 1;
  let angle = -Math.PI / 2;
  const map = {};
  rows.forEach((e) => {
    const sweep = (e.tickets / total) * Math.PI * 2;
    map[e.name] = angle + sweep / 2;
    angle += sweep;
  });
  return map;
}

function buildBins(rows) {
  const total = rows.reduce((sum, e) => sum + e.tickets, 0) || 1;
  const BINS = 2048;
  const bins = new Uint16Array(BINS);
  let acc = 0;
  rows.forEach((e, i) => {
    const next = acc + e.tickets / total;
    const a = Math.floor(acc * BINS);
    const b = Math.min(BINS, Math.floor(next * BINS));
    for (let k = a; k < b; k++) bins[k] = i;
    acc = next;
  });
  if (acc > 0) for (let k = Math.floor(acc * BINS); k < BINS; k++) bins[k] = rows.length - 1;
  return bins;
}

function paintFrame(size, rows, bins, rotation, highlightName, caption, sub) {
  const buf = Buffer.alloc(size * size, I_BG);
  const cx = (size - 1) / 2;
  const cy = size * 0.42;
  const radius = size * 0.32;
  const hub = Math.max(10, radius * 0.18);
  const r2 = radius * radius;
  const hub2 = hub * hub;
  const rim2 = (radius + 4) * (radius + 4);
  const twoPi = Math.PI * 2;
  const hit = highlightName ? rows.findIndex((e) => e.name === highlightName) : -1;
  const yMax = Math.min(size, Math.ceil(cy + radius + 8));
  const yMin = Math.max(0, Math.floor(cy - radius - 8));
  const xMin = Math.max(0, Math.floor(cx - radius - 8));
  const xMax = Math.min(size, Math.ceil(cx + radius + 8));
  for (let y = yMin; y < yMax; y++) {
    const dy = y - cy;
    for (let x = xMin; x < xMax; x++) {
      const dx = x - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 > rim2) continue;
      const i = y * size + x;
      if (d2 > r2) { buf[i] = I_GOLD; continue; }
      if (d2 <= hub2) { buf[i] = I_HUB; continue; }
      let a = Math.atan2(dy, dx) - rotation + Math.PI / 2;
      a = ((a % twoPi) + twoPi) % twoPi;
      const idx = bins[Math.min(bins.length - 1, Math.floor((a / twoPi) * bins.length))];
      buf[i] = idx === hit ? I_HIT : I_SLICE0 + (idx % SLICE.length);
    }
  }
  // Gold hub ring
  const ring = hub + 2;
  const ring2 = ring * ring;
  for (let y = Math.floor(cy - ring - 1); y <= cy + ring + 1; y++) {
    for (let x = Math.floor(cx - ring - 1); x <= cx + ring + 1; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= ring2 && d2 >= hub2) buf[y * size + x] = I_GOLD;
    }
  }
  // Pointer at 3 o'clock (matches on-site wheel)
  const px = Math.round(cx + radius + 2);
  const py = Math.round(cy);
  for (let t = 0; t < 14; t++) {
    const x = px + Math.floor(t * 0.7);
    for (let w = -Math.max(1, 6 - Math.floor(t / 2)); w <= Math.max(1, 6 - Math.floor(t / 2)); w++) {
      const y = py + w;
      if (x >= 0 && y >= 0 && x < size && y < size) buf[y * size + x] = I_GOLD;
    }
  }
  const capTop = Math.floor(size * 0.78);
  for (let y = capTop; y < size; y++) buf.fill(I_CAPTION, y * size, y * size + size);
  const scale = size >= 280 ? 2 : 1;
  drawText(buf, size, caption, 12, capTop + 8, I_CREAM, scale);
  if (sub) drawText(buf, size, sub, 12, capTop + 8 + 9 * scale, I_GOLD, scale);
  return buf;
}

function timings(fast) {
  if (fast) return { fps: 6, size: 120, intro: 0.3, spin: 0.7, pause: 0.2, outro: 0.4, turns: 1 };
  return { fps: 8, size: 180, intro: 0.8, spin: 3.8, pause: 0.65, outro: 2, turns: 4 };
}

function renderDrawGif(draw, opts = {}) {
  const fast = !!(opts.fast || process.env.WHEEL_VIDEO_FAST === '1');
  const t = timings(fast);
  const rows = (draw.board && draw.board.length ? draw.board : (draw.winners || []))
    .map((e) => ({ name: shownName(e.name || e.user), tickets: Number(e.tickets) || 0 }))
    .filter((e) => e.name && e.tickets > 0);
  const winners = (draw.winners || []).map((w) => ({
    name: shownName(w.name || w.user),
    tickets: Number(w.tickets) || 0,
    prize: w.prize,
  }));
  if (!rows.length || !winners.length) return null;
  const bins = buildBins(rows);
  const mids = winnerMids(rows);
  const frames = [];
  const delayCs = Math.max(2, Math.round(100 / t.fps));
  const label = periodLabel(draw.period);
  const pool = draw.prizePool != null ? usd(draw.prizePool) : '';
  let rotation = 0;
  const pushHold = (n, highlight, cap, sub) => {
    const frame = paintFrame(t.size, rows, bins, rotation, highlight, cap, sub);
    for (let i = 0; i < n; i++) frames.push(frame);
  };
  const introFrames = Math.max(1, Math.round(t.intro * t.fps));
  for (let i = 0; i < introFrames; i++) {
    rotation += 0.04;
    frames.push(paintFrame(t.size, rows, bins, rotation, null, 'NOROCHAN LIVE DRAW', label + '  ' + pool));
  }
  const spinFrames = Math.max(2, Math.round(t.spin * t.fps));
  const pauseFrames = Math.max(1, Math.round(t.pause * t.fps));
  for (let w = 0; w < winners.length; w++) {
    const mid = mids[winners[w].name];
    if (mid == null) continue;
    let delta = 0 - mid - (rotation % (Math.PI * 2));
    while (delta <= 0) delta += Math.PI * 2;
    const start = rotation;
    const target = rotation + delta + t.turns * Math.PI * 2;
    for (let i = 0; i < spinFrames; i++) {
      const p = easeOutCubic((i + 1) / spinFrames);
      rotation = start + (target - start) * p;
      frames.push(paintFrame(t.size, rows, bins, rotation, null, 'DRAWING WINNER ' + (w + 1) + ' OF ' + winners.length, 'TICKETS DECIDE THE ODDS'));
    }
    rotation = target;
    pushHold(pauseFrames, winners[w].name, 'WINNER ' + (w + 1) + '  ' + winners[w].name, (winners[w].prize != null ? usd(winners[w].prize) + '  ' : '') + winners[w].tickets + ' TICKETS');
  }
  const outro = winners.map((w, i) => (i + 1) + ' ' + w.name + (w.prize != null ? ' ' + usd(w.prize) : '')).join('   ');
  pushHold(Math.max(2, Math.round(t.outro * t.fps)), null, '3 WINNERS  POOL SPLIT', outro.slice(0, 42));
  const painted = frames[0] ? frames[0].reduce((n, v) => n + (v ? 1 : 0), 0) : 0;
  if (painted < 40) throw new Error('wheel video frame was empty');
  return packGif(frames, t.size, delayCs);
}

module.exports = { renderDrawGif, packGif, periodLabel };
