// wake_when (2026-11-28): the agent asks the server to wake it (a new turn in the same conversation) when a long detached job finishes
// (file stops growing / process is gone). The server polls every 30 s (no Claude involved); waits are kept in data/wakeups.json (survive a restart).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

const EVERY = 30e3, DEFAULT_MIN = 180, MAX_MIN = 360;
let FILE = null, host = null, WAITS = [], timer = null, busy = false;

const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(WAITS, null, 1)); } catch (e) { console.warn('wakeups:', e.message); } };
const expand = (p) => String(p || '').trim().replace(/^~(?=\/|$)/, os.homedir());
const running = (pattern) => new Promise((done) => execFile('pgrep', ['-f', pattern], (err, out) => done(!err && String(out).trim() !== '')));

// host: { data, exists(convId), wake(w, reason: 'done' | 'timeout' | 'process-file') -> Promise, tl }
export function init(h) {
  host = h; FILE = path.join(h.data, 'wakeups.json');
  try { WAITS = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!Array.isArray(WAITS)) WAITS = []; } catch { WAITS = []; }
  if (WAITS.length) start();
}

function start() { if (!timer) { timer = setInterval(tick, EVERY); timer.unref?.(); } }

export function register({ conv, floor, agent, file, process: proc, message, timeoutMinutes }) {
  const f = file ? path.resolve(expand(file)) : '', p = String(proc || '').trim();
  if (!f && !p) return { error: 'noCondition' };
  if (p && p.length < 3) return { error: 'shortProcess' };
  const min = Math.min(MAX_MIN, Math.max(1, Math.round(Number(timeoutMinutes) || DEFAULT_MIN)));
  const w = { id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), conv, floor, agent, file: f, process: p, message: String(message || '').trim(), created: Date.now(), deadline: Date.now() + min * 60e3, size: -1, stable: 0 };
  WAITS.push(w); save(); start();
  return { wait: w, minutes: min };
}

export function cancelFor(conv) { const n = WAITS.length; WAITS = WAITS.filter((w) => w.conv !== conv); if (WAITS.length !== n) save(); return n - WAITS.length; }
export const pending = () => WAITS.length;

async function check(w) { // true = condition met
  if (w.file) {
    let size = -1; try { size = fs.statSync(w.file).size; } catch {}
    if (size < 0) { w.size = -1; w.stable = 0; return false; }
    w.stable = size === w.size ? w.stable + 1 : 0; w.size = size;
    if (w.stable < 1) return false; // size unchanged in 2 checks in a row
  }
  if (w.process && await running(w.process)) return false;
  return true;
}

async function tick() {
  if (busy) return; busy = true;
  try {
    for (const w of [...WAITS]) {
      if (!host.exists(w.conv)) { WAITS = WAITS.filter((x) => x !== w); save(); continue; }
      let reason = null;
      try { if (await check(w)) reason = 'done'; } catch (e) { console.warn('wakeups check:', e.message); }
      if (!reason && Date.now() >= w.deadline) reason = 'timeout';
      if (!reason) continue;
      WAITS = WAITS.filter((x) => x !== w); save();
      try { await host.wake(w, reason); } catch (e) { console.warn('wakeups wake:', e.message); }
    }
  } finally { busy = false; }
  if (!WAITS.length && timer) { clearInterval(timer); timer = null; }
}
export const tickNow = () => tick(); // for tests
