// dispatch.js – Dispatch (2026-11-15): the user writes free text with several tasks, Opus splits it into separate tasks,
// suggests a floor, agent and first message for each, and the user starts them (each = a new conversation, they run in parallel) or keeps them for later.
//
// POST /api/dispatch/split  { text } → { tasks: [{ id, title, floor, agent, name, agentName, message, reason }], ms } or { error }
//   One query() call like router.js: no tools, no settings, no session on disk, in os.tmpdir(), timeout 120 s, via the subscription.
//   Since 2026-11-15 the main entry is the chat of the `controlCenter/dispatch` floor (virtual-floors.js): the lead Dispatcher (Opus) calls the propose_tasks tool (agents.js),
//   the server verifies it via verifyTasks() below and the task card is driven via POST /api/dispatch/card (decideTask). The card state lives in the conversation messages.
// POST /api/dispatch/run  { floor, agent?, message, title? } → { id } (new conversation on the floor, the message is sent right away)
// Prepared tasks (persisted in data/dispecing.json): GET /api/dispatch → { ready }, POST …/prepare { floor, agent, message, title } → { ready, added },
//   POST …/cancel { id } → { ready }.
import { query } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_BIN, MODELS, cleanEnv, who, loadTeam } from './agents.js';
import { extractJson, listFloors } from './router.js';
import { t } from './i18n.js';

const MODEL = (MODELS.filter((m) => /opus/.test(m.id)).at(-1) || {}).id || 'opus'; // 2026-11-15: Opus splits (the newest from MODELS)
const TIMEOUT = 120000, MAX_TEXT = 12000, MAX_TASKS = 25, MAX_READY = 100;
const tail = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const error = (text, code) => Object.assign(new Error(text), { code });
const newId = () => 'd' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

let FILE = null;
export function setDispatch({ data }) { FILE = data ? path.join(data, 'dispecing.json') : null; }

// ---------- splitting the text ----------

function systemPrompt(list) {
  const rows = list.map((p) => `- ${p.id} | ${p.n}${p.building ? t('prompt.router.building', { building: p.building }) : ''}${p.description ? ` | ${tail(p.description, 90)}` : ''}${p.team.length ? t('prompt.router.team', { team: p.team.map((a) => `${a.k} (${a.description})`).join('; ') }) : ''}`);
  return t('prompt.dispatch.system', { who: who(), rows: rows.join('\n'), universal: list.some((p) => p.id === 'brain/universal') ? t('prompt.dispatch.universal') : '', max: MAX_TASKS });
}

// Shared verification of tasks from the model (splitTasks and the propose_tasks tool). Invalid id → floor by name or by the end of the id;
// then by `strict`: false = drop it (splitTasks), true = an error in the `errors` list (the tool returns it to the model to fix).
export function normalizeTasks(raw, floors, { strict = false } = {}) {
  const list = listFloors(floors), byId = new Map(list.map((p) => [p.id, p]));
  const search = (pid) => {
    pid = String(pid || '').trim(); const m = pid.toLowerCase();
    return byId.get(pid) || list.find((p) => p.n.toLowerCase() === m || p.id.toLowerCase() === m || p.id.toLowerCase().endsWith('/' + m)) || (strict ? null : byId.get('brain')) || null;
  };
  const tasks = [], errors = [];
  for (const [i, x] of (Array.isArray(raw) ? raw : []).slice(0, MAX_TASKS).entries()) {
    const message = String(x?.message || '').trim(); if (!message) { errors.push(t('prompt.dispatch.blankMessage', { n: i + 1 })); continue; }
    const p = search(x?.floor); if (!p) { errors.push(t('prompt.dispatch.unknownFloor', { n: i + 1, title: tail(x?.title, 40), floor: tail(x?.floor, 60) })); continue; }
    const a = p.team.find((y) => y.k === x?.agent || y.name === x?.agent);
    if (strict && x?.agent && !a && !['lead', 'vedúci'].includes(String(x.agent).toLowerCase())) { errors.push(t('prompt.dispatch.hasNoTeammate', { n: i + 1, title: tail(x?.title, 40), floor: p.id, agent: tail(x.agent, 40), team: p.team.map((y) => y.k).join(', ') || t('prompt.dispatch.nobody') })); continue; }
    tasks.push({ id: newId(), title: tail(x?.title || message, 60), floor: p.id, agent: a ? a.k : 'lead', name: p.n, agentName: a ? a.name : (floors.find((P) => P.id === p.id)?.lead?.name || t('server.router.lead')), message: message.slice(0, 20000), reason: tail(x?.reason, 200) });
  }
  return { tasks, errors };
}
// for the propose_tasks tool (agents.js, injected via setAgents): verified tasks or errors
export const verifyTasks = (raw, floors) => normalizeTasks(raw, floors, { strict: true });

// Addition to the Dispatcher prompt: list of floors and teams (like the router) + prepared tasks (data/dispecing.json)
export function dispatcherContext(floors) {
  const list = listFloors(floors);
  const rows = list.map((p) => `- ${p.id} | ${p.n}${p.building ? t('prompt.router.building', { building: p.building }) : ''}${p.description ? ` | ${tail(p.description, 90)}` : ''}${p.team.length ? t('prompt.router.team', { team: p.team.map((a) => `${a.k} (${a.description})`).join('; ') }) : ''}`);
  const connection = load();
  return t('prompt.dispatch.context', { rows: rows.join('\n') })
    + (connection.length ? t('prompt.dispatch.ready', { list: connection.slice(0, 30).map((u) => `- ${u.title} → ${u.floor}${u.agent !== 'lead' ? ' / ' + u.agent : ''}`).join('\n') }) : t('prompt.dispatch.none'));
}

// floors: same as for the router (server.js floorRouter).
export async function splitTasks(text, floors) {
  text = String(text || '').trim();
  if (!text) return { error: t('server.dispatch.emptyText') };
  const list = listFloors(floors);
  const t0 = Date.now(), ac = new AbortController(), timer = setTimeout(() => ac.abort(), TIMEOUT);
  let output = '', ch = null;
  try {
    const q = query({
      prompt: text.slice(0, MAX_TEXT),
      options: {
        model: MODEL, cwd: os.tmpdir(), pathToClaudeCodeExecutable: CLAUDE_BIN, env: cleanEnv(), abortController: ac,
        systemPrompt: systemPrompt(list), tools: [], allowedTools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [],
        maxTurns: 1, permissionMode: 'default', persistSession: false, thinking: { type: 'disabled' },
        canUseTool: async () => ({ behavior: 'deny', message: t('prompt.dispatch.withoutTools') }),
      },
    });
    for await (const u of q) {
      if (u.type === 'result') { if (u.subtype === 'success') output = u.result || ''; else ch = u.errors?.join(', ') || u.subtype; }
    }
  } catch (e) { ch = ac.signal.aborted ? t('server.dispatch.timeout', { time: TIMEOUT / 1000 }) : e.message; }
  finally { clearTimeout(timer); }
  const ms = Date.now() - t0;
  if (ch) return { error: ch, ms };
  const j = extractJson(output);
  if (!j || !Array.isArray(j.tasks)) return { error: t('server.dispatch.invalidJson'), ms };
  const { tasks } = normalizeTasks(j.tasks, floors);
  if (!tasks.length) return { error: t('server.dispatch.noneTask'), ms };
  return { tasks, ms };
}

// ---------- start: new conversation + first message (same as /api/message without id) ----------

export async function startTask(d, { sendMessage, findFloor }) {
  const message = String(d?.message || '').trim(), floor = String(d?.floor || '').trim(), agent = String(d?.agent || 'lead').trim() || 'lead';
  if (!message) throw error(t('server.dispatch.blankMessage'), 400);
  const P = floor && findFloor(floor);
  if (!P) throw error(t('server.dispatch.unknownFloor'), 404);
  if (agent !== 'lead' && !loadTeam(P).some((a) => a.k === agent)) throw error(t('server.dispatch.unknownTeammate'), 404);
  const title = tail(d?.title || d?.title, 60) || undefined;
  const k = await sendMessage({ floor: P.id, agent, text: message, title }); // new conversation: no id; more calls = more parallel agents
  return { id: k.id };
}

// ---------- prepared tasks (data/dispecing.json) ----------

function load() {
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(j.ready) ? j.ready : []; } catch { return []; }
}
function save(ready) {
  if (!FILE) throw error(t('server.dispatch.withoutRepository'), 500);
  const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ ready }, null, 1)); fs.renameSync(tmp, FILE);
}
export const dispatchState = () => ({ ready: load() });

export function prepareTask(d, { findFloor }) {
  const message = String(d?.message || '').trim(), floor = String(d?.floor || '').trim(), agent = String(d?.agent || 'lead').trim() || 'lead';
  if (!message) throw error(t('server.dispatch.blankMessage'), 400);
  const P = floor && findFloor(floor);
  if (!P) throw error(t('server.dispatch.unknownFloor'), 404);
  if (agent !== 'lead' && !loadTeam(P).some((a) => a.k === agent)) throw error(t('server.dispatch.unknownTeammate'), 404);
  const list = load();
  if (list.length >= MAX_READY) throw error(t('server.dispatch.countReady', { max: MAX_READY }), 400);
  const u = { id: newId(), title: tail(d?.title || d?.title || message, 60), floor: P.id, agent, name: P.n, agentName: agent === 'lead' ? (P.lead?.name || t('server.router.lead')) : (loadTeam(P).find((a) => a.k === agent)?.name || agent), message: message.slice(0, 20000), ready: Date.now() };
  list.push(u); save(list);
  return { ready: list, added: u };
}

export function cancelTask(d) {
  const id = String(d?.id || '');
  if (!id) throw error(t('server.dispatch.errorId'), 400);
  const list = load(), other = list.filter((u) => u.id !== id);
  if (other.length !== list.length) save(other);
  return { ready: other };
}

// ---------- task card in the Dispatcher chat ----------
// The card (a message of type 'dispatchTasks' in the conversation, created by the propose_tasks tool in agents.js) holds the status of each task:
//   pending → starts → running (conv = id of the new conversation) | ready | error in u.error (status goes back to pending); no ↔ pending (restore).
// d = { id (conversation with the card), card (message id), action: 'uloz' | 'start' | 'prepare' | 'no' | 'restore', ids?: [task ids] (without them all pending),
//       edits?: { <task id>: { floor?, agent?, message? } } (what the user changed on the card meanwhile) }
// deps: { sendMessage, findFloor, taskCard } (server.js; agents.js must not be imported here in a cycle at startup)
export async function decideTask(d, { sendMessage, findFloor, taskCard }) {
  const K = taskCard(String(d?.id || ''), String(d?.card || ''));
  if (!K) throw error(t('server.dispatch.cardNotFound'), 404);
  const action = String(d?.action || '');
  if (!['uloz', 'start', 'prepare', 'no', 'restore'].includes(action)) throw error(t('server.dispatch.unknownAction'), 400);
  const ids = Array.isArray(d?.ids) && d.ids.length ? new Set(d.ids.map(String)) : null;
  const target = K.tasks.filter((u) => (!ids || ids.has(u.id)) && (action === 'restore' ? u.status === 'no' : u.status === 'pending'));
  // edits from the card apply only in a valid form (an unknown floor or agent is ignored)
  for (const u of K.tasks.filter((x) => x.status === 'pending')) {
    const e = d?.edits?.[u.id]; if (!e || typeof e !== 'object') continue;
    const P = e.floor ? findFloor(String(e.floor)) : null;
    if (P) { u.floor = P.id; u.name = P.n; }
    const PP = findFloor(u.floor);
    if (PP && e.agent !== undefined) { const a = loadTeam(PP).find((y) => y.k === e.agent); u.agent = a ? a.k : 'lead'; u.agentName = a ? a.name : (PP.lead?.name || t('server.router.lead')); }
    else if (P && u.agent !== 'lead' && !loadTeam(P).some((y) => y.k === u.agent)) { u.agent = 'lead'; u.agentName = P.lead?.name || t('server.router.lead'); }
    if (typeof e.message === 'string' && e.message.trim()) u.message = e.message.slice(0, 20000);
  }
  if (action === 'uloz') { K.save(); return { ok: true }; }
  if (action === 'no') { for (const u of target) { u.status = 'no'; u.error = ''; } K.save(); return { ok: true }; }
  if (action === 'restore') { for (const u of target) u.status = 'pending'; K.save(); return { ok: true }; }
  for (const u of target) { u.status = 'starts'; u.error = ''; }
  K.save();
  await Promise.all(target.map(async (u) => { // in parallel: each task has its own agent
    try {
      if (action === 'start') { u.conv = (await startTask(u, { sendMessage, findFloor })).id; u.status = 'running'; }
      else { prepareTask(u, { findFloor }); u.status = 'ready'; }
    } catch (e) { u.status = 'pending'; u.error = e.message; }
  }));
  K.save();
  return { ok: true };
}
