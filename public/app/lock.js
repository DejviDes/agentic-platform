
import { ico } from './icons.js';
import { t as T } from './i18n.js';
// lock.js – City lock (2026-11-12, server: lock.js in the root). The card has its own key in sessionStorage (a new tab = locked),
// it adds it to every request to /api/* (fetch header x-city-key, EventSource and links via ?key=). After 8 min without mouse
// or keyboard movement it locks (blurred city + Touch ID), the 🔒 button in the bar locks immediately. A 401 response = the server
// dropped the key (expired), the card locks as well. Loaded as the first module (main.js), so that fetch is wrapped before anyone uses it.
const KEY_SS = 'city-key';
let key = sessionStorage.getItem(KEY_SS) || '';
let idle = 8 * 60e3, lastSeen = Date.now(), ping = 0, locked = false, external = false;
let pending = []; // who is waiting for unlock (app start)

const jeApi = (u) => { try { const x = new URL(u, location.href); return x.origin === location.origin && x.pathname.startsWith('/api/') ? x : null; } catch { return null; } };
export const withKey = (u) => (key ? u + (u.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key) : u);

const povFetch = window.fetch.bind(window);
window.fetch = async (enter, init) => {
  const u = typeof enter === 'string' ? enter : enter instanceof URL ? enter.href : enter.url, x = jeApi(u);
  if (!x) return povFetch(enter, init);
  if (key) { const h = new Headers(init?.headers || (enter instanceof Request ? enter.headers : undefined)); h.set('x-city-key', key); init = { ...init, headers: h }; }
  const r = await povFetch(enter, init);
  if (r.status === 401 && !x.pathname.startsWith('/api/lock/') && !locked && !external) lock(false);
  return r;
};
const PovES = window.EventSource;
window.EventSource = class extends PovES { constructor(u, o) { super(jeApi(u) ? withKey(u) : u, o); } };

// ---------- lock screen ----------
let el = null;
function screen(start) {
  if (!el) {
    el = document.createElement('div'); el.id = 'lock';
    el.innerHTML = `<div class="lockCard box"><div class="lockIcon">${ico('lock')}</div><div class="serif" style="font-size:30px">${T('app.lock.locked')}</div>
      <div class="mono" id="lockText" style="margin:6px 0 18px;color:var(--muted)">${T('app.lock.youUnlock')}</div>
      <button class="btn p" id="lockUnlock">${T('app.lock.unlock')}</button><div class="mono" id="lockError" style="margin-top:12px;color:var(--err);min-height:16px"></div></div>`;
    document.body.appendChild(el);
    el.querySelector('#lockUnlock').addEventListener('click', unlock);
  }
  el.classList.toggle('start', !!start);
  el.querySelector('#lockError').textContent = '';
  el.style.display = 'flex';
  setTimeout(() => el.querySelector('#lockUnlock').focus(), 50);
}

async function unlock() {
  const b = el.querySelector('#lockUnlock'), ch = el.querySelector('#lockError');
  b.disabled = true; b.textContent = T('app.lock.attach'); ch.textContent = '';
  try {
    const r = await povFetch('/api/lock/unlock', { method: 'POST' }), d = await r.json().catch(() => ({}));
    if (!d.ok) { ch.textContent = d.error || T('app.lock.unopened'); return; }
    key = d.key; sessionStorage.setItem(KEY_SS, key); idle = d.idle || idle;
    locked = false; lastSeen = Date.now(); ping = lastSeen; el.style.display = 'none';
    dispatchEvent(new Event('city-unlocked')); // panel.js: load again what received 401 during the lock (/api/today)
    const c = pending; pending = [];
    if (c.length) c.forEach((f) => f()); // app start continues
    else dispatchEvent(new Event('city-alerts')); // during a run: a new event connection (api.js), followed by sync()
  } catch (e) { ch.textContent = T('app.lock.serverNotResponding') + ': ' + e.message; }
  finally { b.disabled = false; b.textContent = T('app.lock.unlock'); }
}

export function lock(server = true) {
  if (locked) return;
  locked = true;
  if (server && key) povFetch('/api/lock/lock', { method: 'POST', headers: { 'x-city-key': key } }).catch(() => {});
  key = ''; sessionStorage.removeItem(KEY_SS);
  document.activeElement?.blur?.();
  screen(false);
}

// App start: waits until the card is unlocked (own key, or the test key in a header from Playwright → external, without idle tracking).
export async function waitForUnlock() {
  try {
    const d = await (await povFetch('/api/lock/state', key ? { headers: { 'x-city-key': key } } : undefined)).json();
    if (d.unlocked) { external = !key; return; }
  } catch { return; } // the server is not running (demo without a server): nothing to protect
  key = ''; sessionStorage.removeItem(KEY_SS); locked = true;
  screen(true);
  await new Promise((r) => pending.push(r));
}

// ---------- inactivity ----------
const motion = () => { lastSeen = Date.now(); };
for (const t of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(t, motion, { capture: true, passive: true });
addEventListener('keydown', (e) => { // during the lock no app shortcuts, Enter unlocks
  if (!locked) return;
  e.stopPropagation(); if (e.key === 'Enter' && !el.querySelector('#lockUnlock').disabled) { e.preventDefault(); unlock(); }
}, { capture: true });
function check() {
  if (locked || external || !key) return;
  const t = Date.now();
  if (t - lastSeen > idle) return lock();
  if (lastSeen > ping && t - ping > 60e3) { ping = t; fetch('/api/lock/activity', { method: 'POST' }).catch(() => {}); }
}
setInterval(check, 10e3);
document.addEventListener('visibilitychange', check); // immediately after the Mac wakes
document.getElementById('lockBtn')?.addEventListener('click', () => lock());
