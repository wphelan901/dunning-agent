/**
 * server.js — Dunning Agent Express server
 * Security: helmet, rate limiting, session auth, input sanitization, HTTPS redirect
 */
require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const crypto_auth  = require('crypto');
const path         = require('path');
const xss          = require('xss');
const { CronJob }  = require('cron');
const nodemailer   = require('nodemailer');

const { fetchOverdueInvoices } = require('./netsuite');
const { buildEmail, TEMPLATE_META } = require('./templates');
const { requireAuth } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── PBKDF2 password verification (no external library needed) ────────────────
function verifyPassword(password, storedHash) {
  try {
    const parts = storedHash.split(':');
    const salt = Buffer.from(parts[3], 'base64');
    const storedKey = Buffer.from(parts[4], 'base64');
    const key = crypto_auth.pbkdf2Sync(password, salt, parseInt(parts[2]), storedKey.length, 'sha256');
    return crypto_auth.timingSafeEqual(key, storedKey);
  } catch { return false; }
}

// ── Load users ───────────────────────────────────────────────────────────────
let USERS = [];
try { USERS = require('./users.json'); } catch(e) { console.warn('users.json not found'); }

// ── In-memory invoice cache (refreshed by cron) ──────────────────────────────
let invoiceCache = { data: [], lastUpdated: null, error: null };

// ── Security middleware ──────────────────────────────────────────────────────

// Force HTTPS in production
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

// Helmet: sets secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// Rate limiting — login: 10 attempts / 15min; API: 200 req/15min
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: 'Too many login attempts. Try again in 15 minutes.' });
const apiLimiter   = rateLimit({ windowMs: 15*60*1000, max: 200 });

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,       // blocks JS access to cookie
    sameSite: 'strict',   // CSRF protection
    maxAge: 8 * 60 * 60 * 1000, // 8 hour session
  },
}));

// ── Auth routes ──────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const username = xss(String(req.body.username || '').trim().toLowerCase());
  const password = String(req.body.password || '');

  const user = USERS.find(u => u.username.toLowerCase() === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = verifyPassword(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.user = { username: user.username, name: user.name, role: user.role };
    res.json({ ok: true, name: user.name });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json(req.session.user);
});

// ── Invoice data route ───────────────────────────────────────────────────────
app.get('/api/invoices', requireAuth, apiLimiter, (req, res) => {
  res.json({
    data: invoiceCache.data,
    lastUpdated: invoiceCache.lastUpdated,
    error: invoiceCache.error,
  });
});

// Manual refresh (admin)
app.post('/api/invoices/refresh', requireAuth, apiLimiter, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const data = await fetchOverdueInvoices();
    invoiceCache = { data, lastUpdated: new Date().toISOString(), error: null };
    res.json({ ok: true, count: data.length });
  } catch (err) {
    invoiceCache.error = err.message;
    res.status(500).json({ error: err.message });
  }
});

// ── Template metadata ────────────────────────────────────────────────────────
app.get('/api/templates', requireAuth, (req, res) => {
  res.json(TEMPLATE_META);
});

// ── Send reminders ────────────────────────────────────────────────────────────
app.post('/api/send', requireAuth, apiLimiter, async (req, res) => {
  const { invoiceIds, templateId } = req.body;

  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0)
    return res.status(400).json({ error: 'invoiceIds required' });
  if (!['friendly','formal','warning','final'].includes(templateId))
    return res.status(400).json({ error: 'Invalid templateId' });
  if (invoiceIds.length > 100)
    return res.status(400).json({ error: 'Max 100 invoices per batch' });

  const invoices = invoiceCache.data.filter(i => invoiceIds.includes(i.id));
  if (invoices.length === 0) return res.status(400).json({ error: 'No matching invoices found' });

  // Set up mailer
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: true },
  });

  const results = [];

  for (const inv of invoices) {
    try {
      const email = buildEmail(templateId, {
        customerName: inv.customerName,
        invoiceNumber: inv.tranId,
        amountRemaining: inv.amountRemaining,
        dueDate: inv.dueDate,
        daysOverdue: inv.daysOverdue,
      });

      // In production: replace 'test@example.com' with actual customer email from NetSuite
      // You'll need to add a customer email lookup to netsuite.js
      await transporter.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
        to: inv.customerEmail || process.env.SMTP_USER, // fallback to self until email lookup added
        subject: email.subject,
        text: email.text,
        html: email.html,
      });

      results.push({ id: inv.id, tranId: inv.tranId, status: 'sent' });
    } catch (err) {
      results.push({ id: inv.id, tranId: inv.tranId, status: 'failed', error: err.message });
    }
  }

  res.json({ results });
});

// ── Preview a template ────────────────────────────────────────────────────────
app.get('/api/template-preview/:templateId', requireAuth, (req, res) => {
  const { templateId } = req.params;
  try {
    const email = buildEmail(templateId, {
      customerName: 'Sample Customer',
      invoiceNumber: 'INV00000',
      amountRemaining: 1250.00,
      dueDate: '2026-03-01',
      daysOverdue: 58,
    });
    res.send(email.html);
  } catch (e) {
    res.status(400).send('Invalid template');
  }
});

// ── Serve the main app (protected) ───────────────────────────────────────────
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Cron: refresh invoices every night at 6am ─────────────────────────────
const job = new CronJob('0 6 * * *', async () => {
  console.log('[cron] Refreshing invoice cache from NetSuite...');
  try {
    const data = await fetchOverdueInvoices();
    invoiceCache = { data, lastUpdated: new Date().toISOString(), error: null };
    console.log(`[cron] Loaded ${data.length} overdue invoices`);
  } catch (err) {
    invoiceCache.error = err.message;
    console.error('[cron] NetSuite fetch failed:', err.message);
  }
}, null, true, 'America/Chicago');

// Initial load on startup
(async () => {
  console.log('[startup] Fetching invoices from NetSuite...');
  try {
    const data = await fetchOverdueInvoices();
    invoiceCache = { data, lastUpdated: new Date().toISOString(), error: null };
    console.log(`[startup] Loaded ${data.length} overdue invoices`);
  } catch (err) {
    invoiceCache.error = err.message;
    console.warn('[startup] Could not load invoices (check .env):', err.message);
  }
})();

app.listen(PORT, () => {
  console.log(`\n✓ Dunning Agent running on http://localhost:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
});
