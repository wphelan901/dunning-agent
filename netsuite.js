/**
 * netsuite.js — NetSuite REST/SuiteQL using OAuth 2.0 Client Credentials
 */
const fetch = require('node-fetch');

const {
  NETSUITE_ACCOUNT_ID,
  NETSUITE_CONSUMER_KEY,
  NETSUITE_CONSUMER_SECRET,
} = process.env;

let cachedToken = null;
let tokenExpiry = 0;

function getHost() {
  return NETSUITE_ACCOUNT_ID.toLowerCase().replace(/_/g, '-');
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const host  = getHost();
  const url   = `https://${host}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
  const creds = Buffer.from(`${NETSUITE_CONSUMER_KEY}:${NETSUITE_CONSUMER_SECRET}`).toString('base64');

  // NetSuite OAuth 2.0 client credentials requires these exact body params
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
  }).toString();

  console.log('[netsuite] Requesting token from:', url);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body,
  });

  const text = await res.text();
  console.log('[netsuite] Token response:', res.status, text.slice(0, 200));

  if (!res.ok) throw new Error(`NetSuite token error ${res.status}: ${text}`);

  const data  = JSON.parse(text);
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + ((data.expires_in || 3600) - 60) * 1000;
  return cachedToken;
}

async function runSuiteQL(sql, limit = 1000, offset = 0) {
  const token   = await getAccessToken();
  const host    = getHost();
  const fullUrl = `https://${host}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;

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

async function sendNetSuiteEmail({ customerId, subject, body }) {
  const token = await getAccessToken();
  const host  = getHost();
  const url   = `https://${host}.suitetalk.api.netsuite.com/services/rest/record/v1/message`;
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
