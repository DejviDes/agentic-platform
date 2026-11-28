// Escalation (escalation.js): push after a long wait, mock push and calendar, no network, fixed dates.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const m = await import(new URL('../server/escalation.js', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escalation-'));
let t = new Date('2026-11-28T12:00:00').getTime(), list = [], events = [], pushes = [];
const adv = (min) => { t += min * 60e3; };
m.setEscalation({ data: dir, interval: false, clock: () => t, waiting: () => list, baseUrl: () => 'https://mac.ts.net:4748', log: () => {}, quietCalendar: 'School',
  calendar: async () => ({ ok: true, events }), push: async (p) => { pushes.push(p); return { sent: 1, failed: 0 }; } });
const wait = (id, from) => ({ id, floor: 'projekty/x', agent: 'lead', title: 'T', from, kind: 'approval' });
// off by default: nothing
list = [wait('a', t - 99 * 60e3)]; assert.equal(await m.check(), 0); assert.equal(m.escalationState().enabled, false);
m.changeEscalation({ enabled: true });
assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'escalation.json'), 'utf8')).enabled, true);
// under the limit: nothing; at the limit: 1 push with tag and url
list = [wait('a', t)]; adv(29); assert.equal(await m.check(), 0);
adv(1); assert.equal(await m.check(), 1);
assert.equal(pushes[0].quiet, false); assert.equal(pushes[0].tag, 'escalation-a'); assert.equal(pushes[0].url, 'https://mac.ts.net:4748/#k=a'); assert.match(pushes[0].text, /projekty\/x/);
// the same minute again: no duplicate; every minute up to 10 in total
assert.equal(await m.check(), 0);
for (let i = 0; i < 12; i++) { adv(1); await m.check(); }
assert.equal(pushes.length, 10);
// the wait ends: nothing; a new wait of the same conversation (new start) is a new series
list = []; adv(1); await m.check(); list = [wait('a', t - 30 * 60e3)]; assert.equal(await m.check(), 1); assert.equal(pushes.length, 11);
// reaction in the middle of a series: stops
adv(1); await m.check(); assert.equal(pushes.length, 12); list = []; adv(1); await m.check(); adv(1); await m.check(); assert.equal(pushes.length, 12);
// school: one quiet push, no repeating
pushes.length = 0; list = [wait('b', t - 31 * 60e3)];
events = [{ calendar: 'School', allDay: false, start: new Date(t - 3600e3), end: new Date(t + 3600e3) }];
assert.equal(await m.check(), 1); assert.equal(pushes[0].quiet, true);
for (let i = 0; i < 5; i++) { adv(1); await m.check(); } assert.equal(pushes.length, 1);
// school and over an hour past the limit: nothing
pushes.length = 0; list = [wait('c', t - 100 * 60e3)]; events = [{ calendar: 'School', allDay: false, start: new Date(t - 3600e3), end: new Date(t + 3600e3) }];
assert.equal(await m.check(), 0);
// another calendar does not count as school
events = [{ calendar: 'Work', allDay: false, start: new Date(t - 3600e3), end: new Date(t + 3600e3) }]; list = [wait('d', t - 31 * 60e3)];
assert.equal(await m.check(), 1); assert.equal(pushes[0].quiet, false);
// limit setting and test push
m.changeEscalation({ limitMin: 5 }); assert.equal(m.escalationState().limitMin, 5);
assert.equal((await m.sendTest()).ok, true);
console.log('ok');
