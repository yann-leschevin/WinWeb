// Éléments d'interface partagés par les applications.
import { showMenu } from '../contextMenu.js';
import { h } from '../utils.js';

/** Barre de menus : [{label: 'Fichier', items: () => [...éléments de menu]}] */
export function menuBar(menus) {
  return h('div', { class: 'app-menubar' }, menus.map((m) => h('button', {
    class: 'app-menu-btn', type: 'button', text: m.label,
    onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      showMenu(r.left, r.bottom + 2, m.items());
    },
  })));
}
