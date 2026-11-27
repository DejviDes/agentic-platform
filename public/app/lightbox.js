
import { ico } from './icons.js';
import { t } from './i18n.js';
// Image viewer (lightbox): a click on a screenshot in a bubble or on a preview in the field
// opens the image in the middle of the screen instead of a new tab. ←/→ switches within a message,
// Esc or a click aside closes, a click on the image toggles "fit to screen" / actual size.
// ⌘/Ctrl + click on a screenshot in a bubble opens a new tab the old way.

let el = null, items = [], idx = 0;

function createEl() {
  el = document.createElement('div');
  el.id = 'preview';
  el.innerHTML = `<div class="nhTopbar"><span class="nhCount mono"></span><a class="nhNew" target="_blank" rel="noopener" title="${t('app.preview.newCard')}">${ico('out')}</a><button class="nhX" title="${t('app.preview.close')}">×</button></div>
    <button class="nhSip nhL" title="${t('app.preview.previous')}">‹</button><div class="nhSurface"><img alt=""></div><button class="nhSip nhP" title="${t('app.preview.next')}">›</button>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    if (e.target.closest('.nhX')) return close();
    if (e.target.closest('.nhL')) return shift(-1);
    if (e.target.closest('.nhP')) return shift(1);
    if (e.target.tagName === 'IMG') { el.classList.toggle('full'); return; }
    if (!e.target.closest('.nhTopbar, .nhNew')) close();
  });
}

function draw() {
  const u = items[idx], img = el.querySelector('img');
  el.classList.remove('full');
  img.src = u;
  el.querySelector('.nhCount').textContent = items.length > 1 ? `${idx + 1} / ${items.length}` : '';
  const create = el.querySelector('.nhNew');
  create.hidden = !u.startsWith('/'); // data:/blob: addresses (not yet sent) the browser does not open in a new tab
  create.href = u;
  el.classList.toggle('more', items.length > 1);
}

export function openPreview(urls, i = 0) {
  if (!urls?.length) return;
  if (!el) createEl();
  items = urls; idx = Math.max(0, Math.min(i, urls.length - 1));
  draw();
  el.classList.add('on');
}
function close() { el?.classList.remove('on'); if (el) el.querySelector('img').removeAttribute('src'); }
function shift(d) { if (items.length < 2) return; idx = (idx + d + items.length) % items.length; draw(); }

// click on images (delegated, bubbles are redrawn)
document.addEventListener('click', (e) => {
  const a = e.target.closest('.msg .convImage a');
  if (a) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const all = [...a.closest('.convImage').querySelectorAll('a')];
    openPreview(all.map((x) => x.getAttribute('href')), all.indexOf(a));
    return;
  }
  const img = e.target.closest('#agImage .imageN img');
  if (img) {
    const all = [...document.querySelectorAll('#agImage .imageN img')];
    openPreview(all.map((x) => x.getAttribute('src')), all.indexOf(img));
  }
});

// keys take precedence over the others (Esc otherwise closes the conversation)
window.addEventListener('keydown', (e) => {
  if (!el?.classList.contains('on')) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowLeft') shift(-1);
  else if (e.key === 'ArrowRight') shift(1);
  else return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
