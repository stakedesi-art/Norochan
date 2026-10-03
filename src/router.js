'use strict';
// Top-level request dispatcher: the site is read-only, so only GET/HEAD are accepted.
const { HttpError, sendJson } = require('./lib/http');
const { handleApi } = require('./routes/api');
const { serveStatic } = require('./routes/static');

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message }, err.headers || {});
    console.error('Request error:', err.message);
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong. Try again.' });
    else res.end();
  }
}

module.exports = { handleRequest };
