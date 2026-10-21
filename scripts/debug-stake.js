'use strict';
// Probe Stake affiliate leaderboard through the same server-side client the site uses.
require('../src/config');
const { stakeGet } = require('../src/services/stake');

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

async function runCase(label, params) {
  try {
    const text = await stakeGet('/leaderboard', params);
    const rows = parseCsv(text);
    const header = rows[0] ? rows[0].join(',') : '';
    const count = rows.length > 1 ? rows.length - 1 : 0;
    console.log(`${label}: status=200 rows=${count} header=${header}`);
  } catch (err) {
    console.log(`${label}: FAILED ${err.message}`);
  }
}

(async () => {
  const start = 1790812800000;
  const end = 1793491199999;
  await runCase('currentMonth', { timePeriod: 'currentMonth', isStakeExclusive: false, limit: 50, offset: 0 });
  await runCase('customRangeOct2026', { timePeriod: 'customRange', isStakeExclusive: false, limit: 50, offset: 0, startDate: start, endDate: end });
})();
