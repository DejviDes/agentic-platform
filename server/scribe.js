// scribe.js – Scribe after a turn (2026-11-25): decisions and status from conversations should get into the project notes without reminders.
// After the lead's turn ends on a floor with notes (not virtual floors, not delegated threads, not scheduled runs) agents.js
// collects a turn excerpt (turnData) and calls processTurn(). A cheap heuristic without a model (judge) skips a turn in which the agent wrote
// to the notes or proposed a memory card, and a trivial turn (no commit, no write and no decision in the user's text). Otherwise one
// Haiku call without tools (like router.js) decides whether and what to write. With `write` a memory card is added to the conversation
// (target notes, source 'scribe'), which the user resolves with Add / No via decideCard in agents.js.
// Guards: at most 1 card per turn, a daily cap on Haiku calls (MAX_CALLS), a Haiku error is only logged (never crashes the run).
// Every decision (skipped with a reason, proposed, accepted, rejected, error) is a line in data/scribe.jsonl (30 days), the Chronicler reads it.
// State in data/scribe.json: { enabled, day, calls, cards: { cardId: { conv, i, floor, targetAbs, when } } } – cards survive a server restart.
// Beware of the circular import with agents.js: values from agents.js are not used at top level (only inside functions).
import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_BIN, MODELS, cleanEnv } from './agents.js';
import { t } from './i18n.js';

export const MAX_CALLS = 40, MAX_EXTRACT = 6000, DAYS_LOG = 30;
const TIMEOUT = 25000;
const nfc = (s) => String(s || '').normalize('NFC');
const tail = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const tilde = (p) => (p && p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p);
const dayKey = (t = new Date()) => t.toLocaleDateString('sv-SE');
const modelHaiku = () => (MODELS.filter((m) => /haiku/.test(m.id)).at(-1) || {}).id || 'haiku';

// ---------------------------------------------------------------- pure functions (test: tests/scribe.test.mjs, node -e)

// a decision in the user's text; Slovak word forms, word boundary via \p{L} with the u flag (not \b, which does not work with diacritics)
export const DECISION = /(?<![\p{L}])(?:rozhod|dohod|odteraz|odte[ďd]|v[žz]dy|nikdy|nechcem|chcem,? aby|chcem,? nech|zru[šs](?![\p{L}])|zru[šs]me|zru[šs]i[ťt]|nema[žz]|ponechaj|nechaj to|zme[ňn](?![\p{L}])|zme[ňn]me|plat[íi](?![\p{L}])|bude platiť|pravidlo|namiesto|radšej|preferujem|schva[ľl]ujem|schválené|súhlasím|ideme na|ostávame pri|(?:ne)?používaj(?![\p{L}])|zakáž(?![\p{L}])|povoľ(?![\p{L}])|odlož|todo(?![\p{L}])|decid|decision|agreed|from now on|always|never|i don'?t want|i want (?:you|it) to|cancel|instead of|i prefer|prefer(?![\p{L}])|approved?(?![\p{L}])|i agree|let'?s go with|stick with|don'?t use|always use|forbid|postpone|rule:)/iu; // sk and en (the city's language)
export const isDecision = (t) => DECISION.test(String(t || ''));

// commit from a Bash step (step: { n, d: command · description (trimmed), result: first 300 chars without line breaks }) → { hash, message } or null
const COMMIT_RESULT = /\[[\w./-]+(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.*?)(?: \d+ files? changed|$)/;
export function commitFromStep(x) {
  if (!x || x.n !== 'Bash' || x.error) return null;
  const m = COMMIT_RESULT.exec(String(x.result || ''));
  if (m) return { hash: m[1].slice(0, 7), message: tail(m[2], 160) };
  return /\bgit\b[^|;&]*\bcommit\b/.test(String(x.d || '')) && !/--dry-run/.test(String(x.d || '')) ? { hash: null, message: '' } : null;
}

// is the file inside the floor's notes target? c = noteTarget(P): { kind, file?, folder? }. A project's README.md file = its whole folder (stav.md, technika.md…)
export function inTarget(f, c) {
  if (!f || !c || !/\.md$/i.test(f)) return false;
  const a = nfc(f);
  if (c.file && nfc(c.file) === a) return true;
  const dir = c.folder || (c.file && /^readme\.md$/i.test(path.basename(c.file)) ? path.dirname(c.file) : null);
  return !!dir && a.startsWith(nfc(dir).replace(/\/+$/, '') + '/');
}

// turn = { user: [user texts], assistant, writes: [abs], read: [abs], commits: [{ hash, message }], memory: bool }, c = noteTarget(P)
// → { skip: 'reason' } or { call: true, decision: bool }
export function judge(turn, c) {
  if (!c || c.kind === 'none') return { skip: t('server.scribe.withoutNotes') };
  if (turn.memory) return { skip: t('server.scribe.card') };
  if ((turn.writes || []).some((f) => inTarget(f, c))) return { skip: t('server.scribe.wrote') };
  const decision = (turn.user || []).some(isDecision);
  if (!(turn.commits || []).length && !(turn.writes || []).length && !decision) return { skip: t('server.scribe.trivial') };
  return { call: true, decision };
}

// candidates for the notes file: the target's fixed file, or (Brain, folder) the target's .md files the agent read during the turn
export function candidates(turn, c) {
  if (!c || c.kind === 'none') return [];
  if (['project', 'custom', 'fresh', 'folder'].includes(c.kind) && c.file) return [c.file];
  // folder with a default file (e.g. control center: the project folder in the brain, README.md): the default + those read in the turn
  return [...new Set([...(c.file ? [nfc(c.file)] : []), ...(turn.read || []).filter((f) => inTarget(f, c)).map(nfc)])].slice(0, 8);
}

// turn excerpt for Haiku, at most `max` characters
export function extractTurn(turn, { floor = '', title = '', target = '', headings = [], cand = [], base = '' } = {}, max = MAX_EXTRACT) {
  const rel = (f) => (base && nfc(f).startsWith(nfc(base) + '/') ? nfc(f).slice(nfc(base).length + 1) : tilde(f));
  const parts = [
    t('prompt.scribe.floor', { floor, title: title ? t('prompt.scribe.conversation', { title: tail(title, 80) }) : '' }),
    t('prompt.scribe.target', { target }),
    cand.length > 1 || (cand.length === 1 && base) ? t('prompt.scribe.candidates', { cand: cand.map(rel).join(', ') }) : '',
    headings.length ? t('prompt.scribe.headings', { headings: headings.slice(0, 40).join('\n') }) : '',
    (turn.commits || []).length ? t('prompt.scribe.commits', { commits: turn.commits.map((x) => (x.hash ? `${x.hash} ${x.message}` : t('prompt.scribe.hashUnknown'))).join('; ') }) : '',
    (turn.writes || []).length ? t('prompt.scribe.writes', { writes: turn.writes.slice(0, 15).map(tilde).join(', ') }) : '',
  ].filter(Boolean);
  let head = parts.join('\n\n');
  const user = (turn.user || []).map((x) => tail(x, 1500)).join('\n---\n');
  const assistant = tail(turn.assistant, 2500);
  let body = t('prompt.scribe.body', { user: user || t('prompt.scribe.none'), assistant: assistant || t('prompt.scribe.none') });
  if (head.length > max / 2) head = head.slice(0, max / 2);
  if (head.length + body.length > max) body = body.slice(0, max - head.length - 1) + '…';
  return head + body;
}

// Haiku reply → { write, file, text, reason } or null
export function parseReply(output) {
  const s = String(output || '').replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let j; try { j = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const text = String(j.text || '').replace(/\s+/g, ' ').trim().replace(/^[-*]\s*/, '').replace(/^\*{0,2}\d{4}-\d{2}-\d{2}:?\*{0,2}:?\s*/, '').slice(0, 600);
  return { write: j.write === true && !!text, file: String(j.file || '').trim(), text, reason: tail(j.reason, 200) };
}

// ---------------------------------------------------------------- state and log

let DATA = null, S = { enabled: true, day: null, calls: 0, cards: {} };
const fileStatus = () => DATA && path.join(DATA, 'scribe.json');
const fileLog = () => DATA && path.join(DATA, 'scribe.jsonl');
const save = () => { if (DATA) try { fs.writeFileSync(fileStatus(), JSON.stringify(S, null, 1)); } catch (e) { console.warn('zapisovac (stav):', e.message); } };

export function setScribe({ data } = {}) {
  DATA = data || null; if (!DATA) return;
  try { S = { ...S, ...JSON.parse(fs.readFileSync(fileStatus(), 'utf8')) }; } catch {}
  S.cards ||= {};
  for (const [id, x] of Object.entries(S.cards)) if (Date.now() - (x.when || 0) > 14 * 864e5) delete S.cards[id]; // old unresolved card
  save(); trimLog();
}
export const scribeState = () => ({ enabled: S.enabled !== false, todayCalls: S.day === dayKey() ? S.calls : 0, maxCalls: MAX_CALLS });
export function changeScribe(d = {}) { if (typeof d.enabled === 'boolean') { S.enabled = d.enabled; save(); } return scribeState(); }

export function record(r) {
  const f = fileLog(); if (!f) return;
  try { fs.appendFileSync(f, JSON.stringify({ when: Date.now(), ...r }) + '\n'); } catch (e) { console.warn('zapisovac (log):', e.message); }
}
export function recordsFrom(from = 0, f = fileLog()) {
  if (!f || !fs.existsSync(f)) return [];
  const out = [];
  for (const r of fs.readFileSync(f, 'utf8').split('\n')) { if (!r) continue; try { const x = JSON.parse(r); if (x.when >= from) out.push(x); } catch {} }
  return out;
}
function trimLog() {
  const f = fileLog(); if (!f || !fs.existsSync(f)) return;
  try { const hr = Date.now() - DAYS_LOG * 864e5, v = recordsFrom(0, f), z = v.filter((x) => x.when >= hr); if (z.length !== v.length) fs.writeFileSync(f, z.map((x) => JSON.stringify(x)).join('\n') + (z.length ? '\n' : '')); } catch {}
}

// the Scribe's unresolved cards (restored after a server restart in decideCard)
export const scribeCard = (id) => S.cards?.[id] || null;
export function resolveCard(id, yes, text = '') {
  const x = S.cards?.[id]; if (!x) return;
  delete S.cards[id]; save();
  record({ conv: x.conv, floor: x.floor, result: yes === null ? 'cancelled' : yes ? 'accepted' : 'rejected', text: tail(text || x.text, 600), file: tilde(x.targetAbs) }); // null = the card no longer exists (conversation deleted)
}
export function unresolvedCards() { return Object.entries(S.cards || {}).map(([id, x]) => ({ id, ...x })); }

// ---------------------------------------------------------------- Haiku

async function queryHaiku(system, prompt) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), TIMEOUT);
  let output = '', error = null;
  try {
    const q = query({
      prompt,
      options: {
        model: modelHaiku(), cwd: os.tmpdir(), pathToClaudeCodeExecutable: CLAUDE_BIN, env: cleanEnv(), abortController: ac,
        systemPrompt: system, tools: [], allowedTools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [],
        maxTurns: 1, permissionMode: 'default', persistSession: false, thinking: { type: 'disabled' },
        canUseTool: async () => ({ behavior: 'deny', message: t('prompt.scribe.withoutTools') }),
      },
    });
    for await (const u of q) if (u.type === 'result') { if (u.subtype === 'success') output = u.result || ''; else error = u.errors?.join(', ') || u.subtype; }
  } catch (e) { error = ac.signal.aborted ? t('server.scribe.timeout', { time: TIMEOUT / 1000 }) : e.message; }
  finally { clearTimeout(timer); }
  if (error) throw new Error(error);
  return output;
}

const SYSTEM = () => t('prompt.scribe.system');

const headingsFile = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter((r) => /^#{1,3}\s/.test(r)).slice(0, 40); } catch { return []; } };

// Main entry from agents.js after a turn ends. o = { P, target: noteTarget(P), title, addCard({ text, file, reason }) → { id, path } | { error } }.
// Never throws, returns the result for tests.
export async function processTurn(turn, o) {
  const who = { conv: turn.conv, floor: o.P?.id || turn.floor };
  try {
    if (S.enabled === false) return { result: 'disabled' };
    const p = judge(turn, o.target);
    if (p.skip) { record({ ...who, result: 'skipped', reason: p.skip }); return { result: 'skipped', reason: p.skip }; }
    const cand = candidates(turn, o.target);
    if (!cand.length) { record({ ...who, result: 'skipped', reason: t('server.scribe.noClearFile') }); return { result: 'skipped', reason: t('server.scribe.withoutFile') }; }
    const today = dayKey();
    if (S.day !== today) { S.day = today; S.calls = 0; }
    if (S.calls >= MAX_CALLS) { record({ ...who, result: 'skipped', reason: t('server.scribe.cap', { max: MAX_CALLS }) }); return { result: 'cap' }; }
    S.calls++; save();
    const base = o.target.folder || '';
    const prompt = extractTurn(turn, { floor: `${o.P?.n || ''} (${who.floor})`, title: o.title, target: tilde(o.target.file || o.target.folder || ''), headings: cand.length === 1 ? headingsFile(cand[0]) : [], cand, base });
    const r = parseReply(await (o.query || queryHaiku)(SYSTEM(), prompt));
    if (!r) { record({ ...who, result: 'error', reason: t('server.scribe.notReturnedJson') }); return { result: 'error' }; }
    if (!r.write) { record({ ...who, result: 'skipWrite', reason: r.reason }); return { result: 'skipWrite', reason: r.reason }; }
    let abs = cand[0];
    // without file = the first candidate (default file)
    if (r.file && (cand.length > 1 || base)) { const selected = cand.find((f) => f === nfc(path.resolve(base || '/', r.file)) || f.endsWith('/' + r.file)); if (!selected) { record({ ...who, result: 'error', reason: t('server.scribe.unknownFile', { file: tail(r.file, 80) }) }); return { result: 'error' }; } abs = selected; }
    const file = base ? path.relative(base, abs) : '';
    const k = o.addCard({ text: r.text, file, reason: r.reason });
    if (!k || k.error) { record({ ...who, result: 'error', reason: k?.error || t('server.scribe.cardNotCreated') }); return { result: 'error' }; }
    if (k.targetAbs) { S.cards[k.id] = { conv: turn.conv, i: k.i, floor: who.floor, targetAbs: k.targetAbs, text: r.text, when: Date.now() }; save(); }
    record({ ...who, result: 'proposed', text: r.text, file: tilde(abs), reason: r.reason, card: k.id });
    return { result: 'proposed', text: r.text, card: k.id };
  } catch (e) {
    console.warn('scribe:', e.message);
    record({ ...who, result: 'error', reason: tail(e.message, 200) });
    return { result: 'error', error: e.message };
  }
}
