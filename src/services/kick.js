'use strict';
// Kick public channel API: live status, title, viewer count and thumbnail. No credentials needed.
const { KICK_CHANNEL, KICK_PUBLIC_TIMEOUT_MS } = require('../config');

async function fetchKickChannelStatus(channelName = KICK_CHANNEL) {
  const normalized = String(channelName || '').trim();
  if (!normalized) {
    return { status: 'unavailable', channel: '', title: null, viewers: null, thumbnail: null, url: 'https://kick.com', message: 'Kick channel is not configured.' };
  }

  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(normalized)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'NorochanSite/1.0' },
      signal: AbortSignal.timeout(KICK_PUBLIC_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Kick API returned ${res.status}`);
    }

    const payload = await res.json().catch(() => ({}));
    const stream = payload && typeof payload === 'object' && payload.livestream ? payload.livestream : null;
    const isLive = !!(stream && (stream.is_live === true || stream.isLive === true));
    const username = String(payload?.user?.username || payload?.slug || normalized).trim();
    const title = stream && (stream.session_title || stream.title || stream.name || null);
    const viewerCount = stream && Number.isFinite(Number(stream.viewer_count))
      ? Number(stream.viewer_count)
      : (stream && Number.isFinite(Number(stream.viewers)) ? Number(stream.viewers) : null);
    const thumbnail = stream && (stream.thumbnail || stream.thumbnail_url || stream.image || stream.image_url || null)
      || (payload && payload.banner_image && payload.banner_image.url)
      || null;

    return {
      status: isLive ? 'live' : 'offline',
      channel: username,
      title: title || (isLive ? 'Live now' : 'Offline right now'),
      viewers: viewerCount,
      thumbnail: thumbnail || null,
      url: `https://kick.com/${username}`,
      message: isLive ? null : 'Offline right now',
      updatedAt: Date.now(),
    };
  } catch (error) {
    return {
      status: 'unavailable',
      channel: normalized,
      title: null,
      viewers: null,
      thumbnail: null,
      url: `https://kick.com/${normalized}`,
      message: 'Status unavailable',
      updatedAt: Date.now(),
      error: error.message,
    };
  }
}

module.exports = { fetchKickChannelStatus };
