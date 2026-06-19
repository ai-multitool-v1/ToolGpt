/**
 * functions/api/cron/check-expiry.js
 * ----------------------------------------------------------------------------
 * GET /api/cron/check-expiry
 *
 * Scheduled job — runs hourly. Finds all `pro` users whose `expires_at` has
 * passed and downgrades them to `free` (resets daily_limit to 200 and
 * clears expires_at).
 *
 * Auth: Bearer CRON_SECRET.
 *
 * The chat endpoint also checks expiry on every request (defensive), but
 * running this cron ensures expired Pro users get their UI refreshed even
 * if they don't send a message.
 */

import { createClient } from '../../_lib/supabase.js';
import { corsHeaders } from '../../_lib/security.js';

export async function onRequestGet({ request, env }) {
  const expected = env.CRON_SECRET;
  if (!expected) {
    return new Response(JSON.stringify({ error: 'CRON_SECRET not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }
  const auth = request.headers.get('Authorization') || '';
  if (auth !== `Bearer ${expected}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(env, 'service');
  const nowIso = new Date().toISOString();

  // Update all pro users whose expires_at < now.
  const result = await admin.from('profiles').update(
    { plan: 'free', daily_limit: 200, expires_at: null },
    { filter: { plan: 'eq.pro', expires_at: `lt.${nowIso}` } }
  ).catch(e => { throw e; });

  return new Response(JSON.stringify({
    ok: true,
    checkedAt: nowIso,
    downgraded: Array.isArray(result) ? result.length : null,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
  });
}
