/**
 * functions/api/cron/daily-reset.js
 * ----------------------------------------------------------------------------
 * GET /api/cron/daily-reset
 *
 * Scheduled job (Cloudflare Pages cron or external cron) that resets every
 * user's `used_tokens` to 0 once per day.
 *
 * Auth: Bearer CRON_SECRET env var (not a user JWT). Set this to a long
 * random string and configure Cloudflare's cron to call this URL with
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * In wrangler.toml:
 *   [triggers]
 *   crons = ["0 0 * * *"]   # midnight UTC daily
 *
 * Or hit it from UptimeRobot / cron-job.org with the secret header.
 */

import { createClient } from '../../_lib/supabase.js';
import { corsHeaders } from '../../_lib/security.js';

export async function onRequestGet({ request, env }) {
  // CRON_SECRET gate.
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

  // Reset used_tokens to 0 for ALL non-banned users.
  // PostgREST supports bulk PATCH with a filter — `used_tokens=gt.0` matches
  // every row that has any usage, making the update minimal.
  const result = await admin.from('profiles').update(
    { used_tokens: 0 },
    { filter: { used_tokens: 'gt.0' } }
  ).catch(e => { throw e; });

  return new Response(JSON.stringify({
    ok: true,
    resetAt: new Date().toISOString(),
    affected: Array.isArray(result) ? result.length : null,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
  });
}
