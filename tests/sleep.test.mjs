// Mac sleep (sleep.js): logic with faked sudo and pmset, the real pmset is never called.
process.env.AGENTIC_LANG = 'sk'; // the test checks the Slovak reason texts
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const m = await import(new URL('../server/sleep.js', import.meta.url));
let t = 1e9, log = [], sudoOk = true, batt = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; charging", lid = 'No', update = { running: 0, pending: [] }, alert = [], pressureMac = 0;
const execute = (p, a) => { log.push(p.split('/').pop() + ' ' + a.join(' '));
  if (p.endsWith('sudo')) { if (!sudoOk) throw new Error('sudo: a password is required'); return ''; }
  if (p.endsWith('notifyutil')) return `com.apple.system.thermalpressurelevel ${pressureMac}`; if (a[0] === '-g') return batt; if (p.endsWith('ioreg')) return `"AppleClamshellState" = ${lid}`; return ''; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spanok-'));
m.setSleep({ data: dir, execute, activity: () => update, alert: (a) => alert.push(a), clock: () => t });
const pm = () => log.filter((l) => /disablesleep|sleepnow/.test(l) && !/-l /.test(l)); const reset = () => { log.length = 0; };
const adv = (s) => { t += s * 1e3; };
// common: nothing
update = { running: 2, pending: [] }; m.recompute(); assert.deepEqual(pm(), []);
// agents: holds
reset(); let st = m.changeSleep({ mode: 'agents' }); assert.deepEqual(pm(), ['sudo -n /usr/bin/pmset -a disablesleep 1']); assert.equal(st.holds, true); assert.match(st.reason, /2 agenti pracujú/);
// next tick: no pmset call
reset(); adv(20); m.recompute(); assert.deepEqual(pm(), []);
// work done: 30 s tail
update = { running: 0, pending: [] }; adv(20); m.recompute(); assert.deepEqual(pm(), []);
lid = 'Yes'; adv(20); m.recompute(); assert.deepEqual(pm(), ['sudo -n /usr/bin/pmset -a disablesleep 0', 'pmset sleepnow']);
// waiting holds, after 30 min it does not
reset(); lid = 'No'; update = { running: 0, pending: [t] }; m.recompute(); assert.deepEqual(pm(), ['sudo -n /usr/bin/pmset -a disablesleep 1']); assert.match(m.sleepState().reason, /čaká na teba/);
reset(); adv(31 * 60); m.recompute(); adv(31); m.recompute(); assert.deepEqual(pm(), ['sudo -n /usr/bin/pmset -a disablesleep 0']); // lid open: no sleepnow
// battery
reset(); update = { running: 1, pending: [] }; m.recompute(); assert.equal(m.sleepState().holds, true);
batt = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t14%; discharging"; lid = 'Yes'; reset(); adv(25); m.recompute();
assert.deepEqual(pm(), ['sudo -n /usr/bin/pmset -a disablesleep 0', 'pmset sleepnow']); assert.deepEqual(alert, ['Batéria pod 15 %']); assert.match(m.sleepState().reason, /Batéria/);
reset(); adv(25); m.recompute(); assert.deepEqual(pm(), []); assert.equal(alert.length, 1);
batt = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t15%; discharging"; adv(25); m.recompute(); assert.equal(m.sleepState().holds, false); // hysteresis: 15 % not yet
batt = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t30%; discharging"; lid = 'No'; adv(25); m.recompute(); assert.equal(m.sleepState().holds, true);
// overheating: closed and pressure heavy -> sleep, alert; back after the lid is opened
update = { running: 1, pending: [] }; lid = 'Yes'; pressureMac = 1; adv(25); m.recompute(); assert.equal(m.sleepState().holds, true); // moderate not yet
alert.length = 0; reset(); pressureMac = 2; adv(25); m.recompute();
assert.deepEqual(pm(), ['sudo -n /usr/bin/pmset -a disablesleep 0', 'pmset sleepnow']); assert.deepEqual(alert, ['Mac sa prehrieva']); assert.match(m.sleepState().reason, /prehrieval/);
reset(); pressureMac = 0; adv(25); m.recompute(); assert.deepEqual(pm(), []); // cool: stays released for 10 min
adv(10 * 60); m.recompute(); assert.equal(m.sleepState().holds, true); // back after 10 min without pressure
pressureMac = 3; adv(25); m.recompute(); assert.equal(m.sleepState().holds, false);
lid = 'No'; adv(25); m.recompute(); assert.equal(m.sleepState().holds, true); assert.equal(alert.length, 2); // lid open: back (2nd overheating = 2nd alert)
pressureMac = 0;
// never
st = m.changeSleep({ mode: 'never' }); update = { running: 0, pending: [] }; adv(25); m.recompute(); assert.equal(st.holds, true); assert.match(st.reason, /nezaspí/);
// without sudo
m.changeSleep({ mode: 'common' }); assert.equal(m.sleepState().holds, false); reset(); sudoOk = false;
st = m.changeSleep({ mode: 'agents' }); update = { running: 1, pending: [] }; adv(70); m.recompute(); st = m.sleepState(); assert.equal(st.holds, false); assert.equal(st.sudoOk, false); assert.match(st.reason, /sudo/);
// after sudo is set up, the next tick (60 s) reconciles
sudoOk = true; adv(70); m.recompute(); assert.equal(m.sleepState().holds, true);
// release on shutdown
reset(); m.releaseSleep(); assert.deepEqual(pm(), ['sudo -n /usr/bin/pmset -a disablesleep 0']); assert.equal(m.sleepState().holds, false);
// invalid mode
assert.throws(() => m.changeSleep({ mode: 'x' }), /režim/);
// restart: held=true in the file and common -> releases
fs.writeFileSync(dir + '/sleep.json', JSON.stringify({ mode: 'common', held: true })); reset();
m.setSleep({ data: dir, execute, activity: () => update, alert() {}, clock: () => t }); assert.deepEqual(pm(), ['sudo -n /usr/bin/pmset -a disablesleep 0']);
m.releaseSleep(); fs.rmSync(dir, { recursive: true, force: true }); console.log('OK');
