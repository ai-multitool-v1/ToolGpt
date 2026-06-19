/**
 * public/js/config.js
 * ----------------------------------------------------------------------------
 * PUBLIC, browser-safe configuration.
 *
 * ⚠️ SECURITY: This file is shipped to the browser. It MUST contain only
 * values that are safe to expose. NO API keys, NO service-role keys, NO
 * secrets. Anything secret lives in Cloudflare env vars and is read by the
 * functions/api/* endpoints, never here.
 *
 * The SUPABASE_ANON_KEY is designed to be public — it's protected by RLS,
 * not by secrecy. See supabase/schema.sql.
 */

export const CONFIG = Object.freeze({
  // Supabase project URL + anon key (safe to expose, protected by RLS).
  SUPABASE_URL:      'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',

  // App branding (used in OAuth redirect).
  APP_NAME: 'ToolGpt',
  APP_URL:  'https://your-app.pages.dev',

  // Plan metadata — used ONLY for UI display. The server enforces actual
  // plan limits; these numbers must match the backend's defaults.
  PLANS: Object.freeze({
    free:  { name: 'Free',  dailyLimit: 200,  model: 'Llama 3.1 8B Instant', provider: 'Groq'   },
    pro:   { name: 'Pro',   dailyLimit: 10000, model: 'Gemini 1.5 Flash',     provider: 'Google' },
    ultra: { name: 'Ultra', dailyLimit: 0,    model: 'Coming Soon',          provider: 'TBD'    },
  }),

  // ToolGpt persona — ethical hacking & cybersecurity expert assistant.
  // The system prompt sets the assistant's role: a senior penetration tester
  // and ethical hacking educator. Responses emphasise legality, scope, and
  // authorization before any offensive technique.
  PERSONA: Object.freeze({
    name: 'ToolGpt',
    tagline: 'Pentesting · Ethical Hacking · Cybersecurity',
    systemPrompt: [
      'You are ToolGpt, a senior penetration tester and ethical-hacking educator.',
      'You help security professionals, students, and developers understand offensive and defensive security.',
      '',
      'Hard rules:',
      '1. NEVER assist with unauthorized access, malware intended to cause harm, or attacks against systems you have not been explicitly authorized to test.',
      '2. Always confirm scope and authorization before discussing offensive techniques.',
      '3. Frame offensive techniques (recon, enumeration, exploitation, post-exploitation) in a controlled-lab / CTF / authorized-engagement context.',
      '4. Prefer educational framing: explain WHY a vulnerability exists, HOW to detect it, and HOW to remediate it.',
      '5. Use precise security terminology (CVE, OWASP, MITRE ATT&CK, CVSS) when relevant.',
      '6. For code, include comments noting the authorized-use assumption.',
      '7. If a request is clearly malicious (targeting a specific real-world system without authorization), refuse and explain why.',
      '',
      'Style: concise, technical, well-structured with code blocks. Use Markdown.',
    ].join('\n'),
  }),

  // Pricing (display only; server is source of truth).
  PRICES: Object.freeze({
    pro: 99, // BDT
  }),

  // bKash / Nagad merchant numbers — safe to expose, they're payment destinations.
  PAYMENT_DESTINATIONS: Object.freeze({
    bkash: { number: '01XXXXXXXXX', type: 'Personal' },
    nagad: { number: '01XXXXXXXXX', type: 'Personal' },
  }),

  // Chat UI defaults.
  CHAT: Object.freeze({
    maxHistoryTurns: 20,
    systemPrompt: 'You are a helpful, concise AI assistant.',
    temperature: 0.7,
  }),
});

/** Helper: detect current page. */
export function currentPage() {
  const p = window.location.pathname.split('/').pop() || 'index.html';
  return p.startsWith('login') ? 'auth' : 'app';
}
