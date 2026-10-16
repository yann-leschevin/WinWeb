// Menus contextuels (clic droit) avec sous-menus simples.
import { h } from './utils.js';

let current = null;

export function closeMenu() {
  if (current) {
    current.remove();
    current = null;
  }
}

function buildMenu(items) {
  const menu = h('div', { class: 'ctx-menu', role: 'menu' });
  for (const item of items) {
    if (!item) continue;
    if (item.separator) {
      menu.append(h('div', { class: 'ctx-sep' }));
      continue;
    }
    const row = h('div', {
      class: `ctx-item${item.disabled ? ' disabled' : ''}${item.submenu ? ' has-sub' : ''}`,
      role: 'menuitem',
    },
    h('span', { class: 'ctx-icon', html: item.icon || '' }),
    h('span', { class: 'ctx-label', text: item.label }),
    h('span', { class: 'ctx-hint', text: item.submenu ? '›' : (item.hint || '') }));
    if (item.checked) row.classList.add('checked');
    if (item.submenu) {
      const sub = buildMenu(item.submenu);
      sub.classList.add('ctx-sub');
      row.append(sub);
    } else if (!item.disabled) {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        item.action?.();
      });
    }
    menu.append(row);
  }
  return menu;
}

/** Affiche un menu à la position (x, y). items: [{label, icon, action, disabled, hint, submenu}|{separator:true}] */
export function showMenu(x, y, items) {
  closeMenu();
  const menu = buildMenu(items);
  document.getElementById('context-menu-layer').append(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 4);
  const top = y + rect.height > window.innerHeight - 4 ? Math.max(4, y - rect.height) : y;
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${top}px`;
  if (left + rect.width * 2 > window.innerWidth) menu.classList.add('subs-left');
  current = menu;
}

export function initContextMenu() {
  document.addEventListener('pointerdown', (e) => {
    if (current && !current.contains(e.target)) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
  // Désactive le menu natif du navigateur sauf dans les champs de saisie.
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('input, textarea, [contenteditable="true"]')) e.preventDefault();
  });
}
