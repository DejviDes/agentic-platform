// file-type.js – attachment icon by file type (2026-11-19): a colored "sheet" with the extension (PDF, JSON, DOCX…) instead of a generic document.
// No imports. Its twin is public/mobile/file-type.js (the gate sends mobile only public/mobile/), when changing edit both. CSS: .tpS in style.css of both apps.

import { t as T } from './i18n.js';
const GROUPS = [
  ['#d9443a', ['pdf']],
  ['#2b6cd4', ['doc', 'docx', 'rtf', 'odt', 'pages']],
  ['#1f9d55', ['xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'ods', 'numbers']],
  ['#e07a1f', ['ppt', 'pptx', 'ans', 'key']],
  ['#8a5cd6', ['json', 'yaml', 'yml', 'xml', 'toml', 'ics', 'sqlite', 'db', 'sql']],
  ['#3f4756', ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'html', 'htm', 'css', 'sh', 'zsh', 'swift', 'cs', 'java', 'c', 'h', 'cpp', 'go', 'rs', 'rb', 'php', 'vue', 'ipynb']],
  ['#6b7280', ['md', 'txt', 'log', 'tex']],
  ['#a17a3a', ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'dmg', 'pkg', 'sppkg']],
  ['#d6407f', ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']],
  ['#c2410c', ['mp4', 'mov', 'mkv', 'webm', 'avi']],
  ['#0e9aa7', ['png', 'jpg', 'jpeg', 'heic', 'gif', 'webp', 'svg', 'fig']],
];
const COLOR = new Map(GROUPS.flatMap(([f, pr]) => pr.map((p) => [p, f])));

export function fileExtension(title) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(title || ''));
  return m ? m[1].toLowerCase() : '';
}

// HTML icons; extension text at most 4 characters, without an extension "SÚB"
export function fileIcon(title) {
  const p = fileExtension(title);
  const t = (p || T('app.fileType.sub')).slice(0, 4).toUpperCase();
  return `<span class="tpS${t.length > 3 ? ' dlh' : ''}" style="--tp:${COLOR.get(p) || '#7c8494'}" aria-hidden="true">${t}</span>`;
}
