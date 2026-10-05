'use strict';
// Visitor accounts (Phase 3). Email+password, Google, Kick. Stored as `accounts` so migrate 001 cannot wipe them.
const crypto = require('crypto');
const storage = require('../storage');
const visitor = require('../lib/visitor');
const { HttpError } = require('../lib/http');

function ensure() {
  if (!Array.isArray(storage.db.accounts)) storage.db.accounts = [];
  if (!storage.db.visitorSessions || typeof storage.db.visitorSessions !== 'object') storage.db.visitorSessions = {};
  if (!storage.db.magicLinks || typeof storage.db.magicLinks !== 'object') storage.db.magicLinks = {};
  return storage.db;
}

function publicAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email || null,
    emailVerified: !!row.emailVerified,
    stakeUser: row.stakeUser || null,
    stakeVerifiedAt: row.stakeVerifiedAt || null,
    claimedCode: row.claimedCode || null,
    codeStatus: row.codeStatus || (row.stakeUser ? 'unknown' : 'none'),
    codeMatched: Array.isArray(row.codeMatched) ? row.codeMatched : [],
    kickName: row.kickName || null,
    providers: {
      email: !!row.email,
      google: !!row.googleId,
      kick: !!row.kickId,
    },
  };
}

function byId(id) {
  ensure();
  return storage.db.accounts.find((a) => a.id === id) || null;
}

function byEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return null;
  ensure();
  return storage.db.accounts.find((a) => String(a.email || '').toLowerCase() === key) || null;
}

function byStakeUser(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  ensure();
  return storage.db.accounts.find((a) => String(a.stakeUser || '').toLowerCase() === key) || null;
}

function byGoogle(id) {
  ensure();
  return storage.db.accounts.find((a) => a.googleId && a.googleId === id) || null;
}

function byKick(id) {
  ensure();
  return storage.db.accounts.find((a) => a.kickId && a.kickId === id) || null;
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, 32, { N: 16384, r: 8, p: 1 });
  return 'scrypt$16384$8$1$' + salt.toString('base64') + '$' + hash.toString('base64');
}

function passwordMatches(plain, stored) {
  if (!plain || !stored) return false;
  const parts = String(stored).split('$');
  if (parts[0] !== 'scrypt' || parts.length < 6) return false;
  let salt, want;
  try {
    salt = Buffer.from(parts[4], 'base64');
    want = Buffer.from(parts[5], 'base64');
  } catch { return false; }
  if (!salt.length || !want.length) return false;
  const got = crypto.scryptSync(String(plain), salt, want.length, { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) });
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(got, want);
}

function passwordOk(value) {
  return String(value || '').length >= 8;
}

function create(fields) {
  ensure();
  const row = {
    id: crypto.randomBytes(12).toString('hex'),
    email: fields.email ? String(fields.email).trim().toLowerCase() : null,
    passwordHash: fields.password ? hashPassword(fields.password) : null,
    emailVerified: !!fields.emailVerified,
    googleId: fields.googleId || null,
    kickId: fields.kickId || null,
    kickName: fields.kickName || null,
    stakeUser: null,
    stakeVerifiedAt: null,
    stakeBetId: null,
    claimedCode: null,
    codeStatus: 'none',
    codeMatched: [],
    createdAt: new Date().toISOString(),
  };
  storage.db.accounts.push(row);
  storage.save();
  return row;
}

function saveRow() {
  storage.save();
}

function startSession(req, account) {
  ensure();
  const token = crypto.randomBytes(32).toString('base64url');
  storage.db.visitorSessions[visitor.sha256(token)] = {
    accountId: account.id,
    expires: Date.now() + visitor.SESSION_MS,
  };
  storage.save();
  return visitor.mintCookie(req, token);
}

function accountFromReq(req) {
  ensure();
  const token = visitor.tokenFrom(req);
  if (!token) return null;
  const row = storage.db.visitorSessions[visitor.sha256(token)];
  if (!row || row.expires <= Date.now()) return null;
  return byId(row.accountId);
}

function requireAccount(req) {
  const row = accountFromReq(req);
  if (!row) throw new HttpError(401, 'Sign in to continue.');
  return row;
}

function endSession(req) {
  ensure();
  const token = visitor.tokenFrom(req);
  if (token) {
    delete storage.db.visitorSessions[visitor.sha256(token)];
    storage.save();
  }
  return visitor.clearCookie(req);
}

function emailOk(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function createVerifyLink(email) {
  ensure();
  const token = crypto.randomBytes(32).toString('base64url');
  storage.db.magicLinks[visitor.sha256(token)] = {
    email: String(email).trim().toLowerCase(),
    purpose: 'verify',
    expires: Date.now() + 15 * 60 * 1000,
  };
  storage.save();
  return token;
}

function consumeVerifyLink(token) {
  ensure();
  const key = visitor.sha256(token);
  const row = storage.db.magicLinks[key];
  if (!row || row.expires <= Date.now()) {
    if (row) delete storage.db.magicLinks[key];
    storage.save();
    throw new HttpError(400, 'That confirmation link is invalid or has expired.');
  }
  delete storage.db.magicLinks[key];
  storage.save();
  return row.email;
}

function signup(email, password) {
  if (!emailOk(email)) throw new HttpError(400, 'Enter a valid email.');
  if (!passwordOk(password)) throw new HttpError(400, 'Password must be at least 8 characters.');
  const key = String(email).trim().toLowerCase();
  let row = byEmail(key);
  if (row && row.emailVerified) throw new HttpError(409, 'That email already has an account. Sign in.');
  if (row) {
    row.passwordHash = hashPassword(password);
    storage.save();
  } else {
    row = create({ email: key, password, emailVerified: false });
  }
  const token = createVerifyLink(key);
  return { row, token, verifyPath: '/auth/email?token=' + encodeURIComponent(token) };
}

function login(email, password) {
  const row = byEmail(email);
  if (!row || !row.passwordHash || !passwordMatches(password, row.passwordHash)) {
    throw new HttpError(401, 'Wrong email or password.');
  }
  if (!row.emailVerified) throw new HttpError(403, 'Confirm your email first. Open the link we sent.');
  return row;
}

function markVerified(email) {
  const row = byEmail(email);
  if (!row) throw new HttpError(400, 'That confirmation link is invalid or has expired.');
  row.emailVerified = true;
  storage.save();
  return row;
}

function listForStaff() {
  ensure();
  const { staffHint } = require('./verify');
  return storage.db.accounts.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map((a) => ({
    id: a.id,
    email: a.email,
    emailVerified: !!a.emailVerified,
    stakeUser: a.stakeUser,
    stakeVerifiedAt: a.stakeVerifiedAt,
    claimedCode: a.claimedCode,
    codeStatus: a.codeStatus,
    codeMatched: a.codeMatched,
    kickName: a.kickName || null,
    referredHint: a.stakeUser ? staffHint(a.stakeUser) : [],
    createdAt: a.createdAt,
  }));
}

function linkKick(account, { kickId, kickName } = {}) {
  if (!account) throw new HttpError(401, 'Sign in to continue.');
  const id = String(kickId || '').trim();
  if (!id) throw new HttpError(400, 'Kick did not return a user.');
  const existing = byKick(id);
  if (existing && existing.id !== account.id) {
    throw new HttpError(409, 'That Kick account is already connected to another Norochan account.');
  }
  account.kickId = id;
  const name = String(kickName || '').trim();
  if (name) account.kickName = name;
  storage.save();
  return account;
}

function unbindStake(id) {
  const row = byId(id);
  if (!row) throw new HttpError(404, 'Account not found.');
  row.stakeUser = null;
  row.stakeVerifiedAt = null;
  row.stakeBetId = null;
  row.claimedCode = null;
  row.codeStatus = 'none';
  row.codeMatched = [];
  storage.save();
  return row;
}

module.exports = {
  ensure, publicAccount, byId, byEmail, byStakeUser, byGoogle, byKick, create, saveRow,
  startSession, accountFromReq, requireAccount, endSession, emailOk, passwordOk,
  hashPassword, signup, login, markVerified, createVerifyLink, consumeVerifyLink,
  listForStaff, unbindStake, linkKick,
};
