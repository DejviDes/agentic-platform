// tools.js – agents' tools (MCP servers) for the app (2026-11-11).
//
// GET /api/tools: list from `claude mcp list` (the same claude as the agents), cache 15 min, first load in the background after start.
// SSE `tool`: tool id when an agent (also a teammate) calls it (toolId below; throttled in agents.js).
// The id is a short lowercase name: 'plugin:playwright:playwright' / mcp__plugin_playwright_playwright__x → 'playwright',
// 'claude.ai Google Calendar' / mcp__claude_ai_Google_Calendar__x → 'google-calendar'.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// the same claude as the agents (CLAUDE_BIN from agents.js), otherwise the one bundled in the Agent SDK (undefined in agents.js = the SDK uses its own)
const BUNDLED = path.join(path.dirname(fileURLToPath(import.meta.url)), 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, 'claude');

export function normalizeMcp(name) {
  let s = String(name || '').trim();
  let m = s.match(/^plugin:[^:]+:(.+)$/); if (m) s = m[1]; // plugin:<plugin>:<server>
  else if ((m = s.match(/^plugin_(.+)$/))) { // plugin_<plugin>_<server> (in tool names)
    const r = m[1], pol = r.split('_');
    s = pol.length % 2 === 0 && pol.slice(0, pol.length / 2).join('_') === pol.slice(pol.length / 2).join('_') ? pol.slice(pol.length / 2).join('_') : pol.slice(1).join('_') || r;
  }
  s = s.replace(/^claude\.ai\s+/i, '').replace(/^claude_ai_/i, '');
  return s.toLowerCase().replace(/[\s_.]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// tool name from the SDK → id for the app (null = do not send)
export function toolId(n) {
  if (n === 'WebFetch' || n === 'WebSearch') return 'web';
  if (n === 'Bash') return 'terminal';
  const m = String(n || '').match(/^mcp__(.+?)__/);
  if (!m || m[1] === 'agentic') return null;
  return normalizeMcp(m[1]) || null;
}

const CACHE_MS = 15 * 60 * 1000;
let STATUS = null, WHEN = 0, runningLoading = null, setting = { bin: 'claude', env: process.env };

export function parseMcpList(text) {
  const out = [], seen = new Set();
  for (const r of String(text).split('\n')) {
    const m = r.match(/^(.+?):\s.*\s-\s+(✔|✓|!|✗|✘|×)\s*(.*)$/);
    if (!m) continue;
    const title = m[1].trim(), id = normalizeMcp(title);
    if (!id || seen.has(id)) continue; seen.add(id);
    const status = m[2] === '✔' || m[2] === '✓' ? 'ok' : /auth/i.test(m[3]) ? 'auth' : 'error';
    out.push({ id, title: title.replace(/^claude\.ai\s+/i, '').replace(/^plugin:[^:]+:/, ''), status });
  }
  return out;
}

export function loadTools() {
  if (runningLoading) return runningLoading;
  const t0 = Date.now();
  runningLoading = new Promise((resolve) => {
    execFile(setting.bin, ['mcp', 'list'], { env: setting.env, timeout: 90000, cwd: process.env.HOME, maxBuffer: 2e6 }, (err, stdout) => {
      const list = parseMcpList(stdout || '');
      if (list.length || !err) { STATUS = list; WHEN = Date.now(); }
      else console.warn('claude mcp list:', err.message);
      runningLoading = null;
      resolve({ tools: STATUS || [], when: WHEN, ms: Date.now() - t0 });
    });
  });
  return runningLoading;
}

// response for GET /api/tools: never waits for the CLI (while loading, the last state or loading)
export function toolState() {
  if (!STATUS || Date.now() - WHEN > CACHE_MS) loadTools();
  if (!STATUS) return { tools: [], loading: true };
  return { tools: STATUS, when: WHEN, ...(runningLoading ? { loading: true } : {}) };
}

// in the background after server start (a few seconds, so it does not slow the start)
export function startTools({ bin, env } = {}) {
  setting = { bin: bin || (fs.existsSync(BUNDLED) ? BUNDLED : 'claude'), env: env || process.env };
  setTimeout(() => loadTools(), 5000).unref();
}
