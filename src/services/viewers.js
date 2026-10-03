'use strict';
// The BotRix "Top viewers" board instance shared by the API routes and the startup code.
const { CONFIG, KICK_CHANNEL } = require('../config');
const { BotrixLeaderboardService } = require('./botrix');

const VIEWER_TRACKING_UNSUPPORTED =
  'The official KICK API has no per-viewer watch-time data, and the BotRix leaderboard is not connected yet. ' +
  'Set BOTRIX_LEADERBOARD_URL to the endpoint issued by BotRix support to enable the Top viewers board.';
const botrix = new BotrixLeaderboardService({ channel: KICK_CHANNEL });
const viewerRewardFor = (rank) => (CONFIG.viewerRewards && CONFIG.viewerRewards[rank] != null ? CONFIG.viewerRewards[rank] : null);

module.exports = { botrix, VIEWER_TRACKING_UNSUPPORTED, viewerRewardFor };
