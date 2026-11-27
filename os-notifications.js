// os-notifications.js – macOS notifications straight from the server (2026-11-10), even when the app is not open in a browser.
// When an agent starts waiting for approval or finishes a turn and no open app window can show its own notification
// (SSE client with ?notif=1 = 🔔 on and browser notifications allowed), the server sends a macOS notification.
// Since 2026-11-12 it is sent by a dedicated app `notifier/City agents.app` (city name and icon, a click opens the floor).
// notifier/build.sh builds it on first use or when the source is newer (the .app is in .gitignore).
// While it is being built or when it fails (e.g. notifications disabled in Settings), it falls back to `terminal-notifier`
// or `osascript` (shown under the name Script Editor). The text is passed as an argument, not as script code.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IS_MAC } from './platform.js';
import { t } from './i18n.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'notifier');
const APP_BIN = path.join(DIR, 'Mesto agentov.app', 'Contents', 'MacOS', 'mesto-oznam');
const SOURCES = ['notifier.swift', 'icon.swift', 'build.sh'].map((f) => path.join(DIR, f));
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
let builds = false, buildFailed = 0;

// true = the app is ready; otherwise starts a background build (at most once per 10 min after a failure) and returns false
function appReady() {
  if (!IS_MAC) return false;
  if (mtime(APP_BIN) >= Math.max(...SOURCES.map(mtime))) return true;
  if (!builds && Date.now() - buildFailed > 10 * 60e3) {
    builds = true;
    execFile('/bin/sh', [path.join(DIR, 'build.sh')], { timeout: 180e3 }, (e, _o, stderr) => {
      builds = false;
      if (e) { buildFailed = Date.now(); console.warn('notifikator: zostavenie zlyhalo:', String(stderr).trim().split('\n').slice(-3).join(' ') || e.message); }
    });
  }
  return false;
}

const TN_PATHS = ['/opt/homebrew/bin/terminal-notifier', '/usr/local/bin/terminal-notifier'];
export const terminalNotifier = () => !IS_MAC ? null : TN_PATHS.find((c) => fs.existsSync(c)) || null; // checked on every notification, installation needs no restart

function fallback({ title, subtitle, text, url, group, quiet }) {
  if (!IS_MAC) return;
  const tn = terminalNotifier(), cb = (e) => { if (e) console.warn('notifikácia macOS:', e.message); };
  if (tn) return execFile(tn, ['-title', title, '-subtitle', subtitle, '-message', text || ' ', '-group', group, ...(quiet ? [] : ['-sound', 'Glass']), ...(url ? ['-open', url] : [])], { timeout: 10000 }, cb);
  execFile('osascript', ['-e', 'on run argv', '-e', 'display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv)' + (quiet ? '' : ' sound name "Glass"'), '-e', 'end run', title, subtitle, text || ' '], { timeout: 10000 }, cb);
}

export function notifyMac({ title, subtitle = '', text = '', url = '', group = 'city', quiet = false }) {
  if (!IS_MAC) return; // outside macOS the notification stays only in the app window (toApp) and on the phone
  const o = { title, subtitle, text, url, group, quiet };
  if (!appReady()) return fallback(o);
  execFile(APP_BIN, [title, subtitle, text || ' ', url, group, ...(quiet ? ['quiet'] : [])], { timeout: 15000 }, (e, _o, stderr) => {
    if (!e) return;
    console.warn('notifier:', String(stderr).trim() || e.message, '→ náhradná notifikácia');
    fallback(o);
  });
}

// watches conversation state changes from `conv` events and decides whether to send a notification (only the server decides for Mac and phone, 2026-11-24)
// who(k) → agent name, floor(k) → { n } for text and link, canApp() → true if the browser will show it
// push({ title, text, url }) → web push to the phone (gateway), cardActive() → true if an app tab is currently active on the Mac
// toApp({ title, text, tag, n, conv }) → the open app window shows the completion notification (SSE `notify`, api.js)
// show() → false = notifications off or quiet for a while, withSound() → false = no sound (notifications.js)
// Fewer notifications (2026-11-24): completion does not beep for automatic server runs (k.scheduled) nor for turns shorter than LONG_TURN_MS;
// completions within MERGE_MS after the last notification are merged into one. Errors and approval waits go out immediately.
// Phone: approval and completion by mobileDone: always | outsideMac (only when no tab is active on the Mac for 2 min) | no (completion never, approval when away from the Mac).
export const LONG_TURN_MS = 120e3, MERGE_MS = 120e3;
export function watchStates({ port, who, floor, canApp, push, cardActive, toApp, show = () => true, withSound = () => true, mobileDone = () => 'outsideMac', now = () => Date.now(), timer = setTimeout }) {
  const states = new Map(); // conversation id → last state
  const starts = new Map(); // conversation id → turn start time (running after a non-running state)
  let window = null; // merging: { items } during MERGE_MS after the last sent completion notification
  const outsideMac = () => !(cardActive?.());
  function send({ title, text, subtitle = '', tag, n = null, conv = null, mobile, quiet }) {
    if (push && mobile) { try { push({ title, text: subtitle ? `${subtitle}: ${text}` : text, url: conv ? `/#k=${encodeURIComponent(conv)}` : '/', quiet }); } catch {} }
    if (canApp()) { try { toApp?.({ title, text: subtitle ? `${subtitle} · ${text}` : text, tag, n, conv }); } catch {} return; }
    notifyMac({ title, subtitle, text, url: `http://localhost:${port}/` + (n ? `#${encodeURIComponent(n)}` : ''), group: tag, quiet });
  }
  const mobileCompletion = () => { const mh = mobileDone(); return mh === 'always' || (mh === 'outsideMac' && outsideMac()); };
  function sendCompletion(items) {
    if (!show() || !items.length) return;
    const quiet = !withSound(), mobile = mobileCompletion();
    if (items.length === 1) { const p = items[0]; return send({ ...p, mobile, quiet }); }
    const names = [...new Set(items.map((p) => p.name))];
    send({ title: t('server.notices.completedTurns', { n: items.length }), text: names.join(', '), tag: 'conv-summary', mobile, quiet });
  }
  function queueCompletion(p) {
    if (window) { window.items = window.items.filter((x) => x.conv !== p.conv); window.items.push(p); return; }
    sendCompletion([p]);
    openWindow();
  }
  function openWindow() {
    window = { items: [] };
    timer(() => { const z = window.items; window = null; if (z.length) { sendCompletion(z); openWindow(); } }, MERGE_MS);
  }
  return (k) => {
    const ago = states.get(k.id), st = k.status; states.set(k.id, st);
    if (st === 'running' && ago !== 'running' && ago !== 'pending') starts.set(k.id, now());
    if (ago === undefined || ago === st) return;
    // a team member's task (k.parent) beeps on completion or error, not when stopped together with the lead ('none') (2026-11-16)
    const end = k.parent ? ['done', 'error'] : ['done', 'reply', 'none', 'error'];
    const pending = st === 'pending', done = (ago === 'running' || ago === 'pending') && end.includes(st);
    if (!pending && !done) return;
    const from = starts.get(k.id); if (done) starts.delete(k.id);
    if (!show()) return;
    const P = floor(k); if (!P) return;
    const name = who(k, P), quiet = !withSound();
    const base = { subtitle: P.n, text: k.title, n: P.n, conv: k.id, name };
    if (pending) { // approval: on the Mac the panel in the app shows it (panel.js), otherwise a macOS notification
      const mh = mobileDone();
      if (push && (mh === 'always' || outsideMac())) { try { push({ title: t('server.notices.pending', { name }), text: `${P.n}: ${k.title}`, url: `/#k=${encodeURIComponent(k.id)}`, quiet }); } catch {} }
      if (!canApp()) notifyMac({ title: t('server.notices.pending', { name }), subtitle: P.n, text: k.title, url: `http://localhost:${port}/#${encodeURIComponent(P.n)}`, group: 'caka-' + k.id, quiet });
      return;
    }
    if (st === 'error') return send({ ...base, title: t('server.notices.error', { name }), tag: 'konv-' + k.id, mobile: true, quiet });
    if (k.scheduled) return; // automatic server run (morning brief, Sorter…): the result is in the city, no beep
    if (from !== undefined && now() - from < LONG_TURN_MS) return; // short turn: you saw or will see the reply in the city
    if (st === 'none') return; // you stopped it yourself
    const title = st === 'reply' ? t('server.notices.reply', { name }) : k.parent ? t('server.notices.task', { name }) : t('server.notices.turn', { name });
    queueCompletion({ ...base, title, tag: 'konv-' + k.id });
  };
}
