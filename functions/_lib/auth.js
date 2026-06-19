/**
 * functions/_lib/auth.js
 * ----------------------------------------------------------------------------
 * Server-side session verification.
 *
 * THE GOLDEN RULE: never trust the frontend.
 *
 * The browser sends `sb-access-token` (cookie) or `Authorization: Bearer <jwt>`.
 * We:
 *   1. Extract the JWT.
 *   2. Ask Supabase's GoTrue `/auth/v1/user` to verify it. This checks the
 *      signature, expiry, and revocation status — we don't decode locally.
 *   3. Fetch the matching `profiles` row via the service-role client.
 *   4. Return { user, profile } or throw.
 *
 * If the user is banned, expired, or unverified, the request is rejected.
 */

import { createClient } from './supabase.js';

/**
 * Extract the access token from request.
 * Priority:
 *   1. Authorization: Bearer <jwt>
 *   2. Cookie: sb-access-token=<jwt>  (set by the frontend on login)
 */
export function extractToken(request) {
  const auth = request.headers.get('Authorization') || request.headers.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  const cookie = request.headers.get('Cookie') || request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  return null;
}

/**
 * Verify the incoming session and load the user's profile.
 *
 * @param {Request} request
 * @param {Object} env
 * @param {Object} [opts]
 * @param {boolean} [opts.requireVerifiedEmail=true]  Reject unverified email users
 * @returns {Promise<{ user: any, profile: any, token: string }>}
 */
export async function requireUser(request, env, opts = {}) {
  const { requireVerifiedEmail = true } = opts;

  const token = extractToken(request);
  if (!token) {
    const err = new Error('Authentication required');
    err.code = 'NO_TOKEN';
    err.status = 401;
    throw err;
  }

  // Verify with Supabase GoTrue — this is the only source of truth.
  const anon = createClient(env, 'anon', token);
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user) {
    const err = new Error('Invalid or expired session');
    err.code = 'INVALID_SESSION';
    err.status = 401;
    throw err;
  }

  // Email verification gate (skip for OAuth users — they are auto-verified).
  const isOAuth = !!(user.app_metadata?.provider && user.app_metadata.provider !== 'email');
  if (requireVerifiedEmail && !isOAuth && !user.email_confirmed_at) {
    const err = new Error('Please verify your email before continuing.');
    err.code = 'EMAIL_NOT_VERIFIED';
    err.status = 403;
    throw err;
  }

  // Load profile via service-role (bypass RLS — server is trusted).
  const admin = createClient(env, 'service');
  const profile = await admin.from('profiles')
    .select('*', { single: true, filter: { id: `eq.${user.id}` } })
    .catch(() => null);

  if (!profile) {
    const err = new Error('Profile not found. Please re-login.');
    err.code = 'NO_PROFILE';
    err.status = 404;
    throw err;
  }

  if (profile.is_banned) {
    const err = new Error('Your account has been banned. Contact support.');
    err.code = 'BANNED';
    err.status = 403;
    throw err;
  }

  // Pro-plan expiry check: if expires_at passed, downgrade to free.
  if (profile.plan === 'pro' && profile.expires_at && new Date(profile.expires_at) < new Date()) {
    await admin.from('profiles').update(
      { plan: 'free', daily_limit: 200, expires_at: null },
      { filter: { id: `eq.${user.id}` } }
    );
    profile.plan = 'free';
    profile.daily_limit = 200;
    profile.expires_at = null;
  }

  return { user, profile, token };
}

/**
 * Admin gate. Add ADMIN_EMAILS="a@x.com,b@x.com" in Cloudflare env.
 * Used by /api/payment/admin.
 */
export function requireAdmin(request, env) {
  const adminList = (env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  if (adminList.length === 0) {
    const err = new Error('Admin access not configured');
    err.code = 'ADMIN_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  return async () => {
    const { user } = await requireUser(request, env);
    if (!adminList.includes((user.email || '').toLowerCase())) {
      const err = new Error('Forbidden: admin only');
      err.code = 'FORBIDDEN';
      err.status = 403;
      throw err;
    }
    return user;
  };
}

/** Convert our typed errors into a JSON Response. */
export function errorResponse(err) {
  const status = err.status || 500;
  return new Response(JSON.stringify({
    error: err.message || 'Internal Server Error',
    code: err.code || 'INTERNAL',
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
