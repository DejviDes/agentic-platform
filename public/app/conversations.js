// conversations.js – Phase 3: the right panel on the floor = conversations with real agents (per design v13b).
// List by people (lead, teammates, delegated tasks nested, older sessions from Claude Code), thread like in Claude Code
// (gradual text, collapsed steps, task list, delegation, Allow / Always / Deny cards, recruiting, memory), pinned bar
// with context and stopwatches, input field with microphone (local Whisper via /api/transcript) and subscription limits in the header.
// Re-renders only on change (signature), text during a stream is appended directly into one bubble without re-rendering.
import { withKey } from './lock.js';
import { t as T, tn as TN, locale, language } from './i18n.js';
import { active, homeModule, houseTab, focusConv, setState, workroom, DISTRICT } from './state.js';
import { $, esc, ago, STANDALONE } from './utils.js';
import { WORLD } from './world.js';
import { SOURCE } from './source.js';
import { HOME_BUILDINGS, HOME_CHAT_EXAMPLES, HOME_TEAM } from './demo-data.js';
import { runningInBackground, threadNumber, agentIndex, card, CONV_STORE, loadConv, loadFloor, loadCommands, send as apiSend, sendImmediately, permission, isReal, cancelFromQueue, messageApp, messageNewSession, messageConv, stop as apiStop } from './api.js';
import './lightbox.js';
import { attachVisuals, visualBlock, park } from './visual.js'; // ```visual and ```video as a window in the message
import { stepPath, initFile, clickFile, markFiles } from './file-view.js'; // file preview: links to paths, panel next to the chat
import { initEditor, setEditor, editorText, textField, clearEditor } from './editor.js';
import { ico, agentIcon } from './icons.js';
import { openUsage } from './usage-window.js'; // Usage limit window: which session used how much (click on the limits ring)
import { fileIcon } from './file-type.js'; // attachment icon by extension
import { dispatchCardHtml, dispatchCardClick, dispatchCardClose, isDispatch, loadReady, openDispatch, readyCount } from './dispatch.js'; // Dispatch: task card in the chat and the Ready panel
import { M } from './modules.js';
import { brainSectionsHtml } from './brain.js'; // Brain detail: Today in the brain and Orphaned notes

const CONV = { delegChoice: new Map(), alert: null, alertMode: null, rename: null, renameText: '', upMe: null, selectMode: false, selected: new Set(), confirm: null, choice: new Map(), where: new Map(), open: null, recipient: 'lead', tab: 'conv', draw: '', openSteps: new Set(), edit: new Map(), appText: new Map(), questions: new Map(), reason: new Set(), mic: 'none', micStart: 0, rec: null, allOld: false, childrenOpen: new Set(), pasted: true, scrollTop: 0, renderT: null, last: '', image: [], attachment: [], imagePreparing: 0, draft: null };
export const convState = CONV;
const RUNNING = ['running', 'pending'];
// usage (2026-11-11): estimated % of the 5-hour limit from the server (usage.js), only format and color here
const fmtP = (p) => (p < 0.1 ? '<' + (0.1).toLocaleString(locale()) : p < 10 ? p.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : String(Math.round(p)));
const trP = (p, warn = 0.5, err = 2) => (p >= err ? 'err' : p >= warn ? 'warn' : '');
// estimate on the delegation card: the teammate's own tasks, otherwise a rough estimate by the chosen model and effort (2026-11-13)
function estimateDeleg(s, a, vol) {
  if (s.estimate) return T('app.conv.estimateSimilar', { name: esc(a.name), n: s.estimate.n, p: fmtP(s.estimate.p) });
  const exact = s.estimatesModel?.[`${vol.model}/${vol.effort}`], o = exact || s.estimatesModel?.[vol.model];
  if (!o) return T('app.conv.estimateNone1');
  return T('app.conv.estimateFirst', { model: esc(vol.model) + (exact ? `/${esc(vol.effort)}` : ''), n: o.n, p: fmtP(o.p) });
}
// estimate on the bulk card: sum of the task estimates, otherwise a rough estimate by model and effort times the number of tasks (computed by the server)
function estimateGroups(s, vol) {
  if (s.estimate) return T('app.conv.estimateTotal', { p: fmtP(s.estimate.p), n: s.tasks.length });
  const exact = s.estimatesModel?.[`${vol.model}/${vol.effort}`], o = exact || s.estimatesModel?.[vol.model];
  if (!o) return T('app.conv.estimateNone2');
  return T('app.conv.estimateRough', { model: esc(vol.model) + (exact ? `/${esc(vol.effort)}` : ''), p: fmtP(o.p) });
}
const MOD_AG = [['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus']], EF_AG = ['low', 'medium', 'high', 'xhigh'];

// ---------- helpers ----------
const duration = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// ---------- markdown in bubbles ----------
// **bold**, *italic*, `code`, ```code``` blocks, headings, bullets and numbered lists, tables and formulas ($…$, $$…$$, \(…\), \[…\])
// via KaTeX. Everything goes through esc, links stay as text. KaTeX (local from node_modules, /vendor/katex/) is loaded only on the first
// formula, until then the formula is shown as source text. Rendered formulas are remembered, so neither a stream nor a re-render recomputes them.
let KATEX = null, katexStatus = 'none';
const texCache = new Map();
function loadKatex() {
  if (katexStatus !== 'none') return; katexStatus = 'loading';
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/vendor/katex/katex.min.css'; document.head.appendChild(l);
  import('/vendor/katex/katex.mjs').then((m) => { KATEX = m.default; katexStatus = 'done'; texCache.clear(); renderConv(true); window.dispatchEvent(new Event('city:render')); })
    .catch((e) => { katexStatus = 'error'; console.warn('KaTeX sa nenačítal:', e); });
}
function tex(src, block) {
  if (!KATEX) { loadKatex(); return `<span class="mdTex${block ? ' block' : ''}">${esc(src)}</span>`; }
  const kl = (block ? 'B' : 'I') + src;
  let h = texCache.get(kl);
  if (h == null) {
    try { h = KATEX.renderToString(src, { displayMode: block, throwOnError: false, output: 'html', strict: 'ignore' }); } catch { h = `<span class="mdTex">${esc(src)}</span>`; }
    if (texCache.size > 800) texCache.clear();
    texCache.set(kl, h);
  }
  return block ? `<div class="mdMath">${h}</div>` : h;
}
// code blocks: fence ``` or ~~~ also indented in a list (the indentation is removed from the code), an unclosed block (the agent is still writing) extends
// to the end. With a language it is highlighted via highlight.js (local from node_modules, /vendor/hljs/): the core and the language grammar are
// loaded only on the first such block, only a closed block is highlighted and the result is remembered, so a stream does not recompute it.
// A block without a language is output (messages, logs) and wraps.
const HL_LANG = { haskell: 'haskell', hs: 'haskell', ghci: 'haskell', python: 'python', py: 'python', python3: 'python', javascript: 'javascript', js: 'javascript', mjs: 'javascript', jsx: 'javascript',
  typescript: 'typescript', ts: 'typescript', tsx: 'typescript', bash: 'bash', sh: 'bash', zsh: 'bash', shell: 'bash', sql: 'sql', json: 'json', c: 'c', h: 'c', cpp: 'cpp', 'c++': 'cpp',
  java: 'java', csharp: 'csharp', cs: 'csharp', 'c#': 'csharp', yaml: 'yaml', yml: 'yaml', html: 'xml', xml: 'xml', css: 'css', diff: 'diff', markdown: 'markdown', md: 'markdown' };
let HL = null, hlCore = null;
const hlStatus = new Map(), hlCache = new Map();
function loadLanguage(j) {
  if (hlStatus.has(j)) return; hlStatus.set(j, 'loading');
  (hlCore ||= import('/vendor/hljs/core.min.js').then((m) => (HL = m.default)))
    .then(() => import(`/vendor/hljs/languages/${j}.min.js`))
    .then((g) => { HL.registerLanguage(j, g.default); hlStatus.set(j, 'done'); renderConv(true); window.dispatchEvent(new Event('city:render')); })
    .catch((e) => { hlStatus.set(j, 'error'); console.warn('highlight.js sa nenačítal:', e); });
}
function highlight(code, j) {
  if (hlStatus.get(j) !== 'done') { loadLanguage(j); return esc(code); }
  const kl = j + '\u0001' + code;
  let h = hlCache.get(kl);
  if (h == null) {
    try { h = HL.highlight(code, { language: j, ignoreIllegals: true }).value; } catch { h = esc(code); }
    if (hlCache.size > 300) hlCache.clear();
    hlCache.set(kl, h);
  }
  return h;
}
// ▶ in the terminal (2026-11-14): only a closed bash block (without comments, empty lines, "$ ", a continuation "\" is joined).
// Multiple commands (2026-11-15) are joined with " && " into one line (iTerm would send each line immediately), a line ending with
// | && || is joined with a space. Heredocs and multi-line constructs (if, for, while, case, functions) have no ▶. You press Enter.
function oneCommand(code) {
  const r = code.replace(/\\\n\s*/g, ' ').split('\n').map((x) => x.trim().replace(/^\$\s+/, '')).filter((x) => x && !x.startsWith('#'));
  if (!r.length || r.length > 12) return '';
  if (r.length > 1 && r.some((x) => /<<|^(if|then|else|elif|fi|for|while|until|do|done|case|esac)(\s|;|$)|[{}]\s*$/.test(x))) return '';
  let p = r[0];
  for (let i = 1; i < r.length; i++) p += (/(\||&&|\|\|)$/.test(p) || /^(\||&&|\|\|)/.test(r[i]) ? ' ' : ' && ') + r[i];
  return p.length <= 2000 ? p : '';
}
function blockCode(code, language, closed) {
  if (/^(vizual|video)$/i.test(language)) return visualBlock(code, language, closed);
  const j = HL_LANG[language.toLowerCase()], start = j === 'bash' && closed ? oneCommand(code) : '';
  return `<div class="mdCode${language ? '' : ' output'}"><div class="mdCodeH"><span>${esc(language)}</span><span>${start ? `<button type="button" class="mdCopy" data-start="${esc(start)}" title="${T('app.conv.startTitle')}">${ico('play')} ${T('app.conv.terminal')}</button>` : ''}<button type="button" class="mdCopy" data-copy>${T('app.conv.copy')}</button></span></div>`
    + `<pre class="mdPre">${j && closed ? highlight(code, j) : esc(code)}</pre></div>`;
}
function selectCode(s, save) {
  const r = s.split('\n'), out = [];
  for (let i = 0; i < r.length; i++) {
    const m = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/.exec(r[i]);
    if (!m) { out.push(r[i]); continue; }
    const [, indent, plot, language] = m, code = [];
    const end = new RegExp(`^[ \\t]*${plot[0] === '`' ? '`' : '~'}{${plot.length},}[ \\t]*$`), crop = new RegExp(`^[ \\t]{0,${indent.length}}`);
    let j = i + 1;
    for (; j < r.length && !end.test(r[j]); j++) code.push(r[j].replace(crop, ''));
    out.push(save(blockCode(code.join('\n'), language, j < r.length), true));
    i = j;
  }
  return out.join('\n');
}
const inl = (x) => x.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, '$1<i>$2</i>');
const ROW_TAB = /^\s*\|.*\|\s*$/, SEPARATE_TAB = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
// ja = my message: a plain line keeps its indentation and multiple spaces in a row (HTML would collapse them), tab = 4 spaces
const spaces = (x) => x.replace(/\t/g, '    ').replace(/^ +| {2,}/g, (m) => '\u00a0'.repeat(m.length));
export function md(t, user = false) {
  const hold = [], blocks = new Set();
  const save = (html, block = false) => { const i = hold.push(html) - 1; if (block) blocks.add(i); return `\u0000${i}\u0000`; };
  let s = String(t || '');
  // 1. code (nothing is rendered inside), 2. formulas, only then escape and lines
  s = selectCode(s, save);
  s = s.replace(/`([^`\n]+)`/g, (_, c) => save(`<code>${esc(c)}</code>`));
  s = s.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_, a, b) => '\n' + save(tex((a ?? b).trim(), true), true) + '\n');
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, a) => save(tex(a.trim(), false)));
  s = s.replace(/(^|[^\\$\w])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?![\w$])/g, (_, ago, a) => ago + save(tex(a, false)));
  const r = esc(s).split('\n'), out = []; // out: { h, block }
  for (let i = 0; i < r.length; i++) {
    const x = r[i];
    if (ROW_TAB.test(x) && SEPARATE_TAB.test(r[i + 1] || '')) {
      const cells = (y) => y.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const zar = cells(r[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      const td = (c, j, tag) => `<${tag}${zar[j] ? ` style="text-align:${zar[j]}"` : ''}>${inl(c)}</${tag}>`;
      let h = `<div class="mdTab"><table><thead><tr>${cells(x).map((c, j) => td(c, j, 'th')).join('')}</tr></thead><tbody>`;
      for (i += 2; i < r.length && ROW_TAB.test(r[i]); i++) h += `<tr>${cells(r[i]).map((c, j) => td(c, j, 'td')).join('')}</tr>`;
      i--; out.push({ h: h + '</tbody></table></div>', block: true }); continue;
    }
    const m = /^\u0000(\d+)\u0000$/.exec(x.trim());
    if (m && blocks.has(+m[1])) { out.push({ h: x.trim(), block: true }); continue; }
    if (/^#{1,4}\s/.test(x)) { out.push({ h: `<b class="mdH">${inl(x.replace(/^#{1,4}\s/, ''))}</b>`, block: true }); continue; }
    if (/^\s*[-*•]\s/.test(x)) { out.push({ h: `<span class="mdLi${/^\s{2,}/.test(x) ? ' nest' : ''}">${inl(x.replace(/^\s*[-*•]\s/, ''))}</span>`, block: true }); continue; }
    const c = /^(\s*)(\d+)[.)]\s(.*)$/.exec(x);
    if (c) { out.push({ h: `<span class="mdLi cis${c[1].length >= 2 ? ' nest' : ''}" data-c="${c[2]}.">${inl(c[3])}</span>`, block: true }); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(x)) { out.push({ h: '<hr class="mdHr">', block: true }); continue; }
    if (/^&gt;\s?/.test(x)) { out.push({ h: `<span class="mdQuote">${inl(x.replace(/^&gt;\s?/, ''))}</span>`, block: true }); continue; }
    out.push({ h: inl(user ? spaces(x) : x), block: false });
  }
  // <br> only between two lines of text (blocks wrap on their own)
  let h = '';
  out.forEach((o, i) => { if (i && !o.block && !out[i - 1].block) h += '<br>'; h += o.h; });
  return h.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[+i]);
}
// screenshots in my bubble (click opens the browser from lightbox.js, ⌘+click a new tab)
const imagesHtml = (o) => (o?.length ? `<div class="convImage">${o.map((m) => { const u = withKey(`/api/image?id=${encodeURIComponent(m)}`); return `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="screenshot" decoding="async"></a>`; }).join('')}</div>` : '');
// attachments in my bubble: a small card with name and size, click opens a copy (PDF and text in the browser, others are downloaded)
const attachmentsHtml = (pr) => (pr?.length ? `<div class="convAttachment">${pr.map((p) => `<a href="${withKey(`/api/attachment?id=${encodeURIComponent(p.id)}`)}" target="_blank" rel="noopener" title="${esc(p.title)}">${fileIcon(p.title)}<span class="tx"><b>${esc(p.title)}</b><i>${size(p.size)}</i></span></a>`).join('')}</div>` : '');
function agentFor(P, slug) {
  const i = agentIndex(P, slug);
  return i != null ? P.agents[i] : { name: slug === 'general-purpose' ? T('app.conv.helper') : slug, emoji: '👤', color: '#9a968c', role: T('app.conv.subagentWithout'), i: null, k: slug };
}
const convFloor = (pid) => [...CONV_STORE.conv.values()].filter((k) => k.floor === pid);
const find = (pid, id) => CONV_STORE.conv.get(id) || (CONV_STORE.floors.get(pid)?.old || []).find((s) => s.id === id);

// ---------- chat floor (2026-11-18): a regular floor or a Home building ----------
// A Home building (virtual floor domov/<k> on the server, home-floors.js) is not in WORLD. The chat in it (Chat tab in the building,
// houseTab 'chat') gets P in the same shape as a floor: def.id, def.n, agents[0] = lead (name and emoji from /api/world, field home).
// It has no teammates (withoutTeam), the figures and tasks in 3D do not change (api.js does not find its projection), selectedAgent is not set.
const HOUSE_P = new Map();
export const hasHomeChat = (k) => !!k && k !== 'postman' && isReal() && !!SOURCE.home?.some((p) => p.id === 'home/' + k);
export const homeChat = () => (active?.kind !== 'floor' && DISTRICT === 'home' && houseTab === 'chat' && hasHomeChat(homeModule) ? homeModule : null);
export function homeFloorP(k) {
  let P = HOUSE_P.get(k); if (P) return P;
  const d = SOURCE.home.find((p) => p.id === 'home/' + k), b = HOME_BUILDINGS.find((x) => x.k === k), ch = HOME_TEAM[k]?.find((a) => a.chat), v = d?.lead || {};
  P = { dk: k, def: { id: 'home/' + k, n: b?.title || d?.n || k, path: '', shortPath: '' },
    agents: [{ k: 'lead', i: 0, lead: true, home: true, name: v.name || T('app.conv.manager'), emoji: v.emoji || '🏠', color: ch?.color || '#9a968c', role: ch?.role || T('app.conv.agentBuilding') }] };
  HOUSE_P.set(k, P); return P;
}
export function chatP() {
  if (active?.kind === 'floor') return WORLD.floors.get(active.n) || null;
  const k = homeChat(); return k ? homeFloorP(k) : null;
}
const selectAg = (P, slug) => { if (!P.dk) setState({ selectedAgent: slug == null ? null : agentIndex(P, slug) }); }; // figure on the floor (not in Home)

// ---------- opening ----------
export function openConv(id) {
  saveDraft();
  CONV.open = id; CONV.tab = 'conv'; CONV.draw = '';
  const P = chatP(), k = id && P ? find(P.def.id, id) : null;
  if (k) CONV.recipient = k.agent;
  loadDraft();
  if (!P?.dk) setState({ selectedAgent: k && P ? agentIndex(P, k.agent) : null });
  if (id && !CONV_STORE.messages.get(id)?.length) { CONV_STORE.errors.delete(id); loadConv(id); }
  CONV.pasted = true; renderConv(); const o = $('content'); o.scrollTop = id == null ? 0 : 1e6; arrowDown();
  if (id != null && !focusConv && wantsFocus()) setFocus(true);
}
// click on a team member or figure: their latest conversation, otherwise a new one
export function openAgent(i) {
  if (i == null) { const k = CONV.open && CONV_STORE.conv.get(CONV.open); return openConv(k?.parent ?? null); }
  const P = chatP(), a = P?.agents[i]; if (!a) return;
  const mine = convFloor(P.def.id).filter((k) => k.agent === a.k).sort((x, y) => (y.changed || 0) - (x.changed || 0));
  saveDraft(); CONV.recipient = a.k; CONV.who = a.lead ? null : a.k; // click on an agent in Team = also a filter of the conversation list
  if (mine[0]) openConv(mine[0].id);
  else { CONV.open = null; CONV.draw = ''; loadDraft(); if (!P.dk) setState({ selectedAgent: i }); renderConv(); $('agText').focus(); }
}
// router in Overview and Workroom (2026-11-17): a new conversation with an agent, the text from the router is added to the draft,
// images and files are added by the user here (⌘V, drag and drop, 📎) and sent by them. Called only after entering the floor (or the Home building chat).
export function newConvWith(agent, text = '') {
  const P = chatP(); if (!P) return;
  saveDraft(); Object.assign(CONV, { recipient: agent || 'lead', open: null, tab: 'conv', draw: '', pasted: true });
  loadDraft();
  if (text.trim()) { const t = editorText().trimEnd(); setEditor(t ? `${t}\n\n${text}` : text); height(); }
  selectAg(P, CONV.recipient); renderConv(); $('content').scrollTop = 0;
  setTimeout(() => $('agText')?.focus(), 0);
}
// ---------- drafts (UX audit 2026-11-17) ----------
// A message being written and prepared attachments belong to the conversation (k:<id>), for a new conversation to the floor and agent (n:<floor>:<agent>),
// not to one shared field: on switching they are saved and restored on return, so nothing goes to the wrong agent. Only in the card's memory.
// KV.koncept = the key that the editor content belongs to (false = already saved, editor is empty; null = nobody yet, the key is computed later).
// Texts (without attachments) are also in the card's sessionStorage, so they survive F5 and the app's auto-reload (control-center.js).
const DRAFTS = new Map(), DRAFTS_KEY = 'city-drafts';
let draftsLoad = false;
function drafts() {
  if (!draftsLoad) { draftsLoad = true; try { for (const [k, t] of JSON.parse(sessionStorage.getItem(DRAFTS_KEY) || '[]')) if (!DRAFTS.has(k)) DRAFTS.set(k, { text: t, image: [], attachment: [] }); } catch {} }
  return DRAFTS;
}
const keyConcept = () => (CONV.open != null ? 'k:' + CONV.open : `n:${active?.kind === 'floor' ? active.n : chatP()?.def.id || ''}:${CONV.recipient || 'lead'}`);
function saveDraft() {
  if (CONV.draft === false) return;
  const kl = CONV.draft ?? keyConcept(), text = editorText(), m = drafts();
  if (text.trim() || CONV.image.length || CONV.attachment.length) m.set(kl, { text, image: CONV.image, attachment: CONV.attachment }); else m.delete(kl);
  CONV.image = []; CONV.attachment = []; CONV.draft = false;
  try { sessionStorage.setItem(DRAFTS_KEY, JSON.stringify([...m].filter(([, c]) => c.text.trim()).map(([k, c]) => [k, c.text]))); } catch {}
}
function loadDraft() {
  CONV.draft = keyConcept(); const c = drafts().get(CONV.draft);
  setEditor(c?.text || ''); CONV.image = c?.image || []; CONV.attachment = c?.attachment || []; height(); drawImage();
}
// for the app's auto-reload (control-center.js): the open conversation and whether anything being written cannot be saved (dictation, attachments)
export const convStateRefresh = () => ({ open: CONV.open, mic: CONV.mic, attachments: CONV.image.length + CONV.attachment.length + CONV.imagePreparing });
export function resetConv() { saveDraft(); Object.assign(CONV, { open: null, recipient: 'lead', tab: 'conv', draw: '', allOld: false, who: null, oldOpen: null }); CONV.openSteps.clear(); loadDraft(); }
export const toggleTab = (t) => { CONV.tab = t; CONV.draw = ''; };

// ---------- rendering ----------
const stopwatch = (v) => (!v ? '' : v.status === 'running' && v.app ? `<span class="spin"></span>${ico('monitor')} ${T('app.conv.stopApp')}${v.start ? ' · ' + duration(Date.now() - v.start) : ''}` : v.status === 'running' ? `<span class="spin"></span>${T('app.conv.stopWorking')}${v.start ? ' ' + duration(Date.now() - v.start) : ''}`
  : v.status === 'pending' ? `${ico('pending')} ${T('app.conv.stopPending')}${v.start ? ' · ' + duration(Date.now() - v.start) : ''}` : v.status === 'reply' ? `${ico('chat')} ${T('app.conv.stopReply')}${v.duration ? ' · ' + T('app.conv.stopTurn', { t: duration(v.duration) }) : ''}`
  : v.status === 'error' ? ico('warning') + ' ' + T('app.conv.stopError') : v.status === 'none' && v.duration ? `${ico('stop')} ${T('app.conv.stopStopped', { t: duration(v.duration) })}` : v.duration ? `✓ ${T('app.conv.stopDone', { t: duration(v.duration) })}` : '');
// List per design v13c: chips to filter by people, "Now" (running, waiting for approval or for your answer), then
// conversations from the newest with the avatar of the one you are talking to. Tasks the lead assigned to teammates are labels inside
// the conversation they came from; in a teammate's filter they are his rows. Older sessions from Claude Code are collapsed at the bottom
// (expanded when the floor has no other conversation in the app).
const NOW = ['pending', 'running', 'reply'];
const nameC = (v, a) => esc(a.name) + (threadNumber(v) ? ` #${threadNumber(v)}` : ''); // "Engine room #2" when the same person runs in several threads
const statusPoint = (v) => (v.status === 'pending' ? 'pending' : v.status === 'running' ? 'work' : v.status === 'reply' ? 'delegates' : 'none');
// agent plan { h done steps, n all, step in progress } → percentage as before in the Tasks tab (without a plan we do not know, it stays "running")
const pctPlan = (v) => (v.plan?.n ? `${Math.round(Math.min(0.97, (v.plan.h + (v.plan.step ? 0.5 : 0)) / v.plan.n) * 100)} %` : '');
const symbolStatus = (v) => (v.status === 'pending' ? '<span class="convSymbol pending">' + ico('pending') + ' ' + T('app.conv.symbolApprove') + '</span>' : v.status === 'running' ? `<span class="convSymbol running">${pctPlan(v) || T('app.conv.symbolRunning')}</span>` : v.status === 'reply' ? `<span class="convSymbol ans">${T('app.conv.symbolAns')}</span>` : v.status === 'error' ? `<span class="convSymbol error">${T('app.conv.symbolError')}</span>` : '');
const menuBtn = (id) => `<button class="convMenuBtn" data-menu="${esc(id)}" title="${T('app.conv.menuTitle')}">⋯</button>`;
const renameField = (id) => `<input class="convRename" data-rename="${esc(id)}" value="${esc(CONV.renameText)}" maxlength="120" spellcheck="false"><button class="convPlus" data-ulozmeno="${esc(id)}">${T('app.conv.save')}</button>`;
export const timeShort = (ms) => { if (!ms) return ''; const m = (Date.now() - ms) / 60000; return m < 2 ? T('app.conv.timeNow') : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : m < 2880 ? T('app.conv.timeYesterday') : `${Math.round(m / 1440)} ${T('app.conv.timeDay')}`; };
const pluralTeammate = (n) => TN('app.conv.teammates', n);
function row(v, P, vs, children = true) {
  const select = CONV.selectMode, chk = select ? `<span class="convChk ${CONV.selected.has(v.id) ? 'on' : ''}">${CONV.selected.has(v.id) ? '✓' : ''}</span>` : '';
  const click = select ? `data-pick="${esc(v.id)}"` : CONV.rename === v.id ? '' : `data-v="${esc(v.id)}"`;
  if (CONV.rename === v.id) return `<div class="convR convEdit">${renameField(v.id)}</div>`;
  if (v.old) return `<div class="convR old ${select ? 'select' : ''}" ${click} title="${T('app.conv.sessionCC')}">${chk}<div class="tx"><b>${esc(v.title)}</b></div><span class="convEnd"><span class="convTime">${esc(timeShort(v.changed))}</span>${select ? '' : menuBtn(v.id)}</span></div>`;
  if (select) children = false;
  const a = agentFor(P, v.agent), rod = v.parent ? CONV_STORE.conv.get(v.parent) : null;
  const meta = [ago(v.changed), v.context ? T('app.conv.context', { p: Math.round(v.context * 100) }) : '', v.usageP ? `≈ ${fmtP(v.usageP)} % ${T('app.conv.z5h')}` : '', v.count ? TN('app.conv.make', v.count) : ''].filter(Boolean).join(' · ');
  const tip = (a.lead ? '' : a.name + (threadNumber(v) ? ` #${threadNumber(v)}` : '') + ' · ') + (rod ? T('app.conv.taskFrom', { title: rod.title }) : meta + (v.direct ? ' · ' + T('app.conv.direct') : ''));
  const d = children ? vs.filter((x) => x.parent === v.id) : [];
  let under = '';
  if (d.length) {
    const open = CONV.childrenOpen.has(v.id), pending = d.filter((x) => x.status === 'pending').length;
    under = `<button class="convChildrenToggle ${pending ? 'pending' : ''}" data-children="${esc(v.id)}">${open ? '▾' : '↳'} ${pluralTeammate(d.length)}${pending ? ` · ${T('app.conv.pending', { n: pending })}` : ''}</button>`;
    if (open) under += `<div class="convChildren">${d.map((x) => { const z = agentFor(P, x.agent); return `<span class="convChild ${statusPoint(x)}" data-v="${esc(x.id)}" title="${T('app.conv.openTask')}">${agentIcon(z, 'xs')} ${nameC(x, z)} · ${esc(x.title)} ${x.status === 'pending' ? ico('pending') : x.status === 'running' ? '…' : x.status === 'error' ? ico('warning') : '✓'}</span>`; }).join('')}</div>`;
  }
  const symbol = symbolStatus(v);
  return `<div class="convR ${NOW.includes(v.status) ? 'now' : ''} ${select ? 'select' : ''}" ${click} title="${esc(tip)}">${chk}
    <div class="tx"><b>${v.status === 'running' || v.status === 'pending' ? `<i class="point ${statusPoint(v)}"></i>` : ''}<span class="tt">${esc(v.title)}</span>${v.pinned ? `<span class="convPin" title="${T('app.conv.pinnedOne')}">${ico('pin')}</span>` : ''}${a.lead ? '' : `<span class="convWho">${nameC(v, a)}</span>`}</b>${under}</div><span class="convEnd">${symbol || `<span class="convTime">${esc(timeShort(v.changed))}</span>`}${select ? '' : menuBtn(v.id)}</span></div>`;
}
function listHtml(n, P) {
  const pid = P.def.id, info = CONV_STORE.floors.get(pid), vs = convFloor(pid), old = info?.old || [];
  if (CONV.who && !P.agents.some((a) => a.k === CONV.who)) CONV.who = null;
  const who = CONV.who ? agentFor(P, CONV.who) : agentFor(P, 'lead');
  const actionsAbove = `<span class="convAboveIf">${CONV.selectMode ? `<button class="convPlus" data-vyberrezim="1">${T('app.conv.done')}</button>` : `<button class="convIco" data-create="${esc(who.k)}" title="${T('app.conv.newWith', { name: esc(who.lead && !who.home ? T('app.conv.lead') : who.name) })}">+</button><button class="convIco" data-nadmenu="1" title="${T('app.conv.select')}">⋯</button>`}</span>`;
  // Home building: building header with tabs (home.js) instead of the floor title (Tasks tab removed 2026-11-18, its best part is here)
  let h = P.dk ? `${M.home?.homeChatHead(P.dk) || ''}<div class="headline convAbove convAboveHouse"><span class="mono">${agentIcon(who, 'xs')} ${T(/^[szšžSZŠŽ]/.test(who.name) ? 'app.conv.convSo' : 'app.conv.convWith', { name: esc(recipientName(who, true)) })}</span>${actionsAbove}</div>`
    : `<div class="headline convAbove"><span class="serif">${T('app.conv.conversations')}</span>${CONV.who ? `<button class="convFilter" data-who="" title="${T('app.conv.cancelFilter')}">${esc(who.name)} ${ico('x')}</button>` : ''}${actionsAbove}</div>`;
  if (pid === 'brain') h += brainSectionsHtml(); // Second Brain: agent activity and orphaned notes (brain.js)
  if (!info?.loaded && !info?.error) h += `<div class="empty">${T('app.conv.loading')}</div>`;
  if (info?.error) h += `<div class="chip error">${ico('warning')} ${esc(info.error)}</div>`;
  if (P.dk && !vs.length && info?.loaded) { // empty building: one sentence and examples (a click only types them into the field, you send it yourself)
    const pr = HOME_CHAT_EXAMPLES[P.dk] || [];
    return h + `<div class="convNew convNewHouse"><b>${T('app.conv.houseEmptinessAbove', { name: esc(who.name) })}</b><p>${T('app.conv.houseEmptinessText')}</p>${pr.length ? `<div class="convExamples">${pr.map((t) => `<button class="convExample" data-example="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}</div>`;
  }
  if (isDispatch(pid)) { // Dispatch: chat as elsewhere, plus a link to ready tasks (window from dispatch.js) and its own intro instead of "Start with the lead"
    if (!CONV.disppr) { CONV.disppr = true; loadReady().then(() => { CONV.draw = ''; renderConv(); }); }
    h += `<div class="convSec">${T('app.conv.ready')} <em>${readyCount()}</em><button class="convPlus" data-disppr="1" title="${T('app.conv.readyTitle')}">${T('app.conv.open')}</button></div>`;
    if (!vs.length && !old.length) return h + `<div class="convNew"><div class="mono">${T('app.conv.dispatchTitle')} · ${esc(info?.path || P.def.path || '')}</div><b>${T('app.conv.dispatchAbove')}</b>
      <p>${T('app.conv.dispatchText')}</p>
      <button class="btn p" data-create="lead">${T('app.conv.dispatchNew')}</button></div>`;
  }
  if (!P.dk && !vs.length && !old.length && P.agents.length === 1) return h + `<div class="convNew"><div class="mono">${T('app.conv.newFloor')} · ${esc(info?.path || P.def.path || '')}</div><b>${T('app.conv.newAbove')}</b>
    <p>${T('app.conv.newText')}</p>
    <button class="btn p" data-begin="1">${T('app.conv.newStart')}</button></div>`;
  const newer = (x, y) => (y.changed || 0) - (x.changed || 0);
  const mineWho = (v) => !CONV.who || v.agent === CONV.who;
  const now = vs.filter((v) => NOW.includes(v.status) && mineWho(v)).sort((x, y) => NOW.indexOf(x.status) - NOW.indexOf(y.status) || newer(x, y)); // waiting for approval, your answer, running
  // background tasks: when 2+ delegated threads run, they go into one grouped block with a live time (updated by a one-second interval, not by re-rendering)
  const bg = runningInBackground(pid).filter(mineWho), bgSet = bg.length >= 2 ? new Set(bg) : null;
  if (now.length) h += `<div class="convSec">${T('app.conv.now')} <em>${now.length}</em></div>`;
  if (bgSet) h += `<div class="convBg"><div class="convBgH">${ico('wheel')} ${TN('app.conv.inBackground', bg.length)}</div>${bg.map((v) => { const z = agentFor(P, v.agent); return `<div class="convBgR" data-v="${esc(v.id)}" title="${T('app.conv.openThread')}">${agentIcon(z, 'mal')}<b>${nameC(v, z)}</b><span class="tt">${esc(v.title)}</span><span class="convBgTime" data-from="${v.created || 0}">${v.created ? duration(Date.now() - v.created) : ''}</span></div>`; }).join('')}</div>`;
  h += now.filter((v) => !bgSet?.has(v)).map((v) => row(v, P, vs, false)).join('');
  const items = vs.filter((v) => (CONV.who ? v.agent === CONV.who : !v.parent) && !now.includes(v)).sort((x, y) => (y.pinned || 0) - (x.pinned || 0) || newer(x, y)); // pinned at the top (most recently pinned first)
  if (!items.length) h += `<div class="convEmpty">${who.lead ? (old.length ? T('app.conv.yetOld') : T('app.conv.yetNone')) : T('app.conv.yetTeammate')}</div>`;
  h += items.map((v) => row(v, P, vs)).join('');
  if (old.length && (!CONV.who || who.lead)) {
    const open = CONV.oldOpen ?? (!vs.length || CONV.selectMode);
    h += `<button class="convSec convOldToggle" data-staretog="1">${open ? '▾' : '▸'} ${T('app.conv.older')} <em>${old.length}</em></button>`;
    if (open) {
      const show = CONV.allOld ? old : old.slice(0, 15);
      h += show.map((v) => row(v, P, vs)).join('');
      if (old.length > show.length) h += `<button class="convPlus convMore" data-old="1">${T('app.conv.showAll', { n: old.length })}</button>`;
    }
  }
  return h;
}
// editing a sent message (2026-11-16, as in claude.ai): textarea instead of a bubble, Esc cancels, ⌘↵ saves and sends.
// The server (editMessage) returns the session to before this message, everything after it disappears and the agent answers the new text.
const editMeHtml = (s, u) => `<div class="msg user edit">${imagesHtml(s.images)}${attachmentsHtml(s.attachments)}<textarea class="meEdit" data-upjat="${s.i}" rows="1" spellcheck="false" placeholder="${T('app.conv.messageText')}">${esc(u.text)}</textarea>
  <div class="meEditFooter"><span class="note">${RUNNING.includes(CONV_STORE.conv.get(u.id)?.status) ? T('app.conv.agentStops') + ' ' : ''}${T('app.conv.changesNotReverted')}${s.images?.length || s.attachments?.length ? ' ' + T('app.conv.attachmentsRemain') : ''}</span><button type="button" class="btn" data-upjazrus="1">${T('app.conv.cancel')}</button><button type="button" class="btn p" data-upjaok="1" title="⌘↵">${T('app.conv.saveSend')}</button></div></div>`;
const ICO_COPY = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 5.5V3.6c0-.9-.7-1.6-1.6-1.6H3.6C2.7 2 2 2.7 2 3.6v5.3c0 .9.7 1.6 1.6 1.6h1.9"/></svg>';
const ICO_EDIT = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"><path d="M10.8 2.7l2.5 2.5L5.8 12.7 2.6 13.4l.7-3.2z"/><path d="M9.4 4.1l2.5 2.5"/></svg>';
const ICO_OK = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.8"/></svg>';
function heightEdits(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 420) + 'px'; }
function cancelEdit() { CONV.upMe = null; renderConv(true); }
async function saveEdit() {
  const u = CONV.upMe; if (!u || u.sends) return;
  const text = u.text.trim(), s = CONV_STORE.messages.get(u.id)?.[u.i];
  if (!text && !s?.images?.length && !s?.attachments?.length) return toastK(T('app.conv.messageBlank'));
  u.sends = true; CONV.pasted = true; renderConv(true);
  try { await messageConv('edit', { id: u.id, i: u.i, text }); if (CONV.upMe === u) CONV.upMe = null; }
  catch (e) { u.sends = false; toastK(T('app.conv.editFailed', { error: e.message })); }
  renderConv(true);
}
// work plan (2026-11-16) as in the Claude app: the last "Task list" card is pinned to the bottom above the field while the agent runs
// or the plan is not finished; new messages go above it. A finished plan after the run stays in history in its place.
function messagesWithPlan(v, sp, P) {
  let li = -1; for (let i = sp.length - 1; i >= 0; i--) if (sp[i]?.type === 'todo') { li = i; break; }
  const paste = li >= 0 && !sp.slice(li + 1).some((s) => s?.type === 'user') && (RUNNING.includes(v.status) || sp[li].items.some((p) => p.s !== 'done')); // a plan from an older turn is not
  return sp.map((s, i) => (paste && i === li ? '' : message(v, s, P))).join('') + (paste ? message(v, sp[li], P).replace('class="convTodo"', 'class="convTodo paste"') : '');
}
// v19: summary of a turn's steps in one line: "Wrote `file`", "Wrote 2 files, ran `npm test`" (by tool, max. 3 groups)
// [verb key, thing key, mode]; the texts are in i18n (app.konv.sl.*, app.konv.vec.*)
const VERBS = { Write: ['Write', 'file', 'path'], Edit: ['Edit', 'file', 'path'], MultiEdit: ['Edit', 'file', 'path'], NotebookEdit: ['Edit', 'file', 'path'], Bash: ['Bash', 'command', 'command'], Read: ['Read', 'file', 'path'],
  Grep: ['Grep', 'files', ''], Glob: ['Grep', 'files', ''], WebFetch: ['WebFetch', 'page', ''], WebSearch: ['WebSearch', 'onWeb', ''], Skill: ['Skill', 'skill', 'command'] };
const PLURAL = new Set(['file', 'command', 'files', 'page', 'skill']);
function descriptionSteps(steps) {
  const sk = new Map();
  for (const k of steps) { const [sl, vec, mod] = VERBS[k.n] || [null, '', 'command'], word = sl ? T('app.conv.sl.' + sl) : T('app.conv.usedN', { n: k.n }); const kl = word + '|' + vec; if (!sk.has(kl)) sk.set(kl, { word, vec, mod, k: [] }); sk.get(kl).k.push(k); }
  const cast = [...sk.values()].slice(0, 3).map(({ word, vec, mod, k }, i) => {
    const verb = i ? word.charAt(0).toLowerCase() + word.slice(1) : word;
    let one = '';
    if (k.length === 1 && mod === 'path') one = (stepPath(k[0]) || k[0].d || '').split('/').filter(Boolean).pop() || '';
    else if (k.length === 1 && mod === 'command') one = String(k[0].d || '').split(' · ')[0];
    if (one.length > 44) one = one.slice(0, 43) + '…';
    const m = PLURAL.has(vec), object = one ? `<code>${esc(one)}</code>` : m ? `${k.length > 1 ? k.length + ' ' : ''}${TN('app.conv.vec.' + vec, k.length)}` : vec ? T('app.conv.vec.' + vec) : '';
    return `${esc(verb)} ${object}`.trim();
  });
  return cast.join(', ') + (sk.size > 3 ? ' ' + T('app.conv.aMore', { n: sk.size - 3 }) : '');
}
// state of a filled question card (in the app only): for each question the selected options and custom text
const questionStatus = (s) => { if (!CONV.questions.has(s.id)) CONV.questions.set(s.id, s.questions.map(() => ({ v: new Set(), other: '' }))); return CONV.questions.get(s.id); };
const questionReplies = (s) => questionStatus(s).map((x, j) => [...[...x.v].sort((a, b) => a - b).map((mi) => s.questions[j].options[mi]?.t), x.other.trim()].filter(Boolean).join(', '));
function message(v, s, P) {
  switch (s.type) {
    case 'user': {
      const u = CONV.upMe;
      if (u && u.id === v.id && u.i === s.i && u.original === (s.text || '') && !u.sends) return editMeHtml(s, u);
      const edit = s.i != null && !s.fromLead && !v.parent && !String(v.id).startsWith('s:'); // editing: only the main conversation; while running, the server stops the agent first (2026-11-18)
      // 2026-11-18: copy and edit as two icons under the bubble (as in claude.ai), visible on hover
      const actions = (s.text && s.i != null ? `<button type="button" class="meIco" data-kopja="${s.i}" title="${T('app.conv.copyText')}" aria-label="${T('app.conv.copyAria')}">${ICO_COPY}</button>` : '')
        + (edit ? `<button type="button" class="meIco" data-upja="${s.i}" title="${T('app.conv.editText')}${RUNNING.includes(v.status) ? ' ' + T('app.conv.editStop') : ''}" aria-label="${T('app.conv.editAria')}">${ICO_EDIT}</button>` : '');
      return `<div class="meBlock"><div class="msg user ${s.fromLead ? 'redirect' : ''}">${s.fromLead ? '<span class="od">' + ico('compass') + ' ' + T('app.conv.fromLead') + '</span>' : ''}${imagesHtml(s.images)}${attachmentsHtml(s.attachments)}${md(s.text, true)}</div><div class="meActions">${s.time ? `<span class="convTime">${esc(s.time)}</span>` : ''}${actions}</div></div>`;
    }
    case 'assistant': return `<div class="msg assistant ${s.command ? 'command' : ''}" data-i="${s.i}">${md(s.text)}${s.writing ? '<span class="cursor"></span>' : ''}</div>`;
    case 'info': return !s.error && /^nová session ·/.test(s.text) ? '' : `<div class="chip ${s.error ? 'error' : ''}">${esc(s.text)}</div>`; // "new session · path" is only in the header's ⋯ (v19)
    case 'steps': { // v19: one line "✓ Wrote `file` ›", a click expands the list of steps (permission and file are in it, file chips are gone)
      const kl = `${v.id}:${s.i}`, open = CONV.openSteps.has(kl), last = s.steps.at(-1), error = s.steps.some((k) => k.error);
      const icoFrom = s.running ? '<span class="spin"></span>' : error ? '<span class="ok errors">' + ico('warning') + '</span>' : '<span class="ok">✓</span>';
      const text = s.running && last ? `${esc(last.n)} ${esc(last.d)}` : descriptionSteps(s.steps);
      return `<div class="convSteps ${open ? 'on' : ''} ${s.running ? 'running' : ''} ${error ? 'error' : ''}" data-steps="${kl}"><div class="h" title="${T('app.conv.stepsTitle', { t: TN('app.conv.steps', s.steps.length) })}">${icoFrom}<span class="kt">${text}</span><i>›</i></div>
        ${open ? `<div class="items">${s.steps.map((k) => `<div class="${k.error ? 'error' : ''}"><span class="n">${esc(k.n)}</span>${stepPath(k) ? `<span class="fileLink" data-file="${esc(stepPath(k))}" title="${T('app.conv.filePreview')}">${esc(k.d)}</span>` : esc(k.d)}${k.result ? `<span class="vys">${esc(k.result.slice(0, 160))}</span>` : ''}</div>`).join('')}</div>` : ''}</div>`;
    }
    case 'todo': return `<div class="convTodo"><div class="mono">${ico('pick')} ${esc(s.title)}</div>${s.items.map((p) => `<div class="p ${p.s}"><span class="icoText">${p.s === 'done' ? '✓' : p.s === 'doing' ? '◐' : '○'}</span>${esc(p.t)}${p.who ? `<span class="who">${esc(p.who)}</span>` : ''}</div>`).join('')}</div>`;
    case 'delegate': { const a = agentFor(P, s.who), sub = s.thread ? CONV_STORE.conv.get(s.thread) : null, st = ['self', 'no', 'cancelled'].includes(s.status) ? s.status : sub?.status || s.status;
      if (['self', 'no', 'cancelled'].includes(st)) return `<div class="chip">${st === 'self' ? ico('refresh') : ico('x')} ${esc(a.name)} · ${esc(s.title)} · ${st === 'self' ? T('app.conv.doingSelf') : st === 'no' ? T('app.conv.rejected') : T('app.conv.cancelled')}</div>`;
      return `<div class="convDel" data-v="${esc(s.thread || '')}">${agentIcon(a)}<div class="tx"><b>↳ ${sub ? nameC(sub, a) : s.number ? `${esc(a.name)} #${s.number}` : esc(a.name)}</b><span>${esc(s.title)}</span></div><span class="convSymbol ${st === 'pending' ? 'pending' : st === 'running' ? 'running' : st === 'error' ? 'error' : ''}">${st === 'pending' ? ico('pending') + ' ' + T('app.conv.symbolApprove') : st === 'running' ? T('app.conv.stopWorking') : st === 'error' ? T('app.conv.symbolError') : st === 'done' ? '✓ ' + T('app.conv.doneMale') : T('app.conv.handedOver')}${s.p ? ` · ≈ ${fmtP(s.p)} %` : ''}</span><i>›</i></div>`; }
    case 'usage': return ''; // v19: the numbers are in the tooltip of the context ring in the header (the thread's last usage, spotrebaTip)
    case 'cap': {
      if (s.status !== 'proposed') return `<div class="chip">${s.status === 'yes' ? ico('play') + ' ' + T('app.conv.continues') : ico('stop') + ' ' + T('app.conv.stopped')} · ${T('app.conv.capSpent', { cap: fmtP(s.cap), p: fmtP(s.p) })}</div>`;
      return `<div class="card"><div style="font-weight:700">${ico('pause')} ${T('app.conv.capExceeded', { cap: fmtP(s.cap) })}</div><div class="mono">${T('app.conv.yet', { p: fmtP(s.p) })}${s.team >= 0.05 ? ` · ${T('app.conv.leadTeam', { lead: fmtP(s.lead), team: fmtP(s.team) })}` : ''}</div>
        <div class="note">${T('app.conv.capNote', { cap: fmtP(s.cap) })}</div>
        <div class="btns"><button class="btn ok" data-st="${esc(s.id)}" data-r="1">${T('app.conv.continue', { cap: fmtP(s.cap) })}</button><button class="btn no" data-st="${esc(s.id)}" data-r="0">${T('app.conv.stop')}</button></div></div>`;
    }
    case 'delegProposal': {
      const a = agentFor(P, s.who), vol = CONV.delegChoice.get(s.id) || { model: s.model, effort: s.effort };
      if (s.status !== 'proposed') return `<div class="chip">${s.status === 'yes' ? '✓' : s.status === 'self' ? ico('refresh') : ico('x')} ${esc(a.name)} · ${s.status === 'yes' ? `${esc(s.model)} · ${esc(s.effort)}` : s.status === 'self' ? T('app.conv.leadSelf') : s.status === 'no' ? T('app.conv.rejected') : T('app.conv.cancelled')}${s.reason ? ` · ${esc(s.reason)}` : ''}</div>`;
      const d = CONV.reason.has(s.id);
      return `<div class="card dnCard"><div style="font-weight:700">${ico('compass')} ${T('app.conv.wantsInvolve')} ${agentIcon(a, 'xs')} ${esc(a.name)}</div><div class="mono">${esc(s.title)}${s.inBackground ? ' · ' + T('app.conv.onBackgroundMale') : ''}</div>
        ${s.assignment ? `<div class="dnZad">${esc(s.assignment)}</div>` : ''}
        <div class="dnRowLine"><span class="mono">model</span><div class="chips">${MOD_AG.map(([k, n]) => `<button data-dnv="${esc(s.id)}" data-m="${k}" class="${vol.model === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
        <div class="dnRowLine"><span class="mono">effort</span><div class="chips">${EF_AG.map((e) => `<button data-dnv="${esc(s.id)}" data-e="${e}" class="${vol.effort === e ? 'on' : ''}">${e}</button>`).join('')}</div></div>
        <div class="note">${s.proposalModel || s.proposalEffort ? T('app.conv.modelProposed') : T('app.conv.modelNotProposed')} ${estimateDeleg(s, a, vol)}</div>
        ${d ? `<input class="convReason" data-reason="${esc(s.id)}" placeholder="${T('app.conv.whyNotLead')}">` : ''}
        <div class="btns"><button class="btn ok" data-dn="${esc(s.id)}" data-r="yes">${T('app.conv.startNow')}</button><button class="btn" data-dn="${esc(s.id)}" data-r="self" title="${T('app.conv.makeSelfTitle1')}">${T('app.conv.makeSelf')}</button><button class="btn no" data-dn="${esc(s.id)}" data-r="no">${T('app.conv.reject')}</button>${d ? '' : `<button class="btn btnReason" data-dn="${esc(s.id)}" data-r="reason" title="${T('app.conv.rejectReason')}">${T('app.conv.withReason')}</button>`}</div></div>`;
    }
    case 'delegGroup': { // bulk card (2026-11-16): multiple Agent calls in one lead message, shared model and effort
      const n = s.tasks.length, vol = CONV.delegChoice.get(s.id) || { model: s.model, effort: s.effort }, who = [...new Set(s.tasks.map((u) => u.who))];
      const one = who.length === 1 ? agentFor(P, who[0]) : null, ul = TN('app.conv.tasks', n);
      if (s.status !== 'proposed') return `<div class="chip">${s.status === 'yes' ? '✓' : s.status === 'one' ? ico('pick') : s.status === 'self' ? ico('refresh') : ico('x')} ${one ? `${esc(one.name)} ×${n}` : ul} · ${s.status === 'yes' ? `${T('app.conv.startedAtOnce')} · ${esc(s.model)} · ${esc(s.effort)}` : s.status === 'one' ? T('app.conv.afterOne') : s.status === 'self' ? T('app.conv.leadSelf') : s.status === 'no' ? T('app.conv.rejected') : T('app.conv.cancelled')}${s.reason ? ` · ${esc(s.reason)}` : ''}</div>`;
      const d = CONV.reason.has(s.id);
      const rows = s.tasks.map((u, j) => { const a = agentFor(P, u.who), open = CONV.openSteps.has(`ds:${s.id}:${j}`);
        return `<div class="dsU ${open ? 'on' : ''}"><button class="dsH" data-dsz="${esc(s.id)}" data-j="${j}" title="${open ? T('app.conv.hide') : T('app.conv.show')}">${agentIcon(a, 'mal')}<b>${esc(a.name)}${u.number ? ` #${u.number}` : ''}</b><span class="tt">${esc(u.title)}</span><i>${open ? '▾' : '▸'}</i></button>
          ${open && u.assignment ? `<div class="dnZad">${esc(u.assignment)}</div>` : ''}</div>`; }).join('');
      return `<div class="card dnCard dsCard"><div style="font-weight:700">${ico('compass')} ${T('app.conv.wantsAllow', { what: one ? `${agentIcon(one, 'xs')} ${esc(one.name)} ×${n}` : ul })}</div><div class="mono">${ul}${s.tasks.every((u) => u.inBackground) ? ' · ' + T('app.conv.onBackgroundMale') : ''}</div>
        <div class="dsItems">${rows}</div>
        <div class="dnRowLine"><span class="mono">model</span><div class="chips">${MOD_AG.map(([k, m]) => `<button data-dnv="${esc(s.id)}" data-m="${k}" class="${vol.model === k ? 'on' : ''}">${m}</button>`).join('')}</div></div>
        <div class="dnRowLine"><span class="mono">effort</span><div class="chips">${EF_AG.map((e) => `<button data-dnv="${esc(s.id)}" data-e="${e}" class="${vol.effort === e ? 'on' : ''}">${e}</button>`).join('')}</div></div>
        <div class="note">${s.proposalModel || s.proposalEffort ? T('app.conv.modelProposedAll') : T('app.conv.modelNotProposedAll')} ${estimateGroups(s, vol)}</div>
        <div class="note">${T('app.conv.atOnceNote')}</div>
        ${d ? `<input class="convReason" data-reason="${esc(s.id)}" placeholder="${T('app.conv.whyNotLead')}">` : ''}
        <div class="btns"><button class="btn ok" data-ds="${esc(s.id)}" data-r="yes">${T('app.conv.startAll', { n })}</button><button class="btn" data-ds="${esc(s.id)}" data-r="one" title="${T('app.conv.afterOneTitle')}">${T('app.conv.afterOneBtn')}</button><button class="btn" data-ds="${esc(s.id)}" data-r="self" title="${T('app.conv.makeSelfTitle2')}">${T('app.conv.makeSelf')}</button><button class="btn no" data-ds="${esc(s.id)}" data-r="no">${T('app.conv.reject')}</button>${d ? '' : `<button class="btn btnReason" data-ds="${esc(s.id)}" data-r="reason" title="${T('app.conv.rejectReason')}">${T('app.conv.withReason')}</button>`}</div></div>`;
    }
    case 'approve': {
      if (s.resolved && !s.plan && /povolené/.test(s.resolved)) return ''; // v19: permission is part of the step row "✓ Wrote …"; denial and plans stay in view
      if (s.resolved) return `<div class="chip">${/povolené/.test(s.resolved) ? '✓' : ico('x')} ${esc(s.what)} · ${esc(s.where)} · ${esc(s.resolved)}</div>`;
      const d = CONV.reason.has(s.id);
      if (s.plan) return `<div class="card plan"><div style="font-weight:700">${ico('plan')} ${esc(s.what)}</div><div class="mono">${esc(s.where)}</div><div class="planText">${md(s.content)}</div>
        ${d ? `<input class="convReason" data-reason="${esc(s.id)}" placeholder="${T('app.conv.whatChange')}">` : ''}
        <div class="btns"><button class="btn ok" data-sch="${esc(s.id)}" data-r="allow">${T('app.conv.approveWork')}</button><button class="btn no" data-sch="${esc(s.id)}" data-r="reject">${d ? T('app.conv.redoPlan') : T('app.conv.changePlan')}</button></div></div>`;
      return `<div class="card"><div style="font-weight:700">${ico('pending')} ${esc(s.what)}</div><div class="mono">${esc(s.where)}</div><pre>${esc(s.content).split('\n').map((r) => `<span class="${r.startsWith('- ') ? 'del' : r.startsWith('+ ') || r.startsWith('$ ') ? 'ins' : ''}">${r}</span>`).join('\n')}</pre>
        ${d ? `<input class="convReason" data-reason="${esc(s.id)}" placeholder="${T('app.conv.whyNotAgent')}">` : ''}
        <div class="btns"><button class="btn ok" data-sch="${esc(s.id)}" data-r="allow">${T('app.conv.allow')}</button>${s.withoutAlways ? '' : `<button class="btn" data-sch="${esc(s.id)}" data-r="always" title="${T('app.conv.allowAlwaysTitle')} ${esc(s.key || s.tool || '')}">${T('app.conv.always')}</button>`}<button class="btn no" data-sch="${esc(s.id)}" data-r="reject">${T('app.conv.reject')}</button>${d ? '' : `<button class="btn btnReason" data-sch="${esc(s.id)}" data-r="reason" title="${T('app.conv.rejectReason')}">${T('app.conv.withReason')}</button>`}</div></div>`;
    }
    case 'hire': {
      const proposed = s.candidates.filter((c) => c.status === 'proposed').length;
      return `<div class="convHire"><div class="mono">${T('app.conv.proposalTeam', { n: TN('app.conv.teammates', s.candidates.length) })}</div>${s.candidates.map((c) => {
        const edit = CONV.edit.get(`${s.id}:${c.k}`);
        return `<div class="cand ${c.status}"><div class="hl"><span class="av">${agentIcon(c)}</span><div><b>${esc(c.name)}</b><span>${esc(c.role)}</span></div>
          ${c.status === 'proposed' && !s.cancelled ? `<div class="bt"><button class="btn ok" data-nab="${esc(s.id)}" data-k="${esc(c.k)}" data-r="1">${T('app.conv.accept')}</button><button class="btn" data-edit="${esc(s.id)}" data-k="${esc(c.k)}">${edit != null ? T('app.conv.hideTimes') : T('app.conv.edit')}</button><button class="btn no" data-nab="${esc(s.id)}" data-k="${esc(c.k)}" data-r="0">${T('app.conv.no')}</button></div>` : `<span class="convSymbol ${c.status === 'accepted' ? 'running' : ''}">${c.status === 'accepted' ? '✓ ' + T('app.conv.accepted') : c.status === 'no' ? T('app.conv.noMale') : T('app.conv.unresolved')}</span>`}</div>
          <p>${esc(c.reason)}</p>${c.skills?.length ? `<div class="sk">${c.skills.map((x) => `<span>${T('app.conv.skillX', { x: esc(x) })}</span>`).join('')}</div>` : ''}
          ${edit != null && c.status === 'proposed' ? `<textarea class="md" data-mdk="${esc(s.id)}:${esc(c.k)}" rows="9">${esc(edit)}</textarea>` : ''}${c.file ? `<div class="note"><code>${esc(c.file)}</code></div>` : ''}</div>`;
      }).join('')}
        ${proposed > 1 && !s.cancelled ? `<div class="btns" style="margin-top:4px"><button class="btn p" data-nab="${esc(s.id)}" data-k="*" data-r="1">${T('app.conv.acceptAll')}</button></div>` : ''}
        <div class="note">${s.cancelled ? T('app.conv.cardExpired') : T('app.conv.saveLike')}</div></div>`;
    }
    case 'memory': { const position = s.target === 'notes', dest = s.path || 'CLAUDE.md';
      const isOn = s.source === 'scribe'; // Scribe after a turn (scribe.js): a proposal by the server after the turn ends, not by the agent
      return `<div class="convMemory ${s.status}"><div class="mono">${isOn ? ico('notebook') + ' ' + T('app.conv.memoryIsOn') : position ? ico('notebook') + ' ' + T('app.conv.memoryPosition') : ico('brain') + ' ' + T('app.conv.memoryRule')}</div>
        <div class="convTarget">→ <code>${esc(dest)}</code>${s.fresh && s.status === 'proposed' ? ' <span class="convSymbol ans">' + T('app.conv.newFile') + '</span>' : ''}${position ? ' <span class="note">' + T('app.conv.withDate') + '</span>' : ''}</div><p>${esc(s.text)}</p>${isOn && s.reason && s.status === 'proposed' ? `<div class="note">${esc(s.reason)}</div>` : ''}
        ${s.status === 'proposed' ? `<div class="btns"><button class="btn ok" data-memory="${esc(s.id)}" data-r="1">${T('app.conv.complete')}</button><button class="btn no" data-memory="${esc(s.id)}" data-r="0">${T('app.conv.no')}</button></div>` : `<span class="convSymbol">${s.status === 'yes' ? `✓ ${T('app.conv.completedTo', { dest: esc(dest.split('/').pop()) })}` : T('app.conv.unfilled')}</span>`}</div>`; }
    case 'questions': { // AskUserQuestion (2026-11-23): as in the Claude app, options + custom answer; one question with one choice is sent on click
      if (s.status !== 'proposed') return `<div class="convQuestion done">${s.questions.map((q, j) => `<div class="convQuestionH"><span class="mono">${esc(q.headline || T('app.conv.question'))}</span><span>${esc(q.question)}</span><b>${s.status === 'yes' ? '→ ' + esc(s.answers?.[j] || '') : s.status === 'no' ? T('app.conv.skipped') : T('app.conv.cancelled')}</b></div>`).join('')}</div>`;
      const st = questionStatus(s);
      return `<div class="convQuestion">${s.questions.map((q, j) => `<div class="convQuestionQ">
        <div class="convQuestionT">${q.headline ? `<span class="mono">${esc(q.headline)}</span>` : ''}<b>${esc(q.question)}</b>${q.more ? `<span class="note">${T('app.conv.selectMore')}</span>` : ''}</div>
        ${q.options.map((m, mi) => `<button type="button" class="convQuestionM ${st[j].v.has(mi) ? 'on' : ''} ${q.more ? 'more' : ''}" data-question="${esc(s.id)}" data-j="${j}" data-m="${mi}"><span class="zn"></span><span class="tx"><span>${esc(m.t)}</span>${m.p ? `<span class="pp">${esc(m.p)}</span>` : ''}</span></button>`).join('')}
        <input class="convQuestionOther" data-otzi="${esc(s.id)}:${j}" value="${esc(st[j].other)}" placeholder="${T('app.conv.anotherReply')}"></div>`).join('')}
        <div class="btns"><button class="btn ok" data-otzok="${esc(s.id)}" data-r="1">${T('app.conv.send')}</button><button class="btn no" data-otzok="${esc(s.id)}" data-r="0">${T('app.conv.skip')}</button></div></div>`; }
    case 'app': { // run_in_claude_app card (2026-11-16): the prompt can be edited, the deep link is opened by the server (POST /api/claude-app)
      const nav = s.status === 'proposed', text = CONV.appText.get(s.id) ?? s.prompt ?? '';
      return `<div class="convMemory convApp ${s.status}"><div class="mono">${ico('monitor')} ${T('app.conv.startApp')}</div>${s.reason ? `<p>${esc(s.reason)}</p>` : ''}
        <div class="convTarget">→ <code>${esc(s.where || '')}</code></div>
        ${nav ? `<textarea class="md" data-appkat="${esc(s.id)}" rows="${Math.min(10, Math.max(4, text.split('\n').length + 1))}">${esc(text)}</textarea>
          <div class="note">${T('app.conv.appNote')}</div>
          <div class="btns"><button class="btn ok" data-app="${esc(s.id)}" data-r="1">${T('app.conv.openTheApp')}</button><button class="btn no" data-app="${esc(s.id)}" data-r="0">${T('app.conv.no')}</button></div>`
        : s.status === 'open' ? `<span class="convSymbol running">✓ ${T('app.conv.openEnter')}</span>${s.trimmed ? `<div class="note">${T('app.conv.trimmed')}</div>` : ''}<div class="btns"><button class="btn" data-app="${esc(s.id)}" data-r="again" title="${T('app.conv.openAgainTitle')}">${T('app.conv.openAgain')}</button></div>`
        : `<span class="convSymbol">${T('app.conv.notStarted')}</span>`}</div>`; }
    case 'newSession': { // run_in_new_session card (2026-11-26): the task can be edited, the conversation is created by the server (POST /api/new-session)
      const nav = s.status === 'proposed', text = CONV.appText.get(s.id) ?? s.assignment ?? '';
      return `<div class="convMemory convApp ${s.status}"><div class="mono">${ico('chat')} ${T('app.conv.newSessionCity')}</div><p><b>${esc(s.title || '')}</b></p>${s.reason ? `<p>${esc(s.reason)}</p>` : ''}
        ${nav ? `<textarea class="md" data-appkat="${esc(s.id)}" rows="${Math.min(12, Math.max(4, text.split('\n').length + 1))}">${esc(text)}</textarea>
          <div class="note">${T('app.conv.newSessionNote')}</div>
          <div class="btns"><button class="btn ok" data-novas="${esc(s.id)}" data-r="1">${T('app.conv.startNow')}</button><button class="btn no" data-novas="${esc(s.id)}" data-r="0">${T('app.conv.no')}</button></div>`
        : s.status === 'starts' ? `<span class="convSymbol running">${T('app.conv.starts')}</span>`
        : s.status === 'started' ? `<span class="convSymbol running">${T('app.conv.started')}</span>${s.conv ? ` <button class="btn" data-novas="${esc(s.id)}" data-r="open" data-conv="${esc(s.conv)}">${T('app.conv.openNew')}</button>` : ''}`
        : `<span class="convSymbol">${T('app.conv.notStarted')}</span>`}</div>`; }
    case 'fromApp': return `<div class="msg fromApp"><span class="od">${ico('monitor')} ${T('app.conv.claudeApp')} · ${esc(s.from || 'session')}</span>${md(s.text)}<span class="convTime">${esc(s.time || '')}</span></div>`; // message from a session in the Claude app (cross-session-message), not yours
    case 'dispatchTasks': return dispatchCardHtml(s, v.id); // Dispatcher task card (propose_tasks), the task state is in the message, controlled by dispatch.js
    case 'title': // title proposal (propose_title, handled via rename({ card })): v19 without a card. A handled proposal is not shown, a pending one only as a small gray line (nothing is confirmed automatically)
      return s.status === 'proposed' ? `<div class="convTitleR">${T('app.conv.proposalTitle')} <b>${esc(s.title || s.proposed)}</b><button data-title="${esc(s.id)}" data-r="1">${T('app.conv.accept2')}</button><button data-title="${esc(s.id)}" data-r="edit">${T('app.conv.edit')}</button><button data-title="${esc(s.id)}" data-r="0">${T('app.conv.no')}</button></div>` : '';
  }
  return '';
}
// Thread header (v19, lightweight): one line = ← · title with a gray subtitle ("Floor · Agent" in the Workroom, only "Agent" in the office panel) ·
// state (only when running, waiting or an error) · context ring (numbers on hover: context, usage, time) · ■ (only while running) · ⛶ focus · ⋯ (terminal,
// new window, path, compact, stop, rename, trash and information about the model and project). Missing: emoji avatar, the row lead · kind · model · effort and the meta row.
const threadPath = (P, v) => v.cwd || CONV_STORE.floors.get(P.def.id)?.path || P.def.path || ''; // a session is resumed only in the folder where it was created
const lastUsage = (sp) => { for (let i = (sp?.length || 0) - 1; i >= 0; i--) if (sp[i]?.type === 'usage') return sp[i]; return null; };
function krouzokHtml(v, sp, kp) {
  const o = 2 * Math.PI * 7.5, ps = lastUsage(sp), waiting = ['running', 'pending'].includes(v.status);
  const extra = [
    // 2026-11-19: "in this 5 h window" = the same number as the Usage limit window (real % from /usage by token share);
    // "whole conversation" also sums turns from older windows, so it can differ
    v.usageWindow != null ? `<span class="r"><span class="n">${T('app.conv.inWindow')}</span><span class="t">${fmtP(v.usageWindow)} %</span></span>` : '',
    (() => { const p = Math.max(v.usageP || 0, v.usageWindow || 0); // the sum from the SDK is a few % lower than the transcripts, the whole must not be less than the window
      return `<span class="r"><span class="n">${T('app.conv.wholeConv')}</span><span class="t">${p ? `≈ ${fmtP(p)} % ${T('app.conv.z5h')}` : '–'}</span></span>`; })(),
    ps ? `<span class="r"><span class="n">${T('app.conv.lastTurn')}${ps.team >= 0.05 ? ` (${T('app.conv.leadTeam', { lead: fmtP(ps.lead), team: fmtP(ps.team) })})` : ''}</span><span class="t ${trP(ps.p)}">≈ ${fmtP(ps.p)} %</span></span>${ps.p >= 2 ? `<span class="note">${T('app.conv.turnCostly')}</span>` : ''}` : '',
    !waiting && stopwatch(v) ? `<span class="r"><span class="n">${T('app.conv.status')}</span><span class="t">${stopwatch(v)}</span></span>` : '',
  ].join('');
  return `<span class="kx kxKrouzok ${kp >= 80 ? 'warn' : ''}" tabindex="0" aria-label="${T('app.conv.contextAria', { p: kp })}"><svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="7.5" class="background"/><circle cx="10" cy="10" r="7.5" class="value" stroke-dasharray="${(o * Math.min(100, Math.max(kp, 2)) / 100).toFixed(1)} ${o.toFixed(1)}" transform="rotate(-90 10 10)"/></svg>${breakdownHtml(v, kp, extra)}</span>`;
}
// Automatic title (2026-11-19): the agent names the conversation itself, the header shows Revert · Edit · ✓ next to the title until you send another message
function autoTitleHtml(sp) {
  const i = sp ? sp.findLastIndex((s) => s?.type === 'title') : -1, s = i >= 0 ? sp[i] : null;
  if (!s || s.status !== 'auto' || sp.slice(i + 1).some((x) => x?.type === 'user')) return '';
  return `<span class="convTitleAuto">${T('app.conv.titleAgent')}<button data-title="${esc(s.id)}" data-r="restore" title="${T('app.conv.restoreOriginal')} ${esc(s.original || '')}">${T('app.conv.restore')}</button><button data-title="${esc(s.id)}" data-r="edit">${T('app.conv.edit')}</button><button data-title="${esc(s.id)}" data-r="ok" title="${T('app.conv.keep')}">✓</button></span>`;
}
function threadHtml(n, P, v) {
  const a = agentFor(P, v.agent), parent = v.parent ? CONV_STORE.conv.get(v.parent) : null, sp = CONV_STORE.messages.get(v.id);
  const kp = Math.round((v.context || 0) * 100);
  const backDest = parent ? `${agentFor(P, parent.agent).name}: ${parent.title}` : T('app.conv.conversations');
  const under = ((workroom || STANDALONE || P.dk) ? esc(n) + ' · ' : '') + nameC(v, a) + (v.old ? ' · Claude Code' : '');
  const isLive = ['running', 'pending', 'reply', 'error'].includes(v.status);
  return `<div class="convHead">
    <div class="convR1"><button class="convIco convBackBtn" data-back="${esc(v.parent || '')}" title="${T('app.conv.back', { dest: esc(backDest) })}">←</button>
      <div class="convWhom"><div class="convHeading">${CONV.rename === v.id ? renameField(v.id) : esc(v.title)}</div><div class="convUnder">${autoTitleHtml(sp) || under}</div></div>
      <span class="convIcons"><span id="convStopwatch">${isLive ? stopwatch(v) : ''}</span>${v.parent ? '' : krouzokHtml(v, sp, kp)}${RUNNING.includes(v.status) ? `<button class="convIco" data-stop="${esc(v.id)}" title="${T('app.conv.stopAgent')}">${ico('stop')}</button>` : ''}<button class="convIco ${focusConv ? 'on' : ''}" data-focus="1" title="${T('app.conv.onWidth')}">${FOCUS_SVG}</button><button class="convMenuBtn" data-menu="${esc(v.id)}" data-hl="1" title="${T('app.conv.headMenu')}">⋯</button></span></div></div>
    <div class="log convLog">${sp ? messagesWithPlan(v, sp, P) : CONV_STORE.errors.has(v.id) ? `<div class="chip error">${ico('warning')} ${esc(CONV_STORE.errors.get(v.id))}</div><button class="convPlus" data-again="${esc(v.id)}">${T('app.conv.tryAgain')}</button>` : `<div class="empty">${T('app.conv.loadingHist')}</div>`}</div>`;
}
const FOCUS_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/></svg>';

// Focus mode: the conversation panel expands to the center of the window above a dimmed scene (CSS, body.kvFokus). It does not change the saved panel width,
// the render loop (main.js) does not draw during focus. It is cancelled by Esc, the same icon, a click outside the panel or leaving the conversation.
export function setFocus(isOn = !focusConv) {
  isOn = !!isOn && !STANDALONE && !workroom && !!chatP() && CONV.open != null && CONV.tab === 'conv'; // in the Workroom (wave 3) the chat is in the center anyway
  if (isOn === focusConv) return;
  setState({ focusConv: isOn }); document.body.classList.toggle('convFocus', isOn);
  document.querySelector('#content [data-focus]')?.classList.toggle('on', isOn);
  if (isOn) { const o = $('content'); CONV.pasted = true; o.scrollTop = o.scrollHeight; $('agText').focus(); }
}
// The app remembers focus (UX audit 2026-11-17): whoever turned it on with the icon has it on every opening of a conversation until they turn it off with the icon
const FOCUS_KEY = 'city-focus';
const wantsFocus = () => { try { return localStorage.getItem(FOCUS_KEY) === '1'; } catch { return false; } };
export function focusWatchdog() { if (focusConv && !(chatP() && CONV.open != null && CONV.tab === 'conv')) setFocus(false); }
// separate window (?conv=<id>#<floor>): only this conversation, the card key is carried over automatically (sessionStorage is copied on window.open)
function openWindow(id) {
  const P = chatP(); if (!P) return;
  const url = `${location.pathname}?conv=${encodeURIComponent(id)}#${P.dk ? 'module:' + encodeURIComponent(P.dk) : encodeURIComponent(active.n)}`; // Home building: #module:<k> (main.js)
  const w = window.open(url, 'mesto-konv-' + id, 'popup=yes,width=980,height=900');
  if (!w) toastK(T('app.conv.windowBlocked'));
}

// ---------- model and effort (selection next to the input field) ----------
// The same dropdown as "Automatic ▾" when entering a task (.vyber, v13b), it just opens upward. Default values
// come from the server (floor / "agents" in world.json / Opus 5.5 · medium). A change applies to the open conversation (or to a new one
// on this floor until you send it) and is sent with the next message, the server remembers it for the conversation. The selection is outside
// the re-rendered part and the HTML changes only on change, so an open menu does not close during a stream.
const DESCRIPTION_MODEL = { 'claude-opus-5-5': T('app.conv.pmOpus'), 'claude-sonnet-5-5': T('app.conv.pmSonnet'), 'claude-haiku-5-5': T('app.conv.pmHaiku'), 'claude-fable-5-1': T('app.conv.pmFable') }; // T() at top level is safe: i18n.js loads the dictionary with top-level await
const DESCRIPTION_EFFORT = { low: T('app.conv.peLow'), medium: T('app.conv.pmNormal'), high: T('app.conv.peHigh'), xhigh: T('app.conv.peXhigh'), max: T('app.conv.peMax') };
const keyChoices = (pid, v) => (v && !v.parent ? v.id : 'n:' + pid);
export function modelName(id, models) {
  if (!id) return '';
  const clean = String(id).replace(/\[1m\]$/i, '');
  return models?.find((m) => m.id === clean)?.name || clean.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^./, (c) => c.toUpperCase());
}
// An unsent selection of model, effort and mode survives F5 (the card's sessionStorage, UX audit 2026-11-17, wave 1).
const CHOICES_KEY = 'city-choices'; let choicesLoad = false;
function loadChoices() { if (choicesLoad) return; choicesLoad = true; try { for (const [k, v] of JSON.parse(sessionStorage.getItem(CHOICES_KEY) || '[]')) if (!CONV.choice.has(k)) CONV.choice.set(k, v); } catch {} }
function saveChoices() { try { sessionStorage.setItem(CHOICES_KEY, JSON.stringify([...CONV.choice])); } catch {} }
function currentChoice(pid, v) {
  loadChoices();
  const info = CONV_STORE.floors.get(pid) || {}, d = info.defaults || { model: 'claude-opus-5-5', effort: 'medium', mode: 'auto' };
  const z = CONV.choice.get(keyChoices(pid, v)) || {};
  return { model: z.model || (v && !v.parent && v.model) || d.model, effort: z.effort || (v && !v.parent && v.effort) || d.effort, mode: z.mode || (v && !v.parent && v.mode) || d.mode || 'default',
    ultracode: typeof z.ultracode === 'boolean' ? z.ultracode : !!(v && !v.parent && v.ultracode) };
}
// v19: one gray text "Opus 5.5 · medium · asks ▾" opens one menu (model, effort, mode, where, Claude app); "+" opens a menu with an attachment and a code block
const MODE_SHORT = { default: T('app.conv.rkDefault'), acceptEdits: T('app.conv.rkEdits'), plan: T('app.conv.rkPlan'), auto: 'auto' };
function drawChoice(pid, v) {
  const info = CONV_STORE.floors.get(pid) || {};
  if (!info.models) return;
  const a = CONV.displayChoice = currentChoice(pid, v), d = info.defaults || {};
  const po = (kind, x, name, description, on) => `<div class="po auto short ${on ? 'on' : ''}" data-${kind}="${esc(x)}"><b>${esc(name)}</b><span>${esc(description)}${x === d[kind] ? ' · ' + T('app.conv.default') : ''}</span></div>`;
  const pp = !v && info.subfolders?.length ? info.subfolders : null; // Where (2026-11-13): only for a new conversation and when the floor has nested projects with CLAUDE.md
  const where = pp && pp.includes(CONV.where.get(pid)) ? CONV.where.get(pid) : '', root = (info.path || '').split('/').pop() || T('app.conv.floor');
  const r = info.modes ? info.modes.find((x) => x.id === a.mode) || info.modes[0] : null; // permission mode (2026-11-10)
  const btn = `<span class="t">${[modelName(a.model, info.models), a.effort, a.ultracode && 'ultra code', r && (MODE_SHORT[r.id] || r.name.toLowerCase()), where && where.split('/').pop()].filter(Boolean).map(esc).join(' · ')}</span><i>▾</i>`;
  const menu = `<div class="sk">Model</div>` + info.models.map((m) => po('model', m.id, m.name, DESCRIPTION_MODEL[m.id] || '', m.id === a.model)).join('')
    + `<div class="sk">Effort</div>` + info.efforts.map((e) => po('effort', e, e, DESCRIPTION_EFFORT[e] || '', e === a.effort)).join('')
    + `<div class="po auto short ${a.ultracode ? 'on' : ''}" data-ultra="1"><b>${a.ultracode ? ico('quadrantOk') : ico('quadrant')} Ultra Code</b><span>${T('app.conv.ultraDescription')}</span></div>`
    + (r ? `<div class="sk">${T('app.conv.modePermissions')}</div>` + info.modes.map((x) => po('mode', x.id, x.name, x.description, x.id === a.mode)).join('') : '')
    + (pp ? `<div class="sk">${T('app.conv.whereStarts')}</div><div class="po auto short ${where ? '' : 'on'}" data-where=""><b>${esc(root)}</b><span>${T('app.conv.wholeFloor')}</span></div>`
      + pp.map((x) => `<div class="po auto short ${x === where ? 'on' : ''}" data-where="${esc(x)}"><b>${esc(x.split('/').pop())}</b><span>${T('app.conv.customCM')}</span></div>`).join('') : '')
    + (r ? `<div class="note">${T('app.conv.alwaysValid')}</div>` : '')
    + (info.virtual ? '' : `<div class="convSep"></div><div class="po auto" data-app-menu="1"><b>${ico('monitor')} ${T('app.conv.startApp')}</b><span>${T('app.conv.appMenuDescription')}</span></div>`); // virtual Home floors have no tool for the Claude app
  const el = $('agChoiceUi');
  el.classList.toggle('warning', !!where);
  if (el.dataset.h !== btn + menu) { el.dataset.h = btn + menu; $('agChoiceBtn').innerHTML = btn; $('agChoiceMenu').innerHTML = menu; }
}
// addressee label (2026-11-19): who you are writing to, visible also while typing (the placeholder disappears). New conversation = agent picker, open one = fixed.
function drawRecipient(P, v) {
  const a = agentFor(P, v ? v.agent : CONV.recipient || 'lead'), fixed = !!v || (P.agents?.length || 0) < 2;
  const btn = `<span class="e">${agentIcon(a, 'xs')}</span><span class="t">${esc(a.name)}</span>${fixed ? '' : '<i>▾</i>'}`;
  const menu = fixed ? '' : `<div class="sk">${T('app.conv.recipientWriting')}</div>` + P.agents.map((x) => `<div class="po auto short ${x.k === a.k ? 'on' : ''}" data-recipient="${esc(x.k || 'lead')}"><b>${agentIcon(x, 'xs')} ${esc(x.name)}</b><span>${esc(x.role || '')}</span></div>`).join('');
  const b = $('recipientBtn'), h = btn + menu + fixed;
  if (b.dataset.h === h) return;
  b.dataset.h = h; b.innerHTML = btn; $('recipientMenu').innerHTML = menu; b.classList.toggle('fixed', fixed);
  b.title = v ? T('app.conv.writingHere', { name: a.name }) : fixed ? T('app.conv.writing', { name: a.name }) : T('app.conv.writingSelect', { name: a.name });
  if (fixed) $('recipientUi').classList.remove('on');
}
const CHOICES_UI = ['agChoiceUi', 'plusUi', 'recipientUi'];
function closeChoice() { for (const id of CHOICES_UI) $(id)?.classList.remove('on'); }
function initChoice() {
  for (const ui of CHOICES_UI) {
    $(ui.replace('Ui', 'Btn')).onmousedown = (e) => e.preventDefault(); // focus stays in the message field
    $(ui.replace('Ui', 'Btn')).onclick = (e) => { e.stopPropagation(); if (e.currentTarget.classList.contains('fixed')) return; const el = $(ui), was = el.classList.contains('on'); closeChoice(); el.classList.toggle('on', !was); el.querySelector('.po.on')?.scrollIntoView({ block: 'nearest' }); };
  }
  $('plusMenu').onclick = () => closeChoice();
  $('recipientMenu').onclick = (e) => {
    const t = e.target.closest('.po[data-recipient]'), P = chatP(); if (!t || !P) return;
    closeChoice();
    const k = t.dataset.recipient, a = agentFor(P, k), oldK = CONV.draft; CONV.recipient = k; CONV.who = a.lead ? null : k;
    if (oldK) { drafts().delete(oldK); CONV.draft = keyConcept(); } // the text being written goes with you to the new addressee
    selectAg(P, k); renderConv(true); $('agText').focus();
  }; // custom button handlers (attachment, code block) run earlier
  $('agChoiceMenu').onclick = (e) => {
    if (e.target.closest('[data-app-menu]')) { closeChoice(); return startInApp(); }
    const t = e.target.closest('.po[data-model], .po[data-effort], .po[data-mode], .po[data-where], .po[data-ultra]'); if (!t || !chatP()) return;
    const pid = chatP().def.id, v = CONV.open ? find(pid, CONV.open) : null;
    if (t.dataset.ultra) { // Ultra Code (2026-11-18): a toggle, the menu stays open; sent with the next message (also while running, the server then uses it immediately)
      const a = currentChoice(pid, v);
      CONV.choice.set(keyChoices(pid, v), { ...a, ultracode: !a.ultracode }); saveChoices(); drawChoice(pid, v);
      return;
    }
    if (t.dataset.where !== undefined) { CONV.where.set(pid, t.dataset.where); closeChoice(); drawChoice(pid, v); $('agText').focus(); return; }
    CONV.choice.set(keyChoices(pid, v), { ...currentChoice(pid, v), ...(t.dataset.model ? { model: t.dataset.model } : t.dataset.mode ? { mode: t.dataset.mode } : { effort: t.dataset.effort }) }); saveChoices();
    closeChoice(); drawChoice(pid, v); $('agText').focus();
  };
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('#agChoiceUi, #plusUi, #recipientUi')) closeChoice(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeChoice(); });
}
// manual "run in the Claude app" (2026-11-16): a regular message to the lead with a prefix, the lead calls run_in_claude_app and shows a card
function startInApp() {
  const t = editorText().trim();
  if (!t) return toastK(T('app.conv.writeToField'));
  setEditor(/^spusti v claude appke:/i.test(t) ? t : 'Spusti v Claude appke: ' + t); send();
}
export const choiceOnSend = () => ({ model: CONV.displayChoice?.model, effort: CONV.displayChoice?.effort, mode: CONV.displayChoice?.mode, ultracode: !!CONV.displayChoice?.ultracode });

// A thread of a task the lead assigned to a teammate runs in the lead's session: you cannot write into it. Instead of the input field
// a bar where to wait for the answer (with the lead), and a link to a direct conversation with the teammate (a new session, without the task context).
function delegTopbar(P, v) {
  const el = $('convDelegTopbar'), del = !!v?.parent;
  $('agEnter').classList.toggle('deleg', del);
  if (!del) { if (el.dataset.h) { el.innerHTML = ''; el.dataset.h = ''; } return; }
  const a = agentFor(P, v.agent), r = CONV_STORE.conv.get(v.parent), lead = agentFor(P, r?.agent || 'lead');
  const running = RUNNING.includes(v.status), recipient = ['vedúci', 'lead'].includes(lead.name.toLowerCase()) ? T('app.conv.leadOf') : lead.name;
  const h = `<div class="tx"><b>${running ? `${agentIcon(a, 'xs')} ${T('app.conv.doingFor', { name: esc(a.name), recipient: esc(recipient) })}` : v.status === 'error' ? `${ico('warning')} ${T('app.conv.taskError')}` : `✓ ${T('app.conv.taskFinished', { name: esc(a.name) })}`}</b><span>${running ? T('app.conv.thenResult') : T('app.conv.resultGot')}${a.i != null ? ` <a href="#" data-direct="${esc(v.agent)}">${T('app.conv.writeDirect', { name: esc(a.name) })}</a> ${T('app.conv.directWithoutContext')}` : ''}</span></div>`
    + `<button class="btn p" data-back="${esc(v.parent)}">← ${T('app.conv.kLead')}</button>`;
  if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
}

// Messages sent while running (server: queueToQueue). They are written into the thread only when the agent receives them.
function queueTopbar(v) {
  const el = $('convQueue'), f = !v?.parent && v?.queue?.length ? v.queue : [];
  const h = f.map((x) => `<div class="pol"><span class="tx"><b>${esc(x.text)}</b><span>${x.afterRun ? T('app.conv.queueAfterRun') : T('app.conv.queueIn')}</span></span><button class="btn" data-cancel="${esc(x.id)}" data-conv="${esc(v.id)}" title="${T('app.conv.queueCancelTitle')}">${T('app.conv.cancel')}</button><button class="btn" data-immediately="${esc(v.id)}" title="${x.afterRun ? T('app.conv.immediatelyBg') : T('app.conv.immediatelyInterrupt')}">${T('app.conv.sendImmediately')}</button></div>`).join('');
  el.classList.toggle('on', f.length > 0);
  if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
}

// ---------- slash commands: menu after "/" (2026-11-11) ----------
// A list from the server (GET /api/commands, supportedCommands in the floor folder, cache), on top the City's commands that
// open existing pickers (they do not go to the agent). ↑↓ select, Tab completes, Enter completes and sends a command without an argument immediately, Esc closes.
const PM = { on: false, pol: [], course: 0, len: null }; // len = 'skill': a menu opened from + › Skill shows only skills (also from plugins)
const KIND_PR = { city: T('app.conv.drCity'), skill: 'skill', claude: 'Claude', plugin: 'plugin' };
function newConvHere() {
  const P = chatP(); if (!P) return;
  const v = CONV.open ? find(P.def.id, CONV.open) : null, recipient = v?.agent || CONV.recipient || 'lead';
  CONV.recipient = recipient; CONV.open = null; CONV.draw = ''; selectAg(P, recipient); renderConv(); setTimeout(() => $('agText').focus(), 0);
}
const COMMANDS_CITY = [
  { n: 'model', description: T('app.conv.pmModel'), kind: 'city', action: () => $('agChoiceBtn').click() },
  { n: 'effort', description: T('app.conv.pmEffort'), kind: 'city', action: () => $('agChoiceBtn').click() },
  { n: 'permissions', description: T('app.conv.pmPerm'), kind: 'city', action: () => $('agChoiceBtn').click() },
  { n: 'clear', alias: ['new', 'reset'], description: T('app.conv.pmClear'), kind: 'city', action: newConvHere },
];
const commandCity = (text) => { const m = /^\/(\S+)\s*$/.exec(text); return m ? COMMANDS_CITY.find((p) => p.n === m[1].toLowerCase() || p.alias?.includes(m[1].toLowerCase())) : null; };
function closeCommands() { PM.len = null; if (!PM.on) return; PM.on = false; $('commandUi').classList.remove('on'); }
function refreshCommands() {
  const t = $('agText'), ago = t.value.slice(0, t.selectionStart), m = /^\/(\S*)$/.exec(ago);
  if (!m || !chatP() || !$('panel').classList.contains('convMode')) return closeCommands(); // only while typing the first word after "/"
  const pid = chatP().def.id, x = CONV_STORE.commands.get(pid);
  if (!x || (!x.list && !x.loading && !x.error)) loadCommands(pid).then(() => PM.on && refreshCommands());
  const q = m[1].toLowerCase(), score = (p) => {
    if (!q) return 0;
    if (p.n.toLowerCase().startsWith(q) || p.n.toLowerCase().split(':').pop().startsWith(q)) return 0;
    if (p.alias?.some((a) => a.toLowerCase().startsWith(q))) return 1;
    if (p.n.toLowerCase().includes(q)) return 2;
    return q.length >= 3 && p.description.toLowerCase().includes(q) ? 3 : -1;
  };
  const order = { city: 0, skill: 1, claude: 2, plugin: 3 };
  const source = PM.len === 'skill' ? (x?.list || []).filter((p) => p.kind === 'skill' || p.kind === 'plugin') : [...COMMANDS_CITY, ...(x?.list || [])];
  PM.pol = source.map((p) => [p, score(p)]).filter(([, s]) => s >= 0)
    .sort((a, b) => a[1] - b[1] || order[a[0].kind] - order[b[0].kind] || a[0].n.localeCompare(b[0].n)).slice(0, PM.len === 'skill' ? 300 : 50).map(([p]) => p);
  PM.course = Math.min(PM.course, Math.max(0, PM.pol.length - 1));
  const status = x?.loading && !x.list ? `<div class="note">${T('app.conv.loadingCommands')}</div>` : x?.error ? `<div class="note">${T('app.conv.commandsError', { error: esc(x.error) })}</div>` : '';
  $('commandMenu').innerHTML = (PM.len === 'skill' ? `<div class="sk">${T('app.conv.skillsFloor')}</div>` : '') + PM.pol.map((p, i) => `<div class="po auto ${i === PM.course ? 'course' : ''}" data-pr="${i}"><b>/${esc(p.n)}${p.arg ? ` <i>${esc(p.arg.length > 34 ? p.arg.slice(0, 33) + '…' : p.arg)}</i>` : ''}</b><em>${KIND_PR[p.kind] || ''}</em><span>${esc(p.description)}</span></div>`).join('')
    + (PM.pol.length || (x?.loading && !x.list) ? '' : `<div class="note">${T(PM.len === 'skill' ? 'app.conv.noneSkill' : 'app.conv.noneCommand', { q: esc(q) })}</div>`) + status;
  PM.on = true; $('commandUi').classList.add('on');
  $('commandMenu').querySelector('.po.course')?.scrollIntoView({ block: 'nearest' });
}
function selectCommand(i, sendNow) {
  const p = PM.pol[i], t = $('agText'); if (!p) return;
  closeCommands();
  if (p.action) { t.value = ''; height(); return p.action(); }
  t.value = `/${p.n} ` + t.value.replace(/^\/\S*\s?/, ''); height(); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
  if (sendNow && !p.arg && p.kind !== 'skill' && p.kind !== 'plugin') send(); // after a skill the task is appended, it is not sent immediately
}
// + › Skill: inserts "/" at the start of the message (the text being written stays after it) and opens a menu with skills only
function openSkills() {
  const t = $('agText'); closeChoice();
  const rest = t.value.replace(/^\/\S*\s?/, ''); t.value = '/' + (rest ? ' ' + rest : ''); height(); t.focus(); t.setSelectionRange(1, 1); // space: the text being written is not part of the skill name
  PM.course = 0; PM.len = 'skill'; refreshCommands();
}
function initCommands() {
  $('skillBtn').onmousedown = (e) => e.preventDefault();
  $('skillBtn').onclick = openSkills;
  $('agText').addEventListener('input', () => { PM.course = 0; refreshCommands(); });
  $('agText').addEventListener('click', refreshCommands);
  $('agText').addEventListener('blur', () => setTimeout(closeCommands, 150));
  // capture on the parent: runs before Enter in panel.js (the field's onkeydown) and before Esc "back"
  $('agEnter').addEventListener('keydown', (e) => {
    if (!PM.on || e.target.id !== 'agText') return;
    const n = PM.pol.length, stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'ArrowDown' && n) { stop(); PM.course = (PM.course + 1) % n; return refreshCommands(); }
    if (e.key === 'ArrowUp' && n) { stop(); PM.course = (PM.course - 1 + n) % n; return refreshCommands(); }
    if (e.key === 'Tab' && n) { stop(); return selectCommand(PM.course, false); }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && n) { stop(); return selectCommand(PM.course, true); }
    if (e.key === 'Escape') { stop(); return closeCommands(); }
  }, true);
  $('commandMenu').addEventListener('pointerdown', (e) => { const t = e.target.closest('[data-pr]'); if (!t) return; e.preventDefault(); selectCommand(+t.dataset.pr, true); });
}

// Context breakdown (server: detectContext after each turn) as a custom tooltip at the indicator, like /context in the terminal.
const thousands = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString(locale(), { maximumFractionDigits: 1 })} ${T('app.conv.mil')}` : n >= 1000 ? `${(n / 1000).toLocaleString(locale(), { maximumFractionDigits: n >= 100000 ? 0 : 1 })} ${T('app.conv.thousands')}` : String(n || 0));
function breakdownHtml(v, kp = Math.round((v.context || 0) * 100), extra = '') { // extra = extra lines under the title (v19: usage and state from the ring in the header)
  const r = v.breakdown;
  if (!r?.category?.length) return `<span class="kxTip"><strong>${T('app.conv.contextAria', { p: kp })}</strong>${extra}<span class="note">${T('app.conv.breakdownAfter')}</span></span>`;
  const mx = Math.max(...r.category.map((x) => x.t));
  const rowLine = (n, t, w) => `<span class="r"><span class="n">${esc(n)}</span><span class="t">${thousands(t)}</span>${w != null ? `<i><b style="width:${Math.max(2, Math.round(w * 100))}%"></b></i>` : ''}</span>`;
  return `<span class="kxTip"><strong>${T('app.conv.contextTokens', { p: kp, total: thousands(r.total), max: thousands(r.max) })}</strong>${extra}`
    + [...r.category].sort((a, b) => !!a.buffer - !!b.buffer || b.t - a.t).map((x) => rowLine(x.n + (x.buffer ? ' (' + T('app.conv.reserve') + ')' : ''), x.t, x.t / mx)).join('')
    + (r.files?.length ? `<span class="sk">${T('app.conv.largestSub')}</span>${r.files.map((x) => rowLine(x.p.split('/').slice(-2).join('/'), x.t)).join('')}` : '')
    + (r.mcp?.length ? `<span class="sk">${T('app.conv.mcpServery')}</span>${r.mcp.map((x) => rowLine(x.n, x.t)).join('')}` : '')
    + `<span class="note">${T('app.conv.statusAfterTurn', { time: new Date(r.when).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}</span></span>`;
}

// ---------- conversation management: ⋯ (rename, hide, trash) and bulk selection ----------
// Renaming in the row or in the thread title (Enter saves, Esc cancels). Hide = only from the City, the session file stays.
// Trash = the session file goes to ~/.Trash (disappears from the Claude app too), always via a confirmation in the bar at the bottom.
const pidActive = () => chatP()?.def.id || null;
// folder of the open conversation (paths from files are verified and opened relative to it)
const baseConv = () => { const pid = pidActive(), v = pid && CONV.open != null ? find(pid, CONV.open) : null; return v?.cwd || (pid && CONV_STORE.floors.get(pid)?.path) || (pid && chatP()?.def.path) || ''; };
function closeMenu() { $('convMenu')?.classList.remove('on'); }
// v19: the ⋯ in the thread header (hl) has extra actions that used to be visible in the header: terminal, new window, path, compact, stop, and information below the line
function headerMenu(P, v, id) {
  const running = RUNNING.includes(v.status), path = threadPath(P, v), kp = Math.round((v.context || 0) * 100);
  const cd = path.startsWith('~/') ? `cd ~/"${path.slice(2)}"` : `cd "${path}"`;
  const compact = !v.parent && !running && v.sid && (kp >= 40 || (v.breakdown?.total || 0) >= 60000);
  const forWhyNo = v.parent ? T('app.conv.forTermTask') : !v.sid ? T('app.conv.preTermSession') : '';
  return (v.sid ? `<div class="po auto" data-mak="term" data-id="${esc(id)}" data-term="${esc(`${cd} && claude --resume ${v.sid}`)}" data-sid="${esc(v.sid)}" data-path="${esc(path)}"><b>${T('app.conv.openTerm')}</b><span>claude --resume ${esc(v.sid.slice(0, 8))}…</span></div>` : `<div class="po auto off" data-mak="term" data-id="${esc(id)}" title="${T('app.conv.termFails', { reason: esc(forWhyNo) })}"><b>${T('app.conv.openTerm')}</b><span>${T('app.conv.unavailable', { reason: esc(forWhyNo) })}</span></div>`)
    + `<div class="po auto" data-mak="window" data-id="${esc(id)}"><b>${T('app.conv.openWindow')}</b><span>${T('app.conv.openWindowDescription')}</span></div>`
    + `<div class="po auto" data-mak="path" data-id="${esc(id)}" data-path="${esc(path)}"><b>${T('app.conv.copyPath')}</b><span>${esc(path)}</span></div>`
    + (compact ? `<div class="po auto" data-mak="compact" data-id="${esc(id)}"><b>${T('app.conv.compact')}</b><span>${T('app.conv.compactDescription')}</span></div>` : '')
    + (running ? `<div class="po auto" data-mak="stop" data-id="${esc(id)}"><b>${T('app.conv.stopAg')}</b><span>${T('app.conv.stopAgDescription')}</span></div>` : '')
    + '<div class="convSep"></div>';
}
function headerInfo(P, v) {
  const root = CONV_STORE.floors.get(P.def.id)?.path || P.def.shortPath || '', nest = v.cwd && root && v.cwd.startsWith(root + '/') ? v.cwd.slice(root.length + 1) : '';
  const a = agentFor(P, v.agent), model = v.modelActual ? `${modelName(v.modelActual, CONV_STORE.floors.get(P.def.id)?.models)}${v.effortActual ? ' · ' + v.effortActual : ''}` : '';
  const kind = a.home ? T('app.conv.kindHome') : a.lead ? (v.old ? T('app.conv.kindLeadOld') : T('app.conv.kindLead')) : v.parent ? T('app.conv.kindTask') : T('app.conv.kindTeammate');
  return `<div class="note convInfo">${esc(a.name)} · ${kind}${model ? `<br>${T('app.conv.modelTurn')} ${esc(model)}` : ''}${nest ? `<br>${T('app.conv.nested')} ${esc(nest)}` : ''}</div>`;
}
function openMenu(btn, id, hl = false) {
  const pid = pidActive(), v = pid && find(pid, id), m = $('convMenu'); if (!v || !m) return;
  const P = chatP(), running = RUNNING.includes(v.status), sub = !!v.parent, session = v.old || (!sub && v.sid);
  m.innerHTML = (hl ? headerMenu(P, v, id) : '') + (v.status === 'reply' ? `<div class="po auto" data-mak="resolve" data-id="${esc(id)}"><b>✓ ${T('app.conv.resolved')}</b><span>${T('app.conv.resolvedDescription')}</span></div>` : '')
    + (!v.old && !sub ? `<div class="po auto" data-mak="pin" data-id="${esc(id)}"><b>${v.pinned ? T('app.conv.unpin') : T('app.conv.pin')}</b><span>${v.pinned ? T('app.conv.unpinDescription') : T('app.conv.pinDescription')}</span></div>` : '')
    + `<div class="po auto" data-mak="rename" data-id="${esc(id)}"><b>${T('app.conv.rename')}</b><span>${session ? T('app.conv.renameCC') : T('app.conv.renameCity')}</span></div>`
    + `<div class="po auto ${running ? 'off' : ''}" data-mak="hide" data-id="${esc(id)}"><b>${T('app.conv.hideFromCity')}</b><span>${running ? T('app.conv.firstStop') : v.old ? T('app.conv.hideOld') : T('app.conv.hideNew')}</span></div>`
    + `<div class="po auto ${running || sub ? 'off' : ''}" data-mak="basket" data-id="${esc(id)}"><b>${T('app.conv.toTrash')}</b><span>${running ? T('app.conv.firstStop') : sub ? T('app.conv.basketSub') : T('app.conv.basketNormal')}</span></div>`
    + (hl ? headerInfo(P, v) : '');
  m.classList.add('on');
  const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  m.style.top = (r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
}
function openAboveMenu(btn) { // the ⋯ menu next to the list title: bulk selection
  const m = $('convMenu'); if (!m) return;
  m.innerHTML = `<div class="po auto" data-mak="pick"><b>${T('app.conv.select')}</b><span>${T('app.conv.pickDescription')}</span></div>`;
  m.classList.add('on');
  const r = btn.getBoundingClientRect(), w = m.offsetWidth;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px'; m.style.top = (r.bottom + 6) + 'px';
}
async function execute(action, ids) {
  const pid = pidActive(); if (!pid || !ids.length) return;
  try {
    const r = await messageConv(action, { ids, floor: pid });
    if (r.completed?.length) toastK(action === 'trash' ? T('app.conv.inTrash', { n: r.completed.length, basket: r.basket }) : action === 'resolve' ? T('app.conv.resolvedToast') : T('app.conv.hiddenToast', { n: r.completed.length }));
    if (r.errors?.length) toastK(r.errors.join(' · '));
    if (action !== 'resolve' && CONV.open && r.completed?.includes(CONV.open)) openConv(null);
  } catch (e) { toastK((action === 'trash' ? T('app.conv.basketFailed') : action === 'resolve' ? T('app.conv.resolveFailed') : T('app.conv.hideFailed')) + ' ' + e.message); }
  CONV.selected.clear(); CONV.confirm = null; CONV.selectMode = false;
  loadFloor(pid, true); renderConv(true);
}
async function saveName() {
  const pid = pidActive(), id = CONV.rename, title = CONV.renameText.trim(); if (!pid || !id) return;
  if (!title) return toastK(T('app.conv.titleEmpty'));
  try {
    await messageConv('rename', { id, floor: pid, title, ...(CONV.renameCard ? { card: CONV.renameCard } : {}) });
    const s = CONV_STORE.floors.get(pid)?.old?.find((x) => x.id === id); if (s) s.title = title;
    const k = CONV_STORE.conv.get(id); if (k) k.title = title;
  } catch (e) { toastK(T('app.conv.renameFailed', { error: e.message })); }
  CONV.rename = null; CONV.renameCard = null; renderConv(true);
}
function selectTopbar(P, v) {
  const el = $('convSelectTopbar'), isOn = !v && (CONV.selectMode || CONV.confirm);
  $('agEnter').classList.toggle('selectMode', !!isOn);
  if (!isOn) { if (el.dataset.h) { el.innerHTML = ''; el.dataset.h = ''; } return; }
  const n = CONV.selected.size;
  const h = CONV.confirm === 'basket'
    ? `<div class="tx"><b>${TN('app.conv.moveBasket', n)}</b><span>${T('app.conv.moveBasketDescription')}</span></div><button class="btn no" data-kosano="1">${T('app.conv.toTrashTimes')}</button><button class="btn" data-potvrdzrus="1">${T('app.conv.backTimes')}</button>`
    : `<div class="tx"><b>${n ? T('app.conv.selected', { n }) : T('app.conv.selectConv')}</b><span>${T('app.conv.selectDescription')}</span></div><button class="btn" data-hromskry="1" ${n ? '' : 'disabled'}>${T('app.conv.hideFromCity')}</button><button class="btn no" data-hromkos="1" ${n ? '' : 'disabled'}>${T('app.conv.toTrash')}</button><button class="btn" data-vyberzrus="1">${T('app.conv.cancel')}</button>`;
  if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
}
function initMessage() {
  const m = document.createElement('div'); m.id = 'convMenu'; m.className = 'selectMenu convMenu'; document.body.appendChild(m);
  m.addEventListener('click', (e) => {
    const t = e.target.closest('[data-mak]'); if (!t || t.classList.contains('off')) return;
    if (t.dataset.mak === 'pick') { closeMenu(); CONV.selectMode = true; CONV.selected.clear(); CONV.confirm = null; return renderConv(true); }
    const id = t.dataset.id, pid = pidActive(), v = pid && find(pid, id); closeMenu(); if (!v) return;
    if (t.dataset.mak === 'term') return void startTerminal(t.dataset);
    if (t.dataset.mak === 'window') return openWindow(id);
    if (t.dataset.mak === 'path') return void copy(t.dataset.path).then((ok) => toastK(ok ? T('app.conv.pathCopy') : T('app.conv.copyFailed')));
    if (t.dataset.mak === 'compact') return void apiSend({ id, text: '/compact' }).catch((err) => toastK(err.message));
    if (t.dataset.mak === 'stop') return void apiStop(id).then(() => toastK(T('app.conv.stopping'))).catch((err) => toastK(err.message));
    if (t.dataset.mak === 'rename') { CONV.rename = id; CONV.renameText = v.title || ''; CONV.renameCard = null; return renderConv(true); }
    if (t.dataset.mak === 'resolve') return execute('resolve', [id]);
    if (t.dataset.mak === 'pin') return void messageConv('pin', { ids: [id], pin: !v.pinned }).then((r) => { if (r.errors?.length) toastK(r.errors.join(' · ')); else toastK(v.pinned ? T('app.conv.unpinned') : T('app.conv.pinned')); loadFloor(pid, true); renderConv(true); }).catch((err) => toastK(err.message));
    if (t.dataset.mak === 'hide') return execute('hide', [id]);
    if (t.dataset.mak === 'basket') { if (CONV.open) openConv(null); CONV.selected = new Set([id]); CONV.confirm = 'basket'; return renderConv(true); }
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('#convMenu, [data-menu], [data-nadmenu]')) closeMenu(); });
  $('content').addEventListener('scroll', closeMenu, { passive: true });
  $('content').addEventListener('scroll', watchScroll, { passive: true });
  $('content').addEventListener('wheel', (e) => { if (e.deltaY < 0) CONV.pasted = false; }, { passive: true }); // immediately, before the next piece of the stream manages to pull the view down
  $('convDown').onclick = () => { CONV.pasted = true; const o = $('content'); o.scrollTo({ top: o.scrollHeight, behavior: 'smooth' }); arrowDown(); };
  $('convSelectTopbar').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t || t.disabled) return; const d = t.dataset;
    if (d.hromskry) return execute('hide', [...CONV.selected]);
    if (d.hromkos) { CONV.confirm = 'basket'; return renderConv(true); }
    if (d.kosano) return execute('trash', [...CONV.selected]);
    if (d.potvrdzrus) { CONV.confirm = null; if (!CONV.selectMode) CONV.selected.clear(); return renderConv(true); }
    if (d.vyberzrus) { CONV.selectMode = false; CONV.selected.clear(); CONV.confirm = null; return renderConv(true); }
  });
  $('content').addEventListener('input', (e) => { if (e.target.dataset?.upjat && CONV.upMe) { CONV.upMe.text = e.target.value; heightEdits(e.target); } else if (e.target.classList?.contains('convRename')) CONV.renameText = e.target.value; else if (e.target.dataset?.appkat) CONV.appText.set(e.target.dataset.appkat, e.target.value); else if (e.target.dataset?.otzi) questionWrite(e.target); });
  $('content').addEventListener('keydown', (e) => {
    if (e.target.dataset?.upjat) { // editing a sent message: Esc cancels, ⌘↵ saves and sends, Enter = new line
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); e.stopPropagation(); saveEdit(); }
      return;
    }
    if (!e.target.classList?.contains('convRename')) return;
    if (e.key === 'Enter') { e.preventDefault(); saveName(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); CONV.rename = null; CONV.renameCard = null; renderConv(true); }
  });
  // a click on the dimmed scene outside the panel cancels focus (the pseudo-element body::before has the event target body)
  document.addEventListener('pointerdown', (e) => { if (focusConv && e.target === document.body) setFocus(false); });
  // Esc first closes a menu, confirmation or selection, only then "back" applies
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('convMenu').classList.contains('on')) { closeMenu(); e.stopPropagation(); return; }
    if (focusConv && !e.target.classList?.contains('convRename') && !e.target.dataset?.upjat && !document.querySelector('#agChoiceUi.on, #plusUi.on, #commandUi.on')) { setFocus(false); e.stopPropagation(); return; }
    if (CONV.confirm || CONV.selectMode) { CONV.confirm = null; CONV.selectMode = false; CONV.selected.clear(); renderConv(true); e.stopPropagation(); }
  }, true);
}

// v19: the row "You write: …" is gone. Who you are writing to is in the placeholder ("Write to the lead…"), a small gray line above the field appears only in a special state
// (running, waiting for a teammate, teammate's task).
// 3rd case (dative) of the agent name: masculine roles in -ár/-ík/-ór/-er… get "-ovi" („Opravár dôkazov“ → „Opravárovi dôkazov“), otherwise "agent Meno" (names generally cannot be declined)
function recipientName(a, s7 = false) { // s7: instrumental for "Conversations with the Trainer" (agent of the Home building); in en only the name or "the lead"
  if (language() !== 'sk') return a.lead && !a.home && !s7 ? T('app.conv.leadOf') : a.name;
  if (s7) { const m = String(a.name); return /(ár|ík|ik|ník|ór|or|ent|ec|ek|ák|er|eľ|ič)$/u.test(m) ? m + 'om' : m; }
  if (a.lead && !a.home) return 'vedúcemu';
  const [first, ...more] = String(a.name).split(/\s+/);
  if (/(ár|ík|ik|ník|ór|or|ent|ec|ek|ák|er|eľ|ič)$/u.test(first) && more.length <= 1 && (!more.length || /(ov|ií|í|a|y|u|e)$/u.test(more[0]))) return [first + 'ovi', ...more].join(' ');
  return `agent ${a.name}`;
}
const placeholderRecipient = (P, v) => T('app.conv.write', { recipient: recipientName(agentFor(P, v ? v.agent : CONV.recipient)) });
function recipientStatus(P, v) {
  if (v?.parent) { const a = agentFor(P, v.agent); return a.i != null ? T('app.conv.taskRunning', { name: esc(a.name) }) : T('app.conv.taskHelper'); }
  const children = v ? convFloor(P.def.id).filter((x) => x.parent === v.id && RUNNING.includes(x.status)) : [];
  if (children.length) return T('app.conv.pendingUntil', { who: children.map((x) => esc(agentFor(P, x.agent).name)).join(', ') });
  return v && RUNNING.includes(v.status) ? T('app.conv.agentWorking') : '';
}

export function renderConv(force = false) {
  const P = chatP(); if (!P) return;
  const n = P.dk ? P.def.n : active.n, pid = P.def.id;
  $('panel').classList.add('convMode'); $('agEnter').classList.add('on');
  const info = CONV_STORE.floors.get(pid);
  if (!info || (!info.when && !info.loading)) loadFloor(pid, true);
  const v0 = CONV.open != null ? find(pid, CONV.open) : null, v = v0 && (!v0.floor || v0.floor === pid) ? v0 : null; // a conversation from another floor (e.g. after clicking through from a floor to the Home building) does not open here
  if (v0 && !v) CONV.open = null;
  if (v && !CONV_STORE.messages.has(v.id) && !CONV_STORE.errors.has(v.id)) loadConv(v.id); // e.g. after a server outage
  if (CONV.open != null && !v && CONV_STORE.floors.get(pid)?.when && !CONV_STORE.floors.get(pid)?.loading) CONV.open = null;
  focusWatchdog();
  if (STANDALONE) document.title = (v ? v.title : T('app.conv.conversations')) + ' · ' + T('app.conv.brand');
  const kk = recipientStatus(P, v), ph = placeholderRecipient(P, v);
  if ($('convRecipient').innerHTML !== kk) $('convRecipient').innerHTML = kk;
  if ($('agText').placeholder !== ph) $('agText').placeholder = ph;
  delegTopbar(P, v);
  queueTopbar(v); alertTopbar();
  selectTopbar(P, v);
  drawChoice(pid, v); drawRecipient(P, v);
  const signature = `${CONV_STORE.ver}|${CONV.open}|${CONV.tab}|${n}`;
  if (!force && signature === CONV.draw) return; CONV.draw = signature;
  const o = $('content'), top = o.scrollTop;
  const focus = document.activeElement?.closest?.('#content') ? document.activeElement : null, focusKl = focus?.dataset?.reason || focus?.dataset?.mdk || focus?.dataset?.appkat || focus?.dataset?.otzi;
  const pick = focus?.dataset?.upjat ? [focus.selectionStart, focus.selectionEnd] : null; // editing a message: the cursor survives re-rendering
  park(o);
  o.innerHTML = v ? threadHtml(n, P, v) : listHtml(n, P);
  if (P.dk && !v) M.home?.attachChatHead(o); // Home building: back, ↻ and tabs Overview · Chat · Agents (home.js)
  attachVisuals(o);
  const ta = CONV.upMe && o.querySelector('.meEdit');
  if (ta) {
    heightEdits(ta);
    const focusAt = (a = ta.value.length, b = a) => { ta.focus({ preventScroll: true }); ta.setSelectionRange(a, b); };
    if (pick) focusAt(...pick);
    else if (CONV.upMe.focus) { CONV.upMe.focus = false; CONV.pasted = false; focusAt(); setTimeout(() => ta.isConnected && focusAt(), 0); } // after pointerdown mousedown would take the focus; the view stays on the message
  }
  o.scrollTop = v && CONV.pasted ? o.scrollHeight : top; arrowDown();
  if (v) markFiles(o); // existing paths in `code` become links (verified in batches and with memory, file-view.js)
  if (CONV.rename) { const i = o.querySelector('.convRename'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  if (focusKl) o.querySelector(`[data-reason="${CSS.escape(focusKl)}"], [data-mdk="${CSS.escape(focusKl)}"], [data-appkat="${CSS.escape(focusKl)}"], [data-otzi="${CSS.escape(focusKl)}"]`)?.focus();
}
// re-render after a server event: at most ~6× per second
export function scheduleRender() { if (CONV.renderT) return; CONV.renderT = setTimeout(() => { CONV.renderT = null; renderConv(); }, 160); }
// text during a stream: only one bubble, without re-rendering the panel
function naDelta(e) {
  if (e.id !== CONV.open || !chatP()) return;
  const el = $('content').querySelector(`.msg.assistant[data-i="${e.i}"]`), s = CONV_STORE.messages.get(e.id)?.[e.i];
  if (!el || !s) return;
  const o = $('content');
  park(el);
  el.innerHTML = md(s.text) + (s.writing ? '<span class="cursor"></span>' : '');
  attachVisuals(el);
  if (CONV.pasted) o.scrollTop = o.scrollHeight; else arrowDown();
}
// sticking to the bottom: a bit up = detached (text below you keeps being appended, the view stays), fully at the bottom or the ↓ arrow = stuck again
function watchScroll() {
  const o = $('content'), d = o.scrollHeight - o.scrollTop - o.clientHeight;
  if (d < 8) CONV.pasted = true; else if (o.scrollTop < CONV.scrollTop - 1) CONV.pasted = false;
  CONV.scrollTop = o.scrollTop; arrowDown();
}
function arrowDown() {
  const o = $('content'), b = $('convDown'); if (!b) return;
  const show = CONV.open != null && CONV.tab === 'conv' && !CONV.pasted && o.scrollHeight - o.scrollTop - o.clientHeight >= 8;
  if (b.classList.contains('on') !== show) b.classList.toggle('on', show);
  const pid = show && pidActive(), live = !!pid && find(pid, CONV.open)?.status === 'running'; // the agent is writing right now: a live bubble, otherwise a calm arrow
  if (b.classList.contains('live') !== live) { b.classList.toggle('live', live); b.title = live ? T('app.conv.downWriting') : T('app.conv.downEnd'); }
}

// clipboard: first the Clipboard API, when the browser denies it (e.g. an embedded browser), the old way via a hidden textarea
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove(); return ok;
}

// ---------- actions in the panel (one listener, pointerdown: a click does not vanish under your hand on re-render) ----------
// opens a terminal with the session (iTerm via the server); when the server cannot (error, another machine), it at least copies the command
async function startTerminal(d) {
  try {
    const r = await fetch('/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: d.sid, path: d.path }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return toastK(T('app.conv.openIn', { app: j.app, sid: d.sid }));
    throw new Error(j.error || r.status);
  } catch (err) { return toastK(await copy(d.term) ? T('app.conv.commandCopy', { error: err.message }) : T('app.conv.termCopyFailed')); }
}
async function action(e) {
  if (!chatP()) return;
  if (!$('panel').classList.contains('convMode')) return;
  if (e.target.closest('.convRename')) return;
  const t = e.target.closest('[data-dk],[data-disppr],[data-menu],[data-pick],[data-vyberrezim],[data-nadmenu],[data-children],[data-ulozmeno],[data-who],[data-staretog],[data-copy],[data-kopja],[data-upja],[data-upjazrus],[data-upjaok],[data-again],[data-v],[data-create],[data-begin],[data-back],[data-steps],[data-sch],[data-nab],[data-edit],[data-memory],[data-question],[data-otzok],[data-title],[data-app],[data-novas],[data-dn],[data-dnv],[data-ds],[data-dsz],[data-st],[data-term],[data-start],[data-stop],[data-compact],[data-old],[data-window],[data-focus],[data-file],[data-example]');
  if ((!t || !t.dataset.dk) && dispatchCardClose()) renderConv(true); // a click outside closes an open .vyber on the Dispatcher task card
  if (!t || e.button !== 0) return;
  const P = chatP(), d = t.dataset;
  if (d.dk) return dispatchCardClick(t, CONV.open, () => renderConv(true));
  if (d.file) return void clickFile(d.file, baseConv(), e.metaKey); // a path in a bubble, chip or step: click = preview, ⌘+click = Obsidian / app
  if (d.disppr) return openDispatch();
  if (d.example) { const t0 = editorText().trimEnd(); setEditor(t0 ? `${t0} ${d.example}` : d.example); height(); setTimeout(() => $('agText')?.focus(), 0); return; } // an example in an empty Home building: only types it in
  if (d.again) { CONV_STORE.errors.delete(d.again); return void loadConv(d.again); }
  if (d.create) { CONV.recipient = d.create; CONV.open = null; CONV.draw = ''; selectAg(P, d.create); renderConv(); setTimeout(() => $('agText').focus(), 0); return; }
  if (d.begin) { $('agText').value = T('app.conv.beginText', { n: active.n }); height(); setTimeout(() => $('agText').focus(), 0); return; }
  if (d.back !== undefined) return openConv(d.back || null);
  if (d.steps) { CONV.openSteps.has(d.steps) ? CONV.openSteps.delete(d.steps) : CONV.openSteps.add(d.steps); return renderConv(true); }
  if (d.old) { CONV.allOld = true; return renderConv(true); }
  if (d.window) return openWindow(d.window);
  if (d.focus) { setFocus(); try { localStorage.setItem(FOCUS_KEY, focusConv ? '1' : ''); } catch {} return; } // icon = permanent choice, Esc and a click outside only for now
  if (d.menu) return openMenu(t, d.menu, !!d.hl);
  if (d.pick) { CONV.selected.has(d.pick) ? CONV.selected.delete(d.pick) : CONV.selected.add(d.pick); return renderConv(true); }
  if (d.nadmenu) return openAboveMenu(t);
  if (d.children) { CONV.childrenOpen.has(d.children) ? CONV.childrenOpen.delete(d.children) : CONV.childrenOpen.add(d.children); return renderConv(true); }
  if (d.vyberrezim) { CONV.selectMode = !CONV.selectMode; CONV.selected.clear(); CONV.confirm = null; return renderConv(true); }
  if (d.ulozmeno) return saveName();
  if (d.who !== undefined) { CONV.who = d.who || null; CONV.recipient = CONV.who || 'lead'; selectAg(P, CONV.recipient); return renderConv(true); } // filter = who you write the new message to
  if (d.staretog) { CONV.oldOpen = !(CONV.oldOpen ?? !convFloor(P.def.id).length); return renderConv(true); }
  if (d.upja !== undefined) { const s = CONV_STORE.messages.get(CONV.open)?.[+d.upja]; if (s) { CONV.upMe = { id: CONV.open, i: +d.upja, text: s.text || '', original: s.text || '', focus: true }; renderConv(true); } return; }
  if (d.upjazrus) return cancelEdit();
  if (d.upjaok) return saveEdit();
  if (d.kopja) { if (await copy(CONV_STORE.messages.get(CONV.open)?.[+d.kopja]?.text || '')) { t.innerHTML = ICO_OK; t.classList.add('ok'); setTimeout(() => { t.innerHTML = ICO_COPY; t.classList.remove('ok'); }, 1500); } else toastK(T('app.conv.copyFailed')); return; }
  if (d.copy !== undefined) { if (await copy(t.closest('.mdCode')?.querySelector('pre')?.textContent || '')) t.textContent = T('app.conv.copied') + ' ✓'; else toastK(T('app.conv.copyFailed')); return; }
  if (d.term) return void startTerminal(d);
  if (d.start) { // ▶ at a bash block: iTerm in the folder of the open thread (otherwise of the floor), the command is only typed in
    const v = CONV.open && CONV_STORE.conv.get(CONV.open), path = v?.cwd || CONV_STORE.floors.get(P.def.id)?.path || P.def.path || '';
    try {
      const r = await fetch('/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: d.start, path }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return toastK(j.entered ? T('app.conv.entered', { app: j.app }) : T('app.conv.inClipboard', { app: j.app }));
      throw new Error(j.error || r.status);
    } catch (err) { return toastK(await copy(d.start) ? T('app.conv.commandCopy', { error: err.message }) : T('app.conv.termCopyFailed')); }
  }
  if (d.compact) { t.disabled = true; try { await apiSend({ id: d.compact, text: '/compact' }); } catch (err) { t.disabled = false; toastK(err.message); } return; }
  if (d.stop) { try { await apiStop(d.stop); toastK(T('app.conv.stopping')); } catch (err) { toastK(err.message); } return; }
  if (d.sch) {
    if ((d.r === 'reason' || (d.r === 'reject' && findMessage(d.sch)?.plan)) && !CONV.reason.has(d.sch)) { CONV.reason.add(d.sch); renderConv(true); setTimeout(() => $('content').querySelector(`[data-reason="${CSS.escape(d.sch)}"]`)?.focus(), 0); return; } // wave 2: Deny = immediately, a reason only via "with a reason…" (a plan without text makes no sense)
    const reason = $('content').querySelector(`[data-reason="${CSS.escape(d.sch)}"]`)?.value || '';
    t.disabled = true;
    try { await permission(d.sch, d.r, reason); CONV.reason.delete(d.sch); } catch (err) { toastK(T('app.conv.requestNotPending', { error: err.message })); }
    return;
  }
  if (d.edit) { const kl = `${d.edit}:${d.k}`; if (CONV.edit.has(kl)) CONV.edit.delete(kl); else { const s = findMessage(d.edit); CONV.edit.set(kl, s?.candidates.find((c) => c.k === d.k)?.md || ''); } return renderConv(true); }
  if (d.nab) {
    const kl = `${d.nab}:${d.k}`, md = CONV.edit.get(kl); t.disabled = true;
    try { await card({ id: d.nab, who: d.k, yes: d.r === '1', md }); CONV.edit.delete(kl); } catch (err) { toastK(err.message); }
    return;
  }
  if (d.app) { // open in the Claude app / No / again
    const s = findMessage(d.app), id = CONV.open; if (!s || !id) return;
    const text = $('content').querySelector(`[data-appkat="${CSS.escape(d.app)}"]`)?.value ?? CONV.appText.get(d.app) ?? s.prompt;
    t.disabled = true;
    try {
      const r = await messageApp({ id, card: d.app, ...(d.r === '0' ? { no: true } : { prompt: text }) });
      CONV.appText.delete(d.app);
      if (d.r !== '0') toastK(r.trimmed ? T('app.conv.openAppTrim') : T('app.conv.openApp'));
    } catch (err) { t.disabled = false; toastK(err.message); }
    return;
  }
  if (d.novas) { // start a new session / No / open the new conversation
    if (d.r === 'open') return openConv(d.conv);
    const s = findMessage(d.novas), id = CONV.open; if (!s || !id) return;
    const assignment = $('content').querySelector(`[data-appkat="${CSS.escape(d.novas)}"]`)?.value ?? CONV.appText.get(d.novas) ?? s.assignment;
    t.disabled = true;
    try {
      await messageNewSession({ id, kid: d.novas, ...(d.r === '0' ? { no: true } : { assignment, title: s.title }) });
      CONV.appText.delete(d.novas);
      if (d.r !== '0') toastK(T('app.conv.newStarted'));
    } catch (err) { t.disabled = false; toastK(err.message); }
    return;
  }
  if (d.title) {
    const s = findMessage(d.title), id = CONV.open; if (!s || !id) return;
    if (d.r === 'edit') { CONV.rename = id; CONV.renameText = s.proposed; CONV.renameCard = s.id; return renderConv(true); }
    t.disabled = true;
    try {
      await messageConv('rename', { id, floor: pidActive(), title: s.proposed, card: s.id, no: d.r === '0', restore: d.r === 'restore', keep: d.r === 'ok' });
      const k = CONV_STORE.conv.get(id); if (k && d.r === '1') k.title = s.proposed;
      if (k && d.r === 'restore' && s.original) k.title = s.original;
      s.status = d.r === 'restore' ? 'returned' : d.r === 'ok' ? 'yes' : s.status; // hide immediately until the update from the server arrives
    } catch (err) { t.disabled = false; toastK(T('app.conv.renameFailed', { error: err.message })); }
    return renderConv(true);
  }
  if (d.dnv) { const s = findMessage(d.dnv), x = { ...(CONV.delegChoice.get(d.dnv) || { model: s?.model, effort: s?.effort }) }; if (d.m) x.model = d.m; if (d.e) x.effort = d.e; CONV.delegChoice.set(d.dnv, x); return renderConv(true); }
  if (d.dn) {
    if (d.r === 'reason' && !CONV.reason.has(d.dn)) { CONV.reason.add(d.dn); renderConv(true); setTimeout(() => $('content').querySelector(`[data-reason="${CSS.escape(d.dn)}"]`)?.focus(), 0); return; }
    const s = findMessage(d.dn), vol = CONV.delegChoice.get(d.dn) || { model: s?.model, effort: s?.effort }, text = $('content').querySelector(`[data-reason="${CSS.escape(d.dn)}"]`)?.value || '';
    t.disabled = true;
    try { await card({ id: d.dn, yes: d.r === 'yes', self: d.r === 'self', model: vol.model, effort: vol.effort, text }); CONV.delegChoice.delete(d.dn); CONV.reason.delete(d.dn); } catch (err) { toastK(err.message); }
    return;
  }
  if (d.dsz) { const kl = `ds:${d.dsz}:${d.j}`; if (!CONV.openSteps.delete(kl)) CONV.openSteps.add(kl); return renderConv(true); } // task description on the bulk card
  if (d.ds) { // bulk delegation card: Run all / One by one / Do it yourself / No
    if (d.r === 'reason' && !CONV.reason.has(d.ds)) { CONV.reason.add(d.ds); renderConv(true); setTimeout(() => $('content').querySelector(`[data-reason="${CSS.escape(d.ds)}"]`)?.focus(), 0); return; }
    const s = findMessage(d.ds), vol = CONV.delegChoice.get(d.ds) || { model: s?.model, effort: s?.effort }, text = $('content').querySelector(`[data-reason="${CSS.escape(d.ds)}"]`)?.value || '';
    t.disabled = true;
    try { await card({ id: d.ds, yes: d.r === 'yes', one: d.r === 'one', self: d.r === 'self', model: vol.model, effort: vol.effort, text }); CONV.delegChoice.delete(d.ds); CONV.reason.delete(d.ds); } catch (err) { t.disabled = false; toastK(err.message); }
    return;
  }
  if (d.st) { t.disabled = true; try { await card({ id: d.st, yes: d.r === '1' }); } catch (err) { toastK(err.message); } return; }
  if (d.question) { // selecting an option: with a single choice it replaces the selection and clears the custom text, one question with one choice is sent immediately
    const s = findMessage(d.question); if (!s || s.status !== 'proposed') return;
    const j = +d.j, mi = +d.m, q = s.questions[j], x = questionStatus(s)[j];
    if (q.more) x.v.has(mi) ? x.v.delete(mi) : x.v.add(mi); else { x.v = new Set([mi]); x.other = ''; }
    if (s.questions.length === 1 && !q.more) return questionSubmit(s, t);
    return renderConv(true);
  }
  if (d.otzok) { const s = findMessage(d.otzok); if (!s || s.status !== 'proposed') return; return questionSubmit(s, t, d.r === '0'); }
  if (d.memory) { t.disabled = true; try { await card({ id: d.memory, yes: d.r === '1' }); if (d.r === '1') toastK(T('app.conv.written')); } catch (err) { toastK(err.message); } return; }
  if (d.v) return openConv(d.v);
}
function questionWrite(el) { // custom answer: for a single-choice question it cancels the selected option (without re-rendering so the cursor is not lost)
  const [id, j] = el.dataset.otzi.split(':'), s = findMessage(id); if (!s) return;
  const x = questionStatus(s)[+j]; x.other = el.value;
  if (!s.questions[+j].more && x.v.size && el.value.trim()) { x.v.clear(); el.closest('.convQuestionQ')?.querySelectorAll('.convQuestionM.on').forEach((b) => b.classList.remove('on')); }
}
async function questionSubmit(s, t, skip = false) {
  const answers = questionReplies(s);
  if (!skip && answers.some((o) => !o)) return toastK(T('app.conv.answerAll'));
  if (t) t.disabled = true;
  try { await card({ id: s.id, yes: !skip, answers }); CONV.questions.delete(s.id); } catch (err) { if (t) t.disabled = false; toastK(err.message); }
}
function findMessage(id) { // first in the open conversation: old card ids (e.g. "t2") repeat between conversations
  const own = CONV_STORE.messages.get(CONV.open)?.find((s) => s?.id === id); if (own) return own;
  for (const sp of CONV_STORE.messages.values()) for (const s of sp) if (s?.id === id) return s; return null; }
let toastK = () => {};

// ---------- sending ----------
export async function send(immediately = false) {
  const text = editorText(); // text and code blocks from the editor as markdown
  if ((!text.trim() && !CONV.image.length && !CONV.attachment.length) || !chatP()) return;
  if (CONV.imagePreparing) return toastK(T('app.conv.fileUploading'));
  CONV.pasted = true;
  const P = chatP(), pid = P.def.id, v = CONV.open ? find(pid, CONV.open) : null;
  const mp = !CONV.image.length && !CONV.attachment.length && commandCity(text); if (mp) { clearEditor(); return mp.action(); } // /model, /clear… do not go to the agent
  const running = v && !v.parent && RUNNING.includes(v.status); // while running, the message goes to the queue (when), ⌘↵ = send immediately
  const image = CONV.image, attachment = CONV.attachment; CONV.image = []; CONV.attachment = [];
  clearEditor(); drawImage();
  try {
    const images = image.length ? image.map(({ type, data }) => ({ type, data })) : undefined, attachments = attachment.length ? attachment.map((x) => x.id) : undefined;
    const where = !v && CONV_STORE.floors.get(pid)?.subfolders?.includes(CONV.where.get(pid)) ? CONV.where.get(pid) : '';
    const body = { ...(v && !v.parent ? { id: v.id } : { floor: pid, agent: v?.parent ? v.agent : CONV.recipient, ...(where ? { subfolder: where } : {}) }), text, images, attachments, ...choiceOnSend(), ...(running ? { when: immediately ? 'now' : 'next' } : {}) };
    // warning about an expensive continuation (server 428): "Send anyway" = deliberately, "New conversation" = a new one that refers to this one
    const cut = CONV.alertMode, u = CONV.alert?.u; CONV.alertMode = null; CONV.alert = null; alertTopbar();
    if (cut === 'deliberate' && body.id) body.deliberate = true;
    if (cut === 'create' && body.id && u) { delete body.id; Object.assign(body, { floor: pid, agent: v.agent, title: text, text: `${T('app.conv.continuing', { title: u.title, sid: u.sid })}\n\n${text}` }); }
    const k = await apiSend(body);
    if (!body.id) CONV.choice.delete('n:' + pid); // a new conversation carries its choice itself, the next new one starts from the floor default
    else CONV.choice.delete(body.id); // the server remembers the choice for the conversation (after plan approval it switches Plan first → Ask)
    saveChoices();
    image.forEach((o) => URL.revokeObjectURL(o.url));
    if (k.id !== CONV.open) openConv(k.id); else renderConv(true);
  } catch (err) {
    setEditor(text); CONV.image = [...image, ...CONV.image]; CONV.attachment = [...attachment, ...CONV.attachment]; height(); drawImage();
    if (err.data?.alert) { CONV.alert = { u: err.data.alert, id: v?.id }; alertTopbar(); } else toastK(T('app.conv.unsent', { error: err.message }));
  }
}
// bar above the input field for an expensive continuation (cache expired / large context)
function alertTopbar() {
  const el = $('convAlert'), x = CONV.alert, u = x?.u;
  const h = !u || x.id !== CONV.open ? '' : `<div class="pol"><span class="tx"><b>${u.kind === 'cache' ? T('app.conv.alertCache', { min: u.minutes }) : T('app.conv.alertContext', { n: Math.round(u.context / 1000) })}</b><span>${u.kind === 'cache'
    ? T('app.conv.alertCache2', { n: Math.round(u.context / 1000), p: fmtP(u.p) })
    : T('app.conv.alertContext2', { p: fmtP(u.p), s: fmtP(u.pMessage) })}</span></span>
    <button class="btn p" data-alert="create" title="${T('app.conv.alertNewTitle')}">${T('app.conv.alertNew')}</button><button class="btn" data-alert="deliberate">${T('app.conv.sendAlsoAnyway')}</button><button class="btn" data-alert="close" title="${T('app.conv.close')}">${ico('x')}</button></div>`;
  el.classList.toggle('on', !!h);
  if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
}

// ---------- screenshots and attachments: ⌘V, drag and drop or 📎 ----------
// Images (PNG, JPEG, GIF, WebP) go to the model directly: they are scaled down to at most 1,800 px on the longer side (the model scales them
// to about 1,568 px anyway), as PNG, over 3.5 MB as JPEG, and sent as base64 together with the message text.
// Other files are uploaded to the server immediately (POST /api/attachment, at most 50 MB) into data/attachments/YYYY-MM-DD/ and the agent gets
// their path in the message. The browser does not reveal the original's path, hence the copy.
const MAX_SIDE = 1800, MAX_IMAGE = 8, MAX_ATTACHMENT = 10;
const isImage = (f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type);
export const size = (b) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} kB` : `${(b / 1048576).toLocaleString(locale(), { maximumFractionDigits: 1 })} MB`);
async function prepareImage(file) {
  let blob = file;
  const bmp = await createImageBitmap(file), k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (k < 1 || file.size > 3.5e6) {
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (blob.size > 3.5e6) blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  }
  bmp.close?.();
  const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
  return { type: blob.type, data, url: URL.createObjectURL(blob) };
}
async function uploadAttachment(f) {
  if (f.size > 50e6) throw new Error(T('app.conv.moreLike50', { name: f.name }));
  let r;
  try { r = await fetch('/api/attachment?title=' + encodeURIComponent(f.name || 'attachment'), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f }); }
  catch { throw new Error(T('app.conv.serverNotResponding')); }
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || r.status); return d;
}
async function addFiles(files) {
  files = files.filter((f) => f && (f.size > 0 || isImage(f)));
  if (!files.length) return;
  if (!chatP()) return toastK(T('app.conv.fileOnlyChat'));
  CONV.imagePreparing++; drawImage();
  try {
    for (const f of files) {
      try {
        if (isImage(f)) {
          if (CONV.image.length >= MAX_IMAGE) { toastK(T('app.conv.mostImage', { n: MAX_IMAGE })); continue; }
          CONV.image.push(await prepareImage(f));
        } else {
          if (CONV.attachment.length >= MAX_ATTACHMENT) { toastK(T('app.conv.mostAttachment', { n: MAX_ATTACHMENT })); continue; }
          CONV.attachment.push(await uploadAttachment(f));
        }
        drawImage();
      } catch (err) { toastK(`${f.name || T('app.conv.file')}: ${err.message}`); }
    }
  } finally { CONV.imagePreparing--; drawImage(); $('agText').focus(); }
}
function drawImage() {
  const el = $('agImage');
  el.innerHTML = CONV.image.map((o, i) => `<span class="imageN"><img src="${o.url}" alt=""><button data-cancel="o${i}" title="${T('app.conv.remove')}">×</button></span>`).join('')
    + CONV.attachment.map((p, i) => `<span class="attachmentN" title="${esc(p.title)}">${fileIcon(p.title)}<span class="tx"><b>${esc(p.title)}</b><i>${size(p.size)}</i></span><button data-cancel="p${i}" title="${T('app.conv.remove')}">×</button></span>`).join('')
    + (CONV.imagePreparing ? '<span class="imageN pr"><span class="spin"></span></span>' : '');
  el.classList.toggle('on', CONV.image.length > 0 || CONV.attachment.length > 0 || CONV.imagePreparing > 0);
}
function initImages() {
  $('imageBtn').innerHTML = `<b>${T('app.conv.attach')}</b><span>${T('app.conv.attachDescription')}</span>`;
  $('imageBtn').onclick = () => $('imageFile').click();
  $('imageFile').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  initEditor({ send, height, addFiles, toast: (t) => toastK(t) }); // block editor (editor.js): inserting files and code, the </> button
  const p = $('panel'), hasFile = (e) => [...(e.dataTransfer?.items || [])].some((it) => it.kind === 'file');
  p.addEventListener('dragover', (e) => { if (!p.classList.contains('convMode') || !hasFile(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; $('agEnter').classList.add('targetImage'); });
  p.addEventListener('dragleave', (e) => { if (!p.contains(e.relatedTarget)) $('agEnter').classList.remove('targetImage'); });
  p.addEventListener('drop', (e) => {
    $('agEnter').classList.remove('targetImage');
    if (!p.classList.contains('convMode') || !hasFile(e)) return;
    e.preventDefault(); addFiles([...e.dataTransfer.files]);
  });
  $('agImage').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cancel]'); if (!b) return;
    const kind = b.dataset.cancel[0], i = +b.dataset.cancel.slice(1);
    if (kind === 'o') { const [o] = CONV.image.splice(i, 1); if (o) URL.revokeObjectURL(o.url); } else CONV.attachment.splice(i, 1);
    drawImage();
  });
}
// ---------- code in the message field (2026-11-16) ----------
// insert: puts the text at the cursor position via insertText so that ⌘Z works; when the browser cannot, setRangeText
function entry(el, t, cursorFrom = null) {
  el.focus();
  const z = el.selectionStart;
  if (!document.execCommand('insertText', false, t)) el.setRangeText(t, el.selectionStart, el.selectionEnd, 'end');
  if (cursorFrom != null) el.selectionStart = el.selectionEnd = z + cursorFrom;
  height();
}
// the cursor is between the opening and closing ``` (an odd number of fences before it)
export function inCodeCursor(el) {
  return (el.value.slice(0, el.selectionStart).match(/^[ \t]*(`{3,}|~{3,})/gm) || []).length % 2 === 1;
}
// Tab in a code block = tab character (otherwise the focus would leave the field)
export function tabInCode(el) { entry(el, '\t'); }
export function height() { const el = $('agText'), max = /^\s*```/m.test(el.value) ? 320 : 140; el.style.maxHeight = max + 'px'; el.style.height = 'auto'; if (el.value) el.style.height = Math.min(max, el.scrollHeight) + 'px'; } // empty field = one line (scrollHeight would count the wrapped placeholder)

// ---------- dictation: MediaRecorder → /api/transcript (local Whisper) ----------
export const MIC_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
async function mic() {
  if (CONV.mic === 'transcribes') return;
  if (CONV.mic === 'uploading') { CONV.rec?.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    fetch('/api/transcript/prepare', { method: 'POST' }).catch(() => {}); // the model is loaded during recording
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((x) => MediaRecorder.isTypeSupported?.(x)) || '';
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined), pieces = [];
    rec.ondataavailable = (e) => e.data.size && pieces.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      CONV.mic = 'transcribes'; micStatus();
      try { const r = await transcribeRecording(new Blob(pieces, { type: rec.mimeType || 'audio/webm' })); insertText(r.text); CONV.last = T('app.conv.transcription', { s: (r.msTranscription / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 }) }); }
      catch (err) { toastK(T('app.conv.transcriptionFailed', { error: err.message })); }
      CONV.mic = 'none'; micStatus();
    };
    CONV.rec = rec; rec.start(); CONV.mic = 'uploading'; CONV.micStart = Date.now(); micStatus();
  } catch (err) { toastK(T('app.conv.micError', { error: err.name === 'NotAllowedError' ? T('app.conv.micRejected') : err.message })); }
}
export async function transcribeRecording(blob) {
  const r = await fetch('/api/transcript', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); return d;
}
function insertText(t) { const el = textField(); el.value = (el.value ? el.value.trimEnd() + ' ' : '') + (t || ''); el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); }
function micStatus() {
  $('micBtn').classList.toggle('on', CONV.mic === 'uploading'); $('micBtn').classList.toggle('pr', CONV.mic === 'transcribes');
  const s = Math.round((Date.now() - CONV.micStart) / 1000);
  $('micStatus').innerHTML = CONV.mic === 'uploading' ? `<span class="rec"></span>${T('app.conv.recording')} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}<span class="waves">${'<i></i>'.repeat(9)}</span><span class="kl">${T('app.conv.micEnd')}</span>`
    : CONV.mic === 'transcribes' ? `<span class="spin"></span>${T('app.conv.transcribing')}` : '';
  $('micStatus').classList.toggle('on', CONV.mic !== 'none');
}

// ---------- subscription limits in the header ----------
function whenReset(ms) {
  if (!ms) return '';
  const z = ms - Date.now(); if (z <= 0) return T('app.conv.refreshing');
  if (z < 24 * 3600e3) return T('app.conv.refreshesO', { h: Math.floor(z / 3600e3), m: Math.floor(z / 60e3) % 60 });
  return T('app.conv.refreshesWhen', { when: new Date(ms).toLocaleString(locale(), { weekday: 'long', hour: '2-digit', minute: '2-digit' }) });
}
// v19: in the bar only a small ring (outer arc = 5 h window, inner = week), details and reset in the #limitsTip tooltip
const krouzok = (h5, week, f) => {
  const ob = (r, sw, x) => (x ? `<circle class="a ${f(x.p)}" cx="13" cy="13" r="${r}" stroke-width="${sw}" pathLength="100" stroke-dasharray="${Math.max(2, Math.min(100, x.p))} 100" transform="rotate(-90 13 13)"/>` : '');
  return `<svg class="limKr" viewBox="0 0 26 26" aria-hidden="true"><circle class="t" cx="13" cy="13" r="10.5" stroke-width="2.6"/><circle class="t" cx="13" cy="13" r="6" stroke-width="2.2"/>${ob(10.5, 2.6, h5)}${ob(6, 2.2, week)}</svg>`;
};
let limSignature = '';
export function drawLimits() {
  const L = CONV_STORE.limits, f = (p) => (p >= 90 ? 'err' : p >= 75 ? 'warn' : 'ok'), el = $('limits');
  const running = [...CONV_STORE.conv.values()].filter((k) => k.status === 'running').length;
  const write = (kr, tip, signature) => { if (signature === limSignature) return; limSignature = signature; el.innerHTML = kr; $('limitsTip').innerHTML = tip; };
  if (!L || (!L.h5 && !L.week)) { const t = L?.error ? T('app.conv.limitsError', { error: esc(L.error) }) : T('app.conv.limitsLoad'); return write(`<span class="lim">${krouzok(null, null, f)}</span>`, `<div class="mono">${T('app.conv.running')}</div><div class="note" style="margin-top:8px">${t}</div>`, 'x|' + t); }
  const rowLine = (label, x) => (x ? `<div class="r"><span>${label}</span><b>${x.p} %</b></div><div class="lb ${f(x.p)}"><b style="width:${x.p}%"></b></div><div class="note">${whenReset(x.reset)}</div>` : '');
  const tip = `<div class="mono">${T('app.conv.running')}${L.subscription ? ' · ' + esc(L.subscription) : ''}</div>${rowLine(T('app.conv.limit5'), L.h5)}${rowLine(T('app.conv.limitWeek'), L.week)}${(L.models || []).map((m) => rowLine(T('app.conv.limitWeekModel', { name: esc(m.name) }), m)).join('')}
    ${L.warning ? `<div class="note" style="color:var(--err);margin-top:8px">${esc(L.warning)}</div>` : ''}
    <button class="btn limDetails" data-limit-details>${T('app.conv.usageSess')} <span>›</span></button>
    <div class="note" style="margin-top:8px">${T('app.conv.limitsFooter', { n: running })}${L.time ? ` (${T('app.conv.lastUsed', { time: new Date(L.time).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })})` : ''}.${L.error ? ` ${T('app.conv.readingFailed', { error: esc(L.error) })}` : ''}</div>`;
  write(`<span class="lim">${krouzok(L.h5, L.week, f)}</span>`, tip, tip + '|' + (L.h5?.p ?? '') + '|' + (L.week?.p ?? ''));
}

// ---------- init ----------
export function initConversations(toast) {
  toastK = toast;
  initFile(toast, baseConv); // first, so that its Esc (close the preview) goes before the Esc of focus mode
  $('content').addEventListener('pointerdown', action);
  initChoice();
  initCommands();
  initMessage();
  $('convQueue').addEventListener('click', async (e) => {
    const z = e.target.closest('[data-cancel]');
    if (z) {
      z.disabled = true;
      try { if (!(await cancelFromQueue(z.dataset.conv, z.dataset.cancel)).ok) { z.disabled = false; toastK(T('app.conv.alreadyReads')); } else toastK(T('app.conv.cancelledOne')); } catch (err) { z.disabled = false; toastK(err.message); }
      return;
    }
    const t = e.target.closest('[data-immediately]'); if (!t) return;
    t.disabled = true;
    try { if (!(await sendImmediately(t.dataset.immediately)).ok) toastK(T('app.conv.uUAgent')); else toastK(T('app.conv.preruSujem')); } catch (err) { t.disabled = false; toastK(err.message); }
  });
  $('convAlert').addEventListener('click', (e) => {
    const t = e.target.closest('[data-alert]'); if (!t) return;
    if (t.dataset.alert === 'close') { CONV.alert = null; return alertTopbar(); }
    CONV.alertMode = t.dataset.alert; send();
  });
  $('convDelegTopbar').addEventListener('click', (e) => {
    const t = e.target.closest('[data-back],[data-direct]'); if (!t || !chatP()) return;
    e.preventDefault();
    if (t.dataset.back !== undefined) return openConv(t.dataset.back || null);
    CONV.recipient = t.dataset.direct; CONV.open = null; CONV.draw = ''; selectAg(chatP(), t.dataset.direct); renderConv(); setTimeout(() => $('agText').focus(), 0);
  });
  $('micBtn').innerHTML = MIC_SVG; $('micBtn').title = T('app.conv.micTitle'); $('micBtn').onclick = mic;
  $('agText').oninput = height;
  initImages();
  CONV_STORE.listen.add((type, d) => {
    if (type === 'delta') return naDelta(d);
    if (type === 'limits') return drawLimits();
    if (chatP()) scheduleRender();
  });
  drawLimits();
  $('limits').addEventListener('click', openUsage);
  $('limitsTip').addEventListener('click', (e) => { if (e.target.closest('[data-limit-details]')) openUsage(); });
  setInterval(() => { // stopwatches and recording every second without re-rendering
    if (CONV.mic === 'uploading') micStatus();
    const el = document.getElementById('convStopwatch');
    if (el && CONV.open && chatP()) { const v = CONV_STORE.conv.get(CONV.open); if (v && RUNNING.includes(v.status)) el.innerHTML = stopwatch(v); }
    if (CONV.open == null && chatP()) for (const c of document.querySelectorAll('.convBgTime[data-from]')) { const from = +c.dataset.from; if (from) c.textContent = duration(Date.now() - from); } // live time of background tasks
  }, 1000);
  setInterval(drawLimits, 60000); // "resets at …"
}
