/**
 * functions/_lib/supabase.js
 * ----------------------------------------------------------------------------
 * Thin Supabase REST client for Cloudflare Workers.
 *
 * Why not @supabase/supabase-js?
 *   - It pulls in `ws` and Node polyfills that bloat the Worker bundle.
 *   - We only need PostgREST (data) + GoTrue (auth) — both are plain HTTP.
 *
 * Two clients are exposed:
 *   - createAnonClient()  -> uses SUPABASE_ANON_KEY, respects RLS
 *   - createServiceClient() -> uses SUPABASE_SERVICE_ROLE_KEY, bypasses RLS
 *
 * The SERVICE_ROLE key MUST NEVER be shipped to the browser. It lives only
 * in Cloudflare env vars and is used by these server-side functions.
 */

const SUPABASE_URL_KEY = 'SUPABASE_URL';
const ANON_KEY = 'SUPABASE_ANON_KEY';
const SERVICE_KEY = 'SUPABASE_SERVICE_ROLE_KEY';

/**
 * Validate that the required env vars exist. Fail fast — never silently
 * fall back to a public key where a service key is required.
 */
function assertEnv(env) {
  if (!env?.[SUPABASE_URL_KEY])   throw new Error('Missing SUPABASE_URL');
  if (!env?.[ANON_KEY])           throw new Error('Missing SUPABASE_ANON_KEY');
  if (!env?.[SERVICE_KEY])        throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
}

/**
 * Build a fetch-powered PostgREST + GoTrue client.
 *
 * @param {Object} env  Cloudflare env bindings
 * @param {'anon'|'service'} mode
 * @param {string|null} accessToken  Optional user JWT to forward (for RLS-evaluated calls)
 */
export function createClient(env, mode = 'service', accessToken = null) {
  assertEnv(env);

  const baseUrl = env[SUPABASE_URL_KEY].replace(/\/+$/, '');
  const apiKey  = mode === 'service' ? env[SERVICE_KEY] : env[ANON_KEY];

  /** Centralised fetch with timeout + JSON parsing. */
  async function req(path, { method = 'GET', body, query, headers = {} } = {}) {
    const url = new URL(baseUrl + path);
    if (query) for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }

    const finalHeaders = {
      'apikey': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...headers,
    };
    if (mode === 'service') finalHeaders['Authorization'] = `Bearer ${env[SERVICE_KEY]}`;
    else if (accessToken)   finalHeaders['Authorization'] = `Bearer ${accessToken}`;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    let res;
    try {
      res = await fetch(url.toString(), {
        method,
        headers: finalHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }

    const text = await res.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = text; }
    }
    if (!res.ok) {
      const msg = (json && (json.message || json.error || json)) || `HTTP ${res.status}`;
      const err = new Error(`Supabase ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  }

  return {
    /** PostgREST query builder (minimal). */
    from(table) {
      return {
        select(columns = '*', { filter, limit, order, single, range } = {}) {
          const query = { select: columns };
          if (limit)  query.limit = limit;
          if (order)  query.order = order;
          if (range)  { query['offset'] = range[0]; query['limit'] = range[1] - range[0] + 1; }
          if (filter) for (const [k, v] of Object.entries(filter)) query[k] = v;
          return req(`/rest/v1/${table}`, { query }).then(r => single ? (Array.isArray(r) ? r[0] : r) : r);
        },
        insert(rows, { returning = 'representation', upsert = false } = {}) {
          const headers = { 'Prefer': `return=${returning}` };
          if (upsert) headers['Prefer'] += ',resolution=merge-duplicates';
          return req(`/rest/v1/${table}`, { method: 'POST', body: rows, query: upsert ? { on_conflict: 'id' } : undefined, headers });
        },
        update(patch, { filter, returning = 'representation' } = {}) {
          const headers = { 'Prefer': `return=${returning}` };
          const query = filter || {};
          return req(`/rest/v1/${table}`, { method: 'PATCH', body: patch, query, headers });
        },
        delete({ filter } = {}) {
          return req(`/rest/v1/${table}`, { method: 'DELETE', query: filter || {} });
        },
      };
    },

    /** GoTrue: getUser verifies a JWT server-side. NEVER trust the client claim. */
    auth: {
      async getUser(jwt) {
        if (!jwt) return { data: { user: null }, error: new Error('No access token') };
        return req('/auth/v1/user', { headers: { Authorization: `Bearer ${jwt}` } })
          .then(user => ({ data: { user }, error: null }))
          .catch(error => ({ data: { user: null }, error }));
      },
    },

    /** RPC call. */
    rpc(fn, args = {}) {
      return req(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
    },
  };
}
