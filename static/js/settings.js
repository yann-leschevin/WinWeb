// Préférences utilisateur (thème, style Windows 10/11, fond d'écran, accent).
import { emit } from './bus.js';
import { rawUrl } from './utils.js';

const KEY = 'winweb.settings';

export const WALLPAPERS = [
  {
    id: 'bloom', name: 'Bloom',
    css: 'radial-gradient(ellipse 60% 70% at 50% 62%, rgba(120,190,255,.95) 0%, rgba(40,110,230,.75) 30%, transparent 62%),'
      + 'radial-gradient(ellipse 45% 40% at 38% 48%, rgba(170,220,255,.8) 0%, transparent 60%),'
      + 'radial-gradient(ellipse 40% 45% at 64% 52%, rgba(60,130,240,.9) 0%, transparent 65%),'
      + 'linear-gradient(160deg, #0b2554 0%, #12408f 45%, #0a2a66 100%)',
    dark: 'radial-gradient(ellipse 60% 70% at 50% 62%, rgba(50,120,230,.9) 0%, rgba(20,60,160,.7) 32%, transparent 62%),'
      + 'radial-gradient(ellipse 40% 45% at 64% 52%, rgba(30,80,200,.8) 0%, transparent 65%),'
      + 'linear-gradient(160deg, #040b1f 0%, #0a1d4a 50%, #050d26 100%)',
  },
  {
    id: 'hero', name: 'Lumière (Windows 10)',
    css: 'linear-gradient(105deg, transparent 38%, rgba(120,200,255,.55) 47%, rgba(255,255,255,.35) 50%, rgba(120,200,255,.45) 53%, transparent 62%),'
      + 'radial-gradient(ellipse at 50% 50%, #1565c0 0%, #0b3d91 45%, #021a45 100%)',
  },
  {
    id: 'aurore', name: 'Aurore',
    css: 'radial-gradient(ellipse 80% 50% at 20% 30%, rgba(60,255,180,.55), transparent 60%),'
      + 'radial-gradient(ellipse 70% 60% at 80% 20%, rgba(160,80,255,.6), transparent 60%),'
      + 'linear-gradient(180deg, #050a24 0%, #0b1f3d 60%, #041018 100%)',
  },
  {
    id: 'couchant', name: 'Couchant',
    css: 'radial-gradient(circle at 50% 75%, #ffd27a 0%, #ff8a5c 18%, transparent 45%),'
      + 'linear-gradient(180deg, #2b1055 0%, #7b2f7f 40%, #e2556b 70%, #ffb36b 100%)',
  },
  {
    id: 'lagon', name: 'Lagon',
    css: 'radial-gradient(ellipse at 30% 80%, rgba(0,255,210,.45), transparent 55%),'
      + 'linear-gradient(135deg, #00b4db 0%, #0083b0 50%, #005073 100%)',
  },
  { id: 'nuit', name: 'Nuit', css: 'radial-gradient(ellipse at 50% 120%, #1d2a44 0%, #0b0f19 60%, #05070c 100%)' },
  { id: 'uni', name: 'Uni', css: 'linear-gradient(#0063b1, #0063b1)' },
];

export const ACCENTS = ['#0067c0', '#0078d4', '#8764b8', '#c239b3', '#e81123', '#ff8c00', '#10893e', '#038387', '#515c6b'];

const DEFAULTS = { theme: 'light', style: 'win11', wallpaper: 'bloom', accent: '', userName: 'Utilisateur' };

let current = { ...DEFAULTS };
try {
  current = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
} catch {
  current = { ...DEFAULTS };
}

export function getSettings() {
  return { ...current };
}

export function setSettings(patch) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* stockage indisponible : préférences gardées pour la session */
  }
  applySettings();
  emit('settings-changed', getSettings());
}

export function wallpaperCss(value = current.wallpaper, theme = current.theme) {
  if (typeof value === 'string' && value.startsWith('image:')) {
    const url = rawUrl(value.slice(6)).replace(/["\\]/g, (c) => `\\${c}`);
    return `center / cover no-repeat url("${url}"), #1a1a1a`;
  }
  const wp = WALLPAPERS.find((w) => w.id === value) || WALLPAPERS[0];
  return theme === 'dark' && wp.dark ? wp.dark : wp.css;
}

export function applySettings() {
  const body = document.body;
  body.classList.toggle('theme-dark', current.theme === 'dark');
  body.classList.toggle('theme-light', current.theme !== 'dark');
  body.classList.toggle('style-win10', current.style === 'win10');
  body.classList.toggle('style-win11', current.style !== 'win10');
  document.documentElement.style.setProperty('--wallpaper', wallpaperCss());
  // L'accent est posé sur <body> pour primer sur les valeurs par défaut des thèmes.
  if (current.accent) body.style.setProperty('--accent', current.accent);
  else body.style.removeProperty('--accent');
}
