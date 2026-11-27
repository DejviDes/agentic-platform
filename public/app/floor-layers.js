// floor-layers.js – Scene 2 in "Layers" mode (design v23, 2026-11-18): office as a micro-city of the floor.
// White board with a belt of the building color, lead in the middle (discs = plan steps, otherwise a single disc), real floor team
// (WORLD.poschodia.get(n).agenti) in a circle rotated by 22.5°, agent column in its own color (height = conversations with them today),
// the top carries the state, flows working → lead and lead → Brain, gray houses around. Above the agent a card with Chat and Task.
// buildFloorLayers(n) returns the same object as buildFloor(n) in floor.js (pick → agent index), navigation.js selects.
// Figures, walking and furniture are not drawn here. Cost: about 60 to 120 draw calls depending on team size, CSS2D cards.
import * as THREE from 'three';
import { selectedAgent } from './state.js';
import { esc } from './utils.js';
import { t as _t } from './i18n.js';
import { BUILDINGS } from './demo-data.js';
import { WORLD } from './world.js';
import { css2d, mouse, ray } from './scene-base.js';
import { refreshTeam, selectAgent } from './panel.js';
import { newConvWith } from './conversations.js';
import { floorId, CONV_STORE, isReal } from './api.js';
import { agentIcon } from './icons.js';
import { rotationEnabled, rotationSpeed } from './city-layers.js';
import { CONTROL_CENTER_C, BRAIN_C, OK, mix, agentPalette, rigCamera, rng, pool, sceneLayers, agentState, darken, boardHeight } from './layers-kit.js';

const STATUS_AG = { get work() { return _t('app.floor.status.work'); }, get delegates() { return _t('app.floor.status.delegates'); }, get pending() { return _t('app.floor.status.pending'); }, get done() { return _t('app.floor.status.done'); } };

export function buildFloorLayers(n) {
  const P = WORLD.floors.get(n), Bd = BUILDINGS.find((b) => b.title === P.building);
  const color = Bd?.controlCenter ? CONTROL_CENTER_C : Bd?.key === 'brain' ? BRAIN_C : Bd?.color || '#8a6cff';
  const team = P.agents.slice(1), count = team.length;
  const R = count <= 2 ? 3.6 : count <= 4 ? 4.4 : count <= 6 ? 5 : 5.6, SD = 2 * R + 5;
  const S = pool(), scene = sceneLayers(SD / 2 + 10);
  const g = new THREE.Group(); scene.add(g);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const palette = agentPalette(color), colorAg = (i) => (i === 0 ? color : palette[(i - 1) % palette.length]);

  // ---------- floor board, paths, areas under agents, Brain in the corner, surroundings ----------
  S.mesh(g, S.boxG(SD, 0.42, SD), S.mat('#fbfaf6'), 0, -0.21, 0, { shadow: false });
  S.mesh(g, S.boxG(SD, 0.14, SD), S.mat(color), 0, -0.49, 0, { edge: null, shadow: false });
  S.mesh(g, S.cylG(R + 1.2, 0.02), S.mat(mix(color, 0.93)), 0, 0.01, 0, { edge: null, shadow: false });
  const position = team.map((_, i) => { const u = Math.PI / 8 + (i * 2 * Math.PI) / Math.max(count, 1); return [Math.cos(u) * R, Math.sin(u) * R]; });
  position.forEach(([x, z]) => S.path(g, [0, 0], [x, z], 0.4, '#ebe8e0'));
  team.forEach((_, i) => S.mesh(g, S.boxG(2.1, 0.03, 2.1), S.mat(mix(colorAg(i + 1), 0.86)), position[i][0], 0.02, position[i][1], { edge: null, shadow: false }));
  const mz = V3(SD / 2 + 1.6, 1.3, -SD / 2 + 1.4);
  S.mesh(g, S.cylG(0.85, 0.3), S.mat(mix(BRAIN_C, 0.5)), mz.x, 0.7, mz.z); S.mesh(g, S.cylG(0.75, 0.3), S.mat(BRAIN_C), mz.x, 1.15, mz.z);
  { const [el, o] = css2d(`<div class="ln"></div><div class="tx"><div class="n"><i style="background:${BRAIN_C}"></i>${_t('app.floor.brain')}</div><div class="sub">${_t('app.floor.writesNotes')}</div></div>`, 'vrLabel small'); el.style.setProperty('--dy', '16px'); o.position.set(mz.x, 1.3, mz.z); g.add(o); }
  surroundings();

  // ---------- agent cards (CSS2D): icon, name, state; on hover Chat and Task ----------
  let cardHover = null;
  const cards = P.agents.map((a, i) => {
    const [el, o] = css2d('', 'vrAg' + (i === 0 ? ' lead' : '')); g.add(o);
    el.addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('[data-action]'); if (b?.dataset.action === 'task') task(i); else selectAgent(i); });
    el.addEventListener('mouseenter', () => { cardHover = i; });
    el.addEventListener('mouseleave', () => { if (cardHover === i) cardHover = null; });
    return { el, o, html: '' };
  });
  // Chat = the same as a click on the figure (selectAgent → openAgent in conversations.js); Task = new conversation with the agent in the panel
  function task(i) {
    const a = P.agents[i]; if (!a) return;
    if (isReal()) { newConvWith(a.k || 'lead'); refreshTeam(); }
    else { selectAgent(i); setTimeout(() => document.getElementById('agText')?.focus(), 0); }
  }

  // ---------- states: columns, lead discs and flows are rebuilt when the state, plan or number of conversations changes ----------
  const dyn = new THREE.Group(); g.add(dyn);
  let hits = [], flows = [], pulses = [], sig = '', states = [];
  function detectStates() {
    const pid = floorId(n), from = new Date().setHours(0, 0, 0, 0), counts = new Map(), real = isReal() && pid;
    if (real) { for (const k of CONV_STORE.conv.values()) if (k.floor === pid && !k.hidden && (k.changed || k.created || 0) >= from) counts.set(k.agent || 'lead', (counts.get(k.agent || 'lead') || 0) + 1); }
    else for (const u of WORLD.tasks) if (u.p === n) counts.set(u.a, (counts.get(u.a) || 0) + 1);
    return P.agents.map((a, i) => {
      const s = agentState(a.status), conv = (real ? counts.get(i === 0 ? 'lead' : a.k) : counts.get(i)) || 0, u = a.task;
      const plan = s !== 'i' && u?.plan?.n ? { h: Math.min(u.plan.h, 7), n: Math.min(u.plan.n, 8) } : null;
      return { s, conv, vys: Math.max(1, Math.min(7, conv)), plan, status: a.status, step: plan ? u.step || '' : '' };
    });
  }
  function buildDyn() {
    for (const f of flows) f.cancel(); flows = [];
    for (const p of pulses) S.cancelPulse(p); pulses = [];
    dyn.clear(); hits = [];
    const V = states[0];
    const steps = V.plan ? Array.from({ length: V.plan.n }, (_, j) => (j < V.plan.h ? 'd' : j === V.plan.h ? (V.s === 'c' ? 'c' : 'w') : 'n')) : [V.s === 'i' ? 'd' : V.s];
    steps.forEach((s, j) => { const r = j % 2 ? 1.15 : 1.3; S.shape(dyn, { type: 'disc', x: 0, z: 0, r, c: color }, s, boardHeight(j) - 0.4, { agent: 0 }, hits); if (s === 'w') pulses.push(S.pulse(dyn, 0, boardHeight(j) + 0.12, 0, r, OK)); });
    const topIn = boardHeight(steps.length - 1) + 0.1;
    cards[0].o.position.set(0, topIn + 0.05, 0);
    team.forEach((a, i) => {
      const st = states[i + 1], [x, z] = position[i], c = colorAg(i + 1);
      for (let j = 0; j < st.vys; j++) {
        const s = j === st.vys - 1 && st.s !== 'i' ? st.s : 'd', ins = j % 2 ? 0.08 : 0;
        S.shape(dyn, { type: 'box', x: x - 0.7 + ins, z: z - 0.7 + ins, w: 1.4 - 2 * ins, d: 1.4 - 2 * ins, c }, s, boardHeight(j) - 0.4, { agent: i + 1 }, hits);
      }
      const top = boardHeight(st.vys - 1) + 0.1;
      cards[i + 1].o.position.set(x, top + 0.05, z);
      if (st.s === 'w') flows.push(S.flow(dyn, V3(x, top, z), V3(0, topIn, 0), c, 1.6));
    });
    if (V.s === 'w') flows.push(S.flow(dyn, V3(0, topIn, 0), mz.clone(), BRAIN_C, 2));
    hlKey = '';
  }
  function drawCards() {
    P.agents.forEach((a, i) => {
      const st = states[i], c = colorAg(i), dot = st.s === 'w' ? OK : st.s === 'c' ? c : '#cfccc3';
      const txt = st.plan ? _t('app.floor.step', { h: st.plan.h + 1, n: st.plan.n }) : STATUS_AG[a.status] || (i === 0 ? _t('app.floor.lead') : _t('app.floor.free')); // the full step text is in the card's title
      const today = st.conv ? ` · ${_t('app.floor.today', { n: st.conv })}` : '';
      const html = `<div class="ln"></div><div class="kk"><div class="av" style="background:${mix(c, 0.82)};color:${darken(c, 0.2)}">${agentIcon(a)}</div>`
        + `<div class="tx"><b>${esc(a.name)}</b><span><i style="background:${dot}"></i>${esc(txt)}${today}</span></div>`
        + `<div class="ak"><button data-action="chat" title="${esc(_t('app.floor.chatTitle'))}">${_t('app.floor.chat')}</button><button data-action="task" title="${esc(_t('app.floor.taskTitle'))}">${_t('app.floor.task')}</button></div></div>`;
      const tip = [a.role, st.step && `${_t('app.floor.step', { h: st.plan.h + 1, n: st.plan.n })}: ${st.step}`].filter(Boolean).join('\n');
      const K = cards[i]; if (K.html !== html) { K.html = html; K.el.innerHTML = html; } if (K.tip !== tip) { K.tip = tip; K.el.title = tip; }
    });
  }
  // highlight: selected agent, card under the mouse or column under the mouse
  let hlKey = '';
  function highlight(hover) {
    const h = cardHover ?? (typeof hover === 'number' ? hover : null), kl = `${selectedAgent}|${h}`;
    if (kl === hlKey) return; hlKey = kl;
    for (const m of hits) S.highlight(m, m.userData.agent === h || m.userData.agent === selectedAgent);
    cards.forEach((K, i) => K.el.classList.toggle('hl', i === selectedAgent || i === h));
  }

  // ---------- camera ----------
  const K = rigCamera({ size: 6 + R * 0.85, target: V3(0, 1.4, 0), leftPanel: true }), camera = K.camera;
  scene.add(camera);
  const controls = K.controls();
  // rotation like the city (⋯ Rotate city and speed, 2026-11-18): stops when the mouse hovers over an agent or card and while dragging
  let rotate = rotationEnabled(), speed = rotationSpeed()[1];
  const onRotation = () => { rotate = rotationEnabled(); speed = rotationSpeed()[1]; };
  addEventListener('city-rotation', onRotation);
  const vis = P.agents.map((a) => ({ a, el: document.createElement('div') })); // panel.js refreshTeam writes figure labels into v.el; here the cards draw them
  let last = -1;
  states = detectStates(); sig = JSON.stringify(states); buildDyn(); drawCards();

  return {
    kind: 'floor', layers: true, n, scene, camera, controls, vis, badgesChange: false,
    pick(e) { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera); return ray.intersectObjects(hits, false)[0]?.object.userData.agent ?? null; },
    update(dt, t, hover) {
      if (rotate && hover == null && cardHover == null && !K.rig.turn) K.rig.tUntil += dt * speed;
      this.badgesChange = K.cam(dt, t);
      if (t - last > 0.35) {
        last = t; states = detectStates(); const s = JSON.stringify(states);
        if (s !== sig) { sig = s; buildDyn(); }
        drawCards();
      }
      highlight(hover);
      for (const f of flows) S.shiftFlow(f, t);
      S.animatePulse(t);
    },
    dispose() {
      removeEventListener('city-rotation', onRotation); controls.dispose(); for (const f of flows) f.cancel(); for (const p of pulses) S.cancelPulse(p);
      scene.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    },
  };

  // surroundings of the office: gray houses around the board and small huts in the corners of the board (backdrop, two InstancedMesh)
  function surroundings() {
    const r = rng(SD * 31), out = [], inside = [], h2 = SD / 2;
    for (let x = -h2 - 8; x <= h2 + 8; x += 1.05) for (let z = -h2 - 8; z <= h2 + 8; z += 1.05) {
      const jx = x + (r() - 0.5) * 0.25, jz = z + (r() - 0.5) * 0.25, m = Math.max(Math.abs(jx), Math.abs(jz)) - h2;
      if (m < 0.9 || Math.hypot(jx, jz) > h2 + 9 || r() < 0.2 + Math.max(0, m - 4) * 0.14) continue;
      if (Math.hypot(jx - mz.x, jz - mz.z) < 2) continue;
      out.push([jx, jz, 0.38 + r() * 0.34, 0.38 + r() * 0.34, 0.12 + r() * r() * 0.55]);
    }
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const k = 3 + Math.floor(r() * 3);
      for (let i = 0; i < k; i++) {
        const x = sx * (h2 - 0.7 - r() * 1.4), z = sz * (h2 - 0.7 - r() * 1.4);
        if (Math.hypot(x, z) < R + 1.6 || inside.some(([a, b]) => Math.hypot(a - x, b - z) < 0.55)) continue;
        inside.push([x, z, 0.3 + r() * 0.25, 0.3 + r() * 0.25, 0.12 + r() * 0.35]);
      }
    }
    S.houses(g, out); S.houses(g, inside);
  }
}
