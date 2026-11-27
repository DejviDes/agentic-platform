// Settings (2026-11-20, previously all in the ⋯ menu): the ⋯ menu has only Settings… (⌘,), Report a bug, Shortcuts and Lock the city.
// The Settings window (#nsWindow) is like in Obsidian: categories on the left, rows with a name, description and control on the right.
// NEW SETTING = one entry in SETTINGS below (a new category = a row in KATEGORIE). Control types:
//   element: 'id'                  existing element from #nsStock in index.html (its module handles it by id); prep: true = show it as a switch (.on = enabled)
//   toggle: { read, write }   custom switch (read() → bool, write(bool), may be async)
//   pick: { options: [[value, text]], read, write }   buttons side by side (read() → value, write(value), may be async)
//   action: { text, click }        button that opens something
// toggle and pick controls are redrawn after a click and on the 'city-settings' event (dispatchEvent from a module that changed the state elsewhere).
// Cost in performance: zero for 3D (DOM only, no calls in the render loop).
import { $, esc } from './utils.js';
import { language, t, tn, changeLanguage } from './i18n.js';
import { openMessage } from './control-center.js';
import { setSkin, ORIGINAL_KEY, originalCity } from './navigation.js';
import { ROTATION_KEY, rotationEnabled, SPEED_KEY, rotationSpeed } from './city-layers.js';
import { mobileDoneState, alertState, chooseMobileDone, chooseAlerts } from './alerts.js';
import { setState } from './state.js';
import { refreshPanel, toast } from './panel.js';
import { SOURCE } from './source.js';
import { M } from './modules.js';

const CATEGORY_NAMES = ['appearance', 'city', 'chat', 'alerts', 'mac', 'usage', 'floors', 'scheduled', 'devices']; // category name: key app.nastavenia.kat.<k>
const ALL_CATEGORIES = CATEGORY_NAMES.map((k) => [k, k]);
// categories of optional modules: Scheduled tasks belong to Home (agent schedule), Devices to the Mobile module; without the module they are not shown
let withoutMac = false; // the server (sleep.js) reports available: false outside macOS: the Mac category is not shown
const categories = () => ALL_CATEGORIES.map(([k]) => [k, t(`app.settings.category.${k}`)]).filter(([k]) => (k !== 'scheduled' || M.home) && (k !== 'devices' || SOURCE.modules.mobile) && (k !== 'mac' || !withoutMac));
const tower = () => M.home?.TOWER || {};
const saveLS = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const readLS = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
// the Saving level is held by the server (usage.js LEVELS, /api/saving); null = not chosen, world.json or 7 % (= medium) applies
let saving = null;
const thousands = (n) => t('app.settings.thousands', { n: Math.round(n / 1000) });
function descriptionSaving(st) { // current values under the Saving level row (from the server, usage.js savingState)
  const el = document.querySelector('#nsWindow .nsR[data-nm="saving"] .nsP'); if (!el || !st) return;
  el.textContent = t('app.settings.saving.now', { cap: st.cap, without: st.cap * st.withoutHuman, flow: thousands(st.thresholdContext) })
    + (st.deleg ? t('app.settings.saving.deleg') : '') + '.'
    + (st.auto ? ' ' + t('app.settings.saving.auto', { h5: st.h5 }) : ' ' + t('app.settings.saving.threshold', { threshold: st.autoThreshold }));
}
async function loadSaving() { try { const r = await fetch('/api/saving', { cache: 'no-store' }); if (r.ok) { const st = await r.json(); saving = st.chosen || 'medium'; drawControls(); descriptionSaving(st); } } catch {} }
async function chooseSaving(u) {
  const r = await fetch('/api/saving', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: u }) }).catch(() => null);
  if (r?.ok) { saving = u; descriptionSaving(await r.json()); toast(t('app.settings.saving.saved')); } else toast(t('app.settings.saving.error'));
}
// the running conversation title is held by the server (agents.js instructionTitle, /api/names); null = not loaded yet
let interimTitle = null;
async function loadNames() { try { const r = await fetch('/api/names', { cache: 'no-store' }); if (r.ok) { interimTitle = !!(await r.json()).interimTitle; drawControls(); } } catch {} }
async function chooseNames(v) {
  const r = await fetch('/api/names', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interimTitle: v }) }).catch(() => null);
  if (r?.ok) interimTitle = v; else toast(t('app.settings.errorSave'));
}
// Mac sleep is held by the server (sleep.js, /api/sleep): common | agents | never; null = not loaded yet
const SLEEP_DESCRIPTION = () => t('app.settings.n.sleep.description');
let sleep = null;
function descriptionSleep() { // current reason and sudo hint under the row
  const el = document.querySelector('#nsWindow .nsR[data-nm="sleep"] .nsP'); if (!el || !sleep) return;
  el.textContent = `${SLEEP_DESCRIPTION()}${sleep.mode !== 'common' ? ` ${t('app.settings.sleep.now', { status: sleep.holds ? t('app.settings.sleep.noSleep') : t('app.settings.sleep.sleep'), reason: String(sleep.reason || '').replace(/\.$/, '').toLowerCase() })}` : ''}`
    + (sleep.sudoOk === false ? ' ' + t('app.settings.sleep.sudo', { command: sleep.sudoCommand || 'sudo bash scripts/sleep-sudo.sh' }) : '');
}
async function loadSleep() { try { const r = await fetch('/api/sleep', { cache: 'no-store' }); if (r.ok) { sleep = await r.json(); drawControls(); descriptionSleep(); if (sleep.available === false && !withoutMac) hideCategoryMac(); } } catch {} }
function hideCategoryMac() {
  withoutMac = true;
  const b = document.querySelector('#nsWindow [data-nskat="mac"]'); if (b) { const was = b.classList.contains('on'); b.hidden = true; if (was) showCategory(categories()[0][0]); }
}
async function chooseSleep(v) {
  const r = await fetch('/api/sleep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: v }) }).catch(() => null);
  if (r?.ok) { sleep = await r.json(); descriptionSleep(); } else toast(t('app.settings.sleep.error'));
}
// the Scribe after a turn is held by the server (scribe.js, /api/scribe); null = not loaded yet
let scribe = null;
async function loadScribe() { try { const r = await fetch('/api/scribe', { cache: 'no-store' }); if (r.ok) { scribe = (await r.json()).enabled !== false; drawControls(); } } catch {} }
async function chooseScribe(v) {
  const r = await fetch('/api/scribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: v }) }).catch(() => null);
  if (r?.ok) scribe = v; else toast(t('app.settings.errorSave'));
}
const SETTINGS = [
  { category: 'appearance', nm: 'language', pick: { options: ['en', 'sk'], read: () => language(), write: changeLanguage } },
  { category: 'appearance', nm: 'font',  element: 'fontBtn', prep: true },
  { category: 'appearance', nm: 'original',  element: 'originalBtn', prep: true },
  { category: 'appearance', nm: 'day',  element: 'dayBtn' },
  { category: 'appearance', nm: 'time',  element: 'clock' },
  { category: 'city', nm: 'rotation',  element: 'rotationBtn', prep: true },
  { category: 'city', nm: 'speed', 
    pick: { options: ['slow', 'medium', 'fast'], read: () => rotationSpeed()[0], write: (v) => { saveLS(SPEED_KEY, v); dispatchEvent(new Event('city-rotation')); } } },
  { category: 'city', nm: 'quick',  element: 'quickBtn', prep: true },
  { category: 'city', nm: 'mode',  element: 'mode' },
  { category: 'chat', nm: 'interimTitle', 
    toggle: { read: () => interimTitle ?? true, write: (v) => chooseNames(v) } },
  { category: 'chat', nm: 'scribe', 
    toggle: { read: () => scribe ?? true, write: (v) => chooseScribe(v) } },
  { category: 'alerts', nm: 'bell', 
    pick: { options: ['enabled', 'silent', 'quiet', 'disabled'], read: () => alertState(), write: (v) => chooseAlerts(v) } },
  { category: 'mac', nm: 'sleep',
    pick: { options: ['common', 'agents', 'never'], read: () => sleep?.mode ?? null, write: (v) => chooseSleep(v) } },
  { category: 'devices', nm: 'mobileDone', 
    pick: { options: ['always', 'outsideMac', 'no'], read: () => mobileDoneState(), write: (v) => chooseMobileDone(v) } },
  { category: 'usage', nm: 'saving', 
    pick: { options: ['high', 'medium', 'low'], read: () => saving, write: (v) => chooseSaving(v) } },
  { category: 'floors', nm: 'floors',  action: { click: () => window(openMessage, 'messagePan') } },
  { category: 'devices', nm: 'zar',  action: { click: async () => { const z = await import('./devices.js'); window(z.openDevices, 'devicesPan'); } } },
];
// window of another module opened from Settings: after it closes (the .on class disappears) Settings return to the same category
function window(open, id) {
  closeWindow(); open();
  const el = $(id); if (!el?.classList.contains('on')) return openSettings();
  const mo = new MutationObserver(() => { if (!el.classList.contains('on')) { mo.disconnect(); openSettings(); } });
  mo.observe(el, { attributes: true, attributeFilter: ['class'] });
}

// ---------- Settings window ----------
const CATEGORY_KEY = 'city-settings-category';
const titleN = (n) => t(`app.settings.n.${n.nm}.title`), descriptionN = (n) => t(`app.settings.n.${n.nm}.description`);
const controlHtml = (n) => {
  if (n.pick) { const v = n.pick.read(); return `<div class="nsSelect" role="group">${n.pick.options.map((h) => `<button class="${h === v ? 'on' : ''}" data-nsv="${esc(h)}" aria-pressed="${h === v}">${esc(t(`app.settings.v.${n.nm}.${h}`))}</button>`).join('')}</div>`; }
  if (n.toggle) { const on = !!n.toggle.read(); return `<button class="nmS nsPrep ${on ? 'on' : ''}" data-nsp role="switch" aria-checked="${on}">${on ? t('app.settings.on') : t('app.settings.off')}</button>`; }
  if (n.action) return `<button class="btn" data-nsa>${esc(t('app.settings.open'))}</button>`;
  return '';
};
function drawControl(n) { const o = document.querySelector(`#nsWindow .nsR[data-nm="${n.nm}"] .nsOv`); if (o) o.innerHTML = controlHtml(n); }
const drawControls = () => { for (const n of SETTINGS) if (n.pick || n.toggle) drawControl(n); };
function buildWindow() {
  const el = document.createElement('div'); el.id = 'nsWindow';
  el.innerHTML = `<div class="nsCard box" role="dialog" aria-modal="true" aria-label="${esc(t('app.settings.title'))}">
    <nav class="nsNav"><div class="nsHl">${esc(t('app.settings.title'))}</div>${categories().map(([k, nz]) => `<button data-nskat="${k}">${esc(nz)}</button>`).join('')}</nav>
    <div class="nsContent"><div class="nsHead"><b id="nsHeadline"></b><button class="nsClose" data-nsz aria-label="${esc(t('app.settings.close'))}" title="${esc(t('app.settings.closeEsc'))}">×</button></div>
      ${categories().map(([k]) => `<div class="nsSec" data-category="${k}"></div>`).join('')}</div></div>`;
  document.body.append(el);
  for (const n of SETTINGS) {
    if (!categories().some(([k]) => k === n.category)) continue; // row of a disabled module
    const r = document.createElement('div'); r.className = 'nsR'; r.dataset.nm = n.nm;
    r.innerHTML = `<div class="nsTx"><div class="nsN">${esc(titleN(n))}</div><div class="nsP">${esc(n.nm === 'sleep' ? SLEEP_DESCRIPTION() : descriptionN(n))}</div></div><div class="nsOv">${controlHtml(n)}</div>`;
    const p = n.element && $(n.element);
    if (p) { if (n.prep) { p.classList.add('nsPrep'); p.setAttribute('role', 'switch'); } r.querySelector('.nsOv').append(p); }
    el.querySelector(`.nsSec[data-category="${n.category}"]`).append(r);
  }
  el.addEventListener('click', async (e) => {
    if (e.target === el || e.target.closest('[data-nsz]')) return closeWindow();
    const k = e.target.closest('[data-nskat]'); if (k) return showCategory(k.dataset.nskat);
    const vs = e.target.closest('[data-vzs]'); if (vs) return startScheduled(vs);
    const vp = e.target.closest('[data-vzp]'); if (vp) return toggleScheduled(vp);
    const vb = e.target.closest('[data-vb]'); if (vb) { closeWindow(); M.home?.openModule(vb.dataset.vb); setState({ houseTab: 'team' }); refreshPanel(); return; } // scheduled task → the agent's building
    const r = e.target.closest('.nsR'), n = r && SETTINGS.find((x) => x.nm === r.dataset.nm); if (!n) return;
    const v = e.target.closest('[data-nsv]');
    if (v && n.pick) { await n.pick.write(v.dataset.nsv); return drawControl(n); }
    if (e.target.closest('[data-nsp]') && n.toggle) { await n.toggle.write(!n.toggle.read()); return drawControl(n); }
    if (e.target.closest('[data-nsa]') && n.action) return n.action.click();
  });
  el.addEventListener('keydown', (e) => { // the scheduled task row is a div with role=button: Enter and space act as a click
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('div[data-vb]')) { e.preventDefault(); e.target.click(); }
  });
  addEventListener('city-settings', drawControls);
}
// Scheduled tasks (2026-11-21): all agents started by the server on a schedule (data from /api/tower, the same as the Clock tower schedule).
// A click on a row = the agent's building in Home (Team tab, switch and runs). Cost: DOM only, 1 fetch when the category opens (at most once per 60 s).
function drawScheduled() {
  const s = document.querySelector('#nsWindow .nsSec[data-category="scheduled"]'); if (!s) return;
  const TOWER = tower(), r = TOWER.d?.schedule;
  const body = r ? (r.length ? `<div class="block vzSchedule nsSchedule">${M.home?.scheduleRowsHtml({ prep: true })}</div>` : `<div class="nsP">${esc(t('app.settings.nap.none'))}</div>`)
    : `<div class="nsP">${esc(SOURCE.mode !== 'isReal' ? t('app.settings.nap.demo') : TOWER.error ? t('app.settings.nap.error') : t('app.settings.nap.loading'))}</div>`;
  const isOn = r ? r.filter((a) => a.enabled).length : 0;
  s.innerHTML = `<div class="nsP" style="margin:0 0 10px">${r ? `${tn('app.settings.nap.count', r.length, { isOn })} ` : ''}${esc(t('app.settings.nap.description'))}</div>${body}`;
}
// switch in the row: POST /api/<k>/toggle (the same as in the building's Team tab), then a fresh schedule
async function toggleScheduled(el) {
  const [k, task] = el.dataset.vzp.split('|'), a = tower().d?.schedule.find((x) => x.k === k && x.task === task);
  if (!a || !M.home?.TOGGLEABLE.has(k) || el.disabled) return;
  const isOn = !a.enabled; el.disabled = true;
  try {
    const r = await fetch(`/api/${k}/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, enabled: isOn }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || t('app.settings.serverReturned', { code: r.status }));
    a.enabled = isOn; toast(`${a.name}: ${isOn ? t('app.settings.nap.enabled') : t('app.settings.nap.disabled')}`);
  } catch (e) { toast(e.message === 'Failed to fetch' || e.message === 'Load failed' ? t('app.settings.serverNotResponding') : e.message); }
  drawScheduled();
  const TOWER = tower(); TOWER.when = 0; await (TOWER.load || M.home?.loadTower()); // new "next run" and state also for the Tower and the Workroom
  if (isCategory('scheduled')) drawScheduled();
}
// Run (only tasks without a building, e.g. the Chronicler): POST /api/<k>/run, then a fresh schedule
async function startScheduled(el) {
  const [k, task] = el.dataset.vzs.split('|'); if (el.disabled) return;
  el.disabled = true;
  try {
    const r = await fetch(`/api/${k}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || t('app.settings.serverReturned', { code: r.status }));
    toast(t('app.settings.nap.started'));
  } catch (e) { toast(e.message === 'Failed to fetch' || e.message === 'Load failed' ? t('app.settings.serverNotResponding') : e.message); }
  const TOWER = tower(); TOWER.when = 0; await (TOWER.load || M.home?.loadTower());
  if (isCategory('scheduled')) drawScheduled();
}
function showScheduled() {
  drawScheduled();
  const TOWER = tower();
  if (!TOWER.load && (!TOWER.d || Date.now() - TOWER.when > 60e3)) M.home?.loadTower().finally(() => { if (isCategory('scheduled')) drawScheduled(); });
}
const isCategory = (k) => $('nsWindow')?.classList.contains('on') && readLS(CATEGORY_KEY) === k;
function showCategory(k) {
  if (!categories().some(([x]) => x === k)) k = categories()[0][0];
  saveLS(CATEGORY_KEY, k);
  for (const b of document.querySelectorAll('#nsWindow [data-nskat]')) b.classList.toggle('on', b.dataset.nskat === k);
  for (const s of document.querySelectorAll('#nsWindow .nsSec')) s.hidden = s.dataset.category !== k;
  $('nsHeadline').textContent = categories().find(([x]) => x === k)[1];
  if (k === 'scheduled') showScheduled();
}
export function openSettings(category) {
  close(); $('nsWindow').classList.add('on'); showCategory(category || readLS(CATEGORY_KEY)); drawControls(); loadSaving(); loadNames(); loadScribe(); loadSleep();
}
export function closeWindow() { $('nsWindow')?.classList.remove('on'); }

const close = () => { $('setUi').classList.remove('on'); $('setBtn').setAttribute('aria-expanded', 'false'); };

// Larger font (v19, 2026-11-18): class largerFont on body, set already by an inline script in index.html (without a flash).
const FONT_KEY = 'city-larger-font';
function initFont() {
  const b = $('fontBtn'); if (!b) return;
  const draw = () => { const on = document.body.classList.contains('largerFont'); b.textContent = on ? t('app.settings.on') : t('app.settings.off'); b.classList.toggle('on', on); };
  b.onclick = () => { const on = document.body.classList.toggle('largerFont'); saveLS(FONT_KEY, on ? '1' : '0'); draw(); };
  draw();
}

// Shortcuts (v19): the keyboard shortcut row at the bottom is hidden, shown by the ? key or a menu item (body.napovedaOn).
const isField = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
function toggleShortcuts() { const on = document.body.classList.toggle('hintOn'); $('shortcutsBtn').textContent = on ? t('app.settings.hide') : '?'; }
function initShortcuts() {
  $('shortcutsBtn').onclick = toggleShortcuts;
  addEventListener('keydown', (e) => { // ? (Shift+/ or Shift+, depending on the layout) is not otherwise used in the app; nothing in a text field and with ⌘/Ctrl/Alt
    if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented || isField(document.activeElement) || document.querySelector('#palette.on, #nsWindow.on')) return;
    toggleShortcuts();
  });
}

// Layers (2026-11-18): "Original city" rebuilds the city and the open floor (navigation.js setSkin), "Rotate the city" only in Layers mode.
// Cost: zero for 3D, the city is rebuilt only on switching.
function initLayers() {
  const bp = $('originalBtn'), bo = $('rotationBtn'); if (!bp || !bo) return;
  const row = (nm) => document.querySelector(`#nsWindow .nsR[data-nm="${nm}"]`) || {};
  const draw = () => {
    const pov = originalCity(), ot = rotationEnabled();
    bp.textContent = pov ? t('app.settings.on') : t('app.settings.off'); bp.classList.toggle('on', pov);
    bo.textContent = ot ? t('app.settings.on') : t('app.settings.off'); bo.classList.toggle('on', ot);
    row('rotation').hidden = pov; // only the city from the layers rotates
    row('speed').hidden = pov || !ot; // speed only when rotation is on
  };
  bp.onclick = () => { saveLS(ORIGINAL_KEY, originalCity() ? '0' : '1'); draw(); setSkin(); };
  bo.onclick = () => { saveLS(ROTATION_KEY, rotationEnabled() ? '0' : '1'); draw(); dispatchEvent(new Event('city-rotation')); };
  draw();
}

export function initSettings() {
  buildWindow(); // first: moves the controls from the stock into the window rows (initLayers then hides the rows)
  initFont(); initShortcuts(); initLayers();
  const ui = $('setUi');
  $('setBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('toolsUi').classList.remove('on'); $('toolsBtn').setAttribute('aria-expanded', 'false'); // only one menu in the bar at a time
    const on = ui.classList.toggle('on'); $('setBtn').setAttribute('aria-expanded', String(on));
  });
  $('setMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    const r = e.target.closest('.nmR'); if (!r) return;
    const tl = r.querySelector('button');
    if (tl && !e.target.closest('button')) tl.click();
    if (['taskOffice', 'shortcuts', 'lock'].includes(r.dataset.nm)) close();
    if (r.dataset.nm === 'settings') openSettings();
  });
  // Workroom (2026-11-20): the top bar is hidden in it, so the ⋯ menu moves directly into body (CSS puts it in the right corner of the Workroom header,
  // above the chat panel; inside #workroom it would be under it) and back into the bar on leaving; the id and handling stay.
  const atHome = document.createComment('setUi');
  ui.before(atHome);
  addEventListener('city-workroom', () => {
    close();
    if (document.body.classList.contains('workroom')) document.body.append(ui); else atHome.after(ui);
  });
  addEventListener('click', (e) => { if (ui.classList.contains('on') && !ui.contains(e.target)) close(); });
  addEventListener('keydown', (e) => {
    if (e.key === ',' && (e.metaKey || e.ctrlKey) && !e.altKey) { e.preventDefault(); e.stopPropagation(); return $('nsWindow').classList.contains('on') ? closeWindow() : openSettings(); }
    if (e.key !== 'Escape') return;
    if ($('nsWindow').classList.contains('on')) { e.stopPropagation(); e.preventDefault(); closeWindow(); }
    else if (ui.classList.contains('on')) { e.stopPropagation(); close(); }
  }, true);
}
