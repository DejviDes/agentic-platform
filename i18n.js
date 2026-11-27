// i18n.js – server translations (language of the City). The default language is 'en', a Slovak City has 'sk' (world.json key `language`).
// The environment variable AGENTIC_LANG ('en' | 'sk') takes precedence over world.json (for tests). Texts are in i18n/en.js and i18n/sk.js,
// keys `server.…` (messages, errors, cards, tool descriptions) and `prompt.…` (system prompts and instructions for agents).
// The module must not import other server modules (modules import each other in a cycle).
import en from './i18n/en.js';
import sk from './i18n/sk.js';

const LANGUAGES = { en, sk };
const valid = (j) => (j === 'sk' || j === 'en' ? j : null);
let current = 'en';

export function language() { return valid(process.env.AGENTIC_LANG) || current; }

// sets the language from world.json; an invalid value stays 'en'. Returns the valid language (taking AGENTIC_LANG into account).
export function setLanguage(j) {
  current = valid(j) || 'en';
  return language();
}

// Dictionary of an optional module (Home, Mail, mobile): the module registers it itself on load, the core does not know it and runs without it.
// addDictionary({ en: { 'server.home.…': '…' }, sk: { … } }); module keys have their own prefix (server.<module>., prompt.<module>.).
export function addDictionary(d = {}) { Object.assign(en, d.en || {}); Object.assign(sk, d.sk || {}); }

// t('server.key', { name }) → text in the current language, {name} is replaced from params. Missing key: en, then the key itself.
export function t(key, params = {}) {
  let text = LANGUAGES[language()]?.[key];
  if (text === undefined) text = en[key];
  if (text === undefined) return key;
  return text.replace(/\{(\w+)\}/g, (m, k) => (params && params[k] !== undefined ? String(params[k]) : m));
}
