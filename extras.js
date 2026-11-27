// extras.js – Phase 3: subscription limits (5 h, week, model) and dictation via local Whisper.
//
// Limits: usage_EXPERIMENTAL…() from the Agent SDK (data of the /usage command) once a minute, only while the app is open.
//         Called on one long-lived `claude` process without a model message (costs nothing); on error the process is closed and retried.
//         Fallback: the rate_limit_event from running agents (limitFromEvent).
// Transcription: POST /api/transcript (recording from MediaRecorder) → long-lived process `uv run transcribe-server.py` (mlx_whisper,
//         whisper-large-v3-turbo, the model loads once). After 20 min without dictation the process stops (frees memory).

import { query } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CLAUDE_BIN, cleanEnv } from './agents.js';
import { t } from './i18n.js';

// ---------- limits ----------
export const LIMITS = { h5: null, week: null, models: [], time: null, source: null, error: null, warning: null };
let lq = null, lEnd = null, lRunning = false;
const percent = (x) => (x == null ? null : Math.round(Number(x)));
function closeLimits() { try { lEnd?.(); lq?.close?.(); } catch {} lq = null; lEnd = null; }

export async function loadLimits(emit) {
  if (lRunning) return; lRunning = true;
  try {
    if (!lq) {
      const quiet = (async function* () { await new Promise((r) => (lEnd = r)); })();
      lq = query({ prompt: quiet, options: { cwd: os.homedir(), env: cleanEnv(), pathToClaudeCodeExecutable: CLAUDE_BIN, settingSources: [] } });
    }
    const u = await Promise.race([lq.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }), new Promise((_, r) => setTimeout(() => r(new Error(t('server.extras.limitsTimeout'))), 15000))]);
    if (!u.rate_limits_available || !u.rate_limits) throw new Error(t('server.extras.withoutLimits', { type: (u.subscription_type || t('server.extras.withoutSubscription')) }));
    const rl = u.rate_limits, window = (x) => (x ? { p: percent(x.utilization), reset: x.resets_at ? Date.parse(x.resets_at) : null } : null);
    LIMITS.h5 = window(rl.five_hour); LIMITS.week = window(rl.seven_day);
    LIMITS.models = (rl.limits || []).filter((l) => l.kind === 'weekly_scoped' && l.scope?.model?.display_name).map((l) => ({ name: l.scope.model.display_name, p: percent(l.percent), reset: l.resets_at ? Date.parse(l.resets_at) : null }));
    if (!LIMITS.models.length) for (const [k, n] of [['seven_day_opus', 'Opus'], ['seven_day_sonnet', 'Sonnet']]) if (rl[k]) LIMITS.models.push({ name: n, ...window(rl[k]) });
    Object.assign(LIMITS, { time: Date.now(), source: 'usage', error: null, subscription: u.subscription_type });
  } catch (e) {
    LIMITS.error = e.message; closeLimits();
  } finally { lRunning = false; emit({ kind: 'limits', limits: LIMITS }); }
}
// fallback: rate_limit_event from a running agent (arrives on a status change, utilization is 0 – 1 or percent)
export function limitFromEvent(info, emit) {
  if (!info) return;
  const p = info.utilization == null ? null : Math.round(info.utilization <= 1 ? info.utilization * 100 : info.utilization);
  const window = { p, reset: info.resetsAt ? (info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt) : null };
  if (info.rateLimitType === 'five_hour' && p != null) LIMITS.h5 = window;
  if (info.rateLimitType === 'seven_day' && p != null) LIMITS.week = window;
  LIMITS.warning = info.status === 'rejected' ? t('server.extras.limitExhausted') : info.status === 'allowed_warning' ? t('server.extras.limitNear') : null;
  if (!LIMITS.source) LIMITS.source = 'rate_limit_event';
  emit({ kind: 'limits', limits: LIMITS });
}
export const stopLimits = closeLimits;

// ---------- dictation (local Whisper) ----------
const ROOT = path.dirname(new URL(import.meta.url).pathname);
let wp = null, wReady = null, wBuf = '', wId = 0, wIdle = null;
const wPending = new Map();
function startWhisper() {
  if (wp) return wReady;
  wp = spawn('uv', ['run', '--quiet', path.join(ROOT, 'transcribe-server.py')], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  wReady = new Promise((resolve, reject) => {
    const tm = setTimeout(() => reject(new Error(t('server.extras.whisperNotLoaded'))), 180000);
    wp.stdout.on('data', (d) => {
      wBuf += d;
      let n;
      while ((n = wBuf.indexOf('\n')) >= 0) {
        const r = wBuf.slice(0, n); wBuf = wBuf.slice(n + 1);
        let o; try { o = JSON.parse(r); } catch { continue; }
        if (o.ready) { clearTimeout(tm); console.log(`Whisper pripravený za ${o.ms} ms`); resolve(); continue; }
        const c = wPending.get(o.id); if (c) { wPending.delete(o.id); o.error ? c.reject(new Error(o.error)) : c.resolve(o); }
      }
    });
    wp.stderr.on('data', () => {}); // mlx downloads and warnings
    wp.on('exit', (code) => {
      clearTimeout(tm); wp = null; wReady = null;
      for (const c of wPending.values()) c.reject(new Error(t('server.extras.whisperFinished', { code })));
      wPending.clear(); reject(new Error(t('server.extras.whisperFinishedUv', { code })));
    });
    wp.on('error', (e) => reject(new Error(t('server.extras.uvError', { error: e.message }))));
  });
  wReady.catch(() => {});
  return wReady;
}
function postponeShutdown() { clearTimeout(wIdle); wIdle = setTimeout(() => wp?.kill(), 20 * 60 * 1000); }
export function prepareTranscription() { postponeShutdown(); return startWhisper(); }
export async function transcription(buf, extension = 'webm') {
  postponeShutdown();
  const t0 = Date.now();
  await startWhisper();
  const file = path.join(os.tmpdir(), `mesto-diktat-${Date.now()}.${extension.replace(/[^a-z0-9]/g, '') || 'webm'}`);
  fs.writeFileSync(file, buf);
  try {
    const id = ++wId;
    const o = await new Promise((resolve, reject) => {
      wPending.set(id, { resolve, reject });
      wp.stdin.write(JSON.stringify({ id, file }) + '\n');
      setTimeout(() => { if (wPending.delete(id)) reject(new Error(t('server.extras.transcriptionTook'))); }, 60000);
    });
    return { text: o.text, msTranscription: o.ms, msTotal: Date.now() - t0 };
  } finally { fs.rm(file, () => {}); }
}
export const stopTranscription = () => wp?.kill();
