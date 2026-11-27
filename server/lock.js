// lock.js – the city lock (2026-11-12). Every app tab has its own key (sessionStorage), without it the server
// answers 401 on /api/*. The key is issued only by unlocking via Touch ID (or the Mac password) with the helper lock/unlock.swift,
// which is compiled to data/unlock on first use. The key expires after 8 min without activity (the tab sends /api/lock/activity),
// so the lock holds even if someone bypassed the screen in the browser. Keys (sha256 only) survive a server restart in data/lock.json,
// a new tab has no key, so it is locked.
// Tests (npm run check, Playwright): test key in data/test-key (0600), valid only for GET (read only).
import { execFile, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IS_MAC } from './platform.js';
import { t } from './i18n.js';

// Outside macOS (no Touch ID) the lock is off: the server is protected only by listening on 127.0.0.1.
export const LOCK_DISABLED = !IS_MAC;

export const IDLE_MS = 8 * 60e3;
const RESERVE_MS = 45e3; // a tab's last activity arrives at the latest ~1 min before locking, the server allows a small margin
let ROOT = '', KEY_SELFTEST = '';
const keys = new Map(); // sha256(key) → last activity (ms)
let FILE = '', change = false;
const hash = (k) => crypto.createHash('sha256').update(k).digest('hex');
const streams = new Map(); // SSE response → key (closed on expiry)
let inProgress = null; // one Touch ID window at a time

export function initLock(root, { selftest = false } = {}) {
  ROOT = root;
  if (LOCK_DISABLED) { console.warn(t('server.lock.disabled')); return; }
  if (selftest) return;
  KEY_SELFTEST = crypto.randomBytes(24).toString('hex');
  const f = path.join(ROOT, 'data', 'test-key');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, KEY_SELFTEST + '\n', { mode: 0o600 });
  FILE = path.join(ROOT, 'data', 'lock.json');
  try { for (const [h, time] of Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8')))) keys.set(h, time); } catch {}
  tidyKeys();
  setInterval(tidyKeys, 15e3).unref();
}

function tidyKeys() {
  const t = Date.now();
  for (const [h, time] of keys) if (t - time > IDLE_MS + RESERVE_MS) { keys.delete(h); change = true; }
  for (const [res, h] of streams) if (!keys.has(h)) { streams.delete(res); try { res.end(); } catch {} }
  if (change && FILE) { change = false; try { fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(keys)), { mode: 0o600 }); } catch {} }
}

const keyFromRequest = (req, url) => String(req.headers['x-city-key'] || url.searchParams.get('key') || '');

// true = the request may proceed (valid tab key, or the test key for GET)
export function verifyKey(req, url) {
  if (LOCK_DISABLED) return true;
  const k = keyFromRequest(req, url);
  if (!k) return false;
  if (KEY_SELFTEST && k === KEY_SELFTEST) return req.method === 'GET' || req.method === 'HEAD';
  const h = hash(k), time = keys.get(h);
  if (time == null || Date.now() - time > IDLE_MS + RESERVE_MS) { if (keys.delete(h)) change = true; return false; }
  return true;
}

export const watchStream = (req, url, res) => { if (LOCK_DISABLED) return; const k = keyFromRequest(req, url); if (k !== KEY_SELFTEST) { streams.set(res, hash(k)); req.on('close', () => streams.delete(res)); } };

let lastCard = 0; // time of the last activity of an open app tab on the Mac (push to the phone is sent only after a longer silence)
export const lastCardActivity = () => lastCard;
export function activity(req, url) { const h = hash(keyFromRequest(req, url)); if (keys.has(h)) { keys.set(h, Date.now()); change = true; lastCard = Date.now(); } }

export function lock(req, url) { if (keys.delete(hash(keyFromRequest(req, url)))) change = true; tidyKeys(); }

function helper() {
  const bin = path.join(ROOT, 'data', 'unlock'), src = path.join(ROOT, 'lock', 'unlock.swift');
  if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs) {
    const r = spawnSync('swiftc', ['-O', src, '-o', bin], { encoding: 'utf8', timeout: 180e3 });
    if (r.status !== 0) throw new Error(t('server.lock.translation', { error: (r.stderr || r.error?.message || '').trim().split('\n')[0] }));
  }
  return bin;
}

// Touch ID / Mac password → new tab key
export function unlock() {
  if (LOCK_DISABLED) return Promise.resolve({ ok: true, key: '', idle: IDLE_MS, disabled: true });
  if (inProgress) return inProgress;
  inProgress = new Promise((resolve) => {
    let bin;
    try { bin = helper(); } catch (e) { return resolve({ ok: false, error: e.message }); }
    execFile(bin, [t('server.lock.reason')], { timeout: 90e3 }, (err, _out, errOut) => {
      if (err) return resolve({ ok: false, error: err.code === 2 ? t('server.lock.unavailable', { error: String(errOut).trim() }) : t('server.lock.unverified', { detail: (errOut ? ': ' + String(errOut).trim() : '') }) });
      const k = crypto.randomBytes(24).toString('hex');
      keys.set(hash(k), Date.now()); change = true; tidyKeys();
      resolve({ ok: true, key: k, idle: IDLE_MS });
    });
  }).finally(() => { inProgress = null; });
  return inProgress;
}
