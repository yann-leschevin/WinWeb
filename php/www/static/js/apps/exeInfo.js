// « Propriétés de l'exécutable » : analyse de l'en-tête PE d'un .exe/.dll.
// Le fichier n'est jamais exécuté, ni côté serveur ni dans le navigateur.
import { api } from '../api.js';
import { basename, formatSize, h, toWinPath } from '../utils.js';
import { createWindow } from '../windowManager.js';

function table(rows) {
  return h('table', { class: 'pe-table' }, h('tbody', {}, rows.filter(Boolean).map(([k, v, cls]) => h('tr', {},
    h('th', { text: k }), h('td', { class: cls || '', text: v })))));
}

function render(info, path) {
  const yes = (b) => (b ? '✔ Oui' : '✘ Non');
  const parts = [
    h('div', { class: 'pe-head' },
      h('div', { class: 'pe-big-ico', text: info.valid ? (info.subsystem_kind === 'Console' ? '⬛' : '🪟') : '❓' }),
      h('div', {},
        h('div', { class: 'pe-name', text: basename(path) }),
        h('div', { class: 'pe-sub', text: `${toWinPath(path)} · ${formatSize(info.file_size)}` }))),
    h('div', { class: 'pe-warning' },
      h('strong', { text: 'Exécution native non disponible. ' }),
      'Un navigateur ne peut pas exécuter de programme Windows natif, et WinWeb ne lance jamais un fichier .exe '
      + '(ni dans le navigateur, ni sur le serveur). Seuls les en-têtes du fichier sont lus et décodés ci-dessous. '
      + 'Pour une application exécutable dans WinWeb, utilisez le format .wapp, une page .html ou un script .js.'),
  ];
  if (!info.valid) {
    parts.push(h('div', { class: 'pe-error', text: `Analyse impossible : ${info.error}` }));
    return parts;
  }
  parts.push(
    h('h3', { text: 'En-tête' }),
    table([
      ['Signature MZ (DOS)', '✔ Présente (« MZ »)', 'ok'],
      ['Signature PE', `✔ Présente (« PE\\0\\0 » à l'offset 0x${info.pe_offset.toString(16).toUpperCase()})`, 'ok'],
      ['Format', `${info.format} (${info.bits} bits)`],
      ['Architecture', `${info.machine} — ${info.machine_code}`],
      ['Type', info.is_dll ? 'Bibliothèque de liens dynamiques (DLL)' : 'Application exécutable'],
      ['Sous-système', `${info.subsystem}${info.subsystem_kind ? ` — ${info.subsystem_kind}` : ''}`],
      info.dotnet !== undefined && ['Assemblage .NET', yes(info.dotnet)],
      ['Horodatage de compilation', `${info.timestamp_iso} (0x${info.timestamp.toString(16).toUpperCase()})`],
      info.timestamp_note && ['Remarque', info.timestamp_note, 'warn'],
      info.entry_point && ['Point d\'entrée (RVA)', info.entry_point],
      info.image_base && ['Adresse de base', info.image_base],
      info.linker_version && ['Éditeur de liens', info.linker_version],
      info.os_version && ['Version de l\'OS requise', info.os_version],
      ['Nombre de sections', String(info.sections_count)],
      ['Caractéristiques', info.characteristics.join(', ') || '—'],
      info.dll_characteristics && ['Protections', info.dll_characteristics.join(', ') || '—'],
    ]),
    h('h3', { text: `Sections (${info.sections.length})` }),
    h('table', { class: 'pe-table pe-sections' },
      h('thead', {}, h('tr', {}, ['Nom', 'Adresse virtuelle', 'Taille virtuelle', 'Taille brute', 'Attributs'].map((t) => h('th', { text: t })))),
      h('tbody', {}, info.sections.map((s) => h('tr', {},
        h('td', { class: 'mono', text: s.name }), h('td', { class: 'mono', text: s.virtual_address }),
        h('td', { class: 'num', text: formatSize(s.virtual_size) }), h('td', { class: 'num', text: formatSize(s.raw_size) }),
        h('td', { text: s.flags.join(', ') }))))),
  );
  if (info.warning) parts.push(h('div', { class: 'pe-error', text: info.warning }));
  return parts;
}

function launch({ path }) {
  const body = h('div', { class: 'pe-info' }, h('div', { class: 'sb-loading', text: 'Analyse de l\'en-tête PE…' }));
  const win = createWindow({
    appId: 'exeinfo', title: `Propriétés de l'exécutable — ${basename(path)}`, icon: '⚙️',
    width: 680, height: 600, minWidth: 420, minHeight: 300, content: body,
  });
  api.pe(path)
    .then((info) => body.replaceChildren(...render(info, path)))
    .catch((err) => body.replaceChildren(h('div', { class: 'pe-error', text: err.message })));
  return win;
}

export default {
  id: 'exeinfo', name: 'Propriétés de l\'exécutable', icon: '⚙️', hidden: true, launch,
  description: 'Analyse de l\'en-tête PE des fichiers .exe',
};
