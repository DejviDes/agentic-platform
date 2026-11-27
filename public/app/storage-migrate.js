// storage-migrate.js – one-time move of browser storage keys renamed to English (step 3 Agentic Platform, 2026-11-27).
// Classic script, not a module: index.html loads it before every other script, so all later reads (also top-level ones
// in modules and the inline font script) already see the new keys. For every old key the value is copied to the new key
// (the old value wins, it is newer than a copy from the preview) and the old key is removed. In the preview (/nahlad/, /preview/),
// which shares the origin with production, old keys are only copied to missing new keys and kept, so the production app keeps its settings.
// Cost: one pass over the keys of localStorage and sessionStorage at start, no-op once the old keys are gone.
(function migrateStorage() {
  const KEYS = {
    'mesto-jazyk': 'agentic-language', 'mesto-jazyk-cache': 'agentic-language-cache', 'mesto-rezim': 'agentic-mode',
    'mesto-povodne': 'agentic-original-city', 'mesto-tim-zbal': 'agentic-team-collapsed', 'mesto-urad-kod': 'agentic-task-office-code',
    'posta-pas': 'agentic-mail-pass', 'mesto-cas-v8': 'city-time-v8', 'mesto-fokus': 'city-focus', 'mesto-kluc': 'city-key',
    'mesto-koncepty': 'city-drafts', 'mesto-nastavenia': 'city-settings', 'mesto-nastavenia-kat': 'city-settings-category',
    'mesto-odomknute': 'city-unlocked', 'mesto-otacanie': 'city-rotation', 'mesto-otacanie-rychlost': 'city-rotation-speed',
    'mesto-pracovna': 'city-workroom', 'mesto-pracovna-bez-dnes': 'city-workroom-without-today', 'mesto-pracovna-bez-mapy': 'city-workroom-without-map',
    'mesto-pracovna-konv': 'city-workroom-conv', 'mesto-pracovna-sirka-l': 'city-workroom-width-l', 'mesto-pracovna-sirka-r': 'city-workroom-width-r',
    'mesto-pracovna-stav19': 'city-workroom-status19', 'mesto-pracovna-zbal': 'city-workroom-pack', 'mesto-rychle-prechody': 'city-quick-transitions',
    'mesto-triedenie-vynimky': 'city-sorting-exceptions', 'mesto-upozornenia': 'city-alerts', 'mesto-vacsie-pismo': 'city-larger-font',
    'mesto-veza': 'city-tower', 'mesto-volby': 'city-choices',
  };
  const PREFIXES = [['mesto-panel-', 'agentic-panel-'], ['mesto-ns-', 'agentic-file-']];
  const target = (k) => {
    if (Object.prototype.hasOwnProperty.call(KEYS, k)) return KEYS[k];
    for (const [o, n] of PREFIXES) if (k.startsWith(o)) return n + k.slice(o.length);
    return null;
  };
  const preview = /^\/(nahlad|preview)\//.test(location.pathname);
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const s = window[name], old = [];
      for (let i = 0; i < s.length; i++) { const k = s.key(i); if (target(k)) old.push(k); }
      for (const k of old) {
        if (!preview) { s.setItem(target(k), s.getItem(k)); s.removeItem(k); }
        else if (s.getItem(target(k)) === null) s.setItem(target(k), s.getItem(k));
      }
    } catch { /* storage unavailable (private mode) */ }
  }
})();
