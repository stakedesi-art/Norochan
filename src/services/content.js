'use strict';
// Announcements and categorized code-benefit posts (SRS Phase 1).
const crypto = require('crypto');
const storage = require('../storage');

const CATEGORIES = [
  { id: 'race', label: 'Wager race', hint: 'Monthly race prizes for code users.' },
  { id: 'reload', label: 'Reloads', hint: 'Reload or lossback-style bonuses.' },
  { id: 'level_up', label: 'Level-up', hint: 'Paid when you hit a Stake level.' },
  { id: 'social', label: 'Social giveaways', hint: 'Drops on Kick, Discord, X and more.' },
  { id: 'wheel', label: 'Monthly wheel', hint: 'Ticket draw from raw wager.' },
  { id: 'code_benefit', label: 'Code benefit', hint: 'General extras included when you use the code.' },
  { id: 'other', label: 'Other', hint: 'Anything else the code includes.' },
];
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

function ensureStore() {
  if (!Array.isArray(storage.db.announcements)) storage.db.announcements = [];
  if (!Array.isArray(storage.db.benefits)) storage.db.benefits = [];
  return storage.db;
}

const money = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const cleanText = (v, max) => String(v || '').trim().slice(0, max);
const httpsUrl = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  if (!/^https:\/\//i.test(s)) return undefined;
  return s.slice(0, 300);
};

function publicAnnouncement(row) {
  return { id: row.id, title: row.title, body: row.body, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function publicBenefit(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    amount: row.amount,
    ctaLabel: row.ctaLabel || null,
    ctaUrl: row.ctaUrl || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function publicFeed() {
  ensureStore();
  const announcements = storage.db.announcements.filter((r) => r.published).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(publicAnnouncement);
  const categories = CATEGORIES.map((cat) => ({
    ...cat,
    posts: storage.db.benefits.filter((r) => r.published && r.category === cat.id).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(publicBenefit),
  })).filter((cat) => cat.posts.length);
  return { announcements, categories };
}

function list(kind) {
  ensureStore();
  const rows = kind === 'announcement' ? storage.db.announcements : storage.db.benefits;
  return rows.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function createAnnouncement(body) {
  ensureStore();
  const title = cleanText(body.title, 120);
  const text = cleanText(body.body, 2000);
  if (!title) throw Object.assign(new Error('Add a title.'), { status: 400 });
  const row = {
    id: crypto.randomUUID(),
    title,
    body: text,
    published: body.published !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  storage.db.announcements.unshift(row);
  storage.save();
  return row;
}

function createBenefit(body) {
  ensureStore();
  const title = cleanText(body.title, 120);
  const text = cleanText(body.body, 2000);
  const category = String(body.category || '').trim();
  if (!title) throw Object.assign(new Error('Add a title.'), { status: 400 });
  if (!CATEGORY_IDS.has(category)) throw Object.assign(new Error('Pick a reward category.'), { status: 400 });
  const ctaUrl = httpsUrl(body.ctaUrl);
  if (ctaUrl === undefined) throw Object.assign(new Error('Link must start with https://'), { status: 400 });
  const row = {
    id: crypto.randomUUID(),
    category,
    title,
    body: text,
    amount: money(body.amount),
    ctaLabel: cleanText(body.ctaLabel, 40) || null,
    ctaUrl,
    published: body.published !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  storage.db.benefits.unshift(row);
  storage.save();
  return row;
}

function updateRow(kind, id, body) {
  ensureStore();
  const rows = kind === 'announcement' ? storage.db.announcements : storage.db.benefits;
  const row = rows.find((r) => r.id === id);
  if (!row) throw Object.assign(new Error('Not found.'), { status: 404 });
  if (body.title != null) {
    const title = cleanText(body.title, 120);
    if (!title) throw Object.assign(new Error('Add a title.'), { status: 400 });
    row.title = title;
  }
  if (body.body != null) row.body = cleanText(body.body, 2000);
  if (body.published != null) row.published = !!body.published;
  if (kind === 'benefit') {
    if (body.category != null) {
      const category = String(body.category || '').trim();
      if (!CATEGORY_IDS.has(category)) throw Object.assign(new Error('Pick a reward category.'), { status: 400 });
      row.category = category;
    }
    if (body.amount !== undefined) row.amount = money(body.amount);
    if (body.ctaLabel !== undefined) row.ctaLabel = cleanText(body.ctaLabel, 40) || null;
    if (body.ctaUrl !== undefined) {
      const ctaUrl = httpsUrl(body.ctaUrl);
      if (ctaUrl === undefined) throw Object.assign(new Error('Link must start with https://'), { status: 400 });
      row.ctaUrl = ctaUrl;
    }
  }
  row.updatedAt = new Date().toISOString();
  storage.save();
  return row;
}

function removeRow(kind, id) {
  ensureStore();
  const key = kind === 'announcement' ? 'announcements' : 'benefits';
  const before = storage.db[key].length;
  storage.db[key] = storage.db[key].filter((r) => r.id !== id);
  if (storage.db[key].length === before) throw Object.assign(new Error('Not found.'), { status: 404 });
  storage.save();
}

module.exports = {
  CATEGORIES, ensureStore, publicFeed, list, createAnnouncement, createBenefit, updateRow, removeRow,
};
