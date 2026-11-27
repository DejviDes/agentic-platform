// api.js – Phase 3: connection to the server in real mode. Events from /api/events (SSE), conversation API
// and projecting real states onto characters and tasks in WORLD (working / waiting / done, papers when delegating).
// KS store: summaries of all conversations, messages of open (and currently running) ones, floors (team, older sessions), limits.
// Server events: conv (summary), message, uprava, delta (text in pieces), team, limits, tool. Format: brain technika.md.
import { BUILDINGS } from './demo-data.js';
import { t as T } from './i18n.js';
import { emit, newTask, newAgent, agentFromServer, WORLD, change } from './world.js';
import { SOURCE } from './source.js';
import { M } from './modules.js';
import { onConvControlCenter, onEventControlCenter, onChangeApp } from './control-center.js';
import { canNotify, notify, onChangeNotifications, loadNotifications } from './alerts.js';

export const CONV_STORE = {
  conv: new Map(), // id → summary { id, sid, floor, agent, title, parent, status, start, context, duration, count, changed, direct }
  messages: new Map(), // id → [messages] (only loaded ones or ones created while the page runs)
  floors: new Map(), // floor id → { team, old, path, when }
  errors: new Map(), // conversation id → load error (not stored as messages, can be retried)
  commands: new Map(), // floor id → { list, when, loading, error } (slash commands, the menu after "/")
  limits: null, connected: false, ver: 0,
  listen: new Set(), // (type, d) → conversations.js: 'change' (redraw), 'delta' (id, i), 'team', 'limits'
};
const taskConv = new Map(); // conversation id → task in WORLD.ulohy
const signal = (type, d) => { if (type !== 'delta') CONV_STORE.ver++; CONV_STORE.listen.forEach((f) => f(type, d)); };
export const isReal = () => SOURCE.mode === 'isReal';

// floor in WORLD by the server id ("projekty/Pokus") and back
const nById = new Map();
export function floorCount(pid) {
  if (!nById.size) for (const b of BUILDINGS) for (const p of b.floors) if (p.id) nById.set(p.id, p.n);
  return nById.get(pid);
}
export const floorId = (n) => WORLD.floors.get(n)?.def.id;
export function agentIndex(P, slug) { if (slug === 'lead') return 0; const i = P.agents.findIndex((a) => a.k === slug); return i < 0 ? null : i; }
// Several instances of the same teammate at once (background tasks): the server gives the delegated thread a `number` (1..N). Until it has one,
// we compute it from the running siblings (same parent + agent, by `created`). With a single thread the number is null.
const ACTIVE = ['running', 'pending'];
export function threadNumber(v) {
  if (!v?.parent) return null;
  if (v.number) return v.number;
  if (!ACTIVE.includes(v.status)) return null;
  const sur = [...CONV_STORE.conv.values()].filter((x) => x.parent === v.parent && x.agent === v.agent && ACTIVE.includes(x.status)).sort((x, y) => (x.created || 0) - (y.created || 0) || (x.id < y.id ? -1 : 1));
  return sur.length > 1 ? sur.indexOf(v) + 1 : null;
}
// running delegated threads of one floor (from the oldest); slug = only one teammate
export const runningInBackground = (pid, slug) => [...CONV_STORE.conv.values()].filter((x) => x.parent && x.floor === pid && x.status === 'running' && (!slug || x.agent === slug)).sort((x, y) => (x.created || 0) - (y.created || 0));

// ---------- API ----------
async function api(path, body) {
  let r;
  try { r = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error(T('app.connection.serverNotResponding')); } // Safari: "Load failed", Chrome: "Failed to fetch"
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || T('app.source.serverReturned', { s: r.status })), { data: d, status: r.status }); // data: e.g. a warning (428)
  return d;
}
export async function loadFloor(pid, force = false) {
  const x = CONV_STORE.floors.get(pid);
  if (x && !force && (x.loading || Date.now() - x.when < 30000)) return x;
  CONV_STORE.floors.set(pid, { ...(x || { team: [], old: [] }), loading: true, when: Date.now() });
  try {
    const d = await api(`/api/conversations?floor=${encodeURIComponent(pid)}`);
    for (const k of d.conversations) CONV_STORE.conv.set(k.id, { ...CONV_STORE.conv.get(k.id), ...k });
    CONV_STORE.floors.set(pid, { team: d.team, old: d.old, path: d.path, defaults: d.defaults, models: d.models, efforts: d.efforts, modes: d.modes, subfolders: d.subfolders || [], when: Date.now(), loaded: true });
    applyTeam(pid, d.team);
  } catch (e) { CONV_STORE.floors.set(pid, { ...(x || { team: [], old: [] }), error: e.message, when: Date.now() }); }
  signal('change');
  return CONV_STORE.floors.get(pid);
}
const loadingConv = new Set();
export async function loadConv(id) {
  if (loadingConv.has(id)) return; loadingConv.add(id);
  try {
    const d = await api(`/api/conversation?id=${encodeURIComponent(id)}`);
    if (!id.startsWith('s:')) CONV_STORE.conv.set(id, { ...CONV_STORE.conv.get(id), ...d.conv });
    if (!CONV_STORE.messages.has(id) || !CONV_STORE.messages.get(id).length) CONV_STORE.messages.set(id, d.messages);
    CONV_STORE.errors.delete(id);
  } catch (e) { CONV_STORE.errors.set(id, e.message); }
  finally { loadingConv.delete(id); }
  signal('change');
}
export async function send(o) {
  const d = await api('/api/message', o);
  CONV_STORE.conv.set(d.conv.id, { ...CONV_STORE.conv.get(d.conv.id), ...d.conv });
  if (o.id?.startsWith('s:')) { CONV_STORE.messages.delete(o.id); for (const x of CONV_STORE.floors.values()) x.old = (x.old || []).filter((s) => s.id !== o.id); }
  if (!CONV_STORE.messages.has(d.conv.id)) loadConv(d.conv.id); // e.g. an adopted older session
  signal('change');
  return d.conv;
}
export const stop = (id) => api('/api/stop', { id });
// floor slash commands for the menu after "/" (server cache 10 min, 5 min here)
export async function loadCommands(pid) {
  const x = CONV_STORE.commands.get(pid);
  if (x?.loading || (x?.list && Date.now() - x.when < 300000)) return;
  CONV_STORE.commands.set(pid, { ...x, loading: true, error: null });
  try { const d = await api(`/api/commands?floor=${encodeURIComponent(pid)}`); CONV_STORE.commands.set(pid, { list: d.commands, when: Date.now() }); }
  catch (e) { CONV_STORE.commands.set(pid, { ...x, loading: false, error: e.message, when: Date.now() }); }
}
export const sendImmediately = (id) => api('/api/send-now', { id }); // interrupt the turn so the agent reads the message from the queue right away
export const cancelFromQueue = (id, uuid) => api('/api/cancel-from-queue', { id, uuid }); // take a message out of the queue before the agent reads it
export const permission = (id, decision, message) => api('/api/permission', { id, decision, message });
export const card = (d) => api('/api/card', d);
export const messageConv = (action, d) => api('/api/conv/' + action, d); // rename, hide, trash, resolve
export const messageNewSession = (d) => api('/api/new-session', d); // card "start in a new session" (2026-11-26)
export const messageApp = (d) => api('/api/claude-app', d); // card "start in the Claude app": the server opens a deep link (2026-11-16)

// ---------- events ----------
function apply(e) {
  if (e.type === 'sorting' || e.kind === 'sorting') return M.home?.onEventSorting(e); // Sorting center: the new state is reloaded
  if (e.type === 'house' || e.kind === 'house') return M.home?.onEventHouse(e); // My house: the house agent or the journal changed
  if (e.type === 'tasks' || e.kind === 'tasks') return M.home?.onEventTasks(e); // Task office: tasks changed, reloaded (at most once per ~2 s)
  if (e.type === 'mail' || e.kind === 'mail') return M.mail?.onEventMail(e); // Mail: the overview or replies changed, reloaded (at most once per ~2 s)
  if (e.type === 'library' || e.kind === 'library') return M.home?.onEventLibrary(e); // Library: facts, ratings or the daily facts agent changed
  if (e.type === 'playground' || e.kind === 'playground') return M.home?.onEventPlayground(e); // Playground: a workout entry, plan change or a run of the Week plan agent, reloaded (at most once per ~2 s)
  if (e.type === 'postman' || e.kind === 'postman') return M.home?.onEventPostman(e); // Postman: new proposal state after a run (the event carries it, otherwise reloaded)
  if (e.kind === 'brain') return void import('./brain.js').then((m) => m.onEventBrain(e)); // Brain: agent activity in the brain (blink, counts, list)
  if (e.type === 'garden' || e.kind === 'garden') return M.home?.onEventGarden(e); // Habit garden: checked off from another window or habits changed, reloaded (at most once per ~2 s)
  if (e.kind === 'notify') return completed(e);
  switch (e.kind) {
    case 'conv': {
      const old = CONV_STORE.conv.get(e.conv.id);
      CONV_STORE.conv.set(e.conv.id, { ...old, ...e.conv });
      project(e.conv, old);
      signal('change', e.conv);
      onConvControlCenter(e.conv);
      break;
    }
    case 'message': {
      let sp = CONV_STORE.messages.get(e.id);
      if (!sp && e.message.i === 0) CONV_STORE.messages.set(e.id, (sp = [])); // new conversation: we follow it from the first message
      if (!sp) return;
      sp[e.message.i] = e.message;
      signal('change', { id: e.id });
      break;
    }
    case 'edit': { const s = CONV_STORE.messages.get(e.id)?.[e.i]; if (!s) return; Object.assign(s, e.change); signal('change', { id: e.id }); break; }
    case 'trimmed': { const sp = CONV_STORE.messages.get(e.id); if (sp && sp.length > e.from) sp.length = e.from; signal('change', { id: e.id }); break; } // edit of a sent message: drop everything after it (agents.js editMessage)
    case 'delta': { const s = CONV_STORE.messages.get(e.id)?.[e.i]; if (!s) return; s.text += e.text; signal('delta', e); break; }
    case 'team': { const x = CONV_STORE.floors.get(e.floor); if (x) x.team = e.team; applyTeam(e.floor, e.team); signal('team', e); break; }
    case 'deleted': { // hidden or in the trash: gone from the lists (summaries, messages, older sessions of floors)
      const ids = new Set(e.ids);
      for (const id of ids) { CONV_STORE.conv.delete(id); CONV_STORE.messages.delete(id); }
      for (const x of CONV_STORE.floors.values()) if (x.old?.some((s) => ids.has(s.id))) x.old = x.old.filter((s) => !ids.has(s.id));
      signal('change', {});
      break;
    }
    case 'notifications': onChangeNotifications(e.status); break; // notification mute changed in another window (⋯ menu)
    case 'limits': CONV_STORE.limits = e.limits; signal('limits', e.limits); break;
    case 'tool': emit('tool', { k: e.id ?? e.k, n: floorCount(e.floor), conv: e.conv, real: 1 }); break; // tools-bar.js: icon in the bar for 3 s
    case 'app': onChangeApp(e.files); break; // Control Center: frontend change → the app refreshes itself
    case 'file': case 'showFile': CONV_STORE.listen.forEach((f) => f(e.kind, e)); break; // agent wrote a file (file-view.js: refreshes the preview), without KS.ver, so the chat is not redrawn
    case 'control-center': onEventControlCenter(e); break; // server code change or commit → new git state in the bar
  }
}

// new teammate: added to WORLD (character), the floor and the city are rebuilt (navigation.js listens for 'team')
function applyTeam(pid, team) {
  const n = floorCount(pid), P = n && WORLD.floors.get(n); if (!P) return;
  let fresh = false;
  for (const a of team) if (!P.agents.some((x) => x.k === a.k)) { P.agents.push(newAgent(agentFromServer(a), P.agents.length, n)); fresh = true; }
  if (fresh) { WORLD.rebuildCity = true; change(); emit('team', { n }); }
}

// conversation state → character and task (Tasks in the panel, cards above the towers, papers on the floor)
const RUNNING = ['running', 'pending'];
function project(k, old) {
  const n = floorCount(k.floor), P = n && WORLD.floors.get(n); if (!P) return;
  const assistant = agentIndex(P, k.agent) ?? (k.parent ? null : 0);
  let u = taskConv.get(k.id);
  if (RUNNING.includes(k.status) && !u && assistant != null) {
    u = newTask(n, assistant, k.title, 'doing', 0.05); u.conv = k.id; taskConv.set(k.id, u); // a click on a task in the panel opens this conversation
    if (k.parent) { u.column = 'flies'; u.flies = 1e9; emit('delegate', { n, u }); u.column = 'doing'; } // paper from the lead
  }
  if (u) {
    const st = k.status === 'pending' ? 'pending' : k.status === 'running' ? 'doing' : 'done';
    if (u.column !== st) {
      u.column = st;
      if (st === 'done') { u.progress = 1; u.end = WORLD.time; if (k.parent) emit('done', { n, u }); taskConv.delete(k.id); }
    }
    u.text = k.title;
    u.plan = k.plan?.n ? { h: k.plan.h, n: k.plan.n } : null; u.step = k.plan?.step || ''; // agent plan (agents.js summary): step above the character, progress in world.js
  }
  if (assistant != null) {
    const a = P.agents[assistant], before = a.status;
    const mine = [...CONV_STORE.conv.values()].filter((x) => x.floor === k.floor && (agentIndex(P, x.agent) ?? (x.parent ? null : 0)) === assistant);
    const st = mine.some((x) => x.status === 'pending') ? 'pending' : mine.some((x) => x.status === 'running') ? 'work' : old && RUNNING.includes(old.status) && !RUNNING.includes(k.status) ? 'done' : before === 'done' ? 'done' : 'none';
    if (st !== before) {
      a.status = st; a.timer = st === 'done' ? 2.4 : 0;
      a.task = st === 'work' || st === 'pending' ? (taskConv.get(mine.find((x) => RUNNING.includes(x.status))?.id) || null) : null;
      if (st === 'pending') emit('pending', { n, a: assistant });
    }
  }
  P.def.status = P.agents.some((a) => a.status === 'pending') ? 'pending' : P.agents.some((a) => a.status === 'work') ? 'work' : P.def.status === 'pending' ? 'none' : P.def.status;
  change();
}

// conversations from the last 24 h as finished tasks (the Task status panel and the cards above the towers are not empty after load)
function recent(k) {
  const age = (Date.now() - (k.changed || 0)) / 1000; if (age > 24 * 3600) return;
  const n = floorCount(k.floor), P = n && WORLD.floors.get(n); if (!P) return;
  const assistant = agentIndex(P, k.agent) ?? (k.parent ? null : 0); if (assistant == null) return;
  const u = newTask(n, assistant, k.title, 'done', 1); u.end = WORLD.time - age;
}
let es = null;
// after a server outage (restart): reload what we missed during the outage
async function sync() {
  try {
    const d = await api('/api/state');
    for (const k of d.conversations) { const old = CONV_STORE.conv.get(k.id); CONV_STORE.conv.set(k.id, { ...old, ...k }); if (old?.status !== k.status) project(k, old); }
    CONV_STORE.limits = d.limits; signal('limits', d.limits);
    loadNotifications(); // the mute may have been toggled by another window during the outage
  } catch {}
  CONV_STORE.messages.clear(); CONV_STORE.errors.clear(); // an open thread reloads its messages (renderConv)
  for (const x of CONV_STORE.floors.values()) x.when = 0;
  M.home?.onEventSorting(); // the Sorter may have finished during the outage
  signal('change');
}
export async function initConnection() {
  if (!isReal()) return;
  try {
    const d = await api('/api/state');
    for (const k of d.conversations) { CONV_STORE.conv.set(k.id, k); if (RUNNING.includes(k.status)) project(k, null); else recent(k); }
    CONV_STORE.limits = d.limits; signal('limits', d.limits);
  } catch (e) { console.warn('Mesto agentov: /api/state –', e.message); }
  let was = false;
  // ?notif=1: this window shows notifications itself, the server then does not send its own macOS notification (os-notifications.js). After changing 🔔 a new connection.
  const attach = () => {
    es?.close(); es = new EventSource('/api/events' + (canNotify() ? '?notif=1' : ''));
    es.onopen = () => { CONV_STORE.connected = true; if (was) sync(); was = true; signal('change'); };
    es.onerror = () => { CONV_STORE.connected = false; signal('change'); };
    es.onmessage = (m) => { try { apply(JSON.parse(m.data)); } catch (err) { console.error('udalosť', err); } };
  };
  attach(); loadNotifications(); addEventListener('city-alerts', attach);
}
// agent finished a turn: the server decides about the notification (os-notifications.js: no automatic runs and short turns, merging; 2026-11-24),
// the window only shows it when the city is not in view (while waiting for approval the panel beeps, panel.js)
function completed({ title, text, tag, n, conv }) {
  const P = n && WORLD.floors.get(n);
  notify(title, text, tag, P ? () => import('./navigation.js').then((m) => m.enterFloor(n)).then(() => import('./conversations.js')).then((m) => conv && setTimeout(() => m.openConv(conv), 760)) : null);
}
