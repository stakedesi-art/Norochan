'use strict';
// Site settings. CONFIG is edited by hand; secrets come from environment variables
// or a gitignored .env file. Never commit STAKE_TOKEN, Kick, or Gmail secrets.
const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const file = path.join(__dirname, '..', '.env');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadDotEnv();

// ============================================================
// CONFIG: edit everything you want to change right here.
// ============================================================
const CONFIG = {
  name: 'Norochan',
  code: 'Norochan',
  referralUrl: 'https://stake.jp/?c=Norochan&offer=norochan',
  // Replace each value with your full link (must start with https://).
  links: {
    discord: 'https://discord.gg/32Ww7KZQXq',
    telegram: 'https://t.me/norochanstakecommunity',
    x: 'https://x.com/Norochanplay',
    youtube: 'https://youtube.com/@norochanplays?si=RbAgoKeuxu-jfyE2',
    kick: 'https://kick.com/norochan',
    instagram: 'https://www.instagram.com/norochanplay',
  },
  race: {
    title: 'October Wager Race',
    startsAt: Date.UTC(2026, 9, 1, 0, 0, 0, 0), // Oct 1 2026 00:00:00 UTC
    endsAt: Date.UTC(2026, 9, 31, 23, 59, 59, 999), // Oct 31 2026 23:59:59 UTC
    top: 10,
  },
  // Prizes in USD. Add single ranks here:
  prizes: {
    1: 200,
    2: 100,
    3: 60,
    4: 40,
    5: 30,
    6: 20,
    7: 15,
    8: 15,
    9: 10,
    10: 10,
  },
  // ...or ranges, for example { from: 11, to: 20, amount: 100 }
  prizeRanges: [],
  // Optional USD rewards for the BotRix "Top viewers" board, e.g. { 1: 50, 2: 25, 3: 10 }. Empty = no reward column.
  viewerRewards: {},
};

// ============================================================
// Settings from environment variables
// ============================================================
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // use 0.0.0.0 when hosting online
// Send Strict-Transport-Security once the site is served over HTTPS. COOKIE_SECURE is the old name.
const HSTS = process.env.HSTS === '1' || process.env.COOKIE_SECURE === '1';
const RAW_STAKE_BASE = process.env.STAKE_API_BASE || 'https://api.stake.com/affiliate';
const STAKE_BASE = RAW_STAKE_BASE.replace(/\/api\/?$/i, '').replace(/\/+$/, '');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
// Public prize pool / bonus figures, edited by hand on the server (see src/data/rewards.example.json).
const REWARDS_FILE = process.env.REWARDS_FILE || path.join(__dirname, 'data', 'rewards.json');
const REFRESH_MS = Math.max(1000, Number(process.env.REFRESH_MS) || 60 * 60 * 1000);
const STAKE_EXCLUSIVE = ['1', 'true', 'yes'].includes(String(process.env.STAKE_EXCLUSIVE || '').toLowerCase());
const ALL_CAMPAIGNS = ['1', 'true', 'yes'].includes(String(process.env.ALL_CAMPAIGNS || '').toLowerCase());
const RACE_CAMPAIGN_CODE = String(process.env.RACE_CAMPAIGN_CODE || 'Norochan').trim() || 'Norochan';
const WHEEL_EXCLUDE = String(process.env.WHEEL_EXCLUDE || 'YASH001KG')
  .split(/[,;]+/)
  .map((s) => s.trim())
  .filter(Boolean);
const DISCORD_WHEEL_WEBHOOK = String(process.env.DISCORD_WHEEL_WEBHOOK || '').trim();
const PUBLIC_SITE_URL = String(process.env.PUBLIC_SITE_URL || 'https://norochan.com').trim().replace(/\/+$/, '') || 'https://norochan.com';
const BASE_URL = String(process.env.BASE_URL || PUBLIC_SITE_URL).trim().replace(/\/+$/, '') || PUBLIC_SITE_URL;
const AUTH_TEST = ['1', 'true', 'yes'].includes(String(process.env.AUTH_TEST || '').toLowerCase());
const OWNER_CODES = String(process.env.OWNER_CODES || 'norochan,divu,ipl2026,deepu')
  .split(/[,;]+/)
  .map((s) => s.trim())
  .filter(Boolean);
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
const KICK_CLIENT_ID = String(process.env.KICK_CLIENT_ID || '').trim();
const KICK_CLIENT_SECRET = String(process.env.KICK_CLIENT_SECRET || '').trim();
const KICK_REDIRECT_URI = String(process.env.KICK_REDIRECT_URI || (BASE_URL + '/auth/kick/callback')).trim();
const GOOGLE_REDIRECT_URI = String(process.env.GOOGLE_REDIRECT_URI || (BASE_URL + '/auth/google/callback')).trim();
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const LEADERBOARD_CSV = path.join(DATA_DIR, 'leaderboard.csv');
const KICK_CHANNEL = String(process.env.KICK_CHANNEL_USERNAME || process.env.KICK_CHANNEL || 'norochan').trim() || 'norochan';
const KICK_PUBLIC_TIMEOUT_MS = 12000;

module.exports = {
  CONFIG,
  PORT,
  HOST,
  HSTS,
  STAKE_BASE,
  DATA_FILE,
  REWARDS_FILE,
  REFRESH_MS,
  STAKE_EXCLUSIVE,
  ALL_CAMPAIGNS,
  RACE_CAMPAIGN_CODE,
  WHEEL_EXCLUDE,
  DISCORD_WHEEL_WEBHOOK,
  PUBLIC_SITE_URL,
  BASE_URL,
  AUTH_TEST,
  OWNER_CODES,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  KICK_CLIENT_ID,
  KICK_CLIENT_SECRET,
  KICK_REDIRECT_URI,
  PUBLIC_DIR,
  DATA_DIR,
  LEADERBOARD_CSV,
  KICK_CHANNEL,
  KICK_PUBLIC_TIMEOUT_MS,
};
