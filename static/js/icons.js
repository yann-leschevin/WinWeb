// Icônes : SVG inline (dossiers, logo, fichiers) et emoji. Aucune ressource externe.
import { escapeHtml } from './utils.js';

export const LOGO_SVG = `<svg viewBox="0 0 24 24" class="logo-svg" aria-hidden="true">
  <rect x="2" y="2" width="9.5" height="9.5" rx="1"/><rect x="12.5" y="2" width="9.5" height="9.5" rx="1"/>
  <rect x="2" y="12.5" width="9.5" height="9.5" rx="1"/><rect x="12.5" y="12.5" width="9.5" height="9.5" rx="1"/></svg>`;

export const FOLDER_SVG = `<svg viewBox="0 0 48 48" class="ico-svg" aria-hidden="true">
  <path d="M4 10a3 3 0 0 1 3-3h11l4 4h19a3 3 0 0 1 3 3v3H4z" fill="#e8a822"/>
  <path d="M4 15h40v22a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#ffc83d"/>
  <path d="M4 15h40v3H4z" fill="#ffd96a" opacity=".7"/></svg>`;

const FILE_SVG = (color, label) => `<svg viewBox="0 0 48 48" class="ico-svg" aria-hidden="true">
  <path d="M11 4h18l10 10v28a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fff" stroke="#b9b9b9"/>
  <path d="M29 4v8a2 2 0 0 0 2 2h8" fill="#e6e6e6" stroke="#b9b9b9"/>
  ${label ? `<rect x="5" y="27" width="${Math.max(18, label.length * 6 + 8)}" height="12" rx="2" fill="${color}"/>
  <text x="${5 + Math.max(18, label.length * 6 + 8) / 2}" y="36" font-size="8" font-family="Segoe UI,Arial,sans-serif" font-weight="700" fill="#fff" text-anchor="middle">${label}</text>` : ''}</svg>`;

export const TRASH_SVG = (full) => `<svg viewBox="0 0 48 48" class="ico-svg" aria-hidden="true">
  <path d="M12 14h24l-2.2 27a3 3 0 0 1-3 2.8H17.2a3 3 0 0 1-3-2.8z" fill="#d7e6f5" stroke="#6b8bb0" stroke-width="1.5"/>
  <path d="M19 19v19M24 19v19M29 19v19" stroke="#6b8bb0" stroke-width="1.5"/>
  <rect x="9" y="10" width="30" height="4" rx="1.5" fill="#9fb9d6" stroke="#6b8bb0"/>
  ${full ? '<path d="M15 10c2-6 8-7 10-3 3-5 9-3 9 3" fill="#fff6c4" stroke="#c9a640"/>' : ''}</svg>`;

export const PC_SVG = `<svg viewBox="0 0 48 48" class="ico-svg" aria-hidden="true">
  <rect x="5" y="8" width="38" height="25" rx="2" fill="#2b88d8" stroke="#1b5e99"/>
  <rect x="8" y="11" width="32" height="19" fill="#9fd4ff"/>
  <path d="M19 33h10l2 6H17z" fill="#8a8a8a"/><rect x="13" y="39" width="22" height="3" rx="1" fill="#6b6b6b"/></svg>`;

const EXT_STYLE = {
  txt: ['#5b6b7c', 'TXT'], md: ['#5b6b7c', 'MD'], log: ['#5b6b7c', 'LOG'], ini: ['#5b6b7c', 'INI'],
  csv: ['#107c41', 'CSV'], json: ['#8a6d00', 'JSON'], xml: ['#8a6d00', 'XML'],
  css: ['#264de4', 'CSS'], py: ['#3572a5', 'PY'], pdf: ['#c50f1f', 'PDF'],
  zip: ['#7a5c00', 'ZIP'], mp3: ['#8e3cbf', 'MP3'], wav: ['#8e3cbf', 'WAV'],
  mp4: ['#b4009e', 'MP4'], webm: ['#b4009e', 'WEBM'], doc: ['#185abd', 'DOC'], docx: ['#185abd', 'DOCX'],
  wdoc: ['#185abd', 'DOC'], wcalc: ['#107c41', 'XLS'], wpres: ['#c43e1c', 'PPT'], wdb: ['#a4373a', 'DB'], wnote: ['#7719aa', 'NOTE'],
  sql: ['#a4373a', 'SQL'], c: ['#555555', 'C'], cpp: ['#00599c', 'C++'], java: ['#b07219', 'JAVA'], ts: ['#3178c6', 'TS'],
  php: ['#4f5d95', 'PHP'], sh: ['#3e7a2e', 'SH'], bat: ['#3e7a2e', 'BAT'], yml: ['#cb171e', 'YML'], yaml: ['#cb171e', 'YAML'],
};

const EMOJI_BY_EXT = {
  wapp: '📦', exe: '⚙️', dll: '🧩', html: '🌐', htm: '🌐', js: '📜',
};
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);

export function isImageExt(ext) {
  return IMAGE_EXTS.has(ext);
}

const emoji = (char) => `<span class="ico-emoji" aria-hidden="true">${escapeHtml(char)}</span>`;
export { emoji as emojiIcon };

/** Retourne le HTML de l'icône d'une entrée du VFS. */
export function iconForEntry(entry, { trashFull = false } = {}) {
  if (entry.special === 'trash') return TRASH_SVG(trashFull);
  if (entry.type === 'dir') {
    const special = { '/Documents': '📄', '/Images': '🖼️', '/Téléchargements': '⬇️', '/Programmes': '🧰', '/Bureau': '🖥️' }[entry.path];
    return special ? `<span class="ico-stack">${FOLDER_SVG}<span class="ico-badge">${special}</span></span>` : FOLDER_SVG;
  }
  const ext = entry.ext || '';
  if (EMOJI_BY_EXT[ext]) {
    return `<span class="ico-stack">${FILE_SVG('#444', '')}<span class="ico-badge big">${EMOJI_BY_EXT[ext]}</span></span>`;
  }
  if (IMAGE_EXTS.has(ext)) {
    return `<span class="ico-stack">${FILE_SVG('#444', '')}<span class="ico-badge big">🖼️</span></span>`;
  }
  const [color, label] = EXT_STYLE[ext] || ['#6e6e6e', ext ? ext.slice(0, 4).toUpperCase() : ''];
  return FILE_SVG(color, escapeHtml(label));
}

/** Icône d'application (emoji ou HTML déjà sûr). */
export function appIcon(icon) {
  if (!icon) return emoji('🪟');
  if (icon.startsWith('<')) return icon;
  return emoji(icon);
}
