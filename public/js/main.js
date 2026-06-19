/**
 * public/js/main.js
 * ----------------------------------------------------------------------------
 * Entry point for index.html (the main chat app).
 *
 * Boots in this order:
 *   1. Wait for supabase-client to finish initialising (it self-inits on import).
 *   2. Call /api/auth/verify — server-side session check.
 *      - If 401 -> redirect to /login-signup.html
 *      - If 403 (email not verified) -> show verification notice
 *      - If banned -> show banned notice
 *   3. Hydrate sidebar, chat, settings, payment with the verified profile.
 *
 * IMPORTANT: we do NOT trust the Supabase JS SDK's getSession() alone —
 * that only tells us the browser has a token, not that the token is still
 * valid server-side. /api/auth/verify is the source of truth.
 */

import { api } from './api.js';
import { initSidebar } from './sidebar.js';
import { initChat }    from './chat.js';
import { initSettings } from './settings.js';
import { initPayment } from './payment.js';
import { toast, $, el } from './ui.js';

async function boot() {
  // Show splash while we verify.
  showSplash('Verifying session…');

  let profile;
  try {
    const res = await api.auth.verify();
    profile = res.profile;
  } catch (err) {
    if (err.status === 401) {
      // No session — go to login.
      location.href = '/login-signup.html';
      return;
    }
    if (err.code === 'EMAIL_NOT_VERIFIED') {
      showFatal('Please verify your email before using the app. Check your inbox.',
        'Resend verification', () => resendVerification());
      return;
    }
    if (err.code === 'BANNED') {
      showFatal('Your account has been banned. Contact support.');
      return;
    }
    showFatal(err.message || 'Failed to verify session. Please refresh.');
    return;
  }

  hideSplash();

  // Hydrate modules in parallel where possible.
  await Promise.all([
    initSidebar(profile),
    initChat(profile),
    initSettings(profile),
    initPayment(profile),
  ]).catch(e => console.error('init error', e));

  toast(`Signed in as ${profile.email}`, 'success', 2000);
}

// ----- Splash + fatal screen helpers -----
function showSplash(msg) {
  const splash = el('div', { id: 'app-splash', class: 'app-splash' },
    el('div', { class: 'splash-spinner' }),
    el('p', { class: 'splash-text' }, msg),
  );
  document.body.append(splash);
}
function hideSplash() {
  $('#app-splash')?.remove();
}
function showFatal(msg, btnLabel, onClick) {
  hideSplash();
  const fatal = el('div', { class: 'app-fatal' },
    el('p', { class: 'fatal-msg' }, msg),
    btnLabel ? el('button', { class: 'btn-primary', onclick: onClick }, btnLabel) : null,
    el('button', { class: 'btn-ghost', onclick: () => location.href = '/login-signup.html' }, 'Back to login'),
  );
  document.body.append(fatal);
}

async function resendVerification() {
  // Lazy import to avoid circular deps.
  const { supabase } = await import('./supabase-client.js');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.email) {
    toast('No session. Please log in again.', 'error');
    setTimeout(() => location.href = '/login-signup.html', 1500);
    return;
  }
  const { error } = await supabase.auth.resend({ type: 'signup', email: session.user.email });
  if (error) toast(error.message, 'error');
  else toast('Verification email sent. Check your inbox.', 'success');
}

// Go.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
