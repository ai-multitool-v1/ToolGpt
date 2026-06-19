/**
 * functions/api/history.js
 * ----------------------------------------------------------------------------
 * GET /api/history?limit=50&before=<iso>
 *
 * Returns the authenticated user's chat history, newest first.
 * Supports cursor pagination via `before`.
 */

import { requireUser, errorResponse } from '../_lib/auth.js';
import { corsHeaders } from '../_lib/security.js';
import { createClient } from '../_lib/supabase.js';

export async function onRequestGet({ request, env }) {
  try {
    const { user } = await requireUser(request, env);
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
    const before = url.searchParams.get('before'); // ISO timestamp

    const admin = createClient(env, 'service');
    const filter = { user_id: `eq.${user.id}`, order: 'created_at.desc', limit };
    if (before) filter.created_at = `lt.${before}`;

    const rows = await admin.from('chat_history').select(
      'id,role,message,model,tokens_used,created_at',
      { filter, limit }
    );

    return new Response(JSON.stringify({ history: rows || [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE /api/history
 * Clears the user's entire chat history. Per-row deletes are also allowed.
 */
export async function onRequestDelete({ request, env }) {
  try {
    const { user } = await requireUser(request, env);
    const admin = createClient(env, 'service');
    await admin.from('chat_history').delete({ filter: { user_id: `eq.${user.id}` } });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
