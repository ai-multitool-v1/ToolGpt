/**
 * functions/_lib/ai/router.js
 * ----------------------------------------------------------------------------
 * Plan-based model router. THE most security-critical file in the system.
 *
 * RULES (per spec):
 *   plan == 'free'  -> Groq llama-3.1-8b-instant
 *                      fallback: qwen3 (via Groq's openai-compatible endpoint)
 *   plan == 'pro'   -> Gemini Flash
 *   plan == 'ultra' -> REJECT with "Ultra Coming Soon 🚀"
 *
 * The browser NEVER tells us which model to use. We ignore any `model`
 * field in the request body. The plan in the DB is the sole authority.
 *
 * Returns:
 *   { content, usage, model, provider }
 * Throws on hard failure.
 */

import { callGroq } from './groq.js';
import { callGemini } from './gemini.js';

// Free-plan model + fallback (both served by Groq's OpenAI-compatible API).
const FREE_PRIMARY  = 'llama-3.1-8b-instant';
const FREE_FALLBACK = 'qwen3-32b'; // adjust to whatever Groq currently exposes

// Pro-plan model.
const PRO_MODEL = 'gemini-1.5-flash';

/**
 * Route a chat completion based on the user's plan.
 *
 * @param {Object} env
 * @param {{ plan: 'free'|'pro'|'ultra' }} profile
 * @param {Array<{role,content}>} messages
 * @param {Object} [opts]  { temperature, maxTokens }
 */
export async function routeChat(env, profile, messages, opts = {}) {
  const { temperature, maxTokens } = opts;

  // ULTRA is not yet implemented.
  if (profile.plan === 'ultra') {
    const err = new Error('Ultra Coming Soon 🚀');
    err.code = 'ULTRA_NOT_AVAILABLE';
    err.status = 404;
    throw err;
  }

  if (profile.plan === 'pro') {
    const r = await callGemini({
      apiKey: env.GEMINI_API_KEY,
      model: PRO_MODEL,
      messages,
      temperature: temperature ?? 0.9,
      maxTokens:   maxTokens ?? 4096,
    });
    return { ...r, provider: 'gemini' };
  }

  // Free plan — Groq with qwen3 fallback.
  try {
    const r = await callGroq({
      apiKey: env.GROQ_API_KEY,
      model: FREE_PRIMARY,
      messages,
      temperature: temperature ?? 0.7,
      maxTokens:   maxTokens ?? 1024,
    });
    return { ...r, provider: 'groq' };
  } catch (primaryErr) {
    console.warn(`[router] Groq primary failed (${primaryErr.code}); trying fallback ${FREE_FALLBACK}`);
    // 4xx (bad request / auth) is not retriable with a different model.
    if (primaryErr.code === 'PROVIDER_4XX' && primaryErr.status !== 429) {
      throw primaryErr;
    }
    // 5xx, rate-limit, or network — try fallback.
    const r = await callGroq({
      apiKey: env.GROQ_API_KEY,
      model: FREE_FALLBACK,
      messages,
      temperature: temperature ?? 0.7,
      maxTokens:   maxTokens ?? 1024,
    });
    return { ...r, provider: 'groq-fallback' };
  }
}
