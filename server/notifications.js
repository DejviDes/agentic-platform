// notifications.js – muting city notifications (2026-11-20). One setting for all channels:
// the beep and notifications in the app window (alerts.js), macOS notifications from the server (os-notifications.js) and push to the phone (push.js).
// Mode: enabled (with sound) | silent (notifications without sound) | disabled (nothing). Plus quiet until a time (quietUntil, ms):
// until then nothing is shown, afterwards the mode applies again. Stored in data/notifications.json.
// The phone pairing code (devices.js) bypasses this setting, it must always arrive.
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';

const MODES = ['enabled', 'silent', 'disabled'];
const MOBILE_DONE = ['always', 'outsideMac', 'no']; // push to the phone when a turn finishes (2026-11-22): always | only when no app is active on the Mac | never
let FILE = null;
let S = { mode: 'enabled', quietUntil: 0, mobileDone: 'outsideMac' }; // default outsideMac since 2026-11-24 (fewer pushes)

export function setNotifications({ data }) {
  FILE = path.join(data, 'notifications.json');
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (MODES.includes(d.mode)) S.mode = d.mode; S.quietUntil = Number(d.quietUntil) || 0; if (MOBILE_DONE.includes(d.mobileDone)) S.mobileDone = d.mobileDone; } catch {}
}

const muted = () => S.quietUntil > Date.now();
export const notificationState = () => ({ mode: S.mode, quietUntil: muted() ? S.quietUntil : 0, mobileDone: S.mobileDone });
export const mobileDone = () => S.mobileDone;
export const show = () => S.mode !== 'disabled' && !muted(); // the notification is sent at all
export const withSound = () => S.mode === 'enabled' && !muted(); // and with a beep / sound

// { mode }, { quietMin } (0 = cancel quiet) or { mobileDone } → new state; invalid values throw an error with code 400
export function changeNotifications(d = {}) {
  if (d.mode !== undefined) {
    if (!MODES.includes(d.mode)) throw Object.assign(new Error(t('server.notifications.unknownMode')), { code: 400 });
    S.mode = d.mode; S.quietUntil = 0;
  }
  if (d.mobileDone !== undefined) {
    if (!MOBILE_DONE.includes(d.mobileDone)) throw Object.assign(new Error(t('server.notifications.unknownChoice')), { code: 400 });
    S.mobileDone = d.mobileDone;
  }
  if (d.quietMin !== undefined) {
    const m = Number(d.quietMin);
    if (!Number.isFinite(m) || m < 0 || m > 24 * 60) throw Object.assign(new Error('Ticho najviac na 24 h'), { code: 400 });
    S.quietUntil = m ? Date.now() + m * 60e3 : 0;
  }
  if (FILE) { try { fs.writeFileSync(FILE, JSON.stringify(S, null, 2)); } catch (e) { console.warn('notifikácie:', e.message); } }
  return notificationState();
}
