// build-world.js – the world (buildings and floors) from real folders. Read only, writes nowhere.
//
// Everything personal is in `world.json` (template svet.example.json), the code knows no specific folders:
// Building = folder `root`, its subfolders are floors (no activity for `archiveAfterDays` days → "archive" annex).
//            Building flags: `onlyWithClaudeMd` (only folders with CLAUDE.md), `subjectCode` + `code` (subjects with a code in the name and a folder
//            with the task code), `exclude`, `archive`, `notes` (where floor notes belong, see normalizeNotes).
// Brain    = optional pavilion in the middle (`brain`: a path string or { title, path, kind: 'obsidian'|'folder' }), in the city only the session and note counts.
// Center   = Control center = the folder of this app (`controlCenter: false` hides it, a string = another path).
// Modules  = `modules: { home, mail, mobile }` (optional parts, off by default), `city`: 'layers' | 'classic'.
// Sessions: ~/.claude/projects/*/*.jsonl, each session belongs to the floor whose folder contains its `cwd`
// (longest path match, so a nested project can have its own floor).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { language, setLanguage, t } from './i18n.js';
import { legacyWorld } from './migrate.js';

const HOME = os.homedir();
const DAY = 24 * 3600 * 1000;
const expand = (p) => (p && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
const shortenPath = (p) => (p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p);
const nfc = (s) => s.normalize('NFC');
const ROOT_APP = nfc(path.dirname(fileURLToPath(import.meta.url)));
const COLORS = ['#4f7cff', '#8a6cff', '#14a3b8', '#3fb68b', '#e0607e', '#f2a65a'];
// folder with a subject code: <root>/<CODE> or <root>/<CODE>-… (e.g. <root>/ABC123-Name)
function findCode(root, code) {
  try {
    const d = fs.readdirSync(root, { withFileTypes: true }).find((x) => x.isDirectory() && (x.name === code || x.name.startsWith(code + '-')));
    return d ? nfc(path.join(root, d.name)) : null;
  } catch { return null; }
}

export const DEFAULT = {
  archiveAfterDays: 30, // a project without a session and without a file change for this many days goes to the "archive" annex
  maxFloors: 12, // more floors do not fit into a tower (Work camera, cards), the rest (least active) goes to the archive
  language: 'en', // City language: 'en' (default) or 'sk' (server texts, agent prompts; the AGENTIC_LANG variable takes precedence)
  user: { name: '' }, // the name appears in texts for agents and in cards (never declined)
  brain: null, // a path string or { title, path, kind: 'obsidian'|'folder', forbiddenWrites?, noteInstruction? }; null = no pavilion
  controlCenter: ROOT_APP, // Control center = the app folder, in the middle between the towers (false/null = no Control center, a string = another path)
  buildings: {}, // "key": { title, color, root, archive, exclude, onlyWithClaudeMd, subjectCode, code, notes }, order as in world.json
  floors: {}, // "~/path": { title, description, building, order, hide, archive: true|false, model, effort, notes }
  agents: {}, // { model, effort, mode } defaults for all floors
  guards: { bannedPush: [] }, // git remote hosts agents never push to (e.g. "gitlab.example.com")
  modules: { home: false, mail: false, mobile: false }, // optional modules (modules.js loads them only when enabled and their files exist)
  city: 'layers', // 'layers' (slabs, fast) or 'classic' (the original city)
  glossary: {}, // { word: 'Correct form' } for default titles from folder names (e.g. { "skoly": "školy" })
  location: null, // { lat, lon } for sunrise and sunset in the app; without it the app estimates longitude from the time zone
};
// location from world.json: only numbers in range, otherwise null
const validLocation = (p) => {
  const lat = Number(p?.lat), lon = Number(p?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
};

// ---------- sessions from ~/.claude/projects ----------

// A session created in the Claude app without a folder starts in a temporary "…/Claude/scratch-workspaces/…" and only then
// may switch to a project (2026-11-10: an LF session had a scratch first cwd, the project only from 1.2 MB). With a scratch start
// the last cwd from the end of the file decides.
const isScratch = (c) => c.includes('/scratch-workspaces/');
const CWD_RE = /"cwd":"((?:[^"\\]|\\.)*)"/g;
const cwdCache = new Map(); // file → { cwd, size } (cwd does not change; for scratch it is recomputed when the file grows)
function cwdSession(file) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return null; }
  const c = cwdCache.get(file);
  if (c && (!isScratch(c.cwd) || c.size === size)) return c.cwd;
  let cwd = null;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(65536);
      for (let position = 0; position < 512 * 1024 && !cwd; position += buf.length) {
        const n = fs.readSync(fd, buf, 0, buf.length, position);
        if (!n) break;
        const m = buf.toString('utf8', 0, n).match(/"cwd":"((?:[^"\\]|\\.)*)"/);
        if (m) cwd = nfc(JSON.parse(`"${m[1]}"`));
        if (n < buf.length) break;
      }
      if (cwd && isScratch(cwd) && size > 0) {
        const n = fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
        const last = [...buf.toString('utf8', 0, n).matchAll(CWD_RE)].map((m) => nfc(JSON.parse(`"${m[1]}"`))).filter((x) => !isScratch(x)).pop();
        if (last) cwd = last;
      }
    } finally { fs.closeSync(fd); }
  } catch {}
  if (cwd) cwdCache.set(file, { cwd, size }); // without a cwd we try again next time (the session is still being written)
  return cwd;
}

// Returns a list of { cwd, time, folder, sid } for all sessions (*.jsonl files directly in the project folder, subagents are in subfolders).
export function loadSessions(root = path.join(HOME, '.claude', 'projects')) {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    const dir = path.join(root, d.name);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const s = path.join(dir, f);
      let st; try { st = fs.statSync(s); } catch { continue; }
      if (st.size < 200) continue; // empty session (only opened)
      out.push({ cwd: cwdSession(s), time: st.mtimeMs, folder: d.name, sid: f.slice(0, -6) });
    }
  }
  return out;
}

// Folder name in ~/.claude/projects = the path with every character outside [A-Za-z0-9-] as a dash (fallback when a session has no cwd).
const encodePath = (p) => [nfc(p), p.normalize('NFD')].map((x) => x.replace(/[^A-Za-z0-9-]/g, '-'));

// ---------- file activity ----------

const OMIT_AT_SCAN = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'bin', 'obj', 'venv', '.venv', '__pycache__', 'Library', 'temp', 'lib']);
// Newest file change down to depth 2 (without node_modules and hidden ones), at most ~3000 entries, does not follow symlinks.
function lastChange(dir) {
  let newest = 0, count = 0;
  const walk = (d, depth) => {
    let items = [];
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of items) {
      if (++count > 3000) return;
      if (e.name.startsWith('.') || e.name === 'Icon\r' || OMIT_AT_SCAN.has(e.name) || e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isFile()) { try { newest = Math.max(newest, fs.statSync(p).mtimeMs); } catch {} }
      else if (e.isDirectory() && depth < 2) walk(p, depth + 1);
    }
  };
  walk(dir, 0);
  return newest;
}
const changeCache = new Map(); // folder → { when, value }, recomputed after 5 min at the earliest
function lastChangeCache(dir) {
  const c = changeCache.get(dir);
  if (c && Date.now() - c.when < 5 * 60 * 1000) return c.value;
  const value = lastChange(dir);
  changeCache.set(dir, { when: Date.now(), value });
  return value;
}

// ---------- titles ----------

let DICTIONARY = {}; // `glossary` from world.json (set by loadSetting)
// Default title from the folder name: "my-project" → "My project", "MY_PROJECT" → "MY PROJECT", names with capitals
// and spaces ("Client A") stay. Shorten and rename in world.json (`title`, `glossary`).
function nice(name) {
  if (name !== name.toLowerCase()) return name.replace(/_/g, ' ');
  const words = name.split(/[-_\s]+/).filter(Boolean);
  return words.map((s, i) => DICTIONARY[s] || (i === 0 ? s[0].toUpperCase() + s.slice(1) : s)).join(' ');
}
// "SubjectName" → "Subject name" (subject description, unless in world.json)
const splitCamel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().replace(/ (\S)/g, (m, c) => ' ' + c.toLowerCase());

// ---------- floor notes (where decisions, state, TODO belong) ----------
// `notes` on a building (world.json), one of the forms:
//   "folder"                          notes only in the project folder, never in the Brain (e.g. client projects)
//   "<path>/…/{slug}/README.md"       file template (ends with .md); {slug} = folder name lowercased with dashes, {name} = folder name, {path} = full floor path
//   "<path>/{name}/"                  folder template (ends with /); the agent picks the file in it by the folder's CLAUDE.md
//   { template, table?, newInstruction? } file template + `table` = a markdown file with rows "| `folder/` | `path.md` |" (takes precedence over the template)
//                                     and `newInstruction` = an addition to the instruction when the notes file does not exist yet
// Without `notes` the agent writes notes nowhere (the instruction asks it to put them in the result).
export function normalizeNotes(p) {
  if (!p) return null;
  if (p === 'folder') return { kind: 'folder' };
  const o = typeof p === 'string' ? { template: p } : p;
  if (!o || typeof o.template !== 'string' || !o.template.trim()) return null;
  const template = o.template.trim();
  if (template === 'folder') return { kind: 'folder' };
  return { kind: template.endsWith('/') ? 'dir' : 'file', template, table: o.table ? String(o.table) : null, newInstruction: o.newInstruction ? String(o.newInstruction) : '' };
}
const slug = (name) => name.toLowerCase().replace(/[\s_]+/g, '-');
// fills {slug}, {name}, {path} into the template and expands ~
// (the original placeholders {meno} and {cesta} of svet.json still work next to {name} and {path})
export const fillTemplate = (template, name, folderPath = '', literal = false) => expand(template.replace(/\{slug\}/g, literal ? name : slug(name)).replace(/\{(?:name|meno)\}/g, name).replace(/\{(?:path|cesta)\}/g, folderPath));
// notes file candidates from a file template: {slug} once as the folder name (as is), once as a slug (no duplicates)
export const noteCandidates = (template, name, folderPath = '') => [...new Set([fillTemplate(template, name, folderPath, true), fillTemplate(template, name, folderPath)])];
// Caption from the project notes (title: "…" in the frontmatter), if they exist.
function captionNotes(B, name, folderPath) {
  const P = normalizeNotes(B?.notes);
  if (P?.kind !== 'file') return null;
  for (const f of noteCandidates(P.template, name, folderPath)) {
    try { const m = fs.readFileSync(f, 'utf8').slice(0, 600).match(/^title:\s*"?([^"\n]+)"?/m); if (m) return m[1].trim(); } catch {}
  }
  return null;
}

// ---------- building the world ----------

const warned = new Set();
const warn = (text) => { if (!warned.has(text)) { warned.add(text); console.log(`⚠️  ${text}`); } };

function normalizeBrain(m) {
  if (!m) return null;
  const kind = (d) => (d === 'obsidian' ? 'obsidian' : 'folder');
  if (typeof m === 'string') return { title: 'Mozog', path: m, kind: 'folder' };
  if (typeof m === 'object' && typeof m.path === 'string' && m.path) return { ...m, title: String(m.title || '').trim() || 'Mozog', kind: kind(m.kind) };
  return null;
}

// Raw world.json merged with the defaults. Buildings go in world.json order (without them the city is empty, the Control center remains).
export function loadSetting(file) {
  let custom = {};
  try {
    if (file && fs.existsSync(file)) custom = JSON.parse(fs.readFileSync(file, 'utf8'));
    else if (file) custom = legacyWorld(file) || {}; // not migrated yet: the original svet.json next to it, migrated in memory (migrate.js)
  } catch (e) { warn(t('server.world.unreadable', { error: e.message })); }
  if (!custom || typeof custom !== 'object' || Array.isArray(custom) || Array.isArray(custom.buildings)) custom = {}; // unknown or old format (buildings as an array) is ignored
  const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  DICTIONARY = obj(custom.glossary);
  const buildings = {};
  for (const [key, B] of Object.entries(obj(custom.buildings))) {
    if (key.startsWith('_')) continue; // comment (_poznamka)
    if (!B || typeof B !== 'object' || typeof B.root !== 'string' || !B.root) { warn(t('server.world.buildingWithoutRoot', { key })); continue; }
    if (!/^[\w.-]+$/.test(key)) { warn(t('server.world.key', { key })); continue; }
    buildings[key] = { title: nice(key), color: COLORS[Object.keys(buildings).length % COLORS.length], archive: true, exclude: [], ...B };
  }
  const floors = {};
  for (const [k, v] of Object.entries(obj(custom.floors))) if (!k.startsWith('_')) floors[nfc(expand(k))] = obj(v);
  const modules = {};
  for (const k of Object.keys(DEFAULT.modules)) modules[k] = obj(custom.modules)[k] === true;
  setLanguage(custom.language === 'sk' ? 'sk' : 'en');
  return {
    ...DEFAULT, ...custom, buildings, floors, modules,
    user: { ...DEFAULT.user, ...obj(custom.user) },
    language: custom.language === 'sk' ? 'sk' : 'en',
    brain: normalizeBrain(custom.brain),
    guards: { bannedPush: [...new Set((Array.isArray(custom.guards?.bannedPush) ? custom.guards.bannedPush : []).map((h) => String(h).trim()).filter(Boolean))] },
    city: custom.city === 'classic' ? 'classic' : 'layers',
    location: validLocation(custom.location),
    glossary: DICTIONARY,
  };
}

// Brain note count: .md files without hidden folders (.git, .obsidian…) and node_modules;
// /api/world is called often, so the result is valid for a minute.
let noteCount = { path: null, time: 0, n: null };
function countNotes(root, now) {
  if (noteCount.path === root && now - noteCount.time < 60_000) return noteCount.n;
  let n = 0;
  const walk = (d) => {
    let items;
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of items) {
      if (x.name.startsWith('.') || x.name === 'node_modules') continue;
      if (x.isDirectory()) walk(path.join(d, x.name));
      else if (x.isFile() && x.name.endsWith('.md')) n++;
    }
  };
  walk(root);
  noteCount = { path: root, time: now, n: fs.existsSync(root) ? n : null };
  return noteCount.n;
}

// all = true: also returns hidden floors (`hidden`) and extended fields for Floor management (listFloors)
export function buildWorld({ fileSettings, now = Date.now(), all = false } = {}) {
  const N = loadSetting(fileSettings);
  const candidates = []; // { key (building), path, name, title, description, paths (for sessions) }
  const controlCenterPath = typeof N.controlCenter === 'string' && N.controlCenter ? nfc(expand(N.controlCenter)) : N.controlCenter === true ? ROOT_APP : null;
  const seen = new Set(controlCenterPath ? [controlCenterPath] : []); // the Control center is not a floor of the Projects tower

  for (const [key, B] of Object.entries(N.buildings)) {
    const root = expand(B.root);
    let items = [];
    try { items = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    const exclude = new Set(B.exclude || []);
    for (const d of items) {
      if (!d.isDirectory() || d.name.startsWith('.') || exclude.has(d.name)) continue; // skips symlinks (OneDrive) and files (Icon)
      const floorPath = nfc(path.join(root, d.name));
      if (floorPath === controlCenterPath) continue;
      if (B.onlyWithClaudeMd && !fs.existsSync(path.join(floorPath, 'CLAUDE.md'))) continue;
      const code = B.subjectCode ? d.name.match(/^([A-Z]{2,}\d{2,4})/)?.[1] : null;
      if (B.subjectCode && !code) continue; // _prehlady, _studium…
      const codePath = code && B.code ? findCode(expand(B.code), code) : null;
      const paths = codePath ? [floorPath, codePath] : [floorPath];
      const description = code ? splitCamel(path.basename(codePath || '').slice(code.length)) || code : (captionNotes(B, d.name, floorPath) || nice(d.name));
      candidates.push({ key, path: floorPath, codePath, name: d.name, title: code || nice(d.name), description, paths });
      seen.add(floorPath); if (codePath) seen.add(codePath);
    }
  }
  // manually added floors (path outside building roots, with "building")
  for (const [floorPath, u] of Object.entries(N.floors)) {
    if (seen.has(floorPath) || !u.building || !N.buildings[u.building] || !fs.existsSync(floorPath)) continue;
    const name = path.basename(floorPath);
    candidates.push({ key: u.building, path: floorPath, name, title: nice(name), description: captionNotes(N.buildings[u.building], name, floorPath) || nice(name), paths: [floorPath] });
  }

  // sessions → floor by the longest path match (Brain too)
  const brainPath = N.brain ? nfc(expand(N.brain.path)) : null, controlCenterK = { controlCenter: true };
  const targets = [...candidates.flatMap((k) => k.paths.map((c) => ({ c, k }))), ...(brainPath ? [{ c: brainPath, k: null }] : []), ...(controlCenterPath ? [{ c: controlCenterPath, k: controlCenterK }] : [])].sort((a, b) => b.c.length - a.c.length);
  const codes = targets.map((x) => ({ ...x, codes: encodePath(x.c) }));
  const stat = new Map([...candidates, controlCenterK].map((k) => [k, { sessions: 0, lastSeen: 0 }]));
  const brain = { sessions: 0, lastSeen: 0 };
  for (const s of loadSessions()) {
    let target;
    if (s.cwd) target = targets.find(({ c }) => s.cwd === c || s.cwd.startsWith(c + '/'));
    else target = codes.find(({ codes: kk }) => kk.some((x) => s.folder === x || s.folder.startsWith(x + '-')));
    if (!target) continue;
    const st = target.k ? stat.get(target.k) : brain;
    st.sessions++; st.lastSeen = Math.max(st.lastSeen, s.time);
  }

  // manual edits, activity, archive
  const buildings = Object.entries(N.buildings).map(([key, B]) => ({ key, title: B.title, color: B.color, floors: [], archive: [] }));
  const used = new Set(N.brain ? [N.brain.title] : []);
  const hidden = [];
  for (const k of candidates.sort((a, b) => a.title.localeCompare(b.title, 'sk'))) {
    const u = N.floors[k.path] || (k.codePath && N.floors[k.codePath]) || {}; // world.json may also key it by the code folder
    const key = u.building && N.buildings[u.building] ? u.building : k.key;
    if (u.hide) {
      if (all) { const { sessions, lastSeen } = stat.get(k); hidden.push({ key, name: k.name, n: String(u.title || k.title).trim(), description: u.description || k.description, path: k.path, codePath: k.codePath, sessions, lastSeen: lastSeen || null, activity: lastSeen || null, order: u.order ?? null, archiveManual: u.archive }); }
      continue;
    }
    const B = N.buildings[key], b = buildings.find((x) => x.key === key);
    const { sessions, lastSeen } = stat.get(k);
    const change = B.archive || u.archive === false ? lastChangeCache(k.path) : 0;
    const activity = Math.max(lastSeen, change);
    let n = String(u.title || k.title).trim();
    if (used.has(n)) n = `${n} (${B.title})`; // the floor title must be unique (the app uses it as an id and in the #… address)
    used.add(n);
    const p = {
      id: `${key}/${n}`, n, title: n, description: u.description || k.description, path: k.path, shortPath: shortenPath(k.path),
      sessions, lastSeen: lastSeen || null, activity: activity || null, order: u.order ?? null,
      hasClaudeMd: fs.existsSync(path.join(k.path, 'CLAUDE.md')),
      paths: k.paths, ...(k.codePath ? { codePath: k.codePath, shortCode: shortenPath(k.codePath) } : {}),
      ...(all ? { name: k.name, archiveManual: u.archive } : {}),
    };
    const toArchive = u.archive === true || (u.archive !== false && B.archive && now - activity > N.archiveAfterDays * DAY);
    (toArchive ? b.archive : b.floors).push(p);
  }
  for (const b of buildings) {
    // order: manual `order` (smaller = lower), then alphabetical. Fixed, activity is shown by the light and sessions.
    b.floors.sort((x, y) => (x.order ?? 1e9) - (y.order ?? 1e9) || x.n.localeCompare(y.n, 'sk'));
    if (b.floors.length > N.maxFloors) {
      // not all fit into the tower: the least active go to the archive, the tower order stays
      const keep = new Set([...b.floors].sort((x, y) => (y.order != null) - (x.order != null) || (y.activity || 0) - (x.activity || 0)).slice(0, N.maxFloors));
      b.archive.push(...b.floors.filter((p) => !keep.has(p)).map((p) => ({ ...p, overflowed: true })));
      b.floors = b.floors.filter((p) => keep.has(p));
    }
    b.archive.sort((x, y) => (y.activity || 0) - (x.activity || 0) || x.n.localeCompare(y.n, 'sk'));
  }
  return {
    created: new Date(now).toISOString(),
    user: { name: String(N.user.name || '').trim() },
    language: language(), // effective language (AGENTIC_LANG takes precedence over world.json)
    city: N.city,
    location: N.location,
    archiveAfterDays: N.archiveAfterDays, maxFloors: N.maxFloors,
    buildings: all ? buildings : buildings.filter((b) => b.floors.length || b.archive.length),
    ...(all ? { hidden } : {}),
    brain: brainPath ? { n: N.brain.title, title: N.brain.title, kind: N.brain.kind, path: brainPath, shortPath: shortenPath(brainPath), sessions: brain.sessions, lastSeen: brain.lastSeen || null, count: countNotes(brainPath, now) } : null,
    controlCenter: controlCenterPath && fs.existsSync(controlCenterPath) ? { n: 'Riadiaca centrála', path: controlCenterPath, shortPath: shortenPath(controlCenterPath), paths: [controlCenterPath], sessions: stat.get(controlCenterK).sessions, lastSeen: stat.get(controlCenterK).lastSeen || null } : null,
  };
}

// Floor management (Control center): all building candidates including hidden and archived.
// → [{ key, title, color, floors: [{ key, path (with ~), codePath?, name, title, description, order, status: 'tower'|'archive'|'hidden', archiveManual, sessions, activity }] }]
export function listFloors({ fileSettings, now = Date.now() } = {}) {
  const s = buildWorld({ fileSettings, now, all: true });
  const row = (status, key) => (p) => ({ key, path: shortenPath(p.path), ...(p.codePath ? { codePath: shortenPath(p.codePath) } : {}), name: p.name, title: p.n, description: p.description, order: p.order ?? null, status, archiveManual: p.archiveManual ?? null, sessions: p.sessions, activity: p.activity || null });
  return s.buildings.map((b) => ({
    key: b.key, title: b.title, color: b.color,
    floors: [...b.floors.map(row('tower', b.key)), ...b.archive.map(row('archive', b.key)), ...s.hidden.filter((p) => p.key === b.key).map(row('hidden', b.key))],
  }));
}
export const expandPath = (p) => nfc(expand(p));
export const shortenPathHome = shortenPath;
export const rootApp = ROOT_APP;
// "user" or "user (Name)" for agent texts and cards (the name is never declined)
export const userLabel = (name) => { const m = String(name || '').trim(); return m ? t('prompt.userName', { name: m }) : t('prompt.user'); };
// git remote hosts agents do not push to (guards.bannedPush in world.json)
export const bannedPush = (fileSettings) => loadSetting(fileSettings).guards.bannedPush;

// Standalone run: node build-world.js → prints an overview (to check world.json)
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const t0 = performance.now();
  const s = buildWorld({ fileSettings: path.join(path.dirname(new URL(import.meta.url).pathname), 'world.json') });
  const when = (ms) => (ms ? `${Math.round((Date.now() - ms) / DAY)} d` : '—');
  for (const b of s.buildings) {
    console.log(`\n${b.title} (${b.floors.length} floors, archive ${b.archive.length})`);
    for (const p of b.floors) console.log(`  ${p.n.padEnd(22)} ${String(p.sessions).padStart(4)} sessions  activity ${when(p.activity).padStart(5)}  ${p.description}  ${p.shortPath}`);
    for (const p of b.archive) console.log(`  · ${p.n.padEnd(20)} ${String(p.sessions).padStart(4)} sessions  activity ${when(p.activity).padStart(5)}${p.overflowed ? '  (did not fit)' : ''}`);
  }
  if (s.controlCenter) console.log(`\nControl center: ${s.controlCenter.sessions} sessions  ${s.controlCenter.shortPath}`);
  console.log(`\nBrain: ${s.brain ? s.brain.sessions : '—'} sessions · ${Math.round(performance.now() - t0)} ms`);
}
