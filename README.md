# ToolGpt — Pentesting & Cybersecurity AI Chat (Cloudflare Pages + Supabase + Groq + Gemini)

Production-ready AI Chat SaaS themed for **pentesting, ethical hacking, and
cybersecurity**. Email/Google auth, plan-based model routing (Free → Groq
Llama 3.1, Pro → Gemini Flash), manual bKash/Nagad payments with Telegram
admin notifications, token quota enforcement, and security hardening.

ToolGpt's persona is a senior penetration tester and ethical-hacking educator.
The system prompt (in `public/js/config.js → PERSONA`) hard-codes
authorization-first behavior: scope and consent before any offensive
technique, educational framing, MITRE ATT&CK / OWASP / CVE references, and
refusal of clearly malicious requests.

> This repository contains the **JavaScript, Cloudflare Functions, SQL,
> Supabase integration, Telegram integration, security logic, and AI
> provider integration**. The two HTML files (`index.html` and
> `login-signup.html`) are provided by the user and are **not** redesigned
> here. The JS modules expose a clear DOM contract (see
> [HTML Integration Contract](#html-integration-contract)) that the HTML must
> satisfy.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Browser (user)                                │
│   index.html / login-signup.html  +  public/js/*.js  (ES modules)    │
│                                                                      │
│   supabase-js (anon key only)  ──►  Supabase Auth (GoTrue)           │
│   fetch /api/* (Bearer + cookie) ─► Cloudflare Pages Functions       │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  Cloudflare Pages Functions (server)                 │
│                                                                      │
│   _middleware.js   → CORS + rate-limit + security headers            │
│   api/auth/verify  → server-side session check                       │
│   api/auth/logout  → invalidate session + clear cookie               │
│   api/chat         → quota check → route by plan → AI → save history │
│   api/history      → user's chat history                             │
│   api/usage        → token usage dashboard data                      │
│   api/profile      → read/update own profile (safe fields only)      │
│   api/payment/*    → submit + list payment requests                  │
│   api/payment/admin→ approve/reject (admin-only)                     │
│   api/cron/*       → daily reset + pro expiry (CRON_SECRET gated)    │
│                                                                      │
│   _lib/supabase.js → thin REST client (no @supabase/supabase-js dep) │
│   _lib/auth.js     → server-side session verification                │
│   _lib/tokens.js   → quota check + token accounting                  │
│   _lib/security.js → CORS, JSON size cap, rate limit, validation     │
│   _lib/telegram.js → bot message sender                             │
│   _lib/ai/router.js→ plan-based model selection (FREE/Groq+fallback, │
│                      PRO/Gemini, ULTRA/Coming Soon)                  │
└──────────────────────────────────────────────────────────────────────┘
                    │                              │
                    ▼                              ▼
        ┌───────────────────┐          ┌────────────────────┐
        │     Supabase      │          │  AI Providers      │
        │  - Auth (GoTrue)  │          │  - Groq (Llama 3.1)│
        │  - Postgres + RLS │          │  - Gemini Flash    │
        └───────────────────┘          └────────────────────┘
                                                    │
                                                    ▼
                                       ┌────────────────────┐
                                       │   Telegram Bot     │
                                       │ (payment alerts)   │
                                       └────────────────────┘
```

---

## Stack

| Layer        | Tech                                                         |
|--------------|-------------------------------------------------------------|
| Frontend     | Static HTML + Tailwind + ES-module JS (no build step)       |
| Edge         | Cloudflare Pages Functions (Workers runtime)                |
| Database     | Supabase Postgres + RLS                                     |
| Auth         | Supabase Auth (email+password + Google OAuth)               |
| AI — Free    | Groq `llama-3.1-8b-instant`, fallback `qwen3-32b`           |
| AI — Pro     | Google Gemini `gemini-1.5-flash`                            |
| AI — Ultra   | Not implemented — returns "Ultra Coming Soon 🚀"            |
| Payments     | bKash / Nagad, manual verification, Telegram notifications  |
| Cron         | External cron → `/api/cron/*` (CRON_SECRET gated)           |

---

## Setup

### 1. Supabase

1. Create a project at https://supabase.com.
2. Open **SQL Editor** → New query → paste [`supabase/schema.sql`](./supabase/schema.sql) → Run.
3. **Auth → Providers**:
   - **Email**: enable, set **Confirm email** = ON.
   - **Google**: enable, paste OAuth client ID/secret from Google Cloud Console.
     Redirect URL: `https://YOUR-PROJECT.supabase.co/auth/v1/callback` and
     your app URL `https://your-app.pages.dev/index.html`.
4. Copy these from **Project Settings → API**:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (public, safe to expose)
   - `SUPABASE_SERVICE_ROLE_KEY` (SECRET — server only)

### 2. AI providers

- **Groq**: https://console.groq.com/keys → create key → `GROQ_API_KEY`
- **Gemini**: https://aistudio.google.com/app/apikey → create key → `GEMINI_API_KEY`

### 3. Telegram bot (for payment notifications)

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → get `TELEGRAM_BOT_TOKEN`.
2. Add the bot to your admin channel/group, OR message it directly.
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` to find `TELEGRAM_CHAT_ID`
   (look for `chat.id` in the JSON).

### 4. Cloudflare Pages

```bash
# Install wrangler
npm install

# Login (one time)
npx wrangler login

# Create the project
npx wrangler pages project create ai-chat-saas

# Set SECRETS (interactive — paste each value when prompted)
npx wrangler pages secret put GROQ_API_KEY              --project-name ai-chat-saas
npx wrangler pages secret put GEMINI_API_KEY            --project-name ai-chat-saas
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name ai-chat-saas
npx wrangler pages secret put TELEGRAM_BOT_TOKEN        --project-name ai-chat-saas
npx wrangler pages secret put TELEGRAM_CHAT_ID          --project-name ai-chat-saas
npx wrangler pages secret put CRON_SECRET               --project-name ai-chat-saas

# Edit wrangler.toml to set SUPABASE_URL, SUPABASE_ANON_KEY,
# ALLOWED_ORIGINS, APP_URL, ADMIN_EMAILS

# Deploy
npm run deploy
```

### 5. Cron jobs

Set up two external cron jobs (cron-job.org, UptimeRobot, or a Cloudflare
Worker with `[triggers] crons = [...]`):

| URL                              | Schedule      | Header                                |
|----------------------------------|---------------|---------------------------------------|
| `https://your-app.pages.dev/api/cron/daily-reset`  | `0 0 * * *` (midnight UTC daily) | `Authorization: Bearer <CRON_SECRET>` |
| `https://your-app.pages.dev/api/cron/check-expiry` | `0 * * * *` (hourly)             | `Authorization: Bearer <CRON_SECRET>` |

### 6. Local development

```bash
npm run dev
# Serves public/ at http://localhost:8788 with functions live.
# Create .dev.vars (gitignored) with the same vars as .env.example
# for local secret access.
```

---

## HTML Integration Contract

Your `index.html` and `login-signup.html` must include the JS modules and
expose the element IDs the modules bind to. Drop the HTML files in
`public/` and add these script tags.

### `public/login-signup.html`

```html
<!-- supabase-client.js self-initialises the global `supabase` on import -->
<script type="module">
  import '/js/supabase-client.js';
  import { initAuthPage } from '/js/auth.js';
  initAuthPage();
</script>
```

Required element IDs (you own the visual design around them):

```
#tab-login, #tab-signup, #tab-forgot            — tab buttons
#form-login, #form-signup, #form-forgot         — <form> wrappers (hidden class toggles)
  #login-email, #login-password                 — inputs
  #signup-email, #signup-password, #signup-username
  #forgot-email
#btn-login, #btn-signup, #btn-forgot, #btn-google
#auth-message                                    — status text container
```

### `public/index.html`

```html
<script type="module" src="/js/main.js"></script>
```

Required element IDs by component:

**Sidebar** (`sidebar.js`)
```
#sidebar, #sidebar-toggle
#user-email, #user-plan
#btn-logout, #btn-new-chat, #btn-show-history
#history-list
```

**Chat** (`chat.js`)
```
#chat-messages           — scrollable message list
#chat-form               — composer <form>
#chat-input              — <textarea>
#chat-send, #chat-clear
#chat-model-indicator    — "Groq · Llama 3.1 8B Instant"
#chat-quota              — "120 / 200 tokens today"
```

**Settings** (`settings.js`)
```
#settings-form, #settings-username, #settings-avatar, #btn-save-profile
#settings-plan           — plan card container
#settings-quota-bar      — usage bar (set width %)
#settings-quota-text
#settings-usage-list     — 7-day chart container
#btn-upgrade             — opens payment modal
```

**Payment** (`payment.js`)
```
#payment-modal, #payment-form
  #payment-method (select), #payment-amount (input number, read-only)
  #payment-trx, #payment-email, #payment-destination
  #btn-payment-submit, #btn-payment-cancel
#my-requests-list        — prior payment requests
```

---

## Security model

1. **Secrets never touch the browser.** All AI keys, the Supabase service-role
   key, and Telegram tokens live only in Cloudflare env vars and are read by
   `functions/_lib/*` server-side.
2. **Sessions verified server-side on every request.**
   `functions/_lib/auth.js → requireUser()` calls Supabase GoTrue
   `/auth/v1/user` to validate the JWT — we never decode it locally.
3. **Plan is read from the DB, never from the client.** `ai/router.js`
   ignores any `model` field in the request body.
4. **Quota is enforced before AND after the AI call.** Pre-flight check
   rejects over-quota requests; post-call usage is recorded with the
   provider's real token counts (or a heuristic estimate).
5. **RLS is enabled on every table.** Even if the anon key were abused,
   users can only read/write their own rows. The service-role key bypasses
   RLS and is server-only.
6. **Profile columns `plan`, `daily_limit`, `used_tokens`, `is_banned`,
   `expires_at` are revoked from `anon` and `authenticated` roles** at the
   DB level — even a leaked anon key can't escalate privileges.
7. **CORS allow-listed** via `ALLOWED_ORIGINS`. Rate-limited per IP
   (60 req/min default, configurable in `_middleware.js`).
8. **Input validation** on every endpoint: JSON size cap, string sanitisation,
   TRX ID format, email format, payment method enum.
9. **Telegram messages are HTML-escaped** to prevent injection.
10. **Cron endpoints gated by `CRON_SECRET`** — they don't accept user JWTs.

---

## Plan matrix

| Plan   | Model                    | Daily tokens | Provider | Payment           |
|--------|--------------------------|--------------|----------|-------------------|
| Free   | llama-3.1-8b-instant (Groq, fallback: qwen3) | 200          | Groq     | —                 |
| Pro    | gemini-1.5-flash         | 10,000       | Google   | 99 BDT / 30 days  |
| Ultra  | —                        | —            | —        | Coming Soon 🚀    |

---

## File map

```
ai-chat-saas/
├── public/                      ← static assets served as-is
│   ├── js/
│   │   ├── config.js            ← public config (no secrets)
│   │   ├── supabase-client.js   ← browser Supabase init (anon key)
│   │   ├── api.js               ← /api/* HTTP client
│   │   ├── auth.js              ← login/signup/google/forgot/logout UI
│   │   ├── ui.js                ← DOM + markdown + toast helpers
│   │   ├── chat.js              ← chat composer + message list
│   │   ├── sidebar.js           ← history sidebar
│   │   ├── settings.js          ← profile + plan + usage dashboard
│   │   ├── payment.js           ← bKash/Nagad payment modal
│   │   └── main.js              ← index.html entry — verifies session + boots
│   ├── index.html               ← (you provide)
│   └── login-signup.html        ← (you provide)
│
├── functions/                   ← Cloudflare Pages Functions
│   ├── _middleware.js           ← CORS + rate-limit + headers
│   ├── _lib/
│   │   ├── supabase.js          ← thin REST client (anon + service)
│   │   ├── auth.js              ← requireUser() — server-side verify
│   │   ├── tokens.js            ← quota check + usage recording
│   │   ├── security.js          ← CORS, parseJson, rateLimit, validators
│   │   ├── telegram.js          ← payment notification sender
│   │   └── ai/
│   │       ├── groq.js          ← Groq OpenAI-compatible client
│   │       ├── gemini.js        ← Gemini generateContent client
│   │       └── router.js        ← plan-based model selection
│   └── api/
│       ├── chat.js              ← POST /api/chat — main chat endpoint
│       ├── history.js           ← GET/DELETE /api/history
│       ├── usage.js             ← GET /api/usage — dashboard data
│       ├── profile.js           ← GET/PATCH /api/profile
│       ├── auth/
│       │   ├── verify.js        ← GET /api/auth/verify
│       │   └── logout.js        ← POST /api/auth/logout
│       ├── payment/
│       │   ├── request.js       ← GET/POST /api/payment/request
│       │   └── admin.js         ← GET/POST /api/payment/admin
│       └── cron/
│           ├── daily-reset.js   ← resets used_tokens to 0 daily
│           └── check-expiry.js  ← downgrades expired Pro users
│
├── supabase/
│   └── schema.sql               ← tables, RLS policies, triggers, helpers
│
├── wrangler.toml                ← Cloudflare config (non-secret vars)
├── package.json
├── .env.example                 ← template; copy to .env / .dev.vars
└── .gitignore
```

---

## API reference (concise)

| Method | Endpoint                       | Body / Query                              | Returns                       |
|--------|--------------------------------|-------------------------------------------|-------------------------------|
| GET    | `/api/auth/verify`             | —                                         | `{ user, profile }`           |
| POST   | `/api/auth/logout`             | —                                         | `{ ok: true }`                |
| POST   | `/api/chat`                    | `{ messages, temperature?, maxTokens? }`  | `{ content, model, usage, quota }` |
| GET    | `/api/history`                 | `?limit=50&before=<iso>`                  | `{ history: [] }`             |
| DELETE | `/api/history`                 | —                                         | `{ ok: true }`                |
| GET    | `/api/usage`                   | —                                         | `{ today, daily, quota }`     |
| GET    | `/api/profile`                 | —                                         | `{ profile }`                 |
| PATCH  | `/api/profile`                 | `{ username?, avatar_url? }`              | `{ profile }`                 |
| GET    | `/api/payment/request`         | —                                         | `{ requests: [] }`            |
| POST   | `/api/payment/request`         | `{ method, amount, trxId, email? }`       | `{ ok, request, message }`    |
| GET    | `/api/payment/admin`           | `?status=pending`                         | `{ requests: [] }`            |
| POST   | `/api/payment/admin`           | `{ action, requestId, notes? }`           | `{ ok, message }`             |
| GET    | `/api/cron/daily-reset`        | `Authorization: Bearer <CRON_SECRET>`     | `{ ok, resetAt, affected }`   |
| GET    | `/api/cron/check-expiry`       | `Authorization: Bearer <CRON_SECRET>`     | `{ ok, downgraded }`          |

---

## Customisation quick-reference

| Want to…                          | Edit                                                                |
|----------------------------------|---------------------------------------------------------------------|
| Change free model                | `functions/_lib/ai/router.js` → `FREE_PRIMARY` / `FREE_FALLBACK`   |
| Change Pro model / daily limit   | `functions/_lib/ai/router.js` → `PRO_MODEL`; `functions/api/payment/admin.js` → `PRO_DAILY_LIMIT` |
| Change pricing                   | `functions/api/payment/request.js` → `PRICES`; `public/js/config.js` → `PRICES` |
| Change merchant numbers          | `public/js/config.js` → `PAYMENT_DESTINATIONS`                      |
| Tighten CORS                     | `wrangler.toml` → `ALLOWED_ORIGINS`                                 |
| Add an admin                     | `wrangler.toml` → `ADMIN_EMAILS`                                    |
| Change rate limit                | `functions/_middleware.js` → `rateLimit({ max, windowMs })`         |
| Change system prompt             | `public/js/config.js` → `CHAT.systemPrompt`                         |

---

## Production checklist

- [ ] Supabase: email confirmation ON; Google OAuth configured.
- [ ] All secrets set via `wrangler pages secret put` (not in wrangler.toml).
- [ ] `wrangler.toml` `ALLOWED_ORIGINS` set to your final domain(s).
- [ ] `ADMIN_EMAILS` includes your admin address.
- [ ] Cron jobs set up for daily-reset (midnight UTC) + check-expiry (hourly).
- [ ] Telegram bot added to your admin channel; `TELEGRAM_CHAT_ID` verified.
- [ ] `public/js/config.js` updated with your Supabase URL + anon key + app URL + merchant numbers.
- [ ] Test: signup → verify email → login → chat (free Groq) → submit payment → approve via /api/payment/admin → chat (Pro Gemini).

---

## License

MIT — use it, ship it, charge for it.
