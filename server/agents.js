// agents.js – Phase 3: floors = real Claude Code agents (Agent SDK on top of your `claude` CLI).
//
// Conversations: data/conversations.json (list) + data/messages/<id>.json (messages in the app's shape, as in design v13b).
//               A floor has several: the lead (agent 'lead') and employees (agent = name from .claude/agents).
//               Delegated task (Agent tool) = nested conversation with `parent`, runs in the parent's session.
//               Older Claude Code sessions in the floor's folder sit under the lead (id 's:<sid>'), they can be read and continued.
// Stream:        SDK events (includePartialMessages) → app events via emit(): conv, message, edit, delta, team, tool.
// Approval:      canUseTool → card Allow / Always / Deny, "always" rules per floor in data/permissions.json.
// Hiring:        the lead's own tools (createSdkMcpServer "agentic"): propose_team, propose_memory. The files
//               .claude/agents/<name>.md and CLAUDE.md are written by the server only after a click in the app, the agent must not write them directly.
// Restart:      mcp__agentic__restart_server (Control center only): card → self-test → process exit → launchd → message via resume.
// Map and API: brain Projekty/mesto-agentov/technika.md (phase 3).

import { createSdkMcpServer, getSessionMessages, listSessions, query, renameSession, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { fillTemplate, noteCandidates, userLabel, loadSetting, loadSessions, normalizeNotes, bannedPush } from './build-world.js';
import { commitNow, underLaunchd, serverSelftest } from './control-center.js';
import { toolId } from './tools.js';
import { WRITE_TOOLS, toolPath, filePreview } from './files.js';
import { units, toPercent, toUnits, tally, learnFromResult, settings as settingsUsage, taskEstimate, estimatesByModel } from './usage.js';
import { usageInWindow } from './usage-sessions.js';
import { record as recordBrain } from './brain-activity.js';
import { t as tl } from './i18n.js';
import * as wakeups from './wakeups.js'; // wake_when tool: waits for a detached job and wakes the agent
import { commitFromStep, scribeCard, processTurn, resolveCard as resolveScribeCard } from './scribe.js'; // Scribe after a turn (2026-11-25)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IS_MAC } from './platform.js';

const HOME = os.homedir();
// The user's name is `user.name` in world.json. Texts for agents and cards never inflect it: "the user" or "the user (Name)".
export const who = () => userLabel(settingWorld().user?.name);
const Who = () => { const x = who(); return x[0].toUpperCase() + x.slice(1); };
let limitsStatus = () => null; // current subscription limits (extras.js LIMITS) for usage.js
let questionChronicler = null; // Chronicler (chronicler-night.js via server.js): the confirm_question tool on the floor centrala/kronikar
let DATA, findFloor, dispatcher = null, emitOut, changeLimits, WORLD_JSON, allPaths = () => [], ROOT = null, endProcess = null;
let CONV_FILE, MESSAGES_DIR, PERMISSIONS, IMAGES_DIR, ATTACHMENTS_DIR, HIDDEN_FILE;
let HIDDEN = new Set(); // sids of older Claude Code sessions hidden in the City (the files stay)

// Which `claude` runs the agents: yours installed from the terminal, if it is at least as new as the one bundled in the Agent SDK, otherwise
// the bundled one (undefined = the SDK takes its own). Both share the login (~/.claude, keychain). An old claude does not know new
// models: the alias `opus` in 2.1.183 meant Opus 4.8 and it could not call Opus 5.5 correctly (2026-11-09).
const version = (bin) => { try { return (execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 }).match(/\d+\.\d+\.\d+/) || [''])[0]; } catch { return ''; } };
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
export let CLAUDE_BIN, CLAUDE_VERSION = '';
try {
  const my = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]; // where (Windows) prints several lines
  const bundled = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'claude.exe' : 'claude');
  const vm = my ? version(my) : '', vp = fs.existsSync(bundled) ? version(bundled) : '';
  CLAUDE_BIN = vm && (!vp || !newer(vp, vm)) ? my : undefined; CLAUDE_VERSION = CLAUDE_BIN ? vm : vp;
} catch { CLAUDE_BIN = undefined; }

// Model and effort of agents. Order: choice in the conversation → floor in world.json ("model", "effort") → "agents" in world.json
// → PRESET. Only from these lists (nothing else gets from the browser to the CLI).
export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5' },
  { id: 'claude-fable-5-1', name: 'Fable 5.1' },
];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Permission mode (2026-11-10): as in Claude Code. bypassPermissions is deliberately missing (everything without asking, even outside the folder).
// The guards in HOOKS apply in every mode: push to the school GitLab, writes to .claude/agents and CLAUDE.md, permanent deletion.
// Since 2026-11-10 also the Control center guards (guardCity): data/, node_modules/, old prototypes, the City server, commit/push/approvals via the API.
export const MODES = [
  { id: 'default', get name() { return tl('server.mode.default.name'); }, get description() { return tl('server.mode.default.description'); } },
  { id: 'acceptEdits', get name() { return tl('server.mode.acceptEdits.name'); }, get description() { return tl('server.mode.acceptEdits.description'); } },
  { id: 'plan', get name() { return tl('server.mode.plan.name'); }, get description() { return tl('server.mode.plan.description'); } },
  { id: 'auto', name: 'Auto', get description() { return tl('server.mode.auto.description'); } },
];
const PRESET = { model: 'claude-opus-5-5', effort: 'medium', mode: 'auto' }; // 2026-11-10: all new conversations default to Auto (the user's decision)
const validModel = (m) => (MODELS.some((x) => x.id === m) ? m : null);
const validEffort = (e) => (EFFORTS.includes(e) ? e : null);
const validMode = (r) => (MODES.some((x) => x.id === r) ? r : null);

// The desktop app (and other tools) may put their own login or API key into the environment. We remove them
// so that `claude` uses your login from `claude auth login` (subscription), never an API key.
export function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDECODE$|CLAUDE_AGENT_SDK|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW|AI_AGENT$|BAGGAGE$)/.test(k)) delete env[k];
  }
  env.MCP_TOOL_TIMEOUT = String(24 * 3600 * 1000); // the hiring card waits for your click (own "agentic" tool)
  // "Stream idle timeout - partial response received" (2026-11-09): while the model writes a tool input (e.g. propose_team),
  // the API sends nothing without incremental streaming and the Claude Code watchdog drops the connection after 180 s. Let tool input stream
  // incrementally (eager_input_streaming) and the watchdog wait 10 min, as with long thinking.
  env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING = '1';
  env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = String(10 * 60 * 1000);
  // Background employees (2026-11-18): after the lead's turn result the SDK waits for the "idle" state at most 10 min
  // (CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, default 600 000), then closes the CLI's stdin. Hooks and canUseTool then
  // have nowhere to go and the CLI denies EVERY employee tool including SubagentHandback ("The user doesn't want to take this
  // action…"): the final report is not delivered and the lead claims the user denied it. We wait up to 4 h (Stop closes the CLI at once).
  env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = String(4 * 3600 * 1000);
  return env;
}

// These tools only read or plan, they run without asking. Everything else (Edit, Write, Bash, WebFetch, MCP…) waits for a click.
// restart_server shows its own card (in every mode), so it is here and does not go through canUseTool.
// SubagentHandback (an employee's final report) and ToolSearch (loading a schema) must go without a card: a background employee
// and a turn started by a notification have nowhere to show an approval, the CLI then denies them ("The user doesn't want…") and the message is lost.
const WITHOUT_ASKING = ['Read', 'Glob', 'Grep', 'Agent', 'Task', 'TodoWrite', 'Skill', 'SubagentHandback', 'ToolSearch','mcp__agentic__propose_team', 'mcp__agentic__propose_memory', 'mcp__agentic__view_conversation', 'mcp__agentic__restart_server', 'mcp__agentic__propose_title', 'mcp__agentic__propose_tasks', 'mcp__agentic__run_in_claude_app', 'mcp__agentic__run_in_new_session', 'mcp__agentic__personal_mail', 'mcp__agentic__plan', 'mcp__agentic__show_file', 'mcp__agentic__confirm_question', 'mcp__agentic__wake_when', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'];
const WRITE = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

// Banned push: `guards.bannedPush` in world.json is a list of git remote hosts (e.g. "gitlab.example.com"), empty by default.
// A push to such a host is always done by the user by hand (typically submitting school homework). Pushes to other repositories go normally through the Allow card.
// Hard ban in every mode: the PreToolUse hook runs before the "Always" rules, before permissions from settings.json and before the card,
// so it cannot be allowed even by mistake.
// Detects a push also in `cd x && git -C y push`, `git -c k=v push`, `sh -c "git push"`, `git subtree|lfs push`, `git send-pack`.
// Repository: the address in the command, or the remote of the folder where the command runs (cwd, `cd …`, `git -C …`, `--git-dir`).
const PUSH = /(?:^|[^\w.-])git(?:\s+(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path)(?:\s+|=)\S+|\s+-{1,2}[\w-]+(?:=\S+)?)*\s+(?:(?:subtree|lfs)\s+(?:-\S+\s+)*)?(?:push|send-pack)\b/;
export const isPush = (command) => PUSH.test(String(command || ''));
const withoutQuotes = (x) => x.replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, os.homedir()).replace(/^\$HOME(?=\/|$)/, os.homedir());
function foldersCommand(command, cwd) {
  const out = new Set([cwd]); let update = cwd;
  for (const piece of String(command).split(/&&|\|\||[;|\n]/)) {
    const cd = /^\s*(?:cd|pushd)\s+("[^"]+"|'[^']+'|\S+)/.exec(piece);
    if (cd) { update = path.resolve(update, withoutQuotes(cd[1])); out.add(update); }
    for (const m of piece.matchAll(/(?:-C|--git-dir|--work-tree)(?:\s+|=)("[^"]+"|'[^']+'|\S+)/g)) out.add(path.resolve(update, withoutQuotes(m[1])));
  }
  return [...out];
}
const hosts = () => { try { return bannedPush(WORLD_JSON || path.join(CITY, 'world.json')); } catch { return []; } };
const hostRe = (h) => new RegExp(h.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
const bannedRepo = (dir, re) => { while (dir && !fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir); try { return re.test(execFileSync('git', ['-C', dir, 'remote', '-v'], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch { return false; } };
export const pushBanned = (command, cwd = process.cwd()) => {
  const h = hosts(); if (!h.length || !isPush(command)) return false;
  const re = hostRe(h);
  return re.test(command) || foldersCommand(command, cwd).some((d) => bannedRepo(d, re));
};
const BAN_PUSH = () => tl('prompt.ban.push');
// Permanent deletion (rm, rmdir, unlink, git clean, find -delete, shred) in modes without a card (Edit without asking, Auto):
// banned, deleting only by moving to the Trash. In Ask mode it goes through a card, where the user sees it and decides.
const DELETION = /(?:^|[;&|(`\n]|\$\()\s*(?:sudo\s+)?(?:rm|rmdir|unlink|shred)\b|\bgit\s+clean\b|\bfind\b[^;&|]*\s-delete\b/;
export const isDeletion = (command) => DELETION.test(String(command || ''));
const BAN_DELETION = () => tl('prompt.ban.deletion');
const BAN_PROTECTED = () => tl('prompt.ban.protected');
// ---------- Control center guards (step 6, 2026-11-10) ----------
// They apply in every mode (also Auto and "Always allow"), because the PreToolUse hook checks them, and canUseTool once more.
// A Write/Edit is judged by its target path (does not slow down other projects, concerns only City files).
// Bash: data/, node_modules/, prototypes, kill/launchctl/node server.js only when the command runs in the City folder or
// mentions it; the City server (port 4747, launchd service, server PID) and the approval API (commit, push, cards) everywhere.
const CITY = path.dirname(path.dirname(fileURLToPath(import.meta.url))).normalize('NFC');
// launchd service: the user's instance label ends in mesto-agentov, the product's in agentic-platform
const SERVICE_NAME = /mesto-agentov|agentic-platform/;
const PLIST_RE = new RegExp('^' + path.join(HOME, 'Library', 'LaunchAgents').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/(?:[\\w-]+\\.)*(?:mesto-agentov|agentic-platform)\\.plist$');
// data/ plus the migration copies next to it (data-backup-<date>/, older data-zaloha-<date>/, data.migrating/ while migrating)
const DATA_DIR_RE = /^data(?:-(?:backup|zaloha)[^/]*|\.migrating[^/]*)?(?:\/|$)/;
// Approval API the agent never calls (only the user by clicking). Both shapes are guarded during the transition:
// the English routes (current code) and the original Slovak ones (older floors, agents and notes still know them).
const CLICK_API = /\/api\/(?:control-center\/(?:commit|push)|permission|card|claude-app|new-session|rules|sorting\/(?:proposal|exceptions|approve|is)|inbox|house\/(?:diary|toggle|run)|mail\/(?:answer|toggle|run|pass\/(?:action|resolve|collect|explain))|library\/(?:rating|toggle|run)|garden\/uncheck|playground\/(?:write|toggle|run)|tasks\/(?:change|new|names|restore|toggle|run)|dispatch\/(?:run|prepare|cancel|card)|brain\/answer|chronicler\/(?:toggle|run)|scribe)\b/;
const CLICK_API_LEGACY = /\/api\/(?:centrala\/(?:commit|push)|povolenie|karta|claude-appka|nova-session|pravidla|triedenie\/(?:navrh|vynimky|schval|is)|inbox|dom\/(?:dennik|prepni|spusti)|posta\/(?:odpoved|prepni|spusti|pas\/(?:akcia|vybav|zber|vysvetli))|kniznica\/(?:hodnotenie|prepni|spusti)|zahrada\/odskrtni|ihrisko\/(?:zapis|prepni|spusti)|ulohy\/(?:zmen|nova|nazvy|obnov|prepni|spusti)|dispecing\/(?:spusti|priprav|zrus|karta)|mozog\/odpoved|kronikar\/(?:prepni|spusti)|zapisovac)\b/;
const inCity = (a) => a === CITY || a.startsWith(CITY + '/');
const BAN_DATA = () => tl('prompt.ban.data');
const BAN_NODE = () => tl('prompt.ban.node');
const BAN_PROTOTYPE = () => tl('prompt.ban.prototype');
const BAN_SERVER = () => tl('prompt.ban.server');
const BAN_CLICK = () => tl('prompt.ban.click');
// protected path (absolute) → ban reason or null. maz = the command deletes or moves (also catches deleting a whole folder above data/)
function protectedPath(abs, deleting = false) {
  abs = String(abs).normalize('NFC').replace(/(.)\/+$/, '$1');
  if (PLIST_RE.test(abs)) return BAN_SERVER();
  if (deleting && (abs === CITY || CITY.startsWith(abs === '/' ? '/' : abs + '/'))) return BAN_DATA();
  if (!inCity(abs)) return null;
  const rel = path.relative(CITY, abs);
  if (DATA_DIR_RE.test(rel)) return BAN_DATA();
  if (rel === 'node_modules' || rel.startsWith('node_modules/')) return BAN_NODE();
  if (/^public\/dizajn-v[^/]*\.html$/.test(rel) && fs.existsSync(abs)) return BAN_PROTOTYPE();
  return null;
}
export const guardWrite = (file, cwd) => (file ? protectedPath(path.resolve(cwd || CITY, withoutQuotes(String(file)))) : null);
const WRITING = /^(rm|rmdir|unlink|shred|mv|cp|tee|touch|truncate|ln|chmod|chown|sed|perl|dd|install|rsync)$/;
const DELETING = ['rm', 'rmdir', 'unlink', 'shred', 'mv'];
const AGO_COMMAND = /^(sudo|command|exec|nohup|time|xargs|env|nice|timeout)$/;
const tokens = (x) => x.match(/"[^"]*"|'[^']*'|[^\s"']+/g) || [];
const REDIRECT = /(?:^|[^<>&\d])\d?>>?\s*("[^"]+"|'[^']+'|[^\s;&|<>]+)/g;
export function guardBash(command, cwd = CITY) {
  const c = String(command || '');
  // everywhere: the approval API and the City server
  if (CLICK_API.test(c) || CLICK_API_LEGACY.test(c)) return BAN_CLICK();
  const secretHit = secretInCommand(c, cwd || CITY); if (secretHit) return secretHit; // City tokens and keys (cat, grep, cp…), also in Bash
  if (/\blaunchctl\b/.test(c) && SERVICE_NAME.test(c)) return BAN_SERVER();
  if (/\b(?:kill|pkill|killall)\b/.test(c) && (/\b4747\b/.test(c) || /\b(?:node|server\.js|watchdog\.js|strazca\.js|city-agents)\b/.test(c) || new RegExp(`\\b${process.pid}\\b`).test(c))) return BAN_SERVER();
  const dirs = foldersCommand(c, cwd || CITY);
  if (!(dirs.some((d) => inCity(String(d).normalize('NFC'))) || c.includes(CITY) || SERVICE_NAME.test(c))) return null;
  // in the City folder
  if (/(?:^|[;&|(`\n]|\$\(|\b(?:sudo|xargs|exec|nohup|command)\s|\btimeout\s+\S+\s)\s*(?:kill|pkill|killall|launchctl)\b/.test(c)) return BAN_SERVER();
  if (/(?:^|[;&|(`\n]|\$\()\s*(?:\w+=\S*\s+)*npm\s+(?:run\s+)?start\b/.test(c)) return BAN_SERVER();
  for (const m of c.matchAll(/\bnode((?:\s+-[^\s;&|]+)*)\s+("[^"]*"|'[^']*'|[^\s;&|]+)([^;&|\n]*)/g)) {
    if (/(?:^|\s)(?:--check|-c)(?:\s|$)/.test(m[1])) continue; // node --check server.js only checks syntax
    // only the self-test may run (--selftest; --skuska is the old name the running server's restart tool still uses)
    if (/^(?:.*\/)?(?:server|strazca|watchdog)\.js$/.test(withoutQuotes(m[2])) && !/--(?:selftest|skuska)\b/.test(m[3])) return BAN_SERVER();
  }
  let update = cwd || CITY;
  for (const piece of c.split(/&&|\|\||[;|\n]/)) {
    const cd = /^\s*(?:cd|pushd)\s+("[^"]+"|'[^']+'|\S+)/.exec(piece);
    if (cd) { update = path.resolve(update, withoutQuotes(cd[1])); continue; }
    const targets = [];
    for (const m of piece.matchAll(REDIRECT)) if (!m[1].startsWith('&') && m[1] !== '/dev/null') targets.push([m[1], false]);
    const t = tokens(piece.replace(REDIRECT, ' '));
    let i = 0;
    while (i < t.length && (AGO_COMMAND.test(t[i]) || /^\w+=/.test(t[i]) || (t[i - 1] === 'timeout' && /^\d/.test(t[i])) || (t[i - 1] === 'xargs' && t[i].startsWith('-')))) i++;
    const cmd = t[i] ? path.basename(withoutQuotes(t[i])) : '';
    if (WRITING.test(cmd) && (!['sed', 'perl'].includes(cmd) || t.slice(i + 1).some((x) => /^-[a-zA-Z]*i/.test(x)))) {
      const arg = t.slice(i + 1).filter((x) => !x.startsWith('-'));
      if (cmd === 'dd') { for (const x of arg) if (x.startsWith('of=')) targets.push([x.slice(3), false]); }
      else if (['cp', 'ln', 'install', 'rsync'].includes(cmd)) { if (arg.length) targets.push([arg.at(-1), false]); }
      else for (const x of arg) targets.push([x, DELETING.includes(cmd)]);
    }
    for (const [x, deleting] of targets) { const d = protectedPath(path.resolve(update, withoutQuotes(x)), deleting); if (d) return d; }
  }
  return null;
}
// shared check for the hook and canUseTool: ban reason or null
export function guardCity(nastroj, enter, cwd) {
  if (nastroj === 'Bash') return guardBash(enter?.command, cwd);
  if (WRITE.includes(nastroj)) return guardWrite(enter?.file_path || enter?.notebook_path, cwd);
  return null;
}
// ---------- City secrets (2026-11-23) ----------
// Read, Grep and Glob go without a card (WITHOUT_ASKING), so their secret files are protected by the PreToolUse hook (in every mode, on every floor):
// ~/.config/mesto-agentov/ (Notion token), ~/.mesto-agentov/ (gateway: certificate keys, VAPID) and from data/ only the files with keys
// (devices.json, lock.json, test-key). The rest of data/ (conversations…) agents may read. The Azure key is in the Keychain, not in a file.
// Residual risk: Bash with obfuscation (base64, python -c open(…)) cannot be caught by a regex, the next layer would be moving the secrets to the Keychain.
const BAN_SECRET = () => tl('prompt.ban.secret');
const low = (p) => String(p).normalize('NFC').toLowerCase().replace(/(.)\/+$/, '$1');
const real = (p) => { // realpath also for a non-existent path (nearest existing parent), so a symlink does not skip the ban
  let a = p; const zv = [];
  while (a && !fs.existsSync(a) && path.dirname(a) !== a) { zv.unshift(path.basename(a)); a = path.dirname(a); }
  try { return path.join(fs.realpathSync(a), ...zv); } catch { return p; }
};
let SECRET = null;
// secret files in data/: current names and the original Slovak ones (before the data migration, and in the data-backup-*/ copy)
const SECRET_FILES = ['devices.json', 'lock.json', 'test-key', 'zariadenia.json', 'zamok.json', 'kluc-skusky'];
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function secret() {
  if (SECRET) return SECRET;
  const double = (x) => [...new Set([low(x), low(real(x))])];
  const cities = double(CITY);
  return (SECRET = {
    dirs: ['.config/mesto-agentov', '.mesto-agentov', '.config/agentic-platform', '.agentic-platform'].flatMap((d) => double(path.join(HOME, d))),
    files: SECRET_FILES.flatMap((f) => double(path.join(CITY, 'data', f))),
    // data/ and its migration copies (data-backup-<date>/, data-zaloha-<date>/, data.migrating/) with the same secret files
    dataRe: new RegExp(`^(?:${cities.map(escRe).join('|')})/data(?:-(?:backup|zaloha)[^/]*|\\.migrating[^/]*)?$`),
    fileRe: new RegExp(`^(?:${cities.map(escRe).join('|')})/data(?:-(?:backup|zaloha)[^/]*|\\.migrating[^/]*)?/(?:${SECRET_FILES.map(escRe).join('|')})$`),
    data: double(path.join(CITY, 'data')),
    backup: cities.flatMap((c) => [c + '/data-backup-x', c + '/data-zaloha-x', c + '/data.migrating']),
  });
}
const underPath = (a, d) => a === d || a.startsWith(d + '/');
export function isSecretPath(abs) {
  const T = secret();
  return [...new Set([low(abs), low(real(abs))])].some((a) => T.dirs.some((d) => underPath(a, d)) || T.files.includes(a) || T.fileRe.test(a));
}
function globRegex(g) { // ripgrep glob (**, *, ?, {a,b}, [..]) → RegExp over the whole absolute path
  let r = '', i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '*') { if (g[i + 1] === '*') { i += 2; if (g[i] === '/') r += '(?:.*/)?'; else { r += '.*'; continue; } } else r += '[^/]*'; }
    else if (c === '?') r += '[^/]';
    else if (c === '{' && g.indexOf('}', i) > 0) { const j = g.indexOf('}', i); r += '(?:' + g.slice(i + 1, j).split(',').map((x) => x.replace(/[.+^$()|\\[\]{}*?]/g, '\\$&')).join('|') + ')'; i = j; }
    else if (c === '[' && g.indexOf(']', i + 1) > 0) { const j = g.indexOf(']', i + 1); r += g.slice(i, j + 1); i = j; }
    else r += c.replace(/[.+^$()|\\{}[\]]/g, '\\$&');
    i++;
  }
  return new RegExp('^' + r + '$', 'i');
}
function globHitsSecret(base, g, T) { // can a glob (Grep glob, Glob pattern) select a secret file? A negative exception (!…) is ignored.
  g = String(g || '').trim(); if (!g || g.startsWith('!')) return false;
  let re; try { re = globRegex(low(g.startsWith('/') ? path.posix.normalize(g) : g.includes('/') ? path.posix.normalize(low(base) + '/' + g) : low(base) + '/**/' + g)); } catch { return true; }
  const probes = [...T.files, ...T.backup.flatMap((b) => SECRET_FILES.map((f) => b + '/' + f)), ...T.dirs.flatMap((d) => [d, d + '/notion-token', d + '/x', d + '/brana/x', d + '/brana/leaf.key', d + '/brana/ca.key', d + '/brana/vapid.json'])];
  return probes.some((s) => re.test(s));
}
// ban reason or null: tool = Read | Grep | Glob, i = tool_input
export function guardReading(nastroj, i, cwd) {
  i = i || {};
  const base = path.resolve(cwd || CITY, withoutQuotes(String(i.file_path || i.path || '.'))).normalize('NFC');
  if (isSecretPath(base)) return BAN_SECRET();
  if (nastroj === 'Read') return null;
  const T = secret(), g = nastroj === 'Glob' ? i.pattern : i.glob;
  if (g) return globHitsSecret(base, g, T) ? BAN_SECRET() : null;
  // Grep without glob: over a folder with secrets (~, ~/.config) or directly in data/ (the self-test key lives there; .gitignore protects the rest of the City) it also searches hidden files
  const b = [...new Set([low(base), low(real(base))])];
  if (nastroj === 'Grep' && (b.some((x) => T.data.includes(x) || T.dataRe.test(x)) || b.some((x) => T.dirs.some((d) => d.startsWith(x === '/' ? '/' : x + '/'))))) return tl('prompt.hook.grepSecret');
  return null;
}
// Bash: a command that mentions secret paths (path with ~ or $HOME, cd into a secret folder, bare file name in data/)
function secretInCommand(c, cwd) {
  const clean = String(c).normalize('NFC').replace(/["'\\]/g, '').replace(/\$\{?HOME\}?/g, HOME).replace(/(^|[\s=:])~(?=\/|\s|$)/g, '$1' + HOME).toLowerCase();
  // data/<secret> and the same in data-backup-*/ (new and original names); a glob that may hit one (data/z*, data/d*, data/l*, data/t*, data/k*)
  if (/(?:^|[\s/=:])\.config\/(?:mesto|agentic)|(?:^|[\s/=:])\.(?:mesto-agentov|agentic-platform)(?:\/|\s|$)|\/notion-token(?![\w-])|(?:^|[\s/])data(?:-[\w.-]*|\.migrating[\w.-]*)?\/(?:devices\.json|lock\.json|test-key|zariadenia\.json|zamok\.json|kluc-skusky)(?![\w.-])|(?:^|[\s/])data(?:-[\w.-]*|\.migrating[\w.-]*)?\/[zkdlt][\w.-]*[*?[]|(?:^|[\s/])data-[\w.-]*[*?[]/.test(clean)) return BAN_SECRET();
  const T = secret();
  for (const d of foldersCommand(c, cwd)) {
    const a = low(path.resolve(String(d)));
    if (T.dirs.some((x) => underPath(a, x))) return BAN_SECRET();
    if ((T.data.includes(a) || T.dataRe.test(a)) && /(?:^|[\s/])(?:devices\.json|lock\.json|test-key|zariadenia\.json|zamok\.json|kluc-skusky|[zkdlt][\w.-]*[*?[])/.test(clean)) return BAN_SECRET();
  }
  return null;
}
const ban = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const HOOKS = {
  PreToolUse: [
    { matcher: 'Bash', hooks: [async (enter) => {
      const command = enter?.tool_input?.command;
      if (pushBanned(command, enter?.cwd)) return ban(BAN_PUSH());
      const p = guardBash(command, enter?.cwd || process.cwd()); if (p) return ban(p);
      if (enter?.permission_mode && enter.permission_mode !== 'default' && isDeletion(command)) return ban(BAN_DELETION());
      return {};
    }] },
    // in every mode (also Edit without asking and Auto, where canUseTool does not come): .claude/agents and CLAUDE.md only through cards
    { matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [async (enter) => {
      const file = enter?.tool_input?.file_path || enter?.tool_input?.notebook_path, cwd = enter?.cwd || process.cwd();
      if (isProtected(file, cwd)) return ban(BAN_PROTECTED());
      const p = guardWrite(file, cwd); return p ? ban(p) : {};
    }] },
    // City secrets: Read, Grep and Glob (they go without a card) must not read tokens and keys, in every mode and on every floor
    { matcher: 'Read|Grep|Glob', hooks: [async (enter) => {
      const d = guardReading(enter?.tool_name, enter?.tool_input, enter?.cwd); return d ? ban(d) : {};
    }] },
  ],
};

// Virtual floor with scheduled tasks (My home, home-floors.js): a run without a human must not hang on a card.
// Exactly listed commands (P.allowedBash) the hook lets through without asking, but only after all Bash hook guards passed.
function hooksFloor(P) {
  if (!P.allowedBash?.length && !P.writeOnly?.length && !P.readingBan?.length) return HOOKS;
  // P.writeOnly (regexes of absolute paths, e.g. Library): Write/Edit outside them the hook denies, so a run without a human writes nothing else
  const abs = (cwd, x) => path.resolve(cwd || P.path || CITY, String(x)).normalize('NFC');
  const writeHook = P.writeOnly?.length ? [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [async (enter) => {
    const file = enter?.tool_input?.file_path || enter?.tool_input?.notebook_path;
    const a = file ? abs(enter?.cwd, file) : '';
    return P.writeOnly.some((re) => re.test(a)) ? {} : ban(P.writeReason || tl('prompt.hook.writeOnly'));
  }] }] : [];
  // P.readingBan (path regexes) and P.searchNo (folders): Read, Grep and Glob outside them; Grep/Glob without a path searches in the floor's cwd
  const readingHook = P.readingBan?.length ? [{ matcher: 'Read|Grep|Glob', hooks: [async (enter) => {
    const i = enter?.tool_input || {}, cwd = enter?.cwd, hladanie = enter?.tool_name !== 'Read';
    const base = abs(cwd, i.file_path || i.path || '.');
    const targets = [base, ...[i.pattern && enter?.tool_name === 'Glob' ? i.pattern : null, i.glob].filter(Boolean).map((g) => abs(base, g))];
    if (targets.some((c) => P.readingBan.some((re) => re.test(c)))) return ban(tl('prompt.hook.readingBan', { name: P.lead?.name || '' }).replace('  ', ' '));
    if (hladanie && P.searchNo?.some((d) => base === d)) return ban(tl('prompt.hook.searchNo'));
    return {};
  }] }] : [];
  if (!P.allowedBash?.length) return { ...HOOKS, PreToolUse: [...HOOKS.PreToolUse, ...writeHook, ...readingHook] };
  const guards = HOOKS.PreToolUse[0].hooks[0];
  return { ...HOOKS, PreToolUse: [...writeHook, ...readingHook, { matcher: 'Bash', hooks: [async (enter, ...r) => {
    const v = await guards(enter, ...r); if (v?.hookSpecificOutput) return v;
    const c = String(enter?.tool_input?.command || '').trim().split(HOME + '/').join('~/').replace(/\$HOME\//g, '~/');
    // a multi-line command (e.g. two scripts in a row) passes when every non-empty line is an allowed command on its own
    const rows = c.split('\n').map((x) => x.trim()).filter(Boolean);
    if (c.includes('..') || !rows.length || !rows.every((l) => P.allowedBash.some((re) => re.test(l)))) return P.onlyThese ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: tl('prompt.hook.onlyThese') } } : {};
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: tl('prompt.hook.house') } };
  }] }, ...HOOKS.PreToolUse.slice(1)] };
}

// ---------- storage ----------
const CONV = new Map(); // id → { id, sid, floor, agent, title, parent, created, changed, context, maxTokens, status, duration, count, toolUse }
const LIVE = new Map(); // id → { status, start, run }  (only while the server runs)
const MESSAGES = new Map(); // id → [messages]  (loaded lazily)
let always = {}; // "always allow": { "projekty/Pokus": ["Edit", "Bash:python3"] }

const novId = () => 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const now = () => Date.now();
let saveT = null;
const saveConv = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFileSync(CONV_FILE, JSON.stringify({ conversations: [...CONV.values()] }, null, 1)), 300); };
const saveAlways = () => fs.writeFileSync(PERMISSIONS, JSON.stringify(always, null, 2));
const messagesT = new Map();
function saveMessages(id, immediately = false) {
  clearTimeout(messagesT.get(id));
  const write = () => { messagesT.delete(id); const s = MESSAGES.get(id); if (s) fs.writeFileSync(path.join(MESSAGES_DIR, id + '.json'), JSON.stringify(s)); };
  if (immediately) write(); else messagesT.set(id, setTimeout(write, 1500));
}
function messages(id) {
  if (!MESSAGES.has(id)) {
    let s = [];
    try { s = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, id + '.json'), 'utf8')); } catch {}
    MESSAGES.set(id, s);
  }
  return MESSAGES.get(id);
}

// ---------- screenshots in messages ----------
// An image goes to the model as an `image` block (base64), the app shows it from data/images/<hash>.<ext>. Name = content hash,
// so the same screenshot (also from an older session's transcript) is on disk only once.
const TYPES_IMAGE = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const MAX_IMAGE = 8, MAX_IMAGE_B_64 = 6_900_000; // API: at most 5 MB per image
function saveImage(type, data) {
  const pr = TYPES_IMAGE[type]; if (!pr || typeof data !== 'string' || !data) return null;
  const name = crypto.createHash('sha1').update(data).digest('hex').slice(0, 20) + pr, s = path.join(IMAGES_DIR, name);
  if (!fs.existsSync(s)) fs.writeFileSync(s, Buffer.from(data, 'base64'));
  return name;
}
export function image(name) {
  if (!/^[0-9a-f]{20}\.(png|jpg|gif|webp)$/.test(name)) return null;
  const s = path.join(IMAGES_DIR, name); return fs.existsSync(s) ? s : null;
}
function verifyImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images) || images.length > MAX_IMAGE) throw Object.assign(new Error(tl('server.image.most', { n: MAX_IMAGE })), { code: 400 });
  return images.map((o) => {
    const type = String(o?.type || ''), data = String(o?.data || '');
    if (!TYPES_IMAGE[type]) throw Object.assign(new Error(tl('server.image.type')), { code: 400 });
    if (!/^[A-Za-z0-9+/]+=*$/.test(data)) throw Object.assign(new Error(tl('server.image.corrupted')), { code: 400 });
    if (data.length > MAX_IMAGE_B_64) throw Object.assign(new Error(tl('server.image.big')), { code: 400 });
    return { type, data, name: saveImage(type, data) };
  });
}

// ---------- attachments (files other than images) ----------
// The browser does not tell where on disk a file is, only its content. The server saves it to data/attachments/YYYY-MM-DD/<name>
// and the agent gets its path in the message (line "Priložené súbory:"), and reads it via Read. It goes neither to git nor to the brain.
const MAX_ATTACHMENTS = 10, MARKER_ATTACHMENTS = 'Priložené súbory:';
const idAttachments = (id) => typeof id === 'string' && /^\d{4}-\d{2}-\d{2}\/[^/\\\0]+$/.test(id) && !id.includes('..');
const safeTitle = (n) => String(n || '').normalize('NFC').replace(/[\/\\\0\x01-\x1f:]/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim().slice(0, 120) || 'attachment';
export function saveAttachment(nazov, data) {
  const day = new Date().toLocaleDateString('sv-SE'), dir = path.join(ATTACHMENTS_DIR, day); fs.mkdirSync(dir, { recursive: true });
  let name = safeTitle(nazov); const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base}-${i}${ext}`;
  fs.writeFileSync(path.join(dir, name), data);
  return { id: `${day}/${name}`, title: name, size: data.length };
}
export function attachment(id) {
  if (!idAttachments(id)) return null;
  const s = path.join(ATTACHMENTS_DIR, id); return s.startsWith(ATTACHMENTS_DIR + path.sep) && fs.existsSync(s) ? s : null;
}
// Older SDK transcripts carry the original path data/prilohy/<id> (before the data migration renamed it to data/attachments/).
// The id is the same, so an old path is read from the new folder.
const legacyAttachmentsDir = () => path.join(path.dirname(ATTACHMENTS_DIR), 'prilohy');
const attachmentRow = (r) => [ATTACHMENTS_DIR, legacyAttachmentsDir()].find((d) => r.startsWith(d + path.sep));
function verifyAttachments(attachments) {
  if (attachments == null) return [];
  if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) throw Object.assign(new Error(tl('server.attachment.most', { n: MAX_ATTACHMENTS })), { code: 400 });
  return attachments.map((id) => {
    const s = attachment(id); if (!s) throw Object.assign(new Error(tl('server.attachment.notFound')), { code: 400 });
    return { id, title: path.basename(s), size: fs.statSync(s).size, path: s };
  });
}
// text for the model: your text + attachment paths (the app shows them as small cards, not as text)
const textWithAttachments = (text, pr) => (pr.length ? `${text ? text + '\n\n' : ''}${MARKER_ATTACHMENTS}\n${pr.map((p) => '- ' + p.path).join('\n')}` : text);
// back from a transcript: the line "Priložené súbory:" with paths into data/prilohy → small cards
function splitAttachments(text) {
  const i = text.lastIndexOf(MARKER_ATTACHMENTS); if (i < 0) return { text };
  const rows = text.slice(i + MARKER_ATTACHMENTS.length).trim().split('\n').map((r) => r.replace(/^-\s*/, '').trim());
  if (!rows.length || !rows.every((r) => attachmentRow(r))) return { text };
  const attachments = rows.map((r) => { const id = r.slice(attachmentRow(r).length + 1), s = attachment(id); return { id, title: path.basename(r), size: s ? fs.statSync(s).size : null }; });
  return { text: text.slice(0, i).trim(), attachments };
}

// attachments older than 30 days are deleted (by folder date), at server start and then once a day
const DAYS_ATTACHMENTS = 30;
function tidyAttachments() {
  const limit = Date.now() - DAYS_ATTACHMENTS * 864e5;
  try {
    for (const d of fs.readdirSync(ATTACHMENTS_DIR)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00').getTime() < limit) fs.rmSync(path.join(ATTACHMENTS_DIR, d), { recursive: true, force: true });
    }
  } catch (e) { console.warn('Upratovanie príloh:', e.message); }
}

export function setAgents(o) {
  ({ findFloor } = o); if (o.dispatcher) dispatcher = o.dispatcher; if (o.questionChronicler) questionChronicler = o.questionChronicler; /* { verify(ulohy), context() } z dispatch.js (nástroj propose_tasks a prompt Dispečera) */ if (o.allPaths) allPaths = o.allPaths; ROOT = o.root || null; endProcess = o.end || null; emitOut = o.emit; changeLimits = o.limits; if (o.limitsStatus) limitsStatus = o.limitsStatus; DATA = o.data; WORLD_JSON = o.worldJson || null;
  CONV_FILE = path.join(DATA, 'conversations.json'); MESSAGES_DIR = path.join(DATA, 'messages'); PERMISSIONS = path.join(DATA, 'permissions.json'); IMAGES_DIR = path.join(DATA, 'images'); ATTACHMENTS_DIR = path.join(DATA, 'attachments');
  fs.mkdirSync(MESSAGES_DIR, { recursive: true }); fs.mkdirSync(IMAGES_DIR, { recursive: true }); fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  tidyAttachments(); setInterval(tidyAttachments, 24 * 3600e3).unref();
  try { always = JSON.parse(fs.readFileSync(PERMISSIONS, 'utf8')); } catch { always = {}; }
  HIDDEN_FILE = path.join(DATA, 'hidden.json'); try { HIDDEN = new Set(JSON.parse(fs.readFileSync(HIDDEN_FILE, 'utf8'))); } catch { HIDDEN = new Set(); }
  wakeups.init({ data: DATA, exists: (cid) => CONV.has(cid), wake: wakeUp });
  setTimeout(afterRestart, 4000).unref(); // the conversation that requested the restart gets a message (data/restart.json)
  if (fs.existsSync(CONV_FILE)) {
    for (const k of JSON.parse(fs.readFileSync(CONV_FILE, 'utf8')).conversations || []) {
      if (k.status === 'running' || k.status === 'pending') k.status = 'none'; // the server crashed during a run
      CONV.set(k.id, k);
    }
    // older records have no cwd: we fill it in from the transcript (a session can be resumed only in the folder where it was created)
    const without = [...CONV.values()].filter((k) => k.sid && !k.cwd);
    if (without.length) {
      const cwdPre = new Map(loadSessions().filter((x) => x.cwd).map((x) => [x.sid, x.cwd]));
      for (const k of without) if (cwdPre.has(k.sid)) k.cwd = cwdPre.get(k.sid);
      saveConv();
    }
  } else {
    // conversion from the old data/auth-sessions.json (phase 1 – 2: one session per floor)
    let rel = {};
    try { rel = JSON.parse(fs.readFileSync(path.join(DATA, 'auth-sessions.json'), 'utf8')); } catch {}
    for (const [floor, sid] of Object.entries(rel)) {
      if (!sid) continue;
      const id = novId();
      CONV.set(id, { id, sid, floor, agent: 'lead', title: tl('server.conv.older'), parent: null, created: now(), changed: now(), context: 0, status: 'none', count: 0 });
    }
    saveConv();
  }
}

// ---------- events to the browser (text in pieces is sent in batches every ~50 ms) ----------
const deltas = new Map(); let deltaT = null;
function flushDeltas() {
  clearTimeout(deltaT); deltaT = null;
  for (const [kl, text] of deltas) { const [id, i] = kl.split('|'); emitOut({ kind: 'delta', id, i: +i, text }); }
  deltas.clear();
}
function emit(e) { if (deltas.size) flushDeltas(); emitOut(e); }

export function summary(k) {
  const z = LIVE.get(k.id);
  return { id: k.id, sid: k.sid, floor: k.floor, agent: k.agent, title: k.title, parent: k.parent, created: k.created, changed: k.changed,
    context: k.context || 0, status: z?.status || k.status || 'none', start: z?.start || null, duration: k.duration || null, count: k.count || 0, direct: k.agent !== 'lead' && !k.parent, cwd: k.cwd ? tilde(k.cwd) : null,
    model: k.model || null, effort: k.effort || null, mode: k.mode || null, ultracode: !!k.ultracode, modelActual: k.modelActual || null, effortActual: k.effortActual || null,
    breakdown: k.breakdown || null, number: k.number || null, pinned: k.pinned || null, scheduled: !!k.scheduled || (String(k.floor).startsWith("home/") && / \d{4}-\d{2}-\d{2}$/.test(k.title || "")), app: !!z?.app, plan: z?.plan || null, // pinned = time pinned to the top; app = the CLI waits for a message from the Claude app; work plan in this run { h, n, step } (label above the agent, api.js)
    usageP: k.usage ? toPercent(k.usage) : 0, // estimated % of 5 h for the whole conversation including the team (ratio of the current window, usage.js)
    usageWindow: k.sid ? usageInWindow(k.sid) : null, // % in the current 5 h window, the same number as the Usage limit window
    queue: z?.run?.queue?.length ? z.run.queue.map((f) => ({ id: f.uuid, text: tail(f.text || (f.pr.length ? f.pr.map((p) => p.title).join(', ') : 'Screenshot'), 200), time: f.time, afterRun: !!f.afterRun })) : null }; // always, so that an empty queue in the browser gets overwritten
}
const ozvi = (k) => emit({ kind: 'conv', conv: summary(k) });
function setStatus(k, status) {
  const z = LIVE.get(k.id) || {}; LIVE.set(k.id, z);
  if (status === 'running' && !z.start) { z.start = now(); z.plan = null; } // a new run starts without a plan
  if (status === 'pending') { if (z.status !== 'pending') z.pendingFrom = now(); } else z.pendingFrom = null; // waiting since (sleep.js: waiting keeps the Mac awake at most 30 min)
  z.status = status;
  if (!['running', 'pending'].includes(status)) { k.status = status; z.start = null; saveConv(); }
  ozvi(k);
}
const timeNow = () => new Date().toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
function add(k, s) {
  const sp = messages(k.id);
  const last = sp.at(-1);
  if (last?.type === 'steps' && last.running && s.type !== 'steps') { last.running = false; emit({ kind: 'edit', id: k.id, i: last.i, change: { running: false } }); }
  s.i = sp.length; s.time ||= timeNow(); if (s.type === 'user' || s.type === 'assistant') s.ts ||= now(); sp.push(s); // ts: the Chronicler takes only today's messages
  if (s.type === 'user' || s.type === 'assistant') k.count = (k.count || 0) + 1;
  k.changed = now(); saveConv(); saveMessages(k.id);
  emit({ kind: 'message', id: k.id, message: s });
  return s;
}
function edit(k, i, change) {
  const s = messages(k.id)[i]; if (!s) return;
  Object.assign(s, change); saveMessages(k.id);
  emit({ kind: 'edit', id: k.id, i, change });
}

// ---------- team from .claude/agents ----------
// Frontmatter: name, description, skills (commas or a list), tools, model, effort, color + app keys meno and emoji (Claude Code ignores them).
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/); if (!m) return null;
  const o = {}; let key = null;
  for (const r of m[1].split(/\r?\n/)) {
    const items = r.match(/^\s*-\s+(.*)$/);
    if (items && key) { (o[key] = Array.isArray(o[key]) ? o[key] : []).push(items[1].trim().replace(/^["']|["']$/g, '')); continue; }
    const conv = r.match(/^([A-Za-z_-]+):\s*(.*)$/); if (!conv) continue;
    key = conv[1]; let v = conv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, '');
    o[key] = v;
  }
  return { meta: o, body: m[2] };
}
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => x.trim()).filter(Boolean);
const niceName = (s) => s.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
// Floor team: .claude/agents/*.md from all its folders (for a school subject both brain and code), the main folder takes precedence.
// The argument is a floor (with `paths`) or directly a path.
export function loadTeam(P) {
  if (P?.withoutTeam) return []; // a virtual Home floor (home-floors.js) has no employees
  const roots = typeof P === 'string' ? [P] : P?.paths?.length ? [P.path, ...P.paths.filter((c) => c !== P.path)] : [P?.path].filter(Boolean);
  const team = [], seen = new Set();
  for (const root of roots) {
    const dir = path.join(root, '.claude', 'agents');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { continue; }
    for (const f of files) {
      let fm = null;
      try { fm = frontmatter(fs.readFileSync(path.join(dir, f), 'utf8')); } catch {}
      const m = fm?.meta || {}, k = m.name || f.slice(0, -3), description = String(m.description || '');
      if (seen.has(k)) continue; seen.add(k);
      team.push({ k, name: m['meno'] || niceName(k), emoji: m.emoji || '👤', role: description.split(/(?<=\.)\s/)[0].replace(/\.$/, '').slice(0, 90), description: description, skills: [...new Set([...list(m.skills), ...list(m['skilly'])])], file: `.claude/agents/${f}`,
        root, definition: { description: description || k, prompt: (fm?.body || '').trim(), ...(list(m.skills).length ? { skills: list(m.skills) } : {}), ...(m.model ? { model: m.model } : {}), ...(EFFORTS.includes(m.effort) ? { effort: m.effort } : {}), ...(m.tools ? { tools: list(m.tools) } : {}) } });
    }
  }
  return team;
}
// for the browser, without definitions and paths
export const publicTeam = (P) => loadTeam(P).map(({ root, definition, ...a }) => a);
// employees that Claude Code does not find by itself in the given cwd (the file is in another folder of the floor) → option `agents`
function agentsOutsideCwd(P, cwd) {
  const outside = loadTeam(P).filter((a) => nfc(a.root) !== nfc(cwd));
  return outside.length ? Object.fromEntries(outside.map((a) => [a.k, a.definition])) : undefined;
}
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'teammate';
// Skills from hiring go to `skilly:` (app only) and to the instruction in the body, not to `skills:` (that would load them whole into the context
// every time the employee starts, 2026-11-11). `skills:` can be added by hand for a small skill needed in every task.
function mdAgent(c, floor) {
  const firstSentence = (c.reason || '').split(/(?<=\.)\s/)[0], large = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const yaml = (t) => (/[:#'"\[\]{}]|^[-?*&!|>%@`]/.test(t) ? JSON.stringify(t) : t); // a colon etc. would break the frontmatter
  return tl('prompt.team.md', { k: c.k, description: yaml(large((c.role.replace(/\.$/, '') + '. ' + firstSentence).replace(/\s+/g, ' ').trim())), skills: c.skills?.length ? `skilly: ${c.skills.join(', ')}\n` : '', name: yaml(c.name), emoji: c.emoji, body: (c.prompt || tl('prompt.team.default', { name: c.name.toLowerCase(), floor: floor.n })).trim(), skillInstruction: c.skills?.length ? tl('prompt.team.skills', { skills: c.skills.join(', ') }) : '', path: floor.shortPath || floor.path, code: floor.shortCode ? tl('prompt.team.code', { code: floor.shortCode }) : '', notes: noteInstruction(floor, false) });
}
function writeAgent(P, c) {
  const dir = path.join(P.path, '.claude', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  let name = c.k, n = 2;
  while (fs.existsSync(path.join(dir, name + '.md'))) name = `${c.k}-${n++}`;
  let md = typeof c.md === 'string' && c.md.trim().startsWith('---') ? c.md : mdAgent(c, P);
  if (name !== c.k) md = md.replace(/^name:.*$/m, `name: ${name}`);
  fs.writeFileSync(path.join(dir, name + '.md'), md.endsWith('\n') ? md : md + '\n');
  return `.claude/agents/${name}.md`;
}
function writeToMemory(P, text) {
  const file = path.join(P.path, 'CLAUDE.md');
  const row = '- ' + text.trim().replace(/\n+/g, ' ');
  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch {}
  const HEADLINE = tl('prompt.notes.headline');
  if (!content) content = `# ${P.n}\n\n${HEADLINE}\n\n${row}\n`;
  else if (content.includes(HEADLINE)) content = content.replace(/\s*$/, '\n') + row + '\n';
  else content = content.replace(/\s*$/, '\n') + `\n${HEADLINE}\n\n${row}\n`;
  fs.writeFileSync(file, content);
}

// ---------- where notes belong (decisions, status, TODO) by building ----------
// Everything is in world.json: `notes` on a building (forms in build-world.js normalizeNotes) or on a floor (path of an .md file, or a folder
// ending in "/" = folder with default README.md, e.g. Control center: `floors["~/Development/city-agents"].notes`), `brain` for the Brain pavilion.
//   file      → notes file by template (or by a folder → file table), without a file a proposal to create it
//   folder    → a folder (e.g. a school subject), the file in it is decided by the folder's CLAUDE.md; on a floor with a folder `file` defaults to README.md
//   project   → only the project folder, NEVER the Brain (client projects)
//   brain     → by the rules in <brain>/CLAUDE.md, if it exists (and `brain.forbiddenWrites`)
// A virtual floor may have its own target (P.notesTarget, e.g. Universal from the Home module). Without it the agent does not write notes.
const expand = (p) => (p && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
const tilde = (p) => (p && p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p);
const inside = (p, dir) => { const r = path.relative(dir, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
function settingWorld() { try { return JSON.parse(fs.readFileSync(WORLD_JSON, 'utf8')); } catch { return {}; } }
export function floorDefaults(P) {
  const N = settingWorld(), G = N.agents || {};
  const np = (P && ((N.floors || {})[tilde(P.path)] || (P.codePath && (N.floors || {})[tilde(P.codePath)]))) || {};
  // virtual floor with its own preset (Dispatch = Opus, 2026-11-15): wins over world.json, a choice in the conversation still overrides it
  const pv = (P && P.preset) || {};
  return { model: validModel(pv.model) || validModel(np.model) || validModel(G.model) || PRESET.model, effort: validEffort(np.effort) || validEffort(G.effort) || PRESET.effort, mode: validMode(np.mode) || validMode(G.mode) || PRESET.mode };
}
const choiceConv = (k, P) => { const d = floorDefaults(P); return { model: validModel(k.model) || d.model, effort: validEffort(k.effort) || d.effort, mode: validMode(k.mode) || d.mode, ultracode: !!k.ultracode }; }; // ultracode (2026-11-18): only a conversation choice, off by default
// table "| `folder/` | `path.md` |" in the building's file (`notes.table`), e.g. the project overview in the parent folder's CLAUDE.md
function mapTables(file) {
  const m = new Map();
  try {
    for (const r of fs.readFileSync(expand(file), 'utf8').split('\n')) {
      const x = r.match(/^\|\s*`([^`]+?)\/?`[^|]*\|\s*`((?:~\/|\/)[^`]+\.md)`/);
      if (x) m.set(x[1].normalize('NFC'), expand(x[2]));
    }
  } catch {}
  return m;
}
// Brain from world.json: { name, path (absolute), kind, forbiddenWrites: [RegExp], forbiddenReason, noteInstruction } or null
function brainSettings(N = loadSetting(WORLD_JSON)) {
  const M = N.brain; if (!M) return null;
  const re = []; for (const x of Array.isArray(M.forbiddenWrites) ? M.forbiddenWrites : []) { try { re.push(new RegExp(String(x), 'i')); } catch {} }
  return { ...M, path: nfc(expand(M.path)), forbiddenWrites: [/(^|\/)\.git\//, ...re] };
}
export function noteTarget(P) {
  const cesta = nfc(P.path), N = loadSetting(WORLD_JSON), M = brainSettings(N);
  if (P.notesTarget) return P.notesTarget;
  const key = String(P.id).split('/')[0], B = N.buildings[key], PN = normalizeNotes(B?.notes);
  const custom = Object.entries(N.floors || {}).find(([k]) => nfc(expand(k)) === cesta)?.[1]?.notes;
  const brain = (f) => M && (inside(f, M.path) || f === M.path);
  if (custom && !(PN?.kind === 'folder' && brain(expand(custom)))) {
    const f = expand(custom);
    if (/\/$/.test(custom)) { const dir = nfc(f.replace(/\/+$/, '')), r = path.join(dir, 'README.md'); return { kind: 'dir', folder: dir, file: r, exists: fs.existsSync(dir) }; } // notes folder, README.md by default (2026-11-25)
    return { kind: 'custom', file: f, exists: fs.existsSync(f) };
  }
  if (PN?.kind === 'folder') {
    const cand = ['docs/rozhodnutia.md', 'ROZHODNUTIA.md', 'docs/poznamky.md', 'POZNAMKY.md', 'NOTES.md', 'docs/notes.md'];
    const ex = cand.find((f) => fs.existsSync(path.join(cesta, f)));
    return { kind: 'folder', file: path.join(cesta, ex || cand[0]), exists: !!ex, folder: cesta };
  }
  if (P.id === 'brain' && M) return { kind: 'brain', folder: M.path };
  if (PN?.kind === 'dir') { const dir = fillTemplate(PN.template, path.basename(cesta), cesta).replace(/\/+$/, ''); return { kind: 'dir', folder: dir, exists: fs.existsSync(dir) }; }
  if (PN?.kind === 'file') {
    const name = path.basename(cesta);
    let f = PN.table ? mapTables(PN.table).get(name) : null;
    if (!f) f = noteCandidates(PN.template, name, cesta).find((x) => fs.existsSync(x));
    if (f) return { kind: 'project', file: f, exists: fs.existsSync(f) };
    return { kind: 'fresh', file: fillTemplate(PN.template, name, cesta), exists: false, newInstruction: PN.newInstruction };
  }
  return { kind: 'none' };
}
// instruction for agents (lead, direct conversation, employee file template)
export function noteInstruction(P, hasTool) {
  const c = noteTarget(P), M = brainSettings(), titleBrain = M?.title || tl('prompt.notes.brain');
  const dest = {
    project: tl('prompt.notes.project', { file: tilde(c.file) }),
    fresh: tl('prompt.notes.fresh', { file: tilde(c.file), instruction: c.newInstruction ? tl('prompt.notes.newInstruction', { instruction: c.newInstruction }) : '' }),
    dir: c.file ? tl('prompt.notes.folderFile', { folder: tilde(c.folder), file: tilde(c.file) })
      : tl('prompt.notes.dir', { folder: tilde(c.folder) }),
    folder: tl('prompt.notes.folder', { file: tilde(c.file), never: M ? tl('prompt.notes.toBrain', { title: titleBrain }) : tl('prompt.notes.outside') }),
    brain: M?.noteInstruction || tl('prompt.notes.brainDefault', { title: titleBrain, path: tilde(M?.path || '') }),
    custom: tl('prompt.notes.custom', { file: tilde(c.file) }),
    none: tl('prompt.notes.none'),
  }[c.kind] || c.instruction || '';
  const onFile = ['dir', 'brain', 'folder'].includes(c.kind);
  const how = c.kind === 'none' ? ''
    : hasTool
      ? tl('prompt.notes.likeTool', { file: onFile ? tl('prompt.notes.aFile') : '' })
      : tl('prompt.notes.likeWithout');
  return tl('prompt.notes.completed', { dest, how });
}
// where exactly to write a memory proposal; checks paths (client projects never into the Brain, forbidden parts of the Brain, only .md)
export function writeTarget(P, target = 'rule', file = '') {
  if (target === 'rule') { const f = path.join(P.path, 'CLAUDE.md'); return { abs: f, path: tilde(f), fresh: !fs.existsSync(f), description: 'pravidlo pre agentov → CLAUDE.md projektu' }; }
  if (target !== 'notes') return { error: tl('server.notes.targetRule') };
  const c = noteTarget(P), N = loadSetting(WORLD_JSON), M = brainSettings(N);
  if (c.kind === 'none') return { error: tl('server.notes.hasNoPlace') };
  let abs = c.file;
  if (['dir', 'brain', 'folder'].includes(c.kind) && file) abs = path.resolve(c.folder, String(file).replace(/^~\//, HOME + '/'));
  if (!abs) return { error: c.kind === 'dir' ? tl('server.notes.assignFile', { folder: tilde(c.folder) }) : tl('server.notes.assignFileBrain', { path: tilde(M?.path || ''), path: tilde(M?.path || '') }) };
  if (!abs.endsWith('.md')) return { error: tl('server.notes.onlyMd') };
  if (c.folder && !inside(abs, c.folder)) return { error: tl('server.notes.inFolder', { folder: tilde(c.folder) }) };
  const PN = normalizeNotes(N.buildings[String(P.id).split('/')[0]]?.notes);
  const closed = PN?.kind === 'folder';
  if (closed && ((M && (inside(abs, M.path) || abs === M.path)) || !inside(abs, P.path))) return { error: tl('server.notes.closed') };
  if (M && inside(abs, M.path) && M.forbiddenWrites.some((r) => r.test(path.relative(M.path, abs)))) return { error: M.forbiddenReason || tl('server.notes.banned', { title: M.title }) };
  const inBrain = !!(M && inside(abs, M.path));
  return { abs, path: tilde(abs), fresh: !fs.existsSync(abs), description: tl('server.notes.description', { dest: inBrain ? M.title : tl('prompt.notes.folderProject') }) };
}
// appends a dated line to the decisions section (or at the end), creates a new file
export function writeNote(P, abs, text) {
  const date = new Date().toLocaleDateString('sv-SE'), row = `- **${date}:** ${text.trim().replace(/\n+/g, ' ')}`;
  let content = '';
  try { content = fs.readFileSync(abs, 'utf8'); } catch {}
  if (!content) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    content = ['fresh', 'project'].includes(noteTarget(P).kind)
      ? tl('prompt.notes.newFile', { n: P.n, n: P.n, path: tilde(P.path), row })
      : tl('prompt.notes.bareFile', { n: P.n, row });
    return fs.writeFileSync(abs, content);
  }
  const rows = content.split('\n'), h = rows.findIndex((r) => /^#{2,3}\s+.*(rozhodnut|Rozhodnut|decision|Decision)/.test(r));
  if (h < 0) return fs.writeFileSync(abs, content.replace(/\s*$/, '\n') + tl('prompt.notes.section', { row }));
  let end = rows.findIndex((r, i) => i > h && /^#{1,3}\s/.test(r)); if (end < 0) end = rows.length;
  let insert = end; while (insert > h + 1 && !rows[insert - 1].trim()) insert--; // after the last non-empty line of the section
  rows.splice(insert, 0, row);
  fs.writeFileSync(abs, rows.join('\n'));
}

// ---------- conversations: list, history, older sessions ----------
const oldCache = new Map(); // path → { when, list }
async function oldSessions(P) {
  if (P.virtual) return []; // sessions from the Brain's folder belong to the Brain, a virtual floor has only its own conversations
  const c = oldCache.get(P.path);
  if (c && now() - c.when < 30000) return c.list;
  const known = new Set([...CONV.values()].map((k) => k.sid).filter(Boolean));
  const out = (await sessionsFloor(P)).filter((s) => !known.has(s.sessionId) && !HIDDEN.has(s.sessionId)).slice(0, 40)
    .map((s) => ({ id: 's:' + s.sessionId, sid: s.sessionId, floor: P.id, agent: 'lead', title: (s.customTitle || s.summary || s.firstPrompt || 'Session').replace(/\s+/g, ' ').slice(0, 90), parent: null,
      created: s.createdAt || s.lastModified, changed: s.lastModified, context: 0, status: 'none', old: true, count: 0, cwd: tilde(s.cwd), cwdFull: s.cwd }));
  oldCache.set(P.path, { when: now(), list: out });
  return out;
}

export async function floorConversations(pid) {
  const P = findFloor(pid); if (!P) return null;
  const our = [...CONV.values()].filter((k) => k.floor === P.id && !k.hidden).map(summary);
  return { floor: P.id, path: P.shortPath || P.path, team: publicTeam(P), conversations: our, old: await oldSessions(P), defaults: floorDefaults(P), models: MODELS, efforts: EFFORTS, modes: MODES, subfolders: subfolders(P), virtual: !!P.virtual };
}

// ---------- nested projects (2026-11-13) ----------
// Floor = folder, but inside there may be a standalone project with its own CLAUDE.md (e.g. ~/Klienti/Projekt/podprojekt).
// A new conversation can be started with cwd in such a subfolder: Claude Code loads its CLAUDE.md and the parent ones, the conversation
// stays on the floor. Searched to depth 3, without hidden and build folders, at most 4000 folders, cache 5 min.
const PODPR_NO = new Set(['node_modules', 'dist', 'build', 'out', 'vendor', 'venv', '__pycache__', 'bin', 'obj', 'target', 'Pods', 'coverage']);
const podprCache = new Map(); // P.path → { when, list }
export function subfolders(P) {
  if (!P || P.virtual || !P.path) return [];
  const c = podprCache.get(P.path);
  if (c && now() - c.when < 5 * 60 * 1000) return c.list;
  const list = []; let seen = 0;
  const walk = (dir, rel, depth) => {
    if (depth > 3 || seen > 4000) return;
    let pol = []; try { pol = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of pol) {
      if (!d.isDirectory() || d.name.startsWith('.') || d.name.startsWith('_') || PODPR_NO.has(d.name)) continue;
      seen++;
      const r = rel ? `${rel}/${d.name}` : d.name, full = path.join(dir, d.name);
      if (fs.existsSync(path.join(full, 'CLAUDE.md'))) list.push(nfc(r));
      walk(full, r, depth + 1);
    }
  };
  walk(P.path, '', 1);
  list.sort((a, b) => a.localeCompare(b, 'sk'));
  podprCache.set(P.path, { when: now(), list });
  return list;
}
// relative path of the conversation's subfolder against the floor ('' = floor root)
const relCwd = (k, P) => { const c = nfc(k.cwd || P.path), r = nfc(P.path); return c.startsWith(r + '/') ? c.slice(r.length + 1) : ''; };
export const allSummaries = () => [...CONV.values()].filter((k) => !k.hidden).map(summary);

// ---------- conversation management: rename, hide, trash (2026-11-09) ----------
// Renaming writes custom-title into the session (renameSession), so you see the name in the Claude app and `claude --resume` too.
// Hiding only hides the conversation in the City (k.hidden, for older sessions data/hidden.json), the files stay.
// Trash moves the session transcript (<sid>.jsonl and the <sid>/ folder with subagents) and the app's messages to
// ~/.Trash/Mesto agentov <date time>/, never deletes permanently. An employee task has no session of its own (it is in the lead's
// session), so it can only be hidden. A conversation where an agent is working right now cannot be hidden or deleted.
const errorK = (message, code = 400) => Object.assign(new Error(message), { code });
async function oldSession(id, pid) {
  for (const c of oldCache.values()) { const s = c.list.find((x) => x.id === id); if (s) return s; }
  const P = pid && findFloor(pid); if (!P) return null;
  return (await oldSessions(P)).find((x) => x.id === id) || null;
}
const running = (id) => !!LIVE.get(id)?.run;
const withChildren = (k) => [k, ...[...CONV.values()].filter((x) => x.parent === k.id)];
export async function rename({ id, floor, title, card, no, restore, keep }) {
  title = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const kk = card ? CONV.get(id) : null, ks = kk && messages(kk.id).find((x) => x.type === 'title' && x.id === card);
  if (card && !ks) throw errorK(tl('server.conv.proposalNotFound'), 404);
  if (ks && no) { edit(kk, ks.i, { status: 'no' }); kk.titleManual = true; saveConv(); return { ok: true }; }
  if (ks && restore) { // automatic title back to the original (2026-11-19)
    edit(kk, ks.i, { status: 'returned' }); title = String(ks.original || '').trim();
    if (!title) { const prva = messages(kk.id).find((x) => x.type === 'user'); title = tail(String(prva?.text || tl('server.conv.conversation')).replace(/\s+/g, ' ').trim(), 60); }
  }
  if (ks && keep) { edit(kk, ks.i, { status: 'yes' }); return { ok: true }; }
  if (!title) throw errorK(tl('server.conv.titleEmpty'));
  if (ks && !restore) edit(kk, ks.i, { status: 'yes', title });
  if (String(id).startsWith('s:')) {
    const s = await oldSession(id, floor); if (!s) throw errorK(tl('server.conv.sessionNotFound'), 404);
    await renameSession(s.sid, title, { dir: s.cwdFull }); oldCache.clear(); sessionsCache.clear();
    return { ok: true };
  }
  const k = CONV.get(id); if (!k) throw errorK(tl('server.conv.notFound'), 404);
  k.title = title; k.titleManual = true; if (!k.sid) k.renameAfterSid = true; saveConv(); ozvi(k); // manual title, Revert or Edit: the agent no longer changes it by itself (running title)
  if (k.sid && !k.parent) { try { await renameSession(k.sid, title, { dir: k.cwd || findFloor(k.floor)?.path }); } catch (e) { console.warn('renameSession:', e.message); } }
  return { ok: true };
}
export async function hide({ ids = [], floor }) {
  const completed = [], errors = [];
  for (const id of ids) {
    if (String(id).startsWith('s:')) { const s = await oldSession(id, floor); if (!s) { errors.push(tl('server.conv.idNotFound', { id })); continue; } HIDDEN.add(s.sid); completed.push(id); continue; }
    const k = CONV.get(id); if (!k) { errors.push(tl('server.conv.idNotFound', { id })); continue; }
    if (withChildren(k).some((x) => running(x.id))) { errors.push(tl('server.conv.workingStop', { title: k.title })); continue; }
    for (const x of withChildren(k)) { x.hidden = true; completed.push(x.id); }
  }
  saveConv(); fs.writeFileSync(HIDDEN_FILE, JSON.stringify([...HIDDEN])); oldCache.clear();
  if (completed.length) emit({ kind: 'deleted', ids: completed });
  return { ok: !errors.length, completed, errors };
}
// "Done" (2026-11-10): a conversation waiting for a reply is switched to done, it stays in the list. Nothing is deleted or sent to the agent.
export function resolve({ ids = [] }) {
  const completed = [], errors = [];
  for (const id of ids) {
    const k = CONV.get(id); if (!k) { errors.push(tl('server.conv.idNotFound', { id })); continue; }
    if (running(k.id)) { errors.push(tl('server.conv.working', { title: k.title })); continue; }
    if ((LIVE.get(k.id)?.status || k.status) !== 'reply') continue; // nothing to settle
    setStatus(k, 'done'); completed.push(k.id);
  }
  return { ok: !errors.length, completed, errors };
}
// Pinning (2026-11-19): the conversation shows on top of the floor list and in the Workroom. k.pinned = time pinned.
// Only City conversations (not older Claude Code sessions and employee tasks).
export function pin({ ids = [], pin: pripnut = true }) {
  const completed = [], errors = [];
  for (const id of ids) {
    const k = CONV.get(id); if (!k) { errors.push(tl('server.conv.idPin', { id, reason: String(id).startsWith('s:') ? tl('server.conv.olderSession') : tl('server.conv.notFoundShort') })); continue; }
    if (k.parent) { errors.push(tl('server.conv.task', { title: k.title })); continue; }
    if (pripnut) k.pinned = now(); else delete k.pinned;
    ozvi(k); completed.push(k.id);
  }
  saveConv();
  return { ok: !errors.length, completed, errors };
}
function findTranscript(sid) {
  const root = path.join(HOME, '.claude', 'projects');
  for (const d of fs.readdirSync(root)) { const f = path.join(root, d, sid + '.jsonl'); if (fs.existsSync(f)) return { dir: d, f }; }
  return null;
}
export async function toTrash({ ids = [], floor }) {
  const completed = [], errors = [], d = new Date(), p2 = (x) => String(x).padStart(2, '0');
  const basket = path.join(HOME, '.Trash', `Mesto agentov ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}`);
  const move = (z, dest) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(z, dest); };
  const transcript = (sid) => { const t = findTranscript(sid); if (!t) return false; move(t.f, path.join(basket, t.dir, sid + '.jsonl')); const sub = path.join(path.dirname(t.f), sid); if (fs.existsSync(sub)) move(sub, path.join(basket, t.dir, sid)); return true; };
  for (const id of ids) {
    try {
      if (String(id).startsWith('s:')) {
        const s = await oldSession(id, floor); if (!s) { errors.push(tl('server.conv.idNotFound', { id })); continue; }
        if (!transcript(s.sid)) { errors.push(tl('server.conv.fileSession', { title: s.title })); continue; }
        completed.push(id); continue;
      }
      const k = CONV.get(id); if (!k) { errors.push(tl('server.conv.idNotFound', { id })); continue; }
      if (k.parent) { k.hidden = true; completed.push(k.id); continue; } // employee task: hide only (it is in the lead's session)
      const all = withChildren(k);
      if (all.some((x) => running(x.id))) { errors.push(tl('server.conv.workingStop', { title: k.title })); continue; }
      if (k.sid) transcript(k.sid);
      for (const x of all) {
        clearTimeout(messagesT.get(x.id)); messagesT.delete(x.id);
        const f = path.join(MESSAGES_DIR, x.id + '.json'); if (fs.existsSync(f)) move(f, path.join(basket, 'mesto-agentov-spravy', x.id + '.json'));
        CONV.delete(x.id); MESSAGES.delete(x.id); LIVE.delete(x.id); completed.push(x.id);
      }
    } catch (e) { errors.push(`${id}: ${e.message}`); }
  }
  saveConv(); oldCache.clear(); sessionsCache.clear();
  if (completed.length) emit({ kind: 'deleted', ids: completed });
  return { ok: !errors.length, completed, errors, basket: completed.length ? tilde(basket) : null };
}

// conversion of a Claude Code transcript (~/.claude/projects/…/<sid>.jsonl) to app messages
async function fromTranscript(sid, P, cwd) {
  let msgs = [];
  try { msgs = await getSessionMessages(sid, { dir: cwd || P.path }); } catch { return [{ type: 'info', text: tl('server.conv.transcript') }]; }
  const out = [], steps = new Map(), tasksT = [];
  const addWith = (s) => { const last = out.at(-1); if (last?.type === 'steps' && s.type !== 'steps') last.running = false; s.i = out.length; out.push(s); return s; };
  for (const m of msgs.slice(-600)) {
    if (m.parent_tool_use_id) continue; // inside of a subagent (it is in a separate file)
    const content = m.message?.content;
    if (m.type === 'user') {
      if (typeof content === 'string') { const pe = peerMessage(content); if (pe) addWith({ type: 'fromApp', ...pe }); else if (!/^\s*</.test(content) && content.trim()) addWith({ type: 'user', text: withoutInstruction(content).trim(), uuid: m.uuid }); continue; } // message from the Claude app (2026-11-16): its own bubble
      const texts = [], images = []; // text and screenshots of one message (also from the Claude app) go into one bubble
      for (const b of content || []) {
        const pe = b.type === 'text' ? peerMessage(b.text) : null;
        if (pe) { addWith({ type: 'fromApp', ...pe }); continue; }
        if (b.type === 'text' && b.text.trim() && !/^\s*</.test(b.text) && !b.text.startsWith('[Request interrupted')) texts.push(withoutInstruction(b.text).trim());
        if (b.type === 'image' && b.source?.type === 'base64') { const name = saveImage(b.source.media_type, b.source.data); if (name) images.push(name); }
        if (b.type === 'tool_result' && steps.has(b.tool_use_id)) { const k = steps.get(b.tool_use_id); k.result = textResult(b.content); if (b.is_error) k.error = true; }
      }
      if (texts.length || images.length) { const r = splitAttachments(texts.join('\n\n')); addWith({ type: 'user', text: r.text, uuid: m.uuid, ...(images.length ? { images } : {}), ...(r.attachments ? { attachments: r.attachments } : {}) }); }
    } else if (m.type === 'assistant') {
      for (const b of content || []) {
        if (b.type === 'text' && b.text.trim()) addWith({ type: 'assistant', text: b.text.trim() });
        else if (b.type === 'tool_use') {
          if (PLAN_TOOLS.has(b.name)) { // one card per turn, further calls overwrite it
            const pol = planFromTool(b.name, b.input, tasksT); if (!pol) continue;
            const last = [...out].reverse().find((s) => s.type === 'todo' || s.type === 'user');
            if (last?.type === 'todo') last.items = pol; else addWith({ type: 'todo', title: tl('server.conv.listTasks'), items: pol });
            continue;
          }
          if (b.name === 'Agent' || b.name === 'Task') { addWith({ type: 'delegate', who: b.input?.subagent_type || 'general-purpose', title: b.input?.description || tl('server.conv.taskDefault'), thread: null, status: 'done' }); continue; }
          let last = out.at(-1);
          if (last?.type !== 'steps') last = addWith({ type: 'steps', steps: [], running: false });
          const k = { n: toolName(b.name), d: descriptionTool(b.name, b.input, P.path), ...fieldF(b.name, b.input, P.path) };
          last.steps.push(k); steps.set(b.id, k);
        }
      }
    }
  }
  return out;
}

export async function conversationDetail(id) {
  if (id.startsWith('s:')) {
    const sid = id.slice(2), k = [...CONV.values()].find((x) => x.sid === sid);
    if (k) return conversationDetail(k.id);
    for (const c of oldCache.values()) { const s = c.list.find((x) => x.id === id); if (s) { const P = findFloor(s.floor); return { conv: s, messages: await fromTranscript(sid, P, s.cwdFull) }; } }
    return null;
  }
  const k = CONV.get(id); if (!k) return null;
  let sp = messages(k.id);
  if (!sp.length && k.sid) { const P = findFloor(k.floor); if (P) { sp = await fromTranscript(k.sid, P, k.cwd); MESSAGES.set(k.id, sp); } }
  return { conv: summary(k), messages: sp };
}

// ---------- step descriptions ----------
const MCP_ICONS = { notion: 'notion', github: 'github', supabase: 'supabase', figma: 'figma', 'claude-in-chrome': 'chrome', chrome: 'chrome', playwright: 'chrome', calendar: 'calendar', kalendar: 'calendar', notes: 'notes' };
// file preview (files.js): a Read/Write/Edit/MultiEdit/NotebookEdit step carries f = absolute file path, the client makes a chip from it
const fieldF = (n, v, cwd) => { const f = toolPath(n, v, cwd); return f ? { f } : {}; };
const changedFile = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return Date.now(); } };
function toolName(n) {
  if (n === 'mcp__agentic__view_conversation') return tl('server.action.conversation');
  const m = n.match(/^mcp__(.+?)__(.+)$/);
  if (!m) return n;
  return m[1].replace(/^plugin_[^_]+_/, '').replace(/^claude_ai_/i, '').replace(/[-_]/g, ' ');
}
// SSE `tool` (2026-11-11): id by tools.js (mcp server, 'web', 'terminal'), conv = who calls it (also a nested task),
// k = older icon for panel.js. The same id + conversation at most once per 2 s.
const lastTools = new Map();
function emitTool(P, kid, nastroj) {
  const id = toolId(nastroj), k = iconTool(nastroj);
  if (!id && !k) return;
  const kl = (id || k) + '|' + kid, t = Date.now();
  if (t - (lastTools.get(kl) || 0) < 2000) return;
  lastTools.set(kl, t); if (lastTools.size > 500) lastTools.clear();
  emit({ kind: 'tool', ...(id ? { id } : {}), ...(k ? { k } : {}), floor: P.id, conv: kid, tool: nastroj });
}
function iconTool(n) {
  const m = n.match(/^mcp__(.+?)__/); if (!m) return null;
  const s = m[1].toLowerCase();
  for (const [k, v] of Object.entries(MCP_ICONS)) if (s.includes(k)) return v;
  return null;
}
const rel = (p, cesta) => { if (!p) return ''; const r = path.relative(cesta, path.resolve(cesta, p)); if (r === '') return '.'; return !r.startsWith('..') && !path.isAbsolute(r) ? r : p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p; };
const tail = (s, n = 90) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function descriptionTool(n, v = {}, cesta) {
  switch (n) {
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': return rel(v.file_path || v.notebook_path, cesta);
    case 'Glob': return v.pattern + (v.path && rel(v.path, cesta) !== '.' ? ` · ${rel(v.path, cesta)}` : '');
    case 'Grep': return `„${tail(v.pattern, 40)}“${v.path ? ` · ${rel(v.path, cesta)}` : ''}`;
    case 'Bash': return tail(v.description ? `${v.command} · ${v.description}` : v.command);
    case 'WebFetch': return tail(v.url); case 'WebSearch': return tail(v.query);
    case 'Skill': return v.skill || v.name || '';
    case 'mcp__agentic__view_conversation': return `[${v.sid || v.id || '?'}]`;
    default: return tail(v.description || v.query || v.title || v.name || Object.values(v).find((x) => typeof x === 'string') || '');
  }
}
function textResult(c) {
  if (typeof c === 'string') return tail(c, 300);
  if (Array.isArray(c)) return tail(c.map((x) => (x.type === 'text' ? x.text : '')).join(' '), 300);
  return '';
}
const todoItems = (v) => (v?.todos || []).map((t) => ({ t: t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content, s: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : 'pending' }));
// Work plan (2026-11-16): the "Task list" card from three tools. mcp__agentic__plan (ours, the whole list at once), TodoWrite (older SDK),
// TaskCreate/TaskUpdate (new SDK: tasks are numbered from 1 in creation order, the list is kept in `tasks` for the conversation, also between turns).
const PLAN_TOOLS = new Set(['mcp__agentic__plan', 'TodoWrite', 'TaskCreate', 'TaskUpdate']);
const STATUS_TASK = { completed: 'done', in_progress: 'doing', pending: 'pending' };
function planFromTool(name, v = {}, tasks) {
  if (name === 'TodoWrite') return todoItems(v);
  if (name === 'mcp__agentic__plan') return (Array.isArray(v.items) ? v.items : []).slice(0, 30).map((p) => ({ t: tail(p?.text, 140), s: ['done', 'doing'].includes(p?.status) ? p.status : 'pending' }));
  if (name === 'TaskCreate') tasks.push({ id: String(tasks.length + 1), t: tail(v.subject || v.description, 140), af: v.activeForm, s: 'pending' });
  else if (name === 'TaskUpdate') {
    const u = tasks.find((x) => x.id === String(v.taskId)); if (!u) return null;
    if (v.status === 'deleted') u.remove = true; else if (STATUS_TASK[v.status]) u.s = STATUS_TASK[v.status];
    if (v.subject) u.t = tail(v.subject, 140); if (v.activeForm) u.af = v.activeForm;
  } else return null;
  return tasks.filter((u) => !u.remove).map((u) => ({ t: u.s === 'doing' && u.af ? tail(u.af, 140) : u.t, s: u.s }));
}
const tasksConv = new Map(); // kid → tasks from TaskCreate (live run)

// ---------- approval and cards ----------
const PENDING = new Map(); // request id → { floor, conv, resolve, enter, key, run }
let counter = 0;
// Key of an "Always allow" rule (2026-11-23). For Bash it is the command + what exactly it runs, not just the first word (`Bash:python3` would allow
// anything): interpreters (python, node, bash, perl, osascript…) also get the script target (`Bash:python3 script.py`), npm/pnpm/yarn/git
// the subcommand (`Bash:npm run check`), npx the package. Returns null = "Always allow" must not be offered or applied, only a one-time allow:
// inline code (-c, -e, heredoc, stdin), compound command (; & | ` $( redirection), wrappers (sudo, env, xargs, eval…), unknown flag.
// A leading `cd folder &&` is ignored. Old broad keys (`Bash:python3`, `Bash:bash`, `Bash:node`, `Bash:git`) therefore never match anymore.
const INTERPRETER = /^(?:python[\d.]*|pypy[\d.]*|node(?:js)?|deno|bun|tsx|ts-node|ruby|perl|php|lua|rscript|osascript|awk|gawk|bash|sh|zsh|dash|ksh|fish|swift)$/i;
const WITHOUT_ALWAYS = /^(?:sudo|doas|su|env|xargs|eval|exec|nohup|time|timeout|nice|command|builtin|source|\.|setsid|caffeinate|watch|script|uv)$/i;
const PACKAGER = /^(?:npx|pnpx|bunx|uvx)$/i;
const SUBCOMMAND = /^(?:npm|pnpm|yarn|git)$/i;
const UNUSUAL_SUBCOMMANDS = /^(?:exec|x|dlx|create|init|eval|config|alias)$/i; // they run foreign code or change what runs later
export function ruleKey(nastroj, enter) {
  if (nastroj !== 'Bash') return nastroj;
  let c = String(enter?.command || '').trim();
  for (let i = 0; i < 3; i++) { const m = /^cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|<>$`"'()\\]+)\s*(?:&&|;)\s*/.exec(c); if (!m) break; c = c.slice(m[0].length); }
  if (!c) return null;
  const ciste = c.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, (m) => (/\$\(|`|\$\{/.test(m) ? m : '""')).replace(/\d?>&\d|\d?>\s*\/dev\/null/g, '');
  if (/[;&|`<>\n\\]|\$\(|\$\{|\$[A-Za-z_]/.test(ciste)) return null;
  const t = tokens(c), first = t[0];
  if (!first || /^\w+=/.test(first)) return null;
  const name = path.basename(withoutQuotes(first)), arg = t.slice(1).map(withoutQuotes);
  if (WITHOUT_ALWAYS.test(name)) return null;
  if (INTERPRETER.test(name)) {
    const target = arg.findIndex((x) => !x.startsWith('-')), flags = target < 0 ? arg : arg.slice(0, target);
    const module = /^python/i.test(name) && flags.length === 1 && flags[0] === '-m'; // python3 -m pytest
    if (target < 0 || !(module || flags.every((x) => /^-(?:u|B|O|OO|v|q|s|S|I|b)$/.test(x)))) return null; // -c, -e, -p, `-` (stdin) and other flags = one-time
    return `Bash:${first} ${module ? '-m ' : ''}${arg[target]}`;
  }
  if (PACKAGER.test(name)) return arg[0] && !arg[0].startsWith('-') ? `Bash:${first} ${arg[0]}` : null;
  if (SUBCOMMAND.test(name)) {
    const sub = arg[0]; if (!sub || sub.startsWith('-') || UNUSUAL_SUBCOMMANDS.test(sub)) return null;
    if (/^(?:run|run-script)$/.test(sub)) return arg[1] && !arg[1].startsWith('-') ? `Bash:${first} run ${arg[1]}` : null; // npm run check
    return `Bash:${first} ${sub}`;
  }
  return 'Bash:' + first;
}
const shorten = (s, max = 4000) => (s.length > max ? s.slice(0, max) + tl('server.action.shorten', { n: s.length - max }) : s);
function descriptionActions(nastroj, v, cesta, o) {
  if (nastroj === 'Write') return { what: tl('server.action.write'), where: rel(v.file_path, cesta), content: shorten(String(v.content || '').split('\n').map((r) => '+ ' + r).join('\n')) };
  if (nastroj === 'Edit') return { what: tl('server.action.edit'), where: rel(v.file_path, cesta), content: shorten(String(v.old_string || '').split('\n').map((r) => '- ' + r).join('\n') + '\n' + String(v.new_string || '').split('\n').map((r) => '+ ' + r).join('\n')) };
  if (nastroj === 'MultiEdit') return { what: tl('server.action.edit'), where: rel(v.file_path, cesta), content: shorten((v.edits || []).map((e) => `- ${e.old_string}\n+ ${e.new_string}`).join('\n…\n')) };
  if (nastroj === 'ExitPlanMode') return { what: tl('server.action.approvePlan'), where: tl('server.action.afterApproval'), content: shorten(String(v.plan || ''), 12000), plan: true };
  if (nastroj === 'Bash') return { what: tl('server.action.startNow'), where: v.description || String(v.command || '').split(/\s+/)[0], content: shorten('$ ' + v.command) };
  return { what: o.title || o.displayName || toolName(nastroj), where: o.description || nastroj, content: shorten(JSON.stringify(v, null, 2)) };
}
const isProtected = (p, cesta) => { if (!p) return false; const a = path.resolve(cesta, p); return /\/\.claude\/agents\//.test(a) || /(^|\/)CLAUDE(\.local)?\.md$/i.test(a); };

async function poziadaj(run, nastroj, enter, o) {
  const P = run.P;
  if (WRITE.includes(nastroj) && isProtected(enter.file_path || enter.notebook_path, P.path))
    return { behavior: 'deny', message: BAN_PROTECTED() }; // guard next to the hook
  if (nastroj === 'Bash' && pushBanned(enter.command, P.path)) return { behavior: 'deny', message: BAN_PUSH() }; // guard next to the hook
  const guard = guardCity(nastroj, enter, P.path); if (guard) return { behavior: 'deny', message: guard }; // Control center guards next to the hook
  if (nastroj === 'SendMessage' && isAddressApp(run.k, enter.to)) return { behavior: 'allow', updatedInput: enter }; // reply to a Claude app session that wrote to us (2026-11-16), without a card
  const key = ruleKey(nastroj, enter);
  if (key && always[P.id]?.includes(key)) return { behavior: 'allow', updatedInput: enter };
  // whom the request belongs to: the conversation where the tool appeared (lead or an employee's nested task)
  let kid = run.owner.get(o.toolUseID) || run.convTask.get(o.agentID);
  if (!kid) { await new Promise((r) => setTimeout(r, 60)); kid = run.owner.get(o.toolUseID) || run.convTask.get(o.agentID) || run.k.id; }
  const k = CONV.get(kid) || run.k;
  if (nastroj === 'AskUserQuestion') return ask(run, k, enter, o);
  return new Promise((resolve) => {
    const id = `p${++counter}`;
    const s = add(k, { type: 'approve', id, tool: nastroj, key, ...(key ? {} : { withoutAlways: true }), ...descriptionActions(nastroj, enter, P.path, o) });
    const vybav = (decision, vysledok) => {
      if (!PENDING.has(id)) return;
      PENDING.delete(id);
      edit(k, s.i, { resolved: decision });
      if (run.active) setStatus(k, 'running');
      if (vysledok.behavior === 'allow') emitTool(P, k.id, nastroj);
      if (nastroj === 'ExitPlanMode' && vysledok.behavior === 'allow') { // plan approved: continues in Ask mode (as Claude Code)
        run.q?.setPermissionMode('default').catch(() => {});
        if (run.k.mode === 'plan') { run.k.mode = 'default'; saveConv(); ozvi(run.k); }
      }
      resolve(vysledok);
    };
    PENDING.set(id, { floor: P.id, conv: k.id, resolve: vybav, enter, key, run });
    o.signal?.addEventListener('abort', () => vybav('zrušené', { behavior: 'deny', message: tl('server.action.cancelled') }));
    setStatus(k, 'pending'); // a lead whose employee waits for approval stays "working" (as in design v13b)
  });
}
// Questions window (2026-11-23): AskUserQuestion as in the Claude app. Card "questions" with options (one or more) and a custom
// answer, the agent waits. Answers go back in updatedInput.answers { question text: "choice, choice" } (Agent SDK format).
function ask(run, k, enter, o) {
  const questions = (Array.isArray(enter.questions) ? enter.questions : []).slice(0, 4).map((q) => ({
    question: String(q?.question || ''), headline: tail(q?.header, 30), more: !!q?.multiSelect,
    options: (Array.isArray(q?.options) ? q.options : []).slice(0, 6).map((m) => ({ t: String(m?.label || ''), p: String(m?.description || '') })),
  })).filter((q) => q.question);
  if (!questions.length) return Promise.resolve({ behavior: 'deny', message: tl('prompt.deny.blankQuestion') });
  return new Promise((resolve) => {
    const s = add(k, { type: 'questions', id: cardId('q'), questions, status: 'proposed' });
    const done = (ans) => {
      if (run.active && !pendingInRun(run)) setStatus(k, 'running');
      if (!ans) return resolve({ behavior: 'deny', message: tl('prompt.deny.withoutReplies') });
      const answers = {}; questions.forEach((q, j) => { answers[q.question] = ans[j] || '(bez odpovede)'; });
      resolve({ behavior: 'allow', updatedInput: { ...enter, answers } });
    };
    CARDS.set(s.id, { conv: k.id, i: s.i, type: 'questions', run, done });
    o.signal?.addEventListener('abort', () => { if (CARDS.delete(s.id)) { edit(k, s.i, { status: 'cancelled' }); done(null); } });
    setStatus(k, 'pending');
  });
}
const pendingInRun = (run) => [...PENDING.values(), ...CARDS.values()].some((c) => c.run === run);

export function decide(id, decision, message) {
  const c = PENDING.get(id); if (!c) return false;
  if (decision === 'reject') {
    c.resolve('zamietnuté', { behavior: 'deny', message: message?.trim() ? tl('prompt.deny.rejected', { text: message.trim() }) : tl('prompt.deny.rejectedWithout') });
  } else {
    if (decision === 'always' && c.key) { (always[c.floor] ||= []).includes(c.key) || always[c.floor].push(c.key); saveAlways(); } // a restart has no "always" rule
    c.resolve(decision === 'always' ? 'povolené vždy' : 'povolené', { behavior: 'allow', updatedInput: c.enter });
  }
  return true;
}
export const rules = (pid) => always[pid] || [];
export function cancelRule(pid, key) { always[pid] = (always[pid] || []).filter((x) => x !== key); saveAlways(); return always[pid]; }

// hiring and memory cards (the lead's own tools wait for a click)
const CARDS = new Map(); // card id → { conv, i, type, run, done(result) }
export const cardType = (id) => CARDS.get(id)?.type; // server.js: cards that want a fresh Face ID from the phone
// Scribe card after a server restart (CARDS live only in memory, scribe.js remembers the unsettled ones in data/scribe.json)
function refreshScribeCard(id) {
  const z = scribeCard(id); if (!z) return null;
  const k = CONV.get(z.conv), P = z.floor ? findFloor(z.floor) : null, s = k ? messages(k.id)[z.i] : null;
  if (!k || !P || s?.id !== id || s.status !== 'proposed') { resolveScribeCard(id, null); return null; }
  const c = { conv: k.id, i: z.i, type: 'memory', run: { P }, target: 'notes', targetAbs: z.targetAbs, done: (yes, text) => resolveScribeCard(id, !!yes, text) };
  CARDS.set(id, c); return c;
}
// Scribe after a turn (scribe.js): a memory card with target "notes" like from the propose_memory tool, but after the turn ends and without a waiting tool.
// The target is checked by writeTarget (same path as propose_memory), settled by decideCard (Add / No). The run is just { P }, the end of the next turn does not cancel it.
function addScribeCard(k, P, { text, file, reason }) {
  const cz = writeTarget(P, 'notes', file);
  if (cz.error) return { error: cz.error };
  const s = add(k, { type: 'memory', id: cardId('m'), text, target: 'notes', path: cz.path, fresh: cz.fresh, description: cz.description, status: 'proposed', source: 'scribe', ...(reason ? { reason: tail(reason, 200) } : {}) });
  CARDS.set(s.id, { conv: k.id, i: s.i, type: 'memory', run: { P }, target: 'notes', targetAbs: cz.abs, done: (yes, t) => resolveScribeCard(s.id, !!yes, t) });
  return { id: s.id, i: s.i, targetAbs: cz.abs, path: cz.path };
}
// turn excerpt for the Scribe: messages since the start of the run (run.iOd), steps of the lead and of delegated threads
export function turnData(k, run) {
  const sp = messages(k.id).slice(run.iOd || 0), children = [...(run.children || [])].flatMap((kid) => messages(kid));
  const steps = [...sp, ...children].filter((s) => s.type === 'steps').flatMap((s) => s.steps || []);
  const files = (ago) => [...new Set(steps.filter((x) => x.f && ago(x)).map((x) => nfc(x.f)))];
  return { conv: k.id, floor: k.floor,
    user: sp.filter((s) => s.type === 'user' && !s.fromLead).map((s) => String(s.text || '')),
    assistant: sp.filter((s) => s.type === 'assistant').at(-1)?.text || '',
    writes: files((x) => WRITE_TOOLS.has(x.n) && !x.error), read: files((x) => x.n === 'Read' && /\.md$/i.test(x.f)),
    commits: steps.map(commitFromStep).filter(Boolean), memory: sp.some((s) => s.type === 'memory') };
}
// Chronicler (chronicler-night.js): turns of main conversations in the window [from, to) → [{ conv, floor, agent, title, turns: [{ when, me, ai }] }]
// (ai = the agent's last reply before the user's next message). Not delegated threads and scheduled runs. Messages without ts
// (before 2026-11-25) are taken only when the conversation was created in the window.
export function turnsWindow(from, po = Date.now()) {
  const out = [];
  for (const k of CONV.values()) {
    if (k.parent || k.scheduled || (k.changed || 0) < from) continue;
    const turns = []; let update = null;
    for (const s of messages(k.id)) {
      const ts = s.ts || ((k.created || 0) >= from ? k.created : 0);
      if (s.type === 'user' && !s.fromLead) { update = ts >= from && ts < po ? { when: ts, user: String(s.text || ''), assistant: '' } : null; if (update) turns.push(update); }
      else if (s.type === 'assistant' && update) update.assistant = String(s.text || '');
    }
    if (turns.length) out.push({ conv: k.id, floor: k.floor, agent: k.agent, title: k.title || '', turns });
  }
  return out;
}
function scribeAfterTurn(k, P, run) {
  try {
    const target = noteTarget(P); if (target.kind === 'none') return;
    processTurn(turnData(k, run), { P, target, title: k.title, addCard: (x) => addScribeCard(k, P, x) }).catch((e) => console.warn('scribe:', e.message));
  } catch (e) { console.warn('scribe:', e.message); }
}
export function decideCard(id, d) {
  const c = CARDS.get(id) || refreshScribeCard(id); if (!c) return { error: tl('server.card.noPending') };
  const k = CONV.get(c.conv), s = messages(k.id)[c.i], P = c.run.P;
  if (c.type === 'hire') {
    const targets = d.who === '*' ? s.candidates.filter((x) => x.status === 'proposed') : s.candidates.filter((x) => x.k === d.who && x.status === 'proposed');
    for (const x of targets) {
      if (d.yes) { if (typeof d.md === 'string' && d.who !== '*') x.md = d.md; x.file = writeAgent(P, x); x.status = 'accepted'; }
      else x.status = 'no';
    }
    edit(k, s.i, { candidates: s.candidates });
    if (targets.some((x) => x.status === 'accepted')) emit({ kind: 'team', floor: P.id, team: publicTeam(P) });
    if (s.candidates.every((x) => x.status !== 'proposed')) { CARDS.delete(id); edit(k, s.i, { done: true }); c.done(s.candidates); }
  } else if (c.type === 'memory') {
    const text = typeof d.text === 'string' && d.text.trim() ? d.text : s.text;
    if (d.yes) {
      try {
        if (c.target === 'notes') { const cz = writeTarget(P, 'notes', path.relative(noteTarget(P).folder || '/', c.targetAbs)); if (cz.error || cz.abs !== c.targetAbs) throw new Error(cz.error || tl('server.card.target')); writeNote(P, c.targetAbs, text); }
        else writeToMemory(P, text);
      } catch (e) { return { error: tl('server.card.writeFailed', { error: e.message }) }; }
    }
    CARDS.delete(id); edit(k, s.i, { status: d.yes ? 'yes' : 'no' }); c.done(d.yes, text);
  } else if (c.type === 'deleg') { // delegation proposal (2026-11-11): Run with model and effort / Do it yourself / No
    const model = MODELS_AGENT.includes(d.model) ? d.model : s.model, effort = EFFORTS.includes(d.effort) ? d.effort : s.effort;
    const status = d.yes ? 'yes' : d.self ? 'self' : 'no', text = typeof d.text === 'string' ? d.text.trim().slice(0, 400) : '';
    CARDS.delete(id); edit(k, s.i, { status, model, effort, ...(text ? { reason: text } : {}) }); c.done({ status, model, effort, text });
  } else if (c.type === 'delegSk') { // group card (2026-11-16): Run all / One by one (splits into separate cards) / Do it yourself / No
    const model = MODELS_AGENT.includes(d.model) ? d.model : s.model, effort = EFFORTS.includes(d.effort) ? d.effort : s.effort;
    const status = d.one ? 'one' : d.yes ? 'yes' : d.self ? 'self' : 'no', text = typeof d.text === 'string' ? d.text.trim().slice(0, 400) : '';
    CARDS.delete(id); edit(k, s.i, { status, model, effort, ...(text ? { reason: text } : {}) }); c.done({ status, model, effort, text });
  } else if (c.type === 'questions') { // answers: array of texts by question (several choices joined by a comma), yes=false = skip
    const ans = d.yes === false ? null : s.questions.map((q, j) => tail(String((Array.isArray(d.answers) ? d.answers[j] : '') || '').trim(), 1000));
    CARDS.delete(id); edit(k, s.i, { status: ans ? 'yes' : 'no', ...(ans ? { answers: ans } : {}) }); c.done(ans);
  } else if (c.type === 'cap') { // per-message usage cap: Continue / Stop
    CARDS.delete(id); edit(k, s.i, { status: d.yes ? 'yes' : 'no' }); c.done(!!d.yes);
  }
  return { ok: true };
}

// ---------- usage, delegation with approval and per-message cap (2026-11-11) ----------
// Every model call (lead and employees, stream messages with parent_tool_use_id) is converted to units
// (usage.js) and added to the turn, the conversation and the employee task. After the turn result a line appears under the reply
// "≈ X % of 5 h · lead · team". Above the per-message cap every further tool (also employees') waits for the Continue / Stop card.
// The Agent tool is in WITHOUT_ASKING (canUseTool does not come), so delegation is approved by the PreToolUse hook: a card with the model
// and effort proposed by the lead, the user may change them, or say "do it yourself" (the hook returns deny with an explanation).
const MODELS_AGENT = ['haiku', 'sonnet', 'opus', 'fable'];
const aliasModel = (m) => { m = String(m || '').toLowerCase(); return MODELS_AGENT.find((x) => m === x || m.includes(x)) || null; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cardId = (p) => p + Date.now().toString(36) + (++counter); // unique even after a server restart (cards stay in the history)
const HOOK_TIME = 24 * 3600; // s: the card waits for a click

function tallyCall(run, u) {
  const m = u.message; if (!m?.usage || m.model === '<synthetic>') return;
  const id = m.id || u.uuid, j = units(m.usage, m.model), ago = run.seen.get(id) || 0;
  if (!(j > ago)) return;
  run.seen.set(id, j); const d = j - ago;
  const kid = u.parent_tool_use_id ? run.convFor.get(u.parent_tool_use_id) : null;
  if (kid && kid !== run.k.id) { run.turn.team += d; const c = CONV.get(kid); if (c) c.usage = (c.usage || 0) + d; }
  else { run.turn.lead += d; const us = m.usage; run.lastContext = (us.input_tokens || 0) + (us.cache_read_input_tokens || 0) + (us.cache_creation_input_tokens || 0); }
  run.k.usage = (run.k.usage || 0) + d;
  tally(d, limitsStatus());
  if (!run.aboveCap && run.turn.lead + run.turn.team >= run.cap) run.aboveCap = true;
}
// line under the reply: how much this turn spent (or background employees finishing after the result)
function writeUsage(run) {
  const { lead, team } = run.turn; if (lead + team < 500) return;
  add(run.k, { type: 'usage', p: toPercent(lead + team), lead: toPercent(lead), team: toPercent(team), context: run.lastContext || 0 });
  run.turn = { lead: 0, team: 0 }; run.cap = run.baseCap; run.aboveCap = false;
  saveConv(); ozvi(run.k);
}

// model, effort and estimate for the delegation card (a single task and each task of a group card)
function paramsDelegation(run, v, d) {
  const P = run.P, who = v.subagent_type || 'general-purpose', def = loadTeam(P).find((a) => a.k === who)?.definition || {};
  let model = aliasModel(v.model) || aliasModel(def.model) || aliasModel(run.model) || 'opus';
  let effort = EFFORTS.includes(v.effort) ? v.effort : EFFORTS.includes(def.effort) ? def.effort : run.effort || 'medium';
  const cap = settingsUsage().deleg; // high saving level: the card offers at most Sonnet and medium (the user changes it on the card)
  if (cap) {
    const price = { haiku: 0, sonnet: 1, opus: 2, fable: 3 };
    if ((price[model] ?? 2) > price[cap.model]) model = cap.model;
    if (EFFORTS.indexOf(effort) > EFFORTS.indexOf(cap.effort)) effort = cap.effort;
  }
  const hist = [...CONV.values()].filter((x) => x.parent && x.floor === P.id && x.agent === who && x.usage > 0 && x.id !== d?.id).sort((a, b) => a.created - b.created).map((x) => x.usage);
  const estimate = taskEstimate(hist);
  // no history of its own: rough estimate from all employees' tasks by model and effort (the card recalculates it when the choice changes)
  const estimatesModel = estimate ? null : estimatesByModel([...CONV.values()].filter((x) => x.parent && x.usage > 0 && aliasModel(x.modelActual) && x.id !== d?.id)
    .sort((a, b) => a.created - b.created).map((x) => ({ m: aliasModel(x.modelActual), e: EFFORTS.includes(x.effortActual) ? x.effortActual : null, j: x.usage })));
  return { who, model, effort, estimate, estimatesModel, proposalModel: !!aliasModel(v.model), proposalEffort: EFFORTS.includes(v.effort) };
}

// Group card (2026-11-16): several Agent calls in one lead message = one "Run all (N)" card.
// Found in transcripts: the CLI sends each tool_use block as a separate assistant message (same message.id) and runs it
// right away (streamed tool execution): the PreToolUse hook of the 1st call runs a few ms after its block, while the 2nd block is still being
// written (7 to 15 s for a long assignment). Hooks of one message therefore arrive one by one and overlap. So each hook waits for
// the end of the message (stream_event message_stop, run.doneMessage), only then it knows the whole group (run.groups by message.id).
// The first hook of the group creates the card, the others wait for the same Promise (run.grpCards). Works with concurrent hooks too.
async function groupDelegation(run, toolUseID, signal) {
  const mid = run.groupFor.get(toolUseID); if (!mid) return null;
  if (run.streamMessage.has(mid)) // the message is streaming: wait for its end (guard 3 min, in case message_stop never comes)
    for (let t = 0; t < 1800 && !run.doneMessage.has(mid) && !signal?.aborted && run.active && !run.stopped; t++) await wait(100);
  if (signal?.aborted || run.stopped) return { result: Promise.resolve({ status: 'cancelled' }) };
  const members = (run.groups.get(mid) || []).filter((x) => !CONV.get(run.convFor.get(x.id))?.rejected);
  if (members.length < 2) return null;
  let sk = run.grpCards.get(mid);
  if (!sk) { sk = { result: cardGroups(run, members, signal) }; run.grpCards.set(mid, sk); }
  return sk;
}
async function cardGroups(run, members, signal) {
  const k = CONV.get(run.owner.get(members[0].id)) || run.k;
  const tasks = members.map(({ id, v }) => { const d = CONV.get(run.convFor.get(id)); return { id, v, d, par: paramsDelegation(run, v, d) }; });
  const first = tasks[0].par, estimates = tasks.map((u) => u.par.estimate);
  // group estimate = sum of task estimates (only when each has one), otherwise a rough estimate by model times the number of tasks (the card recalculates it)
  const estimate = estimates.every(Boolean) ? { p: estimates.reduce((a, o) => a + o.p, 0), n: Math.min(...estimates.map((o) => o.n)) } : null;
  const estimatesModel = estimate ? null : Object.fromEntries(Object.entries(tasks.find((u) => u.par.estimatesModel)?.par.estimatesModel || {}).filter(([, o]) => o).map(([kl, o]) => [kl, { p: o.p * tasks.length, n: o.n }]));
  const s = add(k, { type: 'delegGroup', id: cardId('g'), status: 'proposed', model: first.model, effort: first.effort,
    proposalModel: tasks.some((u) => u.par.proposalModel), proposalEffort: tasks.some((u) => u.par.proposalEffort), estimate, estimatesModel,
    tasks: tasks.map((u) => ({ who: u.par.who, title: tail(u.v.description || tl('server.action.taskDefault'), 70), assignment: shorten(String(u.v.prompt || ''), 1500),
      thread: u.d?.id || null, ...(u.d?.number ? { number: u.d.number } : {}), inBackground: !!u.v.run_in_background, estimate: u.par.estimate })) });
  for (const u of tasks) if (u.d) setStatus(u.d, 'pending');
  const r = await new Promise((done) => {
    CARDS.set(s.id, { conv: k.id, i: s.i, type: 'delegSk', run, done }); setStatus(k, 'pending');
    signal?.addEventListener('abort', () => { if (CARDS.delete(s.id)) { edit(k, s.i, { status: 'cancelled' }); done({ status: 'cancelled' }); } });
  });
  if (r?.status === 'one') for (const u of tasks) if (u.d) setStatus(u.d, 'running'); // separate cards switch them back to "waiting"
  if (run.active && !pendingInRun(run)) setStatus(k, 'running');
  return r || { status: 'cancelled' }; // stop() settles the card with false
}

async function cardDelegation(run, enter, toolUseID, signal) {
  const v = enter?.tool_input || {};
  if (v.subagent_type === 'fork' || run.withoutHuman) return {}; // fork is the lead's continuation; scheduled tasks without a human
  let d = null;
  for (let i = 0; i < 20 && !(d = CONV.get(run.convFor.get(toolUseID))); i++) await wait(50); // the task card is created in process()
  const kid = run.owner.get(toolUseID) || run.k.id, k = CONV.get(kid) || run.k;
  const sk = await groupDelegation(run, toolUseID, signal);
  if (sk) {
    const r = await Promise.race([sk.result, new Promise((ok) => signal?.addEventListener('abort', () => ok({ status: 'cancelled' })))]);
    if (r.status !== 'one') return resultDelegation(run, d, k, v, r); // "One by one": continues with a separate card below
  }
  const { who, model, effort, estimate, estimatesModel, proposalModel, proposalEffort } = paramsDelegation(run, v, d);
  const s = add(k, { type: 'delegProposal', id: cardId('d'), who, title: tail(v.description || tl('server.action.taskDefault'), 70), assignment: shorten(String(v.prompt || ''), 1500),
    model, effort, proposalModel, proposalEffort, estimate, estimatesModel, inBackground: !!v.run_in_background, ...(d?.number ? { number: d.number } : {}), status: 'proposed' });
  if (d) setStatus(d, 'pending');
  const r = await new Promise((done) => {
    CARDS.set(s.id, { conv: k.id, i: s.i, type: 'deleg', run, done }); setStatus(k, 'pending');
    signal?.addEventListener('abort', () => { if (CARDS.delete(s.id)) { edit(k, s.i, { status: 'cancelled' }); done({ status: 'cancelled' }); } });
  });
  if (run.active && !pendingInRun(run)) setStatus(k, 'running');
  return resultDelegation(run, d, k, v, r || { status: 'cancelled' });
}
function resultDelegation(run, d, k, v, r) {
  if (r.status === 'yes') {
    if (d) { d.modelActual = r.model; d.effortActual = r.effort; setStatus(d, 'running'); }
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: tl('prompt.deleg.approved'), updatedInput: { ...v, model: r.model, effort: r.effort } } };
  }
  if (d) { d.rejected = true; d.hidden = true; setStatus(d, 'none'); if (d.delegateIndex != null) edit(k, d.delegateIndex, { status: r.status }); saveConv(); }
  return ban(r.status === 'self' ? tl('prompt.deleg.self')
    : r.status === 'cancelled' ? tl('prompt.deleg.cancelled') : tl('prompt.deleg.rejected', { reason: r.text ? tl('prompt.deleg.text', { text: r.text }) : '.' }));
}

async function watchdogCap(run, signal) {
  if (!run.aboveCap) return {};
  const cap = settingsUsage().capMessages;
  if (run.withoutHuman) { // a scheduled task has nobody to show the card to: it stops (cap × saving-level multiplier, set at the start of the run)
    if (!run.capStopped) { run.capStopped = true; add(run.k, { type: 'info', text: tl('prompt.cap.halted', { pct: String(Math.round(toPercent(run.baseCap) * 10) / 10).replace('.', tl('server.decimal')) }), error: true }); stop(run.k.id); }
    return ban(tl('prompt.cap.exceeded'));
  }
  run.capCard ||= (async () => {
    const t = run.turn, k = run.k;
    const s = add(k, { type: 'cap', id: cardId('s'), p: toPercent(t.lead + t.team), lead: toPercent(t.lead), team: toPercent(t.team), cap, status: 'proposed' });
    const yes = await new Promise((done) => {
      CARDS.set(s.id, { conv: k.id, i: s.i, type: 'cap', run, done }); setStatus(k, 'pending');
      signal?.addEventListener('abort', () => { if (CARDS.delete(s.id)) { edit(k, s.i, { status: 'cancelled' }); done(null); } });
    });
    if (run.active && !pendingInRun(run)) setStatus(k, 'running');
    if (yes) { run.cap += toUnits(cap); run.aboveCap = false; } else if (yes === false) stop(k.id);
    run.capCard = null; return yes;
  })();
  return (await run.capCard) ? {} : ban(tl('prompt.cap.stopped'));
}
// hooks of one run: floor guards + cap (every tool, employees too) + delegation approval
const hooksRun = (P, run) => {
  // a scheduled run (k.scheduled) on a floor with writeOnlyRun (Library: only the facts file) writes more strictly than a chat with the user
  const h = hooksFloor(run?.k?.scheduled && P.writeOnlyRun?.length ? { ...P, writeOnly: P.writeOnlyRun, writeReason: P.writeReasonRun || P.writeReason } : P);
  return { ...h,
    // activity in the Second Brain (brain-activity.js): after a successful Read/Write/Edit of an .md file in the brain; never blocks anything
    PostToolUse: [{ matcher: 'Read|Write|Edit|MultiEdit', hooks: [async (enter) => {
      try { const k = run?.k; recordBrain(enter, { floor: run?.P?.id || k?.floor, agent: k?.agent, name: run?.P?.lead?.name || null, conv: k?.id }); } catch (e) { console.warn('mozog-aktivita hook:', e.message); }
      return {};
    }] }],
    PreToolUse: [...h.PreToolUse,
    { hooks: [async (enter, id, o) => watchdogCap(run, o?.signal)], timeout: HOOK_TIME },
    { matcher: 'Agent|Task', hooks: [async (enter, id, o) => cardDelegation(run, enter, id || enter?.tool_use_id, o?.signal)], timeout: HOOK_TIME },
  ] };
};

// Dispatcher task card (message of type 'dispatchTasks', tool propose_tasks): dispatch.js (decideTask) changes the state of individual tasks through it.
// The state (pending / starts / running / ready / no, conv, error) is in the message, so it survives reopening the chat and a server restart.
export function taskCard(id, card) {
  const k = CONV.get(id), s = k && messages(k.id).find((x) => x?.type === 'dispatchTasks' && x.id === card);
  return s ? { tasks: s.tasks, floor: k.floor, save: () => edit(k, s.i, { tasks: s.tasks }) } : null;
}

// Card "run in a new session" (message 'newSession', tool run_in_new_session): server.js (/api/new-session) starts a conversation through it via dispatch.js startTask.
export function newSessionCard(id, kid) {
  const k = CONV.get(id), s = k && messages(k.id).find((x) => x?.type === 'newSession' && x.id === kid);
  return s ? { s, floor: k.floor, edit: (change) => edit(k, s.i, change) } : null;
}

// ---------- running a task in the Claude app (2026-11-16) ----------
// Deep link claude://code/new?q=<prompt>&folder=<abs path> opens a new Claude Code session in the desktop Claude.app with the prompt FILLED IN
// (it does not send it, the user presses Enter). The session in the app then writes to the City agent with the SendMessage tool to the NAME of its session (which is in
// the registry of live sessions ~/.claude/sessions/<pid>.json). The message is delivered only to a LIVE process, so after the turn ends the City keeps the CLI alive
// (run.waitOnApp in startTurn), otherwise the session would end after the result and would not be in ListAgents.
const IM_APP = 14336; // prompt limit: the constant IM in Claude.app's app.asar, `q` is cut via slice(0, IM) (found 2026-11-16)
const WAITING_APP = 60 * 60 * 1000; // how long the CLI waits for a reply from the app (counted again from the click on the card), then the run ends
const REGISTER_SESSIONS = path.join(HOME, '.claude', 'sessions');
function registerSessions() {
  try { return fs.readdirSync(REGISTER_SESSIONS).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(REGISTER_SESSIONS, f), 'utf8')); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// Name under which this session is in ListAgents (and thus the address for SendMessage). custom-title is used; if the CLI knows it only from a restart,
// we set it via the control request rename_session (Query.renameSession, undocumented) and verify it in the registry; on a duplicate we append the sid.
async function addressSession(run) {
  const k = run.k, base = String(k.title || '').replace(/\s+/g, ' ').replace(/[\[\]"“”„]/g, '').trim().slice(0, 80) || tl('prompt.app.name');
  if (!k.sid) return base;
  const mine = () => registerSessions().find((r) => r.sessionId === k.sid);
  let t = base;
  if (registerSessions().some((r) => r.sessionId !== k.sid && r.name === t)) t = `${base} (${k.sid.slice(0, 4)})`;
  if (mine()?.name !== t) {
    try {
      if (typeof run.q?.renameSession === 'function') await Promise.race([run.q.renameSession(t, k.sid), pause(4000)]);
      else await renameSession(k.sid, t, { dir: k.cwd || run.P.path });
    } catch (e) { console.warn('adresa appky:', e.message); try { await renameSession(k.sid, t, { dir: k.cwd || run.P.path }); } catch {} }
    for (let i = 0; i < 8 && mine()?.name !== t; i++) await pause(250);
  }
  return mine()?.name || t; // the actual name from the registry (when the rename did not take effect, the one under which the app really sees it counts)
}
const footerApp = (address) => tl('prompt.app.footer', { address, address });
export function appLink(prompt, address, folder) { // { url, trimmed }
  const footer = footerApp(address), max = Math.max(200, IM_APP - footer.length);
  const trimmed = prompt.length > max, body = trimmed ? prompt.slice(0, max - 1).replace(/[\ud800-\udbff]$/, '') + '…' : prompt; // without a lone half of a surrogate pair (encodeURIComponent would fail)
  return { url: `claude://code/new?q=${encodeURIComponent(body + footer)}&folder=${encodeURIComponent(folder)}`, trimmed };
}
const isAddressApp = (k, to) => !!to && !!k.app?.names?.includes(String(to).trim());
// Card "run in the Claude app": Open (the server builds the deep link and runs `open`, not the browser) or No. Does not wait for the agent (like the title card).
export async function openInApp({ id, card: kid, prompt, no }) {
  const k = CONV.get(id), ks = k && messages(k.id).find((x) => x.type === 'app' && x.id === kid);
  if (!ks) throw errorK(tl('server.app.cardNotFound'), 404);
  const run = LIVE.get(k.id)?.run;
  if (no) {
    if (ks.status !== 'proposed') throw errorK(tl('server.app.cardResolved'));
    edit(k, ks.i, { status: 'no' });
    if (run?.pendingApp || run?.appPending) run.endWaitingApp?.(); // the user does not want it: no need to keep the CLI alive
    return { ok: true };
  }
  const text = String(prompt ?? ks.prompt ?? '').trim();
  if (!text) throw errorK(tl('server.app.assignment'));
  const { url, trimmed } = appLink(text, ks.address, ks.cwd);
  if (!IS_MAC) throw errorK(tl('server.app.mac'), 501);
  await new Promise((resolve, reject) => execFile('open', [url], { timeout: 15000 }, (e, _o, se) => (e ? reject(errorK('Claude appka sa neotvorila: ' + (String(se).trim() || e.message), 500)) : resolve())));
  edit(k, ks.i, { status: 'open', prompt: text, ...(trimmed ? { trimmed: true } : {}) });
  if (run?.appPending) run.waitOnApp(); // waiting for the reply is counted again from the click
  return { ok: true, trimmed, length: url.length };
}
// Message from another session (cross-session-message) as a "Claude app" bubble (live and from the transcript).
const RE_PEER = /<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/;
function peerMessage(t) {
  const m = RE_PEER.exec(String(t || '')); if (!m) return null;
  const a = (n) => new RegExp(`${n}="([^"]*)"`).exec(m[1])?.[1];
  return { from: a('from-name') || tl('server.app.anotherSession'), text: m[2].trim() };
}
function peerFromEvents(u) { // the SDK knows the message origin (origin.kind 'peer', name, body); otherwise text with an envelope
  const o = u.origin?.kind === 'peer' ? u.origin : null;
  const c = u.message?.content, tx = typeof c === 'string' ? c : (c || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const p = peerMessage(tx);
  if (p) return p;
  return o ? { from: o.name || tl('server.app.anotherSession'), text: String(o.body || '').trim() } : null;
}
function addPeer(run, p) {
  if (!p?.text) return;
  const k = run.k, sp = messages(k.id);
  if (sp.slice(-40).some((s) => s.type === 'fromApp' && s.text === p.text && s.from === p.from)) return;
  add(k, { type: 'fromApp', from: p.from, text: p.text });
  run.peerInTurn = true;
  k.app = { ...(k.app || {}), names: [...new Set([...(k.app?.names || []), p.from])].slice(-8), exchanges: (k.app?.exchanges || 0) + 1 }; saveConv(); // SendMessage to these names is not approved (requestPermission)
}

function toolsCity(run) {
  const P = run.P, k = run.k;
  const waitOnCard = (type, s, extra = {}) => new Promise((done) => {
    CARDS.set(s.id, { conv: k.id, i: s.i, type, run, done, ...extra });
    setStatus(k, 'pending');
  }).finally(() => { if (run.active && !pendingInRun(run)) setStatus(k, 'running'); });
  const proposeTeam = tool('propose_team',
    tl('prompt.tool.team'),
    { candidates: z.array(z.object({
      name: z.string().describe(tl('prompt.tool.team.name')),
      slug: z.string().describe(tl('prompt.tool.team.slug')),
      emoji: z.string().describe('jeden emoji znak'),
      role: z.string().describe(tl('prompt.tool.team.role')),
      reason: z.string().describe(tl('prompt.tool.team.reason')),
      skills: z.array(z.string()).optional().describe(tl('prompt.tool.team.skills')),
      prompt: z.string().describe(tl('prompt.tool.team.prompt')),
    })).min(1).max(6) },
    async ({ candidates }) => {
      const s = add(k, { type: 'hire', id: 'n' + (++counter), candidates: candidates.map((c) => {
        const x = { k: slug(c.slug || c.name), name: c.name, emoji: c.emoji || '👤', role: c.role, reason: c.reason, skills: c.skills || [], prompt: c.prompt, status: 'proposed' };
        x.md = mdAgent(x, P); return x;
      }) });
      const result = await waitOnCard('hire', s);
      const accepted = result.filter((x) => x.status === 'accepted'), no = result.filter((x) => x.status === 'no');
      for (const x of accepted) add(k, { type: 'info', text: tl('server.team.accepted', { emoji: x.emoji, name: x.name, file: x.file }) });
      return { content: [{ type: 'text', text: accepted.length
        ? tl('prompt.team.accepted', { list: accepted.map((x) => tl('prompt.team.acceptedRow', { name: x.name, slug: x.file.replace(/^.*\/|\.md$/g, ''), file: x.file })).join(', '), no: no.length ? tl('prompt.team.declined', { list: no.map((x) => x.name).join(', ') }) : '' })
        : tl('prompt.team.nobody') }] };
    });
  const proposeMemory = tool('propose_memory',
    tl('prompt.tool.memory'),
    { text: z.string().describe(tl('prompt.tool.memory.text')),
      target: z.enum(['rule', 'notes']).optional().describe(tl('prompt.tool.memory.target')),
      file: z.string().optional().describe(tl('prompt.tool.memory.file')) },
    async ({ text, target = 'rule', file }) => {
      const cz = writeTarget(P, target, file);
      if (cz.error) return { content: [{ type: 'text', text: tl('prompt.tool.memory.notShown', { error: cz.error }) }], isError: true };
      const s = add(k, { type: 'memory', id: 'm' + (++counter), text, target, path: cz.path, fresh: cz.fresh, description: cz.description, status: 'proposed' });
      const yes = await waitOnCard('memory', s, { targetAbs: cz.abs, target });
      return { content: [{ type: 'text', text: yes ? tl('prompt.tool.memory.added', { path: cz.path }) : tl('prompt.tool.memory.notGiven') }] };
    });
  // Work plan (2026-11-16): the card is drawn by stream processing (planFromTool), so it fits a nested employee too, the tool only confirms.
  const plan = tool('plan',
    tl('prompt.tool.plan'),
    { items: z.array(z.object({ text: z.string().describe(tl('prompt.tool.plan.text')), status: z.enum(['pending', 'doing', 'done']) })).min(1).max(30) },
    async ({ items: polozky }) => ({ content: [{ type: 'text', text: tl('prompt.tool.plan.reply', { completed: polozky.filter((p) => p.status === 'done').length, total: polozky.length }) }] }));
  const viewConv = tool('view_conversation',
    tl('prompt.tool.view'),
    { sid: z.string().optional().describe(tl('prompt.tool.view.sid')), id: z.string().optional().describe(tl('prompt.tool.view.id')) },
    async ({ sid, id }) => ({ content: [{ type: 'text', text: await shortenedConversation(P, sid || id) }] }));
  // Conversation title proposal (2026-11-12): does not wait for the user, the card stays after the turn and is settled via rename({ card }).
  // Only once per conversation: k.titleProposal = 'pending' is set by sendMessage for a new conversation from the app.
  // Show file (2026-11-17): the agent opens a file preview for the user in the app next to the chat (files.js checks the path, the app opens it only in the open conversation).
  const showFile = tool('show_file',
    tl('prompt.tool.show'),
    { path: z.string().describe(tl('prompt.tool.show.path')) },
    async ({ path: cesta }) => {
      try {
        const d = filePreview(cesta, P.path);
        emit({ kind: 'showFile', path: d.path, base: P.path, conv: k.id, floor: P.id });
        return { content: [{ type: 'text', text: tl('prompt.tool.show.open', { rel: d.rel }) }] };
      } catch (e) { return { content: [{ type: 'text', text: tl('prompt.tool.show.error', { error: e.message }) }], isError: true }; }
    });
  const proposeTitle = tool('propose_title',
    tl('prompt.tool.title'),
    { title: z.string().describe(tl('prompt.tool.title.title')) },
    async ({ title: nazov }) => {
      const n = tail(String(nazov || '').replace(/\s+/g, ' ').trim().replace(/^[„"']+|[“"']+$/g, ''), 60);
      if (!['pending', 'change'].includes(k.titleProposal) || !n) return { content: [{ type: 'text', text: tl('prompt.tool.title.notNeeded') }] };
      if (n === k.title) { k.titleProposal = 'done'; return { content: [{ type: 'text', text: tl('prompt.tool.title.remains') }] }; }
      // 2026-11-19: the title is set at once (state 'auto'), the chat header has Revert / Edit until the user sends another message
      k.titleProposal = 'done';
      add(k, { type: 'title', id: cardId('t'), proposed: n, status: 'auto', original: k.title || '' });
      k.title = n; if (!k.sid) k.renameAfterSid = true; saveConv(); ozvi(k);
      if (k.sid && !k.parent) renameSession(k.sid, n, { dir: k.cwd || P.path }).catch((e) => console.warn('renameSession:', e.message));
      return { content: [{ type: 'text', text: tl('prompt.tool.title.configured') }] };
    });
  // Task in the Claude app (2026-11-16): a card in the chat (opening is done by the server, openInApp), the tool does not wait for the user. After the turn the run keeps the CLI
  // alive (run.pendingApp → startTurn), so the session is in ListAgents and the reply from the app comes as a new turn.
  const startInApp = tool('run_in_claude_app',
    tl('prompt.tool.app'),
    { prompt: z.string().describe(tl('prompt.tool.app.prompt')),
      reason: z.string().describe(tl('prompt.tool.app.reason')),
      folder: z.string().optional().describe(tl('prompt.tool.app.folder')) },
    async ({ prompt, reason, folder }) => {
      const text = String(prompt || '').trim();
      if (!text) return { content: [{ type: 'text', text: tl('prompt.tool.app.empty') }], isError: true };
      const given = String(folder || '').trim().replace(/^~(?=\/|$)/, HOME);
      const cwd = given || k.cwd || P.path;
      if (!path.isAbsolute(cwd) || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) return { content: [{ type: 'text', text: tl('prompt.tool.app.folderNo', { cwd }) }], isError: true };
      const address = await addressSession(run);
      add(k, { type: 'app', id: 'a' + Date.now().toString(36) + (++counter), reason: tail(reason, 240), prompt: text, cwd, where: tilde(cwd), address, status: 'proposed' });
      k.app = { ...(k.app || {}), address }; saveConv();
      run.pendingApp = true; // after the turn ends the CLI stays alive and waits for a message from the app
      return { content: [{ type: 'text', text: tl('prompt.tool.app.card', { address }) }] };
    });
  // New City session: a card in the chat, the server starts it after the click (/api/new-session → startTask). Does not wait for the user.
  const startInNewSession = tool('run_in_new_session',
    tl('prompt.tool.create'),
    { title: z.string().describe(tl('prompt.tool.create.title')),
      assignment: z.string().describe(tl('prompt.tool.create.assignment')),
      reason: z.string().describe(tl('prompt.tool.create.reason')) },
    async ({ title: nazov, assignment, reason }) => {
      const text = String(assignment || '').trim();
      if (!text) return { content: [{ type: 'text', text: tl('prompt.tool.create.empty') }], isError: true };
      add(k, { type: 'newSession', id: 'n' + Date.now().toString(36) + (++counter), title: tail(nazov, 60), assignment: text, reason: tail(reason, 240), status: 'proposed' });
      return { content: [{ type: 'text', text: tl('prompt.tool.create.card') }] };
    });
  // wake_when (2026-11-28): wait (server-side, no Claude) for a file / process of a detached job, then a new turn in this conversation. Does not wait for the user.
  const wakeWhen = tool('wake_when',
    tl('prompt.tool.wake'),
    { file: z.string().optional().describe(tl('prompt.tool.wake.file')),
      process: z.string().optional().describe(tl('prompt.tool.wake.process')),
      message: z.string().describe(tl('prompt.tool.wake.message')),
      timeout_minutes: z.number().optional().describe(tl('prompt.tool.wake.timeout')) },
    async ({ file, process: proc, message, timeout_minutes }) => {
      const r = wakeups.register({ conv: k.id, floor: P.id, agent: k.agent, file, process: proc, message, timeoutMinutes: timeout_minutes });
      if (r.error) return { content: [{ type: 'text', text: tl(r.error === 'noCondition' ? 'prompt.tool.wake.noCondition' : 'prompt.tool.wake.shortProcess') }], isError: true };
      const what = [r.wait.file && tilde(r.wait.file), r.wait.process && `pgrep -f "${r.wait.process}"`].filter(Boolean).join(' + ');
      add(k, { type: 'info', text: tl('server.wake.waiting', { what, min: r.minutes }) });
      return { content: [{ type: 'text', text: tl('prompt.tool.wake.registered', { min: r.minutes }) }] };
    });
  // Dispatcher (2026-11-15): proposes several tasks at once. Does not wait for the user (the card is in the chat, controlled via dispatch.js), floors and agents are verified
  // by dispatcher.verify (dispatch.js), invalid tasks are returned to the model to fix them.
  const proposeTasks = tool('propose_tasks',
    tl('prompt.tool.tasks'),
    { tasks: z.array(z.object({
      title: z.string().describe(tl('prompt.tool.tasks.title')),
      floor: z.string().describe('id poschodia zo zoznamu, napr. projekty/mesto-agentov alebo mozog/univerzal'),
      agent: z.string().optional().describe(tl('prompt.tool.tasks.agent')),
      message: z.string().describe(tl('prompt.tool.tasks.message')),
      reason: z.string().optional().describe(tl('prompt.tool.tasks.reason')),
    })).min(1).max(25) },
    async ({ tasks }) => {
      const r = dispatcher ? dispatcher.verify(tasks) : { tasks: [], errors: [tl('prompt.tool.tasks.notReady')] };
      if (!r.tasks.length) return { content: [{ type: 'text', text: tl('prompt.tool.tasks.notShown', { errors: (r.errors.join('; ') || tl('prompt.tool.tasks.none')) }) }], isError: true };
      add(k, { type: 'dispatchTasks', id: 'u' + Date.now().toString(36) + (++counter), tasks: r.tasks.map((u) => ({ ...u, status: 'pending', conv: null, error: '' })) });
      return { content: [{ type: 'text', text: tl('prompt.tool.tasks.card', { n: r.tasks.length, word: r.tasks.length === 1 ? tl('prompt.tool.tasks.task') : tl('prompt.tool.tasks.tasks'), next: r.errors.length ? tl('prompt.tool.tasks.notReceived', { errors: r.errors.join('; ') }) : tl('prompt.tool.tasks.split') }) }] };
    });
  // Personal mail (2026-11-15, P.personalMail, Home module): only reading the "Personal" account in Mail via personal-mail.js, without asking (WITHOUT_ASKING)
  const personalMail = tool('personal_mail',
    tl('prompt.tool.mail'),
    { id: z.string().optional().describe(tl('prompt.tool.mail.id')),
      search: z.string().optional().describe(tl('prompt.tool.mail.search')),
      days: z.number().optional().describe(tl('prompt.tool.mail.days')),
      max: z.number().optional().describe(tl('prompt.tool.mail.max')) },
    async ({ id, search, days, max }) => {
      try { const { readMail, listMails } = await import('./personal-mail.js'); return { content: [{ type: 'text', text: id ? await readMail(id) : await listMails({ days, search, max }) }] }; } // Home module: loaded only when used
      catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    });
  // alwaysLoad: the tools are in the prompt right away (otherwise the model first searches for them via ToolSearch and guesses parameters = extra steps)
  const restart = tool('restart_server',
    tl('prompt.tool.restart'),
    { reason: z.string().describe(tl('prompt.tool.restart.reason')) },
    async ({ reason }) => restartServer(run, k, reason));
  // Chronicler (2026-11-25, P.chronicler, virtual-floors.js): does not write an unclear thing about notes, sends it as a question to the Brain (chronicler-night.js). Does not wait for an answer.
  const question = tool('confirm_question',
    tl('prompt.tool.question'),
    { question: z.string().describe(tl('prompt.tool.question.question')),
      options: z.array(z.string()).max(4).optional().describe(tl('prompt.tool.question.options')),
      context: z.string().describe(tl('prompt.tool.question.context')),
      file: z.string().describe(tl('prompt.tool.question.file')) },
    async (v) => {
      const r = questionChronicler ? await questionChronicler(v, { conv: k.id }) : { error: tl('prompt.tool.question.notReady') };
      return r.error ? { content: [{ type: 'text', text: tl('prompt.tool.question.notSaved', { error: r.error }) }], isError: true }
        : { content: [{ type: 'text', text: tl('prompt.tool.question.saved', { id: r.id }) }] };
    });
  const tools = P.virtual ? [viewConv, plan, showFile, startInNewSession, wakeWhen, ...(P.proposalTitle ? [proposeTitle] : []), ...(P.dispatch ? [proposeTasks] : []), ...(P.personalMail ? [personalMail] : []), ...(P.chronicler ? [question] : [])] : k.agent === 'lead' ? [proposeTeam, proposeMemory, viewConv, proposeTitle, plan, startInApp, startInNewSession, showFile, wakeWhen] : [proposeMemory, proposeTitle, plan, startInApp, showFile, wakeWhen]; // virtual floor: no hiring and no project memory
  if (P.id === 'control-center') tools.push(restart);
  return createSdkMcpServer({ name: 'agentic', version: '1.0.0', alwaysLoad: true, timeout: 24 * 3600 * 1000, tools: tools });
}

// ---------- server restart from the Control center (step 4, 2026-11-10, no watchdog) ----------
// The server runs as a launchd service with KeepAlive: a self-test (`node server.js --selftest` as a child) and process exit are enough,
// launchd starts it again within ~5 s. The record data/restart.json tells the new server which conversation to message.
// State for the bar: GET /api/control-center → restart: null | { phase: 'selftest' | 'pending' | 'end', pending, reason, from, conv }.
let RESTART = null;
export const restartState = () => (RESTART ? { phase: RESTART.phase, pending: RESTART.pending, reason: RESTART.reason, from: RESTART.from, conv: RESTART.conv } : null);
const notifyRestart = () => emit({ kind: 'control-center', restart: restartState() });
const restartFile = () => path.join(DATA, 'restart.json');
const runsExcept = (run) => [...LIVE.values()].filter((z) => z.run && z.run !== run && !z.run.appPending).length; // a run that only waits for a message from the Claude app (2026-11-16) does not hold up the restart
const MAX_WAITING_REQUESTER = 90 * 1000; // the requester was told to end its turn; after that the server stops it

// write everything deferred (debounce) right away, before the process ends
export function saveAll() {
  if (!CONV_FILE) return;
  flushDeltas(); clearTimeout(saveT);
  fs.writeFileSync(CONV_FILE, JSON.stringify({ conversations: [...CONV.values()] }, null, 1));
  for (const id of [...messagesT.keys()]) saveMessages(id, true);
}

// approval card (same as for tools: Allow / Deny; "Always" means just Allow here)
function cardApproval(run, k, popis) {
  return new Promise((resolve) => {
    const id = `p${++counter}`;
    const s = add(k, { type: 'approve', id, tool: 'mcp__agentic__restart_server', key: null, ...popis });
    const vybav = (decision, vysledok) => {
      if (!PENDING.has(id)) return;
      PENDING.delete(id); edit(k, s.i, { resolved: decision });
      if (run.active && !pendingInRun(run)) setStatus(k, 'running');
      resolve(vysledok.behavior === 'allow' ? true : vysledok.message || false);
    };
    PENDING.set(id, { floor: run.P.id, conv: k.id, resolve: vybav, enter: {}, key: null, run });
    setStatus(k, 'pending');
  });
}

async function restartServer(run, k, reason) {
  const reply = (text, error = false) => ({ content: [{ type: 'text', text }], ...(error ? { isError: true } : {}) });
  reason = String(reason || '').trim() || tl('prompt.restart.reasonDefault');
  if (run.P.id !== 'control-center') return reply(tl('prompt.restart.onlyControlCenter'), true);
  if (!ROOT || !endProcess) return reply(tl('prompt.restart.withoutRoot'), true);
  if (!IS_MAC) return reply(tl('prompt.restart.noMac'), true);
  if (!underLaunchd()) return reply(tl('prompt.restart.noLaunchd'), true);
  if (RESTART) return reply(tl('prompt.restart.alreadyInProgress', { phase: RESTART.phase === 'selftest' ? tl('prompt.restart.selftest') : tl('prompt.restart.pending', { n: RESTART.pending }) }), true);
  const other = runsExcept(run);
  const ok = await cardApproval(run, k, { what: tl('prompt.restart.card'), where: reason,
    content: tl('prompt.restart.content', { when: other ? tl('prompt.restart.inOther', { n: other, word: other === 1 ? tl('prompt.restart.common') : tl('prompt.restart.usual') }) : tl('prompt.restart.endTurn') }) });
  if (ok !== true) return reply(typeof ok === 'string' ? ok : tl('prompt.restart.rejected'));
  if (RESTART) return reply(tl('prompt.restart.meanwhile'), true);
  RESTART = { conv: k.id, reason, from: now(), phase: 'selftest', pending: 0 }; notifyRestart();
  const sk = await serverSelftest(ROOT);
  if (!sk.ok) {
    RESTART = null; notifyRestart();
    add(k, { type: 'info', text: tl('server.restart.failed'), error: true });
    return reply(tl('prompt.restart.failed', { code: sk.code, output: sk.output.slice(-4000) }), true);
  }
  const commit = await commitNow(ROOT);
  try { fs.writeFileSync(restartFile(), JSON.stringify({ conv: k.id, sid: k.sid, reason, time: now(), commit, selftest: sk.output.slice(-500) }, null, 1)); }
  catch (e) { RESTART = null; notifyRestart(); return reply(tl('prompt.restart.restartJson', { error: e.message }), true); }
  RESTART.phase = 'pending'; RESTART.pending = runsExcept(run); notifyRestart();
  add(k, { type: 'info', text: tl('server.restart.passedInfo', { when: RESTART.pending ? tl('server.restart.po', { n: RESTART.pending, word: RESTART.pending === 1 ? tl('server.restart.turn1') : tl('server.restart.turn2') }) : '' }) });
  waitARestart(run).catch((e) => { console.error('reštart:', e); RESTART = null; notifyRestart(); });
  return reply(tl('prompt.restart.passed', { output: sk.output.split('\n').at(-1) || tl('prompt.restart.withoutOutput'), other: RESTART.pending ? tl('prompt.restart.other', { n: RESTART.pending }) : '' }));
}

async function waitARestart(run) {
  let free = null;
  for (;;) {
    const n = runsExcept(run);
    if (n !== RESTART.pending) { RESTART.pending = n; notifyRestart(); }
    if (!n) {
      if (!run.active) break;
      free ??= now();
      if (now() - free > MAX_WAITING_REQUESTER) { await stop(run.k.id); await new Promise((r) => setTimeout(r, 2000)); break; }
    } else free = null;
    await new Promise((r) => setTimeout(r, 1000));
  }
  RESTART.phase = 'end'; RESTART.pending = 0; notifyRestart();
  console.log(`--- ${new Date().toLocaleString('sk-SK')} reštart z centrály: ${RESTART.reason}`);
  endProcess(0);
}

// after start: message to the conversation that requested the restart (via resume of the same session). The record is deleted at once so it does not repeat.
// wake_when: a new turn in the waiting conversation (when 'next': if it runs right now, the message is queued)
async function wakeUp(w, reason) {
  const k = CONV.get(w.conv); if (!k) return;
  const what = [w.file && tilde(w.file), w.process && `pgrep -f "${w.process}"`].filter(Boolean).join(' + ');
  add(k, { type: 'info', text: tl(reason === 'timeout' ? 'server.wake.timeout' : 'server.wake.done', { what }) });
  const text = tl(reason === 'timeout' ? 'prompt.wake.timeout' : 'prompt.wake.done', { what, message: w.message });
  await sendMessage({ id: k.id, text, when: 'next' });
}

async function afterRestart() {
  let z; try { z = JSON.parse(fs.readFileSync(restartFile(), 'utf8')); } catch { return; }
  try { fs.unlinkSync(restartFile()); } catch {}
  if (!z?.conv || now() - (z.time || 0) > 30 * 60 * 1000) return; // old record (the server was off for a long time)
  const k = CONV.get(z.conv); if (!k) return;
  const time = new Date(z.time).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
  const text = tl('prompt.restart.message', { commit: z.commit ? tl('prompt.restart.commit', { hash: z.commit }) : tl('prompt.restart.withoutCommit'), time, reason: z.reason });
  try { await sendMessage({ id: k.id, text }); } catch (e) { console.warn('správa po reštarte:', e.message); }
}

// ---------- prompt ----------
// ---------- interview: older conversations, notes from the brain, git ----------
const nfc = (x) => String(x || '').normalize('NFC');
const date = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '?');
// all Claude Code sessions of the floor (also those from the app), newest first. Same as the City (build-world.js): all folders
// of the floor (`paths`, for a school subject both brain and code) with subfolders, except those belonging to another floor (longest match).
// Each session has the `cwd` where it was created: only there it can be read and resumed.
const sessionsCache = new Map(); // floor id → { when, list }
async function sessionsFloor(P) {
  const c = sessionsCache.get(P.id);
  if (c && now() - c.when < 30000) return c.list;
  const mine = (P.paths?.length ? P.paths : [P.path]).map(nfc), other = allPaths().map(nfc).filter((x) => !mine.includes(x));
  const under = (cwd, x) => cwd === x || cwd.startsWith(x + '/');
  const belongs = (cwd) => { const m = mine.filter((x) => under(cwd, x)).sort((a, b) => b.length - a.length)[0]; return !!m && !other.some((x) => x.length > m.length && under(cwd, x)); };
  const cwds = new Set(P.virtual ? [] : loadSessions().map((s) => s.cwd && nfc(s.cwd)).filter((x) => x && belongs(x)));
  const custom = P.virtual ? new Set([...CONV.values()].filter((k) => k.floor === P.id && k.sid).map((k) => k.sid)) : null; // virtual floor: only sessions of its own conversations
  for (const k of CONV.values()) if (k.floor === P.id && k.cwd) cwds.add(nfc(k.cwd)); // newly created (the file may not have a cwd yet)
  const out = new Map();
  for (const dir of cwds) {
    let items = [];
    try { items = await listSessions({ dir, limit: 200 }); } catch {}
    for (const s of items) if (!out.has(s.sessionId) && (!s.cwd || nfc(s.cwd) === dir) && (!custom || custom.has(s.sessionId))) out.set(s.sessionId, { ...s, cwd: dir });
  }
  const list = [...out.values()].sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
  sessionsCache.set(P.id, { when: now(), list });
  return list;
}
const headingSession = (s) => tail(s.customTitle || s.summary || s.firstPrompt || tl('prompt.overview.withoutTitle'), 80);
const whereSession = (P, s) => (P.paths?.length > 1 && nfc(s.cwd) !== nfc(P.path) ? tl('prompt.overview.where', { path: tilde(s.cwd) }) : '');
// short overview for the interview instructions: at most ~32 lines, only date, shortened id and title (a few hundred tokens)
export async function overviewConversations(P, withoutSid = null, max = 30) {
  const items = (await sessionsFloor(P)).filter((s) => s.sessionId !== withoutSid);
  if (!items.length) return tl('prompt.overview.none');
  const from = Math.min(...items.map((s) => s.createdAt || s.lastModified || Date.now()));
  const r = [tl('prompt.overview.header', { n: items.length, from: date(from), do: date(items[0].lastModified) })];
  for (const s of items.slice(0, max)) r.push(`- ${date(s.lastModified)} [${s.sessionId.slice(0, 8)}] ${headingSession(s)}${whereSession(P, s)}`);
  if (items.length > max) r.push(tl('prompt.overview.more', { n: items.length - max }));
  return r.join('\n');
}
// the project's notes file by the building's `notes` template (read only; a building with a folder or without notes returns null)
function notesBrain(P) {
  const c = noteTarget(P);
  return c.kind === 'project' && c.exists ? tilde(c.file) : null;
}
// shortened form of an older session: the user's messages and the agent's final text reply to each, without tool output
const MAX_CONV = 6000;
export async function shortenedConversation(P, sid) {
  sid = String(sid || '').trim().replace(/^\[|\]$/g, '');
  if (sid.length < 6) return tl('prompt.shorten.assignId');
  const match = (await sessionsFloor(P)).filter((s) => s.sessionId.startsWith(sid));
  if (match.length !== 1) return match.length ? tl('prompt.shorten.ambiguous') : tl('prompt.shorten.notBelongs');
  const info = match[0];
  let msgs = [];
  try { msgs = await getSessionMessages(info.sessionId, { dir: info.cwd || P.path }); } catch (e) { return tl('prompt.shorten.notRead', { error: e.message }); }
  const parts = []; let reply = null, count = 0;
  const textUser = (c) => (typeof c === 'string' ? c : (c || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')).trim();
  for (const m of msgs) {
    if (m.parent_tool_use_id) continue;
    const c = m.message?.content;
    if (m.type === 'user') {
      const t = c == null ? c : withoutInstruction(textUser(c) || '');
      if (!t || /^</.test(t) || t.startsWith('[Request interrupted')) continue;
      if (reply) parts.push('Agent: ' + tail(reply, 1200)); reply = null;
      parts.push(tl('prompt.shorten.user', { text: tail(t, 900) })); count++;
    } else if (m.type === 'assistant') {
      const t = (c || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (t) reply = t; // final text reply of a turn = the last text before the user's next message
    }
  }
  if (reply) parts.push('Agent: ' + tail(reply, 1200));
  let body = parts.join('\n\n');
  if (body.length > MAX_CONV) { const a = body.slice(0, 2600), b = body.slice(-3200); body = tl('prompt.shorten.omitted', { a, n: body.length - a.length - b.length, b }); }
  return tl('prompt.shorten.header', { sid: info.sessionId.slice(0, 8), title: headingSession(info), from: date(info.createdAt || info.lastModified), do: date(info.lastModified), n: count, body: body || tl('prompt.shorten.withoutText') });
}

// "oprav:" (2026-11-11): fix the bug + a permanent rule in the project's CLAUDE.md via a card, so the bug does not repeat.
// Nested employees (Agent) do not get this append, the user's message goes to the lead and the lead proposes the rule.
const TITLE = () => tl('prompt.title');
// Running title (2026-11-23): after every 3 more user messages the server adds an instruction to check the title.
// The agent renames only on a new topic. A manual title, Revert or Edit (k.titleManual) turns it off for good. Setting in data/nastavenia-chatu.json.
const TITLE_EVERY = 3;
const withoutInstruction = (t) => String(t).replace(/\s*<mesto-pokyn>[\s\S]*?<\/mesto-pokyn>/g, ''); // the server's instruction is not shown in bubbles and overviews
const fileChat = () => path.join(DATA, 'nastavenia-chatu.json');
function settingsChat() { try { return { interimTitle: true, ...JSON.parse(fs.readFileSync(fileChat(), 'utf8')) }; } catch { return { interimTitle: true }; } }
export const namesState = () => ({ interimTitle: !!settingsChat().interimTitle });
export function setNames({ interimTitle }) {
  if (typeof interimTitle !== 'boolean') throw errorK(tl('server.names.error'));
  fs.writeFileSync(fileChat(), JSON.stringify({ ...settingsChat(), interimTitle }, null, 1)); return namesState();
}
function instructionTitle(k, P, text, afterEnd) { // returns the instruction text for this message, or ''
  if (k.titleProposal === 'change') k.titleProposal = 'done'; // the prompt applies only in the turn in which it came
  if (k.titleProposal !== 'done' || k.titleManual || k.parent || k.scheduled || afterEnd || String(text).startsWith('/')) return '';
  if (P.virtual && !P.proposalTitle) return '';
  const n = messages(k.id).filter((x) => x.type === 'user' && !x.fromLead).length;
  if (n - (k.titleFrom || 1) < TITLE_EVERY || !settingsChat().interimTitle) return '';
  k.titleFrom = n; k.titleProposal = 'change'; saveConv();
  return tl('prompt.instructionTitle', { title: k.title });
}
const SHOW = () => tl('prompt.show');
const NEW = () => tl('prompt.create');
const FIX = () => tl('prompt.fix');
// Claude app (2026-11-16): tasks the City cannot handle the agent starts in the desktop app (mcp__agentic__run_in_claude_app) and talks to the session there.
const APP = () => tl('prompt.app');
// Visuals in chat (2026-11-18): ```visual and ```video blocks are shown by the app as a window right in the message (public/app/visual.js), for all floors.
const VISUAL = () => tl('prompt.visual');
async function promptPre(P, k) {
  const team = loadTeam(P), rel = relCwd(k, P), cesta = (P.shortPath || P.path) + (rel ? tl('prompt.nested', { rel }) : '');
  const base = tl('prompt.base', { who: Who(), visual: VISUAL() });
  if (P.prompt) return `${base}\n${P.prompt}${P.dispatch && dispatcher ? dispatcher.context() : ''}${P.proposalTitle ? TITLE() : ''}${NEW()}`; // virtual Home floor: the lead's own instructions (e.g. Sorter), no team and no interview
  if (k.agent !== 'lead') {
    const a = team.find((x) => x.k === k.agent);
    return tl('prompt.teammate', { base, agent: a ? tl('prompt.agentRole', { emoji: a.emoji, name: a.name, role: a.role }) : k.agent, floor: P.n, path: cesta, notes: noteInstruction(P, true), fix: FIX(), title: TITLE(), app: APP(), show: SHOW() });
  }
  let txt = tl('prompt.lead', { base, floor: P.n, path: cesta, team: team.length ? team.map((a) => tl('prompt.teamMember', { name: a.name, slug: a.k, role: a.role })).join(', ') : tl('prompt.teamNobody') });
  txt += tl('prompt.lead.older');
  if (P.codePath) txt += tl('prompt.lead.code', { code: tilde(P.codePath) });
  txt += tl('prompt.lead.instructions', { notes: noteInstruction(P, true), fix: FIX(), title: TITLE(), app: APP(), create: NEW(), show: SHOW() });
  if (!team.length) {
    const position = notesBrain(P), git = fs.existsSync(path.join(P.path, '.git'));
    const sources = [tl('prompt.interview.overview'), position && tl('prompt.interview.notes', { position }), git && tl('prompt.interview.git'), P.codePath && tl('prompt.interview.code', { code: tilde(P.codePath) })].filter(Boolean).join(', ');
    txt += tl('prompt.interview', { sources, overview: await overviewConversations(P, k.sid) });
  }
  return txt;
}

// ---------- running one turn ----------
// Opus 4.6+ / Sonnet 5+ / Fable / Haiku 5.5 have 1M context, older ones 200k (or [1m] in the name)
const modelContext = (model) => (/\[1m\]|opus-(4-[6-9]|5)|sonnet-(4-6|5)|fable|mythos|haiku-5/.test(model || '') ? 1_000_000 : 200_000);

// afterEnd (server only, e.g. sorting.js): called after the turn ends with { status, text } (conversation status, last reply)
export async function sendMessage({ id, floor, agent = 'lead', text, images, attachments, model, effort, mode, ultracode, afterEnd, title, when, deliberate, subfolder }) {
  text = String(text || '').trim();
  const obr = verifyImages(images), pr = verifyAttachments(attachments);
  if (!text && !obr.length && !pr.length) throw Object.assign(new Error(tl('server.edit.blank')), { code: 400 });
  const banPr = guardCommand(text); if (banPr) throw Object.assign(new Error(banPr), { code: 400 });
  let k = id ? CONV.get(id) : null;
  if (id?.startsWith('s:')) { // continuing an older Claude Code session: we take it over into the app
    const sid = id.slice(2);
    k = [...CONV.values()].find((x) => x.sid === sid);
    if (!k) {
      let star = null; for (const c of oldCache.values()) star ||= c.list.find((x) => x.id === id);
      if (!star) throw Object.assign(new Error(tl('server.send.unknownSession')), { code: 404 });
      const P = findFloor(star.floor);
      k = { id: novId(), sid, cwd: star.cwdFull, floor: star.floor, agent: 'lead', title: star.title, parent: null, created: star.created, changed: now(), context: 0, status: 'none', count: 0 };
      CONV.set(k.id, k); MESSAGES.set(k.id, await fromTranscript(sid, P, k.cwd)); oldCache.delete(P.path);
      saveConv(); saveMessages(k.id);
    }
  }
  if (k?.parent) { // a nested task cannot be written to (it runs in the lead's session): a new direct conversation with the employee
    floor = k.floor; agent = k.agent; k = null;
  }
  if (!k) {
    const P = findFloor(floor); if (!P) throw Object.assign(new Error(tl('server.http.unknownFloor')), { code: 404 });
    if (agent !== 'lead' && !loadTeam(P).some((a) => a.k === agent)) throw Object.assign(new Error(tl('server.dispatch.unknownTeammate')), { code: 404 });
    let cwd = nfc(P.path);
    if (subfolder) { // only a subfolder from the floor's list (with CLAUDE.md), nothing outside it
      const rel = nfc(String(subfolder)).replace(/^\/+|\/+$/g, '');
      if (!subfolders(P).includes(rel)) throw Object.assign(new Error(tl('server.send.subfolder')), { code: 400 });
      cwd = nfc(path.join(P.path, rel));
    }
    k = { id: novId(), sid: null, cwd, floor: P.id, agent, title: title ? tail(title, 60) : tail(text || (pr.length ? pr.map((p) => p.title).join(', ') : obr.length > 1 ? `${obr.length} screenshots` : 'Screenshot'), 60), parent: null, created: now(), changed: now(), context: 0, status: 'none', count: 0 };
    if (!title && typeof afterEnd !== 'function' && (!P.virtual || P.proposalTitle) && !text.startsWith('/')) k.titleProposal = 'pending'; // title proposal (propose_title)
    if (typeof afterEnd === 'function') k.scheduled = true; // run of a scheduled server task (agentRun): the hook may have a stricter writeOnlyRun
    CONV.set(k.id, k); MESSAGES.set(k.id, []); saveConv();
  }
  const bezici = LIVE.get(k.id)?.run;
  // during a run only from the app (when 'next' / 'now'), scheduled server tasks (afterEnd) get 409 as before
  if (bezici && (!['next', 'now'].includes(when) || afterEnd)) throw Object.assign(new Error(tl('server.send.working')), { code: 409 });
  if (validModel(model)) k.model = model; // the choice applies to this conversation until you change it
  if (validEffort(effort)) k.effort = effort;
  if (validMode(mode)) k.mode = mode;
  if (typeof ultracode === 'boolean' && ultracode !== !!k.ultracode) { // Ultra Code (2026-11-18): workflows with subagents, applies to the whole session
    k.ultracode = ultracode; saveConv();
    if (bezici?.q?.applyFlagSettings) Promise.resolve().then(() => bezici.q.applyFlagSettings({ ultracode })).catch((e) => console.error('ultracode za behu:', e.message));
  }
  if (bezici) { queueToQueue(bezici, text, obr, pr, when === 'now'); return summary(k); }
  if (k.sid && !afterEnd && !text.startsWith('/')) expensiveContinuation(k, deliberate === true);
  const P = findFloor(k.floor); if (!P) throw Object.assign(new Error(tl('server.send.floorMissing')), { code: 404 });
  startTurn(k, P, text, obr, pr, typeof afterEnd === 'function' ? afterEnd : null); // runs in the background
  return summary(k);
}

// Editing a sent message (2026-11-16), as on claude.ai: everything from the edited message on disappears from the thread and from the agent's
// context and a new turn goes with the edited text. The session is resumed up to the entry right before that message (resumeSessionAt =
// the message's parentUuid in the JSONL). The CLI writes a new branch into the same file (the sid stays), the old continuation stays in it
// as a dead branch; getSessionMessages and further resumes follow the parentUuid chain from the newest leaf. The first message
// of a session has no parent: a new session starts and the old one is hidden in the City (the file stays). File changes are not reverted.
const textUzivatela = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some((b) => b.type === 'tool_result')) return null;
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
};
async function pointAgoMessage(k, P, sp, i) {
  const s = sp[i], t = findTranscript(k.sid);
  if (!t) throw errorK(tl('server.edit.fileSession'), 409);
  const records = new Map();
  for (const r of fs.readFileSync(t.f, 'utf8').split('\n')) { if (!r) continue; try { const o = JSON.parse(r); if (o.uuid) records.set(o.uuid, o); } catch {} }
  let z = s.uuid ? records.get(s.uuid) : null;
  if (!z) { // older message without uuid: the n-th of your messages with the same text in the current branch of the session
    const tx = (s.text || '').trim(), n = sp.slice(0, i).filter((x) => x.type === 'user' && (x.text || '').trim() === tx).length;
    const msgs = await getSessionMessages(k.sid, { dir: k.cwd || P.path }).catch(() => []);
    const cand = msgs.filter((m) => {
      if (m.type !== 'user' || m.parent_tool_use_id) return false;
      const o = m.message?.content, txt = textUzivatela(o);
      if (txt == null || /^\s*</.test(txt)) return false;
      return tx ? txt.trim().startsWith(tx) : Array.isArray(o) && o.some((b) => b.type === 'image');
    });
    z = cand[n] && records.get(cand[n].uuid);
  }
  if (!z) throw errorK(tl('server.edit.notFound'), 409);
  return z.parentUuid || null; // null = first message of the session
}
export async function editMessage({ id, i, text }) {
  const k = CONV.get(id); if (!k) throw errorK(tl('server.conv.notFound'), 404);
  if (k.parent) throw errorK(tl('server.edit.task'));
  // editing during a run (2026-11-18): we stop the agent and drop messages waiting in the queue (everything after the edited message disappears anyway)
  if (withChildren(k).some((x) => running(x.id))) {
    const run = LIVE.get(k.id)?.run; if (run) run.queue.splice(0);
    await stop(k.id);
    for (let t = 0; t < 60 && withChildren(k).some((x) => running(x.id)); t++) await new Promise((r) => setTimeout(r, 150));
    if (withChildren(k).some((x) => running(x.id))) throw errorK(tl('server.edit.missed'), 409);
  }
  const P = findFloor(k.floor); if (!P) throw errorK(tl('server.send.floorMissing'), 404);
  const sp = messages(k.id), idx = Number(i), s = sp[idx];
  if (!Number.isInteger(idx) || s?.type !== 'user' || s.fromLead) throw errorK(tl('server.edit.onlyYour'));
  text = String(text || '').trim();
  const banPr = guardCommand(text); if (banPr) throw errorK(banPr);
  // attachments and screenshots of the original message stay (those still on disk)
  const typeFromExtensions = Object.fromEntries(Object.entries(TYPES_IMAGE).map(([t, p]) => [p, t]));
  const obr = (s.images || []).map((name) => { const f = image(name); return f ? { type: typeFromExtensions[path.extname(name)], data: fs.readFileSync(f).toString('base64'), name } : null; }).filter(Boolean);
  const pr = verifyAttachments((s.attachments || []).map((p) => p.id).filter((x) => attachment(x)));
  if (!text && !obr.length && !pr.length) throw errorK(tl('server.edit.blank'));
  const error = (s.images?.length || 0) + (s.attachments?.length || 0) - obr.length - pr.length;
  const resumeAt = k.sid ? await pointAgoMessage(k, P, sp, idx) : null;
  if (running(k.id)) throw errorK(tl('server.edit.stopAgent'), 409); // meanwhile (await) a turn may have started
  // employee threads from the removed part get hidden (they are in the removed branch of the session)
  const children = sp.slice(idx).filter((x) => x.type === 'delegate' && x.thread && CONV.get(x.thread)?.parent === k.id).map((x) => x.thread);
  for (const d of children) CONV.get(d).hidden = true;
  if (!resumeAt && k.sid) { HIDDEN.add(k.sid); fs.writeFileSync(HIDDEN_FILE, JSON.stringify([...HIDDEN])); oldCache.clear(); sessionsCache.clear(); k.sid = null; k.renameAfterSid = true; }
  sp.length = idx;
  k.count = sp.filter((x) => x.type === 'user' || x.type === 'assistant').length; k.context = 0; delete k.breakdown; delete k.deliberateContext;
  saveMessages(k.id, true); saveConv();
  emit({ kind: 'trimmed', id: k.id, from: idx });
  if (children.length) emit({ kind: 'deleted', ids: children });
  startTurn(k, P, text, obr, pr, null, { resumeAt }); // runs in the background (adds the message to the thread right away, synchronously)
  if (error > 0) add(k, { type: 'info', text: tl('server.send.attachmentsError', { what: error === 1 ? tl('server.send.attachmentOne') : tl('server.send.attachmentsMore', { n: error }) }) });
  return summary(k);
}

// Before sending into an existing conversation (2026-11-11): when the cache expired (idle above idleMin, the lead's cache
// lives 1 h) or the context is above the threshold, the server returns 428 with a warning and the app offers "Send anyway" (deliberately)
// or a new conversation that only refers to this one (view_conversation). For context it asks again after every +100k.
function expensiveContinuation(k, deliberate) {
  const n = settingsUsage(), ctx = k.breakdown?.total || Math.round((k.context || 0) * (k.maxTokens || 0));
  const minutes = Math.round((now() - (k.endTurn || k.changed || now())) / 60000), degree = Math.floor(ctx / 100000) + 1; // 1 = first warning above the threshold
  if (deliberate) { if (ctx > n.thresholdContext) k.deliberateContext = degree; return; }
  const base = { context: ctx, minutes, sid: (k.sid || '').slice(0, 8), title: k.title };
  let u = null;
  if (minutes > n.idleMin && ctx > 60000) u = { kind: 'cache', ...base, p: toPercent(ctx * 2) }; // writing the 1 h cache = 2× input
  else if (ctx > n.thresholdContext && (k.deliberateContext || 0) < degree) u = { kind: 'context', ...base, p: toPercent(ctx * 0.1), pMessage: toPercent(ctx * 0.1 * 8) }; // step = reading the context from the cache, a normal message ~8 steps
  if (u) throw Object.assign(new Error(u.kind === 'cache' ? tl('server.send.expensive1') : tl('server.send.expensive2')), { code: 428, alert: u });
}

async function startTurn(k, P, text, obr = [], pr = [], afterEnd = null, { resumeAt = null } = {}) { // resumeAt: editing a message (editMessage)
  const run = { k, P, active: true, q: null, owner: new Map(), convTask: new Map(), convFor: new Map([[null, k.id]]), steps: new Map(), streamed: new Set(), open: new Map(), todo: new Map(), children: new Set(), maxTokens: k.maxTokens || 0, model: null,
    queue: [], cancelled: new Set(), consumed: new Set(), // messages during a run (queueToQueue)
    seen: new Map(), turn: { lead: 0, team: 0 }, aboveCap: false, withoutHuman: !!afterEnd, // turn usage (tallyCall)
    // group delegation card (groupDelegation): Agent calls by message.id and the end of the streamed message
    groupFor: new Map(), groups: new Map(), grpCards: new Map(), msgPre: new Map(), streamMessage: new Set(), doneMessage: new Set() };
  { const n = settingsUsage(); run.baseCap = run.cap = toUnits(n.capMessages * (afterEnd ? n.withoutHuman : 1)); } // saving level (usage.js LEVELS)
  const z = LIVE.get(k.id) || {}; LIVE.set(k.id, z); z.run = run;
  const uuidMe = crypto.randomUUID(); // uuid of the message in the session JSONL (message editing finds the branch point by it)
  run.iOd = messages(k.id).length; // start of the turn for the Scribe (turnData)
  add(k, { ...messageMe(text, obr, pr), uuid: uuidMe });
  const instruction = resumeAt ? '' : instructionTitle(k, P, text, afterEnd); // running title (TITLE_EVERY)
  if (!k.sid) add(k, { type: 'info', text: tl('server.send.newSession', { where: tilde(k.cwd || P.path), agent: k.agent !== 'lead' ? ` · --agent ${k.agent}` : '' }) });
  setStatus(k, 'running');
  const t0 = now();
  // Input is a queue: the first message followed by messages the user sends during the run (priority 'next', the CLI inserts them after
  // the current tool finishes). The input is closed only after the result, when no sent message is waiting anymore (2026-11-11).
  const onSend = []; let alarm = null, end = false, guard = null;
  const endInput = () => { end = true; run.enterEnd = true; alarm?.(); };
  // Waiting for a message from the Claude app (2026-11-16): after the result we do not close the input, the CLI stays alive (the session is in ListAgents and receives
  // the message from the app session as a new turn). Ends with a reply from the app, the "No" card, a stop or after WAITING_APP since the last activity.
  run.waitOnApp = () => {
    run.appPending = true; clearTimeout(run.appTime);
    run.appTime = setTimeout(() => {
      if (!run.appPending) return;
      run.endWaitingApp(); add(k, { type: 'info', text: tl('server.send.appNoAnswer') });
      endInput();
    }, WAITING_APP);
    const zz = LIVE.get(k.id); if (zz) { zz.app = true; ozvi(k); }
  };
  run.endWaitingApp = () => {
    clearTimeout(run.appTime); const was = run.appPending; run.appPending = false; run.pendingApp = false;
    const zz = LIVE.get(k.id); if (zz?.app) { zz.app = false; ozvi(k); }
    if (was && !run.queue.some((f) => !f.afterRun)) endInput(); // nobody sent anything else: no need to keep the CLI
  };
  run.insert = (m) => { onSend.push(m); alarm?.(); };
  const enter = (async function* () {
    yield { type: 'user', uuid: uuidMe, message: { role: 'user', content: contentMessages(text + instruction, obr, pr) }, parent_tool_use_id: null, session_id: k.sid || '' };
    while (true) {
      while (onSend.length) yield onSend.shift();
      if (end) return;
      await new Promise((r) => (alarm = r)); alarm = null;
    }
  })();
  const anythingPending = () => run.queue.some((f) => !f.afterRun) || [...run.cancelled].some((u) => !run.consumed.has(u));
  let error = null;
  const choice = choiceConv(k, P); k.effortActual = choice.effort; run.effort = choice.effort;
  try {
    run.q = query({
      prompt: enter,
      options: {
        cwd: k.cwd || P.path, resume: k.sid || undefined, ...(resumeAt && k.sid ? { resumeSessionAt: resumeAt } : {}), pathToClaudeCodeExecutable: CLAUDE_BIN, env: cleanEnv(),
        model: choice.model, effort: choice.effort, settings: { ultracode: choice.ultracode }, // with resume the setting does not carry over, it is sent every turn
        additionalDirectories: [...new Set([P.path, ...(P.paths || [])])].filter((x) => nfc(x) !== nfc(k.cwd || P.path)), // school subject: brain and code of tasks; nested project: the whole floor too
        settingSources: ['user', 'project', 'local'], // CLAUDE.md, skills, MCP as in Claude Code
        systemPrompt: { type: 'preset', preset: 'claude_code', append: await promptPre(P, k) },
        agent: k.agent !== 'lead' ? k.agent : undefined,
        agents: agentsOutsideCwd(P, k.cwd || P.path),
        permissionMode: choice.mode, allowedTools: [...WITHOUT_ASKING, ...(P.allowedTools || [])], disallowedTools: [...(P.withoutTeam ? ['Agent', 'Task'] : []), ...(P.bannedTools || [])], // a floor without a team does not delegate
        includePartialMessages: true, hooks: hooksRun(P, run),
        mcpServers: { agentic: toolsCity(run) },
        canUseTool: (nastroj, enterN, o) => poziadaj(run, nastroj, enterN, o),
      },
    });
    for await (const u of run.q) {
      clearTimeout(guard);
      if (u.type === 'command_lifecycle') { lifeMessages(run, u); continue; }
      try { await spracuj(run, u); } catch (e) { console.error('process:', e); }
      if (u.type === 'result') {
        for (const o of run.open.values()) edit(CONV.get(o.kid), o.i, { writing: false }); // interrupted text (Send now)
        run.open.clear();
        learnFromResult(u.modelUsage); writeUsage(run);
        for (const x of u.user_message_uuids || (u.user_message_uuid ? [u.user_message_uuid] : [])) delivered(run, x);
        await detectContext(run);
        // the next turn with a message from the queue comes by itself; guard in case the CLI no longer reports the message
        run.peerInTurn = false; run.betweenTurns = true;
        if (run.pendingApp && !run.stopped && !run.error && !anythingPending()) run.waitOnApp(); // waits for a reply from the Claude app (tool run_in_claude_app or SendMessage to the app)
        // Background employees still running (2026-11-24): we do not close the input, a message from the user goes to the lead right away as
        // a new turn and the employees keep running. The input is closed after the turn result when none is running anymore (or by the guard below).
        else if (anythingPending()) guard = setTimeout(endInput, 20000);
        else if (!onBackgroundRunning(run)) endInput();
      } else if (!u.parent_tool_use_id && (u.type === 'stream_event' || u.type === 'assistant')) run.betweenTurns = false;
      // the last background employee finished between turns: the CLI usually starts a turn with a notification (its result closes the input),
      // if it does not, the guard closes the input itself
      if (u.type === 'system' && u.subtype === 'task_notification' && run.betweenTurns && !run.enterEnd && !onBackgroundRunning(run) && !anythingPending()) guard = setTimeout(endInput, 30000);
    }
  } catch (e) { error = e.message; } finally {
    clearTimeout(guard); clearTimeout(run.appTime); run.appPending = false; if (z.app) z.app = false; endInput();
    run.active = false; flushDeltas();
    writeUsage(run); k.endTurn = now(); // background employees finishing, stopped turn
    for (const [id, c] of PENDING) if (c.run === run) c.resolve('zrušené', { behavior: 'deny', message: tl('server.action.cancelled') });
    for (const [id, c] of CARDS) if (c.run === run) { CARDS.delete(id); const kk = CONV.get(c.conv); edit(kk, c.i, c.type === 'memory' ? { status: 'no' } : ['deleg', 'cap', 'questions'].includes(c.type) ? { status: 'cancelled' } : { cancelled: true }); }
    for (const kid of new Set([k.id, ...run.children])) { // close unfinished texts and steps
      const sp = messages(kid);
      for (const s of sp) { if (s.writing) edit(CONV.get(kid), s.i, { writing: false }); if (s.type === 'steps' && s.running) edit(CONV.get(kid), s.i, { running: false }); }
    }
    for (const kid of run.children) { const d = CONV.get(kid); if (d.taskSummary && !messages(kid).some((s) => s.type === 'assistant')) add(d, { type: 'assistant', text: d.taskSummary }); if (['running', 'pending'].includes(LIVE.get(kid)?.status)) { d.duration = now() - d.created; setStatus(d, run.stopped ? 'none' : 'done'); } }
    k.duration = now() - t0;
    if (run.closedImmediately) error = null; // the CLI was closed by the app (Send now after the turn ended), not an error
    if (error && !run.stopped) add(k, { type: 'info', text: `⚠️ ${error}`, error: true });
    if (run.stopped) add(k, { type: 'info', text: tl('server.send.stopped') });
    const last = messages(k.id).filter((s) => s.type === 'assistant').at(-1);
    const status = run.error || (error && !run.stopped) ? 'error' : run.stopped ? 'none' : !afterEnd && !k.scheduled && last && /\?[\s*_)"“”»]*$/.test(last.text) && !isOffer(last.text) && last.i > messages(k.id).length - 3 ? 'reply' : 'done';
    z.run = null; setStatus(k, status);
    saveMessages(k.id, true); for (const kid of run.children) saveMessages(kid, true);
    if (afterEnd) { try { afterEnd({ status, text: last?.text || '' }); } catch (e) { console.error('afterEnd:', e); } }
    // Scribe after a turn (2026-11-25): only the lead of a floor with notes, not delegated threads, virtual floors, scheduled runs, an error or a stop
    else if (!k.parent && k.agent === 'lead' && !P.virtual && !k.scheduled && !run.stopped && status !== 'error') scribeAfterTurn(k, P, run);
    // messages sent after a stop or right after the turn ended: the next turn at once, all together
    const remaining = run.queue.splice(0);
    if (remaining.length) startTurn(k, P, remaining.map((f) => f.text).filter(Boolean).join('\n\n'), remaining.flatMap((f) => f.image), remaining.flatMap((f) => f.pr));
  }
}

// ---------- slash commands (2026-11-11) ----------
// List for the menu after "/" in the app: supportedCommands() from the CLI in the floor's folder (skills, custom commands, plugins,
// built-in). No model message, ~0.3 s, cache 10 min per floor. Built-in only those that make sense without a terminal;
// /model, /effort, /permissions and /clear are handled by the app with its own pickers (they do not go to the CLI).
const COMMANDS = new Map(); // pid → { when, list } or { run: Promise }
const BUILTIN_ALLOWED = new Set(['compact', 'context', 'usage', 'code-review', 'simplify', 'security-review', 'verify', 'deep-research', 'debug', 'run', 'recap', 'insights', 'skill-doctor', 'dataviz', 'claude-api', 'workflow-authoring', 'plugin-authoring']);
// Terminal, settings, login and commands that would bypass guards in the City or make no sense (each turn is a new process).
const COMMANDS_BANNED = new Set(['config', 'settings', 'color', 'focus', 'heapdump', 'doctor', 'checkup', 'import', 'autocompact', 'output-style', 'fast', 'advisor', 'mcp', 'init',
  'update-config', 'fewer-permission-prompts', 'loop', 'proactive', 'schedule', 'routines', 'batch', 'goal', 'usage-credits', 'extra-usage', 'design', 'design-sync', 'design-consent', 'design-revoke',
  'auto-mode-setup', 'team-onboarding', '__remote-workflow', 'workflow-launch-exec', 'reload-plugins', 'reload-skills', 'agents', 'list-agents', 'peers', 'login', 'logout', 'resume', 'exit', 'quit',
  'vim', 'ide', 'theme', 'terminal-setup', 'statusline', 'hooks', 'memory', 'add-dir', 'export', 'permissions', 'model', 'effort', 'clear', 'reset', 'new', 'rename', 'name', 'install-github-app', 'upgrade']);
export function guardCommand(text) {
  const m = /^\/([\w:.-]+)/.exec(String(text || '').trim()); if (!m) return null;
  const n = m[1].toLowerCase();
  if (['model', 'effort', 'permissions', 'clear', 'reset', 'new'].includes(n)) return tl('server.command.sets', { n });
  if (COMMANDS_BANNED.has(n)) return tl('server.command.fails', { n });
  return null;
}
export async function floorCommands(pid) {
  const P = findFloor(pid); if (!P) return null;
  const c = COMMANDS.get(pid);
  if (c?.list && now() - c.when < 10 * 60 * 1000) return c.list;
  if (c?.run) return c.run;
  const run = (async () => {
    const q = query({ prompt: (async function* () { await new Promise(() => {}); })(), options: {
      cwd: P.path, additionalDirectories: (P.paths || []).filter((x) => nfc(x) !== nfc(P.path)), pathToClaudeCodeExecutable: CLAUDE_BIN, env: cleanEnv(), settingSources: ['user', 'project', 'local'] } });
    try {
      const all = await Promise.race([q.supportedCommands(), new Promise((_, r) => setTimeout(() => r(new Error('CLI neodpovedal')), 15000))]);
      const seen = new Set(), list = [];
      for (const x of all) {
        const n = x.name; if (!n || seen.has(n) || n.startsWith('__')) continue;
        if (x.builtin ? !BUILTIN_ALLOWED.has(n) : COMMANDS_BANNED.has(n)) continue;
        if (/^\(removed\)|^Renamed to/.test(x.description || '')) continue;
        seen.add(n);
        list.push({ n, description: tail(String(x.description || '').replace(/\s+/g, ' ').replace(/^\([\w-]+\) /, ''), 160), arg: x.argumentHint || '', alias: (x.aliases || []).filter((a) => a !== n), kind: x.builtin ? 'claude' : n.includes(':') || /^\([\w-]+\) /.test(x.description || '') ? 'plugin' : 'skill' });
      }
      COMMANDS.set(pid, { when: now(), list });
      return list;
    } catch (e) { COMMANDS.delete(pid); throw e; } finally { try { q.close(); } catch {} }
  })();
  COMMANDS.set(pid, { ...c, run });
  return run;
}

// ---------- messages during a run ----------
// As in the Claude app: Enter while working queues the message and the agent reads it after the current step finishes
// (priority 'next'), "Send now" (or ⌘↵) additionally interrupts the turn and the message goes as the next turn. The message is written
// to the thread only when the agent really got it (command_lifecycle), until then it is in the bar above the field (summary().queue).
const messageMe = (text, obr, pr) => ({ type: 'user', text, ...(obr.length ? { images: obr.map((o) => o.name) } : {}), ...(pr.length ? { attachments: pr.map(({ id, title: nazov, size }) => ({ id, title: nazov, size })) } : {}) });
// images before text (as in Claude Code), the model sees them in the same message; attachments as paths at the end of the text
function contentMessages(text, obr, pr) {
  const tx = textWithAttachments(text, pr);
  return obr.length ? [...obr.map((o) => ({ type: 'image', source: { type: 'base64', media_type: o.type, data: o.data } })), ...(tx ? [{ type: 'text', text: tx }] : [])] : tx;
}
// an employee started with run_in_background is still working (or waiting for approval)
const onBackgroundRunning = (run) => [...run.children].some((kid) => CONV.get(kid)?.inBackground && ['running', 'pending'].includes(LIVE.get(kid)?.status));
function queueToQueue(run, text, obr, pr, immediately) {
  const f = { uuid: crypto.randomUUID(), text, image: obr, pr, time: timeNow() };
  run.queue.push(f);
  // after the result (input closed) or after a stop the CLI accepts nothing: the message goes as a new turn after the run ends
  if (run.enterEnd || run.stopped) f.afterRun = true;
  else run.insert({ type: 'user', uuid: f.uuid, priority: 'next', message: { role: 'user', content: contentMessages(text, obr, pr) }, parent_tool_use_id: null, session_id: run.k.sid || '' });
  ozvi(run.k);
  if (immediately) interruptForQueue(run);
}
function delivered(run, uuid) {
  run.consumed.add(uuid);
  const j = run.queue.findIndex((f) => f.uuid === uuid); if (j < 0) return;
  const [f] = run.queue.splice(j, 1);
  add(run.k, { ...messageMe(f.text, f.image, f.pr), uuid: f.uuid }); ozvi(run.k);
}
function lifeMessages(run, u) {
  const id = u.command_uuid; if (!id) return;
  if (u.state === 'cancelled') { // cancelled from the queue (cancelFromQueue) or on stop: does not go to the thread
    run.consumed.add(id);
    const j = run.queue.findIndex((f) => f.uuid === id); if (j >= 0) { run.queue.splice(j, 1); ozvi(run.k); }
    return;
  }
  if (run.cancelled.has(id)) { // stopped run: a message from the queue would start as a new turn, we interrupt it right away
    if (u.state === 'started') { run.suppress = true; run.q?.interrupt().catch(() => {}); }
    else if (u.state !== 'queued') run.consumed.add(id);
    return;
  }
  if (u.state !== 'queued') delivered(run, id); // started = inserted into the running turn or started a new one
}
// "Send now": interrupt the current turn (also a waiting card), the CLI then runs the queued messages as the next turn
function interruptForQueue(run) {
  if (run.stopped) return false;
  // The turn already ended and the CLI keeps only a background process (dev server, background employee): messages wait for the end of the run
  // (afterRun) and interrupt has nothing to interrupt. We close the CLI together with the background processes, finally runs the queue as a new turn.
  if (run.enterEnd) {
    if (!run.queue.length) return false;
    run.closedImmediately = true; try { run.q?.close(); } catch {}
    return true;
  }
  if (!run.queue.some((f) => !f.afterRun)) return false;
  // between turns (background employees still running) the message goes as the next turn by itself, interrupt could stop them
  if (run.betweenTurns) return true;
  for (const c of PENDING.values()) if (c.run === run) c.resolve('zrušené', { behavior: 'deny', message: tl('prompt.deny.interrupted'), interrupt: true });
  for (const [kid, c] of CARDS) if (c.run === run) { CARDS.delete(kid); c.done(c.type === 'hire' ? [] : false); }
  run.q?.interrupt().catch(() => {});
  return true;
}
export function sendImmediately(id) {
  let k = CONV.get(id); while (k?.parent) k = CONV.get(k.parent);
  const run = k && LIVE.get(k.id)?.run;
  return !!run && interruptForQueue(run);
}
// "Cancel" a queued message: while the CLI has not picked it into a turn, it is removed (cancel_async_message, missing in the SDK types,
// present at runtime). When the agent is already reading it, returns false. A message waiting for the end of the run (afterRun) is just deleted.
export async function cancelFromQueue(id, uuid) {
  let k = CONV.get(id); while (k?.parent) k = CONV.get(k.parent);
  const run = k && LIVE.get(k.id)?.run, f = run?.queue.find((x) => x.uuid === uuid);
  if (!f) return false;
  let ok = f.afterRun;
  if (!ok) ok = !!(await run.q?.cancelAsyncMessage?.(uuid).catch(() => false));
  if (!ok) return false;
  run.consumed.add(uuid);
  const j = run.queue.indexOf(f); if (j >= 0) run.queue.splice(j, 1);
  ozvi(run.k);
  return true;
}

// A closing polite offer ("Chceš, nech…?", "Ak chceš, …?") is not a question the agent waits on (2026-11-10).
// Only the last sentence is checked; real questions ("Ktorú možnosť chceš?", "Mám pokračovať?") stay "your answer".
const OFFER = /^(chceš|chcete|nechceš|chcel[a]? by si|ak chceš|ak chcete|keby si chcel[a]?|môžem ti|mám ti|pomôže ti|do you want|would you like|shall i|should i|want me to|if you want|if you'd like|i can also)(?=[\s,.!?:—–*_-]|$)/i;
function isOffer(text) {
  const sentence = String(text).replace(/[\s*_)"“”»]+$/, '').split(/(?<=[.!?:])\s+(?=[A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ*_„"(])|\n+/).filter((x) => x.trim()).at(-1) || '';
  return OFFER.test(sentence.replace(/^[\s*_>#\-–•(„"]+/, ''));
}

async function detectContext(run) {
  try {
    const c = await Promise.race([run.q.getContextUsage({ detail: 'summary' }), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 6000))]);
    run.k.context = Math.min(1, (c.percentage ?? (c.totalTokens / c.maxTokens) * 100) / 100); run.k.maxTokens = c.maxTokens;
    // breakdown for the tooltip on the context indicator (like /context), stored with the conversation, so it works even when the agent is not running
    const mcp = new Map(); for (const t of c.mcpTools || []) if (t.isLoaded !== false) mcp.set(t.serverName, (mcp.get(t.serverName) || 0) + (t.tokens || 0));
    run.k.breakdown = {
      total: c.totalTokens || 0, max: c.maxTokens || 0, when: now(),
      category: (c.categories || []).filter((x) => x.kind !== 'free' && x.kind !== 'deferred' && x.tokens > 0).map((x) => ({ n: x.name, t: x.tokens, buffer: x.kind === 'buffer' || undefined })),
      files: (c.memoryFiles || []).filter((x) => x.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, 5).map((x) => ({ p: tilde(x.path), t: x.tokens })),
      mcp: [...mcp].filter(([, t]) => t > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, t]) => ({ n, t })),
    };
    saveConv(); ozvi(run.k);
  } catch {}
}

async function spracuj(run, u) {
  if (u.type === 'assistant') tallyCall(run, u); // a suppressed turn spent tokens too
  if (run.suppress && (u.type === 'stream_event' || u.type === 'assistant')) return; // turn of a cancelled message after a stop
  const kidPre = (parent) => run.convFor.get(parent ?? null) || run.k.id;
  if (run.appPending && (u.type === 'stream_event' || u.type === 'assistant')) { // the CLI waited for a message from the Claude app (or from the user) and a new turn started
    clearTimeout(run.appTime); run.appPending = false; run.pendingApp = false;
    const zz = LIVE.get(run.k.id); if (zz?.app) { zz.app = false; ozvi(run.k); }
  }
  if (u.type === 'user' && !u.parent_tool_use_id) { const p = peerFromEvents(u); if (p) addPeer(run, p); } // message from a session in the Claude app: its own bubble, not the user's
  if (u.type === 'system') {
    if (u.subtype === 'init') {
      run.model = u.model; run.maxTokens = modelContext(u.model);
      if (run.k.modelActual !== u.model) { run.k.modelActual = u.model; saveConv(); ozvi(run.k); }
      if (!run.k.sid || run.k.sid !== u.session_id) {
        run.k.sid = u.session_id; saveConv(); ozvi(run.k);
        if (run.k.renameAfterSid && !run.k.parent) { delete run.k.renameAfterSid; renameSession(run.k.sid, run.k.title, { dir: run.k.cwd || run.P.path }).catch((e) => console.warn('renameSession:', e.message)); }
      }
    } else if (u.subtype === 'status' && !u.parent_tool_use_id) { // /compact or automatic compaction
      if (u.status === 'compacting' && run.compacts == null) { run.compacts = add(run.k, { type: 'info', text: tl('server.send.compacting') }).i; }
      else if (u.status == null && run.compacts != null && u.compact_result && u.compact_result !== 'success') { edit(run.k, run.compacts, { text: tl('server.send.compactionNo', { result: u.compact_result }), error: true }); run.compacts = null; }
    } else if (u.subtype === 'compact_boundary' && !u.parent_tool_use_id) {
      const m = u.compact_metadata || {}, thousands = (n) => (n >= 1000 ? (n / 1000).toLocaleString('sk-SK', { maximumFractionDigits: 1 }) + ' thousands.' : String(n));
      const text = tl('server.send.compacted', { auto: m.trigger === 'auto' ? tl('server.send.automatic') : '', flow: m.pre_tokens ? tl('server.send.tokens', { a: thousands(m.pre_tokens), b: thousands(m.post_tokens || 0) }) : '' });
      if (run.compacts != null) edit(run.k, run.compacts, { text }); else add(run.k, { type: 'info', text });
      run.compacts = null;
      if (m.post_tokens && run.maxTokens) { run.k.context = Math.min(1, m.post_tokens / run.maxTokens); saveConv(); ozvi(run.k); }
    } else if (u.subtype === 'task_started') {
      const kid = run.convFor.get(u.tool_use_id); if (kid) run.convTask.set(u.task_id, kid);
    } else if (u.subtype === 'task_notification') {
      const kid = run.convTask.get(u.task_id) || run.convFor.get(u.tool_use_id); const d = kid && CONV.get(kid);
      if (d) {
        if (u.summary) d.taskSummary = u.summary; // an employee's final report comes as the result of the Agent tool (below)
        d.duration = u.usage?.duration_ms || now() - d.created;
        setStatus(d, u.status === 'completed' ? 'done' : u.status === 'failed' ? 'error' : 'none');
        markDelegation(run, d);
      }
    }
    return;
  }
  if (u.type === 'rate_limit_event') { changeLimits?.(u.rate_limit_info); return; }
  if (u.type === 'stream_event') {
    const kid = kidPre(u.parent_tool_use_id), k = CONV.get(kid), ev = u.event, kl = (u.parent_tool_use_id || '') + ':' + ev.index;
    if (ev.type === 'message_start') {
      const us = ev.message?.usage; run.msgId = ev.message?.id;
      if (run.msgId) { run.msgPre.set(u.parent_tool_use_id || '', run.msgId); run.streamMessage.add(run.msgId); } // the group card waits for the end of the message
      if (us && !u.parent_tool_use_id) { const flow = (us.input_tokens || 0) + (us.cache_read_input_tokens || 0) + (us.cache_creation_input_tokens || 0); if (flow && run.maxTokens) { run.k.context = Math.min(1, flow / run.maxTokens); ozvi(run.k); } }
    } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
      const s = add(k, { type: 'assistant', text: '', writing: true }); run.open.set(kl, { kid, i: s.i }); if (run.msgId) run.streamed.add(run.msgId);
    } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      const o = run.open.get(kl); if (!o) return;
      messages(o.kid)[o.i].text += ev.delta.text;
      const dk = `${o.kid}|${o.i}`; deltas.set(dk, (deltas.get(dk) || '') + ev.delta.text);
      deltaT ||= setTimeout(flushDeltas, 50); saveMessages(o.kid);
    } else if (ev.type === 'content_block_stop') {
      const o = run.open.get(kl); if (o) { run.open.delete(kl); edit(CONV.get(o.kid), o.i, { writing: false }); }
    } else if (ev.type === 'message_stop' || (ev.type === 'message_delta' && ev.delta?.stop_reason)) {
      const mid = run.msgPre.get(u.parent_tool_use_id || ''); if (mid) run.doneMessage.add(mid);
    }
    return;
  }
  if (u.type === 'assistant') {
    if (u.message?.model === '<synthetic>') { // error message (also comes in result) or slash command output (/context, /usage…)
      if (u.error) { run.error = true; return; }
      const tx = (u.message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      // after /compact the CLI sends the preserved output again with the same uuid (also in the next process), so the uuid with the message
      if (tx && !u.parent_tool_use_id && !(u.uuid && messages(run.k.id).some((s) => s.uuid === u.uuid))) add(run.k, { type: 'assistant', text: tx, command: true, uuid: u.uuid });
      return;
    }
    const kid = kidPre(u.parent_tool_use_id), k = CONV.get(kid);
    const streamed = run.streamed.has(u.message?.id);
    for (const b of u.message?.content || []) {
      if (b.type === 'text') { if (!streamed && b.text.trim()) add(k, { type: 'assistant', text: b.text }); continue; }
      if (b.type !== 'tool_use') continue;
      run.owner.set(b.id, kid);
      emitTool(run.P, kid, b.name);
      if (b.name.startsWith('mcp__agentic__propose')) continue; // cards are added by the tool itself
      if (PLAN_TOOLS.has(b.name)) {
        if (!tasksConv.has(kid)) { tasksConv.set(kid, []); if (tasksConv.size > 300) tasksConv.delete(tasksConv.keys().next().value); }
        const pol = planFromTool(b.name, b.input, tasksConv.get(kid)), i = run.todo.get(kid);
        if (!pol) continue;
        if (i != null) edit(k, i, { items: pol }); else run.todo.set(kid, add(k, { type: 'todo', title: tl('server.conv.listTasks'), items: pol }).i);
        if (pol.length) { const z = LIVE.get(kid) || {}; LIVE.set(kid, z); z.plan = { h: pol.filter((p) => p.s === 'done').length, n: pol.length, step: pol.find((p) => p.s === 'doing')?.t || '' }; ozvi(k); }
        continue;
      }
      if (b.name === 'Agent' || b.name === 'Task') {
        const v = b.input || {}, d = { id: novId(), sid: null, floor: run.P.id, agent: v.subagent_type || 'general-purpose', title: tail(v.description || tl('server.send.fromLead'), 70), parent: kid, created: now(), changed: now(), context: 0, status: 'none', count: 0, toolUse: b.id };
        CONV.set(d.id, d); MESSAGES.set(d.id, []); run.children.add(d.id); run.convFor.set(b.id, d.id);
        const mid = u.message?.id; // group for the group delegation card (fork is not delegation)
        if (mid && v.subagent_type !== 'fork') { run.groupFor.set(b.id, mid); if (!run.groups.has(mid)) run.groups.set(mid, []); run.groups.get(mid).push({ id: b.id, v }); }
        numberThread(k, d);
        const s = add(k, { type: 'delegate', who: d.agent, title: d.title, thread: d.id, status: 'running', ...(d.number ? { number: d.number } : {}) }); d.delegateIndex = s.i;
        add(d, { type: 'user', text: v.prompt || v.description || '', fromLead: true });
        setStatus(d, 'running');
        continue;
      }
      let last = messages(kid).at(-1);
      if (last?.type !== 'steps' || !last.running) last = add(k, { type: 'steps', steps: [], running: true });
      last.steps.push({ n: toolName(b.name), d: descriptionTool(b.name, b.input, run.P.path), ...fieldF(b.name, b.input, run.P.path), id: b.id });
      run.steps.set(b.id, { kid, i: last.i, j: last.steps.length - 1 });
      edit(k, last.i, { steps: last.steps });
    }
    return;
  }
  if (u.type === 'user' && Array.isArray(u.message?.content)) {
    for (const b of u.message.content) {
      if (b.type !== 'tool_result') continue;
      const kr = run.steps.get(b.tool_use_id);
      if (kr) { const k = CONV.get(kr.kid), s = messages(kr.kid)[kr.i], x = s?.steps[kr.j]; if (x) { x.result = textResult(b.content); if (b.is_error) x.error = true; edit(k, kr.i, { steps: s.steps }); } }
      if (kr && !b.is_error) { const x = messages(kr.kid)[kr.i]?.steps[kr.j]; if (x?.f && WRITE_TOOLS.has(x.n)) emit({ kind: 'file', path: x.f, changed: changedFile(x.f) }); } // file preview: the agent wrote a file (files.js)
      const dk = run.convFor.get(b.tool_use_id); // result of a delegated task
      if (dk && dk !== run.k.id) {
        const d = CONV.get(dk); if (d?.rejected) continue; // delegation denied on the card (deny from the hook)
        const result = typeof b.content === 'string' ? b.content : (b.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
        // Agent with run_in_background returns only a start confirmation right away (2026-11-10): the employee keeps running,
        // the end comes as system/task_notification (above). The card stays "running", the confirmation is not recorded as a reply.
        if (u.tool_use_result?.status === 'async_launched' || /^Async agent launched/.test(result.trim())) { d.inBackground = true; continue; }
        if (result.trim() && messages(dk).at(-1)?.type !== 'assistant') add(d, { type: 'assistant', text: shorten(result.replace(/\n*agentId: [\s\S]*$/, '').trim(), 6000) });
        d.duration = now() - d.created;
        if (['running', 'pending'].includes(LIVE.get(dk)?.status)) setStatus(d, b.is_error ? 'error' : 'done');
        markDelegation(run, d);
      }
    }
  }
  if (u.type === 'result') {
    if (u.origin?.kind === 'peer' && !run.peerInTurn) addPeer(run, { from: u.origin.name || tl('server.app.anotherSession'), text: String(u.origin.body || '').trim() }); // guard: the turn was triggered by a message from the app that the stream did not show separately
    if (u.is_error && u.subtype !== 'error_during_execution') { run.error = true; add(run.k, { type: 'info', text: `⚠️ ${u.result || u.subtype}`, error: true }); }
    if (u.subtype === 'error_during_execution') run.stopped ||= run.interrupted;
  }
}
// Thread numbering (2026-11-16): when several threads of the same employee run under the same parent, they get d.number 1..N
// (also the 'delegate' message in the parent's chat). A single thread has no number; the first gets it retroactively when a second appears.
function numberThread(rodic, d) {
  const bezia = [...CONV.values()].filter((x) => x.parent === rodic.id && x.agent === d.agent && x.id !== d.id && !x.rejected && ['running', 'pending'].includes(LIVE.get(x.id)?.status))
    .sort((a, b) => a.created - b.created);
  if (!bezia.length) return;
  let max = Math.max(0, ...bezia.map((x) => x.number || 0));
  for (const x of bezia) if (!x.number) { x.number = ++max; if (x.delegateIndex != null) edit(rodic, x.delegateIndex, { number: x.number }); ozvi(x); }
  d.number = max + 1;
}
function markDelegation(run, d) {
  const rodic = CONV.get(d.parent); if (rodic == null || d.delegateIndex == null) return;
  const status = LIVE.get(d.id)?.status || d.status;
  edit(rodic, d.delegateIndex, { status: status === 'error' ? 'error' : 'done', ...(d.usage ? { p: toPercent(d.usage) } : {}) });
}

export async function stop(id) {
  let k = CONV.get(id); while (k?.parent) k = CONV.get(k.parent);
  const run = k && LIVE.get(k.id)?.run; if (!run) return false;
  wakeups.cancelFor(k.id); // the user stopped the conversation: pending wake_when waits are dropped
  run.stopped = true; run.interrupted = true;
  // messages sent from the queue would be run by the CLI after the interrupt (interrupt does not cancel them): we mark them and interrupt their turn at once (lifeMessages)
  for (const f of run.queue.filter((x) => !x.afterRun)) {
    run.queue.splice(run.queue.indexOf(f), 1); run.cancelled.add(f.uuid);
    add(k, { type: 'info', text: tl('server.send.unsent', { text: tail(f.text || tl('server.send.attachment'), 300) }) });
  }
  ozvi(k);
  for (const c of PENDING.values()) if (c.run === run) c.resolve('zrušené', { behavior: 'deny', message: tl('prompt.deny.stopped'), interrupt: true });
  for (const [kid, c] of CARDS) if (c.run === run) { CARDS.delete(kid); c.done(c.type === 'hire' ? [] : false); }
  // The turn already ended (the result came), the CLI lives only because of a background process (dev server via run_in_background,
  // background employee): interrupt has nothing to interrupt and the run would end only with that process (2026-11-12 Blízko: 30 min).
  // Stop = close the CLI together with the background processes.
  const close = () => { try { run.q?.close(); } catch {} };
  if (run.enterEnd || run.appPending || run.betweenTurns) { close(); return true; } // also a run that only waits for a reply from the Claude app (2026-11-16)
  await run.q?.interrupt().catch(() => {});
  setTimeout(() => { if (run.active) close(); }, 5000); // guard: interrupt did not end the run (background process)
  return true;
}

// floor state for the City and /api/world: how many conversations are running and waiting
export function floorState(pid) {
  let running = 0, pending = 0;
  for (const [id, z] of LIVE) { const k = CONV.get(id); if (k?.floor !== pid) continue; if (z.status === 'running') running++; if (z.status === 'pending') pending++; }
  return { working: running > 0 || pending > 0, pending, hasSession: [...CONV.values()].some((k) => k.floor === pid) };
}
export const runningRuns = () => [...LIVE.values()].filter((z) => z.run).length;
// activity for sleep.js: number of conversations that are working and the times waiting started (approval, question). A run that only waits for a message from the Claude app is not counted.
export function agentActivity() {
  let bezia = 0; const pending = [];
  for (const z of LIVE.values()) {
    if (z.run?.appPending) continue;
    if (z.status === 'running') bezia++; else if (z.status === 'pending') pending.push(z.pendingFrom || z.start || now());
  }
  return { running: bezia, pending };
}
// conversations waiting for the user (escalation.js): { id, floor, agent, title, from, kind: 'question' | 'approval' }; same rules as agentActivity
export function pendingConversations() {
  const out = [];
  for (const [id, z] of LIVE) {
    if (z.status !== 'pending' || z.run?.appPending) continue;
    const k = CONV.get(id); if (!k) continue;
    const question = [...CARDS.values()].some((c) => c.conv === id && c.type === 'questions');
    out.push({ id, floor: k.floor, agent: k.agent, title: k.title || '', from: z.pendingFrom || z.start || now(), kind: question ? 'question' : 'approval' });
  }
  return out;
}
export function firstRun() { for (const z of LIVE.values()) if (z.run?.q) return z.run.q; return null; }
