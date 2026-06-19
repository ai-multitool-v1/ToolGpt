/**
 * public/js/auth.js
 * ----------------------------------------------------------------------------
 * Authentication UI controller for login-signup.html.
 *
 * Implements:
 *   1. Google Login
 *   2. Email + Password Signup  (sends verification email)
 *   3. Email Verification       (required before chat works)
 *   4. Email + Password Login
 *   5. Forgot Password
 *   6. Logout
 *   7. Session Management       (auto-syncs cookie via supabase-client)
 *
 * The HTML is expected to expose these element IDs (you wire your own design
 * around them — see README "HTML Integration Contract"):
 *
 *   #tab-login, #tab-signup, #tab-forgot      - tab buttons
 *   #form-login                                 - <form>
 *     #login-email, #login-password
 *     #btn-login, #btn-google
 *   #form-signup                                - <form>
 *     #signup-email, #signup-password, #signup-username
 *     #btn-signup
 *   #form-forgot                                - <form>
 *     #forgot-email
 *     #btn-forgot
 *   #auth-message                               - status / error text
 */

import { supabase } from './supabase-client.js';
import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);

function showMsg(msg, type = 'info') {
  const el = $('auth-message');
  if (!el) return;
  el.textContent = msg;
  el.className = `auth-message ${type}`;
  el.hidden = false;
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.label ||= btn.textContent;
  btn.textContent = loading ? 'Please wait…' : btn.dataset.label;
}

/**
 * 1. Email + Password Signup.
 * Sends a verification email. User must click the link before login works.
 */
async function handleSignup(e) {
  e.preventDefault();
  const email    = $('signup-email')?.value.trim();
  const password = $('signup-password')?.value;
  const username = $('signup-username')?.value.trim();

  if (!email || !password) return showMsg('Email and password are required.', 'error');
  if (password.length < 8) return showMsg('Password must be at least 8 characters.', 'error');

  setLoading($('btn-signup'), true);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: username || email.split('@')[0] } },
  });
  setLoading($('btn-signup'), false);

  if (error) return showMsg(error.message, 'error');

  // Supabase's signUp returns a session ONLY when email confirmation is off.
  // We require it, so data.session will be null here. Tell the user to check email.
  if (data?.session) {
    showMsg('Account created! Redirecting…', 'success');
    setTimeout(() => location.href = '/index.html', 800);
  } else {
    showMsg('Account created! Please check your email to verify your account.', 'success');
  }
}

/**
 * 4. Email + Password Login.
 */
async function handleLogin(e) {
  e.preventDefault();
  const email    = $('login-email')?.value.trim();
  const password = $('login-password')?.value;
  if (!email || !password) return showMsg('Email and password are required.', 'error');

  setLoading($('btn-login'), true);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  setLoading($('btn-login'), false);

  if (error) return showMsg(error.message, 'error');

  // Defensive: confirm email is verified server-side. Supabase returns
  // session only for verified users when "Confirm email" is enabled, but
  // double-check.
  if (!data.user?.email_confirmed_at) {
    await supabase.auth.signOut();
    return showMsg('Please verify your email before logging in.', 'error');
  }

  showMsg('Welcome back! Redirecting…', 'success');
  setTimeout(() => location.href = '/index.html', 500);
}

/**
 * 1. Google Login.
 * Google OAuth users are auto-verified by Supabase.
 */
async function handleGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${CONFIG.APP_URL}/index.html`,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) showMsg(error.message, 'error');
}

/**
 * 5. Forgot Password.
 */
async function handleForgot(e) {
  e.preventDefault();
  const email = $('forgot-email')?.value.trim();
  if (!email) return showMsg('Email is required.', 'error');

  setLoading($('btn-forgot'), true);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${CONFIG.APP_URL}/login-signup.html?mode=reset`,
  });
  setLoading($('btn-forgot'), false);

  if (error) return showMsg(error.message, 'error');
  showMsg('Password reset link sent. Check your email.', 'success');
}

/**
 * 6. Logout — call API (invalidates server-side) + clear local session.
 */
export async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch { /* server may already be unreachable */ }
  await supabase.auth.signOut();
  location.href = '/login-signup.html';
}

/** Tab switcher. */
function setupTabs() {
  const tabs = ['login', 'signup', 'forgot'];
  tabs.forEach(name => {
    const btn = $(`tab-${name}`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      tabs.forEach(n => {
        $(`tab-${n}`)?.classList.toggle('active', n === name);
        $(`form-${n}`)?.classList.toggle('hidden', n !== name);
      });
    });
  });
}

/** Initialise the auth page. Call from a <script type="module"> at end of body. */
export function initAuthPage() {
  // If already logged in, jump straight to the app.
  supabase.auth.getSession().then(({ data }) => {
    if (data?.session?.user?.email_confirmed_at) {
      location.href = '/index.html';
    }
  });

  setupTabs();

  // Auto-switch to forgot tab via URL hash.
  if (location.hash === '#forgot') $('tab-forgot')?.click();

  $('btn-login')?.addEventListener('click', handleLogin);
  $('btn-signup')?.addEventListener('click', handleSignup);
  $('btn-forgot')?.addEventListener('click', handleForgot);
  $('btn-google')?.addEventListener('click', handleGoogle);

  // Enter-to-submit on each form.
  ['login', 'signup', 'forgot'].forEach(name => {
    $(`form-${name}`)?.addEventListener('submit', (e) => {
      e.preventDefault();
      $(`btn-${name}`)?.click();
    });
  });
}
