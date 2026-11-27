// brain.js – two useful things of the Brain (build plan, phase 5): agent activity in the brain ("Today in the brain") and orphaned notes.
// Data from the server: GET /api/brain { activity: { today: { read, written }, last: [...] }, orphaned: { count, list: [...] },
//   questions: [{ id, when, question, options, context, file, floorN }] (To confirm, night Chronicler), chronicler: { enabled, running, last, next } },
// SSE { kind:'brain', type:'otazky'|'chronicler' } after a change of questions or the Chronicler (without an event, only a new load),
// SSE { kind:'brain', type:'aktivita', event } on every read or write (api.js calls onEventBrain).
// The Brain card in the Overview (panel.js) reads BRAIN.d via brainRow(); the sections in the Brain detail are drawn by brainSectionsHtml() from conversations.js (list of the Second Brain floor).
// While the server is not running (404, error), everything silently disappears and the demo mode stays as it was. Cost: 0 draw calls (plain HTML, 3D only the existing flash via emit('brain')).
// Loading: at start, when opening the Brain detail at most once per 15 s, on SSE at most once per ~2 s (besides that the event is added locally), never in a loop.
// UI state only via set() from state.js (there is none here), at module top level only declarations (circular imports).
import { active } from './state.js';
import { $, esc } from './utils.js';
import { WORLD, emit } from './world.js';
import { isReal, floorCount, agentIndex, send as sendMessage } from './api.js';
import { toast, toastOpen, refreshBrainCard } from './panel.js';
import { renderConv, openConv } from './conversations.js';
import { openConvWhere } from './command-palette.js';
import { ico } from './icons.js';
import { BRAIN_BASE } from './demo-data.js';
import { locale, t } from './i18n.js';

export const BRAIN = { d: null, when: 0, load: null, again: false, tm: null, more: false, sends: false, init: false, custom: new Map(), replies: new Set(), chronicler: false };
const M0 = BRAIN;
const LIMIT_ORPHANED = 10, LIMIT_TODAY = 12;
const valid = (d) => !!d && !!d.activity && Array.isArray(d.activity.last) && !!d.orphaned && Array.isArray(d.orphaned.list);

// ---------- loading ----------
export function loadBrain(timeout = 4000) {
  if (!isReal()) return Promise.resolve(false);
  if (M0.load) { M0.again = true; return M0.load; }
  M0.when = Date.now();
  M0.load = fetch('/api/brain', { cache: 'no-store', signal: AbortSignal.timeout(timeout) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((d) => { if (!valid(d)) throw new Error('neplatné dáta'); M0.d = d; project(); redraw(); return true; })
    .catch(() => false) // 404 or outage: silent, the last state (or none) stays
    .finally(() => { M0.load = null; if (M0.again) { M0.again = false; again(); } });
  return M0.load;
}
function again() { if (M0.tm) return; M0.tm = setTimeout(() => { M0.tm = null; loadBrain(); }, Math.max(300, 2000 - (Date.now() - M0.when))); }
export function refreshBrain() { if (isReal() && !M0.load && Date.now() - M0.when > 15e3) loadBrain(); }

// SSE: the event is added locally at once (flash, counts, list) and the state is loaded again (at most once per ~2 s)
export function onEventBrain(e) {
  if (!isReal()) return;
  const u = e?.event;
  if (u && typeof u === 'object') {
    if (!M0.d) M0.d = { activity: { today: { read: 0, written: 0 }, last: [] }, orphaned: { count: 0, list: [] } };
    const A = M0.d.activity;
    A.today = { read: A.today?.read || 0, written: A.today?.written || 0 };
    A.today[u.kind === 'write' ? 'written' : 'read']++;
    A.last = [u, ...A.last].slice(0, 50);
    project(true); redraw();
  }
  if (M0.load) M0.again = true; else if (Date.now() - M0.when >= 2000) loadBrain(); else again();
}

// last event to WORLD.mozog.posledne (the Brain label in 3D) and, if new, a flash (the same wires as in the demo: emit 'brain')
let seen = '';
function project(blink) {
  const u = M0.d?.activity.last[0]; if (!u) return;
  const direction = u.kind === 'write' ? 'write' : 'reads';
  WORLD.brain.last = { who: `${agentName(u)}${u.floor ? ` (${titleFloor(u.floor)})` : ''}`, direction, position: titleNotes(u), isReal: true };
  const kl = `${u.when}|${u.kind}|${u.path}|${u.conv}`;
  if (kl === seen) return; seen = kl;
  if (!blink) return; // no flash on first load
  const n = titleFloor(u.floor); if (!n || !WORLD.floors.get(n)) return;
  emit('brain', { n, a: agentIndex(WORLD.floors.get(n), u.agent) ?? 0, direction });
}
const titleFloor = (pid) => (pid ? floorCount(pid) : null) || null;

// ---------- helpers ----------
// agent name: the name from the event, otherwise from the floor team, "lead" as Lead (2026-11-24)
const agentName = (u) => { if (u.name) return u.name; const n = titleFloor(u.floor), P = n && WORLD.floors.get(n), i = P ? agentIndex(P, u.agent) : null; return (i != null && P.agents[i]?.name) || (u.agent === 'lead' ? t('app.brain.lead') : u.agent || t('app.brain.agent')); };
// note folder for orientation (the last two parts of the path), e.g. "Projects · audio"
const folder = (c) => { const p = String(c || '').split('/').slice(0, -1); return p.slice(-2).join(' · '); };
const titleNotes = (u) => (u.personal || u.path == null ? t('app.brain.personal') : String(u.path).replace(/\.md$/i, '').split('/').pop());
function time(k) { const d = new Date(k); return Number.isNaN(+d) ? '' : d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }); }
const todayIso = (k) => { const d = new Date(k); return Number.isNaN(+d) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

// row for the Brain card in the Overview; null = the server has no data (the original text is used)
export function brainRow() {
  if (!isReal() || !M0.d) return null;
  const A = M0.d.activity, u = A.last[0];
  const nQuestion = M0.d.questions?.length || 0;
  const today = `${esc(t('app.brain.row', { isOn: A.today?.written || 0, quote: A.today?.read || 0 }))}${M0.d.orphaned?.count ? ` · ${esc(t('app.brain.rowOrphaned', { n: M0.d.orphaned.count }))}` : ''}${nQuestion ? ` · <b>${esc(t('app.brain.rowConfirmation', { n: nQuestion }))}</b>` : ''}`;
  const last = u ? `<span class="mzLast"><br>${esc(u.kind === 'write' ? t('app.brain.wrote') : t('app.brain.read'))} <b>${esc(agentName(u))}</b><br><span style="color:var(--muted)">${esc(titleNotes(u))}</span></span>` : '';
  return `<span class="mono">${today}</span>${last}`;
}

function redraw() {
  refreshBrainCard(); // Brain card in the Overview (writes the DOM only when the text changes)
  if (jeDetail() && !document.activeElement?.matches?.('.mzQuestionIn input')) renderConv(true); // do not redraw while typing your own reply (focus would be lost)
}
const jeDetail = () => active?.kind === 'floor' && WORLD.floors.get(active.n)?.def.id === 'brain' && !!document.querySelector('#content .mzSec');

// ---------- sections in the Brain detail (list of the Second Brain floor) ----------
export function brainSectionsHtml() {
  if (!isReal()) return '';
  refreshBrain();
  const D = M0.d; if (!D) return '';
  const A = D.activity, todayKl = todayIso(Date.now());
  const ud = A.last.filter((u) => todayIso(u.when) === todayKl).slice(0, LIMIT_TODAY);
  const rows = ud.map((u) => {
    const personal = u.personal || u.path == null;
    const position = personal ? `<span class="mzPosition personal">${esc(t('app.brain.personal'))}</span>`
      : `<button class="mzPosition" type="button" data-mz="file" data-path="${esc(u.path)}" title="${esc(u.path)}">${esc(titleNotes(u))}</button>`;
    const ag = u.conv ? `<button class="mzAg" type="button" data-mz="conv" data-floor="${esc(u.floor || '')}" data-conv="${esc(u.conv)}" title="${esc(t('app.brain.openConv'))}">${esc(agentName(u))}</button>` : `<span class="mzAg">${esc(agentName(u))}</span>`;
    return `<div class="mzR"><span class="mono mzTime">${time(u.when)}</span><span class="mzKind ${u.kind === 'write' ? 'write' : 'reads'}">${ico(u.kind === 'write' ? 'pen' : 'eye')}${esc(u.kind === 'write' ? t('app.brain.wroteM') : t('app.brain.readM'))}</span>${position}${ag}</div>`;
  }).join('');
  let h = questionsHtml(D);
  h += `<div class="convSec mzSec">${esc(t('app.brain.todayHeadline'))} <em>${esc(t('app.brain.todayCounts', { isOn: A.today?.written || 0, quote: A.today?.read || 0 }))}</em></div>`;
  h += rows ? `<div class="mzItems">${rows}</div>` : `<div class="convEmpty">${esc(t('app.brain.todayEmpty'))}</div>`;
  const O = D.orphaned, items = O.list || [], show = M0.more ? items : items.slice(0, LIMIT_ORPHANED);
  h += `<div class="convSec mzSec">${esc(t('app.brain.orphaned', { n: O.count ?? items.length }))}${items.length ? `<button class="btn ok mzProposal" type="button" data-mz="proposed"${M0.sends ? ' disabled' : ''}>${esc(M0.sends ? t('app.brain.sending') : t('app.brain.propose'))}</button>` : ''}</div>`;
  h += items.length ? `<div class="mzItems">${show.map((o) => `<div class="mzR"><button class="mzPosition" type="button" data-mz="file" data-path="${esc(o.path)}" title="${esc(o.path)}">${esc(o.title || o.path)}</button><span class="mzWhere">${esc(folder(o.path))}</span></div>`).join('')}</div>` : `<div class="convEmpty">${esc(t('app.brain.orphanedEmpty'))}</div>`;
  if (items.length > LIMIT_ORPHANED) h += `<button class="btn no mzMore" type="button" data-mz="more">${esc(M0.more ? t('app.brain.less') : t('app.brain.more', { n: items.length - LIMIT_ORPHANED }))}</button>`;
  return `<div class="mzBlock">${h}</div>`;
}

// To confirm (2026-11-25): questions of the night Chronicler (chronicler-night.js) and its state. Options = .btn.no, custom reply + Send .btn.ok, Skip.
function chroniclerRow(K) {
  if (!K) return '';
  const p = K.last, when = p ? `${todayIso(p.when) === todayIso(Date.now()) ? t('app.brain.today') : new Date(p.when).toLocaleDateString(locale(), { day: 'numeric', month: 'numeric' })} ${time(p.when)}` : '';
  const status = K.running ? t('app.brain.chronicler.running') : !K.enabled ? t('app.brain.chronicler.disabled') : p ? `${t('app.brain.chronicler.lastUsed', { when })}${p.skipped ? t('app.brain.chronicler.skipped') : p.ok === false ? t('app.brain.chronicler.failed') : ''}${p.message ? ` · ${p.message}` : ''}` : t('app.brain.chronicler.first', { time: K.time || '23:30' });
  return `<div class="mzChronicler"><span title="${esc(p?.message || '')}">${esc(t('app.brain.chronicler.title'))} · ${esc(status)}</span>${K.running ? '' : `<button class="btn no" type="button" data-mz="chronicler"${M0.chronicler ? ' disabled' : ''}>${esc(M0.chronicler ? t('app.brain.starting') : t('app.brain.startNow'))}</button>`}</div>`;
}
function questionsHtml(D) {
  const Q = D.questions || [];
  let h = `<div class="convSec mzSec">${esc(t('app.brain.forConfirmation', { n: Q.length }))}</div>` + chroniclerRow(D.chronicler);
  if (!Q.length) return h + `<div class="convEmpty">${esc(t('app.brain.noneNotAsking'))}</div>`;
  for (const q of Q) {
    const id = esc(q.id), dis = M0.replies.has(q.id) ? ' disabled' : '';
    const context = [q.context, q.floorN, q.file].filter(Boolean).map(esc).join(' · ');
    h += `<div class="mzQuestion"><b>${esc(q.question)}</b>${context ? `<div class="mzQuestionK">${context}</div>` : ''}`
      + (q.options?.length ? `<div class="mzQuestionM">${q.options.map((m, i) => `<button class="btn no" type="button" data-mz="otzv" data-id="${id}" data-v="${i}"${dis}>${esc(m)}</button>`).join('')}</div>` : '')
      + `<div class="mzQuestionIn"><input type="text" data-mzin="${id}" value="${esc(M0.custom.get(q.id) || '')}" placeholder="${esc(t('app.brain.own'))}" maxlength="1000">`
      + `<button class="btn ok" type="button" data-mz="otzt" data-id="${id}"${dis}>${esc(t('app.brain.send'))}</button><button class="btn no" type="button" data-mz="otzp" data-id="${id}"${dis}>${esc(t('app.brain.skip'))}</button></div></div>`;
  }
  return h;
}
async function answer(id, body) {
  if (M0.replies.has(id)) return;
  M0.replies.add(id); renderConv(true);
  try {
    const r = await fetch('/api/brain/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || t('app.brain.serverReturned', { code: r.status }));
    M0.custom.delete(id);
    if (M0.d && Array.isArray(d.questions)) M0.d.questions = d.questions;
    toast(body.skip ? t('app.brain.questionSkipped') : t('app.brain.questionReply'));
  } catch (e) { toast(t('app.brain.unsent', { reason: e.message === 'Failed to fetch' ? t('app.brain.serverNotResponding') : e.message })); }
  finally { M0.replies.delete(id); refreshBrainCard(); if (jeDetail()) renderConv(true); }
}
async function startChronicler() {
  if (M0.chronicler) return;
  M0.chronicler = true; renderConv(true);
  try {
    const r = await fetch('/api/chronicler/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || t('app.brain.serverReturned', { code: r.status }));
    if (M0.d) M0.d.chronicler = d;
    toast(t('app.brain.chroniclerRunning'));
  } catch (e) { toast(e.message === 'Failed to fetch' ? t('app.brain.serverNotRespondingIn') : e.message); }
  finally { M0.chronicler = false; if (jeDetail()) renderConv(true); }
}

// ---------- clicks (delegated on #content) ----------
export function initBrain() {
  if (M0.init) return; M0.init = true;
  $('content').addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-mz]'); if (!el || e.button !== 0) return;
    const d = el.dataset;
    if (d.mz === 'file') return void import('./file-view.js').then((m) => m.clickFile(BRAIN_BASE + d.path, BRAIN_BASE.slice(0, -1), e.metaKey));
    if (d.mz === 'conv') return void (d.floor ? openConvWhere({ floor: d.floor, id: d.conv }) : openConv(d.conv));
    if (d.mz === 'more') { M0.more = !M0.more; return renderConv(true); }
    if (d.mz === 'proposed') return void proposeConnections();
    if (d.mz === 'otzv') return void answer(d.id, { choice: Number(d.v) });
    if (d.mz === 'otzp') return void answer(d.id, { skip: true });
    if (d.mz === 'otzt') { const text = (M0.custom.get(d.id) || '').trim(); if (!text) return void toast(t('app.brain.writeReply')); return void answer(d.id, { text }); }
    if (d.mz === 'chronicler') return void startChronicler();
  });
  $('content').addEventListener('input', (e) => { const id = e.target?.dataset?.mzin; if (id) M0.custom.set(id, e.target.value); });
  $('content').addEventListener('keydown', (e) => { const id = e.target?.dataset?.mzin; if (id && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.target.closest('.mzQuestion')?.querySelector('[data-mz="otzt"]')?.click(); } });
  if (isReal()) loadBrain(2000);
}

// To the brain manager in the background (like Postman Yes): the app does not move you anywhere, Open goes to the conversation
async function proposeConnections() {
  const items = M0.d?.orphaned.list.slice(0, LIMIT_ORPHANED) || []; if (!items.length || M0.sends) return;
  const text = `Osirelé poznámky (bez odkazov dnu aj von), prvých ${items.length}:\n${items.map((o) => `- ${o.path}`).join('\n')}\n\nKu každej navrhni 1 až 3 prepojenia (odkaz [[…]] do súvisiacej poznámky alebo rozcestníka predmetu či projektu). Najprv mi ukáž návrh ako tabuľku, zapisuj až po mojom súhlase, jednu poznámku naraz.`;
  M0.sends = true; renderConv(true);
  try {
    const k = await sendMessage({ floor: 'brain', agent: 'manager-brain', text });
    toastOpen(t('app.brain.managerProposes'), () => openConvWhere({ floor: 'brain', id: k.id }));
  } catch (e) { toast(t('app.brain.managerError', { reason: e.message })); }
  finally { M0.sends = false; if (jeDetail()) renderConv(true); }
}
