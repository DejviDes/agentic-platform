// city-layers.js – Scene 1 in "Layers" mode (design v23, approved 2026-11-18): city made of boards. Floor = board,
// Three buildings from the world (by order) are towers in the building's color, Brain discs, Center hexagons, Home small buildings in front on the left,
// gray houses around as scenery. States from WORLD: working = full color + white band, waiting for you = full color, darker band
// and a slow pulse, quiet = light shade. Flows from working floors to the Brain.
// buildCityLayers() returns the same object as buildCity() in city.js (pick returns the same ids), navigation.js chooses by
// the "Original city" toggle (localStorage agentic-original-city). No day and night colors, orthographic camera (layers-kit.js).
// Cost: about 150 draw calls in the city (boards, edges, plots, 1 InstancedMesh of houses, flows by 4), CSS2D labels.
import * as THREE from 'three';
import { setState, DISTRICT } from './state.js';
import { esc } from './utils.js';
import { BUILDINGS, HOME_BUILDINGS, HOME_TEAM, BRAIN_COUNT } from './demo-data.js';
import { WORLD } from './world.js';
import { t as _t, tn as _tn } from './i18n.js';
import { css2d, mouse, ray } from './scene-base.js';
import { enterFloor } from './navigation.js';
import { controlCenterBadge, titleControlCenter } from './control-center.js';
import { ico } from './icons.js';
import { CONV_STORE } from './api.js';
import { M } from './modules.js';
import { CONTROL_CENTER_C, HOME_C, BRAIN_C, mix, plural, rigCamera, rng, pool, sceneLayers, boardHeight } from './layers-kit.js';

// layout from prototype v23: low (Brain, Center) in the middle, tall towers at the edge, Home in front on the left
const CENTER = 13, CENTER_FROM = 14.2, BRAIN_XZ = [13, 12.5];
// roads from the Brain (end of the road) by tower slot; Home and Center have their own
const PATH_SLOT = [[5.5, 14], [11.5, 5], [21, 6.5], [20.5, 14], [20.5, 22]], HOME_PATH = [9.5, 18.1], CONTROL_CENTER_PATH = [5.5, 8];
// key = tower slot (building order in the world, source.js) or 'brain' / 'centrala'
const POSITION = {
  0: { type: 'box', x: 3.7, z: 12, w: 3.6, d: 4 }, 1: { type: 'box', x: 9.5, z: 3.2, w: 4, d: 3.6 }, 2: { type: 'box', x: 19.3, z: 4.8, w: 3.4, d: 3.4 },
  3: { type: 'box', x: 18.7, z: 12, w: 3.6, d: 4 }, 4: { type: 'box', x: 18.7, z: 19.5, w: 3.6, d: 4 }, // 4th and 5th building (right edge)
  brain: { type: 'disc', x: 13, z: 12.5, r: 2.4 }, 'control-center': { type: 'hex', x: 5.5, z: 8, r: 2.15 }, // key = b.key from source.js
};
// Home buildings: [x, z, width, depth, number of boards] (shift +3.6 / +1.5 as in the prototype)
const HOME_POSITION = {
  sorting: [2, 17.2, 1.8, 1.8, 1], house: [4.6, 17.2, 2.2, 2, 2], tasks: [7.7, 17.4, 2, 1.6, 2], mail: [2.2, 20, 1.6, 1.6, 1], tower: [4.9, 20.2, 0.9, 0.9, 6],
  library: [6.6, 20.2, 2.4, 1.5, 2], garden: [2.4, 22.4, 2.2, 1.4, 1], playground: [6, 22.5, 2.4, 1.4, 1],
};
const CITY_SIZE = 13.5;
export const ROTATION_KEY = 'city-rotation';
export const rotationEnabled = () => { try { return localStorage.getItem(ROTATION_KEY) === '1'; } catch { return false; } };
// rotation speed (radians per second), in ⋯ it cycles slowly → medium → fast; medium = the original 0.21
export const SPEED_KEY = 'city-rotation-speed';
export const SPEEDS = [['slow', 0.09], ['medium', 0.21], ['fast', 0.45]];
export const rotationSpeed = () => { let k = 'medium'; try { k = localStorage.getItem(SPEED_KEY) || k; } catch {} return SPEEDS.find((r) => r[0] === k) || SPEEDS[1]; };
const STATUS_TEXT = { get w() { return _t('app.city.status.working'); }, get c() { return _t('app.city.status.pending'); }, i: '' };

export function buildCityLayers() {
  const S = pool(), scene = sceneLayers(26);
  const g = new THREE.Group(); g.position.set(-CENTER, 0, -CENTER_FROM); scene.add(g);
  const hits = [], floors = new Map(), floor = [], byId = new Map(), buildings = [], cards = [];
  const C = BUILDINGS.find((b) => b.controlCenter), CN = C?.floors[0].n;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), wp = (x, y, z) => V3(x - CENTER, y, z - CENTER_FROM);
  const centerB = (B) => (B.type === 'box' ? [B.x + B.w / 2, B.z + B.d / 2] : [B.x, B.z]);

  // ---------- buildings from real data ----------
  for (const b of BUILDINGS) { const P = POSITION[b.slot ?? b.key]; if (P) buildings.push({ ...P, b, key: b.key, title: b.title, c: b.controlCenter ? CONTROL_CENTER_C : b.key === 'brain' ? BRAIN_C : b.color, floor: [] }); }
  const home = HOME_BUILDINGS.filter((d) => HOME_POSITION[d.k]).map((d) => { const [x, z, w, dd, vis] = HOME_POSITION[d.k]; return { type: 'box', x: x + 3.6, z: z + 1.5, w, d: dd, vis, c: HOME_C, k: d.k, title: d.title, description: d.description, home: true, floor: [], s: 'i', sub: '' }; });

  // roads to the Brain: to towers by slot, then to Home and Center (order as before, so the gray houses stay in their places)
  const paths = [...buildings.filter((B) => B.b.slot != null).sort((x, y) => x.b.slot - y.b.slot).map((B) => PATH_SLOT[B.b.slot]), ...(home.length ? [HOME_PATH] : []), ...(C ? [CONTROL_CENTER_PATH] : [])];
  // plots, roads to the Brain, gray houses
  for (const B of buildings) {
    if (B.type === 'box') S.mesh(g, S.boxG(B.w + 1.4, 0.04, B.d + 1.4), S.mat(mix(B.c, 0.9)), B.x + B.w / 2, 0.02, B.z + B.d / 2, { edge: null, shadow: false });
    else S.mesh(g, S.cylG(B.r + 0.8, 0.04, B.type === 'hex' ? 6 : 64), S.mat(mix(B.c, 0.9)), B.x, 0.02, B.z, { edge: null, shadow: false });
  }
  if (home.length) S.mesh(g, S.boxG(9.2, 0.04, 7.8), S.mat(mix(HOME_C, 0.9)), 9.5, 0.02, 22, { edge: null, shadow: false });
  for (const [cx, cz] of paths) { S.path(g, BRAIN_XZ, [cx, BRAIN_XZ[1]], 0.34, '#e4e1d8'); S.path(g, [cx, BRAIN_XZ[1]], [cx, cz], 0.34, '#e4e1d8'); }
  S.houses(g, slotsHouses());

  // ---------- boards ----------
  const idFloor = (b, p) => (b.controlCenter && p.n === b.dispatch?.n ? '__dispatch' : p.n); // the Dispatch satellite was target '__dispecing' (main.js opens the chat)
  function addFloor(B, j, id, title) {
    const ins = B.type === 'box' && j % 2 && B.w > 1.2 ? 0.12 : 0;
    const t = B.type === 'box' ? { type: 'box', c: B.c, x: B.x + ins, z: B.z + ins, w: B.w - 2 * ins, d: B.d - 2 * ins } : { type: B.type, c: B.c, x: B.x, z: B.z, r: B.type === 'disc' && j % 2 ? B.r - 0.38 : B.r };
    const grp = new THREE.Group(); g.add(grp);
    const m = S.shape(grp, t, 'i', boardHeight(j), { id }, hits);
    const pa = { g: grp, m, B, j, id, title, t, y: boardHeight(j), off: 0, tOff: 0, extra: 0, s: 'i' };
    B.floor.push(pa); floor.push(pa); if (!byId.has(id)) byId.set(id, []); byId.get(id).push(pa); return pa;
  }
  for (const B of buildings) B.b.floors.forEach((p, j) => { const pa = addFloor(B, j, idFloor(B.b, p), p.n); floors.set(p.n, { building: B.b.title, p, g: pa.g, floor: pa, target: 0, slideOut: 0 }); });
  for (const D of home) for (let j = 0; j < D.vis; j++) addFloor(D, j, 'home:' + D.k, D.title);

  // ---------- labels ----------
  const badge = (x, y, z, dy, cls = '') => { const [el, o] = css2d('', 'vrLabel' + (cls ? ' ' + cls : '')); el.style.setProperty('--dy', dy + 'px'); o.position.set(x, y, z); g.add(o); return { el, o, html: '', tip: '' }; };
  const LABEL = new Map();
  for (const B of buildings) {
    const [cx, cz] = centerB(B), L = badge(cx, boardHeight(B.b.floors.length) - 0.3, cz, B.type === 'box' ? 24 : 30, 'click');
    L.el.onclick = (e) => { if (!e.target.closest('.tx')) return; enterFloor(buildingTarget(B)); };
    LABEL.set(B.key, L);
  }
  const labelHome = home.length ? badge(9.5, 2.4, 21.8, 54) : null; // without the Home module no district and no label for it
  for (const D of home) { const [cx, cz] = centerB(D); D.label = badge(cx, boardHeight(D.vis) - 0.2, cz, 14, 'small'); D.label.o.visible = false; }
  // cards above towers only in the Work view (as in city.js), click = floor where someone is waiting, otherwise the first
  for (const B of buildings) {
    if (B.b.pavilion) continue;
    const [cx, cz] = centerB(B), [el, obj] = css2d('', 'box stat'); obj.position.set(cx, boardHeight(B.b.floors.length) + 0.2, cz); g.add(obj); obj.visible = false;
    el.style.translate = `${[0, -30, 80, 150, -110][B.b.slot] || 0}px calc(-50% - 14px)`; // with the fixed Work view angle the cards don't overlap
    el.onclick = () => enterFloor(buildingTarget(B));
    cards.push({ el, obj, b: B.b });
  }
  function buildingTarget(B) { return B.b.floors.find((p) => WORLD.floors.get(p.n)?.agents.some((a) => a.status === 'pending'))?.n || B.b.floors[0].n; }
  // label by the board under the mouse
  const [plabEl, plab] = css2d('', 'vrPlab'); plabEl.style.display = 'none'; g.add(plab);

  // ---------- Home states: hooks of existing modules (each holds one function, the old city overwrites it on return) ----------
  const DS = { mail: 0, mailLive: false, library: 0, garden: '', tower: false, tasks: null };
  const Dk = (k) => home.find((d) => d.k === k);
  if (Dk('mail') && M.mail) M.mail.attachFlag(({ pending: pendingCount, live }) => { DS.mail = pendingCount || 0; DS.mailLive = !!live; });
  if (Dk('library')) M.home.attachLibraryBadge((n) => { DS.library = n || 0; });
  if (Dk('garden')) M.home.attachGardenBadge((t) => { DS.garden = t || ''; });
  if (Dk('tower')) M.home.attachMarker((on) => { DS.tower = !!on; });
  if (Dk('tasks')) M.home.attachBoard(({ total }) => { DS.tasks = total; });
  function homeStatus() {
    const chats = new Map(); // Home building chat (conversations domov/<k>): running = working, pending / reply = waiting for you
    for (const k of CONV_STORE.conv.values()) {
      if (k.hidden || !String(k.floor || '').startsWith('home/')) continue;
      const kk = k.floor.slice(5), s = k.status === 'pending' || (k.status === 'reply' && !k.parent) ? 'c' : k.status === 'running' ? 'w' : null;
      if (s && chats.get(kk) !== 'c') chats.set(kk, s);
    }
    const tr = M.home?.SORTING.data;
    for (const D of home) {
      let s = chats.get(D.k) || 'i', sub = '';
      if ((HOME_TEAM[D.k] || []).some((a) => M.home.houseAgentState(a) === 'work') && s !== 'c') s = 'w';
      if (D.k === 'sorting') { if (tr?.proposed?.status === 'pending-on-approval') { s = 'c'; sub = _t('app.city.house.proposalPending'); } else if (tr?.running) { if (s !== 'c') s = 'w'; sub = _t('app.city.house.sorts'); } }
      if (D.k === 'mail' && DS.mail > 0) { sub = _t('app.city.house.mailPending', { n: DS.mail }); if (DS.mailLive) s = 'c'; }
      if (D.k === 'library' && DS.library > 0) sub = _t('app.city.house.library', { n: DS.library });
      if (D.k === 'garden' && DS.garden) { sub = DS.garden; s = 'c'; }
      if (D.k === 'tower' && DS.tower) sub = _t('app.city.house.tower');
      if (D.k === 'tasks' && DS.tasks != null) sub = _tn('app.city.house.tasks', DS.tasks);
      D.s = s; D.sub = sub;
    }
  }
  // floor used today (2026-11-20): the last session from the server (def.posledna) is today, or someone worked / waited here today → full building color ('u')
  const today = { day: '', midnight: 0, n: new Set() };
  const usedToday = (n) => {
    const d = new Date(), day = d.toDateString();
    if (today.day !== day) { today.day = day; today.midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); today.n.clear(); }
    return today.n.has(n) || (WORLD.floors.get(n)?.def?.lastSeen || 0) >= today.midnight;
  };
  const floorState = (n) => {
    const ag = WORLD.floors.get(n)?.agents || [], s = ag.some((a) => a.status === 'pending') ? 'c' : ag.some((a) => a.status === 'work' || a.status === 'delegates') ? 'w' : 'i';
    if (s !== 'i') { usedToday(n); today.n.add(n); return s; }
    return usedToday(n) ? 'u' : 'i';
  };

  // ---------- flows to the Brain: from working floors (permanent) and on read / write (2.4 s, event 'brain') ----------
  const brainTarget = V3(BRAIN_XZ[0], boardHeight(0) + 0.5, BRAIN_XZ[1]), flows = new Map(), temporary = [];
  const fromFloor = (pa) => { const [cx, cz] = centerB(pa.B); return V3(cx, pa.y + 0.5, cz); };
  function refreshFlows() {
    const wants = new Set();
    for (const pa of floor) if (pa.s === 'w' && pa.B.type !== 'disc' && (!pa.B.home || pa.j === 0)) wants.add(pa);
    for (const [pa, f] of flows) if (!wants.has(pa)) { f.cancel(); flows.delete(pa); }
    for (const pa of wants) if (!flows.has(pa)) flows.set(pa, S.flow(g, fromFloor(pa), brainTarget, pa.B.c));
  }
  const listener = (type, d) => {
    if (type !== 'brain' || temporary.length >= 6) return;
    const pa = floors.get(d.n)?.floor; if (!pa || flows.has(pa) || pa.B.type === 'disc') return;
    temporary.push({ f: S.flow(g, fromFloor(pa), brainTarget, pa.B.c), end: performance.now() + 2400 });
  };
  WORLD.listen.add(listener);

  // ---------- refresh of states and labels (2.5× per second, DOM is written only on change) ----------
  const write = (L, html, tip = '') => { if (L.html !== html) { L.html = html; L.el.innerHTML = html; } if (L.tip !== tip) { L.tip = tip; L.el.title = tip; } };
  const labelHtml = (n, sub, color) => `<div class="ln"></div><div class="tx"><div class="n"><i style="background:${color}"></i>${esc(n)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
  function signature(B) {
    const st = B.floor.map((p) => p.s), w = st.filter((s) => s === 'w').length, c = st.filter((s) => s === 'c').length, n = st.length;
    return [B.type === 'disc' ? null : _tn('app.city.floors', n), w && _tn('app.city.working', w), c && _t('app.city.pending', { n: c })].filter(Boolean).join(' · ') || _t('app.city.quiet');
  }
  function refreshStates() {
    homeStatus();
    for (const pa of floor) {
      const s = pa.B.home ? (pa.j === 0 ? pa.B.s : 'i') : floorState(pa.title);
      if (s !== pa.s) { pa.s = s; S.setStatus(pa.m, s); }
    }
    refreshFlows();
    for (const B of buildings) {
      const L = LABEL.get(B.key);
      if (B.key === 'brain') { const p = WORLD.brain.last; write(L, labelHtml(_t('app.city.brain'), _t('app.city.notes', { n: BRAIN_COUNT }), B.c), `Second Brain · ${_t('app.city.notes', { n: BRAIN_COUNT })}${p ? `\n${_t(p.direction === 'write' ? 'app.city.brainWrote' : 'app.city.brainRead', { who: p.who })}` : ''}`); }
      else if (B.b.controlCenter) { const sf = controlCenterBadge(); write(L, labelHtml(_t('app.city.controlCenter'), [sf, signature(B) !== _t('app.city.quiet') ? signature(B) : null].filter(Boolean).join(' · '), B.c), titleControlCenter()); }
      else write(L, labelHtml(B.title, signature(B), B.c));
    }
    const dw = home.filter((d) => d.s === 'w').length, dc = home.filter((d) => d.s === 'c').length;
    if (labelHome) write(labelHome, labelHtml(_t('app.city.home'), [_tn('app.city.buildings', home.length), dw && _tn('app.city.working', dw), dc && _t('app.city.pending', { n: dc })].filter(Boolean).join(' · '), HOME_C));
    for (const D of home) write(D.label, labelHtml(D.title, D.sub || STATUS_TEXT[D.s], D.s === 'i' ? mix(HOME_C, 0.5) : HOME_C));
    if (hoverId) drawPlab(hoverId);
  }
  function refreshCards() {
    for (const { el, b } of cards) {
      const P = b.floors.map((p) => WORLD.floors.get(p.n)), agents = P.reduce((s, x) => s + (x?.agents.length || 0), 0);
      const ul = WORLD.tasks.filter((u) => b.floors.some((p) => p.n === u.p)), c = (st) => ul.filter((u) => u.column === st || (st === 'doing' && u.column === 'flies')).length, pending = c('pending');
      el.classList.toggle('alarm', pending > 0);
      const html = `<div class="h"><span class="point" style="background:${b.color}"></span><span class="mono" style="color:var(--ink)">${esc(b.title)}</span>${pending ? `<span class="mono" style="margin-left:auto;color:var(--err)">${ico('pending')} ${_t('app.city.pending', { n: pending })}</span>` : ''}</div>
        <div class="number">${agents}<small>${_t('app.city.card.agents')} · ${_tn('app.city.floors', b.floors.length)}</small></div>
        <div class="rows">${(b.rows || []).map(([k, v]) => `<div class="r"><span>${esc(k)}</span>${esc(v)}</div>`).join('')}</div>
        <div class="states">${_t('app.city.card.doing')}<b>${c('doing')}</b> ${_t('app.city.card.rad')}<b>${c('rad')}</b> ${_t('app.city.card.done')}<b>${c('done')}</b></div>`;
      if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; }
    }
  }

  // ---------- hover: boards above the floor lift, itself a bit, outline, label beside ----------
  let hoverId = null;
  function setHover(id) {
    hoverId = id; const L = id ? byId.get(id) : null, hB = L?.[0].B, hj = L?.[0].j;
    for (const pa of floor) {
      const that = !!hB && pa.B === hB, isOn = that && (pa.B.home || pa.j === hj);
      pa.tOff = !that ? 0 : pa.B.home ? 0.14 : pa.j === hj ? 0.14 : pa.j > hj ? 0.42 : 0;
      pa.m.scale.set(isOn ? 1.05 : 1, 1, isOn ? 1.05 : 1);
      if (!!pa.m.userData.hl !== isOn) S.highlight(pa.m, isOn);
    }
    for (const B of buildings) LABEL.get(B.key).el.classList.toggle('hide', B === hB);
    labelHome?.el.classList.toggle('hide', !!hB?.home);
    for (const D of home) D.label.el.classList.toggle('hide', D === hB);
    if (id) drawPlab(id); else plabEl.style.display = 'none';
  }
  function drawPlab(id) {
    const pa = byId.get(id)?.[0]; if (!pa) return;
    let n = pa.title, info, color, action = _t('app.city.open');
    if (pa.B.home) {
      const D = pa.B; color = D.s === 'i' ? mix(HOME_C, 0.5) : HOME_C;
      info = [STATUS_TEXT[D.s], D.sub && D.sub !== STATUS_TEXT[D.s] ? D.sub : null, D.description];
      if (HOME_TEAM[D.k]) action = _t('app.city.clickDoubleClick');
    } else {
      const P = WORLD.floors.get(pa.title), team = (P?.agents.length || 1) - 1, ul = WORLD.tasks.filter((u) => u.p === pa.title);
      const doing = ul.filter((u) => u.column === 'doing' || u.column === 'flies').length, rad = ul.filter((u) => u.column === 'rad').length;
      color = pa.s === 'i' ? mix(pa.B.c, 0.5) : pa.B.c;
      info = id === '__dispatch' ? [STATUS_TEXT[pa.s], _t('app.city.dispatcherChat')] : [STATUS_TEXT[pa.s], team ? _t('app.city.vTime', { n: team }) : _t('app.city.onlyLead'), doing && _t('app.city.doing', { n: doing }), rad && _t('app.city.onRow', { n: rad })];
      if (id === '__dispatch') n = _t('app.city.dispatch');
    }
    const html = `<div class="pl"></div><div class="pb"><i style="background:${color}"></i><b>${esc(n)}</b><span>${esc(info.filter(Boolean).join(' · '))}</span><em>${action}</em></div>`;
    if (plabEl.dataset.h !== html) { plabEl.dataset.h = html; plabEl.innerHTML = html; }
    plabEl.style.display = '';
  }
  const _v = new THREE.Vector3(), _r = new THREE.Vector3();
  function locationPlab() {
    const L = byId.get(hoverId); if (!L) return;
    const q = L[L.length - 1], t = q.t, y = q.y + q.off + q.extra + 0.25;
    const corner = (direction) => {
      _r.set(Math.cos(K.rig.until), 0, -Math.sin(K.rig.until)).multiplyScalar(direction);
      if (t.type !== 'box') return _v.set(t.x, y, t.z).addScaledVector(_r, t.r).clone();
      let best = null, bd = -Infinity;
      for (const [x, z] of [[t.x, t.z], [t.x + t.w, t.z], [t.x, t.z + t.d], [t.x + t.w, t.z + t.d]]) { const d = x * _r.x + z * _r.z; if (d > bd) { bd = d; best = V3(x, y, z); } }
      return best;
    };
    let p = corner(1); const s = p.clone().add(g.position).project(camera), sx = ((s.x + 1) / 2) * innerWidth;
    const left = sx > innerWidth - K.rig.R - 320;
    if (left) p = corner(-1);
    plab.position.copy(p); plabEl.classList.toggle('left', left);
  }

  // ---------- camera and views ----------
  const K = rigCamera({ size: CITY_SIZE, target: V3(0, 2, 0) }), camera = K.camera;
  scene.add(camera);
  const point = (id) => { const L = byId.get(id); if (!L) return null; const q = L[L.length - 1], [cx, cz] = centerB(q.B); return wp(cx, q.y + 0.3, cz); };
  const tower = buildings.filter((B) => !B.b.pavilion).map(centerB), vx = tower.reduce((s, v) => s + v[0], 0) / (tower.length || 1), vz = tower.reduce((s, v) => s + v[1], 0) / (tower.length || 1);
  const VIEWS = { city: { t: V3(0, 2, 0), z: 1 }, work: { t: wp((vx || CENTER) + 2.5, 5, (vz || CENTER_FROM) - 2.5), z: 0.85, until: true }, home: { t: wp(9.5, 1, 22), z: 1.9 } };
  let controls = null, rotate = rotationEnabled(), speed = rotationSpeed()[1];
  const onRotation = () => { rotate = rotationEnabled(); speed = rotationSpeed()[1]; };
  addEventListener('city-rotation', onRotation);
  function pill(on) {
    let el = document.getElementById('vrControls');
    if (!el && on) {
      el = document.createElement('div'); el.id = 'vrControls'; el.className = 'box';
      el.innerHTML = `<button data-o="-1" title="${esc(_t('app.city.rotateLeft'))}" aria-label="${esc(_t('app.city.rotateLeftAria'))}">‹</button><button data-o="1" title="${esc(_t('app.city.rotateRight'))}" aria-label="${esc(_t('app.city.rotateRightAria'))}">›</button>`;
      document.body.appendChild(el);
    }
    if (!el) return;
    el.onclick = (e) => { const b = e.target.closest('[data-o]'); if (b) K.rotate(+b.dataset.o); };
    el.hidden = !on;
  }
  const newControls = () => {
    const c = K.controls(), d = c.dispose;
    c.dispose = () => { d(); pill(false); };
    controls = c; pill(true); if (hoverId) setHover(null); setState({ hover: null }); return c; // return from a floor: neither the label nor lifted boards stay hanging
  };
  newControls();
  let lastStatus = -1, lastCards = -1;

  return {
    kind: 'city', layers: true, scene, camera, floors, get controls() { return controls; }, newControls, point,
    badgesChange: false, // main.js: redraw labels even without camera movement (boards are being lifted right now)
    controlCenterView: CN ? { t: point(CN), p: V3(0, 0, 0) } : null, // ?controlCenter in the address (main.js) flies here
    universalView: byId.has('Univerzál') ? { t: point('Univerzál'), p: V3(0, 0, 0) } : null,
    flyOn(target, position, zoom) { if (target) K.rig.tTarget.copy(target); K.rig.tZoom = zoom ?? 1.7; }, // position is not used in the orthographic view, only the target and zoom
    district(r) { const v = VIEWS[r] || VIEWS.city; this.flyOn(v.t.clone(), null, v.z); if (v.until) K.orient(); }, // Work: fixed angle, cards above towers side by side
    pick(e) { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera); return ray.intersectObjects(hits, false)[0]?.object.userData.id || null; },
    update(dt, t, hover) {
      if (rotate && !hover && !K.rig.turn && controls && DISTRICT !== 'work') K.rig.tUntil += dt * speed; // rotation per the setting, stops when the mouse is over a building
      const dest = K.cam(dt, t);
      if (hover !== hoverId && (hover == null || byId.has(hover))) setHover(hover ?? null);
      // floor slide-out on entry (navigation.js sets target = 2.6): the floor and the boards above it lift
      for (const pa of floor) pa.extra = 0;
      let motion = false;
      for (const x of floors.values()) {
        if (!x.target && x.slideOut < 0.001) { x.slideOut = 0; continue; }
        x.slideOut += (x.target - x.slideOut) * Math.min(1, dt * 7); motion = true;
        for (const pa of x.floor.B.floor) pa.extra += pa.j > x.floor.j ? x.slideOut * 0.3 : pa.j === x.floor.j ? x.slideOut * 0.12 : 0;
      }
      const k = Math.min(1, dt * 12);
      for (const pa of floor) { const d = pa.tOff - pa.off; if (Math.abs(d) > 0.002) { pa.off += d * k; motion = true; } else pa.off = pa.tOff; pa.g.position.y = pa.off + pa.extra; }
      this.badgesChange = motion || dest;
      if (hoverId) locationPlab();
      if (t - lastStatus > 0.4) { lastStatus = t; refreshStates(); }
      const work = DISTRICT === 'work', inHome = DISTRICT === 'home';
      for (const kk of cards) if (kk.obj.visible !== work) kk.obj.visible = work;
      if (work && t - lastCards > 0.5) { lastCards = t; refreshCards(); }
      for (const B of buildings) { const o = LABEL.get(B.key).o, v = !(work && !B.b.pavilion); if (o.visible !== v) o.visible = v; }
      if (labelHome && labelHome.o.visible === inHome) labelHome.o.visible = !inHome;
      for (const D of home) if (D.label.o.visible !== inHome) D.label.o.visible = inHome;
      for (const f of flows.values()) S.shiftFlow(f, t);
      const now = performance.now();
      for (let i = temporary.length - 1; i >= 0; i--) { const x = temporary[i]; if (now > x.end) { x.f.cancel(); temporary.splice(i, 1); } else S.shiftFlow(x.f, t); }
      S.animatePulse(t);
    },
    dispose() {
      WORLD.listen.delete(listener); removeEventListener('city-rotation', onRotation); controls?.dispose();
      for (const f of flows.values()) f.cancel(); flows.clear(); for (const x of temporary) x.f.cancel(); temporary.length = 0;
      const el = document.getElementById('vrControls'); if (el) el.hidden = true;
    },
  };

  // gray houses around the city: grid with random offset, outside plots, Home and roads (only scenery, not clickable)
  function slotsHouses() {
    const r = rng(2026), slots = [], BUILDING = buildings;
    const seg = []; for (const [cx, cz] of paths) { seg.push([BRAIN_XZ, [cx, BRAIN_XZ[1]]]); seg.push([[cx, BRAIN_XZ[1]], [cx, cz]]); }
    const banned = (x, z) => {
      for (const b of BUILDING) {
        if (b.type === 'box') { if (x > b.x - 1.7 && x < b.x + b.w + 1.7 && z > b.z - 1.7 && z < b.z + b.d + 1.7) return true; }
        else if (Math.hypot(x - b.x, z - b.z) < b.r + 1.9) return true;
      }
      if (home.length && x > 4.4 && x < 14.6 && z > 17.6 && z < 26.4) return true; // Home
      for (const [a, b] of seg) {
        const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L));
        if (Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < 1.1) return true;
      }
      return false;
    };
    for (let x = -6; x <= 32; x += 1.55) for (let z = -5; z <= 33; z += 1.55) {
      const jx = x + (r() - 0.5) * 0.35, jz = z + (r() - 0.5) * 0.35, dist = Math.hypot(jx - CENTER, jz - CENTER_FROM);
      if (dist > 19.5 || r() < 0.18 + Math.max(0, dist - 15) * 0.16) continue;
      if (banned(jx, jz)) continue;
      const w = 0.6 + r() * 0.55, d = 0.6 + r() * 0.55, h = 0.22 + r() * r() * (dist < 12 ? 1.1 : 0.75);
      slots.push([jx, jz, w, d, h]);
    }
    return slots;
  }
}
