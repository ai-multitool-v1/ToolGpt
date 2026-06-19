/**
 * public/js/chat.js
 * ----------------------------------------------------------------------------
 * Main chat controller — wires the message composer, message list, model
 * indicator, and quota badge to /api/chat.
 *
 * HTML integration contract (element IDs — your design owns the visuals):
 *
 *   #chat-messages              - scrollable message list
 *   #chat-form                  - <form> wrapping the composer
 *   #chat-input                 - <textarea>
 *   #chat-send                  - submit button
 *   #chat-model-indicator       - shows current model based on plan
 *   #chat-quota                 - shows "used / limit tokens"
 *   #chat-clear                 - clear conversation button
 *
 * Conversation state lives in memory only — chat_history is the source of
 * truth on the server. On page load we hydrate the last N turns from history.
 */

import { api } from './api.js';
import { CONFIG } from './config.js';
import { $, el, escapeHtml, renderMarkdown, toast, fmt } from './ui.js';

// In-memory conversation. Always begins with the system prompt.
const conversation = [{ role: 'system', content: CONFIG.PERSONA.systemPrompt }];

let isSending = false;
let currentProfile = null;

/**
 * Boot the chat page.
 * @param {Object} profile  hydrated from /api/auth/verify
 */
export async function initChat(profile) {
  currentProfile = profile;
  updateModelIndicator(profile);
  updateQuota(profile);

  // Hydrate last N turns from history.
  try {
    const { history } = await api.history({ limit: CONFIG.CHAT.maxHistoryTurns });
    if (Array.isArray(history) && history.length) {
      // Server returns newest first; reverse for display, drop system rows.
      const turns = history.filter(h => h.role !== 'system').reverse();
      for (const t of turns) {
        conversation.push({ role: t.role, content: t.message });
        appendMessage(t.role, t.message, { model: t.model, time: t.created_at });
      }
      scrollToBottom();
    }
  } catch (e) {
    console.warn('history hydrate failed', e);
  }

  // Wire UI.
  $('#chat-form')?.addEventListener('submit', onSend);
  $('#chat-clear')?.addEventListener('click', onClear);

  // Auto-grow textarea.
  const input = $('#chat-input');
  if (input) {
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 240) + 'px';
    });
    // Ctrl/Cmd+Enter to send.
    input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        $('#chat-form')?.requestSubmit();
      }
    });
  }
}

function updateModelIndicator(profile) {
  const node = $('#chat-model-indicator');
  if (!node || !profile) return;
  const planInfo = CONFIG.PLANS[profile.plan] || CONFIG.PLANS.free;
  node.textContent = `${planInfo.provider} · ${planInfo.model}`;
  node.dataset.plan = profile.plan;
}

function updateQuota(profile) {
  const node = $('#chat-quota');
  if (!node || !profile) return;
  const used  = Number(profile.used_tokens || 0);
  const limit = Number(profile.daily_limit || 0);
  node.textContent = `${fmt(used)} / ${fmt(limit)} tokens today`;
  node.classList.toggle('quota-warn', used / limit > 0.8);
  node.classList.toggle('quota-full', used >= limit);
}

async function onSend(e) {
  e.preventDefault();
  if (isSending) return;
  const input = $('#chat-input');
  const text  = (input?.value || '').trim();
  if (!text) return;

  // Append user message immediately (optimistic).
  conversation.push({ role: 'user', content: text });
  appendMessage('user', text);
  input.value = '';
  input.style.height = 'auto';
  scrollToBottom();

  // Show typing indicator.
  const typing = appendMessage('assistant', '', { typing: true });
  isSending = true;
  $('#chat-send')?.setAttribute('disabled', '');

  try {
    const res = await api.chat(conversation.slice(-CONFIG.CHAT.maxHistoryTurns), {
      temperature: CONFIG.CHAT.temperature,
    });
    typing.remove();
    conversation.push({ role: 'assistant', content: res.content });
    appendMessage('assistant', res.content, { model: res.model });
    updateQuota({
      used_tokens: res.quota.used,
      daily_limit: res.quota.limit,
    });
  } catch (err) {
    typing.remove();
    if (err.code === 'ULTRA_NOT_AVAILABLE') {
      appendMessage('assistant', err.message, { system: true });
    } else if (err.code === 'QUOTA_EXCEEDED') {
      toast('Daily token limit reached. Upgrade to Pro.', 'error', 5000);
      appendMessage('assistant', '⚠️ You hit your daily token limit. Upgrade to Pro for 10,000 tokens/day.', { system: true });
    } else if (err.status === 401) {
      toast('Session expired. Redirecting to login…', 'error');
      setTimeout(() => location.href = '/login-signup.html', 1500);
    } else {
      toast(err.message || 'Chat failed. Try again.', 'error');
      appendMessage('assistant', `⚠️ ${err.message}`, { system: true });
    }
  } finally {
    isSending = false;
    $('#chat-send')?.removeAttribute('disabled');
    scrollToBottom();
  }
}

async function onClear() {
  if (!confirm('Clear entire chat history? This cannot be undone.')) return;
  try {
    await api.clearHistory();
    $('#chat-messages')?.replaceChildren();
    // Restore the empty-state card so the welcome screen returns.
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
      <p>History cleared. Start a new conversation below.</p>`;
    $('#chat-messages')?.append(empty);
    conversation.length = 0;
    conversation.push({ role: 'system', content: CONFIG.PERSONA.systemPrompt });
    toast('Chat history cleared.', 'success');
  } catch (e) {
    toast('Failed to clear history.', 'error');
  }
}

/** Append a message bubble. Returns the bubble node. */
function appendMessage(role, content, opts = {}) {
  const list = $('#chat-messages');
  if (!list) return null;

  // Hide the empty-state card the first time a real message appears.
  const empty = $('#chat-empty');
  if (empty) empty.classList.add('hidden');

  const wrap = el('div', { class: `msg msg-${role}${opts.system ? ' msg-system' : ''}` });

  if (opts.typing) {
    wrap.classList.add('msg-typing');
    wrap.append(el('div', { class: 'typing-dots' },
      el('span'), el('span'), el('span')
    ));
    list.append(wrap);
    scrollToBottom();
    return wrap;
  }

  const header = el('div', { class: 'msg-meta' },
    role === 'user' ? 'You' : 'Assistant',
    opts.model ? el('span', { class: 'msg-model' }, opts.model) : null,
    opts.time ? el('span', { class: 'msg-time' }, new Date(opts.time).toLocaleTimeString()) : null,
  );

  const body = el('div', { class: 'msg-body' });
  body.innerHTML = role === 'user' ? escapeHtml(content).replace(/\n/g, '<br>') : renderMarkdown(content);

  wrap.append(header, body);
  list.append(wrap);
  scrollToBottom();
  return wrap;
}

function scrollToBottom() {
  const list = $('#chat-messages');
  if (list) list.scrollTop = list.scrollHeight;
}
