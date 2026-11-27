// Dictionary sk: assembles the partial files sk-<group>.js (keys app.<module>.…). Test: tests/preklad-appka.test.mjs
import conv from './sk-conv.js';
import panel from './sk-panel.js';
import city from './sk-city.js';
import workroom from './sk-workroom.js';
import settings from './sk-settings.js';
import base from './sk-base.js';
export default { ...conv, ...panel, ...city, ...workroom, ...settings, ...base };
