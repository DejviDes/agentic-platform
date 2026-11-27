// point-out.js – "⚑ To the Center" (step 5, 2026-11-10): you point with a finger at what is wrong in the app, and it is sent to the lead
// of the Control Center as a new conversation. The button in the header or the U key turns on pointing mode (crosshair,
// orange frame above a panel element or a 3D object), a click opens the "What is wrong?" card with a field and a microphone.
// The message carries a canvas snapshot (render + toDataURL only on click, preserveDrawingBuffer stays off), the place
// (selector, text, dimensions or 3D object), the view, the window size and the latest console errors (ring buffer
// window.__konzola from index.html). While the mode isn't running, it has no mouse listeners and costs nothing.
import { active, city, DISTRICT } from './state.js';
import { $, esc } from './utils.js';
import { renderer } from './scene-base.js';
import { WORLD } from './world.js';
import { CONV_STORE, send, isReal } from './api.js';
import { toast } from './panel.js';
import { convStateRefresh, MIC_SVG, openConv, transcribeRecording } from './conversations.js';
import { enterFloor } from './navigation.js';
import { CONTROL_CENTER, isControlCenter } from './control-center.js';
import { ico } from './icons.js';
import { locale, t as tr } from './i18n.js';

const COLOR = '#f08a3c', R3D = 34; // radius of the ring around the 3D target in px
const UK = { on: false, c: null, block: false, rec: null, mic: 'none', sent: null, sends: false };
const isField = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

// ---------- pointing mode ----------
function show(on = !UK.on) {
  if (on && !isReal()) return toast(tr('app.pointOut.only_server'));
  if (on && !WORLD.floors.has(CONTROL_CENTER.n)) return toast(tr('app.pointOut.no_je_enabled'));
  if (on === UK.on) return;
  UK.on = on; document.body.classList.toggle('show', on); $('taskOfficeBtn').classList.toggle('on', on);
  $('showRam').style.display = 'none'; $('tip').style.display = 'none';
  // listeners only during pointing (capture on window = before OrbitControls, the panel and main.js)
  const f = on ? addEventListener : removeEventListener;
  f('pointermove', atMotion, true); f('pointerdown', atClick, true);
  if (on) { closeCard(); toast(tr('app.pointOut.click')); }
}
function selector(el) {
  let s = el.tagName.toLowerCase();
  if (el.id) return s + '#' + el.id;
  const tr = [...el.classList].filter((c) => c !== 'on').slice(0, 2); if (tr.length) s += '.' + tr.join('.');
  return s;
}
function path(el) { // nearest ancestors up to the first one with an id (at most 4 levels), e.g. aside#panel > div#content > div.msg.ja
  const c = []; for (let e = el, i = 0; e && e !== document.body && i < 5; e = e.parentElement, i++) { c.unshift(selector(e)); if (e.id) break; }
  return c.join(' > ');
}
function description3D(h) {
  const kind = active?.kind;
  if (kind === 'city') {
    if (h === null) return { what: `mesto (pohľad ${DISTRICT}), prázdne miesto`, obj: null };
    const s = String(h);
    if (s.startsWith('home:')) return { what: `budova Domova ${s.slice(5)}`, obj: s };
    if (isControlCenter(s)) return { what: 'budova Riadiaca centrála', obj: s };
    if (s === '__dispatch') return { what: 'poschodie Dispečing (satelit na streche Riadiacej centrály)', obj: s };
    if (s === 'Univerzál') return { what: 'kiosk Univerzál pri pavilóne Mozgu', obj: s };
    if (s === 'Second Brain') return { what: 'pavilón Mozgu (Second Brain)', obj: s };
    return { what: `poschodie veže ${s}`, obj: s };
  }
  if (kind === 'floor') {
    const a = typeof h === 'number' ? WORLD.floors.get(active.n)?.agents[h] : null;
    return a ? { what: `postavička ${a.emoji || ''} ${a.name} (${a.k || 'lead'}) na poschodí ${active.n}`, obj: `agent ${h}` } : { what: `miestnosť poschodia ${active.n}`, obj: null };
  }
  if (kind === 'interior') return { what: `interiér ${active.B?.title || ''}${h !== null ? `, postavička ${h}` : ''}`, obj: h };
  return { what: 'scéna', obj: null };
}
function target(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el.closest('#showCard, #taskOfficeBtn')) return null;
  if (el === renderer.domElement) {
    const h = active?.pick(e) ?? null, p = description3D(h);
    return { house: false, target: `3D · ${p.what}`, obj: p.obj, r: { x: e.clientX - R3D, y: e.clientY - R3D, w: R3D * 2, h: R3D * 2 }, point: [Math.round(e.clientX), Math.round(e.clientY)] };
  }
  const b = el.getBoundingClientRect(), text = String(el.innerText || el.value || el.placeholder || el.title || '').trim().replace(/\s+/g, ' ');
  return { house: true, target: `${selector(el)}${text ? ` „${text.slice(0, 40)}${text.length > 40 ? '…' : ''}“` : ''}`, path: path(el), text: text.slice(0, 200),
    className: el.className && typeof el.className === 'string' ? el.className : '', r: { x: b.left, y: b.top, w: b.width, h: b.height }, point: [Math.round(e.clientX), Math.round(e.clientY)] };
}
function atMotion(e) {
  e.stopPropagation(); // tooltip and city hover are not active during pointing
  const c = target(e), r = $('showRam');
  if (!c) { r.style.display = 'none'; return; }
  Object.assign(r.style, { display: 'block', left: c.r.x - 3 + 'px', top: c.r.y - 3 + 'px', width: c.r.w + 6 + 'px', height: c.r.h + 6 + 'px', borderRadius: c.house ? '8px' : '50%' });
  r.firstChild.textContent = c.target; r.classList.toggle('right', c.r.x + 300 > innerWidth); r.classList.toggle('down', c.r.y < 90);
}
function atClick(e) {
  const c = target(e); if (!c) return; // a click on ⚑ or the card goes through normally
  e.preventDefault(); e.stopPropagation(); UK.block = true; show(false); openCard(c, e);
}
function blockRundown(e) { // pointerup and click after a click in the mode must not open anything (floor, panel button)
  if (!UK.block) return; e.preventDefault(); e.stopPropagation(); if (e.type === 'click') UK.block = false;
}

// ---------- snapshot: canvas right after rendering + panels as rectangles (a DOM snapshot would need a heavy library) ----------
function snapshot(c) {
  const W = Math.min(1600, innerWidth), k = W / innerWidth, H = Math.round(innerHeight * k);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  try { renderer.render(active.scene, active.camera); g.drawImage(renderer.domElement, 0, 0, W, H); } // in the same task, while the buffer is valid
  catch { g.fillStyle = '#e9eef2'; g.fillRect(0, 0, W, H); }
  g.font = `600 ${Math.round(12 * Math.max(1, k))}px ui-monospace, monospace`; g.textBaseline = 'top';
  for (const id of ['top', 'team', 'panel']) {
    const el = $(id); if (!el) continue; const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (b.width < 2 || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    g.fillStyle = 'rgba(253,252,249,.88)'; g.fillRect(b.left * k, b.top * k, b.width * k, b.height * k);
    g.strokeStyle = '#d5d1c6'; g.lineWidth = 1; g.strokeRect(b.left * k + 0.5, b.top * k + 0.5, b.width * k - 1, b.height * k - 1);
    if (id !== 'top') { g.fillStyle = '#9a958a'; g.fillText(`#${id} (DOM, nesnímané)`, b.left * k + 8, b.top * k + 8); }
  }
  g.strokeStyle = COLOR; g.lineWidth = 3;
  if (c.house) g.strokeRect(c.r.x * k - 2, c.r.y * k - 2, c.r.w * k + 4, c.r.h * k + 4);
  else { g.beginPath(); g.arc((c.r.x + R3D) * k, (c.r.y + R3D) * k, R3D * k, 0, 7); g.stroke(); }
  return cv.toDataURL('image/jpeg', 0.85);
}

// ---------- "What is wrong?" card ----------
function view() {
  if (active?.kind === 'floor') { const o = convStateRefresh().open, k = o && CONV_STORE.conv.get(o); return `floor ${active.n}${k ? ` · otvorená konverzácia „${k.title || o}“` : ''}`; }
  if (active?.kind === 'interior') return `Domov · interiér ${active.B?.title || ''}`;
  return `Mesto · štvrť ${{ city: 'Mesto', work: 'Práca', home: 'Domov' }[DISTRICT] || DISTRICT}`;
}
const errorsConsole = () => {
  const z = window.__console || [], vys = [];
  for (const x of z.slice(-8)) {
    let t; try { t = x.a.map((v) => (v instanceof Error ? `${v.name}: ${v.message}` : typeof v === 'object' ? JSON.stringify(v)?.slice(0, 200) : String(v))).join(' '); } catch { t = String(x.a[0]); }
    vys.push(`${new Date(x.t).toLocaleTimeString(locale())} ${x.u}: ${t.replace(/\s+/g, ' ').slice(0, 300)}${x.n > 1 ? ` (${x.n}×)` : ''}`);
  }
  return vys;
};
function openCard(c, e) {
  UK.c = c; UK.sent = null; c.image = snapshot(c); c.where = view();
  c.window = `${innerWidth} × ${innerHeight} (pixel ratio ${devicePixelRatio}, panel ${Math.round($('panel').getBoundingClientRect().width)} px${document.body.classList.contains('panelHidden') ? ', hidden' : ''})`;
  c.errors = errorsConsole();
  const kc = active === city ? active.camera : null;
  c.cam = kc ? `pozícia ${kc.position.toArray().map((v) => v.toFixed(1)).join(', ')} · cieľ ${city.controls.target.toArray().map((v) => v.toFixed(1)).join(', ')}` : '';
  const k = $('showCard');
  k.innerHTML = `<div class="h"><b>${ico('flag')} ${tr('app.pointOut.card_heading')}</b><button class="ukX" data-u="cancel" title="${tr('app.pointOut.cancel_esc')}">${ico('x')}</button></div>
    <img src="${c.image}" alt=""><div class="target">${esc(c.target)}</div><div class="mono">${esc(c.where)} · ${innerWidth} × ${innerHeight}</div>
    <div class="ukField"><textarea id="ukText" rows="3" placeholder="${tr('app.pointOut.placeholder')}"></textarea><button class="ukMic" id="ukMic" data-u="mic" title="${tr('app.pointOut.dictate')}">${MIC_SVG}</button></div>
    <div class="btns"><button class="btn p" data-u="send">${tr('app.pointOut.send')}</button><button class="btn" data-u="cancel">${tr('app.pointOut.cancel')}</button></div>
    <div class="note">${tr('app.pointOut.note', { compass: ico('compass'), errors: c.errors.length ? tr('app.pointOut.errors_n', { n: c.errors.length }) : tr('app.pointOut.errors_0') })}</div>`;
  k.classList.add('on'); place(e.clientX, e.clientY); k.querySelector('img').onload = () => place(e.clientX, e.clientY);
  setTimeout(() => $('ukText')?.focus(), 30);
}
function place(x, y) { // next to the click, the whole card in the window (we know the height only after rendering)
  const k = $('showCard'), h = k.offsetHeight, w = k.offsetWidth;
  k.style.left = Math.max(16, x + 18 + w > innerWidth - 16 ? x - 18 - w : x + 18) + 'px';
  k.style.top = Math.max(72, Math.min(innerHeight - 16 - h, y - 40)) + 'px';
}
function closeCard() { if (UK.mic === 'uploading') UK.rec?.stop(); $('showCard').classList.remove('on'); UK.c = null; }

// message body: first line = your text (the server makes the conversation name from it), then context for the agent
export function buildMessage(c, text) {
  const r = (x) => Math.round(x);
  const placeParts = c.house
    ? [`Miesto (prvok panela, DOM): ${c.path}`, c.text ? `Text prvku: „${c.text}“` : '', `Rozmery: x ${r(c.r.x)}, y ${r(c.r.y)}, ${r(c.r.w)} × ${r(c.r.h)} px`]
    : [`Miesto (3D): ${c.target.slice(5)}${c.obj != null ? ` · userData ${JSON.stringify(c.obj)}` : ''}`, `Bod kliknutia: x ${c.point[0]}, y ${c.point[1]} px`];
  return [`⚑ ${text}`, '',
    '— Pripomienka z appky Mesto agentov (⚑ Do centrály). Ide o skutočnú appku public/index.html + public/app/ (pravidlá v technika.md).',
    ...placeParts.filter(Boolean),
    `Pohľad: ${c.where}`, `Okno: ${c.window}`, c.cam ? `Kamera mesta: ${c.cam}` : null, 'Štýl: Maketa',
    c.errors.length ? `Posledné chyby z konzoly:\n${c.errors.map((x) => '  ' + x).join('\n')}` : 'Chyby z konzoly: žiadne',
    `Snímka je priložená: plátno 3D scény, oranžový ${c.house ? 'obdĺžnik' : 'krúžok'} = kliknuté miesto, panely sú v nej iba ako sivé obdĺžniky (DOM sa nesníma).`,
  ].filter((x) => x != null).join('\n');
}
export function messageBody(c, text) {
  return { floor: 'control-center', agent: 'lead', text: buildMessage(c, text), images: [{ type: 'image/jpeg', data: c.image.split(',')[1] }] };
}
async function sendPointOut() {
  const c = UK.c, t = $('ukText')?.value.trim(); if (!c || UK.sends) return;
  if (!t) { $('ukText').focus(); return toast(tr('app.pointOut.write')); }
  UK.sends = true; const b = $('showCard').querySelector('[data-u="send"]'); if (b) { b.disabled = true; b.textContent = tr('app.pointOut.sending'); }
  try {
    const k = await send(messageBody(c, t));
    UK.sent = k.id; UK.c = null;
    $('showCard').innerHTML = `<div class="h"><b>${ico('flag')} ${tr('app.pointOut.sent')}</b><button class="ukX" data-u="cancel" title="${tr('app.pointOut.close_esc')}">${ico('x')}</button></div>
      <div class="note">${ico('compass')} ${tr('app.pointOut.started', { title: esc(k.title || t) })}</div>
      <div class="btns"><button class="btn p" data-u="open">${tr('app.pointOut.open')}</button><button class="btn" data-u="cancel">${tr('app.pointOut.close')}</button></div>`;
    clearTimeout(UK.close); UK.close = setTimeout(() => { if (UK.sent === k.id) closeCard(); }, 8000);
  } catch (err) { toast(tr('app.pointOut.unsent', { error: err.message })); if (b) { b.disabled = false; b.textContent = tr('app.pointOut.send'); } }
  UK.sends = false;
}
async function openSent() {
  const id = UK.sent; closeCard(); if (!id) return;
  if (!(active?.kind === 'floor' && isControlCenter(active.n))) { await enterFloor(CONTROL_CENTER.n, null); setTimeout(() => openConv(id), 760); }
  else openConv(id);
}
// dictation into the card (the same local Whisper as in the panel)
async function mic() {
  if (UK.mic === 'transcribes') return;
  if (UK.mic === 'uploading') { UK.rec?.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    fetch('/api/transcript/prepare', { method: 'POST' }).catch(() => {});
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((x) => MediaRecorder.isTypeSupported?.(x)) || '';
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined), pieces = [];
    rec.ondataavailable = (e) => e.data.size && pieces.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((x) => x.stop()); UK.mic = 'transcribes'; micStatus();
      try { const r = await transcribeRecording(new Blob(pieces, { type: rec.mimeType || 'audio/webm' })); const el = $('ukText'); if (el) { el.value = (el.value ? el.value.trimEnd() + ' ' : '') + (r.text || ''); el.focus(); } }
      catch (err) { toast(tr('app.pointOut.transcription_failed', { error: err.message })); }
      UK.mic = 'none'; micStatus();
    };
    UK.rec = rec; rec.start(); UK.mic = 'uploading'; micStatus();
  } catch (err) { toast(tr('app.pointOut.microphone', { error: err.name === 'NotAllowedError' ? tr('app.pointOut.access_rejected') : err.message })); }
}
function micStatus() { const b = $('ukMic'); if (!b) return; b.classList.toggle('on', UK.mic === 'uploading'); b.classList.toggle('pr', UK.mic === 'transcribes'); b.title = UK.mic === 'uploading' ? tr('app.pointOut.recording') : UK.mic === 'transcribes' ? tr('app.pointOut.transcribing') : tr('app.pointOut.dictate'); }

export function initPointOut() {
  $('taskOfficeBtn').addEventListener('click', (e) => { e.stopPropagation(); show(); });
  for (const ev of ['pointerup', 'click']) addEventListener(ev, blockRundown, true); // one if while nobody is pointing
  addEventListener('keydown', (e) => {
    const card = $('showCard').classList.contains('on');
    if (e.key === 'Escape' && (UK.on || card)) { e.preventDefault(); e.stopImmediatePropagation(); show(false); closeCard(); return; }
    if (card && e.target.id === 'ukText' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopImmediatePropagation(); sendPointOut(); return; }
    if ((e.key === 'u' || e.key === 'U') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !isField(document.activeElement)) { e.stopImmediatePropagation(); show(); }
  }, true);
  $('showCard').addEventListener('click', (e) => {
    const b = e.target.closest('[data-u]'); if (!b || b.disabled) return;
    const u = b.dataset.u;
    if (u === 'cancel') closeCard(); else if (u === 'send') sendPointOut(); else if (u === 'mic') mic(); else if (u === 'open') openSent();
  });
  if (new URLSearchParams(location.search).has('debug')) window.__show = { UK, buildMessage, messageBody, snapshot, target, show };
}
