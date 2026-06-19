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
import { $, el, escapeHtml, renderMarkdown, toast, fmt, openModal } from './ui.js';
import { sanitizeText } from './sanitize.js';

// In-memory conversation. Always begins with the system prompt.
const conversation = [{ role: 'system', content: CONFIG.PERSONA.systemPrompt }];

let isSending = false;
let currentProfile = null;
let isLocked = false; // anonymous visitor — cannot actually send

/**
 * Boot the chat page.
 * @param {Object} profile  hydrated from /api/auth/verify
 * @param {Object} [opts]
 * @param {boolean} [opts.locked=false]  Anonymous visitor — read-only mode
 */
export async function initChat(profile, opts = {}) {
  currentProfile = profile;
  isLocked = !!opts.locked;
  updateModelIndicator(profile);
  updateQuota(profile);

  // Hydrate last N turns from history (skip for anonymous — they have none).
  if (!isLocked) {
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
  }

  // Wire UI. In locked (anonymous) mode, the composer is still interactive —
  // pressing send opens the login-required modal instead of calling the API.
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
  // SANITIZE: strip control chars, HTML tags, BOM/RTL overrides. Cap length.
  const raw   = (input?.value || '');
  const text  = sanitizeText(raw, 16_000);

  // Anonymous visitor — don't actually send. Show login-required modal.
  // We still clear the composer so it feels responsive, and show the user's
  // message briefly so they see what they typed before being asked to login.
  if (isLocked) {
    if (!text) {
      openModal('login-required-modal');
      return;
    }
    // Append the user's message visually so they get feedback...
    appendMessage('user', text);
    input.value = '';
    input.style.height = 'auto';
    scrollToBottom();
    // ...then immediately show the login modal.
    setTimeout(() => openModal('login-required-modal'), 250);
    return;
  }

  if (!text) {
    toast('Message appears empty after sanitization.', 'info');
    return;
  }
  // Reject messages that are mostly repeated chars (spam/abuse heuristic).
  if (/(.)\1{500,}/.test(text)) {
    toast('Message rejected: too much repetition.', 'error');
    return;
  }

  // Append user message immediately (optimistic).
  conversation.push({ role: 'user', content: text });
  appendMessage('user', text);
  input.value = '';
  input.style.height = 'auto';
  scrollToBottom();

  // Show thinking loader (typing dots + "ToolGpt is thinking…" label).
  const typing = appendMessage('assistant', '', { typing: true });
  isSending = true;
  $('#chat-send')?.setAttribute('disabled', '');

  try {
    const res = await api.chat(conversation.slice(-CONFIG.CHAT.maxHistoryTurns), {
      temperature: CONFIG.CHAT.temperature,
    });
    typing.remove();
    conversation.push({ role: 'assistant', content: res.content });
    // Reveal assistant reply with typewriter animation.
    appendMessage('assistant', res.content, { model: res.model, typewriter: true });
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
    // Enhanced thinking loader: dots + "ToolGpt is thinking…" label.
    wrap.classList.add('msg-typing');
    const thinking = el('div', { class: 'msg-thinking' },
      el('div', { class: 'thinking-avatar', 'data-tg-logo': '' }),
      el('div', { class: 'thinking-content' },
        el('div', { class: 'thinking-label' }, 'ToolGpt is thinking'),
        el('div', { class: 'typing-dots' },
          el('span'), el('span'), el('span')
        ),
      ),
    );
    // Inject the logo SVG into the avatar placeholder.
    const logoHolder = thinking.querySelector('[data-tg-logo]');
    if (logoHolder && CONFIG.LOGO_SVG) logoHolder.innerHTML = CONFIG.LOGO_SVG;
    wrap.append(thinking);
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

  if (opts.typewriter && role === 'assistant' && content) {
    // Typewriter reveal: progressively reveal text content, then swap to
    // fully-rendered markdown at the end for proper formatting.
    list.append(wrap);
    wrap.append(header, body);
    typewriterReveal(body, content);
    scrollToBottom();
    return wrap;
  }

  // Default: render full content immediately.
  body.innerHTML = role === 'user'
    ? escapeHtml(content).replace(/\n/g, '<br>')
    : renderMarkdown(content);

  wrap.append(header, body);
  list.append(wrap);
  scrollToBottom();
  return wrap;
}

/**
 * Typewriter reveal — progressively reveal the assistant's response text
 * character-by-character (in small chunks per frame for speed), then swap
 * to fully-rendered Markdown HTML at the end.
 *
 * During typing, the text is shown as plain text with a blinking cursor.
 * Once complete, the body's innerHTML is replaced with the rendered
 * markdown (code blocks, lists, links, etc.) via a quick fade.
 *
 * Speed: ~3-5 chars per frame (~180-300 chars/sec). For a 1000-char
 * response that's ~3-5 seconds of typing animation.
 *
 * @param {HTMLElement} bodyEl  the .msg-body element to fill
 * @param {string} text         the raw response text
 */
function typewriterReveal(bodyEl, text) {
  if (!bodyEl || !text) {
    if (bodyEl) bodyEl.innerHTML = renderMarkdown(text || '');
    return;
  }

  // Render the final markdown once so we can swap to it at the end.
  const finalHtml = renderMarkdown(text);

  // Cap length so very long responses don't take forever.
  // For responses > 3000 chars, increase chunk size proportionally.
  const totalLen = text.length;
  let chunkSize = 3;
  if (totalLen > 500)  chunkSize = 5;
  if (totalLen > 1500) chunkSize = 10;
  if (totalLen > 3000) chunkSize = 20;

  // Estimate total time so we can cap it (max ~6 seconds).
  const estimatedMs = (totalLen / chunkSize) * 16;
  if (estimatedMs > 6000) {
    chunkSize = Math.ceil(totalLen / (6000 / 16));
  }

  let i = 0;
  bodyEl.classList.add('typewriter-active');
  bodyEl.innerHTML = '';

  function step() {
    i = Math.min(totalLen, i + chunkSize);
    const partial = text.slice(0, i);
    // Show partial text as plain text (escaped) — formatting appears at end.
    // Append a blinking cursor via a separate span after the text node.
    bodyEl.innerHTML = '';
    bodyEl.append(document.createTextNode(partial));
    const cursor = document.createElement('span');
    cursor.className = 'typewriter-cursor';
    cursor.textContent = '▋';
    bodyEl.append(cursor);
    scrollToBottom();

    if (i < totalLen) {
      // Use setTimeout(16) instead of rAF so it doesn't pause when tab is hidden.
      setTimeout(step, 16);
    } else {
      // Done — swap to rendered markdown with a quick fade.
      bodyEl.style.transition = 'opacity .2s ease';
      bodyEl.style.opacity = '0';
      setTimeout(() => {
        bodyEl.innerHTML = finalHtml;
        bodyEl.classList.remove('typewriter-active');
        bodyEl.style.opacity = '1';
        // Scroll one more time after the swap in case markdown changed height.
        scrollToBottom();
      }, 180);
    }
  }

  // Small initial delay so the typing doesn't start before the bubble appears.
  setTimeout(step, 80);
}

function scrollToBottom() {
  const list = $('#chat-messages');
  if (list) list.scrollTop = list.scrollHeight;
}
