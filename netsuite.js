/**
 * netsuite.js — NetSuite REST/SuiteQL using netsuite-rest library
 */
const NsRest = require('netsuite-rest');

const {
  NETSUITE_ACCOUNT_ID,
  NETSUITE_CONSUMER_KEY,
  NETSUITE_CONSUMER_SECRET,
  NETSUITE_TOKEN_ID,
  NETSUITE_TOKEN_SECRET,
} = process.env;

function getClient() {
  return new NsRest({
    consumer_key:    NETSUITE_CONSUMER_KEY,
    consumer_secret: NETSUITE_CONSUMER_SECRET,
    token:           NETSUITE_TOKEN_ID,
    token_secret:    NETSUITE_TOKEN_SECRET,
    account:         NETSUITE_ACCOUNT_ID,
    base_url:        `https://${NETSUITE_ACCOUNT_ID.toLowerCase().replace(/_/g,'-')}.suitetalk.api.netsuite.com`,
  });
}

async function runSuiteQL(sql, limit = 1000, offset = 0) {
  const ns  = getClient();
  const res = await ns.request({
    path:   `query/v1/suiteql?limit=${limit}&offset=${offset}`,
    method: 'POST',
    body:   JSON.stringify({ q: sql }),
    headers: { 'Content-Type': 'application/json', 'Prefer': 'transient' },
  });

  if (res.status !== 200) {
    const text = await res.text();
    throw new Error(`NetSuite SuiteQL error ${res.status}: ${text}`);
  }
  return res.json();
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
  const ns  = getClient();
  const res = await ns.request({
    path:   'record/v1/message',
    method: 'POST',
    body:   JSON.stringify({
      subject, message: body, incoming: false,
      messageType: { id: 'EMAIL' },
      recipient:   [{ id: String(customerId) }],
    }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status !== 200 && res.status !== 204) {
    const t = await res.text();
    throw new Error(`NetSuite email error ${res.status}: ${t}`);
  }
  return true;
}

module.exports = { fetchOverdueInvoices, sendNetSuiteEmail, runSuiteQL };
