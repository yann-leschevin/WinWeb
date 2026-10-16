// Gestionnaire de fenêtres : création, focus/z-index, réduire, agrandir,
// restaurer, déplacement, redimensionnement par les bords et ancrage (snap).
import { emit } from './bus.js';
import { appIcon } from './icons.js';
import { clamp, h } from './utils.js';

const windows = new Map();
let nextId = 1;
let zTop = 10;
let activeId = null;
let cascadeIndex = 0;

const layer = () => document.getElementById('window-layer');
const snapPreview = () => document.getElementById('snap-preview');
const changed = () => emit('windows-changed', getWindows());

const GLYPHS = {
  min: '<svg viewBox="0 0 10 10"><path d="M1 5.5h8" stroke="currentColor" stroke-width="1"/></svg>',
  max: '<svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" rx=".8" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  restore: '<svg viewBox="0 0 10 10"><rect x="1.5" y="3" width="5.5" height="5.5" rx=".8" fill="none" stroke="currentColor"/><path d="M3 3V1.8h5.2V7H7" fill="none" stroke="currentColor"/></svg>',
  close: '<svg viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1"/></svg>',
};

export function getWindows() {
  return [...windows.values()];
}
export function getWindow(id) {
  return windows.get(id);
}
export function activeWindow() {
  return windows.get(activeId) || null;
}
export function findWindow(predicate) {
  return getWindows().find(predicate) || null;
}

/** Écran de téléphone : trop étroit pour des fenêtres flottantes. */
export function isCompact() {
  return window.innerWidth < 640;
}

function layerRect() {
  return layer().getBoundingClientRect();
}

function topVisible(exceptId) {
  return getWindows()
    .filter((w) => !w.minimized && w.id !== exceptId)
    .sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex))[0] || null;
}

export function focusWindow(win) {
  if (!win || !windows.has(win.id)) return;
  if (activeId === win.id && !win.minimized && Number(win.el.style.zIndex) === zTop) return;
  if (win.minimized) {
    win.minimized = false;
    win.el.classList.remove('minimized');
  }
  if (activeId !== win.id || Number(win.el.style.zIndex) !== zTop) {
    zTop += 1;
    win.el.style.zIndex = String(zTop);
  }
  for (const w of windows.values()) w.el.classList.toggle('active', w === win);
  activeId = win.id;
  changed();
}

export function blurAll() {
  if (activeId === null) return;
  activeId = null;
  for (const w of windows.values()) w.el.classList.remove('active');
  changed();
}

/** Clic sur un bouton de la barre des tâches : réduit si active, sinon met au premier plan. */
export function toggleFromTaskbar(win) {
  if (win.id === activeId && !win.minimized) win.minimize();
  else focusWindow(win);
}

let desktopShown = null;
export function showDesktop() {
  const visible = getWindows().filter((w) => !w.minimized);
  if (visible.length) {
    desktopShown = visible.map((w) => w.id);
    visible.forEach((w) => w.minimize());
  } else if (desktopShown) {
    desktopShown.map((id) => windows.get(id)).filter(Boolean).forEach((w) => focusWindow(w));
    desktopShown = null;
  }
}

function setRect(win, rect) {
  const s = win.el.style;
  s.left = `${Math.round(rect.x)}px`;
  s.top = `${Math.round(rect.y)}px`;
  s.width = `${Math.round(rect.w)}px`;
  s.height = `${Math.round(rect.h)}px`;
}

function currentRect(win) {
  return {
    x: win.el.offsetLeft, y: win.el.offsetTop, w: win.el.offsetWidth, h: win.el.offsetHeight,
  };
}

function applyLayout(win) {
  const L = layerRect();
  const el = win.el;
  el.classList.toggle('maximized', win.layout === 'max');
  el.classList.toggle('snapped', win.layout === 'left' || win.layout === 'right');
  if (win.layout === 'max') setRect(win, { x: 0, y: 0, w: L.width, h: L.height });
  else if (win.layout === 'left') setRect(win, { x: 0, y: 0, w: L.width / 2, h: L.height });
  else if (win.layout === 'right') setRect(win, { x: L.width / 2, y: 0, w: L.width / 2, h: L.height });
  else setRect(win, win.normalRect);
  const maxBtn = el.querySelector('.wc-max');
  if (maxBtn) {
    maxBtn.innerHTML = win.layout === 'max' ? GLYPHS.restore : GLYPHS.max;
    maxBtn.title = win.layout === 'max' ? 'Niveau inférieur' : 'Agrandir';
  }
  win.onResize?.();
}

function setLayout(win, layout) {
  if (win.layout === 'normal') win.normalRect = currentRect(win);
  win.layout = layout;
  applyLayout(win);
  changed();
}

/**
 * Crée une fenêtre.
 * options : { appId, title, icon, width, height, x, y, minWidth, minHeight,
 *             resizable, maximizable, content: Node, className, onClose(): bool|Promise<bool> }
 */
export function createWindow(options = {}) {
  const o = {
    appId: 'app', title: 'Fenêtre', icon: '🪟', width: 720, height: 480,
    minWidth: 300, minHeight: 200, resizable: true, maximizable: true, ...options,
  };
  const id = `w${nextId++}`;
  const L = layerRect();
  const minW = Math.min(o.minWidth, L.width - 8);
  const minH = Math.min(o.minHeight, L.height - 8);
  const w = clamp(o.width, minW, Math.max(minW, L.width - 20));
  const hgt = clamp(o.height, minH, Math.max(minH, L.height - 20));
  const offset = (cascadeIndex++ % 8) * 28;
  const x = o.x ?? clamp((L.width - w) / 2 - 120 + offset, Math.min(8, (L.width - w) / 2), Math.max(8, L.width - w - 8));
  const y = o.y ?? clamp((L.height - hgt) / 2 - 60 + offset, 8, Math.max(8, L.height - hgt - 8));

  const iconEl = h('span', { class: 'win-icon', html: appIcon(o.icon) });
  const titleEl = h('span', { class: 'win-title', text: o.title });
  const btnMin = h('button', { class: 'wc wc-min', title: 'Réduire', html: GLYPHS.min, type: 'button' });
  const btnMax = o.maximizable && o.resizable
    ? h('button', { class: 'wc wc-max', title: 'Agrandir', html: GLYPHS.max, type: 'button' }) : null;
  const btnClose = h('button', { class: 'wc wc-close', title: 'Fermer', html: GLYPHS.close, type: 'button' });
  const titlebar = h('div', { class: 'win-titlebar' }, iconEl, titleEl,
    h('div', { class: 'win-controls' }, btnMin, btnMax, btnClose));
  const body = h('div', { class: 'win-body' });
  const el = h('div', {
    class: `window ${o.className || ''}`, role: 'dialog', 'aria-label': o.title, dataset: { id, app: o.appId },
  }, titlebar, body);
  if (o.content) body.append(o.content);

  const win = {
    id, el, body, titlebar, appId: o.appId, title: o.title, icon: o.icon,
    layout: 'normal', minimized: false, normalRect: { x, y, w, h: hgt },
    minWidth: o.minWidth, minHeight: o.minHeight, onClose: o.onClose, onResize: o.onResize,
    createdAt: Date.now(),
    setTitle(text) {
      win.title = text;
      titleEl.textContent = text;
      el.setAttribute('aria-label', text);
      changed();
    },
    setIcon(icon) {
      win.icon = icon;
      iconEl.innerHTML = appIcon(icon);
      changed();
    },
    focus: () => focusWindow(win),
    /** Redimensionne (et recentre) la fenêtre en mode normal, dans les limites de l'écran. */
    resizeTo(width, height) {
      const L = layerRect();
      const nw = clamp(width, win.minWidth, Math.max(win.minWidth, L.width - 16));
      const nh = clamp(height, win.minHeight, Math.max(win.minHeight, L.height - 16));
      win.normalRect = {
        x: Math.max(8, (L.width - nw) / 2), y: Math.max(8, (L.height - nh) / 2 - 20), w: nw, h: nh,
      };
      win.layout = 'normal';
      applyLayout(win);
    },
    minimize() {
      win.minimized = true;
      el.classList.add('minimized');
      if (activeId === win.id) {
        activeId = null;
        el.classList.remove('active');
        const next = topVisible(win.id);
        if (next) focusWindow(next);
      }
      changed();
    },
    maximize: () => setLayout(win, 'max'),
    restore: () => setLayout(win, 'normal'),
    toggleMaximize: () => setLayout(win, win.layout === 'max' ? 'normal' : 'max'),
    snap: (side) => setLayout(win, side),
    async close(force = false) {
      if (!windows.has(win.id)) return;
      if (!force && win.onClose) {
        const ok = await win.onClose();
        if (ok === false) return;
      }
      windows.delete(win.id);
      el.classList.add('closing');
      setTimeout(() => el.remove(), 140);
      win.onDestroy?.();
      if (activeId === win.id) {
        activeId = null;
        const next = topVisible(win.id);
        if (next) focusWindow(next);
      }
      changed();
    },
  };

  btnMin.addEventListener('click', (e) => { e.stopPropagation(); win.minimize(); });
  btnMax?.addEventListener('click', (e) => { e.stopPropagation(); win.toggleMaximize(); });
  btnClose.addEventListener('click', (e) => { e.stopPropagation(); win.close(); });
  el.addEventListener('pointerdown', () => focusWindow(win), true);
  titlebar.addEventListener('dblclick', (e) => {
    if (!e.target.closest('.wc') && btnMax) win.toggleMaximize();
  });
  titlebar.addEventListener('pointerdown', (e) => startMove(win, e));

  if (o.resizable) {
    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const handle = h('div', { class: `rz rz-${dir}` });
      handle.addEventListener('pointerdown', (e) => startResize(win, dir, e));
      el.append(handle);
    }
  } else {
    el.classList.add('fixed-size');
  }

  windows.set(id, win);
  setRect(win, win.normalRect);
  layer().append(el);
  focusWindow(win);
  // Petit écran (téléphone) : les fenêtres redimensionnables s'ouvrent en plein écran
  if (o.maximized || (isCompact() && btnMax)) win.maximize();
  return win;
}

// --------------------------------------------------------------- déplacement
function snapZone(e) {
  const L = layerRect();
  if (e.clientY <= L.top + 2) return 'max';
  if (e.clientX <= L.left + 2) return 'left';
  if (e.clientX >= L.right - 3) return 'right';
  return null;
}

function showSnapPreview(zone) {
  const p = snapPreview();
  if (!zone) {
    p.classList.add('hidden');
    return;
  }
  const L = layerRect();
  const rects = {
    max: [0, 0, L.width, L.height],
    left: [0, 0, L.width / 2, L.height],
    right: [L.width / 2, 0, L.width / 2, L.height],
  };
  const [x, y, w, hh] = rects[zone];
  Object.assign(p.style, { left: `${x + 6}px`, top: `${y + 6}px`, width: `${w - 12}px`, height: `${hh - 12}px` });
  p.classList.remove('hidden');
}

function startMove(win, e) {
  if (e.button !== 0 || e.target.closest('.wc')) return;
  e.preventDefault();
  const titlebar = win.titlebar;
  titlebar.setPointerCapture(e.pointerId);
  const startX = e.clientX;
  const startY = e.clientY;
  let origin = currentRect(win);
  let moved = false;
  let zone = null;
  document.body.classList.add('wm-busy');

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    if (!moved) {
      moved = true;
      if (win.layout !== 'normal') {
        // Détache une fenêtre agrandie/ancrée en conservant la position relative du curseur.
        const ratio = (startX - win.el.getBoundingClientRect().left) / win.el.offsetWidth;
        const L = layerRect();
        const nr = win.normalRect;
        win.layout = 'normal';
        win.normalRect = { ...nr, x: startX - L.left - nr.w * ratio, y: Math.max(0, startY - L.top - 16) };
        applyLayout(win);
        origin = currentRect(win);
        changed();
      }
    }
    const L = layerRect();
    const nx = clamp(origin.x + dx, -origin.w + 80, L.width - 80);
    const ny = clamp(origin.y + dy, 0, L.height - 32);
    win.el.style.left = `${nx}px`;
    win.el.style.top = `${ny}px`;
    zone = snapZone(ev);
    showSnapPreview(zone);
  };
  const onUp = () => {
    titlebar.removeEventListener('pointermove', onMove);
    titlebar.removeEventListener('pointerup', onUp);
    titlebar.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('wm-busy');
    showSnapPreview(null);
    if (!moved) return;
    win.normalRect = currentRect(win);
    if (zone && (zone !== 'max' || win.el.querySelector('.wc-max'))) setLayout(win, zone);
  };
  titlebar.addEventListener('pointermove', onMove);
  titlebar.addEventListener('pointerup', onUp);
  titlebar.addEventListener('pointercancel', onUp);
}

// --------------------------------------------------------------- redimensionnement
function startResize(win, dir, e) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  focusWindow(win);
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  if (win.layout !== 'normal') {
    win.normalRect = currentRect(win);
    win.layout = 'normal';
    applyLayout(win);
  }
  const start = currentRect(win);
  const sx = e.clientX;
  const sy = e.clientY;
  const L = layerRect();
  document.body.classList.add('wm-busy');

  const onMove = (ev) => {
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    let { x, y, w, h: hh } = start;
    if (dir.includes('e')) w = clamp(start.w + dx, win.minWidth, L.width - start.x);
    if (dir.includes('s')) hh = clamp(start.h + dy, win.minHeight, L.height - start.y);
    if (dir.includes('w')) {
      w = clamp(start.w - dx, win.minWidth, start.x + start.w);
      x = start.x + start.w - w;
    }
    if (dir.includes('n')) {
      hh = clamp(start.h - dy, win.minHeight, start.y + start.h);
      y = start.y + start.h - hh;
    }
    setRect(win, { x, y, w, h: hh });
    win.onResize?.();
  };
  const onUp = () => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('wm-busy');
    win.normalRect = currentRect(win);
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}

export function closeAllWindows() {
  for (const w of getWindows()) w.close(true);
}

export function initWindowManager() {
  // Un clic dans une iframe ne remonte pas jusqu'au document : on détecte le
  // changement de focus pour activer la fenêtre correspondante.
  window.addEventListener('blur', () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active.tagName === 'IFRAME') {
        const winEl = active.closest('.window');
        if (winEl) focusWindow(windows.get(winEl.dataset.id));
      }
    }, 0);
  });
  window.addEventListener('resize', () => {
    const L = layerRect();
    for (const win of windows.values()) {
      if (win.layout !== 'normal') applyLayout(win);
      else {
        const r = win.normalRect;
        r.x = clamp(r.x, -r.w + 80, Math.max(0, L.width - 80));
        r.y = clamp(r.y, 0, Math.max(0, L.height - 32));
        setRect(win, r);
      }
    }
  });
}
