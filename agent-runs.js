// agent-runs.js – shared part of the Home buildings that run an agent without a human (sorting.js, house.js), 2026-11-11.
// The agent runs as an ordinary conversation of a virtual floor (home-floors.js) via sendMessage in auto mode,
// so it is visible in the app with tools and any cards. Each module keeps its own run state (running, history).
import fs from 'node:fs';
import { t as tl } from './i18n.js';

export const p2 = (x) => String(x).padStart(2, '0');
export const day = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; // local date RRRR-MM-DD
export const error = (message, code = 400) => Object.assign(new Error(message), { code });
// first sentence of a scheduled run's intro (shared by house.js, library.js, playground.js, postman.js, task-office.js)
export const introStart = (u, n, how, finishing) => tl('prompt.scheduler.start', { n, u, how: tl(how === 'plan' ? 'prompt.scheduler.likePlan' : 'prompt.scheduler.likeManual'), finishing: finishing ? tl('prompt.scheduler.finishing') : '' });
// short and full weekday names (Date.getDay(), Sunday = 0) in the city language
export const daysShortened = () => tl('server.scheduler.days.shortened').split(',');
export const daysFull = () => tl('server.scheduler.days.full').split(',');
export const tail = (t, n = 1500) => { t = String(t || '').trim(); return t.length > n ? '…' + t.slice(-n) : t; };

// body of a scheduled task's SKILL.md without frontmatter; read on every run (the user may change it, the server does not)
export function skillText(file) {
  let t = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (t.startsWith('---\n')) { const k = t.indexOf('\n---', 3); if (k > 0) t = t.slice(t.indexOf('\n', k + 1) + 1); }
  return t.trim();
}

// Starts the agent (floor lead) with the text as the first message of a new conversation. onConv(id) right after creation,
// model and effort (optional) apply to this conversation, otherwise the floor default. onEnd({ ok, conv, message }) after the turn ends. verification(from) = extra check that the run really wrote something.
export async function agentRun({ sendMessage, floor, text, title, model, effort, verification, onConv, onEnd, message = (t) => tail(t, 1500) }) {
  const from = new Date();
  let convId = null;
  const k = await sendMessage({ floor, agent: 'lead', text, mode: 'auto', title, ...(model ? { model } : {}), ...(effort ? { effort } : {}),
    afterEnd: ({ status, text: reply }) => {
      let ok = status === 'done' || status === 'reply';
      if (ok && verification) { try { ok = !!verification(from); } catch { ok = false; } }
      onEnd({ ok, conv: convId, message: message(reply) || (ok ? tl('server.scheduler.run.done') : tl('server.scheduler.run.ended', { status })) });
    } });
  convId = k.id;
  onConv?.(k.id);
  return { conv: k.id };
}
