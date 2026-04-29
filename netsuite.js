/**
 * netsuite.js — NetSuite REST/SuiteQL
 * Uses manual OAuth 1.0a matching NetSuite's exact requirements
 * Reference: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4394715627.html
 */
const fetch  = require('node-fetch');
const crypto = require('crypto');

const {
  NETSUITE_ACCOUNT_ID,
  NETSUITE_CONSUMER_KEY,
  NETSUITE_CONSUMER_SECRET,
  NETSUITE_TOKEN_ID,
  NETSUITE_TOKEN_SECRET,
} = process.env;

function buildAuthHeader(method, url) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(20).toString('hex');

  // NetSuite requires realm to be the account ID in uppercase
  const realm = NETSUITE_ACCOUNT_ID.toUpperCase();

  // These are the exact params NetSuite expects, in this order for the base string
  const params = [
    ['oauth_consumer_key', NETSUITE_CONSUMER_KEY],
    ['oauth_nonce', nonce],
    ['oauth_signature_method', 'HMAC-SHA256'],
    ['oauth_timestamp', String(timestamp)],
    ['oauth_token', NETSUITE_TOKEN_ID],
    ['oauth_version', '1.0'],
  ];

  // Sort params alphabetically by key
  params.sort((a, b) => a[0] < b[0] ? -1 : 1);

  // Build normalized param string
  const normalizedParams = params
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .join('&');

  // Build signature base string
  const baseString = [
    method.toUpperCase(),
    encode(url),
    encode(normalizedParams),
  ].join('&');

  // Build signing key — raw secrets with & separator (NOT encoded)
  const signingKey = `${NETSUITE_CONSUMER_SECRET}&${NETSUITE_TOKEN_SECRET}`;

  // Generate signature
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(baseString)
    .digest('base64');

  // Build Authorization header
  const authParams = [
    ...params,
    ['oauth_signature', signature],
  ];

  const authStr = authParams
    .map(([k, v]) => `${k}="${encode(v)}"`)
    .join(',');

  return `OAuth realm="${realm}",${authStr}`;
}

// Strict RFC 3986 encoding
function encode(str) {
  return encodeURIComponent(String(str))
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function getBaseUrl() {
  const id = NETSUITE_ACCOUNT_ID.toLowerCase().replace(/_/g, '-');
  return `https://${id}.suitetalk.api.netsuite.com`;
}

async function runSuiteQL(sql) {
  const baseUrl = `${getBaseUrl()}/services/rest/query/v1/suiteql`;
  const fullUrl = `${baseUrl}?limit=1000&offset=0`;

  // IMPORTANT: Sign with base URL only (no query string)
  const auth = buildAuthHeader('POST', baseUrl);

  console.log('[netsuite] Calling:', baseUrl);

  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
      'Prefer': 'transient',
    },
    body: JSON.stringify({ q: sql }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`NetSuite SuiteQL error ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function fetchOverdueInvoices() {
  const sql = `
    SELECT t.id, t.tranId, e.altName AS customerName,
           t.amountRemaining, t.dueDate,
           (CURRENT_DATE - t.dueDate) AS daysOverdue
    FROM invoice t
    JOIN entity e ON t.entity = e.id
    WHERE t.dueDate <= (CURRENT_DATE - 30)
      AND t.amountRemaining > 0
      AND t.status = 'A'
    ORDER BY daysOverdue DESC`;

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

async function sendNetSuiteEmail({ customerId, subject, body }) {
  const url  = `${getBaseUrl()}/services/rest/record/v1/message`;
  const auth = buildAuthHeader('POST', url);
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject, message: body, incoming: false,
      messageType: { id: 'EMAIL' },
      recipient: [{ id: String(customerId) }],
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`NetSuite email error ${res.status}: ${t}`); }
  return true;
}

module.exports = { fetchOverdueInvoices, sendNetSuiteEmail, runSuiteQL };
