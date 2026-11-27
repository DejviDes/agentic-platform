// scheduler.js – shared agent scheduler for the Home buildings (2026-11-11): My house (house.js) and the Task Office (task-office.js).
// Scheduled tasks run on the server: prompt = body of ~/.claude/scheduled-tasks/<task>/SKILL.md (read on every run),
// a run is a conversation on a virtual floor (home-floors.js). The scheduler ticks once a minute; if the Mac slept at run time, the run catches up
// after wake (only the last missed slot, so at most 1 catch-up run), otherwise the slot is skipped. The `enabled` switch is
// off by default. Enabling does not fire a missed run: the last slot counts as resolved (the Claude app did it).
// Gate (`o.gate`, 2026-11-11, token saving): before a scheduled run (not a manual one) a cheap check without a model decides whether there is work.
// If not, the slot is resolved and „Preskočené: dôvod“ is recorded (a run with `skipped: true`), Claude is not started. Error or > 60 s = the run continues.
// Task: { n, h, m } (one slot per day) or { n, times: [[h, m], …] } (several slots), `window` = how long after the slot it still catches up (ms).
// `days: [0..6]` (Date.getDay) = slots only on these weekdays (Playground: Sunday), `daysText` = day text for the Clock tower schedule.
// `o.text(u, { date, t, how })` (optional) = prompt body from code instead of SKILL.md (a task the Claude app never had).
// State (enabled, last runs) is in data/<file>, `day` = key of the last slot that was started or resolved.
// Mac sleep (2026-11-17): a closed Mac on battery wakes only for a few seconds in DarkWake (no graphics). A run started then
// froze and after an hour the safeguard stopped it as an error. So: in DarkWake a scheduled run is not started (waits for a real wake)
// and a run during which the Mac slept (a gap between ticks or DarkWake) is stopped after wake, recorded as interrupted
// (`skipped: true, interrupted: true`, not an error) and the scheduler starts it again within the catch-up window.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { agentRun, error, day, tail, p2, skillText } from './agent-runs.js';
import { t as tl } from './i18n.js';

// Scheduled-task skills live in ~/.claude/scheduled-tasks/<folder>/SKILL.md. Task ids are English; existing
// installations keep the older folder names, so an English folder wins and the legacy one is the fallback.
const LEGACY_SKILL_DIRS = { 'morning-brief': 'ranny-brief', 'evening-journal': 'vecerny-dennik', 'daily-facts': 'denne-fakty', 'overview-for': 'prehlad-for', 'recurring-tasks': 'opakovane-ulohy' };
export function skillPath(u) {
  const dir = path.join(os.homedir(), '.claude', 'scheduled-tasks');
  const en = path.join(dir, u, 'SKILL.md');
  const legacy = LEGACY_SKILL_DIRS[u] && path.join(dir, LEGACY_SKILL_DIRS[u], 'SKILL.md');
  return legacy && !fs.existsSync(en) && fs.existsSync(legacy) ? legacy : en;
}

const MAX_RUNS = 10, MAX_DURATION = 60 * 60e3; // a run longer than an hour is stopped (e.g. stuck on an approval card)
const MAX_GATE = 60e3; // a gate longer than a minute is ignored (the run continues)
const GAP_SLEEP = 150e3; // tick once a minute; a bigger gap = the Mac slept

// The Mac is really awake (not DarkWake): `pmset -g systemstate` lists Graphics among capabilities. The result is cached for 20 s (shared by
// all schedulers). A command error = treated as awake (as before).
let awake = { t: 0, v: true };
export function macAwake() {
  if (Date.now() - awake.t < 20e3) return awake.v;
  let v = true;
  try { v = /Capabilities are:.*Graphics/.test(execFileSync('/usr/bin/pmset', ['-g', 'systemstate'], { encoding: 'utf8', timeout: 3000 })); } catch {}
  awake = { t: Date.now(), v };
  return v;
}

// o: { TASKS, floor, file ('house.json'), kind (SSE `kind`), skill(u) → SKILL.md path, intro(u, { how, date, t, finishing }) → text before the skill,
//      verification?(u, date) → (from) => bool, message?(u, reply) → text, messageOk?(u) → text for a successful run, model?, effort?, afterRun?(u, { ok }),
//      gate?(u, { t, last }) → Promise<{ startNow, reason, context? }> (last = start of the last successful run, ISO, or null; context goes into the prompt after the intro) }
export function newScheduler(o) {
  const { TASKS } = o;
  let DATA_FILE = null, emit = () => {}, sendMessage = null, stop = null;
  let S = { tasks: {} }; // task → { enabled, day, runs: [{ when, how, date, ok, conv, message }] }
  const running = {}; // task → { conv, from, how, date } while running

  const ul = (u) => (S.tasks[u] ||= { enabled: false, day: null, runs: [] });
  const save = () => { if (DATA_FILE) fs.writeFileSync(DATA_FILE, JSON.stringify({ ...S, running }, null, 1)); };
  const notify = () => emit({ kind: o.kind, type: o.kind });
  const times = (u) => TASKS[u].times || [[TASKS[u].h, TASKS[u].m]];

  // ------------------------------------------------------------ times

  // task slots around time t (yesterday, today, tomorrow), oldest first
  const slots = (u, t) => {
    const out = [];
    const days = TASKS[u].days, range = days ? Array.from({ length: 15 }, (_, i) => i - 7) : [-1, 0, 1]; // weekly task: ±7 days
    for (const dd of range) for (const [h, m] of times(u)) { const d = new Date(t); d.setDate(d.getDate() + dd); d.setHours(h, m, 0, 0); if (!days || days.includes(d.getDay())) out.push(d); }
    return out.sort((a, b) => a - b);
  };
  // the task's last slot that has already occurred
  function dueSlot(u, t = new Date()) { const s = slots(u, t).filter((d) => d <= t); return s[s.length - 1]; }
  const key = (u, s) => (times(u).length > 1 ? `${day(s)} ${p2(s.getHours())}:${p2(s.getMinutes())}` : day(s)); // single-slot task: date only (as in house.json from the start)
  // a slot is waiting for a run: it is in the catch-up window and has not been started yet
  const pending = (u, t) => { const s = dueSlot(u, t); return t < s.getTime() + TASKS[u].window && ul(u).day !== key(u, s) ? s : null; };
  function next(u, t = new Date()) {
    if (ul(u).enabled) { const c = pending(u, t); if (c) return c; }
    return slots(u, t).find((d) => d > t);
  }
  // the date the run is for: the slot in the catch-up window (the journal after midnight belongs to yesterday), otherwise today
  const dateRun = (u, t) => { const s = dueSlot(u, t); return t < s.getTime() + TASKS[u].window ? day(s) : day(t); };

  // ------------------------------------------------------------ state for GET

  const status = (t = new Date()) => Object.keys(TASKS).map((u) => {
    const x = ul(u), b = running[u], p = x.runs[0], c = times(u).map(([h, m]) => `${h}:${p2(m)}`);
    return { task: u, n: TASKS[u].n, time: c.join(', '), times: c, enabled: !!x.enabled, running: !!b, conv: b?.conv || null,
      last: p ? { when: p.when, ok: p.ok, conv: p.conv, how: p.how, date: p.date, message: p.message, skipped: !!p.skipped } : null, next: next(u, t).toISOString() };
  });

  // ------------------------------------------------------------ runs

  function endRun(u, b) {
    const x = ul(u), bb = running[u];
    if (bb?.slept && !b.ok && !b.skipped) { // the run froze during Mac sleep: not an error, the slot is released and the run starts again
      b = { ...b, ok: true, skipped: true, interrupted: true, message: tl(bb.how === 'plan' ? 'server.scheduler.interrupted.again' : 'server.scheduler.interrupted.withoutAgain') };
      if (bb.how === 'plan') x.day = bb.agoDay ?? null;
    }
    x.runs.unshift({ when: new Date().toISOString(), from: running[u]?.from || null, conv: null, ...b }); x.runs = x.runs.slice(0, MAX_RUNS);
    delete running[u]; save(); notify();
    if (b.skipped) return; // nothing changed, afterRun (mirror refresh, cache) is not needed
    try { o.afterRun?.(u, { ok: !!b.ok }); } catch (e) { console.warn(`${o.kind} (${u}) poBehu:`, e.message); }
  }

  // last successful run (skipped included): its start, from which the gate looks for news; runs from `set` without `from` have only `when`
  const last = (u) => { const b = ul(u).runs.find((x) => x.ok && !x.interrupted); return b ? b.from || b.when : null; };
  // gate with a time limit; an error, timeout or nonsensical reply = run (fail-open)
  async function askGate(u, t) {
    let timer;
    try {
      const r = await Promise.race([
        Promise.resolve().then(() => o.gate(u, { t, last: last(u) })),
        new Promise((_, no) => { timer = setTimeout(() => no(new Error(`brána trvala dlhšie ako ${MAX_GATE / 1000} s`)), MAX_GATE); }),
      ]);
      if (!r || typeof r.startNow !== 'boolean') throw new Error('brána nevrátila { spustit }');
      return r;
    } catch (e) {
      console.warn(`${o.kind} (${u}) brána:`, e.message);
      return { startNow: true, reason: tl('server.scheduler.gateFailed') };
    } finally { clearTimeout(timer); }
  }

  async function start(u, how = 'manual', t = new Date()) {
    if (!TASKS[u]) throw error(tl('server.scheduler.unknownTask'), 404);
    if (running[u]) throw error(tl('server.scheduler.alreadyRunning', { n: TASKS[u].n }), 409);
    if (!sendMessage) throw error(tl('server.scheduler.buildingUnset'), 500);
    const date = dateRun(u, t), s = dueSlot(u, t);
    const finishing = how === 'plan' && t - s > 5 * 60e3;
    const from = new Date().toISOString(), agoDay = ul(u).day;
    ul(u).day = key(u, s); // slot resolved (also a manual run: the scheduler will not start it again in the same slot)
    running[u] = { how, date, conv: null, from, agoDay }; save(); notify(); // also during the gate: a second run is not started
    try {
      let context = '';
      if (how === 'plan' && o.gate) {
        const b = await askGate(u, t);
        if (!b.startNow) { endRun(u, { how, date, ok: true, skipped: true, message: tl('server.scheduler.skipped', { reason: b.reason || tl('server.scheduler.noneOnDoing') }) }); return { skipped: true }; }
        context = b.context ? String(b.context).trim() + '\n\n' : '';
      }
      const text = o.intro(u, { how, date, t, finishing }) + context + (o.text ? o.text(u, { date, t, how }) : skillText(o.skill(u)));
      const r = await agentRun({ sendMessage, floor: o.floor, text, title: `${TASKS[u].n} ${date}`, model: o.model, effort: o.effort,
        verification: o.verification?.(u, date),
        message: (reply) => (o.message ? o.message(u, reply) : tail(reply, 600)),
        onConv: (id) => { if (running[u]?.from === from) { running[u].conv = id; save(); notify(); } },
        onEnd: ({ ok, conv, message }) => endRun(u, { how, date, conv: conv ?? running[u]?.conv ?? null, ok, message: ok && o.messageOk?.(u) || message }) });
      setTimeout(() => { if (running[u]?.from === from && running[u].conv && stop) stop(running[u].conv).catch(() => {}); }, MAX_DURATION).unref();
      return r;
    } catch (e) {
      endRun(u, { how, date, ok: false, message: tl('server.scheduler.notStarted', { error: e.message }) });
      throw e;
    }
  }

  function toggle(u, enabled, t = new Date()) {
    if (!TASKS[u]) throw error(tl('server.scheduler.unknownTask'), 404);
    const x = ul(u);
    if (enabled === true && !x.enabled) x.day = key(u, dueSlot(u, t)); // the last slot was still done by the Claude app, no catch-up
    x.enabled = enabled === true; save(); notify();
    return status(t);
  }

  // scheduler: enabled tasks in their slot or in the catch-up window, each at most once per slot
  let lastTick = Date.now();
  function tick(t = new Date()) {
    const slept = Date.now() - lastTick > GAP_SLEEP; lastTick = Date.now();
    const woken = macAwake();
    for (const [u, b] of Object.entries(running)) {
      if (slept || !woken) b.slept = true; // the run went through a Mac sleep
      else if (b.slept && b.conv && !b.stops && stop) { b.stops = true; stop(b.conv).catch(() => {}); } // after wake: interrupt, it will start again
    }
    if (!woken) return; // DarkWake: do not start, wait for a real wake
    for (const u of Object.keys(TASKS)) {
      if (!ul(u).enabled || running[u] || !pending(u, t)) continue;
      start(u, 'plan', t).catch((e) => console.warn(`${o.kind} (${u}):`, e.message));
    }
  }

  function set(n) {
    DATA_FILE = path.join(n.data, o.file); emit = n.emit || emit; sendMessage = n.sendMessage; stop = n.stop || null;
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
    if (saved?.tasks) S.tasks = saved.tasks;
    for (const [u, b] of Object.entries(saved?.running || {})) if (TASKS[u]) endRun(u, { how: b.how || 'manual', date: b.date || null, conv: b.conv || null, ok: false, message: tl('server.scheduler.restart') });
    save();
    setTimeout(() => { try { tick(); } catch (e) { console.warn(`${o.kind}:`, e.message); } }, 45e3).unref(); // wait a moment after start (conversations)
    setInterval(() => { try { tick(); } catch (e) { console.warn(`${o.kind}:`, e.message); } }, 60e3).unref();
  }

  // schedule for the Clock tower (read only): tasks, times, enabled, running, last run and next slot
  const schedule = (t = new Date()) => status(t).map((x) => ({ task: x.task, name: x.n, times: x.times, ...(TASKS[x.task].daysText ? { days: TASKS[x.task].daysText } : {}), enabled: x.enabled, running: x.running,
    last: x.last ? { when: x.last.when, ok: x.last.ok, skipped: x.last.skipped } : null, next: x.next }));

  // last runs of a task for the building panel (newest first): { when, ok, how, date, skipped, message (at most 200 chars) }
  const runs = (u, n = 5) => (S.tasks[u]?.runs || []).slice(0, n).map((b) => ({ when: b.when, ok: !!b.ok, how: b.how || null, date: b.date || null, skipped: !!b.skipped, message: tail(b.message, 200) }));

  return { dueSlot, next, status, schedule, runs, start, toggle, tick, set, running: (u) => !!running[u] };
}
