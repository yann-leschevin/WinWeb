// Visionneuse d'images : zoom, rotation, image précédente / suivante du dossier.
import { api } from '../api.js';
import { fileDialog } from '../dialogs.js';
import { isImageExt } from '../icons.js';
import { toastError } from '../notify.js';
import { basename, dirname, formatSize, h, rawUrl } from '../utils.js';
import { createWindow } from '../windowManager.js';

const IMAGE_FILTER = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];

function launch({ path = null } = {}) {
  const st = { path, list: [], zoom: 1, fit: true, rotate: 0, sizeText: '' };
  const img = h('img', { class: 'iv-img', alt: '', draggable: 'false' });
  const placeholder = h('div', { class: 'iv-placeholder', text: 'Ouvrez une image avec 📂 ou double-cliquez sur un fichier image.' });
  const stage = h('div', { class: 'iv-stage' }, img, placeholder);
  const info = h('span', { class: 'iv-info' });
  const zoomLabel = h('span', { class: 'iv-zoom', text: '100 %' });
  const btn = (text, title, fn) => h('button', { class: 'btn icon flat', type: 'button', text, title, onclick: fn });

  const win = createWindow({
    appId: 'imageviewer', title: 'Photos', icon: '🖼️', width: 820, height: 580, minWidth: 360, minHeight: 260,
    onResize: () => apply(),
  });

  function setZoom(z) {
    st.fit = false;
    st.zoom = Math.max(0.05, Math.min(z, 20));
    apply();
  }
  function apply() {
    if (!img.naturalWidth) return;
    const rotated = st.rotate % 180 !== 0;
    const w = rotated ? img.naturalHeight : img.naturalWidth;
    const hh = rotated ? img.naturalWidth : img.naturalHeight;
    if (st.fit) st.zoom = Math.min(1, (stage.clientWidth - 20) / w, (stage.clientHeight - 20) / hh) || 1;
    img.style.width = `${img.naturalWidth * st.zoom}px`;
    img.style.height = `${img.naturalHeight * st.zoom}px`;
    img.style.transform = `rotate(${st.rotate}deg)`;
    stage.classList.toggle('scrollable', !st.fit);
    zoomLabel.textContent = `${Math.round(st.zoom * 100)} %`;
  }
  function updateInfo() {
    const idx = st.list.findIndex((e) => e.path === st.path);
    const dims = img.naturalWidth ? `${img.naturalWidth} × ${img.naturalHeight} px · ` : '';
    info.textContent = `${dims}${st.sizeText}${idx >= 0 ? ` · ${idx + 1}/${st.list.length}` : ''}`;
  }
  async function show(p) {
    st.path = p;
    st.rotate = 0;
    st.fit = true;
    placeholder.classList.add('hidden');
    img.src = rawUrl(p);
    win.setTitle(`${basename(p)} - Photos`);
    try {
      const entries = await api.list(dirname(p));
      st.list = entries.filter((e) => e.type === 'file' && isImageExt(e.ext));
      const cur = st.list.find((e) => e.path === p);
      st.sizeText = cur ? formatSize(cur.size) : '';
      updateInfo();
    } catch (err) {
      toastError(err.message);
    }
  }
  function step(delta) {
    if (!st.list.length) return;
    const i = st.list.findIndex((e) => e.path === st.path);
    const next = st.list[(i + delta + st.list.length) % st.list.length];
    if (next) show(next.path);
  }

  const bar = h('div', { class: 'iv-bar' },
    btn('📂', 'Ouvrir…', async () => {
      const p = await fileDialog({ mode: 'open', startDir: st.path ? dirname(st.path) : '/Images', filter: IMAGE_FILTER });
      if (p) show(p);
    }),
    btn('◀', 'Précédente (←)', () => step(-1)), btn('▶', 'Suivante (→)', () => step(1)),
    h('span', { class: 'iv-spacer' }),
    btn('➖', 'Zoom arrière', () => setZoom(st.zoom / 1.25)), zoomLabel, btn('➕', 'Zoom avant', () => setZoom(st.zoom * 1.25)),
    btn('⤢', 'Ajuster à la fenêtre', () => { st.fit = true; apply(); }),
    btn('1:1', 'Taille réelle', () => setZoom(1)),
    btn('⟳', 'Pivoter', () => { st.rotate = (st.rotate + 90) % 360; apply(); }),
    h('span', { class: 'iv-spacer' }), info);
  const root = h('div', { class: 'imageviewer', tabindex: '0' }, stage, bar);
  win.body.append(root);

  img.addEventListener('load', () => {
    apply();
    updateInfo();
  });
  img.addEventListener('error', () => {
    if (st.path) toastError('Impossible d\'afficher cette image', 'Photos');
  });
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(st.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === '+') setZoom(st.zoom * 1.25);
    else if (e.key === '-') setZoom(st.zoom / 1.25);
  });
  if (path) show(path);
  setTimeout(() => root.focus(), 50);
  return win;
}

export default { id: 'imageviewer', name: 'Photos', icon: '🖼️', launch, description: 'Visionneuse d\'images' };
