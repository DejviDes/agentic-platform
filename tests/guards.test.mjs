// tests/guards.test.mjs – unit test of the agents.js guards (2026-11-23): reading City secrets without a card (Read, Grep, Glob, Bash)
// and the "Always allow" rule key for Bash (interpreters, subcommands, inline code, compound commands). No Claude, no network, nothing is written.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ruleKey, guardBash, guardReading, guardWrite } from '../server/agents.js';

const CITY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const flow = path.join(HOME, '.config', 'mesto-agentov', 'notion-token');

// ---------- Read, Grep, Glob ----------
const banned = (n, i, cwd = CITY) => assert.ok(guardReading(n, i, cwd), `${n} ${JSON.stringify(i)} should have been denied`);
const allowed = (n, i, cwd = CITY) => assert.equal(guardReading(n, i, cwd), null, `${n} ${JSON.stringify(i)} should have passed`);
banned('Read', { file_path: flow });
banned('Read', { file_path: '~/.config/mesto-agentov/notion-token' });
banned('Read', { file_path: path.join(HOME, '.config', 'MESTO-agentov', 'NOTION-token') }); // macOS ignores letter case
banned('Read', { file_path: path.join(HOME, '.config', 'x', '..', 'mesto-agentov', 'notion-token') });
banned('Read', { file_path: '.config/mesto-agentov/notion-token' }, HOME); // relative path from cwd
banned('Read', { file_path: path.join(HOME, '.mesto-agentov', 'brana', 'leaf.key') });
banned('Read', { file_path: path.join(HOME, '.mesto-agentov', 'brana', 'vapid.json') });
banned('Read', { file_path: path.join(CITY, 'data', 'devices.json') });
banned('Read', { file_path: 'data/lock.json' });
banned('Read', { file_path: 'data/test-key' });
banned('Grep', { pattern: 'x', path: path.join(HOME, '.config', 'mesto-agentov') });
banned('Grep', { pattern: 'x', path: flow });
banned('Grep', { pattern: 'x', path: HOME }); // above the secrets folder (Grep searches hidden ones too)
banned('Grep', { pattern: 'x', path: path.join(HOME, '.config') });
banned('Grep', { pattern: 'x', path: path.join(CITY, 'data') }); // data/ holds the self-test key
banned('Grep', { pattern: 'x', path: path.join(CITY, 'data'), glob: '*' });
banned('Grep', { pattern: 'x', path: HOME, glob: '**/notion-token' });
banned('Grep', { pattern: 'x', glob: 'test-key' });
banned('Glob', { pattern: path.join(HOME, '.config', 'mesto-agentov', '*') });
banned('Glob', { pattern: '**/notion-token', path: HOME });
banned('Glob', { pattern: 'data/{lock,devices}.json' });
banned('Glob', { pattern: '../.config/mesto-*/*', path: path.join(HOME, 'Development') });
allowed('Read', { file_path: path.join(CITY, 'agents.js') });
allowed('Read', { file_path: path.join(CITY, 'data', 'conversations.json') }); // data/ as a whole may be read
allowed('Read', { file_path: path.join(HOME, '.config', 'git', 'config') });
allowed('Read', { file_path: path.join(HOME, '.mesto-agentov-poznamka.md') });
allowed('Grep', { pattern: 'x', path: CITY });
allowed('Grep', { pattern: 'x' });
allowed('Grep', { pattern: 'x', path: path.join(CITY, 'data'), glob: 'conversations.json' });
allowed('Grep', { pattern: 'x', path: path.join(CITY, 'data', 'messages') });
allowed('Grep', { pattern: 'x', path: path.join(HOME, 'Development') });
allowed('Grep', { pattern: 'x', path: HOME, glob: '*.md' });
allowed('Glob', { pattern: '**/*.js' });
allowed('Glob', { pattern: 'public/app/*.js', path: CITY });
allowed('Glob', { pattern: '**/*.md', path: HOME });

// ---------- Bash ----------
const bash = (c, cwd = CITY) => guardBash(c, cwd);
for (const c of [
  `cat ${flow}`, 'cat ~/.config/mesto-agentov/notion-token', 'cat "$HOME/.config/mesto-agentov/notion-token"', 'cat $HOME/.config/mesto-*/n*',
  'cd ~/.config/mesto-agentov && cat notion-token', 'cat ~/.mesto-agentov/brana/leaf.key', 'grep -r . ~/.mesto-agentov',
  'cat data/devices.json', 'cat ./data/test-key', 'head -c 50 data/lock.json', 'cat data/z*', 'cd data && cat test-key',
]) assert.ok(bash(c), `Bash should deny: ${c}`);
assert.ok(bash('cat test-key', path.join(CITY, 'data')), 'cat in data/');
for (const c of ['ls', 'npm run check', 'cat data/conversations.json', 'grep -n "devices.json" devices.js', 'grep local.mesto-agentov a.txt', 'node --check agents.js', 'cat ~/.config/git/config']) assert.equal(bash(c), null, `Bash should pass: ${c}`);

// ---------- secrets under the original names and in the migration backup (step 3, 2026-11-27) ----------
for (const f of ['zariadenia.json', 'zamok.json', 'kluc-skusky']) banned('Read', { file_path: path.join(CITY, 'data', f) });
for (const d of ['data-backup-2026-11-27', 'data-backup-2026-11-27-2', 'data-zaloha-2026-11-26', 'data.migrating']) {
  for (const f of ['devices.json', 'lock.json', 'test-key', 'zariadenia.json', 'zamok.json', 'kluc-skusky']) banned('Read', { file_path: path.join(CITY, d, f) });
  banned('Grep', { pattern: 'x', path: path.join(CITY, d) });
  allowed('Read', { file_path: path.join(CITY, d, 'conversations.json') });
}
banned('Glob', { pattern: 'data-backup-*/*.json', path: CITY });
banned('Read', { file_path: path.join(HOME, '.agentic-platform', 'gateway', 'leaf.key') });
banned('Read', { file_path: path.join(HOME, '.config', 'agentic-platform', 'notion-token') });
for (const c of ['cat data/zariadenia.json', 'cat data/kluc-skusky', 'head data/zamok.json', 'cat data-backup-2026-11-27/devices.json', 'cat data-backup-2026-11-27/zariadenia.json',
  'cat data-backup-*/test-key', 'cd data-backup-2026-11-27 && cat kluc-skusky', 'cat data/d*', 'cat ~/.agentic-platform/gateway/ca.key']) assert.ok(bash(c), `Bash should deny: ${c}`);

// ---------- writes into the City folder: data/ (and its migration copies), node_modules/, old prototypes ----------
const write = (f, cwd = CITY) => guardWrite(f, cwd);
for (const f of ['data/conversations.json', 'data/konverzacie.json', 'data/messages/x.json', 'data/spravy/x.json', 'data', 'data-backup-2026-11-27/conversations.json', 'data-zaloha-2026-11-26/x', 'data.migrating/x', 'node_modules/x/index.js', 'public/dizajn-v1.html'])
  if (!f.startsWith('public/dizajn-') || existsSync(path.join(CITY, f))) assert.ok(write(f), `write should be banned: ${f}`); // prototypes are only in the private repository, the guard bans existing ones
for (const f of ['agents.js', 'migrate.js', 'public/dizajn-v999-rozpracovane.html', 'database.js', 'tests/x.mjs']) assert.equal(write(f), null, `write should pass: ${f}`);
for (const c of ['echo x > data/conversations.json', 'cp a data/povolenia.json', 'mv data data2', 'rm -rf data-backup-2026-11-27', 'sed -i "" s/a/b/ data/permissions.json', 'touch node_modules/x'])
  assert.ok(bash(c), `Bash should deny the write: ${c}`);

// ---------- approval API: the English routes and the original Slovak ones ----------
for (const api of ['/api/control-center/commit', '/api/control-center/push', '/api/permission', '/api/card', '/api/claude-app', '/api/new-session', '/api/rules', '/api/sorting/approve', '/api/inbox', '/api/house/diary', '/api/mail/pass/action', '/api/library/rating', '/api/garden/uncheck', '/api/playground/write', '/api/tasks/change', '/api/dispatch/run', '/api/brain/answer', '/api/chronicler/run', '/api/scribe',
  '/api/centrala/commit', '/api/centrala/push', '/api/povolenie', '/api/karta', '/api/claude-appka', '/api/nova-session', '/api/pravidla', '/api/triedenie/schval', '/api/dom/dennik', '/api/posta/pas/akcia', '/api/kniznica/hodnotenie', '/api/zahrada/odskrtni', '/api/ihrisko/zapis', '/api/ulohy/zmen', '/api/dispecing/spusti', '/api/mozog/odpoved', '/api/kronikar/spusti', '/api/zapisovac']) {
  assert.ok(bash(`curl -s -X POST http://127.0.0.1:4747${api}`, os.tmpdir()), `API should be banned (outside the City too): ${api}`);
  assert.ok(bash(`curl -s -X POST http://localhost:4748/m${api}`, os.tmpdir()), `mobile API should be banned: ${api}`);
}
for (const c of ['curl -s http://127.0.0.1:4747/api/world', 'curl -s http://127.0.0.1:4747/api/svet', 'curl -s http://127.0.0.1:4747/api/conversations']) assert.equal(bash(c, os.tmpdir()), null, `reading the API should pass: ${c}`);

// ---------- the server itself: launchd service of both names, kill, starting server.js (only the self-test may run) ----------
for (const c of ['launchctl kickstart -k gui/501/com.example.mesto-agentov', 'launchctl bootout gui/501/local.agentic-platform', 'launchctl unload ~/Library/LaunchAgents/local.agentic-platform.plist', 'pkill -f server.js', 'kill $(lsof -ti :4747)'])
  assert.ok(bash(c, os.tmpdir()), `server: Bash should deny: ${c}`);
for (const c of ['node server.js', 'node ./server.js --port 1', 'npm start', 'cd /tmp && node ' + path.join(CITY, 'server.js')]) assert.ok(bash(c), `starting the server should be banned: ${c}`);
for (const c of ['node server.js --selftest', 'node server.js --skuska', 'AGENTIC_PLATFORM=linux node server.js --selftest', 'node --check server.js', 'node migrate.js --dry-run']) assert.equal(bash(c), null, `should pass: ${c}`);
assert.ok(write(path.join(HOME, 'Library', 'LaunchAgents', 'local.agentic-platform.plist'), os.tmpdir()), 'plist of the product');
assert.ok(write(path.join(HOME, 'Library', 'LaunchAgents', 'com.example.mesto-agentov.plist'), os.tmpdir()), 'plist of the original instance');

// ---------- "Always allow" rule key ----------
const K = (c) => ruleKey('Bash', { command: c });
assert.equal(ruleKey('Edit', {}), 'Edit');
assert.equal(ruleKey('mcp__x__y', {}), 'mcp__x__y');
// simple commands: the first word as before
assert.equal(K('ls -la'), 'Bash:ls');
assert.equal(K('cat README.md'), 'Bash:cat');
assert.equal(K('cd src'), 'Bash:cd');
assert.equal(K('mkdir -p a/b'), 'Bash:mkdir');
// interpreters: the script target
assert.equal(K('python3 script.py'), 'Bash:python3 script.py');
assert.equal(K('python3 script.py --x 1'), 'Bash:python3 script.py');
assert.equal(K('python3 -u script.py'), 'Bash:python3 script.py');
assert.equal(K('/usr/bin/python3 script.py'), 'Bash:/usr/bin/python3 script.py');
assert.equal(K('python3 -m pytest -q'), 'Bash:python3 -m pytest');
assert.equal(K('node tests/x.mjs'), 'Bash:node tests/x.mjs');
assert.equal(K('bash start.sh'), 'Bash:bash start.sh');
assert.equal(K('perl script.pl'), 'Bash:perl script.pl');
assert.equal(K('osascript hello.scpt'), 'Bash:osascript hello.scpt');
assert.notEqual(K('python3 a.py'), K('python3 b.py'));
// inline code and stdin: one-off only
for (const c of ['python3 -c "print(1)"', "python3 -c 'import os'", 'node -e "1"', 'node -p 1', 'node --eval 1', 'perl -e "1"', 'perl -pe s/a/b/', 'bash -c "ls"', 'sh -c ls',
  'osascript -e "beep"', 'python3 <<EOF\nprint(1)\nEOF', 'python3 - <<EOF\nx\nEOF', 'python3', 'node', 'python3 -', 'ruby -e 1', 'python3 -W error x.py', 'node -r ./h.js x.js',
  'echo x | python3 script.py', 'cat a | bash', 'python3 a.py && python3 b.py', 'python3 a.py; rm x', 'ls $(pwd)', 'ls `pwd`', 'echo x > f', 'python3 script.py < in.txt', 'python3 $X',
  'sudo ls', 'env python3 a.py', 'xargs rm', 'eval ls', 'nohup ls', 'timeout 5 ls', 'source a.sh', 'uv run a.py', 'FOO=1 python3 a.py', '']) assert.equal(K(c), null, `no "Always allow": ${JSON.stringify(c)}`);
assert.equal(K('python3 a.py 2>&1'), 'Bash:python3 a.py'); // 2>&1 and >/dev/null are not a compound command
assert.equal(K('python3 a.py >/dev/null'), 'Bash:python3 a.py');
assert.equal(K('python3 a.py "x;y"'), 'Bash:python3 a.py'); // semicolon inside quotes
// a leading cd is ignored
assert.equal(K('cd ~/proj && npm run check'), 'Bash:npm run check');
assert.equal(K('cd "a b" && python3 s.py'), 'Bash:python3 s.py');
assert.equal(K('cd a && cd b && ls'), 'Bash:ls');
assert.equal(K('cd a && python3 -c "x"'), null);
assert.equal(K('cd a && ls && rm -rf x'), null);
// npm, git
assert.equal(K('npm run check'), 'Bash:npm run check');
assert.equal(K('npm run check -- --x'), 'Bash:npm run check');
assert.equal(K('npm test'), 'Bash:npm test');
assert.equal(K('npm install'), 'Bash:npm install');
assert.equal(K('git status'), 'Bash:git status');
assert.equal(K('git diff HEAD~1'), 'Bash:git diff');
assert.equal(K('npm exec evil'), null);
assert.equal(K('npm'), null);
assert.equal(K('git -c core.pager=x log'), null);
assert.equal(K('git config alias.x !sh'), null);
assert.equal(K('npx playwright test'), 'Bash:npx playwright');
assert.equal(K('npx -y evil'), null);
assert.equal(K('npx'), null);

console.log('guards: OK');
