// utils.js – Small helpers: random numbers, picking, HTML escape, $ = getElementById, pred (how long ago).
// Created by splitting the prototype public/dizajn-v12d.html (phase 1). Module map: brain Projekty/mesto-agentov/technika.md.

import { t as T } from './i18n.js';
export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const $ = (id) => document.getElementById(id);
// separate window of a single conversation (?conv=<id>#<floor>): without a map and without a render loop, body has the class "samostatne"
export const STANDALONE = new URLSearchParams(location.search).has('conv') || new URLSearchParams(location.search).has('file'); // separate window of a conversation or file (file-view.js)
// today's date in local time as 'YYYY-MM-DD' (Home tasks are compared as strings)
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// "5 min ago", "3 h ago", "yesterday", "12 d ago" from a time in ms
export const ago = (ms) => { const m = (Date.now() - ms) / 60000; return m < 2 ? T('app.utils.nowMin') : m < 60 ? T('app.utils.agoMin', { n: Math.round(m) }) : m < 24 * 60 ? T('app.utils.agoH', { n: Math.round(m / 60) }) : m < 48 * 60 ? T('app.utils.yesterday') : T('app.utils.agoD', { n: Math.round(m / 1440) }); };
