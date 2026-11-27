// source.js – Where the world comes from: real folders from the server (GET /api/world, phase 2) or demo (DEMO_BUILDINGS).
// loadWorld() fills BUILDINGS in demo-data.js before the city is built. The toggle is a label in the header (initSource), the choice is remembered
// in localStorage `agentic-mode`, the address ?demo or ?isReal overrides it. In real mode there are real agents on the floors (phase 3, api.js),
// in the demo a simulation (world.js).
import { BUILDINGS, DEMO_BUILDINGS, setBrainCount, setBrainGroups, setBrainBase } from './demo-data.js';
import { $, ago } from './utils.js';
import { t as T, locale } from './i18n.js';
import { setLocation } from './daylight.js';

// mode: 'isReal' | 'demo'; wanted = what you chose (on a server outage it differs from mode)
// modules: which optional parts are enabled (home, mail, mobile). The server sends them in /api/world in the field `modules`; when it does not have it (older server), everything is enabled.
// The address ?withoutModules turns them all off (checking the core without Home). user: { name } from the server (without it the app does not address anyone by name).
// city: default scene from the server ('layers' | 'classic'), until the user switches it in ⋯ (localStorage agentic-original-city).
export const MODULES = ['home', 'mail', 'mobile'];
export const SOURCE = { mode: 'demo', wanted: 'isReal', reason: '', created: null, archiveAfterDays: 30, home: [], modules: Object.fromEntries(MODULES.map((k) => [k, true])), user: null, city: null };
// tower positions (x, z) by the building's order in the world (slot 0 to 4); the city has five places around the Brain
const SLOTS = [[-14, -15], [14, -15], [0, -27], [-28, -15], [28, -15]]; // the first three are the original places, the 4th and 5th building go to the edges of the back row (more than 5 buildings are not shown)
const HOUR = 3600 * 1000;

// rows on the card above the tower (in Work): the most active and the latest, for a building with an archive the number of active ones
function rows(b) {
  const najS = [...b.floors].sort((x, y) => (y.sessions || 0) - (x.sessions || 0))[0];
  const najA = [...b.floors].sort((x, y) => (y.activity || 0) - (x.activity || 0))[0];
  const r = [];
  if (b.archive.length) r.push([T('app.data.active_projects'), T('app.source.activeRow', { n: b.floors.length, a: b.archive.length })]);
  if (najS?.sessions) r.push([T('app.data.mostActive'), `${najS.n} · ${najS.sessions} sessions`]);
  if (najA?.activity && r.length < 2) r.push([T('app.source.lastUsed'), `${najA.n} · ${ago(najA.activity)}`]);
  return r.slice(0, 2);
}

function convertWorld(d) {
  const now = Date.now();
  const buildings = d.buildings.slice(0, SLOTS.length).map((b, slot) => {
    const floor = (p) => ({ n: p.n, description: p.description || p.n, status: p.pending ? 'pending' : p.working || (p.lastSeen && now - p.lastSeen < HOUR) ? 'work' : 'none', sessions: p.sessions, lastSeen: p.lastSeen, activity: p.activity, path: p.shortPath, id: p.id, team: p.team || [] });
    const x = { key: b.key, title: b.title, color: b.color, slot, position: SLOTS[slot], floors: b.floors.map(floor), archive: b.archive.map(floor) };
    x.rows = rows(x);
    return x;
  }).filter((b) => b.floors.length);
  const m = d.brain || {};
  buildings.push({ key: 'brain', title: T('app.city.brain'), color: '#2bb68a', pavilion: true, floors: [{ n: 'Second Brain', description: T('app.data.second_brain'), status: 'work', sessions: m.sessions || 0, lastSeen: m.lastSeen, activity: m.lastSeen, path: m.shortPath, id: m.id || 'brain', team: m.team || [] },
    // Universal (2026-11-15): a universal chat outside projects, virtual floor `brain/universal` (the server knows it via findFloor, the app adds it to /api/world); lead Secretary
    { n: 'Univerzál', description: T('app.data.universal_chat_outside_projects'), status: 'none', sessions: 0, id: 'brain/universal', team: [], lead: { name: T('app.source.secretary'), emoji: '🗂️', role: T('app.data.universal_asistent_things_outside_project') } }] });
  const c = d.controlCenter; // Control Center = the city's app (~/Development/mesto-agentov), a separate building between the towers
  if (c) buildings.push({ key: 'control-center', title: T('app.city.controlCenter'), color: '#8c949e', pavilion: true, controlCenter: true, dispatch: { n: 'Dispečing', id: 'control-center/dispatch' }, floors: [{ n: c.n, description: T('app.source.appCity', { path: c.shortPath }), status: c.pending ? 'pending' : c.working ? 'work' : 'none', sessions: c.sessions, lastSeen: c.lastSeen, activity: c.lastSeen, path: c.shortPath, id: 'control-center', team: c.team || [] },
    // Dispatch (2026-11-15): a regular floor chat `controlCenter/dispatch` (virtual floor of the server, lead Dispatcher on Opus), a click on the top strip of the center opens it
    { n: 'Dispečing', description: T('app.data.splits_your_free_text_na_tasks_pre_p'), status: 'none', sessions: 0, id: 'control-center/dispatch', team: [], lead: { name: T('app.source.dispatcher'), emoji: '📋', role: T('app.data.splits_free_text_na_tasks_a_priradi_') } }] });
  return buildings;
}

// enabled modules: the field `modules` from the server (an object { home: true, … } or a list of keys); without it everything enabled, ?withoutModules turns everything off
function determineModules(d) {
  const m = d?.modules, isOn = Array.isArray(m) ? new Set(m) : null;
  for (const k of MODULES) SOURCE.modules[k] = m == null ? true : isOn ? isOn.has(k) : !!m[k];
  if (new URLSearchParams(location.search).has('withoutModules')) for (const k of MODULES) SOURCE.modules[k] = false;
  SOURCE.user = d?.user && typeof d.user === 'object' ? d.user : null;
  SOURCE.city = d?.city === 'classic' || d?.city === 'layers' ? d.city : null;
  setLocation(d?.location); // sunrise and sunset (daylight.js); without a location in world.json an estimate from the time zone
}

export async function loadWorld() {
  let wants = 'isReal';
  try { wants = localStorage.getItem('agentic-mode') || 'isReal'; } catch {}
  const q = new URLSearchParams(location.search);
  if (q.has('demo')) wants = 'demo'; else if (q.has('isReal')) wants = 'isReal';
  SOURCE.wanted = wants;
  if (wants === 'isReal') {
    try {
      const r = await fetch('/api/world', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(T('app.source.serverReturned', { s: r.status }));
      const d = await r.json(), buildings = convertWorld(d);
      if (buildings.length < 2) throw new Error(T('app.source.serverNotFound'));
      BUILDINGS.push(...buildings);
      setBrainCount(d.brain?.count); setBrainBase(d.brain?.shortPath);
      if (d.brain) { try { const ans = await fetch('/api/brain', { cache: 'no-store', signal: AbortSignal.timeout(2500) }); if (ans.ok) setBrainGroups((await ans.json())?.groups); } catch {} } // exact group counts for the graph in the dome (on error the sample ones stay)
      Object.assign(SOURCE, { language: d.language, mode: 'isReal', created: d.created, archiveAfterDays: d.archiveAfterDays ?? 30, home: Array.isArray(d.home) ? d.home : [] }); // home: Home buildings with a virtual floor (the building's chat, conversations.js)
      determineModules(d); if (!SOURCE.modules.home) SOURCE.home = []; // without the Home module no chats of it
      return;
    } catch (e) { SOURCE.reason = e.name === 'TimeoutError' ? T('app.source.serverNotResponding') : e.message; console.warn('Mesto agentov: /api/world –', SOURCE.reason, '→ demo režim'); }
  }
  BUILDINGS.push(...DEMO_BUILDINGS);
  SOURCE.mode = 'demo';
  determineModules(null);
}

export function toggleMode() {
  const fresh = SOURCE.mode === 'demo' ? 'isReal' : 'demo';
  try { localStorage.setItem('agentic-mode', fresh); } catch {}
  const u = new URL(location.href); u.searchParams.delete('demo'); u.searchParams.delete('isReal');
  location.href = u.toString(); // the city is rebuilt from the second source
}

// label in the header: "demo" / "real", a click switches the mode
export function initSource() {
  const el = $('mode');
  const real = SOURCE.mode === 'isReal';
  el.textContent = real ? T('app.source.isReal') : 'demo';
  el.classList.toggle('isReal', real);
  el.classList.toggle('outage', !real && SOURCE.wanted === 'isReal');
  el.title = real
    ? T('app.source.headingReal', { time: new Date(SOURCE.created).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })
    : SOURCE.wanted === 'isReal'
      ? T('app.source.headingOutage', { reason: SOURCE.reason })
      : T('app.source.headingDemo');
  el.onclick = toggleMode;
}
