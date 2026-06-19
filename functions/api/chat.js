/**
 * functions/api/chat.js
 * ----------------------------------------------------------------------------
 * POST /api/chat
 *
 * Body: { messages: [{role, content}], temperature?, maxTokens? }
 * Auth: Required (Bearer token or sb-access-token cookie).
 *
 * Flow:
 *   1. Verify Supabase session server-side.
 *   2. Load profile; reject if banned / expired / unverified.
 *   3. Check daily token quota.
 *   4. Estimate input tokens (for pre-flight quota check).
 *   5. Route to AI provider based on plan (free=Groq+fallback, pro=Gemini).
 *   6. Use the provider's real usage counters; fall back to estimate.
 *   7. Save user message + assistant reply to chat_history.
 *   8. Record token_usage; bump profiles.used_tokens.
 *   9. Return the assistant's content + new quota snapshot.
 *
 * NOTE: We NEVER trust a `model` field from the client. The plan in the DB
 * is the sole authority. See _lib/ai/router.js.
 */

import { requireUser, errorResponse } from '../_lib/auth.js';
import { parseJson, cleanString, corsHeaders } from '../_lib/security.js';
import { checkQuota, recordUsage, estimateTokens } from '../_lib/tokens.js';
import { routeChat } from '../_lib/ai/router.js';
import { createClient } from '../_lib/supabase.js';

export async function onRequestPost({ request, env }) {
  try {
    // 1. Auth + profile
    const { user, profile } = await requireUser(request, env);

    // 2. Parse + validate body
    const body = await parseJson(request, 256 * 1024);
    let messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      const err = new Error('messages[] is required');
      err.status = 400; err.code = 'BAD_REQUEST'; throw err;
    }

    // Sanitise + cap each message. Max 50 turns, 16k chars per message.
    messages = messages
      .slice(-50)
      .map(m => ({
        role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user',
        content: cleanString(m.content, 16_000),
      }))
      .filter(m => m.content.length > 0);

    if (messages.length === 0) {
      const err = new Error('No valid messages after sanitisation');
      err.status = 400; err.code = 'BAD_REQUEST'; throw err;
    }

    // 3. Quota check (pre-flight, using input estimate)
    const inputEstimate = messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    const quota = checkQuota(profile);
    if (!quota.allowed) {
      return new Response(JSON.stringify({
        error: 'Daily token limit reached. Upgrade to Pro for more.',
        code: 'QUOTA_EXCEEDED',
        quota,
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
      });
    }

    // 4. Call the AI router (plan-based, server-side)
    let result;
    try {
      result = await routeChat(env, profile, messages, {
        temperature: body.temperature,
        maxTokens:   body.maxTokens,
      });
    } catch (aiErr) {
      if (aiErr.code === 'ULTRA_NOT_AVAILABLE') {
        return new Response(JSON.stringify({
          error: aiErr.message,
          code: aiErr.code,
        }), {
          status: aiErr.status || 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
        });
      }
      console.error('[chat] AI error', aiErr);
      return new Response(JSON.stringify({
        error: 'AI provider unavailable. Please try again.',
        code: 'AI_UNAVAILABLE',
        detail: aiErr.message,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
      });
    }

    // 5. Real usage if provider returned it; otherwise estimate.
    const inputTokens  = result.usage.inputTokens  || inputEstimate;
    const outputTokens = result.usage.outputTokens || estimateTokens(result.content);

    // 6. Persist chat history (user msg + assistant reply) + token usage.
    const admin = createClient(env, 'service');
    const now = new Date().toISOString();
    await admin.from('chat_history').insert([
      { user_id: user.id, role: 'user',      message: messages[messages.length - 1].content, model: result.model, tokens_used: inputTokens,  created_at: now },
      { user_id: user.id, role: 'assistant', message: result.content,                        model: result.model, tokens_used: outputTokens, created_at: new Date().toISOString() },
    ]);

    await recordUsage(env, { userId: user.id, inputTokens, outputTokens, model: result.model });

    // 7. Return result + refreshed quota snapshot.
    const newQuota = checkQuota({ ...profile, used_tokens: profile.used_tokens + inputTokens + outputTokens });

    return new Response(JSON.stringify({
      content: result.content,
      model: result.model,
      provider: result.provider,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      quota: newQuota,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// Block GETs explicitly.
export function onRequestGet() {
  return new Response(JSON.stringify({ error: 'Method Not Allowed', code: 'METHOD' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'POST' },
  });
}
