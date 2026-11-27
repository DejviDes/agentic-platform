// ---------- block-based message editor (2026-11-16) ----------
// The message field = #agText (first text block) and after it pairs of [code block .kBlok, text field .kText]. The code block has
// a language picker and × in the header, you type into it in monospace without wrapping (Enter = new line with the same indentation,
// Tab / ⇧Tab = indentation, ⌘↵ sends). On send everything is assembled into markdown (```language), so the server, bubble and
// message editing stay unchanged. Pasting code (⌘V) creates a block by itself, ⌘⇧V pastes without processing, a ``` line + Enter
// creates a block, text with ``` is split into blocks on paste. At top level only declarations (modules are imported in a circle).
import { $, esc } from './utils.js';
import { t as tr } from './i18n.js'; // alias: in this file `t` is a common variable name

const ED = { o: null, last: null, clean: false, menu: null };
const LANGUAGES = [['', ''], ['python', 'Python'], ['js', 'JavaScript'], ['ts', 'TypeScript'], ['bash', 'Bash'], ['haskell', 'Haskell'], ['sql', 'SQL'],
  ['json', 'JSON'], ['html', 'HTML'], ['css', 'CSS'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['java', 'Java'], ['yaml', 'YAML'], ['diff', 'diff'], ['markdown', 'Markdown']];
const nameLanguage = (j) => (LANGUAGES.find((x) => x[0] === j)?.[1] || j || tr('app.editor.withoutLanguage'));

// pasted text looks like code: at least 2 lines of code and most non-empty lines have code characters, not a sentence
export function looksLikeCode(t) {
  const r = t.split('\n').filter((x) => x.trim());
  if (r.length < 2) return false;
  const code = r.filter((x) => /^(\t| {2,})\S/.test(x) || /[;{}(\[,:=>]\s*$/.test(x) || /^\s*[})\]]/.test(x)
    || /^\s*(def|class|import|from|const|let|var|function|return|if|elif|else|for|while|public|private|static|#include|using|namespace|module|where|data|type|SELECT|INSERT|UPDATE|CREATE|<\/?[a-z]|\$ |npm|git|cd|brew|sudo|curl|python3?|node)\b/.test(x)
    || /(=>|::|->|<-|==|!=|&&|\|\|)/.test(x) || /^\s*[\w.]+(\[\w*\])?( [^=]*)? = \S/.test(x)).length;
  const sentence = r.filter((x) => /[\p{L}][.!?…]\s*$/u.test(x) && !/^\s*(\/\/|#|--)/.test(x)).length;
  return code >= 2 && code / r.length >= 0.6 && sentence / r.length < 0.35;
}
export function guessLanguage(t) {
  const s = t.trim();
  if (/^[\[{]/.test(s)) { try { JSON.parse(s); return 'json'; } catch {} }
  if (/^\s*(\$ |#!\/bin\/(ba|z)?sh|(npm|npx|git|cd|brew|sudo|curl|ls|mkdir|python3?|node|pip3?) )/m.test(s) && !/[;{]\s*$/m.test(s)) return 'bash';
  if (/^\s*(module \S+ where|\w+\s*::\s*\S)/m.test(s) || /^\s*import qualified /m.test(s)) return 'haskell';
  if (/^\s*(def |class \w+(\(.*\))?:|elif |import \w+$|from \S+ import )/m.test(s) || /:\s*$/m.test(s) && !/[;{}]\s*$/m.test(s)) return 'python';
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE)\b/im.test(s)) return 'sql';
  if (/^\s*<(!doctype|html|div|\w+[ >])/im.test(s)) return 'html';
  if (/^\s*(using System|namespace \w|public (sealed |static )?class )/m.test(s)) return 'csharp';
  if (/^\s*#include\s*</m.test(s)) return 'c';
  if (/^[^{]*\{[\s\S]*^\s*[\w-]+\s*:\s*[^;]+;\s*$/m.test(s) && !/\b(function|const|let|return)\b/.test(s)) return 'css';
  if (/:\s*(string|number|boolean)\b|^\s*(interface|type) \w+/m.test(s)) return 'ts';
  if (/\b(const|let|function|=>|import .* from|export |console\.)/.test(s)) return 'js';
  return '';
}

// ---------- elements ----------
function heightEl(el) {
  if (el.id === 'agText') return ED.o?.height();
  el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px';
}
function newBlock(code, language) {
  const b = document.createElement('div');
  b.className = 'kBlock'; b.dataset.language = language || '';
  b.innerHTML = `<div class="kHl"><button type="button" class="kLang" title="${esc(tr('app.editor.languageCode'))}">${esc(nameLanguage(language))} ▾</button><button type="button" class="kCancel" title="${esc(tr('app.editor.remove'))}">×</button></div>`
    + `<textarea class="kCode" rows="1" wrap="off" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="${esc(tr('app.editor.codePlaceholder'))}"></textarea>`;
  b.querySelector('.kCode').value = code || '';
  return b;
}
function newText(t) {
  const el = document.createElement('textarea');
  el.className = 'kText'; el.rows = 1; el.placeholder = tr('app.editor.textPlaceholder'); el.value = t || '';
  return el;
}
const editor = () => $('agEditor');
const allHeight = () => editor()?.querySelectorAll('.kCode, .kText').forEach(heightEl);
const onEnd = (el) => { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; };
const onStart = (el) => { el.focus(); el.selectionStart = el.selectionEnd = 0; };

// inserts a code block at the cursor position in a text field: text before stays, selected text goes into the block, text after goes below the block
function insertBlock(textEl, code, language) {
  const v = textEl.value, a = textEl.selectionStart, z = textEl.selectionEnd;
  const mark = code ?? v.slice(a, z), ago = v.slice(0, a).replace(/[ \t]*\n*$/, ''), za = v.slice(z).replace(/^\n+/, '');
  const b = newBlock(mark.replace(/^\n+|\s+$/g, ''), language ?? (mark.trim() ? guessLanguage(mark) : '')), t = newText(za);
  textEl.value = ago; textEl.after(b, t);
  heightEl(textEl); allHeight();
  const k = b.querySelector('.kCode'); if (k.value) onEnd(k); else k.focus();
  return b;
}
// removes a code block and appends the text below it to the text above it
function cancelBlock(b) {
  const ago = b.previousElementSibling, za = b.nextElementSibling;
  if (za?.classList.contains('kText')) {
    if (za.value.trim()) ago.value = ago.value.replace(/\s+$/, '') + (ago.value.trim() ? '\n' : '') + za.value;
    za.remove();
  }
  b.remove(); heightEl(ago); onEnd(ago);
}

// ---------- markdown ↔ editor ----------
export function editorText() {
  const el = $('agText'); if (!el) return '';
  let out = el.value;
  for (const x of editor()?.children || []) {
    if (x.classList.contains('kBlock')) {
      const code = x.querySelector('.kCode').value.replace(/\s+$/, ''); if (!code.trim()) continue;
      const plot = '`'.repeat(Math.max(3, ...[...code.matchAll(/^\s*(`{3,})/gm)].map((m) => m[1].length + 1)));
      out = out.replace(/\s+$/, '') + (out.trim() ? '\n\n' : '') + plot + (x.dataset.language || '') + '\n' + code + '\n' + plot;
    } else if (x.classList.contains('kText') && x.value.trim()) out = out.replace(/\s+$/, '') + '\n\n' + x.value;
  }
  return out.replace(/^\s*\n/, '').trimEnd(); // empty lines at the start removed, the indentation of the first line stays
}
export function setEditor(md) {
  const el = $('agText'), ed = editor(); if (!el || !ed) return;
  [...ed.children].forEach((x) => { if (x !== el) x.remove(); });
  const r = String(md || '').split('\n'), parts = [{ t: [] }];
  for (let i = 0; i < r.length; i++) {
    const m = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/.exec(r[i]);
    if (!m) { parts.at(-1).t.push(r[i]); continue; }
    const end = new RegExp(`^[ \\t]*${m[1][0] === '`' ? '`' : '~'}{${m[1].length},}[ \\t]*$`), code = [];
    let j = i + 1;
    for (; j < r.length && !end.test(r[j]); j++) code.push(r[j]);
    parts.push({ code: code.join('\n'), language: m[2] || '' }, { t: [] });
    i = j;
  }
  el.value = parts[0].t.join('\n').replace(/\s+$/, '');
  let last = el;
  for (const c of parts.slice(1)) {
    const x = c.t ? newText(c.t.join('\n').replace(/^\n+|\s+$/g, '')) : newBlock(c.code, c.language);
    last.after(x); last = x;
  }
  heightEl(el); allHeight();
}
export const clearEditor = () => setEditor('');
// where to put dictated text: the last text field where the cursor was (otherwise #agText)
export const textField = () => (ED.last?.isConnected ? ED.last : $('agText'));

// ---------- language picker (fixed above everything so the scrolling editor does not clip it) ----------
function closeMenu() { ED.menu?.remove(); ED.menu = null; }
function openMenu(btn) {
  const b = btn.closest('.kBlock'); if (ED.menu?.block === b) return closeMenu();
  closeMenu();
  const m = document.createElement('div');
  m.className = 'kMenu box'; m.block = b;
  m.innerHTML = LANGUAGES.map(([k, n]) => `<button type="button" data-lang="${k}" class="${k === b.dataset.language ? 'on' : ''}">${esc(n)}</button>`).join('');
  document.body.appendChild(m); ED.menu = m;
  const r = btn.getBoundingClientRect(), h = m.offsetHeight;
  m.style.left = r.left + 'px'; m.style.top = (r.top - h - 6 > 8 ? r.top - h - 6 : r.bottom + 6) + 'px';
  m.addEventListener('pointerdown', (e) => {
    const x = e.target.closest('[data-lang]'); if (!x) return;
    e.preventDefault(); b.dataset.language = x.dataset.lang; btn.textContent = nameLanguage(x.dataset.lang) + ' ▾';
    closeMenu(); b.querySelector('.kCode').focus();
  });
}

// ---------- keys in a code block ----------
function rows(el) { // start of the first and end of the last line of the selection
  const v = el.value, a = v.lastIndexOf('\n', el.selectionStart - 1) + 1;
  let z = v.indexOf('\n', Math.max(el.selectionEnd - (el.selectionEnd > el.selectionStart && v[el.selectionEnd - 1] === '\n' ? 1 : 0), el.selectionStart)); if (z < 0) z = v.length;
  return [a, z];
}
function transcription(el, a, z, t, s0, s1) {
  el.focus(); el.setSelectionRange(a, z);
  if (!document.execCommand('insertText', false, t)) el.setRangeText(t, a, z, 'end'); // insertText = ⌘Z works
  el.setSelectionRange(s0, s1); heightEl(el);
}
function indent(el, back) {
  const [a, z] = rows(el), r = el.value.slice(a, z).split('\n'), s0 = el.selectionStart, s1 = el.selectionEnd;
  if (!back && s0 === s1) { transcription(el, s0, s1, '\t', s0 + 1, s0 + 1); return; }
  const fresh = r.map((x) => (back ? x.replace(/^(\t| {1,4})/, '') : '\t' + x)), t = fresh.join('\n');
  const first = fresh[0].length - r[0].length;
  transcription(el, a, z, t, Math.max(a, s0 + first), s1 + (t.length - (z - a)));
}
function keyCode(e, el) {
  const b = el.closest('.kBlock');
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); return indent(el, e.shiftKey); }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); return ED.o.send(); }
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { // new line with the same indentation
    e.preventDefault();
    const v = el.value, a = v.lastIndexOf('\n', el.selectionStart - 1) + 1, ods = /^[ \t]*/.exec(v.slice(a, el.selectionStart))[0];
    const p = el.selectionStart + 1 + ods.length;
    return transcription(el, el.selectionStart, el.selectionEnd, '\n' + ods, p, p);
  }
  if (e.key === 'Backspace' && !el.value) { e.preventDefault(); return cancelBlock(b); }
  const withoutSelection = el.selectionStart === el.selectionEnd;
  if (e.key === 'ArrowDown' && withoutSelection && !el.value.slice(el.selectionStart).includes('\n')) { const n = b.nextElementSibling; if (n) { e.preventDefault(); onStart(n); } return; }
  if (e.key === 'ArrowUp' && withoutSelection && !el.value.slice(0, el.selectionStart).includes('\n')) { e.preventDefault(); onEnd(b.previousElementSibling); return; }
  if (e.key === 'Escape') { e.stopPropagation(); el.blur(); }
}
// text fields: a ``` line (with a language) + Enter = code block; in .kText Enter sends, arrows and Backspace pass into the block above/below
function keyText(e, el) {
  const withoutSelection = el.selectionStart === el.selectionEnd, v = el.value;
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.isComposing) {
    const a = v.lastIndexOf('\n', el.selectionStart - 1) + 1, m = /^\s*`{3,}\s*([\w+#.-]*)\s*$/.exec(v.slice(a, el.selectionStart));
    if (m) {
      e.preventDefault(); e.stopPropagation();
      el.setSelectionRange(a, el.selectionStart);
      const j = m[1].toLowerCase(), language = LANGUAGES.find((x) => x[0] === j || x[1].toLowerCase() === j)?.[0] ?? j;
      insertBlock(el, '', language); return;
    }
    if (el.id !== 'agText') { e.preventDefault(); e.stopPropagation(); $('agSend').click(); }
    return;
  }
  const za = el.nextElementSibling, ago = el.previousElementSibling;
  if (e.key === 'ArrowDown' && withoutSelection && za?.classList.contains('kBlock') && !v.slice(el.selectionStart).includes('\n')) { e.preventDefault(); e.stopPropagation(); onStart(za.querySelector('.kCode')); return; }
  if (el.id === 'agText') return; // other #agText keys are handled by panel.js and the command menu
  if ((e.key === 'ArrowUp' || e.key === 'Backspace') && withoutSelection && el.selectionStart === 0 && ago?.classList.contains('kBlock')) { e.preventDefault(); onEnd(ago.querySelector('.kCode')); }
}

// ---------- paste ----------
function insertion(e) {
  const el = e.target; if (!el.matches?.('#agText, .kText, .kCode')) return;
  const f = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file').map((it) => it.getAsFile());
  if (f.length) { e.preventDefault(); e.stopPropagation(); ED.o.addFiles(f); return; }
  const t = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
  if (!t || ED.clean) return; // ⌘⇧V = without processing
  if (el.classList.contains('kCode')) { // into a code block plain text (without \r), nothing is split
    e.preventDefault(); transcription(el, el.selectionStart, el.selectionEnd, t, el.selectionStart + t.length, el.selectionStart + t.length); return;
  }
  if (/^[ \t]*(`{3,}|~{3,})/m.test(t)) { // markdown with code blocks → split into blocks
    e.preventDefault();
    const a = el.selectionStart; el.setRangeText(t, a, el.selectionEnd, 'end');
    setEditor(editorText());
    const last = [...editor().querySelectorAll('#agText, .kText')].at(-1); onEnd(last);
    return;
  }
  if (!looksLikeCode(t)) return;
  e.preventDefault();
  const j = guessLanguage(t); insertBlock(el, t, j);
  const n = el.nextElementSibling?.nextElementSibling; if (n && !n.value) onStart(n); // after pasting you continue with text below the block
  ED.o.toast(tr('app.editor.inserted', { language: j ? ' (' + nameLanguage(j) + ')' : '' }));
}

// </> button: in a text field it inserts a block (selected text goes into it), in a code block it creates nothing new
export function insertBlockCode() {
  const ae = document.activeElement;
  const el = ae?.matches?.('#agText, .kText') ? ae : ae?.classList?.contains('kCode') ? null : textField();
  if (!el) return ae.focus();
  insertBlock(el);
}

export function initEditor(o) {
  ED.o = o;
  const ed = editor(); if (!ed) return;
  ed.addEventListener('keydown', (e) => {
    const el = e.target; if (e.isComposing) return;
    if (el.classList.contains('kCode')) return keyCode(e, el);
    if (el.id === 'agText' || el.classList.contains('kText')) keyText(e, el);
  }, true); // capture: before onkeydown on #agText (panel.js), so that ``` + Enter does not send the message
  ed.addEventListener('input', (e) => { if (e.target.matches('.kCode, .kText')) heightEl(e.target); });
  ed.addEventListener('focusin', (e) => { if (e.target.matches('#agText, .kText')) ED.last = e.target; });
  ed.addEventListener('paste', insertion, true);
  ed.addEventListener('click', (e) => {
    const lang = e.target.closest('.kLang'); if (lang) return openMenu(lang);
    const zr = e.target.closest('.kCancel'); if (zr) return cancelBlock(zr.closest('.kBlock'));
  });
  ed.addEventListener('mousedown', (e) => { if (e.target.closest('.kLang, .kCancel')) e.preventDefault(); }); // focus stays in the field
  addEventListener('keydown', (e) => { ED.clean = e.key.toLowerCase() === 'v' && e.shiftKey && (e.metaKey || e.ctrlKey); if (e.key === 'Escape' && ED.menu) { e.stopPropagation(); closeMenu(); } }, true);
  addEventListener('pointerdown', (e) => { if (ED.menu && !ED.menu.contains(e.target) && !e.target.closest('.kLang')) closeMenu(); }, true);
  const kb = $('codeBtn');
  kb.innerHTML = `<b>${esc(tr('app.editor.blockCode'))}</b><span>${esc(tr('app.editor.blockCodeDescription'))}</span>`;
  kb.title = tr('app.editor.blockCodeTitle');
  kb.onmousedown = (e) => e.preventDefault();
  kb.onclick = insertBlockCode;
}
