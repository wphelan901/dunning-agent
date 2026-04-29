/**
 * netsuite.js — NetSuite REST/SuiteQL integration with OAuth 1.0a TBA
 */
const fetch = require('node-fetch');
const crypto = require('crypto');

const {
  NETSUITE_ACCOUNT_ID,
  NETSUITE_CONSUMER_KEY,
  NETSUITE_CONSUMER_SECRET,
  NETSUITE_TOKEN_ID,
  NETSUITE_TOKEN_SECRET,
} = process.env;

// ── OAuth 1.0a Token-Based Authentication ───────────────────────────────────
function buildAuthHeader(method, url) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const realm = NETSUITE_ACCOUNT_ID.toUpperCase().replace('-', '_');

  const params = {
    oauth_consumer_key: NETSUITE_CONSUMER_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: timestamp,
    oauth_token: NETSUITE_TOKEN_ID,
    oauth_version: '1.0',
  };

  const sortedParams = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join('&');

  const signingKey = `${encodeURIComponent(NETSUITE_CONSUMER_SECRET)}&${encodeURIComponent(NETSUITE_TOKEN_SECRET)}`;
  const signature = crypto.createHmac('sha256', signingKey).update(baseString).digest('base64');

  const headerParts = {
    ...params,
    oauth_signature: signature,
    realm,
  };

  return 'OAuth ' + Object.entries(headerParts)
    .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
    .join(', ');
}

// ── SuiteQL query runner ─────────────────────────────────────────────────────
async function runSuiteQL(sql, limit = 1000, offset = 0) {
  const accountId = NETSUITE_ACCOUNT_ID.replace('_', '-').toLowerCase();
  const url = `https://${accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;

  const auth = buildAuthHeader('POST', url.split('?')[0]);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
      'Prefer': 'transient',
    },
    body: JSON.stringify({ q: sql }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NetSuite SuiteQL error ${res.status}: ${text}`);
  }

  return res.json();
}

// ── Fetch overdue invoices 30+ days ─────────────────────────────────────────
async function fetchOverdueInvoices() {
  const sql = `
    SELECT
      t.id,
      t.tranId,
      e.altName AS customerName,
      t.amountRemaining,
      t.dueDate,
      (CURRENT_DATE - t.dueDate) AS daysOverdue
    FROM invoice t
    JOIN entity e ON t.entity = e.id
    WHERE t.dueDate <= (CURRENT_DATE - 30)
      AND t.amountRemaining > 0
      AND t.status = 'A'
    ORDER BY daysOverdue DESC
  `;

  const result = await runSuiteQL(sql);
  return (result.items || []).map(row => ({
    id: row.id,
    tranId: row.tranid,
    customerName: row.customername,
    amountRemaining: parseFloat(row.amountremaining) || 0,
    dueDate: row.duedate,
    daysOverdue: parseInt(row.daysoverdue) || 0,
  }));
}

// ── Send email via NetSuite ──────────────────────────────────────────────────
async function sendNetSuiteEmail({ customerId, subject, body, authorId }) {
  const accountId = NETSUITE_ACCOUNT_ID.replace('_', '-').toLowerCase();
  const url = `https://${accountId}.suitetalk.api.netsuite.com/services/rest/record/v1/message`;

  const auth = buildAuthHeader('POST', url);

  const payload = {
    subject,
    message: body,
    incoming: false,
    messageType: { id: 'EMAIL' },
    author: { id: authorId || '1' },
    recipient: [{ id: String(customerId) }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NetSuite send email error ${res.status}: ${text}`);
  }

  return true;
}

module.exports = { fetchOverdueInvoices, sendNetSuiteEmail, runSuiteQL };
