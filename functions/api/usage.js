/**
 * functions/api/usage.js
 * ----------------------------------------------------------------------------
 * GET /api/usage
 *
 * Returns:
 *   - today's token usage (sum of token_usage rows in the last 24h)
 *   - profile quota snapshot (used / limit / remaining)
 *   - 7-day usage history for chart rendering
 */

import { requireUser, errorResponse } from '../_lib/auth.js';
import { corsHeaders } from '../_lib/security.js';
import { createClient } from '../_lib/supabase.js';

export async function onRequestGet({ request, env }) {
  try {
    const { user, profile } = await requireUser(request, env);
    const admin = createClient(env, 'service');

    // Last 24h usage sum
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = await admin.from('token_usage').select(
      'input_tokens,output_tokens,total_tokens,model,created_at',
      { filter: { user_id: `eq.${user.id}`, created_at: `gte.${since}`, order: 'created_at.desc', limit: 1000 } }
    );

    const today = (recent || []).reduce((acc, r) => ({
      input: acc.input + Number(r.input_tokens),
      output: acc.output + Number(r.output_tokens),
      total: acc.total + Number(r.total_tokens),
    }), { input: 0, output: 0, total: 0 });

    // 7-day bucketed history
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const last7 = await admin.from('token_usage').select(
      'total_tokens,created_at',
      { filter: { user_id: `eq.${user.id}`, created_at: `gte.${since7}`, order: 'created_at.asc', limit: 5000 } }
    );

    const buckets = new Map();
    for (const r of (last7 || [])) {
      const day = r.created_at.slice(0, 10);
      buckets.set(day, (buckets.get(day) || 0) + Number(r.total_tokens));
    }
    const daily = Array.from(buckets.entries()).map(([day, total]) => ({ day, total }));

    return new Response(JSON.stringify({
      today,
      daily,
      quota: {
        used: profile.used_tokens,
        limit: profile.daily_limit,
        remaining: Math.max(0, profile.daily_limit - profile.used_tokens),
        plan: profile.plan,
        expiresAt: profile.expires_at,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
