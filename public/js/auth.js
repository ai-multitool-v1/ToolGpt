/**
 * public/js/auth.js
 * ----------------------------------------------------------------------------
 * Authentication UI controller for login-signup.html.
 *
 * Implements:
 *   1. Google Login
 *   2. Email + Password Signup  (sends verification email, REJECTS weak pw)
 *   3. Email Verification       (required before chat works)
 *   4. Email + Password Login
 *   5. Forgot Password
 *   6. Logout
 *   7. Session Management       (auto-syncs cookie via supabase-client)
 *
 * Security additions:
 *   - Real-time password strength meter on signup (>= 'fair' required)
 *   - All inputs sanitized client-side before submission (server re-checks)
 *   - Password show/hide toggle
 *
 * The HTML is expected to expose these element IDs (see login-signup.html):
 *   #tab-login, #tab-signup, #tab-forgot      - tab buttons
 *   #form-login, #form-signup, #form-forgot   - <form> wrappers
 *     #login-email, #login-password
 *     #signup-email, #signup-password, #signup-username
 *     #forgot-email
 *   #btn-login, #btn-signup, #btn-forgot, #btn-google
 *   #auth-message                            - status / error text
 *   #pw-strength                             - strength meter container (signup)
 */

import { supabase } from './supabase-client.js';
import { CONFIG } from './config.js';
import {
  sanitizeEmail, isValidEmail,
  sanitizeUsername, isValidUsername,
  sanitizeText,
  checkPasswordStrength, isPasswordAcceptable,
  attachStrengthMeter,
} from './sanitize.js';

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

/** Swap visible form with animation. Removes .hidden first so the CSS
 *  animation can replay on each switch. */
function switchTab(name) {
  ['login', 'signup', 'forgot'].forEach(n => {
    const tab  = $(`tab-${n}`);
    const form = $(`form-${n}`);
    if (!tab || !form) return;
    const isActive = n === name;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    if (isActive) {
      form.classList.remove('hidden');
      // Restart the enter animation by re-triggering it.
      form.style.animation = 'none';
      void form.offsetWidth; // reflow
      form.style.animation = '';
    } else {
      form.classList.add('hidden');
    }
  });
  // Clear status message on tab switch.
  const msg = $('auth-message');
  if (msg) { msg.hidden = true; msg.textContent = ''; }
}

/**
 * 1. Email + Password Signup.
 * Sends a verification email. User must click the link before login works.
 * WEAK PASSWORDS ARE REJECTED — minimum 'fair' on the strength meter.
 */
async function handleSignup(e) {
  e.preventDefault();
  const emailRaw    = $('signup-email')?.value || '';
  const password    = $('signup-password')?.value || '';
  const usernameRaw = $('signup-username')?.value || '';

  // --- Sanitize + validate email ---
  const email = sanitizeEmail(emailRaw);
  if (!isValidEmail(email)) {
    return showMsg('Please enter a valid email address.', 'error');
  }

  // --- Sanitize + validate username (optional) ---
  let username = '';
  if (usernameRaw) {
    username = sanitizeUsername(usernameRaw);
    if (!isValidUsername(username)) {
      return showMsg('Username must start with a letter, be 3-32 chars, and use only letters, digits, _ . -', 'error');
    }
  }

  // --- Password strength gate (CRITICAL) ---
  const strength = checkPasswordStrength(password);
  if (!isPasswordAcceptable(password)) {
    const tips = strength.suggestions.slice(0, 2).join('; ');
    return showMsg(`Password too weak (${strength.label}, ${strength.score}/8). ${tips}`, 'error');
  }

  setLoading($('btn-signup'), true);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: username || email.split('@')[0] } },
  });
  setLoading($('btn-signup'), false);

  if (error) {
    // Map common Supabase errors to friendly messages.
    if (error.message.toLowerCase().includes('already registered')) {
      return showMsg('This email is already registered. Try logging in.', 'error');
    }
    if (error.message.toLowerCase().includes('password')) {
      return showMsg(`Password rejected by server: ${error.message}`, 'error');
    }
    return showMsg(error.message, 'error');
  }

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
  const emailRaw    = $('login-email')?.value || '';
  const password    = $('login-password')?.value || '';

  const email = sanitizeEmail(emailRaw);
  if (!isValidEmail(email)) return showMsg('Please enter a valid email address.', 'error');
  if (!password)            return showMsg('Password is required.', 'error');

  setLoading($('btn-login'), true);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  setLoading($('btn-login'), false);

  if (error) {
    // Don't leak whether the email exists — generic message.
    return showMsg('Invalid email or password.', 'error');
  }

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
  const emailRaw = $('forgot-email')?.value || '';
  const email = sanitizeEmail(emailRaw);
  if (!isValidEmail(email)) return showMsg('Please enter a valid email address.', 'error');

  setLoading($('btn-forgot'), true);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${CONFIG.APP_URL}/login-signup.html?mode=reset`,
  });
  setLoading($('btn-forgot'), false);

  if (error) return showMsg(error.message, 'error');
  // Always show success — don't leak whether the email exists.
  showMsg('If that email exists, a reset link has been sent.', 'success');
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

/** Wire up password show/hide toggles on every <input type="password">. */
function setupPasswordToggles() {
  document.querySelectorAll('input[type="password"]').forEach(input => {
    // Wrap in a positioning context if not already wrapped.
    if (input.parentElement?.classList.contains('pw-field-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'pw-field-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'pw-toggle';
    toggle.setAttribute('aria-label', 'Show password');
    toggle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    toggle.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      toggle.innerHTML = showing
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
    });
    wrap.appendChild(toggle);
  });
}

/** Initialise the auth page. Call from a <script type="module"> at end of body. */
export function initAuthPage() {
  // Inject the new ToolGpt logo SVG into the logo mark containers.
  document.querySelectorAll('[data-tg-logo]').forEach(node => {
    node.innerHTML = CONFIG.LOGO_SVG;
  });

  // If already logged in AND verified, jump straight to the app.
  supabase.auth.getSession().then(({ data }) => {
    if (data?.session?.user?.email_confirmed_at) {
      location.href = '/index.html';
    }
  });

  // Tab switching with animation.
  ['login', 'signup', 'forgot'].forEach(name => {
    $(`tab-${name}`)?.addEventListener('click', () => switchTab(name));
  });

  // Auto-switch to forgot tab via URL hash.
  if (location.hash === '#forgot') switchTab('forgot');

  // Password strength meter on signup.
  const signupPw = $('signup-password');
  const meter    = $('pw-strength');
  if (signupPw && meter) {
    attachStrengthMeter(signupPw, meter);
  }

  // Password show/hide toggles on all password inputs.
  setupPasswordToggles();

  // Button wiring.
  $('btn-login')?.addEventListener('click', handleLogin);
  $('btn-signup')?.addEventListener('click', handleSignup);
  $('btn-forgot')?.addEventListener('click', handleForgot);

  // Wire ALL google buttons (login + signup tabs each have one).
  document.querySelectorAll('#btn-google').forEach(btn => {
    btn.addEventListener('click', handleGoogle);
  });

  // Enter-to-submit on each form.
  ['login', 'signup', 'forgot'].forEach(name => {
    $(`form-${name}`)?.addEventListener('submit', (e) => {
      e.preventDefault();
      $(`btn-${name}`)?.click();
    });
  });
}
