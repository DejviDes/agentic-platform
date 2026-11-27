// Dictionary en: assembles partial files en-<group>.js (keys app.<module>.…). Test: tests/preklad-appka.test.mjs
import conv from './en-conv.js';
import panel from './en-panel.js';
import city from './en-city.js';
import workroom from './en-workroom.js';
import settings from './en-settings.js';
import base from './en-base.js';
export default { ...conv, ...panel, ...city, ...workroom, ...settings, ...base };
