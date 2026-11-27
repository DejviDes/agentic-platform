// Outside macOS (AGENTIC_PLATFORM=linux) the Mac lock, sleep and notifications are disabled and start nothing (platform.js). No server.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.AGENTIC_PLATFORM !== 'linux') { // the test reruns itself in a subprocess with the Mac disabled
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, AGENTIC_PLATFORM: 'linux' }, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
  console.log('platform.test: OK');
  process.exit(0);
}
const k = await import(new URL('../server/platform.js', import.meta.url));
assert.equal(k.IS_MAC, false); assert.equal(k.PLATFORM, 'linux');

const lock = await import(new URL('../server/lock.js', import.meta.url));
assert.equal(lock.LOCK_DISABLED, true);
assert.equal(lock.verifyKey({ headers: {}, method: 'POST' }, new URL('http://x/api/world')), true); // allowed without a key
const o = await lock.unlock(); assert.equal(o.ok, true); assert.equal(o.disabled, true); // neither swiftc nor Touch ID ran

const sp = await import(new URL('../server/sleep.js', import.meta.url));
let calls = 0;
sp.setSleep({ execute: () => { calls++; return ''; }, activity: () => ({ running: 3, pending: [] }) });
sp.recompute(true);
assert.deepEqual(sp.sleepState(), { mode: 'common', holds: false, available: false, reason: 'Iba na macOS.' });
assert.throws(() => sp.changeSleep({ mode: 'never' }), /macOS/);
sp.releaseSleep(); assert.equal(calls, 0);

const oz = await import(new URL('../server/os-notifications.js', import.meta.url));
assert.equal(oz.terminalNotifier(), null);
assert.equal(oz.notifyMac({ title: 'x' }), undefined); // nothing is started (otherwise execFile would return a process)
console.log('OK');
process.exit(0);
