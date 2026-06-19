/**
 * public/js/main.js
 * ----------------------------------------------------------------------------
 * Entry point for index.html (the main chat app).
 *
 * Boots in this order:
 *   1. Wait for supabase-client to finish initialising (it self-inits on import).
 *   2. Call /api/auth/verify — server-side session check.
 *      - If 401 (no session) -> ANONYMOUS VIEW: render the chat UI in a
 *        "locked" state. Visitor can browse the interface, see the welcome
 *        screen, and read suggestions, but cannot send messages or access
 *        settings/payment. Clicking the composer CTA redirects to login.
 *      - If 403 (email not verified) -> show verification notice
 *      - If banned -> show banned notice
 *      - Otherwise hydrate sidebar/chat/settings/payment with the verified profile.
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
import { toast, $, el, openModal, closeModal } from './ui.js';
import { CONFIG } from './config.js';

/**
 * Wire all elements with [data-open-modal] or [data-close-modal] to the
 * shared openModal/closeModal helpers. This avoids inline onclick handlers.
 *
 * Example:
 *   <button data-open-modal="settings-modal">Open settings</button>
 *   <button data-close-modal="settings-modal">Close</button>
 *   <button data-open-modal="payment-modal" data-close-modal="settings-modal">
 *     Open payment (also closes settings)
 *   </button>
 */
function setupModalTriggers() {
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open-modal]');
    if (opener) {
      const targetId = opener.dataset.openModal;
      // If the same click also closes another modal, close it first.
      const alsoClose = opener.dataset.closeModal;
      if (alsoClose && alsoClose !== targetId) closeModal(alsoClose);
      openModal(targetId);
      return;
    }
    const closer = e.target.closest('[data-close-modal]');
    if (closer) {
      closeModal(closer.dataset.closeModal);
      return;
    }
  });
}

async function boot() {
  showSplash('Verifying session…');

  // Wire modal triggers + inject the new ToolGpt logo SVG.
  setupModalTriggers();
  document.querySelectorAll('[data-tg-logo]').forEach(node => {
    node.innerHTML = CONFIG.LOGO_SVG;
  });

  let profile = null;
  let isAnonymous = false;

  try {
    const res = await api.auth.verify();
    profile = res.profile;
  } catch (err) {
    if (err.status === 401) {
      // No session — anonymous visitor. Show the locked UI.
      isAnonymous = true;
    } else if (err.code === 'EMAIL_NOT_VERIFIED') {
      hideSplash();
      showFatal('Please verify your email before using the app. Check your inbox.',
        'Resend verification', () => resendVerification());
      return;
    } else if (err.code === 'BANNED') {
      hideSplash();
      showFatal('Your account has been banned. Contact support.');
      return;
    } else {
      // Network error etc. — fall back to anonymous view so the user at
      // least sees something instead of a blank screen.
      isAnonymous = true;
      console.warn('[boot] verify failed, falling back to anonymous view:', err);
    }
  }

  hideSplash();

  if (isAnonymous) {
    await bootAnonymous();
  } else {
    await bootAuthenticated(profile);
  }
}

/** Authenticated boot — full chat experience. */
async function bootAuthenticated(profile) {
  await Promise.all([
    initSidebar(profile),
    initChat(profile),
    initSettings(profile),
    initPayment(profile),
  ]).catch(e => console.error('init error', e));

  toast(`Signed in as ${profile.email}`, 'success', 2000);
}

/**
 * Anonymous boot — let visitors explore AND attempt to chat.
 *
 * What's available:
 *   - See the ToolGpt welcome screen + suggestion cards
 *   - See the sidebar (with anonymous user card)
 *   - See the model indicator + quota (locked values)
 *   - Type into the composer + press send
 *
 * What happens on send:
 *   - A "login required" modal opens (chat.js triggers it).
 *   - The modal explains that sign-in is needed to actually send messages.
 *   - User can click "Sign in" to go to /login-signup.html or close it.
 *
 * What's still locked:
 *   - Settings + Payment (sidebar buttons disabled)
 *   - History (sidebar section shows "Sign in to save chat history")
 *
 * A persistent banner at the top tells the visitor they're in guest mode.
 */
async function bootAnonymous() {
  // Build a fake "anonymous" profile so the UI has something to render.
  const anonProfile = {
    email: 'anonymous@toolgpt.local',
    username: 'guest',
    plan: 'free',
    daily_limit: 200,
    used_tokens: 0,
    expires_at: null,
    is_banned: false,
  };

  // Show the locked banner.
  const banner = el('div', { class: 'locked-banner', role: 'status' },
    el('span', {}, '🔒 You are browsing as a guest. Sign in to send messages and save history.'),
    el('button', {
      type: 'button',
      onclick: () => location.href = '/login-signup.html',
    }, 'Sign in →'),
  );
  document.body.prepend(banner);
  document.body.classList.add('has-locked-banner');

  // Mark sidebar as anonymous (CSS blurs sensitive sections).
  const sidebar = $('#sidebar');
  if (sidebar) sidebar.classList.add('anonymous');

  // Hydrate sidebar with anonymous info.
  await initSidebar(anonProfile);

  // Render the chat UI in locked mode. The composer stays visible —
  // when the user tries to send, chat.js opens the login-required modal.
  await initChat(anonProfile, { locked: true });

  toast('Browsing as guest. Try sending a message to sign in.', 'info', 4000);
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
