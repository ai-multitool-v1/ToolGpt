/**
 * public/js/api.js
 * ----------------------------------------------------------------------------
 * HTTP client for /api/* endpoints.
 *
 * Every request automatically attaches:
 *   - Authorization: Bearer <access_token>
 *   - Cookie: sb-access-token (synced by supabase-client.js)
 *
 * If a request returns 401, we attempt ONE silent token refresh and retry.
 */

import { getAccessToken, supabase } from './supabase-client.js';

/** Build a fetch with auth headers. */
async function authedFetch(url, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...options, headers, credentials: 'include' });
}

/** Try to refresh the session once. Returns true on success. */
async function tryRefresh() {
  const { data, error } = await supabase.auth.refreshSession();
  return !error && data?.session;
}

async function apiCall(url, options = {}, { allowRetry = true } = {}) {
  let res = await authedFetch(url, options);

  // Single silent retry on 401.
  if (res.status === 401 && allowRetry) {
    const ok = await tryRefresh();
    if (ok) res = await authedFetch(url, options);
  }

  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { error: text }; }
  }

  if (!res.ok) {
    const err = new Error(body?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = body?.code;
    err.payload = body;
    throw err;
  }
  return body;
}

export const api = {
  // ----- Auth -----
  auth: {
    verify:  () => apiCall('/api/auth/verify'),
    logout:  () => apiCall('/api/auth/logout', { method: 'POST' }),
  },

  // ----- Chat -----
  chat: (messages, opts = {}) => apiCall('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, ...opts }),
  }),

  history: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiCall(`/api/history${q ? '?' + q : ''}`);
  },
  clearHistory: () => apiCall('/api/history', { method: 'DELETE' }),

  // ----- Profile & Usage -----
  profile: {
    get:    () => apiCall('/api/profile'),
    update: (patch) => apiCall('/api/profile', { method: 'PATCH', body: JSON.stringify(patch) }),
  },
  usage: () => apiCall('/api/usage'),

  // ----- Payment -----
  payment: {
    myRequests: () => apiCall('/api/payment/request'),
    submit:     (payload) => apiCall('/api/payment/request', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  },
};

// Export raw fetch for cases where we need streams later (SSE chat).
export { authedFetch };
