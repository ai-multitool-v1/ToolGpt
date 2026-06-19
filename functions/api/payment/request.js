/**
 * functions/api/payment/request.js
 * ----------------------------------------------------------------------------
 * POST /api/payment/request
 *
 * Body: { method: 'bkash'|'nagad', amount: number, trxId: string, email?: string }
 *
 * Flow:
 *   1. Auth — must be a logged-in verified user.
 *   2. Validate: method, amount (>0), trxId format.
 *   3. Insert into payment_requests with status='pending'.
 *   4. Fire Telegram notification (async, non-blocking).
 *   5. Return the new request row.
 *
 * The admin approves via /api/payment/admin — that endpoint sets
 * status='approved', plan='pro', expires_at=+30d, and notifies the user.
 */

import { requireUser, errorResponse } from '../../_lib/auth.js';
import { parseJson, corsHeaders, isValidTrxId, isValidEmail, cleanString } from '../../_lib/security.js';
import { createClient } from '../../_lib/supabase.js';
import { sendTelegram, buildPaymentMessage } from '../../_lib/telegram.js';

// Pricing table — kept server-side so the client can't change it.
const PRICES = {
  pro: 99,    // BDT
  // ultra: 499, // not yet
};

export async function onRequestPost({ request, env }) {
  try {
    const { user, profile } = await requireUser(request, env);
    const body = await parseJson(request, 8 * 1024);

    const method = body.method === 'bkash' ? 'bkash' : body.method === 'nagad' ? 'nagad' : null;
    if (!method) {
      const err = new Error('method must be bkash or nagad');
      err.status = 400; err.code = 'BAD_REQUEST'; throw err;
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      const err = new Error('amount must be a positive number');
      err.status = 400; err.code = 'BAD_REQUEST'; throw err;
    }
    // Reject obvious mismatches (admin does final verification).
    if (amount < PRICES.pro * 0.9) {
      const err = new Error(`amount looks too low; expected at least ${PRICES.pro} BDT`);
      err.status = 400; err.code = 'BAD_AMOUNT'; throw err;
    }

    const trxId = cleanString(body.trxId, 32);
    if (!isValidTrxId(trxId)) {
      const err = new Error('trxId must be 6–20 alphanumeric characters');
      err.status = 400; err.code = 'BAD_TRX'; throw err;
    }

    const email = (body.email || user.email || '').trim();
    if (!isValidEmail(email)) {
      const err = new Error('valid email is required');
      err.status = 400; err.code = 'BAD_EMAIL'; throw err;
    }

    // Prevent duplicate pending requests from the same user (debounce).
    const admin = createClient(env, 'service');
    const existing = await admin.from('payment_requests').select(
      'id,status,requested_at',
      { filter: { user_id: `eq.${user.id}`, status: 'eq.pending', order: 'requested_at.desc', limit: 1 } }
    );
    if (existing && existing.length) {
      const ageMs = Date.now() - new Date(existing[0].requested_at).getTime();
      if (ageMs < 5 * 60 * 1000) {
        const err = new Error('You already have a pending request. Please wait 5 minutes before submitting another.');
        err.status = 429; err.code = 'DUPLICATE'; throw err;
      }
    }

    // Insert the pending request.
    const inserted = await admin.from('payment_requests').insert({
      user_id: user.id,
      email,
      method,
      amount,
      trx_id: trxId,
      status: 'pending',
    });
    const row = Array.isArray(inserted) ? inserted[0] : inserted;

    // Fire Telegram notification — don't block on it.
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      ctxWaitUntil(env, sendTelegram(env, buildPaymentMessage({
        email,
        method,
        amount,
        trxId,
        userId: user.id,
        requestId: row?.id,
      })).catch(e => console.error('[telegram]', e.message)));
    }

    return new Response(JSON.stringify({
      ok: true,
      request: row,
      message: 'Payment request submitted. Admin will verify within a few hours.',
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * GET /api/payment/request
 * Returns the user's own payment requests (for the "My Plans" page).
 */
export async function onRequestGet({ request, env }) {
  try {
    const { user } = await requireUser(request, env);
    const admin = createClient(env, 'service');
    const rows = await admin.from('payment_requests').select(
      'id,method,amount,trx_id,status,requested_at,approved_at',
      { filter: { user_id: `eq.${user.id}`, order: 'requested_at.desc', limit: 50 } }
    );
    return new Response(JSON.stringify({ requests: rows || [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Cloudflare's context.waitUntil isn't passed to Pages Function handlers
 * by default — but `env` may carry it. If unavailable, we just await.
 */
function ctxWaitUntil(env, promise) {
  if (typeof env?.waitUntil === 'function') env.waitUntil(promise);
  else promise.catch(() => {});
}
