// usage-sessions.js – breakdown of the 5-hour and weekly limit by session (2026-11-19).
//
// Source: transcripts of all Claude Code sessions in ~/.claude/projects (the city via Agent SDK = entrypoint sdk-ts,
// Claude app = claude-desktop, terminal = cli) including team members in <sid>/subagents/*.jsonl (added to the parent).
// Every model call (an assistant line with usage, one requestId = one call) is weighted as in usage.js (units).
// Files are read incrementally (byte offset), the first load of a week may take a few seconds.
//
// Percentages: the actual % from /usage split by share of units (5 h and week). Usage without a transcript on the Mac
// (claude.ai chat, mobile, cloud) is thereby spread across sessions, the window says so in a note.
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';
import os from 'node:os';
import { units, setWindowRatio } from './usage.js';

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const H5 = 5 * 3600e3, WEEK = 7 * 24 * 3600e3;
const FILES = new Map(); // path → { floor, sid, calls: Map(requestId → { t, j, m }), title, assistant, enter, cwd }
let running = null;
const IN_WINDOW = new Map(); // sid → % of 5 h in the current window (last h5 breakdown), for the chat (agents.js summary)
export const usageInWindow = (sid) => IN_WINDOW.get(sid) ?? null;

async function loadFile(filePath, sid, from) {
  let st; try { st = await fs.promises.stat(filePath); } catch { FILES.delete(filePath); return; }
  let s = FILES.get(filePath);
  if (!s || st.size < s.floor) { s = { floor: 0, sid, calls: new Map(), title: '', assistant: '', enter: '', cwd: '' }; FILES.set(filePath, s); }
  if (st.size === s.floor) return;
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const PIECE = 4 << 20; let rest = '';
    while (s.floor < st.size) {
      const buf = Buffer.alloc(Math.min(PIECE, st.size - s.floor));
      const { bytesRead } = await fh.read(buf, 0, buf.length, s.floor); if (!bytesRead) break;
      const text = rest + buf.toString('utf8', 0, bytesRead), last = text.lastIndexOf('\n');
      s.floor += bytesRead;
      if (last < 0) { rest = text; continue; }
      rest = text.slice(last + 1);
      for (const r of text.slice(0, last).split('\n')) processRow(s, r, from);
    }
    s.floor -= Buffer.byteLength(rest); // an unfinished line is read next time
  } finally { await fh.close(); }
}

function processRow(s, r, from) {
  if (r.includes('"custom-title"')) { try { s.title = JSON.parse(r).customTitle || s.title; } catch {} return; }
  if (r.includes('"ai-title"')) { try { s.assistant = JSON.parse(r).aiTitle || s.assistant; } catch {} return; }
  if (!r.includes('"type":"assistant"') || !r.includes('"usage"')) return;
  let d; try { d = JSON.parse(r); } catch { return; }
  const u = d.message?.usage, t = Date.parse(d.timestamp); if (!u || !(t >= from)) return;
  if (!s.enter) { s.enter = d.entrypoint || ''; s.cwd = d.cwd || ''; }
  const m = d.message.model || d.requestedModel || '';
  if (m === '<synthetic>') return;
  s.calls.set(d.requestId || d.message.id || d.uuid, { t, j: units(u, m), m });
}

// all transcripts changed since `from`: <project>/<sid>.jsonl and <project>/<sid>/subagents/*.jsonl
async function walk(from) {
  const list = [];
  let projects = []; try { projects = await fs.promises.readdir(ROOT, { withFileTypes: true }); } catch { return; }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = path.join(ROOT, p.name);
    let items = []; try { items = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const x of items) {
      if (x.isFile() && x.name.endsWith('.jsonl')) list.push([path.join(dir, x.name), x.name.slice(0, -6)]);
      else if (x.isDirectory()) {
        const sub = path.join(dir, x.name, 'subagents');
        let f = []; try { f = await fs.promises.readdir(sub); } catch { continue; }
        for (const n of f) if (n.endsWith('.jsonl')) list.push([path.join(sub, n), x.name]);
      }
    }
  }
  for (const [filePath, sid] of list) {
    if (!FILES.has(filePath)) { try { if ((await fs.promises.stat(filePath)).mtimeMs < from) continue; } catch { continue; } }
    await loadFile(filePath, sid, from);
  }
  // drop old calls and files (only a week is kept)
  for (const [c, s] of FILES) { for (const [k, v] of s.calls) if (v.t < from) s.calls.delete(k); if (!s.calls.size && s.floor > 0) { try { if (fs.statSync(c).mtimeMs < from) FILES.delete(c); } catch { FILES.delete(c); } } }
}

const sourceNames = () => ({ 'sdk-ts': t('server.usage.sourceCity'), 'sdk-cli': t('server.usage.sourceCity'), 'claude-desktop': t('server.usage.sourceApp'), cli: t('server.usage.sourceTerminal') }); // function: the language is set only after world.json is loaded
const familyModel = (m) => (/haiku/i.test(m) ? 'Haiku' : /sonnet/i.test(m) ? 'Sonnet' : /fable|mythos/i.test(m) ? 'Fable' : /opus/i.test(m) ? 'Opus' : '');

// window: 'h5' | 'week'; limits = limits from extras.js; conversations = allSummaries(); floors = [{ id, n, path }]
export async function usageBreakdown(window, { limits, conversations = [], floors = [] }) {
  const L = window === 'week' ? limits?.week : limits?.h5, length = window === 'week' ? WEEK : H5;
  if (!L?.reset) return { window, error: t('server.usage.limitsNotLoaded') };
  const from = L.reset - length, weekFrom = (limits?.week?.reset ? limits.week.reset - WEEK : Date.now() - WEEK);
  const start = Math.min(from, weekFrom); // always read the whole week, so switching to the week view is instant
  if (!running) running = walk(start).finally(() => { running = null; });
  await running;

  const poSid = new Map(); // sid → { j, last, models, cwd, enter, title }
  for (const s of FILES.values()) {
    let j = 0, last = 0; const mod = {};
    for (const v of s.calls.values()) if (v.t >= from) { j += v.j; last = Math.max(last, v.t); const r = familyModel(v.m); if (r) mod[r] = (mod[r] || 0) + v.j; }
    if (!j) continue;
    const x = poSid.get(s.sid) || { j: 0, last: 0, models: {}, cwd: '', enter: '', title: '' };
    x.j += j; x.last = Math.max(x.last, last);
    for (const [r, v] of Object.entries(mod)) x.models[r] = (x.models[r] || 0) + v;
    if (!x.cwd && s.cwd) x.cwd = s.cwd; if (!x.enter && s.enter) x.enter = s.enter;
    if (s.title || s.assistant) x.title = s.title || x.title || s.assistant;
    poSid.set(s.sid, x);
  }
  const zoSid = new Map(conversations.filter((k) => k.sid).map((k) => [k.sid, k]));
  const floor = floors.filter((p) => p.path).sort((a, b) => b.path.length - a.path.length);
  const home = os.homedir();
  const rows = [...poSid.entries()].map(([sid, x]) => {
    const k = zoSid.get(sid), P = floor.find((p) => x.cwd === p.path || x.cwd.startsWith(p.path + '/'));
    const source = sourceNames()[x.enter] || (x.enter ? x.enter : t('server.usage.sourceOther'));
    return {
      sid, j: x.j, last: x.last, source: k ? t('server.usage.sourceCity') : source,
      title: (k?.title || x.title || t('server.usage.withoutTitle')).replace(/\s+/g, ' ').slice(0, 90),
      where: P?.n || (x.cwd ? x.cwd.replace(home, '~') : ''), conv: k?.id || null, floor: k?.floor || P?.id || null,
      models: Object.entries(x.models).sort((a, b) => b[1] - a[1]).map(([r, v]) => ({ m: r, share: Math.round((v / x.j) * 100) })),
    };
  }).sort((a, b) => b.j - a.j);

  const sum = rows.reduce((a, r) => a + r.j, 0), p = L.p ?? 0;
  // 2026-11-19: the 5 h window too = share of tokens from the actual % (the calibration from usage.js is deliberately cautious and left
  // a „rest“ of around 14 % although the user did everything in the city and Claude Code; transcripts cover almost all usage)
  const outside = 0, method = 'share';
  for (const r of rows) r.p = sum ? (r.j / sum) * p : 0;
  if (window === 'h5') { setWindowRatio(sum, p, L.reset); IN_WINDOW.clear(); for (const r of rows) IN_WINDOW.set(r.sid, r.p); }
  const afterSources = {};
  for (const r of rows) afterSources[r.source] = (afterSources[r.source] || 0) + r.p;
  return {
    window, from, reset: L.reset, p, method, outside: Math.round(outside * 10) / 10,
    sources: Object.entries(afterSources).sort((a, b) => b[1] - a[1]).map(([z, v]) => ({ source: z, p: Math.round(v * 10) / 10 })),
    sessions: rows.map(({ j, ...r }) => ({ ...r, p: Math.round(r.p * 10) / 10, share: sum ? Math.round((j / sum) * 1000) / 10 : 0 })),
  };
}
