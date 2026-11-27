// Visualizations in chat (2026-11-18): a ```visual block (a standalone HTML page in an isolated window) and ```video (YouTube, Vimeo, direct file).
// md() from conversations.js inserts only an .mdViz placeholder with the code; the window (iframe) is created by attachVisuals() only when it is near the screen.
// Re-rendering the thread: park() before innerHTML and attachVisuals() after it move live windows via moveBefore (animation and video state stay).
// Off screen a visual is paused (rAF, timers, CSS and SVG animations via a helper script in the window).
import { esc } from './utils.js';
import { ico } from './icons.js';
import { t as T } from './i18n.js';

const V = { init: false, io: null, park: null, sled: new Set(), status: new Map(), windows: new Map() }; // state: key → { h, pause, large }; windows: key → iframe
const MAX_H = 640, MIN_H = 60;

function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const st = (k) => { let s = V.status.get(k); if (!s) { s = { h: 0, pause: false, large: false }; V.status.set(k, s); } return s; };

// ---------- video: link → embed ----------
function timeOnSec(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return +t;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t); if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  const c = t.split(':').map(Number); return c.some(isNaN) ? 0 : c.reduce((a, x) => a * 60 + x, 0);
}
export function parseVideo(code) {
  const r = code.split('\n').map((x) => x.trim()).filter(Boolean);
  const url = r.find((x) => /^https?:\/\//i.test(x)); if (!url) return null;
  let from = 0; const description = [];
  for (const x of r) { if (x === url) continue; const m = /^(?:od|start|čas|cas)\s*:?\s*([\dhms:]+)$/i.exec(x); if (m) from = timeOnSec(m[1]); else description.push(x); }
  let u; try { u = new URL(url); } catch { return null; }
  if (!from) from = timeOnSec(u.searchParams.get('t') || u.searchParams.get('start') || '');
  const host = u.hostname.replace(/^(www|m)\./, '');
  let yt = null;
  if (host === 'youtu.be') yt = u.pathname.slice(1);
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) yt = u.searchParams.get('v') || (/^\/(shorts|embed|live)\/([\w-]+)/.exec(u.pathname) || [])[2];
  if (yt && /^[\w-]{6,20}$/.test(yt)) return { kind: 'iframe', url, description: description.join(' '), high: /\/shorts\//.test(u.pathname), src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0&playsinline=1&modestbranding=1${from ? `&start=${from}` : ''}` };
  const vi = host === 'vimeo.com' && /^\/(\d+)/.exec(u.pathname);
  if (vi) return { kind: 'iframe', url, description: description.join(' '), src: `https://player.vimeo.com/video/${vi[1]}${from ? `#t=${from}s` : ''}` };
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return { kind: 'video', url, description: description.join(' '), src: url + (from ? `#t=${from}` : '') };
  if (/\.(gif|webp|png|jpe?g|svg)$/i.test(u.pathname)) return { kind: 'image', url, description: description.join(' '), src: url };
  return null;
}

// ---------- placeholder in md() ----------
export function visualBlock(code, language, closed) {
  const kind = language.toLowerCase() === 'video' ? 'video' : 'visual';
  if (!closed) return `<div class="mdVisual draw"><div class="mdVisualH"><span>${kind === 'video' ? ico('play') + ' ' + T('app.visual.video') : ico('spark') + ' ' + T('app.visual.visualization')}</span></div><div class="mdVisualPending">${kind === 'video' ? T('app.visual.inserting') : T('app.visual.drawing')}</div></div>`;
  const k = hash(kind + '\n' + code), s = V.status.get(k);
  const codeHtml = `<pre class="mdPre mdVisualCode" hidden>${esc(code)}</pre>`;
  if (kind === 'video') {
    const v = parseVideo(code);
    if (!v) return `<div class="mdVisual error"><div class="mdVisualH"><span>${ico('play')} ${T('app.visual.video')}</span></div><div class="mdVisualPending">${T('app.visual.cannot')}</div>${codeHtml.replace(' hidden', '')}</div>`;
    return `<div class="mdVisual video${v.high ? ' high' : ''}" data-visual="${k}" data-kind="video"><div class="mdVisualH"><span>${ico('play')} ${esc(v.description || T('app.visual.video'))}</span><span><a class="mdCopy" href="${esc(v.url)}" target="_blank" rel="noopener" title="${T('app.visual.openHeading')}">${T('app.visual.open')} ${ico('out')}</a></span></div><div class="mdVisualO"></div>${codeHtml}</div>`;
  }
  const tl = (a, t, z) => `<button type="button" class="mdCopy" data-viza="${a}" title="${t}">${z}</button>`;
  return `<div class="mdVisual${s?.large ? ' large' : ''}" data-visual="${k}" data-kind="visual"><div class="mdVisualH"><span>${ico('spark')} ${T('app.visual.visualization')}</span><span class="mdVisualError" hidden></span><span>${tl('pause', T('app.visual.pause'), s?.pause ? ico('play') : ico('pause'))}${tl('again', T('app.visual.again'), ico('refresh'))}${tl('large', T('app.visual.large'), s?.large ? '⤡' : '⤢')}${tl('code', T('app.visual.showCode'), T('app.visual.code'))}${tl('copy', T('app.visual.copyHeading'), T('app.visual.copy'))}</span></div><div class="mdVisualO"${s?.h ? ` style="height:${s.h}px"` : ''}></div>${codeHtml}</div>`;
}

// ---------- visualization window ----------
// helper script in the window: height for the parent, pause (rAF, timers, CSS/SVG animations, videos), errors
const HELP = `(()=>{let p=0;const q=[],R=requestAnimationFrame.bind(window),T=setTimeout.bind(window),I=setInterval.bind(window),A=new Set();
window.requestAnimationFrame=(f)=>R(function g(t){if(p)q.push(()=>R(f));else f(t)});
window.setTimeout=(f,ms,...a)=>T(function g(){if(p)q.push(()=>T(g,0));else typeof f==='function'?f(...a):0},ms);
window.setInterval=(f,ms,...a)=>I(()=>{if(!p&&typeof f==='function')f(...a)},ms);
const floor=(m)=>parent.postMessage(Object.assign({mvz:1},m),'*');
let h=0;const vy=()=>{const n=Math.ceil(Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0));if(n!==h){h=n;floor({h:n})}};
addEventListener('load',()=>{vy();new ResizeObserver(vy).observe(document.documentElement);document.body&&new ResizeObserver(vy).observe(document.body)});
addEventListener('error',(e)=>floor({error:String(e.message||e.error||'error')}));
addEventListener('message',(e)=>{const d=e.data||{};if(d.mvz!==1)return;
 if(d.pause&&!p){p=1;document.getAnimations().forEach(a=>{if(a.playState==='running'){a.pause();A.add(a)}});document.querySelectorAll('svg').forEach(s=>s.pauseAnimations&&s.pauseAnimations());document.querySelectorAll('video,audio').forEach(v=>{if(!v.paused){v.pause();v.dataset.mvz=1}})}
 else if(!d.pause&&p){p=0;A.forEach(a=>a.play());A.clear();document.querySelectorAll('svg').forEach(s=>s.unpauseAnimations&&s.unpauseAnimations());document.querySelectorAll('video[data-mvz],audio[data-mvz]').forEach(v=>{delete v.dataset.mvz;v.play()});q.splice(0).forEach(f=>f())}});
})();`;
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:";
function colors() {
  const cs = getComputedStyle(document.documentElement);
  return ['bg', 'ink', 'muted', 'line', 'card', 'soft', 'accent', 'accent-ink', 'ok', 'warn', 'err'].map((n) => `--${n}:${cs.getPropertyValue(`--${n}`).trim() || 'initial'}`).join(';');
}
function srcdoc(code) {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>:root{${colors()};color-scheme:light}html,body{margin:0;background:transparent;color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif}body{padding:10px 12px}button{font:inherit;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:5px 11px}button:hover{background:var(--soft)}</style><script>${HELP}<\/script>`;
  return head + String(code).replace(/^\s*<!doctype[^>]*>/i, '');
}

function createWindow(el, k) {
  const code = el.querySelector('.mdVisualCode')?.textContent || '', s = st(k);
  if (el.dataset.kind === 'video') {
    const v = parseVideo(code); if (!v) return null;
    if (v.kind === 'iframe') {
      const f = document.createElement('iframe');
      f.src = v.src; f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin'; f.loading = 'lazy'; f.title = v.description || 'video';
      return f;
    }
    if (v.kind === 'video') { const x = document.createElement('video'); x.src = v.src; x.controls = true; x.loop = true; x.muted = true; x.playsInline = true; x.preload = 'metadata'; return x; }
    const i = document.createElement('img'); i.src = v.src; i.alt = v.description || ''; i.decoding = 'async'; return i;
  }
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts'); f.referrerPolicy = 'no-referrer'; f.title = T('app.visual.visualization');
  f.srcdoc = srcdoc(code);
  if (s.pause) f.addEventListener('load', () => send(f, true), { once: true });
  return f;
}
const send = (f, pause) => { try { f.contentWindow?.postMessage({ mvz: 1, pause }, '*'); } catch { /* the window does not exist yet */ } };

function init() {
  if (V.init) return; V.init = true;
  V.park = document.createElement('div'); V.park.id = 'visualPark'; V.park.setAttribute('aria-hidden', 'true');
  V.park.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px;height:400px;overflow:hidden;pointer-events:none';
  document.body.appendChild(V.park);
  V.io = new IntersectionObserver((zaz) => {
    for (const z of zaz) {
      const el = z.target, k = el.dataset.visual;
      if (z.isIntersecting && !el.querySelector('.mdVisualO > *')) { const o = createWindow(el, k); if (o) { el.querySelector('.mdVisualO').appendChild(o); V.windows.set(k, o); } }
      const f = el.querySelector('.mdVisualO > iframe');
      if (f && el.dataset.kind === 'visual') send(f, !z.isIntersecting || st(k).pause);
    }
  }, { rootMargin: '200px 0px' });
  addEventListener('message', (e) => {
    const d = e.data; if (!d || d.mvz !== 1) return;
    for (const [k, f] of V.windows) {
      if (f.contentWindow !== e.source) continue;
      const el = f.closest('.mdVisual');
      if (d.h != null) { const h = Math.max(MIN_H, Math.min(MAX_H, d.h)); st(k).h = h; const o = el?.querySelector('.mdVisualO'); if (o && !el.classList.contains('large')) o.style.height = h + 'px'; }
      if (d.error && el) { const c = el.querySelector('.mdVisualError'); c.hidden = false; c.innerHTML = ico('warning'); c.title = T('app.visual.error') + ': ' + d.error; }
      return;
    }
  });
  document.addEventListener('click', click);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const el = document.querySelector('.mdVisual.large'); if (el) { e.stopPropagation(); toggleLarge(el); } } }, true);
}
function toggleLarge(el) {
  const s = st(el.dataset.visual); s.large = !s.large; el.classList.toggle('large', s.large);
  const o = el.querySelector('.mdVisualO'); o.style.height = s.large ? '' : (s.h ? s.h + 'px' : '');
  const b = el.querySelector('[data-viza="large"]'); if (b) b.textContent = s.large ? '⤡' : '⤢';
}
async function click(e) {
  const b = e.target.closest('[data-viza]'); if (!b) return;
  const el = b.closest('.mdVisual'), k = el?.dataset.visual; if (!k) return;
  e.preventDefault(); e.stopPropagation();
  const f = el.querySelector('.mdVisualO > iframe'), s = st(k), a = b.dataset.viza;
  if (a === 'pause') { s.pause = !s.pause; b.innerHTML = s.pause ? ico('play') : ico('pause'); if (f) send(f, s.pause); }
  else if (a === 'again') { if (f) { s.pause = false; el.querySelector('[data-viza="pause"]').innerHTML = ico('pause'); f.srcdoc = srcdoc(el.querySelector('.mdVisualCode').textContent); } }
  else if (a === 'large') toggleLarge(el);
  else if (a === 'code') { const p = el.querySelector('.mdVisualCode'); p.hidden = !p.hidden; b.textContent = p.hidden ? T('app.visual.code') : T('app.visual.hide'); }
  else if (a === 'copy') { try { await navigator.clipboard.writeText(el.querySelector('.mdVisualCode').textContent); b.textContent = T('app.visual.copied'); setTimeout(() => { b.textContent = T('app.visual.copy'); }, 1500); } catch { b.textContent = T('app.visual.failed'); } }
}

// before re-rendering: set the live windows from root aside (only with moveBefore, otherwise they would be loaded again anyway)
export function park(root) {
  if (!V.init || !root || typeof V.park.moveBefore !== 'function') return;
  root.querySelectorAll('.mdVisual[data-visual] .mdVisualO > *').forEach((o) => { o.dataset.vizk = o.closest('.mdVisual').dataset.visual; try { V.park.moveBefore(o, null); } catch { /* nothing */ } });
}
// after re-rendering: connect placeholders to the set-aside windows or let them be created on display
export function attachVisuals(root = document) {
  const placeholders = root.querySelectorAll?.('.mdVisual[data-visual]:not([data-ok])');
  if (!placeholders?.length && !V.park?.childElementCount) return;
  init();
  const postponed = new Map([...V.park.children].map((o) => [o.dataset.vizk, o]));
  for (const el of placeholders) {
    el.dataset.ok = '1';
    const k = el.dataset.visual, o = postponed.get(k), cie = el.querySelector('.mdVisualO');
    if (o) { postponed.delete(k); try { cie.moveBefore(o, null); } catch { cie.appendChild(o); } V.windows.set(k, o); }
    V.io.observe(el); V.sled.add(el);
  }
  for (const el of V.sled) if (!el.isConnected) { V.io.unobserve(el); V.sled.delete(el); }
  postponed.forEach((o) => o.remove());
  for (const [k, f] of V.windows) if (!f.isConnected) V.windows.delete(k);
}
