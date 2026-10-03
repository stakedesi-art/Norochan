'use strict';
// Tiny CSV parser + header helpers used for Stake reports and the local CSV fallback.

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function parseNumericCsvValue(value) {
  if (value == null) return Number.NaN;
  let cleaned = String(value).trim();
  if (!cleaned) return Number.NaN;
  cleaned = cleaned.replace(/[$,\s]/g, '');
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : Number.NaN;
}

function normalizeCampaignCode(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').replace(/\s+/g, ' ').trim();
}

// "total_weighted_amount (USD)" -> "total_weighted_amount"
const normHeader = (h) =>
  String(h).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

module.exports = { parseCsv, parseNumericCsvValue, normalizeCampaignCode, normHeader };
