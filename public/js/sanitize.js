/**
 * public/js/sanitize.js
 * ----------------------------------------------------------------------------
 * Client-side input sanitization + password strength checker.
 *
 * ⚠️ These are UX/defense-in-depth layers ONLY. The server re-validates
 * everything in functions/_lib/security.js — never trust the client.
 *
 * Exports:
 *   - sanitizeText(s, maxLen)        Strip control chars + HTML tags + trim
 *   - sanitizeEmail(s)               Lowercase + RFC-ish check
 *   - sanitizeTrxId(s)               bKash/Nagad TRX format (6-20 alnum)
 *   - sanitizeUsername(s)            Alnum/_/-/. only, 3-32 chars
 *   - sanitizeUrl(s)                 https only, block data: URIs (XSS vector)
 *   - checkPasswordStrength(pw)      Returns { score, label, checks, suggestions }
 *   - attachStrengthMeter(input$, meter$)  Live-updates a strength meter UI
 */

/** Strip HTML tags + control chars + dangerous Unicode, then trim. */
export function sanitizeText(s, maxLen = 16000) {
  if (typeof s !== 'string') return '';
  return s
    // Drop null bytes & other C0 controls (preserves \t \n \r).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // Strip HTML tags (defense-in-depth; renderMarkdown already escapes).
    .replace(/<\/?[^>]+>/g, '')
    // Strip BOM + RTL/LTR override (homoglyph attack vector).
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .slice(0, maxLen)
    .trim();
}

/** Lowercase + basic RFC 5322-ish check. Server is final authority. */
export function sanitizeEmail(s) {
  if (typeof s !== 'string') return '';
  return s.trim().toLowerCase().slice(0, 254);
}
export function isValidEmail(s) {
  return typeof s === 'string' && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s);
}

/** bKash/Nagad TRX IDs: 6-20 alphanumeric. Server regex matches. */
export function sanitizeTrxId(s) {
  if (typeof s !== 'string') return '';
  return s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}
export function isValidTrxId(s) {
  return typeof s === 'string' && /^[A-Z0-9]{6,20}$/.test(s);
}

/** Username: 3-32 chars, alnum + _ - . only, must start with a letter. */
export function sanitizeUsername(s) {
  if (typeof s !== 'string') return '';
  return s.trim().replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 32);
}
export function isValidUsername(s) {
  return typeof s === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]{2,31}$/.test(s);
}

/**
 * URL sanitizer — MUST be https to prevent data: URI XSS and javascript: URLs.
 * Returns '' for anything that isn't a clean https URL.
 */
export function sanitizeUrl(s) {
  if (typeof s !== 'string') return '';
  const u = s.trim();
  if (!u) return '';
  if (!/^https:\/\//i.test(u)) return '';
  // Block obvious XSS payloads even within https.
  if (/["'<>\s]/.test(u)) return '';
  return u.slice(0, 1024);
}

/**
 * Password strength checker.
 *
 * Scoring:
 *   - Length:       +1 if >=8, +2 if >=12, +3 if >=16
 *   - Lowercase:    +1
 *   - Uppercase:    +1
 *   - Digit:        +1
 *   - Special char: +1  (one of !@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?)
 *   - Variety:      +1 if 4+ distinct character classes
 *
 * Returns:
 *   { score: 0-8, label: 'weak'|'fair'|'good'|'strong',
 *     checks: { length, lower, upper, digit, special, variety },
 *     suggestions: string[] }
 *
 * 'weak' (score 0-3) is REJECTED at signup. Minimum required is 'fair' (4+).
 */
export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string') pw = '';
  const checks = {
    length:  pw.length >= 8,
    long:    pw.length >= 12,
    xlong:   pw.length >= 16,
    lower:   /[a-z]/.test(pw),
    upper:   /[A-Z]/.test(pw),
    digit:   /[0-9]/.test(pw),
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw),
  };
  const classes = [checks.lower, checks.upper, checks.digit, checks.special].filter(Boolean).length;
  checks.variety = classes >= 4;

  let score = 0;
  if (checks.length)  score += 1;
  if (checks.long)    score += 1;
  if (checks.xlong)   score += 1;
  if (checks.lower)   score += 1;
  if (checks.upper)   score += 1;
  if (checks.digit)   score += 1;
  if (checks.special) score += 1;
  if (checks.variety) score += 1;

  // Hard penalty for very short.
  if (pw.length < 8) score = Math.min(score, 1);

  // Common-password penalty.
  const common = ['password', 'passw0rd', '12345678', 'qwerty12', 'letmein!', 'admin123', 'welcome1'];
  if (common.some(c => pw.toLowerCase().includes(c))) score = Math.min(score, 2);

  // Sequential / repeated char penalty.
  if (/(.)\1{3,}/.test(pw))                       score = Math.min(score, 3); // aaaa
  if (/(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(pw)) score = Math.min(score, 3);

  let label;
  if (score <= 3)      label = 'weak';
  else if (score <= 5) label = 'fair';
  else if (score <= 6) label = 'good';
  else                 label = 'strong';

  const suggestions = [];
  if (!checks.length)    suggestions.push('Use at least 8 characters');
  if (!checks.lower)     suggestions.push('Add lowercase letters');
  if (!checks.upper)     suggestions.push('Add uppercase letters');
  if (!checks.digit)     suggestions.push('Add digits');
  if (!checks.special)   suggestions.push('Add a special character (!@#$…)');
  if (!checks.variety)   suggestions.push('Mix 4+ character classes');
  if (checks.length && !checks.long) suggestions.push('Consider 12+ characters for stronger security');

  return { score, label, checks, suggestions };
}

/** True if password is acceptable for signup (>= fair). */
export function isPasswordAcceptable(pw) {
  return checkPasswordStrength(pw).score >= 4;
}

/**
 * Attach a live strength meter to an <input type="password">.
 *
 * Expected meter DOM (caller creates):
 *   <div class="pw-strength">
 *     <div class="pw-strength-bar"><div class="pw-strength-fill"></div></div>
 *     <div class="pw-strength-label"></div>
 *     <ul class="pw-strength-tips"></ul>
 *   </div>
 *
 * @param {HTMLInputElement} inputEl
 * @param {HTMLElement} meterEl  container with .pw-strength-fill / .pw-strength-label / .pw-strength-tips
 */
export function attachStrengthMeter(inputEl, meterEl) {
  if (!inputEl || !meterEl) return;
  const fill  = meterEl.querySelector('.pw-strength-fill');
  const label = meterEl.querySelector('.pw-strength-label');
  const tips  = meterEl.querySelector('.pw-strength-tips');

  const update = () => {
    const pw = inputEl.value || '';
    const r = checkPasswordStrength(pw);

    // Update fill width + color via data-strength attr (CSS handles colors).
    const pct = Math.min(100, (r.score / 8) * 100);
    if (fill) {
      fill.style.width = `${pct}%`;
      fill.dataset.strength = r.label;
    }
    if (label) {
      label.textContent = pw ? `${r.label.toUpperCase()} (${r.score}/8)` : '';
      label.dataset.strength = r.label;
    }
    if (tips) {
      tips.replaceChildren();
      if (pw && r.suggestions.length) {
        for (const s of r.suggestions.slice(0, 3)) {
          const li = document.createElement('li');
          li.textContent = s;
          tips.append(li);
        }
      }
    }
    // Store the latest result on the input for the submit handler to read.
    inputEl._strength = r;
  };

  inputEl.addEventListener('input', update);
  // Initial paint.
  update();
}
