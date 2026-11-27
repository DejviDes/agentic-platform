// daylight.js – Time of day: simulated time (auto / fast / noon / night, ?time=HH:MM), sun by the location from world.json, dayState(), sky colors.
// Created by splitting the prototype public/dizajn-v12d.html (phase 1). Module map: brain Projekty/mesto-agentov/technika.md.
import * as THREE from 'three';

// =====================================================================
// CITY SURROUNDINGS + TIME OF DAY: sun, moon and lights by real time and location
// =====================================================================
const MODE_KEY = 'city-time-v8';
export let MODE = 'auto'; try { MODE = localStorage.getItem(MODE_KEY) || 'auto'; } catch {}
const SPEEDUP = 960;                       // fast mode: the whole day in 90 seconds
let zrStart = performance.now(), zrOd = Date.now();
// ?time=16:10 in the address freezes time at that hour (for a quick look at the sunset and the like)
const FIXED = (new URLSearchParams(location.search).get('time') || '').match(/^(\d{1,2}):(\d{2})$/);
export function simTime() {
  const d = new Date();
  if (FIXED) { d.setHours(+FIXED[1], +FIXED[2], 0, 0); return d; }
  if (MODE === 'accelerated') return new Date(zrOd + (performance.now() - zrStart) * SPEEDUP);
  if (MODE === 'day') { d.setHours(12, 0, 0, 0); return d; }
  if (MODE === 'evening') { d.setHours(22, 0, 0, 0); return d; }
  return d;
}
// sun height above the horizon (simplified calculation like in the suncalc library) for LOCATION.
// LOCATION = `location` from world.json (setLocation is called by source.js); without it the longitude from the browser time zone and a general latitude of 48°.
export const RAD = Math.PI / 180;
export const LOCATION = { lat: 48, lon: null, own: false };
export function setLocation(p) {
  const ok = p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
  LOCATION.lat = ok ? p.lat : 48; LOCATION.lon = ok ? p.lon : null; LOCATION.own = Boolean(ok); _vz.clear();
}
const length = () => LOCATION.lon ?? -new Date().getTimezoneOffset() / 4; // 60 min of shift = 15°
function heightSun(date) {
  const d = date.valueOf() / 86400000 - 0.5 + 2440588 - 2451545;
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI, tilt = RAD * 23.4397;
  const declination = Math.asin(Math.sin(L) * Math.sin(tilt)), ra = Math.atan2(Math.sin(L) * Math.cos(tilt), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * length() - ra, fi = RAD * LOCATION.lat;
  return Math.asin(Math.sin(fi) * Math.sin(declination) + Math.cos(fi) * Math.cos(declination) * Math.cos(H)) / RAD;
}
const _vz = new Map();
export function eastWest(date) {
  const k = date.toDateString(); if (_vz.has(k)) return _vz.get(k);
  const p = new Date(date); p.setHours(0, 0, 0, 0);
  let east = null, west = null, ago = heightSun(p);
  for (let m = 2; m <= 1440; m += 2) { const t = new Date(p.valueOf() + m * 60000), v = heightSun(t); if (ago < 0 && v >= 0 && !east) east = t.valueOf(); if (ago >= 0 && v < 0) west = t.valueOf(); ago = v; }
  const r = { east: east ?? p.valueOf() + 7 * 3600000, west: west ?? p.valueOf() + 17 * 3600000 }; _vz.set(k, r); return r;
}
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function dayState() {
  const now = simTime(), e = heightSun(now), { east, west } = eastWest(now), t = now.valueOf();
  const p = (t - east) / (west - east);                       // day: 0 = sunrise, 1 = sunset
  let pn;                                                          // night: 0 = sunset, 1 = sunrise
  if (t >= west) { const z = eastWest(new Date(t + 86400000)); pn = (t - west) / (z.east - west); }
  else { const v = eastWest(new Date(t - 86400000)); pn = (t - v.west) / (east - v.west); }
  return { now, e, p, pn, east, west, day: smooth(-4, 8, e), night: 1 - smooth(-10, -2, e), lamps: 1 - smooth(-1, 5, e), gold: smooth(-6, 0, e) * (1 - smooth(4, 14, e)) };
}
const SKY = {
  a: { day: ['#8dbae3', '#e1ecf2'], // v13e: bluer sky during the day (previously #dbe5ec → #eef1f2)
       gold: ['#c3d1e6', '#ffd09c'], dusk: ['#39436a', '#f08c6a'], night: ['#0f1320', '#232a40'] },
};
export function skyColors(k, e) {
  const O = SKY[k], c = (a, b, t) => [0, 1].map((i) => new THREE.Color(a[i]).lerp(new THREE.Color(b[i]), Math.min(1, Math.max(0, t))));
  if (e >= 10) return c(O.day, O.day, 0);
  if (e >= 2) return c(O.gold, O.day, (e - 2) / 8);
  if (e >= -4) return c(O.dusk, O.gold, (e + 4) / 6);
  if (e >= -10) return c(O.night, O.dusk, (e + 10) / 6);
  return c(O.night, O.night, 0);
}

// time of day button in the panel: Auto → Fast → Noon → Night → Auto
export function nextMode() {
  MODE = { auto: 'accelerated', accelerated: 'day', day: 'evening', evening: 'auto' }[MODE]; try { localStorage.setItem(MODE_KEY, MODE); } catch {}
  if (MODE === 'accelerated') { zrStart = performance.now(); const d = new Date(); d.setHours(5, 30, 0, 0); zrOd = d.valueOf(); } // the fast day starts before sunrise
}
