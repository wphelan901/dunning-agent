# Dunning Agent — America's Best Carpet & Tile
Internal accounts receivable tool. Connects to NetSuite, surfaces overdue invoices, and sends branded dunning emails.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in your credentials
cp .env.example .env
# Edit .env with your NetSuite OAuth keys and SMTP credentials

# 3. Set up user passwords
node scripts/hash-password.js yourpassword
# Copy the hash output into users.json for each user

# 4. Run in development
npm run dev

# 5. Open http://localhost:3000
```

---

## Setting up NetSuite credentials

You need a **Token-Based Authentication (TBA)** integration in NetSuite:

1. NetSuite → Setup → Integration → Manage Integrations → New
2. Enable **Token-Based Authentication**
3. Note your **Consumer Key** and **Consumer Secret**
4. Setup → Users/Roles → Access Tokens → New
5. Note your **Token ID** and **Token Secret**
6. Fill all four values in `.env`

---

## Adding users

```bash
node scripts/hash-password.js password123
# outputs: $2a$12$xxxx...
```

Edit `users.json`:
```json
[
  {
    "username": "sharon",
    "passwordHash": "$2a$12$xxxx...",
    "name": "Sharon",
    "role": "viewer"
  }
]
```

Roles: `admin` (can refresh data, send reminders) · `viewer` (read-only)

---

## Email setup (SMTP)

The app sends via SMTP through `billing@abctflooring.com`.

Fill in `.env`:
```
SMTP_HOST=smtp.office365.com   # or smtp.gmail.com for Gmail
SMTP_PORT=587
SMTP_USER=billing@abctflooring.com
SMTP_PASS=your_app_password
```

**Note:** For Gmail, use an App Password (not your regular password).
For Microsoft 365, use your email password or an App Password if MFA is enabled.

---

## Deploying to production

### Option A — Simple VPS (DigitalOcean, Linode, etc.)
```bash
# On the server:
npm install --production
NODE_ENV=production node server.js

# Use PM2 to keep it running:
npm install -g pm2
pm2 start server.js --name dunning-agent
pm2 save
```

Put Nginx in front for SSL:
```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

### Option B — Railway / Render (easiest, free tier available)
1. Push code to a private GitHub repo
2. Connect to Railway or Render
3. Set environment variables in their dashboard
4. Deploy — they handle SSL automatically

---

## Security features

- **Helmet.js** — sets CSP, HSTS, X-Frame-Options, and other secure headers
- **bcrypt** — passwords are hashed with bcrypt (cost factor 12), never stored in plaintext
- **Session hardening** — httpOnly cookies, sameSite=strict (CSRF protection), secure flag in production
- **Rate limiting** — login: 10 attempts/15 min; API: 200 req/15 min
- **HTTPS redirect** — all HTTP traffic redirected to HTTPS in production
- **Input sanitization** — all user inputs sanitized with xss library before use
- **Environment variables** — NetSuite credentials and secrets never in source code
- **Payload limits** — JSON body capped at 50kb to prevent abuse

---

## Data refresh

Invoices are cached in memory and auto-refreshed every night at **6:00 AM Central**.
Admins can manually refresh via the ↺ button in the header.

---

## Email templates

| ID | Name | When to use |
|----|------|-------------|
| `friendly` | Friendly Reminder | First contact, 30–44 days |
| `formal` | Formal Notice | 45–59 days |
| `warning` | Warning / Service Notice | 60–74 days |
| `final` | Final Demand | 75+ days, before collections |
