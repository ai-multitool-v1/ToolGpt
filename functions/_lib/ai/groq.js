/**
 * functions/_lib/ai/groq.js
 * ----------------------------------------------------------------------------
 * Groq API client.
 *
 * Groq is OpenAI-compatible:
 *   POST https://api.groq.com/openai/v1/chat/completions
 *   { model, messages, temperature, max_tokens, stream }
 *
 * Returns a normalised shape:
 *   { content, usage: { inputTokens, outputTokens }, raw }
 *
 * Errors are thrown; the caller (router.js) decides whether to fall back.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * @param {Object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.model='llama-3.1-8b-instant']
 * @param {Array<{role:string, content:string}>} opts.messages
 * @param {number} [opts.temperature=0.7]
 * @param {number} [opts.maxTokens=1024]
 */
export async function callGroq({ apiKey, model = 'llama-3.1-8b-instant', messages, temperature = 0.7, maxTokens = 1024 }) {
  if (!apiKey) {
    const err = new Error('GROQ_API_KEY not configured');
    err.code = 'PROVIDER_MISSING_KEY';
    throw err;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);

  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const err = new Error(`Groq network error: ${e.message}`);
    err.code = 'PROVIDER_NETWORK';
    throw err;
  }
  clearTimeout(t);

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Groq HTTP ${res.status}`);
    err.code = res.status >= 500 ? 'PROVIDER_5XX' : 'PROVIDER_4XX';
    err.status = res.status;
    err.body = body;
    throw err;
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? '';

  return {
    content,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    model: data.model || model,
    raw: data,
  };
}
