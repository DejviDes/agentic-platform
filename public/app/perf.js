// perf.js – Performance measurement: ?meranie in the address, a panel at the bottom left, window.__meranie (test, stats, samples).
// Created by splitting the prototype public/dizajn-v12d.html (phase 1). Module map: brain Projekty/mesto-agentov/technika.md.
import * as THREE from 'three';
import { active, DISTRICT } from './state.js';
import { tickWorld } from './world.js';
import { clock, labelRenderer, renderer } from './scene-base.js';
import { t as T, locale } from './i18n.js';

// ---------- performance measurement: ?meranie in the address ----------
// A panel at the bottom left with numbers for the last 2 s, samples every 5 s into window.__meranie (export: __perf.vzorky).
// CPU time = how many ms one frame takes in JavaScript (simulation, scene, WebGL commands, labels, panel).
// GPU time via EXT_disjoint_timer_query_webgl2 (if the browser provides it), load = share of the time when the CPU works on the page.
export const PERF = (() => {
  const isOn = new URLSearchParams(location.search).has('perf');
  const gl = renderer.getContext(), ext = isOn ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
  const S = { frames: 0, sim: 0, scene: 0, webgl: 0, badges: 0, panel: 0, max: 0, gpu: 0, gpuN: 0, long: 0 }, pending = [];
  let windowStart = performance.now(), lastVz = performance.now(), el = null, last = {};
  const samples = [];
  // test: n frames in a row without waiting for the browser (works also in a hidden window). Returns the average per frame:
  // cpu = JavaScript + commands for WebGL, total = including completion on the graphics card (gl.finish), shadows = with shadow recomputation on.
  function test(n = 60, shadows = false) {
    const sc = active, r = (v) => Math.round(v * 100) / 100; let cpu = 0, sim = 0, upd = 0, gl3 = 0, label = 0;
    gl.finish(); const z = performance.now();
    for (let i = 0; i < n; i++) {
      const a = performance.now(); tickWorld(1 / 30); const b = performance.now(); sc.update(1 / 30, clock.elapsedTime + i / 30, null); sc.controls.update(); const c = performance.now();
      if (shadows) renderer.shadowMap.needsUpdate = true; renderer.render(sc.scene, sc.camera); const d = performance.now(); labelRenderer.render(sc.scene, sc.camera); const e = performance.now();
      sim += b - a; upd += c - b; gl3 += d - c; label += e - d; cpu += e - a;
    }
    gl.finish(); const total = (performance.now() - z) / n, I = renderer.info;
    return { view: sc.kind === 'city' ? `city/${DISTRICT}` : sc.kind, cpuMs: r(cpu / n), totalMs: r(total), simMs: r(sim / n), sceneUpdateMs: r(upd / n), webglMs: r(gl3 / n), labelsMs: r(label / n),
      calls: I.render.calls, triangles: I.render.triangles, geometries: I.memory.geometries, textures: I.memory.textures, programs: I.programs?.length, heapMB: performance.memory ? r(performance.memory.usedJSHeapSize / 1048576) : null, pixels: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray() };
  }
  // scene statistics: how many objects and materials there are and what could be merged
  function stats() {
    const sc = active.scene, mats = new Set(), types = {}; let mesh = 0, visible = 0, transp = 0, motion = 0;
    sc.traverse((o) => { if (!o.isMesh) return; mesh++; if (o.visible) visible++; const m = o.material; if (Array.isArray(m)) return; mats.add(m.uuid); types[m.type] = (types[m.type] || 0) + 1; if (m.transparent) transp++; if (o.matrixAutoUpdate) motion++; });
    // breakdown by top-level scene objects: mesh count, of which with a unique material, moving and transparent
    const count = new Map(); sc.traverse((o) => { if (o.isMesh && !Array.isArray(o.material)) count.set(o.material.uuid, (count.get(o.material.uuid) || 0) + 1); });
    const breakdown = sc.children.map((ch, i) => { let n = 0, jed = 0, poh = 0, tr = 0, mats = new Set(), sig = new Set(); ch.traverse((o) => { if (!o.isMesh || Array.isArray(o.material)) return; n++; const m = o.material; mats.add(m.uuid); if (count.get(m.uuid) === 1) jed++; if (o.matrixAutoUpdate) poh++; if (m.transparent) tr++;
      sig.add([m.type, m.color?.getHex(), m.emissive?.getHex(), m.roughness, m.metalness, m.map?.uuid, m.transparent, m.opacity, m.side, m.flatShading, m.vertexColors].join('|')); });
      return { i, type: ch.type, children: ch.children.length, mesh: n, materials: mats.size, signatures: sig.size, unique: jed, motion: poh, transparent: tr }; }).filter((x) => x.mesh > 20).sort((a, b) => b.mesh - a.mesh);
    return { mesh, visible, materials: mats.size, transp, matrixAutoUpdate: motion, types, breakdown };
  }
  if (isOn) window.__perf = { samples, last: () => last, info: () => renderer.info, test, stats };
  if (isOn) { el = document.createElement('div'); Object.assign(el.style, { position: 'fixed', left: '12px', bottom: '34px', zIndex: 20, font: '11px/1.45 "JetBrains Mono", monospace', background: 'rgba(20,22,28,.85)', color: '#e8e8e8', padding: '8px 10px', borderRadius: '8px', pointerEvents: 'none', whiteSpace: 'pre' }); document.body.appendChild(el);
    new PerformanceObserver((l) => { for (const e of l.getEntries()) S.long += e.duration; }).observe({ type: 'longtask', buffered: false }); }
  let q = null;
  return {
    isOn,
    gpuStart() { if (!ext || q) return; q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); },
    gpuStop() { if (!q) return; gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); q = null; },
    snapshot(d) {
      if (!isOn) return;
      S.frames++; for (const k of ['sim', 'scene', 'webgl', 'badges', 'panel']) S[k] += d[k]; S.max = Math.max(S.max, d.total);
      while (pending.length) { const x = pending[0]; if (!gl.getQueryParameter(x, gl.QUERY_RESULT_AVAILABLE)) break; if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { S.gpu += gl.getQueryParameter(x, gl.QUERY_RESULT) / 1e6; S.gpuN++; } gl.deleteQuery(x); pending.shift(); }
      const now = performance.now(), dt = now - windowStart; if (dt < 2000) return;
      const n = Math.max(1, S.frames), r = (v) => Math.round(v * 100) / 100, I = renderer.info, mem = performance.memory;
      const cpu = (S.sim + S.scene + S.webgl + S.badges + S.panel) / n;
      last = { time: new Date().toLocaleTimeString(locale()), view: active?.kind === 'city' ? `city/${DISTRICT}` : active?.kind || '-', fps: r(S.frames * 1000 / dt), cpuMs: r(cpu), maxMs: r(S.max),
        simMs: r(S.sim / n), sceneMs: r(S.scene / n), webglMs: r(S.webgl / n), badgesMs: r(S.badges / n), panelMs: r(S.panel / n), gpuMs: S.gpuN ? r(S.gpu / S.gpuN) : null,
        load: r((cpu * S.frames) / dt * 100), longTasksMs: Math.round(S.long), calls: I.render.calls, triangles: I.render.triangles, geometries: I.memory.geometries, textures: I.memory.textures, programs: I.programs?.length,
        heapMB: mem ? r(mem.usedJSHeapSize / 1048576) : null, houseNodes: document.getElementsByTagName('*').length, badges: labelRenderer.domElement.childElementCount };
      el.textContent = `${last.view}  ${last.fps} fps   CPU ${last.cpuMs} ms/${T('app.perf.snapshot')} (max ${last.maxMs})   ${T('app.perf.load')} ${last.load} %\n` +
        `  sim ${last.simMs} · ${T('app.perf.scene')} ${last.sceneMs} · WebGL ${last.webglMs} · ${T('app.perf.labels')} ${last.badgesMs} · panel ${last.panelMs}   GPU ${last.gpuMs ?? 'n/a'} ms\n` +
        `  ${last.calls} ${T('app.perf.calls')} · ${(last.triangles / 1000).toFixed(0)}k ${T('app.perf.triangle')} · geom ${last.geometries} · ${T('app.perf.text')} ${last.textures} · ${T('app.perf.shaders')} ${last.programs}\n` +
        `  JS heap ${last.heapMB ?? 'n/a'} MB · DOM ${last.houseNodes} · ${T('app.perf.nameTags')} ${last.badges} · ${T('app.perf.longTasks')} ${last.longTasksMs} ms`;
      if (now - lastVz > 5000) { samples.push(last); lastVz = now; }
      Object.assign(S, { frames: 0, sim: 0, scene: 0, webgl: 0, badges: 0, panel: 0, max: 0, gpu: 0, gpuN: 0, long: 0 }); windowStart = now;
    },
  };
})();
// v12c: when the window is not active (you work in another app), at most 10 frames/s. Resolution by activity:
// when working with the mouse 1.5× (sharp), when you only look 1.25×, after 1.5 min without movement 1×. Labels in the city
// are recomputed only when the camera moves (they are attached to static buildings).
