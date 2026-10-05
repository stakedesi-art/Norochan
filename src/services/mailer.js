'use strict';
// Gmail SMTP (app password). Zero npm. AUTH_TEST skips the network send.
const tls = require('tls');
const { AUTH_TEST, BASE_URL } = require('../config');

const GMAIL_USER = String(process.env.GMAIL_USER || process.env.SMTP_USER || '').trim();
const GMAIL_PASS = String(process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '').trim();
const SMTP_HOST = String(process.env.SMTP_HOST || 'smtp.gmail.com').trim() || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;

function mailOn() { return !!(GMAIL_USER && GMAIL_PASS); }

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

function smtpSend({ to, subject, text }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST }, () => { /* wait for banner */ });
    let buf = '';
    const lines = [
      'EHLO norochan.com',
      'AUTH LOGIN',
      b64(GMAIL_USER),
      b64(GMAIL_PASS),
      'MAIL FROM:<' + GMAIL_USER + '>',
      'RCPT TO:<' + to + '>',
      'DATA',
    ];
    let i = 0;
    const body = [
      'From: Norochan <' + GMAIL_USER + '>',
      'To: <' + to + '>',
      'Subject: ' + subject,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
      '.',
    ].join('\r\n');
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('Mail send timed out.')); }, 20000);
    function fail(err) { clearTimeout(timer); sock.destroy(); reject(err); }
    sock.setEncoding('utf8');
    sock.on('error', fail);
    sock.on('data', (chunk) => {
      buf += chunk;
      while (buf.includes('\n')) {
        const nl = buf.indexOf('\n');
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        const code = Number(line.slice(0, 3));
        if (line[3] === '-') continue;
        if (i === 0) {
          if (code !== 220) return fail(new Error('Mail server refused the connection.'));
          sock.write(lines[i++] + '\r\n');
          continue;
        }
        if (i < lines.length) {
          if (code >= 400) return fail(new Error('Mail server: ' + line));
          sock.write(lines[i++] + '\r\n');
          continue;
        }
        if (i === lines.length) {
          if (code !== 354 && code >= 400) return fail(new Error('Mail server: ' + line));
          sock.write(body + '\r\n');
          i += 1;
          continue;
        }
        sock.write('QUIT\r\n');
        clearTimeout(timer);
        sock.end();
        if (code >= 400) return fail(new Error('Mail server: ' + line));
        return resolve();
      }
    });
  });
}

async function sendVerifyEmail(to, verifyPath) {
  const link = BASE_URL + verifyPath;
  const text = 'Confirm your Norochan account by opening this link:\n\n' + link + '\n\nIt expires in 15 minutes. If you did not sign up, ignore this email.';
  console.log('[mail] Verify link for ' + to + (AUTH_TEST || !mailOn() ? ' ' + verifyPath : ''));
  if (AUTH_TEST) return;
  if (!mailOn()) return;
  await smtpSend({ to, subject: 'Confirm your Norochan account', text });
}

module.exports = { mailOn, sendVerifyEmail };
