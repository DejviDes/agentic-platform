// layers-kit.js – Shared parts of the "Layers" mode (design v23, 2026-11-18) for city-layers.js and floor-layers.js:
// colors, materials and geometries with a cache per scene, a floor as a slab (shape), flows into the Brain,
// gray little houses as a backdrop (InstancedMesh) and an orthographic camera that rotates only around the vertical axis.
// Only declarations at module top level (modules are imported in a cycle). Materials are without tone mapping so the colors match the prototype.
import * as THREE from 'three';
import { hover, setState, workroom } from './state.js';
import { renderer } from './scene-base.js';

// ---------- colors and helpers ----------
export const OK = '#1f9d6b', BRAIN_C = '#2bb68a', CONTROL_CENTER_C = '#3a3a3a', HOME_C = '#e0739a';
export const AGC = ['#3f73e0', '#e0603f', '#8a63d2', '#2a9fb0', '#d4589a', '#d39b22', '#2f9e5a', '#b4532a', '#5b6bd6', '#0f8f8a'];
export const HOUSE_COLORS = ['#e9e6df', '#e3e0d8', '#eeebe5', '#dedad1'];
export const mix = (h, t) => { const n = parseInt(h.slice(1), 16); const f = (v) => Math.round(v + (255 - v) * t); return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join(''); };
export const darken = (h, t) => { const n = parseInt(h.slice(1), 16); const f = (v) => Math.round(v * (1 - t)); return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join(''); };
export const boardHeight = (k) => 0.5 + k * 0.85; // height of the k-th slab
export const plural = (n, a, b, c) => (n === 1 ? a : n >= 2 && n <= 4 ? b : c);
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// teammate colors: far enough from the building color so the pillar stands out from the slab
export function agentPalette(buildingColor) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const dist = (x, y) => Math.hypot(...rgb(x).map((v, i) => v - rgb(y)[i]));
  const p = AGC.filter((c) => dist(c, buildingColor) > 95);
  return p.length ? p : AGC;
}
// agent state in WORLD → slab state: w working, c waiting for you, i quiet
export const agentState = (s) => (s === 'work' || s === 'delegates' ? 'w' : s === 'pending' ? 'c' : 'i');

// ---------- materials, geometries and slabs (cache per scene) ----------
export function pool() {
  const mats = new Map(), geos = new Map(), egeos = new Map(), pending = new Map(), edgeMats = new Map(), pulses = [];
  const mat = (hex, o = {}) => { const k = hex + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color: hex, toneMapped: false, ...o })); return mats.get(k); };
  const basic = (hex, o = {}) => { const k = 'B' + hex + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshBasicMaterial({ color: hex, toneMapped: false, ...o })); return mats.get(k); };
  const boxG = (w, h, d) => { w = +w.toFixed(3); h = +h.toFixed(3); d = +d.toFixed(3); const k = `b${w}|${h}|${d}`; if (!geos.has(k)) geos.set(k, new THREE.BoxGeometry(w, h, d)); return geos.get(k); };
  const cylG = (r, h, seg = 64) => { r = +r.toFixed(3); const k = `c${r}|${h}|${seg}`; if (!geos.has(k)) geos.set(k, new THREE.CylinderGeometry(r, r, h, seg)); return geos.get(k); };
  const edges = (g) => { if (!egeos.has(g)) egeos.set(g, new THREE.EdgesGeometry(g, 30)); return egeos.get(g); };
  const lineMat = (opacity) => new THREE.LineBasicMaterial({ color: 0x151515, transparent: true, opacity: opacity, toneMapped: false });
  const EDGE = lineMat(0.15), EDGE_G = lineMat(0.1), EDGE_H = lineMat(0.9);
  const edgeColors = (c) => { if (!edgeMats.has(c)) edgeMats.set(c, new THREE.LineBasicMaterial({ color: darken(c, 0.35), toneMapped: false })); return edgeMats.get(c); };
  // waiting for you: full building color that slowly pulses (one material per color, pulse in animatePulse)
  const matPending = (c) => { if (!pending.has(c)) pending.set(c, new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0, toneMapped: false })); return pending.get(c); };
  const colorStatus = (c, s) => (s === 'w' || s === 'u' ? mat(c) : s === 'c' ? matPending(c) : s === 'd' ? mat(mix(c, 0.42)) : s === 'n' ? mat(mix(c, 0.8), { transparent: true, opacity: 0.32 }) : mat(mix(c, 0.7)));
  const edgeStatus = (s, c) => (s === 'c' ? edgeColors(c) : s === 'n' ? EDGE_G : EDGE);
  function mesh(parent, geo, m, x, y, z, { edge = EDGE, shadow = true, hit = null, hits = null } = {}) {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true;
    if (edge) { const e = new THREE.LineSegments(edges(geo), edge); e.userData.edge = true; o.add(e); }
    if (hit) { Object.assign(o.userData, hit); hits.push(o); }
    parent.add(o); return o;
  }
  // floor slab: box, disk or hexagon; u = used today (full building color, 2026-11-20); band: white blinking = working, darker building color = waiting for you
  // t: { type, x, z, w, d | r, c }, y: bottom of the slab. Both bands are prepared, setStatus only toggles them (the state changes at runtime).
  function shape(parent, t, s, y, hit, hits) {
    const h = 0.5, box = t.type === 'box', seg = t.type === 'hex' ? 6 : 64;
    const geo = box ? boxG(t.w, h, t.d) : cylG(t.r, h, seg);
    const o = mesh(parent, geo, mat('#ffffff'), box ? t.x + t.w / 2 : t.x, y + h / 2, box ? t.z + t.d / 2 : t.z, { edge: null, hit, hits });
    const e = new THREE.LineSegments(edges(geo), EDGE); e.userData.edge = true; o.add(e);
    const pass = (vys, m) => { const p = new THREE.Mesh(box ? boxG(t.w + 0.04, vys, t.d + 0.04) : cylG(t.r + 0.02, vys, seg), m); p.visible = false; o.add(p); return p; };
    o.userData.shape = { t, e, passW: pass(0.07, basic('#ffffff', { transparent: true })), passC: pass(0.12, basic(darken(t.c, 0.3))), s: null, disk: !box && t.type !== 'hex' };
    setStatus(o, s);
    return o;
  }
  function setStatus(o, s) {
    const T = o.userData.shape; if (T.s === s) return; T.s = s;
    o.material = colorStatus(T.t.c, s);
    T.e.material = edgeStatus(s, T.t.c); T.e.visible = !T.disk || s === 'n' || s === 'c';
    T.passW.visible = s === 'w'; T.passC.visible = s === 'c';
    if (o.userData.hl) highlight(o, true);
  }
  // outline on mouse hover (a disk does not have one otherwise)
  function highlight(o, on) {
    const T = o.userData.shape; o.userData.hl = on;
    T.e.material = on ? EDGE_H : edgeStatus(T.s, T.t.c); T.e.visible = on || !T.disk || T.s === 'n' || T.s === 'c';
  }
  // flow: an arc with three dots (4 draw calls), returns an object for removal
  function flow(parent, a, b, color, height = 3.2) {
    const mid = a.clone().lerp(b, 0.5); mid.y = Math.max(a.y, b.y) + height;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const lineM = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.35, toneMapped: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), lineM); parent.add(line);
    if (!geos.has('dot')) geos.set('dot', new THREE.SphereGeometry(0.1, 12, 8));
    const dots = [0, 1, 2].map(() => { const m = new THREE.Mesh(geos.get('dot'), basic(color)); parent.add(m); return m; });
    return { curve, dots, line, parent, cancel() { parent.remove(line, ...dots); line.geometry.dispose(); lineM.dispose(); } };
  }
  const shiftFlow = (f, t) => f.dots.forEach((m, i) => m.position.copy(f.curve.getPoint((t * 0.28 + i / 3) % 1)));
  function pulse(parent, x, y, z, r, color) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 8, 64), new THREE.MeshBasicMaterial({ color: color, transparent: true, toneMapped: false }));
    m.rotation.x = Math.PI / 2; m.position.set(x, y, z); parent.add(m); pulses.push(m); return m;
  }
  function cancelPulse(m) { const i = pulses.indexOf(m); if (i >= 0) pulses.splice(i, 1); m.parent?.remove(m); m.geometry.dispose(); m.material.dispose(); }
  function path(parent, a, b, width, color) {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); if (len < 0.01) return;
    const m = new THREE.Mesh(boxG(len, 0.03, width), mat(color));
    m.position.set((a[0] + b[0]) / 2, 0.03, (a[1] + b[1]) / 2); m.rotation.y = -Math.atan2(dz, dx); m.receiveShadow = true; parent.add(m);
  }
  // gray little houses: one InstancedMesh (1 draw call + shadow), slots [x, z, w, d, h]
  function houses(parent, slots) {
    if (!slots.length) return null;
    const im = new THREE.InstancedMesh(boxG(1, 1, 1), mat('#ffffff'), slots.length);
    const m4 = new THREE.Matrix4(), colors = HOUSE_COLORS.map((c) => new THREE.Color(c));
    slots.forEach(([x, z, w, d, h], i) => { m4.makeScale(w, h, d); m4.setPosition(x, h / 2, z); im.setMatrixAt(i, m4); im.setColorAt(i, colors[i % colors.length]); });
    im.castShadow = true; im.receiveShadow = true; parent.add(im); return im;
  }
  // pulses: waiting slabs (emissive) and rings by the lead
  function animatePulse(t) {
    const p = 0.5 - 0.5 * Math.cos(t * 2.6); for (const m of pending.values()) m.emissiveIntensity = p * 0.45;
    const pw = mats.get('B#ffffff' + JSON.stringify({ transparent: true })); if (pw) pw.opacity = 0.55 + 0.45 * Math.cos(t * 5); // the white band of working slabs blinks
    for (const m of pulses) { const u = (t * 0.6) % 1; m.scale.setScalar(1 + u * 0.45); m.material.opacity = 1 - u; }
  }
  return { mat, basic, boxG, cylG, edges, EDGE, EDGE_H, mesh, shape, setStatus, highlight, flow, shiftFlow, pulse, cancelPulse, path, houses, animatePulse };
}

// ---------- scene: lights as in the prototype, without day and night colors ----------
export function sceneLayers(radiusShadow = 26) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#f4f3ee');
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe8e4da, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-10, 22, 13); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -radiusShadow, right: radiusShadow, top: radiusShadow, bottom: -radiusShadow, near: 1, far: 80 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; sun.shadow.radius = 5;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.ShadowMaterial({ opacity: 0.09 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  return scene;
}

// ---------- camera: orthographic, fixed angle from above, rotation around the vertical axis, wheel zooms ----------
// The view center shifts into the free area between the panels (Team on the floor on the left, panel on the right), widths are read 2× per second.
export function rigCamera({ size, target, leftPanel = false }) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400);
  const until0 = Math.PI / 4;
  const rig = { until: until0, tUntil: until0, polar: 0.98, zoom: 1, tZoom: 1, size, tSize: size, target: target.clone(), tTarget: target.clone(), floorX: 0, tFloorX: 0, when: -1, turn: null, L: 0, R: 0 };
  let lastKey = '';
  function outline(t) {
    if (t - rig.when < 0.5) return; rig.when = t;
    const pan = document.getElementById('panel'), team = document.getElementById('team');
    const R = document.body.classList.contains('panelHidden') || !pan ? 0 : pan.offsetWidth + 32;
    const L = leftPanel && team && team.offsetWidth ? team.offsetWidth + 32 : 0;
    rig.R = R; rig.L = L; rig.tFloorX = (L - R) / 2; // by how many px to shift the view center to the right
    if (rig.when0 == null) { rig.when0 = t; rig.floorX = rig.tFloorX; } // first read without easing
  }
  function cam(dt, t) {
    outline(t);
    const k = Math.min(1, dt * 7.5);
    rig.until += (rig.tUntil - rig.until) * k; rig.zoom += (rig.tZoom - rig.zoom) * k; rig.size += (rig.tSize - rig.size) * k; rig.floorX += (rig.tFloorX - rig.floorX) * k;
    rig.target.lerp(rig.tTarget, k);
    const r = 100, T = rig.target;
    camera.position.set(T.x + r * Math.sin(rig.polar) * Math.sin(rig.until), T.y + r * Math.cos(rig.polar), T.z + r * Math.sin(rig.polar) * Math.cos(rig.until));
    camera.lookAt(T);
    const H = innerHeight || 1, asp = (innerWidth || 1) / H, h = rig.size / rig.zoom, na1px = (2 * h) / H;
    const sx = -rig.floorX * na1px, sy = 30 * na1px; // 30 px: half of the top bar
    const kl = `${h.toFixed(4)}|${sx.toFixed(4)}|${sy.toFixed(4)}|${asp.toFixed(4)}`;
    const change = kl !== lastKey;
    if (change) { lastKey = kl; camera.left = -h * asp + sx; camera.right = h * asp + sx; camera.top = h + sy; camera.bottom = -h + sy; camera.updateProjectionMatrix(); }
    return change; // true = the projection changed (shift between panels, zoom): CSS2D labels need redrawing (the main.js key does not capture it fully)
  }
  const orient = () => { rig.tUntil = until0 + Math.round((rig.tUntil - until0) / (2 * Math.PI)) * 2 * Math.PI; }; // back to the base angle (by the shortest way)
  const rotate = (s) => { const q = Math.PI / 2; rig.tUntil = Math.round((rig.tUntil - until0) / q) * q + until0 + s * q; };
  // mouse control: dragging rotates around the vertical axis, the wheel zooms (main.js tells a click from a drag itself, > 5 px);
  // ← → arrows rotate by 90° (not in a text field, in the ⌘K palette, with ⌘/Ctrl/Alt or in the Workroom)
  function controls({ zoomMin = 0.6, zoomMax = 3 } = {}) {
    const el = renderer.domElement;
    const down = (e) => { if (e.button !== 0) return; rig.turn = { x: e.clientX, until: rig.tUntil, motion: false }; };
    const motion = (e) => { const T = rig.turn; if (!T) return; const dx = e.clientX - T.x; if (Math.abs(dx) > 3) T.motion = true; if (T.motion) { rig.tUntil = rig.until = T.until - dx * 0.008; el.style.cursor = 'grabbing'; } };
    const up = () => { rig.turn = null; };
    const out = () => { if (hover !== null) setState({ hover: null }); }; // the mouse went from a building straight to a panel or the bar: hover does not stay hanging (rotation would stall)
    const wheel = (e) => { if (workroom) return; e.preventDefault(); rig.tZoom = Math.min(zoomMax, Math.max(zoomMin, rig.tZoom * Math.exp(-e.deltaY * 0.0012))); };
    const keys = (e) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || workroom) return;
      const a = document.activeElement; if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
      if (document.querySelector('#palette.on')) return;
      rotate(e.key === 'ArrowLeft' ? -1 : 1);
    };
    el.addEventListener('pointerdown', down); addEventListener('pointermove', motion); addEventListener('pointerup', up); el.addEventListener('wheel', wheel, { passive: false }); el.addEventListener('pointerleave', out); addEventListener('keydown', keys);
    return {
      target: rig.tTarget, enabled: true,
      update() {},
      dispose() { el.removeEventListener('pointerdown', down); removeEventListener('pointermove', motion); removeEventListener('pointerup', up); el.removeEventListener('wheel', wheel); el.removeEventListener('pointerleave', out); removeEventListener('keydown', keys); rig.turn = null; },
    };
  }
  return { camera, rig, cam, rotate, orient, controls };
}
