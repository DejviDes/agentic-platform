// router.js – POST /api/router (2026-11-11): Haiku suggests which floor and whom the user's message belongs to. Starts nothing.
//
// One query() call without tools, without settings (CLAUDE.md, MCP, skills are not loaded), without a session on disk,
// in a neutral folder (os.tmpdir()), timeout 20 s. Goes through the subscription like the agents (cleanEnv, never an API key).
// Response: { floor, agent, name, agentName, reason, alternatives: [{ floor, agent, name }] (max 2), ms } or { error }.

import { query } from '@anthropic-ai/claude-agent-sdk';
import os from 'node:os';
import { CLAUDE_BIN, MODELS, cleanEnv, who, loadTeam } from './agents.js';
import { t } from './i18n.js';

const MODEL = (MODELS.filter((m) => /haiku/.test(m.id)).at(-1) || {}).id || 'haiku';
const TIMEOUT = 20000;
const tail = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// floors: [{ id, n, building, description, path|paths }] (the server also adds the brain and the control center)
export function listFloors(floors) {
  return floors.map((P) => ({ id: P.id, n: P.n, building: P.building || '', description: P.description || '', team: loadTeam(P).map((a) => ({ k: a.k, name: a.name, description: tail(a.description || a.role, 110) })) }));
}

function systemPrompt(list) {
  const rows = list.map((p) => `- ${p.id} | ${p.n}${p.building ? t('prompt.router.building', { building: p.building }) : ''}${p.description ? ` | ${tail(p.description, 60)}` : ''}${p.team.length ? t('prompt.router.team', { team: p.team.map((a) => `${a.k} (${a.description})`).join('; ') }) : ''}`);
  return t('prompt.router', { who: who(), rows: rows.join('\n') });
}

export function extractJson(text) {
  const t = String(text || '').replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

export async function proposeFloor(text, floors) {
  text = String(text || '').trim();
  if (!text) return { error: t('server.router.emptyText') };
  const list = listFloors(floors), byId = new Map(list.map((p) => [p.id, p]));
  const t0 = Date.now(), ac = new AbortController(), timer = setTimeout(() => ac.abort(), TIMEOUT);
  let output = '', error = null;
  try {
    const q = query({
      prompt: tail(text, 4000),
      options: {
        model: MODEL, cwd: os.tmpdir(), pathToClaudeCodeExecutable: CLAUDE_BIN, env: cleanEnv(), abortController: ac,
        systemPrompt: systemPrompt(list), tools: [], allowedTools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [],
        maxTurns: 1, permissionMode: 'default', persistSession: false, thinking: { type: 'disabled' },
        canUseTool: async () => ({ behavior: 'deny', message: t('server.router.withoutTools') }),
      },
    });
    for await (const u of q) {
      if (u.type === 'result') { if (u.subtype === 'success') output = u.result || ''; else error = u.errors?.join(', ') || u.subtype; }
    }
  } catch (e) { error = ac.signal.aborted ? t('server.router.timeout', { time: TIMEOUT / 1000 }) : e.message; }
  finally { clearTimeout(timer); }
  const ms = Date.now() - t0;
  if (error) return { error, ms };
  const j = extractJson(output);
  if (!j) return { error: t('server.router.invalidJson'), ms };
  const verify = (pid, ag) => { // only an existing floor and teammate, otherwise the lead
    const p = byId.get(String(pid || '')); if (!p) return null;
    const a = p.team.find((x) => x.k === ag);
    return { floor: p.id, agent: a ? a.k : 'lead', name: p.n, agentName: a ? a.name : t('server.router.lead') };
  };
  const main = verify(j.floor, j.agent);
  if (!main) return { error: t('server.router.unknownFloor', { floor: tail(j.floor, 40) }), ms };
  const seen = new Set([main.floor + '|' + main.agent]), alternatives = [];
  for (const x of Array.isArray(j.alternatives) ? j.alternatives : []) {
    const o = verify(x?.floor, x?.agent); if (!o || seen.has(o.floor + '|' + o.agent)) continue;
    seen.add(o.floor + '|' + o.agent); alternatives.push({ floor: o.floor, agent: o.agent, name: o.name });
    if (alternatives.length >= 2) break;
  }
  return { ...main, reason: tail(j.reason, 200), alternatives, ms };
}
