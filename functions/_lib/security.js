/**
 * functions/_lib/security.js
 * ----------------------------------------------------------------------------
 * Cross-cutting security helpers:
 *   - CORS (locked to allow-list)
 *   - JSON parsing with size cap
 *   - String sanitisation
 *   - Per-IP rate limiting backed by Cloudflare KV (optional) or Durable Object
 *
 * Rate limiting strategy:
 *   We use a simple in-memory token-bucket per-Worker-instance. For production
 *   across multiple isolates, add a Cloudflare KV namespace or Durable Object
 *   and replace `bucket` with a shared counter. The interface stays the same.
 */

const ALLOWED_ORIGINS = (typeof env !== 'undefined' && env?.ALLOWED_ORIGINS)
  ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : [];

/** Per-IP token buckets. Cleared on Worker restart. */
const buckets = new Map();

/**
 * CORS preflight + headers. If ALLOWED_ORIGINS is set in env, only those
 * origins are allowed. Otherwise, same-origin only.
 */
export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env?.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const allowOrigin = allowed.length === 0
    ? (origin && sameSite(origin, new URL(request.url).origin) ? origin : '')
    : (allowed.includes(origin) ? origin : (allowed[0] === '*' ? '*' : ''));

  return {
    'Access-Control-Allow-Origin': allowOrigin || 'null',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function sameSite(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

/** Handle OPTIONS preflight. */
export function handlePreflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

/**
 * Parse a JSON body with a hard size cap to prevent memory abuse.
 * @param {Request} request
 * @param {number} maxBytes  default 64 KB
 */
export async function parseJson(request, maxBytes = 64 * 1024) {
  const cl = Number(request.headers.get('Content-Length') || 0);
  if (cl > maxBytes) {
    const err = new Error('Request body too large');
    err.status = 413; err.code = 'PAYLOAD_TOO_LARGE'; throw err;
  }
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { const err = new Error('Invalid JSON'); err.status = 400; err.code = 'BAD_JSON'; throw err; }
}

/**
 * Basic input sanitisation — strips control chars and trims.
 * NOTE: This is NOT a substitute for parameterised queries. We always use
 * PostgREST's parameterised filter syntax (e.g. `id=eq.${value}`) which is
 * SQL-injection safe at the Supabase layer.
 */
export function cleanString(s, maxLen = 16000) {
  if (typeof s !== 'string') return '';
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, maxLen)
    .trim();
}

/**
 * Per-IP rate limiter.
 *
 * @param {Request} request
 * @param {Object} [opts]
 * @param {number} [opts.max=30]   Max requests per window
 * @param {number} [opts.windowMs=60_000]  Window length
 * @returns {{ ok: boolean, remaining: number, retryAfter: number }}
 */
export function rateLimit(request, { max = 30, windowMs = 60_000 } = {}) {
  const ip = request.headers.get('CF-Connecting-IP')
          || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
          || 'unknown';

  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(ip, bucket);
  }
  bucket.count += 1;

  // Garbage-collect occasionally so the map doesn't grow unbounded.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }

  return {
    ok: bucket.count <= max,
    remaining: Math.max(0, max - bucket.count),
    retryAfter: Math.max(0, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** Validate a Bangladeshi mobile-wallet TRX ID. bKash = 10 chars alphanumeric; Nagad = similar. */
export function isValidTrxId(trx) {
  if (typeof trx !== 'string') return false;
  const t = trx.trim();
  return /^[A-Z0-9]{6,20}$/i.test(t);
}

/** Validate email. */
export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
