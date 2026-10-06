'use strict';
// The BotRix "Top viewers" board instance shared by the API routes and the startup code.
const { KICK_CHANNEL } = require('../config');
const { BotrixLeaderboardService } = require('./botrix');
const { viewerRewardFor } = require('./rewards');

const VIEWER_TRACKING_UNSUPPORTED =
  'The official KICK API has no per-viewer watch-time data, and the BotRix leaderboard is turned off. ' +
  'Set BOTRIX_PUBLIC=1 to use the official BotRix public API, or BOTRIX_LEADERBOARD_URL for an issued endpoint.';
const botrix = new BotrixLeaderboardService({ channel: KICK_CHANNEL });

module.exports = { botrix, VIEWER_TRACKING_UNSUPPORTED, viewerRewardFor };
