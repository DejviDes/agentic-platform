// Mesto agentov icon in the Maketa style: an isometric city made of boards.
// Run: node icon/build.mjs  (writes SVG and PNG to public/ and public/mobile/)
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INK = '#151515', PAPER = '#f4f3ee', TOP = '#ffffff', LAVA = '#e6e3da', RIGHTS = '#cdc9bd';
const C = Math.cos(Math.PI / 6), S = Math.sin(Math.PI / 6);

// isometry: x right-down, y left-down, z up
function point(x, y, z, k, ox, oy) { return [ox + (x - y) * C * k, oy + (x + y) * S * k - z * k]; }
const pts = a => a.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');

function cuboid({ x, y, z = 0, w, d, h, top: topColor = TOP, lava = LAVA, rights = RIGHTS, window }, k, ox, oy, hr) {
  const P = (a, b, c) => point(a, b, c, k, ox, oy);
  const t = z + h;
  const top = [P(x, y, t), P(x + w, y, t), P(x + w, y + d, t), P(x, y + d, t)];
  const left = [P(x, y + d, t), P(x + w, y + d, t), P(x + w, y + d, z), P(x, y + d, z)];
  const right = [P(x + w, y, t), P(x + w, y + d, t), P(x + w, y + d, z), P(x + w, y, z)];
  const st = `stroke="${INK}" stroke-width="${hr}" stroke-linejoin="round"`;
  let s = `<polygon points="${pts(left)}" fill="${lava}" ${st}/>`
        + `<polygon points="${pts(right)}" fill="${rights}" ${st}/>`
        + `<polygon points="${pts(top)}" fill="${topColor}" ${st}/>`;
  // floors: thin lines on the walls (boards)
  for (let zz = z + 1; zz < t - 0.01; zz += 1) {
    s += `<polyline points="${pts([P(x, y + d, zz), P(x + w, y + d, zz), P(x + w, y, zz)])}" fill="none" stroke="${INK}" stroke-opacity=".28" stroke-width="${hr * 0.6}"/>`;
  }
  if (window) { // one warm window on the right wall
    const [a, b, c2] = window; // y from, y to, z
    s += `<polygon points="${pts([P(x + w, y + a, c2 + 0.7), P(x + w, y + b, c2 + 0.7), P(x + w, y + b, c2 + 0.2), P(x + w, y + a, c2 + 0.2)])}" fill="#e3a032" stroke="${INK}" stroke-width="${hr * 0.6}"/>`;
  }
  return s;
}

// city: base plate + buildings (drawn back to front by x+y)
const BUILDINGS = [
  { x: 0.3, y: 2.7, w: 1.5, d: 1.6, h: 3 },             // first building on the left
  { x: 2.7, y: 0.3, w: 1.6, d: 1.5, h: 2 },             // second building on the right
  { x: 1.7, y: 1.7, w: 1.4, d: 1.4, h: 5, window: [0.35, 1.05, 3.1] }, // Brain in the middle
  { x: 3.4, y: 3.4, w: 1.1, d: 1.1, h: 1 },             // district in front
].sort((a, b) => (a.x + a.y) - (b.x + b.y));

function city(k, ox, oy, hr) {
  let s = cuboid({ x: 0, y: 0, z: -0.45, w: 4.8, d: 4.8, h: 0.45, top: '#efede6' }, k, ox, oy, hr);
  for (const b of BUILDINGS) s += cuboid(b, k, ox, oy, hr);
  return s;
}

// fits the city into a square (x0, y0, side v) with a proportional margin
function place(x0, y0, v, margin) {
  const xs = [], ys = [];
  const all = [{ x: 0, y: 0, z: -0.45, w: 4.8, d: 4.8, h: 0.45 }, ...BUILDINGS];
  for (const b of all) for (const a of [b.x, b.x + b.w]) for (const c of [b.y, b.y + b.d]) for (const z of [b.z || 0, (b.z || 0) + b.h]) {
    const [px, py] = point(a, c, z, 1, 0, 0); xs.push(px); ys.push(py);
  }
  const sx = Math.max(...xs) - Math.min(...xs), sy = Math.max(...ys) - Math.min(...ys);
  const k = v * (1 - 2 * margin) / Math.max(sx, sy);
  return { k, ox: x0 + v / 2 - k * (Math.min(...xs) + sx / 2), oy: y0 + v / 2 - k * (Math.min(...ys) + sy / 2) };
}

// full square (iPhone, Safari and favicon round the corners themselves)
function svgFilled(N) {
  const { k, ox, oy } = place(0, 0, N, 0.12);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="${N}" height="${N}">`
    + `<rect width="${N}" height="${N}" fill="${PAPER}"/>` + city(k, ox, oy, N * 0.011) + `</svg>`;
}

// macOS: rounded square 824/1024 with a margin and shadow (for a manual change via Get Info)
function svgMac() {
  const N = 1024, m = 100, r = 185, v = N - 2 * m;
  const { k, ox, oy } = place(m, m, v, 0.13);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="${N}" height="${N}">`
    + `<defs><filter id="t" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-opacity=".28"/></filter>`
    + `<clipPath id="o"><rect x="${m}" y="${m}" width="${v}" height="${v}" rx="${r}"/></clipPath></defs>`
    + `<rect x="${m}" y="${m}" width="${v}" height="${v}" rx="${r}" fill="${PAPER}" filter="url(#t)"/>`
    + `<g clip-path="url(#o)">${city(k, ox, oy, v * 0.011)}</g></svg>`;
}

const svg = svgFilled(512);
writeFileSync(join(root, 'public/icon.svg'), svg);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
async function png(svgText, N, path) {
  await page.setViewportSize({ width: N, height: N });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svgText.replace(/width="\d+" height="\d+"/, `width="${N}" height="${N}"`)}</body></html>`);
  await page.locator('svg').screenshot({ path: join(root, path), omitBackground: true });
  console.log('✓', path);
}
await png(svg, 180, 'public/apple-touch-icon.png');
await png(svg, 180, 'public/mobile/icon-180.png');
await png(svg, 192, 'public/mobile/icon-192.png');
await png(svg, 512, 'public/mobile/icon-512.png');
await png(svgMac(), 1024, 'icon/icon-mac-1024.png');
await browser.close();
