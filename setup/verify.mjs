#!/usr/bin/env node
// Environment check before setting up Agentic Platform. Read only, changes nothing and sends nothing anywhere.
//   node setup/verify.mjs          overview for a person
//   node setup/verify.mjs --json   the same as JSON (for the AI that leads the setup)
// Finds out: system, Node, Claude Code CLI and sign-in, git, whether world.json and node_modules exist, whether the port is free,
// candidates for buildings (folders with projects), Obsidian vaults and the number of Claude Code session folders.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const JSONV = process.argv.includes('--json');
const PORT = Number(process.env.PORT || 4747);
const tilde = (p) => (p.startsWith(HOME + path.sep) ? '~' + p.slice(HOME.length) : p);
const command = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }).trim(); } catch (e) { return e.code === 'ENOENT' ? null : (String(e.stdout || '') + String(e.stderr || '')).trim() || ''; } };
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const subfolders = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name); } catch { return []; } };

const v = {};

// system and tools
const OS = process.platform;
const WSL = OS === 'linux' && /microsoft/i.test(os.release());
v.system = {
  os: OS, arch: process.arch, kernel: os.release(),
  title: OS === 'darwin' ? 'macOS' : OS === 'win32' ? 'Windows' : OS === 'linux' ? (WSL ? 'Linux (WSL)' : 'Linux') : OS,
  mac: OS === 'darwin', linux: OS === 'linux', windows: OS === 'win32', wsl: WSL,
  tested: OS === 'darwin', // elsewhere the server runs, Mac-only features (Touch ID, notifications, sleep, dictation) are switched off
};
const nodeMain = Number(process.versions.node.split('.')[0]);
v.node = { version: process.versions.node, ok: nodeMain >= 22 };
const claudeVersion = command('claude', ['--version']);
v.claude = { installed: claudeVersion !== null, version: claudeVersion || null };
if (claudeVersion !== null) {
  const status = command('claude', ['auth', 'status']) || '';
  v.claude.loggedIn = /logged in|prihlásen|authenticated|subscription|claude\.ai/i.test(status) && !/not logged|neprihlás|not authenticated/i.test(status);
  v.claude.status = status.split('\n').slice(0, 3).join(' ').slice(0, 200);
}
v.apiKey = Boolean(process.env.ANTHROPIC_API_KEY); // the city runs on the subscription, the server removes the key before starting an agent
const gitVersion = command('git', ['--version']);
v.git = { installed: gitVersion !== null, appInGit: exists(path.join(APP, '.git')) };
if (v.system.mac) {
  v.mac = {
    xcodeTools: Boolean(command('xcode-select', ['-p'])),
    uv: command('uv', ['--version']) !== null,
    ffmpeg: command('ffmpeg', ['-version']) !== null,
    service: exists(path.join(HOME, 'Library/LaunchAgents/local.agentic-platform.plist')),
  };
}
if (v.system.linux) {
  const sd = command('systemctl', ['--user', 'show-environment']); // null = no systemctl; error text = the user manager is not running (e.g. WSL without systemd)
  v.linux = {
    systemd: sd !== null && /^PATH=|^HOME=/m.test(sd),
    service: exists(path.join(HOME, '.config/systemd/user/agentic-platform.service')),
    uv: command('uv', ['--version']) !== null,
    ffmpeg: command('ffmpeg', ['-version']) !== null,
  };
}
if (v.system.windows) {
  const q = command('schtasks', ['/Query', '/TN', 'AgenticPlatform']);
  v.windows = { task: Boolean(q) && !/ERROR|CHYBA/i.test(q) };
}

// the app
v.app = {
  folder: tilde(APP),
  worldJson: exists(path.join(APP, 'world.json')),
  packagesInstalled: exists(path.join(APP, 'node_modules/@anthropic-ai/claude-agent-sdk')),
};
if (v.app.worldJson) {
  try { const s = JSON.parse(fs.readFileSync(path.join(APP, 'world.json'), 'utf8')); v.app.buildings = Object.keys(s.buildings || {}); v.app.brain = s.brain || null; v.app.modules = s.modules || {}; }
  catch (e) { v.app.errorWorldJson = e.message; }
}
v.port = await new Promise((ok) => {
  const s = net.connect({ host: '127.0.0.1', port: PORT });
  s.once('connect', () => { s.destroy(); ok({ number: PORT, free: false }); });
  s.once('error', () => ok({ number: PORT, free: true }));
  s.setTimeout(1500, () => { s.destroy(); ok({ number: PORT, free: true }); });
});

// candidates for buildings: common folders with projects
const NAMES = ['Projects', 'projects', 'Development', 'dev', 'Dev', 'Code', 'code', 'src', 'repos', 'Repos', 'git', 'GitHub', 'Work', 'work', 'Projekty', 'Praca', 'Práca', 'Skola', 'Škola', 'School', 'Studium', 'Štúdium', 'Documents/GitHub', 'Documents/Projects', 'Documents/Projekty', 'Documents/Code'];
v.candidates = [];
// one folder can show up under several names (~/Projects and ~/projects on a case-insensitive disk, symlinks), so compare by realpath, inode and case
const CASELESS = OS === 'darwin' || OS === 'win32';
const realCase = (p) => { try { return path.join(path.dirname(p), path.basename(fs.realpathSync.native(p))); } catch { return p; } }; // ~/projects typed as ~/Projects → the name as it is on disk
const sameKey = (p) => { let r = p; try { r = fs.realpathSync.native(p); } catch {} let id = ''; try { const st = fs.statSync(p); id = `${st.dev}:${st.ino}`; } catch {} return { r: CASELESS ? r.toLowerCase() : r, id }; };
const seen = [];
for (const m of NAMES) {
  const p = path.join(HOME, m);
  if (!exists(p)) continue;
  const key = sameKey(p);
  if (seen.some((s) => s.r === key.r || (key.id && s.id === key.id))) continue;
  seen.push(key);
  const children = subfolders(p);
  if (!children.length) continue;
  const withGit = children.filter((d) => exists(path.join(p, d, '.git'))).length;
  const withClaude = children.filter((d) => exists(path.join(p, d, 'CLAUDE.md'))).length;
  v.candidates.push({ path: tilde(realCase(p)), folders: children.length, withGit, withClaudeMd: withClaude, sample: children.slice(0, 8) });
}

// notes: Obsidian vaults, from Obsidian's own settings and by folder (a folder with a .obsidian subfolder) in common places
const obsidianSettings = [
  path.join(HOME, 'Library/Application Support/obsidian/obsidian.json'),
  path.join(HOME, '.config/obsidian/obsidian.json'),
  path.join(process.env.APPDATA || path.join(HOME, 'AppData/Roaming'), 'obsidian/obsidian.json'),
];
const vaultPaths = [];
for (const f of obsidianSettings) {
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); for (const t of Object.values(j.vaults || {})) if (t.path && exists(t.path)) vaultPaths.push(t.path); } catch {}
}
const isVault = (p) => exists(path.join(p, '.obsidian'));
const SKIP = new Set(['node_modules', 'Library', 'AppData', 'Applications']);
const findVaults = (dir, depth) => {
  if (isVault(dir)) { vaultPaths.push(dir); return; }
  if (depth <= 0) return;
  for (const d of subfolders(dir)) if (!SKIP.has(d)) findVaults(path.join(dir, d), depth - 1);
};
for (const m of ['', 'Documents', 'Notes', 'notes', 'Obsidian', 'obsidian', 'Documents/Obsidian', 'Documents/Notes', 'Library/Mobile Documents/iCloud~md~obsidian/Documents', ...v.candidates.map((k) => k.path.replace(/^~\/?/, ''))]) {
  const p = m ? path.join(HOME, m) : HOME;
  if (exists(p)) findVaults(p, m ? 2 : 1); // depth 2 below each place; the home folder itself only one level (its subfolders are listed above)
}
v.obsidian = [];
const seenVaults = [];
for (const vp of vaultPaths) {
  const key = sameKey(vp);
  if (seenVaults.some((s) => s.r === key.r || (key.id && s.id === key.id))) continue;
  seenVaults.push(key);
  let notes = 0;
  const count = (d, depth) => { if (depth > 4 || notes > 5000) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; if (e.isDirectory()) count(path.join(d, e.name), depth + 1); else if (e.name.endsWith('.md')) notes++; } };
  try { count(vp, 0); } catch {}
  v.obsidian.push({ path: tilde(vp), notes, hasClaudeMd: exists(path.join(vp, 'CLAUDE.md')) });
}

// Claude Code sessions (the city computes floor activity from them)
try { v.sessions = subfolders(path.join(HOME, '.claude/projects')).length; } catch { v.sessions = 0; }

// ---------- output ----------
if (JSONV) { console.log(JSON.stringify(v, null, 2)); process.exit(0); }
const ok = (b) => (b ? '✓' : '✗');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
console.log(`Agentic Platform – environment check (${tilde(APP)})\n`);
console.log(`${v.system.tested ? '✓' : '·'} System: ${v.system.title} (kernel ${v.system.kernel}, ${v.system.arch})${v.system.tested ? '' : '  → runs, but Touch ID, system notifications, Mac sleep and dictation are off (docs/SETUP.md, "Linux and Windows")'}`);
console.log(`${ok(v.node.ok)} Node ${v.node.version}${v.node.ok ? '' : '  → version 22 or newer is needed'}`);
console.log(`${ok(v.claude.installed)} Claude Code CLI ${v.claude.version || '→ not installed'}`);
if (v.claude.installed) console.log(`${ok(v.claude.loggedIn)} Signed in: ${v.claude.loggedIn ? 'yes' : 'no → run in a terminal: claude auth login'}`);
if (v.apiKey) console.log('! ANTHROPIC_API_KEY is set. The city removes it before starting agents and runs on your subscription.');
console.log(`${ok(v.git.installed)} git${v.git.appInGit ? ', the app is in git' : ', the app is not in git yet (the Control center needs it)'}`);
console.log(`${ok(v.app.packagesInstalled)} Packages ${v.app.packagesInstalled ? 'installed' : '→ npm install'}`);
console.log(`${v.app.worldJson ? '✓ world.json exists' : '· no world.json yet (it is created during setup)'}`);
console.log(`${v.port.free ? '✓' : '·'} Port ${v.port.number} ${v.port.free ? 'free' : 'taken (the city or another server is already running)'}`);
if (v.linux) console.log(`· Linux: systemd --user ${ok(v.linux.systemd)}, service ${v.linux.service ? 'installed' : 'no'}, uv ${ok(v.linux.uv)}, ffmpeg ${ok(v.linux.ffmpeg)}`);
if (v.windows) console.log(`· Windows: Task Scheduler task ${v.windows.task ? 'exists' : 'not set up'}${v.system.wsl ? '' : ' (WSL 2 is recommended)'}`);
if (v.mac) console.log(`· macOS: Xcode tools ${ok(v.mac.xcodeTools)}, uv ${ok(v.mac.uv)}, ffmpeg ${ok(v.mac.ffmpeg)}, service ${v.mac.service ? 'installed' : 'no'}`);
console.log(`\nCandidates for buildings:`);
if (!v.candidates.length) console.log('  (no common project folders found, tell me where yours are)');
for (const k of v.candidates) console.log(`  ${k.path}  ${plural(k.folders, 'folder', 'folders')} (${k.withGit} with git, ${k.withClaudeMd} with CLAUDE.md), e.g. ${k.sample.slice(0, 4).join(', ')}`);
console.log(`\nObsidian vaults: ${v.obsidian.length ? v.obsidian.map((t) => `${t.path} (${plural(t.notes, 'note', 'notes')}${t.hasClaudeMd ? ', has CLAUDE.md' : ''})`).join(', ') : 'none found (tell me where your notes are)'}`);
console.log(`Claude Code sessions: ${plural(v.sessions, 'project folder', 'project folders')}`);
