// demo-data.js – Sample data of the core (demo buildings, teams, router words, brain) and empty containers of the Home module.
// Buildings in real mode come from the server (/api/world, source.js). The Home sample (HOME, HOME_BUILDINGS, HOME_TEAM) belongs to the module and is filled by home-config.js.
// Created by splitting the prototype public/dizajn-v12d.html (phase 1). Module map: brain Projekty/mesto-agentov/technika.md.


import { t as T, language } from './i18n.js';

// Proper names of the demo are written in Slovak; in English they are translated by this map (ids such as 'Second Brain' and
// 'Dispečing' stay, the app and the server use them as floor keys). 'Riadiaca centrála' is shown as 'Control center' in the demo
// (2026-11-27, README screenshots); control-center.js accepts it in demo mode via DEMO_CONTROL_CENTER_NAME. Real mode names come from the server.
const EN_NAMES = {
  'Štúdium': 'Study', 'Práca': 'Work', 'Projekty': 'Projects', 'Archív': 'Archive', 'Osobné': 'Personal', 'Zdroje': 'Sources',
  'Diplomovka': 'Thesis', 'Algoritmy': 'Algorithms', 'Databázy': 'Databases', 'Angličtina': 'English', 'Štatistika': 'Statistics', 'Seminár': 'Seminar',
  'Webstránka': 'Website', 'Mobilná appka': 'Mobile app', 'Reporty': 'Reports', 'Školenie': 'Training', 'Prieskum': 'Survey', 'Ponuka': 'Quote',
  'Starý web': 'Old website', 'Tlačové správy': 'Press releases', 'Katalóg': 'Catalog', 'Dohody': 'Agreements', 'Kurzy': 'Courses',
  'Cvičenie': 'Workouts', 'Recepty': 'Recipes', 'Portfólio': 'Portfolio', 'Fotky': 'Photos', 'Cesty': 'Trips', 'Univerzál': 'Universal', 'Tajomník': 'Secretary',
  'Rešerš': 'Research', 'Poznámky': 'Notes', 'Sadzba': 'Typesetting', 'Skúšač': 'Examiner', 'Testy': 'Tests', 'Vysvetľovač': 'Explainer',
  'Obsah': 'Content', 'Automatizácia': 'Automation', 'Dokumentácia': 'Documentation', 'Staviteľ mesta': 'City builder', 'Panely a dizajn': 'Panels and design',
  'Správca': 'Keeper', 'Ranný brief': 'Morning brief', 'Triedenie': 'Sorting', 'Denník': 'Journal', 'Úlohy': 'Tasks', 'Redaktor': 'Editor',
  'Prezentácia': 'Presentation', 'Dizajn': 'Design', 'Riadiaca centrála': 'Control center',
  'poznamky/kapitola-2.md': 'notes/chapter-2.md', 'poznamky/zhrnutie.md': 'notes/summary.md',
  'diplomovka/poznamky/kapitola-2.md': 'thesis/notes/chapter-2.md', 'algoritmy/slajdy/prednaska-08.md': 'algorithms/slides/lecture-08.md', 'diplomovka/zdroje.md': 'thesis/sources.md',
  'projekty/blog/README.md': 'projects/blog/README.md', 'projekty/recepty/README.md': 'projects/recipes/README.md', 'inbox → projekty/…': 'inbox → projects/…',
  'Webstránka · 26 sessions': 'Website · 26 sessions',
};
// English router words added to the Slovak ones (the router matches either)
const EN_WORDS = {
  'Diplomovka': ['thesis', 'chapter', 'citation', 'defense'], 'Algoritmy': ['algorithm', 'recursion', 'complexity', 'exam'], 'Databázy': ['database'], 'Angličtina': ['english'], 'Štatistika': ['statistic', 'data'],
  'Webstránka': ['website', 'page'], 'Mobilná appka': ['app'], 'E-shop': ['shop', 'order'], 'Reporty': ['report'], 'Prieskum': ['survey'],
  Blog: ['article', 'post'], 'Cvičenie': ['workout', 'training'], 'Recepty': ['recipe', 'cooking'], Portfólio: ['portfolio'], 'Second Brain': ['journal', 'sorting', 'notes'],
};
const EN = language() !== 'sk';
export const DEMO_CONTROL_CENTER_NAME = () => N('Riadiaca centrála');
const N = (x) => (EN && typeof x === 'string' ? EN_NAMES[x] || x : x);
const renameKeys = (o, extra) => Object.fromEntries(Object.entries(o).map(([k, v]) => [N(k), extra ? [...v, ...(extra[k] || [])] : v]));
const localizeAgent = (a) => (EN ? { ...a, name: N(a.name), request: a.request?.map(N) } : a);
const localizeBuildings = (list) => (EN ? list.map((b) => ({ ...b, title: N(b.title), rows: b.rows?.map((r) => r.map(N)), archive: b.archive?.map((f) => ({ ...f, n: N(f.n) })),
  floors: b.floors.map((f) => ({ ...f, n: N(f.n), lead: f.lead && { ...f.lead, name: N(f.lead.name) } })) })) : list);

// =====================================================================
// DATA (draft – in the app it comes from the server and from folders)
// =====================================================================
// BUILDINGS = the world the city is built from. At startup it is filled by loadWorld() in source.js:
// from the server (real folders, phase 2) or from DEMO_BUILDINGS (demo mode, the server does not respond).
// slot = tower position in the city (0 left at the back, 1 right at the back, 2 center at the back, 3 and 4 at the edges), position = its coordinates in the old city.
export const BUILDINGS = [];
// Demo: invented buildings and projects
export const DEMO_BUILDINGS = localizeBuildings([
  { key: 'studium', title: 'Štúdium', color: '#4f7cff', slot: 0, position: [-14, -15], floors: [
    { n: 'Diplomovka', description: T('app.data.diplomova_work'), status: 'work', sessions: 33 }, { n: 'Algoritmy', description: T('app.data.zapisky_a_cvicenia'), status: 'none', sessions: 10 }, { n: 'Databázy', description: T('app.data.project_z_databaz'), status: 'pending', sessions: 19 },
    { n: 'Angličtina', description: T('app.data.preparation_na_exam'), status: 'none', sessions: 8 }, { n: 'Štatistika', description: T('app.data.zadania_a_data'), status: 'none', sessions: 4 }, { n: 'Seminár', description: T('app.data.presentation'), status: 'none', sessions: 2 } ],
    rows: [[T('app.data.nearest'), T('app.data.submission_chapter_pi_13_11')], [T('app.data.then'), T('app.data.selftest_z_algorithms_po_16_11')]] },
  { key: 'work', title: 'Práca', color: '#8a6cff', slot: 1, position: [14, -15], floors: [
    { n: 'Webstránka', description: T('app.data.company_web'), status: 'done', sessions: 26 }, { n: 'Mobilná appka', description: T('app.data.app_pre_customers'), status: 'work', sessions: 14 }, { n: 'E-shop', description: T('app.data.internetovy_shop'), status: 'none', sessions: 3 },
    { n: 'Intranet', description: T('app.data.interny_portal'), status: 'work', sessions: 1 }, { n: 'Reporty', description: T('app.data.mesacne_overviews'), status: 'none', sessions: 1 }, { n: 'Školenie', description: T('app.data.materials_pre_team'), status: 'none', sessions: 1 },
    { n: 'Prieskum', description: T('app.data.dotaznik_pre_customers'), status: 'none', sessions: 1 }, { n: 'Ponuka', description: T('app.data.cenova_offer'), status: 'none', sessions: 1 }, { n: 'Workshop', description: T('app.data.materials_na_workshop'), status: 'none', sessions: 1 } ],
    archive: ['Starý web', 'Tlačové správy', 'Katalóg', 'Newsletter', 'Dohody', 'Kurzy'].map((n) => ({ n })),
    rows: [[T('app.data.active_projects'), T('app.data.9_archive_6')], [T('app.data.mostActive'), 'Webstránka · 26 sessions']] },
  { key: 'projekty', title: 'Projekty', color: '#14a3b8', slot: 2, position: [0, -27], floors: [
    { n: 'Blog', description: T('app.data.osobny_blog'), status: 'work', sessions: 14 }, { n: 'Cvičenie', description: T('app.data.aplikacia_na_treningy'), status: 'none', sessions: 1 }, { n: 'Recepty', description: T('app.data.zbierka_receptov'), status: 'none', sessions: 2 },
    { n: 'Portfólio', description: T('app.data.ukazky_prace'), status: 'none', sessions: 0 }, { n: 'Fotky', description: T('app.data.archive_fotografii'), status: 'none', sessions: 0 }, { n: 'Cesty', description: T('app.data.scheduler_vyletov'), status: 'none', sessions: 0 } ],
    rows: [[T('app.data.mostActive'), 'Blog · 14 sessions'], [T('app.data.now_running'), 'Blog']] },
  { key: 'brain', title: T('app.city.brain'), color: '#2bb68a', pavilion: true, floors: [{ n: 'Second Brain', description: T('app.data.second_brain'), status: 'work', sessions: 182 }, { n: 'Univerzál', description: T('app.data.universal_chat_outside_projects'), status: 'none', sessions: 0, id: 'brain/universal', lead: { name: 'Tajomník', emoji: '🗂️', role: T('app.data.universal_asistent_things_outside_project') } }] },
  { key: 'control-center', title: T('app.city.controlCenter'), color: '#8c949e', pavilion: true, controlCenter: true, dispatch: { n: 'Dispečing', id: 'control-center/dispatch' }, floors: [{ n: 'Riadiaca centrála', description: T('app.data.app_city'), status: 'work', sessions: 3 }, { n: 'Dispečing', description: T('app.data.splits_your_free_text_na_tasks_pre_p'), status: 'none', sessions: 0, id: 'control-center/dispatch', lead: { name: 'Dispečer', emoji: '📋', role: T('app.data.splits_free_text_na_tasks_a_priradi_') } }] },
]);
const LEAD = (u, tool = 'calendar') => ({ name: T('app.data.lead'), role: T('app.data.splits_tasks_a_checks_vystupy'), emoji: '🧭', tasks: u || [T('app.data.plan_na_week'), T('app.data.check_vystupov')], tool, key: ['tím', 'total', 'celé', 'naplánuj', 'plán'] });
const TEAMS = {
  'Diplomovka': [LEAD([T('app.data.plan_chapters'), T('app.data.check_citacii')]),
    { name: 'Rešerš', role: T('app.data.searches_a_zhrna_sources'), emoji: '🔍', tasks: [T('app.data.sources_ku_kapitole_2'), T('app.data.summary_article'), T('app.data.list_literatury')], key: ['source', 'literatúr', 'rešerš', 'článok'] },
    { name: 'Poznámky', role: T('app.data.writing_notes_do_brain'), emoji: '📝', tasks: [T('app.data.notes_zo_stretnutia'), T('app.data.complete_definitions'), T('app.data.summary_chapter')], key: ['poznám', 'summarize', 'definíc'], rules: [T('app.data.definitions_highlight_citatom')], request: [T('app.data.write_file'), 'poznamky/kapitola-2.md', T('app.data.diff_metodika')] },
    { name: 'Sadzba', role: T('app.data.export_do_pdf'), emoji: '📄', tasks: [T('app.data.pdf_z_chapter_2'), T('app.data.titulna_side')], key: ['pdf', 'export', 'vytlač'], request: [T('app.data.start_command'), 'pandoc', '$ pandoc kapitola-2.md -o kapitola-2.pdf'] },
    { name: 'Skúšač', role: T('app.data.kvizy_by_slabych_okruhov'), emoji: '🎯', tasks: [T('app.data.kviz_z_metodiky'), T('app.data.questions_k_obhajobe')], key: ['kvíz', 'vyskúšaj', 'skúš', 'obhajob'] }],
  'Algoritmy': [LEAD([T('app.data.preparation_na_exam')]),
    { name: 'Testy', role: T('app.data.local_tests_k_uloham'), emoji: '🧪', tasks: [T('app.data.tests_k_ulohe_8'), T('app.data.hranicne_pripady')], key: ['test', 'verify'], request: [T('app.data.start_command'), 'python3', '$ python3 test_08.py'] },
    { name: 'Vysvetľovač', role: T('app.data.vysvetluje_latku_na_other_prikladoch'), emoji: '💡', tasks: [T('app.data.rekurzia_na_priklade'), T('app.data.zlozitost_algorithms')], key: ['explain', 'nerozumiem', 'ako funguje'] },
    { name: 'Git', role: T('app.data.vetvy_a_submission'), emoji: '⬆️', tasks: [T('app.data.new_branch_pre_task_9'), T('app.data.status_vetiev')], key: ['git', 'commit', 'push', 'odovzd', 'vetv'], tool: 'github', request: [T('app.data.start_command'), 'git', '$ git switch -c uloha-09'] },
    { name: 'Poznámky', role: T('app.data.notes_z_prednasok'), emoji: '📝', tasks: [T('app.data.notes_z_lekcie_8'), T('app.data.tahak_na_exam')], key: ['poznám', 'ťahák', 'summarize'] }],
  'Webstránka': [LEAD([T('app.data.status_project_pre_client')]),
    { name: 'Frontend', role: T('app.data.stranky_a_komponenty'), emoji: '🧱', tasks: [T('app.data.new_podstranka'), T('app.data.responzivne_menu')], key: ['stránk', 'komponent', 'frontend', 'css'] },
    { name: 'Obsah', role: T('app.data.texts_a_images'), emoji: '📝', tasks: [T('app.data.texts_na_uvodnu_page'), T('app.data.alt_texts')], key: ['text', 'content', 'obrázok'] },
    { name: 'Automatizácia', role: T('app.data.deployment_a_scheduled_tasks'), emoji: '⚙️', tasks: [T('app.data.deployment_po_merge'), T('app.data.weekly_report')], key: ['nasad', 'automat', 'report'] },
    { name: 'Tester', role: T('app.data.testovacie_scenare'), emoji: '🧪', tasks: [T('app.data.scenar_orders'), T('app.data.regresne_tests')], key: ['test', 'scenár'], tool: 'chrome' },
    { name: 'Dokumentácia', role: T('app.data.guides_pre_client'), emoji: '📚', tasks: [T('app.data.guide_pre_redaktorov'), T('app.data.odovzdavaci_protocol')], key: ['návod', 'document', 'protocol'] }],
};
Object.assign(TEAMS, {
  'Riadiaca centrála': [ // sample control center team (in real mode it is created by an interview, step 6 of the draft)
    LEAD([T('app.data.plan_control_controlCenter'), T('app.data.check_changes_ago_commit')], 'notion'),
    { name: 'Staviteľ mesta', role: T('app.data.building_surroundings_a_vykon_city_js_surroundings_'), emoji: '🏗️', tasks: [T('app.data.zeriav_na_streche_controlCenter'), T('app.data.zlucit_new_meshe')], key: ['buildings', '3d', 'výkon', 'žeriav'] },
    { name: 'Panely a dizajn', role: T('app.data.panel_bars_a_custom_elements_style_css'), emoji: '🎨', tasks: [T('app.data.topbar_controlCenter'), T('app.data.custom_elements')], key: ['panel', 'tlačidl', 'lišt', 'design'] },
    { name: 'Server', role: T('app.data.server_js_agents_js_hooks'), emoji: '🖥️', tasks: [T('app.data.sledovanie_changes_app'), T('app.data.guard_at_zastaveni_server')], key: ['server', 'hook', 'reštart'] }],
  'Second Brain': [
    { name: 'Správca', role: T('app.data.udrziava_system_a_rules_notes'), emoji: '🧠', tasks: [T('app.data.check_links'), T('app.data.cleanup_inbox')], key: ['brain', 'systém', 'pravidl'] },
    { name: 'Ranný brief', role: T('app.data.composes_denny_overview_kazde_morning'), emoji: '🌅', tasks: [T('app.data.brief_na_monday'), T('app.data.deadlines_week')], key: ['brief', 'ráno', 'today'], tool: 'calendar' },
    { name: 'Triedenie', role: T('app.data.sorts_inbox'), emoji: '📥', tasks: [T('app.data.proposal_sorting_inbox')], key: ['inbox', 'trieden'], request: [T('app.data.move_files'), 'inbox → projekty/…', '$ git mv inbox/nacrt.md projekty/blog/nacrt.md'] },
    { name: 'Denník', role: T('app.data.vecerne_questions_a_habits'), emoji: '📔', tasks: [T('app.data.journal_na_today')], key: ['denník', 'návyk'] },
    { name: 'Úlohy', role: T('app.data.mirror_tasks_z_kalendara'), emoji: '✅', tasks: [T('app.data.mirror_tasks')], key: ['úloh', 'task'], tool: 'calendar' },
    { name: 'Git', role: T('app.data.synchronizacia_notes'), emoji: '🔄', tasks: [T('app.data.pull_a_push_changes')], key: ['git', 'sync', 'push'], tool: 'github', request: [T('app.data.start_command'), 'git', '$ git pull --rebase && git push'] }],
  Blog: [LEAD([T('app.data.preparation_article_na_week')]),
    { name: 'Redaktor', role: T('app.data.proposals_a_edit_clankov'), emoji: '📝', tasks: [T('app.data.osnova_article'), T('app.data.korektura')], key: ['článok', 'osnov', 'korektúr'] },
    { name: 'Web', role: T('app.data.staticky_web_a_deployment'), emoji: '🌐', tasks: [T('app.data.edit_templates')], key: ['web', 'stránk', 'šablón'], tool: 'github', request: [T('app.data.start_command'), 'npm', '$ npm run build'] },
    { name: 'Audit', role: T('app.data.revizia_obsahu'), emoji: '🔍', tasks: [T('app.data.check_links')], key: ['audit', 'revízi', 'link'] },
    { name: 'Prezentácia', role: T('app.data.materials_na_prednasku'), emoji: '📊', tasks: [T('app.data.slides_k_teme')], key: ['prezentáci', 'slajd'] }],
  'Mobilná appka': [LEAD(),
    { name: 'Developer', role: T('app.data.screens_a_logika'), emoji: '🧱', tasks: [T('app.data.new_screen'), T('app.data.offline_mode')], key: ['obrazov', 'logik', 'offline'], request: [T('app.data.start_command'), 'npm', '$ npm run build:app'] },
    { name: 'API', role: T('app.data.napojenie_na_servery'), emoji: '🔌', tasks: [T('app.data.endpoint_pre_login')], key: ['api', 'endpoint'] },
    { name: 'Tester', role: T('app.data.tests'), emoji: '🧪', tasks: [T('app.data.tests_prihlasenia')], key: ['test'] }],
});
const PROJECT_TEAM_SK = [LEAD(), { name: 'Developer', role: T('app.data.code_a_deployment'), emoji: '💻', tasks: [T('app.data.new_feature'), T('app.data.fix_errors')], key: ['kód', 'errors', 'funkci'], tool: 'github', request: [T('app.data.start_command'), 'npm', '$ npm run build'] },
  { name: 'Dizajn', role: T('app.data.proposal_obrazoviek'), emoji: '🎨', tasks: [T('app.data.proposal_screens')], key: ['design', 'figm', 'návrh'], tool: 'figma' }, { name: 'Poznámky', role: T('app.data.readme_a_decisions'), emoji: '📝', tasks: [T('app.data.write_decisions')], key: ['poznám', 'readme', 'rozhodnut'] }];
const PROJECT_TEAM = PROJECT_TEAM_SK.map(localizeAgent);
const TEAMS_LOCAL = Object.fromEntries(Object.entries(TEAMS).map(([k, v]) => [N(k), v.map(localizeAgent)]));
export const teamFor = (n, building) => TEAMS_LOCAL[n] || (building === N('Projekty') ? PROJECT_TEAM : (building === N('Práca')
  ? [LEAD(), { name: 'Developer', role: T('app.data.code_a_deployment'), emoji: '💻', tasks: [T('app.data.fix_errors'), T('app.data.new_feature')], key: ['kód', 'errors', 'funkci', 'nasad'], tool: 'github', request: [T('app.data.start_command'), 'npm', '$ npm test'] }, { name: 'Dokumentácia', role: T('app.data.guides_a_protokoly'), emoji: '📚', tasks: [T('app.data.guide_pre_pouzivatelov')], key: ['návod', 'document'] }]
  : [LEAD(undefined, 'calendar'), { name: 'Poznámky', role: T('app.data.notes_do_brain'), emoji: '📝', tasks: [T('app.data.notes_z_lectures'), T('app.data.summary_week')], key: ['poznám', 'summarize'], request: [T('app.data.write_file'), 'poznamky/zhrnutie.md', T('app.data.diff_summary')] }]).map(localizeAgent));
// floor keywords for the router
export const WORDS = renameKeys({
  'Diplomovka': ['diplom', 'chapters', 'literatúr', 'citáci', 'obhajob'], 'Algoritmy': ['algoritm', 'rekurz', 'zložitosť', 'skúšk'], 'Databázy': ['databáz', 'sql'], 'Angličtina': ['anglič', 'skúška z angl'], 'Štatistika': ['štatist', 'dáta'],
  'Webstránka': ['web', 'stránk', 'css'], 'Mobilná appka': ['appk', 'mobile'], 'E-shop': ['eshop', 'e-shop', 'objednáv'], Intranet: ['intranet', 'portál'], 'Reporty': ['report'], 'Prieskum': ['research', 'dotazník'],
  Blog: ['blog', 'článok'], 'Cvičenie': ['cvič', 'tréning'], 'Recepty': ['recept', 'varen'], 'Riadiaca centrála': ['mesto agentov', 'appk', 'centrál', 'city'], Portfólio: ['portfól'],
  'Second Brain': ['brain', 'brief', 'inbox', 'trieden', 'denník'],
}, EN ? EN_WORDS : null);
export const BRAIN_GROUPS = [['Štúdium', '#4f7cff', 347], ['Projekty', '#14a3b8', 137], ['Archív', '#b9b6ac', 63], ['Osobné', '#ff8fc8', 44], ['Zdroje', '#35c58a', 21], ['Inbox', '#8a8880', 20]].map(([n, c, k]) => [N(n), c, k]);
export let BRAIN_COUNT = 657; // demo; in real mode the number of .md in the brain from the server (/api/world brain.pocet, source.js)
// groups from GET /api/brain (`groups`: number of .md per brain folder); changes the field in place, the scene reads it when building
// real mode: the largest top-level folders of the brain (up to 6, files in the root left out), colors stay in order
export const setBrainGroups = (s) => {
  if (!s || typeof s !== 'object') return;
  const top = Object.entries(s).filter(([k, n]) => k !== '.' && Number.isFinite(n) && n > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!top.length) return;
  const colors = BRAIN_GROUPS.map((g) => g[1]);
  BRAIN_GROUPS.length = 0;
  top.forEach(([k, n], i) => BRAIN_GROUPS.push([k, colors[i % colors.length], n]));
};
// brain root for opening notes (world.json `brain.path`, shortened with ~), set from /api/world
export let BRAIN_BASE = '~/Notes/';
export const setBrainBase = (s) => { if (s) BRAIN_BASE = String(s).replace(/\/?$/, '/'); };
export const setBrainCount = (n) => { if (Number.isFinite(n)) BRAIN_COUNT = n; };
// names of the brain groups the demo wires point to (city.js); in Slovak the original 'Štúdium' and 'Projekty'
export const BRAIN_STUDY = N('Štúdium'), BRAIN_PROJECTS = N('Projekty');
// keys: 'study' for a study building, otherwise 'projects' (city.js, panel.js)
export const NOTES = { study: ['diplomovka/poznamky/kapitola-2.md', 'algoritmy/slajdy/prednaska-08.md', 'diplomovka/zdroje.md'].map(N), projects: ['projekty/blog/README.md', 'projekty/recepty/README.md'].map(N) };
export const COLORS = ['#ff6b5e', '#4f8cff', '#ffc542', '#35c58a', '#b46bff', '#ff8fc8', '#2bc4c9'];

// =====================================================================
// HOME DISTRICT (module): empty containers, the core only reads them. The sample data and buildings are filled by home-config.js when the module is enabled.
// Without the module they stay empty, so no Home district is built in the cities.
// =====================================================================
export const HOME = {};
export const HOME_BUILDINGS = [];
export const HOME_TEAM = {};
export const HOME_CHAT_EXAMPLES = {};
