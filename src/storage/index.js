'use strict';
// Storage entry point. Every module reads and writes data through this object:
//   db     the in-memory dataset; today only { viewerLeaderboard } (BotRix snapshots)
//   load() read it at startup
//   save() persist it after a change (synchronous)
// A future Postgres driver must expose the same interface; see docs/AWS_DEPLOYMENT.md.
const { DATA_FILE } = require('../config');
const { createFileStore } = require('./file-store');

module.exports = createFileStore(DATA_FILE);
