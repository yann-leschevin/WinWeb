// Bloc-notes : ouvrir / enregistrer des fichiers texte du VFS.
import { api } from '../api.js';
import { fsChanged } from '../bus.js';
import { choiceDialog, fileDialog } from '../dialogs.js';
import { toast, toastError } from '../notify.js';
import { basename, dirname, h } from '../utils.js';
import { createWindow } from '../windowManager.js';
import { menuBar } from './common.js';

function launch({ path = null } = {}) {
  const state = { path, saved: '', wrap: true, fontSize: 15, statusBar: true };
  const text = h('textarea', { class: 'np-text', spellcheck: 'false', wrap: 'soft' });
  const status = h('div', { class: 'np-status' });
  const win = createWindow({
    appId: 'notepad', title: 'Bloc-notes', icon: '📝', width: 720, height: 500, minWidth: 320, minHeight: 200,
  });

  const dirty = () => text.value !== state.saved;
  const updateTitle = () => win.setTitle(`${dirty() ? '*' : ''}${state.path ? basename(state.path) : 'Sans titre'} - Bloc-notes`);
  function updateStatus() {
    const before = text.value.slice(0, text.selectionStart);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    status.textContent = `Ln ${line}, Col ${col}   |   ${text.value.length} caractères   |   ${Math.round(state.fontSize / 15 * 100)} %   |   UTF-8`;
    status.classList.toggle('hidden', !state.statusBar);
  }
  function applyFormat() {
    text.style.fontSize = `${state.fontSize}px`;
    text.wrap = state.wrap ? 'soft' : 'off';
    text.classList.toggle('nowrap', !state.wrap);
    updateStatus();
  }

  async function load(p) {
    try {
      const data = await api.read(p);
      state.path = data.path;
      state.saved = data.content;
      text.value = data.content;
      text.setSelectionRange(0, 0);
      updateTitle();
      updateStatus();
    } catch (err) {
      toastError(err.message, 'Bloc-notes');
    }
  }

  async function saveAs() {
    const target = await fileDialog({
      mode: 'save', startDir: state.path ? dirname(state.path) : '/Documents',
      defaultName: state.path ? basename(state.path) : 'Sans titre.txt',
    });
    if (!target) return false;
    return save(target);
  }

  async function save(target = state.path) {
    if (!target) return saveAs();
    try {
      const entry = await api.write(target, text.value);
      state.path = entry.path;
      state.saved = text.value;
      updateTitle();
      fsChanged([dirname(entry.path)]);
      toast('Bloc-notes', `Enregistré : ${entry.name}`, { icon: '💾', timeout: 1800 });
      return true;
    } catch (err) {
      toastError(err.message, 'Enregistrement impossible');
      return false;
    }
  }

  /** Demande quoi faire des modifications non enregistrées. Retourne false pour annuler. */
  async function confirmDiscard() {
    if (!dirty()) return true;
    const choice = await choiceDialog(
      `Voulez-vous enregistrer les modifications de ${state.path ? basename(state.path) : 'Sans titre'} ?`,
      ['Enregistrer', 'Ne pas enregistrer', 'Annuler'], { title: 'Bloc-notes', icon: '📝' },
    );
    if (choice === 0) return save();
    return choice === 1;
  }

  async function open() {
    if (!(await confirmDiscard())) return;
    const target = await fileDialog({ mode: 'open', startDir: state.path ? dirname(state.path) : '/Documents' });
    if (target) load(target);
  }

  async function newDoc() {
    if (!(await confirmDiscard())) return;
    state.path = null;
    state.saved = '';
    text.value = '';
    updateTitle();
    updateStatus();
  }

  function insertDate() {
    const stamp = new Date().toLocaleString('fr-FR');
    text.setRangeText(stamp, text.selectionStart, text.selectionEnd, 'end');
    text.dispatchEvent(new Event('input'));
  }

  const bar = menuBar([
    {
      label: 'Fichier',
      items: () => [
        { label: 'Nouveau', hint: 'Ctrl+N', action: newDoc },
        { label: 'Nouvelle fenêtre', action: () => launch() },
        { label: 'Ouvrir…', hint: 'Ctrl+O', action: open },
        { label: 'Enregistrer', hint: 'Ctrl+S', action: () => save() },
        { label: 'Enregistrer sous…', hint: 'Ctrl+Maj+S', action: saveAs },
        { separator: true },
        { label: 'Quitter', action: () => win.close() },
      ],
    },
    {
      label: 'Édition',
      items: () => [
        { label: 'Sélectionner tout', hint: 'Ctrl+A', action: () => { text.focus(); text.select(); } },
        { label: 'Heure/Date', hint: 'F5', action: insertDate },
      ],
    },
    {
      label: 'Format',
      items: () => [
        { label: 'Retour automatique à la ligne', checked: state.wrap, icon: state.wrap ? '✔' : '', action: () => { state.wrap = !state.wrap; applyFormat(); } },
        { label: 'Agrandir la police', hint: 'Ctrl++', action: () => { state.fontSize = Math.min(48, state.fontSize + 2); applyFormat(); } },
        { label: 'Réduire la police', hint: 'Ctrl+-', action: () => { state.fontSize = Math.max(9, state.fontSize - 2); applyFormat(); } },
      ],
    },
    {
      label: 'Affichage',
      items: () => [
        { label: 'Barre d\'état', icon: state.statusBar ? '✔' : '', action: () => { state.statusBar = !state.statusBar; updateStatus(); } },
      ],
    },
  ]);

  win.body.append(h('div', { class: 'notepad' }, bar, text, status));
  win.onClose = confirmDiscard;

  text.addEventListener('input', () => { updateTitle(); updateStatus(); });
  text.addEventListener('keyup', updateStatus);
  text.addEventListener('click', updateStatus);
  text.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else save(); }
    else if (ctrl && key === 'o') { e.preventDefault(); open(); }
    else if (ctrl && key === 'n') { e.preventDefault(); newDoc(); }
    else if (ctrl && (key === '+' || key === '=')) { e.preventDefault(); state.fontSize = Math.min(48, state.fontSize + 2); applyFormat(); }
    else if (ctrl && key === '-') { e.preventDefault(); state.fontSize = Math.max(9, state.fontSize - 2); applyFormat(); }
    else if (e.key === 'F5') { e.preventDefault(); insertDate(); }
    else if (e.key === 'Tab') { e.preventDefault(); text.setRangeText('\t', text.selectionStart, text.selectionEnd, 'end'); text.dispatchEvent(new Event('input')); }
  });

  applyFormat();
  updateTitle();
  if (path) load(path);
  setTimeout(() => text.focus(), 50);
  return win;
}

export default { id: 'notepad', name: 'Bloc-notes', icon: '📝', launch, description: 'Éditeur de texte' };
