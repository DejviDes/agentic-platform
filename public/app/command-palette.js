// command-palette.js – ⌘K: quick search and jumps (conversations, older sessions, floors, Home buildings, actions). UX audit 2026-11-17, wave 1.
// DOM overlay only, no 3D objects. The state is local in the module (P), not in state.js, because nobody else reads it.
import { active, workroom } from './state.js';
import { esc, ago } from './utils.js';
import { BUILDINGS, HOME_BUILDINGS } from './demo-data.js';
import { CONV_STORE, floorCount, isReal } from './api.js';
import { enterFloor } from './navigation.js';
import { convState, hasHomeChat, openConv, homeFloorP } from './conversations.js';
import { openWorkroom, closeWorkroom } from './workroom.js';
import { ico } from './icons.js';
import { M } from './modules.js';
import { floorLabel } from './control-center.js';
import { t as tr } from './i18n.js'; // alias: in build() `t` is an array of searched words

const P = { on: false, q: '', pol: [], course: 0, el: null, vst: null, items: null, ago: null };
const without = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ICONS = { pending: 'pending', running: 'clock', conv: 'chat', old: 'cabinet', task: 'puzzle', floor: 'building', home: 'house', action: 'plus' }; // icon names from icons.js

function floorFlat() {
  const o = [];
  for (const b of BUILDINGS) for (const p of b.floors) o.push({ n: p.n, id: p.id, building: b.title });
  return o;
}
const houseK = (pid) => (String(pid || '').startsWith('home/') ? pid.slice(5) : null); // virtual floor of a Home building (the building's chat, 2026-11-18)
const isHouseChat = (pid) => hasHomeChat(houseK(pid));
const floorName = (pid) => { for (const b of BUILDINGS) for (const p of b.floors) if (p.id === pid) return floorLabel(p.n); const k = houseK(pid); if (k) return tr('app.palette.home') + ' · ' + (HOME_BUILDINGS.find((b) => b.k === k)?.title || k); return pid || ''; };
export const openConvWhere = (k) => (isHouseChat(k.floor) ? M.home?.openHomeChat(houseK(k.floor), { id: k.id }) : goOn(floorCount(k.floor), k.id));

// entering the floor and the conversation; if you are already on it, just open the thread
async function goOn(n, convId, create = false) {
  if (n === undefined) return;
  if (active?.kind === 'floor' && active.n === n) { if (!create) { if (convId) openConv(convId); } else openConv(null); }
  else {
    await enterFloor(n, null, create ? null : convId || null);
    if (create) { openConv(null); setTimeout(() => { if (convState.open && CONV_STORE.conv.get(convState.open)?.status === 'pending') openConv(null); }, 800); }
  }
  if (create) setTimeout(() => document.getElementById('agText')?.focus(), 60);
}

function rowConv(k, kind) {
  const n = floorCount(k.floor), where = floorName(k.floor);
  return { kind, icon: k.status === 'pending' ? ICONS.pending : k.status === 'running' ? ICONS.running : k.parent ? ICONS.task : ICONS.conv, title: k.title || tr('app.palette.withoutTitle'), where: where + (k.agent && k.agent !== 'lead' ? ' · ' + k.agent : ''), time: k.changed, pending: k.status === 'pending', hay: without(`${k.title} ${where} ${k.agent}`), ide: () => openConvWhere(k), n };
}

function build(q) {
  const t = without(q).trim().split(/\s+/).filter(Boolean), match = (hay) => t.every((x) => hay.includes(x)), v = [];
  const floorR = [], homeR = [], convR = [], oldR = [], buildingR = []; // result groups in display order
  const real = isReal();
  if (real) {
    const all = [...CONV_STORE.conv.values()].filter((k) => (floorCount(k.floor) !== undefined || isHouseChat(k.floor)) && !k.hidden);
    if (!t.length) {
      const hl = all.filter((k) => !k.parent), note = (a, b) => (b.changed || 0) - (a.changed || 0);
      const pending = all.filter((k) => k.status === 'pending').sort(note), running = all.filter((k) => k.status === 'running' && k.status !== 'pending').sort(note);
      const uz = new Set([...pending, ...running].map((k) => k.id));
      for (const k of [...pending, ...running]) convR.push(rowConv(k));
      for (const k of hl.filter((k) => !uz.has(k.id)).sort(note).slice(0, 8)) convR.push(rowConv(k));
    } else {
      // Order when searching (2026-11-17, assignment): first the floor whose name matches and "New conversation" on it,
      // then Home buildings, then conversations (of those floors first, then waiting and newest), older sessions and finally floors that match only by building.
      const title = new Set(floorFlat().filter((p) => match(without(p.n))).map((p) => p.id).filter(Boolean));
      const ks = all.map((k) => ({ r: rowConv(k), naP: title.has(k.floor) ? 1 : 0 })).filter((x) => match(x.r.hay))
        .sort((a, b) => (b.naP - a.naP) || (b.r.pending - a.r.pending) || (b.r.time || 0) - (a.r.time || 0)).map((x) => x.r);
      ks.slice(0, 30).forEach((r) => convR.push(r));
      for (const [pid, info] of CONV_STORE.floors) {
        const n = floorCount(pid);
        for (const s of info.old || []) {
          if (CONV_STORE.conv.has(s.id)) continue;
          const hay = without(`${s.title} ${floorName(pid)}`);
          if (match(hay)) oldR.push({ kind: 'old', icon: ICONS.old, title: s.title || tr('app.palette.withoutTitle'), where: floorName(pid) + ' · Claude Code', time: s.changed, hay, ide: () => goOn(n, s.id) });
        }
      }
    }
  }
  if (t.length || !real) {
    for (const p of floorFlat()) {
      const hay = without(`${p.n} ${floorLabel(p.n)} ${p.building}`);
      if (!match(hay)) continue;
      const r = { kind: 'floor', icon: ICONS.floor, title: p.n, where: p.building, hay, ide: () => enterFloor(p.n) };
      if (match(without(p.n))) { floorR.push(r); if (real && p.id) floorR.push({ kind: 'action', icon: ICONS.action, title: tr('app.palette.newConv', { n: p.n }), where: tr('app.palette.action'), ide: () => goOn(p.n, null, true) }); }
      else buildingR.push(r);
    }
    for (const b of HOME_BUILDINGS) {
      const hay = without(`${b.title} ${b.description} home home`);
      if (match(hay)) homeR.push({ kind: 'home', icon: ICONS.home, title: b.title, where: tr('app.palette.home') + ' · ' + b.description, hay, ide: () => M.home?.openModule(b.k) });
      if (real && hasHomeChat(b.k)) { const a = homeFloorP(b.k).agents[0], hc = without(`${a.name} chat ${b.title}`); if (match(hc)) homeR.push({ kind: 'action', icon: 'chat', title: tr('app.palette.chat', { name: a.name }), where: `${tr('app.palette.home')} · ${b.title}`, hay: hc, ide: () => M.home?.openHomeChat(b.k, { lastSeen: true }) }); }
    }
  }
  if (t.length || !real) v.push(...floorR, ...homeR, ...convR, ...oldR, ...buildingR);
  else v.push(...convR);
  // Workroom (wave 3): without a search the last item, when searching by the words workroom / work / city
  if (!t.length || match(without(workroom ? tr('app.palette.hayCity') : tr('app.palette.hayWorkroom')))) v.push(workroom
    ? { kind: 'action', icon: 'house', title: tr('app.palette.backToCity'), where: tr('app.palette.backWhere'), ide: () => closeWorkroom({ do3D: true }) }
    : { kind: 'action', icon: 'plan', title: tr('app.palette.workroom'), where: tr('app.palette.workroomWhere'), ide: () => openWorkroom() });
  if (real) {
    const pending = [...CONV_STORE.conv.values()].filter((k) => k.status === 'pending' && (floorCount(k.floor) !== undefined || isHouseChat(k.floor)));
    if (pending.length && (!t.length || match(without(tr('app.palette.hayPending'))))) v.unshift({ kind: 'action', icon: ICONS.pending, title: tr('app.palette.openPending', { n: pending.length }), where: tr('app.palette.openPendingWhere'), pending: true, ide: () => { const k = pending.sort((a, b) => (a.start || a.changed || 0) - (b.start || b.changed || 0))[0]; openConvWhere(k); } });
  }
  return v.slice(0, 40);
}

function draw() {
  P.pol = build(P.q);
  P.course = Math.min(P.course, Math.max(0, P.pol.length - 1));
  P.items.innerHTML = P.pol.length
    ? P.pol.map((r, i) => `<button type="button" class="paletteR${r.pending ? ' pending' : ''}${i === P.course ? ' on' : ''}" data-i="${i}" tabindex="-1"><span class="paletteIco">${ico(r.icon)}</span><span class="paletteTx"><b>${esc(r.title)}</b><em>${esc(r.where || '')}</em></span><span class="mono paletteTime">${r.time ? esc(ago(r.time)) : ''}</span></button>`).join('')
    : `<div class="paletteEmpty">${esc(tr('app.palette.none'))}${isReal() ? '' : esc(' ' + tr('app.palette.noneDemo'))}.</div>`;
  P.items.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
function pick(i) { const r = P.pol[i]; if (!r) return; close(false); r.ide(); }
export function openPalette() { open(); }
function open() {
  if (P.on) return;
  P.on = true; P.q = ''; P.course = 0; P.ago = document.activeElement;
  P.el.classList.add('on'); P.vst.value = ''; draw(); P.vst.focus();
}
function close(restore = true) {
  if (!P.on) return;
  P.on = false; P.el.classList.remove('on'); P.vst.blur();
  if (restore && P.ago?.isConnected && P.ago.focus) P.ago.focus();
}

export function initPalette() {
  const el = document.createElement('div');
  el.id = 'palette';
  el.innerHTML = `<div class="paletteCard" role="dialog" aria-label="${esc(tr('app.palette.aria'))}"><input class="paletteVst" type="text" placeholder="${esc(tr('app.palette.placeholder'))}" autocomplete="off" spellcheck="false"><div class="paletteItems"></div><div class="paletteFooter mono">${esc(tr('app.palette.footer'))}</div></div>`;
  document.body.appendChild(el);
  Object.assign(P, { el, vst: el.querySelector('.paletteVst'), items: el.querySelector('.paletteItems') });
  el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  P.items.addEventListener('click', (e) => { const b = e.target.closest('.paletteR'); if (b) pick(+b.dataset.i); });
  P.items.addEventListener('mousemove', (e) => { const b = e.target.closest('.paletteR'); if (b && +b.dataset.i !== P.course) { P.items.querySelector('.on')?.classList.remove('on'); P.course = +b.dataset.i; b.classList.add('on'); } });
  P.vst.addEventListener('input', () => { P.q = P.vst.value; P.course = 0; draw(); });
  CONV_STORE.listen.add((type) => { if (P.on && type === 'change') draw(); });
  addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); P.on ? close() : open(); return; }
    if (!P.on) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); if (P.pol.length) { P.course = (P.course + (e.key === 'ArrowDown' ? 1 : P.pol.length - 1)) % P.pol.length; draw(); } }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(P.course); }
    else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); }
  }, true);
}
