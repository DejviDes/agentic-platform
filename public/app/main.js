// main.js – Entry point: module init, mouse, start (skin, address #…), main tick() loop with performance saving.
// Created by splitting the prototype public/dizajn-v12d.html (phase 1). Module map: brain Projekty/mesto-agentov/technika.md.
import { waitForUnlock } from './lock.js'; // first: wraps fetch with the card key before any other module uses it
import { active, focusConv, hover, city, setState, workroom, DISTRICT, selectedAgent } from './state.js';
import { $, esc, ago, STANDALONE } from './utils.js';
import { BUILDINGS, HOME, HOME_BUILDINGS, HOME_TEAM } from './demo-data.js';
import { M, loadModules } from './modules.js';
import { WORLD, tickWorld, createWorld } from './world.js';
import { clock, labelRenderer, renderer } from './scene-base.js';
import { initPanel, setCrumbs, refreshPanel, refreshTeam, selectAgent, selectHouseAgent } from './panel.js';
import { addressReady, readAddress, initNavigation, setSkin, openAddress, enterInterior, enterFloor } from './navigation.js';
import { PERF } from './perf.js';
import { initSource, loadWorld, SOURCE } from './source.js';
import { initConnection } from './api.js';
import { initControlCenter, afterRefresh } from './control-center.js';
import { CONV_STORE } from './api.js';
import { initPointOut } from './point-out.js';
import { initSettings } from './settings.js';
import { hasHomeChat, openConv } from './conversations.js';
import { initPalette } from './command-palette.js';
import { initTopbar } from './topbar.js';
import { openWindowFromAddress } from './file-view.js';
import { openDispatchChat } from './dispatch.js';
import { initWorkroom, openWorkroom, workroomSaved } from './workroom.js';
import { agentIcon } from './icons.js';
import { initLanguage, t as tr, tn as trn } from './i18n.js';


await waitForUnlock(); // city lock: a new card waits for Touch ID (lock.js)
await loadWorld(); await initLanguage(SOURCE.language); document.title = tr('app.index.title'); // phase 2: BUILDINGS from the server (real folders), sample ones on failure or in demo mode
await loadModules(); // optional modules (Home, Mail) via dynamic import, only the enabled ones (modules.js)
const homeLoaded = SOURCE.mode === 'isReal' ? M.home?.loadHome(2000) : null; // phase 4A: Home from the server (runs in parallel, awaited before building the city), a sample on error
const taskOfficeLoaded = SOURCE.mode === 'isReal' ? M.home?.loadTasks(2000) : null; // Task office: board in 3D, awaited only while the Home load is running
if (SOURCE.mode === 'isReal') M.mail?.loadMail(2000); // Mail: flag on the mailbox in 3D, not awaited
if (SOURCE.mode === 'isReal') M.home?.loadPostman(2000); // Postman: letter and flag in 3D, Home button, not awaited
if (SOURCE.mode === 'isReal') M.home?.loadSorting(2000); // Sorting center: flag and cart in 3D, not awaited
initSettings(); initSource(); initPanel(); initNavigation(); // panel and navigation events (in the prototype they were directly at top level)

// ---------- mouse ----------
const tip = $('tip');
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!active) return;
  const h = active.pick(e); setState({ hover: h });
  renderer.domElement.style.cursor = h !== null ? 'pointer' : 'grab';
  if (active.kind === 'city' && typeof h === 'string' && h.startsWith('home:')) {
    const k = h.slice(5), B = HOME_BUILDINGS.find((b) => b.k === k);
    tip.innerHTML = B ? `<div class="serif">${esc(B.title)}</div><div class="mono" style="margin:3px 0 6px">${esc(B.description)}</div><div style="font-size:12px">${HOME_TEAM[k] ? `${tr('app.main.homeClick')} · ${HOME_TEAM[k].map((a) => agentIcon(a, 'xs')).join(' ')} →` : tr('app.main.clickOpen')}</div>` : `<div class="serif">${tr('app.main.postman')}</div><div class="mono" style="margin-top:3px">${trn('app.main.postmanCarries', M.home?.postmanCount?.() ?? (HOME.proposals || []).filter((n) => n.status === null).length)}</div>`;
    tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.style.display = 'block';
  } else if (active.kind === 'city' && h === '__dispatch') {
    tip.innerHTML = `<div class="serif">${tr('app.main.dispatch')}</div><div class="mono" style="margin:3px 0 6px">${tr('app.main.dispatchSat')}</div><div style="font-size:12px">${tr('app.main.dispatchInfo')}</div>`;
    tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.style.display = 'block';
  } else if (active.kind === 'city' && h) {
    const P = WORLD.floors.get(h), ul = WORLD.tasks.filter((u) => u.p === h), c = (s) => ul.filter((u) => u.column === s || (s === 'doing' && u.column === 'flies')).length;
    tip.innerHTML = `<div class="serif">${esc(h)}</div><div class="mono" style="margin:3px 0 8px">${esc(P.def.description)} · ${trn('app.main.agents', P.agents.length)}${P.def.sessions ? ` · ${tr('app.main.sessions', { n: P.def.sessions })}` : ''}${P.def.activity ? ` · ${ago(P.def.activity)}` : ''}</div>
      <div class="mono">${tr('app.main.doing')} <b style="color:var(--ink)">${c('doing')}</b> · ${tr('app.main.rad')} <b style="color:var(--ink)">${c('rad')}</b> · ${tr('app.main.done')} <b style="color:var(--ink)">${c('done')}</b>${c('pending') ? ` · <b style="color:var(--err)">${tr('app.main.pending', { n: c('pending') })}</b>` : ''}</div>
      <div style="font-size:12px;margin-top:8px">${tr('app.main.enter')}</div>`;
    tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.style.display = 'block';
  } else tip.style.display = 'none';
});
let down, clickHome = { k: null, t: 0 }; // Home building: click = panel right away, double click = interior (UX audit 2026-11-17, previously always ~2.5 s to the interior)
renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || !active) return;
  const h = active.pick(e);
  if (active.kind === 'city') { if (typeof h === 'string' && h.startsWith('home:')) { const k = h.slice(5), double = clickHome.k === k && performance.now() - clickHome.t < 450; clickHome = { k, t: performance.now() }; if (double && HOME_TEAM[k] && k !== 'postman') enterInterior(k); else M.home?.openModule(k); } else if (h === '__dispatch') openDispatchChat(); else if (h) enterFloor(h); } else if (h !== null) { if (active.kind === 'interior') selectHouseAgent(h); else selectAgent(h); }
});

// ---------- start ----------
createWorld();
await initConnection(); // phase 3: real agents (nothing in the demo)
initPointOut(); // ⚑ To the Control Center: button in the header and the U key
initPalette(); // ⌘K: quick search and jumps
initTopbar(); // v19 bar: "Search ⌘K" and "waiting for you N"
initWorkroom(); // Workroom (UX audit wave 3): button, W key, list and mini status
initControlCenter(); // Control Center: git status for the bar and the building label
await Promise.all(['400 26px "Instrument Serif"', '500 44px "JetBrains Mono"', '600 34px Inter'].map((f) => document.fonts.load(f).catch(() => {})));
await Promise.all([homeLoaded, taskOfficeLoaded]); // HOME must be filled before buildHome (boards and labels in 3D)
setSkin();
const hash = decodeURIComponent(location.hash.slice(1));
if (await afterRefresh()) {} // self-refresh after a frontend change: back to the same place with the typed text (control-center.js)
else if (STANDALONE && new URLSearchParams(location.search).has('file')) { // standalone file window (?file=<path>&base=…, file-view.js): only the preview, the scene is not drawn
  renderer.domElement.style.display = 'none'; labelRenderer.domElement.style.display = 'none'; openWindowFromAddress();
}
else if (STANDALONE) { // standalone conversation window: ?conv=<id>#<floor>, the scene is built but never drawn (below panelTick instead of tick)
  renderer.domElement.style.display = 'none'; labelRenderer.domElement.style.display = 'none';
  const id = new URLSearchParams(location.search).get('conv');
  if (WORLD.floors.has(hash)) { await enterFloor(hash); openConv(id); }
  else if (hash.startsWith('module:') && hasHomeChat(hash.slice(7))) await M.home?.openHomeChat(hash.slice(7), { id }); // Home building chat (conversations.js openWindow)
  else $('content').innerHTML = `<div class="empty">${tr('app.main.floorNotFound')}</div>`;
}
else if (location.hash) await openAddress(readAddress()); // #floor, #floor/conv, #home:k, #module:k (navigation.js, UX audit wave 1)
// The Workroom is remembered (F5 stays in it): the address #praca/… opens it by itself, without an address (or after the app self-refresh) according to localStorage
if (!STANDALONE && !workroom && workroomSaved() && (!location.hash || location.hash.startsWith('#work'))) await openWorkroom();
addressReady(); // from now on the place in the app is written to the address
if (new URLSearchParams(location.search).has('universal') && active === city && city.universalView) setTimeout(() => city.flyOn(city.universalView.t.clone(), city.universalView.p.clone()), 1200);
if (new URLSearchParams(location.search).has('control-center') && active === city && city.controlCenterView) setTimeout(() => city.flyOn(city.controlCenterView.t.clone(), city.controlCenterView.p.clone()), 1200);

let lastPanel = 0, lastVersion = -1, panelMouse = false;
$('panel').addEventListener('pointerenter', () => (panelMouse = true));
$('panel').addEventListener('pointerleave', () => (panelMouse = false));
// v11b saving: 60 frames/s when working with the mouse, 30 when you only look, 12 after 1.5 min without movement.
// Shadows in the city are recomputed once a second (the sun moves slowly), more often when the mouse moves.
let lastSnapshot = 0, lastEnter = performance.now(), lastShadow = 0, lastScene = null;
for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown']) addEventListener(ev, () => (lastEnter = performance.now()), { passive: true, capture: true });
const PR_MAX = Math.min(devicePixelRatio, 1.5); let prNow = PR_MAX, lastCamera = '', lastBadges = null;
// 2026-11-10 power-saving mode: window in the background (without focus) or 90 s without movement = drawn only once per 2 s, immediately on a state change
// (WORLD, conversations). When someone waits for approval 4 frames/s (red blinking), when someone works 2 (green pulsing).
// On battery (Battery API, not in Safari) at most 30 frames/s even when working with the mouse.
let onBattery = false, lastStatus = '', lastChange = 0;
navigator.getBattery?.().then((b) => { const setB = () => (onBattery = !b.charging); setB(); b.addEventListener('chargingchange', setB); }).catch(() => {});
const agentStatus = () => { let c = false, p = false; for (const P of WORLD.floors.values()) for (const a of P.agents) { if (a.status === 'pending') c = true; else if (a.status === 'work' || a.status === 'delegates') p = true; } return c ? 4 : p ? 2 : 0.5; };
function panelTick(t) {
  const quiet = (panelMouse && t - lastPanel < 1.6) || (DISTRICT === 'home' && active === city) || active?.kind === 'interior'; // Home is redrawn only after an action (the interior also on an agent state change)
  if (!quiet && (WORLD.version !== lastVersion || (t - lastPanel > 0.5 && selectedAgent === null))) {
    if (WORLD.version !== lastVersion) { refreshTeam(); setCrumbs(); }
    lastVersion = WORLD.version; lastPanel = t; refreshPanel();
  }
}
// Workroom (wave 3): the render loop stands still (no requestAnimationFrame, WebGL or nameplates), simulation and panel 2× per second
// via the interval below. On return to the city the 'city-workroom' event starts it again and nameplates and shadows are recomputed.
let loop = false;
function tick(now = performance.now()) {
  if (workroom) { loop = false; return; }
  loop = true; requestAnimationFrame(tick);
  const calm = now - lastEnter, saving = !document.hasFocus() || calm >= 90000;
  const status = `${WORLD.version}|${CONV_STORE.ver}|${DISTRICT}`; if (status !== lastStatus) { lastStatus = status; lastChange = now; } // state change = draw right away (and smoothly for a while)
  const fps = saving ? (now - lastChange < 1500 ? 15 : agentStatus()) : Math.min(calm < 4000 ? 60 : 30, onBattery ? 30 : 60);
  const pr = Math.min(PR_MAX, calm < 4000 ? 1.5 : calm < 90000 ? 1.25 : 1);
  if (pr !== prNow) { prNow = pr; renderer.setPixelRatio(pr); }
  if (now - lastSnapshot < 1000 / fps - 3) return;
  lastSnapshot = now;
  const dtReal = Math.min(clock.getDelta(), 3), dt = Math.min(dtReal, 0.12), t = clock.elapsedTime; // simulation and timers run in real time, animations do not skip
  const m0 = performance.now(); let m1 = m0, m2 = m0, m3 = m0;
  tickWorld(dtReal); m1 = performance.now();
  if (active && !focusConv) { active.update(dt, t, hover); active.controls.update();
    const inCity = active === city; renderer.shadowMap.autoUpdate = !inCity;
    if (inCity && (lastScene !== active || now - lastShadow > (calm < 4000 ? 200 : 1000))) { renderer.shadowMap.needsUpdate = true; lastShadow = now; }
    lastScene = active; m2 = performance.now();
    PERF.gpuStart(); renderer.render(active.scene, active.camera); PERF.gpuStop(); m3 = performance.now();
    const cam = active.camera, key = cam.matrixWorld.elements.join(',') + cam.projectionMatrix.elements[0] + DISTRICT + innerWidth + innerHeight + '|' + hover; // hover: ladder of floor names at the tower
    if (!inCity || active.badgesChange || key !== lastCamera || lastBadges !== active) { lastCamera = key; lastBadges = active; labelRenderer.render(active.scene, cam); } } // badgesChange: Layers city, the boards are just rising
  const m4 = performance.now();
  // panel: on a change right away, otherwise for progress 2× per second (agent detail only on a change so it is not overwritten while reading)
  // when the mouse is over the panel, redraw rarely so that a click on a button does not vanish under the hand
  panelTick(t);
  const m5 = performance.now();
  PERF.snapshot({ sim: m1 - m0, scene: m2 - m1, webgl: m3 - m2, badges: m4 - m3, panel: m5 - m4, total: m5 - m0 });
}
// standalone conversation window: no render loop (the scene is never drawn), only simulation and panel 2× per second
if (STANDALONE) setInterval(() => { if (document.hidden) return; tickWorld(0.5); panelTick(performance.now() / 1000); }, 500);
else {
  requestAnimationFrame(tick);
  setInterval(() => { // Workroom: only simulation (agent states) and panel, nothing is drawn
    if (!workroom || document.hidden) return;
    const m0 = performance.now(), dt = Math.min(clock.getDelta(), 3); tickWorld(dt); const m1 = performance.now(); panelTick(clock.elapsedTime); const m2 = performance.now();
    PERF.snapshot({ sim: m1 - m0, scene: 0, webgl: 0, badges: 0, panel: m2 - m1, total: m2 - m0 });
  }, 500);
  addEventListener('city-workroom', () => {
    if (workroom) { renderer.info.reset(); return; } // measurement in the Workroom shows 0 draw calls
    lastCamera = ''; lastBadges = null; lastScene = null; lastChange = performance.now(); // nameplates, shadows and a few smooth frames anew
    renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight);
    if (!loop) requestAnimationFrame(tick);
  });
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight);
  for (const sc of [city, active]) { if (!sc) continue; const c = sc.camera, asp = innerWidth / innerHeight; if (c.isOrthographicCamera) { const d = (c.top - c.bottom) / 2; c.left = -d * asp; c.right = d * asp; } else c.aspect = asp; c.updateProjectionMatrix(); }
});
