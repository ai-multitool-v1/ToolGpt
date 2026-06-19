/**
 * functions/api/profile.js
 * ----------------------------------------------------------------------------
 * GET  /api/profile          -> read own profile
 * PATCH /api/profile         -> update own profile (username, avatar_url only)
 *
 * CRITICAL: the client CANNOT change plan / daily_limit / used_tokens /
 * is_banned / expires_at. Those columns are revoked at the DB level
 * (see supabase/schema.sql §8) AND filtered here.
 */

import { requireUser, errorResponse } from '../_lib/auth.js';
import { parseJson, cleanString, corsHeaders } from '../_lib/security.js';
import { createClient } from '../_lib/supabase.js';

const SAFE_FIELDS = ['username', 'avatar_url'];

export async function onRequestGet({ request, env }) {
  try {
    const { profile } = await requireUser(request, env);
    return new Response(JSON.stringify({ profile }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const { user, profile } = await requireUser(request, env);
    const body = await parseJson(request, 8 * 1024);

    // Allow-list patch: silently drop anything not in SAFE_FIELDS.
    const patch = {};
    if (typeof body.username === 'string') {
      patch.username = cleanString(body.username, 64) || null;
    }
    if (typeof body.avatar_url === 'string') {
      // Only allow https URLs or null. Block data: URIs (XSS vector).
      const u = body.avatar_url.trim();
      if (!u) patch.avatar_url = null;
      else if (/^https:\/\/[^"' ]+$/i.test(u)) patch.avatar_url = u.slice(0, 1024);
    }

    if (Object.keys(patch).length === 0) {
      return new Response(JSON.stringify({ profile }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
      });
    }

    const admin = createClient(env, 'service');
    const updated = await admin.from('profiles').update(patch, {
      filter: { id: `eq.${user.id}` },
    });

    return new Response(JSON.stringify({ profile: Array.isArray(updated) ? updated[0] : updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
