// workroom.js – Workroom (UX audit 2026-11-17, Wave 3, variant A from prototype dizajn-v16.html): work mode without 3D.
// Layout: thin bar on top | on the left a list of conversations of the whole city | in the middle the existing #panel with the chat (only moved
// by CSS under body.pracovna) | on the right a mini city status (building scheme, row of waiting and running floors, usage, Home agents, For today).
// The list can be collapsed into a strip with dots ( [ or ⇤ ), the mini status closed ( ] or ◧ ), both are remembered in localStorage.
// The mode state is `workroom` in state.js (changed only via set), filters and search are local in the module (P), because nobody else reads them.
// Cost: the render loop in the Workroom stands still (main.js), 3D is not drawn at all. The list and mini status are built from KS.konv (~300 summaries)
// at most once per second or on a server event and the DOM is rewritten only when the text changes. No new server calls:
// limits from KS.limity, Home agents from /api/tower (tower.js already loads it), For today from /api/today (panel.js already loads it).
import { active, homeModule, focusConv, city, setState, workroom } from './state.js';
import { $, esc, STANDALONE } from './utils.js';
import { BUILDINGS, HOME_BUILDINGS } from './demo-data.js';
import { WORLD, ACTIONS } from './world.js';
import { labelRenderer, renderer } from './scene-base.js';
import { agentIndex, CONV_STORE, floorCount, permission, isReal, messageConv, stop } from './api.js';
import { chatP, convState, setFocus, newConvWith, openConv } from './conversations.js';
import { pendingRequest, selectAgent, todayData, todayTasks, todayAlerts, refreshPanel, toast } from './panel.js';
import { backToCity, enterFloor } from './navigation.js';
import { openPalette } from './command-palette.js';
import { openUsage } from './usage-window.js';
import { CONTROL_CENTER_C, HOME_C, BRAIN_C } from './layers-kit.js';
import { ico } from './icons.js';
import { M } from './modules.js';
import { locale, t as tr, tn } from './i18n.js';

const KEY = { mode: 'city-workroom', pack: 'city-workroom-pack', status: 'city-workroom-status19', conv: 'city-workroom-conv', map: 'city-workroom-without-map', today: 'city-workroom-without-today' };
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const P = { q: '', building: 'all', po: null, more: false, agOpen: false, pack: false, status: false, withoutMap: false, withoutToday: false, drawT: null, lastConv: null, demoOpen: null };
const DAY = 864e5, MAX_RECENT = 12;
const without = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); // without diacritics like command-palette.js
const write = (el, h) => { if (el && el._h !== h) { el._h = h; el.innerHTML = h; } }; // the DOM changes only on change (hover and click do not lose their element)
// position of the building in the map scheme (CSS .pr-bld.s0 / s1 / s2 by the tower slot, brain and controlCenter have their own), the others below them
const placeMap = (b) => (b.slot != null ? 's' + b.slot : b.key === 'brain' || b.key === 'control-center' ? b.key : 'another');

export const workroomSaved = () => read(KEY.mode) === '1';

// ---------- floors: id → building, name, color (also virtual Home floors domov/<k>) ----------
// 2026-11-19: colors as in the city Layers (city-layers.js): Center dark gray, Brain green, Home pink, others the building's color
export const buildingColor = (b) => (b.controlCenter ? CONTROL_CENTER_C : b.key === 'brain' ? BRAIN_C : b.color);
function floors() {
  const m = new Map();
  for (const b of BUILDINGS) for (const p of b.floors) { const pid = p.id || p.n; m.set(pid, { pid, n: p.n, key: b.key, building: b.title, color: buildingColor(b) }); }
  for (const b of HOME_BUILDINGS) m.set('home/' + b.k, { pid: 'home/' + b.k, n: b.title, key: 'home', building: tr('app.workroom.home'), color: HOME_C, dk: b.k });
  return m;
}
function agentName(k, I) {
  if (I.dk) return k.agent === 'lead' ? tr('app.workroom.agent_house') : k.agent;
  const P_ = WORLD.floors.get(I.n), i = P_ ? agentIndex(P_, k.agent) : null;
  return (i != null && P_.agents[i]?.name) || (k.agent === 'lead' ? tr('app.workroom.lead') : k.agent);
}
function when(ms) {
  if (!ms) return '';
  const d = new Date(ms), midnight = new Date().setHours(0, 0, 0, 0);
  if (ms >= midnight) return d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  if (ms >= midnight - DAY) return tr('app.workroom.yesterday');
  if (ms >= midnight - 6 * DAY) return d.toLocaleDateString(locale(), { weekday: 'short' });
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'numeric' });
}
const duration = (from) => { const m = Math.floor((Date.now() - from) / 60000); return m < 1 ? tr('app.workroom.less_min') : m < 60 ? tr('app.workroom.min', { m }) : tr('app.workroom.h_min', { h: Math.floor(m / 60), m: m % 60 }); };
const isPending = (k) => k.status === 'pending' || k.status === 'reply';

// ---------- demo mode (2026-11-27): the list from the simulated tasks (WORLD.tasks), so the Workroom is not empty in the demo ----------
// pending (with the agent's approval request right in the row), running and done; a click enters the floor and selects the agent (no server calls)
function demoConv() {
  const pid = new Map(); for (const b of BUILDINGS) for (const p of b.floors) pid.set(p.n, p.id || p.n);
  const now = Date.now(), ago = (t) => now - Math.max(0, WORLD.time - t) * 1000, out = [];
  for (const u of WORLD.tasks) {
    const status = u.column === 'pending' ? 'pending' : u.column === 'doing' || u.column === 'flies' ? 'running' : u.column === 'done' ? 'done' : null;
    const a = WORLD.floors.get(u.p)?.agents[u.a]; if (!status || !a || !pid.has(u.p)) continue;
    out.push({ id: 'demo-' + u.id, demo: true, n: u.p, ai: u.a, floor: pid.get(u.p), agent: a.lead ? 'lead' : a.name, title: u.text, status, changed: ago(u.end ?? u.time), start: status === 'running' ? ago(u.time) : 0 });
  }
  return out;
}
const demoRequest = (k) => { const r = k.status === 'pending' && WORLD.floors.get(k.n)?.agents[k.ai]?.request; return r ? { id: k.id, what: r[0], where: r[1] } : null; };
const convs = () => (isReal() ? [...CONV_STORE.conv.values()] : demoConv());

// ---------- list data (same rules as the Overview in panel.js: teammates' tasks only when waiting, leads with running tasks in Running) ----------
function build() {
  const M = floors(), all = [], children = new Map(), poP = new Map(); // poP: pid → { pending, running, n } for the mini status
  for (const k of convs()) {
    if (k.hidden) continue;
    const I = M.get(k.floor); if (!I) continue;
    all.push(k);
    const s = poP.get(k.floor) || { pending: 0, running: 0, n: 0 }; s.n++; if (k.status === 'pending') s.pending++; else if (k.status === 'running') s.running++; poP.set(k.floor, s);
    if (k.parent && k.status === 'running') children.set(k.parent, (children.get(k.parent) || 0) + 1);
  }
  const t = without(P.q).trim().split(/\s+/).filter(Boolean);
  const match = (k) => {
    const I = M.get(k.floor);
    if (P.building !== 'all' && I.key !== P.building) return false;
    if (P.po && k.floor !== P.po) return false;
    if (t.length) { const h = without(`${k.title} ${I.building} ${I.n} ${agentName(k, I)}`); if (!t.every((w) => h.includes(w))) return false; }
    return true;
  };
  const note = (a, b) => (b.changed || 0) - (a.changed || 0);
  const vsAll = all.filter((k) => (!k.parent || k.status === 'pending') && match(k));
  // 2026-11-19: pinned conversations on top (last pinned first), not repeated in the other sections
  const pin = vsAll.filter((k) => k.pinned && !k.parent).sort((a, b) => b.pinned - a.pinned);
  const vs = vsAll.filter((k) => !pin.includes(k));
  const pending = vs.filter(isPending).sort(note);
  const running = vs.filter((k) => !isPending(k) && (k.status === 'running' || children.has(k.id))).sort(note);
  const uz = new Set([...pending, ...running].map((k) => k.id));
  // scheduled runs of Home agents (brief, journal, mail) in Recent only with the Home chip, a floor filter or search; your chats in Home always (2026-11-19)
  const homeVisible = P.building === 'home' || !!P.po || t.length > 0;
  const ost = vs.filter((k) => !uz.has(k.id) && (homeVisible || M.get(k.floor).key !== 'home' || !k.scheduled)).sort(note);
  return { M, all, children, poP, pin, pending, running, ost, searches: t.length > 0 };
}

// ---------- list ----------
const short = (n) => String(n || '').replace(/\s*\(.*?\)\s*/g, ' ').trim(); // "Experimental floor (phase 3)" → "Experimental floor"
function row(k, D) {
  const I = D.M.get(k.floor), update = k.demo ? P.demoOpen === k.id && active?.kind === 'floor' && active.n === k.n : !!chatP() && convState.open === k.id;
  const running = k.status === 'running' || D.children.has(k.id), point = isPending(k) ? 'pending' : running ? 'work' : k.status === 'error' ? 'error' : '';
  const ag = agentName(k, I), lead = k.agent === 'lead', where = short(I.n) + (lead ? '' : ` · ${ag}`);
  const path = `${I.building} › ${I.n} · ${ag}${k.parent ? ' · ' + tr('app.workroom.task') : ''}${running && k.start ? ' · ' + tr('app.workroom.running_od', { time: duration(k.start) }) : k.changed ? ` · ${when(k.changed)}` : ''}`;
  // dot only while running, waiting and on error, otherwise no space is reserved for it (v19)
  let h = `<div class="pr-r ${point ? 'sb' : ''} ${isPending(k) ? 'pending' : ''} ${update ? 'update' : ''}" tabindex="0" role="button" data-pa="open" data-id="${esc(k.id)}" title="${esc(`${k.title || tr('app.workroom.without_title')}\n${path}`)}">${point ? `<span class="point ${point}"></span>` : ''}<div style="min-width:0"><div class="t">${k.pinned ? `<span class="pinZ">${ico('pin')}</span>` : ''}${esc(k.title || tr('app.workroom.without_title'))}</div>`;
  if (k.status === 'pending') {
    const z = k.demo ? demoRequest(k) : pendingRequest(k); // a simple request can be handled in the row, a plan and delegation only in the thread (like the Overview, wave 2)
    h += z ? `<div class="ziad" title="${esc(`${z.what || ''} · ${z.where || ''}`)}">${ico('pending')} ${esc(String(z.what || tr('app.workroom.approve')).slice(0, 40))}</div><div class="actions"><button class="pr-b ok small" data-pa="allow" data-z="${esc(z.id)}">${tr('app.workroom.allow')}</button><button class="pr-b no small" data-pa="reject" data-z="${esc(z.id)}">${tr('app.workroom.reject')}</button></div>`
      : '<div class="plan">' + ico('pending') + ' ' + tr('app.workroom.open_approve') + '</div>';
  } else if (k.status === 'reply') h += '<div class="plan">' + ico('chat') + ' ' + tr('app.workroom.your_reply') + '</div>';
  else if (running) h += `<div class="doing">${k.plan?.n && k.plan.step ? `◐ ${k.plan.h + 1}/${k.plan.n} · ${esc(k.plan.step)}` : D.children.get(k.id) ? `${ico('people')} ${tn('app.workroom.tasks_running', D.children.get(k.id))}` : tr('app.workroom.working')}</div>`;
  h += '</div><div class="pr-rc">';
  // project label in the building's color (as in Layers); ■ stop while running and ✓ handled for "your reply" (like the Overview in the city) show on hover
  const st = `<div class="c tag ${k.status === 'running' || k.status === 'reply' ? 'hasSt' : ''}" style="--fb:${I.color}">${esc(where)}</div>`;
  if (!k.demo) { // demo mode: no pin or stop (they talk to the server)
  h += `<div class="hov"><button class="stop pin ${k.pinned ? 'on' : ''}" data-pa="pin" data-id="${esc(k.id)}" title="${k.pinned ? tr('app.workroom.unpin') : tr('app.workroom.pin')}">${ico('pin')}</button>`;
  if (k.status === 'running') h += `<button class="stop" data-pa="stop" data-id="${esc(k.id)}" title="${tr('app.workroom.stop')}">${ico('stop')}</button>`;
  else if (k.status === 'reply') h += `<button class="stop select" data-pa="resolve" data-id="${esc(k.id)}" title="${tr('app.workroom.resolved_t')}">${tr('app.workroom.resolved')}</button>`;
  h += '</div>';
  }
  h += st;
  return h + '</div></div>';
}
function drawList(D) {
  let h = '';
  if (D.pin.length) h += `<div class="pr-sec pin">${ico('pin')} ${tr('app.workroom.sec_pinned')}</div>` + D.pin.map((k) => row(k, D)).join('');
  if (D.pending.length) h += `<div class="pr-sec pending">${ico('pending')} ${tr('app.workroom.sec_pending')}</div>` + D.pending.map((k) => row(k, D)).join('');
  if (D.running.length) h += `<div class="pr-sec work"><span class="point work"></span> ${tr('app.workroom.sec_running')}</div>` + D.running.map((k) => row(k, D)).join('');
  const midnight = new Date().setHours(0, 0, 0, 0);
  const grp = [[tr('app.workroom.today'), midnight], [tr('app.workroom.yesterday_v'), midnight - DAY], [tr('app.workroom.tyzden'), midnight - 6 * DAY]].concat(D.searches || P.po || P.building !== 'all' ? [[tr('app.workroom.older'), -Infinity]] : []); // 2026-11-18: with a floor or building filter also those older than a week, otherwise a quiet office looks empty
  const ost = D.ost.filter((k) => (k.changed || 0) >= grp[grp.length - 1][1]);
  if (ost.length) {
    const lim = D.searches || P.more ? Infinity : MAX_RECENT; let n = 0, more = 0, i = 0;
    for (let s = 0; s < grp.length; s++) {
      const items = []; while (i < ost.length && (ost[i].changed || 0) >= grp[s][1]) items.push(ost[i++]);
      if (!items.length) continue;
      const seen = items.slice(0, Math.max(0, lim - n)); n += seen.length; more += items.length - seen.length;
      if (seen.length) h += `<div class="pr-sec under">${grp[s][0]}</div>` + seen.map((k) => row(k, D)).join('');
    }
    if (more) h += `<button class="pr-b pr-more" data-pa="more">${tr('app.workroom.more', { n: more })}</button>`;
    else if (P.more && !D.searches && ost.length > MAX_RECENT) h += `<button class="pr-b pr-more" data-pa="less">${tr('app.workroom.less')}</button>`;
  }
  if (!h) h = `<div class="pr-none">${P.q ? tr('app.workroom.none_pre', { q: esc(P.q) }) : P.po || P.building !== 'all' ? tr('app.workroom.none_here') : isReal() ? tr('app.workroom.none') : tr('app.workroom.demo')}</div>`;
  write($('prScroll'), h);
  // building filter: one "All ▾" in the search field (own .vyber menu), the number = how many are waiting there for you
  const nPending = (k) => D.all.filter((x) => x.status === 'pending' && (k === 'all' || D.M.get(x.floor).key === k)).length;
  const choices = [['all', tr('app.workroom.all')], ...BUILDINGS.map((b) => [b.key, b.title]), ...(HOME_BUILDINGS.length ? [['home', tr('app.workroom.home')]] : [])];
  write($('prFilterMenu'), choices.map(([k, n]) => { const c = nPending(k); return `<button class="po auto ${P.building === k ? 'on' : ''}" data-pa="chip" data-k="${esc(k)}"><b>${esc(n)}</b>${c ? `<em class="cc">${tr('app.workroom.n_pending', { n: c })}</em>` : ''}</button>`; }).join(''));
  const select = choices.find(([k]) => k === P.building), cB = P.building === 'all' ? nPending('all') : 0;
  write($('prFilterBtn'), `<span class="t">${esc(select ? select[1] : tr('app.workroom.all'))}</span>${cB ? `<em class="cc">${cB}</em>` : ''}<i>▾</i>`);
  $('prFilterBtn').classList.toggle('on', P.building !== 'all');
  const I = P.po && D.M.get(P.po);
  // 2026-11-19 (variant A): with a floor filter (click on the strip in the map) "＋ new chat" goes straight to the lead of that floor
  write($('prFl'), I ? `<button class="pr-chip on" data-pa="cancelAfter" title="${tr('app.workroom.cancel_filter', { where: esc(I.building) + ' › ' + esc(I.n) })}"><span class="t">${esc(I.n)}</span> ${ico('x')}</button><button class="pr-chip create" style="--fb:${I.color}" data-pa="newHere" data-po="${esc(I.pid)}" title="${tr('app.workroom.new_t', { n: esc(I.n) })}">${tr('app.workroom.fresh')}</button>` : '');
  // collapsed strip: what is waiting and running, then 12 recent
  const strip = [...D.pin, ...D.pending, ...D.running, ...D.ost.slice(0, MAX_RECENT)];
  write($('prStrip'), strip.map((k) => { const J = D.M.get(k.floor), b = isPending(k) ? 'pending' : k.status === 'running' || D.children.has(k.id) ? 'work' : k.status === 'error' ? 'error' : ''; /* as in the list, done stays in the building's color (v19: .bod.hotovo is hidden), otherwise done in the orange Center looks like running */ return `<button data-pa="open" data-id="${esc(k.id)}" class="${active?.kind === 'floor' && convState.open === k.id ? 'update' : ''}" title="${esc(`${k.title || tr('app.workroom.without_title')} · ${J.building} › ${J.n}`)}"><span class="point ${b}" style="${b ? '' : `background:${J.color}`}"></span></button>`; }).join(''));
}
const order = () => [...(P.pack ? $('prStrip') : $('prScroll')).querySelectorAll('[data-pa="open"]')].map((e) => e.dataset.id);

// ---------- city mini status ----------
function drawStatus(D) {
  const statusP = (pid) => { const s = D.poP.get(pid); return !s ? '' : s.pending ? 'pending' : s.running ? 'work' : 'hasConv'; };
  const pass = (I) => `<button style="--fb:${I.color}" class="pass ${statusP(I.pid)} ${P.po === I.pid ? 'fil' : ''}" data-pa="po" data-po="${esc(I.pid)}" data-t="${esc(`${I.building} › ${I.n}`)}" aria-label="${esc(`${I.building} › ${I.n}`)}"></button>`;
  const bld = (b, className, bldItems) => `<div class="pr-bld ${className}"><div class="bn"><i style="background:${bldItems[0]?.color || 'var(--line)'}"></i><span>${esc(b)}</span></div><div class="pr-ps">${bldItems.map(pass).join('')}</div></div>`;
  let h = '';
  for (const b of BUILDINGS) h += bld(b.title, placeMap(b), b.floors.map((p) => D.M.get(p.id || p.n)).filter(Boolean));
  if (HOME_BUILDINGS.length) h += bld(tr('app.workroom.home'), 'home', HOME_BUILDINGS.map((b) => D.M.get('home/' + b.k)));
  write($('prMap'), h);
  const nC = [...D.poP.values()].reduce((a, s) => a + s.pending, 0), nB = [...D.poP.values()].reduce((a, s) => a + s.running, 0);
  write($('prMapToggle'), `<span>${tr('app.workroom.city')}</span>${P.withoutMap && (nC || nB) ? `<em>${[nC ? tr('app.workroom.n_pending', { n: nC }) : '', nB ? tr('app.workroom.n_running', { n: nB }) : ''].filter(Boolean).join(' · ')}</em>` : ''}<i>${P.withoutMap ? '▸' : '▾'}</i>`);
  // v19 polish: below the map only floors that are waiting or running (nothing when quiet; the waiting/running counts are already in this row)
  const live = [...D.poP].filter(([, s]) => s.pending || s.running).sort((a, b) => b[1].pending - a[1].pending);
  write($('prRow'), live.map(([pid, s]) => { const I = D.M.get(pid); return `<button class="${s.pending ? 'pending' : 'work'} ${P.po === pid ? 'fil' : ''}" data-pa="po" data-po="${esc(pid)}" title="${tr('app.workroom.filter_t')}">${s.pending ? ico('pending') : '●'} ${esc(I.building)} › ${esc(I.n)}</button>`; }).join(''));
  // usage (KS.limity from /usage): two bars with percentage and reset time
  const L = CONV_STORE.limits, f = (p) => (p >= 90 ? 'err' : p >= 75 ? 'w' : ''), reset = (ms) => { const z = ms - Date.now(); return !ms ? '' : z <= 0 ? tr('app.workroom.refreshing') : z < DAY ? tr('app.workroom.reset_o', { h: Math.floor(z / 36e5), m: Math.floor(z / 6e4) % 60 }) : tr('app.workroom.reset_day', { time: new Date(ms).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }); };
  // 2026-11-18: bar, percentages and reset time in plain view (not only in title), without a section heading
  const sp = (title, x, o) => (x ? `<div class="pr-spR ${f(x.p)}" data-pa="usage" data-id="${o}" title="${tr('app.workroom.usage_t')}"><div class="l"><span>${title}</span><b>${x.p} %</b></div><div class="pr-bar"><i style="width:${Math.min(100, x.p)}%"></i></div><div class="pr-res">${esc(reset(x.reset))}</div></div>` : '');
  write($('prUsage'), !isReal() || !(L && (L.h5 || L.week)) ? '' : `<div class="pr-sp">${sp(tr('app.workroom.window5H'), L.h5, 'h5')}${sp(tr('app.workroom.week_s'), L.week, 'week')}</div>`);
  // Home agents today: finished runs in one row (list on click), in plain view only running, waiting and failed
  const midnight = new Date().setHours(0, 0, 0, 0), today = (ms) => ms >= midnight && ms < midnight + DAY, hm = (ms) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const ag = (M.home?.TOWER.d?.schedule || []).map((r) => { const po = r.last ? Date.parse(r.last.when) : 0, da = r.next ? Date.parse(r.next) : 0;
    if (r.running) return { r, st: 'running', time: po || Date.now() };
    if (po && today(po)) return { r, st: r.last.ok === false ? 'error' : 'ok', time: po };
    if (da && today(da) && r.enabled) return { r, st: 'pending', time: da };
    return null; }).filter(Boolean).sort((a, b) => a.time - b.time);
  const agR = (a) => `<div class="pr-ag ${a.st}" role="button" tabindex="0" data-pa="module" data-k="${esc(a.r.k)}" title="${esc(tr('app.workroom.opens_team', { building: a.r.building }))}"><span class="icoText">${a.st === 'ok' ? '✓' : a.st === 'error' ? '✗' : a.st === 'running' ? '●' : ico('clock')}</span><span>${esc(a.r.name)}${a.st === 'error' ? ' ' + tr('app.workroom.failed') : a.st === 'running' ? ' ' + tr('app.workroom.running') : ''} <span class="time">${hm(a.time)}</span></span></div>`;
  const hot = ag.filter((a) => a.st === 'ok'), ost = ag.filter((a) => a.st !== 'ok');
  write($('prAgents'), !ag.length ? '' : (hot.length ? `<button class="pr-ag ok zb" data-pa="agDone" title="${tr('app.workroom.done_t')}"><span class="icoText">✓</span><span>${tn('app.workroom.agents_done', hot.length)} <i>${P.agOpen ? '▴' : '▾'}</i></span></button>` + (P.agOpen ? hot.map(agR).join('') : '') : '') + ost.map(agR).join(''));
  // For today: schedule from the brief and tasks from /api/today (only the few nearest, the rest is in the Task office)
  const d = todayData(), U = todayTasks(), po = U?.poTermine || [], alert = d && !d.error ? todayAlerts(d) : [];
  const pol = d && !d.error ? [...(d.schedule || []).filter((r) => !r.ran).map((r) => ({ when: r.time, code: r.code, text: r.what + (r.where ? ` · ${r.where}` : '') })), ...(U?.today || []), ...(U?.tomorrow || []).map((x) => ({ ...x, when: x.when.replace(/^zajtra\s*/, ''), tomorrow: 1 }))] : [];
  const poR = po.length ? `<div class="pr-dn po" role="button" tabindex="0" data-pa="tasksAfter" title="${tr('app.workroom.po_t')}"><span class="kd">${ico('warning')}</span><span class="tx">${tr('app.workroom.po_n', { n: po.length })} <em>${tr('app.workroom.taskOffice')}</em></span></div>` : '';
  const seen = pol.slice(0, 5);
  const nToday = alert.length + po.length + pol.length;
  const hlToday = `<div class="pr-sk"><button class="pr-collapse" data-pa="section" data-s="today" title="${tr('app.workroom.today_t')}"><span>${tr('app.workroom.na_today')}</span>${P.withoutToday && nToday ? `<em>${nToday}</em>` : ''}<i>${P.withoutToday ? '▸' : '▾'}</i></button></div>`;
  write($('prToday'), !isReal() || !(alert.length || poR || seen.length || d?.error) ? '' : P.withoutToday ? hlToday : hlToday + alert.map((t) => `<div class="pr-res err">${ico('warning')} ${esc(t)}</div>`).join('') + (d?.error ? `<div class="pr-res err">${esc(d.error)}</div>` : '')
    + poR + seen.map((x) => `<div class="pr-dn" title="${esc(`${x.code || tr('app.workroom.personal')}${x.tomorrow ? ' · ' + tr('app.workroom.tomorrow') : ''}`)}"><span class="kd">${esc(x.when || '')}</span><span class="tx">${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.text)}</a>` : esc(x.text)}</span></div>`).join('')
    + (pol.length > seen.length ? `<div class="pr-res">${tr('app.workroom.a_more', { n: pol.length - seen.length })}</div>` : ''));
}

// ---------- drawing (at most once per second or on a server event) ----------
function draw() {
  if (!workroom) return;
  const D = build();
  drawList(D); if (P.status) drawStatus(D); drawPath(D);
  if (chatP() && convState.open && convState.open !== P.lastConv) { P.lastConv = convState.open; save(KEY.conv, convState.open); }
}
// path in the top bar (2026-11-19: "I can't see where I am"): building dot, building › floor; click = the floor's conversation list
function drawPath(D) {
  const C = chatP(), J = C && D.M.get(C.def.id);
  write($('prPath'), !J ? '' : `<span class="pr-cs">›</span><button class="pr-path" data-pa="path" title="${tr('app.workroom.conv_floor', { n: esc(J.n) })}"><span class="point" style="background:${J.color}"></span>${esc(J.building)} › <b>${esc(J.n)}</b></button>`);
  // 2026-11-19: "City" leads to the whole city, "Back" leads to the office of the open conversation (also Esc · W)
  write($('prBack'), !J ? '' : `<button class="pr-b" data-pa="back" title="${tr('app.workroom.back_t', { where: esc(J.building) + ' › ' + esc(J.n) })}"><svg class="ikn" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6 4 12l6 6"/><path d="M4 12h16"/></svg> ${tr('app.workroom.back')}</button>`);
}
function schedule() { if (!workroom || P.drawT) return; P.drawT = setTimeout(() => { P.drawT = null; draw(); }, 150); }
function setPack(on) { P.pack = on; document.body.classList.toggle('prPack', on); save(KEY.pack, on ? '1' : '0'); $('prPackBtn').title = on ? tr('app.workroom.expand') : tr('app.workroom.collapse'); }
function setSection(s, without, persist = true) { // 2026-11-18: collapsible city overview (map + waiting/running) and For today, remembered
  if (s === 'map') { P.withoutMap = without; document.body.classList.toggle('prWithoutMap', without); } else P.withoutToday = without;
  if (persist) save(KEY[s], without ? '1' : '0');
}
function setStatus(on, persist = true) { P.status = on; document.body.classList.toggle('prWithoutStatus', !on); if (persist) save(KEY.status, on ? '1' : '0'); $('prStatusBtn').classList.toggle('on', on); if (on) draw(); }
const closeFilter = () => $('prFilterUi')?.classList.remove('on');
function filterPo(pid) { P.po = P.po === pid ? null : pid; if (P.po) P.building = 'all'; P.more = false; draw(); }

// ---------- entering, leaving, opening a conversation ----------
export async function openWorkroom({ withoutConv = false } = {}) {
  if (STANDALONE || workroom) return;
  setState({ workroom: true, hover: null }); document.body.classList.add('workroom'); save(KEY.mode, '1');
  renderer.domElement.style.display = 'none'; labelRenderer.domElement.style.display = 'none'; $('tip').style.display = 'none';
  if (focusConv) setFocus(false); // focus makes no sense in the Workroom, the chat is in the middle anyway
  dispatchEvent(new Event('city-workroom')); // main.js stops the render loop
  if (active?.kind === 'interior') await backToCity(); // the Home interior has no chat, in the Workroom the city = "New"
  if (homeModule) setState({ homeModule: null });
  refreshPanel(); draw();
  if (!withoutConv && active === city) { const id = read(KEY.conv); if (id && CONV_STORE.conv.has(id)) await openConvPr(id); }
}
export function closeWorkroom() {
  if (!workroom) return;
  setState({ workroom: false }); document.body.classList.remove('workroom', 'prNew'); save(KEY.mode, '0');
  renderer.domElement.style.display = ''; labelRenderer.domElement.style.display = '';
  dispatchEvent(new Event('city-workroom')); // main.js restores the size, labels and the loop
  if (document.activeElement?.closest?.('#workroom')) document.activeElement.blur();
  refreshPanel();
}
async function openConvPr(id) {
  if (String(id).startsWith('demo-')) { // demo mode: the floor with the agent (the simulated chat is the agent's log)
    const k = demoConv().find((x) => x.id === id); if (!k) return;
    P.demoOpen = id; if (homeModule) setState({ homeModule: null });
    if (active?.kind === 'floor' && active.n === k.n) selectAgent(k.ai); else await enterFloor(k.n, k.ai);
    return draw();
  }
  const k = CONV_STORE.conv.get(id), I = k && floors().get(k.floor); if (!I) return;
  if (I.dk) { await M.home?.openHomeChat(I.dk, { id }); return draw(); } // Home agent: thread in the building's chat (a building without chat: only its panel)
  const n = floorCount(k.floor); if (!n || !WORLD.floors.has(n)) return;
  if (homeModule) setState({ homeModule: null });
  if (active?.kind === 'floor' && active.n === n) openConv(id); else await enterFloor(n, null, id); // in the Workroom without a camera flight (navigation.js wait)
  draw();
  $('prScroll').querySelector('.pr-r.update')?.scrollIntoView({ block: 'nearest' });
}
async function newHere(pid) { // new conversation with the floor's lead (Home: the building's chat)
  const I = floors().get(pid); if (!I) return;
  if (I.dk) { await M.home?.openHomeChat(I.dk, { create: true }); return draw(); }
  const n = floorCount(pid); if (!n || !WORLD.floors.has(n)) return;
  if (homeModule) setState({ homeModule: null });
  if (!(active?.kind === 'floor' && active.n === n)) await enterFloor(n);
  newConvWith('lead'); draw();
}
async function create() { // ＋ New: Router "What needs to be done?" (router.js, wave 2) in the middle
  if (homeModule) setState({ homeModule: null });
  if (active && active !== city) await backToCity(); else refreshPanel();
  draw(); setTimeout(() => $('routerText')?.focus(), 0);
}
function adjacent(direction) {
  const p = order(); if (!p.length) return;
  let i = p.indexOf(chatP() ? convState.open : null);
  i = i < 0 ? (direction > 0 ? 0 : p.length - 1) : Math.max(0, Math.min(p.length - 1, i + direction));
  openConvPr(p[i]);
}

// ---------- events ----------
const inArray = (el = document.activeElement) => !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
// Esc in the Workroom applies only when no menu, card, palette or preview is open (those close with their own Esc)
const something = () => !!document.querySelector('#palette.on, #setUi.on, .pick.on, #convMenu.on, #messagePan.on, #dispatchPan.on, #devicesPan.on, #nsWindow.on, #showCard.on, #routerCard.on, body.nsWhole')
  || ['preview', 'filePreview'].some((id) => { const el = $(id); return el && getComputedStyle(el).display !== 'none'; });
function keys(e) {
  if (STANDALONE || e.isComposing) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key || '';
  if (!workroom) { // in the city: W = to the Workroom
    if (!mod && !e.altKey && !inArray() && k.toLowerCase() === 'w' && !e.defaultPrevented) { e.preventDefault(); openWorkroom(); }
    return;
  }
  if (document.querySelector('#palette.on')) return; // ⌘K palette has its own keys
  if (k === 'Escape') {
    if (e.defaultPrevented || something()) return;
    const a = document.activeElement;
    if (a?.id === 'prSearch') { if (a.value) { a.value = ''; P.q = ''; draw(); } else a.blur(); return; }
    if (inArray(a)) { a.blur(); return; } // the first Esc leaves the field (text stays), the second returns to the city
    closeWorkroom(); return;
  }
  if (e.altKey && !mod && (k === 'ArrowUp' || k === 'ArrowDown')) { // ⌥↑ ⌥↓: previous / next conversation (in multi-line text the cursor movement stays)
    if (inArray() && /\n/.test(document.activeElement.value || '')) return;
    e.preventDefault(); adjacent(k === 'ArrowUp' ? -1 : 1); return;
  }
  if (mod && !e.altKey && !e.shiftKey && /^[1-9]$/.test(k)) { const p = order()[+k - 1]; if (p) { e.preventDefault(); openConvPr(p); } return; } // ⌘1–⌘9: the nth in the list
  if (mod || e.altKey || inArray()) return;
  if (k === ']') { e.preventDefault(); setStatus(!P.status); }
  else if (k === '[') { e.preventDefault(); setPack(!P.pack); }
  else if (k === '/') { e.preventDefault(); if (P.pack) setPack(false); $('prSearch').focus(); $('prSearch').select(); }
  else if (k.toLowerCase() === 'w') { e.preventDefault(); closeWorkroom(); }
}
function click(e) {
  const t = e.target.closest('[data-pa]'); if (!t || t.disabled) return;
  if (t.tagName === 'A' || e.target.closest('a')) return;
  const a = t.dataset.pa, id = t.dataset.id;
  switch (a) {
    case 'open': openConvPr(id); break;
    case 'usage': openUsage(id); break; // Limit usage window (usage-window.js)
    case 'allow': case 'reject': { // Allow / Deny directly in the row (same as the Overview, wave 2)
      e.stopPropagation(); t.parentElement.querySelectorAll('button').forEach((x) => (x.disabled = true));
      if (String(t.dataset.z).startsWith('demo-')) { const k = demoConv().find((x) => x.id === t.dataset.z); if (k) ACTIONS.decide(k.n, k.ai, a === 'allow'); toast(a === 'allow' ? tr('app.workroom.allowed') : tr('app.workroom.rejected')); refreshPanel(); draw(); break; }
      permission(t.dataset.z, a === 'allow' ? 'allow' : 'reject', '').then(() => toast(a === 'allow' ? tr('app.workroom.allowed') : tr('app.workroom.rejected'))).catch((err) => { toast(tr('app.workroom.request_notPending', { error: err.message })); $('prScroll')._h = ''; draw(); });
      break;
    }
    case 'resolve': e.stopPropagation(); t.disabled = true; messageConv('resolve', { ids: [id] }).then(() => { toast(tr('app.workroom.resolved_toast')); $('prScroll')._h = ''; draw(); }).catch((err) => { t.disabled = false; toast(err.message); }); break;
    case 'pin': e.stopPropagation(); t.disabled = true; { const k = CONV_STORE.conv.get(id); messageConv('pin', { ids: [id], pin: !k?.pinned }).then((r) => { if (r.errors?.length) toast(r.errors.join(' · ')); else toast(k?.pinned ? tr('app.workroom.unpinned') : tr('app.workroom.pinned')); $('prScroll')._h = ''; draw(); }).catch((err) => { t.disabled = false; toast(err.message); }); } break;
    case 'stop': e.stopPropagation(); t.disabled = true; stop(id).then(() => toast(tr('app.workroom.stopping'))).catch((err) => { t.disabled = false; toast(err.message); }); break;
    case 'city': closeWorkroom(); if (homeModule) setState({ homeModule: null }); backToCity(); break; // the whole city, not the office
    case 'back': closeWorkroom(); break; // office of the open conversation
    case 'search': openPalette(); break;
    case 'status': setStatus(!P.status); break;
    case 'pack': setPack(!P.pack); break;
    case 'section': setSection(t.dataset.s, !(t.dataset.s === 'map' ? P.withoutMap : P.withoutToday)); draw(); break;
    case 'create': create(); break;
    case 'path': openConv(null); draw(); break;
    case 'more': P.more = true; draw(); break;
    case 'less': P.more = false; draw(); break;
    case 'chip': closeFilter(); P.building = t.dataset.k; if (P.po && P.building !== 'all' && floors().get(P.po)?.key !== P.building) P.po = null; P.more = false; draw(); break;
    case 'cancelAfter': P.po = null; draw(); break;
    case 'po': filterPo(t.dataset.po); break;
    case 'newHere': newHere(t.dataset.po); break;
    case 'agDone': P.agOpen = !P.agOpen; draw(); break;
    case 'module': M.home?.openModule(t.dataset.k); setState({ houseTab: 'team' }); refreshPanel(); draw(); break;
    case 'tasksAfter': M.home?.setFilter('po'); M.home?.openModule('tasks'); draw(); break; // summary row "overdue" in For today (Wave 3b)
  }
}

// ---------- side panel width (2026-11-20): a handle on the edge changes --prL / --prR on <html> by dragging, double click restores the default ----------
// A collapsed list (body.prZbal) and a hidden state (body.prBezStavu) set the variable on body, so they take priority. DOM only, 3D does not run then.
const WIDTH = { L: { k: 'city-workroom-width-l', min: 220, max: 520, def: 300 }, R: { k: 'city-workroom-width-r', min: 220, max: 520, def: 280 } };
function setWidth(s, px, persist = true) {
  const S = WIDTH[s], v = Math.round(Math.min(S.max, Math.max(S.min, px)));
  document.documentElement.style.setProperty(s === 'L' ? '--prL' : '--prR', `${v}px`);
  if (persist) save(S.k, String(v));
}
function initWidth() {
  for (const s of ['L', 'R']) {
    const ul = Number(read(WIDTH[s].k)); if (ul) setWidth(s, ul, false);
    const u = document.createElement('div'); u.className = `pr-handle ${s === 'L' ? 'l' : 'r'}`; u.title = tr('app.workroom.handle');
    u.addEventListener('pointerdown', (e) => {
      e.preventDefault(); u.setPointerCapture(e.pointerId); document.body.classList.add('prTaha');
      const motion = (ev) => setWidth(s, s === 'L' ? ev.clientX : innerWidth - ev.clientX, false);
      const end = () => { u.removeEventListener('pointermove', motion); document.body.classList.remove('prTaha'); const v = getComputedStyle(document.documentElement).getPropertyValue(s === 'L' ? '--prL' : '--prR'); save(WIDTH[s].k, String(parseInt(v, 10))); };
      u.addEventListener('pointermove', motion); u.addEventListener('pointerup', end, { once: true }); u.addEventListener('pointercancel', end, { once: true });
    });
    u.addEventListener('dblclick', () => setWidth(s, WIDTH[s].def));
    document.body.appendChild(u); // above #panel (z-index 5), #workroom has its own layer 4
  }
}

export function initWorkroom() {
  if (STANDALONE) return;
  P.pack = read(KEY.pack) === '1'; P.status = read(KEY.status) === '1'; // v19: closed by default, only your choice is remembered
  setSection('map', read(KEY.map) === '1', false); setSection('today', read(KEY.today) === '1', false);
  setPack(P.pack); setStatus(P.status, false);
  const el = $('workroom');
  el.addEventListener('click', click);
  $('prMap').addEventListener('dblclick', (e) => { const t = e.target.closest('[data-po]'); if (!t) return; P.po = t.dataset.po; P.building = 'all'; newHere(t.dataset.po); }); // double click on the strip = filter + new chat
  el.addEventListener('keydown', (e) => { const r = (e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-pa]'); if (r) { e.preventDefault(); e.target.click(); } });
  // hover over the strip: floor name and counts below the map
  document.body.appendChild($('prMpop')); // bubble at the strip: outside the side panel, otherwise it gets clipped
  $('prMap').addEventListener('mouseover', (e) => {
    const p = e.target.closest('.pass'); if (!p) return;
    const s = convs().filter((k) => k.floor === p.dataset.po && !k.hidden), c = s.filter((k) => k.status === 'pending').length, b = s.filter((k) => k.status === 'running').length;
    // 2026-11-19: description directly at the strip (bubble to the left of the map), not at the bottom below the map
    const [building, ...po] = p.dataset.t.split(' › '), el = $('prMpop'), r = p.getBoundingClientRect();
    el.innerHTML = `<b>${esc(po.join(' › ') || building)}</b><span>${esc(building)}${c ? ` · <em class="c">${tr('app.workroom.n_pending', { n: c })}</em>` : ''}${b ? ` · <em class="b">${tr('app.workroom.n_running', { n: b })}</em>` : ''}</span><i>${tr('app.workroom.bubble')}</i>`;
    el.style.setProperty('--fb', getComputedStyle(p).getPropertyValue('--fb'));
    el.classList.add('on'); el.style.top = `${r.top + r.height / 2}px`; el.style.right = `${innerWidth - r.left + 10}px`;
  });
  $('prMap').addEventListener('mouseleave', () => $('prMpop').classList.remove('on'));
  $('prFilterBtn').onclick = (e) => { e.stopPropagation(); $('prFilterUi').classList.toggle('on'); $('prFilterUi').querySelector('.po.on')?.scrollIntoView({ block: 'nearest' }); };
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('#prFilterUi')) closeFilter(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFilter(); });
  $('prSearch').addEventListener('input', (e) => { P.q = e.target.value; draw(); });
  $('prSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { const p = order()[0]; if (p) { openConvPr(p); e.target.blur(); } } });
  $('workroomBtn').onclick = () => openWorkroom();
  initWidth();
  addEventListener('keydown', keys);
  CONV_STORE.listen.add((type) => { if (type === 'change' || type === 'limits') schedule(); });
  setInterval(() => { if (workroom && !document.hidden) draw(); }, 1000); // times, open conversation, Tower and brief data (written only on change)
}
