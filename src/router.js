'use strict';
// Public GET/HEAD. Staff writes are /api/admin/*. Visitor auth is /api/auth, /api/me, /auth/*.
const { HttpError, sendJson } = require('./lib/http');
const { handleApi } = require('./routes/api');
const { serveStatic } = require('./routes/static');

const WRITE_METHODS = ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'];

function isApiOrAuth(pathname) {
  return pathname.startsWith('/api/') || pathname.startsWith('/auth/');
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (isApiOrAuth(url.pathname)) {
      if (!WRITE_METHODS.includes(req.method)) {
        return sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: WRITE_METHODS.join(', ') });
      }
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
    return serveStatic(req, res, url);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message }, err.headers || {});
    console.error('Request error:', err.message);
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong. Try again.' });
    else res.end();
  }
}

module.exports = { handleRequest };
