// modules.js – optional server modules (Home, Mail, City on mobile).
// The core (server.js, agents.js…) knows nothing about them: modules are enabled in `world.json` (`modules: { home, mail, mobile }`, all off by default)
// and loaded with dynamic import() only when enabled and the module files exist. A missing file or a load error just disables the module
// (warning in the log), the server starts without it and does not crash.
//
// Each module is a file `module-<key>.js` with exports (all optional):
//   onlyClick   { '/api/…': 'text' } POST addresses only the app page may send (server.js adds them to the core onlyClick)
//   floor(id)   virtual floor by id (or null) for findFloor
//   floors()    list [{ id, n, lead }] of the module's virtual floors for /api/world (field `home`)
//   selftest    floor ids that `node server.js --selftest` must find
//   set(c)      the module's schedulers and state, c = { data, emit, sendMessage, stop, push } (not called in --selftest)
//   start(c)    steps after server start, c = { handler } (e.g. the mobile gateway); may return a Promise
//   handle(c)   the module's HTTP routes, c = { req, res, url, post, path, q, body, bodyBin, json }; true = handled
// The list of module files is in product/variants.json (modules.<key>.files); every new module file is added there too.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from './i18n.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const MODULES = { home: 'module-home.js', mail: 'module-mail.js', mobile: 'module-mobile.js' };

// enabled: { home: bool, mail: bool, mobile: bool } (from build-world.js `modules`)
export async function loadModules(enabled = {}) {
  const loaded = {}, loadedModules = {};
  for (const [key, file] of Object.entries(MODULES)) {
    loaded[key] = false;
    if (enabled[key] !== true) continue;
    if (!fs.existsSync(path.join(ROOT, file))) { console.log(t('server.modules.errorFile', { key, file })); continue; }
    try { loadedModules[key] = await import('./' + file); loaded[key] = true; }
    catch (e) { console.warn(t('server.modules.notLoaded', { key, error: e.message })); }
  }
  const list = Object.values(loadedModules);
  return {
    loaded, // modules actually loaded: { home, mail, mobile } → /api/world `modules`
    modules: loadedModules,
    onlyClick: Object.assign({}, ...list.map((m) => m.onlyClick || {})),
    floor: (id) => { for (const m of list) { const p = m.floor?.(id); if (p) return p; } return null; },
    floors: () => list.flatMap((m) => m.floors?.() || []),
    selftest: list.flatMap((m) => m.selftest || []),
    set: (c) => { for (const m of list) m.set?.(c); },
    start: (c) => list.map((m) => m.start?.(c)).filter(Boolean),
    async handle(c) { for (const m of list) if (await m.handle?.(c)) return true; return false; },
  };
}
