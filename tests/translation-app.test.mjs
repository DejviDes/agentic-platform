// App translation test: en and sk have the same keys and placeholders {…}, en values without Slovak diacritics, keys with the app. prefix (no browser, independent of the date)
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = async (j) => (await import(pathToFileURL(resolve(root, 'public/app/i18n', `${j}.js`)))).default;
const en = await load('en'), sk = await load('sk');
const placeholders = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',');
const DIACRITICS = /[áäčďéíĺľňóôŕšťúýžÁÄČĎÉÍĽŇÓÔŔŠŤÚÝŽ]/;
const ALLOWED_EN = new Set(['app.settings.v.language.sk']); // language name Slovenčina

const kEn = Object.keys(en), kSk = Object.keys(sk);
assert.ok(kEn.length > 500, `too few keys (${kEn.length})`);
assert.deepEqual(kEn.filter((k) => !(k in sk)), [], 'keys in en missing in sk');
assert.deepEqual(kSk.filter((k) => !(k in en) && !(k.endsWith('.few') && k.slice(0, -4) + '.other' in en)), [], 'keys in sk missing in en');
assert.deepEqual(kEn.filter((k) => !k.startsWith('app.')), [], 'keys without the app. prefix');
assert.deepEqual(kEn.filter((k) => placeholders(en[k]) !== placeholders(sk[k])), [], 'different placeholders {…}');
assert.deepEqual(kEn.filter((k) => typeof en[k] !== 'string' || typeof sk[k] !== 'string'), [], 'value is not a string');
assert.deepEqual(kEn.filter((k) => DIACRITICS.test(en[k]) && !ALLOWED_EN.has(k)), [], 'Slovak diacritics in en');
// plurals: x.one requires x.other
for (const k of kEn) if (k.endsWith('.one')) assert.ok(`${k.slice(0, -4)}.other` in en, `missing .other for ${k}`);
console.log(`translation-app: ${kEn.length} keys, en = sk, OK`);
