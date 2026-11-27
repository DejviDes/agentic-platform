// navigation.js – Transitions between scenes (city ↔ floor ↔ interior), skins, the Esc and G keys.
// Created by splitting the prototype public/dizajn-v12d.html (phase 1). Module map: brain Projekty/mesto-agentov/technika.md.
import * as THREE from 'three';
import { active, homeModule, houseBack, houseTab, city, setState, workroom, DISTRICT, selectedAgent } from './state.js';
import { $, STANDALONE } from './utils.js';
import { HOME_BUILDINGS, HOME_TEAM } from './demo-data.js';
import { WORLD } from './world.js';
import { labelRenderer, BRAIN_CENTER, chooseSkin } from './scene-base.js';
import { buildCity } from './city.js';
import { buildFloor } from './floor.js';
import { buildCityLayers } from './city-layers.js';
import { buildFloorLayers } from './floor-layers.js';
import { fillSelect, setCrumbs, refreshPanel, refreshTeam, toast, selectAgent } from './panel.js';
import { homeChat, convState, openConv, resetConv } from './conversations.js';
import { floorId, CONV_STORE, isReal } from './api.js';
import { openWorkroom, closeWorkroom } from './workroom.js';
import { M } from './modules.js';
import { SOURCE } from './source.js';
import { t } from './i18n.js';

// Interruptible transitions (UX audit 2026-11-17, wave 1): every wait in an animation can be skipped (click, key, new jump).
// A new transition during a running one finishes it first and then runs (previously a click was discarded). "Fast transitions" in ⚙️ = without waiting.
const QUICK_KEY = 'city-quick-transitions';
export const quickTransitions = () => localStorage.getItem(QUICK_KEY) === '1';
const waiting = new Set();
// Layers (design v23, 2026-11-18): city and floor from slabs; the "Original city" switch in the ⋯ menu brings back city.js and floor.js unchanged
export const ORIGINAL_KEY = 'agentic-original-city';
// until the user switches the scene (localStorage), the default from the server applies: the /api/world field `city` ('klasicke' = Original city, otherwise Layers)
export const originalCity = () => { let v = null; try { v = localStorage.getItem(ORIGINAL_KEY); } catch {} return v === null ? SOURCE.city === 'classic' : v === '1'; };
const statusCity = () => (originalCity() ? buildCity() : buildCityLayers());
const statusFloor = (n) => (originalCity() ? buildFloor(n) : buildFloorLayers(n));
const statusInterior = (k) => (originalCity() ? M.home?.buildInterior(k) : M.home?.buildInteriorLayers(k)); // Home buildings: Layers as offices (2026-11-19)
const wait = (ms) => new Promise((r) => {
  if (quickTransitions() || workroom) return r(); // in the Workroom (wave 3) every transition is instant, the scene is not drawn anyway
  const f = () => { clearTimeout(t); waiting.delete(f); r(); }, t = setTimeout(f, ms);
  waiting.add(f);
});
export function skipTransition() { for (const f of [...waiting]) f(); }
let inProgress = false, endTransition = null;
async function beginTransition() {
  while (inProgress) { skipTransition(); await endTransition; }
  inProgress = true; let done; endTransition = new Promise((r) => (done = r));
  return () => { inProgress = false; done(); };
}
export async function enterFloor(n, agent = null, conv = null) { // conv: open this conversation straight away (Recent conversations in the Team panel)
  const done = await beginTransition();
  if (active && active !== city) { $('transition').classList.add('on'); await wait(320); active.dispose(); }
  else { const x = city.floors.get(n); if (x) { x.target = 2.6; await wait(360); } $('transition').classList.add('on'); await wait(320); if (x) { x.target = 0; x.slideOut = 0; } city.controls.dispose(); }
  labelRenderer.domElement.innerHTML = '';
  setState({ active: statusFloor(n) }); document.body.dataset.view = 'floor'; setState({ selectedAgent: null }); setState({ filter: 'all' });
  resetConv();
  fillSelect(); setCrumbs(); refreshTeam(); refreshPanel();
  $('transition').classList.remove('on'); done();
  if (isReal() && agent === null) { // phase 3: a conversation waiting for approval opens immediately (not in a separate window, there ?conv applies)
    if (STANDALONE) return;
    if (conv) { openConv(conv); return; }
    const pending = [...CONV_STORE.conv.values()].find((k) => k.floor === floorId(n) && k.status === 'pending');
    if (pending) setTimeout(() => openConv(pending.id), 700);
    return;
  }
  const pending = WORLD.floors.get(n).agents.find((a) => a.status === 'pending');
  if (agent !== null) setTimeout(() => selectAgent(agent), 700); else if (pending) setTimeout(() => selectAgent(pending.i), 900);
}
export async function backToCity() {
  if (!active || active === city) return;
  const done = await beginTransition();
  if (!active || active === city) return done(); // meanwhile already the city
  const fromHouse = active.kind === 'interior';
  $('transition').classList.add('on'); await wait(320);
  active.dispose(); labelRenderer.domElement.innerHTML = '';
  city.newControls(); setState({ active: city }); document.body.dataset.view = 'city'; setState({ selectedAgent: null });
  if (WORLD.rebuildCity) { WORLD.rebuildCity = false; setSkin(); } // new teammate: mini floors in the tower anew
  if (fromHouse) { setState({ houseAgent: null }); city.district('home'); }
  fillSelect(); setCrumbs(); refreshPanel();
  $('transition').classList.remove('on'); done();
}
// v12: entering a Home building (the camera flies to the building, then the interior with agents)
export async function enterInterior(k, back = null) { // back: a jump from the My house card, "←" leads back
  if (!HOME_TEAM[k]) return;
  const done = await beginTransition();
  setState({ DISTRICT: 'home' }); setState({ homeModule: k }); setState({ houseTab: 'overview' }); setState({ houseAgent: null, houseBack: back });
  document.querySelectorAll('#district button').forEach((b) => b.classList.toggle('on', b.dataset.r === 'home'));
  if (active && active !== city) { $('transition').classList.add('on'); await wait(320); active.dispose(); }
  else { const B = HOME_BUILDINGS.find((b) => b.k === k); if (city.layers) city.flyOn(city.point('home:' + k), null, 2.6); else city.flyOn(new THREE.Vector3(B.x, 1.5, B.z), new THREE.Vector3(B.x + 5, 8, B.z + 12)); await wait(450); $('transition').classList.add('on'); await wait(320); city.controls.dispose(); }
  labelRenderer.domElement.innerHTML = '';
  setState({ active: statusInterior(k) }); document.body.dataset.view = 'floor'; setState({ selectedAgent: null });
  fillSelect(); setCrumbs(); refreshTeam(); refreshPanel();
  $('transition').classList.remove('on'); done();
}
// district switch in the bar (City · Work · Home): core, because City and Work exist also without the Home module
export function toggleDistrict(r) {
  if (active && active !== city) { setState({ DISTRICT: r }); backToCity().then(() => city.district(r)); }
  else { setState({ DISTRICT: r }); city?.district(r); }
  document.querySelectorAll('#district button').forEach((b) => b.classList.toggle('on', b.dataset.r === r));
  refreshPanel();
}
export function flyToBrain() { if (active !== city) return; if (city.layers) city.flyOn(city.point('Second Brain'), null, 2); else city.flyOn(BRAIN_CENTER.clone().add(new THREE.Vector3(0, -1, 0)), BRAIN_CENTER.clone().add(new THREE.Vector3(8, 4, 14))); toast(t('app.navigation.brain')); }

// builds the city anew (at start and after hiring). Since 2026-11-10 only the Model, the Diorama has been removed.
export function setSkin() {
  chooseSkin();
  const was = active?.kind === 'floor' ? active.n : null, wasI = active?.kind === 'interior' ? active.k : null, ag = selectedAgent;
  if (active && active !== city) active.dispose();
  if (city) { city.dispose(); city.scene.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.dispose(); }); }); }
  labelRenderer.domElement.innerHTML = '';
  document.body.classList.toggle('layers', !originalCity()); // CSS: in Layers mode without the time-of-day control and without a tooltip over the city
  setState({ city: statusCity() }); setState({ active: city }); document.body.dataset.view = 'city';
  if (was) { city.controls.dispose(); setState({ active: statusFloor(was) }); document.body.dataset.view = 'floor'; setState({ selectedAgent: ag }); }
  if (wasI) { city.controls.dispose(); setState({ active: statusInterior(wasI) }); document.body.dataset.view = 'floor'; }
  fillSelect(); setCrumbs(); refreshTeam(); refreshPanel();
  if (DISTRICT !== 'city' && active === city) city.district(DISTRICT);
}
// collapsible right panel: a button on the edge or the P key; after hiding, the city moves to the center of the screen

// ---------- init: side effects (events, bar, clock) – called by main.js when all modules are loaded ----------
// phase 3: after a teammate is accepted the floor is rebuilt (a new figure at the desk)
export async function rebuildFloor(n) {
  if (active?.kind !== 'floor' || active.n !== n) return;
  const done = await beginTransition();
  if (active?.kind !== 'floor' || active.n !== n) return done(); // meanwhile you left
  $('transition').classList.add('on'); await wait(320);
  active.dispose(); labelRenderer.domElement.innerHTML = '';
  setState({ active: statusFloor(n) }); refreshTeam(); refreshPanel();
  $('transition').classList.remove('on'); done();
}

// ---------- address and history (UX audit 2026-11-17, wave 1) ----------
// Place in the app ↔ address: '' city, #<floor>, #<floor>/<conversation>, #home:<k> interior, #module:<k> Home building panel.
// Home building chat (2026-11-18): #home:<k>/chat and #home:<k>/chat/<conversation> (likewise #module:<k>/chat…).
// The Workroom (wave 3) adds a prefix: #work (without a conversation), #praca/<floor>/<conversation>, #praca/modul:<k>.
// Written via pushState on every change of place (Back in the browser = previous place), F5 and a saved link open the same thing.
// Cost: comparing two short strings once per 400 ms, no calls in the render loop.
export function addressPlaces() {
  if (workroom) { const a = addressPlaces3D(); return a ? '#work/' + a.slice(1) : '#work'; }
  return addressPlaces3D();
}
function addressPlaces3D() {
  if (active?.kind === 'floor') { const n = encodeURIComponent(active.n); return convState.open && convState.tab === 'conv' ? `#${n}/${encodeURIComponent(convState.open)}` : `#${n}`; }
  const ch = homeChat() ? (convState.open ? `/chat/${encodeURIComponent(convState.open)}` : '/chat') : '';
  if (active?.kind === 'interior') return `#home:${encodeURIComponent(active.k)}${ch}`;
  if (homeModule) return `#module:${encodeURIComponent(homeModule)}${ch}`;
  return '';
}
export function readAddress(h = location.hash) {
  const s = h.replace(/^#/, ''); if (!s) return { kind: 'city' };
  if (s === 'work' || s.startsWith('work/')) return { ...readAddress(s.slice(5)), work: true }; // Workroom (wave 3)
  if (s.startsWith('home:') || s.startsWith('module:')) { // Home building, optionally /chat and /chat/<conversation>
    const [k, ch, conv] = s.slice(s.indexOf(':') + 1).split('/');
    return { kind: s.startsWith('home:') ? 'interior' : 'module', k: decodeURIComponent(k), chat: ch === 'chat', conv: conv ? decodeURIComponent(conv) : null };
  }
  const [n, conv] = s.split('/'); // the parts are encoded, "/" in a floor name is %2F
  return { kind: 'floor', n: decodeURIComponent(n), conv: conv ? decodeURIComponent(conv) : null };
}
export async function openAddress(a) { // returns false when the address matches nothing in the city
  if (!STANDALONE && !!a.work !== workroom) { if (a.work) await openWorkroom({ withoutConv: true }); else closeWorkroom(); } // Back from the Workroom to 3D and vice versa
  if (a.kind === 'floor' && WORLD.floors.has(a.n)) {
    if (active?.kind === 'floor' && active.n === a.n) { if (isReal() && (convState.open || null) !== a.conv) openConv(a.conv); }
    else await enterFloor(a.n, null, a.conv);
    return true;
  }
  if (a.kind === 'interior' && HOME_TEAM[a.k]) { if (!(active?.kind === 'interior' && active.k === a.k)) await enterInterior(a.k); chatAddress(a); return true; }
  if (a.kind === 'module' && M.home) { if (active !== city) await backToCity(); if (!(a.chat && DISTRICT === 'home' && homeModule === a.k)) M.home?.openModule(a.k); chatAddress(a); return true; }
  if (a.kind === 'city') { if (active !== city) await backToCity(); if (homeModule) setState({ homeModule: null }), refreshPanel(); return true; }
  return false;
}
// building chat from the address: /chat opens the Chat tab (and the thread), without it from the chat it returns to the Overview (Back in the browser)
function chatAddress(a) {
  if (a.chat) { if (!homeChat() || (convState.open || null) !== a.conv) M.home?.openHomeChat(a.k, { id: a.conv }); }
  else if (houseTab === 'chat') { setState({ houseTab: 'overview' }); refreshPanel(); }
}
let fromHistory = Infinity; // during a jump from Back the intermediate states are not written; at start nothing until main.js opens the address
export function addressReady() { fromHistory = performance.now() + 300; }
function writeAddress() {
  if (STANDALONE || inProgress || performance.now() < fromHistory || !active) return;
  const a = addressPlaces();
  if (a !== location.hash && !(a === '' && !location.hash)) history.pushState(null, '', a || location.pathname + location.search);
}
function initAddress() {
  if (STANDALONE) return;
  setInterval(writeAddress, 400);
  addEventListener('popstate', async () => {
    fromHistory = performance.now() + 60000;
    try { await openAddress(readAddress()); } finally { fromHistory = performance.now() + 500; }
  });
}
function initQuick() {
  const b = $('quickBtn'); if (!b) return;
  const draw = () => { const on = quickTransitions(); b.textContent = on ? t('app.settings.on') : t('app.settings.off'); b.classList.toggle('on', on); };
  b.onclick = () => { localStorage.setItem(QUICK_KEY, quickTransitions() ? '0' : '1'); draw(); };
  draw();
}
export function initNavigation() {
  $('crumbs').addEventListener('click', (e) => { if (e.target.closest('[data-d]')) backToCity(); }); // breadcrumbs in the bar (v19): "City" and the building lead back to the city
  WORLD.listen.add((type, d) => { // new teammate: the floor immediately, the city immediately (if you are in it) or on return
    if (type !== 'team') return;
    if (active === city && !inProgress) { WORLD.rebuildCity = false; setSkin(); } else rebuildFloor(d.n);
  });
  initAddress(); initQuick();
  addEventListener('pointerdown', () => { if (inProgress) skipTransition(); }, { capture: true, passive: true }); // a click during an animation finishes it immediately
  addEventListener('keydown', (e) => {
    if (inProgress) { skipTransition(); if (e.key === 'Escape') return; } // Esc during a transition only finishes it, does not go back
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // ⌘G, ⌘P and the like belong to the browser, not the app (UX audit 2026-11-17)
    if (workroom) return; // Workroom (workroom.js): Esc = back to the city it handles itself, G (fly to the Brain) makes no sense there
    if (e.key === 'Escape' && homeChat() && convState.open) { const k = CONV_STORE.conv.get(convState.open); openConv(k?.parent ?? null); return; } // Home building chat: from a thread back to the list
    if (e.key === 'Escape' && active === city && homeModule) { M.home?.openModule(houseBack || null); return; } // Home module without an interior: Esc = back (previously it did nothing)
    if (e.key === 'Escape' && STANDALONE) { const k = convState.open && CONV_STORE.conv.get(convState.open); if (k?.parent) openConv(k.parent); return; } // separate window: only from a task back to the lead
    if (e.key === 'Escape' && isReal() && active?.kind === 'floor') { // phase 3: from a thread back to the list, from the list to the city
      if (convState.open) { const k = CONV_STORE.conv.get(convState.open); openConv(k?.parent ?? null); } else backToCity();
      return;
    }
    if (e.key === 'Escape') { if (selectedAgent !== null) selectAgent(null); else backToCity(); }
    if (e.key.toLowerCase() === 'g') flyToBrain();
  });
  document.querySelectorAll('#district button').forEach((b) => { if (b.dataset.r === 'home' && !M.home) b.hidden = true; b.onclick = () => { setState({ homeModule: null }); toggleDistrict(b.dataset.r); }; }); // without the Home module its button is missing
}
