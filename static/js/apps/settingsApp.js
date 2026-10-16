// Paramètres : personnalisation (thème, style Windows 10/11, fond d'écran,
// accentuation), système et applications par défaut.
import { fileDialog } from '../dialogs.js';
import { appIcon } from '../icons.js';
import { ASSOCIATIONS, getApp } from '../registry.js';
import {
  ACCENTS, getSettings, setSettings, WALLPAPERS, wallpaperCss,
} from '../settings.js';
import { basename, h } from '../utils.js';
import { createWindow, focusWindow, getWindows } from '../windowManager.js';

let instance = null;

const PAGES = [
  ['perso', '🎨', 'Personnalisation'],
  ['system', '💻', 'Système'],
  ['apps', '🧩', 'Applications par défaut'],
];

function card(title, ...children) {
  return h('section', { class: 'st-card' }, h('h3', { text: title }), ...children);
}

function choice(options, current, onPick) {
  return h('div', { class: 'st-choices' }, options.map(([value, label, preview]) => h('button', {
    class: `st-choice${value === current ? ' active' : ''}`, type: 'button', onclick: () => onPick(value),
  }, preview || null, h('span', { text: label }))));
}

function persoPage(rerender) {
  const s = getSettings();
  const isImage = s.wallpaper.startsWith('image:');
  const wallpapers = h('div', { class: 'st-wallpapers' },
    WALLPAPERS.map((wp) => h('button', {
      class: `st-wp${s.wallpaper === wp.id ? ' active' : ''}`, type: 'button', title: wp.name,
      style: { background: wallpaperCss(wp.id, s.theme) },
      onclick: () => { setSettings({ wallpaper: wp.id }); rerender(); },
    }, h('span', { text: wp.name }))),
    h('button', {
      class: `st-wp st-wp-browse${isImage ? ' active' : ''}`, type: 'button', title: 'Choisir une image du VFS',
      style: isImage ? { background: wallpaperCss(s.wallpaper) } : {},
      onclick: async () => {
        const p = await fileDialog({
          mode: 'open', title: 'Choisir un fond d\'écran', startDir: '/Images',
          filter: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
        });
        if (p) {
          setSettings({ wallpaper: `image:${p}` });
          rerender();
        }
      },
    }, h('span', { text: isImage ? basename(s.wallpaper.slice(6)) : '📂 Parcourir…' })));

  const accents = h('div', { class: 'st-accents' },
    h('button', {
      class: `st-accent auto${!s.accent ? ' active' : ''}`, type: 'button', title: 'Automatique', text: 'Auto',
      onclick: () => { setSettings({ accent: '' }); rerender(); },
    }),
    ACCENTS.map((c) => h('button', {
      class: `st-accent${s.accent === c ? ' active' : ''}`, type: 'button', title: c, style: { background: c },
      onclick: () => { setSettings({ accent: c }); rerender(); },
    })));

  const nameInput = h('input', { class: 'input', type: 'text', value: s.userName, maxlength: '40' });
  nameInput.addEventListener('change', () => setSettings({ userName: nameInput.value.trim() || 'Utilisateur' }));

  return [
    h('h2', { text: 'Personnalisation' }),
    h('div', { class: 'st-preview', style: { background: wallpaperCss() } },
      h('div', { class: 'st-preview-window' }), h('div', { class: 'st-preview-bar' })),
    card('Choisir votre mode',
      choice([['light', 'Clair', h('span', { class: 'st-swatch light' })], ['dark', 'Sombre', h('span', { class: 'st-swatch dark' })]],
        s.theme, (v) => { setSettings({ theme: v }); rerender(); })),
    card('Style de l\'interface',
      choice([
        ['win11', 'Windows 11', h('span', { class: 'st-style win11' }, h('i'), h('b'))],
        ['win10', 'Windows 10', h('span', { class: 'st-style win10' }, h('i'), h('b'))],
      ], s.style, (v) => { setSettings({ style: v }); rerender(); }),
      h('p', { class: 'st-help', text: 'Windows 11 : barre des tâches centrée, coins arrondis, menu Démarrer flottant. Windows 10 : barre alignée à gauche, angles droits, menu Démarrer en deux colonnes.' })),
    card('Arrière-plan', wallpapers),
    card('Couleur d\'accentuation', accents),
    card('Compte', h('label', { class: 'st-row' }, h('span', { text: 'Nom affiché' }), nameInput)),
  ];
}

function systemPage() {
  const rows = [
    ['Système d\'exploitation', 'WinWeb 1.0 (simulation dans le navigateur)'],
    ['Style', getSettings().style === 'win10' ? 'Windows 10' : 'Windows 11'],
    ['Navigateur', navigator.userAgent],
    ['Résolution', `${window.screen.width} × ${window.screen.height} (zone : ${window.innerWidth} × ${window.innerHeight})`],
    ['Processeurs logiques', String(navigator.hardwareConcurrency || 'inconnu')],
    ['Langue', navigator.language],
    ['Fenêtres ouvertes', String(getWindows().length)],
    ['Taille max. d\'un dépôt', `${document.body.dataset.maxUpload || '?'} Mo`],
    ['Stockage', 'Serveur Flask local : dossier data/ (fichiers) + data/index.json (index)'],
  ];
  return [
    h('h2', { text: 'Système' }),
    card('Spécifications', h('dl', { class: 'st-dl' }, rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]))),
    card('Exécutables pris en charge', h('ul', { class: 'st-list' },
      h('li', { text: '.wapp — archive zip (manifest.json + application HTML/CSS/JS), lancée dans une iframe sandboxée.' }),
      h('li', { text: '.html / .htm — page lancée comme application dans une iframe sandboxée.' }),
      h('li', { text: '.js — script exécuté dans un bac à sable, sortie console affichée.' }),
      h('li', { text: '.exe — jamais exécuté : analyse de l\'en-tête PE uniquement.' }))),
  ];
}

function appsPage() {
  const groups = new Map();
  for (const [ext, id] of Object.entries(ASSOCIATIONS)) {
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(`.${ext}`);
  }
  return [
    h('h2', { text: 'Applications par défaut' }),
    card('Associations des types de fichiers', h('table', { class: 'st-table' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Application' }), h('th', { text: 'Extensions' }))),
      h('tbody', {}, [...groups].map(([id, exts]) => {
        const app = getApp(id);
        return h('tr', {},
          h('td', {}, h('span', { class: 'st-app-ico', html: appIcon(app?.icon) }), h('span', { text: app?.name || id })),
          h('td', { text: exts.join('  ') }));
      })))),
    h('p', { class: 'st-help', text: 'Les autres types de fichiers proposent « Ouvrir avec ». Clic droit sur un fichier → Ouvrir avec pour choisir une autre application.' }),
  ];
}

function launch({ page = 'perso' } = {}) {
  if (instance && getWindows().includes(instance.win)) {
    instance.show(page);
    focusWindow(instance.win);
    return instance.win;
  }
  const nav = h('nav', { class: 'st-nav' });
  const main = h('div', { class: 'st-main' });
  const root = h('div', { class: 'settings' },
    h('div', { class: 'st-side' },
      h('div', { class: 'st-user' }, h('span', { class: 'st-avatar', text: '👤' }),
        h('div', {}, h('strong', { class: 'st-username' }), h('div', { class: 'st-sub', text: 'Compte local' }))),
      nav),
    main);
  const win = createWindow({
    appId: 'settings', title: 'Paramètres', icon: '⚙️', width: 900, height: 620, minWidth: 560, minHeight: 380, content: root,
  });
  let current = page;
  function show(p) {
    current = PAGES.some(([id]) => id === p) ? p : 'perso';
    root.querySelector('.st-username').textContent = getSettings().userName;
    nav.replaceChildren(...PAGES.map(([id, icon, label]) => h('button', {
      class: `st-nav-item${id === current ? ' active' : ''}`, type: 'button', onclick: () => show(id),
    }, h('span', { text: icon }), h('span', { text: label }))));
    const scroll = main.scrollTop;
    const builders = { perso: () => persoPage(() => show(current)), system: systemPage, apps: appsPage };
    main.replaceChildren(...builders[current]());
    main.scrollTop = scroll;
  }
  instance = { win, show };
  win.onDestroy = () => { instance = null; };
  show(current);
  return win;
}

export default { id: 'settings', name: 'Paramètres', icon: '⚙️', launch, description: 'Thème, fond d\'écran, style Windows 10/11' };
