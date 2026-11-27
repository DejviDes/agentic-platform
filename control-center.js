// control-center.js – Control center (2026-11-10).
// Control center bar: git status of the city app (changed files, diff, recent commits), server start time and whether the server code
// changed since start. Commit and push are started only by the user with a click in the bar (POST from the own page, server.js verifies it),
// an agent never starts them itself. Self-refresh: watches public/app and public/index.html and sends the SSE event `app`.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';

export const STARTED = Date.now();
// git remote hosts that are never pushed to (server.js fills them from world.json `guards.bannedPush`)
let hostsBan = () => [];
export const setPushBan = (f) => { hostsBan = f; };
// files whose change takes effect only after a server restart
const SERVER_FILES = ['server.js', 'agents.js', 'extras.js', 'build-world.js', 'modules.js', 'overview.js', 'control-center.js', 'os-notifications.js', 'start.sh', 'package.json', 'transcribe-server.py'];
const kind = (s) => (s.startsWith('public/app/') || s === 'public/index.html' ? 'app' : SERVER_FILES.includes(s) ? 'server' : s.startsWith('public/') ? 'design' : 'other');
const error = (message, code = 400) => Object.assign(new Error(message), { code });

function git(cwd, args, { timeout = 10000, max = 8e6 } = {}) {
  return new Promise((resolve, reject) => execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, timeout, maxBuffer: max, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
    (e, out, err) => (e ? reject(error(String(err || e.message).trim().split('\n').slice(-3).join('\n'), 500)) : resolve(out))));
}

// changed files: porcelain -z (on rename the original path follows), +/− from numstat, untracked counted by lines
async function changes(root) {
  const [st, num] = await Promise.all([git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']), git(root, ['diff', '--numstat', 'HEAD']).catch(() => '')]);
  const pm = new Map();
  for (const r of num.split('\n')) { const [p, m, ...s] = r.split('\t'); if (s.length) pm.set(s.join('\t').replace(/^.*=> /, '').replace(/[{}]/g, ''), [p, m]); }
  const parts = st.split('\0'), out = [];
  for (let i = 0; i < parts.length; i++) {
    const x = parts[i]; if (x.length < 4) continue;
    const xy = x.slice(0, 2), s = x.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // original path
    let [plus, minus] = pm.get(s) || [0, 0];
    if (xy === '??') { try { const t = fs.readFileSync(path.join(root, s)); plus = t.length < 2e6 && !t.includes(0) ? String(t).split('\n').length : '-'; } catch {} }
    out.push({ s, status: xy === '??' ? 'nový' : xy.includes('D') ? 'zmazaný' : xy.includes('R') ? 'premenovaný' : xy.includes('A') ? 'pridaný' : 'zmenený', kind: kind(s), plus: plus === '-' ? null : +plus, minus: minus === '-' ? null : +minus });
  }
  return out.sort((a, b) => ['app', 'server', 'design', 'other'].indexOf(a.kind) - ['app', 'server', 'design', 'other'].indexOf(b.kind) || a.s.localeCompare(b.s));
}

export async function controlCenterState(root) {
  const [z, log, branch, ahead] = await Promise.all([
    changes(root),
    git(root, ['log', '-5', '--format=%h%x09%ct%x09%s']).catch(() => ''),
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '?'),
    git(root, ['rev-list', '--count', '@{u}..HEAD']).catch(() => null),
  ]);
  const serverChanged = SERVER_FILES.filter((f) => { try { return fs.statSync(path.join(root, f)).mtimeMs > STARTED; } catch { return false; } });
  return {
    started: STARTED, branch: branch.trim(), ahead: ahead == null ? null : +ahead, changes: z, serverChanged,
    log: log.trim().split('\n').filter(Boolean).map((r) => { const [h, t, ...s] = r.split('\t'); return { h, time: +t * 1000, s: s.join('\t') }; }),
  };
}

// diff of one file from the change list (no other file), a new file as all added lines
export async function diffControlCenter(root, file) {
  const z = (await changes(root)).find((x) => x.s === file); if (!z) throw error(t('server.controlCenter.fileNoIsBetweenChanges'), 404);
  let d;
  if (z.status === 'nový') { const buf = fs.readFileSync(path.join(root, file)); d = buf.includes(0) ? t('server.controlCenter.binary') : t('server.controlCenter.newFile', { rows: String(buf).split('\n').map((r) => '+' + r).join('\n') }); }
  else d = await git(root, ['diff', 'HEAD', '--', file]).then((x) => x.split('\n').filter((r) => !/^(diff --git|index |--- |\+\+\+ )/.test(r)).join('\n'));
  return { file, diff: d.length > 200000 ? d.slice(0, 200000) + t('server.controlCenter.shortened') : d };
}

// commit of the selected files, optionally push. Never to hosts from `guards.bannedPush` (world.json).
export async function commitControlCenter(root, { message, files, push }) {
  message = String(message || '').trim(); if (!message) throw error(t('server.controlCenter.writeMessage'));
  const z = await changes(root), all = new Set(z.map((x) => x.s));
  const select = (Array.isArray(files) ? files : []).filter((s) => all.has(s)); if (!select.length) throw error(t('server.controlCenter.selectFile'));
  await git(root, ['add', '-A', '--', ...select]);
  await git(root, ['commit', '-q', '-m', message, '--', ...select]);
  const hash = (await git(root, ['rev-parse', '--short', 'HEAD'])).trim();
  const pushed = push ? await pushRepo(root).catch((e) => ({ error: e.message })) : null;
  return { hash, files: select.length, push: pushed };
}

// push of unpushed commits: only the main branch to the origin of the city repository, never to a banned host (`guards.bannedPush`)
async function pushRepo(root) {
  const url = (await git(root, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
  if (!url) throw error(t('server.controlCenter.withoutOrigin'), 409);
  if (hostsBan().some((h) => h && url.toLowerCase().includes(String(h).toLowerCase()))) throw error(t('server.controlCenter.pushBanned'), 403);
  const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
  if (branch !== 'main') throw error(`Pushuje sa iba vetva main (teraz ${branch || '?'})`, 409);
  await git(root, ['push', '-q', 'origin', 'main'], { timeout: 60000 });
  return { ok: true, dest: url.replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, '$1') };
}
// POST /api/control-center/push: only when there are unpushed commits (ahead > 0)
export async function pushControlCenter(root) {
  const ahead = +(await git(root, ['rev-list', '--count', '@{u}..HEAD']).catch(() => { throw error(t('server.controlCenter.withoutUpstream'), 409); })).trim();
  if (!ahead) throw error(t('server.controlCenter.noneOnPush'), 409);
  const r = await pushRepo(root);
  return { ...r, commits: ahead, output: `${ahead} ${ahead === 1 ? 'commit' : ahead < 5 ? 'commits' : 'commits'} → ${r.dest} (main)` };
}

// ---------- server restart (step 4, no watchdog: the server runs as a launchd service with KeepAlive) ----------
// launchd sets XPC_SERVICE_NAME to the service label (start.sh does exec, the variable stays); the City service label ends with "mesto-agentov"
export const underLaunchd = () => /(^|\.)(mesto-agentov|agentic-platform)$/.test(process.env.XPC_SERVICE_NAME || '');
// `node server.js --selftest` as a child: loads modules, builds the world, does not listen on a port, does not write to data/
export function serverSelftest(root, timeout = 60000) {
  return new Promise((resolve) => execFile(process.execPath, ['server.js', '--selftest'], { cwd: root, timeout, maxBuffer: 4e6, env: { ...process.env, PORT: '0' } },
    (e, out, err) => resolve({ ok: !e, code: e ? (e.code ?? e.signal ?? 1) : 0, output: String(err || '').trim() || String(out || '').trim() })));
}
export const commitNow = (root) => git(root, ['log', '-1', '--format=%h %s']).then((x) => x.trim()).catch(() => '');

// app self-refresh: a content change of public/app/*.js|css or public/index.html → SSE `app` (changes merged over 1 s).
// Server code → SSE `controlCenter` (the bar shows that an old version is running). A save without a content change is ignored (hash).
export function watchApp(root, emit) {
  const hash = new Map(), h = (f) => { try { return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };
  const pile = { app: new Set(), controlCenter: new Set() }, t = {};
  const change = (type, abs, name) => {
    const fresh = h(abs); if (hash.get(abs) === fresh) return; hash.set(abs, fresh);
    pile[type].add(name); clearTimeout(t[type]);
    t[type] = setTimeout(() => { const files = [...pile[type]]; pile[type].clear(); emit({ kind: type, files }); }, 1000);
  };
  const watch = (dir, type, filter) => {
    try { for (const f of fs.readdirSync(dir)) if (filter(f)) hash.set(path.join(dir, f), h(path.join(dir, f))); } catch {}
    try { fs.watch(dir, (ev, f) => { f = String(f || ''); if (filter(f)) change(type, path.join(dir, f), f); }).on('error', (e) => console.warn('centrála: sledovanie', dir, e.message)); }
    catch (e) { console.warn('centrála: sledovanie', dir, e.message); }
  };
  watch(path.join(root, 'public', 'app'), 'app', (f) => /^[\w.-]+\.(js|css)$/.test(f));
  watch(path.join(root, 'public'), 'app', (f) => f === 'index.html');
  watch(root, 'control-center', (f) => SERVER_FILES.includes(f));
}
