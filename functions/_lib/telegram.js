/**
 * functions/_lib/telegram.js
 * ----------------------------------------------------------------------------
 * Telegram Bot integration for payment-request notifications.
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN  - bot token from @BotFather
 *   TELEGRAM_CHAT_ID    - chat id to receive notifications (channel or group)
 *
 * Sends a formatted message when a user submits a bKash/Nagad payment.
 */

const TG_API = 'https://api.telegram.org/bot';

/**
 * Send a MarkdownV2-formatted message to Telegram.
 * @param {Object} env
 * @param {string} text
 */
export async function sendTelegram(env, text) {
  if (!env?.TELEGRAM_BOT_TOKEN || !env?.TELEGRAM_CHAT_ID) {
    // Soft-fail: log but don't block the payment flow.
    console.warn('[telegram] missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID — skipping');
    return { ok: false, reason: 'not_configured' };
  }

  const url = `${TG_API}${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error('[telegram] send failed:', res.status, t);
    return { ok: false, status: res.status, body: t };
  }
  return { ok: true };
}

/**
 * Build the payment-request notification message.
 * Uses HTML parse_mode (Telegram supports a safe subset).
 */
export function buildPaymentMessage({ email, method, amount, trxId, userId, requestId }) {
  return [
    '🟢 <b>New Payment Request</b>',
    '',
    `👤 <b>User:</b> <code>${escapeHtml(email)}</code>`,
    `🆔 <b>User ID:</b> <code>${userId}</code>`,
    `🧾 <b>Request ID:</b> <code>${requestId}</code>`,
    '',
    `💳 <b>Method:</b> ${method === 'bkash' ? 'bKash' : 'Nagad'}`,
    `💰 <b>Amount:</b> ${amount} BDT`,
    `🔢 <b>TRX ID:</b> <code>${escapeHtml(trxId)}</code>`,
    '',
    `⏱ <b>Status:</b> Pending — verify & approve in admin panel.`,
  ].join('\n');
}

/**
 * Build the approval/rejection notification.
 */
export function buildStatusMessage({ email, status, plan, expiresAt }) {
  const icon = status === 'approved' ? '✅' : '❌';
  const lines = [
    `${icon} <b>Payment ${status.toUpperCase()}</b>`,
    '',
    `👤 <b>User:</b> <code>${escapeHtml(email)}</code>`,
    `📊 <b>New Plan:</b> ${plan || '—'}`,
  ];
  if (status === 'approved' && expiresAt) {
    lines.push(`📅 <b>Valid Until:</b> ${new Date(expiresAt).toUTCString()}`);
  }
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
