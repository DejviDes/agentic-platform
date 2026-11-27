// Agentic Platform (formerly Mesto agentov) – local server.
// World from real folders (build-world.js), floors = Claude Code agents (agents.js, Agent SDK on top of your
// `claude` CLI), progress goes to the browser via Server-Sent Events and every write and command waits for approval by a click.
// Subscription limits and dictation via local Whisper are in extras.js. Needs Node 22+, `npm install`,
// a logged-in `claude` CLI (`claude auth login`, subscription, never an API key) and `uv` + `ffmpeg` for dictation.
//
// Start:      node server.js → http://localhost:4747 (macOS: optional launchd service via start.sh, label ends with mesto-agentov)
//             service restart: launchctl kickstart -k gui/$(id -u)/<label>
//             agent in the Control center: tool mcp__agentic__restart_server (self-test → process exit → launchd starts it again)
// Modules:    Home, Mail and City on mobile are optional (modules.js, `modules` in world.json); the core runs without them.
// Self-test:  node server.js --selftest (also the old --skuska) loads all modules, builds the world and exits (0 = ok, 1 = error),
//             does not listen on a port and does not write to data/.

import { migrate, needsMigration } from './migrate.js'; // first: also maps the original MESTO_* environment to AGENTIC_* before other modules read it
import http from 'node:http';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { userLabel, loadSetting, buildWorld } from './build-world.js';
import { loadModules } from './modules.js'; // optional modules Home, Mail, mobile (enabled in world.json)
import { changeLanguage, changeFloor, list as listMessages } from './floor-admin.js';
import { language, t } from './i18n.js';
import { cleanEnv, openInApp, conversationDetail, image, attachment, saveAttachment, floorConversations, publicTeam, setAgents, sendMessage, editMessage, rules, rename, hide, toTrash, resolve as resolveConv, pin, decide, decideCard, cardType, taskCard, newSessionCard, floorState, restartState, saveAll, agentActivity, allSummaries, stop, sendImmediately, cancelFromQueue, floorCommands, cancelRule, namesState, setNames, CLAUDE_BIN, CLAUDE_VERSION } from './agents.js';
import { LIMITS, limitFromEvent, loadLimits, transcription, prepareTranscription, stopLimits, stopTranscription } from './extras.js';
import { commitControlCenter, diffControlCenter, setPushBan, pushControlCenter, watchApp, controlCenterState } from './control-center.js';
import { watchStates, notifyMac } from './os-notifications.js';
import { setSleep, recompute as recomputeSleep, sleepState, releaseSleep, changeSleep } from './sleep.js';
import { mobileDone, setNotifications, notificationState, changeNotifications, show, withSound } from './notifications.js';
import { calibrate, setUsage, setSaving, savingState } from './usage.js';
import { usageBreakdown } from './usage-sessions.js';
import { brainData, setBrain } from './brain-activity.js'; // agent activity in the brain and orphaned notes (Brain)
import { proposeFloor } from './router.js';
import { setScribe, scribeState, changeScribe } from './scribe.js'; // Scribe after a turn (2026-11-25)
import { pendingQuestions, setChronicler, replyToQuestion, addQuestion, toggle as toggleChronicler, start as startChronicler, chroniclerState } from './chronicler-night.js'; // nightly Chronicler and questions in the Brain
import { startTools, toolState } from './tools.js';
import { virtualFloor } from './virtual-floors.js';
import { dispatcherContext, setDispatch, verifyTasks, prepareTask, splitTasks, decideTask, startTask, dispatchState, cancelTask } from './dispatch.js';
import { IS_MAC } from './platform.js';
import { LOCK_DISABLED, activity, initLock, unlock, verifyKey, lastCardActivity, watchStream, lock } from './lock.js';
import { exist as existFiles, rawHeaders, filePreview, setFiles, open as openFile, rawFile } from './files.js'; // file preview from the chat

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// canUseTool is deliberately not called for tools from allowedTools (Read, Grep…), the SDK warning on every turn is not needed
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.code !== 'CLAUDE_SDK_CAN_USE_TOOL_SHADOWED') console.warn(w.name + ': ' + w.message); });
const PORT = Number(process.env.PORT || 4747);
const DATA = path.join(ROOT, 'data');
const PREVIEW = path.join(ROOT, '..', 'mesto-agentov-nahlad', 'public'); // preview branch of the app at /nahlad/ (git worktree)
// self-test before a restart: no port, nothing written to data/. --skuska is the original name of the switch: the running
// server's restart tool (restart_server) still calls it, so the switch stays accepted.
const SELFTEST = process.argv.includes('--selftest') || process.argv.includes('--skuska');
// One-time migration of the original Slovak svet.json and data/ (migrate.js): before anything reads data/.
// The self-test only runs it dry (with the count checks), so a migration that would fail stops the restart in time.
{
  const pending = needsMigration(ROOT);
  if (pending.conflicts.length || pending.world || pending.data) {
    try {
      const r = migrate({ root: ROOT, dryRun: SELFTEST, log: (m) => console.log('migration: ' + m) });
      if (SELFTEST) console.log(`migration (dry run) ok: world.json ${r.world ? 'from svet.json' : 'exists'}, data/ ${r.data ? `${r.data.renamed.length} names, ${r.data.after.conversations} conversations, ${r.data.after.messageFiles} message files` : 'up to date'}`);
    } catch (e) { console.error('migration failed, nothing changed: ' + e.message); process.exit(1); }
  }
}
initLock(ROOT, { selftest: SELFTEST }); // City lock: tab key after Touch ID, 8 min of inactivity (lock.js)
if (!SELFTEST) fs.mkdirSync(DATA, { recursive: true });

// ---------- world: buildings and floors ----------

// Phase 2: the world is built from real folders (build-world.js, read only).
// Manual edits: world.json (template svet.example.json, ignored in git). Without it the city is empty, only the Control center remains.
const WORLD_JSON = path.join(ROOT, 'world.json');
let world = buildWorld({ fileSettings: WORLD_JSON });
const HOME = process.env.HOME || '';
const MOD = await loadModules(loadSetting(WORLD_JSON).modules); // only enabled modules whose files exist
const who = () => userLabel(world.user?.name);
function findFloor(id) {
  const p = world.buildings.flatMap((b) => [...b.floors, ...b.archive]).find((x) => x.id === id || x.n === id);
  if (p) return p;
  const m = world.brain; // Brain pavilion = floor "Second Brain"
  if (m?.path && (id === 'brain' || id === 'Second Brain')) return { ...m, id: 'brain', n: 'Second Brain', shortPath: m.path.startsWith(HOME) ? '~' + m.path.slice(HOME.length) : m.path };
  if (world.controlCenter && (id === 'control-center' || id === world.controlCenter.n)) return { ...world.controlCenter, id: 'control-center' }; // Control center = the city app
  return virtualFloor(id, who()) || MOD.floor(id); // virtual floors: control-center/dispatch (virtual-floors.js) and module floors (Home: home/<k>, brain/universal); not in the world nor in the towers
}
// for the router and Dispatch: active floors with the building name, Brain, Control center and Universal (not the archive)
const floorRouter = () => [...world.buildings.flatMap((b) => b.floors.map((p) => ({ ...p, building: b.title }))), ...['brain', 'control-center', 'brain/universal'].map(findFloor).filter((p) => p?.path)];
const allFloor = () => [...world.buildings.flatMap((b) => [...b.floors, ...b.archive]), ...(world.controlCenter ? [world.controlCenter] : [])];

// ---------- SSE ----------

const clients = new Set();
// macOS notifications from the server when no open app window shows them itself (os-notifications.js)
const onStatusConv = watchStates({
  port: PORT, floor: (k) => findFloor(k.floor),
  who: (k, P) => (k.agent === 'lead' ? P?.lead?.name || t('server.router.lead') : publicTeam(P).find((a) => a.k === k.agent)?.name || k.agent),
  canApp: () => [...clients].some((r) => r.notif),
  show, withSound, mobileDone, // muting notifications from the ⋯ menu and push on completion (notifications.js)
  toApp: (o) => emit({ kind: 'notify', ...o }), // the completion notification is shown by the app window with ?notif=1 (api.js)
  push: MOD.modules.mobile?.sendPush, cardActive: () => Date.now() - lastCardActivity() < 120e3, // push to mobile only when no app tab on the Mac has been active for 2 min
});
function emit(event) {
  if (event.kind === 'conv') { try { onStatusConv(event.conv); } catch (e) { console.warn('notification:', e.message); } try { recomputeSleep(); } catch (e) { console.warn('sleep:', e.message); } } // a conversation state change immediately recomputes Mac sleep
  const row = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(row);
}

if (SELFTEST) { // modules loaded (the import would fail otherwise), the world was built; check the Control center floor and exit
  if (!world?.buildings?.length && !world?.controlCenter) { console.error(t('server.selftest.withoutWorld')); process.exit(1); }
  if (world.controlCenter && !findFloor('control-center')) { console.error(t('server.selftest.withoutControlCenter')); process.exit(1); }
  for (const id of MOD.selftest) if (!findFloor(id)) { console.error(t('server.selftest.withoutFloor', { id })); process.exit(1); }
  if (!findFloor('control-center/dispatch')?.virtual) { console.error(t('server.selftest.withoutDispatch')); process.exit(1); }
  if (!findFloor('control-center/chronicler')?.chronicler) { console.error(t('server.selftest.withoutChronicler')); process.exit(1); }
  if (MOD.loaded.home && !floorRouter().some((p) => p.id === 'brain/universal')) { console.error(t('server.selftest.withoutUniversal')); process.exit(1); }
  console.log(t('server.selftest.passed', { buildings: world.buildings.length, floors: allFloor().length, modules: Object.entries(MOD.loaded).filter(([, v]) => v).map(([k]) => k).join(', ') || t('server.selftest.none'), claude: CLAUDE_VERSION || '?' }));
  process.exit(0);
}

// process exit on a restart from the Control center (launchd KeepAlive starts it again): save, close helper processes
function end(code = 0) {
  try { saveAll(); } catch (e) { console.error('saving before restart:', e.message); }
  // Mac sleep is deliberately not restored here: launchd starts the server again right away and it reconciles the state (data/sleep.json held),
  // otherwise a Mac with a closed lid would fall asleep during the restart. It is restored only on SIGTERM/SIGINT (service shutdown).
  stopTranscription(); stopLimits();
  for (const res of clients) { try { res.end(); } catch {} }
  setTimeout(() => process.exit(code), 300);
}

setUsage({ data: DATA, worldJson: WORLD_JSON, limits: () => LIMITS });
setNotifications({ data: DATA }); // muting notifications (menu ⋯ Notifications) // estimate of 5h limit usage per message (usage.js)
setSleep({ data: DATA, activity: agentActivity, alert: (title, text) => { if (!show()) return; try { MOD.modules.mobile?.sendPush?.({ title: title, text, url: '/' }); } catch {} notifyMac({ title: title, text, group: 'sleep', quiet: !withSound() }); } }); // Mac sleep: disablesleep by mode and agent work (sleep.js)
// after loading limits also the 5 h window breakdown from transcripts (at most once a minute): the real units / % ratio for estimates
// in the chat, so "this conversation" matches the Limit usage window (usage-sessions.js → setWindowRatio)
let breakdownT = 0;
const emitLimits = (e) => {
  calibrate(LIMITS); emit(e);
  if (Date.now() - breakdownT > 60e3 && LIMITS.h5?.reset) { breakdownT = Date.now(); usageBreakdown('h5', { limits: LIMITS, conversations: allSummaries() }).catch(() => {}); }
};
setDispatch({ data: DATA }); // Dispatch: prepared tasks in data/dispecing.json
setAgents({ questionChronicler: addQuestion, dispatcher: { verify: (u) => verifyTasks(u, floorRouter()), context: () => dispatcherContext(floorRouter()) }, data: DATA, root: ROOT, end, worldJson: WORLD_JSON, findFloor, emit, allPaths: () => allFloor().flatMap((p) => p.paths || [p.path]), limits: (info) => limitFromEvent(info, emitLimits), limitsStatus: () => LIMITS });
{ const B = loadSetting(WORLD_JSON).brain; setBrain({ data: DATA, emit, root: B ? path.resolve(String(B.path).replace(/^~(?=\/|$)/, os.homedir())).normalize('NFC') : null, privateFolders: B?.private, omitOrphaned: B?.omitOrphaned }); } // activity record from the PostToolUse hook (agents.js)
setScribe({ data: DATA }); // Scribe after a turn: state and unresolved cards data/scribe.json, log data/scribe.jsonl
setChronicler({ data: DATA, emit, sendMessage, stop, findFloor }); // nightly Chronicler 23:30 (on by default), questions data/chronicler-questions.json
MOD.set({ data: DATA, emit, sendMessage, stop, push: MOD.modules.mobile?.sendPush }); // schedulers of enabled modules (Home: sorting, house, library, playground, task office; Mail: belt and overview), not in --selftest
setPushBan(() => loadSetting(WORLD_JSON).guards.bannedPush); // Control center commit/push: never to hosts from world.json `guards.bannedPush`
setFiles(() => { // allowed file preview roots: `files.roots` in world.json, otherwise the Brain, every building root and the app folder
  const N = loadSetting(WORLD_JSON), m = N.brain, ex = N.files && typeof N.files === 'object' ? N.files : {};
  const roots = Array.isArray(ex.roots) && ex.roots.length ? ex.roots : [m?.path, ...Object.values(N.buildings).map((b) => b.root), ROOT];
  return { roots: roots.filter(Boolean).map((p) => p.replace(/^~(?=\/|$)/, HOME)), brain: m?.kind === 'obsidian' ? m.path.replace(/^~(?=\/|$)/, HOME) : null, sensitive: Array.isArray(ex.sensitive) ? ex.sensitive : [] };
});

// limits once a minute, only while the app is open (after 10 min without a browser the helper process closes)
let withoutClient = Date.now();
setInterval(() => {
  if (clients.size) { withoutClient = Date.now(); loadLimits(emitLimits); }
  else if (Date.now() - withoutClient > 10 * 60 * 1000) stopLimits();
}, 60 * 1000);
setInterval(() => { for (const res of clients) res.write(': tik\n\n'); }, 25000);
watchApp(ROOT, emit); // Control center: frontend change → SSE `app` (the app reloads itself), server code → `controlCenter`

function verifyLogin() {
  return new Promise((resolve) => {
    execFile('claude', ['auth', 'status'], { env: cleanEnv(), timeout: 15000 }, (err, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ loggedIn: false, error: err ? err.message : t('server.http.unknownReply') });
      }
    });
  });
}

// ---------- HTTP ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2' };
// KaTeX (formulas in the chat) is served straight from node_modules, loaded only with the first message containing a formula
const KATEX = path.join(ROOT, 'node_modules', 'katex', 'dist');
const VENDOR = { '/vendor/katex/': KATEX, '/vendor/hljs/': path.join(ROOT, 'node_modules', '@highlightjs', 'cdn-assets', 'es') }; // libraries from node_modules that the app loads only when needed

// ⌘ terminal: a new iTerm window (Terminal.app if missing) with `cd <folder> && claude --resume <sid>`.
// The command goes to osascript as an argument (not by composing AppleScript), sid only a UUID, the folder must exist.
// ▶ on a bash block in the chat (2026-11-14): with `command` instead of `sid` it opens iTerm in the conversation folder and only TYPES
// the command (newline NO), the user presses Enter, so one click does not run something the agent's guards would stop. One line only.
// Without iTerm, Terminal.app with `cd` and the command goes to the clipboard (do script would run it right away).
function openTerminal({ sid, path: folder, command: entry } = {}) {
  if (!IS_MAC) throw Object.assign(new Error(t('server.terminal.onlyMac')), { code: 501 });
  const error = (m) => Object.assign(new Error(m), { code: 400 });
  if (entry != null) {
    entry = String(entry).trim();
    if (!entry || entry.length > 2000 || /[\r\n\0]/.test(entry)) throw error(t('server.terminal.oneRow'));
  } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid || '')) throw error(t('server.terminal.invalidId'));
  const dir = String(folder || '').replace(/^~(?=\/|$)/, HOME);
  if (!path.isAbsolute(dir) || !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw error(t('server.terminal.folder', { path: folder }));
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const iterm = fs.existsSync('/Applications/iTerm.app');
  if (entry != null) {
    const script = iterm
      ? ['on run argv', 'tell application "iTerm"', 'activate', 'set w to (create window with default profile)', 'tell current session of w', 'write text (item 1 of argv)', 'write text (item 2 of argv) newline NO', 'end tell', 'end tell', 'end run']
      : ['on run argv', 'set the clipboard to (item 2 of argv)', 'tell application "Terminal"', 'activate', 'do script (item 1 of argv)', 'end tell', 'end run'];
    return new Promise((resolve, reject) => execFile('osascript', [...script.flatMap((r) => ['-e', r]), `cd ${q(dir)}`, entry], { timeout: 15000 },
      (err, _o, se) => (err ? reject(new Error(t('server.terminal.notOpened', { error: (se || err.message).trim() }))) : resolve({ ok: true, app: iterm ? 'iTerm' : 'Terminal', entered: iterm }))));
  }
  const command = `cd ${q(dir)} && claude --resume ${sid}`;
  const script = iterm
    ? ['on run argv', 'tell application "iTerm"', 'activate', 'set w to (create window with default profile)', 'tell current session of w to write text (item 1 of argv)', 'end tell', 'end run']
    : ['on run argv', 'tell application "Terminal"', 'activate', 'do script (item 1 of argv)', 'end tell', 'end run'];
  return new Promise((resolve, reject) => execFile('osascript', [...script.flatMap((r) => ['-e', r]), command], { timeout: 15000 },
    (err, _o, se) => (err ? reject(new Error(t('server.terminal.notOpened', { error: (se || err.message).trim() }))) : resolve({ ok: true, app: iterm ? 'iTerm' : 'Terminal', command }))));
}

// 📁 Floor management: Finder "Choose folder" window (osascript choose folder), returns the path with ~ instead of the home folder.
// The browser never reveals a file or folder path, so the server on the Mac does the picking (2026-11-14). Only one window at a time.
let selectRunning = false;
function selectFolder() {
  if (!IS_MAC) return Promise.reject(Object.assign(new Error(t('server.pick.onlyMac')), { code: 501 }));
  if (selectRunning) return Promise.reject(Object.assign(new Error(t('server.pick.alreadyOpen')), { code: 409 }));
  selectRunning = true;
  const start = fs.existsSync(path.join(HOME, 'Development')) ? path.join(HOME, 'Development') : HOME;
  const script = ['on run argv', 'activate', t('server.pick.script'), 'end run'];
  return new Promise((resolve, reject) => execFile('osascript', [...script.flatMap((r) => ['-e', r]), start], { timeout: 300e3 }, (err, out, se) => {
    selectRunning = false;
    if (err) return /-128/.test(String(se)) ? resolve({ cancelled: true }) : reject(new Error(t('server.pick.failed', { error: (se || err.message).trim() })));
    let c = String(out).trim().replace(/\/$/, '');
    if (c === HOME || c.startsWith(HOME + '/')) c = '~' + c.slice(HOME.length);
    resolve({ path: c });
  }));
}

// JSON body, at most 40 MB (a message may carry screenshots as base64)
function body(req) {
  return new Promise((resolve, reject) => {
    let d = '', n = 0;
    req.on('data', (c) => { n += c.length; if (n > 40e6) { reject(new Error(t('server.body.tooBig'))); req.destroy(); } else d += c; });
    req.on('end', () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

// raw body (recording for transcription at most 25 MB, attachment 50 MB)
function bodyBin(req, max = 25e6, error = t('server.body.recording')) {
  return new Promise((resolve, reject) => {
    const pieces = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error(error)); req.destroy(); } else pieces.push(c); });
    req.on('end', () => resolve(Buffer.concat(pieces)));
  });
}

// core POST addresses that only the app page may send (module addresses are added by modules.js)
const onlyClickCore = () => ({ // a function: texts are composed in the City language only when used
  '/api/permission': t('server.onlyClick.permission'),
  '/api/card': t('server.onlyClick.card'),
  '/api/rules': t('server.onlyClick.rules'),
  '/api/control-center/commit': t('server.onlyClick.commit'),
  '/api/control-center/push': t('server.onlyClick.push'),
  '/api/terminal': t('server.onlyClick.terminal'),
  '/api/claude-app': t('server.onlyClick.claudeApp'),
  '/api/new-session': t('server.onlyClick.newSession'),
  '/api/world/floor': t('server.onlyClick.floor'),
  '/api/language': t('server.onlyClick.language'),
  '/api/world/select': t('server.onlyClick.pick'),
  '/api/dispatch/run': t('server.onlyClick.dispatchStart'),
  '/api/dispatch/prepare': t('server.onlyClick.dispatchPrepare'),
  '/api/dispatch/cancel': t('server.onlyClick.dispatchCancel'),
  '/api/dispatch/card': t('server.onlyClick.dispatchCard'),
  '/api/file/open': t('server.onlyClick.fileOpen'),
  '/api/sleep': t('server.onlyClick.sleep'),
  '/api/brain/answer': t('server.onlyClick.brainReply'),
  '/api/chronicler/toggle': t('server.onlyClick.chroniclerToggle'),
  '/api/chronicler/run': t('server.onlyClick.chroniclerStart'),
  '/api/scribe': t('server.onlyClick.scribe'),
});

// Mobile security (2026-11-24, risk from the atlas): tool permissions and cards that change agent rules (memory = CLAUDE.md, hiring = .claude/agents/)
// pass from mobile only with a Face ID no older than 2 min. The session (30 min) is enough for reading and writing messages. Always allow only on the Mac. Does not apply to the Mac (without req.fromMobile).
const FACE_ID_MS = 2 * 60e3, CARDS_FACE_ID = new Set(['memory', 'hire']);
const freshFaceId = (req) => !req.fromMobile || req.fromMobile.fromFaceId <= FACE_ID_MS;
const handler = async (req, res) => { // also for the mobile gateway (gateway.js): it sets req.fromMobile only after verifying the device, Face ID and a listed route
  // Protection against foreign pages: another website in the browser could otherwise send a task to an agent or click Allow (CSRF),
  // or reach the server via DNS rebinding. Host must be localhost/127.0.0.1 and POST only from our own page (Origin), or without Origin (curl).
  const host = String(req.headers.host || ''), allowed = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
  const origin = req.headers.origin, site = req.headers['sec-fetch-site'];
  if (!req.fromMobile && (!allowed.includes(host) || (req.method !== 'GET' && req.method !== 'HEAD' && ((origin && !allowed.some((h) => origin === `http://${h}`)) || (site && site !== 'same-origin' && site !== 'none'))))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(t('server.http.banned'));
  }
  const url = new URL(req.url, `http://${host}`);
  const post = req.method === 'POST', route = url.pathname, q = (k) => url.searchParams.get(k);
  // Approvals, cards and commit/push may be sent only by the app page (the browser adds Origin and Sec-Fetch-Site same-origin).
  // An agent could otherwise approve its own card via curl (2026-11-10, guard also in the agents.js hook).
  const onlyClick = { ...onlyClickCore(), ...MOD.onlyClick }[route]; // core addresses + enabled modules
  if (post && onlyClick && !req.fromMobile && (!origin || site !== 'same-origin')) return json(res, 403, { error: onlyClick }); // from mobile the gateway has already decided (token + Face ID + allowed route)
  try {
    // Lock (lock.js): without a valid tab key nothing under /api/* is reachable except the state and unlocking via Touch ID.
    if (route === '/api/lock/state') return json(res, 200, LOCK_DISABLED ? { unlocked: true, disabled: true } : { unlocked: verifyKey(req, url) });
    if (post && route === '/api/lock/unlock') {
      if (!origin || site !== 'same-origin') return json(res, 403, { error: t('server.lock.unlock') });
      const r = await unlock(); return json(res, r.ok ? 200 : 401, r);
    }
    if (post && route === '/api/lock/lock') { lock(req, url); return json(res, 200, { ok: true }); }
    if (route.startsWith('/api/') && !req.fromMobile && !verifyKey(req, url)) return json(res, 401, { error: t('server.lock.locked'), locked: true });
    if (post && route === '/api/lock/activity') { activity(req, url); return json(res, 200, { ok: true }); }
    if (route === '/api/world') {
      world = buildWorld({ fileSettings: WORLD_JSON });
      const complete = (p) => ({ ...p, ...floorState(p.id), team: publicTeam(p) });
      const m = world.brain && { ...world.brain, id: 'brain', ...floorState('brain'), team: world.brain.path ? publicTeam(world.brain.path) : [] };
      const c = world.controlCenter && { ...world.controlCenter, id: 'control-center', ...floorState('control-center'), team: publicTeam(world.controlCenter) };
      const home = MOD.floors(); // Home module buildings for mobile (virtual floors, not in the world)
      return json(res, 200, { ...world, modules: MOD.loaded, brain: m, controlCenter: c, home, buildings: world.buildings.map((b) => ({ ...b, floors: b.floors.map(complete), archive: b.archive.map(complete) })) });
    }
    if (route === '/api/world/message') return json(res, 200, listMessages(WORLD_JSON)); // Floor management: all candidates including hidden and archived (floor-admin.js)
    if (post && route === '/api/language') { // City language: writes `language` to world.json (other keys stay) and applies right away to server texts and agent prompts
      if (req.fromMobile) return json(res, 403, { error: t('server.language.mobile') });
      try { const d = await body(req); changeLanguage(WORLD_JSON, d?.language); world = buildWorld({ fileSettings: WORLD_JSON }); return json(res, 200, { ok: true, language: language() }); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
    }
    if (post && route === '/api/world/floor') {
      try { return json(res, 200, changeFloor(WORLD_JSON, await body(req))); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
    }
    if (post && route === '/api/world/select') {
      try { return json(res, 200, await selectFolder()); } catch (e) { return json(res, e.code || 500, { error: e.message }); }
    }
    if (route === '/api/login') return json(res, 200, await verifyLogin());
    if (route === '/api/notifications') { // muting notifications: GET state, POST { rezim } or { quietMin } (notifications.js)
      if (!post) return json(res, 200, notificationState());
      try { const r = changeNotifications(await body(req)); emit({ kind: 'notifications', status: r }); return json(res, 200, r); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
    }
    if (route === '/api/sleep') { // Mac sleep: GET state, POST { rezim: bezny | agenti | nikdy } (sleep.js); from mobile via the gateway
      if (!post) return json(res, 200, sleepState());
      try { return json(res, 200, changeSleep(await body(req))); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
    }
    if (route === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': ahoj\n\n');
      res.notif = q('notif') === '1'; // an app window with 🔔 on and browser notifications allowed shows them itself
      clients.add(res); withoutClient = Date.now(); if (!req.fromMobile) watchStream(req, url, res); // the mobile stream is closed by the gateway when the session expires
      if (!LIMITS.time || Date.now() - LIMITS.time > 55000) loadLimits(emitLimits);
      req.on('close', () => clients.delete(res));
      return;
    }
    // phase 3: conversations with agents
    if (route === '/api/state') return json(res, 200, { conversations: allSummaries(), limits: LIMITS });
    if (route === '/api/conversations') {
      const d = await floorConversations(q('floor'));
      return d ? json(res, 200, d) : json(res, 404, { error: t('server.http.unknownFloor') });
    }
    if (route === '/api/commands') { // slash commands for the menu after "/" (agents.js floorCommands, cache 10 min)
      try { const z = await floorCommands(q('floor')); return z ? json(res, 200, { commands: z }) : json(res, 404, { error: t('server.http.unknownFloor') }); }
      catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (route === '/api/conversation') {
      const d = await conversationDetail(q('id') || '');
      return d ? json(res, 200, d) : json(res, 404, { error: t('server.http.unknownConversation') });
    }
    if (post && route === '/api/message') {
      try { return json(res, 200, { conv: await sendMessage(await body(req)) }); }
      catch (e) { return json(res, e.code || 500, { error: e.message, ...(e.alert ? { alert: e.alert } : {}) }); } // 428: warning about an expensive continuation
    }
    if (post && ['/api/conv/rename', '/api/conv/hide', '/api/conv/trash', '/api/conv/resolve', '/api/conv/edit', '/api/conv/pin'].includes(route)) { // rename, hide, trash, resolved, pin, edit a sent message
      const f = { '/api/conv/rename': rename, '/api/conv/hide': hide, '/api/conv/trash': toTrash, '/api/conv/resolve': resolveConv, '/api/conv/edit': editMessage, '/api/conv/pin': pin }[route];
      try { return json(res, 200, await f(await body(req))); } catch (e) { return json(res, e.code || 500, { error: e.message }); }
    }
    if (post && route === '/api/terminal') { // ⌘ terminal: opens iTerm (otherwise Terminal) with claude --resume in the session folder (2026-11-12)
      try { return json(res, 200, await openTerminal(await body(req))); } catch (e) { return json(res, e.code || 500, { error: e.message }); }
    }
    if (post && route === '/api/claude-app') { // "run in Claude app" card: deep link claude://code/new via `open` (2026-11-16)
      try { const d = await body(req); if (req.fromMobile && d.no !== true) return json(res, 403, { error: t('server.http.mobileCard') }); return json(res, 200, await openInApp(d)); } catch (e) { return json(res, e.code || 500, { error: e.message }); } // mobile (2026-11-23): Close only
    }
    if (post && route === '/api/new-session') { // "run in a new session" card (run_in_new_session): a new conversation via startTask like Dispatch, or No
      try {
        const d = await body(req), K = newSessionCard(String(d.id || ''), String(d.kid || ''));
        if (!K) return json(res, 404, { error: t('server.http.cardNotFound') });
        if (K.s.status !== 'proposed') return json(res, 400, { error: t('server.http.cardResolved') });
        if (d.no === true) { K.edit({ status: 'no' }); return json(res, 200, { ok: true }); }
        if (req.fromMobile) return json(res, 403, { error: t('server.http.newSessionMac') });
        const assignment = String(d.assignment ?? K.s.assignment ?? '').trim(), title = String(d.title ?? K.s.title ?? '').trim();
        K.edit({ status: 'starts' }); // blocks a double click while the conversation is being created
        try {
          const r = await startTask({ floor: K.floor, agent: 'lead', title: title, message: assignment }, { sendMessage, findFloor });
          K.edit({ status: 'started', conv: r.id, assignment, title });
          return json(res, 200, { ok: true, conv: r.id });
        } catch (e) { K.edit({ status: 'proposed' }); throw e; }
      } catch (e) { return json(res, e.code || 500, { error: e.message }); }
    }
    if (post && route === '/api/stop') { const { id } = await body(req); return json(res, (await stop(id)) ? 200 : 404, { ok: true }); }
    if (post && route === '/api/send-now') { const { id } = await body(req); return json(res, 200, { ok: sendImmediately(id) }); } // queued message: interrupt the turn so the agent reads it right away
    if (post && route === '/api/cancel-from-queue') { const { id, uuid } = await body(req); return json(res, 200, { ok: await cancelFromQueue(id, uuid) }); } // queued message: take it out before the agent reads it
    if (post && route === '/api/permission') {
      const { id, decision, message } = await body(req);
      if (!['allow', 'always', 'reject'].includes(decision)) return json(res, 400, { error: t('server.http.unknownDecision') });
      if (req.fromMobile && decision === 'always') return json(res, 403, { error: t('server.http.allowAlways') });
      if (decision === 'allow' && !freshFaceId(req)) return json(res, 401, { error: t('server.http.faceId'), freshFaceId: true });
      return json(res, decide(id, decision, message) ? 200 : 404, { ok: true });
    }
    if (post && route === '/api/card') { const d = await body(req); if (d.yes && CARDS_FACE_ID.has(cardType(d.id)) && !freshFaceId(req)) return json(res, 401, { error: t('server.http.faceId'), freshFaceId: true }); const r = decideCard(d.id, d); return json(res, r.error ? 404 : 200, r); }
    if (route === '/api/rules') {
      if (post) return json(res, 200, { rules: cancelRule(q('floor'), (await body(req)).key) });
      return json(res, 200, { rules: rules(q('floor')) });
    }
    if (route === '/api/image') { // screenshot from a message (data/obrazky, name = content hash)
      const s = image(q('id') || '');
      if (!s) { res.writeHead(404); return res.end(t('server.http.notFound')); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(s)] || 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' });
      return fs.createReadStream(s).pipe(res);
    }
    if (post && route === '/api/attachment') { // file upload: body = content, ?title= original name
      try { return json(res, 200, saveAttachment(q('title'), await bodyBin(req, 50e6, t('server.http.file50')))); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    // File preview (files.js): allowed roots only (Brain, buildings), read only; opening in Obsidian / an app only by a click (onlyClick), not from mobile
    if (!post && route === '/api/file') { try { return json(res, 200, filePreview(q('path'), q('base'))); } catch (e) { return json(res, e.code || 400, { error: e.message }); } }
    if (!post && route === '/api/file/raw') {
      let s; try { s = rawFile(q('path'), q('base')); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
      res.writeHead(200, rawHeaders(s));
      return fs.createReadStream(s.real).on('error', () => res.destroy()).pipe(res);
    }
    if (post && route === '/api/file/exist') { try { const d = await body(req); return json(res, 200, existFiles(d.paths, d.base)); } catch (e) { return json(res, e.code || 400, { error: e.message }); } }
    if (post && route === '/api/file/open') { try { const d = await body(req); return json(res, 200, await openFile(d.path, d.where, d.base)); } catch (e) { return json(res, e.code || 400, { error: e.message }); } }
    if (route === '/api/attachment') { // opening an attachment from its chip; nothing in it runs as an app page (sandbox, nosniff)
      const s = attachment(q('id') || '');
      if (!s) { res.writeHead(404); return res.end(t('server.http.notFound')); }
      const ext = path.extname(s).toLowerCase(), text = ['.json', '.txt', '.csv', '.md', '.log', '.xml', '.yml', '.yaml', '.py', '.js', '.ts', '.hs', '.html', '.css', '.sql'].includes(ext);
      const type = ext === '.pdf' ? 'application/pdf' : ['.png', '.jpg', '.gif', '.webp'].includes(ext) ? TYPES[ext] : text ? 'text/plain; charset=utf-8' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox', 'Cache-Control': 'no-store',
        'Content-Disposition': `${type === 'application/octet-stream' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(path.basename(s))}` });
      return fs.createReadStream(s).pipe(res);
    }
    // Control center: app git state, file diff, commit (and push) only by a click in the app (POST with Origin and Sec-Fetch-Site same-origin, not curl without them)
    if (route === '/api/control-center') return json(res, 200, { ...(await controlCenterState(ROOT)), restart: restartState() });
    if (route === '/api/control-center/diff') { try { return json(res, 200, await diffControlCenter(ROOT, q('file') || '')); } catch (e) { return json(res, e.code || 500, { error: e.message }); } }
    if (post && route === '/api/control-center/push') { // push of unpushed commits (main → origin), without a commit
      try { const r = await pushControlCenter(ROOT); emit({ kind: 'control-center', push: r.dest }); return json(res, 200, r); }
      catch (e) { return json(res, e.code || 500, { error: e.message }); }
    }
    if (post && route === '/api/control-center/commit') {
      try { const r = await commitControlCenter(ROOT, await body(req)); emit({ kind: 'control-center', commit: r.hash }); return json(res, 200, r); }
      catch (e) { return json(res, e.code || 500, { error: e.message }); }
    }
    if (post && route === '/api/router') { // router: Haiku proposes a floor and an agent, runs nothing (router.js)
      const { text } = await body(req);
      const r = await proposeFloor(text, floorRouter());
      return json(res, r.error ? (r.error === t('server.router.emptyText') ? 400 : 502) : 200, r);
    }
    // Dispatch (dispatch.js): splitting free text into tasks (Sonnet), starting a task = a new conversation, prepared tasks in data/dispecing.json
    if (route === '/api/dispatch' && !post) return json(res, 200, dispatchState());
    if (post && route.startsWith('/api/dispatch/')) {
      try {
        const d = await body(req);
        if (route === '/api/dispatch/split') {
          const r = await splitTasks(d.text, floorRouter());
          return json(res, r.error ? (r.error === t('server.router.emptyText') ? 400 : 502) : 200, r);
        }
        if (route === '/api/dispatch/run') return json(res, 200, await startTask(d, { sendMessage, findFloor }));
        if (route === '/api/dispatch/prepare') return json(res, 200, prepareTask(d, { findFloor }));
        if (route === '/api/dispatch/cancel') return json(res, 200, cancelTask(d));
        if (route === '/api/dispatch/card') return json(res, 200, await decideTask(d, { sendMessage, findFloor, taskCard })); // task card in the Dispatcher chat (propose_tasks)
        return json(res, 404, { error: t('server.http.unknownActionDispatch') });
      } catch (e) { return json(res, e.code || 400, { error: e.message }); }
    }
    if (route === '/api/tools') return json(res, 200, toolState()); // MCP servers from `claude mcp list` (tools.js, cache 15 min)
    if (route === '/api/limits') return json(res, 200, LIMITS);
    if (route === '/api/names') { // running conversation title (agents.js instructionTitle), Settings window → Chat
      if (!post) return json(res, 200, namesState());
      try { return json(res, 200, setNames(await body(req))); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
    }
    if (route === '/api/saving') { // saving level = cap of a single message (usage.js UROVNE), Settings window → Usage
      if (!post) return json(res, 200, savingState());
      try { return json(res, 200, setSaving((await body(req)).level)); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
    }
    if (route === '/api/limits/breakdown' && !post) { // how much of the 5 h / week each session used, Claude app included (usage-sessions.js, 2026-11-19)
      try { return json(res, 200, await usageBreakdown(q('window') === 'week' ? 'week' : 'h5', { limits: LIMITS, conversations: allSummaries(), floors: [...allFloor(), findFloor('brain')].filter(Boolean) })); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    // Routes of optional modules (Home, Mail, City on mobile): modules.js loads them only when enabled in world.json, otherwise these addresses do not exist
    // Brain: activity, orphaned notes and Chronicler questions to confirm (chronicler-night.js); answer only by a click in the app (onlyClick, not from mobile)
    if (route === '/api/brain' && !post) { try { return json(res, 200, { ...brainData(), questions: pendingQuestions(), chronicler: chroniclerState() }); } catch (e) { return json(res, 500, { error: e.message }); } }
    if (post && route === '/api/brain/answer') { try { return json(res, 200, replyToQuestion(await body(req))); } catch (e) { return json(res, e.code || 400, { error: e.message }); } }
    // Chronicler (chronicler-night.js): nightly run over the notes, 23:30, on by default; toggle and Run now only by a click (onlyClick)
    if (route === '/api/chronicler' && !post) return json(res, 200, chroniclerState());
    if (post && route.startsWith('/api/chronicler/')) {
      try {
        const d = await body(req);
        if (route === '/api/chronicler/toggle') { const r = toggleChronicler(d.task, d.enabled === true); emit({ kind: 'brain', type: 'chronicler' }); return json(res, 200, r); }
        if (route === '/api/chronicler/run') { await startChronicler(d.task); return json(res, 200, chroniclerState()); }
        return json(res, 404, { error: t('server.http.unknownActionChronicler') });
      } catch (e) { return json(res, e.code || 400, { error: e.message }); }
    }
    if (route === '/api/scribe') { // Scribe after a turn (scribe.js), Settings window → Chat; change only by a click (onlyClick)
      if (!post) return json(res, 200, scribeState());
      try { return json(res, 200, changeScribe(await body(req))); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
    }
    if (await MOD.handle({ req, res, url, post, path: route, q, body, bodyBin, json: (r, code, obj) => { json(r, code, obj); return true; } })) return;
    if (['/api/today', '/api/home', '/api/tower'].includes(route) && !MOD.loaded.home) return json(res, 404, { error: t('server.http.moduleHome') }); // the app takes 404 as "without Home"
    if (post && route === '/api/speak') { // Autopilot on mobile: text → MP3 (Azure, speak.js)
      if (!fs.existsSync(path.join(ROOT, 'speak.js'))) return json(res, 404, { error: t('server.http.voice') }); // optional, in the package it belongs to the mobile module
      try { const { speak } = await import('./speak.js'); const { b, type, voice } = await speak((await body(req)).text); res.writeHead(200, { 'Content-Type': type, 'Content-Length': b.length, 'Cache-Control': 'no-store', 'X-Hlas': voice }); return res.end(b); }
      catch (e) { return json(res, e.code || 500, { error: e.message }); }
    }
    if (post && route === '/api/transcript/prepare') { prepareTranscription().catch(() => {}); return json(res, 200, { ok: true }); }
    if (post && route === '/api/transcript') {
      try {
        const type = String(req.headers['content-type'] || 'audio/webm');
        return json(res, 200, await transcription(await bodyBin(req), type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm'));
      } catch (e) { return json(res, 500, { error: e.message }); }
    }

    // Preview: /nahlad/ = the app from the worktree ../mesto-agentov-nahlad (preview branch), on the same API and data.
    if (url.pathname === '/preview') { res.writeHead(302, { Location: '/preview/' }); return res.end(); }
    if (url.pathname.startsWith('/preview/') && fs.existsSync(PREVIEW)) {
      const rest = url.pathname.slice('/preview'.length), s = path.join(PREVIEW, rest === '/' ? 'index.html' : rest);
      if (!s.startsWith(PREVIEW + path.sep) || !fs.existsSync(s) || !fs.statSync(s).isFile()) { res.writeHead(404); return res.end(t('server.http.notFound')); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(s)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(s).pipe(res);
    }

    // static files from public/ (and KaTeX, highlight.js from node_modules under /vendor/…)
    const ven = Object.keys(VENDOR).find((v) => url.pathname.startsWith(v)), root = ven ? VENDOR[ven] : path.join(ROOT, 'public');
    const file = ven ? path.join(root, url.pathname.slice(ven.length)) : path.join(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      return res.end(t('server.http.notFound'));
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); // always current modules after an app change (the browser only asks whether they changed)
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
};
const server = http.createServer(handler);

// localhost only, never to the network (mobile goes through the gateway.js gateway, which calls `handler` only after verification).
server.listen(PORT, '127.0.0.1', () => {
  console.log(t('server.start.running', { port: PORT }));
  for (const p of MOD.start({ handler })) Promise.resolve(p).then((b) => b?.status && console.log(t('server.start.brana', { status: b.status().status, detail: b.status().detail ? ' (' + b.status().detail + ')' : '' }))).catch((e) => console.warn(t('server.start.moduleError'), e.message)); // mobile gateway (module-mobile.js)
  verifyLogin().then((a) => {
    if (!a.loggedIn) console.log(t('server.start.loggedOut'));
    else console.log(t('server.start.login', { method: a.authMethod, subscription: a.subscriptionType ? ' (' + a.subscriptionType + ')' : '' }));
    console.log(t('server.start.agents', { version: CLAUDE_VERSION || '?', source: CLAUDE_BIN ? t('server.start.your') : t('server.start.bundled') }));
  });
  startTools({ bin: CLAUDE_BIN, env: cleanEnv() }); // `claude mcp list` in the background after start
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { saveAll(); } catch {} releaseSleep(); stopTranscription(); stopLimits(); process.exit(0); });
