// floor.js – Scene 2: tower floor (lead's office, desks, kanban, kitchenette), draws from WORLD.
// Created by splitting the prototype public/dizajn-v12d.html (phase 1). Module map: brain Projekty/mesto-agentov/technika.md.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { rnd, pick } from './utils.js';
import { t as _t } from './i18n.js';
import { simTime, dayState } from './daylight.js';
import { WORLD } from './world.js';
import { animate, box, interiorLights, mat, mouse, figure, ray, renderer, skin, texture } from './scene-base.js';
import { selectAgent } from './panel.js';
import { CONTROL_CENTER, floorLabel } from './control-center.js';

// =====================================================================
// SCENE 2: FLOOR v4 – a compact, furnished office (draws from the shared WORLD)
// =====================================================================
export const SCALE = 1.2;                 // the whole interior is 20 % larger than in v3
export const W = 14.2, D = 9;              // local units (in the world 17 × 10.8)
export const PLACES = [[-1.9, -1.7], [0.6, -1.7], [3.1, -1.7], [-1.9, 1.4], [0.6, 1.4], [3.1, 1.4]];
const COFFEE = new THREE.Vector3(4.9, 0, -3.15), CORRIDOR = -3.5;
const hashStr = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

export function screens() {
  return ['code', 'text', 'pdf', 'green'].map((kind) => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = kind === 'pdf' ? '#f4f4f0' : kind === 'green' ? '#0f1a14' : '#1b1e27'; g.fillRect(0, 0, 128, 256);
    for (let y = 8; y < 256; y += 12) {
      g.fillStyle = kind === 'code' ? pick(['#7aa2ff', '#8ff0bd', '#ffc542', '#c8cde0']) : kind === 'pdf' ? '#9a9ca5' : kind === 'green' ? pick(['#3ddc84', '#3ddc84', '#ff6b5e']) : '#c8cde0';
      g.fillRect(kind === 'code' && Math.random() < 0.4 ? 20 : 8, y, 20 + Math.random() * 90, 5);
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 0.5); t.colorSpace = THREE.SRGBColorSpace; return t;
  });
}
function flooringTex() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#f3efe7'; g.fillRect(0, 0, 512, 512); for (let y = 0; y < 512; y += 64) {
      const shift = (y / 64) % 2 ? 128 : 0;
      for (let x = -256; x < 512; x += 256) { g.fillStyle = pick(['#f1ece3', '#f4f0e8', '#efeae0']); g.fillRect(x + shift + 1, y + 1, 254, 62); }
      g.fillStyle = '#e4ded3'; g.fillRect(0, y, 512, 1.5);
    }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(W / 3.5, D / 3.5); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function boardTex(building) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 256);
  g.lineWidth = 3; g.lineCap = 'round'; g.font = '28px "Comic Sans MS", "Marker Felt", cursive';
  if (/^(Škola|Štúdium|Study)$/.test(building)) {
    g.fillStyle = '#2d5bd7'; g.fillText('∀n ∈ ℕ : P(n) ⇒ P(n+1)', 24, 56);
    g.fillStyle = '#d23f3f'; g.fillText('Σ k = n(n+1) / 2', 24, 112);
    g.fillStyle = '#1f8a5b'; g.fillText('A ⊆ B ⇔ ∀x (x∈A ⇒ x∈B)', 24, 168);
    g.strokeStyle = '#d23f3f'; g.beginPath(); g.arc(420, 100, 40, 0, 6.3); g.stroke();
  } else if (building === _t('app.city.controlCenter')) { // Control Center: latest commits of the city app
    g.fillStyle = '#151515'; g.font = '600 22px "JetBrains Mono", monospace'; g.fillText('git log --oneline', 24, 40);
    const f = ['#2d5bd7', '#1f8a5b', '#d23f3f', '#8a6cff', '#c2621f'];
    (CONTROL_CENTER.status?.log?.length ? CONTROL_CENTER.status.log.slice(0, 5) : [{ h: '·······', s: _t('app.floor.appCity') }]).forEach((c, i) => { g.font = '22px "Marker Felt", cursive'; g.fillStyle = f[i]; g.fillText(c.h, 24, 80 + i * 36); g.fillStyle = '#333'; g.fillText(c.s.length > 26 ? c.s.slice(0, 25) + '…' : c.s, 128, 80 + i * 36); });
  } else {
    const cube = (x, y, t, f) => { g.strokeStyle = f; g.strokeRect(x, y, 120, 54); g.fillStyle = f; g.font = '22px "Marker Felt", cursive'; g.fillText(t, x + 12, y + 34); };
    cube(24, 40, _t('app.floor.whiteboard.list'), '#2d5bd7'); cube(196, 40, _t('app.floor.whiteboard.form'), '#8a6cff'); cube(368, 40, _t('app.floor.whiteboard.action'), '#1f8a5b'); cube(196, 160, _t('app.floor.whiteboard.report'), '#d23f3f');
    g.strokeStyle = '#555'; g.beginPath(); g.moveTo(144, 67); g.lineTo(196, 67); g.moveTo(316, 67); g.lineTo(368, 67); g.moveTo(256, 94); g.lineTo(256, 160); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function plant(g, x, z, v = 1, y0 = 0) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * v, 0.17 * v, 0.4 * v, 14), mat(skin.flowerPot)); p.position.set(x, y0 + 0.2 * v, z); p.castShadow = true; g.add(p);
  for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.27 * v, 0), mat(skin.plant, { flatShading: true })); l.position.set(x + rnd(-0.14, 0.14) * v, y0 + (0.58 + i * 0.2) * v, z + rnd(-0.14, 0.14) * v); l.castShadow = true; g.add(l); }
}
export const BOOKS = ['#e2483d', '#4f7cff', '#ffc542', '#35c58a', '#8a6cff', '#ff8fc8', '#26272c', '#f2a65a'];
export function shelf(g, x, z, rot, w = 1.4, h = 2.0) {
  const p = new THREE.Group(); p.position.set(x, 0, z); p.rotation.y = rot; g.add(p);
  const dayMonth = mat(0xe9e5dc);
  p.add(box(w, h, 0.36, dayMonth, 0, h / 2, 0));
  const interior = mat(0xf6f3ec);
  const police = 4, vy = (h - 0.1) / police;
  for (let i = 0; i < police; i++) {
    const y0 = 0.08 + i * vy;
    p.add(box(w - 0.08, vy - 0.06, 0.02, interior, 0, y0 + vy / 2, 0.17)); // back wall of the compartment
    let xx = -w / 2 + 0.1;
    while (xx < w / 2 - 0.15) {
      if (Math.random() < 0.12) { xx += 0.2; continue; }
      const kw = rnd(0.05, 0.09), kh = rnd(vy * 0.55, vy * 0.85);
      const k = box(kw, kh, 0.24, mat(new THREE.Color(pick(BOOKS)).lerp(new THREE.Color(0xffffff), 0.1)), xx + kw / 2, y0 + kh / 2 + 0.01, 0.05);
      k.rotation.z = Math.random() < 0.1 ? 0.25 : 0; p.add(k); xx += kw + 0.012;
    }
  }
  return p;
}

export function buildDesk(g, x, z, big, image, color, role, occupied = true) {
  const sir = big ? 2.3 : 1.7, ms = mat(skin.desk, { roughness: 0.6 }), mn = mat(skin.legs), mm = mat(skin.monitor, { roughness: 0.4 });
  const r = hashStr(role + x + z);
  g.add(box(sir, 0.07, 0.85, ms, x, 0.74, z));
  g.add(box(0.06, 0.7, 0.78, mn, x - sir / 2 + 0.06, 0.37, z)); g.add(box(0.42, 0.55, 0.62, mn, x + sir / 2 - 0.27, 0.3, z - 0.05)); // container with drawers
  // mat in the agent's color
  const pd = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.42), mat(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55), { roughness: 0.9 })); pd.rotation.x = -Math.PI / 2; pd.position.set(x - 0.1, 0.776, z - 0.12); g.add(pd);
  // main monitor (toward the agent)
  g.add(box(0.06, 0.25, 0.06, mm, x, 0.9, z + 0.22)); g.add(box(big ? 0.95 : 0.78, 0.46, 0.05, mm, x, 1.13, z + 0.2));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(big ? 0.87 : 0.7, 0.38), new THREE.MeshBasicMaterial({ map: image[r % 3] })); scr.position.set(x, 1.13, z + 0.17); scr.rotation.y = Math.PI; g.add(scr);
  const glow = new THREE.MeshBasicMaterial({ color: 0xcfd3d8 }); const pass = new THREE.Mesh(new THREE.PlaneGeometry(big ? 0.6 : 0.46, 0.05), glow); pass.position.set(x, 0.96, z + 0.226); g.add(pass);
  // sticky notes on the back of the monitor
  for (let i = 0; i < 1 + (r % 3); i++) { const lp = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ color: pick(['#ffe066', '#ff9fb2', '#9fe0ff']) })); lp.position.set(x + 0.28 - i * 0.12, 1.25 - (i % 2) * 0.08, z + 0.227); lp.rotation.z = rnd(-0.2, 0.2); g.add(lp); }
  // side monitor: the screen turned at an angle toward the agent (its back is toward you like the main monitor)
  const green = /Verity|Git|Developer|Tester/.test(role);
  if (occupied && (big || r % 3 !== 0 || green)) {
    const bx = x - sir / 2 + 0.38, bz = z + 0.1, ROT = Math.PI - 0.5;
    g.add(box(0.05, 0.22, 0.05, mm, bx, 0.88, bz));
    const bm = box(0.6, 0.38, 0.04, mm, bx, 1.08, bz); bm.rotation.y = ROT; g.add(bm);
    const bs = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.32), new THREE.MeshBasicMaterial({ map: image[green ? 3 : (r + 1) % 3] })); bs.position.set(bx + Math.sin(ROT) * 0.025, 1.08, bz + Math.cos(ROT) * 0.025); bs.rotation.y = ROT; g.add(bs);
  }
  g.add(box(0.5, 0.025, 0.16, mm, x, 0.79, z - 0.12));
  // small things on the desk
  const mug = () => { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 12), mat(pick([0xff8a65, 0x4f8cff, 0xffffff, 0x35c58a]))); h.position.set(x + sir / 2 - 0.22, 0.83, z - 0.18); h.castShadow = true; g.add(h); };
  const books = () => { for (let i = 0; i < 3; i++) g.add(box(0.32 - i * 0.03, 0.05, 0.24, mat(pick(BOOKS)), x + sir / 2 - 0.3, 0.8 + i * 0.05, z + 0.18)); };
  const lamp = () => { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 6), mat(0x888a90)); st.position.set(x + sir / 2 - 0.15, 0.98, z + 0.25); g.add(st); const t = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.13, 16, 1, true), mat(0x26272c, { side: THREE.DoubleSide })); t.position.set(x + sir / 2 - 0.22, 1.18, z + 0.2); t.rotation.z = 0.6; g.add(t); };
  if (r % 2 === 0) mug(); if (r % 3 === 1) books(); if (r % 4 === 2) lamp();
  if (r % 5 === 3 || !occupied) plant(g, x + sir / 2 - 0.3, z + 0.12, 0.45, 0.77);
  if (/GoodNotes|PDF|Dokument/.test(role)) { g.add(box(0.55, 0.32, 0.45, mat(0xf1f0eb), x + sir / 2 + 0.45, 0.16, z + 0.15)); g.add(box(0.4, 0.02, 0.3, mat(0xffffff), x + sir / 2 + 0.45, 0.33, z + 0.15)); }
  if (/Prepis/.test(role)) { const s = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 8, 20, Math.PI), mat(0x26272c)); s.position.set(x + 0.45, 0.8, z + 0.05); s.rotation.x = -Math.PI / 2; g.add(s); }
  if (/Skúšač|Tester/.test(role)) for (let i = 0; i < 4; i++) { const p = box(0.3, 0.008, 0.4, mat(0xffffff), x + 0.45 + rnd(-0.02, 0.02), 0.785 + i * 0.01, z + 0.05); p.rotation.y = rnd(-0.15, 0.15); g.add(p); }
  // chair (tucked in when the spot is free)
  const sm = mat(skin.chair, { roughness: 0.6 }), oz = occupied ? 0 : 0.35;
  g.add(box(0.56, 0.08, 0.52, sm, x, 0.45, z - 0.82 + oz)); g.add(box(0.56, 0.6, 0.07, sm, x, 0.8, z - 1.1 + oz));
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8), mat(0x888a90)); leg.position.set(x, 0.22, z - 0.82 + oz); g.add(leg);
  return { seat: new THREE.Vector3(x, 0.47, z - 0.78), deskPosition: new THREE.Vector3(x, 1.0, z), glow, stand: new THREE.Vector3(x + sir / 2 + 0.4, 0, z - 0.3), alley: x + 1.25 };
}

function whiteboard(t, n, agents) {
  const c = t.image, g = c.getContext('2d'), T = skin.whiteboard;
  g.fillStyle = T.bg; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = '#00000018'; g.lineWidth = 4; g.strokeRect(2, 2, c.width - 4, c.height - 4);
  g.fillStyle = T.ink; g.font = `600 34px ${T.font}`; g.textAlign = 'left'; g.fillText(_t('app.floor.tasksN', { n }), 28, 52);
  const st = [['rad', _t('app.floor.pillar.rad')], ['doing', _t('app.floor.pillar.doing')], ['pending', _t('app.floor.pillar.pending')], ['done', _t('app.floor.pillar.done')]], sw = (c.width - 56) / 4;
  const ul = WORLD.tasks.filter((u) => u.p === n);
  st.forEach(([k, nz], i) => {
    const x = 28 + i * sw; g.fillStyle = k === 'pending' ? '#e2483d' : T.muted; g.font = `600 21px ${T.font}`; g.fillText(nz.toUpperCase(), x, 96);
    ul.filter((u) => u.column === k || (k === 'doing' && u.column === 'flies')).slice(-5).forEach((u, j) => {
      const y = 112 + j * 70; g.fillStyle = T.card; g.beginPath(); g.roundRect(x, y, sw - 16, 60, 10); g.fill();
      g.fillStyle = agents[u.a].color; g.beginPath(); g.roundRect(x, y, 8, 60, [10, 0, 0, 10]); g.fill();
      g.fillStyle = T.ink; g.font = `600 19px ${T.font}`; g.fillText(u.text.length > 22 ? u.text.slice(0, 21) + '…' : u.text, x + 18, y + 27);
      g.fillStyle = T.muted; g.font = `500 16px ${T.font}`; g.fillText(agents[u.a].name, x + 18, y + 49);
    });
  });
  t.needsUpdate = true;
}

export function buildFloor(n) {
  const P = WORLD.floors.get(n), def = P.def, school = /^(Škola|Štúdium|Study)$/.test(P.building);
  const scene = new THREE.Scene(); const sv = interiorLights(scene, 14);
  const g = new THREE.Group(); g.scale.setScalar(SCALE); scene.add(g);
  const image = screens(), click = [];

  // slab with a cut and the floor
  const cut = mat(skin.cut, { roughness: 1 }), under = mat(0xffffff, { roughness: 0.95, map: flooringTex() });
  const board = new THREE.Mesh(new THREE.BoxGeometry(W, 0.6, D), [cut, cut, under, cut, cut, cut]); board.position.y = -0.3; board.receiveShadow = true; g.add(board);
  
  // carpet under the team
  const kob = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 5.4), mat(0xe9e6dd, { roughness: 1 })); kob.rotation.x = -Math.PI / 2; kob.position.set(0.6, 0.006, -0.15); kob.receiveShadow = true; g.add(kob);
  const kobMargin = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(7.3, 5.1)), new THREE.LineBasicMaterial({ color: 0xd5d1c6 })); kobMargin.rotation.x = -Math.PI / 2; kobMargin.position.set(0.6, 0.01, -0.15); g.add(kobMargin);

  // walls
  const sm = mat(skin.wall, { roughness: 0.9 });
  g.add(box(W, 2.7, 0.25, sm, 0, 1.35, -D / 2 + 0.125)); g.add(box(0.25, 2.7, D, sm, -W / 2 + 0.125, 1.35, 0));
  g.add(box(W, 0.1, 0.27, mat(0xe2dfd6), 0, 0.05, -D / 2 + 0.135)); // baseboard
  const ZS = -D / 2 + 0.26; // faces of the back wall
  const om = new THREE.MeshStandardMaterial({ color: skin.window, emissive: skin.window, emissiveIntensity: 0.3, roughness: 0.2 });
  const window = (x, w) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.3), om); o.position.set(x, 1.65, ZS); g.add(o); g.add(box(w + 0.1, 0.06, 0.08, mat(0xffffff), x, 0.98, ZS + 0.02)); g.add(box(0.04, 1.3, 0.03, mat(0xffffff), x, 1.65, ZS + 0.01)); };
  window(-5.4, 2.0); window(-2.3, 2.0); sv.windows.push(om);
  // v12: lamps above the team, in the lead's office, above the meeting room and in the kitchenette (at night they shine fully)
  for (const x of [-1.9, 0.6, 3.1]) sv.lamp(g, x, -0.15, { strength: 1.1 });
  sv.lamp(g, -5.3, -2.6, { radius: 0.26 }); sv.lamp(g, -5.3, 2.2, { y: 2.2, radius: 0.42, strength: 0.9 }); sv.lamp(g, 5.5, -2.6, { kind: 'panel', y: 2.6, radius: 0.4, strength: 0.7 });
  // whiteboard with notes in marker
  const tb = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: boardTex(P.building) })); tb.position.set(0.5, 1.6, ZS); g.add(tb);
  g.add(box(2.5, 1.3, 0.03, mat(0xc9c7bf), 0.5, 1.6, ZS - 0.02)); g.add(box(2.0, 0.04, 0.1, mat(0xc9c7bf), 0.5, 0.98, ZS + 0.05));
  // shelves with books / server room
  if (school) shelf(g, 2.75, ZS + 0.2, 0, 1.3, 2.1);
  else { const rack = box(0.8, 2.0, 0.6, mat(0x1f2026), 2.75, 1.0, ZS + 0.3); g.add(rack); }
  const leds = [];
  if (!school) for (let i = 0; i < 12; i++) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.03), new THREE.MeshBasicMaterial({ color: 0x3ddc84 })); l.position.set(2.55 + (i % 3) * 0.12, 0.4 + Math.floor(i / 3) * 0.4, ZS + 0.61); g.add(l); leds.push(l); }
  // wall clock showing real time
  const cc = document.createElement('canvas'); cc.width = cc.height = 128; const cg = cc.getContext('2d');
  cg.fillStyle = '#fff'; cg.beginPath(); cg.arc(64, 64, 60, 0, 7); cg.fill(); cg.strokeStyle = '#26272c'; cg.lineWidth = 5; cg.stroke();
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; cg.fillStyle = '#26272c'; cg.fillRect(64 + Math.sin(a) * 48 - 2, 64 - Math.cos(a) * 48 - 2, 4, 4); }
  const dial = new THREE.Mesh(new THREE.CircleGeometry(0.32, 32), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cc) })); dial.position.set(5.6, 2.25, ZS + 0.01); g.add(dial);
  const hand = (handLen, hr) => { const p = new THREE.Group(); p.position.set(5.6, 2.25, ZS + 0.02); const m = new THREE.Mesh(new THREE.PlaneGeometry(hr, handLen), new THREE.MeshBasicMaterial({ color: 0x26272c })); m.position.y = handLen / 2; p.add(m); g.add(p); return p; };
  const hourHand = hand(0.16, 0.035), minHand = hand(0.24, 0.025);
  // paintings on the left wall in the lead's office
  for (const [z, f] of [[-3.6, '#4f7cff'], [-2.6, '#ffc542']]) { g.add(box(0.03, 0.55, 0.42, mat(0xffffff), -W / 2 + 0.27, 1.75, z)); const o = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.47), mat(f)); o.position.set(-W / 2 + 0.29, 1.75, z); o.rotation.y = Math.PI / 2; g.add(o); }

  // lead's office (glazed)
  const glass = new THREE.MeshStandardMaterial({ color: 0xe8f0f5, transparent: true, opacity: 0.2, roughness: 0.05, depthWrite: false }), ram = mat(0xb9bcc2);
  const pane = (w, x, z, rot) => { const s = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.3), glass); s.position.set(x, 1.15, z); s.rotation.y = rot; g.add(s); g.add(box(rot ? 0.05 : w, 0.05, rot ? w : 0.05, ram, x, 2.3, z)); g.add(box(rot ? 0.05 : w, 0.05, rot ? w : 0.05, ram, x, 0.03, z)); };
  pane(3.2, -3.6, -2.9, Math.PI / 2); pane(2.1, -6.05, -1.3, 0); pane(0.6, -3.9, -1.3, 0);
  const kobV = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.0), mat(0xdcd8cc, { roughness: 1 })); kobV.rotation.x = -Math.PI / 2; kobV.position.set(-5.4, 0.007, -2.7); g.add(kobV);
  shelf(g, -W / 2 + 0.45, -2.2, Math.PI / 2, 1.0, 1.4);
  plant(g, -6.6, -3.95, 1.1);
  const armchair = mat(skin.seat); g.add(box(0.75, 0.4, 0.7, armchair, -4.25, 0.2, -1.95)); g.add(box(0.75, 0.45, 0.15, armchair, -4.25, 0.55, -2.25));

  // kitchenette
  const km = mat(skin.kitchen);
  g.add(box(2.6, 0.9, 0.7, km, 5.55, 0.45, ZS + 0.35)); g.add(box(2.7, 0.06, 0.76, mat(0xffffff), 5.55, 0.93, ZS + 0.35));
  g.add(box(2.2, 0.55, 0.38, km, 5.4, 2.0, ZS + 0.19)); // upper cabinet
  g.add(box(0.36, 0.45, 0.34, mat(0x2a2c33), 4.7, 1.19, ZS + 0.3)); // coffee machine
  for (let i = 0; i < 3; i++) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 10), mat(pick([0xff8a65, 0x4f8cff, 0xffffff]))); h.position.set(5.3 + i * 0.16, 1.01, ZS + 0.3); g.add(h); }
  g.add(box(0.75, 2.0, 0.7, mat(0xffffff), 6.65, 1.0, ZS + 0.35)); // fridge
  const auto = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.45, 16), new THREE.MeshStandardMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.7 })); auto.position.set(4.0, 1.12, ZS + 0.35); g.add(auto);
  g.add(box(0.36, 0.9, 0.36, mat(0xffffff), 4.0, 0.45, ZS + 0.35)); // water dispenser
  const steam = []; for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })); g.add(s); steam.push(s); }

  // meeting room with the task board
  if (skin.carpet) { const k = new THREE.Mesh(new THREE.CircleGeometry(1.9, 40), mat(skin.carpet)); k.rotation.x = -Math.PI / 2; k.position.set(-5.3, 0.008, 2.2); g.add(k); }
  const st = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.07, 40), mat(skin.desk)); st.position.set(-5.3, 0.74, 2.2); st.castShadow = true; g.add(st); g.add(box(0.12, 0.7, 0.12, mat(skin.legs), -5.3, 0.37, 2.2));
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.add(box(0.48, 0.08, 0.48, mat(skin.chair), -5.3 + Math.cos(a) * 1.35, 0.45, 2.2 + Math.sin(a) * 1.35)); }
  g.add(box(0.3, 0.02, 0.4, mat(0xffffff), -5.1, 0.79, 2.0)); g.add(box(0.5, 0.03, 0.34, mat(0x26272c), -5.6, 0.79, 2.4)); // papers and a laptop
  const tcan = document.createElement('canvas'); tcan.width = 1024; tcan.height = 480; const ttex = new THREE.CanvasTexture(tcan); ttex.colorSpace = THREE.SRGBColorSpace; ttex.anisotropy = 8;
  const tab = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.97), new THREE.MeshBasicMaterial({ map: ttex })); tab.position.set(-W / 2 + 0.26, 1.5, 2.0); tab.rotation.y = Math.PI / 2; g.add(tab);

  // relaxation zone front right
  const sed = mat(skin.seat);
  g.add(box(0.9, 0.42, 2.3, sed, 6.45, 0.21, 2.6)); g.add(box(0.25, 0.55, 2.3, sed, 6.8, 0.55, 2.6)); g.add(box(0.9, 0.55, 0.22, sed, 6.45, 0.45, 1.5)); g.add(box(0.9, 0.55, 0.22, sed, 6.45, 0.45, 3.7));
  g.add(box(0.8, 0.32, 1.1, mat(skin.desk), 5.35, 0.16, 2.6));
  g.add(box(0.28, 0.04, 0.2, mat(0xff8a65), 5.3, 0.34, 2.4));
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), mat(0xd8d4c8)); bag.scale.y = 0.6; bag.position.set(4.6, 0.25, 3.6); bag.castShadow = true; g.add(bag);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 6), mat(0x888a90)); stand.position.set(6.75, 0.85, 0.85); g.add(stand);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 0.3, 18, 1, true), mat(0xfff5e0, { side: THREE.DoubleSide, emissive: 0xffe2a8, emissiveIntensity: 0.4 })); shade.position.set(6.75, 1.75, 0.85); g.add(shade); sv.shades.push(shade.material);
  { const l = new THREE.PointLight(0xffcf90, 0, 5, 1.6); l.position.set(6.75, 1.6, 0.85); g.add(l); sv._standing = l; } // standing lamp by the sofa
  plant(g, 6.6, -0.5, 1.35); plant(g, -6.7, 4.0, 1.1); plant(g, -3.2, 3.9, 0.9); plant(g, 4.0, 4.0, 0.8); plant(g, -3.25, -0.9, 0.7);
  // inscription on the floor
  const nap = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.8), new THREE.MeshBasicMaterial({ map: texture(`${floorLabel(def.n)} · ${def.description}`.toUpperCase(), { fg: '#cfcac0', font: '500 54px "JetBrains Mono"', w: 1024, h: 128 }), transparent: true, depthWrite: false }));
  nap.rotation.x = -Math.PI / 2; nap.position.set(0.8, 0.012, 3.55); g.add(nap);
  // robot vacuum
  const robot = new THREE.Group(); const rt = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.08, 24), mat(0x2a2c33)); rt.position.y = 0.05; rt.castShadow = true; robot.add(rt);
  const rl = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), new THREE.MeshBasicMaterial({ color: 0x3ddc84 })); rl.rotation.x = -Math.PI / 2; rl.position.set(0, 0.095, 0.12); robot.add(rl);
  robot.position.set(-1, 0, 3.2); g.add(robot); const robotTarget = new THREE.Vector3(2, 0, 2.6);

  // desks: occupied by agents, the rest are free spots
  const vis = P.agents.map((a, i) => {
    const [x, z] = a.lead ? [-5.4, -3.0] : PLACES[(i - 1) % PLACES.length];
    const desk = buildDesk(g, x, z, a.lead, image, a.color, a.name);
    const ch = figure(a.color); ch.scale.setScalar(1.12); ch.position.copy(desk.seat); g.add(ch);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.5, 10), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.7; hit.userData.agent = i; ch.add(hit); click.push(hit);
    const el = document.createElement('div'); el.className = 'tag'; el.style.animationDelay = `${0.25 + i * 0.08}s`; el.onclick = (e) => { e.stopPropagation(); selectAgent(i); };
    const tag = new CSS2DObject(el); tag.position.set(0, 1.5, 0); ch.add(tag);
    return { a, ch, desk, el, path: null, coffee: 0 };
  });
  for (let k = P.agents.length - 1; k < PLACES.length; k++) buildDesk(g, PLACES[k][0], PLACES[k][1], false, image, '#cfcac0', 'free' + k, false);

  const papers = [];
  function paper(from, dest) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.01, 0.44), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })); m.castShadow = true; g.add(m); papers.push({ m, from: from.clone(), dest: dest.clone(), t: 0 }); }
  const listener = (type, d) => {
    if (d.n !== n) return;
    if (type === 'delegate') paper(vis[0].desk.deskPosition, vis[d.u.a].desk.deskPosition);
    if (type === 'done') paper(vis[d.u.a].desk.deskPosition, vis[0].desk.deskPosition);
  };
  WORLD.listen.add(listener);
  function go(v, onCoffee, then) {
    const s = v.desk, l = s.alley;
    const body = onCoffee ? [new THREE.Vector3(l, 0, s.seat.z), new THREE.Vector3(l, 0, CORRIDOR), new THREE.Vector3(COFFEE.x, 0, CORRIDOR), COFFEE.clone()]
      : [new THREE.Vector3(COFFEE.x, 0, CORRIDOR), new THREE.Vector3(l, 0, CORRIDOR), new THREE.Vector3(l, 0, s.seat.z), new THREE.Vector3(s.seat.x, 0, s.seat.z)];
    v.path = { body, i: 0, then };
  }
  let lastVersion = -1;
  const asp = innerWidth / innerHeight; let camera, end;
  // target shifted to the right (on screen) so the room fits between the left and right panels
  const target = new THREE.Vector3(1.4, 0.6, -0.6);
  camera = new THREE.PerspectiveCamera(30, asp, 0.1, 500); end = target.clone().add(new THREE.Vector3(12.5, 21.5, 28.5)); camera.position.copy(target).add(new THREE.Vector3(26, 42, 54));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.target.copy(target);
  Object.assign(controls, { minPolarAngle: 0.45, maxPolarAngle: 1.2, minDistance: 8, maxDistance: 60, minAzimuthAngle: -0.4, maxAzimuthAngle: 1.4, minZoom: 0.6, maxZoom: 3 });
  const intro = { t: 0, zP: camera.position.clone(), zZ: camera.zoom };
  let lastTime = -1; sv.time();

  return {
    kind: 'floor', n, scene, camera, controls, vis,
    pick(e) { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera); const h = ray.intersectObjects(click, false)[0]; return h ? h.object.userData.agent : null; },
    update(dt, t) {
      if (intro.t < 1) { intro.t = Math.min(1, intro.t + dt / 1.4); const k = 1 - Math.pow(1 - intro.t, 3); camera.position.lerpVectors(intro.zP, end, k);  }
      for (const o of image) o.offset.y -= dt * 0.08;
      if (t - lastTime > 0.5) { lastTime = t; sv.time(); if (sv._standing) sv._standing.intensity = 0.4 + 3 * dayState().lamps; }
      const now = simTime(); hourHand.rotation.z = -((now.getHours() % 12) + now.getMinutes() / 60) / 12 * Math.PI * 2; minHand.rotation.z = -now.getMinutes() / 60 * Math.PI * 2;
      steam.forEach((s, i) => { const k = (t * 0.5 + i / 3) % 1; s.position.set(4.7 + Math.sin(t * 2 + i) * 0.03, 1.45 + k * 0.5, ZS + 0.3); s.material.opacity = 0.5 * (1 - k); s.scale.setScalar(0.6 + k); });
      leds.forEach((l, i) => { l.material.color.set(Math.sin(t * 6 + i * 1.7) > 0.6 ? 0xffc542 : 0x3ddc84); });
      // the vacuum drives around the front part
      const dv = robotTarget.clone().sub(robot.position); if (dv.length() < 0.1) robotTarget.set(rnd(-2.6, 4.2), 0, rnd(2.5, 4.1)); else { dv.normalize(); robot.position.addScaledVector(dv, dt * 0.5); robot.rotation.y = Math.atan2(dv.x, dv.z); }
      for (const p of papers) { p.t = Math.min(1, p.t + dt / 1.1); p.m.position.lerpVectors(p.from, p.dest, p.t); p.m.position.y += Math.sin(p.t * Math.PI) * 2.6; p.m.rotation.set(Math.sin(p.t * 9) * 0.4, p.t * 6, Math.cos(p.t * 7) * 0.3); if (p.t >= 1) { g.remove(p.m); p.m.geometry.dispose(); } }
      for (let i = papers.length - 1; i >= 0; i--) if (papers[i].t >= 1) papers.splice(i, 1);
      for (const v of vis) {
        const a = v.a;
        if ((v.path || v.coffee > 0) && a.status !== 'none') { v.path = null; v.coffee = 0; }
        if (a.status === 'none' && !a.lead && !v.path && v.coffee <= 0 && Math.random() < dt * 0.02 && !vis.some((x) => x.path || x.coffee > 0)) {
          go(v, true, () => { v.coffee = 2.5; v.afterCoffee = () => go(v, false, () => {}); });
        }
        if (v.path) {
          const c = v.path, target = c.body[c.i], d2 = new THREE.Vector3(target.x - v.ch.position.x, 0, target.z - v.ch.position.z), len = d2.length();
          v.ch.position.y = 0;
          if (len < 0.06) { c.i++; if (c.i >= c.body.length) { v.path = null; c.then?.(); } }
          else { d2.normalize(); v.ch.position.addScaledVector(d2, Math.min(len, dt * 1.6)); v.ch.rotation.y = Math.atan2(d2.x, d2.z); }
        }
        if (v.coffee > 0) { v.coffee -= dt; v.ch.rotation.y = Math.PI; if (v.coffee <= 0) { const f = v.afterCoffee; v.afterCoffee = null; f?.(); } }
        if (!v.path && v.coffee <= 0) { v.ch.position.copy(a.status === 'pending' ? v.desk.stand : v.desk.seat); v.ch.rotation.y = 0; }
        animate(v.ch, v.path ? 'walks' : v.coffee > 0 ? 'none' : a.status, t);
        v.desk.glow.color.set(a.status === 'pending' ? 0xe2483d : a.status === 'work' ? 0xffc542 : a.status === 'done' ? 0x35c58a : 0xcfd3d8);
      }
      if (WORLD.version !== lastVersion) { lastVersion = WORLD.version; whiteboard(ttex, n, P.agents); }
    },
    dispose() { WORLD.listen.delete(listener); controls.dispose(); scene.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.dispose(); }); }); },
  };
}
