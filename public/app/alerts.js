// alerts.js – Beep and system notification when an agent is waiting for approval (2026-11-10).
// Beep via Web Audio (no sound file). Notification only when the City is not in view (another tab, another window).
// Muting (2026-11-20): the setting is on the server (notifications.js, /api/notifications) and also applies to macOS notifications
// and push to mobile. The "Notifications" item in the ⋯ menu cycles: on → no sound → quiet 1 h → off → on.
// A change from another window is brought by the `notifikacie` event (api.js → onChangeNotifications).
import { $ } from './utils.js';
import { t as T, locale } from './i18n.js';

const OLD_KEY = 'city-alerts'; // until 2026-11-20 the off state was only in localStorage of this browser
let N = { mode: 'enabled', quietUntil: 0, mobileDone: 'outsideMac' };
let ctx = null, timer = 0;

const muted = () => N.quietUntil > Date.now();
const show = () => N.mode !== 'disabled' && !muted();
const withSound = () => N.mode === 'enabled' && !muted();

// the browser allows sound only after the first click on the page, so we prepare the AudioContext then
function unlock() {
  if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); }
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
}

function play() {
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const t0 = ctx.currentTime;
  for (const [f, from] of [[880, 0], [1175, 0.16]]) { // two short tones upward
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + from); g.gain.exponentialRampToValueAtTime(0.18, t0 + from + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + from + 0.22);
    o.connect(g).connect(ctx.destination); o.start(t0 + from); o.stop(t0 + from + 0.25);
  }
}
export function beep() { if (withSound()) play(); }

// system notification (macOS notification center), a click returns to the City on the given floor
export function notify(title, text, tag, onClick) {
  if (!show() || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return; // the City is in view, a label, toast and beep are enough
  try {
    const n = new Notification(title, { body: text, tag, renotify: true, silent: !withSound() });
    n.onclick = () => { window.focus(); n.close(); onClick?.(); };
  } catch {}
}

// can this window show a notification? The server decides by that whether to send its own macOS notification (os-notifications.js).
// With notifications off it does not matter, the server then sends nothing.
export const canNotify = () => show() && 'Notification' in window && Notification.permission === 'granted';
const changeOptions = () => dispatchEvent(new Event('city-alerts')); // api.js reconnects with ?notif=

const hhmm = (ms) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
function refreshBtn() {
  const b = $('bellBtn'); if (!b) return;
  dispatchEvent(new Event('city-settings')); // the Settings window redraws four buttons
  const quiet = muted();
  b.textContent = quiet ? T('app.alert.quietUntil', { time: hhmm(N.quietUntil) }) : { enabled: T('app.alert.enabled'), silent: T('app.alert.withoutSound'), disabled: T('app.alert.disabled') }[N.mode];
  b.classList.toggle('on', N.mode === 'enabled' && !quiet);
  const permission = !('Notification' in window) ? '' : Notification.permission === 'denied' ? ' ' + T('app.alert.banned')
    : Notification.permission === 'default' ? ' ' + T('app.alert.allow') : '';
  b.title = (quiet ? T('app.alert.quietHeading', { time: hhmm(N.quietUntil) })
    : { enabled: T('app.alert.enabledHeading'), silent: T('app.alert.quietTitle'), disabled: T('app.alert.disabledHeading') }[N.mode])
    + permission + ' ' + T('app.alert.click');
  clearTimeout(timer); if (quiet) timer = setTimeout(() => { refreshBtn(); changeOptions(); }, Math.min(N.quietUntil - Date.now() + 500, 2 ** 31 - 1)); // after the quiet period ends the caption returns by itself
}

// new state from the server (the `notifikacie` event from api.js or a response to a change)
export function onChangeNotifications(status) {
  if (!status) return;
  const ago = canNotify(); N = { mode: status.mode, quietUntil: status.quietUntil || 0, mobileDone: status.mobileDone || 'outsideMac' }; refreshBtn(); dispatchEvent(new Event('city-settings'));
  if (ago !== canNotify()) changeOptions();
}

// current state from the server; also called by api.js on connect (separate windows do not call initAlerts)
export async function loadNotifications() {
  try { const r = await fetch('/api/notifications', { cache: 'no-store' }); if (r.ok) onChangeNotifications(await r.json()); } catch {}
}

async function save(change) {
  try {
    const r = await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
    if (r.ok) onChangeNotifications(await r.json());
  } catch {}
}

// Settings window (settings.js, 2026-11-20): four buttons instead of clicking through; 'quiet' = on with quiet for 1 h
export const alertState = () => (muted() ? 'quiet' : N.mode);
export async function chooseAlerts(v) {
  unlock();
  if (v !== 'disabled' && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
  await save(v === 'quiet' ? { mode: 'enabled', quietMin: 60 } : { mode: v });
  if (v === 'enabled') beep();
}

// push to mobile when a turn finishes (2026-11-22): always | outsideMac | nie
export const mobileDoneState = () => N.mobileDone;
export const chooseMobileDone = (v) => save({ mobileDone: v });

export function initAlerts() {
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });
  const b = $('bellBtn'); if (!b) return;
  b.onclick = async () => {
    unlock();
    if (show() && 'Notification' in window && Notification.permission === 'default') { await Notification.requestPermission().catch(() => {}); refreshBtn(); beep(); changeOptions(); return; }
    if (muted()) await save({ mode: 'disabled' });
    else if (N.mode === 'enabled') await save({ mode: 'silent' });
    else if (N.mode === 'silent') await save({ mode: 'enabled', quietMin: 60 });
    else await save({ mode: 'enabled' });
    beep();
  };
  refreshBtn();
  (async () => {
    try {
      let old = null; try { old = localStorage.getItem(OLD_KEY); localStorage.removeItem(OLD_KEY); } catch {}
      if (old === '0') return save({ mode: 'disabled' }); // transfers the old off state from this browser to the server
      await loadNotifications();
    } catch {}
  })();
}
