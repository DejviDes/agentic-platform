// virtual-floors.js – virtual floors of the core (2026-11-15): `control-center/dispatch` (Dispatch at the Control center) and `control-center/chronicler`.
// Same principle as home-floors.js (properties virtual, withoutTeam, lead, prompt, writeOnly, readingBan… are described in its
// header), only the key is the full floor id. Universal (things outside projects) is in the Home module (home-universal.js).
// server.js finds them in findFloor via virtualFloor(id, who). In addition:
//   proposalTitle – the agent has the propose_title tool and the server reminds it to name a new conversation (agents.js)
//   description – short description for the router and dispatch (router.js listFloors)
//   dispatch    – the lead has the propose_tasks tool (task card) and the list of floors is appended to its prompt (agents.js)
//   preset      – { model } default model of the floor (floorDefaults in agents.js), a conversation can override it
//   prompt      – text, or a function (who) → text, where `who` is "user" or "user (Name)" from world.json
//   chronicler  – the lead has the confirm_question tool (agents.js → chronicler-night.js addQuestion), 2026-11-25
//   path, readingBan, searchNo – may also be functions () → value (Chronicler: the Brain folder from world.json on every build)
//   paths       – function () → extra run folders (additionalDirectories), e.g. project notes outside cwd; the array is built on every findFloor
//   writeOnly   – may also contain an object with a test(abs) method (Chronicler: targets from the inputs change every night)
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from './agents.js';
import { t } from './i18n.js';
import { loadSetting } from './build-world.js';
import { chroniclerPaths, canWrite as canWriteChronicler } from './chronicler-night.js';

const HOME = os.homedir();
const CITY = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Brain from world.json (`brain.path`, `brain.forbiddenWrites` = regexes of relative paths): the Chronicler works in it and does not read the forbidden parts
function brainWorld() {
  const M = loadSetting(path.join(CITY, 'world.json')).brain;
  if (!M?.path) return null;
  const re = []; for (const x of Array.isArray(M.forbiddenWrites) ? M.forbiddenWrites : []) { try { re.push(new RegExp(String(x), 'i')); } catch {} }
  return { path: path.resolve(String(M.path).replace(/^~(?=\/|$)/, HOME)).normalize('NFC'), banned: re };
}
const brain = () => brainWorld()?.path || CITY;
const tilde = (p) => (p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p);

const FLOOR = {
  'control-center/dispatch': {
    n: 'Dispečing', building: 'Riadiaca centrála', path: CITY, lead: { name: 'Dispečer', emoji: '📋' }, proposalTitle: true, dispatch: true,
    preset: { model: (MODELS.filter((m) => /opus/.test(m.id)).at(-1) || {}).id }, // the Dispatcher runs on Opus (the newest from MODELS), it can be switched in the chat like elsewhere
    get description() { return t('prompt.vp.dispatchDescription'); }, // getter: the language is set only after world.json is loaded
    // the server appends the list of floors and teams and prepared tasks after this text on every turn (agents.js promptPre, dispatch.js dispatcherContext)
    prompt: (who) => t('prompt.vp.dispatcher', { Kto: who.replace(/^./, (c) => c.toUpperCase()) }),
    allowedBash: [/^date(?: -u)?(?: \+[-%\w:. ]{1,40})?$/],
    onlyThese: true,
    bannedTools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebSearch', 'WebFetch', 'Read', 'Glob', 'Grep', 'Skill', 'TodoWrite'],
  },
  // Chronicler (2026-11-25, chronicler-night.js): nightly run over project notes. It gets the inputs (the day's conversations, commits, Scribe) in a message,
  // writes only to the floors' note targets from the inputs (writeOnly = canWrite), sends unclear things via the confirm_question tool.
  'control-center/chronicler': {
    n: 'Kronikár', building: 'Riadiaca centrála', path: brain, lead: { name: 'Kronikár', emoji: '📜' }, chronicler: true,
    preset: { model: (MODELS.filter((m) => /sonnet/.test(m.id)).at(-1) || {}).id },
    get description() { return t('prompt.vp.chroniclerDescription'); },
    paths: () => chroniclerPaths(brain()),
    prompt: (who) => t('prompt.vp.chronicler', { who }),
    allowedTools: ['Write', 'Edit', 'MultiEdit'], // writing only per writeOnly, the hook refuses the rest
    allowedBash: [/^date(?: -u)?(?: \+[-%\w:. ]{1,40})?$/],
    onlyThese: true,
    bannedTools: ['NotebookEdit', 'WebSearch', 'WebFetch', 'Skill'],
    writeOnly: [{ test: (a) => canWriteChronicler(a) }],
    get writeReason() { return t('prompt.vp.chroniclerWriteReason'); },
    readingBan: () => {
      const M = brainWorld(), B = M?.path || CITY;
      return [
        { test: (a) => !!M && a.startsWith(B + '/') && M.banned.some((r) => r.test(a.slice(B.length + 1))) }, // brain.forbiddenWrites from world.json
        new RegExp('^' + esc(B) + '/(?:\\.obsidian|\\.git)(?:/|$)'),
        /financ|dennik|denník/i,
      ];
    },
    searchNo: () => [brain()],
  },
};

export function virtualFloor(id, who = t('prompt.user')) {
  const b = FLOOR[String(id || '')];
  if (!b) return null;
  const f = (x) => (typeof x === 'function' ? x() : x), floorPath = f(b.path);
  return { id, n: b.n, building: b.building, description: b.description, path: floorPath, shortPath: tilde(floorPath), virtual: true, withoutTeam: true, proposalTitle: !!b.proposalTitle, dispatch: !!b.dispatch, personalMail: !!b.personalMail, chronicler: !!b.chronicler, preset: b.preset || null, lead: b.lead, prompt: typeof b.prompt === 'function' ? b.prompt(who) : b.prompt,
    ...(b.paths ? { paths: typeof b.paths === 'function' ? b.paths() : b.paths } : {}),
    allowedTools: b.allowedTools || [], allowedBash: b.allowedBash || [], onlyThese: !!b.onlyThese, bannedTools: b.bannedTools || [],
    writeOnly: b.writeOnly || [], writeReason: b.writeReason || '', writeOnlyRun: [], writeReasonRun: '', readingBan: f(b.readingBan) || [], searchNo: f(b.searchNo) || [] };
}
export const virtualFloors = (who) => Object.keys(FLOOR).map((id) => virtualFloor(id, who));
