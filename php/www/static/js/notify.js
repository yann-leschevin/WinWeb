// Notifications « toast » en bas à droite.
import { h } from './utils.js';

/** Affiche une notification ; retourne un objet permettant de la mettre à jour. */
export function toast(title, message = '', { icon = 'ℹ️', timeout = 4500, progress = false } = {}) {
  const bar = progress ? h('div', { class: 'toast-progress' }, h('i')) : null;
  const msg = h('div', { class: 'toast-msg', text: message });
  const node = h('div', { class: 'toast' },
    h('div', { class: 'toast-icon', text: icon }),
    h('div', { class: 'toast-body' }, h('div', { class: 'toast-title', text: title }), msg, bar),
    h('button', { class: 'toast-close', title: 'Fermer', text: '✕', onclick: () => close() }));
  document.getElementById('toasts').append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  let timer = null;
  function close() {
    clearTimeout(timer);
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  }
  if (timeout) timer = setTimeout(close, timeout);
  return {
    close,
    update(text, ratio) {
      if (text !== undefined) msg.textContent = text;
      if (bar && ratio !== undefined) bar.firstChild.style.width = `${Math.round(ratio * 100)}%`;
    },
    later(ms = 3500) {
      clearTimeout(timer);
      timer = setTimeout(close, ms);
    },
  };
}

export const toastError = (message, title = 'Erreur') => toast(title, message, { icon: '⛔', timeout: 6000 });
