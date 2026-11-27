// usage.js – estimate of how much of the subscription's 5-hour limit each message used (2026-11-11).
//
// Unit = 1 Opus input token. A model call weighs like the API price: input 1, output 5, cache read 0.1,
// cache write 1.25 (5 min) or 2 (1 h), times the model factor (Sonnet, Haiku are cheaper). Factors are learned
// from modelUsage (costUSD) in Agent SDK results; until then the defaults apply.
// The 5 h limit comes from /usage only in whole percent, so the units → % conversion calibrates itself: in every
// 5-hour window the city's usage is summed and divided by the limit percentage (from 4 %). The largest ratio of the recent
// windows applies, because usage outside the city (Claude app, scheduled tasks) only lowers the ratio. The estimate is thus rather cautious.
// The initial value of 466,000 units per 1 % comes from the 2026-11-11 analysis (all sessions in the 14:00 – 19:00 window = 27 %).
//
// Caps (world.json → "usage": { "capMessages": 3, "thresholdContext": 150000, "idleMin": 55 }):
//   capMessages  – % of 5 h per message (lead + team); when exceeded, the agent waits for the card before the next tool
//   thresholdContext – from how many context tokens the app warns before sending
//   idleMin – after how many idle minutes the cache (1 h) expired and continuing writes the whole context again
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';

const DEFAULT_FACTORS = { opus: 1, sonnet: 0.6, haiku: 0.2, fable: 2 };
const INITIAL_CALIBRATION = 466000;
let FILE = null, WORLD = null, D = { perPercent: INITIAL_CALIBRATION, factors: {}, windows: [] };
let saveT = null;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(FILE, JSON.stringify(D, null, 1)); } catch {} }, 2000); };

export function setUsage({ data, worldJson, limits: l }) {
  FILE = path.join(data, 'usage.json'); WORLD = worldJson; if (l) limits = l;
  try { D = { ...D, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
}

// Saving level (2026-11-22, Settings window → Usage). The chosen level (data/usage.json) takes precedence over capMessages
// and thresholdContext from world.json; without a chosen level world.json applies, otherwise the medium values (since 2026-11-25; before that high). Per level:
//   cap          – % of 5 h per message, then the Continue / Stop card
//   context      – from how many context tokens the app warns before sending
//   withoutHuman – cap multiplier for scheduled tasks (they have nobody to show the card to, they stop by themselves)
//   deleg        – highest model and effort the delegation card offers (null = no limit; the user changes it on the card)
// Automatic: when the 5 h window is above AUTO_THRESHOLD %, high applies until the window resets (the chosen level is not overwritten).
export const LEVELS = {
  high: { cap: 3, context: 100000, withoutHuman: 2, deleg: { model: 'sonnet', effort: 'medium' } },
  medium: { cap: 7, context: 150000, withoutHuman: 3, deleg: null },
  low: { cap: 12, context: 250000, withoutHuman: 3, deleg: null },
};
export const AUTO_THRESHOLD = 80;
let limits = () => null; // limits from extras.js (setUsage)
export const saving = () => D.level || null;
export function setSaving(u) {
  if (!(u in LEVELS)) throw Object.assign(new Error(t('server.usage.unknownLevel')), { code: 400 });
  D.level = u; save(); return savingState();
}
export function savingState() {
  const n = settings();
  return { chosen: saving(), level: n.level, auto: n.auto, autoThreshold: AUTO_THRESHOLD, h5: limits()?.h5?.p ?? null, cap: n.capMessages, thresholdContext: n.thresholdContext, withoutHuman: n.withoutHuman, deleg: n.deleg };
}

export function settings() {
  let s = {}; try { s = JSON.parse(fs.readFileSync(WORLD, 'utf8')).usage || {}; } catch {}
  const number = (x, d, min, max) => (Number.isFinite(+x) && +x >= min && +x <= max ? +x : d);
  const chosen = D.level in LEVELS ? D.level : null, h5 = limits()?.h5?.p;
  const auto = chosen !== 'high' && h5 != null && h5 >= AUTO_THRESHOLD;
  const level = auto ? 'high' : chosen || 'medium', u = LEVELS[level], fromWorld = !chosen && !auto;
  return {
    level, auto,
    capMessages: fromWorld ? number(s.capMessages, u.cap, 0.001, 50) : u.cap,
    thresholdContext: fromWorld ? number(s.thresholdContext, 150000, 20000, 900000) : u.context,
    withoutHuman: u.withoutHuman, deleg: u.deleg,
    idleMin: number(s.idleMin, 55, 5, 600),
  };
}

const family = (model) => (/haiku/i.test(model) ? 'haiku' : /sonnet/i.test(model) ? 'sonnet' : /fable|mythos/i.test(model) ? 'fable' : 'opus');
const factor = (model) => D.factors[family(model)] ?? DEFAULT_FACTORS[family(model)];

// weight of one call in units (without the model factor)
export function usageWeight(u = {}) {
  const cc = u.cache_creation || {}, w5 = cc.ephemeral_5m_input_tokens, w1 = cc.ephemeral_1h_input_tokens;
  const write = w5 != null || w1 != null ? 1.25 * (w5 || 0) + 2 * (w1 || 0) : 1.25 * (u.cache_creation_input_tokens || 0);
  return (u.input_tokens || 0) + 5 * (u.output_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + write;
}
export const units = (usage, model) => usageWeight(usage) * factor(model);
// 2026-11-19: actual ratio of the current 5 h window = units of all transcripts on the Mac (usage-sessions.js) / % from /usage.
// While the window has at least 3 %, it applies (same number as the Usage limit window), otherwise the cautious calibration from past windows.
let RATIO = null; // { n: units per 1 %, reset }
export function setWindowRatio(j, p, reset) { RATIO = p >= 3 && j > 0 && reset > Date.now() ? { n: j / p, reset } : null; }
const perPercent = () => (RATIO && RATIO.reset > Date.now() ? RATIO.n : D.perPercent);
export const toPercent = (j) => j / perPercent();
export const toUnits = (p) => p * perPercent();

// model factors from the result's modelUsage (sums for the whole query(), the price / weight ratio is the same for sums)
export function learnFromResult(modelUsage) {
  if (!modelUsage) return;
  const price = {};
  for (const [m, x] of Object.entries(modelUsage)) {
    const w = (x.inputTokens || 0) + 5 * (x.outputTokens || 0) + 0.1 * (x.cacheReadInputTokens || 0) + 1.25 * (x.cacheCreationInputTokens || 0);
    if (w > 20000 && x.costUSD > 0) price[family(m)] = x.costUSD / w;
  }
  const opus = price.opus || (D.opusPrice ?? null);
  if (price.opus) D.opusPrice = price.opus;
  if (!opus) return;
  let change = false;
  for (const [r, c] of Object.entries(price)) if (r !== 'opus') { const f = Math.round((c / opus) * 1000) / 1000; if (f > 0.02 && f < 20 && D.factors[r] !== f) { D.factors[r] = f; change = true; } }
  if (change || price.opus) save();
}

// city usage in the current 5-hour window (key = limit reset time rounded to the hour)
let window = null;
const windowKey = (reset) => (reset ? Math.round(reset / 3600000) : null);
export function tally(j, limits) {
  const reset = limits?.h5?.reset, kl = windowKey(reset); if (!kl || !(j > 0) || reset < Date.now()) return; // old limits (app closed): no window
  window = D.windows.find((o) => o.kl === kl);
  if (!window) { window = { kl, j: 0, p: null }; D.windows.push(window); D.windows = D.windows.slice(-12); }
  window.j += j; save();
}
// after each limits load: units / % ratio in the window, calibration = largest ratio from windows with at least 4 %
export function calibrate(limits) {
  const kl = windowKey(limits?.h5?.reset), p = limits?.h5?.p; if (!kl || p == null) return;
  const o = D.windows.find((x) => x.kl === kl); if (!o) return;
  o.p = p;
  // windows where the city used little and the limit was used mostly by something else (Claude app) give a low ratio: the largest is taken,
  // and until there are at least 3 windows, the initial value stays in play too (one mixed window does not throw off the estimate)
  const ratios = D.windows.filter((x) => x.p >= 4 && x.j > 0).map((x) => x.j / x.p).filter((r) => r > 50000 && r < 20e6);
  if (ratios.length < 3) ratios.push(INITIAL_CALIBRATION);
  const n = Math.round(Math.max(...ratios)); if (n !== D.perPercent) { D.perPercent = n; save(); }
}
export const calibrationState = () => ({ perPercent: D.perPercent, windows: D.windows.filter((x) => x.p >= 4).length, factors: { ...DEFAULT_FACTORS, ...D.factors } });

// estimate of a team member's task from the same member's recent tasks (median, in %)
export function taskEstimate(tasks) {
  const p = tasks.filter((x) => x > 0).slice(-5).sort((a, b) => a - b);
  return p.length ? { p: toPercent(p[Math.floor(p.length / 2)]), n: p.length } : null;
}
// rough estimate for a team member without own history (2026-11-13): tasks of all team members by model and effort,
// keys „model/effort“ and just „model“ (older tasks without effort); tasks = [{ m, e, j }] sorted from the oldest
export function estimatesByModel(tasks) {
  const sk = {};
  for (const u of tasks) for (const kl of u.e ? [`${u.m}/${u.e}`, u.m] : [u.m]) (sk[kl] ||= []).push(u.j);
  return Object.fromEntries(Object.entries(sk).map(([kl, j]) => [kl, taskEstimate(j)]));
}
