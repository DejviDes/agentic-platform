#!/usr/bin/env node
// Updates Agentic Platform to the latest released version. Downloads only the changes since your version (git); your setup
// (world.json, data/, the teams in your own folders) does not change, because it is not in the repository.
//   npm run update                 downloads, shows the news, updates and restarts the service
//   npm run update -- --verify     only tells whether there is a new version and what it brings (changes nothing)
//   npm run update -- --json       the same as --verify, output for a machine (the app, an AI)
// Steps: 1) no custom edits in the code, 2) git fetch of tags, 3) news from CHANGELOG.md, 4) git merge --ff-only to the tag,
// 5) npm install if the dependencies changed, 6) migrations setup/migrations/<version>.mjs, 7) self-test server.js --selftest
// (on failure it rolls back to the original version), 8) restart of the launchd service, if installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = process.env.AGENTIC_ROOT ? path.resolve(process.env.AGENTIC_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // AGENTIC_ROOT: testing the update from outside
const args = process.argv.slice(2);
const JSONV = args.includes('--json');
const ONLY_VIEW = JSONV || args.includes('--verify');
const SERVICE = 'local.agentic-platform';
const git = (...a) => execFileSync('git', a, { cwd: APP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const quietGit = (...a) => { try { return git(...a); } catch { return null; } };
const listing = (t) => { if (!JSONV) console.log(t); };
const end = (t, data = {}) => { if (JSONV) console.log(JSON.stringify({ error: t, ...data })); else console.error(`✗ ${t}`); process.exit(1); };

const number = (v) => String(v || '').replace(/^v/, '').split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
const compare = (a, b) => { const x = number(a), y = number(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

// ---------- 1) repository and custom edits ----------
if (!fs.existsSync(path.join(APP, '.git'))) end('The city was not installed with git clone, so it cannot be updated in parts. Install it following the README (git clone) and copy world.json into the new folder.');
if (!quietGit('remote', 'get-url', 'origin')) end('The repository has no remote origin (where to download from).');
const edits = git('status', '--porcelain', '--untracked-files=no');
if (edits && !ONLY_VIEW) end(`You have custom edits in the city's code, the update could overwrite them:\n${edits}\nSave them (git stash), update, then bring them back (git stash pop), or ask Claude in this folder to help you with it.`);

// ---------- 2) versions ----------
try { git('fetch', '--tags', '--quiet', 'origin'); } catch (e) { end('Could not download the versions (network or access to the repository): ' + String(e.stderr || e.message).trim().split('\n')[0]); }
const tags = (quietGit('tag', '-l', 'v*') || '').split('\n').filter(Boolean).sort(compare);
if (!tags.length) end('There is no released version on the server yet.');
const latest = tags[tags.length - 1];
const myTag = quietGit('describe', '--tags', '--abbrev=0', '--match', 'v*');
const my = myTag || (JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version ? 'v' + JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version : 'v0.0.0');
const upToDate = spawnSync('git', ['merge-base', '--is-ancestor', latest, 'HEAD'], { cwd: APP }).status === 0;

// ---------- 3) news between my version and the latest one ----------
function news() {
  const text = quietGit('show', `${latest}:CHANGELOG.md`) || '';
  const parts = text.split(/^(?=## )/m).filter(c => c.startsWith('## '));
  return parts.filter(c => { const v = c.match(/^## v?(\d+\.\d+\.\d+)/); return v && compare(v[1], my) > 0 && compare(v[1], latest) <= 0; }).map(c => c.trim());
}
const list = upToDate ? [] : news();
if (JSONV) { console.log(JSON.stringify({ my, latest, newVersion: !upToDate, customEdits: !!edits, news: list }, null, 2)); process.exit(0); }
if (upToDate) { listing(`✓ You have the latest version (${my}).`); process.exit(0); }
listing(`New version ${latest} (you have ${my}).\n\n${list.join('\n\n') || '(no description of the news)'}\n`);
if (ONLY_VIEW) { listing('Update with: npm run update'); process.exit(0); }

// ---------- 4) download only the changes ----------
const original = git('rev-parse', 'HEAD');
const branch = quietGit('symbolic-ref', '--short', 'HEAD');
try {
  if (branch) git('merge', '--ff-only', '--quiet', latest);
  else git('checkout', '--quiet', latest);
} catch (e) { end(`The update cannot be done as a fast-forward (do you have your own commits?): ${String(e.stderr || e.message).trim().split('\n')[0]}\nNothing changed.`); }
const changed = git('diff', '--name-only', original, 'HEAD').split('\n').filter(Boolean);
listing(`Downloaded: ${changed.length} changed files.`);

const back = (reason) => {
  git('reset', '--keep', original);
  if (changed.includes('package.json')) spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: APP, stdio: 'inherit' });
  end(`${reason}\nThe city is rolled back to ${my}. Try again later or report it in the repository.`);
};

// ---------- 5) dependencies ----------
if (changed.includes('package.json')) {
  listing('The dependencies changed, running npm install…');
  if (spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: APP, stdio: 'inherit' }).status !== 0) back('npm install failed.');
}

// ---------- 6) settings migrations (e.g. a new key in world.json), oldest first ----------
const MIG = path.join(APP, 'setup', 'migrations');
const migrations = fs.existsSync(MIG) ? fs.readdirSync(MIG).filter(f => /^\d+\.\d+\.\d+\.mjs$/.test(f)).map(f => f.slice(0, -4))
  .filter(v => compare(v, my) > 0 && compare(v, latest) <= 0).sort(compare) : [];
for (const v of migrations) {
  listing(`Migration ${v}…`);
  try { const m = await import(pathToFileURL(path.join(MIG, `${v}.mjs`)).href); await m.default({ root: APP, home: os.homedir(), listing }); }
  catch (e) { back(`Migration ${v} failed: ${e.message}`); }
}

// ---------- 7) self-test ----------
const sk = spawnSync(process.execPath, ['server.js', '--selftest'], { cwd: APP, encoding: 'utf8', timeout: 60000 });
if (sk.status !== 0) { const r = (sk.stderr || sk.stdout || '').trim().split('\n'); back(`The new version failed the server self-test: ${(r.find(l => /Error|chyba/i.test(l)) || r.pop() || '').trim().slice(0, 200)}`); }

// ---------- 8) restart ----------
const uid = process.getuid?.();
const hasService = process.platform === 'darwin' && uid != null && spawnSync('launchctl', ['print', `gui/${uid}/${SERVICE}`], { stdio: 'ignore' }).status === 0;
if (hasService) {
  spawnSync('launchctl', ['kickstart', '-k', `gui/${uid}/${SERVICE}`], { stdio: 'ignore' });
  listing(`✓ Updated to ${latest}, the service restarted. Reload the page in your browser.`);
} else listing(`✓ Updated to ${latest}. Restart the server (Ctrl+C and npm start again) and reload the page.`);
