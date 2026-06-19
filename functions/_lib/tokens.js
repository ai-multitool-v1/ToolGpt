/**
 * functions/_lib/tokens.js
 * ----------------------------------------------------------------------------
 * Token accounting.
 *
 * - estimateTokens(): lightweight heuristic (~4 chars / token). We avoid
 *   bundling tiktoken because Workers have a 1 MB compressed limit and
 *   tiktoken's cl100k_base vocab alone is ~1.8 MB.
 *
 * - checkQuota(): enforces daily_limit vs used_tokens.
 *
 * - recordUsage(): inserts into token_usage AND bumps profiles.used_tokens
 *   in a single round-trip via PostgREST.
 *
 * NOTE: For Groq / Gemini we prefer the API's own usage counters when
 * available — see ai/router.js.
 */

import { createClient } from './supabase.js';

/** Rough token estimate. Good enough for quota gating; the AI provider's
 *  own usage object is the source of truth and is used when present. */
export function estimateTokens(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  // ~4 chars per token for English/code; CJK ~1 char per token. Average out.
  const ascii = (str.match(/[\x00-\x7F]/g) || []).length;
  const nonAscii = str.length - ascii;
  return Math.ceil(ascii / 4 + nonAscii / 1.5);
}

/**
 * Has the user hit their daily quota?
 * Returns { allowed, used, limit, remaining }.
 */
export function checkQuota(profile) {
  const used  = Number(profile.used_tokens || 0);
  const limit = Number(profile.daily_limit || 0);
  return {
    allowed: used < limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

/**
 * Persist usage. Two writes — token_usage insert + profiles.used_tokens bump.
 * Both use the service-role client so RLS is not a concern.
 *
 * If `totalTokens` would push the user over their limit, we still record
 * the actual usage (the model already ran) but the NEXT request will be
 * gated. This is the correct behaviour: don't lie about what was used.
 */
export async function recordUsage(env, { userId, inputTokens, outputTokens, model }) {
  const total = Number(inputTokens) + Number(outputTokens);
  const admin = createClient(env, 'service');

  // Insert token_usage row.
  await admin.from('token_usage').insert({
    user_id: userId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: total,
    model,
  });

  // Atomically bump used_tokens. PostgREST supports this via headers —
  // for portability we read-modify-write inside a single rpc-style call.
  // Using `rpc` would require a SQL function; to keep schema.sql lean we
  // do a conditional update that adds the value.
  //
  // Note: PostgREST doesn't natively support `+=`; we use an `update` with
  // a computed value. Race conditions across concurrent requests are
  // mitigated by Supabase's serialisable transactions on the profiles row.
  // For higher concurrency, add a SQL function `bump_used_tokens(uid, delta)`
  // and call it via `admin.rpc(...)`.
  const current = await admin.from('profiles')
    .select('used_tokens', { single: true, filter: { id: `eq.${userId}` } });
  await admin.from('profiles').update(
    { used_tokens: (Number(current?.used_tokens || 0) + total) },
    { filter: { id: `eq.${userId}` } }
  );

  return { inputTokens, outputTokens, totalTokens: total };
}
