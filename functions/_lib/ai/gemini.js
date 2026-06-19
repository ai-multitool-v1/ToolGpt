/**
 * functions/_lib/ai/gemini.js
 * ----------------------------------------------------------------------------
 * Google Gemini API client (Pro plan).
 *
 * Endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=API_KEY
 *
 * Gemini's request/response shape is different from OpenAI's — we adapt:
 *   OpenAI:  messages = [{role:'user'|'assistant'|'system', content}]
 *   Gemini:  contents  = [{role:'user'|'model', parts:[{text}]}]
 *            systemInstruction = { parts:[{text}] }  (for system role)
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * @param {Object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.model='gemini-1.5-flash']
 * @param {Array<{role:string, content:string}>} opts.messages
 * @param {number} [opts.temperature=0.9]
 * @param {number} [opts.maxTokens=2048]
 */
export async function callGemini({ apiKey, model = 'gemini-1.5-flash', messages, temperature = 0.9, maxTokens = 2048 }) {
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY not configured');
    err.code = 'PROVIDER_MISSING_KEY';
    throw err;
  }

  // Convert messages to Gemini's contents[] + systemInstruction.
  const systemParts = [];
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push({ text: m.content });
      continue;
    }
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    });
  }

  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      topP: 0.95,
    },
  };
  if (systemParts.length) {
    body.systemInstruction = { parts: systemParts };
  }

  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45_000);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const err = new Error(`Gemini network error: ${e.message}`);
    err.code = 'PROVIDER_NETWORK';
    throw err;
  }
  clearTimeout(t);

  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`Gemini HTTP ${res.status}`);
    err.code = res.status >= 500 ? 'PROVIDER_5XX' : 'PROVIDER_4XX';
    err.status = res.status;
    err.body = txt;
    throw err;
  }

  const data = await res.json();
  const cand = data.candidates?.[0];
  const content = cand?.content?.parts?.map(p => p.text).join('\n') ?? '';

  // Gemini returns usageMetadata instead of usage.
  const u = data.usageMetadata || {};

  return {
    content,
    usage: {
      inputTokens: u.promptTokenCount ?? 0,
      outputTokens: u.candidatesTokenCount ?? 0,
    },
    model,
    raw: data,
  };
}
