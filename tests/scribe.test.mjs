// tests/scribe.test.mjs – Scribe after a turn (scribe.js) and the Chronicler's material (chronicler-night.js): heuristic, commit, notes target,
process.env.AGENTIC_LANG = 'sk'; // the test checks the Slovak texts
// Haiku reply parsing, processTurn with a fake Haiku, material text and questions. No Claude, no data/ (state only in memory).
import assert from 'node:assert/strict';
import path from 'node:path';
import { guardBash } from '../agents.js';
import { commitFromStep, isDecision, candidates, judge, parseReply, processTurn, inTarget, extractTurn } from '../scribe.js';
import { replyText, materialText, collectMaterials } from '../chronicler-night.js';

const D = '/tmp/brain/Projekty/p', c = { kind: 'dir', folder: D, file: D + '/README.md' };
const t = (o) => ({ user: [], assistant: '', writes: [], read: [], commits: [], memory: false, ...o });

// decision in text (Slovak, without \b)
for (const s of ['Rozhodol som sa inak', 'zmeň to na modrú', 'Vždy pushni', 'nepoužívaj emoji', 'Zrušme Banku', 'odteraz platí v19', 'nechcem to tak']) assert.ok(isDecision(s), s);
for (const s of ['zmena kódu', 'používajú sa', 'zrušenie', 'prečo nejde tlačidlo?', 'oprav farbu']) assert.ok(!isDecision(s), s);

// commit from a Bash step
assert.deepEqual(commitFromStep({ n: 'Bash', d: 'git commit -m x', result: '[main 7a21cd9] Bežiaca session 1 file changed, 2 insertions(+)' }), { hash: '7a21cd9', message: 'Bežiaca session' });
assert.deepEqual(commitFromStep({ n: 'Bash', d: 'git add -A && git commit -m "a"', result: '' }), { hash: null, message: '' });
assert.equal(commitFromStep({ n: 'Bash', d: 'git status', result: 'On branch main' }), null);
assert.equal(commitFromStep({ n: 'Bash', d: 'git commit', result: '[main abc1234] x', error: true }), null);

// notes target
assert.ok(inTarget(D + '/technika.md', c));
assert.ok(!inTarget(D + '/kod.js', c) && !inTarget('/tmp/brain/Projekty/q/README.md', c));
assert.ok(inTarget(D + '/stav.md', { kind: 'project', file: D + '/README.md' })); // project README = the whole folder
assert.ok(!inTarget(D + '/stav.md', { kind: 'custom', file: D + '/poznamky.md' }));

// three turns: trivial, with a commit, with a decision; and a turn in which the agent already wrote
assert.ok(judge(t({ user: ['Prečo mi nejde tlačidlo?'], assistant: 'Chýba handler.' }), c).skip);
assert.deepEqual(judge(t({ user: ['oprav farbu'], writes: ['/x/styl.css'], commits: [{ hash: 'abc1234', message: 'color' }] }), c), { call: true, decision: false });
assert.deepEqual(judge(t({ user: ['Odteraz chcem, aby sa Banka nestavala.'] }), c), { call: true, decision: true });
assert.match(judge(t({ user: ['rozhodli sme X'], writes: [D + '/README.md'] }), c).skip, /zapísal/);
assert.match(judge(t({ user: ['rozhodli sme X'], memory: true }), c).skip, /kartou/);
assert.match(judge(t({ user: ['rozhodli sme X'] }), { kind: 'none' }).skip, /nemá/);

// candidates and excerpt
assert.deepEqual(candidates(t({ read: [D + '/stav.md', '/iné/x.md'] }), c), [D + '/README.md', D + '/stav.md']);
assert.deepEqual(candidates(t({}), { kind: 'project', file: D + '/README.md' }), [D + '/README.md']);
const v = extractTurn(t({ user: ['a'.repeat(9000)], assistant: 'b'.repeat(9000) }), { floor: 'P', cand: [D + '/README.md'], base: D });
assert.ok(v.length <= 6000 && v.includes('Kandidáti na súbor (file): README.md'));

// Haiku reply
assert.equal(parseReply('nie json'), null);
assert.deepEqual(parseReply('```json\n{"write": true, "file": "README.md", "text": "- **2026-11-25:** Banka sa nestavia (abc1234).", "reason": "decision"}\n```'), { write: true, file: 'README.md', text: 'Banka sa nestavia (abc1234).', reason: 'decision' });
assert.equal(parseReply('{"write": true, "text": ""}').write, false);

// processTurn with a fake Haiku: card proposal, do not write, unknown file
let card = null;
const o = (output) => ({ P: { id: 'p', n: 'P' }, target: c, title: 'T', query: async () => output, addCard: (x) => { card = x; return { id: 'm1', i: 1, targetAbs: path.join(D, x.file || 'README.md') }; } });
const decision = t({ conv: 'k1', user: ['Odteraz chcem, aby sa Banka nestavala.'], assistant: 'Dobre.' });
assert.equal((await processTurn(decision, o('{"write": true, "file": "README.md", "text": "Banka sa nestavia.", "reason": "x"}'))).result, 'proposed');
assert.deepEqual(card, { text: 'Banka sa nestavia.', file: 'README.md', reason: 'x' });
assert.equal((await processTurn(decision, o('{"write": false, "reason": "nič"}'))).result, 'skipWrite');
assert.equal((await processTurn(decision, o('{"write": true, "file": "../q/README.md", "text": "x"}'))).result, 'error');
assert.equal((await processTurn(decision, { ...o(''), query: async () => { throw new Error('timeout'); } })).result, 'error'); // a Haiku error does not throw
assert.equal((await processTurn(t({ conv: 'k2', user: ['hello'] }), o('{}'))).result, 'skipped');

// Chronicler: material without virtual floors and without floors without notes, trimmed to the cap
const T25 = new Date('2026-11-25T12:00:00').getTime(); // fixed time within the day 2026-11-25; with Date.now() the test failed on another day
const P1 = { id: 'p', n: 'Projekt', path: '/tmp' }, long = 'x'.repeat(5000);
const d = collectMaterials('2026-11-25', {
  turnsWindow: () => [
    { conv: 'k1', floor: 'p', agent: 'lead', title: 'A', turns: Array.from({ length: 40 }, () => ({ when: T25, user: long, assistant: long })) },
    { conv: 'k2', floor: 'home/house', agent: 'lead', title: 'B', turns: [{ when: T25, user: 'a', assistant: 'b' }] },
    { conv: 'k3', floor: 'without', agent: 'lead', title: 'C', turns: [{ when: T25, user: 'a', assistant: 'b' }] },
  ],
  findFloor: (id) => (id === 'p' ? P1 : id === 'without' ? { id, n: 'Bez', path: '/tmp' } : { id, virtual: true }),
  noteTarget: (P) => (P.id === 'p' ? c : { kind: 'none' }),
  recordsFrom: () => [{ when: T25, floor: 'p', result: 'rejected', text: 'Nechcem toto' }], unresolved: () => [], commits: () => ['abc1234 commit'],
});
assert.deepEqual(d.floors.map((p) => p.id), ['p']);
const tx = materialText(d);
assert.ok(tx.length <= 60000 && tx.includes('abc1234 commit') && tx.includes('ZAMIETNUTÉ'));
assert.match(replyText([{ question: 'Q?', context: 'k', reply: 'nie', file: '/tmp/a.md' }], '2026-11-25'), /Odpoveď: nie/);

// guard: an agent must not call the question answer, the Chronicler or the Scribe via the API
for (const u of ['/api/brain/answer', '/api/chronicler/run', '/api/chronicler/toggle', '/api/scribe']) assert.ok(guardBash(`curl -X POST http://127.0.0.1:4747${u}`, '/tmp'), u);
assert.equal(guardBash('curl http://127.0.0.1:4747/api/brain', '/tmp'), null);

console.log('scribe.test: OK');
process.exit(0);
