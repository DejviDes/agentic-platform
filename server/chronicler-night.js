// chronicler-night.js – nightly Chronicler (2026-11-25): once a day (23:30) goes through what was decided and done in that day's conversations
// and tidies up the projects' notes. The server prepares the material WITHOUT Claude (floors with conversations that day, their notes target,
// today's commits, an excerpt of turns up to ~60,000 characters, Scribe records), then one Sonnet run (effort medium) on the virtual floor
// `controlCenter/chronicler` (virtual-floors.js). Clear things it fixes itself, unclear ones it sends as a question via the confirm_question tool (agents.js
// → addQuestion). Questions are in data/chronicler-questions.json, the app shows them in the Brain (GET /api/brain → questions), the answer goes through
// a POST to the answer endpoint in the Brain (only a click in the app, not from mobile). After a while (DELAY) the server sends the answers to the Chronicler in one short run.
// The Chronicler may write only to the floors' notes targets from the latest material and to files of answered questions (canWrite,
// writeOnly floors), never personal parts of the brain, the journal or finances. Scheduler: data/chronicler-plan.json (on by default), modeled on postman.js.
// Beware of the circular import with agents.js: values from agents.js are used only inside functions.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { error, day, p2 } from './agent-runs.js';
import { newScheduler } from './scheduler.js';
import { noteTarget, writeTarget, turnsWindow } from './agents.js';
import { unresolvedCards, inTarget, recordsFrom } from './scribe.js';
import { t } from './i18n.js';

export const FLOOR = 'control-center/chronicler', TASK = 'chronicler-night';
export const MODEL = 'claude-sonnet-5-5';
export const MAX_MATERIALS = 60000, MAX_PENDING = 12, MAX_QUESTIONS = 200, DELAY = 45e3;
const TASKS = { [TASK]: { n: 'Kronikár', h: 23, m: 30, window: 10 * 3600e3 } }; // the Mac was asleep at night: catch up in the morning until 9:30
const HOME = os.homedir();
const nfc = (s) => String(s || '').normalize('NFC');
const tilde = (p) => (p && p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p);
const row = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const block = (s, n) => { s = String(s ?? '').trim().replace(/\n{3,}/g, '\n\n'); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

let DATA = null, emit = () => {}, findFloor = null, sendMessage = null;
let targets = []; // [{ pid, n, P, c }] from the latest material: where the Chronicler may write
let materials = null;
let Q = { questions: [] };

// ---------------------------------------------------------------- where it may write

const BAN_WRITE = /(?:^|\/)(?:Osobne|\.obsidian|\.git|_system|\.claude)(?:\/|$)|financ|dennik|denník|(?:^|\/)Dnes\.md$|(?:^|\/)CLAUDE(?:\.local)?\.md$/i;
function inTargetWrite(abs, x) {
  if (!inTarget(abs, x.c)) return false;
  if (['dir', 'brain', 'folder'].includes(x.c.kind)) { // further writeTarget guards: forbidden parts of the Brain, closed projects
    const cz = writeTarget(x.P, 'notes', path.relative(x.c.folder, abs));
    return !cz.error && nfc(cz.abs) === abs;
  }
  return true;
}
const banned = (abs) => !/\.md$/i.test(abs) || BAN_WRITE.test(abs) || abs.split('/').includes('..');
// writeOnly floors centrala/kronikar (hook in Write/Edit): target from the material or the file of an answered question (2 days)
export function canWrite(a) {
  const abs = nfc(a);
  if (banned(abs)) return false;
  if (targets.some((x) => inTargetWrite(abs, x))) return true;
  const hr = Date.now() - 2 * 864e5;
  return Q.questions.some((q) => q.status === 'answered' && q.file === abs && (q.answered || 0) > hr);
}
// directories outside the brain where notes live (additionalDirectories of the run)
export const chroniclerPaths = (brain) => [...new Set(targets.map((x) => x.c.folder || (x.c.file && path.dirname(x.c.file))).filter((d) => d && !nfc(d).startsWith(nfc(brain) + '/') && fs.existsSync(d)))];

// ---------------------------------------------------------------- material

function commitsWindow(repoPath, from, po) {
  try {
    const out = execFileSync('git', ['-C', repoPath, 'log', `--since=${new Date(from).toISOString()}`, `--until=${new Date(po).toISOString()}`, '--pretty=%h %s', '-n', '25', '--', '.'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean).map((r) => row(r, 160));
  } catch { return []; } // not a repository
}

// date YYYY-MM-DD → { date, from, po, floors: [{ id, n, P, c, conv, commits, scribe }], unresolved }
export function collectMaterials(date, z = {}) {
  const from = new Date(`${date}T00:00:00`).getTime(), po = from + 864e5;
  const turns = (z.turnsWindow || turnsWindow)(from, po), find = z.findFloor || findFloor, target = z.noteTarget || noteTarget;
  const by = new Map();
  for (const x of turns) {
    if (x.floor === FLOOR) continue;
    const P = find?.(x.floor); if (!P || P.virtual) continue;
    const c = target(P); if (!c || c.kind === 'none') continue;
    if (!by.has(P.id)) by.set(P.id, { id: P.id, n: P.n, P, c, conv: [] });
    by.get(P.id).conv.push(x);
  }
  const isOn = (z.recordsFrom || recordsFrom)(from).filter((r) => r.when < po && r.result !== 'skipped');
  const floors = [...by.values()].map((p) => ({ ...p, commits: (z.commits || commitsWindow)(p.P.path, from, po), scribe: isOn.filter((r) => r.floor === p.id) }));
  const unresolved = (z.unresolved || unresolvedCards)().filter((x) => by.has(x.floor));
  return { date, from, po, floors, unresolved };
}

const isOnText = () => ({ proposed: t('prompt.chronicler.isOn.proposed'), accepted: t('prompt.chronicler.isOn.accepted'), rejected: t('prompt.chronicler.isOn.rejected'), skipWrite: t('prompt.chronicler.isOn.skipWrite'), error: t('prompt.chronicler.isOn.error'), cancelled: t('prompt.chronicler.isOn.cancelled') }); // function: the language is set only after world.json is loaded
// material → text for the Chronicler, at most `max` characters (turns get trimmed, the last floors may drop out)
export function materialText(d, max = MAX_MATERIALS) {
  const time = (t) => { const x = new Date(t); return `${p2(x.getHours())}:${p2(x.getMinutes())}`; };
  let out = t('prompt.chronicler.materials', { date: d.date, n: d.floors.length });
  let omitted = 0;
  for (const p of d.floors) {
    const c = p.c, dest = c.file ? tilde(c.file) + (c.kind === 'dir' ? t('prompt.chronicler.default', { folder: tilde(c.folder) }) : '') : t('prompt.chronicler.fileBy', { folder: tilde(c.folder) });
    let h = t('prompt.chronicler.floor', { n: p.n, id: p.id, dest, missing: c.file && !c.exists ? t('prompt.chronicler.missing') : '' });
    h += p.commits.length ? t('prompt.chronicler.commits', { commits: p.commits.map((x) => `- ${x}`).join('\n') }) : t('prompt.chronicler.withoutCommits');
    const isOn = [...p.scribe.filter((r) => r.result !== 'proposed' || d.unresolved.some((x) => x.id === r.card)), ...[]];
    if (isOn.length) h += t('prompt.chronicler.scribe', { writes: isOn.map((r) => `- ${isOnText()[r.result] || r.result}${r.text ? `: ${row(r.text, 300)}` : r.reason ? ` (${row(r.reason, 120)})` : ''}`).join('\n') });
    h += t('prompt.chronicler.conversations');
    for (const k of p.conv) {
      h += t('prompt.chronicler.conv', { title: row(k.title || t('prompt.chronicler.conversationTitle'), 80), conv: k.conv, agent: k.agent && k.agent !== 'lead' ? t('prompt.chronicler.agent', { agent: k.agent }) : '' });
      for (const th of k.turns) h += t('prompt.chronicler.turn', { time: time(th.when), user: block(th.user, 700), assistant: block(th.assistant, 1100).replace(/\n/g, '\n  ') });
    }
    if (out.length + h.length > max) { // trim this block, only list the remaining floors
      const rest = max - out.length - 200;
      if (rest > 1500) out += h.slice(0, rest) + t('prompt.chronicler.trimmed'); else omitted++;
      if (rest <= 1500 || out.length > max - 400) { omitted += d.floors.length - d.floors.indexOf(p) - 1; break; }
      continue;
    }
    out += h;
  }
  if (omitted) out += t('prompt.chronicler.omitted', { n: omitted });
  return out;
}

export function setTargets(d) { // also for tests (node -e)
  targets = d.floors.map((p) => ({ pid: p.id, n: p.n, P: p.P, c: p.c }));
}
async function prepare(date) {
  materials = collectMaterials(date); setTargets(materials);
  return materials;
}

// ---------------------------------------------------------------- scheduler

const INTRO = (u, { how, date, t: time0, finishing }) => t('prompt.chronicler.intro', { n: TASKS[u].n, u, how: how === 'plan' ? t('prompt.chronicler.poPlane') : t('prompt.chronicler.manual'), finishing: finishing ? t('prompt.chronicler.finishing') : '', date, hour: p2(time0.getHours()), min: p2(time0.getMinutes()) });

const scheduler = newScheduler({
  TASKS, floor: FLOOR, file: 'chronicler-plan.json', kind: 'chronicler',
  skill: () => { throw new Error('Kronikár nemá SKILL.md, podklady pripraví chronicler-night.js'); },
  text: () => materialText(materials || { date: '?', floors: [], unresolved: [] }),
  gate: async (u, { t: tt }) => {
    const d = await prepare(day(scheduler.dueSlot(u, tt)));
    if (!d.floors.length) return { startNow: false, reason: t('server.chronicler.noneActivity') };
    return { startNow: true, reason: t('server.chronicler.floorCount', { n: d.floors.length }) };
  },
  message: (u, reply) => row(reply, 600),
  model: MODEL, effort: 'medium', intro: INTRO,
  afterRun: () => { materials = null; notify(); },
});

export async function start(u = TASK) {
  if (!TASKS[u]) throw error(t('server.chronicler.unknownTask'), 404);
  const d = await prepare(day(new Date()));
  if (!d.floors.length) throw error(t('server.chronicler.noneOnDoing'), 409);
  return scheduler.start(u, 'manual');
}
export const toggle = (u, enabled) => { scheduler.toggle(u || TASK, enabled === true); return chroniclerState(); };
export function chroniclerSchedule(t = new Date()) { return scheduler.schedule(t); } // function declaration (circular imports via tower.js)
export function chroniclerState(t = new Date()) {
  const x = scheduler.status(t)[0];
  return { task: x.task, enabled: x.enabled, running: x.running, conv: x.conv, time: x.time, next: x.next, last: x.last ? { when: x.last.when, ok: x.last.ok, skipped: x.last.skipped, message: x.last.message, conv: x.last.conv } : null };
}

// ---------------------------------------------------------------- questions to confirm (user)

const fileQuestions = () => DATA && path.join(DATA, 'chronicler-questions.json');
function saveQuestions() { if (DATA) try { fs.writeFileSync(fileQuestions(), JSON.stringify(Q, null, 1)); } catch (e) { console.warn('kronikar (otázky):', e.message); } }
function notify() { try { emit({ kind: 'brain', type: 'questions' }); } catch {} }

// confirm_question tool (agents.js): v = { question, options, context, file } → { id } or { error } (the model gets the error)
export function addQuestion(v = {}, { conv = null } = {}) {
  const question = row(v.question, 300), context = row(v.context, 300);
  const options = (Array.isArray(v.options) ? v.options : []).map((x) => row(x, 120)).filter(Boolean).slice(0, 4);
  if (!question) return { error: t('prompt.chronicler.errorQuestion') };
  const abs = nfc(path.resolve(String(v.file || '').trim().replace(/^~(?=\/|$)/, HOME) || '/'));
  const x = !banned(abs) && targets.find((c) => inTargetWrite(abs, c));
  if (!x) return { error: t('prompt.chronicler.fileNo', { file: tilde(abs) }) };
  const pendingQs = Q.questions.filter((q) => q.status === 'pending');
  if (pendingQs.length >= MAX_PENDING) return { error: t('prompt.chronicler.pendingMax', { n: pendingQs.length }) };
  if (pendingQs.some((q) => q.question === question)) return { error: t('prompt.chronicler.same') };
  const q = { id: 'q' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), when: Date.now(), question, options, context, file: abs, floor: x.pid, floorN: x.n, status: 'pending', reply: null, conv };
  Q.questions = [q, ...Q.questions].slice(0, MAX_QUESTIONS);
  saveQuestions(); notify();
  return { id: q.id };
}

// pending questions for GET /api/brain (oldest first)
export function pendingQuestions() {
  return Q.questions.filter((q) => q.status === 'pending').sort((a, b) => a.when - b.when)
    .map((q) => ({ id: q.id, when: q.when, question: q.question, options: q.options, context: q.context, file: tilde(q.file), floor: q.floor, floorN: q.floorN }));
}

// POST answer from the Brain: d = { id, choice (option index) | text, skip }
export function replyToQuestion(d = {}) {
  const q = Q.questions.find((x) => x.id === d.id);
  if (!q) throw error(t('server.chronicler.questionMissing'), 404);
  if (q.status !== 'pending') throw error(t('server.chronicler.questionResolved'), 409);
  if (d.skip === true) { q.status = 'cancelled'; q.answered = Date.now(); }
  else {
    const ans = row(Number.isInteger(d.choice) ? q.options[d.choice] : d.text, 1000);
    if (!ans) throw error(t('server.chronicler.errorReply'));
    Object.assign(q, { status: 'answered', reply: ans, answered: Date.now(), sent: false, attempts: 0 });
    scheduleSend();
  }
  saveQuestions(); notify();
  return { ok: true, questions: pendingQuestions() };
}

// answered questions go to the Chronicler together in one short run (DELAY after the last answer, not during the nightly run)
let sendingT = null, sending = false;
function scheduleSend(ms = DELAY) { clearTimeout(sendingT); sendingT = setTimeout(() => submit().catch((e) => console.warn('kronikar (odpovede):', e.message)), ms); sendingT.unref?.(); }
export function replyText(questions, today = day(new Date())) {
  return t('prompt.chronicler.answers', { today, today })
    + questions.map((q, i) => t('prompt.chronicler.questionRow', { n: i + 1, question: q.question, context: q.context || '-', reply: q.reply, file: tilde(q.file) })).join('\n\n');
}
async function submit() {
  const pending = Q.questions.filter((q) => q.status === 'answered' && !q.sent && (q.attempts || 0) < 3);
  if (!pending.length) return;
  if (sending || scheduler.running(TASK) || !sendMessage) return scheduleSend(60e3);
  sending = true;
  for (const q of pending) { q.sent = true; q.attempts = (q.attempts || 0) + 1; }
  saveQuestions();
  try {
    const k = await sendMessage({ floor: FLOOR, agent: 'lead', text: replyText(pending), mode: 'auto', model: MODEL, effort: 'low', title: t('server.chronicler.title', { day: day(new Date()) }),
      afterEnd: ({ status }) => {
        sending = false;
        for (const q of pending) q.written = status === 'done' || status === 'reply';
        saveQuestions(); notify();
        if (Q.questions.some((q) => q.status === 'answered' && !q.sent)) scheduleSend(5e3);
      } });
    for (const q of pending) q.convReplies = k.id;
    saveQuestions();
  } catch (e) {
    sending = false;
    for (const q of pending) q.sent = false;
    saveQuestions(); scheduleSend(120e3);
    throw e;
  }
}

// ---------------------------------------------------------------- start (server.js, not in --selftest)

export function setChronicler(o) {
  DATA = o.data; emit = o.emit || emit; findFloor = o.findFloor || null; sendMessage = o.sendMessage || null;
  try { Q = { questions: [], ...JSON.parse(fs.readFileSync(fileQuestions(), 'utf8')) }; } catch {}
  const hr = Date.now() - 14 * 864e5;
  for (const q of Q.questions) if (q.status === 'pending' && q.when < hr) { q.status = 'cancelled'; q.expired = true; } // unanswered for 14 days
  saveQuestions();
  const fresh = !fs.existsSync(path.join(DATA, 'chronicler-plan.json'));
  scheduler.set(o);
  if (fresh) scheduler.toggle(TASK, true); // on by default (a missed run is not caught up)
  if (Q.questions.some((q) => q.status === 'answered' && !q.sent)) scheduleSend(90e3); // answers from before the restart
}
