'use strict';
// Stake username is typed by the player. Owner codes go to staff. Any other code is "not under code".
const { HttpError } = require('../lib/http');
const { OWNER_CODES } = require('../config');
const { normalizeCampaignCode } = require('../lib/csv');
const accounts = require('./accounts');
const { codesForUsername, isOwnerCode } = require('./referred');

function ownerList() {
  return (OWNER_CODES || []).map((c) => normalizeCampaignCode(c)).filter(Boolean);
}

function isOwnerPick(code) {
  return isOwnerCode(code);
}

function claimStake(account, stakeUser, code) {
  if (account.stakeUser) throw new HttpError(409, 'This Stake username is locked. Ask support if it must be unbound.');
  const name = String(stakeUser || '').trim();
  if (!/^[\w.-]{3,24}$/.test(name)) throw new HttpError(400, 'Enter a valid Stake username.');
  const taken = accounts.byStakeUser(name);
  if (taken && taken.id !== account.id) throw new HttpError(409, 'That Stake username is already on another account.');
  const raw = String(code || '').trim();
  const other = !raw || /^other$/i.test(raw) || !isOwnerPick(raw);
  account.stakeUser = name;
  account.stakeVerifiedAt = new Date().toISOString();
  account.stakeBetId = null;
  if (other) {
    account.claimedCode = raw && !/^other$/i.test(raw) ? normalizeCampaignCode(raw) : 'other';
    account.codeStatus = 'not_under_code';
    account.codeMatched = [];
  } else {
    account.claimedCode = normalizeCampaignCode(raw);
    account.codeStatus = 'pending';
    account.codeMatched = [];
  }
  accounts.saveRow();
  return accounts.publicAccount(account);
}

function resolveCode(id, verdict) {
  const row = accounts.byId(id);
  if (!row) throw new HttpError(404, 'Account not found.');
  if (!row.stakeUser) throw new HttpError(400, 'This account has no Stake username.');
  if (row.codeStatus !== 'pending') throw new HttpError(409, 'This code is not waiting on staff.');
  const ok = String(verdict || '').toLowerCase();
  if (ok === 'verified' || ok === 'approve' || ok === 'yes') {
    row.codeStatus = 'verified';
    row.codeMatched = row.claimedCode ? [row.claimedCode] : [];
  } else if (ok === 'not_under_code' || ok === 'reject' || ok === 'no') {
    row.codeStatus = 'not_under_code';
    row.codeMatched = [];
  } else {
    throw new HttpError(400, 'Choose verified or not_under_code.');
  }
  accounts.saveRow();
  return accounts.publicAccount(row);
}

function staffHint(username) {
  return codesForUsername(username);
}

module.exports = { claimStake, resolveCode, ownerList, isOwnerPick, staffHint };
