// world.js – WORLD: agents, tasks and delegation on the floors from the BUILDING, from which both the city and the floor are drawn.
// Demo mode: simulation (autopilot, random tasks). Real mode (phase 3): team = lead + .claude/agents/ from the server,
// states and tasks are set by api.js from real conversations, the simulation does not run.
// Created by splitting the prototype public/dizajn-v12d.html (phase 1). Module map: brain Projekty/mesto-agentov/technika.md.
import { rnd, pick } from './utils.js';
import { t as T } from './i18n.js';
import { BUILDINGS, COLORS, WORDS, teamFor } from './demo-data.js';
import { SOURCE } from './source.js';


// =====================================================================
// WORLD – one simulation from which both the city and the floor are drawn
// =====================================================================
export const WORLD = { floors: new Map(), tasks: [], listen: new Set(), time: 0, id: 0, auto: 0, version: 0, brain: { last: null } };
export const change = () => WORLD.version++;
export const emit = (type, d) => WORLD.listen.forEach((f) => f(type, d));
export function newTask(n, a, text, column = 'rad', progress = 0) { const u = { id: ++WORLD.id, text, p: n, a, column, progress, duration: rnd(14, 26), time: WORLD.time - (column === 'done' ? rnd(60, 900) : rnd(0, 120)) }; WORLD.tasks.push(u); change(); return u; }
function log(n, assistant, kind, text) { const a = WORLD.floors.get(n).agents[assistant]; a.log.push({ kind, text }); if (a.log.length > 60) a.log.shift(); change(); }

// real mode: the lead is on every floor, teammates are the files .claude/agents/*.md (p.tim from the server)
export const LEAD_REAL = { k: 'lead', name: T('app.data.lead'), role: T('app.data.splits_tasks_a_checks_vystupy'), emoji: '🧭', tasks: [T('app.world.tasksFloor')], key: ['tím', 'total', 'naplánuj', 'plán'] };
export const agentFromServer = (a) => ({ k: a.k, name: a.name, role: a.role || a.description || T('app.world.teammate'), emoji: a.emoji || '👤', skills: a.skills || [], file: a.file, tasks: [a.role || a.name], key: [a.name.toLowerCase(), a.k] });
export const newAgent = (a, i, n) => ({ ...a, i, lead: i === 0, color: COLORS[(i + n.length) % COLORS.length], status: 'none', task: null, timer: 0, log: [], rules: [...(a.rules || [])] });
export function createWorld() {
  const real = SOURCE.mode === 'isReal';
  for (const b of BUILDINGS) for (const p of b.floors) {
    const team = real ? [p.lead ? { ...LEAD_REAL, ...p.lead } : LEAD_REAL, ...(p.team || []).map(agentFromServer)] : teamFor(p.n, b.title);
    const agents = team.map((a, i) => newAgent(a, i, p.n));
    WORLD.floors.set(p.n, { def: p, building: b.title, agents, cooldown: rnd(0, 3) });
    if (real) continue; // real tasks and states come from the server (api.js)
    const spec = agents.slice(1);
    log(p.n, 0, 'assistant', T('app.world.amLead', { n: p.n }));
    if (p.status === 'work' || p.status === 'pending') spec.slice(0, 3).forEach((a) => { const u = newTask(p.n, a.i, a.tasks[0], 'doing', rnd(0.1, 0.7)); a.task = u; a.status = 'work'; log(p.n, a.i, 'assistant', T('app.world.workingOn', { text: u.text })); });
    if (p.status === 'pending') { const a = spec.find((x) => x.request && x.task) || spec[0]; a.status = 'pending'; a.task.column = 'pending'; a.task.progress = 0.8; log(p.n, a.i, 'assistant', T('app.world.needApproval')); }
    spec.forEach((a) => { if (Math.random() < 0.6) newTask(p.n, a.i, a.tasks[a.tasks.length - 1], 'done', 1); });
    if (p.status !== 'none') spec.slice(3).forEach((a) => newTask(p.n, a.i, a.tasks[1] || a.tasks[0]));
  }
}

function finish(n, u) {
  const P = WORLD.floors.get(n), a = P.agents[u.a];
  if (a.request && !u.approved && Math.random() < 0.4 && !P.agents.some((x) => x.status === 'pending')) {
    u.column = 'pending'; u.progress = 0.8; a.status = 'pending'; log(n, u.a, 'assistant', T('app.world.needApproval')); emit('pending', { n, a: u.a }); change(); return;
  }
  u.column = 'done'; u.progress = 1; u.end = WORLD.time; a.status = 'done'; a.timer = 2.4; a.task = null;
  log(n, u.a, 'assistant', T('app.world.done', { text: u.text })); log(n, 0, 'chip', T('app.world.handedOver', { name: a.name, text: u.text }));
  emit('done', { n, u }); emit('brain', { n, a: u.a, direction: 'write' }); change();
}

export function tickWorld(dt) {
  WORLD.time += dt;
  if (SOURCE.mode === 'isReal') { // real mode: only catching up "done" and smooth progress of running tasks
    for (const P of WORLD.floors.values()) for (const a of P.agents) if (a.timer > 0) { a.timer -= dt; if (a.timer <= 0 && a.status === 'done') { a.status = 'none'; change(); } }
    for (const u of WORLD.tasks) if (u.column === 'doing') { // with an agent plan (api.js planUlohy) progress follows the finished steps
      if (u.plan) u.progress += Math.min(1, dt * 1.5) * (Math.min(0.97, (u.plan.h + (u.step ? 0.5 : 0)) / u.plan.n) - u.progress);
      else u.progress += (dt / 90) * (0.92 - u.progress);
    }
    return;
  }
  for (const [n, P] of WORLD.floors) {
    const lead = P.agents[0];
    P.cooldown -= dt;
    for (const a of P.agents) if (a.timer > 0) { a.timer -= dt; if (a.timer <= 0 && ['done', 'delegates', 'work'].includes(a.status) && (a.status !== 'work' || a.lead)) { a.status = 'none'; change(); } }
    for (const u of WORLD.tasks) {
      if (u.p !== n) continue;
      const a = P.agents[u.a];
      if (u.column === 'flies') { u.flies -= dt; if (u.flies <= 0) { u.column = 'doing'; a.status = 'work'; a.task = u; log(n, u.a, 'assistant', T('app.world.takingTask', { text: u.text })); } }
      else if (u.column === 'doing' && a.status === 'work') {
        u.progress = Math.min(1, u.progress + dt / u.duration);
        if (Math.random() < dt * 0.1) { emit('brain', { n, a: u.a, direction: 'reads' }); if (a.tool) emit('tool', { k: a.tool, n }); }
        if (u.progress >= 1) finish(n, u);
      }
    }
    if (lead.status === 'none' && P.cooldown <= 0) {
      const u = WORLD.tasks.find((x) => x.p === n && x.column === 'rad' && ['none', 'done'].includes(P.agents[x.a].status));
      if (u) { P.cooldown = 1.4; u.column = 'flies'; u.flies = 1.1; lead.status = 'delegates'; lead.timer = 1.1; log(n, 0, 'chip', T('app.world.delegates', { name: P.agents[u.a].name, text: u.text })); emit('delegate', { n, u }); change(); }
    }
  }
  // demo autopilot so the city lives
  if (WORLD.time - WORLD.auto > 6) {
    WORLD.auto = WORLD.time;
    const active = WORLD.tasks.filter((u) => ['doing', 'flies', 'rad'].includes(u.column)).length;
    if (active < 10) { const [n, P] = pick([...WORLD.floors]); const a = pick(P.agents.slice(1)); newTask(n, a.i, pick(a.tasks)); }
  }
}

export const ACTIONS = {
  decide(n, assistant, allow) {
    const a = WORLD.floors.get(n).agents[assistant]; if (a.status !== 'pending') return;
    log(n, assistant, 'chip', allow ? T('app.world.approved') : T('app.world.rejected')); log(n, assistant, 'assistant', allow ? T('app.world.thanks') : T('app.world.tryOtherwise'));
    if (a.task) { a.task.column = 'doing'; a.task.approved = true; a.task.progress = allow ? 0.86 : 0.55; }
    a.status = 'work'; change(); if (allow && a.tool) emit('tool', { k: a.tool, n });
  },
  assignFloor(n, text) {
    const P = WORLD.floors.get(n), lead = P.agents[0];
    log(n, 0, 'user', text); lead.status = 'work'; lead.timer = 2; log(n, 0, 'assistant', T('app.world.splitTeam'));
    const tail = text.length > 30 ? text.slice(0, 29) + '…' : text;
    P.agents.slice(1).filter((a) => a.status !== 'pending').slice(0, 3).forEach((a) => { newTask(n, a.i, tail); log(n, 0, 'chip', `→ ${a.name} (${a.role.toLowerCase()})`); });
  },
  agent(n, assistant, text) {
    const a = WORLD.floors.get(n).agents[assistant];
    if (/^(oprav|fix):/i.test(text)) { const r = text.replace(/^(oprav|fix):\s*/i, ''); log(n, assistant, 'user', text); a.rules.push(r); log(n, assistant, 'assistant', T('app.world.rule', { r })); return; }
    if (a.lead) return ACTIONS.assignFloor(n, text);
    log(n, assistant, 'user', text); newTask(n, assistant, text.length > 30 ? text.slice(0, 29) + '…' : text); log(n, assistant, 'assistant', T('app.world.adding'));
  },
};

// router: picks the floor and agent by words
export function route(text, fixed) {
  const t = text.toLowerCase();
  let n = fixed, reason = [];
  if (!n) {
    let naj = 0;
    // keywords from demo-data.js (for floors that are in the world) + the floor name as a word (phase 2: real floors)
    for (const k of WORLD.floors.keys()) { const sl = [...(WORDS[k] || []), k.toLowerCase()]; const z = sl.filter((s) => t.includes(s)); if (z.length > naj) { naj = z.length; n = k; reason = z; } }
    if (!n) n = WORLD.floors.keys().next().value;
  }
  const P = WORLD.floors.get(n);
  let a = 0, naj = 0;
  P.agents.forEach((ag, i) => { const z = (ag.key || []).filter((s) => t.includes(s)); if (z.length > naj) { naj = z.length; a = i; reason = [...reason, ...z]; } });
  if (P.agents.slice(1).filter((ag) => (ag.key || []).some((s) => t.includes(s))).length > 1) a = 0; // multiple roles at once → the lead splits
  return { n, a, reason: [...new Set(reason)] };
}
