// topbar.js – Top bar v19 (2026-11-18): "Search ⌘K" and "waiting for you N" (only when N > 0). Breadcrumbs are drawn by panel.js (setCrumbs),
// connected apps by tools-bar.js, limits by conversations.js (drawLimits), the ⋯ menu by settings.js.
// "Waiting" = conversations waiting for approval or for your reply (the same definition as the "Waiting for you" group in the Workroom).
// Cost in performance: zero for 3D; on the 'change' event the conversations array (hundreds of items) is walked and the DOM is written only when the number changes.
import { $ } from './utils.js';
import { t } from './i18n.js';
import { CONV_STORE, floorCount, isReal } from './api.js';
import { openPalette } from './command-palette.js';
import { openWorkroom } from './workroom.js';
import { openConv } from './conversations.js';
import { enterFloor } from './navigation.js';
import { M } from './modules.js';

const L = { n: -1, first: null };

function count() {
  let n = 0, first = null;
  for (const k of CONV_STORE.conv.values()) {
    if (k.hidden || (k.status !== 'pending' && k.status !== 'reply') || (k.parent && k.status !== 'pending')) continue;
    n++; if (!first || (k.changed || 0) > (first.changed || 0)) first = k;
  }
  return { n, first };
}

export function refreshPending() {
  const b = $('pendingBtn'); if (!b) return;
  const { n, first } = isReal() ? count() : { n: 0, first: null };
  L.first = first;
  if (n === L.n) return; L.n = n;
  b.hidden = n === 0;
  b.textContent = t('app.topbar.pending', { n });
  b.title = n === 1 ? t('app.topbar.opensConv', { title: first?.title || '' }) : t('app.topbar.opensWorkroom');
}

// one waiting = straight to its thread (like a row in the Overview), more = Workroom
async function openPending() {
  const k = L.n === 1 ? L.first : null;
  if (!k) return openWorkroom();
  const dk = String(k.floor || '').startsWith('home/') ? k.floor.slice(5) : null;
  if (dk) return M.home?.openHomeChat(dk, { id: k.id }); // thread in the Home building chat
  const n = floorCount(k.floor); if (!n) return openWorkroom();
  await enterFloor(n); openConv(k.id);
}

export function initTopbar() {
  $('searchBtn').onclick = () => openPalette();
  $('pendingBtn').onclick = () => { openPending(); };
  CONV_STORE.listen.add((type) => { if (type === 'change') refreshPending(); });
  refreshPending();
}
