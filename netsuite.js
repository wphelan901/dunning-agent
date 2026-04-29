const fetch  = require('node-fetch');
const crypto = require('crypto');

const A  = () => process.env.NETSUITE_ACCOUNT_ID;
const CK = () => process.env.NETSUITE_CONSUMER_KEY;
const CS = () => process.env.NETSUITE_CONSUMER_SECRET;
const TK = () => process.env.NETSUITE_TOKEN_ID;
const TS = () => process.env.NETSUITE_TOKEN_SECRET;

function pct(s) {
  return encodeURIComponent(String(s))
    .replace(/!/g,'%21').replace(/'/g,'%27')
    .replace(/\(/g,'%28').replace(/\)/g,'%29').replace(/\*/g,'%2A');
}

function sign(method, url) {
  const ts    = String(Math.floor(Date.now()/1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const realm = A().toUpperCase().replace(/-/g,'_');

  const p = {
    oauth_consumer_key:     CK(),
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp:        ts,
    oauth_token:            TK(),
    oauth_version:          '1.0',
  };

  const ps  = Object.keys(p).sort().map(k=>`${pct(k)}=${pct(p[k])}`).join('&');
  const bs  = [method.toUpperCase(), pct(url), pct(ps)].join('&');
  const key = `${CS()}&${TS()}`;
  const sig = crypto.createHmac('sha256', key).update(bs).digest('base64');

  const hp = Object.keys(p).sort().map(k=>`${k}="${pct(p[k])}"`).join(',');
  return `OAuth realm="${realm}",${hp},oauth_signature="${pct(sig)}"`;
}

function host() {
  return A().toLowerCase().replace(/_/g,'-');
}

async function runSuiteQL(sql) {
  const url  = `https://${host()}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
  const full = `${url}?limit=1000&offset=0`;
  const auth = sign('POST', url);

  const res  = await fetch(full, {
    method:  'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'Prefer': 'transient' },
    body:    JSON.stringify({ q: sql }),
  });

  const txt = await res.text();
  console.log('[ns]', res.status, txt.slice(0,200));
  if (!res.ok) throw new Error(`NS ${res.status}: ${txt}`);
  return JSON.parse(txt);
}

async function fetchOverdueInvoices() {
  const r = await runSuiteQL(`
    SELECT t.id, t.tranId, e.altName AS customerName,
           t.amountRemaining, t.dueDate, (CURRENT_DATE - t.dueDate) AS daysOverdue
    FROM invoice t JOIN entity e ON t.entity = e.id
    WHERE t.dueDate <= (CURRENT_DATE - 30) AND t.amountRemaining > 0 AND t.status = 'A'
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
