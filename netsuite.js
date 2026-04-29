/**
 * netsuite.js — NetSuite REST/SuiteQL using OAuth 2.0 Client Credentials
 * Simpler and more reliable than OAuth 1.0a TBA
 */
const fetch = require('node-fetch');

const {
  NETSUITE_ACCOUNT_ID,
  NETSUITE_CONSUMER_KEY,
  NETSUITE_CONSUMER_SECRET,
} = process.env;

let cachedToken = null;
let tokenExpiry  = 0;

function getBaseUrl() {
  const id = NETSUITE_ACCOUNT_ID.toLowerCase().replace(/_/g, '-');
  return `https://${id}.suitetalk.api.netsuite.com`;
}

// ── Get OAuth 2.0 access token ───────────────────────────────────────────────
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const id      = NETSUITE_ACCOUNT_ID.toLowerCase().replace(/_/g, '-');
  const url     = `https://${id}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
  const creds   = Buffer.from(`${NETSUITE_CONSUMER_KEY}:${NETSUITE_CONSUMER_SECRET}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`NetSuite token error ${res.status}: ${text}`);

  const data    = JSON.parse(text);
  cachedToken   = data.access_token;
  tokenExpiry   = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// ── SuiteQL runner ───────────────────────────────────────────────────────────
async function runSuiteQL(sql, limit = 1000, offset = 0) {
  const token   = await getAccessToken();
  const baseUrl = `${getBaseUrl()}/services/rest/query/v1/suiteql`;
  const fullUrl = `${baseUrl}?limit=${limit}&offset=${offset}`;

  const res = await fetch(fullUrl, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      'Prefer':        'transient',
    },
    body: JSON.stringify({ q: sql }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`NetSuite SuiteQL error ${res.status}: ${text}`);
  return JSON.parse(text);
}

// ── Fetch overdue invoices 30+ days ─────────────────────────────────────────
async function fetchOverdueInvoices() {
  const sql = `
    SELECT t.id, t.tranId, e.altName AS customerName,
           t.amountRemaining, t.dueDate,
           (CURRENT_DATE - t.dueDate) AS daysOverdue
    FROM invoice t
    JOIN entity e ON t.entity = e.id
    WHERE t.dueDate        <= (CURRENT_DATE - 30)
      AND t.amountRemaining >  0
      AND t.status          = 'A'
    ORDER BY daysOverdue DESC`;

  const result = await runSuiteQL(sql);
  return (result.items || []).map(row => ({
    id:              row.id,
    tranId:          row.tranid,
    customerName:    row.customername,
    amountRemaining: parseFloat(row.amountremaining) || 0,
    dueDate:         row.duedate,
    daysOverdue:     parseInt(row.daysoverdue) || 0,
  }));
}

// ── Send email via NetSuite ──────────────────────────────────────────────────
async function sendNetSuiteEmail({ customerId, subject, body }) {
  const token = await getAccessToken();
  const url   = `${getBaseUrl()}/services/rest/record/v1/message`;
  const res   = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      subject, message: body, incoming: false,
      messageType: { id: 'EMAIL' },
      recipient:   [{ id: String(customerId) }],
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`NetSuite email error ${res.status}: ${t}`); }
  return true;
}

module.exports = { fetchOverdueInvoices, sendNetSuiteEmail, runSuiteQL };
