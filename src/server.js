'use strict';
// Norochan site: zero-dependency Node 18+ server. Startup only; see src/router.js for requests.
const http = require('http');
const { PORT, HOST, STAKE_BASE, REFRESH_MS, REWARDS_FILE } = require('./config');
const storage = require('./storage');
const { refreshAll, state } = require('./services/stake');
const { botrix } = require('./services/viewers');
const { handleRequest } = require('./router');

const server = http.createServer(handleRequest);

function main() {
  storage.load();
  if (['users', 'sessions', 'auditLog'].some((k) => k in storage.db)) {
    console.warn(`[storage] ${storage.location} still holds old visitor-account data. Stop the site and run: npm run migrate`);
  }
  botrix.ensureStore(storage.db);
  server.listen(PORT, HOST, () => {
    console.log(`Norochan site running at http://localhost:${PORT}`);
    console.log(`Stake API: ${STAKE_BASE} | token set: ${process.env.STAKE_TOKEN ? 'yes' : 'NO (set STAKE_TOKEN, see README)'}`);
    if (botrix.configError) console.error(`[botrix] ${botrix.configError} Top viewers board disabled.`);
    else console.log(`BotRix leaderboard: ${botrix.configured ? `on, sync every ${Math.round(botrix.syncMs / 60000)} min` : 'off (set BOTRIX_LEADERBOARD_URL, see README)'}`);
    console.log(`Rewards file: ${REWARDS_FILE}`);
  });
  botrix.start({ getStore: () => botrix.ensureStore(storage.db), persist: storage.save });
  refreshAll();
  setInterval(refreshAll, REFRESH_MS);
  // If the very first fetch failed, retry sooner than the hourly cycle.
  setInterval(() => { if (!state.leaderboard.updatedAt) refreshAll(); }, Math.min(REFRESH_MS, 2 * 60 * 1000));
}
main();
