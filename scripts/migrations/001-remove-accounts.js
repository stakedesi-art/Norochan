'use strict';
// Migration 001: remove the retired visitor-account system from the data file.
// Deletes `users` (emails, password hashes, linked Stake/Kick names, last-login IPs), `sessions` and
// `auditLog`. Keeps everything else, notably `viewerLeaderboard` (BotRix current month + snapshots).
//
// Stop the site first (it holds the data in memory and would write the old keys back), then:
//   node scripts/migrations/001-remove-accounts.js --dry-run   # show what would change
//   node scripts/migrations/001-remove-accounts.js             # apply, after writing a backup
// Uses DATA_FILE like the server (default src/data.json). Safe to run more than once.
const fs = require('fs');
const path = require('path');

const ID = '001-remove-accounts';
const RETIRED_KEYS = ['users', 'sessions', 'auditLog'];
// Phase 3 stores visitor rows in `accounts` / `visitorSessions` / `magicLinks`. Never add those here.
const dataFile = process.env.DATA_FILE || path.join(__dirname, '..', '..', 'src', 'data.json');
const dryRun = process.argv.includes('--dry-run');

function describe(value) {
  if (Array.isArray(value)) return `${value.length} entries`;
  if (value && typeof value === 'object') return `${Object.keys(value).length} entries`;
  return typeof value;
}

function main() {
  let db;
  try { db = JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') { console.log(`${ID}: ${dataFile} does not exist, nothing to migrate.`); return; }
    console.error(`${ID}: cannot read ${dataFile}: ${err.message}`);
    process.exit(1);
  }

  const present = RETIRED_KEYS.filter((k) => k in db);
  const applied = Array.isArray(db.migrations) && db.migrations.includes(ID);
  if (!present.length) {
    console.log(`${ID}: no account data in ${dataFile}.${applied ? ' Already applied.' : ''}`);
    if (!applied && !dryRun) write(db);
    return;
  }

  for (const k of present) console.log(`${ID}: ${dryRun ? 'would remove' : 'removing'} "${k}" (${describe(db[k])})`);
  const kept = Object.keys(db).filter((k) => !RETIRED_KEYS.includes(k) && k !== 'migrations');
  console.log(`${ID}: keeping ${kept.length ? kept.map((k) => `"${k}"`).join(', ') : 'nothing else'}`);
  if (dryRun) return;

  const backup = `${dataFile}.pre-${ID}-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  fs.copyFileSync(dataFile, backup);
  fs.chmodSync(backup, 0o600);
  console.log(`${ID}: backup written to ${backup}`);
  console.log(`${ID}: the backup still contains emails, password hashes and IPs; delete it once the site works.`);

  for (const k of present) delete db[k];
  write(db);
  console.log(`${ID}: done.`);
}

function write(db) {
  db.migrations = [...new Set([...(Array.isArray(db.migrations) ? db.migrations : []), ID])];
  const tmp = dataFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, dataFile);
}

main();
