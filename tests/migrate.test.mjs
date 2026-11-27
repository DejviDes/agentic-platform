// tests/migrate.test.mjs – data migration of the original Slovak svet.json and data/ (migrate.js, step 3 of Agentic Platform).
// A small sample in a temporary folder with fixed dates; no Claude, no network, nothing outside os.tmpdir() is written.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate, needsMigration, migrateWorld, legacyWorld, legacyEnv, tFloor, tMcp, tPieces, tValue } from '../migrate.js';

const NOW = new Date('2026-11-27T12:00:00').getTime();
const DAY = '2026-11-27';
const write = (root, rel, content) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 1)); };
const read = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

function sample() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  write(root, 'svet.json', {
    _poznamka: 'pozn', archivPoDnoch: 30, pouzivatel: { meno: 'Test' }, jazyk: 'sk', mesto: 'klasicke',
    mozog: { nazov: 'Brain', cesta: '~/B', druh: 'priecinok', zakazaneZapisy: ['^x/'] },
    budovy: { skola: { nazov: 'Škola', koren: '~/S', lenSClaudeMd: true, poznamky: '{cesta}/' }, klient: { koren: '~/O', poznamky: 'priecinok' }, projekty: { koren: '~/D', vynechaj: ['_x'], poznamky: { sablona: '~/N/{slug}/README.md', tabulka: '~/T.md' } } },
    poschodia: { '~/D/pokus': { nazov: 'Pokus', budova: 'projekty', poradie: 1, archiv: false, skryt: false } },
    poistky: { zakazanyPush: ['git.example.com'] }, moduly: { domov: true, posta: false, mobil: true },
    slovnik: { skoly: 'školy', restauracia: 'Reštaurácia' },
  });
  write(root, 'data/konverzacie.json', { konverzacie: [
    { id: 'k1', sid: 's1', poschodie: 'centrala', agent: 'veduci', titul: 'Prvá', stav: 'hotovo', vytvorene: DAY, nazovNavrh: 'caka', rozpis: { mcp: [{ n: 'mesto', t: 10 }] } },
    { id: 'k2', poschodie: 'domov/dom', agent: 'veduci', titul: 'Brief', stav: 'chyba', planovany: true, rodic: 'k1' },
    { id: 'k3', poschodie: 'kurzy/AB100', agent: 'kronikar', titul: 'Predmet', stav: 'nic', pripnuta: NOW },
  ] });
  write(root, 'data/spravy/k1.json', JSON.stringify([
    { typ: 'ja', text: 'Ahoj, stav je hotovo', i: 0, cas: '10:00' },
    { typ: 'kroky', kroky: [{ n: 'mesto', d: 'plan', vysledok: 'ok' }, { n: 'Read', d: 'a.md' }], bezi: false, i: 1 },
    { typ: 'schval', nastroj: 'mcp__mesto__pozri_konverzaciu', kluc: 'mcp__mesto__pozri_konverzaciu', stav: 'ano', vybavene: 'povolené', i: 2 },
    { typ: 'pamat', ciel: 'poznamky', cesta: '~/N/x.md', stav: 'nie', zdroj: 'zapisovac', i: 3 },
    { typ: 'todo', polozky: [{ t: 'krok', s: 'robi' }, { t: 'iný', s: 'caka' }], i: 4 },
    { typ: 'dispUlohy', ulohy: [{ poschodie: 'mozog', agent: 'veduci', stav: 'bezi', konv: 'k2' }], i: 5 },
  ]));
  write(root, 'data/spravy/k2.json', JSON.stringify([{ typ: 'ai', text: 'ok', i: 0 }]));
  write(root, 'data/povolenia.json', { centrala: ['mcp__mesto__plan', 'Bash:ls'], 'kurzy/AB100': ['Edit'], 'domov/posta': [] });
  write(root, 'data/zariadenia.json', { zariadenia: [{ id: 'd1', meno: 'iPhone', hashTokenu: 'h', vytvorene: DAY, naposledy: DAY }], relacie: [{ h: 'x', dev: 'd1', posledna: NOW }] });
  write(root, 'data/dom.json', { ulohy: { 'ranny-brief': { zapnute: true, den: DAY, behy: [{ kedy: DAY, od: DAY, konv: 'k2', ako: 'plan', datum: DAY, ok: true, sprava: 'hotovo' }] } }, bezi: null });
  write(root, 'data/postar.json', { datum: DAY, hlavne: [{ id: 'a', kluc: 'uloha:abc', budova: 'ulohy', stav: 'nove' }], dalsie: [{ id: 'b', kluc: 'posta', budova: 'posta' }], spocitane: ['uloha:abc'], odmietnute: { 'uloha:def': '2026-12-03' }, odpovede: [{ kluc: 'inbox', budova: 'triedenie', odpoved: 'nie', kedy: DAY }], posledny: { kedy: DAY, uloha: 'postar-rano' } });
  write(root, 'data/restart.json', { konv: 'k1', sid: 's1', dovod: 'zmena', cas: NOW, commit: 'abc', skuska: 'ok' });
  write(root, 'data/zapisovac.jsonl', [{ kedy: NOW, konv: 'k1', poschodie: 'centrala/kronikar', vysledok: 'preskocene', dovod: 'nič' }, { kedy: NOW, konv: 'k3', poschodie: 'kurzy/AB100', vysledok: 'prijate' }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  write(root, 'data/spanok.json', { rezim: 'agenti', drzal: false });
  write(root, 'data/obrazky/0123456789abcdef0123.png', Buffer.from([137, 80, 78, 71]));
  write(root, 'data/prilohy/2026-11-09/zmluva.json', '{"nazov":"zmluva"}'); // user content: copied as it is
  write(root, 'data/kluc-skusky', 'k'); fs.chmodSync(path.join(root, 'data/kluc-skusky'), 0o600);
  write(root, 'data/server.log', 'log\n');
  return root;
}

// ---------- single values ----------
assert.equal(tFloor('centrala'), 'control-center');
assert.equal(tFloor('centrala/dispecing'), 'control-center/dispatch');
assert.equal(tFloor('domov/zahrada'), 'home/garden');
assert.equal(tFloor('domov/nieco-nove'), 'home/nieco-nove');
assert.equal(tFloor('mozog/univerzal'), 'brain/universal');
assert.equal(tFloor('kurzy/AB100'), 'kurzy/AB100', 'the user\'s floors stay');
assert.equal(tFloor('projekty/Pokus'), 'projekty/Pokus');
assert.equal(tMcp('mcp__mesto__navrhni_do_pamate'), 'mcp__agentic__propose_memory');
assert.equal(tMcp('mesto'), 'agentic');
assert.equal(tMcp('mcp__claude_ai_Notion__x'), 'mcp__claude_ai_Notion__x');
assert.equal(tPieces('uloha:42364f92'), 'task:42364f92');
assert.equal(tValue('hotovo'), 'done');
assert.equal(tValue('Hotovo'), 'Hotovo', 'a capitalized word is a text, not a value');
assert.equal(tValue('nedela'), 'nedela', 'kept in code (keepStrings), so kept in data');

// ---------- environment ----------
const env = legacyEnv({ MESTO_JAZYK: 'sk', MESTO_PLATFORMA: 'linux', AGENTIC_PLATFORM: 'darwin' });
assert.equal(env.AGENTIC_LANG, 'sk', 'MESTO_JAZYK is a fallback for AGENTIC_LANG');
assert.equal(env.AGENTIC_PLATFORM, 'darwin', 'the new name wins');

// ---------- world ----------
{
  const w = migrateWorld({ budovy: { skola: { koren: '~/S', poznamky: '~/x/{meno}/{cesta}' } }, poschodia: { '~/a': { popis: 'A', poznamky: 'priecinok' } }, mesto: 'vrstvy', slovnik: { nazov: 'Názov' }, _poznamka: 'x' });
  assert.deepEqual(w, { buildings: { skola: { root: '~/S', notes: '~/x/{name}/{path}' } }, floors: { '~/a': { description: 'A', notes: 'folder' } }, city: 'layers', glossary: { nazov: 'Názov' }, _poznamka: 'x' });
}

// ---------- the whole migration ----------
const root = sample();
const before = fs.readFileSync(path.join(root, 'data/konverzacie.json'), 'utf8');
assert.deepEqual(needsMigration(root), { world: true, data: true, conflicts: [] });
// legacyWorld: what the server reads before the migration (nothing written)
assert.equal(legacyWorld(path.join(root, 'world.json')).guards.bannedPush[0], 'git.example.com');

// dry run: nothing written
const dry = migrate({ root, dryRun: true, now: NOW });
assert.equal(dry.done, 'dry run, nothing written');
assert.equal(dry.data.before.conversations, 3);
assert.deepEqual(dry.data.before, dry.data.after);
assert.ok(!fs.existsSync(path.join(root, 'world.json')) && !fs.existsSync(path.join(root, 'data/conversations.json')));
assert.equal(fs.readFileSync(path.join(root, 'data/konverzacie.json'), 'utf8'), before);
assert.equal(fs.readdirSync(root).sort().join(','), 'data,svet.json');

// real run
const r = migrate({ root, now: NOW });
assert.equal(r.done, 'migrated');
assert.equal(r.backup, 'data-backup-2026-11-27');
assert.deepEqual(r.data.before, { conversations: 3, messageFiles: 2, messages: 7, devices: 1, deviceSessions: 1, permissionFloors: 3, permissionRules: 3, plans: { 'dom.json': { tasks: 1, runs: 1 } }, jsonl: { 'mozog-aktivita.jsonl': 0, 'zapisovac.jsonl': 2 }, images: 1, attachments: 1, files: 14 });
assert.equal(fs.readdirSync(root).sort().join(','), 'data,data-backup-2026-11-27,svet.json,world.json');
assert.equal(fs.readFileSync(path.join(root, 'data-backup-2026-11-27/konverzacie.json'), 'utf8'), before, 'the backup is the original data/');
assert.ok(fs.existsSync(path.join(root, 'svet.json')), 'svet.json stays');
assert.equal(fs.readdirSync(path.join(root, 'data')).sort().join(','), 'attachments,conversations.json,devices.json,house.json,images,messages,permissions.json,postman.json,restart.json,scribe.jsonl,server.log,sleep.json,test-key');
assert.equal(fs.statSync(path.join(root, 'data/test-key')).mode & 0o777, 0o600, 'file modes stay');

const w = read(root, 'world.json');
assert.deepEqual(Object.keys(w.buildings), ['skola', 'klient', 'projekty'], 'building ids stay');
assert.equal(w.buildings.skola.onlyWithClaudeMd, true);
assert.equal(w.buildings.skola.notes, '{path}/');
assert.equal(w.buildings.klient.notes, 'folder');
assert.deepEqual(w.buildings.projekty.notes, { template: '~/N/{slug}/README.md', table: '~/T.md' });
assert.deepEqual(w.floors['~/D/pokus'], { title: 'Pokus', building: 'projekty', order: 1, archive: false, hide: false });
assert.deepEqual(w.guards, { bannedPush: ['git.example.com'] });
assert.deepEqual(w.modules, { home: true, mail: false, mobile: true });
assert.deepEqual(w.glossary, { skoly: 'školy', restauracia: 'Reštaurácia' });
assert.equal(w.city, 'classic'); assert.equal(w.language, 'sk'); assert.equal(w.user.name, 'Test'); assert.equal(w.brain.kind, 'folder'); assert.deepEqual(w.brain.forbiddenWrites, ['^x/']);
assert.equal(w._poznamka, 'pozn');

const c = read(root, 'data/conversations.json').conversations;
assert.deepEqual(c[0], { id: 'k1', sid: 's1', floor: 'control-center', agent: 'lead', title: 'Prvá', status: 'done', created: DAY, titleProposal: 'pending', breakdown: { mcp: [{ n: 'agentic', t: 10 }] } });
assert.deepEqual([c[1].floor, c[1].status, c[1].scheduled, c[1].parent], ['home/house', 'error', true, 'k1']);
assert.deepEqual([c[2].floor, c[2].agent, c[2].status, c[2].pinned], ['kurzy/AB100', 'kronikar', 'none', NOW], 'employee names stay');

const m = read(root, 'data/messages/k1.json');
assert.deepEqual(m[0], { type: 'user', text: 'Ahoj, stav je hotovo', i: 0, time: '10:00' }, 'texts stay');
assert.deepEqual(m[1].steps, [{ n: 'agentic', d: 'plan', result: 'ok' }, { n: 'Read', d: 'a.md' }]);
assert.deepEqual([m[2].type, m[2].tool, m[2].key, m[2].status, m[2].resolved], ['approve', 'mcp__agentic__view_conversation', 'mcp__agentic__view_conversation', 'yes', 'povolené']);
assert.deepEqual([m[3].type, m[3].target, m[3].path, m[3].status, m[3].source], ['memory', 'notes', '~/N/x.md', 'no', 'scribe']);
assert.deepEqual(m[4].items, [{ t: 'krok', s: 'doing' }, { t: 'iný', s: 'pending' }]);
assert.deepEqual(m[5].tasks[0], { floor: 'brain', agent: 'lead', status: 'running', conv: 'k2' });
assert.equal(fs.readFileSync(path.join(root, 'data/messages/k2.json'), 'utf8'), '[{"type":"assistant","text":"ok","i":0}]', 'compact files stay compact');

assert.deepEqual(read(root, 'data/permissions.json'), { 'control-center': ['mcp__agentic__plan', 'Bash:ls'], 'kurzy/AB100': ['Edit'], 'home/mail': [] });
assert.deepEqual(read(root, 'data/devices.json'), { devices: [{ id: 'd1', name: 'iPhone', tokenHash: 'h', created: DAY, lastUsed: DAY }], sessions: [{ h: 'x', device: 'd1', lastSeen: NOW }] });
assert.deepEqual(read(root, 'data/house.json'), { tasks: { 'morning-brief': { enabled: true, day: DAY, runs: [{ when: DAY, from: DAY, conv: 'k2', how: 'plan', date: DAY, ok: true, message: 'hotovo' }] } }, running: null });
const p = read(root, 'data/postman.json');
assert.deepEqual([p.main[0].key, p.main[0].building, p.more[0].key, p.more[0].building, p.counted[0], Object.keys(p.rejected)[0], p.answers[0].key, p.answers[0].building, p.answers[0].reply, p.last.task],
  ['task:abc', 'tasks', 'mail', 'mail', 'task:abc', 'task:def', 'inbox', 'sorting', 'no', 'postman-morning']);
assert.deepEqual(read(root, 'data/restart.json'), { conv: 'k1', sid: 's1', reason: 'zmena', time: NOW, commit: 'abc', selftest: 'ok' }, 'the restart note of the old server is read by the new one');
assert.deepEqual(fs.readFileSync(path.join(root, 'data/scribe.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)), [{ when: NOW, conv: 'k1', floor: 'control-center/chronicler', result: 'skipped', reason: 'nič' }, { when: NOW, conv: 'k3', floor: 'kurzy/AB100', result: 'accepted' }]);
assert.deepEqual(read(root, 'data/sleep.json'), { mode: 'agents', held: false });
assert.equal(fs.readFileSync(path.join(root, 'data/attachments/2026-11-09/zmluva.json'), 'utf8'), '{"nazov":"zmluva"}', 'attachments are user files, not converted');

// idempotent: a second run does nothing
assert.deepEqual(needsMigration(root), { world: false, data: false, conflicts: [] });
assert.equal(migrate({ root, now: NOW }).done, 'nothing to do');
assert.equal(fs.readdirSync(root).length, 4);

// conflict: old and new name side by side → nothing touched
write(root, 'data/konverzacie.json', '{"konverzacie":[]}');
assert.throws(() => migrate({ root, now: NOW }), /both the old and the new name/);
assert.ok(fs.existsSync(path.join(root, 'data/konverzacie.json')) && read(root, 'data/conversations.json').conversations.length === 3);

// a broken file: nothing replaced, no backup, no world.json
const root2 = sample();
write(root2, 'data/spravy/zly.json', '[{"typ":');
assert.throws(() => migrate({ root: root2, now: NOW }), /spravy\/zly\.json/);
assert.equal(fs.readdirSync(root2).sort().join(','), 'data,svet.json');
assert.ok(fs.existsSync(path.join(root2, 'data/konverzacie.json')));

// two old keys that become one new key (titul and nazov are both title) are a mismatch, not a silent loss
const root3 = sample();
write(root3, 'data/spravy/k3.json', JSON.stringify([{ typ: 'nazov', titul: 'a', nazov: 'b' }]));
assert.throws(() => migrate({ root: root3, now: NOW }), /two keys become "title"/);
assert.equal(fs.readdirSync(root3).sort().join(','), 'data,svet.json');

// a backup of the same day is kept, the next one gets -2
const root4 = sample();
fs.mkdirSync(path.join(root4, 'data-backup-2026-11-27'));
assert.equal(migrate({ root: root4, now: NOW }).backup, 'data-backup-2026-11-27-2');

for (const d of [root, root2, root3, root4]) fs.rmSync(d, { recursive: true, force: true });
console.log('migrate: OK');
