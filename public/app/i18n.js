// i18n.js – App translations (en by default, sk if chosen). No imports of other app modules (modules import each other in a circle).
// The only exception to "only declarations at top level": top-level await loads the dictionary, so t() also works in constants of other modules.
// Language: localStorage `agentic-language` (only when the server API /api/language does not exist yet) > `language` from the server (cache `agentic-language-cache`) > 'en'.
// Keys only with the prefix `app.`; the dictionaries i18n/en.js and i18n/sk.js are composed of partial files i18n/en-<group>.js and sk-<group>.js.
const LOCALES = { en: 'en-GB', sk: 'sk-SK' };
const quote = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const valid = (j) => (j === 'en' || j === 'sk' ? j : null);
let current = valid(quote('agentic-language')) || valid(quote('agentic-language-cache')) || 'en';
let DICTIONARY = {}, BACKUP = {};
const load = async (j) => (await import(`./i18n/${j}.js`)).default;
const MODULES = []; // dictionaries of optional modules (addDictionary), added again after another language is loaded
const completeModule = (d) => { Object.assign(BACKUP, d.en || {}); if (DICTIONARY !== BACKUP) Object.assign(DICTIONARY, d[current] || {}); };
const loadAll = async (j) => { BACKUP = { ...(await load('en')) }; DICTIONARY = j === 'en' ? BACKUP : { ...(await load(j)) }; MODULES.forEach(completeModule); document.documentElement.lang = j; };
await loadAll(current);

export const language = () => current;
// Dictionary of an optional module (Home, Mail): the module registers it on load, the core does not know about it and runs without it.
// addDictionary({ en: { 'app.domov.…': '…' }, sk: { … } }); call before the first t() with module keys.
export function addDictionary(d = {}) { MODULES.push(d); completeModule(d); }
export const locale = () => LOCALES[current]; // for Intl and toLocaleString
const fill = (s, p) => s.replace(/\{(\w+)\}/g, (m, k) => (k in p ? String(p[k]) : m));
export function t(key, params = {}) { const s = DICTIONARY[key] ?? BACKUP[key]; return s === undefined ? key : fill(s, params); }
// Plurals: key `x.one` / `x.few` / `x.other` (en only one/other, sk 1 / 2 to 4 / others); {n} is always available.
export function tn(key, n, params = {}) {
  const f = current === 'sk' ? (n === 1 ? 'one' : n >= 2 && n <= 4 ? 'few' : 'other') : (n === 1 ? 'one' : 'other');
  const k = [`${key}.${f}`, `${key}.other`].find((x) => DICTIONARY[x] !== undefined || BACKUP[x] !== undefined) || key;
  return t(k, { n, ...params });
}
// Static texts in HTML: data-i18n (textContent), data-i18n-title, data-i18n-aria (aria-label), data-i18n-placeholder; the English fallback stays in HTML.
export function translateDom(root = document) {
  for (const [attr, target] of [['data-i18n', null], ['data-i18n-title', 'title'], ['data-i18n-aria', 'aria-label'], ['data-i18n-placeholder', 'placeholder']]) {
    for (const el of root.querySelectorAll(`[${attr}]`)) { const s = t(el.getAttribute(attr)); if (target) el.setAttribute(target, s); else el.textContent = s; }
  }
}
// serverLanguage: the `language` field from /api/world (undefined = older server). Called by main.js after the world loads, before the first render.
export async function initLanguage(serverLanguage) {
  const local = valid(quote('agentic-language')), zo = valid(serverLanguage);
  // the server knows the language (has /api/language) → its value applies; the local choice is only a substitute for an older server (e.g. from a test in /nahlad/) and is cleared
  const wants = zo || local || current;
  if (zo) { try { localStorage.setItem('agentic-language-cache', zo); localStorage.removeItem('agentic-language'); } catch {} }
  if (wants !== current) { // the server has a different language than was loaded at start: modules have already been evaluated, hence a single reload
    if (!sessionStorage.getItem('city-language-reload')) { sessionStorage.setItem('city-language-reload', '1'); location.reload(); await new Promise(() => {}); }
    current = wants; await loadAll(wants);
  }
  sessionStorage.removeItem('city-language-reload');
  translateDom();
}
export async function changeLanguage(j) {
  if (!valid(j)) return;
  let ok = false;
  try { const r = await fetch('/api/language', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: j }) }); ok = r.ok; if (!r.ok && r.status !== 404) return; } catch { return; }
  try { if (ok) { localStorage.removeItem('agentic-language'); localStorage.setItem('agentic-language-cache', j); } else localStorage.setItem('agentic-language', j); } catch {}
  location.reload();
}
