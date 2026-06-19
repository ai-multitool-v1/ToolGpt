/**
 * public/js/settings.js
 * ----------------------------------------------------------------------------
 * Settings panel — profile editing + plan management + usage dashboard.
 *
 * HTML integration contract:
 *   #settings-form            - profile form
 *     #settings-username
 *     #settings-avatar
 *     #btn-save-profile
 *   #settings-plan            - plan card (free/pro/ultra)
 *   #settings-quota-bar       - <div> usage bar (fills 0..100%)
 *   #settings-quota-text      - "200 / 10000 tokens"
 *   #settings-usage-list      - 7-day usage chart container
 *   #btn-upgrade              - opens payment modal (see payment.js)
 *
 * Ultra plan: shows "Coming Soon 🚀" — no upgrade button.
 */

import { api } from './api.js';
import { CONFIG } from './config.js';
import { $, el, escapeHtml, fmt, toast } from './ui.js';
import { sanitizeUsername, isValidUsername, sanitizeUrl } from './sanitize.js';

export async function initSettings(profile) {
  hydrateProfileForm(profile);
  hydratePlanCard(profile);
  hydrateUsage();

  $('#btn-save-profile')?.addEventListener('click', saveProfile);
}

function hydrateProfileForm(profile) {
  const u = $('#settings-username');
  if (u) u.value = profile.username || '';
  const a = $('#settings-avatar');
  if (a) a.value = profile.avatar_url || '';
}

function hydratePlanCard(profile) {
  const card = $('#settings-plan');
  if (!card) return;
  const info = CONFIG.PLANS[profile.plan] || CONFIG.PLANS.free;

  card.dataset.plan = profile.plan;
  card.replaceChildren(
    el('h3', { class: 'plan-name' }, info.name + (profile.plan === 'ultra' ? ' 🚀' : '')),
    el('div', { class: 'plan-meta' },
      el('span', {}, `Provider: ${info.provider}`),
      el('span', {}, `Model: ${info.model}`),
      el('span', {}, `Daily limit: ${info.dailyLimit === 0 ? '—' : fmt(info.dailyLimit)} tokens`),
    ),
  );

  if (profile.plan === 'pro' && profile.expires_at) {
    card.append(el('div', { class: 'plan-expiry' },
      `Pro active until ${new Date(profile.expires_at).toLocaleDateString()}`
    ));
  }

  if (profile.plan === 'free') {
    $('#btn-upgrade')?.classList.remove('hidden');
  } else if (profile.plan === 'pro') {
    $('#btn-upgrade')?.classList.add('hidden');
  } else if (profile.plan === 'ultra') {
    card.append(el('div', { class: 'plan-soon' }, 'Ultra Coming Soon 🚀 — features will appear here.'));
    $('#btn-upgrade')?.classList.add('hidden');
  }
}

async function hydrateUsage() {
  try {
    const data = await api.usage();
    const bar  = $('#settings-quota-bar');
    const text = $('#settings-quota-text');
    if (bar) {
      const pct = data.quota.limit > 0 ? Math.min(100, (data.quota.used / data.quota.limit) * 100) : 0;
      bar.style.width = `${pct}%`;
      bar.classList.toggle('over', pct >= 100);
    }
    if (text) {
      text.textContent = `${fmt(data.quota.used)} / ${fmt(data.quota.limit)} tokens · plan: ${data.quota.plan}`;
    }
    renderDailyUsage(data.daily || []);
  } catch (e) {
    console.error('usage load failed', e);
  }
}

function renderDailyUsage(daily) {
  const wrap = $('#settings-usage-list');
  if (!wrap) return;
  wrap.replaceChildren();
  if (!daily.length) {
    wrap.append(el('div', { class: 'empty' }, 'No usage in the last 7 days.'));
    return;
  }
  const max = Math.max(...daily.map(d => d.total), 1);
  for (const d of daily) {
    const bar = el('div', { class: 'usage-bar' });
    bar.style.height = `${(d.total / max) * 100}%`;
    bar.title = `${d.day}: ${fmt(d.total)} tokens`;
    wrap.append(el('div', { class: 'usage-col' },
      bar,
      el('span', { class: 'usage-label' }, d.day.slice(5)),
    ));
  }
}

async function saveProfile() {
  const usernameRaw = $('#settings-username')?.value || '';
  const avatarRaw   = $('#settings-avatar')?.value || '';
  const btn = $('#btn-save-profile');
  if (btn) btn.disabled = true;

  // SANITIZE: username + avatar URL.
  const patch = {};
  if (usernameRaw) {
    const username = sanitizeUsername(usernameRaw);
    if (!isValidUsername(username)) {
      toast('Username must start with a letter, be 3-32 chars, alnum/_/.- only.', 'error');
      if (btn) btn.disabled = false;
      return;
    }
    patch.username = username;
  } else {
    patch.username = null;
  }
  if (avatarRaw) {
    const avatar = sanitizeUrl(avatarRaw);
    if (!avatar) {
      toast('Avatar URL must be a clean https:// URL.', 'error');
      if (btn) btn.disabled = false;
      return;
    }
    patch.avatar_url = avatar;
  } else {
    patch.avatar_url = null;
  }

  try {
    const { profile } = await api.profile.update(patch);
    toast('Profile saved.', 'success');
    hydrateProfileForm(profile);
    hydratePlanCard(profile);
  } catch (e) {
    toast(e.message || 'Save failed.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}
