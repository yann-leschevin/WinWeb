// Fenêtre « Propriétés », boîte « Ouvrir avec » et téléchargement d'un fichier.
import { api } from '../api.js';
import { iconForEntry } from '../icons.js';
import { getApp, launchApp, openPath, openWithChoices } from '../registry.js';
import {
  basename, dirname, formatDate, formatSize, h, rawUrl, toWinPath,
} from '../utils.js';
import { createWindow } from '../windowManager.js';
import { typeName } from './explorer.js';

function launchProperties({ path }) {
  const body = h('div', { class: 'props' }, h('div', { class: 'sb-loading', text: 'Chargement…' }));
  const win = createWindow({
    appId: 'properties', title: `Propriétés de ${basename(path) || 'Ce PC'}`, icon: 'ℹ️',
    width: 420, height: 470, resizable: false, maximizable: false, content: body,
  });
  api.stat(path).then((e) => {
    const rows = [
      ['Type', typeName(e)],
      ['Emplacement', toWinPath(dirname(e.path))],
      ['Taille', `${formatSize(e.size)} (${e.size.toLocaleString('fr-FR')} octets)`],
      e.type === 'dir' && ['Contenu', `${e.files} fichier(s), ${e.dirs} dossier(s)`],
      null,
      ['Créé le', formatDate(e.created)],
      ['Modifié le', formatDate(e.modified)],
      e.original && ['Emplacement d\'origine', toWinPath(e.original)],
      e.deleted && ['Supprimé le', formatDate(e.deleted)],
      e.type === 'file' && ['Ouvrir avec', getApp(openWithChoices(e.path)[0][0])?.name || 'Bloc-notes'],
    ];
    body.replaceChildren(
      h('div', { class: 'props-head' }, h('span', { class: 'props-ico', html: iconForEntry(e) }),
        h('input', { class: 'input', type: 'text', value: e.name || 'Ce PC', readonly: true })),
      h('div', { class: 'props-sep' }),
      h('dl', { class: 'props-dl' }, rows.flatMap((r) => (r === null ? [h('div', { class: 'props-sep wide' })]
        : r ? [h('dt', { text: r[0] }), h('dd', { text: r[1] })] : []))),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', type: 'button', text: 'Ouvrir', onclick: () => { win.close(); openPath(e.path, e); } }),
        h('button', { class: 'btn primary', type: 'button', text: 'OK', onclick: () => win.close() })),
    );
  }).catch((err) => body.replaceChildren(h('div', { class: 'pe-error', text: err.message })));
  return win;
}

function launchOpenWith({ path }) {
  const choices = openWithChoices(path);
  const body = h('div', { class: 'dialog openwith' },
    h('div', { class: 'dialog-text', text: `Comment voulez-vous ouvrir « ${basename(path)} » ?` }),
    h('div', { class: 'ow-list' }, choices.map(([id, name]) => h('button', {
      class: 'ow-item', type: 'button',
      onclick: () => { win.close(); launchApp(id, { path }); },
    }, h('span', { text: getApp(id)?.icon || '🪟' }), h('span', { text: name }))),
    h('button', {
      class: 'ow-item', type: 'button', onclick: () => { win.close(); launchApp('download', { path }); },
    }, h('span', { text: '⬇️' }), h('span', { text: 'Télécharger sur cet ordinateur' }))),
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', type: 'button', text: 'Annuler', onclick: () => win.close() })));
  const win = createWindow({
    appId: 'dialog', title: 'Ouvrir avec', icon: '🧭', width: 420, height: 360, resizable: false, maximizable: false, content: body,
  });
  return win;
}

function launchDownload({ path }) {
  const a = h('a', { href: rawUrl(path, true), download: basename(path), class: 'hidden' });
  document.body.append(a);
  a.click();
  a.remove();
  return null;
}

export const propertiesApp = { id: 'properties', name: 'Propriétés', icon: 'ℹ️', hidden: true, launch: launchProperties };
export const openWithApp = { id: 'openwith', name: 'Ouvrir avec', icon: '🧭', hidden: true, launch: launchOpenWith };
export const downloadApp = { id: 'download', name: 'Télécharger', icon: '⬇️', hidden: true, launch: launchDownload };
