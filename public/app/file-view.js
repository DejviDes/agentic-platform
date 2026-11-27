// file-view.js – File preview (2026-11-17): file paths in the chat are clickable and open the #filePreview panel next to the chat (read-only),
// ⌘+click opens the file in Obsidian (when it is in the vault) or in the default app. Three entry points: inline `code` that looks like a path
// (after verification via /api/file/exist, the result is remembered), "📄 name" chips under the agent's reply (files written in the turn) and paths
// in the expanded list of steps. The panel is plain HTML without drawing; the open state is in state.js (filePreview).
// Markdown and code are drawn by functions from conversations.js (md → selectCode → blockCode), so coloring and formulas are the same as in bubbles.
// Modules are imported in a cycle: only declarations at top level, the panel element is created only in initFile.
import { active, filePreview, setState } from './state.js';
import { $, esc } from './utils.js';
import { withKey } from './lock.js';
import { CONV_STORE } from './api.js';
import { copy, convState, md, size } from './conversations.js';
import { attachVisuals } from './visual.js';
import { ico } from './icons.js';
import { t } from './i18n.js';

const INFO = new Map(); // `${base}\n${path}` → { info: { path, type, name, vault } | null, t }
const PENDING = new Map(); // keys waiting for batch verification
const NOT_FOUND = 60e3; // "does not exist" is remembered for a minute (the agent may have created it meanwhile), "exists" until the end of the page
let verifyT = 0, baseFn = () => '', toastS = () => {};
let S = { info: null, error: '', path: '', flow: 0, when: 0 }; // S.info = response of GET /api/file
let el = null;

const CONNECTION = /\.(md|markdown|js|mjs|cjs|ts|tsx|jsx|json|css|html?|txt|py|sh|zsh|ya?ml|toml|plist|log|csv|ics|svg|png|jpe?g|gif|webp|pdf|swift|c|h|cpp|java|hs|sql|xml|ini|conf|rtf|docx?|xlsx?|pptx?)$/i;
const NO_PATH = /[*?<>|"'`(){}=,;$\\]/;
const kl = (z, c) => `${z}\n${c}`;
const name = (c) => String(c).split('/').filter(Boolean).pop() || c;

// inline code text → path (without :line), or '' when it does not look like a path
export function pathFromCode(t) {
  const c = String(t || '').trim().replace(/(?::\d+){1,2}$/, '').replace(/#L\d+(?:-L?\d+)?$/, '');
  if (!c || c.length > 300 || NO_PATH.test(c) || (/\s/.test(c) && !/^(?:~|\.{0,2})\//.test(c)) || /^[a-z][a-z0-9+.-]*:\/\//i.test(c) || c.startsWith('-') || c.endsWith('/')) return '';
  return c.includes('/') || CONNECTION.test(c) ? c : '';
}

// ---------- existence check (batched, with memory) ----------
function fromMemory(z, c) {
  const e = INFO.get(kl(z, c));
  if (!e || (!e.info && Date.now() - e.t > NOT_FOUND)) return undefined;
  return e.info;
}
function demand(z, c) { const k = kl(z, c); if (PENDING.has(k)) return; PENDING.set(k, { z, c }); if (!verifyT) verifyT = setTimeout(() => { verifyT = 0; sendVerification(); }, 300); }
async function sendVerification() {
  const poZ = new Map();
  for (const { z, c } of PENDING.values()) { if (!poZ.has(z)) poZ.set(z, []); poZ.get(z).push(c); }
  PENDING.clear();
  if (INFO.size > 3000) INFO.clear();
  for (const [z, paths] of poZ) {
    for (let i = 0; i < paths.length; i += 50) {
      const batch = paths.slice(i, i + 50);
      try {
        const r = await fetch('/api/file/exist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: batch, base: z }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || r.status);
        for (const c of batch) INFO.set(kl(z, c), { info: d.results?.[c] || null, t: Date.now() });
      } catch { for (const c of batch) INFO.set(kl(z, c), { info: null, t: Date.now() - NOT_FOUND + 10000 }); } // server error: retried in 10 s
    }
  }
  if (active?.kind === 'floor') markFiles($('content'));
}
// inline `code` in finished agent bubbles that is an existing path becomes a link; unknown paths are queried (in a batch)
export function markFiles(root) {
  if (!root) return;
  const z = baseFn();
  for (const b of root.querySelectorAll('.msg.assistant')) {
    if (b.querySelector(':scope > .cursor')) continue; // the agent is still writing
    for (const c of b.querySelectorAll('code:not(.file)')) {
      const p = pathFromCode(c.textContent); if (!p) continue;
      const e = fromMemory(z, p);
      if (e === undefined) demand(z, p);
      else if (e) { c.classList.add('file'); c.dataset.file = p; c.title = t('app.file.previewTitle', { where: e.vault ? 'Obsidian' : t('app.file.openInApp') }); }
    }
  }
}

// ---------- chips under the agent's reply ----------
const WRITE = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// file path in a step: f (since 2026-11-17), in older conversations d (a path relative to the floor or ~/…, a click expands it with the base)
export const stepPath = (k) => k.f || ((WRITE.has(k.n) || k.n === 'Read') && k.d && k.d !== '.' ? k.d : '');

// ---------- click on a link ----------
export async function clickFile(path, base, meta) {
  let e = fromMemory(base, path);
  if (e === undefined) { demand(base, path); clearTimeout(verifyT); verifyT = 0; await sendVerification(); e = fromMemory(base, path); }
  if (!e) return toastS(t('app.file.notFound', { path }));
  if (meta) return openOutside(e.path, e.vault ? 'obsidian' : 'app');
  openPreview(e.path, base);
}
async function openOutside(path, where) {
  try {
    const r = await fetch('/api/file/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, where }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || r.status);
  } catch (e) { toastS(t('app.file.openingFailed', { reason: e.message })); }
}

// ---------- preview panel ----------
export function openPreview(path, base) {
  if (!el) return;
  const same = filePreview?.path === path;
  setState({ filePreview: { path, base } });
  document.body.classList.add('nsOpen');
  if (!same) S = { info: null, error: '', path, flow: S.flow, when: 0 };
  draw(same);
  load();
}
export function closePreview() {
  if (!filePreview) return;
  setState({ filePreview: null }); document.body.classList.remove('nsOpen'); wholeScreen(false);
  S = { info: null, error: '', path: '', flow: S.flow + 1, when: 0 };
  if (el) el.querySelector('.nsBody').innerHTML = '';
}
async function load() {
  const n = filePreview; if (!n) return;
  const flow = ++S.flow;
  try {
    const r = await fetch(`/api/file?path=${encodeURIComponent(n.path)}&base=${encodeURIComponent(n.base || '')}`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (flow !== S.flow || filePreview !== n) return;
    if (!r.ok || d.error) throw new Error(d.error || t('app.file.serverReturned', { code: r.status }));
    const unchanged = S.info && !S.error && S.info.changed === d.changed && S.info.size === d.size && S.info.path === d.path;
    S.info = d; S.error = ''; S.when = Date.now();
    if (!unchanged) draw(true);
  } catch (e) {
    if (flow !== S.flow || filePreview !== n) return;
    S.error = e.message; S.when = Date.now(); draw(true);
  }
}
// markdown: frontmatter as a yaml block, formulas and code as in bubbles; text: the whole file as a code block with the extension as the language
const plot = (t) => '`'.repeat(Math.max(3, ...(t.match(/`+/g) || []).map((x) => x.length + 1)));
const jeHtml = (d) => d && /^(html?|xhtml)$/i.test(String(d.extension || '').replace(/^\./, '')) && d.content != null;
// HTML as a page (2026-11-17): an iframe with srcdoc and a sandbox without allow-same-origin = opaque origin, no access to the city, API or key.
// Relative files next to the page (own css, images) are not loaded, CDN is.
function bodyHtml(d) {
  if (jeHtml(d) && read('html') !== 'code') return `<iframe class="nsWeb" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${esc(d.content)}" title="${esc(d.name)}"></iframe>`;
  if (d.type === 'image') return `<div class="nsImage"><img src="${esc(withKey(`/api/file/raw?path=${encodeURIComponent(d.path)}&z=${d.changed || ''}`))}" alt="${esc(d.name)}" decoding="async"></div>`;
  if (d.type === 'md' || d.type === 'text') {
    let txt = String(d.content ?? '');
    let h;
    if (d.type === 'md') {
      const fm = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(txt);
      if (fm) { const f = plot(fm[1]); txt = `${f}yaml\n${fm[1]}\n${f}\n` + txt.slice(fm[0].length); }
      h = md(txt);
    } else {
      const f = plot(txt), lang = txt.length > 200000 ? 'txt' : (d.extension || 'txt').replace(/^\./, '').replace(/[^\w+#-]/g, '') || 'txt'; // a large file is not colored
      h = md(`${f}${lang}\n${txt}\n${f}`);
    }
    return `<div class="msg assistant nsMd ${d.type}">${h}</div>${d.trimmed ? `<div class="nsNote">${esc(t('app.file.trimmed', { size: size(d.size) }))}</div>` : ''}`;
  }
  return `<div class="nsOther"><div class="nsIcon">${ico('document')}</div><b>${esc(d.name)}</b><span class="note">${esc(d.extension ? d.extension.replace(/^\./, '').toUpperCase() : t('app.file.file'))} · ${size(d.size)}<br>${esc(t('app.file.hide'))}</span><button type="button" class="btn p" data-ns="app">${esc(t('app.file.openInApp2'))}</button></div>`;
}
function draw(keepScrolling = false) {
  if (!el || !filePreview) return;
  const d = S.info, body = el.querySelector('.nsBody'), top = body.scrollTop;
  el.querySelector('.nsName').textContent = d?.name || name(filePreview.path);
  const rel = d?.rel || filePreview.path; el.querySelector('.nsRel').textContent = rel; el.querySelector('.nsRel').title = d?.path || filePreview.path;
  el.querySelector('[data-ns="obsidian"]').hidden = !d?.vault;
  const web = el.querySelector('[data-ns="web"]'); web.hidden = !jeHtml(d); web.textContent = read('html') === 'code' ? t('app.file.page') : t('app.file.code');
  body.classList.toggle('nsWebBody', !S.error && jeHtml(d) && read('html') !== 'code');
  if (WINDOW) document.title = (d?.name || name(filePreview.path)) + ' · ' + t('app.file.titleApp');
  body.innerHTML = S.error ? `<div class="nsError">${ico('warning')} ${esc(S.error)}</div>` : d ? bodyHtml(d) : `<div class="nsNote">${esc(t('app.file.loading'))}</div>`;
  attachVisuals(body);
  body.scrollTop = keepScrolling ? top : 0;
}
function use(type) {
  const n = filePreview; if (!n) return;
  if (type === 'close') return WINDOW ? window.close() : closePreview();
  if (type === 'refresh') return load();
  if (type === 'wrap') { const on = el.classList.toggle('nsWrap'); el.querySelector('[data-ns="wrap"]').classList.toggle('on', on); return save('wrap', on ? '1' : '0'); }
  if (type === 'web') { save('html', read('html') === 'code' ? '' : 'code'); return draw(); }
  if (type === 'whole') return wholeScreen(!document.body.classList.contains('nsWhole'));
  if (type === 'window') return openWindowFile(S.info?.path || n.path, n.base);
  openOutside(S.info?.path || n.path, type);
}
// ---------- width, full screen, new window ----------
const WINDOW = new URLSearchParams(location.search).has('file'); // separate file window (?file=<path>&base=…)
const read = (k) => { try { return localStorage.getItem('agentic-file-' + k) || ''; } catch { return ''; } };
const save = (k, v) => { try { if (v === '' || v == null) localStorage.removeItem('agentic-file-' + k); else localStorage.setItem('agentic-file-' + k, String(v)); } catch {} };
function setWidthNs(w, persist = true) {
  const pan = document.body.classList.contains('panelHidden') ? 0 : parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panelW')) || 420;
  const v = Math.round(Math.min(Math.max(320, innerWidth - pan - 80), Math.max(320, w)));
  document.documentElement.style.setProperty('--nsW', v + 'px');
  if (persist) save('width', v);
}
function wholeScreen(on) {
  document.body.classList.toggle('nsWhole', on);
  el?.querySelector('[data-ns="whole"]')?.classList.toggle('on', on);
  const b = el?.querySelector('[data-ns="whole"]'); if (b) { b.textContent = on ? '⤡' : '⤢'; b.title = on ? t('app.file.back') : t('app.file.whole'); }
}
function openWindowFile(path, base) { // like the conversation window (conversations.js openWindow): the card key is copied with sessionStorage
  const url = `${location.pathname}?file=${encodeURIComponent(path)}${base ? '&base=' + encodeURIComponent(base) : ''}`;
  const w = window.open(url, 'mesto-subor-' + path, 'popup=yes,width=900,height=1000');
  if (!w) return toastS(t('app.file.window'));
  if (!WINDOW) closePreview();
}
// separate file window: called by main.js after initialization
export function openWindowFromAddress() {
  const q = new URLSearchParams(location.search);
  openPreview(q.get('file') || '', q.get('base') || '');
}

export function initFile(toast, base) { // base() = folder of the open conversation (paths are verified and opened relative to it)
  toastS = toast || toastS; baseFn = base || baseFn;
  if (el) return;
  el = document.createElement('aside'); el.id = 'filePreview'; el.className = 'box';
  el.innerHTML = `<div class="nsTurn" title="${esc(t('app.file.drag'))}"></div><div class="nsH"><div class="nsWhom"><b class="nsName"></b><span class="nsRel mono"></span></div>
    <span class="nsBtns"><button type="button" class="nsBtn" data-ns="obsidian" hidden title="${esc(t('app.file.obsidianTitle'))}">Obsidian</button><button type="button" class="nsBtn" data-ns="web" hidden title="${esc(t('app.file.webTitle'))}">${esc(t('app.file.code'))}</button><button type="button" class="nsBtn" data-ns="app" title="${esc(t('app.file.appTitle'))}">${esc(t('app.file.open'))}</button><button type="button" class="nsBtn nsIco" data-ns="wrap" title="${esc(t('app.file.wrap'))}">⏎</button><button type="button" class="nsBtn nsIco" data-ns="whole" title="${esc(t('app.file.whole'))}">⤢</button><button type="button" class="nsBtn nsIco" data-ns="window" title="${esc(t('app.file.newWindow'))}">⧉</button><button type="button" class="nsBtn nsIco" data-ns="refresh" title="${esc(t('app.file.again'))}">${ico('refresh')}</button><button type="button" class="nsBtn nsIco" data-ns="close" title="${esc(t('app.file.closeEsc'))}">${ico('x')}</button></span></div>
    <div class="nsBody"></div>`;
  document.body.appendChild(el);
  // wrapping (on by default) and width are remembered
  el.classList.toggle('nsWrap', read('wrap') !== '0');
  el.querySelector('[data-ns="wrap"]').classList.toggle('on', el.classList.contains('nsWrap'));
  const w = parseInt(read('width')); if (w) setWidthNs(w, false);
  const turn = el.querySelector('.nsTurn');
  turn.onpointerdown = (e) => { // left edge: wider to the left (the preview is anchored to the right, next to the chat)
    e.preventDefault(); turn.setPointerCapture(e.pointerId); document.body.classList.add('nsDragging');
    const right = el.getBoundingClientRect().right;
    turn.onpointermove = (ev) => setWidthNs(right - ev.clientX, false);
    turn.onpointerup = () => { turn.onpointermove = turn.onpointerup = null; document.body.classList.remove('nsDragging'); save('width', Math.round(el.getBoundingClientRect().width)); };
  };
  turn.ondblclick = () => { document.documentElement.style.removeProperty('--nsW'); save('width', ''); };
  el.addEventListener('click', async (e) => {
    const tl = e.target.closest('[data-ns]');
    if (tl) return use(tl.dataset.ns);
    const k = e.target.closest('[data-copy]');
    if (k) { if (await copy(k.closest('.mdCode')?.querySelector('pre')?.textContent || '')) { k.textContent = t('app.file.copied'); setTimeout(() => { k.textContent = t('app.file.copy'); }, 1500); } else toastS(t('app.file.copyFailed')); }
  });
  // Esc closes the preview before focus mode or "back" react (the listener is registered before the others)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !filePreview || e.isComposing) return;
    if (e.target.closest?.('.meEdit, .convRename') || $('convMenu')?.classList.contains('on') || document.querySelector('#agChoiceUi.on, #plusUi.on, #commandUi.on')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (WINDOW) return; // the separate window is closed with ✕ or ⌘W
    if (document.body.classList.contains('nsWhole')) wholeScreen(false); else closePreview();
  }, true);
  // the file was written by the agent (SSE { kind: 'file', path }): the content is refreshed, scrolling stays (the same file = the same mtime is not redrawn)
  CONV_STORE.listen.add((type, d) => {
    // the agent showed a file (tool show_file): it opens only in the window where that conversation is currently open
    if (type === 'showFile') { if (!WINDOW && d?.path && convState.open != null && String(convState.open) === String(d.conv) && active?.kind === 'floor') openPreview(d.path, d.base); return; }
    if (type !== 'file' || !filePreview) return;
    if ([filePreview.path, S.info?.path, S.info?.rel].includes(d?.path)) { clearTimeout(S.sseT); S.sseT = setTimeout(load, 150); }
  });
  window.addEventListener('focus', () => { if (filePreview && Date.now() - S.when > 1000) load(); });
  // highlight.js or KaTeX were pulled in (conversations.js): redraw the body from the already loaded content
  window.addEventListener('city:render', () => { if (filePreview && S.info) draw(true); });
}
