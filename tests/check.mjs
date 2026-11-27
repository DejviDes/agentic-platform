// tests/check.mjs – automated app test without Claude: `npm run check [URL]`.
// Static code check + the app in headless Chromium (1440×900) + performance measurement. Read-only: every POST is blocked.
// Requires a running server (default http://localhost:4747) and Chromium in ~/Library/Caches/ms-playwright.
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- thresholds and time limits ----------
const MAX_CALLS = 1800;   // draw calls in the city (last value ~1,600)
const MAX_CPU_MS = 6;       // CPU ms per frame in the city (last value ~4 ms)
const STEP_MS = 12000;      // limit for one step in the app
const PERF_FRAMES = 60;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'tests', 'vystup');
const URL_APP = (process.argv[2] || 'http://localhost:4747').replace(/\/$/, '');
const start = Date.now();
const rows = []; // { n, ok, note }
const write = (n, ok, note = '') => rows.push({ n, ok, note });
const sec = () => ((Date.now() - start) / 1000).toFixed(1);

async function step(n, fn, limit = STEP_MS) {
  let t;
  try {
    const v = await Promise.race([fn(), new Promise((_, rej) => (t = setTimeout(() => rej(new Error(`time limit ${limit / 1000} s`)), limit)))]);
    write(n, true, typeof v === 'string' ? v : '');
  } catch (e) { write(n, false, String(e.message || e).split('\n')[0].slice(0, 160)); } finally { clearTimeout(t); }
}

// ---------- 1. static checks ----------
function staticParts() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mesto-check-'));
  const check = (file) => {
    const k = path.join(tmp, 'x.mjs'); copyFileSync(file, k);
    const r = spawnSync(process.execPath, ['--check', k], { encoding: 'utf8' });
    return r.status === 0 ? null : (r.stderr || '').split('\n').find((l) => /Error/.test(l)) || 'chyba syntaxe';
  };
  const dir = path.join(ROOT, 'public', 'app');
  const wrong = [];
  const appFiles = readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const f of appFiles) { const c = check(path.join(dir, f)); if (c) wrong.push(`public/app/${f}: ${c}`); }
  write(`Syntax public/app (${appFiles.length} modules)`, !wrong.length, wrong.join('; '));
  const srv = readdirSync(ROOT).filter((f) => f.endsWith('.js'));
  const wrongWith = [];
  for (const f of srv) { const c = check(path.join(ROOT, f)); if (c) wrongWith.push(`${f}: ${c}`); }
  write(`Server syntax (${srv.length} files)`, !wrongWith.length, wrongWith.join('; '));
  rmSync(tmp, { recursive: true, force: true });
  const r = spawnSync(process.execPath, ['server.js', '--selftest'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  write('server.js --selftest', r.status === 0, r.status === 0 ? '' : `code ${r.status}: ${((r.stderr || r.stdout || '').trim().split('\n').pop() || '').slice(0, 140)}`);
  // unit tests of the modules' server parts (no Claude, no network, temp dirs); a missing file = package without that module, the test is skipped
  const TESTS = [['Task office', 'task-office'], ['Today', 'today'], ['Mail', 'mail'], ['Mail v2 (pass)', 'mail-pass'], ['Library', 'library'], ['Garden', 'garden'], ['Playground', 'playground'], ['Postman', 'postman'], ['Mac sleep', 'sleep'], ['Scheduler (gate)', 'scheduler'], ['Mobile gateway', 'gateway'], ['Agent guards (secrets, Always allow)', 'guards'], ['Brain (activity, orphans)', 'brain'], ['Scribe and Chronicler', 'scribe'], ['Data migration', 'migrate'], ['Platform', 'platform']];
  for (const [title, file] of TESTS) {
    if (!existsSync(path.join(ROOT, 'tests', `${file}.test.mjs`))) continue;
    const t = spawnSync(process.execPath, [`tests/${file}.test.mjs`], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    write(`${title}: unit test`, t.status === 0, t.status === 0 ? '' : ((t.stderr || t.stdout || '').trim().split('\n').find((l) => /Error|assert/i.test(l)) || 'failed').slice(0, 160));
  }  // public package (only in the private repository): trial bake of the working copy, warning only (WARN), does not fail the check
  if (existsSync(path.join(ROOT, 'product', 'bake.mjs'))) {
    const z = spawnSync(process.execPath, ['product/bake.mjs', '--selftest', '--workroom'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    const output = ((z.stdout || '') + (z.stderr || '')).split('\n');
    const what = output.filter((l) => /^\s{2}\S.*(imports|syntax|@osobne)|^\s*✗|leak|findings|forbidden file/i.test(l)).map((l) => l.trim()).slice(0, 3).join('; ');
    write('Product: trial bake (guard, imports)', z.status === 0 ? true : 'warning', z.status === 0 ? '' : `${what || 'failed'} (detailed: node product/bake.mjs --selftest --workroom)`.slice(0, 220));
  }
}

// ---------- 2. the app in the browser ----------
async function app() {
  try { const r = await fetch(URL_APP + '/', { signal: AbortSignal.timeout(4000) }); if (!r.ok) throw new Error('HTTP ' + r.status); }
  catch (e) { write('Server running', false, `${URL_APP} not responding (${e.message}). Start it: npm start`); return; }
  write('Server running', true, URL_APP);

  let browser;
  try { browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] }); }
  catch (e) { write('Chromium', false, 'failed to start: ' + String(e.message).split('\n')[0] + ' (try: npx playwright-core install chromium)'); return; }
  try {
    // city lock (lock.js): test key from data/test-key, the server accepts it only for GET
    let keySelftest = ''; try { keySelftest = readFileSync(process.env.AGENTIC_TEST_KEY_FILE || path.join(ROOT, 'data', 'test-key'), 'utf8').trim(); } catch {} // AGENTIC_TEST_KEY_FILE: key from another directory (git worktree)
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    const posts = [], errors = [];
    // read-only: every POST (also PUT/DELETE/PATCH) is dropped and recorded
    await ctx.route('**/*', (route) => { const m = route.request().method(); if (m !== 'GET' && m !== 'HEAD') { posts.push(`${m} ${new URL(route.request().url()).pathname}`); return route.abort(); } return keySelftest && route.request().url().startsWith(new URL(URL_APP).origin + '/') ? route.continue({ headers: { ...route.request().headers(), 'x-city-key': keySelftest } }) : route.continue(); });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text() + (m.location()?.url || ''))) errors.push(m.text().slice(0, 140)); });
    page.on('pageerror', (e) => errors.push('exception: ' + String(e.message).slice(0, 140)));
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/i.test(r.url())) errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });

    const view = () => page.evaluate(() => document.body.dataset.view);
    const pending = (fn, arg) => page.waitForFunction(fn, arg, { timeout: STEP_MS - 1500 });

    await step('App loads without console errors', async () => {
      await page.goto(URL_APP + '/?perf&time=13:00', { waitUntil: 'load' });
      await pending(() => document.body.dataset.view === 'city' && !!window.__perf);
      await page.waitForTimeout(1500);
      if (errors.length) throw new Error(`${errors.length}× ${errors[0]}`);
    });
    const mode = await page.evaluate(() => document.getElementById('mode')?.textContent?.trim() || '?').catch(() => '?');

    await step('City view (first render)', async () => {
      await pending(() => window.__perf.info().render.calls > 0);
      await page.screenshot({ path: path.join(OUTPUT, 'mesto.png') });
      return `mode: ${mode}`;
    });

    await step('Work view', async () => {
      await page.click('#district button[data-r="work"]');
      await pending(() => document.querySelector('#district button[data-r="work"]').classList.contains('on'));
      await page.waitForTimeout(800);
      if ((await view()) !== 'city') throw new Error('view is not the city');
    });

    await step('Enter a floor and back (Esc)', async () => {
      await page.click('#district button[data-r="city"]');
      await page.waitForTimeout(500);
      // ES modules have a single instance, an import from the browser returns the same functions as the app (a click on a 3D building cannot be hit reliably in headless)
      await page.evaluate(async () => { const { WORLD } = await import(new URL('app/world.js', document.baseURI).href); const { enterFloor } = await import(new URL('app/navigation.js', document.baseURI).href); enterFloor([...WORLD.floors.keys()][0]); });
      await pending(() => document.body.dataset.view === 'floor');
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUTPUT, 'poschodie.png') });
      // Esc may first close the thread/agent selection, hence up to 3 presses
      for (let i = 0; i < 3 && (await view()) !== 'city'; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(900); }
      await pending(() => document.body.dataset.view === 'city');
    }, 20000);

    await step('City overview (panel)', async () => {
      await page.click('#district button[data-r="city"]');
      await pending(() => /Prehľad|Overview/.test(document.getElementById('content')?.textContent || ''));
    });

    await step('Switch demo / real and back', async () => {
      const was = await page.evaluate(() => document.getElementById('mode').textContent.trim());
      await page.evaluate(() => document.getElementById('mode').click()); /* 2026-11-20: the button is in the Settings window, not in the ⋯ menu */ await page.waitForTimeout(1500);
      await pending(() => document.body.dataset.view === 'city');
      const po = await page.evaluate(() => document.getElementById('mode').textContent.trim());
      await page.evaluate(() => document.getElementById('mode').click()); /* 2026-11-20: the button is in the Settings window, not in the ⋯ menu */ await page.waitForTimeout(1500);
      await pending(() => document.body.dataset.view === 'city');
      return `${was} → ${po} → ${was}`;
    }, 20000);

    // 2026-11-21 (code audit): both cities before the Original city is split into a separate package. A round = city, floor, Home interior and back.
    // Scenes are called through the app modules (as above), the scene kind is verified by state.js: Layers have active.layers === true.
    const scene = () => page.evaluate(async () => { const { active } = await import(new URL('app/state.js', document.baseURI).href); return { kind: active?.kind, layers: !!active?.layers }; });
    const hasHome = () => page.evaluate(async () => !!(await import(new URL('app/modules.js', document.baseURI).href)).M.home); // Home module loaded (modules.js)
    const backToCity = async () => { for (let i = 0; i < 3 && (await view()) !== 'city'; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(900); } await pending(() => document.body.dataset.view === 'city'); };
    const roundCity = async (original, file) => {
      await page.evaluate((p) => localStorage.setItem('agentic-original-city', p ? '1' : '0'), original);
      await page.goto(URL_APP + '/?time=13:00', { waitUntil: 'load' });
      await pending(() => document.body.dataset.view === 'city');
      await page.waitForTimeout(1200);
      let s = await scene();
      if (s.kind !== 'city' || s.layers === original) throw new Error(`city: expected ${original ? 'Original' : 'Layers'}, got ${JSON.stringify(s)}`);
      await page.screenshot({ path: path.join(OUTPUT, `${file}-mesto.png`) });
      await page.evaluate(async () => { const { WORLD } = await import(new URL('app/world.js', document.baseURI).href); const { enterFloor } = await import(new URL('app/navigation.js', document.baseURI).href); enterFloor([...WORLD.floors.keys()][0]); });
      await pending(() => document.body.dataset.view === 'floor');
      await page.waitForTimeout(1000);
      s = await scene();
      if (s.kind !== 'floor' || s.layers === original) throw new Error(`floor: ${JSON.stringify(s)}`);
      await backToCity();
      if (!(await hasHome())) return 'city and floor and back (Home module is off, interior skipped)';
      await page.evaluate(async () => { const { enterInterior } = await import(new URL('app/navigation.js', document.baseURI).href); await enterInterior('house'); });
      await pending(() => document.body.dataset.view === 'floor');
      await page.waitForTimeout(1000);
      s = await scene();
      if (s.kind !== 'interior' || s.layers === original) throw new Error(`Home interior: ${JSON.stringify(s)}`);
      await page.screenshot({ path: path.join(OUTPUT, `${file}-domov.png`) });
      await backToCity();
      return 'city, floor, Home interior (My house) and back';
    };
    await step('Layers: round with Home interior', () => roundCity(false, 'layers'), 30000);
    await step('Original city: round with Home interior', async () => {
      try { return await roundCity(true, 'original'); } finally { await page.evaluate(() => localStorage.setItem('agentic-original-city', '0')).catch(() => {}); }
    }, 40000);

    // Core without modules (?withoutModules): the modules.js loader turns them all off even if the server sends them enabled. The app must run without the Home district, its button,
    // the Scheduled tasks settings and without console errors; the #domov:… address returns it to the city. Verified in Layers and in the Original city.
    const roundWithoutModules = async (original) => {
      await page.evaluate((p) => localStorage.setItem('agentic-original-city', p ? '1' : '0'), original);
      const ago = errors.length, called = new Set(), watch = (r) => { const m = new URL(r.url()).pathname.match(/\/api\/(today|home|tower|mail|sorting|tasks|library|garden|playground)(\/|$)/); if (m) called.add(m[1]); };
      page.on('request', watch); // without modules the app must not call module URLs (the server would return 404)
      await page.goto(URL_APP + `/?withoutModules&time=13:00&k=${original ? 'p' : 'v'}#home:house`, { waitUntil: 'load' }); // a different parameter so the page really reloads (a difference only in #hash does not reload it)
      await pending(() => document.body.dataset.view === 'city');
      await page.waitForTimeout(1500);
      const st = await page.evaluate(async () => {
        const { M } = await import(new URL('app/modules.js', document.baseURI).href), { HOME_BUILDINGS } = await import(new URL('app/demo-data.js', document.baseURI).href);
        const { active } = await import(new URL('app/state.js', document.baseURI).href);
        const tl = document.querySelector('#district button[data-r="home"]');
        return { home: !!M.home, mail: !!M.mail, buildings: HOME_BUILDINGS.length, button: !!tl && !tl.hidden, kind: active?.kind, layers: !!active?.layers };
      });
      if (st.home || st.mail || st.buildings || st.button) throw new Error(`modules are not off: ${JSON.stringify(st)}`);
      if (st.kind !== 'city' || st.layers === original) throw new Error(`scene: ${JSON.stringify(st)}`);
      await page.screenshot({ path: path.join(OUTPUT, `bez-modulov-${original ? 'original' : 'layers'}.png`) });
      await page.evaluate(async () => { const { WORLD } = await import(new URL('app/world.js', document.baseURI).href); const { enterFloor } = await import(new URL('app/navigation.js', document.baseURI).href); enterFloor([...WORLD.floors.keys()][0]); });
      await pending(() => document.body.dataset.view === 'floor');
      await page.waitForTimeout(800);
      await backToCity();
      await page.click('#district button[data-r="work"]'); await page.waitForTimeout(600);
      await page.click('#district button[data-r="city"]'); await page.waitForTimeout(400);
      await page.keyboard.press('Meta+,'); await pending(() => document.getElementById('nsWindow')?.classList.contains('on'));
      const category = await page.evaluate(() => [...document.querySelectorAll('#nsWindow [data-nskat]')].map((b) => b.dataset.nskat));
      if (category.includes('scheduled')) throw new Error('Settings show Scheduled tasks without the Home module');
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      await page.click('#workroomBtn'); await pending(() => document.body.classList.contains('workroom')); await page.waitForTimeout(1200);
      const house = await page.evaluate(() => !!document.querySelector('.pr-bld.home, [data-pa="module"]'));
      if (house) throw new Error('Workroom shows Home without the module');
      for (let i = 0; i < 3 && (await page.evaluate(() => document.body.classList.contains('workroom'))); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(700); } // Esc = back to the city
      await pending(() => !document.body.classList.contains('workroom'));
      page.off('request', watch);
      if (called.size) throw new Error(`appka bez modulov volala: ${[...called].join(', ')}`);
      if (errors.length > ago) throw new Error(`${errors.length - ago}× ${errors[ago]}`);
      return 'city, floor, Work, Settings and Workroom without Home, no module API calls';
    };
    await step('Jadro bez modulov: Vrstvy', () => roundWithoutModules(false), 30000);
    await step('Core without modules: Original city', async () => {
      try { return await roundWithoutModules(true); } finally { await page.evaluate(() => localStorage.setItem('agentic-original-city', '0')).catch(() => {}); }
    }, 30000);

    // measure on a fresh page so nothing from the clicking interferes (fixed time 13:00)
    await step(`Performance (city, ${PERF_FRAMES} frames)`, async () => {
      await page.goto(URL_APP + '/?perf&time=13:00', { waitUntil: 'load' });
      await pending(() => document.body.dataset.view === 'city' && !!window.__perf);
      await page.waitForTimeout(2500);
      const test = (n) => page.evaluate((k) => window.__perf.test(k, true), n);
      await test(10); // shader warm-up
      let best = null;
      for (let i = 0; i < 3; i++) { const t = await test(PERF_FRAMES); if (!best || t.cpuMs < best.cpuMs) best = t; }
      const t = best, wrong = [];
      if (t.calls > MAX_CALLS) wrong.push(`calls ${t.calls} > ${MAX_CALLS}`);
      if (t.cpuMs > MAX_CPU_MS) wrong.push(`CPU ${t.cpuMs} ms > ${MAX_CPU_MS} ms`);
      const sum = `calls ${t.calls}, CPU ${t.cpuMs} ms, triangles ${Math.round(t.triangles / 1000)}k, geometries ${t.geometries}, textures ${t.textures}`;
      if (wrong.length) throw new Error(wrong.join(', ') + ` (${sum})`);
      return sum;
    }, 45000);

    write('Read-only: no POST / writes to the server', posts.length === 0, posts.length ? `blocked: ${[...new Set(posts)].join(', ')}` : '');
    const totalErrors = errors.length;
    write('Console and network without errors during the whole test', totalErrors === 0, totalErrors ? `${totalErrors}×: ${[...new Set(errors)].slice(0, 3).join(' | ')}` : '');
  } finally { await browser.close(); }
}

// ---------- output ----------
mkdirSync(OUTPUT, { recursive: true });
staticParts();
await app().catch((e) => write('Unexpected test error', false, String(e.stack || e).split('\n').slice(0, 2).join(' ')));
const width = Math.max(...rows.map((r) => r.n.length));
console.log(`\nAgentic Platform: automated test (${URL_APP})\n${'─'.repeat(width + 12)}`);
for (const r of rows) console.log(`${r.ok === 'warning' ? 'WARN  ' : r.ok ? 'OK    ' : 'FAIL  '} ${r.n.padEnd(width)}${r.note ? '  ' + r.note : ''}`);
const wrong = rows.filter((r) => !r.ok).length; // 'warning' is a warning, not a failure
console.log(`${'─'.repeat(width + 12)}\n${wrong ? `FAIL: ${wrong} of ${rows.length} checks failed` : `OK: ${rows.length} checks passed`} · ${sec()} s · screenshot: tests/vystup/mesto.png\n`);
process.exit(wrong ? 1 : 0);
