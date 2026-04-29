/**
 * netsuite.js — NetSuite REST/SuiteQL with correct OAuth 1.0a TBA signing
 */
const fetch   = require('node-fetch');
const crypto  = require('crypto');
 
const {
  NETSUITE_ACCOUNT_ID,
  NETSUITE_CONSUMER_KEY,
  NETSUITE_CONSUMER_SECRET,
  NETSUITE_TOKEN_ID,
  NETSUITE_TOKEN_SECRET,
} = process.env;
 
function pct(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A');
}
 
function buildAuthHeader(method, baseUrl) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce     = crypto.randomBytes(16).toString('hex');
  const realm     = NETSUITE_ACCOUNT_ID.toUpperCase().replace(/-/g, '_');
 
  const oauthParams = {
    oauth_consumer_key:     NETSUITE_CONSUMER_KEY,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp:        timestamp,
    oauth_token:            NETSUITE_TOKEN_ID,
    oauth_version:          '1.0',
  };
 
  const paramString = Object.keys(oauthParams).sort()
    .map(k => `${pct(k)}=${pct(oauthParams[k])}`).join('&');
 
  const baseString = [method.toUpperCase(), pct(baseUrl), pct(paramString)].join('&');
  const signingKey = `${pct(NETSUITE_CONSUMER_SECRET)}&${pct(NETSUITE_TOKEN_SECRET)}`;
  const signature  = crypto.createHmac('sha256', signingKey).update(baseString).digest('base64');
 
  const all = { ...oauthParams, oauth_signature: signature };
  return 'OAuth realm="' + realm + '", ' +
    Object.keys(all).sort().map(k => `${k}="${pct(all[k])}"`).join(', ');
}
 
function accountHost() {
  return NETSUITE_ACCOUNT_ID.toLowerCase().replace(/_/g, '-');
}
 
async function runSuiteQL(sql, limit = 1000, offset = 0) {
  const url   = `https://${accountHost()}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
  const query = `${url}?limit=${limit}&offset=${offset}`;
  const auth  = buildAuthHeader('POST', url);
 
  const res = await fetch(query, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'Prefer': 'transient' },
    body: JSON.stringify({ q: sql }),
  });
 
  if (!res.ok) { const t = await res.text(); throw new Error(`NetSuite SuiteQL error ${res.status}: ${t}`); }
  return res.json();
}
 
async function fetchOverdueInvoices() {
  const sql = `
    SELECT t.id, t.tranId, e.altName AS customerName,
           t.amountRemaining, t.dueDate, (CURRENT_DATE - t.dueDate) AS daysOverdue
    FROM invoice t JOIN entity e ON t.entity = e.id
    WHERE t.dueDate <= (CURRENT_DATE - 30) AND t.amountRemaining > 0 AND t.status = 'A'
    ORDER BY daysOverdue DESC`;
 
  const result = await runSuiteQL(sql);
  return (result.items || []).map(row => ({
    id: row.id, tranId: row.tranid, customerName: row.customername,
    amountRemaining: parseFloat(row.amountremaining) || 0,
    dueDate: row.duedate, daysOverdue: parseInt(row.daysoverdue) || 0,
  }));
}
 
async function sendNetSuiteEmail({ customerId, subject, body }) {
  const url  = `https://${accountHost()}.suitetalk.api.netsuite.com/services/rest/record/v1/message`;
  const auth = buildAuthHeader('POST', url);
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, message: body, incoming: false, messageType: { id: 'EMAIL' }, recipient: [{ id: String(customerId) }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`NetSuite email error ${res.status}: ${t}`); }
  return true;
}
 
module.exports = { fetchOverdueInvoices, sendNetSuiteEmail, runSuiteQL };  
