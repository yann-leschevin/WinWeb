// Point d'entrée : enregistre les applications et démarre la session.
import browser from './apps/browser.js';
import calculator from './apps/calculator.js';
import cmd from './apps/cmd.js';
import editorpp from './apps/codeEditor.js';
import exeInfo from './apps/exeInfo.js';
import explorer from './apps/explorer.js';
import imageViewer from './apps/imageViewer.js';
import notepad from './apps/notepad.js';
import database from './apps/office/database.js';
import notes from './apps/office/notes.js';
import sheet from './apps/office/sheet.js';
import slides from './apps/office/slides.js';
import writer from './apps/office/writer.js';
import { downloadApp, openWithApp, propertiesApp } from './apps/properties.js';
import { htmlApp, jsApp, wappApp } from './apps/sandbox.js';
import settingsApp from './apps/settingsApp.js';
import taskmgr from './apps/taskmgr.js';
import { initContextMenu } from './contextMenu.js';
import { initDesktop } from './desktop.js';
import { initDragDrop } from './dragdrop.js';
import { registerApp } from './registry.js';
import {
  boot, initSession, lock, restart, shutdown,
} from './session.js';
import { applySettings } from './settings.js';
import { initStartMenu } from './startMenu.js';
import { initTaskbar } from './taskbar.js';
import { initWindowManager } from './windowManager.js';
import { onExternalChange, ready as fsReady } from './localfs.js';
import { fsChanged } from './bus.js';
import { toastError } from './notify.js';

// ---------------------------------------------------------------- version en ligne
// Les fichiers du visiteur sont dans son navigateur (IndexedDB). Le service
// worker (sw.js) sert les adresses « vfs/… » (images, fonds d'écran,
// téléchargements) : on attend qu'il contrôle la page avant de démarrer.
async function startServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const root = new URL('../../', import.meta.url);
    await navigator.serviceWorker.register(new URL('sw.js', root), { scope: root.pathname });
    if (navigator.serviceWorker.controller) return true;
    await Promise.race([
      new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })),
      new Promise((resolve) => { setTimeout(resolve, 4000); }),
    ]);
    return Boolean(navigator.serviceWorker.controller);
  } catch {
    return false;
  }
}
const [swOk, fsError] = await Promise.all([
  startServiceWorker(),
  fsReady().then(() => null, (err) => err),
]);

[
  explorer, notepad, calculator, settingsApp, taskmgr, imageViewer, cmd,
  htmlApp, wappApp, jsApp, exeInfo, propertiesApp, openWithApp, downloadApp,
  browser, editorpp, writer, sheet, slides, database, notes,
].forEach(registerApp);

applySettings();
initContextMenu();
initWindowManager();
initStartMenu({ lock, restart, shutdown });
initTaskbar();
initDragDrop();
initSession();
initDesktop();
boot();

// Un autre onglet de WinWeb a modifié les fichiers : on rafraîchit l'affichage
onExternalChange(() => fsChanged(['/', '/Bureau']));

if (fsError) {
  toastError(`${fsError.message} Les fichiers ne pourront pas être enregistrés.`, 'Stockage indisponible');
} else if (!swOk) {
  toastError('Ce navigateur bloque le service worker (navigation privée ?) : les images et téléchargements du PC virtuel ne s\'afficheront pas.', 'Affichage limité');
}
