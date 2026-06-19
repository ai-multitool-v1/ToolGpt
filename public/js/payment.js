/**
 * public/js/payment.js
 * ----------------------------------------------------------------------------
 * Manual payment flow for bKash / Nagad.
 *
 * HTML integration contract:
 *   #payment-modal           - modal root
 *   #payment-form            - <form>
 *     #payment-method        - <select> with bkash / nagad
 *     #payment-amount        - <input type="number"> (pre-filled, read-only)
 *     #payment-trx           - <input> for transaction ID
 *     #payment-email         - <input> pre-filled from profile
 *     #payment-destination   - displays merchant number (from CONFIG)
 *     #btn-payment-submit
 *     #btn-payment-cancel
 *   #btn-upgrade             - opens the modal (wired by main.js)
 *   #my-requests-list        - lists user's prior payment requests
 *
 * Flow:
 *   User clicks "Upgrade to Pro"
 *     -> modal opens, shows merchant number + amount (99 BDT)
 *     -> user pays via bKash/Nagad app, copies TRX ID
 *     -> submits form -> POST /api/payment/request
 *     -> backend stores request + notifies admin via Telegram
 *     -> user sees "pending" status; admin approves within hours
 */

import { api } from './api.js';
import { CONFIG } from './config.js';
import { $, el, escapeHtml, fmt, toast, timeAgo, openModal, closeModal } from './ui.js';
import { sanitizeTrxId, isValidTrxId, sanitizeEmail, isValidEmail } from './sanitize.js';

let paymentProfile = null;

export function initPayment(profile) {
  paymentProfile = profile;

  $('#btn-upgrade')?.addEventListener('click', () => openModal('payment-modal'));
  $('#btn-payment-cancel')?.addEventListener('click', () => closeModal('payment-modal'));
  $('#payment-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'payment-modal') closeModal('payment-modal');
  });

  $('#payment-form')?.addEventListener('submit', onSubmit);

  $('#payment-method')?.addEventListener('change', (e) => {
    updateDestination(e.target.value);
  });

  // Load prior requests.
  loadMyRequests();
}

function openPaymentModal() {
  openModal('payment-modal');
  // Pre-fill amount + email.
  const amount = $('#payment-amount');
  if (amount) { amount.value = CONFIG.PRICES.pro; amount.readOnly = true; }
  const email = $('#payment-email');
  if (email && paymentProfile) email.value = paymentProfile.email || '';

  // Default destination.
  const method = $('#payment-method')?.value || 'bkash';
  updateDestination(method);
}

function updateDestination(method) {
  const node = $('#payment-destination');
  if (!node) return;
  const info = CONFIG.PAYMENT_DESTINATIONS[method] || CONFIG.PAYMENT_DESTINATIONS.bkash;
  node.textContent = `${method === 'bkash' ? 'bKash' : 'Nagad'} → ${info.number} (${info.type})`;
}

async function onSubmit(e) {
  e.preventDefault();
  const btn = $('#btn-payment-submit');
  if (btn) btn.disabled = true;

  // SANITIZE all fields before submission.
  const method = $('#payment-method')?.value === 'nagad' ? 'nagad' : 'bkash';
  const amount = Number($('#payment-amount')?.value || 0);
  const trxIdRaw = $('#payment-trx')?.value || '';
  const trxId = sanitizeTrxId(trxIdRaw);
  const emailRaw = $('#payment-email')?.value || '';
  const email = sanitizeEmail(emailRaw);

  // VALIDATE
  if (!Number.isFinite(amount) || amount <= 0) {
    toast('Amount must be a positive number.', 'error');
    if (btn) btn.disabled = false;
    return;
  }
  if (!isValidTrxId(trxId)) {
    toast('TRX ID must be 6-20 alphanumeric characters.', 'error');
    if (btn) btn.disabled = false;
    return;
  }
  if (!isValidEmail(email)) {
    toast('Please enter a valid email address.', 'error');
    if (btn) btn.disabled = false;
    return;
  }

  const payload = { method, amount, trxId, email };

  try {
    const res = await api.payment.submit(payload);
    toast('Payment request submitted! Admin will verify shortly.', 'success', 5000);
    closeModal();
    $('#payment-form')?.reset();
    loadMyRequests();
  } catch (err) {
    toast(err.message || 'Submission failed.', 'error', 5000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadMyRequests() {
  const list = $('#my-requests-list');
  if (!list) return;
  try {
    const { requests } = await api.payment.myRequests();
    list.replaceChildren();
    if (!Array.isArray(requests) || requests.length === 0) {
      list.append(el('div', { class: 'empty' }, 'No payment requests yet.'));
      return;
    }
    for (const r of requests.slice(0, 10)) {
      list.append(el('div', { class: `request-row request-${r.status}` },
        el('span', { class: 'req-method' }, r.method === 'bkash' ? 'bKash' : 'Nagad'),
        el('span', { class: 'req-amount' }, `${fmt(r.amount)} BDT`),
        el('span', { class: 'req-trx' }, `TRX: ${escapeHtml(r.trx_id)}`),
        el('span', { class: `req-status status-${r.status}` }, r.status),
        el('span', { class: 'req-time' }, timeAgo(r.requested_at)),
      ));
    }
  } catch (e) {
    list.replaceChildren(el('div', { class: 'error' }, 'Failed to load.'));
  }
}
