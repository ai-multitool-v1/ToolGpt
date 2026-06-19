/**
 * public/js/sidebar.js
 * ----------------------------------------------------------------------------
 * Left-sidebar history panel + mobile drawer.
 *
 * HTML integration contract:
 *   #sidebar               - root aside element
 *   #sidebar-toggle        - button (mobile) to open/close drawer
 *   #history-list          - container for history items
 *   #btn-new-chat          - "New chat" button (clears current conversation only)
 *   #btn-show-history      - loads recent history from server
 *   #btn-logout            - logout button
 *   #user-email            - displays logged-in email
 *   #user-plan             - displays current plan badge
 *
 * The sidebar shows two views:
 *   - Recent conversations (grouped by day, derived from /api/history)
 *   - Quick actions (new chat, settings, upgrade, logout)
 */

import { api } from './api.js';
import { $, el, escapeHtml, timeAgo, toast } from './ui.js';
import { logout } from './auth.js';

export async function initSidebar(profile) {
  // User info.
  const emailEl = $('#user-email');
  if (emailEl) emailEl.textContent = profile.email || '—';
  const planBadge = $('#user-plan');
  if (planBadge) {
    planBadge.textContent = profile.plan?.toUpperCase() || 'FREE';
    planBadge.dataset.plan = profile.plan || 'free';
  }
  // Avatar: first letter of email, uppercased.
  const avatarEl = $('#user-avatar');
  if (avatarEl) {
    const initial = (profile.email || profile.username || 'U')[0].toUpperCase();
    avatarEl.textContent = initial;
  }

  // Buttons.
  $('#btn-logout')?.addEventListener('click', async () => {
    await logout();
  });
  $('#btn-show-history')?.addEventListener('click', loadHistory);
  $('#btn-new-chat')?.addEventListener('click', () => {
    // Clear visible messages + show empty state again. Server history preserved.
    const list = document.getElementById('chat-messages');
    if (list) {
      list.replaceChildren();
      const empty = document.createElement('div');
      empty.id = 'chat-empty';
      empty.className = 'chat-empty';
      empty.innerHTML = `
        <div class="chat-empty-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 7 8 11 4 15"></polyline>
            <line x1="12" y1="16" x2="20" y2="16"></line>
          </svg>
        </div>
        <h1>ToolGpt</h1>
        <p>New conversation started. Previous history is still saved.</p>`;
      list.append(empty);
    }
    toast('New chat started.', 'info');
  });

  // Mobile drawer toggle.
  $('#sidebar-toggle')?.addEventListener('click', () => {
    $('#sidebar')?.classList.toggle('open');
  });

  // Auto-load recent history on first paint.
  await loadHistory();
}

async function loadHistory() {
  const list = $('#history-list');
  if (!list) return;
  list.replaceChildren(el('div', { class: 'sidebar-loading' }, 'Loading…'));

  try {
    const { history } = await api.history({ limit: 30 });
    if (!Array.isArray(history) || history.length === 0) {
      list.replaceChildren(el('div', { class: 'sidebar-empty' }, 'No conversations yet.'));
      return;
    }

    // Group by day (YYYY-MM-DD).
    const groups = new Map();
    for (const h of history) {
      const day = (h.created_at || '').slice(0, 10) || 'unknown';
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(h);
    }

    list.replaceChildren();
    for (const [day, items] of groups) {
      list.append(el('div', { class: 'history-day' }, prettyDay(day)));
      for (const it of items) {
        const preview = (it.message || '').slice(0, 80);
        const node = el('button', {
          type: 'button',
          class: `history-item history-${it.role}`,
          onclick: () => onHistoryClick(it),
        },
          el('span', { class: 'history-role' }, it.role === 'user' ? 'You' : 'AI'),
          el('span', { class: 'history-preview' }, escapeHtml(preview)),
          el('span', { class: 'history-time' }, timeAgo(it.created_at)),
        );
        list.append(node);
      }
    }
  } catch (e) {
    list.replaceChildren(el('div', { class: 'sidebar-error' }, 'Failed to load history.'));
    console.error(e);
  }
}

function prettyDay(day) {
  const d = new Date(day + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString();
}

function onHistoryClick(item) {
  // Dispatch an event the chat controller can listen for to scroll to /
  // restore that conversation. For now, we just scroll to top.
  document.dispatchEvent(new CustomEvent('history:select', { detail: item }));
  // Close drawer on mobile.
  $('#sidebar')?.classList.remove('open');
}
