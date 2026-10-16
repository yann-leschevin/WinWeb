// Invite de commandes simulée (aucune commande n'est exécutée côté serveur :
// tout passe par l'API du système de fichiers virtuel).
import { api } from '../api.js';
import { fsChanged } from '../bus.js';
import { getApps, launchApp, openPath } from '../registry.js';
import {
  basename, dirname, formatDate, h, joinPath, normPath, toWinPath,
} from '../utils.js';
import { createWindow } from '../windowManager.js';

const HELP = [
  ['CD', 'Affiche le nom du dossier courant ou change de dossier.'],
  ['CLS', 'Efface l\'écran.'],
  ['COPY', 'Copie un fichier ou un dossier : COPY source destination'],
  ['DATE / TIME', 'Affiche la date ou l\'heure.'],
  ['DEL', 'Supprime un ou plusieurs fichiers (vers la Corbeille).'],
  ['DIR', 'Affiche la liste des fichiers et dossiers.'],
  ['ECHO', 'Affiche un message. ECHO texte > fichier écrit dans un fichier (>> ajoute).'],
  ['EXIT', 'Ferme l\'invite de commandes.'],
  ['HELP', 'Affiche cette aide.'],
  ['MKDIR / MD', 'Crée un dossier.'],
  ['MOVE', 'Déplace un élément : MOVE source dossier_destination'],
  ['REN', 'Renomme un fichier ou un dossier : REN ancien nouveau'],
  ['RMDIR / RD', 'Supprime un dossier (vers la Corbeille).'],
  ['START', 'Lance un fichier ou une application (START notepad, START C:\\Documents\\a.txt).'],
  ['TREE', 'Affiche l\'arborescence du dossier courant.'],
  ['TYPE', 'Affiche le contenu d\'un fichier texte.'],
  ['VER', 'Affiche la version du système.'],
  ['WHOAMI', 'Affiche l\'utilisateur courant.'],
];

const APP_ALIASES = {
  notepad: 'notepad', calc: 'calculator', explorer: 'explorer', cmd: 'cmd', taskmgr: 'taskmgr',
  control: 'settings', settings: 'settings', 'ms-settings:': 'settings', mspaint: 'imageviewer', photos: 'imageviewer',
};

function tokenize(line) {
  const tokens = [];
  const re = /"([^"]*)"|(>>|>)|([^\s">]+)/g;
  let m;
  while ((m = re.exec(line))) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

function launch({ cwd = '/Documents' } = {}) {
  const st = { cwd: normPath(cwd), history: [], hIndex: 0, busy: false };
  const output = h('div', { class: 'cmd-output' });
  const promptEl = h('span', { class: 'cmd-prompt' });
  const input = h('input', { class: 'cmd-input', type: 'text', spellcheck: 'false', autocomplete: 'off' });
  const line = h('div', { class: 'cmd-line' }, promptEl, input);
  const root = h('div', { class: 'cmd' }, output, line);
  const win = createWindow({
    appId: 'cmd', title: 'Invite de commandes', icon: '⬛', width: 760, height: 460, minWidth: 360, minHeight: 200, content: root,
  });

  const prompt = () => `${toWinPath(st.cwd)}>`;
  const print = (text = '', cls = '') => {
    output.append(h('div', { class: `cmd-row ${cls}`, text: text || '\u00a0' }));
  };
  const scroll = () => { root.scrollTop = root.scrollHeight; };
  const updatePrompt = () => { promptEl.textContent = prompt(); };

  /** Chemin saisi (style Windows ou Unix) -> chemin virtuel absolu (non résolu). */
  function toVirtual(arg) {
    let p = (arg || '').trim().replace(/^[a-z]:/i, '').replace(/\\/g, '/');
    if (!p) return st.cwd;
    if (!p.startsWith('/')) p = joinPath(st.cwd, p);
    return normPath(p);
  }

  /** Résout un chemin sans tenir compte de la casse. Retourne {path, entry} ou null. */
  async function resolve(arg) {
    const target = toVirtual(arg);
    if (target === '/') return { path: '/', entry: { type: 'dir', path: '/', name: '' } };
    let cur = '/';
    let entry = null;
    for (const seg of target.split('/').filter(Boolean)) {
      let entries;
      try {
        entries = await api.list(cur);
      } catch {
        return null;
      }
      entry = entries.find((e) => e.name.toLowerCase() === seg.toLowerCase());
      if (!entry) return null;
      cur = entry.path;
    }
    return { path: cur, entry };
  }

  async function needEntry(arg, kind) {
    if (!arg) throw new Error('La syntaxe de la commande n\'est pas correcte.');
    const r = await resolve(arg);
    if (!r) throw new Error(kind === 'dir' ? 'Le chemin d\'accès spécifié est introuvable.' : 'Le fichier spécifié est introuvable.');
    if (kind === 'dir' && r.entry.type !== 'dir') throw new Error('Nom de répertoire non valide.');
    if (kind === 'file' && r.entry.type !== 'file') throw new Error('Accès refusé : ceci est un dossier.');
    return r;
  }

  async function parentAndName(arg) {
    const target = toVirtual(arg);
    const parent = await needEntry(toWinPath(dirname(target)), 'dir');
    return { parent: parent.path, name: basename(target) };
  }

  const commands = {
    help: async () => {
      HELP.forEach(([c, d]) => print(`${c.padEnd(12)} ${d}`));
    },
    ver: async () => print('WinWeb [version 1.0.2026] — invite de commandes simulée'),
    whoami: async () => print('winweb\\utilisateur'),
    date: async () => print(`La date du jour est : ${new Date().toLocaleDateString('fr-FR')}`),
    time: async () => print(`L'heure actuelle est : ${new Date().toLocaleTimeString('fr-FR')}`),
    cls: async () => output.replaceChildren(),
    exit: async () => win.close(),
    echo: async (args, raw) => {
      const text = raw.replace(/^\s*echo\s?/i, '');
      const m = text.match(/^(.*?)\s*(>>|>)\s*("([^"]+)"|\S+)\s*$/);
      if (m) {
        const content = m[1];
        const file = m[4] ?? m[3];
        const { parent, name } = await parentAndName(file);
        const target = joinPath(parent, name);
        let previous = '';
        if (m[2] === '>>') {
          try { previous = (await api.read(target)).content; } catch { previous = ''; }
        }
        await api.write(target, `${previous}${content}\r\n`);
        fsChanged([parent]);
        return;
      }
      print(text.trim() === '' ? 'ECHO est activé.' : text);
    },
    cd: async (args) => {
      if (!args.length) { print(toWinPath(st.cwd)); return; }
      const arg = args.join(' ');
      const r = await needEntry(arg === '\\' ? '/' : arg, 'dir');
      st.cwd = r.path;
    },
    'cd..': async () => { st.cwd = dirname(st.cwd); },
    'cd\\': async () => { st.cwd = '/'; },
    dir: async (args) => {
      const r = await needEntry(args.join(' ') || toWinPath(st.cwd), 'dir');
      const entries = await api.list(r.path);
      print(` Répertoire de ${toWinPath(r.path)}`);
      print();
      let files = 0;
      let dirs = 0;
      let bytes = 0;
      for (const e of entries) {
        const date = formatDate(e.modified).replace(' ', '  ');
        if (e.type === 'dir') {
          dirs += 1;
          print(`${date}    <DIR>          ${e.name}`);
        } else {
          files += 1;
          bytes += e.size;
          print(`${date}    ${e.size.toLocaleString('fr-FR').padStart(14)} ${e.name}`);
        }
      }
      print(`${String(files).padStart(16)} fichier(s) ${bytes.toLocaleString('fr-FR').padStart(14)} octets`);
      print(`${String(dirs).padStart(16)} Rép(s)`);
    },
    tree: async () => {
      print(toWinPath(st.cwd));
      const walk = async (path, prefix, depth) => {
        if (depth > 6) return;
        const entries = await api.list(path);
        for (let i = 0; i < entries.length; i += 1) {
          const e = entries[i];
          const last = i === entries.length - 1;
          print(`${prefix}${last ? '└───' : '├───'}${e.name}`);
          if (e.type === 'dir') await walk(e.path, `${prefix}${last ? '    ' : '│   '}`, depth + 1);
        }
      };
      await walk(st.cwd, '', 0);
    },
    mkdir: async (args) => {
      if (!args.length) throw new Error('La syntaxe de la commande n\'est pas correcte.');
      for (const arg of args) {
        if (await resolve(arg)) throw new Error(`Un sous-répertoire ou un fichier ${arg} existe déjà.`);
        const { parent, name } = await parentAndName(arg);
        await api.create(parent, name, 'dir');
        fsChanged([parent]);
      }
    },
    del: async (args) => {
      if (!args.length) throw new Error('La syntaxe de la commande n\'est pas correcte.');
      const targets = [];
      for (const arg of args) {
        if (arg.includes('*')) {
          const { parent, name } = await parentAndName(arg);
          const re = new RegExp(`^${name.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
          const matches = (await api.list(parent)).filter((e) => e.type === 'file' && re.test(e.name));
          if (!matches.length) throw new Error('Impossible de trouver le fichier.');
          targets.push(...matches.map((e) => e.path));
        } else {
          targets.push((await needEntry(arg, 'file')).path);
        }
      }
      await api.remove(targets);
      fsChanged([...targets.map(dirname), '/Corbeille']);
      print(`${targets.length} fichier(s) déplacé(s) dans la Corbeille.`);
    },
    rmdir: async (args) => {
      const r = await needEntry(args.join(' '), 'dir');
      await api.remove([r.path]);
      fsChanged([dirname(r.path), '/Corbeille']);
    },
    type: async (args) => {
      const r = await needEntry(args.join(' '), 'file');
      const data = await api.read(r.path);
      data.content.split(/\r?\n/).forEach((l) => print(l));
    },
    ren: async (args) => {
      if (args.length !== 2) throw new Error('La syntaxe de la commande n\'est pas correcte.');
      const r = await needEntry(args[0]);
      await api.rename(r.path, args[1]);
      fsChanged([dirname(r.path)]);
    },
    copy: async (args) => {
      if (args.length !== 2) throw new Error('La syntaxe de la commande n\'est pas correcte.');
      const src = await needEntry(args[0]);
      const dest = await needEntry(args[1], 'dir');
      await api.copy([src.path], dest.path);
      fsChanged([dest.path]);
      print('        1 fichier(s) copié(s).');
    },
    move: async (args) => {
      if (args.length !== 2) throw new Error('La syntaxe de la commande n\'est pas correcte.');
      const src = await needEntry(args[0]);
      const dest = await needEntry(args[1], 'dir');
      await api.move([src.path], dest.path);
      fsChanged([dest.path, dirname(src.path)]);
      print('        1 élément(s) déplacé(s).');
    },
    start: async (args) => {
      if (!args.length) {
        launchApp('cmd', { cwd: st.cwd });
        return;
      }
      const name = args.join(' ');
      const alias = APP_ALIASES[name.toLowerCase().replace(/\.exe$/, '')];
      if (alias) {
        launchApp(alias, alias === 'explorer' ? { path: st.cwd } : {});
        return;
      }
      const r = await resolve(name);
      if (r) {
        openPath(r.path, r.entry.path === '/' ? null : r.entry);
        return;
      }
      const app = getApps().find((a) => a.id === name.toLowerCase() || a.name.toLowerCase() === name.toLowerCase());
      if (app) launchApp(app.id);
      else throw new Error(`Windows ne trouve pas « ${name} ». Vérifiez que vous avez tapé le nom correctement.`);
    },
  };
  Object.assign(commands, {
    md: commands.mkdir, erase: commands.del, rd: commands.rmdir, chdir: commands.cd, rename: commands.ren, '?': commands.help,
  });

  async function run(raw) {
    const text = raw.trim();
    print(`${prompt()}${raw}`, 'cmd-echo');
    if (!text) return;
    st.history.push(raw);
    st.hIndex = st.history.length;
    let tokens = tokenize(text);
    let name = tokens[0].toLowerCase();
    // « cd.. », « cd\ », « dir/w » collés
    const glued = name.match(/^(cd|dir)([.\\/].*)$/);
    if (glued && !commands[name]) {
      tokens = [glued[1], glued[2], ...tokens.slice(1)];
      name = glued[1];
    }
    const fn = commands[name];
    if (!fn) {
      // Un nom de fichier exécutable tapé directement : on le lance comme START.
      const r = await resolve(tokens.join(' '));
      if (r && r.entry.type === 'file') {
        openPath(r.path, r.entry);
        return;
      }
      print(`'${tokens[0]}' n'est pas reconnu en tant que commande interne`, 'cmd-error');
      print('ou externe, un programme exécutable ou un fichier de commandes. Tapez HELP.', 'cmd-error');
      return;
    }
    try {
      await fn(tokens.slice(1).filter((t) => t !== '>' && t !== '>>'), text);
    } catch (err) {
      print(err.message, 'cmd-error');
    }
  }

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      if (st.busy) return;
      const value = input.value;
      input.value = '';
      st.busy = true;
      line.classList.add('busy');
      await run(value);
      st.busy = false;
      line.classList.remove('busy');
      if (output.childElementCount > 2000) [...output.children].slice(0, 500).forEach((n) => n.remove());
      print('');
      updatePrompt();
      scroll();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (st.hIndex > 0) input.value = st.history[--st.hIndex];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      st.hIndex = Math.min(st.history.length, st.hIndex + 1);
      input.value = st.history[st.hIndex] || '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const m = input.value.match(/^(.*?)("?)([^\s"]*)$/);
      const partial = m[3].toLowerCase();
      try {
        const entries = await api.list(st.cwd);
        const hit = entries.find((en) => en.name.toLowerCase().startsWith(partial));
        if (hit) input.value = `${m[1]}${hit.name.includes(' ') ? `"${hit.name}"` : hit.name}`;
      } catch { /* ignore */ }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      output.replaceChildren();
    }
  });
  root.addEventListener('click', () => {
    if (!window.getSelection()?.toString()) input.focus();
  });

  print('WinWeb [version 1.0.2026]');
  print('Invite de commandes simulée. Tapez HELP pour la liste des commandes.');
  print('');
  updatePrompt();
  setTimeout(() => input.focus(), 50);
  return win;
}

export default { id: 'cmd', name: 'Invite de commandes', icon: '⬛', launch, description: 'dir, cd, mkdir, del, type, echo, cls, start…' };
