// sleep.js – Mac sleep (2026-11-23). The user closes the MacBook lid, puts it in a bag and the agents finish (continues from mobile).
// A closed Mac always sleeps, caffeinate does not stop it; the only way is `sudo -n pmset -a disablesleep 1|0`. Passwordless sudo is set up
// once by the user with scripts/sleep-sudo.sh (allows only these two commands). The server keeps the mode in data/sleep.json:
//   common – does nothing (default)
//   agents – while an agent works, disablesleep 1; a conversation that waits (approval, question) keeps the Mac up at most 30 min from the start of waiting.
//            When nothing holds anymore (after a 30 s tail so the Mac does not sleep between two turns of a chain): disablesleep 0 and sleepnow if the lid is closed.
//   never  – disablesleep 1 always, until the user turns it off
// Overheating guard (2026-11-26): a closed Mac with macOS thermal pressure at least heavy (notifyutil thermalpressurelevel ≥ 2) restores sleep,
// goes to sleep and an alert is sent; back only after the lid is opened or after 10 min without pressure. Degrees are not read (they need sudo and 90 °C is common under load).
// Guard for both active modes: on battery below 15 % sleep is restored and an alert is sent (macOS + push), released again only after charging above 15 % or on AC power.
// pmset is called only when the desired state changes (the 20 s tick only reads agent state, battery once per 20 s). On start the state is reconciled, on SIGTERM/SIGINT disablesleep 0 is restored.
import fs from 'node:fs';
import { t } from './i18n.js';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { IS_MAC } from './platform.js';

export const MODES_SLEEP = ['common', 'agents', 'never'];
const WAITING_MAX = 30 * 60e3; // waiting for the user keeps the Mac awake at most this long from the start of waiting
const REVERB = 30e3; // after the last activity keep holding a little longer (chain of turns, scheduler)
const MIN_BATTERY = 15;
const PRESSURE_MAX = 2, COOLDOWN = 10 * 60e3; // 0 nominal, 1 moderate, 2 heavy, 3 trapping, 4 sleeping
const TICK = 20e3, CACHE = 20e3, SUDO_CACHE = 60e3, SUDO_RETRY = 60e3;
const PMSET = '/usr/bin/pmset', SUDO = '/usr/bin/sudo', IOREG = '/usr/sbin/ioreg', NOTIFYUTIL = '/usr/bin/notifyutil';

const executeReal = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });

let FILE = null, execute = executeReal, activity = () => ({ running: 0, pending: [] }), alert = () => {}, clock = Date.now, timer = null;
let S = { mode: 'common', held: false }; // held = whether we last set disablesleep 1 (survives a server restart too)
let sudo = { ok: null, t: 0 }, bat = { t: 0, v: null }, lid = { t: 0, v: null }, pressure = { t: 0, v: null };
let overheated = false, overheatedFrom = 0, warnedHeat = false;
let lastHold = 0, lastSudo = 0, fromReason = '', batteryLow = false, warned = false, wants = false;

const save = () => { if (FILE) { try { fs.writeFileSync(FILE, JSON.stringify(S, null, 2)); } catch (e) { console.warn('spánok:', e.message); } } };

// configuration (in production only { data, activity, alert }, the rest for tests with a faked pmset)
export function setSleep(o = {}) {
  if (!IS_MAC) return; // no pmset outside macOS: nothing is run
  if (o.data) FILE = path.join(o.data, 'sleep.json');
  if (o.execute) execute = o.execute;
  if (o.activity) activity = o.activity;
  if (o.alert) alert = o.alert;
  if (o.clock) clock = o.clock;
  S = { mode: 'common', held: false }; sudo = { ok: null, t: 0 }; bat = { t: 0, v: null }; lid = { t: 0, v: null }; pressure = { t: 0, v: null };
  overheated = false; overheatedFrom = 0; warnedHeat = false;
  lastHold = 0; lastSudo = 0; batteryLow = false; warned = false; wants = false; fromReason = '';
  if (FILE) { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (MODES_SLEEP.includes(d.mode)) S.mode = d.mode; S.held = !!d.held; } catch {} }
  recompute();
  clearInterval(timer); timer = setInterval(() => { try { recompute(); } catch (e) { console.warn('spánok:', e.message); } }, TICK); timer.unref?.();
}

function detectSudo(force) { // `sudo -n -l` with exact arguments: succeeds only if the rule exists (nothing is run)
  if (!force && sudo.ok !== null && clock() - sudo.t < SUDO_CACHE) return sudo.ok;
  let ok = false; try { execute(SUDO, ['-n', '-l', PMSET, '-a', 'disablesleep', '1']); ok = true; } catch {}
  sudo = { ok, t: clock() }; return ok;
}
function detectBattery() { // { onBattery, pct } or null (desktop Mac, error)
  if (clock() - bat.t < CACHE) return bat.v;
  let v = null;
  try { const t = execute(PMSET, ['-g', 'batt']), m = t.match(/(\d{1,3})%/); if (m) v = { onBattery: /Battery Power/.test(t), pct: Number(m[1]) }; } catch {}
  bat = { t: clock(), v }; return v;
}
function detectLid(force) { // true = closed, false = open, null = unknown
  if (!force && clock() - lid.t < CACHE) return lid.v;
  let v = null; try { v = /"AppleClamshellState"\s*=\s*Yes/.test(execute(IOREG, ['-r', '-k', 'AppleClamshellState', '-d', '1'])); } catch {}
  lid = { t: clock(), v }; return v;
}
function detectPressure() { // macOS thermal pressure 0 to 4 or null
  if (clock() - pressure.t < CACHE) return pressure.v;
  let v = null; try { const m = execute(NOTIFYUTIL, ['-g', 'com.apple.system.thermalpressurelevel']).match(/(\d+)\s*$/); if (m) v = Number(m[1]); } catch {}
  pressure = { t: clock(), v }; return v;
}
function setPmset(value) { // true = podarilo sa
  lastSudo = clock();
  try { execute(SUDO, ['-n', PMSET, '-a', 'disablesleep', value ? '1' : '0']); sudo = { ok: true, t: clock() }; S.held = value; save(); return true; }
  catch { sudo = { ok: false, t: clock() }; return false; }
}
const mn = (n, key) => t(key + (n === 1 ? '1' : n >= 2 && n <= 4 ? '2' : '5')); // Slovak plural forms (English uses 1 and the rest)

// what the Mac should do now: { wants, reason }
function compute() {
  const { running, pending: pendingTimes } = activity(), nowMs = clock();
  if (S.mode === 'common') return { wants: false, reason: t('server.sleep.common') };
  const b = detectBattery();
  if (b) { if (b.onBattery && b.pct < MIN_BATTERY) batteryLow = true; else if (!b.onBattery || b.pct > MIN_BATTERY) batteryLow = false; } else batteryLow = false; // hysteresis: back only above 15 % or on AC power
  if (batteryLow) return { wants: false, reason: t('server.sleep.battery', { pct: MIN_BATTERY }), battery: true };
  const lidClosed = detectLid() === true, tl = lidClosed ? detectPressure() : null;
  if (lidClosed && tl !== null && tl >= PRESSURE_MAX) { overheated = true; overheatedFrom = nowMs; }
  else if (overheated && (!lidClosed || (nowMs - overheatedFrom >= COOLDOWN && !tl))) overheated = false;
  if (overheated) return { wants: false, reason: t('server.sleep.heat'), heat: true };
  if (S.mode === 'never') return { wants: true, reason: t('server.sleep.never') };
  const pending = pendingTimes.filter((c) => nowMs - c < WAITING_MAX);
  if (running > 0) return { wants: true, reason: `${running} ${mn(running, 'server.sleep.working')}`, active: true };
  if (pending.length) {
    const minsLeft = Math.max(1, Math.ceil((WAITING_MAX - (nowMs - Math.min(...pending))) / 60e3));
    return { wants: true, reason: t('server.sleep.pending', { n: pending.length, agents: mn(pending.length, 'server.sleep.pending'), zost: minsLeft }), active: true };
  }
  if (pendingTimes.length) return { wants: false, reason: t('server.sleep.pendingLong') };
  return { wants: false, reason: t('server.sleep.noneNotWorking') };
}

// reconciles the desired state with the actual one; called from the tick, on conversation change and on mode change
export function recompute(force = false) {
  if (!IS_MAC) return;
  const v = compute(); fromReason = v.reason; wants = v.wants;
  if (v.wants) lastHold = clock();
  let targetHold = v.wants;
  if (!v.wants && S.held && !v.battery && !v.heat && S.mode === 'agents' && clock() - lastHold < REVERB) targetHold = true; // tail
  if (v.battery && S.held && !warned) { warned = true; try { alert(t('server.sleep.batteryHeading'), t('server.sleep.batteryText')); } catch {} }
  if (!v.battery) warned = false;
  if (v.heat && S.held && !warnedHeat) { warnedHeat = true; try { alert(t('server.sleep.heatHeading'), t('server.sleep.heatText')); } catch {} }
  if (!v.heat) warnedHeat = false;
  if (targetHold === S.held) return;
  if (!force && sudo.ok === false && clock() - lastSudo < SUDO_RETRY) return; // without the sudo rule it is not retried every 20 s
  if (targetHold && !detectSudo(true)) { sudo = { ok: false, t: clock() }; lastSudo = clock(); return; }
  const was = S.held;
  if (!setPmset(targetHold)) return;
  if (was && !targetHold && detectLid(true) === true) { try { execute(PMSET, ['sleepnow']); } catch (e) { console.warn('spánok: sleepnow:', e.message); } } // the lid is closed and nothing holds: sleep
}

// { mode } → new state; an invalid value = error with code 400
export function changeSleep(d = {}) {
  if (!IS_MAC) throw Object.assign(new Error(t('server.sleep.onlyMac')), { code: 400 });
  if (d.mode === undefined || !MODES_SLEEP.includes(d.mode)) throw Object.assign(new Error(t('server.sleep.unknownMode')), { code: 400 });
  S.mode = d.mode; save();
  lastHold = 0; detectSudo(true); bat.t = 0; recompute(true);
  return sleepState();
}

export function sleepState() {
  if (!IS_MAC) return { mode: 'common', holds: false, available: false, reason: 'Iba na macOS.' };
  const b = detectBattery(), ok = detectSudo(false);
  const reason = wants && !S.held && ok === false ? t('server.sleep.errorSudo') : fromReason;
  return { mode: S.mode, holds: S.held, reason, sudoOk: ok, sudoCommand: 'sudo bash ' + path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname)), 'scripts', 'sleep-sudo.sh').replace(process.env.HOME || '\0', '~'), battery: b, lid: S.mode === 'common' ? null : detectLid() };
}

// on server shutdown: sleep is restored (synchronously). On failure held stays true, the start reconciles it.
export function releaseSleep() {
  if (!IS_MAC) return;
  clearInterval(timer);
  if (!S.held) return;
  try { execute(SUDO, ['-n', PMSET, '-a', 'disablesleep', '0']); S.held = false; save(); } catch (e) { console.warn('spánok: návrat pri vypnutí zlyhal:', e.message); }
}
