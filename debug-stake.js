'use strict';

const base = process.env.STAKE_API_BASE || 'https://api.stake.com/affiliate';
const token = process.env.STAKE_TOKEN;
if (!token) throw new Error('STAKE_TOKEN is not set');
const headers = { 'x-access-token': token, Accept: 'text/csv', 'User-Agent': 'NorochanDebug/1.0' };

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((v) => v !== '')) rows.push(row);
  }
  return rows;
}

async function runCase(label, url) {
  const res = await fetch(url, { headers, redirect: 'manual' });
  const text = await res.text();
  const rows = parseCsv(text);
  const header = rows[0] ? rows[0].join(',') : '';
  const count = rows.length > 1 ? rows.length - 1 : 0;
  console.log(`${label}: status=${res.status} rows=${count} header=${header}`);
}

(async () => {
  const start = 1790812800000;
  const end = 1793491199999;
  await runCase('currentMonth', `${base}/leaderboard?timePeriod=currentMonth&isStakeExclusive=false&limit=100&offset=0`);
  await runCase('customRangeOct2026', `${base}/leaderboard?timePeriod=customRange&isStakeExclusive=false&limit=100&offset=0&startDate=${start}&endDate=${end}`);
})();
