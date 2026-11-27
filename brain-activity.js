// brain-activity.js – two Brain (Second Brain) features: agent activity in the brain and orphaned notes.
// Activity: the PostToolUse hook (agents.js) calls record(); events go to data/brain-activity.jsonl (14 days) and via SSE to the app.
// Writes via Bash (scripts) are not captured. Paths in private folders (world.json `brain.private`) are stored, but the API returns them without a name.
// Orphaned: a note without an outgoing or incoming link (excluding `brain.omitOrphaned` folders and files in the root), cache 10 min.
// The brain root, private and omitted folders come from world.json `brain` via setBrain(); without a brain everything is empty.
// Reads the brain only, never writes to notes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const nfc = (s) => String(s).normalize('NFC');
export let BRAIN = null; // brain root (absolute), set by setBrain() from world.json `brain.path`
const DAYS = 14, WINDOW_DUPLICATES = 60e3, CACHE_ORPHANED = 10 * 60e3;
const OMIT_FOLDERS = new Set(['.git', '.obsidian', '.claude', '.trash']);
let OMIT_ORPHANED = ['_system']; // world.json `brain.omitOrphaned`
let PRIVATE = []; // world.json `brain.private`: top-level folders shown without names
const GENERATED = [/^Zdroje\/Fakty\//, /\.scenar\.md$/i];

// ---------- pure functions ----------
// file path in the brain → relative path (NFC) or null when it lies outside the brain or is not .md
export function relativeInBrain(file, root = BRAIN, cwd = root) {
  if (!file || typeof file !== 'string' || !root) return null;
  const k = nfc(root), a = nfc(path.resolve(cwd || k, file.replace(/^~(?=\/|$)/, os.homedir())));
  if (!a.startsWith(k + path.sep) || !a.toLowerCase().endsWith('.md')) return null;
  const rel = a.slice(k.length + 1).split(path.sep).join('/');
  return rel.split('/').some((c) => OMIT_FOLDERS.has(c)) ? null : rel;
}
export const isPersonal = (rel) => PRIVATE.some((p) => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\/|$)', 'i').test(rel || ''));

// event by tool and hook input; null = record nothing
export function eventFromHook(enter, koh = {}, root = BRAIN, now = Date.now()) {
  const tool = enter?.tool_name, i = enter?.tool_input || {};
  if (!['Read', 'Write', 'Edit', 'MultiEdit'].includes(tool)) return null;
  const rel = relativeInBrain(i.file_path, root, enter?.cwd || root);
  if (!rel) return null;
  return { when: now, kind: tool === 'Read' ? 'reads' : 'write', path: rel, floor: koh.floor || null, agent: enter?.agent_type || koh.agent || 'lead', name: koh.name || null, conv: koh.conv || null };
}

// the same conv + path + kind within 60 s counts once; lastByKey = Map key → time
export function isDuplicate(lastByKey, u, window = WINDOW_DUPLICATES) {
  const kl = `${u.conv || ''}|${u.kind}|${u.path}`, ago = lastByKey.get(kl);
  if (ago != null && u.when - ago < window) return true;
  lastByKey.set(kl, u.when);
  if (lastByKey.size > 5000) for (const [k, t] of lastByKey) if (u.when - t > window) lastByKey.delete(k);
  return false;
}

// to the API: private folders without a name
export const publicEvent = (u) => isPersonal(u.path) ? { ...u, path: null, personal: true } : u;

export function forToday(events, now = Date.now()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const today = events.filter((u) => u.when >= d.getTime()).sort((a, b) => b.when - a.when);
  return {
    today: { read: today.filter((u) => u.kind === 'reads').length, written: today.filter((u) => u.kind === 'write').length },
    last: today.slice(0, 50).map(publicEvent),
  };
}

// links [[x]], [[x|alias]], [[x#heading]] → target (without alias and heading); code in ``` blocks is skipped
export function links(text) {
  const without = String(text).replace(/```[\s\S]*?```/g, '');
  const out = [];
  for (const m of without.matchAll(/\[\[([^\]\n]+?)\]\]/g)) {
    const c = m[1].split('|')[0].split('#')[0].trim();
    if (c) out.push(c);
  }
  return out;
}

function allMd(root) {
  const out = [];
  const recurse = (d, rel) => {
    let items; try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const p of items) {
      if (p.isDirectory()) { if (!OMIT_FOLDERS.has(p.name)) recurse(path.join(d, p.name), rel ? `${rel}/${p.name}` : p.name); }
      else if (p.isFile() && p.name.toLowerCase().endsWith('.md')) out.push(nfc(rel ? `${rel}/${p.name}` : p.name));
    }
  };
  recurse(root, '');
  return out;
}

// { count, list: [{ path, title, changed }] }; a note is orphaned when it has no outgoing or incoming link
export function countOrphaned(root = BRAIN, max = 50) {
  if (!root) return { count: 0, list: [] };
  const files = allMd(root);
  const underPaths = new Map(), underTitle = new Map();
  for (const s of files) {
    const without = s.replace(/\.md$/i, '').toLowerCase();
    underPaths.set(without, s);
    const n = without.split('/').pop();
    (underTitle.get(n) || underTitle.set(n, []).get(n)).push(s);
  }
  const find = (linkTarget) => {
    const c = nfc(linkTarget).replace(/^\/+/, '').replace(/\.md$/i, '').toLowerCase();
    if (underPaths.has(c)) return underPaths.get(c);
    const n = underTitle.get(c.split('/').pop());
    return n && n.length ? n[0] : null;
  };
  const outside = new Map(files.map((s) => [s, 0])), inside = new Map(files.map((s) => [s, 0]));
  for (const s of files) {
    let text; try { text = fs.readFileSync(path.join(root, s), 'utf8'); } catch { continue; }
    for (const o of links(text)) {
      const target = find(o);
      outside.set(s, outside.get(s) + 1);
      if (target && target !== s) inside.set(target, inside.get(target) + 1);
    }
  }
  const orphaned = [];
  for (const s of files) {
    if (!s.includes('/') || OMIT_ORPHANED.some((v) => s === v || s.startsWith(v + '/'))) continue;
    if (GENERATED.some((r) => r.test(s))) continue; // daily facts and audio lecture scripts are generated, they are not expected to have links (2026-11-24)
    if (outside.get(s) || inside.get(s)) continue;
    let changed = 0; try { changed = Math.round(fs.statSync(path.join(root, s)).mtimeMs); } catch {}
    orphaned.push({ path: s, title: s.split('/').pop().replace(/\.md$/i, ''), changed });
  }
  orphaned.sort((a, b) => b.changed - a.changed);
  return { count: orphaned.length, list: orphaned.slice(0, max) };
}

// ---------- server state ----------
let FILE = null, emitOut = null;
const last = new Map();
let cache = null;

export function setBrain({ data, emit, root, privateFolders, omitOrphaned } = {}) {
  BRAIN = root ? nfc(root) : null;
  if (Array.isArray(privateFolders)) PRIVATE = privateFolders.map(String);
  if (Array.isArray(omitOrphaned)) OMIT_ORPHANED = omitOrphaned.map(String);
  emitOut = emit || null;
  if (data) FILE = path.join(data, 'brain-activity.jsonl');
  trimFile();
  setInterval(trimFile, 24 * 3600e3).unref();
}

export function loadEvents(file = FILE) {
  if (!file || !fs.existsSync(file)) return [];
  const out = [];
  for (const r of fs.readFileSync(file, 'utf8').split('\n')) { if (!r) continue; try { out.push(JSON.parse(r)); } catch {} }
  return out;
}

export function trimFile(file = FILE, now = Date.now()) {
  try {
    if (!file || !fs.existsSync(file)) return;
    const limit = now - DAYS * 86400e3, all = loadEvents(file), remains = all.filter((u) => u.when >= limit);
    if (remains.length !== all.length) fs.writeFileSync(file, remains.map((u) => JSON.stringify(u)).join('\n') + (remains.length ? '\n' : ''));
  } catch (e) { console.warn('mozog-aktivita (orezanie):', e.message); }
}

// called by the PostToolUse hook: never throws (errors are only logged)
export function record(enter, koh) {
  try {
    const u = eventFromHook(enter, koh);
    if (!u || !FILE || isDuplicate(last, u)) return;
    fs.appendFileSync(FILE, JSON.stringify(u) + '\n');
    try { emitOut?.({ kind: 'brain', type: 'activity', event: publicEvent(u) }); } catch {}
  } catch (e) { console.warn('brain-activity:', e.message); }
}

// count of .md per top-level brain folder { Skola: 347, ... } (files in the root under '.'); private folders only as a number, without names
export function countGroups(root = BRAIN) {
  if (!root) return {};
  const out = {};
  for (const c of allMd(root)) { const k = c.includes('/') ? c.split('/')[0] : '.'; out[k] = (out[k] || 0) + 1; }
  return out;
}

export function brainData(now = Date.now()) {
  if (!cache || now - cache.when > CACHE_ORPHANED) {
    let orphaned = { count: 0, list: [] }, groups = {};
    try { orphaned = countOrphaned(); } catch (e) { console.warn('osirele poznamky:', e.message); }
    try { groups = countGroups(); } catch (e) { console.warn('skupiny poznamok:', e.message); }
    cache = { when: now, orphaned, groups };
  }
  return { activity: forToday(loadEvents(), now), orphaned: cache.orphaned, groups: cache.groups };
}
