// scene-base.js – Skins, renderer, materials and cubes, textures, lights (also interior ones by time), figures, optimization (merge, freeze, withoutShadow).
// Created by splitting the prototype public/dizajn-v12d.html (phase 1). Module map: brain Projekty/mesto-agentov/technika.md.
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { dayState } from './daylight.js';

// =====================================================================
// SKINS
// =====================================================================
export const SKINS = {
  a: { background: 0xf4f3ee, fog: [0xf4f3ee, 80, 180], ground: 0xe2dac8, path: 0xa4a9b0, // v13e: day colors (2026-11-10), previously ground 0xeeede6, road 0xe0dfd7, edges 0xc9c7bf
     lines: 0xffffff, buildingShell: 0xffffff, board: 0xfbfaf6, glass: { color: 0xdfe6ea, opacity: 0.2 }, edges: 0x8c949e,
    cut: 0xd8d6cd, wall: 0xffffff, window: 0xd8e4ec, flooring: 0xfbfaf7, desk: 0xffffff, legs: 0xdcdad2, chair: 0x26272c, monitor: 0x1c1d22, plant: 0x8dbf96, flowerPot: 0xffffff, kitchen: 0xefeee8, seat: 0xe6e4dc, carpet: null,
    cam: 'perspective', fontBadge: '500 44px "JetBrains Mono"', whiteboard: { bg: '#ffffff', ink: '#151515', muted: '#8a8880', card: '#f4f3ee', font: 'Inter' }, cheeks: false, platform: 0xffffff },
};
export let skin = SKINS.a;
// v13e: slightly darker exposure so the colors in the sun do not fade. Since 2026-11-10 only Maketa (Diorama removed)
export function chooseSkin() { skin = SKINS.a; renderer.toneMappingExposure = 0.97; } // called by navigation.js → setSkin() when rebuilding the city

// =====================================================================
// RENDERER + helpers
// =====================================================================
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // v11b: on Retina 1.5× instead of 2× (44 % fewer pixels)
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
export const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 2 });
document.body.appendChild(labelRenderer.domElement);
export const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
export const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
export function box(w, h, d, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o; }
export function texture(text, { bg, fg, font = '600 54px Inter', w = 384, h = 96, r = 18 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, r); g.fill(); }
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg; g.fillText(text, w / 2, h / 2 + 2, w - 24);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function lights(scene, r, night = false) {
  if (night) { // evening: moonlight, the rest is done by lamps and windows
    scene.add(new THREE.HemisphereLight(0x9fb0e0, 0x2a2438, 0.9));
    const sl = new THREE.DirectionalLight(0xc4d0ff, 0.7); sl.position.set(-22, 40, 18); sl.castShadow = true;
    sl.shadow.mapSize.set(2048, 2048); sl.shadow.radius = 7; sl.shadow.bias = -0.0004;
    Object.assign(sl.shadow.camera, { left: -r, right: r, top: r, bottom: -r, far: 160 }); scene.add(sl);
    return;
  }
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe6e4dc, 1.55));
  const sl = new THREE.DirectionalLight(0xffffff, 2.3); sl.position.set(-18, 40, 24); sl.castShadow = true;
  sl.shadow.mapSize.set(2048, 2048); sl.shadow.radius = 7; sl.shadow.bias = -0.0004;
  Object.assign(sl.shadow.camera, { left: -r, right: r, top: r, bottom: -r, far: 130 }); scene.add(sl);
}
// v12: interior lighting (floor and the Home building) by the outdoor time. During the day daylight from the windows,
// after sunset darkness around, a night sky in the windows and warm lamps (hanging, table, standing) with light.
const NIGHT_BACKGROUND = 0x141927;
export function interiorLights(scene, r) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0xe6e4dc, 1.5); scene.add(hemi);
  const sl = new THREE.DirectionalLight(0xffffff, 2.3); sl.position.set(-18, 40, 24); sl.castShadow = true;
  sl.shadow.mapSize.set(2048, 2048); sl.shadow.radius = 7; sl.shadow.bias = -0.0004;
  Object.assign(sl.shadow.camera, { left: -r, right: r, top: r, bottom: -r, far: 130 }); scene.add(sl);
  const C = (h) => new THREE.Color(h);
  const position = [C(NIGHT_BACKGROUND), C(skin.background)], hn = [C(0x8792c4), C(0xffffff)], hz = [C(0x2c2838), C(0xe6e4dc)];
  const sf = [C(0xaebcff), C(0xffffff)], ok = [C(0x1b2546), C(skin.window)];
  const windows = [], lamps = [], shades = []; scene.background = position[1].clone();
  const lerp = (pair, k, target) => target.copy(pair[0]).lerp(pair[1], k);
  const metalM = mat(0x3a3b40, { roughness: 0.5, metalness: 0.4 });
  return {
    windows, shades,
    nightBrightness: 0, // a building can add night brightness of the whole room (e.g. a glass greenhouse), 0 = no change
    // hanging lamp above a table (cord up, shade, glowing bottom) + a point light under it
    // kind 'iba' = light only without a body (the body is drawn by interior-kit.js), disk = its glowing material
    lamp(g, x, z, { y = 2.45, strength = 1, color: tint = 0xffd6a0, kind = 'hang', radius = 0.32, disk } = {}) {
      const sv = disk || new THREE.MeshBasicMaterial({ color: 0xfff1d8 });
      if (kind === 'hang') {
        const sn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.1, 4), metalM); sn.position.set(x, y + 0.6, z); g.add(sn);
        const t = new THREE.Mesh(new THREE.ConeGeometry(radius, radius * 0.8, 20, 1, true), mat(0x2a2b30, { side: THREE.DoubleSide, roughness: 0.5 })); t.position.set(x, y + radius * 0.4, z); g.add(t);
        const d = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.96, 20), sv); d.rotation.x = Math.PI / 2; d.position.set(x, y + 0.01, z); g.add(d);
      } else if (kind === 'standing') {
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, y, 6), metalM); st.position.set(x, y / 2, z); g.add(st);
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.3, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0xfff5e0, side: THREE.DoubleSide, emissive: 0xffe2a8, emissiveIntensity: 0.4 })); t.position.set(x, y + 0.05, z); g.add(t); shades.push(t.material);
      } else if (kind !== 'only') { // ceiling panel (warehouse, gym, greenhouse)
        const p = new THREE.Mesh(new THREE.BoxGeometry(radius * 4, 0.06, 0.3), sv); p.position.set(x, y, z); g.add(p);
        const sn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.1, 4), metalM); sn.position.set(x, y + 0.58, z); g.add(sn);
      }
      const l = new THREE.PointLight(tint, 0, 7.5, 1.6); l.position.set(x, y - 0.25, z); g.add(l);
      lamps.push({ l, strength, sv });
    },
    time() {
      const s = dayState(), d = s.day, n = s.lamps;
      lerp(position, d, scene.background);
      lerp(hn, d, hemi.color); lerp(hz, d, hemi.groundColor); hemi.intensity = 0.6 + ((1.55) - 0.6) * d + this.nightBrightness * (1 - d);
      lerp(sf, d, sl.color); sl.intensity = 0.32 + ((2.3) - 0.32) * d;
      for (const m of windows) { lerp(ok, d, m.color); m.emissive.copy(m.color); m.emissiveIntensity = 0.3 * d + 0.55 * (1 - d); }
      for (const L of lamps) { L.l.intensity = L.strength * (0.8 + 7.5 * n); L.sv.color.setHex(n > 0.5 ? 0xffefc8 : 0xfbf6ec); }
      for (const m of shades) m.emissiveIntensity = 0.4 + 1.1 * n;
      return s;
    },
  };
}
export function css2d(html, cls) { const el = document.createElement('div'); el.className = cls; el.innerHTML = html; return [el, new CSS2DObject(el)]; }

// figure with a skeleton
// v12c: simplified figure for the city (pedestrians, people in Home, agents in the mini offices of towers).
// Only 2 meshes instead of 7: body with head and arms as one piece and eyes. The geometries are shared by all
// and one material per color. From a distance it looks the same, it is animated by the whole body (bouncing when walking and working).
let _unitGeo = null; const _unitMat = new Map();
function joinGeo(items) { // items: [geometry, Matrix4] → one non-indexed geometry (position, normal)
  const gs = items.map(([g, m]) => { const x = (g.index ? g.toNonIndexed() : g.clone()); for (const n of Object.keys(x.attributes)) if (n !== 'position' && n !== 'normal') x.deleteAttribute(n); return x.applyMatrix4(m); });
  const out = new THREE.BufferGeometry(), total = gs.reduce((s, g) => s + g.attributes.position.count, 0);
  for (const n of ['position', 'normal']) { const arr = new Float32Array(total * 3); let o = 0; for (const g of gs) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; } out.setAttribute(n, new THREE.BufferAttribute(arr, 3)); }
  return out;
}
function figureSimple(tint) {
  if (!_unitGeo) {
    const T = (x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    const hand = new THREE.CapsuleGeometry(0.075, 0.2, 3, 8);
    _unitGeo = {
      body: joinGeo([[new THREE.CapsuleGeometry(0.27, 0.26, 4, 12), T(0, 0.42, 0)], [new THREE.SphereGeometry(0.28, 16, 10), T(0, 0.95, 0)], [hand, T(-0.31, 0.44, 0)], [hand, T(0.31, 0.44, 0)]]),
      eyes: joinGeo([[new THREE.SphereGeometry(0.045, 6, 4), T(-0.095, 0.98, 0.25, 1, 1.45, 1)], [new THREE.SphereGeometry(0.045, 6, 4), T(0.095, 0.98, 0.25, 1, 1.45, 1)]]),
      eyeM: new THREE.MeshBasicMaterial({ color: 0x15161a }),
    };
  }
  const k = new THREE.Color(tint).getHex(); if (!_unitMat.has(k)) _unitMat.set(k, new THREE.MeshStandardMaterial({ color: k, roughness: 0.55 }));
  const g = new THREE.Group(), body = new THREE.Mesh(_unitGeo.body, _unitMat.get(k)), eyes = new THREE.Mesh(_unitGeo.eyes, _unitGeo.eyeM);
  body.castShadow = true; g.add(body); g.add(eyes);
  g.userData = { simple: true, pieces: [body, eyes], phase: Math.random() * 6 };
  return g;
}
export function figure(tint, simple = false) {
  if (simple) return figureSimple(tint);
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(tint), roughness: 0.55 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.26, 6, 18), m); body.position.y = 0.42; body.castShadow = true; g.add(body);
  const head = new THREE.Group(); head.position.y = 0.95; g.add(head);
  const h = new THREE.Mesh(new THREE.SphereGeometry(0.28, 28, 18), m); h.castShadow = true; head.add(h);
  const eye = new THREE.MeshBasicMaterial({ color: 0x15161a });
  for (const x of [-0.095, 0.095]) { const o = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), eye); o.position.set(x, 0.03, 0.25); o.scale.y = 1.45; head.add(o); }
  
  const hands = [];
  for (const s of [-1, 1]) { const pv = new THREE.Group(); pv.position.set(0.3 * s, 0.6, 0); g.add(pv); const r = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.2, 4, 10), m); r.position.y = -0.16; r.castShadow = true; pv.add(r); hands.push(pv); }
  g.userData = { body, head, hands, phase: Math.random() * 6 };
  return g;
}
export function animate(ch, status, t) {
  if (ch.userData.simple) { // simplified: only a bounce and tilt of the whole body
    const f = ch.userData.phase, [a, b] = ch.userData.pieces;
    const y = status === 'walks' ? Math.abs(Math.cos(t * 9 + f)) * 0.06 : status === 'work' ? Math.abs(Math.sin(t * 7 + f)) * 0.02 : status === 'pending' ? Math.abs(Math.sin(t * 3.4 + f)) * 0.1 : status === 'done' ? Math.abs(Math.sin(t * 9 + f)) * 0.08 : 0;
    const tilt = status === 'walks' ? Math.sin(t * 9 + f) * 0.06 : status === 'work' ? 0.06 : 0;
    a.position.y = b.position.y = y; a.rotation.z = b.rotation.z = tilt; return;
  }
  const { body, head, hands: [l, p], phase: f } = ch.userData;
  body.position.y = 0.42; head.position.y = 0.95; head.rotation.set(0, 0, 0);
  if (status === 'work') { l.rotation.set(-1.15 + Math.sin(t * 14 + f) * 0.12, 0, 0.15); p.rotation.set(-1.15 + Math.sin(t * 14 + f + 2) * 0.12, 0, -0.15); head.rotation.x = 0.15; body.position.y += Math.abs(Math.sin(t * 7 + f)) * 0.012; }
  else if (status === 'pending') { l.rotation.set(0, 0, 0.12); p.rotation.set(0, 0, -2.75 + Math.sin(t * 7 + f) * 0.28); head.rotation.z = Math.sin(t * 2.5 + f) * 0.12; const s = Math.abs(Math.sin(t * 3.4 + f)) * 0.1; body.position.y += s; head.position.y += s; }
  else if (status === 'done') { const v = Math.sin(t * 9 + f) * 0.2; l.rotation.set(0, 0, 2.5 + v); p.rotation.set(0, 0, -2.5 - v); head.rotation.x = -0.15; }
  else if (status === 'delegates') { l.rotation.set(0, 0, 0.12); p.rotation.set(-1.9 + Math.sin(t * 6) * 0.3, 0, -0.2); }
  else if (status === 'walks') { const k = Math.sin(t * 9 + f); l.rotation.set(k * 0.6, 0, 0.1); p.rotation.set(-k * 0.6, 0, -0.1); const b = Math.abs(Math.cos(t * 9 + f)) * 0.06; body.position.y += b; head.position.y += b; }
  else { l.rotation.set(0, 0, 0.12); p.rotation.set(0, 0, -0.12); head.rotation.y = Math.sin(t * 0.7 + f) * 0.3; }
}

// =====================================================================
// SCENE 1: CITY with the Brain on the square
// =====================================================================
export const WIDTH = 9, DEPTH = 6.5, HEIGHT = 2.2, BX = 10.5;
export const BRAIN_CENTER = new THREE.Vector3(0, 2.7, -0.5); // center of the hologram inside the dome
// static objects stop being recomputed every frame (live = what moves)
// v12c: merging static objects. All static, opaque meshes under `root` with the same material
// (the same material object, not just the same color) are merged into one mesh. The material stays the same,
// so night, lights and highlights keep working. Everything in `exclude` (moves) and below it is skipped, as are invisible
// objects, transparent materials (glass, water, glows), objects with userData (click, steam) and meshes with children.
const signatureMat = (m) => [m.type, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity, m.roughness, m.metalness, m.map?.uuid, m.emissiveMap?.uuid, m.alphaMap?.uuid, m.envMap?.uuid, m.envMapIntensity, m.side, m.flatShading, m.vertexColors, m.depthTest, m.depthWrite, m.fog, m.wireframe].join('|');
export function merge(root, exclude = new Set()) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), groups = new Map(), M4 = new THREE.Matrix4();
  (function walk(o) {
    for (const c of o.children) {
      if (exclude.has(c) || !c.visible) continue;
      const m = c.material;
      if (c.isMesh && !c.isInstancedMesh && !c.children.length && m && !Array.isArray(m) && m.visible !== false && !m.transparent && !Object.keys(c.userData).length && c.geometry?.attributes.position) {
        const k = `${signatureMat(m)}|${c.castShadow ? 1 : 0}${c.receiveShadow ? 1 : 0}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); // the same look = one material
      } else walk(c);
    }
  })(root);
  let ago = 0, po = 0;
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    const m = items[0].material, sUv = !!m.map, withColor = !!m.vertexColors;
    const geos = [], used = [];
    for (const c of items) {
      const src = c.geometry; if (sUv && !src.attributes.uv) continue;
      const g = src.index ? src.toNonIndexed() : src.clone();
      for (const n of Object.keys(g.attributes)) if (!(n === 'position' || n === 'normal' || (n === 'uv' && sUv) || (n === 'color' && withColor))) g.deleteAttribute(n);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (withColor && !g.attributes.color) continue;
      g.applyMatrix4(M4.multiplyMatrices(inv, c.matrixWorld)); geos.push(g); used.push(c);
    }
    if (used.length < 2) continue;
    const names = Object.keys(geos[0].attributes), total = geos.reduce((s, g) => s + g.attributes.position.count, 0), out = new THREE.BufferGeometry();
    for (const n of names) {
      const size = geos[0].attributes[n].itemSize, arr = new Float32Array(total * size); let o = 0;
      for (const g of geos) { const a = g.attributes[n]; for (let i = 0; i < a.count; i++) for (let j = 0; j < size; j++) arr[o++] = a.getComponent ? a.getComponent(i, j) : a.array[i * size + j]; }
      out.setAttribute(n, new THREE.BufferAttribute(arr, size));
    }
    const sp = new THREE.Mesh(out, m); sp.castShadow = used[0].castShadow; sp.receiveShadow = used[0].receiveShadow; sp.matrixAutoUpdate = false; root.add(sp);
    for (const c of used) c.parent.remove(c);
    ago += used.length; po++;
  }
  if (new URLSearchParams(location.search).has('perf')) console.info('merge', root.type, 'skupín', groups.size, 'zlúčených', ago, '→', po);
  return { ago, po };
}
export function freeze(o, live) { if (live.has(o)) return; o.updateMatrix(); o.matrixAutoUpdate = false; for (const c of o.children) freeze(c, live); }
export const withoutShadow = (o) => { o.traverse((x) => { x.castShadow = false; }); return o; };

// animation clock (tick in main.js and __perf.test)
export const clock = new THREE.Clock();
