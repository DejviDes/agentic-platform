// 0.2.2: start.sh moved to scripts/start.sh (server modules moved to server/). The launchd service installed by
// launchd/install.sh still points to <app>/start.sh, which no longer exists, so the service would not start again.
// This rewrites the path in ~/Library/LaunchAgents/local.agentic-platform.plist and reloads the service, so launchd
// takes the new path (kickstart alone keeps the old definition). Safe to run more than once. Linux and Windows: nothing to do
// (the systemd unit and the Task Scheduler task from docs/SETUP.md run `node server.js`, which stays in place).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LABEL = 'local.agentic-platform';

export default async function ({ root, home, listing }) {
  if (process.platform !== 'darwin') return;
  const plist = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (!fs.existsSync(plist)) return;
  const old = path.join(root, 'start.sh'), now = path.join(root, 'scripts', 'start.sh');
  const text = fs.readFileSync(plist, 'utf8');
  const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const from = `<string>${xml(old)}</string>`;
  if (!text.includes(from)) return; // already updated, or the service runs from another folder
  fs.writeFileSync(plist + '.before-0.2.2', text);
  fs.writeFileSync(plist, text.split(from).join(`<string>${xml(now)}</string>`));
  if (spawnSync('plutil', ['-lint', plist], { stdio: 'ignore' }).status !== 0) {
    fs.writeFileSync(plist, text);
    throw new Error(`the rewritten ${plist} is not a valid plist (the original is kept)`);
  }
  listing(`The launchd service now starts scripts/start.sh (backup ${path.basename(plist)}.before-0.2.2).`);
  const uid = process.getuid?.();
  if (uid == null || spawnSync('launchctl', ['print', `gui/${uid}/${LABEL}`], { stdio: 'ignore' }).status !== 0) return; // not loaded, it reads the file at next login
  // reload so launchd uses the new path; the running server stops here and starts again from the new definition
  spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
  const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plist], { encoding: 'utf8' });
  if (r.status !== 0) listing(`Could not reload the service (${(r.stderr || '').trim()}). Run: launchctl bootstrap gui/${uid} "${plist}"`);
}
