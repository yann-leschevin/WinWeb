// Diaporama (format .wpres) : diapositives 16:9, zones de texte, images, formes,
// thèmes, dispositions, transitions, notes du présentateur, mode présentation
// plein écran et export HTML autonome.
import { showMenu } from '../../contextMenu.js';
import { escapeHtml, h } from '../../utils.js';
import { createWindow } from '../../windowManager.js';
import {
  docController, fileShortcuts, pickLocalImage, pickVfsImage, rbBtn, rbColor, rbSelect, ribbon,
} from './common.js';
import { handleRichPaste, safeImageSrc, sanitizeHtml } from './sanitize.js';

const W = 960;
const H = 540;
const THEMES = {
  clair: { name: 'Clair', bg: '#ffffff', color: '#1f1f1f', accent: '#2b579a', font: '"Segoe UI", Arial, sans-serif' },
  sombre: { name: 'Sombre', bg: '#1d1f24', color: '#f3f3f3', accent: '#4cc2ff', font: '"Segoe UI", Arial, sans-serif' },
  ocean: { name: 'Océan', bg: 'linear-gradient(135deg, #0f2f57 0%, #1f6aa5 100%)', color: '#ffffff', accent: '#9fe0ff', font: '"Segoe UI", Arial, sans-serif' },
  aurore: { name: 'Aurore', bg: 'linear-gradient(135deg, #3a1c71 0%, #d76d77 60%, #ffaf7b 100%)', color: '#ffffff', accent: '#ffe08a', font: 'Georgia, serif' },
  papier: { name: 'Papier', bg: '#f6f1e7', color: '#3b2f2f', accent: '#b5522d', font: 'Georgia, "Times New Roman", serif' },
  foret: { name: 'Forêt', bg: 'linear-gradient(160deg, #0b3d2e 0%, #1d6b4f 100%)', color: '#f0fff4', accent: '#b6f09c', font: '"Trebuchet MS", sans-serif' },
};
const TRANSITIONS = [['none', 'Aucune'], ['fade', 'Fondu'], ['slide', 'Glissement'], ['zoom', 'Zoom']];
const SHAPES = [['rect', '▭ Rectangle'], ['round', '▢ Rectangle arrondi'], ['ellipse', '◯ Ellipse'], ['triangle', '△ Triangle'], ['arrow', '➜ Flèche'], ['star', '☆ Étoile']];
const CLIP = {
  triangle: 'polygon(50% 0, 100% 100%, 0 100%)',
  arrow: 'polygon(0 30%, 62% 30%, 62% 0, 100% 50%, 62% 100%, 62% 70%, 0 70%)',
  star: 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
};
const isColor = (v) => /^#[0-9a-f]{3,8}$/i.test(String(v || ''));
let uid = 0;
const newId = () => `e${Date.now().toString(36)}${(uid++).toString(36)}`;

function textEl(x, y, w, h2, html) {
  return { id: newId(), type: 'text', x, y, w, h: h2, html };
}

function layoutElements(layout) {
  switch (layout) {
    case 'titre':
      return [
        textEl(80, 160, 800, 130, '<div style="font-size: 56px; font-weight: 600; text-align: center">Titre de la présentation</div>'),
        textEl(160, 310, 640, 70, '<div style="font-size: 26px; text-align: center; opacity: 0.8">Sous-titre</div>'),
      ];
    case 'contenu':
      return [
        textEl(60, 36, 840, 80, '<div style="font-size: 40px; font-weight: 600">Titre de la diapositive</div>'),
        textEl(60, 130, 840, 370, '<ul style="font-size: 26px"><li>Premier point</li><li>Deuxième point</li><li>Troisième point</li></ul>'),
      ];
    case 'deux':
      return [
        textEl(60, 36, 840, 80, '<div style="font-size: 40px; font-weight: 600">Comparaison</div>'),
        textEl(60, 140, 405, 360, '<ul style="font-size: 24px"><li>Colonne gauche</li></ul>'),
        textEl(495, 140, 405, 360, '<ul style="font-size: 24px"><li>Colonne droite</li></ul>'),
      ];
    case 'section':
      return [textEl(80, 200, 800, 140, '<div style="font-size: 50px; font-weight: 600">Titre de section</div>')];
    default:
      return [];
  }
}

const newSlide = (layout = 'contenu') => ({ id: newId(), layout, notes: '', transition: 'fade', bg: null, elements: layoutElements(layout) });

/** HTML statique d'un élément (vignettes, présentation, export). */
function elementHtml(el) {
  const box = `left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;`;
  if (el.type === 'text') return `<div class="sl-el sl-text" style="${box}"><div class="sl-text-inner">${sanitizeHtml(el.html)}</div></div>`;
  if (el.type === 'image') {
    const src = safeImageSrc(el.src);
    return src ? `<div class="sl-el sl-image" style="${box}"><img src="${escapeHtml(src)}" alt="" draggable="false"></div>` : '';
  }
  const fill = isColor(el.fill) ? el.fill : '#2b579a';
  const radius = el.shape === 'ellipse' ? 'border-radius:50%;' : el.shape === 'round' ? 'border-radius:18px;' : '';
  const clip = CLIP[el.shape] ? `clip-path:${CLIP[el.shape]};` : '';
  return `<div class="sl-el sl-shape" style="${box}"><div class="sl-shape-fill" style="background:${fill};${radius}${clip}"></div></div>`;
}

function slideBackground(slide, theme) {
  return isColor(slide.bg) ? slide.bg : theme.bg;
}

function slideHtml(slide, theme) {
  return `<div class="sl-slide" style="background:${slideBackground(slide, theme)};color:${theme.color};font-family:${escapeHtml(theme.font)};--sl-accent:${theme.accent}">${slide.elements.map(elementHtml).join('')}</div>`;
}

const SLIDE_CSS = `.sl-slide{position:relative;width:${W}px;height:${H}px;overflow:hidden;box-sizing:border-box}
.sl-el{position:absolute;box-sizing:border-box}.sl-text-inner{width:100%;height:100%;overflow:hidden;font-size:24px;line-height:1.25;outline:none;overflow-wrap:anywhere}
.sl-text-inner ul,.sl-text-inner ol{margin:0;padding-left:1.2em}.sl-text-inner li{margin:.25em 0}.sl-text-inner p{margin:0}
.sl-image img{width:100%;height:100%;object-fit:contain;display:block}.sl-shape-fill{width:100%;height:100%}`;

function launch({ path = null } = {}) {
  const pres = { theme: 'clair', slides: [newSlide('titre')] };
  let current = 0;
  let selected = null;
  let editingId = null;

  const theme = () => THEMES[pres.theme] || THEMES.clair;
  const slide = () => pres.slides[current];
  const findEl = (id) => slide().elements.find((e) => e.id === id);

  const thumbs = h('div', { class: 'sl-thumbs' });
  const stage = h('div', { class: 'sl-stage' });
  const stageWrap = h('div', { class: 'sl-stage-wrap' }, stage);
  const notes = h('textarea', { class: 'sl-notes', placeholder: 'Cliquez pour ajouter des notes du présentateur' });
  const status = h('div', { class: 'sl-status' });

  const win = createWindow({
    appId: 'slides', title: 'Diaporama', icon: '📙', width: 1100, height: 720, minWidth: 620, minHeight: 400,
  });

  const doc = docController({
    win, appName: 'Diaporama', icon: '📙', ext: 'wpres', defaultName: 'Présentation1.wpres', openFilter: ['wpres'],
    serialize: () => {
      syncEditing();
      return JSON.stringify({
        format: 'winweb-slides', version: 1, theme: pres.theme,
        slides: pres.slides.map((s) => ({ ...s, elements: s.elements.map((e) => (e.type === 'text' ? { ...e, html: sanitizeHtml(e.html) } : e)) })),
      });
    },
    load(content) {
      const data = JSON.parse(content || '{}');
      if (data.format !== 'winweb-slides' || !Array.isArray(data.slides)) throw new Error('Ce fichier n\'est pas une présentation valide');
      pres.theme = THEMES[data.theme] ? data.theme : 'clair';
      pres.slides = data.slides.map((s) => ({
        id: s.id || newId(), layout: s.layout || 'vide', notes: String(s.notes || ''), transition: s.transition || 'fade',
        bg: isColor(s.bg) ? s.bg : null,
        elements: (Array.isArray(s.elements) ? s.elements : []).filter((e) => ['text', 'image', 'shape'].includes(e.type)).map((e) => ({
          id: e.id || newId(), type: e.type, x: Number(e.x) || 0, y: Number(e.y) || 0, w: Number(e.w) || 100, h: Number(e.h) || 50,
          html: e.type === 'text' ? sanitizeHtml(e.html) : undefined, src: e.type === 'image' ? safeImageSrc(e.src) : undefined,
          shape: e.shape, fill: isColor(e.fill) ? e.fill : undefined,
        })),
      }));
      if (!pres.slides.length) pres.slides.push(newSlide('titre'));
      current = 0;
      selected = null;
      editingId = null;
      themeSel.value = pres.theme;
      renderAll();
    },
    reset() {
      pres.theme = 'clair';
      pres.slides = [newSlide('titre')];
      current = 0;
      selected = null;
      editingId = null;
      themeSel.value = pres.theme;
      renderAll();
    },
  });

  // ---------------------------------------------------------------- rendu
  function fitStage() {
    const r = stageWrap.getBoundingClientRect();
    const scale = Math.max(0.1, Math.min((r.width - 40) / W, (r.height - 30) / H));
    stage.style.transform = `scale(${scale})`;
    stage.dataset.scale = String(scale);
  }

  function renderStage() {
    const t = theme();
    stage.style.background = slideBackground(slide(), t);
    stage.style.color = t.color;
    stage.style.fontFamily = t.font;
    stage.replaceChildren(...slide().elements.map((el) => {
      const node = h('div', { class: 'sl-el-host', dataset: { id: el.id } });
      node.innerHTML = elementHtml(el);
      const inner = node.firstElementChild;
      if (!inner) return node;
      inner.dataset.id = el.id;
      if (el.id === selected) {
        inner.classList.add('selected');
        for (const dir of ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']) inner.append(h('span', { class: `sl-handle sl-h-${dir}`, dataset: { dir } }));
      }
      if (el.type === 'text') {
        const textInner = inner.querySelector('.sl-text-inner');
        if (el.id === editingId) {
          inner.classList.add('editing');
          textInner.contentEditable = 'true';
          textInner.addEventListener('input', () => { el.html = textInner.innerHTML; doc.touch(); refreshThumb(); });
          textInner.addEventListener('paste', handleRichPaste);
        }
      }
      return inner;
    }));
    notes.value = slide().notes || '';
    transSel.value = slide().transition || 'fade';
    status.textContent = `Diapositive ${current + 1} sur ${pres.slides.length}    |    Thème : ${t.name}`;
  }

  function thumbNode(s, i) {
    const mini = h('div', { class: 'sl-thumb-inner' });
    mini.innerHTML = slideHtml(s, theme());
    const node = h('div', {
      class: `sl-thumb${i === current ? ' active' : ''}`, draggable: 'true', dataset: { i },
      onclick: () => goTo(i),
      oncontextmenu: (e) => {
        e.preventDefault();
        goTo(i);
        showMenu(e.clientX, e.clientY, slideMenu());
      },
    }, h('span', { class: 'sl-thumb-num', text: String(i + 1) }), h('div', { class: 'sl-thumb-box' }, mini));
    node.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-slide', String(i)); e.stopPropagation(); });
    node.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const from = Number(e.dataTransfer.getData('text/x-slide'));
      if (Number.isNaN(from) || from === i) return;
      const [moved] = pres.slides.splice(from, 1);
      pres.slides.splice(i, 0, moved);
      current = i;
      doc.touch();
      renderAll();
    });
    return node;
  }

  function renderThumbs() {
    thumbs.replaceChildren(...pres.slides.map(thumbNode),
      h('button', { class: 'sl-add', type: 'button', text: '+ Nouvelle diapositive', onclick: () => addSlide('contenu') }));
  }

  let thumbTimer = null;
  function refreshThumb() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      const node = thumbs.children[current];
      if (node) node.replaceWith(thumbNode(slide(), current));
    }, 250);
  }

  function renderAll() {
    renderThumbs();
    renderStage();
    fitStage();
  }

  function goTo(i) {
    syncEditing();
    current = Math.max(0, Math.min(pres.slides.length - 1, i));
    selected = null;
    editingId = null;
    renderAll();
    thumbs.children[current]?.scrollIntoView({ block: 'nearest' });
  }

  function syncEditing() {
    if (!editingId) return;
    const node = stage.querySelector(`.sl-el[data-id="${editingId}"] .sl-text-inner`);
    const el = findEl(editingId);
    if (node && el) el.html = node.innerHTML;
  }

  // ---------------------------------------------------------------- diapositives
  function addSlide(layout) {
    syncEditing();
    pres.slides.splice(current + 1, 0, newSlide(layout));
    doc.touch();
    goTo(current + 1);
  }
  function duplicateSlide() {
    syncEditing();
    const copy = JSON.parse(JSON.stringify(slide()));
    copy.id = newId();
    copy.elements.forEach((e) => { e.id = newId(); });
    pres.slides.splice(current + 1, 0, copy);
    doc.touch();
    goTo(current + 1);
  }
  function deleteSlide() {
    if (pres.slides.length < 2) return;
    pres.slides.splice(current, 1);
    doc.touch();
    goTo(Math.min(current, pres.slides.length - 1));
  }
  function moveSlide(delta) {
    const j = current + delta;
    if (j < 0 || j >= pres.slides.length) return;
    [pres.slides[current], pres.slides[j]] = [pres.slides[j], pres.slides[current]];
    doc.touch();
    goTo(j);
  }
  const slideMenu = () => [
    { label: 'Nouvelle diapositive', icon: '➕', action: () => addSlide('contenu') },
    { label: 'Dupliquer', icon: '⧉', action: duplicateSlide },
    { label: 'Monter', icon: '↑', disabled: current === 0, action: () => moveSlide(-1) },
    { label: 'Descendre', icon: '↓', disabled: current === pres.slides.length - 1, action: () => moveSlide(1) },
    { separator: true },
    { label: 'Supprimer la diapositive', icon: '🗑️', disabled: pres.slides.length < 2, action: deleteSlide },
  ];

  // ---------------------------------------------------------------- éléments
  function addElement(el) {
    syncEditing();
    slide().elements.push(el);
    selected = el.id;
    editingId = null;
    doc.touch();
    renderStage();
    refreshThumb();
  }
  const addText = () => addElement(textEl(300, 220, 360, 90, '<div style="font-size: 28px">Votre texte</div>'));
  const addShape = (shape) => addElement({ id: newId(), type: 'shape', shape, x: 380, y: 170, w: 200, h: shape === 'arrow' ? 110 : 200, fill: theme().accent.startsWith('#') ? theme().accent : '#2b579a' });
  async function addImage(source) {
    const src = source === 'vfs' ? await pickVfsImage() : await pickLocalImage();
    if (!src || !safeImageSrc(src)) return;
    addElement({ id: newId(), type: 'image', src, x: 280, y: 120, w: 400, h: 300 });
  }

  function removeSelected() {
    if (!selected) return;
    slide().elements = slide().elements.filter((e) => e.id !== selected);
    selected = null;
    editingId = null;
    doc.touch();
    renderStage();
    refreshThumb();
  }
  function arrange(where) {
    const el = findEl(selected);
    if (!el) return;
    syncEditing();
    const list = slide().elements.filter((e) => e !== el);
    if (where === 'front') list.push(el);
    else list.unshift(el);
    slide().elements = list;
    doc.touch();
    renderStage();
    refreshThumb();
  }
  function duplicateElement() {
    const el = findEl(selected);
    if (!el) return;
    syncEditing();
    addElement({ ...JSON.parse(JSON.stringify(el)), id: newId(), x: el.x + 20, y: el.y + 20 });
  }

  /** Applique une commande de mise en forme au texte en cours d'édition, ou à toute la zone sélectionnée. */
  function formatText(cmd, value = null) {
    const el = findEl(selected);
    if (!el || el.type !== 'text') return;
    if (editingId !== el.id) {
      editingId = el.id;
      renderStage();
      const inner = stage.querySelector(`.sl-el[data-id="${el.id}"] .sl-text-inner`);
      inner.focus();
      const range = document.createRange();
      range.selectNodeContents(inner);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
    }
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, value);
    syncEditing();
    doc.touch();
    refreshThumb();
  }
  function setFontSize(px) {
    const el = findEl(selected);
    if (!el || el.type !== 'text') return;
    formatText('fontSize', '7');
    stage.querySelectorAll(`.sl-el[data-id="${el.id}"] font[size="7"], .sl-el[data-id="${el.id}"] [style*="xxx-large"]`).forEach((n) => {
      n.removeAttribute('size');
      n.style.fontSize = `${px}px`;
    });
    syncEditing();
  }
  function setFill(color) {
    const el = findEl(selected);
    if (!el) { slide().bg = color; doc.touch(); renderStage(); refreshThumb(); return; }
    if (el.type === 'shape') { el.fill = color; doc.touch(); renderStage(); refreshThumb(); }
  }

  // ---------------------------------------------------------------- souris sur la scène
  stage.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('.sl-el');
    const scale = Number(stage.dataset.scale) || 1;
    if (!node) {
      if (selected || editingId) {
        syncEditing();
        selected = null;
        editingId = null;
        renderStage();
        refreshThumb();
      }
      return;
    }
    const id = node.dataset.id;
    const el = findEl(id);
    if (!el) return;
    if (id === editingId && !e.target.classList.contains('sl-handle')) return; // sélection de texte
    e.preventDefault();
    if (selected !== id || editingId) {
      syncEditing();
      selected = id;
      editingId = null;
      renderStage();
    }
    const handle = e.target.closest('.sl-handle');
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { x: el.x, y: el.y, w: el.w, h: el.h };
    const target = stage.querySelector(`.sl-el[data-id="${id}"]`);
    let moved = false;
    const move = (ev) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      if (handle) {
        const dir = handle.dataset.dir;
        let { x, y, w, h: hh } = orig;
        if (dir.includes('e')) w = Math.max(20, orig.w + dx);
        if (dir.includes('s')) hh = Math.max(20, orig.h + dy);
        if (dir.includes('w')) { w = Math.max(20, orig.w - dx); x = orig.x + orig.w - w; }
        if (dir.includes('n')) { hh = Math.max(20, orig.h - dy); y = orig.y + orig.h - hh; }
        if (ev.shiftKey && el.type !== 'text') { const ratio = orig.w / orig.h; hh = w / ratio; }
        Object.assign(el, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) });
      } else {
        el.x = Math.round(Math.max(-el.w + 20, Math.min(W - 20, orig.x + dx)));
        el.y = Math.round(Math.max(-el.h + 20, Math.min(H - 20, orig.y + dy)));
      }
      Object.assign(target.style, { left: `${el.x}px`, top: `${el.y}px`, width: `${el.w}px`, height: `${el.h}px` });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) { doc.touch(); refreshThumb(); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  stage.addEventListener('dblclick', (e) => {
    const node = e.target.closest('.sl-text');
    if (!node) return;
    const id = node.dataset.id;
    selected = id;
    editingId = id;
    renderStage();
    const inner = stage.querySelector(`.sl-el[data-id="${id}"] .sl-text-inner`);
    inner?.focus();
    const range = document.createRange();
    range.selectNodeContents(inner);
    range.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  stage.addEventListener('contextmenu', (e) => {
    const node = e.target.closest('.sl-el');
    if (!node || editingId) return;
    e.preventDefault();
    selected = node.dataset.id;
    renderStage();
    showMenu(e.clientX, e.clientY, [
      { label: 'Dupliquer', hint: 'Ctrl+D', icon: '⧉', action: duplicateElement },
      { label: 'Premier plan', icon: '⬆', action: () => arrange('front') },
      { label: 'Arrière-plan', icon: '⬇', action: () => arrange('back') },
      { separator: true },
      { label: 'Supprimer', hint: 'Suppr', icon: '🗑️', action: removeSelected },
    ]);
  });

  notes.addEventListener('input', () => { slide().notes = notes.value; doc.touch(); });

  win.body.addEventListener('keydown', (e) => {
    if (fileShortcuts(e, doc)) return;
    if (e.key === 'F5') { e.preventDefault(); present(e.shiftKey ? current : 0); return; }
    if (e.target === notes || editingId) {
      if (e.key === 'Escape' && editingId) { syncEditing(); editingId = null; renderStage(); refreshThumb(); }
      return;
    }
    if (e.target.closest('input, select, textarea')) return;
    const el = findEl(selected);
    const ctrl = e.ctrlKey || e.metaKey;
    if ((e.key === 'Delete' || e.key === 'Backspace') && el) { e.preventDefault(); removeSelected(); }
    else if (ctrl && e.key.toLowerCase() === 'd' && el) { e.preventDefault(); duplicateElement(); }
    else if (ctrl && e.key.toLowerCase() === 'm') { e.preventDefault(); addSlide('contenu'); }
    else if (e.key.startsWith('Arrow') && el) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') el.x -= step;
      if (e.key === 'ArrowRight') el.x += step;
      if (e.key === 'ArrowUp') el.y -= step;
      if (e.key === 'ArrowDown') el.y += step;
      doc.touch();
      renderStage();
      refreshThumb();
    } else if (!el && (e.key === 'PageDown' || e.key === 'ArrowDown')) { e.preventDefault(); goTo(current + 1); }
    else if (!el && (e.key === 'PageUp' || e.key === 'ArrowUp')) { e.preventDefault(); goTo(current - 1); }
    else if (e.key === 'Escape') { selected = null; renderStage(); }
  });

  // ---------------------------------------------------------------- présentation
  function present(start = 0) {
    syncEditing();
    let idx = start;
    const holder = h('div', { class: 'sl-show-slide' });
    const counter = h('div', { class: 'sl-show-counter' });
    const overlay = h('div', { class: 'sl-show', tabindex: '0' }, holder, counter);
    document.body.append(overlay);
    const fit = () => {
      const s = Math.min(window.innerWidth / W, window.innerHeight / H);
      holder.style.transform = `translate(-50%, -50%) scale(${s})`;
    };
    const show = (i, dir = 1) => {
      idx = Math.max(0, Math.min(pres.slides.length - 1, i));
      const sl = pres.slides[idx];
      holder.innerHTML = slideHtml(sl, theme());
      holder.className = `sl-show-slide tr-${sl.transition || 'none'}${dir < 0 ? ' back' : ''}`;
      void holder.offsetWidth; // relance l'animation
      holder.classList.add('run');
      counter.textContent = `${idx + 1} / ${pres.slides.length}`;
    };
    const close = () => {
      window.removeEventListener('resize', fit);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement === overlay) document.exitFullscreen().catch(() => {});
      overlay.remove();
      win.focus();
    };
    const onFs = () => { if (!document.fullscreenElement) close(); };
    overlay.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(e.key)) {
        if (idx === pres.slides.length - 1) close(); else show(idx + 1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(e.key)) show(idx - 1, -1);
      else if (e.key === 'Home') show(0, -1);
      else if (e.key === 'End') show(pres.slides.length - 1);
      else if (e.key === 'Escape') close();
    });
    overlay.addEventListener('click', () => { if (idx === pres.slides.length - 1) close(); else show(idx + 1); });
    overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); show(idx - 1, -1); });
    window.addEventListener('resize', fit);
    overlay.requestFullscreen?.().then(() => document.addEventListener('fullscreenchange', onFs)).catch(() => {});
    fit();
    show(idx);
    overlay.focus();
  }

  function exportHtml() {
    syncEditing();
    const t = theme();
    const slides = pres.slides.map((s) => `<section class="tr-${escapeHtml(s.transition || 'none')}">${slideHtml(s, t)}</section>`).join('\n');
    return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(doc.state.name.replace(/\.wpres$/, ''))}</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}${SLIDE_CSS}
section{display:none;position:absolute;left:50%;top:50%}section.on{display:block}
section.on.tr-fade{animation:f .5s}section.on.tr-zoom{animation:z .5s}section.on.tr-slide{animation:s .5s}
@keyframes f{from{opacity:0}}@keyframes z{from{opacity:0;scale:.85}}@keyframes s{from{opacity:.2;translate:40% 0}}
#n{position:fixed;right:14px;bottom:10px;color:#fff8;font:13px sans-serif}</style></head>
<body>${slides}<div id="n"></div><script>
var s=document.querySelectorAll('section'),i=0;
function fit(){var k=Math.min(innerWidth/${W},innerHeight/${H});s.forEach(function(x){x.style.transform='translate(-50%,-50%) scale('+k+')';});}
function go(n){i=Math.max(0,Math.min(s.length-1,n));s.forEach(function(x,j){x.classList.toggle('on',j===i);});document.getElementById('n').textContent=(i+1)+' / '+s.length;}
addEventListener('keydown',function(e){if(['ArrowRight','ArrowDown','PageDown',' ','Enter'].indexOf(e.key)>=0)go(i+1);else if(['ArrowLeft','ArrowUp','PageUp','Backspace'].indexOf(e.key)>=0)go(i-1);else if(e.key==='Home')go(0);else if(e.key==='End')go(s.length-1);});
addEventListener('click',function(){go(i+1);});addEventListener('contextmenu',function(e){e.preventDefault();go(i-1);});
addEventListener('resize',fit);fit();go(0);
</script></body></html>`;
  }

  // ---------------------------------------------------------------- ruban
  const themeSel = rbSelect(Object.entries(THEMES).map(([k, t]) => [k, t.name]), 'Thème', (v) => {
    pres.theme = v;
    doc.touch();
    renderAll();
  }, { width: 120 });
  const transSel = rbSelect(TRANSITIONS, 'Transition de la diapositive', (v) => { slide().transition = v; doc.touch(); }, { width: 120 });

  const fileMenu = () => [
    { label: 'Nouveau', hint: 'Ctrl+N', icon: '📄', action: doc.newDoc },
    { label: 'Nouvelle fenêtre', action: () => launch() },
    { label: 'Ouvrir…', hint: 'Ctrl+O', icon: '📂', action: doc.open },
    { label: 'Enregistrer', hint: 'Ctrl+S', icon: '💾', action: doc.save },
    { label: 'Enregistrer sous…', hint: 'Ctrl+Maj+S', action: doc.saveAs },
    { separator: true },
    { label: 'Exporter en page HTML autonome…', icon: '🌐', action: () => doc.exportAs('html', exportHtml, 'HTML') },
    { separator: true },
    { label: 'Fermer', action: () => win.close() },
  ];

  const layoutMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 2, [
      { label: 'Titre', action: () => addSlide('titre') },
      { label: 'Titre et contenu', action: () => addSlide('contenu') },
      { label: 'Deux contenus', action: () => addSlide('deux') },
      { label: 'En-tête de section', action: () => addSlide('section') },
      { label: 'Vide', action: () => addSlide('vide') },
    ]);
  };

  const rb = ribbon([
    {
      label: 'Accueil',
      groups: [
        {
          label: 'Diapositives',
          items: [rbBtn('➕<br>Nouvelle', 'Nouvelle diapositive (choisir la disposition)', layoutMenu, { big: true }),
            h('div', { class: 'rb-col' }, rbBtn('⧉ Dupliquer', 'Dupliquer la diapositive', duplicateSlide),
              rbBtn('🗑️ Supprimer', 'Supprimer la diapositive', deleteSlide))],
        },
        {
          label: 'Police',
          items: [h('div', { class: 'rb-row' },
            rbSelect([['', 'Taille'], ...[14, 18, 20, 24, 28, 32, 40, 48, 60, 72, 96].map((s) => [String(s), String(s)])], 'Taille du texte', (v) => v && setFontSize(Number(v)), { width: 70 }),
            rbBtn('<b>G</b>', 'Gras', () => formatText('bold')), rbBtn('<i>I</i>', 'Italique', () => formatText('italic')),
            rbBtn('<u>S</u>', 'Souligné', () => formatText('underline'))),
          h('div', { class: 'rb-row' },
            rbColor('A', 'Couleur du texte', '#c00000', (c) => formatText('foreColor', c)),
            rbBtn('⯇≡', 'Aligner à gauche', () => formatText('justifyLeft')), rbBtn('≡', 'Centrer', () => formatText('justifyCenter')),
            rbBtn('≡⯈', 'Aligner à droite', () => formatText('justifyRight')), rbBtn('• ≡', 'Puces', () => formatText('insertUnorderedList')))],
        },
        {
          label: 'Dessin',
          items: [rbColor('🪣 Remplissage', 'Couleur de la forme sélectionnée (ou fond de la diapositive)', '#2b579a', setFill),
            h('div', { class: 'rb-row' }, rbBtn('⬆ Avant', 'Premier plan', () => arrange('front')), rbBtn('⬇ Arrière', 'Arrière-plan', () => arrange('back')))],
        },
        { label: 'Diaporama', items: [rbBtn('▶<br>Lancer', 'Présenter depuis le début (F5)', () => present(0), { big: true })] },
      ],
    },
    {
      label: 'Insertion',
      groups: [
        { label: 'Texte', items: [rbBtn('🅰<br>Zone de texte', 'Insérer une zone de texte', addText, { big: true })] },
        {
          label: 'Images',
          items: [rbBtn('🖼️<br>Image', 'Image du dossier Images', () => addImage('vfs'), { big: true }),
            rbBtn('💻<br>Ordinateur', 'Image de votre ordinateur', () => addImage('local'), { big: true })],
        },
        {
          label: 'Formes',
          items: [h('div', { class: 'rb-shapes' }, SHAPES.map(([k, label]) => rbBtn(label.split(' ')[0], label, () => addShape(k))))],
        },
      ],
    },
    {
      label: 'Création',
      groups: [
        { label: 'Thèmes', items: [themeSel] },
        {
          label: 'Arrière-plan',
          items: [rbColor('🎨 Fond', 'Couleur de fond de la diapositive', '#ffffff', (c) => { slide().bg = c; doc.touch(); renderStage(); refreshThumb(); }),
            rbBtn('↺ Fond du thème', 'Revenir au fond du thème', () => { slide().bg = null; doc.touch(); renderStage(); refreshThumb(); })],
        },
      ],
    },
    {
      label: 'Transitions',
      groups: [{ label: 'Transition vers cette diapositive', items: [transSel, rbBtn('Appliquer à toutes', 'Même transition partout', () => {
        pres.slides.forEach((s) => { s.transition = transSel.value; });
        doc.touch();
      })] }],
    },
    {
      label: 'Diaporama',
      groups: [{
        label: 'Démarrer',
        items: [rbBtn('▶<br>Du début', 'F5', () => present(0), { big: true }),
          rbBtn('⏵<br>Diapo actuelle', 'Maj+F5', () => present(current), { big: true })],
      }],
    },
  ], { fileMenu, showMenu, accent: '#c43e1c' });

  const ro = new ResizeObserver(fitStage);
  ro.observe(stageWrap);
  win.onDestroy = () => ro.disconnect();

  win.body.append(h('div', { class: 'office-app slides' }, rb,
    h('div', { class: 'sl-main' }, thumbs, h('div', { class: 'sl-center' }, stageWrap, notes)), status));
  win.body.tabIndex = -1;
  renderAll();
  if (path) doc.load(path);
  return win;
}

export { SLIDE_CSS };
export default {
  id: 'slides', name: 'Diaporama', icon: '📙', launch, description: 'Présentations (.wpres)',
};
