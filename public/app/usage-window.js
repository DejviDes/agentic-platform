// Limit usage window (2026-11-19): which session ate how much of the 5-hour and weekly limit, also sessions from the Claude app.
// It opens by clicking the limits ring in the bar (or "Details" in its tooltip). The data is computed by the server (usage-sessions.js,
// GET /api/limits/breakdown?window=h5|week) from transcripts in ~/.claude/projects, here it is only displayed. Refresh every 30 s while the window is open.
import { $, esc, ago } from './utils.js';
import { CONV_STORE, isReal } from './api.js';
import { ico } from './icons.js';
import { openConvWhere } from './command-palette.js';
import { t as T, tn, locale } from './i18n.js';

const S = { on: false, window: 'h5', d: {}, error: '', timer: 0, all: false };
const fmt = (p) => (p >= 10 ? Math.round(p) : p >= 0.1 ? p.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '< ' + (0.1).toLocaleString(locale()));
const color = (p) => (p >= 90 ? 'err' : p >= 75 ? 'warn' : 'ok');
const SOURCE_COLOR = { City: 'var(--accent)', 'Claude app': 'var(--warn)', Terminal: 'var(--ok)', 'Mesto': 'var(--accent)', 'Claude appka': 'var(--warn)', 'Terminál': 'var(--ok)' }; // source labels come translated from the server (en, sk)

async function load() {
  const o = S.window;
  try {
    const r = await fetch('/api/limits/breakdown?window=' + o, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || (r.status === 404 ? T('app.usage.breakdownUnknown') : T('app.source.serverReturned', { s: r.status })));
    S.d[o] = d; S.error = '';
  } catch (e) { S.error = e.message; }
  draw();
}

export function openUsage(window) {
  if (!isReal()) return;
  if (window === 'h5' || window === 'week') S.window = window;
  let el = $('usagePan');
  if (!el) {
    el = document.createElement('div'); el.id = 'usagePan';
    el.addEventListener('click', click);
    document.body.appendChild(el);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.on) { e.stopPropagation(); close(); } }, true);
  }
  S.on = true; S.all = false; el.classList.add('on'); draw(); load();
  clearInterval(S.timer); S.timer = setInterval(() => { if (S.on && !document.hidden) load(); }, 30000);
}
function close() { S.on = false; clearInterval(S.timer); $('usagePan')?.classList.remove('on'); }

function click(e) {
  if (e.target.id === 'usagePan') return close();
  const t = e.target.closest('[data-sp]'); if (!t) return;
  const a = t.dataset.sp;
  if (a === 'close') return close();
  if (a === 'h5' || a === 'week') { S.window = a; S.all = false; draw(); return load(); }
  if (a === 'all') { S.all = true; return draw(); }
  if (a === 'conv') { const k = CONV_STORE.conv.get(t.dataset.id); if (k) { close(); openConvWhere(k); } }
}

const whenReset = (ms) => {
  const z = ms - Date.now(); if (!ms) return ''; if (z <= 0) return T('app.usage.refreshing');
  return z < 24 * 3600e3 ? T('app.usage.refreshesO', { h: Math.floor(z / 3600e3), m: Math.floor(z / 60e3) % 60 }) : T('app.usage.refreshes', { when: new Date(ms).toLocaleString(locale(), { weekday: 'long', hour: '2-digit', minute: '2-digit' }) });
};

function draw() {
  const el = $('usagePan'); if (!el || !S.on) return;
  const d = S.d[S.window], tab = (k, n) => `<button class="btn${S.window === k ? ' on' : ''}" data-sp="${k}">${n}</button>`;
  let h = `<div class="spWindow slWindow" role="dialog" aria-label="${T('app.usage.headline')}"><div class="spHl"><b>${T('app.usage.headline')}</b><span class="slTabs">${tab('h5', T('app.usage.h5'))}${tab('week', T('app.usage.tyzden'))}</span><button class="btn" data-sp="close" aria-label="${T('app.usage.close')}">${ico('x')}</button></div><div class="slBody">`;
  if (S.error) h += `<div class="note" style="color:var(--warn)">${ico('warning')} ${esc(S.error)}</div>`;
  if (!d) { el.innerHTML = h + `<div class="slEmpty">${T('app.usage.counting')}</div></div></div>`; return; }

  // summary: a big percentage and a bar split by source (City, Claude app, outside transcripts)
  const parts = [...d.sources.map((z) => ({ n: z.source, p: z.p, c: SOURCE_COLOR[z.source] || 'var(--muted)' })), ...(d.outside > 0.05 ? [{ n: T('app.usage.outside'), p: d.outside, c: 'var(--line)' }] : [])];
  h += `<div class="slSummary"><div class="slSize ${color(d.p)}">${d.p} %</div><div class="slSummaryT"><b>${S.window === 'week' ? T('app.usage.weekLimit') : T('app.usage.h5Limit')}</b><span>${whenReset(d.reset)} · ${T('app.usage.windowFrom')} ${new Date(d.from).toLocaleString(locale(), S.window === 'week' ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' })}</span></div></div>
    <div class="slStrip">${parts.map((c) => `<i style="width:${Math.max(0.5, c.p)}%;background:${c.c}" title="${esc(c.n)}: ${fmt(c.p)} %"></i>`).join('')}</div>
    <div class="slLeg">${parts.map((c) => `<span><i style="background:${c.c}"></i>${esc(c.n)} <b>${fmt(c.p)} %</b></span>`).join('')}</div>`;

  const items = d.sessions || [], max = Math.max(...items.map((s) => s.p), 0.1), show = S.all ? items : items.slice(0, 12);
  if (!items.length) h += `<div class="slEmpty">${T('app.usage.none')}</div>`;
  h += '<div class="slItems">';
  for (const s of show) {
    const k = s.conv && CONV_STORE.conv.get(s.conv), models = s.models.map((m) => (s.models.length > 1 ? `${m.m} ${m.share} %` : m.m)).join(' + ');
    h += `<div class="slR${k ? ' click' : ''}"${k ? ` data-sp="conv" data-id="${esc(s.conv)}" title="${T('app.usage.open')}"` : ''}>
      <div class="slN"><b>${esc(s.title)}</b><small><span class="slSource" style="--c:${SOURCE_COLOR[s.source] || 'var(--muted)'}">${esc(s.source)}</span>${s.where ? ' · ' + esc(s.where) : ''} · ${ago(s.last)}${models ? ' · ' + esc(models) : ''}</small></div>
      <div class="slP"><b>${fmt(s.p)} %</b><span class="slMini"><i style="width:${(s.p / max) * 100}%"></i></span></div></div>`;
  }
  h += '</div>';
  if (!S.all && items.length > show.length) { const zv = items.slice(show.length); h += `<button class="btn slMore" data-sp="all">${tn('app.usage.more', zv.length, { total: fmt(zv.reduce((a, s) => a + s.p, 0)) })}</button>`; }
  const method = T('app.usage.method');
  h += `<div class="note slNote">${method} ${T('app.usage.note')}</div></div></div>`;
  el.innerHTML = h;
}
