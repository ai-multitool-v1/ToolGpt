/**
 * functions/api/payment/admin.js
 * ----------------------------------------------------------------------------
 * Admin-only endpoints to approve / reject payment requests.
 *
 * POST   /api/payment/admin   { action: 'approve'|'reject', requestId, notes? }
 * GET    /api/payment/admin   -> list pending requests (admin queue)
 *
 * Auth: must be logged in + email in ADMIN_EMAILS env var.
 *
 * On approve:
 *   - payment_requests.status = 'approved'
 *   - payment_requests.approved_at = now()
 *   - profiles.plan = 'pro'
 *   - profiles.daily_limit = 10000   (Pro gets 50x free quota)
 *   - profiles.expires_at = now() + 30 days
 *   - Send Telegram confirmation
 *
 * On reject:
 *   - payment_requests.status = 'rejected'
 *   - Send Telegram rejection notice
 */

import { requireUser, errorResponse } from '../../_lib/auth.js';
import { parseJson, corsHeaders } from '../../_lib/security.js';
import { createClient } from '../../_lib/supabase.js';
import { sendTelegram, buildStatusMessage } from '../../_lib/telegram.js';

const PRO_DAILY_LIMIT = 10000;
const PRO_DURATION_DAYS = 30;

export async function onRequestGet({ request, env }) {
  try {
    await assertAdmin(request, env);
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'pending';
    const admin = createClient(env, 'service');

    const filter = { order: 'requested_at.desc', limit: 100 };
    if (['pending', 'approved', 'rejected'].includes(status)) filter.status = `eq.${status}`;

    const rows = await admin.from('payment_requests').select(
      'id,user_id,email,method,amount,trx_id,status,requested_at,approved_at,notes',
      { filter }
    );

    return new Response(JSON.stringify({ requests: rows || [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    await assertAdmin(request, env);
    const body = await parseJson(request, 8 * 1024);

    const action = body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : null;
    if (!action) {
      const err = new Error('action must be approve or reject');
      err.status = 400; err.code = 'BAD_REQUEST'; throw err;
    }
    const requestId = String(body.requestId || '').trim();
    if (!requestId) {
      const err = new Error('requestId is required');
      err.status = 400; err.code = 'BAD_REQUEST'; throw err;
    }

    const admin = createClient(env, 'service');

    // Load the request.
    const reqs = await admin.from('payment_requests').select(
      'id,user_id,email,method,amount,trx_id,status,requested_at',
      { filter: { id: `eq.${requestId}`, limit: 1 } }
    );
    const req = Array.isArray(reqs) ? reqs[0] : null;
    if (!req) {
      const err = new Error('Payment request not found');
      err.status = 404; err.code = 'NOT_FOUND'; throw err;
    }
    if (req.status !== 'pending') {
      const err = new Error(`Request already ${req.status}`);
      err.status = 409; err.code = 'CONFLICT'; throw err;
    }

    if (action === 'approve') {
      const expiresAt = new Date(Date.now() + PRO_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const approvedAt = new Date().toISOString();

      // 1. Update payment_requests row.
      await admin.from('payment_requests').update(
        { status: 'approved', approved_at: approvedAt, notes: body.notes || null },
        { filter: { id: `eq.${requestId}` } }
      );

      // 2. Upgrade profile to Pro.
      await admin.from('profiles').update(
        {
          plan: 'pro',
          daily_limit: PRO_DAILY_LIMIT,
          used_tokens: 0,           // reset daily counter on upgrade
          expires_at: expiresAt,
        },
        { filter: { id: `eq.${req.user_id}` } }
      );

      // 3. Telegram confirmation.
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        sendTelegram(env, buildStatusMessage({
          email: req.email,
          status: 'approved',
          plan: 'pro',
          expiresAt,
        })).catch(e => console.error('[telegram]', e.message));
      }

      return new Response(JSON.stringify({
        ok: true,
        message: 'Payment approved; user upgraded to Pro.',
        expiresAt,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
      });
    }

    // Reject.
    await admin.from('payment_requests').update(
      { status: 'rejected', notes: body.notes || null },
      { filter: { id: `eq.${requestId}` } }
    );

    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      sendTelegram(env, buildStatusMessage({
        email: req.email,
        status: 'rejected',
      })).catch(e => console.error('[telegram]', e.message));
    }

    return new Response(JSON.stringify({ ok: true, message: 'Payment rejected.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

async function assertAdmin(request, env) {
  const { user } = await requireUser(request, env);
  const adminList = (env.ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (adminList.length === 0) {
    const err = new Error('Admin access not configured (set ADMIN_EMAILS)');
    err.status = 503; err.code = 'ADMIN_NOT_CONFIGURED'; throw err;
  }
  if (!adminList.includes((user.email || '').toLowerCase())) {
    const err = new Error('Forbidden: admin only');
    err.status = 403; err.code = 'FORBIDDEN'; throw err;
  }
  return user;
}
