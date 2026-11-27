// files.js – file preview from the chat (2026-11-17): path verification, type, content (read only), images, bulk "is this a file?" check and opening
// in Obsidian / the default app. Allowed roots come from the server (setFiles: `files.roots` in world.json, otherwise the Brain and the root of each building;
// via realpath, a symlink must not lead outside).
// Forbidden: sensitive files (server data/, world.json, .git, node_modules, .env*, keys, cookie/token/secret/heslo/recovery in the name, paths per `files.sensitive` in world.json).
// Errors are Error with a code field (400, 403, 404, 415); routes in server.js return them as { error }. The mobile gateway may only read (no opening).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from './i18n.js';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLATFORM } from './platform.js';

const HOME = os.homedir();
const MAX_CONTENT = 1024 * 1024; // nothing more is read into the preview (type "text" with truncated: true)
const SNIFF = 8192;
const MAX_PATHS = 50;

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const CITY = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_DATA = path.join(CITY, 'data'); // the server's conversations, permissions and attachments are never shown

// Configuration comes from the server (setFiles): { roots: [absolute paths], brain: absolute path of the Obsidian vault | null, sensitive: [regex as text] }.
// Valid for a few seconds (world.json is read rarely), without configuration no root is allowed.
let source = () => ({ roots: [], brain: null, sensitive: [] }), cache = null;
export const setFiles = (f) => { source = f; cache = null; };
function config() {
  if (cache && Date.now() - cache.time < 5000) return cache;
  let k; try { k = source(); } catch { k = { roots: [], brain: null, sensitive: [] }; }
  const sensitivePatterns = []; for (const x of k.sensitive || []) { try { sensitivePatterns.push(new RegExp(String(x), 'i')); } catch { /* an invalid pattern is skipped */ } }
  const roots = [...new Set((k.roots || []).map((p) => path.resolve(p)))];
  cache = { time: Date.now(), roots, brain: k.brain ? path.resolve(k.brain) : null, sensitive: sensitivePatterns };
  return cache;
}

const error = (code, message) => Object.assign(new Error(message), { code });

const IMAGES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const TEXT = new Set(('txt json jsonc json5 js mjs cjs ts tsx jsx css scss sass less html htm xml yml yaml py hs cs sql csv tsv log sh zsh bash toml ini cfg conf swift java kt c h cc cpp hpp go rs vue svelte ' +
  'rb php pl lua r tex bib rst org env example gitignore gitattributes editorconfig properties gradle plist srt vtt ics ipynb lock mdx').split(' '));
const BINARY = new Set(('pdf docx doc xlsx xls pptx ppt odt ods odp pages numbers key zip gz tgz bz2 xz 7z rar tar dmg pkg iso app exe dll so dylib bin mp3 mp4 m4a m4v mov avi mkv wav flac aac ogg ' +
  'heic heif tif tiff bmp ico psd assistant fig sketch woff woff2 ttf otf eot sqlite db epub mobi jar class pyc').split(' '));
// never launched when opening in the default app (executables, scripts, bundles, links)
const BANNED_OPEN = new Set('app command sh zsh bash tool terminal scpt applescript workflow pkg dmg jar webloc inetloc fileloc url action prefpane mobileconfig'.split(' '));
const BUNDLE_EXTENSIONS = ['.app', '.workflow', '.action', '.prefpane', '.bundle', '.framework', '.plugin', '.xpc', '.kext', '.appex'];

const withoutDiacritics = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const NAME_SENSITIVE = /cookie|token|secret|heslo|recovery/;
const SEGMENT_SENSITIVE = new Set(['.git', 'node_modules', '.ssh', '.gnupg', '.aws']);

// sensitive path? `segments` = path segments relative to the root, `abs` = full path
function sensitive(segments, abs) {
  const name = segments.at(-1) || '', m = withoutDiacritics(name);
  if (segments.some((s) => SEGMENT_SENSITIVE.has(s))) return true;
  if (abs === APP_DATA || abs.startsWith(APP_DATA + path.sep)) return true;
  const rel = withoutDiacritics(segments.join('/'));
  if (config().sensitive.some((re) => re.test(rel))) return true;
  if (m === 'world.json' || m.startsWith('.env') || /\.(pem|key|p12|pfx)$/.test(m) || m.startsWith('id_rsa') || m.startsWith('id_ed25519') || m.startsWith('id_ecdsa')) return true;
  return NAME_SENSITIVE.test(m);
}

// rel to the root (lexical and real) or null when outside
const inRoots = (p, root) => { const r = path.relative(root, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep) : null; };

function expand(filePath, base) {
  let c = String(filePath ?? '').trim();
  if (!c || c.length > 2000 || c.includes('\0')) throw error(400, t('server.files.errorPath'));
  if (c === '~') c = HOME; else if (c.startsWith('~/')) c = path.join(HOME, c.slice(2));
  if (path.isAbsolute(c)) return path.resolve(c);
  const z = String(base ?? '').trim();
  if (!z) throw error(400, t('server.files.baseRequired'));
  const zr = z === '~' ? HOME : z.startsWith('~/') ? path.join(HOME, z.slice(2)) : z;
  if (!path.isAbsolute(zr)) throw error(400, t('server.files.baseAbsolute'));
  return path.resolve(zr, c);
}

// Verifies a path and returns { abs (lexical, normalized), real (realpath), st }. Throws Error with code 400/403/404.
// A non-existent path outside the roots is 403 (we do not reveal what is on disk), inside the roots 404.
export function verifyPath(filePath, base) {
  const abs = expand(filePath, base);
  const roots = config().roots;
  const lex = roots.map((d) => inRoots(abs, d)).find((r) => r);
  if (!lex) throw error(403, t('server.files.outsideFolders'));
  if (sensitive(lex, abs)) throw error(403, t('server.files.notShown'));
  let realPath;
  try { realPath = fs.realpathSync(abs); } catch (e) { throw error(e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 404 : 403, e.code === 'ENOENT' || e.code === 'ENOTDIR' ? t('server.files.missing') : t('server.files.unreadable')); }
  const sk = roots.map((d) => inRoots(realPath, real(d))).find((r) => r);
  if (!sk) throw error(403, t('server.files.pathOutside'));
  if (sensitive(sk, realPath) || sensitive(sk, abs)) throw error(403, t('server.files.notShown'));
  let st;
  try { st = fs.statSync(realPath); } catch { throw error(404, t('server.files.missing')); }
  if (!st.isFile()) throw error(400, t('server.files.noIsFile'));
  return { abs, real: realPath, st };
}

const extensionFrom = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };

function hasZero(realPath) {
  let fd; try { fd = fs.openSync(realPath, 'r'); const b = Buffer.alloc(SNIFF), n = fs.readSync(fd, b, 0, SNIFF, 0); return b.subarray(0, n).includes(0); }
  catch { return true; } finally { if (fd != null) try { fs.closeSync(fd); } catch { /* nothing */ } }
}

export function fileType(realPath, extension) {
  if (extension === 'md') return 'md';
  if (IMAGES[extension]) return 'image';
  if (TEXT.has(extension)) return 'text';
  if (BINARY.has(extension)) return 'other';
  return hasZero(realPath) ? 'other' : 'text';
}

const relShow = (abs) => (abs === HOME || abs.startsWith(HOME + path.sep) ? '~' + abs.slice(HOME.length) : abs);

function vaultPath(realPath) {
  const v = config().brain; if (!v) return undefined;
  const r = path.relative(real(v), realPath);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : undefined;
}

// GET /api/file
export function filePreview(filePath, base) {
  const { abs, real: realPath, st } = verifyPath(filePath, base);
  const name = path.basename(abs), extension = extensionFrom(name);
  let type = fileType(realPath, extension);
  const out = { path: abs, rel: relShow(abs), name, type, extension, size: st.size, changed: st.mtimeMs };
  const vault = vaultPath(realPath); if (vault) out.vault = vault;
  if (type === 'md' || type === 'text') {
    const trimmed = st.size > MAX_CONTENT;
    let buf;
    try {
      const fd = fs.openSync(realPath, 'r');
      try { buf = Buffer.alloc(Math.min(st.size, MAX_CONTENT)); const n = fs.readSync(fd, buf, 0, buf.length, 0); buf = buf.subarray(0, n); } finally { fs.closeSync(fd); }
    } catch { throw error(403, t('server.files.unreadable')); }
    let txt = buf.toString('utf8');
    if (trimmed) { txt = txt.replace(/�+$/, ''); type = 'text'; out.type = 'text'; out.trimmed = true; } // a truncated file is shown as plain text
    out.content = txt;
  }
  return out;
}

// GET /api/file/raw – { real, mime, size, svg } or error 415 for types other than images
export function rawFile(filePath, base) {
  const { abs, real: realPath, st } = verifyPath(filePath, base);
  const extension = extensionFrom(path.basename(abs));
  if (!IMAGES[extension]) throw error(415, 'Tento typ sa neposiela');
  return { real: realPath, mime: IMAGES[extension], size: st.size, svg: extension === 'svg' };
}

// headers for a raw image (svg: nothing in it runs as a page)
export function rawHeaders(s) {
  const h = { 'Content-Type': s.mime, 'Content-Length': s.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-cache' };
  if (s.svg) h['Content-Security-Policy'] = 'sandbox';
  return h;
}

// POST /api/file/exist – { results: { [originalPath]: { path, type, name, vault? } | null } }
export function exist(paths, base) {
  if (!Array.isArray(paths)) throw error(400, t('server.files.errorList'));
  if (paths.length > MAX_PATHS) throw error(400, `Najviac ${MAX_PATHS} ciest naraz`);
  const results = {};
  for (const c of paths) {
    if (typeof c !== 'string') continue;
    try {
      const { abs, real: realPath } = verifyPath(c, base), name = path.basename(abs);
      const r = { path: abs, type: fileType(realPath, extensionFrom(name)), name };
      const v = vaultPath(realPath); if (v) r.vault = v;
      results[c] = r;
    } catch { results[c] = null; }
  }
  return { results };
}

// POST /api/file/open – where: 'obsidian' (only files in the Brain vault, if `brain.kind` is obsidian) or 'app' (the default app, not executables)
export function open(filePath, where, base) {
  const { abs, real: realPath, st } = verifyPath(filePath, base);
  if (where === 'obsidian') {
    const v = vaultPath(realPath);
    if (!v) throw error(403, t('server.files.obsidian'));
    const f = v.replace(/\.md$/i, '');
    return start(['obsidian://open?vault=' + encodeURIComponent(path.basename(config().brain)) + '&file=' + encodeURIComponent(f)]);
  }
  if (where !== 'app') throw error(400, t('server.files.unknownPlace'));
  const segment = realPath.split(path.sep).map((s) => s.toLowerCase());
  if (st.mode & 0o111) throw error(403, t('server.files.executable'));
  if (BANNED_OPEN.has(extensionFrom(path.basename(realPath))) || BANNED_OPEN.has(extensionFrom(path.basename(abs)))) throw error(403, t('server.files.typeBanned'));
  if (segment.some((s) => BUNDLE_EXTENSIONS.some((b) => s.endsWith(b)))) throw error(403, t('server.files.bundle'));
  return start([realPath]);
}

function start(args) {
  const [command, pa] = PLATFORM === 'darwin' ? ['open', args] : PLATFORM === 'win32' ? ['cmd', ['/c', 'start', '', ...args]] : ['xdg-open', args]; // opening with the default app per OS
  return new Promise((ok, wrong) => execFile(command, pa, { timeout: 8000 }, (e) => (e ? wrong(error(500, 'Otvorenie zlyhalo')) : ok({ ok: true }))));
}

// SSE event after a tool write: absolute file path from the tool input (or null)
export const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
export const FILE_TOOLS = new Set(['Read', ...WRITE_TOOLS]);
export function toolPath(title, enter, cwd) {
  const f = enter?.file_path || enter?.notebook_path;
  if (!FILE_TOOLS.has(title) || typeof f !== 'string' || !f) return null;
  return path.resolve(cwd || HOME, f.replace(/^~(?=\/|$)/, HOME));
}
