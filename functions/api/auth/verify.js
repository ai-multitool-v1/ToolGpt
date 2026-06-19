/**
 * functions/api/auth/verify.js
 * ----------------------------------------------------------------------------
 * GET /api/auth/verify
 *
 * Called by the frontend on every page load to:
 *   1. Confirm the user's session is valid (server-side check).
 *   2. Hydrate the profile (plan, quota, etc.) for UI state.
 *
 * Returns 200 { user, profile } on success, 401 on invalid session.
 */

import { requireUser, errorResponse } from '../../_lib/auth.js';
import { corsHeaders } from '../../_lib/security.js';

export async function onRequestGet({ request, env }) {
  try {
    const { user, profile } = await requireUser(request, env);
    return new Response(JSON.stringify({
      user: {
        id: user.id,
        email: user.email,
        emailVerified: !!user.email_confirmed_at,
        provider: user.app_metadata?.provider || 'email',
        createdAt: user.created_at,
      },
      profile,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
