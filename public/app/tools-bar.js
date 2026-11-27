// tools-bar.js – Bar of connected tools in the header (2026-11-11). Demo: all icons from tool-icons.js and simulated lighting up.
// Real mode: only tools from GET /api/tools (Claude Code MCP servers, state ok / auth / error), refreshed once per 15 min
// only while the app is visible. An icon lights up for 3 s on SSE { kind: 'nastroj', id, floor, conv } (api.js → emit).
// Without the endpoint (404, old server) the original bar stays without simulation. Cost: none in the render loop (CSS class + timeout).
// v19 (2026-11-18): one gray icon #toolsBtn with a dropdown #toolsMenu (row = app + state), a dot on the icon when an agent is using the app right now.
import { $, esc } from './utils.js';
import { calendarIcon, TOOLS } from './tool-icons.js';
import { ico as icoSvg } from './icons.js';
import { simTime } from './daylight.js';
import { WORLD } from './world.js';
import { agentIndex, CONV_STORE, isReal } from './api.js';
import { t } from './i18n.js';

// id from the server (MCP server name from `claude mcp list`) → icon key in TOOLS (others get a neutral label with an abbreviation).
// Connectors in state 'auth' (unconnected claude.ai connectors, most of them) are not drawn in the bar, they are only in the tooltip of the Connected label.
const MAP = { notion: 'notion', github: 'github', figma: 'figma', 'figma-desktop': 'figma', supabase: 'supabase', 'google-calendar': 'calendar', 'kalendar': 'calendar', calendar: 'calendar', playwright: 'chrome', chrome: 'chrome', 'apple-notes': 'notes', 'poznamky': 'notes' };
const STATUS_TEXT = { auth: 'app.tools.status.auth', error: 'app.tools.status.error' }; // translation keys (translated at draw time)
const statusText = (status) => t(STATUS_TEXT[status] || 'app.tools.status.ok');
const NST = { when: 0, loading: false, list: null, attempts: 0 };

const iconFor = (id) => TOOLS.find((x) => x.k === (MAP[id] || id));
// Tools without an icon from one family = one tile (UX audit wave 1: "CD CD Me GS GS GD" didn't say what is what).
const GROUPS = { google: { symbol: 'G', bg: '#4a7fd6', name: 'Google', rest: /^google\s+/i }, claude: { symbol: '', icon: 'spark', bg: '#c4693f', name: 'Claude', rest: /^claude\s+/i } };
const group = (id) => (/^(google-(?!calendar)|gmail$)/.test(id) ? 'google' : /^(claude-|meetings$)/.test(id) ? 'claude' : null);
const key = (id) => MAP[id] || group(id) || id;
const shortcut = (s) => { const c = String(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' '); return (c.length > 1 ? c[0][0] + c[1][0] : c[0].slice(0, 2)).replace(/^./, (x) => x.toUpperCase()); };
const iconHtml = (ico, title) => (ico ? (ico.k === 'calendar' ? calendarIcon() : ico.svg) : esc(shortcut(title)));
// menu row: colored icon (id nst-<key>, lighting up applies to it), name and state; lightUp() changes only the state text
function tile(id, title, status, ico) {
  const st = statusText(status);
  return `<div class="nstR ${STATUS_TEXT[status] ? 'muted' : ''}"><span class="nst ${ico?.whole ? 'whole' : ''} ${ico ? '' : 'badge'}" id="nst-${esc(id)}" style="background:${ico ? ico.bg : '#6f6d66'}">${iconHtml(ico, title)}</span><span class="nN">${esc(title)}</span><span class="nS" data-zak="${esc(st)}">${esc(st)}</span></div>`;
}
function tileGroups(g) {
  const S = GROUPS[g.sk], st = statusText(g.status);
  return `<div class="nstR ${STATUS_TEXT[g.status] ? 'muted' : ''}" title="${esc(g.parts.join(', '))}"><span class="nst badge grp" id="nst-${esc(g.id)}" style="background:${S.bg}">${S.icon ? icoSvg(S.icon) : S.symbol}</span><span class="nN">${esc(S.name)} <em>${g.parts.length}</em></span><span class="nS" data-zak="${esc(st)}">${esc(st)}</span></div>`;
}
function drawDemo() { $('tools').innerHTML = TOOLS.map((x) => tile(x.k, x.n, 'ok', x)).join(''); }
function drawReal(items) {
  const pol = new Map(), auth = [], better = { ok: 0, error: 1 };
  for (const x of items) {
    if (!x?.id || x.id === 'agentic') continue;
    if (x.status === 'auth') { auth.push(x.title || x.id); continue; }
    const ico = iconFor(x.id), sk = !ico && group(x.id), id = ico ? ico.k : sk || x.id, b = pol.get(id); // playwright and chrome, figma and figma-desktop = one icon
    if (sk) { const S = GROUPS[sk], cast = String(x.title || x.id).replace(S.rest, ''); const g = b || { id, sk, status: x.status, parts: [] }; g.parts.push(cast); if ((better[x.status] ?? 2) < (better[g.status] ?? 2)) g.status = x.status; pol.set(id, g); continue; }
    if (!b || (better[x.status] ?? 2) < (better[b.status] ?? 2)) pol.set(id, { ...x, id, ico });
  }
  const list = [...pol.values()].sort((a, b) => (a.status === 'ok' ? 0 : 1) - (b.status === 'ok' ? 0 : 1) || (a.ico ? 0 : 1) - (b.ico ? 0 : 1));
  $('tools').innerHTML = list.map((x) => x.sk ? tileGroups(x) : tile(x.id, x.title || x.id, x.status, x.ico)).join('');
  $('toolsNep').textContent = auth.length ? t('app.tools.disconnected', { list: auth.join(', ') }) : '';
  $('toolsUi').style.display = list.length || auth.length ? '' : 'none';
  $('toolsBtn').title = t('app.tools.caption', { n: list.filter((x) => x.status === 'ok').length, z: list.length }) + (auth.length ? t('app.tools.more', { n: auth.length }) : '');
}
function load() {
  if (NST.loading) return; NST.loading = true;
  fetch('/api/tools', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((d) => {
    NST.loading = false; NST.when = Date.now();
    if (!Array.isArray(d.tools)) return;
    if (d.loading && !d.tools.length && NST.attempts++ < 6) { NST.when = 0; setTimeout(load, 20000); return; } // the server is still determining the MCP state
    NST.list = d.tools; drawReal(d.tools);
  }).catch(() => { NST.loading = false; NST.when = Date.now(); }); // old server without the endpoint: the original bar stays
}
function lightUp(id, ms, tip) {
  const el = $('nst-' + key(id)); if (!el) return;
  const nS = el.parentElement.querySelector('.nS'), ui = $('toolsUi');
  if (tip && nS) nS.textContent = tip;
  el.classList.add('isOn'); ui.classList.add('isOn'); clearTimeout(el.t);
  el.t = setTimeout(() => { el.classList.remove('isOn'); if (nS) nS.textContent = nS.dataset.zak; if (!$('tools').querySelector('.isOn')) ui.classList.remove('isOn'); }, ms);
}

// called by WORLD.pocuvaj in panel.js. Simulated events (world.js) don't light up in real mode, only those from the server (d.skut).
export function onTool(d) {
  if (!isReal()) return lightUp(d.k, 1600);
  if (!d.real) return;
  const k = d.conv && CONV_STORE.conv.get(d.conv), P = d.n && WORLD.floors.get(d.n), i = k && P ? agentIndex(P, k.agent) : null;
  const who = (i != null && P.agents[i]?.name) || (k?.agent === 'lead' ? t('app.tools.lead') : k?.agent) || t('app.tools.agent');
  lightUp(d.k, 3000, d.n ? t('app.tools.usesOn', { who, n: d.n }) : t('app.tools.uses', { who }));
}

export function initTools() {
  const ui = $('toolsUi'), tl = $('toolsBtn'), close = () => { ui.classList.remove('on'); tl.setAttribute('aria-expanded', 'false'); };
  tl.addEventListener('click', (e) => {
    e.stopPropagation(); $('setUi').classList.remove('on'); $('setBtn').setAttribute('aria-expanded', 'false'); // only one menu at a time in the bar
    tl.setAttribute('aria-expanded', String(ui.classList.toggle('on')));
  });
  $('toolsMenu').addEventListener('click', (e) => e.stopPropagation());
  addEventListener('click', (e) => { if (ui.classList.contains('on') && !ui.contains(e.target)) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.classList.contains('on')) { e.stopPropagation(); close(); } }, true);
  drawDemo();
  let calendarDay = simTime().getDate();
  setInterval(() => { const d = simTime().getDate(); if (d !== calendarDay) { calendarDay = d; const el = $('nst-calendar'); if (el) el.innerHTML = calendarIcon(); } }, 60000); // new day = new number
  if (!isReal()) return;
  load();
  const attempt = () => { if (!document.hidden && Date.now() - NST.when > 15 * 60e3) load(); };
  setInterval(attempt, 60e3); document.addEventListener('visibilitychange', attempt);
}
