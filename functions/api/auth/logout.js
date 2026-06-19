/**
 * functions/api/auth/logout.js
 * ----------------------------------------------------------------------------
 * POST /api/auth/logout
 *
 * Calls Supabase GoTrue /logout?global=true to invalidate the JWT server-side
 * and clear the sb-access-token cookie.
 *
 * The frontend also clears its local session, but server-side signout is the
 * source of truth — without it the JWT would remain valid until expiry.
 */

import { corsHeaders, parseJson } from '../../_lib/security.js';
import { extractToken } from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const token = extractToken(request);
  const url = `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/logout?global=true`;

  if (token) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': env.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
      });
    } catch (e) {
      console.warn('[logout] supabase call failed', e.message);
    }
  }

  // Clear the cookie. Note SameSite=None + Secure so it works cross-origin
  // when the API and frontend are on different domains. If they're same-site,
  // consider tightening to SameSite=Lax.
  const cookie = 'sb-access-token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None';

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
      ...corsHeaders(request, env),
    },
  });
}

export async function onRequestGet({ request, env }) {
  // Convenience: also allow GET for easy redirect-after-logout.
  return onRequestPost({ request, env });
}
