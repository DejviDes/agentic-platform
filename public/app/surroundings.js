// surroundings.js – City surroundings: island, streets, cars, pedestrians, park and fountains, houses, river, sky by the camera (sun, moon, stars).
// Created by splitting the prototype public/dizajn-v12d.html (phase 1). Module map: brain Projekty/mesto-agentov/technika.md.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { rnd, pick } from './utils.js';
import { smooth } from './daylight.js';
import { animate, withoutShadow, box, mat, figure, renderer, skin, texture, HEIGHT, merge, freeze } from './scene-base.js';
import { t as tt } from './i18n.js';

function windowTex(wall, window) {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = wall; g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = window; g.fillRect(x * 64 + 14, y * 64 + 12, 36, 40); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function lightsWindowsTex() { // black facade, about 60 % of windows lit – used as emissiveMap
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (Math.random() < 0.62) { g.fillStyle = pick(['#ffd98a', '#ffe7b0', '#ffc76b', '#fff1c9', '#bfe0ff']); g.fillRect(x * 64 + 14, y * 64 + 12, 36, 40); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function glowTex(color = '255,220,150') {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, `rgba(${color},0.9)`); gr.addColorStop(0.4, `rgba(${color},0.35)`); gr.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}

// v11b: the city is an island floating in the air. The edge slightly overhangs the last blocks, under the island are
// tapering layers and a tip, the river falls from the edges as a waterfall. Distant blocks, skyline and hills are gone (performance).
// Layout: in front (z > 26) the Home district, in the middle the Brain on the square, at the back (z < -10) the Work towers.
const MAP = {
  a: { X: 52, Zp: 54, Zz: -57, river: -46, riverWith: 7 },
  c: { X: 52, Zp: 54, Zz: -57, river: -46, riverWith: 7 },
};
// v12: fountain. The basin is a single lathe profile (the rim higher than the water), so the water and the stone are never
// in the same plane (previously they overlapped and caused stripes). In the middle a column with a bowl, a jet, drops in arcs and rings on the surface.
export function buildFountain(add, live, x, z, r) {
  const g = new THREE.Group(); g.position.set(x, 0, z); add(g);
  const stone = mat(0xe6e3da, { roughness: 0.7, side: THREE.DoubleSide }), H = 0.3, OK = 0.44;
  const profile = [[r - 0.16, H - 0.02], [r - 0.16, OK], [r - 0.08, OK + 0.04], [r, OK], [r * 1.06, 0.06], [r * 1.08, 0]].map(([a, b]) => new THREE.Vector2(a, b));
  const tank = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), stone); tank.castShadow = tank.receiveShadow = true; g.add(tank);
  const waterM = new THREE.MeshStandardMaterial({ color: 0x9fc8d8, roughness: 0.08, metalness: 0.1, envMap: envTex(), envMapIntensity: 0.7, emissive: 0x3c86a4, emissiveIntensity: 0.22 });
  const level = new THREE.Mesh(new THREE.CircleGeometry(r - 0.16, 48), waterM); level.rotation.x = -Math.PI / 2; level.position.y = H; level.receiveShadow = true; g.add(level);
  const vS = 0.62 + r * 0.25; // height of the column with the bowl
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.09, r * 0.13, vS - H, 16), stone); pillar.position.y = H + (vS - H) / 2; pillar.castShadow = true; g.add(pillar);
  const bowl = new THREE.Mesh(new THREE.LatheGeometry([[0.02, 0], [r * 0.32, 0.1], [r * 0.34, 0.14], [r * 0.3, 0.13], [0.02, 0.06]].map(([a, b]) => new THREE.Vector2(a, b)), 28), stone); bowl.position.y = vS; bowl.castShadow = true; g.add(bowl);
  const waterWhiteM = new THREE.MeshStandardMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.75, roughness: 0.1, emissive: 0x9fd8ee, emissiveIntensity: 0.35, depthWrite: false });
  const vP = 0.55 + r * 0.35, stream = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, vP, 8, 1, true), waterWhiteM); stream.position.y = vS + vP / 2; g.add(stream); live.add(stream);
  const drops = [], rings = [], N = 14, geo = new THREE.SphereGeometry(0.045, 6, 4);
  for (let i = 0; i < N; i++) { const k = new THREE.Mesh(geo, waterWhiteM); g.add(k); live.add(k); drops.push({ k, a: (i / N) * Math.PI * 2 + (i % 2) * 0.2, f: i / N }); }
  const circleM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), circleM.clone()); m.rotation.x = -Math.PI / 2; m.position.y = H + 0.005; g.add(m); live.add(m); rings.push({ m, f: i / 3 }); }
  const top = vS + vP, reach = r - 0.35;
  return {
    update(t) {
      stream.scale.set(1, 1 + Math.sin(t * 6) * 0.05, 1);
      for (const d of drops) { const k = (t * 0.7 + d.f) % 1; d.k.position.set(Math.cos(d.a) * reach * k, top + 0.35 * k - (0.35 + top - H) * k * k, Math.sin(d.a) * reach * k); }
      for (const c of rings) { const k = (t * 0.35 + c.f) % 1, s = 0.2 + k * (r - 0.3); c.m.scale.set(s, s, 1); c.m.material.opacity = 0.45 * (1 - k); }
    },
  };
}
// controlCenter (2026-11-10): if present, the square gets the Control Center courtyard between the towers (paving, a path through its entrances, 4 trees)
// and controlCenter.staticke({ add, M }) adds the static parts of the building to the surroundings root so they merge with it (fewer draw calls).
export function buildSurroundings(scene, controlCenter = null) {
  const A = { car: [], people: [], clouds: [], lode: [], trafficLight: null, birdT: 4, fountain: null };
  const S = { lampsHeads: [], glows: [], pointLights: [], houses: [], shops: [], lightsCars: [], clouds: [], water: [] }; // what changes with time
  const M = MAP['a'], SX = M.X;
  const R0 = M.river - M.riverWith / 2, R1 = M.river + M.riverWith / 2; // river banks (R0 at the back, R1 closer to the city)
  const palette = ['#e6cba9', '#d8a68b', '#c6d7bc', '#b5c9df', '#ecdcb0', '#d9bcc1', '#d6d0c4'] /* v13e: muted house colors instead of white-gray ones */;
  const asphaltDay = new THREE.Color(skin.path), asphaltNight = new THREE.Color(0x3a3f4f);
  const asphalt = mat(skin.path, { roughness: 0.95 });
  const sidewalk = mat(0xf2eee5, { roughness: 1 }), curb = mat(0xdedcd4);
  const white = new THREE.MeshBasicMaterial({ color: skin.lines });
  const grass = mat(0xb3cd92, { roughness: 1 });
  const paving = mat(0xe8e0d0, { roughness: 1 });
  const stoneM = mat(0xcdc4b4, { roughness: 0.9 });
  const root = new THREE.Group(); scene.add(root); const live = new Set();
  const add = (o) => { root.add(o); return o; };
  const surface = (x0, x1, z0, z1, m, y = 0.015) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), m); p.rotation.x = -Math.PI / 2; p.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); p.receiveShadow = true; return add(p); };
  // rounded slab: top at y, thickness h downward (island, beach, sea, pedestal)
  const board = (x0, x1, z0, z1, r, y, h, m) => {
    const s = new THREE.Shape();
    s.moveTo(x0 + r, z0); s.lineTo(x1 - r, z0); s.quadraticCurveTo(x1, z0, x1, z0 + r); s.lineTo(x1, z1 - r); s.quadraticCurveTo(x1, z1, x1 - r, z1);
    s.lineTo(x0 + r, z1); s.quadraticCurveTo(x0, z1, x0, z1 - r); s.lineTo(x0, z0 + r); s.quadraticCurveTo(x0, z0, x0 + r, z0);
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 12 }); g.rotateX(Math.PI / 2);
    const o = new THREE.Mesh(g, m); o.position.y = y; o.receiveShadow = true; return add(o);
  };
  const waterM = new THREE.MeshStandardMaterial({ color: 0x79aecd, roughness: 0.18, metalness: 0.15, envMap: envTex(), envMapIntensity: 0.6 });
  S.water.push({ m: waterM, day: waterM.color.clone(), night: new THREE.Color(0x1f2a3a) });
  const WATER_Y = -0.55; // river surface

  // ---------- ground: island in the air ----------
  const MARGIN = 3; // white edge of the model
  const groundM = mat(skin.ground, { roughness: 1 });
  for (const [z0, z1] of [[R1, M.Zp], [M.Zz, R0]]) board(-SX, SX, z0, z1, 7, 0, 0.6, groundM);
  board(-SX - MARGIN, SX + MARGIN, M.Zz - MARGIN, M.Zp + MARGIN, 12, -0.62, 2.2, mat(0xffffff, { roughness: 0.85 }));
  const E = { x0: -SX - MARGIN, x1: SX + MARGIN, z0: M.Zz - MARGIN, z1: M.Zp + MARGIN };
  const layers = [0xdedcd4, 0xd0cec5, 0xc2c0b7, 0xb4b2a9];
  // v12b: the underside of the island is a single rock mass instead of steps. The outline rings (rounded rectangle) taper
  // downward to a point, the edges are broken up by noise and the rock layers are in the colors of the vertices. One static mesh of about 3,000 triangles
  // without shadows, so performance practically does not change.
  {
    const cx = 0, cz = (E.z0 + E.z1) / 2, a = (E.x1 - E.x0) / 2 - 0.4, b = (E.z1 - E.z0) / 2 - 0.4, N = 4.5;
    const SEG = 110, K = 16, Y0 = -2.8, HL = 40, tipX = 4, tipFrom = -3;
    const phases = Array.from({ length: 6 }, () => Math.random() * 6.28);
    const sum = (u, v) => Math.sin(u * 3 + phases[0] + v * 2) * 0.5 + Math.sin(u * 7 + phases[1] - v * 5) * 0.3 + Math.sin(u * 13 + phases[2] + v * 9) * 0.2 + Math.sin(u * 23 + phases[3]) * 0.12;
    const colors = layers.map((c) => new THREE.Color(c)), soil = new THREE.Color(0xc9c3b6), moss = new THREE.Color(0xd5dccb);
    const floor = [], col = [], idx = [], c = new THREE.Color();
    for (let k = 0; k <= K; k++) {
      const t = k / K, s = Math.pow(Math.cos(t * Math.PI / 2), 0.75) * (1 - 0.06 * t), y0 = Y0 - HL * Math.pow(t, 1.15);
      for (let i = 0; i < SEG; i++) {
        const th = (i / SEG) * Math.PI * 2, what = Math.cos(th), si = Math.sin(th);
        const n = k === 0 ? 0 : sum(th, t * 3), r = 1 + (k === 0 ? 0 : 0.1 + 0.06 * t) * n - (k === 0 ? 0 : 0.035);
        const x = cx + tipX * t * t + Math.sign(what) * Math.pow(Math.abs(what), 2 / N) * a * s * r;
        const z = cz + tipFrom * t * t + Math.sign(si) * Math.pow(Math.abs(si), 2 / N) * b * s * r;
        const y = y0 + (k === 0 ? 0 : sum(th * 2 + 1, t * 5) * (0.8 + 1.6 * t));
        floor.push(x, y, z);
        // color: a thin layer of soil and moss under the edge, then bands of rock that undulate
        const pass = Math.min(3, Math.max(0, Math.floor(t * 4 + sum(th * 3, t) * 0.35)));
        if (k <= 1) c.copy(k === 0 ? moss : soil); else c.copy(colors[pass]).lerp(colors[Math.min(3, pass + 1)], (t * 4) % 1 * 0.35);
        c.multiplyScalar(0.92 + 0.1 * Math.sin(i * 1.7 + k * 2.3)); col.push(c.r, c.g, c.b);
      }
    }
    const tip = floor.length / 3; floor.push(cx + tipX, Y0 - HL - 6, cz + tipFrom); c.copy(colors[3]).multiplyScalar(0.9); col.push(c.r, c.g, c.b);
    for (let k = 0; k < K; k++) for (let i = 0; i < SEG; i++) { const a0 = k * SEG + i, a1 = k * SEG + (i + 1) % SEG, b0 = a0 + SEG, b1 = a1 + SEG; idx.push(a0, a1, b0, a1, b1, b0); } // vertex order so that the walls face outward (otherwise only the back side is visible)
    for (let i = 0; i < SEG; i++) idx.push(K * SEG + i, K * SEG + (i + 1) % SEG, tip);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(floor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })); rock.castShadow = rock.receiveShadow = false; add(rock);
    // roots and climbing plants hanging from under the edge
    const rootM = mat(0xa39e92, { roughness: 1 }), lianaM = mat(0xbfcab5, { roughness: 1, flatShading: true });
    // the roots hang close to the rock wall and are drawn as 3 batched objects (InstancedMesh), not 60 separate ones
    const rootG = new THREE.CylinderGeometry(0.05, 0.16, 1, 5), listG = new THREE.IcosahedronGeometry(0.32, 0);
    const NK = 46, roots = new THREE.InstancedMesh(rootG, rootM, NK), vines = new THREE.InstancedMesh(rootG, lianaM, NK), bars = new THREE.InstancedMesh(listG, lianaM, NK * 3);
    const o = new THREE.Object3D(); let nk = 0, nl = 0, nli = 0;
    for (let i = 0; i < NK; i++) {
      const th = Math.random() * Math.PI * 2, what = Math.cos(th), si = Math.sin(th), dl = rnd(1.5, 5);
      const x = cx + Math.sign(what) * Math.pow(Math.abs(what), 2 / N) * (a + 0.15), z = cz + Math.sign(si) * Math.pow(Math.abs(si), 2 / N) * (b + 0.15);
      o.position.set(x, Y0 - dl / 2 + 0.3, z); o.rotation.set(rnd(-0.15, 0.15), 0, rnd(-0.15, 0.15)); o.scale.set(1, dl, 1); o.updateMatrix();
      if (i % 3) roots.setMatrixAt(nk++, o.matrix); else { vines.setMatrixAt(nli++, o.matrix);
        for (let j = 0; j < 3; j++) { o.position.set(x + rnd(-0.3, 0.3), Y0 - dl * (0.2 + j * 0.3), z + rnd(-0.3, 0.3)); o.rotation.set(0, 0, 0); o.scale.setScalar(rnd(0.6, 1.1)); o.updateMatrix(); bars.setMatrixAt(nl++, o.matrix); } }
    }
    roots.count = nk; vines.count = nli; bars.count = nl;
    for (const m of [roots, vines, bars]) { m.castShadow = false; m.frustumCulled = false; m.instanceMatrix.needsUpdate = true; add(m); }
  }
  // smaller stones floating under the island
  for (const [x, y, z, r] of [[-SX - 14, -9, 20, 3], [SX + 12, -14, -18, 4], [-20, -30, M.Zp + 14, 2.5], [30, -24, M.Zz - 10, 3.2]]) { const k = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(layers[2], { flatShading: true })); k.position.set(x, y, z); k.scale.y = 0.7; add(k); const tr = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.4, 8), mat(0xeeede6)); tr.position.set(x, y + r * 0.7, z); add(tr); }

  // ---------- river at the back: sunken, embankment walls with a railing, bridge ----------
  const rX = SX + MARGIN;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(rX * 2, M.riverWith + 0.4), waterM); water.rotation.x = -Math.PI / 2; water.position.set(0, WATER_Y, M.river); add(water);
  // subtle ripples (strips of light on the water)
  const ripplesM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
  const ripples = new THREE.Group(); add(ripples); live.add(ripples);
  for (let i = 0; i < (70); i++) { const v = new THREE.Mesh(new THREE.PlaneGeometry(rnd(1.2, 3.2), 0.07), ripplesM); v.rotation.x = -Math.PI / 2; v.position.set(rnd(-rX, rX), WATER_Y + 0.01, M.river + rnd(-M.riverWith / 2 + 0.6, M.riverWith / 2 - 0.6)); ripples.add(v); }
  for (const [z, s] of [[R0, -1], [R1, 1]]) {
    const dl = SX * 2 - 4;
    add(box(dl, 1.3, 0.5, stoneM, 0, -0.6, z + 0.25 * s)).castShadow = false;           // embankment wall
    if (true) { add(box(dl, 0.12, 0.12, mat(0x8a8c92), 0, 0.72, z + 0.3 * s)).castShadow = false; } // railing
  }
  for (let x = -rX + 2; x < rX; x += 2.4) for (const z of [R0 - 0.3, R1 + 0.3]) { if (Math.abs(x) < 4.2) continue; add(box(0.06, 0.66, 0.06, mat(0x8a8c92), x, 0.36, z)).castShadow = false; }
  // waterfalls: the river falls from both edges of the island
  const vc = document.createElement('canvas'); vc.width = 64; vc.height = 128; const vg = vc.getContext('2d');
  vg.fillStyle = '#e4f0f5'; vg.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 46; i++) { vg.fillStyle = pick(['#ffffff', '#b8e4f5', '#c9ecf8']); vg.fillRect(rnd(0, 64), rnd(0, 128), rnd(1, 4), rnd(14, 50)); }
  const waterfallT = new THREE.CanvasTexture(vc); waterfallT.wrapS = waterfallT.wrapT = THREE.RepeatWrapping; waterfallT.colorSpace = THREE.SRGBColorSpace;
  const ac = document.createElement('canvas'); ac.width = 4; ac.height = 128; const ag = ac.getContext('2d'), agr = ag.createLinearGradient(0, 0, 0, 128);
  agr.addColorStop(0, '#fff'); agr.addColorStop(0.55, '#999'); agr.addColorStop(1, '#000'); ag.fillStyle = agr; ag.fillRect(0, 0, 4, 128);
  const waterfallM = new THREE.MeshBasicMaterial({ map: waterfallT, alphaMap: new THREE.CanvasTexture(ac), transparent: true, depthWrite: false, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) { const v = new THREE.Mesh(new THREE.PlaneGeometry(M.riverWith, 22), waterfallM); v.rotation.y = Math.PI / 2; v.position.set(sx * (rX + 0.05), WATER_Y - 11, M.river); add(v); }
  A.waterfallT = waterfallT;
  // bridge with an arch and lamps
  const mostM = mat(0xeceae3), mostDl = M.riverWith + 3;
  add(box(7.6, 0.45, mostDl, mostM, 0, 0.0, M.river));
  add(box(5, 0.03, mostDl, asphalt, 0, 0.24, M.river)).castShadow = false;
  for (const x of [-3.6, 3.6]) { add(box(0.35, 0.7, mostDl, mostM, x, 0.55, M.river)); }
  const archG = new THREE.TorusGeometry(M.riverWith / 2 - 0.2, 0.45, 8, 24, Math.PI);
  for (const x of [-3.2, 3.2]) { const o = new THREE.Mesh(archG, mostM); o.rotation.y = Math.PI / 2; o.position.set(x, -1.3, M.river); o.scale.set(1, 0.42, 1); add(o); }

  // ---------- streets (sidewalks and curbs break at intersections) ----------
  const STREETS = [
    { os: 'x', c: 8, sir: 6 },                         // north boulevard = main street with a traffic light
    { os: 'x', c: 22, sir: 5 },                        // south boulevard (by the Home district)
    { os: 'x', c: -36, sir: 5 },                       // back street behind the towers
    { os: 'x', c: 49, sir: 6 },                        // front street in front of Home
    { os: 'z', c: -28, sir: 6, from: -36, do: 52.4 }, { os: 'z', c: 28, sir: 6, from: -36, do: 52.4 },
    { os: 'z', c: 0, sir: 5, from: M.Zz + 2, do: -36 }, // street across the bridge
  ];
  for (const u of STREETS) if (u.os === 'x') { const k = u.c === 8 || u.c === 22 ? SX - 1 : SX - 4.5; u.from = -k; u.do = k; }
  const holes = (u) => STREETS.filter((v) => v.os !== u.os && u.c > v.from - 0.1 && u.c < v.do + 0.1 && v.c > u.from && v.c < u.do).map((v) => [v.c - v.sir / 2 - 1.4, v.c + v.sir / 2 + 1.4]);
  const segments = (from, do_, d) => { const out = []; let s = from; for (const [a, b] of d.sort((p, q) => p[0] - q[0])) { if (a > s) out.push([s, Math.min(a, do_)]); s = Math.max(s, b); } if (s < do_) out.push([s, do_]); return out; };
  for (const u of STREETS) {
    const X = u.os === 'x', h = X ? 0.04 : 0.056, dl = u.do - u.from, st = (u.from + u.do) / 2;
    const r = add(box(X ? dl : u.sir, h, X ? u.sir : dl, asphalt, X ? st : u.c, h / 2, X ? u.c : st)); r.castShadow = false;
    const d = holes(u), bridge = u.c === 0 && !X ? [[R0 - 1.6, R1 + 1.6]] : [];
    for (const [a, b] of segments(u.from, u.do, [...d])) {
      for (let s = a + 1; s < b - 1; s += 4) add(box(X ? 1.8 : 0.14, 0.03, X ? 0.14 : 1.8, white, X ? s : u.c, h + 0.01, X ? u.c : s)).castShadow = false;
    }
    for (const [a, b] of segments(u.from, u.do, [...d, ...bridge])) {
      const L = b - a, m = (a + b) / 2;
      if (L < 0.5) continue;
      for (const sd of [-1, 1]) {
        const o = (u.sir / 2 + 0.7) * sd;
        add(box(X ? L : 1.4, 0.12, X ? 1.4 : L, sidewalk, X ? m : u.c + o, 0.06, X ? u.c + o : m)).castShadow = false;
        add(box(X ? L : 0.12, 0.16, X ? 0.12 : L, curb, X ? m : u.c + (u.sir / 2 + 0.06) * sd, 0.08, X ? u.c + (u.sir / 2 + 0.06) * sd : m)).castShadow = false;
      }
    }
  }
  // pedestrian crossings
  for (const x of [3, -19, 19]) for (let i = 0; i < 9; i++) add(box(2.4, 0.035, 0.36, white, x, 0.055, 5.45 + i * 0.64)).castShadow = false;
  for (const x of [3, -19, 19]) for (let i = 0; i < 8; i++) add(box(2.4, 0.035, 0.34, white, x, 0.055, 19.85 + i * 0.62)).castShadow = false;
  for (const cx of [-28, 28]) for (const z of [15.25, 30]) for (let i = 0; i < 9; i++) add(box(0.36, 0.035, 2.4, white, cx - 2.6 + i * 0.65, 0.075, z)).castShadow = false;

  // ---------- square with the Brain (paving between the boulevard and the towers) ----------
  surface(-23.6, 23.6, -11.6, 3.6, paving, 0.012);
  for (const x of [-9.6, 9.6]) surface(x - 0.9, x + 0.9, -11.6, -4.5, sidewalk, 0.02); // sidewalks to the towers
  if (controlCenter) { // Control Center courtyard in the middle between the towers, a path from the Brain to the entrance and from the back entrance to Projects
    surface(-6.4, 6.4, -20.6, -11.6, paving, 0.013);
    surface(-0.9, 0.9, -12.3, -6.5, sidewalk, 0.02); surface(-0.9, 0.9, -23.8, -18.1, sidewalk, 0.02);
  } else surface(-0.9, 0.9, -21, -6.5, sidewalk, 0.02);
  const park = new THREE.Mesh(new THREE.CircleGeometry(6.4, 56), grass); park.rotation.x = -Math.PI / 2; park.position.set(0, 0.025, -0.5); park.receiveShadow = true; add(park);
  const bench = (x, z, rot) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; add(g); const d = mat(0xd9cbb3); g.add(box(1.4, 0.08, 0.45, d, 0, 0.42, 0)); g.add(box(1.4, 0.4, 0.06, d, 0, 0.66, -0.22)); g.add(box(0.06, 0.42, 0.4, mat(0x6f7177), -0.6, 0.21, 0)); g.add(box(0.06, 0.42, 0.4, mat(0x6f7177), 0.6, 0.21, 0)); };
  for (const a of [0.8, 2.35, 3.9, 5.45]) bench(Math.sin(a) * 5.6, -0.5 + Math.cos(a) * 5.6, a + Math.PI);
  const flowerM = [0xff6b8a, 0xffc542, 0xb46bff, 0xffffff].map((c) => mat(c)), flowerG = new THREE.SphereGeometry(0.13, 8, 6);
  const bed = (x, z, r) => { const z0 = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.22, 20), mat(0xe6e3da)); z0.position.set(x, 0.11, z); add(z0); for (let i = 0; i < 9; i++) { const k = new THREE.Mesh(flowerG, pick(flowerM)); const a = rnd(0, 6.28), rr = rnd(0, r * 0.75); k.position.set(x + Math.cos(a) * rr, 0.3, z + Math.sin(a) * rr); add(k); } };
  bed(-5.2, -4.6, 0.6); bed(5.2, -4.6, 0.6); bed(-8.5, -9.5, 0.9); bed(8.5, -9.5, 0.9);

  // trees and lamps
  const trunk = mat(0x9b7457), crowns = ([0x7eae69, 0x689d60, 0x93bc77]).map((c) => mat(c, { flatShading: true }));
  const crownG = new THREE.IcosahedronGeometry(0.95, 1), coneG = [0, 1, 2].map((i) => new THREE.ConeGeometry(0.9 - i * 0.22, 0.9, 8)), trunkG = new THREE.BoxGeometry(0.22, 1.1, 0.22);
  const tree = (x, z, v = 1, shadow = true) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(v); add(g);
    const km = new THREE.Mesh(trunkG, trunk); km.position.y = 0.55; km.castShadow = shadow; g.add(km);
    if (Math.random() < 0.65) { const k = new THREE.Mesh(crownG, pick(crowns)); k.position.y = 1.7; k.castShadow = shadow; g.add(k); }
    else for (let i = 0; i < 3; i++) { const k = new THREE.Mesh(coneG[i], pick(crowns)); k.position.y = 1.3 + i * 0.5; k.castShadow = shadow; g.add(k); }
  };
  const glow = glowTex();
  const lampHeadM = mat(0xfff3d6, { emissive: 0xffd88a, emissiveIntensity: 0.15 }); S.lampsHeads.push(lampHeadM);
  const lampGlowM = new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }); S.glows.push({ material: lampGlowM });
  const pillarG = new THREE.BoxGeometry(0.09, 3.2, 0.09), pillarM = mat(0x55575e), headG = new THREE.SphereGeometry(0.2, 12, 8);
  const lamp = (x, z) => {
    const s0 = new THREE.Mesh(pillarG, pillarM); s0.position.set(x, 1.6, z); add(s0);
    const hl = new THREE.Mesh(headG, lampHeadM); hl.position.set(x, 3.25, z); add(hl);
    const s = new THREE.Sprite(lampGlowM); s.scale.set(2.6, 2.6, 1); s.position.set(x, 3.25, z); add(s);
  };
  const outsideIntersections = (x) => Math.abs(Math.abs(x) - 28) > 5 && ((Math.abs(Math.abs(x) - 64) > 5));
  for (let x = -SX + 4; x < SX - 2; x += 9) if (outsideIntersections(x) && outsideIntersections(x + 4.5)) { lamp(x, 4.6); lamp(x + 4.5, 11.4); lamp(x + 2, 18.7); lamp(x + 6.5, 25.3); }
  for (const cx of [-28, 28]) for (let z = -32; z < 48; z += 10) if (Math.abs(z - 8) > 5 && Math.abs(z - 22) > 5 && Math.abs(z - 49) > 5) { lamp(cx - 3.6, z); lamp(cx + 3.6, z + 5); }
  for (let x = -SX + 6; x < SX - 2; x += 12) if (outsideIntersections(x) && Math.abs(x) > 5) { lamp(x, -32.6); lamp(x + 6, 45.4); }
  for (const z of [R0 - 1.5, R1 + 1.5]) for (let x = -SX + 5; x < SX - 3; x += 14) if (Math.abs(x) > 6) lamp(x, z);
  for (const [x, z] of [[-3.2, 4.6], [3.2, 4.6], [-12, 15.3], [12, 15.3]]) { const plural = new THREE.PointLight(0xffc77a, 0, 10, 2); plural.position.set(x, 3.1, z); add(plural); S.pointLights.push(plural); }
  // trees on the square and next to the towers
  for (const [x, z] of [[-6.2, -3.2], [6.2, -3.4], [-12.5, -7.5], [12.5, -7.5], [-21, -7], [21, -7], [-17, -1.5], [17, -1.5]]) tree(x, z, 1.1);
  if (controlCenter) for (const [x, z] of [[-5.6, -12.9], [-5.6, -19.5], [6.0, -19.8]]) tree(x, z, 1.1); // Control Center courtyard (the tree at 6.3, -12.4 removed 2026-11-16, it stood in front of Univerzál)
  for (const sx of [-1, 1]) for (let z = -32; z < -10; z += 4.5) tree(sx * 21.5, z, rnd(0.9, 1.15));
  for (let x = -SX + 4; x < SX - 3; x += 4) if (Math.abs(x) > 5 && ((Math.abs(Math.abs(x) - 28) > 5 && Math.abs(Math.abs(x) - 64) > 5))) tree(x, (R1 - 39.9) / 2, rnd(0.8, 1), true); // waterfront

  // ---------- boulevard: park in the middle between both traffic lanes ----------
  const P0 = 12.4, P1 = 18.1, PZ = (P0 + P1) / 2;
  for (const [a, b] of [[-SX + 1, -32.4], [-23.6, 23.6], [32.4, SX - 1]]) {
    if (b <= a) continue;
    surface(a, b, P0, P1, grass, 0.02);
    surface(a, b, PZ - 0.7, PZ + 0.7, sidewalk, 0.03);
    for (let x = a + 2; x < b - 1; x += 5.5) { if (Math.abs(x) < 3.6 || Math.abs(Math.abs(x) - 19) < 2) continue; tree(x, P0 + 0.85, 0.85); tree(x + 2.7, P1 - 0.85, 0.85); }
  }
  for (const x of [-15, -8, 8, 15]) bench(x, PZ - 1.15, 0);
  for (const x of [-11.5, 11.5]) { bed(x, PZ, 0.7); }
  // fountain on the Brain – Home axis
  A.fountain = buildFountain(add, live, 0, PZ, 2.05);

  // ---------- houses: colored facades by day, windows light up at dusk (emissiveMap) ----------
  const windowDay = windowTex('#ffffff', '#dfe6ea'), lights = lightsWindowsTex();
  const nightWall = new THREE.Color('#30364a');
  const roofM = mat(0xb9b1a5);
  const facadeM = (color, rw, h) => { const tx = (tex) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rw / 10, h / 12); return t; }; const m = new THREE.MeshStandardMaterial({ color: color.clone(), map: tx(windowDay), emissive: 0xffffff, emissiveMap: tx(lights), emissiveIntensity: 0, roughness: 0.85 }); S.houses.push({ m, day: color }); return m; };
  // distant houses share a few materials (less work for the GPU)
  const cheapMats = palette.map((c) => facadeM(new THREE.Color(c), 1, 1)).map((m) => { m.map.repeat.set(0.7, 1.4); m.emissiveMap.repeat.set(0.7, 1.4); return m; });
  const geoHouse = new THREE.BoxGeometry(1, 1, 1);
  const house = (x, z, w, d, h, cheap = false) => {
    if (cheap) { const b = new THREE.Mesh(geoHouse, pick(cheapMats)); b.scale.set(w, h, d); b.position.set(x, h / 2, z); b.receiveShadow = true; add(b); return; }
    const color = new THREE.Color(pick(palette));
    const walls = facadeM(color, w, h), sides = facadeM(color, d, h);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sides, sides, roofM, roofM, walls, walls]); b.position.set(x, h / 2, z); b.castShadow = b.receiveShadow = true; add(b);
    add(box(w + 0.2, 0.2, d + 0.2, roofM, x, h + 0.1, z));
    const r = Math.random();
    if (r < 0.3) { add(box(0.9, 0.6, 0.7, mat(0xcfcfcf), x + rnd(-w / 4, w / 4), h + 0.5, z + rnd(-d / 4, d / 4))); add(box(0.7, 0.45, 0.6, mat(0xcfcfcf), x + rnd(-w / 4, w / 4), h + 0.42, z + rnd(-d / 4, d / 4))); }
    else if (r < 0.45) { const n = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.1, 14), mat(0xb9a58f)); n.position.set(x + w / 4, h + 1.2, z); add(n); const s = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.5, 14), mat(0x9b8a76)); s.position.set(x + w / 4, h + 2.0, z); add(s); for (const [dx, dz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) add(box(0.06, 0.65, 0.06, mat(0x6f7177), x + w / 4 + dx, h + 0.4, z + dz)); }
    else if (r < 0.65) { add(box(w * 0.7, 0.25, d * 0.6, grass, x, h + 0.32, z)); for (let i = 0; i < 3; i++) { const k = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), pick(crowns)); k.position.set(x + rnd(-w / 3, w / 3), h + 0.7, z + rnd(-d / 4, d / 4)); add(k); } }
    else if (r < 0.8) { for (let i = 0; i < 4; i++) { const p = box(1.1, 0.05, 0.7, mat(0x3a4a6a), x - w / 4 + (i % 2) * 1.3, h + 0.35, z - 0.5 + Math.floor(i / 2) * 0.9); p.rotation.x = -0.35; add(p); } }
    else if (r < 0.9) { const s = new THREE.Shape(); s.moveTo(-w / 2 - 0.2, 0); s.lineTo(w / 2 + 0.2, 0); s.lineTo(0, Math.min(2.4, w * 0.35)); s.closePath(); const geo = new THREE.ExtrudeGeometry(s, { depth: d + 0.2, bevelEnabled: false }); geo.translate(0, 0, -(d + 0.2) / 2); const st = new THREE.Mesh(geo, mat(0xcdbfae)); st.position.set(x, h + 0.2, z); st.castShadow = true; add(st); }
    else add(box(0.06, 2.5, 0.06, mat(0x8a8c92), x, h + 1.45, z));
  };
  // block of houses between streets: random sizes, free space = a tree or a yard
  const block = (x0, x1, z0, z1, h0, h1, { p = 0.85, w0 = 5, w1 = 8.5, cheap = false } = {}) => {
    for (let z = z0 + 0.6; z < z1 - 3.5;) {
      const d = Math.min(rnd(w0, w1), z1 - 0.6 - z); if (d < 3.5) break;
      for (let x = x0 + 0.6; x < x1 - 3.5;) {
        const w = Math.min(rnd(w0, w1), x1 - 0.6 - x); if (w < 3.5) break;
        if (Math.random() < p) house(x + w / 2, z + d / 2, w - 0.9, d - 0.9, rnd(h0, h1), cheap);
        else if (!cheap) tree(x + w / 2, z + d / 2, rnd(0.9, 1.25));
        x += w;
      }
      z += d;
    }
  };
  for (const s of [-1, 1]) {
    const [a, b] = s < 0 ? [-SX + 1.5, -32.4] : [32.4, SX - 1.5];
    block(a, b, -32.1, 3.6, 5, 13); block(a, b, 25.9, 44.6, 3.5, 9, { p: 0.75 });
  }
  for (const s of [-1, 1]) for (let x = 7; x < SX - 6; x += 7.5) house(s * x, R0 - 3.6, 5, 3.6, rnd(3, 5.5)); // small houses behind the river
  for (let x = -SX + 4; x < SX - 3; x += 6) if (Math.abs(x) > 6) tree(x, M.Zz + 1.6, rnd(0.8, 1));
  for (const [x, z] of [[-24, 47], [24, 47]]) tree(x, z, 1);

  // ---------- shops by the boulevard (in front of the square, shop windows facing the street) ----------
  for (const [x, title, f] of [[-21.2, tt('app.surroundings.shop.cafe'), '#e2483d'], [-16, tt('app.surroundings.shop.flowers'), '#35c58a'], [-10.8, tt('app.surroundings.shop.books'), '#4f7cff'], [10.8, tt('app.surroundings.shop.bakery'), '#f2a65a'], [16, tt('app.surroundings.shop.gallery'), '#8a6cff'], [21.2, tt('app.surroundings.shop.bistro'), '#ff8fc8']]) {
    const z0 = 1.6, h = rnd(1.9, 2.4), color = new THREE.Color(pick(palette)), tm = mat(color.clone(), { emissive: 0x2a2f45, emissiveIntensity: 0 });
    add(box(4.6, h, 3.4, tm, x, h / 2, z0));
    const om = new THREE.MeshStandardMaterial({ color: 0xd6e6f0, emissive: 0xffc76b, emissiveIntensity: 0 });
    const window = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.3), om); window.position.set(x, 0.95, z0 + 1.71); add(window);
    const zm = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0 }); const zo = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), zm); zo.position.set(x + 1, 1.0, z0 - 1.71); zo.rotation.y = Math.PI; add(zo);
    const mk = box(4.4, 0.08, 0.9, mat(f), x, 1.75, z0 + 2.1); mk.rotation.x = 0.35; add(mk);
    const tab = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(title, { bg: '#ffffff', fg: '#151515', font: '500 44px "JetBrains Mono"', r: 8 }) })); tab.scale.set(2.6, 0.65, 1); tab.position.set(x, h + 0.8, z0); add(tab);
    S.shops.push({ tm, day: color, om, zm });
  }
  for (let i = 0; i < 3; i++) { const x = -22.6 + i * 1.4; const st = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 16), mat(0xffffff)); st.position.set(x, 0.75, 4.0); add(st); add(box(0.05, 0.72, 0.05, mat(0x6f7177), x, 0.38, 4.0)); const sl = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.35, 12), mat(i % 2 ? 0xe2483d : 0xffffff)); sl.position.set(x, 2.0, 4.0); add(sl); add(box(0.03, 1.3, 0.03, mat(0x6f7177), x, 1.4, 4.0)); }
  // stop on the boulevard
  add(box(3, 0.08, 1.2, mat(0xffffff), 10, 2.4, 11.6)); add(box(3, 2.3, 0.05, new THREE.MeshStandardMaterial({ color: 0xdfeaf2, transparent: true, opacity: 0.5 }), 10, 1.2, 12.15)); add(box(0.08, 2.4, 0.08, mat(0x6f7177), 8.55, 1.2, 11.1)); add(box(0.08, 2.4, 0.08, mat(0x6f7177), 11.45, 1.2, 11.1));

  // traffic light
  const hereM = [0x3a1414, 0x3a3214, 0x143a1e].map((c) => new THREE.MeshBasicMaterial({ color: c }));
  for (const z of [4.7, 11.3]) {
    add(box(0.1, 2.6, 0.1, mat(0x55575e), 3.9, 1.3, z)); add(box(0.32, 0.9, 0.28, mat(0x2a2c33), 3.9, 2.85, z));
    hereM.forEach((m, i) => { const l = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), m); l.position.set(3.9, 3.12 - i * 0.27, z + (z < 8 ? 0.15 : -0.15)); if (z > 8) l.rotation.y = Math.PI; add(l); });
  }
  A.trafficLight = { t: 0, hereM };

  // ---------- cars (lights turn on at dusk) ----------
  const CAR_COLORS = [0xffffff, 0x2a2c33, 0xcfd2d6, 0x4f7cff, 0xe2483d, 0xf2a65a];
  const wheelG = new THREE.CylinderGeometry(0.2, 0.2, 0.14, 12), wheelM = mat(0x1c1d22), windowCarM = new THREE.MeshStandardMaterial({ color: 0x2e3442, roughness: 0.2 });
  const frontM = new THREE.MeshBasicMaterial({ color: 0xfff2c4 }), backM = new THREE.MeshBasicMaterial({ color: 0xff3b30 }), lightG = new THREE.CircleGeometry(0.09, 10);
  const glowCarM = new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  function auto(strip, autobus = false) {
    const g = new THREE.Group(), dl = autobus ? 4.2 : 1.9, f = autobus ? (0xf2a65a) : pick(CAR_COLORS);
    g.add(box(dl, autobus ? 1.0 : 0.5, autobus ? 1.15 : 0.95, mat(f, { roughness: 0.4 }), 0, autobus ? 0.75 : 0.45, 0));
    if (!autobus) g.add(box(1.0, 0.42, 0.85, windowCarM, -0.1, 0.9, 0));
    else g.add(box(dl - 0.4, 0.4, 1.17, windowCarM, 0, 1.0, 0));
    for (const [dx, dz] of [[-dl / 2 + 0.4, -0.48], [dl / 2 - 0.4, -0.48], [-dl / 2 + 0.4, 0.48], [dl / 2 - 0.4, 0.48]]) { const k = new THREE.Mesh(wheelG, wheelM); k.rotation.x = Math.PI / 2; k.position.set(dx, 0.2, dz); g.add(k); }
    const sv = new THREE.Group(); g.add(sv); S.lightsCars.push(sv); sv.visible = false;
    for (const dz of [-0.3, 0.3]) {
      const s = new THREE.Mesh(lightG, frontM); s.position.set(dl / 2 + 0.01, 0.5, dz); s.rotation.y = Math.PI / 2; sv.add(s);
      const z2 = new THREE.Sprite(glowCarM); z2.position.set(dl / 2 + 0.2, 0.5, dz); sv.add(z2);
      const zad = new THREE.Mesh(lightG, backM); zad.position.set(-dl / 2 - 0.01, 0.5, dz); zad.rotation.y = -Math.PI / 2; zad.scale.setScalar(0.8); sv.add(zad);
    }
    add(withoutShadow(g)); live.add(g);
    const a = { g, strip, speed: autobus ? 3 : rnd(3.5, 6), dl, position: 0 }; A.car.push(a); return a;
  }
  const zDo = 52.4;
  const stripes = [
    { os: 'x', c: 6.6, direction: 1, n: 4, here: true }, { os: 'x', c: 9.4, direction: -1, n: 4, here: true, bus: true },
    { os: 'x', c: 20.8, direction: 1, n: 3 }, { os: 'x', c: 23.2, direction: -1, n: 3 },
    { os: 'x', c: -37.2, direction: 1, n: 2 }, { os: 'x', c: -34.8, direction: -1, n: 2 },
    { os: 'x', c: 47.6, direction: 1, n: 2 }, { os: 'x', c: 50.4, direction: -1, n: 2, bus: true },
    { os: 'z', c: -29.4, direction: 1, n: 3, from: -36, do: zDo }, { os: 'z', c: -26.6, direction: -1, n: 3, from: -36, do: zDo },
    { os: 'z', c: 26.6, direction: 1, n: 3, from: -36, do: zDo }, { os: 'z', c: 29.4, direction: -1, n: 3, from: -36, do: zDo },
    { os: 'z', c: -1.2, direction: -1, n: 1, from: M.Zz + 2, do: -36 }, { os: 'z', c: 1.2, direction: 1, n: 1, from: M.Zz + 2, do: -36 },
  ];
  for (const p of stripes) { if (p.os === 'x') { p.from = -SX; p.do = SX; } for (let k = 0; k < p.n; k++) { const a = auto(p, p.bus && k === 0); a.position = p.from + (k + rnd(0, 0.6)) * ((p.do - p.from) / p.n); } }

  // ---------- pedestrians: boulevard sidewalks, park in the middle, front street ----------
  const FL = ['#ff8a65', '#7aa2ff', '#ffc542', '#8fd9a8', '#c9a8ff', '#ff9fb2', '#9aa0aa'];
  const pedestrian = (z, min, max) => { const ch = figure(pick(FL), true); ch.scale.setScalar(0.62); add(withoutShadow(ch)); live.add(ch); A.people.push({ ch, z: z + rnd(-0.25, 0.25), x: rnd(min, max), direction: Math.random() < 0.5 ? 1 : -1, v: rnd(0.8, 1.4), min, max }); };
  for (let i = 0; i < 14; i++) pedestrian(i % 2 ? 11.7 : 4.3, -SX + 6, SX - 6);
  for (let i = 0; i < 8; i++) pedestrian(PZ, -23, 23);
  for (let i = 0; i < 6; i++) pedestrian(i % 2 ? 18.8 : 25.2, -SX + 6, SX - 6);
  for (let i = 0; i < 5; i++) pedestrian(45.3, -SX + 6, SX - 6);
  for (let i = 0; i < 4; i++) pedestrian(i % 2 ? R1 + 1.0 : -32.8, -SX + 6, SX - 6);
  for (let i = 0; i < 2; i++) { const ch = figure(i ? '#4f7cff' : '#e2483d', true); ch.scale.setScalar(0.62); add(withoutShadow(ch)); live.add(ch); A.people.push({ ch, transition: true, x: 2.7 + i * 0.6, z: i ? 11.6 : 4.4, direction: i ? -1 : 1, v: 1.1 }); }

  // ---------- boats on the river, in the Diorama also on the sea by the pier ----------
  const boat = (color, withSail) => {
    const g = new THREE.Group(), tm = mat(color, { roughness: 0.5 });
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.45, 0.9), tm); t2.position.y = 0.15; t2.castShadow = true; g.add(t2);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 4), tm); nose.rotation.z = -Math.PI / 2; nose.rotation.x = Math.PI / 4; nose.scale.set(1, 1, 0.75); nose.position.set(1.48, 0.15, 0); g.add(nose);
    g.add(box(2.0, 0.06, 0.8, mat(0xd9b48a), 0, 0.4, 0));
    if (withSail) {
      g.add(box(0.06, 2.2, 0.06, mat(0x8a6a4f), 0.1, 1.5, 0));
      const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0, 1.9); s.lineTo(-1.2, 0); s.closePath();
      const sail = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.7 })); sail.position.set(0.05, 0.55, 0); sail.castShadow = true; g.add(sail);
    } else { g.add(box(0.7, 0.45, 0.6, mat(0xffffff), -0.3, 0.62, 0)); g.add(box(0.5, 0.2, 0.62, windowCarM, -0.3, 0.72, 0)); }
    add(withoutShadow(g)); live.add(g); return g;
  };
  const LFAR = [0xffffff, 0xe2483d, 0x4f7cff, 0xf2a65a];
  for (let i = 0; i < (4); i++) A.lode.push({ g: boat(LFAR[i % 4], i % 2 === 0), type: 'river', x: rnd(-rX * 0.6, rX * 0.6), z: M.river + (i % 2 ? 1.6 : -1.6), direction: i % 2 ? 1 : -1, v: rnd(1.2, 2), f: rnd(0, 6) });
  

  // ---------- clouds and birds ----------
  for (let i = 0; i < 10; i++) {
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.95 });
    for (let k = 0; k < 5; k++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(1.2, 2.2), 0), m); s.position.set(k * 1.6 - 3, rnd(-0.3, 0.6), rnd(-0.8, 0.8)); g.add(s); }
    const down = i < 4; // a few clouds under the island, so it is visible that it floats
    g.position.set(rnd(-SX, SX), down ? rnd(-26, -12) : rnd(40, 52), down ? (i % 2 ? M.Zp + rnd(4, 14) : M.Zz - rnd(4, 14)) : rnd(-40, 30)); const sc = rnd(0.9, 1.4); g.scale.set(sc, sc * 0.5, sc); add(g); live.add(g);
    A.clouds.push({ g, v: rnd(0.4, 0.9) }); S.clouds.push(m);
  }
  const birdM = new THREE.MeshBasicMaterial({ color: 0x3a3c44, side: THREE.DoubleSide }), wings = [], kdl = new THREE.Group(); add(kdl); live.add(kdl); kdl.visible = false;
  for (let i = 0; i < 6; i++) { const v = new THREE.Group(); v.position.set(-i * 0.9 * (i % 2 ? 1 : -0.6), 0, i * 0.7); kdl.add(v); for (const s of [-1, 1]) { const k = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.18), birdM); k.position.x = 0.3 * s; const p = new THREE.Group(); p.add(k); p.userData.s = s; v.add(p); wings.push(p); } }

  const whiteColor = new THREE.Color(0xffffff), cloudNight = new THREE.Color(0x6a6f8a), cloudGold = new THREE.Color(0xffc9a8);
  for (const x of [...A.car, ...A.clouds, ...A.lode]) merge(x.g); // v12c: parts of a car, cloud and boat move together, one piece per material is enough
  controlCenter?.staticParts({ add, M: { curb, pillarM, paving } });
  merge(root, live); freeze(root, live); // v12c: static objects merged by material
  return {
    // sets everything that depends on the time of day (called several times per second)
    time(s) {
      const l = s.lamps;
      for (const m of S.lampsHeads) m.emissiveIntensity = 0.15 + 1.3 * l;
      for (const z of S.glows) z.material.opacity = l;
      for (const p of S.pointLights) p.intensity = 18 * l;
      for (const { m, day } of S.houses) { m.color.copy(day).lerp(nightWall, s.night * 0.85); m.emissiveIntensity = 1.15 * l; }
      for (const o of S.shops) { o.tm.color.copy(o.day).lerp(nightWall, s.night * 0.6); o.tm.emissiveIntensity = s.night; o.om.emissiveIntensity = 0.8 * l; o.zm.opacity = l; }
      for (const v of S.water) v.m.color.copy(v.day).lerp(v.night, s.night * 0.85);
      ripplesM.opacity = 0.35 - 0.2 * s.night;
      for (const sv of S.lightsCars) sv.visible = l > 0.45;
      asphalt.color.copy(asphaltDay).lerp(asphaltNight, s.night * 0.7);
      for (const m of S.clouds) { m.color.copy(whiteColor).lerp(cloudGold, s.gold * 0.7).lerp(cloudNight, s.night); m.opacity = 0.95 - 0.35 * s.night; }
      birdM.color.set(s.night > 0.5 ? 0xb8c0e0 : 0x3a3c44);
    },
    update(dt, t) {
      const Sm = A.trafficLight; Sm.t += dt;
      const cycle = Sm.t % 17, phase = cycle < 9 ? 'green' : cycle < 11 ? 'yellow' : 'red';
      Sm.hereM[0].color.set(phase === 'red' ? 0xff3b30 : 0x3a1414); Sm.hereM[1].color.set(phase === 'yellow' ? 0xffc542 : 0x3a3214); Sm.hereM[2].color.set(phase === 'green' ? 0x34d17a : 0x143a1e);
      for (const a of A.car) {
        const { from, do: dO } = a.strip;
        let v = a.speed;
        if (a.strip.here && phase !== 'green') { const stop = a.strip.direction > 0 ? 0.8 : 5.2, ago = (stop - a.position) * a.strip.direction; if (ago > 0 && ago < 2.5 + a.dl / 2) v = 0; }
        for (const b of A.car) { if (b === a || b.strip !== a.strip) continue; const spacing = (b.position - a.position) * a.strip.direction; if (spacing > 0 && spacing < (a.dl + b.dl) / 2 + 0.9) { v = 0; break; } }
        a.position += v * a.strip.direction * dt; if (a.position > dO + 3) a.position = from - 3; if (a.position < from - 3) a.position = dO + 3;
        if (a.strip.os === 'x') { a.g.position.set(a.position, 0, a.strip.c); a.g.rotation.y = a.strip.direction > 0 ? 0 : Math.PI; }
        else { a.g.position.set(a.strip.c, a.strip.c === -1.2 || a.strip.c === 1.2 ? (a.position > R0 - 1.6 && a.position < R1 + 1.6 ? 0.22 : 0) : 0, a.position); a.g.rotation.y = a.strip.direction > 0 ? -Math.PI / 2 : Math.PI / 2; }
        a.g.visible = a.position > from + 0.5 && a.position < dO - 0.5;
      }
      for (const p of A.people) {
        if (p.transition) {
          if (phase === 'red' && cycle > 11.5 && cycle < 16.3) { p.z += p.v * p.direction * dt; animate(p.ch, 'walks', t); p.ch.rotation.y = p.direction > 0 ? 0 : Math.PI; if ((p.direction > 0 && p.z > 11.6) || (p.direction < 0 && p.z < 4.4)) { p.z = p.direction > 0 ? 11.6 : 4.4; p.direction *= -1; } }
          else animate(p.ch, 'none', t);
          p.ch.position.set(p.x, 0.12, p.z); continue;
        }
        p.x += p.v * p.direction * dt; if (p.x > p.max || p.x < p.min) p.direction *= -1;
        // v12: pedestrians in the alley walk around the fountain in an arc (previously they walked through the water)
        let zz = p.z, rot = p.direction > 0 ? Math.PI / 2 : -Math.PI / 2; const RF = 2.75;
        if (Math.abs(p.z - PZ) < 0.6 && Math.abs(p.x) < RF) { p.bypasses ||= Math.random() < 0.5 ? 1 : -1; const dz = Math.sqrt(RF * RF - p.x * p.x); zz = PZ + p.bypasses * dz; rot = Math.atan2(p.direction, -p.bypasses * p.direction * p.x / Math.max(dz, 0.3)); }
        p.ch.position.set(p.x, 0.12, zz); p.ch.rotation.y = rot; animate(p.ch, 'walks', t);
      }
      for (const l of A.lode) {
        const swing = Math.sin(t * 1.6 + l.f);
        if (l.type === 'river') { l.x += l.v * l.direction * dt; if (l.x > rX - 3) l.x = -rX + 3; if (l.x < -rX + 3) l.x = rX - 3; l.g.position.set(l.x, WATER_Y + 0.05 + swing * 0.04, l.z); l.g.rotation.set(swing * 0.03, l.direction > 0 ? 0 : Math.PI, 0); l.g.visible = Math.abs(l.x) < rX - 2; }
        else if (l.type === 'anchor') { l.g.position.set(l.x, -0.82 + swing * 0.05, l.z); l.g.rotation.set(swing * 0.05, l.rot, swing * 0.03); }
        else { l.a += l.v * dt; l.g.position.set(l.cx + Math.cos(l.a) * l.r, -0.82 + swing * 0.05, l.cz + Math.sin(l.a) * l.r * 0.5); l.g.rotation.set(swing * 0.04, -l.a + (l.v > 0 ? -Math.PI / 2 : Math.PI / 2), 0); }
      }
      ripples.position.x = Math.sin(t * 0.3) * 1.5; A.waterfallT.offset.y = (t * 0.6) % 1;
      A.fountain?.update(t);
      for (const m of A.clouds) { m.g.position.x += m.v * dt; if (m.g.position.x > SX + 10) m.g.position.x = -SX - 10; }
      A.birdT -= dt;
      if (!kdl.visible && A.birdT <= 0) { kdl.visible = true; kdl.position.set(-SX - 5, rnd(18, 24), rnd(-12, 20)); }
      if (kdl.visible) { kdl.position.x += dt * 6; kdl.position.y += Math.sin(t) * dt * 0.3; for (const k of wings) k.rotation.z = Math.sin(t * 12) * 0.6 * k.userData.s; if (kdl.position.x > SX + 8) { kdl.visible = false; A.birdT = rnd(14, 26); } }
    },
  };
}

export const GLASS_OPACITY = 0.42;
export const PILLAR = new THREE.BoxGeometry(0.08, HEIGHT - 0.02, 0.08);
let _env = null;
export function envTex() { if (!_env) { const pm = new THREE.PMREMGenerator(renderer); _env = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); } return _env; }

// sky pinned to the camera: the sun and moon move in an arc from left to right by time, stars at night
export function cameraSky(camera) {
  // 2026-11-10: the sky is far behind the city (4.2× farther), buildings cover the sun and moon and the disc is not drawn over the tower facades
  const g = new THREE.Group(); g.scale.setScalar(4.2); camera.add(g);
  const disk = (core, margin, craters) => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    const gl = x.createRadialGradient(128, 128, 30, 128, 128, 128); gl.addColorStop(0, margin[0]); gl.addColorStop(0.45, margin[1]); gl.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gl; x.fillRect(0, 0, 256, 256); x.fillStyle = core; x.beginPath(); x.arc(128, 128, 44, 0, 7); x.fill();
    if (craters) { x.fillStyle = 'rgba(214,200,160,0.55)'; for (const [cx, cy, r] of [[112, 116, 9], [140, 138, 12], [124, 150, 6], [146, 110, 5], [104, 140, 4]]) { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); } }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  };
  const sun = disk('#fff8e0', ['rgba(255,226,140,0.9)', 'rgba(255,200,100,0.35)'], false);
  const month = disk('#fff6dc', ['rgba(255,244,214,0.55)', 'rgba(255,236,190,0.18)'], true);
  g.add(sun); g.add(month);
  const N = 260, position = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    position[i * 3] = rnd(-110, 110); position[i * 3 + 1] = rnd(-4, 50); position[i * 3 + 2] = -200;
  }
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(position, 3));
  const hv = new THREE.Points(gg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  g.add(hv);
  // 2026-11-10 (3): the sun and moon have a fixed place in the sky on the right, low above the horizon, like real ones.
  // In the normal view they are not visible, they show when you rotate the city to the right and tilt the camera to the horizon. They are in the world (not by
  // the camera), far behind the city (D = 700, far 900), buildings cover them. The position is kept near the camera (like the sky), so
  // zooming in on them has no effect, only the viewing direction.
  const sceneRoot = camera.parent, D = 700, SIZE = 92, yaw0 = Math.atan2(-22, -147); // base camera (29, 82, 158) → target (7, -3, 11)
  const DIRECTION = { from: -1.2, po: -1.75 };  // angle from the base view direction (rad, negative = right): morning → evening
  const HEIGHT = { horizon: 1.5, top: 5.5 }; // degrees above the horizontal; a tilted camera sees at most about 11° above the horizon (the top of the screen is under the bar)
  g.remove(sun); g.remove(month); sceneRoot.add(sun); sceneRoot.add(month);
  for (const sp of [sun, month]) { sp.material.depthTest = true; sp.material.toneMapped = false; sp.renderOrder = 0; } // without tone mapping: otherwise a white sun on a light sky near the horizon is gray and not visible
  const status = { s: 0.5, m: 0.5, ms: 1 }, _d = new THREE.Vector3();
  const place = (sp, q, scale, lift) => {
    const qq = Math.min(1, Math.max(0, q)), yaw = yaw0 + DIRECTION.from + (DIRECTION.po - DIRECTION.from) * qq;
    const el = (HEIGHT.horizon + lift + (HEIGHT.top - HEIGHT.horizon) * Math.sin(qq * Math.PI)) * Math.PI / 180;
    _d.set(Math.cos(el) * Math.sin(yaw), Math.sin(el), Math.cos(el) * Math.cos(yaw));
    sp.position.copy(camera.position).addScaledVector(_d, D); sp.scale.set(SIZE * scale, SIZE * scale, 1); sp.visible = true;
  };
  const white = new THREE.Color(0xffffff), orange = new THREE.Color(0xffa25a);
  return {
    time(s) {
      status.s = s.p; status.ms = 1 + 0.35 * (1 - smooth(0, 15, s.e)); // near the horizon the sun is bigger and more orange
      sun.material.color.copy(white).lerp(orange, 1 - smooth(0, 14, s.e));
      sun.material.opacity = smooth(-3, 1, s.e);
      status.m = s.pn; month.material.opacity = s.night;
      hv.material.opacity = 0.85 * s.night;
    },
    update() { // every frame: direction and offset toward the camera, nothing extra is drawn
      if (sun.material.opacity > 0) place(sun, status.s, status.ms, 0); else sun.visible = false;
      if (month.material.opacity > 0) place(month, status.m, 1, 1); else month.visible = false;
    },
  };
}
