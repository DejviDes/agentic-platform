// escalation.js – web push to the phone when a conversation has been waiting for the user (approval, question) longer than a limit (2026-11-28).
// Once a minute (cheap: reads the in-memory list of waiting conversations) it checks the waiting ones. After `limitMin` minutes (default 30) it sends a push
// (push.js, the City's own web push, free) every minute, at most 10 times, with one tag so the notifications on the phone replace each other. The list is read before
// every send, so the series ends right after the conversation stops waiting. During an event in the quiet calendar (QUIET_CALENDAR, e.g. school) only ONE quiet push is sent
// (no repeating) and nothing at all once the wait is an hour past the limit. At most one series per wait (conversation + start of waiting).
// Settings are in data/escalation.json: { enabled (default off), limitMin }. Do Not Disturb and silent mode are left to iOS.
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';

const TICK = 60e3, REPEAT_MS = 50e3, MAX_SEND = 10, LATE_MS = 60 * 60e3;
export let QUIET_CALENDAR = ''; // name of a calendar whose events mean "only one quiet push" (e.g. lectures); empty = none, setEscalation({ quietCalendar }) changes it
const DEFAULTS = { enabled: false, limitMin: 30 };

let FILE = null, S = { ...DEFAULTS }, timer = null;
let waiting = () => [], calendar = async () => ({ ok: false, events: [] }), baseUrl = () => '', push = async () => ({ sent: 0, failed: 0 }), clock = Date.now, log = (m) => console.warn('upozornenie:', m);
const sent = new Map(); // `${conv}|${from}` → { n, last, quiet }

const save = () => { if (FILE) { try { fs.writeFileSync(FILE, JSON.stringify(S, null, 1)); } catch (e) { log(e.message); } } };

// o: { data, waiting, calendar, baseUrl, push } in production; clock, log, interval (false = no timer) for tests
export function setEscalation(o = {}) {
  if (o.data) FILE = path.join(o.data, 'escalation.json');
  if (o.waiting) waiting = o.waiting;
  if (o.calendar) calendar = o.calendar;
  if (o.baseUrl) baseUrl = o.baseUrl;
  if (o.push) push = o.push;
  if (o.clock) clock = o.clock;
  if (o.log) log = o.log;
  if (typeof o.quietCalendar === 'string') QUIET_CALENDAR = o.quietCalendar;
  S = { ...DEFAULTS }; sent.clear();
  if (FILE) { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); S = { ...S, enabled: d.enabled === true, limitMin: d.limitMin >= 1 ? d.limitMin : S.limitMin }; } catch {} }
  clearInterval(timer);
  if (o.interval !== false) { timer = setInterval(() => { check().catch((e) => log(e.message)); }, o.interval || TICK); timer.unref?.(); }
}

export const escalationState = () => ({ enabled: !!S.enabled, limitMin: S.limitMin });
export function changeEscalation(d = {}) {
  if (typeof d.enabled === 'boolean') S.enabled = d.enabled;
  if (d.limitMin !== undefined) { const n = Math.round(Number(d.limitMin)); if (n >= 1 && n <= 24 * 60) S.limitMin = n; }
  save(); return escalationState();
}

// is an event of the quiet calendar running right now (all-day events do not count)
async function inSchool(nowMs) {
  if (!QUIET_CALENDAR) return false;
  try {
    const c = await calendar(new Date(nowMs - 864e5), new Date(nowMs + 864e5));
    return (c?.events || []).some((e) => e.calendar === QUIET_CALENDAR && !e.allDay && +e.start <= nowMs && nowMs < +e.end);
  } catch { return false; }
}

const what = (w) => t(w.kind === 'question' ? 'server.escalation.question' : 'server.escalation.approval') + ': ' + [w.floor, w.agent && w.agent !== 'lead' ? w.agent : ''].filter(Boolean).join(' / ') + (w.title ? ` – ${w.title}` : '');

// one pass; returns the number of pushes sent
export async function check() {
  const nowMs = clock(), list = S.enabled ? waiting() || [] : []; // switched off: nothing is sent
  const live = new Set(list.map((w) => `${w.id}|${w.from}`));
  for (const key of sent.keys()) if (!live.has(key)) sent.delete(key); // wait ended: the series ends, a new wait starts a new one
  let n = 0, school = null;
  for (const w of list) {
    const key = `${w.id}|${w.from}`, over = nowMs - w.from - S.limitMin * 60e3, st = sent.get(key);
    if (over < 0) continue;
    if (st && (st.quiet || st.n >= MAX_SEND || nowMs - st.last < REPEAT_MS)) continue;
    school ??= await inSchool(nowMs);
    if (school && (st || over > LATE_MS)) { sent.set(key, { n: MAX_SEND, last: nowMs, quiet: true }); continue; } // school: one quiet push only, none after an hour
    const base = baseUrl(), next = { n: (st?.n || 0) + 1, last: nowMs, quiet: school };
    sent.set(key, next); // before sending: no duplicate even if the push is slow
    try { await push({ title: t0(next.n), text: what(w), url: base ? `${base}/#k=${encodeURIComponent(w.id)}` : '/', quiet: school, tag: 'escalation-' + w.id }); n++; } catch (e) { log(e.message); }
  }
  return n;
}
const t0 = (i) => (i > 1 ? t('server.escalation.waitingN', { n: i }) : t('server.escalation.waiting'));

export async function sendTest() {
  const r = await push({ title: 'Agentic Platform', text: t('server.escalation.test'), url: '/', tag: 'escalation-test' });
  if (!r?.sent) { const e = new Error('No device received the push (is a phone paired?)'); e.code = 502; throw e; }
  return { ok: true, sent: r.sent };
}
