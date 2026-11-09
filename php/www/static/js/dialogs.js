// Boîtes de dialogue de l'OS : message, confirmation, saisie, ouverture/enregistrement.
import { api } from './api.js';
import { iconForEntry } from './icons.js';
import { basename, dirname, h, joinPath, toWinPath } from './utils.js';
import { createWindow } from './windowManager.js';

function dialogWindow({ title, icon = 'ℹ️', width = 420, height = 200, content }) {
  return createWindow({
    appId: 'dialog', title, icon, width, height, resizable: false, maximizable: false,
    className: 'dialog-window', content,
  });
}

export function alertDialog(message, { title = 'WinWeb', icon = 'ℹ️' } = {}) {
  return new Promise((resolve) => {
    const ok = h('button', { class: 'btn primary', type: 'button', text: 'OK' });
    const content = h('div', { class: 'dialog' },
      h('div', { class: 'dialog-main' }, h('div', { class: 'dialog-icon', text: icon }),
        h('div', { class: 'dialog-text', text: message })),
      h('div', { class: 'dialog-buttons' }, ok));
    const win = dialogWindow({ title, icon, content, height: 190 });
    win.onClose = () => { resolve(); return true; };
    ok.addEventListener('click', () => win.close());
    setTimeout(() => ok.focus(), 30);
  });
}

export function confirmDialog(message, { title = 'Confirmation', icon = '❓', okLabel = 'Oui', cancelLabel = 'Non', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', text: okLabel });
    const cancel = h('button', { class: 'btn', type: 'button', text: cancelLabel });
    const content = h('div', { class: 'dialog' },
      h('div', { class: 'dialog-main' }, h('div', { class: 'dialog-icon', text: icon }),
        h('div', { class: 'dialog-text', text: message })),
      h('div', { class: 'dialog-buttons' }, ok, cancel));
    const win = dialogWindow({ title, icon, content, height: 200 });
    win.onClose = () => { resolve(result); return true; };
    ok.addEventListener('click', () => { result = true; win.close(); });
    cancel.addEventListener('click', () => win.close());
    content.addEventListener('keydown', (e) => { if (e.key === 'Escape') win.close(); });
    setTimeout(() => ok.focus(), 30);
  });
}

/** Choix parmi 3 boutons (ex. Enregistrer / Ne pas enregistrer / Annuler). Retourne l'index ou -1. */
export function choiceDialog(message, labels, { title = 'WinWeb', icon = '❓' } = {}) {
  return new Promise((resolve) => {
    let result = -1;
    const buttons = labels.map((label, i) => h('button', {
      class: `btn ${i === 0 ? 'primary' : ''}`, type: 'button', text: label,
      onclick: () => { result = i === labels.length - 1 ? -1 : i; win.close(); },
    }));
    const content = h('div', { class: 'dialog' },
      h('div', { class: 'dialog-main' }, h('div', { class: 'dialog-icon', text: icon }),
        h('div', { class: 'dialog-text', text: message })),
      h('div', { class: 'dialog-buttons' }, buttons));
    const win = dialogWindow({ title, icon, content, width: 460, height: 200 });
    win.onClose = () => { resolve(result); return true; };
    setTimeout(() => buttons[0].focus(), 30);
  });
}

export function promptDialog(message, value = '', { title = 'WinWeb', icon = '✏️', okLabel = 'OK', selectStem = false } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input', { class: 'input', type: 'text', value, spellcheck: 'false' });
    const ok = h('button', { class: 'btn primary', type: 'submit', text: okLabel });
    const cancel = h('button', { class: 'btn', type: 'button', text: 'Annuler' });
    const form = h('form', { class: 'dialog' },
      h('div', { class: 'dialog-main column' }, h('label', { class: 'dialog-text', text: message }), input),
      h('div', { class: 'dialog-buttons' }, ok, cancel));
    const win = dialogWindow({ title, icon, content: form, height: 210 });
    win.onClose = () => { resolve(result); return true; };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      result = input.value;
      win.close();
    });
    cancel.addEventListener('click', () => win.close());
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') win.close(); });
    setTimeout(() => {
      input.focus();
      const dot = value.lastIndexOf('.');
      if (selectStem && dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    }, 30);
  });
}

/**
 * Sélecteur de fichier intégré au VFS.
 * mode 'open' | 'save' ; filter : liste d'extensions acceptées (open) ; retourne le chemin ou null.
 */
export function fileDialog({ mode = 'open', title, startDir = '/Documents', defaultName = '', filter = null } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let cwd = startDir;
    const places = [['🖥️ Bureau', '/Bureau'], ['📄 Documents', '/Documents'], ['🖼️ Images', '/Images'],
      ['⬇️ Téléchargements', '/Téléchargements'], ['🧰 Programmes', '/Programmes'], ['💻 Ce PC', '/']];
    const address = h('div', { class: 'fd-address' });
    const list = h('div', { class: 'fd-list' });
    const nameInput = h('input', { class: 'input', type: 'text', value: defaultName, placeholder: 'Nom du fichier' });
    const okBtn = h('button', { class: 'btn primary', type: 'submit', text: mode === 'save' ? 'Enregistrer' : 'Ouvrir' });
    const cancelBtn = h('button', { class: 'btn', type: 'button', text: 'Annuler' });
    const upBtn = h('button', { class: 'btn icon', type: 'button', title: 'Dossier parent', text: '↑' });
    const sidebar = h('div', { class: 'fd-sidebar' }, places.map(([label, path]) =>
      h('button', { class: 'fd-place', type: 'button', text: label, onclick: () => load(path) })));
    const form = h('form', { class: 'file-dialog' },
      h('div', { class: 'fd-top' }, upBtn, address),
      h('div', { class: 'fd-middle' }, sidebar, list),
      h('div', { class: 'fd-bottom' }, h('label', { text: 'Nom :' }), nameInput, okBtn, cancelBtn));
    const win = createWindow({
      appId: 'dialog', title: title || (mode === 'save' ? 'Enregistrer sous' : 'Ouvrir'),
      icon: mode === 'save' ? '💾' : '📂', width: 640, height: 440, minWidth: 460, minHeight: 320, content: form,
    });
    win.onClose = () => { resolve(result); return true; };

    async function load(path) {
      try {
        const entries = await api.list(path);
        cwd = path;
        address.textContent = toWinPath(path);
        list.replaceChildren();
        const shown = entries.filter((e) => e.type === 'dir' || !filter || filter.includes(e.ext));
        if (!shown.length) list.append(h('div', { class: 'fd-empty', text: 'Ce dossier est vide.' }));
        for (const entry of shown) {
          const row = h('div', { class: 'fd-item', tabindex: '0' },
            h('span', { class: 'fd-ico', html: iconForEntry(entry) }), h('span', { text: entry.name }));
          row.addEventListener('click', () => {
            list.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
            row.classList.add('selected');
            if (entry.type === 'file') nameInput.value = entry.name;
          });
          row.addEventListener('dblclick', () => {
            if (entry.type === 'dir') load(entry.path);
            else { nameInput.value = entry.name; form.requestSubmit(); }
          });
          list.append(row);
        }
      } catch (err) {
        list.replaceChildren(h('div', { class: 'fd-empty', text: err.message }));
      }
    }

    upBtn.addEventListener('click', () => load(dirname(cwd)));
    cancelBtn.addEventListener('click', () => win.close());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      const target = name.startsWith('/') ? name : joinPath(cwd, name);
      if (mode === 'open') {
        result = target;
        win.close();
        return;
      }
      try {
        const existing = await api.list(dirname(target));
        if (existing.some((en) => en.name === basename(target))) {
          const ok = await confirmDialog(`« ${basename(target)} » existe déjà.\nVoulez-vous le remplacer ?`,
            { title: 'Confirmer l\'enregistrement', icon: '⚠️' });
          if (!ok) return;
        }
      } catch { /* dossier inexistant : le serveur renverra une erreur explicite */ }
      result = target;
      win.close();
    });
    load(startDir);
    setTimeout(() => nameInput.focus(), 30);
  });
}
