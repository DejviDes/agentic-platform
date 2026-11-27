// icons.js – one set of line SVG icons for the whole interface instead of emoji (2026-11-18, direction A).
// Style like Lucide: viewBox 24×24, fill:none, stroke:currentColor, line width 1.6 (CSS .ikn in style.css), paths drawn by hand.
// Icons are SVG strings in HTML (no images and no network requests). Note: tool-icons.js are logos of connected tools (tools-bar.js), this is a different set.
// Class .ikn (not .icoText): .icoText is already used by other elements (convTodo, attachmentN, uF, pr-ag).

export const ICONS = {
  // buildings and places
  house: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-6h4v6"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="m8.5 12.2 2.5 2.5 4.5-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7.5 8.5 6 8.5-6"/>',
  library: '<path d="M5 4v16M10 4v16"/><path d="m14.5 5.6 4.2-1.1 3.3 14.4-4.2 1.1z"/>',
  garden: '<path d="M12 21v-9"/><path d="M12 12c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5z"/><path d="M12 15c0-3-2.5-5-7-5 0 3 2.5 5 7 5z"/>',
  tower: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sorting: '<path d="M3.5 13h5l1.5 3h4l1.5-3h5"/><path d="M5.5 5h13L21 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V13z"/>',
  playground: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5"/><path d="M5.5 10.5v7M9.8 10.5v7M14.2 10.5v7M18.5 10.5v7"/><path d="M3.5 20.5h17"/>',
  brain: '<path d="M9.5 4.5a3 3 0 0 0-3.2 3A3.5 3.5 0 0 0 4.5 11a3.3 3.3 0 0 0 1.8 2.9 3.2 3.2 0 0 0 3.2 5.6 2.5 2.5 0 0 0 2.5-1.2V6.2a2.5 2.5 0 0 0-2.5-1.7z"/><path d="M14.5 4.5a3 3 0 0 1 3.2 3A3.5 3.5 0 0 1 19.5 11a3.3 3.3 0 0 1-1.8 2.9 3.2 3.2 0 0 1-3.2 5.6 2.5 2.5 0 0 1-2.5-1.2"/>',
  building: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01"/><path d="M10 20.5v-4h4v4"/>',
  dispatch: '<circle cx="12" cy="12" r="1.8"/><path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  cabinet: '<rect x="3.5" y="4" width="17" height="4.5" rx="1.5"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 12.5h4"/>',
  folder: '<path d="M3.5 6.5a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  // agent roles
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2 5.2-5.2 2 2-5.2z"/>',
  pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="m14.5 6.5 3 3"/>',
  beaker: '<path d="M9.5 3h5M10 3v6L4.6 18.8A1.5 1.5 0 0 0 5.9 21h12.2a1.5 1.5 0 0 0 1.3-2.2L14 9V3"/><path d="M7.5 15h9"/>',
  branch: '<circle cx="6" cy="5.5" r="2.2"/><circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 7.7v8.6"/><path d="M18 10.2c0 4-5 4.3-10.2 7"/>',
  monitor: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8 20.5h8M12 16.5v4"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.5 0 2.2-1.1 1.6-2.2-.6-1.2.1-2.5 1.5-2.5H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.7 16.8 3.5 12 3.5z"/><path d="M7.8 11.5h.01M10.5 7.8h.01M15 7.8h.01"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5c-3.5-.5-6.5 0-8.5 1.5z"/><path d="M12 6.5v13"/>',
  notebook: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 3.5v17M12.5 8.5H16M12.5 12H16"/>',
  glob: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z"/>',
  plug: '<path d="M9 3v5M15 3v5"/><path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 17v4"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.8"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.8"/>',
  ter: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" />',
  magnifier: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3.5a6 6 0 0 0-3.5 10.9c.7.6 1 1.3 1 2.1h5c0-.8.3-1.5 1-2.1A6 6 0 0 0 12 3.5z"/>',
  document: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10z"/><path d="M14 3.5v5h5M9 13h6M9 16.5h6"/>',
  up: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14-4.5L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4.5l2-2.5"/><path d="M20 20v-5h-5"/>',
  wheel: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.7"/><path d="M12 2.8v2.5M12 18.7v2.5M2.8 12h2.5M18.7 12h2.5M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/>',
  puzzle: '<path d="M10 4.5h4v2.5a1.8 1.8 0 1 0 3.5 0V4.5H20V10h-2.5a1.8 1.8 0 1 0 0 3.5H20V19.5h-5.5V17a1.8 1.8 0 1 0-3.5 0v2.5H4.5V14H7a1.8 1.8 0 1 0 0-3.5H4.5V4.5z" />',
  layers: '<path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  bricks: '<rect x="3.5" y="4" width="17" height="5" rx="1"/><rect x="3.5" y="9" width="8" height="5.5" rx="1"/><rect x="11.5" y="9" width="9" height="5.5" rx="1"/><rect x="3.5" y="14.5" width="17" height="5.5" rx="1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  month: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  columns: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5.5l-3 13"/>',
  truck: '<path d="M3 6.5h11v10H3z"/><path d="M14 10h4l3 3v3.5h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3"/><path d="M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/>',
  flower: '<circle cx="12" cy="12" r="2.4"/><path d="M12 9.6c-2-1-2-5 0-6 2 1 2 5 0 6zM12 14.4c-2 1-2 5 0 6 2-1 2-5 0-6zM9.6 12c-1-2-5-2-6 0 1 2 5 2 6 0zM14.4 12c1-2 5-2 6 0-1 2-5 2-6 0z"/>',
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17.5 14.5c2.2.3 3.5 2 3.5 4.5"/>',
  // states and actions
  pending: '<path d="M8.5 13V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11.5 10.5v-6a1.5 1.5 0 0 1 3 0v6"/><path d="M14.5 10.5V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.7a5.5 5.5 0 0 1-4.4-2.2L3.8 15a1.5 1.5 0 0 1 2.3-1.9l2.4 2.4"/>',
  warning: '<path d="M12 4 21.5 20h-19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  play: '<path d="M7.5 4.8v14.4l11.5-7.2z"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  next: '<path d="M5 5.5v13l9-6.5z"/><path d="M18.5 5.5v13"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  thumbUp: '<path d="M7 11v9H4v-9z"/><path d="m7 11 4-7c1.7 0 2.5 1.2 2.2 3L12.7 10H19a2 2 0 0 1 2 2.3l-1.2 6.2a2 2 0 0 1-2 1.5H7"/>',
  thumbDown: '<g transform="rotate(180 12 12)"><path d="M7 11v9H4v-9z"/><path d="m7 11 4-7c1.7 0 2.5 1.2 2.2 3L12.7 10H19a2 2 0 0 1 2 2.3l-1.2 6.2a2 2 0 0 1-2 1.5H7"/></g>',
  chat: '<path d="M20.5 15a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 2-2h12.5a2 2 0 0 1 2 2z"/>',
  plan: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><rect x="9" y="2.5" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21h4"/>',
  bellOff: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21h4M4 4l16 16"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  pin: '<path d="M12 16.5V21"/><path d="M8.5 4h7"/><path d="M9.5 4v5.5l-3 3.5v1.5h11V13l-3-3.5V4"/>', // pinned conversation (2026-11-19)
  paperclip: '<path d="m20 11-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.5 16.5a1.7 1.7 0 0 1-2.4-2.4L15 6.5"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  spark: '<path d="M12 3c.6 4.5 2.5 6.4 7 7-4.5.6-6.4 2.5-7 7-.6-4.5-2.5-6.4-7-7 4.5-.6 6.4-2.5 7-7z"/>',
  out: '<path d="M8 16 17 7M9 7h8v8"/>',
  openMail: '<path d="M13 4.5h6.5V11"/><path d="M19.5 4.5 11 13"/><path d="M18 14.5v2.8a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2V8.2A2.2 2.2 0 0 1 6.7 6H9.5"/>', // mail v2: arrow out of a square
  taskPlus: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="M12 8.5v7M8.5 12h7"/>', // mail v2: task into Notion
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  panelLeft: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  panelRight: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/>',
  quadrant: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>',
  quadrantOk: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="m8.5 12.2 2.5 2.5 4.5-5"/>',
  flag: '<path d="M5 21V4M5 5h12l-2 4 2 4H5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pedestrians: '<circle cx="13" cy="4.5" r="1.8"/><path d="m10 21 2-6-3-3 1-4.5 3.5 2.5 3 .5M8 11l-3 1.5"/>',
  move: '<path d="M3.5 12h17M16 7.5l4.5 4.5-4.5 4.5M7.5 7.5 3 12l4.5 4.5"/>',
  pick: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  larger: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  questionMark: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8M12 17h.01"/>',
  doubleArrow: '<path d="m6 11 6-6 6 6M6 18l6-6 6 6"/>',
  exclamation: '<path d="M12 4.5v10M12 19.5h.01"/>',
  dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  // layout
  video: '<rect x="3" y="5.5" width="13.5" height="13" rx="2.5"/><path d="m16.5 10.5 4.5-3v9l-4.5-3"/>',
};

// <svg> icons; the class is added to .ikn (e.g. 'cervena', 'ok', 'tlm')
export function ico(name, className = '') {
  return `<svg class="ikn${className ? ' ' + className : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.dot}</svg>`;
}

// Home building icon by key (house, tasks, mail, library, garden, tower, sorting, playground, bank, postman)
export const BUILDING_ICONS = { house: 'house', tasks: 'tasks', mail: 'mail', library: 'library', garden: 'garden', tower: 'tower', sorting: 'sorting', playground: 'playground', bank: 'bank', postman: 'mail' };
export const buildingIcon = (k, className = '') => ico(BUILDING_ICONS[k] || 'house', className);

// emoji that an agent author put into the data or frontmatter now serve only as a hint when choosing an icon (they are not shown)
const EMOJI_HINT = {
  '🧭': 'compass', '✏️': 'pen', '📝': 'pen', '📄': 'document', '🎯': 'ter', '🎧': 'headphones', '🧪': 'beaker', '💡': 'bulb', '⬆️': 'up',
  '🏗️': 'layers', '🧩': 'puzzle', '⚙️': 'wheel', '📚': 'library', '🎨': 'palette', '🖥️': 'monitor', '🧠': 'brain', '🌅': 'sun', '📥': 'sorting',
  '📔': 'notebook', '✅': 'tasks', '🔄': 'sync', '🌐': 'glob', '🔍': 'magnifier', '🔎': 'magnifier', '📊': 'columns', '🧱': 'bricks', '🔌': 'plug', '💻': 'code',
  '🏠': 'house', '📬': 'mail', '🔁': 'repeat', '🚚': 'truck', '🕰️': 'tower', '🏦': 'bank', '🌱': 'garden', '🗓️': 'calendar', '🏃': 'playground',
  '🗂️': 'cabinet', '📋': 'plan', '📁': 'folder', '💬': 'chat', '🏢': 'building', '🛰️': 'dispatch', '👥': 'people', '📅': 'calendar', '🔔': 'bell',
};

// Slovak keywords → icon (the text is first stripped of diacritics and lowercased, hence without \b and without diacritics)
const KEYS = [
  [/veduci|lead|kompas/, 'compass'], [/dispec|dispatch/, 'dispatch'], [/tajomnik|univerzal/, 'cabinet'],
  [/poznamk|pisar|pero|zapis/, 'pen'], [/test|verit/, 'beaker'], [/skusa|kviz|skusk/, 'ter'], [/prepis|nahravk|audio/, 'headphones'],
  [/git|vetv|commit|push/, 'branch'], [/server|strojov|hook|monitor/, 'monitor'], [/dizajn|figm|panel|maket|paleta/, 'palette'],
  [/kontrol|overov|kontrolor/, 'eye'], [/kronik|kniha|dokument|navod/, 'book'], [/knihovnik|kniznic/, 'library'],
  [/inbox|trieden|triedic/, 'sorting'], [/automaticky presun|presun/, 'truck'], [/denn?ik|vecer/, 'notebook'], [/ranny|brief/, 'sun'],
  [/fakt/, 'bulb'], [/opakovan/, 'repeat'], [/ulohy|uloh|task|notion/, 'tasks'], [/web|strank|vercel|landing/, 'glob'],
  [/api|endpoint/, 'plug'], [/audit|reviz|nalez/, 'magnifier'], [/prezentac|slajd|financ|report/, 'columns'],
  [/sharepoint/, 'layers'], [/formular|akci/, 'puzzle'], [/spfx|web part|webpart|tehl/, 'bricks'], [/automatiz|spravca|system/, 'wheel'],
  [/stavitel|architekt|budov/, 'building'], [/developer|vyvojar|kod|program/, 'code'], [/vysvetl|poradca/, 'bulb'], [/priklad/, 'pen'], [/goodnotes|pdf/, 'document'],
  [/domovnik|domov/, 'house'], [/zahradnik|zahrad|navyk/, 'garden'], [/trener|beh|trening/, 'playground'], [/hodinar|vez|termin/, 'tower'], [/post[ay]|forum|fora|mail/, 'mail'],
  [/plan tyzdna|plan/, 'calendar'], [/mozog|brain/, 'brain'],
];
const unify = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
let EN = null; // emoji without FE0F → icon name, built on first use (only declarations at top level)
function emojiIcon(e) {
  if (!EN) EN = new Map(Object.entries(EMOJI_HINT).map(([k, v]) => [k.replace(/\uFE0F/g, ''), v]));
  return EN.get(String(e || '').replace(/\uFE0F/g, '')) || null;
}
function iconAgent(a) {
  if (!a) return null;
  if (a.lead || a.k === 'lead') return 'compass';
  const name = unify(a.name);
  for (const [re, n] of KEYS) if (re.test(name)) return n;
  const em = emojiIcon(a.emoji);
  if (em) return em;
  const key = unify(a.k);
  for (const [re, n] of KEYS) if (re.test(key)) return n;
  const role = unify(a.role);
  for (const [re, n] of KEYS) if (re.test(role)) return n;
  return null;
}

// 28×28 square with an agent icon (by name, key, role), when nothing fits it shows the initial of the name; class: 'mal' (22 px), 'stred' (34 px), 'velky' (44 px)
export function agentIcon(a, className = '') {
  const n = iconAgent(a);
  const t = className ? ' ' + className : '';
  if (n) return `<span class="icoAg${t}" aria-hidden="true">${ico(n)}</span>`;
  const ini = ([...String(a?.name || '').trim()][0] || '·').toUpperCase().replace(/[<>&"]/g, '');
  return `<span class="icoAg in${t}" aria-hidden="true">${ini}</span>`;
}
