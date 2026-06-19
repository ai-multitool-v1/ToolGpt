/**
 * functions/_middleware.js
 * ----------------------------------------------------------------------------
 * Runs before every /api/* request on Cloudflare Pages.
 *
 * Responsibilities:
 *   1. CORS preflight short-circuit (OPTIONS -> 204).
 *   2. Per-IP rate limit (default 60 req/min).
 *   3. Inject basic security headers.
 *   4. Forward to the route handler.
 */

import { corsHeaders, handlePreflight, rateLimit } from './_lib/security.js';

export async function onRequest(context) {
  const { request, env, next } = context;

  // 1. CORS preflight
  if (request.method === 'OPTIONS') {
    return handlePreflight(request, env);
  }

  // 2. Rate limit (skip for cron routes — they're authenticated by CRON_SECRET)
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/cron/')) {
    const rl = rateLimit(request, { max: 60, windowMs: 60_000 });
    if (!rl.ok) {
      return new Response(JSON.stringify({
        error: 'Too many requests',
        code: 'RATE_LIMITED',
        retryAfter: rl.retryAfter,
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rl.retryAfter),
          ...corsHeaders(request, env),
        },
      });
    }
  }

  // 3. Run the route
  let response;
  try {
    response = await next();
  } catch (err) {
    console.error('[middleware] uncaught', err);
    response = new Response(JSON.stringify({
      error: 'Internal Server Error',
      code: 'INTERNAL',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // 4. Merge CORS + security headers onto the response.
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-XSS-Protection', '1; mode=block');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
