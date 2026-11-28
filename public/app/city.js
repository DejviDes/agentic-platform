// city.js – Scene 1: the city with the Brain on the square, towers, the archive building and the City · Work · Home views.
// Created by splitting the prototype public/dizajn-v12d.html (phase 1). Module map: brain Projekty/mesto-agentov/technika.md.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { hover, DISTRICT } from './state.js';
import { esc, rnd, pick } from './utils.js';
import { BUILDINGS, BRAIN_COUNT, BRAIN_GROUPS, BRAIN_STUDY, BRAIN_PROJECTS } from './demo-data.js';
import { skyColors, smooth, RAD, dayState } from './daylight.js';
import { WORLD } from './world.js';
import { animate, box, css2d, DEPTH, mat, BRAIN_CENTER, mouse, figure, ray, renderer, WIDTH, skin, texture, HEIGHT, merge } from './scene-base.js';
import { envTex, cameraSky, buildSurroundings, GLASS_OPACITY, PILLAR, glowTex } from './surroundings.js';
import { M } from './modules.js';
import { PLACES } from './floor.js';
import { enterFloor } from './navigation.js';
import { CONTROL_CENTER, controlCenterBadge, titleControlCenter, floorLabel } from './control-center.js';
import { ico } from './icons.js';
import { t as _t, tn as _tn } from './i18n.js';

export function buildCity() {
  const scene = new THREE.Scene();
  // sky as a top-to-bottom color gradient, changes with the sun's height
  const bgC = document.createElement('canvas'); bgC.width = 2; bgC.height = 256;
  const bgT = new THREE.CanvasTexture(bgC); bgT.colorSpace = THREE.SRGBColorSpace; scene.background = bgT;
  scene.fog = new THREE.Fog(0xffffff, 210, 520);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xe6e4dc, 1.5); scene.add(hemi);
  const sunL = new THREE.DirectionalLight(0xffffff, 2.3); sunL.castShadow = true; sunL.shadow.mapSize.set(2048, 2048); sunL.shadow.radius = 7; sunL.shadow.bias = -0.0004;
  Object.assign(sunL.shadow.camera, { left: -66, right: 66, top: 66, bottom: -66, near: 1, far: 240 }); scene.add(sunL); scene.add(sunL.target);
  const monthL = new THREE.DirectionalLight(0xc4d0ff, 0); monthL.position.set(-22, 40, 18); scene.add(monthL);
  const glassMats = [];
  const click = [], floors = new Map(), cards = [], wires = [];
  // 2026-11-10: floor alarm when an agent waits for approval: red shell around the glass (one shared material, blinks only while waiting)
  const alarmM = new THREE.MeshBasicMaterial({ color: 0xe2483d, transparent: true, opacity: 0, depthWrite: false });
  // v14d (2026-11-10): when work is going on at a floor, green edges and a green shell that pulses slowly (about 3 s). Red takes priority.
  const GREEN = 0x2fbf71, workM = new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0, depthWrite: false });

  // scaled-down copy of the real floor layout: the lead's office, desks per team,
  // free seats, meeting room, kitchenette and sofa. The agents are the same as in the floor view.
  const MM = {
    desk: mat(skin.desk), mon: mat(skin.monitor), chair: mat(skin.chair), glass: new THREE.MeshStandardMaterial({ color: 0xe8f0f5, transparent: true, opacity: 0.3, depthWrite: false }),
    carpet: mat(0xe9e6dd, { roughness: 1 }), kitchen: mat(skin.kitchen), white: mat(0xffffff), seat: mat(skin.seat), plant: mat(skin.plant, { flatShading: true }), flowerPot: mat(skin.flowerPot),
    bub: texture('!', { bg: '#e2483d', fg: '#fff', font: '700 70px Inter', w: 96, h: 96, r: 48 }),
  };
  // v12: at night the offices in the towers are lit. Furniture and floor get warm light from inside,
  // there are light strips under the ceiling of each floor. Floors where nothing is being worked on glow dimmer.
  const interiorTower = [], ramDay = new THREE.Color(0x5a626e) /* v13e: dark tower frames */, ramNight = new THREE.Color(0x3a3f4a);
  const ramTowerM = mat(ramDay.clone(), { roughness: 0.45, metalness: 0.25 });
  for (const k of ['desk', 'carpet', 'kitchen', 'white', 'seat', 'chair']) { MM[k].emissive = new THREE.Color(0xffc98a); MM[k].emissiveIntensity = 0; interiorTower.push([MM[k], 0.45]); }
  const passM = new THREE.MeshBasicMaterial({ color: 0xe9e6df }), passDay = new THREE.Color(0xe9e6df), passNight = new THREE.Color(0xfff0c8);
  const mbox = (gg, w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); gg.add(o); return o; };
  function miniDesk(gg, x, z, big, retracted) {
    const sir = big ? 2.3 : 1.7;
    mbox(gg, sir, 0.07, 0.85, MM.desk, x, 0.74, z); mbox(gg, sir - 0.1, 0.68, 0.06, MM.desk, x, 0.37, z + 0.35);
    mbox(gg, big ? 0.95 : 0.78, 0.46, 0.05, MM.mon, x, 1.13, z + 0.2);
    const oz = retracted ? 0.35 : 0;
    mbox(gg, 0.56, 0.08, 0.52, MM.chair, x, 0.45, z - 0.82 + oz); mbox(gg, 0.56, 0.6, 0.07, MM.chair, x, 0.8, z - 1.1 + oz);
    return { sed: new THREE.Vector3(x, 0.47, z - 0.78), stand: new THREE.Vector3(x + sir / 2 + 0.4, 0, z - 0.3) };
  }
  function miniPlant(gg, x, z, v) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * v, 0.17 * v, 0.4 * v, 10), MM.flowerPot); p.position.set(x, 0.2 * v, z); gg.add(p); const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4 * v, 0), MM.plant); l.position.set(x, 0.75 * v, z); gg.add(l); }
  function miniFloor(g, n, y0) {
    const m = new THREE.Group(); m.position.y = y0; m.scale.setScalar(0.6); g.add(m);
    const kob = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 5.4), MM.carpet); kob.rotation.x = -Math.PI / 2; kob.position.set(0.6, 0.01, -0.15); m.add(kob);
    // lead's office
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), MM.glass); s1.rotation.y = Math.PI / 2; s1.position.set(-3.6, 1.1, -2.9); m.add(s1);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), MM.glass); s2.position.set(-5.8, 1.1, -1.3); m.add(s2);
    // meeting room, kitchenette, sofa, flowers
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.07, 24), MM.desk); st.position.set(-5.3, 0.74, 2.2); m.add(st); mbox(m, 0.12, 0.7, 0.12, MM.desk, -5.3, 0.37, 2.2);
    mbox(m, 2.6, 0.9, 0.7, MM.kitchen, 5.55, 0.45, -4.1); mbox(m, 0.75, 2.0, 0.7, MM.white, 6.65, 1.0, -4.1);
    mbox(m, 0.9, 0.42, 2.3, MM.seat, 6.45, 0.21, 2.6); mbox(m, 0.25, 0.55, 2.3, MM.seat, 6.8, 0.55, 2.6);
    miniPlant(m, 6.6, -0.5, 1.2); miniPlant(m, -6.7, 4.0, 1); miniPlant(m, -6.6, -3.9, 1);
    // team
    const agents = WORLD.floors.get(n).agents, figures = [];
    agents.forEach((ag, i) => {
      const [x, z] = ag.lead ? [-5.4, -3.0] : PLACES[(i - 1) % PLACES.length];
      const { sed, stand } = miniDesk(m, x, z, ag.lead, false);
      const ch = figure(ag.color, true); ch.scale.setScalar(1.45); ch.position.copy(sed); m.add(ch); // a bit larger so they are readable from a distance
      const bub = new THREE.Sprite(new THREE.SpriteMaterial({ map: MM.bub, depthTest: false })); bub.scale.set(0.8, 0.8, 1); bub.position.set(stand.x, 2.25, stand.z); bub.visible = false; m.add(bub);
      figures.push({ ch, ag, sed, stand, bub });
    });
    for (let k = agents.length - 1; k < PLACES.length; k++) miniDesk(m, PLACES[k][0], PLACES[k][1], false, true);
    return figures;
  }
  // ---------- CONTROL CENTER (2026-11-10, from prototype v14c): the city's app in the middle between the three towers, opposite the Brain ----------
  // Static parts (base, walls, windows, strip, roof, crane column, office desks) go into the surroundings root and get merged with it.
  // Separate objects remain: the glass, the git log board, the sign, the rotating crane part with the beacon, the figures and the label.
  const C = BUILDINGS.find((b) => b.controlCenter), CN = C?.floors[0].n, UZ = { x: 0, z: -15.2 }, DISPATCH_ID = '__dispatch', UNIVERSAL = 'Univerzál';
  const cDesks = [[-3.6, -1.4], [-0.4, 1.2], [2.0, 1.2], [4.2, -1.0]], cPlaces = [];
  const yellowM = mat(0xf2b632, { roughness: 0.6 }), grayM = mat(0x8c949e);
  function controlCenterStatic(add, M) {
    const g = new THREE.Group(); g.position.set(UZ.x, 0, UZ.z); add(g);
    const shell = mat(skin.buildingShell);
    g.add(box(7.6, 0.3, 5.4, M.curb, 0, 0.15, 0)); // base
    const underM = mat(skin.board, { roughness: 0.9, emissive: 0xffcf94, emissiveIntensity: 0 }); interiorTower.push([underM, 0.7]);
    g.add(box(7.0, 0.12, 4.8, underM, 0, 0.36, 0));
    g.add(box(6.9, 2.3, 0.12, shell, 0, 1.57, -2.3)); // back wall with the board
    for (let i = 0; i <= 4; i++) for (const z of [-2.4, 2.4]) g.add(box(0.09, 2.3, 0.09, ramTowerM, -3.5 + i * 1.75, 1.57, z));
    for (const x of [-3.5, 3.5]) for (const z of [-0.8, 0.8]) g.add(box(0.09, 2.3, 0.09, ramTowerM, x, 1.57, z));
    // office: scaled-down desks as in the towers (the figures are in city.update, not here)
    const office = new THREE.Group(); office.position.y = 0.42; office.scale.setScalar(0.62); g.add(office);
    for (const [x, z] of cDesks) cPlaces.push(miniDesk(office, x, z, !cPlaces.length, false));
    // floor: orange strip, windows (lit at night), roof
    g.add(box(7.22, 0.22, 5.02, mat(new THREE.Color(CONTROL_CENTER.color)), 0, 2.83, 0));
    g.add(box(7.2, 1.5, 5.0, shell, 0, 3.47, 0));
    // top strip = the Dispatch floor (2026-11-15, id centrala/dispecing): without raising the building (a taller superstructure would hide the Projects tower behind it in the Work view), windows are blue screens
    const windowM = mat(0x3d6fae, { roughness: 0.25, emissive: 0x7fb4ff, emissiveIntensity: 0 }); interiorTower.push([windowM, 0.9]);
    for (const z of [-2.51, 2.51]) for (const x of [-2.3, 0, 2.3]) g.add(box(1.7, 0.5, 0.04, windowM, x, 3.2, z));
    for (const x of [-3.61, 3.61]) for (const z of [-1.2, 1.2]) g.add(box(0.04, 0.5, 1.6, windowM, x, 3.2, z));
    g.add(box(7.5, 0.2, 5.3, M.curb, 0, 4.32, 0)); // roof
    // crane column on the back part of the roof (the jib reaches ~5.4, does not hit the towers)
    g.add(box(0.7, 0.2, 0.7, grayM, 2.4, 4.52, -1.2));
    g.add(box(0.3, 4.0, 0.3, yellowM, 2.4, 6.52, -1.2));
    for (let i = 0; i < 6; i++) g.add(box(0.38, 0.06, 0.38, yellowM, 2.4, 5.02 + i * 0.62, -1.2));
  }
  const surroundings = buildSurroundings(scene, C ? { staticParts: ({ add, M }) => controlCenterStatic(add, M) } : null);
  const home = M.home ? M.home.buildHome(scene, click) : { time() {}, update() {} }; // 3D Home district only with the module enabled

  // ---------- BRAIN: the Second Brain pavilion in the middle of the square ----------
  const MZ = { x: 0, z: -0.5 }, turquoise = new THREE.Color(0x2bd4a0);
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.6, 0.5, 64), mat(0xf7f6f1)); podium.position.set(MZ.x, 0.25, MZ.z); podium.receiveShadow = podium.castShadow = true; scene.add(podium);
  const step = new THREE.Mesh(new THREE.CylinderGeometry(4.9, 5.1, 0.16, 64), mat(0xe9e7e0)); step.position.set(MZ.x, 0.08, MZ.z); step.receiveShadow = true; scene.add(step);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(4.62, 4.62, 0.12, 64, 1, true), new THREE.MeshStandardMaterial({ color: 0x2bd4a0, emissive: turquoise, emissiveIntensity: 0.6, side: THREE.DoubleSide })); rim.position.set(MZ.x, 0.44, MZ.z); scene.add(rim);
  const circleM = new THREE.MeshStandardMaterial({ color: 0xc8f7e6, emissive: turquoise, emissiveIntensity: 0.4 });
  const circle = new THREE.Mesh(new THREE.TorusGeometry(4.05, 0.07, 10, 96), circleM); circle.rotation.x = -Math.PI / 2; circle.position.set(MZ.x, 0.53, MZ.z); scene.add(circle);
  const domeM = new THREE.MeshStandardMaterial({ color: 0xdcecf2, transparent: true, opacity: 0.2, roughness: 0.03, metalness: 0.4, envMap: envTex(), envMapIntensity: 1.2, depthWrite: false, side: THREE.DoubleSide });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.9, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), domeM); dome.position.set(MZ.x, 0.5, MZ.z); scene.add(dome);
  const ribM = mat(0xd3d6da, { metalness: 0.3, roughness: 0.4 });
  for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(3.9, 0.035, 6, 48, Math.PI), ribM); r.position.set(MZ.x, 0.5, MZ.z); r.rotation.y = i * Math.PI / 6; scene.add(r); }
  const equator = new THREE.Mesh(new THREE.TorusGeometry(3.9, 0.06, 6, 64), ribM); equator.rotation.x = -Math.PI / 2; equator.position.set(MZ.x, 0.52, MZ.z); scene.add(equator);
  const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.25, 24), ribM); peak.position.set(MZ.x, 4.42, MZ.z); scene.add(peak);
  // hologram of the notes graph inside the dome
  const brain = new THREE.Group(); brain.position.copy(BRAIN_CENTER); brain.scale.setScalar(1.15); scene.add(brain);
  const nodes = [];
  BRAIN_GROUPS.forEach(([title, color, count], si) => {
    const angle = (si / BRAIN_GROUPS.length) * Math.PI * 2, c = new THREE.Vector3(Math.cos(angle) * 1.4, (si % 2 ? 0.55 : -0.45), Math.sin(angle) * 1.4);
    const n = Math.max(5, Math.round(count / 16));
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(i === 0 ? 0.17 : rnd(0.06, 0.11), 12, 10), new THREE.MeshStandardMaterial({ color: color, roughness: 0.4, emissive: color, emissiveIntensity: 0.3 }));
      s.position.copy(c).add(new THREE.Vector3(rnd(-0.7, 0.7), rnd(-0.6, 0.6), rnd(-0.7, 0.7)).multiplyScalar(i === 0 ? 0 : 1)); brain.add(s);
      nodes.push({ s, group: title, pulse: 0, base: s.scale.x });
    }
  });
  const body = [];
  nodes.forEach((u, i) => {
    const near = nodes.map((v, j) => [v.s.position.distanceTo(u.s.position) + (v.group === u.group ? 0 : 1.2), j]).filter(([, j]) => j !== i).sort((a, b) => a[0] - b[0]).slice(0, 2);
    for (const [, j] of near) body.push(u.s.position, nodes[j].s.position);
  });
  const edgesBrainM = new THREE.LineBasicMaterial({ color: 0x8fcfb8, transparent: true, opacity: 0.6 });
  brain.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(body), edgesBrainM));
  // glow in the center and a light column into the sky
  const glowBrainM = new THREE.SpriteMaterial({ map: glowTex('80,240,190'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.3 });
  const glowBrain = new THREE.Sprite(glowBrainM); glowBrain.scale.set(9, 9, 1); glowBrain.position.copy(BRAIN_CENTER); scene.add(glowBrain);
  const lc = document.createElement('canvas'); lc.width = 4; lc.height = 128; const lg = lc.getContext('2d'), lgr = lg.createLinearGradient(0, 0, 0, 128);
  lgr.addColorStop(0, 'rgba(120,255,210,0)'); lgr.addColorStop(1, 'rgba(120,255,210,0.85)'); lg.fillStyle = lgr; lg.fillRect(0, 0, 4, 128);
  const rayM = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0.15 });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.0, 34, 32, 1, true), rayM); beam.position.set(MZ.x, 4.5 + 17, MZ.z); scene.add(beam);
  // optical fibers to the buildings: always faintly lit, pulses (wires) run along them during reads and writes
  const thread = [];
  for (const b of BUILDINGS.filter((x) => !x.pavilion)) {
    const [bx, bz] = b.position, side = Math.abs(bx) > 3;
    const target = new THREE.Vector3(side ? bx - Math.sign(bx) * WIDTH / 2 : bx, 0.16, side ? bz + 1.2 : bz + DEPTH / 2);
    const direction = target.clone().sub(new THREE.Vector3(MZ.x, 0, MZ.z)).setY(0).normalize();
    const start = new THREE.Vector3(MZ.x, 0.55, MZ.z).addScaledVector(direction, 4.6);
    const curve = side || !C ? new THREE.QuadraticBezierCurve3(start, start.clone().lerp(target, 0.5).add(new THREE.Vector3(0, 0.9, 0)), target)
      : new THREE.CubicBezierCurve3(start, start.clone().lerp(target, 0.3).add(new THREE.Vector3(6.6, 0.7, 0)), start.clone().lerp(target, 0.7).add(new THREE.Vector3(6.6, 0.7, 0)), target); // to Projects in an arc around the center
    const m = new THREE.LineBasicMaterial({ color: b.color, transparent: true, opacity: 0.4 });
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), m)); thread.push(m);
  }
  // click on the pavilion = enter the Second Brain
  const hitBrain = new THREE.Mesh(new THREE.SphereGeometry(4.2, 16, 10), new THREE.MeshBasicMaterial({ visible: false })); hitBrain.position.set(MZ.x, 1.6, MZ.z); hitBrain.userData.id = 'Second Brain'; scene.add(hitBrain); click.push(hitBrain);
  const [mozEl, mozObj] = css2d('', 'box brainTag'); mozObj.position.set(MZ.x, 5.4, MZ.z); scene.add(mozObj);
  mozEl.onclick = () => enterFloor('Second Brain');
  let brainGlow = 0.3, mozTip = '';
  // ---------- UNIVERSAL (2026-11-15): low kiosk of the Secretary to the right of the Brain pavilion, between the park and the shops (on the left it is hidden by the Town hall tower), floor `brain/universal` (chat outside projects) ----------
  // Height only 1.5, so it hides nothing behind it. Static, merges into 5 draws (walls, strip, roof, window, sign).
  let uniBandM = null;
  if (BUILDINGS.some((b) => b.floors.some((p) => p.n === UNIVERSAL))) {
    const ug = new THREE.Group(); ug.position.set(6.6, 0, -14.2); ug.rotation.y = -0.15; scene.add(ug); // 2026-11-16: next to the center (between it and the tower on the right), chats outside projects are together
    const uniM = mat(0xf2f1eb); uniBandM = new THREE.MeshStandardMaterial({ color: 0x2bd4a0, emissive: turquoise, emissiveIntensity: 0.35 });
    ug.add(box(2.6, 0.14, 1.8, uniM, 0, 0.07, 0)); ug.add(box(2.3, 1.15, 1.5, uniM, 0, 0.72, 0));
    ug.add(box(2.36, 0.12, 1.56, uniBandM, 0, 1.36, 0)); ug.add(box(2.6, 0.1, 1.8, ribM, 0, 1.47, 0));
    ug.add(box(1.5, 0.46, 0.04, mat(0x2a3340, { roughness: 0.25 }), 0, 0.74, 0.76)); ug.add(box(0.36, 0.78, 0.04, uniBandM, 0.98, 0.55, 0.77));
    const uns = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.26), new THREE.MeshBasicMaterial({ map: texture(_t('app.city.universalWrite'), { bg: '#ffffff', fg: '#151515', font: skin.fontBadge, w: 680, h: 104, r: 14 }) })); uns.position.set(0, 1.17, 0.762); ug.add(uns);
    const uh = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.8, 1.9), new THREE.MeshBasicMaterial({ visible: false })); uh.position.y = 0.9; uh.userData.id = UNIVERSAL; ug.add(uh); click.push(uh);
    merge(ug, new Set([uns, uh]));
  }

  // center: moving and transparent parts (the static ones are merged in the surroundings, controlCenterStatic above)
  let cent = null;
  if (C) {
    const cg = new THREE.Group(); cg.position.set(UZ.x, 0, UZ.z); scene.add(cg);
    const glassM = new THREE.MeshStandardMaterial({ color: 0x98bddb, transparent: true, opacity: GLASS_OPACITY, roughness: 0.04, metalness: 0.35, envMap: envTex(), envMapIntensity: 1.0, depthWrite: false, emissive: 0xffb866, emissiveIntensity: 0 }); glassMats.push(glassM);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(6.96, 2.3, 4.76), glassM); glass.position.y = 1.57; cg.add(glass);
    const wrapG = new THREE.BoxGeometry(7.26, 2.4, 5.06), alarmC = new THREE.Mesh(wrapG, alarmM), workC = new THREE.Mesh(wrapG, workM); // red / green shell around the glass
    for (const o of [alarmC, workC]) { o.position.y = 1.57; o.visible = false; cg.add(o); }
    const tabC = document.createElement('canvas'); tabC.width = 512; tabC.height = 256; const tabT = new THREE.CanvasTexture(tabC); tabT.colorSpace = THREE.SRGBColorSpace;
    const tab = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.15), new THREE.MeshBasicMaterial({ map: tabT })); tab.position.set(0.7, 1.8, -2.23); cg.add(tab);
    const write = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.5), new THREE.MeshBasicMaterial({ map: texture(_t('app.city.controlCenterWrite'), { bg: '#ffffff', fg: '#151515', font: skin.fontBadge, w: 830, h: 96, r: 14 }) }));
    write.position.set(0, 3.88, 2.52); cg.add(write);
    // Dispatch satellite (2026-11-16) on the front left corner of the roof: a click target easily visible from above, the dish slowly turns, glows on hover
    const parabola = new THREE.Group(); parabola.position.set(-2.3, 4.42, 0.9); cg.add(parabola);
    const dispatchM = new THREE.MeshStandardMaterial({ color: 0x3d6fae, emissive: 0x7fb4ff, emissiveIntensity: 0.4 });
    parabola.add(box(0.6, 0.2, 0.6, grayM, 0, 0.1, 0));
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 8), grayM); pillar.position.y = 0.55; parabola.add(pillar);
    const tilt = new THREE.Group(); tilt.position.y = 0.95; tilt.rotation.x = 0.75; parabola.add(tilt);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 8, 0, Math.PI * 2, 0, 0.9), mat(0xf2f1eb, { side: THREE.DoubleSide })); bowl.rotation.x = Math.PI; bowl.position.y = 0.69; tilt.add(bowl);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), grayM); arm.position.y = 0.45; tilt.add(arm);
    const tipMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), dispatchM); tipMesh.position.y = 0.78; tilt.add(tipMesh);
    tilt.add(box(0.5, 0.06, 0.5, dispatchM, 0, 0.02, 0));
    // rotating crane part: spins faster when someone is working in the center; the beacon blinks when someone is waiting or new server code is waiting for a restart
    const top = new THREE.Group(); top.position.set(2.4, 8.52, -1.2); top.rotation.y = -0.6; cg.add(top);
    const darkM = mat(0x2a2d36);
    top.add(box(0.5, 0.45, 0.5, darkM, 0, 0.22, 0.38));
    top.add(box(5.4, 0.2, 0.24, yellowM, -2.5, 0.55, 0)); top.add(box(1.7, 0.18, 0.24, yellowM, 1.0, 0.55, 0));
    top.add(box(0.55, 0.5, 0.45, darkM, 1.6, 0.25, 0)); top.add(box(0.14, 1.0, 0.14, yellowM, 0, 1.05, 0));
    top.add(box(0.3, 0.12, 0.3, darkM, -3.6, 0.38, 0)); top.add(box(0.16, 0.22, 0.16, darkM, -3.6, -1.75, 0));
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    top.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([V(0, 1.55, 0), V(-5.0, 0.66, 0), V(0, 1.55, 0), V(1.8, 0.66, 0), V(-3.6, 0.32, 0), V(-3.6, -1.64, 0)]), new THREE.LineBasicMaterial({ color: 0x55575e })));
    const lighthouse = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshBasicMaterial({ color: 0x3ddc84 })); lighthouse.position.y = 1.64; top.add(lighthouse);
    merge(top, new Set([lighthouse]));
    // figures of the center's team at the desks (the first four)
    const office = new THREE.Group(); office.position.y = 0.42; office.scale.setScalar(0.62); cg.add(office);
    const figures = WORLD.floors.get(CN).agents.slice(0, cDesks.length).map((ag, i) => {
      const { sed, stand } = cPlaces[i];
      const ch = figure(ag.color, true); ch.scale.setScalar(1.45); ch.position.copy(sed); office.add(ch);
      const bub = new THREE.Sprite(new THREE.SpriteMaterial({ map: MM.bub, depthTest: false })); bub.scale.set(0.8, 0.8, 1); bub.position.set(stand.x, 2.25, stand.z); bub.visible = false; office.add(bub);
      return { ch, ag, sed, stand, bub };
    });
    // two invisible cubes (2026-11-16): the whole building with the roof = Control Center, the satellite on the roof = Dispatch (it is above the roof, so it is hit first from above)
    const hitM = new THREE.MeshBasicMaterial({ visible: false });
    const hit = new THREE.Mesh(new THREE.BoxGeometry(7.5, 4.1, 5.3), hitM); hit.position.y = 2.35; hit.userData.id = CN; cg.add(hit); click.push(hit);
    const hitD = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.0, 2.1), hitM); hitD.position.set(-2.3, 5.45, 0.9); hitD.userData.id = DISPATCH_ID; cg.add(hitD); click.push(hitD);
    // name ladder on hover (as with the towers): both names to the left of the building, Dispatch at the satellite
    const rebC = [[_t('app.city.controlCenterFull'), 1.55], [_t('app.city.dispatch') + ' ' + ico('dispatch'), 5.2]].map(([t, y]) => { const [e, o] = css2d(`<span class="point"></span>${t}`, 'rebBadge'); o.position.set(-3.9, y, 2.55); o.visible = false; cg.add(o); return { e, o }; });
    const [el, obj] = css2d('', 'box brainTag taskOfficeTag'); obj.position.set(UZ.x, 11.2, UZ.z); scene.add(obj); // above the crane, does not hide the building
    el.onclick = () => enterFloor(CN);
    // board: the app's latest commits (redrawn only on a new commit)
    const drawBoard = (log) => {
      const g = tabC.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#151515'; g.font = '600 22px "JetBrains Mono", monospace'; g.fillText('git log --oneline', 24, 40);
      const f = ['#2d5bd7', '#1f8a5b', '#d23f3f', '#8a6cff', '#c2621f'];
      (log?.length ? log.slice(0, 5) : [{ h: '·······', s: _t('app.floor.appCity') }]).forEach((c, i) => { g.font = '22px "Marker Felt", cursive'; g.fillStyle = f[i]; g.fillText(c.h, 24, 80 + i * 36); g.fillStyle = '#333'; g.fillText(c.s.length > 26 ? c.s.slice(0, 25) + '…' : c.s, 128, 80 + i * 36); });
      tabT.needsUpdate = true;
    };
    drawBoard(null);
    cent = { glassM, top, lighthouse, parabola, dispatchM, figures, alarmC, workC, el, drawBoard, whiteboard: '', badge: '', rebC, reb: '' };
  }

  // buildings
  const ROOF_TOWER = 0xc9c7c0; // neutral concrete gray, pastel in the Diorama
  BUILDINGS.filter((b) => !b.pavilion).forEach((b, bi) => {
    const color = new THREE.Color(b.color);
    const shell = new THREE.Color(skin.buildingShell);
    const bg = new THREE.Group(); bg.position.set(b.position[0], 0, b.position[1]); scene.add(bg);
    bg.add(box(WIDTH, 2.6, DEPTH, mat(shell), 0, 1.3, 0));
    bg.add(box(2.2, 2, 0.1, mat(0x2a2d36), 0, 1, DEPTH / 2 + 0.03));
    bg.add(box(WIDTH + 0.02, 0.18, DEPTH + 0.02, mat(color), 0, 2.5, 0)); // colored strip of the building
    const ramM = ramTowerM;
    b.floors.forEach((p, j) => {
      const g = new THREE.Group(); g.position.y = 2.6 + j * HEIGHT; bg.add(g);
      const fd = new THREE.Color(skin.board);
      const underM = mat(fd, { roughness: 0.9, emissive: 0xffcf94, emissiveIntensity: 0 }); interiorTower.push([underM, p.status === 'none' ? 0.35 : 0.7]);
      g.add(box(WIDTH, 0.22, DEPTH, underM));
      for (const z of [-DEPTH / 4, DEPTH / 4]) { const pass = new THREE.Mesh(new THREE.BoxGeometry(WIDTH - 1.2, 0.05, 0.22), passM); pass.position.set(0, HEIGHT - 0.06, z); g.add(pass); }
      // glazed facade: tinted glass with sky reflections, window frames and a sill between the floors
      const glassM = new THREE.MeshStandardMaterial({ color: 0x98bddb, transparent: true, opacity: GLASS_OPACITY, roughness: 0.04, metalness: 0.35, envMap: envTex(), envMapIntensity: 1.0, depthWrite: false,
        emissive: 0xffb866, emissiveIntensity: 0 }); glassMats.push(glassM);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(WIDTH - 0.06, HEIGHT - 0.05, DEPTH - 0.06), glassM); glass.position.y = HEIGHT / 2 + 0.1; g.add(glass);
      g.add(box(WIDTH + 0.08, 0.36, DEPTH + 0.08, ramM, 0, 0.06, 0)); // the sill covers the floor slab
      for (let i = 0; i <= 6; i++) { const x = -WIDTH / 2 + i * WIDTH / 6; for (const z of [-DEPTH / 2, DEPTH / 2]) { const m = new THREE.Mesh(PILLAR, ramM); m.position.set(x, HEIGHT / 2 + 0.1, z); g.add(m); } }
      for (let i = 1; i < 4; i++) { const z = -DEPTH / 2 + i * DEPTH / 4; for (const x of [-WIDTH / 2, WIDTH / 2]) { const m = new THREE.Mesh(PILLAR, ramM); m.position.set(x, HEIGHT / 2 + 0.1, z); g.add(m); } }
      const hrM = new THREE.LineBasicMaterial({ color: skin.edges, transparent: true, opacity: 0.7 });
      const hr = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), hrM); hr.position.copy(glass.position); g.add(hr);
      const figures = miniFloor(g, p.n, 0.11);
      const wrapG = new THREE.BoxGeometry(WIDTH + 0.3, HEIGHT + 0.1, DEPTH + 0.3);
      const alarm = new THREE.Mesh(wrapG, alarmM); alarm.position.y = HEIGHT / 2 + 0.05; alarm.visible = false; g.add(alarm);
      const workO = new THREE.Mesh(wrapG, workM); workO.position.y = HEIGHT / 2 + 0.05; workO.visible = false; g.add(workO);
      const [alarmEl, alarmObj] = css2d('', 'alarmBadge'); alarmObj.position.set(WIDTH / 2 + 0.2, HEIGHT / 2 + 0.1, DEPTH / 2); alarmObj.visible = false; g.add(alarmObj);
      alarmEl.onclick = () => enterFloor(p.n);
      // name ladder: HTML label to the left of the floor, shown at all floors of the tower when the mouse is over any of them
      const [rebEl, rebObj] = css2d(`<span class="point"></span>${esc(floorLabel(p.n))}`, 'rebBadge'); rebObj.position.set(-WIDTH / 2 - 0.15, HEIGHT / 2 + 0.1, DEPTH / 2); rebObj.visible = false; g.add(rebObj);
      const badge =new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.48), new THREE.MeshBasicMaterial({ map: texture(p.sessions ? `${floorLabel(p.n)} · ${p.sessions}` : floorLabel(p.n), { bg: '#fff', fg: '#151515', font: skin.fontBadge, r: 8 }), transparent: true, depthWrite: false }));
      badge.position.set(-WIDTH / 2 + 1.5, HEIGHT - 0.4, DEPTH / 2 + 0.02); g.add(badge);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, HEIGHT, DEPTH), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = HEIGHT / 2; hit.userData.id = p.n; g.add(hit); click.push(hit);
      floors.set(p.n, { g, p, glass: glassM, hr: hrM, figures, slideOut: 0, target: 0, building: b.title, alarm, workO, alarmEl, alarmObj, alarmText: '', rebEl, rebObj, rebStatus: '' });
      merge(g, new Set([...figures.flatMap((x) => [x.ch, x.bub]), alarm, workO, alarmObj, rebObj])); // v12c: floor furniture in a few objects (the floor slides out as a whole, the figures stay)
    });
    merge(bg, new Set(b.floors.map((p) => floors.get(p.n).g))); // v12c: rest of the tower
    const top = 2.6 + b.floors.length * HEIGHT;
    bg.add(box(WIDTH + 0.3, 0.3, DEPTH + 0.3, mat(0xf2f1eb), 0, top + 0.15, 0));
    bg.add(box(WIDTH + 0.32, 0.08, DEPTH + 0.32, mat(ROOF_TOWER), 0, top + 0.32, 0)); // the roof is the same for all towers (decision 2026-11-08), the building's color is carried by the strip at the ground
    // the card stands above the center of the roof (point 0.6 above it) and CSS translate lifts it entirely above the point, so it does not hide the top floor.
    // Horizontally the cards are spaced by pixels on screen (not in the world), because that fits at every camera zoom.
    const [el, obj] = css2d('', 'box stat'); obj.position.set(0, top + 0.6, 0); bg.add(obj);
    const dx = [-95, 65, -55, -130, 130][b.slot] || 0; // by the tower's position (slot 0 left, 1 right, 2 back)
    el.style.translate = `${dx}px calc(-50% - 14px)`;
    el.onclick = () => { const n = b.floors.find((p) => WORLD.floors.get(p.n).agents.some((a) => a.status === 'pending'))?.n || b.floors[0].n; enterFloor(n); };
    cards.push({ el, b, obj });
  });

  // archive annexes at the towers removed (2026-11-16): the archive is in the building overview and in the Floor management of the center

  // wires Brain ↔ floor (read / write)
  function wire(n, direction) {
    const x = floors.get(n); if (!x) return;
    const target = new THREE.Vector3(); x.g.getWorldPosition(target); target.y += 1; if (Math.abs(target.x) > 3) { target.x += target.x > 0 ? -WIDTH / 2 : WIDTH / 2; target.z += 0.5; } else target.z += DEPTH / 2;
    const curve = new THREE.QuadraticBezierCurve3(BRAIN_CENTER.clone(), BRAIN_CENTER.clone().lerp(target, 0.5).add(new THREE.Vector3(0, 3, 1.5)), target);
    const color = BUILDINGS.find((b) => b.title === x.building).color;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.9 }));
    scene.add(line);
    const dots = [0, 0.18, 0.36].map((o) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: color })); scene.add(b); return { b, o }; });
    wires.push({ line, dots, curve, t: 0, direction });
    const sk = /^(Škola|Štúdium|Study)$/.test(x.building) ? BRAIN_STUDY : BRAIN_PROJECTS;
    const cand = nodes.filter((u) => u.group === sk); if (cand.length) pick(cand).pulse = 1;
  }
  const listener = (type, d) => { if (type === 'brain') wire(d.n, d.direction); };
  WORLD.listen.add(listener);

  const asp = innerWidth / innerHeight; let camera;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const SPACING = null; // direction of the isometric camera
  camera = new THREE.PerspectiveCamera(30, asp, 1, 900);
  // v11: the whole city is visible from the normal view (low Home in front, tall towers in the back), the toggle only zooms in on the district
  const target0 = V3(7, -3, 11);
  camera.position.copy(V3(29, 82, 158));
  scene.add(camera);
  const sky = cameraSky(camera);
  let controls;
  const newControls = () => { controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.48; controls.target.copy(target0); return controls; };
  newControls();
  const cityView = { t: target0.clone(), p: camera.position.clone(), z: camera.zoom };
  // target higher so that the cards above the tower roofs fit under the top bar (tuned for 10 floors at 1440 × 900).
  // Phase 2: the number of floors is real (at most maxFloors = 12), a taller tower moves the target up and the camera further away.
  const extra = Math.max(0, Math.max(...BUILDINGS.filter((b) => !b.pavilion).map((b) => b.floors.length)) - 10) * HEIGHT;
  const pt = V3(11, 15 + extra * 0.6, -16); // x 7 → 11: the cards move left, the right tower's card no longer goes under the right panel (UX audit wave 1, 1440 px)
  const workView = { t: pt, p: pt.clone().add(V3(18, 34, 114).multiplyScalar((1 + extra * 0.03) * (BUILDINGS.filter((b) => !b.pavilion).length > 3 ? 1.5 : 1))), z: 1 }; // the 4th and 5th tower stand at the edges, so the Work view zooms out
  const dt0 = (M.home?.HOME_CENTER || V3(1, 2, 36)).clone().add(V3(4.5, 0, -1)); // moved so the district does not hide the panel
  const dti = V3(3, 2, 30); // in the Diorama slightly backward, so the town hall tower is visible too
  const homeView = { t: dt0, p: dt0.clone().add(V3(12, 44, 56).multiplyScalar(1.4)), z: 1 }; // 2026-11-17: zoomed out so the whole district and the Brain are visible
  let lastCards = 0, fly_ = null, lastTime = -1, lastColors = '';
  const goldColor = new THREE.Color(0xffa860), hemiNightSky = new THREE.Color(0x9fb0e0), hemiNightGround = new THREE.Color(0x2a2438), hemiDayGround = new THREE.Color(0xb2a48b);
  // v13e: in the Maket weaker bluish ambient light and stronger warm sun, so the walls have shadow and the colors do not fade
  const hemiDaySky = new THREE.Color(0xe2efff), sunDay = new THREE.Color(0xfff2dc);
  function applyTime() {
    const s = dayState();
    // sky and fog
    const [up, horizon] = skyColors('a', s.e), key = up.getHexString() + horizon.getHexString();
    if (key !== lastColors) { lastColors = key; const g = bgC.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#' + up.getHexString()); gr.addColorStop(1, '#' + horizon.getHexString()); g.fillStyle = gr; g.fillRect(0, 0, 2, 256); bgT.needsUpdate = true; scene.fog.color.copy(horizon); }
    // lights: sky, sun (direction follows the course of the day, shadows move), moon
    hemi.color.copy(hemiNightSky).lerp(hemiDaySky, s.day); hemi.groundColor.copy(hemiNightGround).lerp(hemiDayGround, s.day); hemi.intensity = 0.85 + ((1.05) - 0.85) * s.day;
    const angle = 0.2 + 0.9 * Math.min(1, Math.max(0, s.p)) /* 2026-11-10: light from the right, from the same side as the sun in the sky */, height = Math.max(4, Math.sin(Math.max(s.e, 4) * RAD) * 70);
    sunL.position.set(Math.sin(angle) * 60, height, 30 + Math.cos(angle) * 20); sunL.target.position.set(0, 0, 0);
    sunL.intensity = (2.9) * smooth(-2, 6, s.e); sunL.color.copy(sunDay).lerp(goldColor, s.gold);
    monthL.intensity = 0.7 * s.night;
    for (const m of glassMats) { m.emissiveIntensity = 1.35 * s.lamps; m.envMapIntensity = 0.12 + 0.88 * s.day; }
    ramTowerM.color.copy(ramDay).lerp(ramNight, s.lamps); // facade frames darken at night so the lit offices stand out
    for (const [m, f] of interiorTower) m.emissiveIntensity = f * s.lamps;
    passM.color.copy(passDay).lerp(passNight, s.lamps);
    circleM.emissiveIntensity = 1.0 + 1.6 * s.lamps; glowBrainM.opacity = 0.5 + 0.45 * s.lamps; rayM.opacity = 0.28 + 0.45 * s.lamps; brainGlow = 0.55 + 0.75 * s.lamps;
    edgesBrainM.opacity = 0.5 + 0.4 * s.lamps; domeM.envMapIntensity = 0.4 + 0.8 * s.day; for (const m of thread) m.opacity = 0.35 + 0.45 * s.lamps;
    surroundings.time(s); sky.time(s); home.time(s);
  }

  function refreshCards() {
    for (const { el, b } of cards) {
      const P = b.floors.map((p) => WORLD.floors.get(p.n));
      const agentCount = P.reduce((s, x) => s + x.agents.length, 0);
      const ul = WORLD.tasks.filter((u) => b.floors.some((p) => p.n === u.p));
      const c = (st) => ul.filter((u) => u.column === st || (st === 'doing' && u.column === 'flies')).length;
      const pending = c('pending');
      el.classList.toggle('alarm', pending > 0);
      el.innerHTML = `<div class="h"><span class="point" style="background:${b.color}"></span><span class="mono" style="color:var(--ink)">${esc(b.title)}</span>${pending ? `<span class="mono" style="margin-left:auto;color:var(--err)">${ico('pending')} ${_t('app.city.pending', { n: pending })}</span>` : ''}</div>
        <div class="number">${agentCount}<small>${_t('app.city.card.agents')} · ${_tn('app.city.floors', b.floors.length)}</small></div>
        <div class="rows">${b.rows.map(([k, v]) => `<div class="r"><span>${esc(k)}</span>${esc(v)}</div>`).join('')}</div>
        <div class="states">${_t('app.city.card.doing')}<b>${c('doing')}</b> ${_t('app.city.card.rad')}<b>${c('rad')}</b> ${_t('app.city.card.done')}<b>${c('done')}</b></div>`;
    }
    // v19: the Brain label only "Brain", the note count and who read last is in the title; the DOM is written only when the content changes
    const p = WORLD.brain.last, mTip = `Second Brain · ${_t('app.city.notes', { n: BRAIN_COUNT })}${p ? `\n${_t(p.direction === 'write' ? 'app.city.brainWrote' : 'app.city.brainRead', { who: p.who })}` : ''}`;
    if (mTip !== mozTip) { mozTip = mTip; mozEl.title = mTip; if (!mozEl.firstChild) mozEl.textContent = _t('app.city.brain'); }
    if (cent) { // label and board of the center: rewritten only on change
      const ag = WORLD.floors.get(CN).agents, S = CONTROL_CENTER.status;
      const point = ag.some((a) => a.status === 'pending') ? 'pending' : ag.some((a) => a.status === 'work' || a.status === 'delegates') || S?.serverChanged?.length ? 'work' : 'done';
      const sf = controlCenterBadge(), html = `${point === 'done' ? '' : `<span class="point ${point}"></span>`}${_t('app.city.controlCenter')}${sf ? ` · <span class="stZ">${esc(sf)}</span>` : ''}`, tip = titleControlCenter();
      if (html !== cent.badge) { cent.badge = html; cent.el.innerHTML = html; }
      if (tip !== cent.tip) { cent.tip = tip; cent.el.title = tip; }
      const tl = S?.log?.map((c) => c.h).join() || '';
      if (tl !== cent.whiteboard) { cent.whiteboard = tl; cent.drawBoard(S.log); }
    }
  }

  return {
    kind: 'city', scene, camera, floors, get controls() { return controls; }, newControls,
    controlCenterView: C ? { t: V3(UZ.x, 5.5, UZ.z), p: V3(UZ.x + 12, 17, UZ.z + 32) } : null, // ?controlCenter in the address flies here (the label fits under the bar)
    universalView: uniBandM ? { t: V3(6.6, 0.8, -14.2), p: V3(18.6, 12, 14) } : null, // ?universal in the address flies to the kiosk
    flyOn(target, position, zoom) { fly_ = { t: 0, zT: controls.target.clone(), naT: target, zP: camera.position.clone(), naP: position, zZ: camera.zoom, naZ: zoom ?? camera.zoom }; },
    district(r) { const v = r === 'home' ? homeView : r === 'work' ? workView : cityView; this.flyOn(v.t.clone(), v.p.clone(), v.z); },
    pick(e) { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera); return ray.intersectObjects(click, false)[0]?.object.userData.id || null; },
    update(dt, t, hover) {
      if (fly_) { fly_.t = Math.min(1, fly_.t + dt * 1.2); const k = 1 - Math.pow(1 - fly_.t, 3); controls.target.lerpVectors(fly_.zT, fly_.naT, k); camera.position.lerpVectors(fly_.zP, fly_.naP, k); if (fly_.naZ !== fly_.zZ) { camera.zoom = fly_.zZ + (fly_.naZ - fly_.zZ) * k; camera.updateProjectionMatrix(); } if (fly_.t >= 1) fly_ = null; }
      let pendingSomeone = false, workingSomeone = false;
      const hoverTower = floors.get(hover)?.building;
      // while the name ladder is shown, the center's card fades and releases the mouse so it does not overlap with it
      if (!!hoverTower !== document.body.classList.contains('ladderOn')) document.body.classList.toggle('ladderOn', !!hoverTower);
      for (const [id, x] of floors) {
        x.slideOut += (x.target - x.slideOut) * Math.min(1, dt * 7); x.g.position.z = x.slideOut;
        const ag = WORLD.floors.get(id).agents;
        const pending = ag.some((a) => a.status === 'pending'), work = ag.some((a) => a.status === 'work');
        x.hr.color.set(pending ? 0xe2483d : work ? GREEN : skin.edges); x.hr.opacity = id === hover || pending || work ? 1 : 0.65;
        if (pending) pendingSomeone = true; else if (work) workingSomeone = true;
        if (x.workO.visible !== (work && !pending)) x.workO.visible = work && !pending;
        if (x.alarm.visible !== pending) { x.alarm.visible = pending; x.alarmObj.visible = pending; }
        if (pending) { const who = ag.filter((a) => a.status === 'pending').map((a) => a.name), txt = `${id} · ${who.length > 1 ? _t('app.city.pendingMore', { n: who.length }) : _t('app.city.pendingName', { name: who[0] })}`; if (txt !== x.alarmText) { x.alarmText = txt; x.alarmEl.innerHTML = ico('pending') + ' ' + esc(txt); x.alarmEl.title = _t('app.city.clickAndApprove'); } }
        x.glass.opacity = id === hover ? 0.12 : GLASS_OPACITY; // on hover the glass becomes transparent and you see inside
        const reb = hoverTower && x.building === hoverTower ? `on${id === hover ? ' hl' : ''} ${pending ? 'pending' : work ? 'work' : ''}` : '';
        if (reb !== x.rebStatus) { x.rebStatus = reb; x.rebObj.visible = !!reb; x.rebEl.className = 'rebBadge ' + reb; }
        for (const { ch, ag: a, sed, stand, bub } of x.figures) {
          ch.position.copy(a.status === 'pending' ? stand : sed);
          animate(ch, ['pending', 'work', 'done', 'delegates'].includes(a.status) ? a.status : 'none', t);
          bub.visible = a.status === 'pending'; if (bub.visible) bub.position.y = 2.25 + Math.sin(t * 3) * 0.08;
        }
      }
      if (cent) { // center: crane, beacon, glass on hover, figures
        const ag = WORLD.floors.get(CN).agents, pending = ag.some((a) => a.status === 'pending'), newServer = !!CONTROL_CENTER.status?.serverChanged?.length;
        cent.top.rotation.y += dt * (ag.some((a) => a.status === 'work' || a.status === 'delegates') ? 0.3 : 0.03);
        const blink = pending || newServer;
        cent.lighthouse.material.color.set(CONTROL_CENTER.error ? 0xe2483d : blink ? 0xf08a3c : 0x3ddc84); cent.lighthouse.visible = !blink || Math.sin(t * 6) > -0.3;
        cent.glassM.opacity = hover === CN ? 0.12 : GLASS_OPACITY;
        cent.parabola.rotation.y = Math.sin(t * 0.25) * 0.7; cent.dispatchM.emissiveIntensity = hover === DISPATCH_ID ? 1.4 : 0.4; // Dispatch satellite
        const rc = hover === CN ? '1' : hover === DISPATCH_ID ? '2' : ''; // name ladder: lower floor / Dispatch
        if (rc !== cent.reb) { cent.reb = rc; cent.rebC.forEach(({ e, o }, i) => { o.visible = !!rc; e.className = 'rebBadge' + (rc ? ' on' : '') + (+rc === i + 1 ? ' hl' : ''); }); }
        const pr = ag.some((a) => a.status === 'work' || a.status === 'delegates');
        if (cent.alarmC.visible !== pending) cent.alarmC.visible = pending; if (cent.workC.visible !== (pr && !pending)) cent.workC.visible = pr && !pending;
        if (pending) pendingSomeone = true; else if (pr) workingSomeone = true;
        for (const { ch, ag: a, sed, stand, bub } of cent.figures) {
          ch.position.copy(a.status === 'pending' ? stand : sed); animate(ch, ['pending', 'work', 'done', 'delegates'].includes(a.status) ? a.status : 'none', t);
          bub.visible = a.status === 'pending'; if (bub.visible) bub.position.y = 2.25 + Math.sin(t * 3) * 0.08;
        }
      }
      if (pendingSomeone) alarmM.opacity = 0.12 + 0.3 * (0.5 + 0.5 * Math.sin(t * 5)); // red blinks fast, only when someone is waiting
      if (workingSomeone) workM.opacity = 0.07 + 0.17 * (0.5 + 0.5 * Math.sin(t * 2.2)); // green pulses slowly, only when work is going on somewhere
      brain.rotation.y += dt * 0.12;
      for (const u of nodes) { if (u.pulse > 0) u.pulse = Math.max(0, u.pulse - dt * 0.9); u.s.scale.setScalar(u.base * (1 + u.pulse * 1.6)); u.s.material.emissiveIntensity = brainGlow + u.pulse; }
      if (uniBandM) uniBandM.emissiveIntensity = hover === UNIVERSAL ? 1.1 : 0.35 + 0.35 * (brainGlow - 0.3);
      domeM.opacity = hover === 'Second Brain' ? 0.07 : 0.2; circle.scale.setScalar(1 + Math.sin(t * 1.6) * 0.012);
      for (const d of wires) {
        d.t += dt / 2.2; d.line.material.opacity = Math.max(0, 0.9 * (1 - d.t));
        for (const { b, o } of d.dots) { const tt = Math.min(1, Math.max(0, d.t * 1.6 - o)); b.position.copy(d.curve.getPoint(d.direction === 'write' ? 1 - tt : tt)); b.visible = d.t < 1; }
        if (d.t >= 1) { scene.remove(d.line); d.line.geometry.dispose(); d.dots.forEach(({ b }) => { scene.remove(b); b.geometry.dispose(); }); }
      }
      for (let i = wires.length - 1; i >= 0; i--) if (wires[i].t >= 1) wires.splice(i, 1);
      surroundings.update(dt, t); home.update(dt, t, hover); sky.update(); target0.copy(controls.target);
      for (const k of cards) k.obj.visible = DISTRICT === 'work'; // cards above the towers only in the Work view (in City and Home they do not hide the scene)
      if (t - lastTime > 0.2) { lastTime = t; applyTime(); }
      if (t - lastCards > 0.5) { lastCards = t; refreshCards(); }
    },
    dispose() { WORLD.listen.delete(listener); controls.dispose(); },
  };
}
