// floor-admin.js – Floor management in the Control center (2026-11-13): writes manual floor edits to world.json.
// Writes only for paths that are candidates (listFloors), or for an existing folder added to a building.
// Keeps other keys, JSON format with 2 spaces, writes atomically (tmp + rename). Reading and building the world is in build-world.js.
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';
import { loadSetting, expandPath, shortenPathHome, listFloors } from './build-world.js';

const error = (code, message) => Object.assign(new Error(message), { code });

export const list = (fileSettings) => ({ buildings: listFloors({ fileSettings }) });

function loadRaw(file) {
  let o = {};
  try { if (fs.existsSync(file)) o = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw error(500, t('server.message.unreadable', { error: e.message })); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw error(409, t('server.message.unknownFormat'));
  if (Array.isArray(o.buildings)) throw error(409, t('server.message.oldFormat'));
  o.floors = o.floors && typeof o.floors === 'object' ? o.floors : {};
  return o;
}
function write(file, o) {
  for (const [k, v] of Object.entries(o.floors)) if (!v || !Object.keys(v).length) delete o.floors[k];
  if (!Object.keys(o.floors).length) delete o.floors;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
// key in world.json matching the path (keys may use ~ or a different unicode form)
const findFloorKey = (o, ...paths) => {
  for (const c of paths.filter(Boolean)) {
    const k = Object.keys(o.floors).find((x) => expandPath(x) === expandPath(c));
    if (k) return k;
  }
  return null;
};
function cleanChanges(z) {
  if (!z || typeof z !== 'object') throw error(400, t('server.message.missingChanges'));
  const out = {};
  for (const [k, v] of Object.entries(z)) {
    const empty = v === null || v === '';
    if (k === 'hide') { if (!empty && typeof v !== 'boolean') throw error(400, t('server.message.hideBool')); out.hide = empty || v === false ? undefined : true; }
    else if (k === 'archive') { if (!empty && typeof v !== 'boolean') throw error(400, t('server.message.archiveBool')); out.archive = empty ? undefined : v; }
    else if (k === 'title' || k === 'description') { if (!empty && typeof v !== 'string') throw error(400, t('server.message.mustBeText', { k })); out[k] = empty || !v.trim() ? undefined : v.trim().slice(0, 200); }
    else if (k === 'order') { if (!empty && !Number.isInteger(v)) throw error(400, t('server.message.orderWhole')); out.order = empty ? undefined : v; }
    else throw error(400, t('server.message.unknownKey', { k }));
  }
  return out;
}
const candidates = (fileSettings) => listFloors({ fileSettings }).flatMap((b) => b.floors);

// body: { path, changes }  |  { building, order: [path, …] } (order 1..n)  |  { path, building } (adding a folder outside the roots)
export function changeFloor(fileSettings, body) {
  const tz = body || {};
  const o = loadRaw(fileSettings), everyone = candidates(fileSettings);
  const same = (a, b) => expandPath(a) === expandPath(b);
  if (tz.changes == null && Array.isArray(tz.order)) { // poradie celej budovy
    const v = everyone.filter((x) => x.key === tz.building);
    if (!v.length) throw error(404, t('server.message.unknownBuilding1'));
    const given = tz.order.map((c) => v.find((x) => same(x.path, c)) || (() => { throw error(400, t('server.message.pathNotBelongsBuilding', { c })); })());
    if (new Set(given).size !== given.length) throw error(400, t('server.message.duplicatePath'));
    given.forEach((x, i) => { const k = findFloorKey(o, x.path, x.codePath) || x.path; o.floors[k] = { ...(o.floors[k] || {}), order: i + 1 }; });
  } else if (tz.changes == null && tz.path && tz.building) { // add a folder
    const N = loadSetting(fileSettings);
    if (!N.buildings[tz.building]) throw error(400, t('server.message.unknownBuilding2'));
    const abs = expandPath(String(tz.path).trim());
    if (!path.isAbsolute(abs)) throw error(400, t('server.message.pathAbsolute'));
    let st; try { st = fs.statSync(abs); } catch { throw error(404, t('server.message.folderMissing')); }
    if (!st.isDirectory()) throw error(400, t('server.message.noIsFolder'));
    if ([...Object.values(N.buildings).map((b) => b.root), N.brain?.path, typeof N.controlCenter === 'string' ? N.controlCenter : null].some((r) => r && same(r, abs))) throw error(409, t('server.message.rootBuilding'));
    if (everyone.some((x) => same(x.path, abs) || (x.codePath && same(x.codePath, abs)))) throw error(409, t('server.message.alreadyIsInList'));
    const k = findFloorKey(o, abs) || shortenPathHome(abs);
    o.floors[k] = { ...(o.floors[k] || {}), building: tz.building };
    delete o.floors[k].hide;
  } else { // edit of one floor
    if (!tz.path) throw error(400, t('server.message.errorPath'));
    const c = everyone.find((x) => same(x.path, tz.path));
    if (!c) throw error(404, t('server.message.pathNotBelongs'));
    const z = cleanChanges(tz.changes);
    const k = findFloorKey(o, c.path, c.codePath) || c.path;
    const u = { ...(o.floors[k] || {}) };
    for (const [key, v] of Object.entries(z)) { if (v === undefined) delete u[key]; else u[key] = v; }
    o.floors[k] = u;
  }
  write(fileSettings, o);
  return { ok: true, buildings: listFloors({ fileSettings }) };
}

// City language (2026-11-26): writes `language` ('en' | 'sk') to world.json, other keys stay; an invalid value = error 400
export function changeLanguage(file, languageNew) {
  if (languageNew !== 'en' && languageNew !== 'sk') throw error(400, t('server.language.invalid'));
  const o = loadRaw(file);
  o.language = languageNew;
  write(file, o);
  return languageNew;
}
