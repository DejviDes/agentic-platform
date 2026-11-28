// dispatch.js – Dispatch (2026-11-15). The floor `controlCenter/dispatch` (the top strip of the Control Center in 3D, the 🛰️ button in the center's bar) is a REGULAR CHAT
// like the other floors (source.js puts it into WORLD under the name "Dispatch", the lead Dispatcher works on Opus). So this module holds two things:
//  1) the task card in the chat (a message of type 'dispatchTasks' from the propose_tasks tool): on each task the floor and agent (own .vyber), an editable message,
//     ▶ Run now / ✎ Prepare / No and at the top ▶ Run all (in parallel). The task state is in the conversation message (server, POST /api/dispatch/card),
//     so after reopening the chat the card shows the correct state. It is rendered by conversations.js via dispatchCardHtml, clicks go through dispatchCardClick.
//  2) the "Prepared" window (#dispatchPan): tasks from ✎ Prepare (data/dispecing.json), from there ▶ Run, Discard or open the floor with a prefilled message.
// HTML only, no 3D scene and no UI state in state.js (local module state: menus and expanded card edits).
import { active } from './state.js';
import { $, esc } from './utils.js';
import { BUILDINGS, HOME_TEAM } from './demo-data.js';
import { WORLD } from './world.js';
import { CONV_STORE, floorCount, isReal } from './api.js';
import { toast } from './panel.js';
import { enterInterior, enterFloor } from './navigation.js';
import { convState, hasHomeChat, openConv } from './conversations.js';
import { ico, agentIcon } from './icons.js';
import { M } from './modules.js';
import { t as tr, tn } from './i18n.js';
import { floorLabel } from './control-center.js';

export const DISPATCH_ID = 'control-center/dispatch';
export const DISPATCH_NAME = 'Dispečing'; // floor name in WORLD (source.js)
const DISPATCH = { on: false, ready: [], connectionError: '', connectionLoaded: false };
// cards in the chat: menu = open .vyber { kt, ku, kind }, edit = edits of waiting tasks `${kt}|${ku}` → { floor, agent, message, agentName }, kde = card → conversation id, running = started requests
const CARD = { menu: null, edit: new Map(), where: new Map(), running: 0, hanging: false };
export const dispatchRunning = () => CARD.running > 0;
export const isDispatch = (pid) => pid === DISPATCH_ID;

// ---------- API ----------
async function call(url, body) {
  let r;
  try { r = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error(tr('app.dispatch.server_notResponding')); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (r.status === 404 ? tr('app.dispatch.server_unknown') : tr('app.dispatch.server_returned', { status: r.status })));
  if (d.error) throw new Error(d.error);
  return d;
}

// ---------- catalog of floors and teams (from what the app already has from /api/world) ----------
function catalog() {
  const r = [];
  for (const b of BUILDINGS) for (const p of b.floors) r.push({ id: p.id || p.n, n: p.n, building: b.title, color: b.color });
  return r;
}
const nWorld = (pid) => (WORLD.floors.has(pid) ? pid : floorCount(pid)); // floor name in WORLD by id (or name in the demo)
function teamFloor(pid, common) { // [{ k, name, emoji }], always at least the lead and the current agent
  const n = nWorld(pid), P = n && WORLD.floors.get(n);
  const t = P ? P.agents.map((a) => ({ k: a.k || 'lead', name: a.name, emoji: a.emoji || '' })) : [{ k: 'lead', name: tr('app.dispatch.lead'), emoji: '🧭' }];
  if (common && !t.some((a) => a.k === common.k)) t.push(common);
  return t;
}
const floorName = (k) => catalog().find((p) => p.id === k.floor)?.n || k.name || k.floor;
const agentDescription = (k) => { const a = teamFloor(k.floor).find((x) => x.k === k.agent); return a ? a.name : k.agentName || k.agent; };

// ---------- task card in the chat ----------
const statusConv = (s) => ({ running: tr('app.dispatch.st_running'), pending: tr('app.dispatch.st_pending'), reply: tr('app.dispatch.st_reply'), error: tr('app.dispatch.st_error'), none: tr('app.dispatch.st_none') })[s], STATUS_ICO = { pending: 'pending', reply: 'chat', error: 'warning' };
function statusConvLabel(x) { // live state of the started conversation from KS (api.js), otherwise "running"
  const v = x.conv && CONV_STORE.conv.get(x.conv);
  return v ? (STATUS_ICO[v.status] ? ico(STATUS_ICO[v.status]) + ' ' : '') + esc(statusConv(v.status) || tr('app.dispatch.st_done')) : tr('app.dispatch.st_running');
}
const kl = (kt, ku) => `${kt}|${ku}`;
// task with the edits from the card applied (floor, agent, message)
const effect = (kt, x) => ({ ...x, ...(CARD.edit.get(kl(kt, x.id)) || {}) });
function selectHtml(kt, ku, kind, text, menu) {
  const on = CARD.menu?.kt === kt && CARD.menu.ku === ku && CARD.menu.kind === kind;
  return `<div class="pick ${on ? 'on' : ''}"><button type="button" class="selectBtn" data-dk="menu" data-kt="${esc(kt)}" data-ku="${esc(ku)}" data-kind="${kind}"><span class="t">${esc(text)}</span><i>▾</i></button><div class="selectMenu">${on ? menu : ''}</div></div>`;
}
function menuFloors(kt, x) {
  const category = catalog(), grp = new Map();
  for (const p of category) { if (!grp.has(p.building)) grp.set(p.building, { color: p.color, p: [] }); grp.get(p.building).p.push(p); }
  let h = '';
  for (const [b, s] of grp) h += `<div class="sk"><span class="point" style="background:${esc(s.color)}"></span>${esc(b)}</div>` + s.p.map((p) => `<div class="po ${p.id === x.floor ? 'on' : ''}" data-dk="choiceP" data-kt="${esc(kt)}" data-ku="${esc(x.id)}" data-v="${esc(p.id)}"><b>${esc(floorLabel(p.n))}</b></div>`).join('');
  if (!category.some((p) => p.id === x.floor)) h += `<div class="sk">${tr('app.dispatch.other')}</div><div class="po on" data-dk="choiceP" data-kt="${esc(kt)}" data-ku="${esc(x.id)}" data-v="${esc(x.floor)}"><b>${esc(floorName(x))}</b></div>`;
  return h;
}
function menuAgents(kt, x) {
  return teamFloor(x.floor, { k: x.agent, name: x.agentName || x.agent, emoji: '' }).map((a) => `<div class="po auto ${a.k === x.agent ? 'on' : ''}" data-dk="choiceA" data-kt="${esc(kt)}" data-ku="${esc(x.id)}" data-v="${esc(a.k)}"><b>${agentIcon(a, 'xs')} ${esc(a.name)}</b></div>`).join('');
}
function taskHtml(kt, u) {
  const x = effect(kt, u), title = `<b class="dpTitle">${esc(x.title)}</b>`, a = `data-kt="${esc(kt)}" data-ku="${esc(x.id)}"`;
  if (x.status === 'no') return `<div class="dpCard no"><div class="dpK1"><s>${esc(x.title)}</s><span class="mono">${tr('app.dispatch.discarded')}</span><button class="btn" data-dk="restore" ${a}>${tr('app.dispatch.restore')}</button></div></div>`;
  if (x.status === 'ready') return `<div class="dpCard finished"><div class="dpK1">${title}<span class="mono">${ico('pen')} ${tr('app.dispatch.ready_m')}</span><button class="btn" data-dk="prep" ${a}>${tr('app.dispatch.ready_btn')}</button></div></div>`;
  if (x.status === 'running') return `<div class="dpCard finished"><div class="dpK1">${title}<span class="dpSt">${statusConvLabel(x)}</span></div>
    <div class="dpK3"><span class="mono">${esc(floorName(x))} · ${esc(agentDescription(x))}</span>${x.conv ? `<button class="btn p" data-dk="open" ${a}>${tr('app.dispatch.open_conv')}</button>` : ''}</div></div>`;
  const teammate = x.status === 'starts';
  return `<div class="dpCard ${teammate ? 'starts' : ''}"><div class="dpK1">${title}${teammate ? `<span class="dpSt"><span class="spin"></span>${tr('app.dispatch.starting')}</span>` : ''}</div>
    <div class="dpK2">${selectHtml(kt, x.id, 'p', floorName(x), menuFloors(kt, x))}${selectHtml(kt, x.id, 'a', agentDescription(x), menuAgents(kt, x))}</div>
    <textarea class="dpMessage" data-mdk="dp|${esc(kt)}|${esc(x.id)}" data-dks="${esc(kl(kt, x.id))}" rows="3" spellcheck="false" aria-label="${tr('app.dispatch.message_agent')}" ${teammate ? 'disabled' : ''}>${esc(x.message)}</textarea>
    ${x.reason ? `<div class="dpReason">${esc(x.reason)}</div>` : ''}${x.error ? `<div class="dpError">${ico('warning')} ${esc(x.error)}</div>` : ''}
    <div class="btns"><button class="btn p" data-dk="start" ${a} ${teammate ? 'disabled' : ''}>${ico('play')} ${tr('app.dispatch.start_immediately')}</button><button class="btn" data-dk="prepare" ${a} ${teammate ? 'disabled' : ''}>${ico('pen')} ${tr('app.dispatch.prepare')}</button><button class="btn no" data-dk="no" ${a} ${teammate ? 'disabled' : ''}>${tr('app.dispatch.no')}</button></div></div>`;
}
// message of type 'dispatchTasks' in the chat (conversations.js: message()); conv = id of the conversation the card is in
export function dispatchCardHtml(s, conv) {
  hangInput();
  if (conv) CARD.where.set(s.id, conv);
  const items = s.tasks || [], pending = items.filter((u) => u.status === 'pending').length, n = items.length;
  return `<div class="convHire dpCh"><div class="dpChHl"><div class="mono">${ico('plan')} ${tr('app.dispatch.proposal_ulah')} · ${tn('app.dispatch.tasks_n', n)}</div>
    ${pending > 1 ? `<button class="btn p" data-dk="all" data-kt="${esc(s.id)}" title="${tr('app.dispatch.all_t')}">${ico('play')} ${tr('app.dispatch.all', { n: pending })}</button>` : ''}</div>
    ${items.map((u) => taskHtml(s.id, u)).join('')}</div>`;
}
function findCard(conv, kt) { return (CONV_STORE.messages.get(conv) || []).find((s) => s?.type === 'dispatchTasks' && s.id === kt) || null; }
function hangInput() { // typing into messages on cards (the listener is attached only at the first card, at module top level there are only declarations)
  if (CARD.hanging) return; CARD.hanging = true;
  document.addEventListener('input', (e) => {
    const k = e.target?.dataset?.dks; if (!k) return;
    CARD.edit.set(k, { ...(CARD.edit.get(k) || {}), message: e.target.value });
  });
  document.addEventListener('change', (e) => { // after typing, the edit is saved to the conversation message (survives reopening the chat)
    const k = e.target?.dataset?.dks; if (!k) return;
    const [kt] = k.split('|'); sendCard(CARD.where.get(kt), kt, 'uloz').catch(() => {});
  });
}
async function sendCard(conv, kt, action, ids) {
  const s = conv && findCard(conv, kt); if (!s) return toast(tr('app.dispatch.card_notFound'));
  const edits = {};
  for (const x of s.tasks) if (x.status === 'pending') { const e = CARD.edit.get(kl(kt, x.id)); if (e) edits[x.id] = { floor: e.floor, agent: e.agent, message: e.message }; }
  CARD.running++;
  try { await call('/api/dispatch/card', { id: conv, card: kt, action, ...(ids ? { ids } : {}), edits }); }
  catch (e) { toast(`${e.message}`); }
  finally { CARD.running--; }
  if (action === 'prepare') loadReady();
}
// clicks on the card (conversations.js: delegated handler for [data-dk]); redraw() redraws the chat
export async function dispatchCardClick(t, conv, redraw) {
  const d = t.dataset, kt = d.kt, ku = d.ku, s = conv && findCard(conv, kt), u = s?.tasks.find((x) => x.id === ku);
  if (d.dk === 'menu') { const same = CARD.menu?.kt === kt && CARD.menu.ku === ku && CARD.menu.kind === d.kind; CARD.menu = same ? null : { kt, ku, kind: d.kind }; return redraw(); }
  if (d.dk === 'choiceP' && u) {
    const e = effect(kt, u), team = teamFloor(d.v), a = team.some((x) => x.k === e.agent) ? e.agent : 'lead';
    CARD.edit.set(kl(kt, ku), { ...(CARD.edit.get(kl(kt, ku)) || {}), floor: d.v, name: catalog().find((p) => p.id === d.v)?.n || d.v, agent: a, agentName: team.find((x) => x.k === a)?.name || '' });
    CARD.menu = null; redraw(); return sendCard(conv, kt, 'uloz');
  }
  if (d.dk === 'choiceA' && u) {
    CARD.edit.set(kl(kt, ku), { ...(CARD.edit.get(kl(kt, ku)) || {}), agent: d.v, agentName: teamFloor(effect(kt, u).floor).find((x) => x.k === d.v)?.name || '' });
    CARD.menu = null; redraw(); return sendCard(conv, kt, 'uloz');
  }
  if (CARD.menu) { CARD.menu = null; redraw(); }
  if (d.dk === 'all') return sendCard(conv, kt, 'start', s?.tasks.filter((x) => x.status === 'pending').map((x) => x.id));
  if (['start', 'prepare', 'no', 'restore'].includes(d.dk) && u) return sendCard(conv, kt, d.dk, [ku]);
  if (d.dk === 'open' && u?.conv) return openPlace(u.floor, { conv: u.conv });
  if (d.dk === 'prep') return openDispatch();
}
export function dispatchCardClose() { if (CARD.menu) { CARD.menu = null; return true; } return false; } // Esc / click outside closes the open menu

// ---------- the "Prepared" window (#dispatchPan) ----------
function drawReady() {
  const el = $('dpPrep'), c = $('dpCount'); if (!el) return;
  if (c) c.textContent = DISPATCH.ready.length ? String(DISPATCH.ready.length) : '';
  if (DISPATCH.connectionError) { el.innerHTML = `<div class="dpError">${ico('warning')} ${esc(DISPATCH.connectionError)}</div>`; return; }
  el.innerHTML = DISPATCH.ready.length ? DISPATCH.ready.map((p) => {
    const k = { floor: p.floor, agent: p.agent, name: p.name, agentName: p.agentName };
    return `<div class="dpPrep" data-id="${esc(p.id)}"><div class="dpP1" data-dp="openP" data-id="${esc(p.id)}" title="${tr('app.dispatch.open_floor')}"><b>${esc(p.title || tr('app.dispatch.task'))}</b><span class="mono">${esc(floorName(k))} · ${esc(agentDescription(k))}</span><div class="dpP2">${esc(p.message)}</div></div>
      <div class="btns"><button class="btn p" data-dp="startP" data-id="${esc(p.id)}">${ico('play')} ${tr('app.dispatch.startNow')}</button><button class="btn no" data-dp="discardP" data-id="${esc(p.id)}">${tr('app.dispatch.discard')}</button></div></div>`;
  }).join('') : DISPATCH.connectionLoaded ? '<div class="uEmpty">' + tr('app.dispatch.empty', { pen: ico('pen') }) + '</div>' : '<div class="uEmpty">' + tr('app.dispatch.loading') + '</div>';
}
export const readyCount = () => DISPATCH.ready.length;
export async function loadReady() {
  if (!isReal()) { DISPATCH.connectionLoaded = true; return drawReady(); }
  try { DISPATCH.ready = (await call('/api/dispatch')).ready || []; DISPATCH.connectionError = ''; }
  catch (e) { DISPATCH.connectionError = e.message; }
  DISPATCH.connectionLoaded = true; drawReady();
}
async function cancel(id) {
  if (isReal()) await call('/api/dispatch/cancel', { id }); else DISPATCH.ready = DISPATCH.ready.filter((p) => p.id !== id);
  await loadReady();
}
async function startPrepared(p) {
  try {
    const conv = isReal() ? (await call('/api/dispatch/run', { floor: p.floor, agent: p.agent, message: p.message, title: p.title })).id : null;
    await cancel(p.id).catch(() => {});
    toast(tr('app.dispatch.started', { title: p.title || tr('app.dispatch.task_tiny') }));
    if (conv) openPlace(p.floor, { conv });
  } catch (e) { toast(`${e.message}`); }
}
// opens the floor (and the conversation, or an empty field with a prefilled message for the agent) and closes the window
async function openPlace(pid, { conv = null, message = '', agent = 'lead' } = {}) {
  closeDispatch();
  const n = nWorld(pid), dk = String(pid).startsWith('home/') ? String(pid).slice(5) : null;
  if (!n) { if (dk && hasHomeChat(dk)) return M.home?.openHomeChat(dk, conv ? { id: conv } : { text: message, create: true }); if (dk && HOME_TEAM[dk]) return enterInterior(dk); return toast(tr('app.dispatch.floor_notFound', { id: pid })); } // Home building: its chat
  const immediately = active?.kind === 'floor' && active.n === n;
  if (!immediately) await enterFloor(n, null);
  if (!isReal()) return;
  setTimeout(() => {
    if (active?.kind !== 'floor' || active.n !== n) return;
    if (conv) return openConv(conv);
    if (message) {
      convState.recipient = agent || 'lead'; openConv(null);
      const t = $('agText'); if (!t) return;
      t.value = message; t.dispatchEvent(new Event('input')); t.focus();
    }
  }, immediately ? 30 : 760);
}
// opens the Dispatch chat (click on the 3D strip, the 🛰️ button in the center's bar); when the floor is not in WORLD (old server), at least shows the Prepared window
export async function openDispatchChat() {
  if (!WORLD.floors.has(DISPATCH_NAME)) return openDispatch();
  closeDispatch();
  if (active?.kind === 'floor' && active.n === DISPATCH_NAME) return;
  const tip = $('tip'); if (tip) tip.style.display = 'none'; // the tooltip from 3D stayed displayed after the click
  await enterFloor(DISPATCH_NAME, null);
}

const SKELETON = () => `<div class="dpWindow" role="dialog" aria-label="${tr('app.dispatch.window')}"><div class="dpHl"><b>${ico('plan')} ${tr('app.dispatch.window')}</b><span class="mono">${DISPATCH_ID}</span><span class="dpGap"></span>
  <button class="btn" data-dp="chat" title="${tr('app.dispatch.chat_t')}">${tr('app.dispatch.chat')}</button><button class="btn" data-dp="close" aria-label="${tr('app.dispatch.close')}">${ico('x')}</button></div>
  <div class="dpBody"><div class="dpSec" style="margin-top:0;border-top:0;padding-top:0"><span class="mono">${tr('app.dispatch.ready_sec')}</span><em id="dpCount"></em></div><div id="dpPrep"></div></div></div>`;
export function openDispatch() {
  let el = $('dispatchPan');
  if (!el) {
    el = document.createElement('div'); el.id = 'dispatchPan'; el.innerHTML = SKELETON();
    el.addEventListener('click', click);
    el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeDispatch(); });
    document.body.appendChild(el);
  }
  DISPATCH.on = true; el.classList.add('on');
  const tip = $('tip'); if (tip) tip.style.display = 'none';
  drawReady(); loadReady();
}
export function closeDispatch() { DISPATCH.on = false; $('dispatchPan')?.classList.remove('on'); }
function click(e) {
  e.stopPropagation();
  if (e.target.id === 'dispatchPan') return closeDispatch();
  const b = e.target.closest('[data-dp]'); if (!b || b.disabled) return;
  const k = b.dataset.dp, p = DISPATCH.ready.find((x) => x.id === b.dataset.id);
  if (k === 'close') return closeDispatch();
  if (k === 'chat') return openDispatchChat();
  if (k === 'openP' && p) return openPlace(p.floor, { message: p.message, agent: p.agent });
  if (k === 'startP' && p) return startPrepared(p);
  if (k === 'discardP' && p) return cancel(p.id).catch((er) => toast(`${er.message}`));
}

// ---------- app self-refresh (control-center.js): expanded card edits and the open Prepared window survive a reload ----------
export function saveDispatchState() {
  if (!DISPATCH.on && !CARD.edit.size) return null;
  return { on: DISPATCH.on, edit: [...CARD.edit] };
}
export function dispatchRefresh(st) {
  if (!st) return;
  CARD.edit = new Map(st.edit || []);
  if (st.on) openDispatch();
}
