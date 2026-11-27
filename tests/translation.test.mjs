// Server translations (i18n.js, i18n/en.js, i18n/sk.js): same keys and placeholders, English without Slovak diacritics,
// t() behaviour and a check that t('key', { … }) calls in the sources supply exactly the placeholders of the text. No server, independent of the date.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.AGENTIC_LANG;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: en } = await import(new URL('../server/i18n/en.js', import.meta.url));
const { default: sk } = await import(new URL('../server/i18n/sk.js', import.meta.url));
const { t, language, setLanguage } = await import(new URL('../server/i18n.js', import.meta.url));

const keysEn = Object.keys(en).sort(), keysSk = Object.keys(sk).sort();
assert.deepEqual(keysEn, keysSk, 'en and sk have the same keys');
assert.ok(keysEn.length > 100);
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const diacritics = /[áäčďéíľĺňóôŕšťúýžÁÄČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ]/;
for (const k of keysEn) {
  assert.match(k, /^(server|prompt)\./, `key ${k} has the prefix server. or prompt.`);
  assert.equal(typeof en[k], 'string', k); assert.equal(typeof sk[k], 'string', k);
  assert.equal(placeholders(en[k]), placeholders(sk[k]), `same placeholders in ${k}`);
  assert.equal(en[k].match(/^\s*/)[0], sk[k].match(/^\s*/)[0], `same leading spaces and newlines in ${k}`);
  assert.equal(en[k].match(/\s*$/)[0], sk[k].match(/\s*$/)[0], `same trailing spaces and newlines in ${k}`);
  assert.ok(!diacritics.test(en[k]), `en value ${k} without Slovak diacritics: ${(en[k].match(diacritics) || [])[0]}`);
}

// t(): language, missing key, params
assert.equal(language(), 'en', 'default language is en');
assert.equal(t('server.missing.key'), 'server.missing.key', 'missing key → the key itself');
assert.equal(t('server.missing.key', { a: 1 }), 'server.missing.key');
assert.equal(t('prompt.userName', { name: 'Ada' }), 'the user (Ada)');
assert.equal(t('prompt.userName'), 'the user ({name})', 'missing param stays as a placeholder');
assert.equal(setLanguage('sk'), 'sk'); assert.equal(language(), 'sk');
assert.equal(t('prompt.userName', { name: 'Ada' }), 'používateľ (Ada)');
assert.equal(setLanguage('xx'), 'en', 'invalid language = en');
process.env.AGENTIC_LANG = 'sk';
assert.equal(language(), 'sk', 'AGENTIC_LANG takes precedence'); assert.equal(setLanguage('en'), 'sk');
assert.equal(t('prompt.user'), 'používateľ');
delete process.env.AGENTIC_LANG;
setLanguage('en');
// a key missing in sk falls back to en
const skKey = 'server.test.only.en'; en[skKey] = 'only en';
setLanguage('sk'); assert.equal(t(skKey), 'only en'); setLanguage('en'); delete en[skKey];

// static check of calls: t('key', { a, b: expr }) supplies exactly the placeholders of the text, every used key exists
const FILES = ['server.js', ...['agents.js', 'build-world.js', 'floor-admin.js', 'virtual-floors.js', 'control-center.js', 'router.js', 'dispatch.js', 'modules.js', 'scribe.js', 'chronicler-night.js', 'scheduler.js', 'agent-runs.js', 'extras.js', 'os-notifications.js', 'notifications.js', 'sleep.js', 'usage.js', 'usage-sessions.js', 'files.js', 'lock.js'].map((f) => 'server/' + f)];
function balanced(s, i) { // from '{' returns the index after the matching '}'
  let d = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "'" || c === '"' || c === '`') { const q = c; j++; while (j < s.length && s[j] !== q) { if (s[j] === '\\') j++; j++; } continue; }
    if (c === '{') d++; else if (c === '}' && --d === 0) return j + 1;
  }
  return -1;
}
function keysObject(o) { // top-level keys of an object { a, b: expr, c }
  const out = []; let d = 0, cur = '';
  const body = o.slice(1, -1);
  for (let j = 0; j <= body.length; j++) {
    const c = body[j];
    if (c === "'" || c === '"' || c === '`') { const q = c; cur += c; j++; while (j < body.length && body[j] !== q) { if (body[j] === '\\') { cur += body[j]; j++; } cur += body[j]; j++; } cur += q; continue; }
    if ('({['.includes(c)) d++; if (')}]'.includes(c)) d--;
    if ((c === ',' && d === 0) || j === body.length) { const m = cur.trim().match(/^([\w$]+)/); if (m) out.push(m[1]); cur = ''; continue; }
    cur += c;
  }
  return out.sort().join(',');
}
let calls = 0;
for (const f of FILES) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of s.matchAll(/\b(?:tl|t)\('((?:server|prompt)\.[\w.]+)'/g)) {
    const key = m[1]; calls++;
    assert.ok(key in sk, `${f}: unknown key ${key}`);
    const po = m.index + m[0].length;
    let param = '';
    const rest = s.slice(po).match(/^\s*,\s*\{/);
    if (rest) { const from = po + rest[0].length - 1; const end = balanced(s, from); param = keysObject(s.slice(from, end)); }
    assert.equal(param, placeholders(sk[key]), `${f}: call ${key} supplies ${param || '(none)'}, the text wants ${placeholders(sk[key]) || '(none)'}`);
  }
}
assert.ok(calls > 150, 't() calls were found');

console.log('OK', keysEn.length, 'keys,', calls, 'calls');
