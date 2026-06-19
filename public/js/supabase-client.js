/**
 * public/js/supabase-client.js
 * ----------------------------------------------------------------------------
 * Thin Supabase client for the browser.
 *
 * Uses the @supabase/supabase-js module from a CDN (esm.sh) so we don't
 * need a build step. Loaded as an ES module via <script type="module">.
 *
 * ⚠️ Only the anon key is used here. The service-role key is NEVER loaded
 * in the browser — it lives only in Cloudflare env vars.
 */

import { CONFIG } from './config.js';

// Dynamic import from esm.sh — works in all modern browsers + CF Pages.
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');

export const supabase = createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: 'sb-auth',
    },
  }
);

/**
 * Convenience: get the current session's access token.
 * Returns null if no session.
 */
export async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session) return null;
  return data.session.access_token;
}

/**
 * Persist the access token in a cookie so Cloudflare Functions can read it
 * from `Cookie: sb-access-token=...`. We mark it SameSite=None + Secure
 * because the API may be on a different subdomain than the frontend.
 *
 * This is called automatically on session changes.
 */
export async function syncAccessTokenCookie() {
  const token = await getAccessToken();
  if (token) {
    document.cookie = `sb-access-token=${encodeURIComponent(token)}; path=/; max-age=3600; SameSite=None; Secure`;
  } else {
    document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=None; Secure';
  }
}

// Re-sync the cookie whenever the session changes (login, refresh, logout).
supabase.auth.onAuthStateChange((_event, _session) => {
  syncAccessTokenCookie().catch(() => {});
});
