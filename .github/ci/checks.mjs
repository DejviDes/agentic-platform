// Checks for GitHub Actions (.github/workflows/ci.yml), the same on Linux, Windows and macOS (no shell globs, no bash).
//   node .github/ci/checks.mjs syntax   node --check of every .js/.mjs file of the package (without node_modules and .git)
//   node .github/ci/checks.mjs tests    unit tests from the TESTS list in tests/check.mjs that are in the package
//                                       (no running server, no browser, no Claude; npm run check also opens Chromium, so CI does not run it)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['node_modules', '.git', 'data']);
const what = process.argv[2];
let failed = 0;

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.(m?js)$/.test(e.name)) out.push(p);
  }
  return out;
}

function run(label, args) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} (${Date.now() - t0} ms)`);
  if (!ok) console.log(((r.stdout || '') + (r.stderr || '') || r.error?.message || '').trim().split('\n').slice(-25).map((l) => '     ' + l).join('\n'));
  return ok;
}

if (what === 'syntax') {
  const list = files(ROOT);
  for (const f of list) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) { failed++; console.log(`FAIL ${path.relative(ROOT, f)}\n${(r.stderr || '').trim()}`); }
  }
  console.log(`node --check: ${list.length - failed} of ${list.length} files ok`);
} else if (what === 'tests') {
  // the list of unit tests lives in tests/check.mjs (const TESTS = [['Title', 'file'], ...]), a file missing in the package is skipped like there
  const src = fs.readFileSync(path.join(ROOT, 'tests', 'check.mjs'), 'utf8');
  const block = src.slice(src.indexOf('const TESTS = ['), src.indexOf('for (const [title, file] of TESTS)'));
  const tests = [...block.matchAll(/\['([^']+)',\s*'([\w-]+)'\]/g)].map((m) => ({ title: m[1], file: `tests/${m[2]}.test.mjs` }));
  if (!tests.length) { console.log('FAIL no TESTS list found in tests/check.mjs'); process.exit(1); }
  const present = tests.filter((t) => fs.existsSync(path.join(ROOT, t.file)));
  for (const t of present) run(`${t.title} (${t.file})`, [t.file]);
  console.log(`unit tests: ${present.length - failed} of ${present.length} ok (${tests.length - present.length} belong to modules that are not in this package)`);
  if (!present.length) failed++;
} else {
  console.log('usage: node .github/ci/checks.mjs syntax|tests');
  process.exit(2);
}
process.exit(failed ? 1 : 0);
