/**
 * public/js/ui.js
 * ----------------------------------------------------------------------------
 * Small DOM utility helpers used by chat.js, sidebar.js, settings.js.
 * Framework-free, dependency-free.
 */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Create an element with attributes + children in one call. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) node.setAttribute(k, '');
    else if (v === false || v == null) { /* skip */ }
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Escape HTML to prevent XSS when injecting raw text. */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minimal Markdown renderer — headings, bold, italic, code, code blocks,
 * links, lists, line breaks. NOT a full Markdown engine; designed for chat
 * output where the AI may include code. For full Markdown, swap in marked.
 *
 * Returns safe HTML (all user input is escaped before being marked up).
 */
export function renderMarkdown(md) {
  if (!md) return '';
  // 1. Extract fenced code blocks first to protect them.
  const blocks = [];
  let text = String(md).replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const i = blocks.length;
    blocks.push(`<pre><code class="language-${escapeHtml(lang || '')}">${escapeHtml(code)}</code></pre>`);
    return `\u0000BLOCK${i}\u0000`;
  });

  // 2. Escape remaining text.
  text = escapeHtml(text);

  // 3. Inline code.
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // 4. Bold + italic.
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 5. Links.
  text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // 6. Headings.
  text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>')
             .replace(/^## (.+)$/gm, '<h2>$1</h2>')
             .replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 7. Lists (simple — unordered + ordered).
  text = text.replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>');
  text = text.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  text = text.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // 8. Paragraphs / line breaks.
  text = text.split(/\n{2,}/).map(p =>
    p.trim().startsWith('<') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`
  ).join('\n');

  // 9. Restore code blocks.
  text = text.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => blocks[Number(i)]);

  return text;
}

/** Toast notifications. */
let toastContainer;
export function toast(message, type = 'info', duration = 3500) {
  if (!toastContainer) {
    toastContainer = el('div', { class: 'toast-container', 'aria-live': 'polite' });
    document.body.append(toastContainer);
  }
  const t = el('div', { class: `toast toast-${type}` }, message);
  toastContainer.append(t);
  setTimeout(() => {
    t.classList.add('fade-out');
    setTimeout(() => t.remove(), 300);
  }, duration);
}

/** Format a date for display. */
export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Format a number with thousand separators. */
export function fmt(n) {
  return Number(n || 0).toLocaleString();
}
