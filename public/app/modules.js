// modules.js – Loader of optional modules (Home, Mail). The app core does not statically import module files, it calls them via the object M
// (M.domov?.otvorModul(k)); without a module the item is null and the core behaves as if that part did not exist.
// Which modules are enabled is determined by SOURCE.moduly (source.js: the `modules` field from /api/world, without it all, address ?withoutModules none).
// The Mobile module has nothing in the core that would be loaded: Settings only show it and Paired mobiles (devices.js) open it via dynamic import.
// At top level only declarations (imports are circular), loading is done by loadModules() from main.js right after loadWorld().
import { SOURCE } from './source.js';

// M.domov = namespace of home-module.js (Home district, its buildings, 3D, panels, events), M.posta = mail.js (flag on the mailbox, events)
export const M = { home: null, mail: null };

async function load(key, path) {
  try { M[key] = await import(path); return M[key]; }
  catch (e) { console.warn(`Mesto agentov: modul ${key} sa nenačítal (${e.message}), pokračujem bez neho`); SOURCE.modules[key] = false; return null; }
}

export async function loadModules() {
  const Z = SOURCE.modules;
  if (Z.home) {
    const house = await load('home', './home-module.js');
    if (house && Z.mail) await load('mail', './mail.js');
    if (house) house.fillHome(!M.mail); // without Mail the Mail building is not built in the Home district
  }
  SOURCE.modules.mail = !!M.mail;
}
