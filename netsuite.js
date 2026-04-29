const fetch  = require('node-fetch');
const crypto = require('crypto');

function sign(method, url) {
  const account = process.env.NETSUITE_ACCOUNT_ID;
  const ck = process.env.NETSUITE_CONSUMER_KEY;
  const cs = process.env.NETSUITE_CONSUMER_SECRET;
  const tk = process.env.NETSUITE_TOKEN_ID;
  const ts = process.env.NETSUITE_TOKEN_SECRET;
  const realm = account.toUpperCase().replace(/-/g,'_');
  const timestamp = String(Math.floor(Date.now()/1000));
  const nonce = crypto.randomBytes(16).toString('hex');

  // Exact parameter names and order per NetSuite TBA docs
  const oauthParams = {
    oauth_consumer_key:     ck,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp:        timestamp,
    oauth_token:            tk,
    oauth_version:          '1.0',
  };

  // Build normalized parameter string
  const sortedKeys = Object.keys(oauthParams).sort();
  const normalizedParams = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`)
    .join('&');

  // Build signature base string
  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(normalizedParams)
  ].join('&');

  // Signing key — consumer_secret & token_secret (raw, not encoded)
  const signingKey = `${cs}&${ts}`;
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(baseString)
    .digest('base64');

  console.log('[ns] Account:', account);
  console.log('[ns] Realm:', realm);
  console.log('[ns] CK:', ck ? ck.slice(0,8)+'...' : 'MISSING');
  console.log('[ns] TK:', tk ? tk.slice(0,8)+'...' : 'MISSING');
  console.log('[ns] Signature:', signature.slice(0,20)+'...');

  // Build Authorization header — exact format from NetSuite docs
  // realm first, then params in alphabetical order, signature last
  const headerValue = [
    `OAuth realm="${realm}"`,
    `oauth_consumer_key="${encodeURIComponent(ck)}"`,
    `oauth_nonce="${encodeURIComponent(nonce)}"`,
    `oauth_signature="${encodeURIComponent(signature)}"`,
    `oauth_signature_method="HMAC-SHA256"`,
    `oauth_timestamp="${encodeURIComponent(timestamp)}"`,
    `oauth_token="${encodeURIComponent(tk)}"`,
    `oauth_version="1.0"`,
  ].join(', ');

  console.log('[ns] Auth header (first 100):', headerValue.slice(0,100));
  return headerValue;
}

function host() {
  return process.env.NETSUITE_ACCOUNT_ID.toLowerCase().replace(/_/g,'-');
}

async function runSuiteQL(sql) {
  const url  = `https://${host()}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
  const full = `${url}?limit=1000&offset=0`;
  const auth = sign('POST', url);

  console.log('[ns] Requesting:', url);

  const res = await fetch(full, {
    method:  'POST',
    headers: {
      'Authorization': auth,
      'Content-Type':  'application/json',
      'Prefer':        'transient',
    },
    body: JSON.stringify({ q: sql }),
  });

  const txt = await res.text();
  console.log('[ns] Status:', res.status);
  console.log('[ns] Response:', txt.slice(0,200));
  if (!res.ok) throw new Error(`NS ${res.status}: ${txt}`);
  return JSON.parse(txt);
}

async function fetchOverdueInvoices() {
  const r = await runSuiteQL(`
    SELECT t.id, t.tranId, e.altName AS customerName,
           t.amountRemaining, t.dueDate,
           (CURRENT_DATE - t.dueDate) AS daysOverdue
    FROM invoice t JOIN entity e ON t.entity = e.id
    WHERE t.dueDate <= (CURRENT_DATE - 30)
      AND t.amountRemaining > 0
      AND t.status = 'A'
    ORDER BY daysOverdue DESC`);
  return (r.items||[]).map(row=>({
    id: row.id, tranId: row.tranid, customerName: row.customername,
    amountRemaining: parseFloat(row.amountremaining)||0,
    dueDate: row.duedate, daysOverdue: parseInt(row.daysoverdue)||0,
  }));
}

async function sendNetSuiteEmail({ customerId, subject, body }) {
  const url  = `https://${host()}.suitetalk.api.netsuite.com/services/rest/record/v1/message`;
  const auth = sign('POST', url);
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ subject, message: body, incoming: false,
      messageType: { id: 'EMAIL' }, recipient: [{ id: String(customerId) }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`NS email ${res.status}: ${t}`); }
  return true;
}

module.exports = { fetchOverdueInvoices, sendNetSuiteEmail, runSuiteQL };
