'use strict';
// Norochan site: zero-dependency Node 18+ server. Startup only; see src/router.js for requests.
const http = require('http');
const { PORT, HOST, STAKE_BASE, REFRESH_MS, REWARDS_FILE, KICK_REDIRECT_URI } = require('./config');
const staff = require('./lib/staff');
const storage = require('./storage');
const { refreshAll, state } = require('./services/stake');
const { botrix } = require('./services/viewers');
const { ensureStore } = require('./services/content');
const wheel = require('./services/wheel');
const accounts = require('./services/accounts');
const referred = require('./services/referred');
const { handleRequest } = require('./router');

const server = http.createServer(handleRequest);

function main() {
  storage.load();
  if (['users', 'sessions', 'auditLog'].some((k) => k in storage.db)) {
    console.warn(`[storage] ${storage.location} still holds old visitor-account data. Stop the site and run: npm run migrate`);
  }
  botrix.ensureStore(storage.db);
  ensureStore();
  wheel.ensureStore();
  accounts.ensure();
  server.listen(PORT, HOST, () => {
    console.log(`Norochan site running at http://localhost:${PORT}`);
    console.log(`Stake API: ${STAKE_BASE} | token set: ${process.env.STAKE_TOKEN ? 'yes' : 'NO (set STAKE_TOKEN, see README)'}`);
    if (botrix.configError && !botrix.configured) console.error(`[botrix] ${botrix.configError} Top viewers board disabled.`);
    else console.log(`BotRix leaderboard: ${botrix.configured ? `on, sync every ${Math.round(botrix.syncMs / 60000)} min` : 'off (set BOTRIX_LEADERBOARD_URL or BOTRIX_PUBLIC=1, see README)'}`);
    console.log(`Rewards file: ${REWARDS_FILE}`);
    console.log(`Staff studio: ${staff.configured() ? 'on (/studio.html)' : 'off (set ADMIN_PASSWORD, 8+ characters)'}`);
    console.log(`Wheel Discord post: ${process.env.DISCORD_WHEEL_WEBHOOK ? 'on' : 'off (set DISCORD_WHEEL_WEBHOOK)'}`);
    console.log(`Visitor login: email+password (Gmail confirm). Google: ${process.env.GOOGLE_CLIENT_ID ? 'on' : 'off'} · Kick OAuth: ${process.env.KICK_CLIENT_ID ? 'on · callback ' + KICK_REDIRECT_URI : 'off'}`);
  });
  botrix.start({ getStore: () => botrix.ensureStore(storage.db), persist: storage.save });
  const refreshThenWheel = () => refreshAll().then(() => referred.refreshReferred()).then(() => {
    try {
      wheel.maybeFinalize();
      wheel.announcePending();
    }
    catch (err) { console.error(`[wheel] ${err.message}`); }
  });
  refreshThenWheel();
  setInterval(refreshThenWheel, REFRESH_MS);
  // If the very first fetch failed, retry sooner than the hourly cycle.
  setInterval(() => { if (!state.leaderboard.updatedAt) refreshThenWheel(); }, Math.min(REFRESH_MS, 2 * 60 * 1000));
}
main();
