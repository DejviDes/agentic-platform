// panel.js – Right panel, team on the left, toasts, breadcrumbs, tool bar, clock, hiding and panel width (P, dragging), time-of-day button,
// custom project picker (v13b). On a floor in real mode the panel is drawn by conversations.js (phase 3), in the demo the task status and agent detail remain.
// Created by splitting the prototype public/dizajn-v12d.html (phase 1). Module map: brain Projekty/mesto-agentov/technika.md.
import * as THREE from 'three';
import { active, houseAgent, homeModule, filter, city, setState, workroom, DISTRICT, selectedAgent } from './state.js';
import { $, esc, ago, rnd, STANDALONE, pick } from './utils.js';
import { BUILDINGS, HOME_BUILDINGS, HOME_TEAM, BRAIN_COUNT, BRAIN_GROUPS, NOTES } from './demo-data.js';
import { initTools, onTool } from './tools-bar.js';
import { initRouter } from './router.js';
import { nextMode, LOCATION, MODE, simTime, eastWest } from './daylight.js';
import { ACTIONS, emit, route, WORLD } from './world.js';
import { flyToBrain, enterFloor } from './navigation.js';
import { timeShort, initConversations, convState, hasHomeChat, openAgent, openConv, send, renderConv, focusWatchdog, tabInCode, inCodeCursor, height } from './conversations.js';
import { runningInBackground, threadNumber, floorId, agentIndex, CONV_STORE, loadConv, floorCount, send as apiSend, permission, isReal, messageConv, stop } from './api.js';
import { drawControlCenter, floorLabel } from './control-center.js';
import { initAlerts, notify, beep } from './alerts.js';
import { ico, agentIcon } from './icons.js';
import { M } from './modules.js';
import { initBrain, brainRow } from './brain.js';
import { t as tt, tn as tnn, locale } from './i18n.js';

export function selectHouseAgent(i) {
  if (HOME_TEAM[homeModule]?.[i]?.chat && hasHomeChat(homeModule)) return void M.home?.openHomeChat(homeModule, { lastSeen: true }); // conversational agent (Trainer, Gardener…): a click in the team or in 3D opens its chat
  setState({ houseAgent: i }); setState({ houseTab: 'team' }); active?.refreshTags?.(); refreshTeam(); refreshPanel(); }
export function teamHouseHtml(team) {
  const now = simTime();
  return team.map((a) => { const st = M.home?.houseAgentState(a, now), { last, next } = M.home?.runsAround(a, now); return `
    <div class="block" style="${houseAgent === a.i ? 'border-color:var(--ink)' : ''}" data-da="${a.i}">
      <div style="display:flex;gap:10px;align-items:center">${agentIcon(a, 'center')}
        <div style="flex:1"><div style="font-weight:700;display:flex;gap:7px;align-items:center">${esc(a.name)}<span class="point ${st}"></span></div><div class="mono">${esc(a.role)}</div></div></div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin-top:10px;font-size:12.5px">
        <span class="mono">${tt('app.home.tm.task')}</span><span>${a.task ? `<code>${esc(a.task)}</code>` : tt('app.home.tm.withoutSchedule')}</span>
        <span class="mono">${tt('app.home.tm.schedule')}</span><span>${a.times ? `${a.days ? a.days.map((d) => tt('app.home.daysLong.' + d)).join(', ') + ' ' : a.daysMonth ? tt('app.home.sb.firstWeek') + ' ' : tt('app.home.tm.daily') + ' '}${a.times.join(', ')}` : tt('app.home.sp.onRequest')}</span>
        <span class="mono">${tt('app.home.ur.status')}</span><span style="font-weight:600">${esc(M.home?.houseAgentText(a, st))}</span>
        ${a.times ? `<span class="mono">${tt('app.home.tm.lastUsed')}</span><span>${a.server ? (a.server.last ? `${M.home?.whenRun(new Date(a.server.last.when), now)}${a.server.last.ok === false ? ' · ' + ico('warning') + ' ' + tt('app.home.kn.error') : ''}` : '—') : last ? M.home?.whenRun(last, now) : '—'}</span>` : ''}
        ${a.server?.next ? `<span class="mono">${tt('app.home.tm.nextRun')}</span><span>${a.server.enabled ? M.home?.whenRun(new Date(a.server.next), now) : tt('app.home.tm.disabled')}</span>` : ''}
      </div>
      ${a.passive ? '' : a.chat ? `<div class="btns" style="margin-top:10px"><button class="btn p" data-start="${a.i}">${ico('chat')} ${tt('app.home.tm.write')}</button></div>` : `<div class="btns" style="margin-top:10px"><button class="btn ${st === 'work' ? '' : 'p'}" data-start="${a.i}" ${st === 'work' ? 'disabled' : ''}>${st === 'work' ? tt('app.home.sp.running2') : ico('play') + ' ' + tt('app.home.sp.startNow')}</button>${a.server ? `<button class="btn ${a.server.enabled ? 'ok' : ''}" data-toggle="${a.i}" role="switch" aria-checked="${a.server.enabled}" title="${tt('app.home.sp.scheduleServer')}">${a.server.enabled ? '● ' + tt('app.home.sp.runningFromServer2') : '○ ' + tt('app.home.sp.runningFromServerOff')}</button>` : ''}</div>`}
      ${a.server && !a.server.enabled ? `<div class="mono" style="margin-top:6px">${tt('app.home.sp.agoEnabling', { task: `<code>${esc(a.task)}</code>` })}</div>` : ''}
    </div>`; }).join('') + `<div class="mono" style="margin:4px 2px">${tt('app.home.tm.agents')} ${team.some((a) => a.server) ? tt('app.home.tm.real') : tt('app.home.tm.sample')}</div>`;
}
// =====================================================================
// UI

// =====================================================================
const statusTxt = (st) => (['work', 'pending', 'done', 'none', 'delegates'].includes(st) ? tt('app.panel.status.' + st) : undefined);
export function toast(t) { const el = $('toast'); el.classList.remove('action'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2600); }
// message with an Open button (2026-11-24): the task runs in the background, the app does not move you anywhere; Open goes to the conversation
export function toastOpen(t, onClick) {
  const el = $('toast'); el.innerHTML = `${esc(t)} <button class="btn ok" type="button">${tt('app.panel.open')}</button>`; el.classList.add('on', 'action');
  el.querySelector('button').onclick = () => { el.classList.remove('on', 'action'); onClick(); };
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on', 'action'), 8000);
}
const when = (u) => { const s = WORLD.time - (u.end ?? u.time); return s < 60 ? tt('app.panel.when.now') : s < 3600 ? tt('app.panel.when.min', { n: Math.round(s / 60) }) : s < 86400 ? tt('app.panel.when.h', { n: Math.round(s / 3600) }) : tt('app.panel.when.d', { n: Math.round(s / 86400) }); };

// clock
// v19: the city time of day is in the ⋯ menu (#clock); the DOM is written only when the minute changes
const tickClock = () => { const el = $('clock'), t = simTime().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }); if (el.textContent !== t) el.textContent = t; };

// input and router
export function fillSelect() {
  const s = $('fromDest'); const sel = s.value;
  s.innerHTML = `<option value="">${tt('app.panel.auto')}</option>` + BUILDINGS.map((b) => `<optgroup label="${esc(b.title)}">${b.floors.map((p) => `<option value="${esc(p.n)}">${esc(floorLabel(p.n))}</option>`).join('')}</optgroup>`).join('');
  s.value = active?.kind === 'floor' ? active.n : sel || '';
  drawSelect();
}
// v13b: custom dropdown project picker (instead of the system <select>, which stays hidden as the value)
function drawSelect() {
  const s = $('fromDest'), hour = s.value, b = BUILDINGS.find((x) => x.floors.some((p) => p.n === hour));
  $('fromDestBtn').innerHTML = `${b ? `<span class="point" style="background:${b.color}"></span>` : ''}<span class="t">${hour ? esc(hour) : tt('app.panel.auto')}</span><i>▾</i>`;
  $('fromDestMenu').innerHTML = `<input id="fromDestSearch" placeholder="${tt('app.panel.searchProject')}"><div class="po auto ${hour ? '' : 'on'}" data-v=""><b>${tt('app.panel.auto')}</b><span>${tt('app.panel.autoDescription')}</span></div>` +
    BUILDINGS.map((x) => `<div class="sk"><span class="point" style="background:${x.color}"></span>${esc(x.title)}</div>` + x.floors.map((p) => `<div class="po ${p.n === hour ? 'on' : ''}" data-v="${esc(p.n)}"><b>${esc(floorLabel(p.n))}</b><span>${esc(p.description || '')}</span>${p.sessions ? `<em>${tt('app.panel.sessions', { n: p.sessions })}</em>` : ''}</div>`).join('')).join('');
  $('fromDestMenu').querySelectorAll('.po').forEach((el) => (el.onclick = () => { s.value = el.dataset.v; closeSelect(); drawSelect(); refreshHint(); $('zText').focus(); }));
  const h = $('fromDestSearch');
  h.oninput = () => { const q = h.value.toLowerCase(); $('fromDestMenu').querySelectorAll('.po').forEach((el) => el.classList.toggle('hidden', !!q && !el.textContent.toLowerCase().includes(q))); $('fromDestMenu').querySelectorAll('.sk').forEach((sk) => { let n = sk.nextElementSibling, seen = false; while (n && n.classList.contains('po')) { if (!n.classList.contains('hidden')) seen = true; n = n.nextElementSibling; } sk.style.display = seen ? '' : 'none'; }); };
  h.onkeydown = (e) => { if (e.key === 'Enter') { const first = [...$('fromDestMenu').querySelectorAll('.po:not(.hidden)')][h.value ? 0 : 1]; first?.click(); } if (e.key === 'Escape') closeSelect(); };
}
function closeSelect() { $('fromDestUi').classList.remove('on'); }
function refreshHint() {
  const text = $('zText').value.trim();
  if (!text) { $('hint').innerHTML = tt('app.panel.hint.example'); return; }
  const r = route(text, $('fromDest').value || null), a = WORLD.floors.get(r.n).agents[r.a];
  $('hint').innerHTML = `→ <b>${esc(floorLabel(r.n))} · ${esc(a.name)}</b>${r.a === 0 ? tt('app.panel.hint.splits') : ''}${r.reason.length ? `${tt('app.panel.hint.byWords')}${r.reason.slice(0, 3).map((d) => `„${esc(d)}…“`).join(', ')}` : ''}`;
}

// Brain card: real mode = the line "Written today N · read M" and the latest event from /api/brain, until data arrives the original text; demo = sample
export function refreshBrainCard() {
  const p = WORLD.brain.last, mel = $('brainText'), real = brainRow();
  const mt = real ?? `<span class="mono">${tt('app.panel.brain.count', { n: BRAIN_COUNT })}</span><br>${p && !p.isReal ? `${p.direction === 'write' ? tt('app.panel.brain.wrote') : tt('app.panel.brain.read')} <b>${esc(p.who)}</b><br><span style="color:var(--muted)">${esc(p.position)}</span>` : tt('app.panel.brain.second')}`;
  if (mel.dataset.h !== mt) { mel.dataset.h = mt; mel.innerHTML = mt; }
}
export function refreshPanel() {
  focusWatchdog(); // focus mode is cancelled when no conversation is open
  applyProfilePanel(); // when switching between profiles (conversations, overview, home) it switches the width and hiding (otherwise does nothing)
  drawControlCenter(); // Control Center bar: only on its floor, hidden otherwise (redrawn only on change)
  const inFloors = active?.kind === 'floor';
  const real = isReal();
  // wave 2: the "What needs to be done?" router is the only input field in the city and in Home (the old field with the project picker only in the demo)
  const prMode = !inFloors && real; $('panel').classList.toggle('prMode', prMode);
  // Brain card: in real mode data from /api/brain (brain.js), otherwise a sample (demo only); written only on change
  if (!prMode || real) refreshBrainCard();
  // Workroom (wave 3): outside a floor it shows only the "What needs to be done?" router in the middle (body.prNova), Home only when its module is open
  const homePanel = !inFloors && DISTRICT === 'home' && (!workroom || !!homeModule);
  document.body.classList.toggle('prNew', workroom && !inFloors && !homePanel);
  if (homePanel) return M.home?.renderHome(); // Home building Chat tab: renderHome hands the drawing over to conversations.js (renderConv)
  if (inFloors && real) return renderConv(); // phase 3: floor = conversations with real agents (the Tasks tab was removed 2026-11-18)
  $('panel').classList.remove('convMode');
  if (selectedAgent !== null && inFloors && !real) return refreshDetail();
  $('agEnter').classList.toggle('on', inFloors && real);
  if (!inFloors && real) return renderOverview(); // v13d: city overview (Now, Today, Done)
  let ul = WORLD.tasks.filter((u) => !inFloors || u.p === active.n);
  const count = (k) => ul.filter((u) => k === 'all' || u.column === k || (k === 'doing' && u.column === 'flies')).length;
  const order = { pending: 0, doing: 1, flies: 1, rad: 2, done: 3 };
  const list = ul.filter((u) => filter === 'all' || u.column === filter || (filter === 'doing' && u.column === 'flies'))
    .sort((a, b) => order[a.column] - order[b.column] || (a.column === 'done' ? (b.end ?? b.time) - (a.end ?? a.time) : b.progress - a.progress)).slice(0, 40);
  const ch = ['all', 'rad', 'doing', 'pending', 'done'].map((x) => [x, tt('app.panel.chip.' + x)]);
  $('content').innerHTML = `
    <div class="headline"><span class="serif">${tt('app.panel.taskState')}</span><span class="mono">${inFloors ? esc(floorLabel(active.n)) : tt('app.panel.wholeCity')}</span></div>
    <div class="chips">${ch.map(([k, nz]) => `<button data-f="${k}" class="${filter === k ? 'on' : ''} ${k === 'pending' ? 'pendingChip' : ''}">${nz} ${count(k)}</button>`).join('')}</div>
    ${list.length ? list.map((u) => { const a = WORLD.floors.get(u.p).agents[u.a]; const st = u.column === 'flies' ? 'doing' : u.column;
      const indeterminate = real && st === 'doing' && !u.plan; // without an agent plan we do not know the percentage (previously made up, it grew toward 92 %), UX audit wave 1
      return `
      <div class="ul ${st}" data-id="${u.id}">
        <span class="pct">${st === 'pending' ? tt('app.panel.pct.pending') : st === 'rad' ? '—' : indeterminate ? tt('app.panel.pct.running') : Math.round(u.progress * 100) + '%'}</span>
        <div class="tx"><b>${esc(u.text)}</b><span>${agentIcon(a, 'xs')} ${esc(a.name)} · ${esc(u.p)}</span></div>
        <span class="when">${when(u)}</span>
        <div class="bar${indeterminate ? ' indeterminate' : ''}"><i style="width:${indeterminate ? 30 : Math.round(u.progress * 100)}%"></i></div>
        ${st === 'pending' ? (real ? '<div class="mini"><span class="mono">' + ico('pending') + ' ' + tt('app.panel.openApprove') + '</span></div>' : `<div class="mini"><button class="btn ok" data-r="1">${tt('app.panel.allow')}</button><button class="btn no" data-r="0">${tt('app.panel.reject')}</button></div>`) : ''}
      </div>`; }).join('') : `<div class="empty">${tt('app.panel.noneHere')}</div>`}`;
  $('content').querySelectorAll('.chips button').forEach((b) => (b.onclick = () => { setState({ filter: b.dataset.f }); refreshPanel(); }));
  $('content').querySelectorAll('.ul').forEach((el) => (el.onclick = (e) => {
    const u = WORLD.tasks.find((x) => x.id === +el.dataset.id);
    if (e.target.dataset.r !== undefined && !real) { e.stopPropagation(); ACTIONS.decide(u.p, u.a, e.target.dataset.r === '1'); refreshPanel(); return; }
    if (real && u.conv) { // a real task = a conversation with an agent: open it (on another floor, enter first)
      if (active?.kind === 'floor' && active.n === u.p) return openConv(u.conv);
      return enterFloor(u.p).then(() => openConv(u.conv));
    }
    if (active?.kind === 'floor' && active.n === u.p) selectAgent(u.a); else enterFloor(u.p, u.a);
  }));
}

// ---------- v13d: city overview in three parts ----------
// Now = conversations waiting for you (✋ approval, 💬 reply) and those running (at most 5). Today = /api/today:
// schedule from the morning brief, tasks today, tomorrow and overdue from live Notion (tasks, Wave 3b). Done (7 days: Today, Yesterday, This week; older up to 30) = a collapsed row, when expanded
// by floor (last 3), only the last 24 h. The source is real conversations (KS.konv), not animation tasks.
// The HTML is rewritten only on change, so frequent panel refreshes cost nothing.
const TODAY = { data: null, when: 0, loading: false, again: false };
let hotOpen = false, hotOlder = false;
// The only client subscriber of /api/today (Wave 3b): City overview, Workroom, My house, Home overview and the Task office board read this data,
// no extra server call. Refresh at most once per 5 min, after a task change (SSE 'tasks', task-office.js) immediately via refreshToday().
export function todayData() { loadToday(); return TODAY.data; }
export function refreshToday() { TODAY.when = 0; if (TODAY.loading) TODAY.again = true; else loadToday(); }
function loadToday() {
  if (!M.home) return; // /api/today belongs to the Home module, without it it is not called
  if (TODAY.loading || Date.now() - TODAY.when < 5 * 60e3) return;
  TODAY.loading = true;
  let locked = false; // 401 = card locked (lock.js): keep the old data, after unlocking (event city-unlocked) it is loaded immediately
  fetch('/api/today', { cache: 'no-store' }).then((r) => { locked = r.status === 401; return locked ? null : r.json(); }).then((d) => { if (!locked) TODAY.data = d; })
    .catch(() => { TODAY.data = { error: tt('app.panel.serverNotResponding') }; })
    .finally(() => {
      TODAY.when = Date.now(); TODAY.loading = false;
      if (locked) return;
      if (TODAY.again) { TODAY.again = false; TODAY.when = 0; return loadToday(); }
      M.home?.refreshBoard(); // 3D Task office board: total count from tasks.otvorene
      if (active?.kind !== 'floor') refreshPanel();
    });
}
// Today's tasks only from /api/today → tasks (the server picks them from live Notion, on an outage a backup from the brief); the app only formats them.
// null until data is available. Item: { id, code, text, link, when, date }; when: "20:00" / "today", "tomorrow 9:00", overdue "3. 11.".
const pad2 = (n) => String(n).padStart(2, '0');
function whenTasks(t, kind) {
  if (!t) return kind === 'today' ? tt('app.panel.today') : kind === 'tomorrow' ? tt('app.panel.tomorrow') : '';
  const front = t.length === 10, d = new Date(front ? t + 'T00:00:00' : t); if (isNaN(d)) return '';
  const hm = front ? '' : d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
  if (kind === 'today') return hm || tt('app.panel.today');
  if (kind === 'tomorrow') return hm ? tt('app.panel.tomorrowHm', { hm }) : tt('app.panel.tomorrow');
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'numeric' });
}
const dateTasks = (t) => { if (!t) return null; if (t.length === 10) return t; const d = new Date(t); return isNaN(d) ? null : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
export function todayTasks() {
  const u = todayData()?.tasks; if (!u) return null;
  const pol = (kind) => (u[kind] || []).map((x) => ({ id: x.id, code: x.code, text: x.text, link: x.url, when: whenTasks(x.dueSlot, kind), date: dateTasks(x.dueSlot), ms: x.dueSlot && x.dueSlot.length > 10 ? Date.parse(x.dueSlot) || null : null }));
  return { source: u.source, error: u.error || null, restored: u.restored || null, open: u.open ?? null, today: pol('today'), tomorrow: pol('tomorrow'), poTermine: pol('poTermine') };
}
// today status rows for both Overview and Workroom: brief failed / tasks only from backup / Notion refresh failed (texts provided by the server)
export function todayAlerts(d = TODAY.data) {
  const u = d?.tasks, z = [];
  if (d?.brief?.je === false) z.push(d.brief.error || tt('app.panel.brief.no'));
  if (u?.source === 'brief') z.push(`${tt('app.panel.brief.backup')}${u.error ? `: ${u.error}` : ''}`);
  else if (u?.error) z.push(tt('app.panel.notion.failed', { error: u.error }));
  return z;
}
// Wave 2 (UX audit 2026-11-17): a simple request (not a plan, not delegation) can be handled directly in the Overview, a running conversation can be stopped.
// Messages of a waiting conversation are loaded once (GET), until then the row shows only "✋ approve" and a click opens the thread.
export function pendingRequest(k) {
  if (k.status !== 'pending') return null;
  const sp = CONV_STORE.messages.get(k.id);
  if (!sp) { if (!CONV_STORE.errors.has(k.id)) loadConv(k.id); return null; }
  for (let j = sp.length - 1; j >= 0; j--) if (sp[j]?.type === 'approve' && !sp[j].resolved) return sp[j].plan ? null : sp[j];
  return null;
}
const shortN = (n) => String(n || '').replace(/\s*\(.*?\)\s*/g, ' ').trim(); // "Experimental floor (phase 3)" → "Experimental floor"
// v19: name + gray floor, on the right time or status; ■ stop and ✓ done only on hover (CSS .prR:hover), a dot only when running and waiting
function rowConv(k, children = null, withoutFloor = false) { // children: Map parent → count of running teammate tasks (Running only)
  // Home agents (Evening journal, Mail, Gardener…) run on the virtual floor domov/<k>, which is not in WORLD: the row opens the thread in the Home building chat (2026-11-18)
  const dk = String(k.floor || '').startsWith('home/') ? k.floor.slice(5) : null, db = dk && HOME_BUILDINGS.find((b) => b.k === dk);
  const n = db ? '' : floorCount(k.floor), P = n && WORLD.floors.get(n), i = P ? agentIndex(P, k.agent) : null, a = db ? { emoji: '🏠', name: db.title } : (i != null && P.agents[i]) || { emoji: '👤', name: k.agent };
  const z = pendingRequest(k), nd = children instanceof Map ? children.get(k.id) || 0 : 0;
  const where = db ? tt('app.panel.homeWhere', { title: db.title }) : n ? shortN(floorLabel(n)) : '';
  const tip = `${k.title}\n${a.name}${threadNumber(k) ? ' #' + threadNumber(k) : ''}${n ? ' · ' + floorLabel(n) : db ? ' · ' + tt('app.panel.home') : ''}${k.parent ? ' · ' + tt('app.panel.fromLead') : ''}${nd ? ' · ' + tnn('app.panel.runningTasks', nd) : ''}`;
  const point = k.status === 'pending' || k.status === 'reply' ? '<span class="point pending"></span>' : k.status === 'running' || nd ? '<span class="point work"></span>' : '';
  const symbol = z ? `<span class="prSch" title="${esc(z.what)} · ${esc(z.where || '')}"><span class="convSymbol pending">${ico('pending')} ${esc(String(z.what || tt('app.panel.approve')).slice(0, 28))}</span><span class="prSchB"><button class="btn ok" data-psch="${esc(z.id)}" data-r="allow">${tt('app.panel.allow')}</button><button class="btn no" data-psch="${esc(z.id)}" data-r="reject">${tt('app.panel.reject')}</button></span></span>`
    : k.status === 'pending' ? '<span class="convSymbol pending">' + ico('pending') + ' ' + tt('app.panel.approve') + '</span>' : k.status === 'reply' ? `<span class="prAns"><span class="convSymbol ans">${tt('app.panel.yourReply')}</span><button class="resolveBtn" data-resolve="${esc(k.id)}" title="${tt('app.panel.resolveTitle')}">${tt('app.panel.resolved')}</button></span>` : k.status === 'running' ? `<span class="prAns"><span class="convSymbol running">${k.start ? esc(timeShort(k.start)) : tt('app.panel.running')}</span><button class="resolveBtn" data-pstop="${esc(k.id)}" title="${tt('app.panel.stopTitle')}">${ico('stop')} ${tt('app.panel.stop')}</button></span>` : `<span class="convSymbol">${esc(timeShort(k.changed || 0))}</span>`;
  return `<div tabindex="0" role="button" class="prR ${k.status}${point ? ' sb' : ''}" data-conv="${esc(k.id)}" data-n="${esc(n || '')}"${db ? ` data-home="${esc(dk)}"` : ''} title="${esc(tip)}"><div class="tx"><b>${point}<span class="t">${esc(k.title)}</span></b>${withoutFloor || !where ? '' : `<span>${esc(where)}</span>`}</div>${symbol}</div>`;
}
// 2 hours ahead (or already past the start) = task time in red
const soonMs = (x) => { let ms = x.ms; if (ms == null && x.calendar) { const m = /^(\d{1,2}):(\d{2})/.exec(x.when || ''); if (m) ms = new Date().setHours(+m[1], +m[2], 0, 0); } return ms != null && ms - Date.now() < 2 * 36e5; };
function renderOverview() {
  loadToday();
  const all = [...CONV_STORE.conv.values()], order = { pending: 0, reply: 1, running: 2 };
  // teammate tasks (k.rodic) have no row of their own, only when waiting for approval; a lead with running tasks stays on top with a count (UX audit 2026-11-17)
  const children = new Map(); for (const k of all) if (k.parent && k.status === 'running') children.set(k.parent, (children.get(k.parent) || 0) + 1);
  const vs = all.filter((k) => !k.parent || k.status === 'pending');
  const current = vs.filter((k) => k.status in order || children.has(k.id)).sort((x, y) => (order[x.status] ?? 2) - (order[y.status] ?? 2) || (y.changed || 0) - (x.changed || 0));
  const pendingYou = current.filter((k) => k.status === 'pending' || k.status === 'reply'), running = current.filter((k) => k.status !== 'pending' && k.status !== 'reply');
  const midnight = new Date().setHours(0, 0, 0, 0), DAY = 864e5, limit = midnight - (hotOlder ? 29 : 6) * DAY;
  // Waiting for you (always in full), then Running and Recent (done in the last 2 hours), at most 8 rows in total (assignment 2026-11-12; v19: three sections without numbers)
  const MAX_LAST = 8, recent = vs.filter((k) => k.status === 'done' && !children.has(k.id) && (k.changed || 0) >= Date.now() - 2 * 36e5).sort((x, y) => (y.changed || 0) - (x.changed || 0));
  const free = Math.max(0, MAX_LAST - pendingYou.length), other = [...running, ...recent], show = other.slice(0, free);
  const runningU = show.filter((k) => running.includes(k)), nedU = show.filter((k) => !running.includes(k));
  const inLast = new Set([...pendingYou, ...show].map((k) => k.id));
  const hot = vs.filter((k) => k.status === 'done' && (k.changed || 0) >= limit && !inLast.has(k.id)).sort((x, y) => (y.changed || 0) - (x.changed || 0));
  const period = (t) => (t >= midnight ? tt('app.panel.obd.today') : t >= midnight - DAY ? tt('app.panel.obd.yesterday') : t >= midnight - 6 * DAY ? tt('app.panel.obd.tyzden') : tt('app.panel.obd.older'));
  const sec = (t, tr = '') => `<div class="convSec ${tr}">${t}</div>`;
  let h = `<div class="headline"><span class="serif">${tt('app.panel.overview')}</span></div>`;
  // failed Home agent runs in 24 h (/api/today → failed, tower.js failedRuns): on top, a click opens the building Team with "Run now" (UX audit 2026-11-17)
  const bad = TODAY.data?.failed || [];
  if (!pendingYou.length && !show.length && !bad.length) h += `<div class="prQuiet"><b>✓</b> ${tt('app.panel.nobody')}</div>`;
  if (bad.length) h += sec(tt('app.panel.failed'), 'pending') + bad.map((z) => `<div tabindex="0" role="button" class="prR failed" data-failed="${esc(z.k)}" title="${tt('app.panel.failedTitle')}"><div class="tx"><b><span class="point pending"></span><span class="t">${esc(tt('app.panel.begFailed', { name: z.name }))}</span></b><span>${esc(z.building)} · ${esc(ago(Date.parse(z.when)))}</span></div><span class="convSymbol pending">${tt('app.panel.view')}</span></div>`).join('');
  if (pendingYou.length) h += sec(tt('app.panel.pendingOnYou'), 'pending') + pendingYou.map((k) => rowConv(k, children)).join('');
  if (runningU.length) h += sec(tt('app.panel.running2')) + runningU.map((k) => rowConv(k, children)).join('');
  if (nedU.length) h += sec(tt('app.panel.recent')) + nedU.map((k) => rowConv(k, children)).join('');
  if (other.length > free) h += `<div class="prNote">${tt('app.panel.more', { n: other.length - free })}${running.length > free ? tt('app.panel.working') : ''}</div>`;
  // Today (Wave 3b): schedule from the brief, tasks today and tomorrow only from /api/today → tasks; overdue one summary row (number only once)
  const d = TODAY.data, U = todayTasks(), alert = d && !d.error ? todayAlerts(d) : [];
  const items = d ? [...(d.schedule || []).filter((r) => !r.ran).map((r) => ({ calendar: 1, when: r.time, code: r.code, text: r.what + (r.where ? ` · ${r.where}` : '') })), ...(U?.today || []).map((x) => ({ ...x, today: 1 })), ...(U?.tomorrow || [])] : [];
  const po = U?.poTermine || [];
  if (M.home) { // Today belongs to the Home module (/api/today)
  h += sec(tt('app.panel.forToday'));
  if (!d) h += `<div class="prNote">${tt('app.panel.loading')}</div>`;
  else if (d.error) h += `<div class="prQuiet error">${ico('warning')} ${esc(d.error)}</div>`;
  h += alert.map((t) => `<div class="prQuiet error">${ico('warning')} ${esc(t)}</div>`).join('');
  if (d && !d.error && !items.length && !po.length) h += `<div class="prQuiet"><b>✓</b> ${tt('app.panel.noneRemains')}</div>`;
  if (po.length) h += `<div class="today poTer" tabindex="0" role="button" data-poter="1" title="${tt('app.panel.poTermTitle')}"><b>${tt('app.panel.poTerm', { n: po.length })}</b><span class="dCode">${tt('app.panel.oldest')} ${esc(po[0].code || '')} ${esc(po[0].text)}</span><span class="when">${tt('app.panel.taskOfficeTasks')}</span></div>`;
  h += items.map((x, i) => `<div class="today" tabindex="0" role="button" data-today="${i}" data-code="${esc(x.code || '')}"><b>${esc(x.text)}</b><span class="dCode">${esc(x.code || tt('app.panel.personal'))}${x.link ? `<a class="dNot" href="${esc(x.link)}" target="_blank" rel="noopener">Notion ${ico('out')}</a>` : ''}</span><span class="when ${soonMs(x) ? 'soon' : ''}">${esc(x.when)}</span>${!x.calendar && x.code && WORLD.floors.has(x.code) ? `<button class="agent" data-agent="${i}" title="${tt('app.panel.agentTitle')}">${tt('app.panel.agent')}</button>` : ''}</div>`).join('');
  }
  h += `<button class="convSec hotLink" id="hotToggle">${tt('app.panel.completed')} ${hotOpen ? '⌄' : '›'}</button>`;
  if (hotOpen) {
    const obd = new Map(); for (const k of hot) { const o = period(k.changed || 0); if (!obd.has(o)) obd.set(o, new Map()); const po = obd.get(o), n = floorCount(k.floor) || '?'; if (!po.has(n)) po.set(n, []); po.get(n).push(k); }
    for (const [o, po] of obd) {
      h += `<div class="hotObd">${o}</div>`;
      for (const [n, rows] of po) h += `<div class="hotSk">${esc(shortN(n))}</div>` + rows.slice(0, 3).map((k) => rowConv(k, null, true)).join('');
    }
    if (!hot.length) h += `<div class="prNote">${tt('app.panel.hotNone', { n: hotOlder ? '30' : '7' })}</div>`;
    h += `<button class="hotOlder" id="hotOlder">${hotOlder ? tt('app.panel.hot7') : tt('app.panel.hot30')}</button>`;
  }
  const o = $('content');
  if (o.dataset.overview === h && o.querySelector('#hotToggle')) return; o.dataset.overview = h; o.innerHTML = h;
  o.querySelectorAll('[data-resolve]').forEach((b) => (b.onclick = (e) => {
    e.stopPropagation(); b.disabled = true;
    messageConv('resolve', { ids: [b.dataset.resolve] }).then(() => { if (active?.kind !== 'floor') refreshPanel(); }).catch(() => { b.disabled = false; }); // the state arrives as a 'konv' event, redraw immediately (saving mode would wait)
  }));
  o.querySelectorAll('[data-psch]').forEach((b) => (b.onclick = (e) => { // Allow / Deny directly from the Overview (wave 2)
    e.stopPropagation(); b.parentElement.querySelectorAll('button').forEach((x) => (x.disabled = true));
    permission(b.dataset.psch, b.dataset.r, '').then(() => toast(b.dataset.r === 'allow' ? tt('app.panel.allowed') : tt('app.panel.rejected'))).catch((err) => { toast(tt('app.panel.requestNotPending', { error: err.message })); o.dataset.overview = ''; refreshPanel(); });
  }));
  o.querySelectorAll('[data-pstop]').forEach((b) => (b.onclick = (e) => {
    e.stopPropagation(); b.disabled = true;
    stop(b.dataset.pstop).then(() => toast(tt('app.panel.stopping'))).catch((err) => { b.disabled = false; toast(err.message); });
  }));
  o.querySelectorAll('[data-conv]').forEach((el) => {
    el.onclick = () => {
      const dk = el.dataset.home; if (dk) { o.dataset.overview = ''; M.home?.openHomeChat(dk, { id: el.dataset.conv }); return; } // thread in the Home building chat (a building without chat: only its panel)
      const n = el.dataset.n, id = el.dataset.conv; if (!n) return; o.dataset.overview = ''; setState({ hover: null }); enterFloor(n).then(() => openConv(id)); };
    // hovering over a row highlights its floor in the city (glass, edges and tower labels), so you learn what is where
    el.onmouseenter = () => { if (active?.kind === 'city' && el.dataset.n) setState({ hover: el.dataset.n }); };
    el.onmouseleave = () => { if (active?.kind === 'city') setState({ hover: null }); };
  });
  o.querySelectorAll('[data-failed]').forEach((el) => (el.onclick = () => { o.dataset.overview = ''; M.home?.openModule(el.dataset.failed); setState({ houseTab: 'team' }); refreshPanel(); }));
  o.querySelectorAll('[data-poter]').forEach((el) => (el.onclick = () => { o.dataset.overview = ''; M.home?.setFilter('po'); M.home?.openModule('tasks'); }));
  o.querySelectorAll('[data-today]').forEach((el) => (el.onclick = (e) => {
    if (e.target.closest('a')) return; // the Notion link opens by itself
    const n = el.dataset.code, x = items[+el.dataset.today]; if (!n || !WORLD.floors.has(n)) return;
    const agent = !!e.target.closest('[data-agent]'); o.dataset.overview = '';
    enterFloor(n).then(() => { if (!agent) return; openConv(null); const t = $('agText'); t.value = tt('app.panel.help', { text: x.text, when: x.when }); height(); t.focus(); });
  }));
  $('hotToggle').onclick = () => { hotOpen = !hotOpen; renderOverview(); };
  const hs = $('hotOlder'); if (hs) hs.onclick = () => { hotOlder = !hotOlder; renderOverview(); };
}

function refreshDetail() {
  const n = active.n, a = WORLD.floors.get(n).agents[selectedAgent];
  $('agEnter').classList.add('on');
  const u = a.task;
  let h = `<button class="backLink" id="backTasks">${tt('app.panel.backTasks')}</button>
    <div class="agHead">${agentIcon(a, 'big')}<div><div class="serif">${esc(a.name)}</div><div class="mono">${esc(a.role)}</div></div></div>
    <div class="block"><div class="mono">${tt('app.panel.currentTask')}</div><div style="margin-top:6px;font-weight:600;display:flex;gap:8px;align-items:center"><span class="point ${a.status}"></span>${u ? esc(u.text) : statusTxt(a.status) || a.status}</div>${u?.step && u.plan ? `<div class="mono" style="margin-top:4px">${esc(tt('app.panel.step', { h: u.plan.h + 1, n: u.plan.n, step: u.step }))}</div>` : ''}${u ?`<div class="bar"><i style="width:${Math.round(u.progress * 100)}%"></i></div>` : ''}</div>`;
  if (a.status === 'pending' && a.request) { const [what, where, content] = a.request; h += `<div class="card"><div style="font-weight:700">${ico('pending')} ${esc(what)}</div><div class="mono">${esc(where)}</div><pre><span class="ins">${esc(content)}</span></pre><div class="btns"><button class="btn ok" data-r="1">${tt('app.panel.allow')}</button><button class="btn">${tt('app.panel.always')}</button><button class="btn no" data-r="0">${tt('app.panel.reject')}</button></div></div>`; }
  h += `<div class="block"><div class="mono">${tt('app.panel.rules')}</div>${a.rules.length ? a.rules.map((r) => `<span class="rule">✓ ${esc(r)}</span>`).join('') : `<div style="font-size:12.5px;color:var(--muted);margin-top:6px">${tt('app.panel.yetNone')}</div>`}</div>
    <div class="mono" style="margin-top:12px">${tt('app.panel.record')}</div><div class="log">${a.log.map((l) => l.kind === 'chip' ? `<div class="chip">${esc(l.text)}</div>` : `<div class="msg ${l.kind}">${esc(l.text)}</div>`).join('')}</div>`;
  const o = $('content'); const down = o.scrollHeight - o.scrollTop - o.clientHeight < 40;
  o.innerHTML = h;
  $('backTasks').onclick = () => selectAgent(null);
  o.querySelectorAll('.card button[data-r]').forEach((b) => (b.onclick = () => { ACTIONS.decide(n, a.i, b.dataset.r === '1'); refreshPanel(); }));
  if (down) o.scrollTop = o.scrollHeight;
}

export function refreshTeam() {
  if (active?.kind === 'interior') {
    const team = active.team;
    $('team').innerHTML = headSections('team', tt('app.panel.team'), team.length) + (PACK.team ? '' : team.map((a) => { const st = M.home?.houseAgentState(a); return `
      <div class="member ${a.i === houseAgent ? 'on' : ''}" data-i="${a.i}" title="${esc(a.role || '')}"><div class="av">${agentIcon(a)}</div>
        <div class="m">${esc(a.name)}${ACTIVE_STATUS.has(st) ? `<span class="point ${st}"></span>` : ''}</div><div class="u">${esc(M.home?.houseAgentText(a, st))}</div></div>`; }).join('')) + lastHtml();
    $('team').querySelectorAll('.member[data-i]').forEach((el) => (el.onclick = () => selectHouseAgent(+el.dataset.i)));
    attachTeamHeads();
    return;
  }
  if (active?.kind !== 'floor') return;
  const P = WORLD.floors.get(active.n);
  $('team').innerHTML = headSections('team', tt('app.panel.team'), P.agents.length) + (PACK.team ? '' : P.agents.map((a) => `
    <div class="member ${a.i === selectedAgent ? 'on' : ''}" data-i="${a.i}" title="${esc(a.role || '')}"><div class="av">${agentIcon(a)}</div>
      <div class="m">${esc(a.name)}${ACTIVE_STATUS.has(a.status) ? `<span class="point ${a.status}"></span>` : ''}</div>${ACTIVE_STATUS.has(a.status) ? `<div class="u">${statusTxt(a.status)}</div>` : ''}</div>`).join('')) + lastHtml();
  $('team').querySelectorAll('.member[data-i]').forEach((el) => (el.onclick = () => selectAgent(+el.dataset.i)));
  attachTeamHeads();
  // labels above agents are DOM that is redrawn often: it is touched only when the content changed
  for (const v of active.vis) {
    const a = v.a, update = ACTIVE_STATUS.has(a.status), cls = `tag ${a.status === 'pending' ? 'pending' : ''} ${a.i === selectedAgent ? 'on' : ''}`;
    const html = `${update ? `<span class="point ${a.status}"></span>` : ''}${esc(a.name)}${xN(a)}${update ? `<span class="t s">· ${statusTxt(a.status)}</span>` : ''}${stepTag(a)}`;
    if (v.sigC !== cls) { v.el.className = cls; v.sigC = cls; }
    if (v.sigH !== html) { v.el.innerHTML = html; v.sigH = html; }
    const tip = [a.role, a.task?.text].filter(Boolean).join(' · ');
    if (v.sigT !== tip) { v.el.title = tip; v.sigT = tip; }
  }
}
// Collapsing the Team panel (2026-11-17): the collapsed state is in localStorage.
// "Recent" section (left out in v19, restored 2026-11-18 on request): the newest main conversations from all floors (KS.konv),
// 5 rows, "more" shows 15 (PACK.poslViac); switching office → office without a trip through the city.
const PACK = (() => { try { return JSON.parse(localStorage.getItem('agentic-team-collapsed') || '{}'); } catch { return {}; } })();
const savePack = () => { try { localStorage.setItem('agentic-team-collapsed', JSON.stringify(PACK)); } catch {} };
const headSections = (k, title, n) => `<button class="teamHead" data-pack="${k}" aria-expanded="${!PACK[k]}"><span class="serif">${title}</span>${n ? `<span class="mono">${n}</span>` : ''}<span class="sip">${PACK[k] ? '▸' : '▾'}</span></button>`;
const ACTIVE_STATUS = new Set(['work', 'pending', 'delegates']);
const STATUS_CONV = { running: 'work', pending: 'pending', error: 'pending' };
const LAST_FEW = 5, LAST_MANY = 15;
function lastConv() {
  return [...CONV_STORE.conv.values()].filter((k) => !k.parent && floorCount(k.floor)).sort((x, y) => (y.changed || 0) - (x.changed || 0));
}
function lastHtml() {
  if (!isReal() || STANDALONE) return '';
  const all = lastConv(); if (!all.length) return '';
  const rows = all.slice(0, PACK.lastMore ? LAST_MANY : LAST_FEW);
  const here = active?.kind === 'floor' ? floorId(active.n) : null;
  return `<div class="teamLast">${headSections('last', tt('app.panel.last'), '')}` + (PACK.last ? '' : rows.map((k) => {
    const n = floorCount(k.floor), P = WORLD.floors.get(n), ia = P ? agentIndex(P, k.agent) : null, a = ia != null ? P.agents[ia] : null, st = STATUS_CONV[k.status];
    return `<div class="member ${here === k.floor && convState.open === k.id ? 'on' : ''}" data-conv="${esc(k.id)}" title="${esc(n)} · ${esc(k.title || tt('app.panel.newConv'))}"><div class="av">${a ? agentIcon(a) : ico('chat')}</div>
      <div class="m">${esc(k.title || tt('app.panel.newConv'))}${st ? `<span class="point ${st}"></span>` : ''}</div><div class="u">${here === k.floor ? tt('app.panel.tu') : esc(n)}${k.changed ? ' · ' + ago(k.changed) : ''}</div></div>`;
  }).join('') + (all.length > LAST_FEW ? `<button class="teamMore" data-last-more="1">${PACK.lastMore ? tt('app.panel.less') : tt('app.panel.showMore', { n: Math.min(all.length, LAST_MANY) })}</button>` : '')) + '</div>';
}
function attachTeamHeads() {
  $('team').querySelectorAll('.teamHead').forEach((b) => (b.onclick = () => { const k = b.dataset.pack; PACK[k] = !PACK[k]; savePack(); refreshTeam(); }));
  $('team').querySelectorAll('.member[data-conv]').forEach((el) => (el.onclick = () => openLast(el.dataset.conv)));
  $('team').querySelectorAll('[data-last-more]').forEach((b) => (b.onclick = () => { PACK.lastMore = !PACK.lastMore; savePack(); refreshTeam(); }));
}
function openLast(id) {
  const k = CONV_STORE.conv.get(id), n = k && floorCount(k.floor); if (!n) return;
  if (active?.kind === 'floor' && active.n === n) { openConv(id); refreshTeam(); return; }
  enterFloor(n, null, id).then(() => refreshTeam());
}
// conversations change constantly (messages, state): the list is redrawn at most once per 1.5 s and only when the Team panel is visible
let lastT = null;
function watchLast() {
  CONV_STORE.listen.add((type) => { if (type !== 'change' || lastT || !active || active === city || PACK.last) return; lastT = setTimeout(() => { lastT = null; if (active && active !== city) refreshTeam(); }, 1500); });
}
// the agent's current plan step (api.js planUlohy) under the label above the figure, only while it works
const stepTag = (a) => { const u = a.task; return a.status === 'work' && u?.step && u.plan ? `<span class="step">◐ ${u.plan.h + 1}/${u.plan.n} · ${esc(u.step)}</span>` : ''; };
// ×N badge by the name in the label above the figure (CSS2D tag, which is overwritten here anyway): the teammate runs in 2+ threads at once
const xN = (a) => { const n = active?.n && a.k ? runningInBackground(floorId(active.n), a.k).length : 0; return n >= 2 ? `<span class="x" title="${tt('app.panel.xN', { n })}">×${n}</span>` : ''; };
export function selectAgent(i) {
  if (isReal() && active?.kind === 'floor') { openAgent(i); refreshTeam(); return; } // phase 3: its newest conversation
  setState({ selectedAgent: i }); refreshTeam(); refreshPanel(); if (i !== null) $('content').scrollTop = 1e6;
}
export function setCrumbs() {
  if (STANDALONE) return; // in a separate window the window title is determined by the conversation (renderConv)
  // v19: breadcrumbs "City / Projects / Experiment" replace "← City" (a click on City and the building = back to the city, navigation.js), the floor description is in the title
  const dr = (t, tip) => `<button class="dr" data-d="1" title="${esc(tip)}">${esc(t)}</button>`, sep = '<span>/</span>';
  const html = active?.kind === 'interior' ? `${dr(tt('app.panel.city'), tt('app.panel.backCity'))}${sep}${dr(tt('app.panel.home'), tt('app.panel.backHome'))}${sep}<b title="${esc(active.B.description)}">${esc(active.B.title)}</b>`
    : active?.kind === 'floor' ? `${dr(tt('app.panel.city'), tt('app.panel.backEsc'))}${sep}${dr(floorLabel(WORLD.floors.get(active.n).building), tt('app.panel.backCity'))}${sep}<b title="${esc(WORLD.floors.get(active.n).def.description || '')}">${esc(floorLabel(active.n))}</b>` : '';
  const d = $('crumbs'); if (d.dataset.h !== html) { d.dataset.h = html; d.innerHTML = html; }
  const pending = WORLD.tasks.filter((u) => u.column === 'pending').length;
  document.title = pending ? `(${pending}) ${tt('app.panel.titleApp')}` : tt('app.panel.titleApp');
}

// ---------- transitions ----------
// The panel has three profiles with separate width and hiding (decision 2026-11-14), which do not affect each other:
// "conversations" = every floor with a chat (including virtual Home floors), "home" = Home dashboards and the interiors of its buildings,
// "overview" = city overview in the City district and in Work. The old profiles (map, office) and the shared key serve only as a default value.
// Switching happens in refreshPanel (also called by toggleDistrict and on entering an interior after the DISTRICT change).
const profilePanel = () => (active?.kind === 'floor' ? 'conversations' : active?.kind === 'interior' || DISTRICT === 'home' ? 'home' : 'overview');
const OLD_PROFILE = { overview: 'map', conversations: 'office', home: 'office' };
const keyPanel = (k, p = profilePanel()) => `agentic-panel-${k}-${p}`;
function readPanel(k, p) { try { return localStorage.getItem(keyPanel(k, p)) ?? localStorage.getItem(keyPanel(k, OLD_PROFILE[p])) ?? localStorage.getItem('agentic-panel-' + k); } catch { return null; } }
function savePanel(k, v) { try { localStorage.setItem(keyPanel(k), v); } catch {} }
let profileOnPanel = null;
function applyProfilePanel() {
  if (STANDALONE) return; // separate window: the panel at full width (CSS), nothing is read or saved
  const p = profilePanel(); if (p === profileOnPanel) return;
  profileOnPanel = p;
  const w = +readPanel('width', p);
  if (w) setWidth(w, false); else document.documentElement.style.removeProperty('--panelW');
  togglePanel(readPanel('hidden', p) === '1', false, false);
}
function togglePanel(hide = !document.body.classList.contains('panelHidden'), animate = true, save = true) {
  document.body.classList.toggle('panelHidden', hide);
  $('panelBtn').textContent = hide ? '‹' : '›';
  if (save) savePanel('hidden', hide ? '1' : '0');
  if (animate && active && !active.layers) { // Layers: the camera computes the center between the panels by itself (layers-kit.js rigCamera)
    const c = active.camera, ctrl = active.controls;
    const right = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0).setY(0).normalize();
    const shift = right.multiplyScalar((hide ? -1 : 1) * (c.isOrthographicCamera ? 9 / c.zoom : 0.11 * c.position.distanceTo(ctrl.target)));
    if (active === city) city.flyOn(ctrl.target.clone().add(shift), c.position.clone().add(shift));
    else { ctrl.target.add(shift); c.position.add(shift); }
  }
}
const PANEL_MIN = 380, panelMax = () => Math.max(PANEL_MIN, innerWidth - 96);
function setWidth(w, save = true) { const v = Math.round(Math.min(panelMax(), Math.max(PANEL_MIN, w))); document.documentElement.style.setProperty('--panelW', v + 'px'); if (save) savePanel('width', v); return v; }
// time of day: Auto = real time (sun by the location in world.json), Fast = a whole day in 90 s, Noon, Night
const MODE_TEXT = { auto: ['clock'], accelerated: ['next'], day: ['sun'], evening: ['month'] };
function refreshDayBtn() {
  const { east, west } = eastWest(simTime()), hm = (ms) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  $('dayBtn').innerHTML = ico(MODE_TEXT[MODE][0]) + ' ' + tt('app.panel.mode.' + MODE); $('dayBtn').title = tt('app.panel.sun', { east: hm(east), west: hm(west), estimate: LOCATION.own ? '' : tt('app.panel.estimate') });
}

// ---------- init: side effects (events, bar, clock) – called by main.js when all modules are loaded ----------
export function initPanel() {
  $('content').addEventListener('keydown', (e) => { const r = (e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.prR[role="button"]'); if (r && r === e.target) { e.preventDefault(); r.click(); } }); // Overview by keyboard: Tab + Enter (UX audit wave 1)
  addEventListener('city-unlocked', () => { if (TODAY.when) refreshToday(); }); // during the lock /api/today returned 401 or the data went stale
  watchLast(); // Recent conversations in the Team panel
  initTools(); // tool bar (tools-bar.js): demo all icons, real mode according to /api/tools
  initRouter(toast); // router in the City overview (router.js)
  WORLD.listen.add((type, d) => {
    if (type === 'tool') onTool(d);
    if (type === 'brain' && !isReal()) { const a = WORLD.floors.get(d.n).agents[d.a]; const sk = /^(Škola|Štúdium|Study)$/.test(WORLD.floors.get(d.n).building) ? 'study' : 'projects'; WORLD.brain.last = { who: `${a.name} (${d.n})`, direction: d.direction, position: pick(NOTES[sk]) }; }
    if (type === 'pending') {
      const name = WORLD.floors.get(d.n).agents[d.a].name;
      toast(tt('app.panel.pending', { n: d.n, name }));
      if (isReal() && !STANDALONE) { beep(); notify(tt('app.panel.pendingNotify', { name }), tt('app.panel.pendingDescription', { n: d.n }), 'caka-' + d.n, () => enterFloor(d.n)); } // does not beep in the demo
    }
  });
  if (!STANDALONE) initAlerts(); // notifications and sound are handled by the main window
  tickClock(); setInterval(tickClock, 500);
  $('zText').oninput = refreshHint; $('fromDest').onchange = refreshHint;
  $('zText').onkeydown = (e) => { if (e.key === 'Enter') $('fromAdd').click(); };
  $('fromAdd').onclick = async () => {
    const text = $('zText').value.trim(); if (!text) return;
    const r = route(text, $('fromDest').value || null), a = WORLD.floors.get(r.n).agents[r.a];
    $('zText').value = ''; refreshHint();
    if (isReal()) { // phase 3: a real agent (a new conversation with a lead or teammate)
      try { const k = await apiSend({ floor: floorId(r.n), agent: a.k || 'lead', text }); toast(tt('app.panel.got', { n: r.n, name: a.name })); if (active?.kind === 'floor' && active.n === r.n) openConv(k.id); }
      catch (e) { $('zText').value = text; toast(tt('app.panel.unsent', { error: e.message })); }
      return;
    }
    if (r.a === 0) ACTIONS.assignFloor(r.n, text); else ACTIONS.agent(r.n, r.a, text);
    toast(r.a === 0 ? tt('app.panel.splits', { n: r.n, name: a.name }) : tt('app.panel.got', { n: r.n, name: a.name }));
    emit('brain', { n: r.n, a: r.a, direction: 'reads' });
  };
  $('fromDestBtn').onclick = (e) => { e.stopPropagation(); const ui = $('fromDestUi'); ui.classList.toggle('on'); if (ui.classList.contains('on')) { $('fromDestSearch').value = ''; $('fromDestSearch').oninput(); setTimeout(() => $('fromDestSearch').focus(), 0); $('fromDestMenu').querySelector('.po.on')?.scrollIntoView({ block: 'nearest' }); } };
  document.addEventListener('pointerdown', (e) => { if (!$('fromDestUi').contains(e.target)) closeSelect(); });

  // mini Brain graph in the panel
  (function () {
    const c = $('brainMini'), g = c.getContext('2d'); const pts = [];
    BRAIN_GROUPS.forEach(([, f], i) => { const cx = 64 + Math.cos(i) * 30, cy = 44 + Math.sin(i * 1.7) * 18; for (let k = 0; k < 6; k++) pts.push([cx + rnd(-12, 12), cy + rnd(-10, 10), f]); });
    g.strokeStyle = '#c9c7bf'; g.lineWidth = 1; for (let i = 1; i < pts.length; i++) { g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i - 1 - (i % 3)]?.[0] ?? pts[0][0], pts[i - 1 - (i % 3)]?.[1] ?? pts[0][1]); g.stroke(); }
    for (const [x, y, f] of pts) { g.fillStyle = f; g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); }
  })();
  $('brainCard').onclick = () => { enterFloor('Second Brain'); }; // 2026-11-24: straight to the floor with activity and orphaned notes
  initConversations(toast); initBrain(); // Brain detail: clicks and loading /api/brain (brain.js)
  $('agSend').onclick = () => {
    if (isReal()) return send();
    const v = $('agText').value.trim(); if (!v || selectedAgent === null) return; $('agText').value = ''; height(); ACTIONS.agent(active.n, selectedAgent, v); refreshPanel();
  };
  $('agText').onkeydown = (e) => {
    const el = e.target; if (e.isComposing) return;
    if (isReal() && inCodeCursor(el)) { // in a code block: Enter = new line, Tab = tab, ⌘↵ sends
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); return tabInCode(el); }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) return;
      if (e.key === 'Enter') { e.preventDefault(); return send(true); }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (isReal() && (e.metaKey || e.ctrlKey)) return send(true); $('agSend').click(); } }; // ⌘↵ during a run = send immediately
  // header: in real mode the subscription limits, in the demo the original caption
  document.body.classList.toggle('realMode', isReal());
  $('panelBtn').onclick = () => togglePanel();
  // v13b: panel width by dragging the left edge (up to almost the whole window), double click toggles narrow / wide, remembered
  $('panelTurn').onpointerdown = (e) => {
    e.preventDefault(); const turn = $('panelTurn'); turn.setPointerCapture(e.pointerId); document.body.classList.add('dragging');
    turn.onpointermove = (ev) => setWidth(innerWidth - 16 - ev.clientX);
    turn.onpointerup = () => { turn.onpointermove = turn.onpointerup = null; document.body.classList.remove('dragging'); };
  };
  $('panelTurn').ondblclick = () => { const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panelW')); setWidth(w > 560 ? 420 : Math.round(innerWidth * 0.62)); };
  addEventListener('resize', () => { const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panelW')); if (w > panelMax()) setWidth(panelMax(), false); });
  addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'p' && !workroom && !e.metaKey && !e.ctrlKey && !e.altKey && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) togglePanel(); });
  applyProfilePanel(); // width and hiding by profile (conversations, overview, home), on transition again in refreshPanel
  M.home?.refreshDistrictBtn();
  $('dayBtn').onclick = () => {
    nextMode();
    refreshDayBtn(); tickClock();
  };
  refreshDayBtn();
}
