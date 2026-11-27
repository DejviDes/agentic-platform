// control-center.js – Control Center (2026-11-10): the city app as a place in the city (building in city.js, floor id `controlCenter`).
// Control Center bar above conversations (git status from /api/control-center: changed files, diff, commit and push only by click) and
// self-refresh of the app after a frontend change (SSE `app` from the server): waits until you stop typing for 2 s, typed text, open
// floor, conversation and camera view stay (sessionStorage `city-refresh`). Design: brain navrh-stavebny-urad.md.
import { active, city, setState, workroom, DISTRICT } from './state.js';
import { $, esc } from './utils.js';
import { WORLD } from './world.js';
import { CONV_STORE, isReal } from './api.js';
import { refreshPanel, toast } from './panel.js';
import { convStateRefresh, openConv } from './conversations.js';
import { setEditor, editorText } from './editor.js';
import { enterFloor } from './navigation.js';
import { dispatchRunning, dispatchRefresh, saveDispatchState } from './dispatch.js';
import { ico } from './icons.js';
import { locale, t as tr, tn } from './i18n.js';

export const CONTROL_CENTER = {
  n: 'Riadiaca centrála', color: '#8c949e',
  status: null, error: '', ver: 0, // state = response of /api/control-center
  expand: false, diff: null, commit: false, msg: '', outside: new Set(), running: false, push: false, // bar UI (outside = files unchecked from the commit)
};
export const isControlCenter = (n) => n === CONTROL_CENTER.n;
const onControlCenter = () => active?.kind === 'floor' && isControlCenter(active.n);

// ---------- state from the server ----------
let loading = null;
export function loadControlCenter() {
  if (!isReal() || loading) return loading;
  loading = fetch('/api/control-center', { cache: 'no-store' }).then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || r.status); return d; }))
    .then((d) => { CONTROL_CENTER.status = d; CONTROL_CENTER.error = ''; for (const s of [...CONTROL_CENTER.outside]) if (!d.changes.some((z) => z.s === s)) CONTROL_CENTER.outside.delete(s); if (CONTROL_CENTER.diff && !d.changes.some((z) => z.s === CONTROL_CENTER.diff.file)) CONTROL_CENTER.diff = null; })
    .catch((e) => { CONTROL_CENTER.error = e.message === 'Failed to fetch' || e.message === 'Load failed' ? tr('app.controlCenter.server_notResponding') : String(e.message); })
    .finally(() => { loading = null; CONTROL_CENTER.ver++; drawControlCenter(true); });
  return loading;
}
const statusSub = (s) => (s === 'nový' ? tr('app.controlCenter.fresh') : s === 'zmazaný' ? tr('app.controlCenter.deleted') : s === 'zmenený' ? tr('app.controlCenter.changed') : s === 'premenovaný' ? tr('app.controlCenter.renamed') : s === 'pridaný' ? tr('app.controlCenter.added') : s);
const hhmm = (ms) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
// text on the building label in the city (city.js overwrites it only on a change). v19: "Center · 5 changes", changes only when present, "new code waits for restart" stays
// visible (it is a state), "server running since" goes into the tooltip (titleControlCenter).
export function controlCenterBadge() {
  const S = CONTROL_CENTER.status;
  if (!isReal()) return tr('app.controlCenter.sample');
  if (!S) return CONTROL_CENTER.error ? tr('app.controlCenter.server_notResponding') : '';
  return [S.serverChanged.length ? tr('app.controlCenter.new_code') : '', S.changes.length ? tn('app.controlCenter.changes_n', S.changes.length) : ''].filter(Boolean).join(' · ');
}
export function titleControlCenter() {
  const S = CONTROL_CENTER.status;
  if (!isReal() || !S) return tr('app.controlCenter.title');
  return `${tr('app.controlCenter.title')}\n${tr('app.controlCenter.server_running_od', { time: hhmm(S.started) })}${S.serverChanged.length ? '\n' + tr('app.controlCenter.new_code_server') : ''}\n${S.changes.length ? tn('app.controlCenter.changed_files_n', S.changes.length) : tr('app.controlCenter.without_changes')}${S.branch ? ` · ${S.branch}` : ''}`;
}

// ---------- bar above conversations ----------
let signature = '';
export function drawControlCenter(force = false) {
  const el = $('controlCenterTopbar'); if (!el) return;
  const on = onControlCenter() && isReal() && workroom; // 2026-11-20: git status only in the right panel of the Workroom, not above the chat
  if (el.classList.contains('on') !== on) { el.classList.toggle('on', on); if (on) loadControlCenter(); }
  if (!on) return;
  if (document.activeElement?.id === 'cMsg' && !force) return; // do not redraw under the hands while typing the commit message
  const p = `${CONTROL_CENTER.ver}|${CONTROL_CENTER.expand}|${CONTROL_CENTER.diff?.file}|${CONTROL_CENTER.diff?.text?.length}|${CONTROL_CENTER.commit}|${CONTROL_CENTER.running}|${[...CONTROL_CENTER.outside]}`;
  if (p === signature && !force) return; signature = p;
  const focus = document.activeElement?.id === 'cMsg', cursor = focus ? $('cMsg').selectionStart : 0;
  el.innerHTML = topbarHtml();
  if (focus && $('cMsg')) { $('cMsg').focus(); $('cMsg').setSelectionRange(cursor, cursor); }
}
function topbarHtml() {
  const S = CONTROL_CENTER.status;
  if (!S) return `<div class="taskOffice"><div class="uHl"><span class="uSt ${CONTROL_CENTER.error ? 'err' : ''}"><i></i>${CONTROL_CENTER.error ? tr('app.controlCenter.topbar_error', { error: esc(CONTROL_CENTER.error) }) : tr('app.controlCenter.loading')}</span></div></div>`;
  const n = S.changes.length, fresh = S.serverChanged.length;
  // 2026-11-20: "Git" section in the right panel of the Workroom (at a Control Center conversation), one line, expands on click; when there are no changes, unpushed
  // commits or new server code, it is empty. Floors are in the ⋯ menu (settings.js), Dispatch only via the satellite on the roof of the Control Center in the city.
  if (!n && !S.ahead && !fresh) { CONTROL_CENTER.expand = false; CONTROL_CENTER.commit = false; return ''; }
  const parts = [S.branch !== 'main' ? S.branch : '', n ? tn('app.controlCenter.changes_n', n) : '', S.ahead ? tr('app.controlCenter.unpushed', { n: S.ahead }) : ''].filter(Boolean); // narrow panel: short, commit and branch main in title
  let h = `<div class="taskOffice uSmall ${fresh ? 'warn' : ''}"><button class="uRow ${CONTROL_CENTER.expand ? 'on' : ''}" data-c="expand" title="${esc(`Git · ${S.branch}\n${tr('app.controlCenter.server_running_od', { time: hhmm(S.started) })}\n` + S.log.map((c) => `${c.h} ${c.s}`).join('\n'))}">${fresh ? `<span class="uSt warn"><i></i>${tr('app.controlCenter.new_code_server')}</span>` : ''}<span class="uTx">${esc(parts.join(' · '))}</span><i>▾</i></button>`;
  if (!CONTROL_CENTER.expand) return h + '</div>';
  if (fresh) h += `<div class="note">${tr('app.controlCenter.changed_od_start', { files: esc(S.serverChanged.join(', ')) })}</div>`;
  h += `<div class="uBtns">${n ? `<button class="btn p" data-c="commit">${tr('app.controlCenter.commit_btn')}</button>` : ''}${S.ahead > 0 ? `<button class="btn" data-c="push" ${CONTROL_CENTER.running ? 'disabled' : ''} title="${tr('app.controlCenter.push_t')}">${CONTROL_CENTER.push ? tr('app.controlCenter.pushing') : tr('app.controlCenter.push', { n: S.ahead })}</button>` : ''}<button class="btn uRefresh" data-c="refresh" title="${tr('app.controlCenter.refresh')}" aria-label="${tr('app.controlCenter.refresh')}"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button></div>`;
  if (n) h += `<div class="uItems">${n ? S.changes.map((z) => `<div class="uF ${CONTROL_CENTER.diff?.file === z.s ? 'on' : ''}" data-cf="${esc(z.s)}" title="${esc(statusSub(z.status))} · ${tr('app.controlCenter.click_diff')}"><span class="icoText ${z.kind}">${z.kind}</span><b>${esc(z.s)}</b><span class="pm">${z.status === 'nový' ? `<em class="p">${tr('app.controlCenter.fresh')}</em> ` : z.status === 'zmazaný' ? `<em class="m">${tr('app.controlCenter.deleted')}</em> ` : ''}${z.plus != null ? `<em class="p">+${z.plus}</em> <em class="m">−${z.minus}</em>` : `<em>${tr('app.controlCenter.bin')}</em>`}</span></div>${CONTROL_CENTER.diff?.file === z.s ? diffHtml(CONTROL_CENTER.diff.text) : ''}`).join('') : `<div class="uEmpty">${tr('app.controlCenter.clean')}</div>`}</div>`;
  if (CONTROL_CENTER.commit && n) {
    if (!CONTROL_CENTER.msg) CONTROL_CENTER.msg = proposalMessages();
    h += `<div class="uCommit"><div class="mono">${tr('app.controlCenter.commit_branch', { branch: esc(S.branch) })}</div><textarea id="cMsg" rows="2" spellcheck="false">${esc(CONTROL_CENTER.msg)}</textarea>
      ${S.changes.map((z) => `<div class="uChk" data-cc="${esc(z.s)}"><span class="chk ${CONTROL_CENTER.outside.has(z.s) ? '' : 'on'}"></span>${esc(z.s)}</div>`).join('')}
      <div class="btns"><button class="btn p" data-c="commit" ${CONTROL_CENTER.running ? 'disabled' : ''}>${CONTROL_CENTER.running ? tr('app.controlCenter.working') : tr('app.controlCenter.commit')}</button><button class="btn" data-c="commitPush" ${CONTROL_CENTER.running ? 'disabled' : ''}>${tr('app.controlCenter.commit_push')}</button><button class="btn" data-c="cancel">${tr('app.controlCenter.cancel')}</button></div>
      <div class="note">${tr('app.controlCenter.commit_note')}</div></div>`;
  }
  return h + '</div>';
}
const diffHtml = (t) => (t == null ? `<pre class="uDiff">${tr('app.controlCenter.loading_diff')}</pre>`
  : `<pre class="uDiff">${t.split('\n').map((r) => `<span class="${r[0] === '+' ? 'ins' : r[0] === '-' ? 'del' : r.startsWith('@@') ? 'hl' : ''}">${esc(r)}</span>`).join('\n') || tr('app.controlCenter.without_diff')}</pre>`);
// message suggestion: the last Control Center conversation (its title), otherwise changed files
function proposalMessages() {
  const k = [...CONV_STORE.conv.values()].filter((x) => x.floor === 'control-center' && !x.parent).sort((a, b) => (b.changed || 0) - (a.changed || 0))[0];
  if (k?.title && Date.now() - (k.changed || 0) < 12 * 3600e3) return `Mesto: ${k.title}`;
  const z = CONTROL_CENTER.status.changes.filter((x) => !CONTROL_CENTER.outside.has(x.s)).map((x) => x.s.split('/').pop());
  return `Mesto: zmeny v ${z.slice(0, 4).join(', ')}${z.length > 4 ? ' …' : ''}`;
}

async function commit(push) {
  const S = CONTROL_CENTER.status, files = S.changes.map((z) => z.s).filter((s) => !CONTROL_CENTER.outside.has(s));
  const message = ($('cMsg')?.value ?? CONTROL_CENTER.msg).trim();
  if (!files.length) return toast(tr('app.controlCenter.select_file'));
  if (!message) { $('cMsg')?.focus(); return toast(tr('app.controlCenter.write_message')); }
  CONTROL_CENTER.msg = message; CONTROL_CENTER.running = true; drawControlCenter(true);
  try {
    const r = await fetch('/api/control-center/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, files, push }) });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `server vrátil ${r.status}`);
    toast(`✓ Commit ${d.hash} · ${tn('app.controlCenter.files_n', d.files)}${d.push ? (d.push.ok ? ' · ' + tr('app.controlCenter.pushed_na', { dest: d.push.dest }) : ' · ' + tr('app.controlCenter.push_failed', { error: d.push.error })) : ''}`);
    Object.assign(CONTROL_CENTER, { commit: false, msg: '', diff: null }); CONTROL_CENTER.outside.clear();
  } catch (e) { toast(tr('app.controlCenter.commit_failed', { error: e.message })); }
  CONTROL_CENTER.running = false; await loadControlCenter();
}
// standalone push of unpushed commits (POST /api/control-center/push without a body → { ok, error?, output? })
async function doPush() {
  if (CONTROL_CENTER.running) return;
  CONTROL_CENTER.running = CONTROL_CENTER.push = true; drawControlCenter(true);
  try {
    const r = await fetch('/api/control-center/push', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (r.status === 404 && !d.error) throw new Error(tr('app.controlCenter.push_unknown'));
    if (!r.ok || !d.ok) throw new Error(d.error || `server vrátil ${r.status}`);
    toast(`✓ ${tr('app.controlCenter.pushed')}${d.output ? ` · ${String(d.output).trim().split('\n').pop().slice(0, 80)}` : ''}`);
  } catch (e) { toast(tr('app.controlCenter.push_failed2', { error: e.message })); }
  CONTROL_CENTER.running = CONTROL_CENTER.push = false; await loadControlCenter();
}
async function showDiff(s) {
  if (CONTROL_CENTER.diff?.file === s) { CONTROL_CENTER.diff = null; return drawControlCenter(); }
  CONTROL_CENTER.diff = { file: s, text: null }; drawControlCenter();
  try { const r = await fetch(`/api/control-center/diff?file=${encodeURIComponent(s)}`, { cache: 'no-store' }), d = await r.json(); if (CONTROL_CENTER.diff?.file === s) CONTROL_CENTER.diff.text = r.ok ? d.diff : `${ico('warning')} ${d.error}`; }
  catch (e) { if (CONTROL_CENTER.diff?.file === s) CONTROL_CENTER.diff.text = `${ico('warning')} ${e.message}`; }
  drawControlCenter();
}
function click(e) {
  const b = e.target.closest('[data-c],[data-cf],[data-cc]'); if (!b || b.disabled) return;
  e.stopPropagation();
  if (b.dataset.cf != null) return showDiff(b.dataset.cf);
  if (b.dataset.cc != null) { const s = b.dataset.cc; CONTROL_CENTER.outside.has(s) ? CONTROL_CENTER.outside.delete(s) : CONTROL_CENTER.outside.add(s); return drawControlCenter(true); }
  const k = b.dataset.c;
  if (k === 'expand') { CONTROL_CENTER.expand = !CONTROL_CENTER.expand; if (!CONTROL_CENTER.expand) CONTROL_CENTER.diff = null; }
  if (k === 'commit') { CONTROL_CENTER.commit = !CONTROL_CENTER.commit; if (CONTROL_CENTER.commit) setTimeout(() => $('cMsg')?.focus(), 30); }
  if (k === 'cancel') CONTROL_CENTER.commit = false;
  if (k === 'refresh') return loadControlCenter();
  if (k === 'floors') return openMessage();
  if (k === 'commit' || k === 'commitPush') return commit(k === 'commitPush');
  if (k === 'push') return doPush();
  drawControlCenter(true);
}

// ---------- Floor management (2026-11-13) ----------
// Window from the Control Center bar: floors of all buildings (including hidden and archived) from GET /api/world/message. A change goes via
// POST /api/world/floor into world.json, on entering the tower it shows after the app refresh (button in the window). HTML only, no 3D scene.
const SP = { on: false, buildings: [], error: '', running: false, changed: false, edit: null, path: '', building: '', menu: false, selects: false };
// three options always show where the floor really is; Auto is a separate toggle (archive after 30 days without activity)
const STATES = () => [['tower', tr('app.controlCenter.sp_tower')], ['archive', tr('app.controlCenter.sp_archive')], ['hidden', tr('app.controlCenter.sp_hidden')]];
const ago = (ms) => { if (!ms) return tr('app.controlCenter.without_activity'); const d = Math.floor((Date.now() - ms) / 864e5); return d < 1 ? tr('app.controlCenter.today') : tr('app.controlCenter.ago_d', { n: d }); };
const whereIs = (r) => (r.status === 'hidden' ? 'hidden' : r.status === 'archive' ? 'archive' : 'tower');
const jeAuto = (r) => r.status !== 'hidden' && r.archiveManual !== true && r.archiveManual !== false;
async function callMessage(url, opts) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (r.status === 404 ? tr('app.controlCenter.sp_unknown') : tr('app.controlCenter.server_returned', { status: r.status })));
  return d;
}
async function loadMessage() {
  try { SP.buildings = (await callMessage('/api/world/message')).buildings; SP.error = ''; } catch (e) { SP.error = e.message; }
  drawMessage();
}
export function openMessage() {
  if (!isReal()) return;
  let el = $('messagePan');
  if (!el) {
    el = document.createElement('div'); el.id = 'messagePan';
    el.addEventListener('click', clickMessages);
    el.addEventListener('input', (e) => { if (e.target.id === 'spPath') SP.path = e.target.value; });
    el.addEventListener('keydown', keyMessages);
    el.addEventListener('focusout', (e) => { if (e.target.classList?.contains('spField') && SP.edit) saveTitle(e.target.value); });
    for (const [type, f] of Object.entries(TURN_EVENTS)) el.addEventListener(type, f);
    document.body.appendChild(el);
  }
  SP.on = true; SP.edit = null; SP.menu = false; el.classList.add('on'); drawMessage(); loadMessage();
}
function closeMessage() { SP.on = false; SP.edit = null; $('messagePan')?.classList.remove('on'); }
function drawMessage() {
  const el = $('messagePan'); if (!el || !SP.on) return;
  const scroll = el.querySelector('.spBody')?.scrollTop || 0;
  const field = (r, kind, value, empty) => (SP.edit?.path === r.path && SP.edit.kind === kind
    ? `<input class="spField" data-kind="${kind}" value="${esc(value)}" spellcheck="false" maxlength="200" placeholder="${esc(empty)}">`
    : `<span class="sp${kind === 'title' ? 'N' : 'P'}" data-spedit="${kind}" data-path="${esc(r.path)}" title="${tr('app.controlCenter.click_transcription')}">${esc(value)}</span>`);
  let h = `<div class="spWindow" role="dialog" aria-label="${tr('app.controlCenter.sp_heading')}"><div class="spHl"><b>${ico('building')} ${tr('app.controlCenter.sp_heading')}</b><span class="mono">world.json</span>
    <button class="btn" data-sp="close" aria-label="${tr('app.controlCenter.close')}">${ico('x')}</button></div>`;
  if (SP.error) h += `<div class="note" style="color:var(--warn)">${ico('warning')} ${esc(SP.error)}</div>`;
  if (SP.changed) h += `<div class="spZm">${tr('app.controlCenter.sp_change')} <button class="btn p" data-sp="refresh">${tr('app.controlCenter.sp_refresh')}</button></div>`;
  h += '<div class="spBody">';
  for (const b of SP.buildings) {
    h += `<div class="spBuilding"><div class="spBuildingHl"><i style="background:${esc(b.color || '#999')}"></i><b>${esc(b.title)}</b><em>${b.floors.length}</em></div>`;
    if (!b.floors.length) h += `<div class="uEmpty">${tr('app.controlCenter.sp_none')}</div>`;
    b.floors.forEach((r, i) => {
      const s = whereIs(r), au = jeAuto(r);
      h += `<div class="spRow ${r.status}" draggable="${SP.edit ? 'false' : 'true'}" data-turn="${esc(r.path)}" data-b="${esc(b.key)}"><div class="spOrder" title="${tr('app.controlCenter.sp_drag')}"><button data-sp="up" data-path="${esc(r.path)}" data-b="${esc(b.key)}" ${i === 0 ? 'disabled' : ''} aria-label="${tr('app.controlCenter.higher')}">↑</button><button data-sp="down" data-path="${esc(r.path)}" data-b="${esc(b.key)}" ${i === b.floors.length - 1 ? 'disabled' : ''} aria-label="${tr('app.controlCenter.lower')}">↓</button></div>
        <div class="spName">${field(r, 'title', r.title, r.name)}<small class="mono" title="${esc(r.path)}">${esc(r.path)}</small>${field(r, 'description', r.description, tr('app.controlCenter.description'))}</div>
        <div class="spPrav"><div class="spStatus"><button class="spAuto ${au ? 'on' : ''}" data-spauto="${esc(r.path)}" role="checkbox" aria-checked="${au}" title="${tr('app.controlCenter.sp_auto_t')}">${au ? ico('quadrantOk') : ico('quadrant')} ${tr('app.controlCenter.sp_auto')}</button>
          <div class="spSeg ${au ? 'au' : ''}" data-path="${esc(r.path)}">${STATES().map(([k, t]) => `<button class="${s === k ? 'on' : ''}" data-spstav="${k}" title="${s === k ? (au ? tr('app.controlCenter.sp_now_auto') : tr('app.controlCenter.sp_manual_set')) : tr('app.controlCenter.sp_move', { status: t })}">${t}</button>`).join('')}</div></div>
          <span class="spInfo">${au ? tr('app.controlCenter.sp_auto_m') + ' · ' : s === 'hidden' ? '' : tr('app.controlCenter.sp_manual_m') + ' · '}${tn('app.controlCenter.sessions_n', r.sessions)} · ${ago(r.activity)}</span></div></div>`;
    });
    h += '</div>';
  }
  const bn = SP.buildings.find((b) => b.key === SP.building);
  h += `<div class="spAdd"><div class="mono">${tr('app.controlCenter.sp_add_h')}</div><div class="spForm"><input id="spPath" placeholder="${tr('app.controlCenter.sp_path_ph')}" spellcheck="false" value="${esc(SP.path)}">
    <button class="btn" data-sp="folder" title="${tr('app.controlCenter.sp_select_t')}" ${SP.selects ? 'disabled' : ''}>${ico('folder')} ${tr('app.controlCenter.sp_select')}</button>
    <div class="pick ${SP.menu ? 'on' : ''}"><button class="selectBtn" data-sp="menu"><span class="t">${esc(bn?.title || tr('app.controlCenter.building'))}</span><i>▾</i></button><div class="selectMenu up">${SP.buildings.map((b) => `<div class="po auto ${b.key === SP.building ? 'on' : ''}" data-spb="${esc(b.key)}"><b>${esc(b.title)}</b></div>`).join('')}</div></div>
    <button class="btn p" data-sp="pridaj" ${SP.running ? 'disabled' : ''}>${tr('app.controlCenter.add')}</button></div></div>`;
  h += '</div></div>';
  const focus = document.activeElement?.id === 'spPath', cursor = focus ? $('spPath').selectionStart : 0;
  el.innerHTML = h;
  el.querySelector('.spBody').scrollTop = scroll;
  if (focus) { $('spPath').focus(); $('spPath').setSelectionRange(cursor, cursor); }
  el.querySelector('.spField')?.focus();
}
async function sendMessage(body, okMessage) {
  if (SP.running) return;
  SP.running = true;
  try {
    const d = await callMessage('/api/world/floor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    SP.buildings = d.buildings; SP.error = '';
    if (!SP.changed) toast(okMessage || tr('app.controlCenter.sp_saved'));
    SP.changed = true;
    return true;
  } catch (e) { SP.error = e.message; toast(e.message); }
  finally { SP.running = false; drawMessage(); }
}
function saveTitle(value) {
  const e = SP.edit; SP.edit = null; if (!e) return;
  const r = SP.buildings.flatMap((b) => b.floors).find((x) => x.path === e.path);
  const create = value.trim();
  if (!r || create === (e.kind === 'title' ? r.title : r.description)) return drawMessage();
  sendMessage({ path: e.path, changes: { [e.kind]: create || null } });
}
// drag and drop of rows: only within one building; upper half of the target = before it, lower = after it. Saves the whole order of the building.
const TURN = { path: null, b: null };
const turnTarget = (e) => { const r = e.target.closest?.('.spRow'); return r && TURN.path && r.dataset.b === TURN.b && r.dataset.turn !== TURN.path ? r : null; };
const cancelMarkers = () => $('messagePan')?.querySelectorAll('.spAbove, .spUnder, .spTurn').forEach((x) => x.classList.remove('spAbove', 'spUnder', 'spTurn'));
const TURN_EVENTS = {
  dragstart(e) {
    const r = e.target.closest?.('.spRow');
    if (!r || SP.running || SP.edit) return e.preventDefault();
    TURN.path = r.dataset.turn; TURN.b = r.dataset.b;
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', TURN.path);
    r.classList.add('spTurn');
  },
  dragover(e) {
    const r = turnTarget(e); if (!r) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const box = r.getBoundingClientRect(), under = e.clientY > box.top + box.height / 2;
    if (!r.classList.contains(under ? 'spUnder' : 'spAbove')) { $('messagePan').querySelectorAll('.spAbove, .spUnder').forEach((x) => x.classList.remove('spAbove', 'spUnder')); r.classList.add(under ? 'spUnder' : 'spAbove'); }
  },
  drop(e) {
    const r = turnTarget(e); if (!r) return;
    e.preventDefault();
    const under = r.classList.contains('spUnder'), building = SP.buildings.find((x) => x.key === TURN.b);
    const order = building.floors.map((x) => x.path).filter((c) => c !== TURN.path);
    const j = order.indexOf(r.dataset.turn) + (under ? 1 : 0);
    order.splice(j, 0, TURN.path);
    TURN.path = null; cancelMarkers();
    if (order.join('\n') !== building.floors.map((x) => x.path).join('\n')) sendMessage({ building: building.key, order });
  },
  dragend() { TURN.path = null; cancelMarkers(); },
};
function keyMessages(e) {
  e.stopPropagation();
  if (e.target.classList?.contains('spField')) {
    if (e.key === 'Enter') { e.preventDefault(); saveTitle(e.target.value); }
    else if (e.key === 'Escape') { e.preventDefault(); SP.edit = null; drawMessage(); }
  } else if (e.key === 'Escape') closeMessage();
}
function clickMessages(e) {
  e.stopPropagation();
  if (e.target.id === 'messagePan') return closeMessage();
  const t = e.target;
  const ed = t.closest('[data-spedit]');
  if (ed) { SP.edit = { path: ed.dataset.path, kind: ed.dataset.spedit }; return drawMessage(); }
  const au = t.closest('[data-spauto]');
  if (au) {
    const path = au.dataset.spauto, r = SP.buildings.flatMap((b) => b.floors).find((x) => x.path === path);
    if (!r) return;
    // turn on = back to automatic (also from hidden), turn off = pin manually where it is now
    return sendMessage({ path, changes: jeAuto(r) ? { hide: null, archive: whereIs(r) === 'archive' } : { hide: null, archive: null } });
  }
  const sg = t.closest('[data-spstav]');
  if (sg && (!sg.classList.contains('on') || sg.parentElement.classList.contains('au'))) {
    const path = sg.parentElement.dataset.path, k = sg.dataset.spstav;
    return sendMessage({ path, changes: k === 'hidden' ? { hide: true } : { hide: null, archive: k === 'archive' } });
  }
  const vb = t.closest('[data-spb]');
  if (vb) { SP.building = vb.dataset.spb; SP.menu = false; return drawMessage(); }
  const b = t.closest('[data-sp]');
  if (SP.menu && b?.dataset.sp !== 'menu') { SP.menu = false; drawMessage(); }
  if (!b || b.disabled) return;
  const k = b.dataset.sp;
  if (k === 'close') return closeMessage();
  if (k === 'refresh') return location.reload();
  if (k === 'menu') { SP.menu = !SP.menu; return drawMessage(); }
  if (k === 'up' || k === 'down') {
    const building = SP.buildings.find((x) => x.key === b.dataset.b), rows = building.floors, i = rows.findIndex((r) => r.path === b.dataset.path);
    let j = i + (k === 'up' ? -1 : 1);
    while (rows[j] && rows[j].status !== rows[i].status) j += k === 'up' ? -1 : 1; // move only within the same state (tower / archive / hidden)
    if (!rows[j]) return;
    const order = rows.map((r) => r.path); [order[i], order[j]] = [order[j], order[i]];
    return sendMessage({ building: building.key, order });
  }
  if (k === 'folder') { // the Finder window is opened by the server (the browser never reveals the path)
    SP.selects = true; drawMessage();
    callMessage('/api/world/select', { method: 'POST' })
      .then((d) => { if (d.path) SP.path = d.path; })
      .catch((e) => toast(e.message))
      .finally(() => { SP.selects = false; drawMessage(); });
    return;
  }
  if (k === 'pridaj') {
    if (!SP.path.trim()) return toast(tr('app.controlCenter.sp_path'));
    if (!SP.building) return toast(tr('app.controlCenter.sp_select_building'));
    sendMessage({ path: SP.path.trim(), building: SP.building }, tr('app.controlCenter.sp_added')).then((ok) => { if (ok) { SP.path = ''; drawMessage(); } });
  }
}

// ---------- self-refresh after a frontend change (SSE `app`) ----------
const REFRESH = { files: new Set(), t: null, enter: 0 };
export function onChangeApp(files) {
  for (const s of files || []) REFRESH.files.add(s);
  clearTimeout(REFRESH.t); REFRESH.t = setTimeout(tryRefresh, 900);
}
function tryRefresh() {
  const ae = document.activeElement, field = ae && (/^(TEXTAREA|INPUT)$/.test(ae.tagName) || ae.isContentEditable);
  const k = convStateRefresh();
  // waits for: typing in the last 2 s, dictation recording, unsent attachments, a commit or push in progress, pointing out ⚑ and its card
  if ((field && performance.now() - REFRESH.enter < 2000) || k.mic !== 'none' || k.attachments || CONTROL_CENTER.running || dispatchRunning() || document.body.classList.contains('show') || $('showCard')?.classList.contains('on') || $('routerMic')?.matches('.on, .pr') || $('routerCard')?.classList.contains('on')) { REFRESH.t = setTimeout(tryRefresh, 2000); return; }
  refreshApp();
}
function refreshApp() {
  const ae = document.activeElement, k = convStateRefresh(), c = active === city ? active.camera : null;
  const st = {
    time: Date.now(), files: [...REFRESH.files], agText: editorText(), zText: $('zText')?.value || '', routerText: $('routerText')?.value || '',
    focus: ae?.id && /^(agText|zText|routerText|cMsg)$/.test(ae.id) ? ae.id : null, cursor: ae?.selectionStart ?? null,
    floor: active?.kind === 'floor' ? active.n : null, conv: k.open, scroll: $('content')?.scrollTop || 0,
    cam: c ? { p: c.position.toArray(), t: city.controls.target.toArray(), district: DISTRICT } : null,
    dispatch: saveDispatchState(), // Dispatch: typed text and task cards (dispatch.js)
    controlCenter: { expand: CONTROL_CENTER.expand, commit: CONTROL_CENTER.commit, msg: $('cMsg')?.value ?? CONTROL_CENTER.msg, outside: [...CONTROL_CENTER.outside] },
  };
  try { sessionStorage.setItem('city-refresh', JSON.stringify(st)); } catch {}
  $('transition').classList.add('on');
  setTimeout(() => location.reload(), 260);
}
// after the app start (main.js): restores the state from before the self-refresh
export async function afterRefresh() {
  let st = null;
  try { st = JSON.parse(sessionStorage.getItem('city-refresh') || 'null'); sessionStorage.removeItem('city-refresh'); } catch {}
  if (!st || Date.now() - st.time > 60000) return false;
  Object.assign(CONTROL_CENTER, { expand: !!st.controlCenter?.expand, commit: !!st.controlCenter?.commit, msg: st.controlCenter?.msg || '' }); CONTROL_CENTER.outside = new Set(st.controlCenter?.outside || []);
  if (st.floor && WORLD.floors.has(st.floor)) {
    await enterFloor(st.floor, null);
    if (st.conv) setTimeout(() => { openConv(st.conv); setTimeout(() => { $('content').scrollTop = st.scroll; }, 400); }, 760);
  } else if (st.cam && active === city) {
    if (st.cam.district && st.cam.district !== 'city') setState({ DISTRICT: st.cam.district });
    document.querySelectorAll('#district button').forEach((b) => b.classList.toggle('on', b.dataset.r === (st.cam.district || 'city')));
    city.camera.position.fromArray(st.cam.p); city.controls.target.fromArray(st.cam.t); city.controls.update();
    refreshPanel(); // panel width by district (panel profile)
  }
  const restore = () => {
    if (st.agText) setEditor(st.agText); // code blocks are reassembled from markdown
    for (const id of ['zText', 'routerText']) { const el = $(id); if (el && st[id]) { el.value = st[id]; el.dispatchEvent(new Event('input')); } }
    const f = st.focus && $(st.focus); if (f) { f.focus(); if (st.cursor != null) f.setSelectionRange?.(st.cursor, st.cursor); }
  };
  if (st.dispatch) setTimeout(() => dispatchRefresh(st.dispatch), st.floor ? 900 : 300); // the Dispatch window opens again with the text and cards
  setTimeout(restore, st.floor ? 900 : 50);
  const name = st.files.length > 3 ? `${st.files.slice(0, 3).join(', ')} …` : st.files.join(', ');
  setTimeout(() => toast(tr('app.controlCenter.refreshed', { name }) + (st.agText || st.zText || st.routerText || st.dispatch?.edit?.length ? ' · ' + tr('app.controlCenter.message_remained') : '')), st.floor ? 1000 : 300);
  return true;
}

export function initControlCenter() {
  $('controlCenterTopbar')?.addEventListener('click', click);
  $('controlCenterTopbar')?.addEventListener('input', (e) => { if (e.target.id === 'cMsg') CONTROL_CENTER.msg = e.target.value; });
  for (const ev of ['keydown', 'input', 'compositionupdate']) addEventListener(ev, () => (REFRESH.enter = performance.now()), { capture: true, passive: true });
  if (!isReal()) return;
  loadControlCenter();
  // git status: on the Control Center floor every 15 s, otherwise once per minute (building label); nothing when the card is hidden
  let last = Date.now();
  setInterval(() => { if (document.hidden) return; const t = Date.now(); if (t - last > (onControlCenter() ? 15000 : 60000)) { last = t; loadControlCenter(); } }, 5000);
}
// events from the server and conversations (api.js): server code change / commit → new status; end of a turn in the Control Center → new status
export function onEventControlCenter() { loadControlCenter(); }
export function onConvControlCenter(k) { if (k?.floor === 'control-center' && k.status !== 'running') { clearTimeout(onConvControlCenter.t); onConvControlCenter.t = setTimeout(loadControlCenter, 600); } }
