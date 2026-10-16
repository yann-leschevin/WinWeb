// Lanceurs d'« exécutables » web : .wapp, .html/.htm et .js.
// Tout contenu utilisateur s'exécute dans une iframe sandbox="allow-scripts"
// SANS allow-same-origin : origine opaque, aucun accès à l'API ni au DOM parent.
import { api } from '../api.js';
import { emojiIcon } from '../icons.js';
import { toastError } from '../notify.js';
import { basename, escapeHtml, h, rawUrl, toWinPath } from '../utils.js';
import { createWindow } from '../windowManager.js';

const SANDBOX = 'allow-scripts';

function sandboxFrame(src, title) {
  const frame = h('iframe', {
    class: 'app-frame', sandbox: SANDBOX, referrerpolicy: 'no-referrer', title, allow: '',
  });
  if (src !== null) frame.src = src;
  return frame;
}

/** Messages facultatifs qu'une application sandboxée peut envoyer à sa fenêtre. */
function bridge(win, frame) {
  const onMessage = (e) => {
    if (e.source !== frame.contentWindow || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'winweb:setTitle' && typeof e.data.title === 'string') win.setTitle(e.data.title.slice(0, 100));
    else if (e.data.type === 'winweb:close') win.close();
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

function frameToolbar(label, onReload) {
  return h('div', { class: 'sb-bar' },
    h('button', { class: 'btn icon flat', type: 'button', title: 'Recharger', text: '⟳', onclick: onReload }),
    h('span', { class: 'sb-path', text: label }),
    h('span', { class: 'sb-badge', title: 'iframe sandbox="allow-scripts" sans allow-same-origin', text: '🛡️ Bac à sable' }));
}

// ------------------------------------------------------------------ .html / .htm
function launchHtml({ path }) {
  const frame = sandboxFrame(rawUrl(path), basename(path));
  const win = createWindow({
    appId: 'htmlapp', title: basename(path), icon: '🌐', width: 900, height: 620, minWidth: 320, minHeight: 220,
    content: h('div', { class: 'sandbox-app' },
      frameToolbar(toWinPath(path), () => { frame.src = rawUrl(path); }), frame),
  });
  win.groupKey = `html:${path}`;
  win.onDestroy = bridge(win, frame);
  return win;
}

// ------------------------------------------------------------------ .wapp
async function launchWapp({ path }) {
  const loading = h('div', { class: 'sb-loading', text: 'Décompression de l\'application…' });
  const win = createWindow({
    appId: 'wapp', title: basename(path), icon: '📦', width: 520, height: 300, minWidth: 260, minHeight: 160, content: loading,
  });
  win.groupKey = `wapp:${path}`;
  try {
    const m = await api.openWapp(path);
    const icon = m.icon_url
      ? `<img class="app-img-icon" src="${escapeHtml(m.icon_url)}" alt="">`
      : emojiIcon(m.icon || '📦');
    const frame = sandboxFrame(m.url, m.name);
    win.setTitle(m.name);
    win.setIcon(icon);
    win.body.replaceChildren(h('div', { class: 'sandbox-app' }, frame));
    win.resizeTo(m.width, m.height + 36); // + barre de titre
    win.onDestroy = bridge(win, frame);
  } catch (err) {
    loading.textContent = `Impossible de lancer l'application : ${err.message}`;
    loading.classList.add('error');
    toastError(err.message, basename(path));
  }
  return win;
}

// ------------------------------------------------------------------ .js
const JS_BOOT = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:14px system-ui,sans-serif;margin:12px;color:#222;background:#fff}</style></head><body><script>
(function () {
  var send = function (level, args) {
    parent.postMessage({ __winweb: 'console', level: level, text: args.map(fmt).join(' ') }, '*');
  };
  function fmt(v) {
    try {
      if (typeof v === 'string') return v;
      if (v instanceof Error) return v.stack || String(v);
      if (typeof v === 'function') return String(v);
      if (v === undefined) return 'undefined';
      var json = JSON.stringify(v, null, 2);
      return json === undefined ? String(v) : json;
    } catch (e) { return String(v); }
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (l) {
    console[l] = function () { send(l, Array.prototype.slice.call(arguments)); };
  });
  console.clear = function () { send('clear', []); };
  console.table = function (d) { send('log', [d]); };
  window.onerror = function (msg, src, line, col, err) {
    send('error', [(err && err.stack) || (msg + ' (ligne ' + line + ')')]);
  };
  window.addEventListener('unhandledrejection', function (e) { send('error', ['Promesse rejetée : ' + fmt(e.reason)]); });
  window.addEventListener('message', function (e) {
    if (e.source !== parent || !e.data || e.data.__winweb !== 'run') return;
    var s = document.createElement('script');
    s.textContent = e.data.code + '\\n//# sourceURL=' + encodeURIComponent(e.data.name);
    document.body.appendChild(s);
    send('done', []);
  });
  parent.postMessage({ __winweb: 'ready' }, '*');
})();
<\/script></body></html>`;

async function launchJs({ path }) {
  const out = h('div', { class: 'js-console' });
  const status = h('span', { class: 'js-status', text: 'Chargement…' });
  const stage = h('div', { class: 'js-stage hidden' });
  const toggleBtn = h('button', { class: 'btn flat', type: 'button', text: '🖼️ Sortie graphique' });
  const runBtn = h('button', { class: 'btn flat', type: 'button', text: '▶ Relancer' });
  const stopBtn = h('button', { class: 'btn flat', type: 'button', text: '⏹ Arrêter' });
  const clearBtn = h('button', { class: 'btn flat', type: 'button', text: '🧹 Effacer' });
  const root = h('div', { class: 'jsrunner' },
    h('div', { class: 'sb-bar' }, runBtn, stopBtn, clearBtn, toggleBtn, status,
      h('span', { class: 'sb-badge', text: '🛡️ Bac à sable' })),
    h('div', { class: 'js-split' }, out, stage));
  const win = createWindow({
    appId: 'jsrunner', title: `${basename(path)} - Console JavaScript`, icon: '📜', width: 760, height: 480,
    minWidth: 360, minHeight: 220, content: root,
  });
  win.groupKey = `js:${path}`;

  let frame = null;
  let code = '';
  const print = (level, text) => {
    if (level === 'clear') { out.replaceChildren(); return; }
    out.append(h('div', { class: `js-line js-${level}`, text }));
    if (out.childElementCount > 5000) out.firstChild.remove();
    out.scrollTop = out.scrollHeight;
  };
  const onMessage = (e) => {
    if (!frame || e.source !== frame.contentWindow || !e.data) return;
    const { __winweb: kind, level, text } = e.data;
    if (kind === 'ready') {
      status.textContent = 'Exécution…';
      frame.contentWindow.postMessage({ __winweb: 'run', code, name: basename(path) }, '*');
    } else if (kind === 'console') {
      if (level === 'done') status.textContent = 'Script exécuté (les tâches asynchrones peuvent continuer)';
      else print(level, String(text).slice(0, 20000));
    }
  };
  window.addEventListener('message', onMessage);

  function stop() {
    frame?.remove();
    frame = null;
    status.textContent = 'Arrêté';
  }
  async function run() {
    stop();
    try {
      code = (await api.read(path)).content;
    } catch (err) {
      status.textContent = 'Erreur';
      print('error', err.message);
      return;
    }
    print('info', `▶ ${toWinPath(path)} — ${new Date().toLocaleTimeString('fr-FR')}`);
    frame = sandboxFrame(null, basename(path));
    frame.srcdoc = JS_BOOT;
    stage.replaceChildren(frame);
  }
  runBtn.addEventListener('click', run);
  stopBtn.addEventListener('click', stop);
  clearBtn.addEventListener('click', () => out.replaceChildren());
  toggleBtn.addEventListener('click', () => {
    stage.classList.toggle('hidden');
    toggleBtn.classList.toggle('active', !stage.classList.contains('hidden'));
  });
  win.onDestroy = () => {
    window.removeEventListener('message', onMessage);
    stop();
  };
  run();
  return win;
}

export const htmlApp = {
  id: 'htmlapp', name: 'Application HTML', icon: '🌐', hidden: true, launch: launchHtml,
  description: 'Lance une page .html dans une fenêtre sandboxée',
};
export const wappApp = {
  id: 'wapp', name: 'Lanceur WApp', icon: '📦', hidden: true, launch: launchWapp,
  description: 'Lance une application .wapp',
};
export const jsApp = {
  id: 'jsrunner', name: 'Console JavaScript', icon: '📜', hidden: true, launch: launchJs,
  description: 'Exécute un script .js dans un bac à sable',
};
