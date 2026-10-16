// Démarrage, écran de verrouillage, arrêt et redémarrage.
import { closeStartMenu } from './startMenu.js';
import { closeAllWindows } from './windowManager.js';

const $ = (id) => document.getElementById(id);
let lockTimer = null;
let unlocking = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function updateLockClock() {
  const now = new Date();
  $('lock-screen').querySelector('.lock-time').textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  $('lock-screen').querySelector('.lock-date').textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function setScreen(name) {
  for (const id of ['boot-screen', 'off-screen', 'lock-screen']) $(id).classList.toggle('hidden', id !== name);
  document.body.classList.toggle('session', name === null);
  document.body.classList.toggle('booting', name === 'boot-screen' || name === 'off-screen');
}

export function lock() {
  closeStartMenu();
  const screen = $('lock-screen');
  screen.classList.remove('unlocking', 'show-login');
  setScreen('lock-screen');
  updateLockClock();
  clearInterval(lockTimer);
  lockTimer = setInterval(updateLockClock, 1000);
  unlocking = false;
  setTimeout(() => screen.focus(), 50);
}

async function unlock() {
  if (unlocking) return;
  unlocking = true;
  const screen = $('lock-screen');
  screen.classList.add('unlocking');
  await wait(450);
  clearInterval(lockTimer);
  setScreen(null);
  screen.classList.remove('unlocking');
  unlocking = false;
}

export async function boot() {
  setScreen('boot-screen');
  const text = $('boot-screen').querySelector('.boot-text');
  const steps = ['Chargement du noyau…', 'Montage du système de fichiers virtuel…', 'Démarrage des services…', 'Préparation du Bureau…'];
  for (const step of steps) {
    text.textContent = step;
    await wait(520);
  }
  lock();
}

export async function shutdown() {
  closeStartMenu();
  closeAllWindows();
  setScreen('boot-screen');
  $('boot-screen').querySelector('.boot-text').textContent = 'Arrêt en cours…';
  await wait(1400);
  setScreen('off-screen');
}

export async function restart() {
  closeStartMenu();
  closeAllWindows();
  setScreen('boot-screen');
  $('boot-screen').querySelector('.boot-text').textContent = 'Redémarrage…';
  await wait(1200);
  await boot();
}

export function initSession() {
  const screen = $('lock-screen');
  screen.addEventListener('click', unlock);
  screen.addEventListener('keydown', (e) => {
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) unlock();
  });
  document.addEventListener('keydown', (e) => {
    if (!screen.classList.contains('hidden') && e.target === document.body) unlock();
  });
  $('off-screen').querySelector('.power-on').addEventListener('click', () => boot());
}
