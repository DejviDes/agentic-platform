// router.js – Router in the City overview (2026-11-11): "What needs to be done?" field with a microphone, POST /api/router { text } proposes
// a floor and an agent (model on the server, 1 – 5 s), proposal card with a reason, alternatives as chips, Send = new conversation
// via send() in the background (2026-11-24: doesn't move you anywhere, message with an Open button). The field is a permanent element #router outside #content, so a redraw of the Overview doesn't erase the text or focus.
// Without the endpoint (404, old server) the card shows a local estimate by keywords (route from world.js). Visibility:
// #panel.prRezim (panel.js refreshPanel, only the real mode in the city view). Cost in performance: zero, nothing in the render loop.
// 2026-11-17: "To…" and the "other…" chip = manual floor selection (since 2026-11-19 only floors, always the lead; you switch to a teammate by the label in the writing field). Continue (Enter) opens a new
// conversation with the agent with the text in the writing field (newConvWith), where images and files can be added; Send right away (⌘↵) as before.
import { $, esc } from './utils.js';
import { BUILDINGS } from './demo-data.js';
import { WORLD, route } from './world.js';
import { floorId, agentIndex, floorCount, send } from './api.js';
import { MIC_SVG, newConvWith, openConv, transcribeRecording } from './conversations.js';
import { enterFloor } from './navigation.js';
import { active } from './state.js';
import { ico, agentIcon } from './icons.js';
import { toastOpen } from './panel.js';
import { t as tr } from './i18n.js';

const R = { phase: 'none', text: '', options: [], sel: 0, reason: '', local: false, request: 0, mic: 'none', rec: null, q: '', course: 0, ago: 'none' };
let toast = () => {};

// { floor (server id), agent (slug or 'lead') } → what to show
function description(m) {
  const n = floorCount(m.floor), P = n && WORLD.floors.get(n), i = P ? agentIndex(P, m.agent) : null, a = i != null ? P.agents[i] : null;
  return { n, emoji: a?.emoji || '👤', agent: a?.name || m.agentName || (m.agent === 'lead' ? tr('app.router.lead') : m.agent), floor: n || m.name || m.floor };
}
function draw() {
  const k = $('routerCard'), b = $('routerSearch');
  b.disabled = R.phase === 'searches' || R.phase === 'sends';
  if (R.phase === 'none') { k.innerHTML = ''; k.className = ''; return; }
  k.className = 'on';
  if (R.phase === 'searches') { k.innerHTML = `<div class="rtSearches"><span class="spin"></span>${tr('app.router.searching')}</div>`; return; }
  if (R.phase === 'pick') return drawSelect();
  const m = R.options[R.sel], p = description(m), color = BUILDINGS.find((b) => b.floors.some((x) => x.n === p.n))?.color;
  const other = R.options.map((x, i) => [x, i]).filter(([, i]) => i !== R.sel);
  k.innerHTML = `<div class="rtProposal"><span class="point" style="background:${color || 'var(--muted)'}"></span><div class="tx"><b>${esc(p.floor)} · ${agentIcon({ name: p.agent, emoji: p.emoji }, 'xs')} ${esc(p.agent)}</b>
      <span>${R.sel === 0 ? esc(R.reason || tr('app.router.best')) : tr('app.router.your_choice')}${R.local && R.sel === 0 ? ' · ' + tr('app.router.local') : ''}</span></div></div>
    ${other.length ? `<div class="rtAlt"><span>${tr('app.router.or')}</span>${other.map(([x, i]) => { const q = description(x); return `<button data-rt="alt" data-i="${i}" title="${esc(q.floor + ' · ' + q.agent)}">${esc(q.floor)} · ${agentIcon({ name: q.agent, emoji: q.emoji }, 'xs')} ${esc(q.agent)}</button>`; }).join('')}<button data-rt="other" title="${tr('app.router.select_self')}">${tr('app.router.other')}</button></div>` : `<div class="rtAlt"><button data-rt="other" title="${tr('app.router.select_self')}">${tr('app.router.other')}</button></div>`}
    <div class="btns"><button class="btn p" data-rt="send" ${R.phase === 'sends' || !p.n ? 'disabled' : ''} title="${tr('app.router.send_t')}">${R.phase === 'sends' ? tr('app.router.sending') : tr('app.router.send')}</button><button class="btn" data-rt="continue" ${R.phase === 'sends' || !p.n ? 'disabled' : ''} title="${tr('app.router.edit_t')}">${tr('app.router.edit')}</button><button class="btn" data-rt="cancel">${tr('app.router.cancel')}</button></div>`;
}
function cancel() { R.request++; R.phase = 'none'; R.options = []; draw(); }

// ---------- manual recipient selection: floor · agent, search without diacritics, ↑↓ Enter Esc ----------
const without = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function recipients() {
  const t = without(R.q).trim().split(/\s+/).filter(Boolean), o = [];
  for (const b of BUILDINGS) for (const p of b.floors) {
    const P = WORLD.floors.get(p.n); if (!P?.def?.id) continue;
    // 2026-11-19: only floors (projects), always to the lead; a teammate is switched by the "to" label in the writing field before sending
    if (t.every((x) => without(`${b.title} ${p.n}`).includes(x))) o.push({ floor: P.def.id, agent: 'lead', n: p.n, building: b.title, color: b.color });
  }
  return o;
}
function drawSelect() {
  const k = $('routerCard'), items = recipients(); R.course = Math.max(0, Math.min(R.course, items.length - 1));
  if (!k.querySelector('#rtSearch')) {
    k.innerHTML = `<div class="rtSelectH"><input id="rtSearch" placeholder="${tr('app.router.recipient_ph')}" autocomplete="off"><button class="btn" data-rt="back" title="${tr('app.router.back')}">${ico('x')}</button></div><div class="rtItems"></div>`;
    const v = $('rtSearch'); v.value = R.q;
    v.oninput = () => { R.q = v.value; R.course = 0; drawSelect(); };
    v.onkeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); R.course += e.key === 'ArrowDown' ? 1 : -1; drawSelect(); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const m = recipients()[R.course]; if (m) openNew(m); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); backFromSelection(); }
    };
    setTimeout(() => v.focus(), 0);
  }
  const z = k.querySelector('.rtItems');
  z.innerHTML = items.length ? items.map((m, i) => `<button class="rtR ${i === R.course ? 'on' : ''}" data-rt="pick" data-i="${i}"><span class="point" style="background:${m.color || 'var(--muted)'}"></span><span class="tx"><b>${esc(m.n)}</b><i>${esc(m.building)}</i></span></button>`).join('')
    : `<div class="rtEmpty">${tr('app.router.none')}</div>`;
  z.querySelector('.rtR.on')?.scrollIntoView({ block: 'nearest' });
}
function selectRecipient() { R.request++; R.ago = R.phase === 'proposed' ? 'proposed' : 'none'; R.phase = 'pick'; R.q = ''; R.course = 0; $('routerCard').innerHTML = ''; draw(); }
function backFromSelection() { R.phase = R.ago === 'proposed' && R.options.length ? 'proposed' : 'none'; draw(); $('routerText').focus(); }
// new conversation with the agent, text into the writing field (images and files are added there)
async function openNew(m) {
  const n = m && floorCount(m.floor); if (!n) return;
  const text = $('routerText').value.trim();
  $('routerText').value = ''; R.phase = 'none'; R.options = []; R.text = ''; draw();
  $('content').dataset.overview = '';
  if (!(active?.kind === 'floor' && active.n === n)) await enterFloor(n);
  newConvWith(m.agent || 'lead', text);
}

// local estimate (without a server): the same keywords as the demo
function localMatch(text) {
  const r = route(text, null), P = WORLD.floors.get(r.n), a = P?.agents[r.a];
  if (!P?.def.id) return null;
  return { floor: P.def.id, agent: r.a === 0 ? 'lead' : a.k || 'lead', reason: r.reason.length ? tr('app.router.by_words', { words: r.reason.slice(0, 3).map((d) => `„${d}…“`).join(', ') }) : '' };
}
async function search() {
  const text = $('routerText').value.trim(); if (!text || R.phase === 'sends') return;
  const my = ++R.request; R.text = text; R.phase = 'searches'; draw();
  let d = null, local = false;
  try {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 30000);
    const r = await fetch('/api/router', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: ctrl.signal });
    clearTimeout(t);
    d = await r.json().catch(() => null);
    if (!r.ok || !d || d.error || !d.floor) { local = r.status === 404 || !d; if (!local) throw new Error(d?.error || `server vrátil ${r.status}`); }
  } catch (e) {
    if (my !== R.request) return;
    if (e.name !== 'TypeError' && e.name !== 'AbortError') { toast(tr('app.router.error', { error: e.message })); R.phase = 'none'; return draw(); }
    local = true; // the server doesn't respond or takes too long
  }
  if (my !== R.request) return; // meanwhile cancelled or a new search
  if (local) { const m = localMatch(text); if (!m) { toast(tr('app.router.unknown')); R.phase = 'none'; return draw(); } d = m; }
  const alt = (d.alternatives || []).filter((x) => x?.floor && !(x.floor === d.floor && x.agent === d.agent)).slice(0, 4);
  Object.assign(R, { phase: 'proposed', sel: 0, reason: d.reason || '', local: local, options: [{ floor: d.floor, agent: d.agent || 'lead', name: d.name, agentName: d.agentName }, ...alt] });
  draw();
}
async function sendProposal() {
  const m = R.options[R.sel], n = m && floorCount(m.floor); if (!n || R.phase !== 'proposed') return;
  const text = $('routerText').value.trim() || R.text;
  R.phase = 'sends'; draw();
  try {
    const k = await send({ floor: m.floor || floorId(n), agent: m.agent || 'lead', text });
    $('routerText').value = ''; R.phase = 'none'; R.options = []; draw();
    // runs in the background (2026-11-24): the app doesn't move you anywhere, you go to the conversation with the Open button
    const p = description(m);
    toastOpen(tr('app.router.sent', { floor: p.floor, agent: p.agent }), () => { $('content').dataset.overview = ''; enterFloor(n).then(() => openConv(k.id)); });
  } catch (e) { R.phase = 'proposed'; draw(); toast(tr('app.router.unsent', { error: e.message })); }
}
// dictation (the same local Whisper as in the conversation and in the ⚑ card)
async function mic() {
  if (R.mic === 'transcribes') return;
  if (R.mic === 'uploading') { R.rec?.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    fetch('/api/transcript/prepare', { method: 'POST' }).catch(() => {});
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((x) => MediaRecorder.isTypeSupported?.(x)) || '';
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined), pieces = [];
    rec.ondataavailable = (e) => e.data.size && pieces.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((x) => x.stop()); R.mic = 'transcribes'; micStatus();
      try { const r = await transcribeRecording(new Blob(pieces, { type: rec.mimeType || 'audio/webm' })); const el = $('routerText'); el.value = (el.value ? el.value.trimEnd() + ' ' : '') + (r.text || ''); el.focus(); }
      catch (err) { toast(tr('app.router.transcription_failed', { error: err.message })); }
      R.mic = 'none'; micStatus();
    };
    R.rec = rec; rec.start(); R.mic = 'uploading'; micStatus();
  } catch (err) { toast(tr('app.router.microphone', { error: err.name === 'NotAllowedError' ? tr('app.router.access') : err.message })); }
}
function micStatus() { const b = $('routerMic'); b.classList.toggle('on', R.mic === 'uploading'); b.classList.toggle('pr', R.mic === 'transcribes'); b.title = R.mic === 'uploading' ? tr('app.router.recording') : R.mic === 'transcribes' ? tr('app.router.transcribing') : tr('app.router.dictate'); }


export function initRouter(t) {
  toast = t;
  const el = $('router');
  el.innerHTML = `<div class="rtField"><input id="routerText" placeholder="${tr('app.router.ph')}" autocomplete="off"><button class="rtRecipient" id="routerRecipient" title="${tr('app.router.recipient_t')}">${tr('app.router.recipient')}</button><button class="ukMic" id="routerMic" title="${tr('app.router.dictate')}">${MIC_SVG}</button><button class="rtIde" id="routerSearch" title="${tr('app.router.find_t')}" aria-label="${tr('app.router.find')}">→</button></div><div id="routerCard"></div>`;
  $('routerText').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const thatSure = R.phase === 'proposed' && $('routerText').value.trim() === R.text;
      if (thatSure) { if (e.metaKey || e.ctrlKey) openNew(R.options[R.sel]); else sendProposal(); } else search();
    }
    if (e.key === 'Escape' && R.phase !== 'none') { e.preventDefault(); e.stopPropagation(); cancel(); }
  };
  $('routerSearch').onclick = search;
  $('routerMic').onclick = mic;
  $('routerRecipient').onclick = () => (R.phase === 'pick' ? backFromSelection() : selectRecipient());
  $('routerCard').onclick = (e) => {
    const b = e.target.closest('[data-rt]'); if (!b || b.disabled) return;
    const d = b.dataset.rt;
    if (d === 'alt') { R.sel = +b.dataset.i; draw(); } else if (d === 'send') sendProposal(); else if (d === 'continue') openNew(R.options[R.sel]);
    else if (d === 'other') selectRecipient(); else if (d === 'pick') openNew(recipients()[+b.dataset.i]); else if (d === 'back') backFromSelection(); else if (d === 'cancel') cancel();
  };
}
