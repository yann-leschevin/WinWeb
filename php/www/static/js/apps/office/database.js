// Base de données (format .wdb = fichier SQLite) : tables, mode feuille de données
// modifiable, formulaire, création/modification de structure, requêtes SQL,
// import/export CSV. Les modifications sont enregistrées immédiatement, comme Access.
import { api } from '../../api.js';
import { fsChanged } from '../../bus.js';
import { showMenu } from '../../contextMenu.js';
import { confirmDialog, fileDialog, promptDialog } from '../../dialogs.js';
import { toast, toastError } from '../../notify.js';
import {
  basename, dirname, extname, h,
} from '../../utils.js';
import { createWindow } from '../../windowManager.js';
import {
  escapeCsv, parseCsv, rbBtn, ribbon,
} from './common.js';

const PAGE = 200;
const TYPES = [['TEXT', 'Texte'], ['INTEGER', 'Entier'], ['REAL', 'Réel'], ['NUMERIC', 'Numérique'], ['DATE', 'Date'], ['BOOLEAN', 'Oui/Non'], ['BLOB', 'Binaire']];
const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

const SAMPLE_SQL = `
CREATE TABLE Clients (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL, ville TEXT, email TEXT, inscrit DATE);
CREATE TABLE Produits (id INTEGER PRIMARY KEY AUTOINCREMENT, libelle TEXT NOT NULL, prix REAL NOT NULL, stock INTEGER DEFAULT 0);
CREATE TABLE Commandes (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER REFERENCES Clients(id), produit_id INTEGER REFERENCES Produits(id), quantite INTEGER NOT NULL DEFAULT 1, date DATE);
INSERT INTO Clients (nom, ville, email, inscrit) VALUES
 ('Dupont Marie', 'Paris', 'marie.dupont@exemple.fr', '2025-01-12'), ('Martin Paul', 'Lyon', 'paul.martin@exemple.fr', '2025-03-04'),
 ('Bernard Chloé', 'Nantes', 'chloe.b@exemple.fr', '2025-05-21'), ('Petit Lucas', 'Lille', 'lucas.petit@exemple.fr', '2025-07-30'),
 ('Durand Emma', 'Bordeaux', 'emma.durand@exemple.fr', '2025-09-02');
INSERT INTO Produits (libelle, prix, stock) VALUES ('Clavier', 39.9, 120), ('Souris', 19.5, 340), ('Écran 27"', 249, 35), ('Casque', 59, 80), ('Webcam', 45, 60);
INSERT INTO Commandes (client_id, produit_id, quantite, date) VALUES
 (1, 1, 2, '2026-01-05'), (1, 3, 1, '2026-01-05'), (2, 2, 3, '2026-02-11'), (3, 4, 1, '2026-02-20'),
 (4, 5, 2, '2026-03-02'), (5, 3, 2, '2026-03-15'), (2, 1, 1, '2026-04-01'), (3, 2, 5, '2026-04-18');
CREATE VIEW "Ventes par client" AS SELECT c.nom AS client, COUNT(*) AS commandes, ROUND(SUM(p.prix * o.quantite), 2) AS total
 FROM Commandes o JOIN Clients c ON c.id = o.client_id JOIN Produits p ON p.id = o.produit_id GROUP BY c.id ORDER BY total DESC;
`;

function launch({ path = null } = {}) {
  const state = {
    path: null, objects: [], current: null, view: 'welcome', page: 0, sort: null, desc: false, filter: '', formIndex: 0,
  };
  const sideList = h('div', { class: 'db-objects' });
  const main = h('div', { class: 'db-main' });
  const status = h('div', { class: 'db-status' });

  const win = createWindow({
    appId: 'database', title: 'Base de données', icon: '🗄️', width: 1060, height: 680, minWidth: 560, minHeight: 360,
  });
  const setTitle = () => win.setTitle(`${state.path ? `${basename(state.path)} - ` : ''}Base de données`);

  const exec = (sql, params) => api.dbExec(state.path, sql, params);
  const current = () => state.objects.find((o) => o.name === state.current) || null;

  // ---------------------------------------------------------------- base
  async function openDb(p) {
    try {
      const data = await api.dbSchema(p);
      state.path = data.path;
      state.objects = data.objects;
      state.current = state.objects.find((o) => o.type === 'table')?.name || state.objects[0]?.name || null;
      state.view = state.current ? 'data' : 'empty';
      state.page = 0;
      state.sort = null;
      state.filter = '';
      setTitle();
      renderSide();
      render();
    } catch (err) {
      toastError(err.message, 'Base de données');
    }
  }

  async function refreshSchema(keep = true) {
    const data = await api.dbSchema(state.path);
    state.objects = data.objects;
    if (!keep || !state.objects.some((o) => o.name === state.current)) {
      state.current = state.objects[0]?.name || null;
      if (!state.current && state.view !== 'sql') state.view = 'empty';
    }
    renderSide();
  }

  async function newDb(sample = false) {
    const target = await fileDialog({ mode: 'save', title: 'Nouvelle base de données', startDir: '/Documents', defaultName: sample ? 'Exemple.wdb' : 'Base1.wdb' });
    if (!target) return;
    const file = extname(target) === 'wdb' ? target : `${target}.wdb`;
    try {
      await api.write(file, '');
      fsChanged([dirname(file)]);
      if (sample) await api.dbExec(file, SAMPLE_SQL);
      await openDb(file);
    } catch (err) {
      toastError(err.message, 'Base de données');
    }
  }

  async function openDialog() {
    const target = await fileDialog({ mode: 'open', startDir: state.path ? dirname(state.path) : '/Documents', filter: ['wdb'] });
    if (target) openDb(target);
  }

  // ---------------------------------------------------------------- volet de navigation
  function renderSide() {
    const tables = state.objects.filter((o) => o.type === 'table');
    const views = state.objects.filter((o) => o.type === 'view');
    const item = (o) => h('button', {
      class: `db-obj${o.name === state.current && state.view !== 'sql' ? ' active' : ''}`, type: 'button', title: o.sql || '',
      onclick: () => { state.current = o.name; state.view = 'data'; state.page = 0; state.sort = null; state.filter = ''; renderSide(); render(); },
      oncontextmenu: (e) => {
        e.preventDefault();
        state.current = o.name;
        showMenu(e.clientX, e.clientY, [
          { label: 'Ouvrir', icon: '▦', action: () => { state.view = 'data'; renderSide(); render(); } },
          { label: 'Formulaire', icon: '🗂️', action: () => { state.view = 'form'; state.formIndex = 0; renderSide(); render(); } },
          { label: 'Mode création', icon: '📐', disabled: o.type !== 'table', action: () => { state.view = 'design'; renderSide(); render(); } },
          { label: 'Exporter en CSV…', icon: '📤', action: () => exportCsv(o.name) },
          { separator: true },
          { label: 'Renommer…', icon: '✏️', disabled: o.type !== 'table', action: () => renameTable(o.name) },
          { label: 'Supprimer', icon: '🗑️', action: () => dropObject(o) },
        ]);
      },
    }, h('span', { text: o.type === 'view' ? '🔎' : '▦' }), h('span', { class: 'db-obj-name', text: o.name }),
    o.count !== null && o.count !== undefined ? h('span', { class: 'db-obj-count', text: String(o.count) }) : null);
    sideList.replaceChildren(...[
      h('div', { class: 'db-side-title', text: 'Tables' }),
      ...(tables.length ? tables.map(item) : [h('div', { class: 'db-side-empty', text: 'Aucune table' })]),
      views.length ? h('div', { class: 'db-side-title', text: 'Requêtes enregistrées (vues)' }) : null,
      ...views.map(item),
    ].filter(Boolean));
  }

  // ---------------------------------------------------------------- rendu principal
  function render() {
    if (!state.path || state.view === 'welcome') return renderWelcome();
    if (state.view === 'empty') {
      main.replaceChildren(h('div', { class: 'db-empty' },
        h('p', { text: 'Cette base ne contient encore aucune table.' }),
        h('button', { class: 'btn primary', type: 'button', text: '➕ Créer une table', onclick: () => newTableDesign() }),
        h('button', { class: 'btn', type: 'button', text: '⬆️ Importer un CSV', onclick: importCsv })));
      status.textContent = state.path;
      return null;
    }
    if (state.view === 'sql') return renderSql();
    if (state.view === 'design') return renderDesign();
    if (state.view === 'newtable') return null;
    if (state.view === 'form') return renderForm();
    return renderData();
  }

  function renderWelcome() {
    main.replaceChildren(h('div', { class: 'db-welcome' },
      h('div', { class: 'db-welcome-ico', text: '🗄️' }),
      h('h2', { text: 'Base de données' }),
      h('p', { text: 'Créez des tables, saisissez des données, interrogez-les en SQL. Les bases sont des fichiers SQLite (.wdb) de votre dossier Documents.' }),
      h('div', { class: 'db-welcome-btns' },
        h('button', { class: 'btn primary', type: 'button', text: '➕ Base de données vide', onclick: () => newDb(false) }),
        h('button', { class: 'btn', type: 'button', text: '🛒 Base exemple (clients, produits, commandes)', onclick: () => newDb(true) }),
        h('button', { class: 'btn', type: 'button', text: '📂 Ouvrir une base…', onclick: openDialog }))));
    status.textContent = 'Aucune base ouverte';
  }

  // ---------------------------------------------------------------- feuille de données
  function whereClause(obj) {
    if (!state.filter) return { sql: '', params: [] };
    const cols = obj.columns.map((c) => `CAST(${q(c.name)} AS TEXT) LIKE ?`);
    return { sql: ` WHERE ${cols.join(' OR ')}`, params: obj.columns.map(() => `%${state.filter}%`) };
  }

  async function renderData() {
    const obj = current();
    if (!obj) return;
    const editable = obj.type === 'table' && obj.rowid;
    const where = whereClause(obj);
    const order = state.sort ? ` ORDER BY ${q(state.sort)} ${state.desc ? 'DESC' : 'ASC'}` : '';
    const select = editable ? `SELECT rowid AS "__rowid__", * FROM ${q(obj.name)}` : `SELECT * FROM ${q(obj.name)}`;
    let rows;
    let columns;
    let total;
    try {
      const [res] = await exec(`${select}${where.sql}${order} LIMIT ${PAGE} OFFSET ${state.page * PAGE}`, where.params.length ? where.params : undefined);
      const [cnt] = await exec(`SELECT count(*) FROM ${q(obj.name)}${where.sql}`, where.params.length ? where.params : undefined);
      ({ rows, columns } = res);
      total = cnt.rows[0][0];
    } catch (err) {
      main.replaceChildren(h('div', { class: 'db-error', text: err.message }));
      return;
    }
    const rowidIdx = editable ? columns.indexOf('__rowid__') : -1;
    const shownCols = columns.map((name, i) => ({ name, i })).filter((c) => c.i !== rowidIdx);
    const colInfo = Object.fromEntries(obj.columns.map((c) => [c.name, c]));
    const selectedRows = new Set();

    const search = h('input', { class: 'input db-search', type: 'search', placeholder: '🔍 Rechercher dans la table', value: state.filter });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.filter = search.value.trim(); state.page = 0; renderData(); } });
    const pager = h('div', { class: 'db-pager' },
      h('button', { class: 'btn icon flat', type: 'button', text: '⏮', disabled: state.page === 0, onclick: () => { state.page = 0; renderData(); } }),
      h('button', { class: 'btn icon flat', type: 'button', text: '◀', disabled: state.page === 0, onclick: () => { state.page -= 1; renderData(); } }),
      h('span', { text: `Enr. ${total ? state.page * PAGE + 1 : 0}–${Math.min(total, (state.page + 1) * PAGE)} sur ${total}` }),
      h('button', { class: 'btn icon flat', type: 'button', text: '▶', disabled: (state.page + 1) * PAGE >= total, onclick: () => { state.page += 1; renderData(); } }),
      h('button', { class: 'btn icon flat', type: 'button', text: '⏭', disabled: (state.page + 1) * PAGE >= total, onclick: () => { state.page = Math.max(0, Math.ceil(total / PAGE) - 1); renderData(); } }));
    const delBtn = h('button', { class: 'btn', type: 'button', text: '🗑️ Supprimer la sélection', disabled: true, onclick: () => deleteRows([...selectedRows]) });

    const head = h('tr', {}, h('th', { class: 'db-sel-h' }), shownCols.map(({ name }) => h('th', {
      class: 'db-th', title: colInfo[name] ? `${colInfo[name].type || 'sans type'}${colInfo[name].pk ? ' · clé primaire' : ''}` : '',
      onclick: () => { if (state.sort === name) state.desc = !state.desc; else { state.sort = name; state.desc = false; } renderData(); },
    }, colInfo[name]?.pk ? '🔑 ' : '', name, state.sort === name ? (state.desc ? ' ▼' : ' ▲') : '')));
    const body = h('tbody');
    for (const row of rows) {
      const rowid = editable ? row[rowidIdx] : null;
      const tr = h('tr', {}, h('td', {
        class: 'db-sel', text: '',
        onclick: (e) => {
          if (!editable) return;
          if (!e.ctrlKey && !e.shiftKey) { selectedRows.clear(); body.querySelectorAll('tr.sel').forEach((n) => n.classList.remove('sel')); }
          if (selectedRows.has(rowid)) { selectedRows.delete(rowid); tr.classList.remove('sel'); } else { selectedRows.add(rowid); tr.classList.add('sel'); }
          delBtn.disabled = !selectedRows.size;
        },
      }));
      for (const { name, i } of shownCols) tr.append(dataCell(obj, colInfo[name], name, row[i], rowid, editable));
      body.append(tr);
    }
    if (editable) {
      // Ligne « nouvel enregistrement »
      const tr = h('tr', { class: 'db-new' }, h('td', { class: 'db-sel', text: '✱' }));
      for (const { name } of shownCols) {
        const td = h('td', { class: 'db-cell', contenteditable: 'true', spellcheck: 'false' });
        td.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); td.blur(); } });
        td.addEventListener('blur', async () => {
          const text = td.textContent;
          if (!text) return;
          try {
            await exec(`INSERT INTO ${q(obj.name)} (${q(name)}) VALUES (?)`, [convert(text, colInfo[name])]);
            await refreshSchema();
            renderData();
          } catch (err) { toastError(err.message, 'Ajout impossible'); td.textContent = ''; }
        });
        tr.append(td);
      }
      body.append(tr);
    }
    main.replaceChildren(
      h('div', { class: 'db-toolbar' }, search, editable ? delBtn : h('span', { class: 'db-ro', text: obj.type === 'view' ? 'Vue (lecture seule)' : 'Lecture seule (table WITHOUT ROWID)' }), h('span', { class: 'db-spacer' }), pager),
      h('div', { class: 'db-grid' }, h('table', { class: 'db-table' }, h('thead', {}, head), body)),
    );
    status.textContent = `${obj.name} · ${total} enregistrement(s)${state.filter ? ` (filtre : « ${state.filter} »)` : ''} · ${state.path}`;
  }

  function convert(text, col) {
    if (text === '') return null;
    const type = (col?.type || '').toUpperCase();
    if (/INT|REAL|FLOA|DOUB|NUM|DEC|BOOL/.test(type)) {
      const t = text.trim().toLowerCase();
      if (/BOOL/.test(type) && ['oui', 'vrai', 'true', 'yes'].includes(t)) return 1;
      if (/BOOL/.test(type) && ['non', 'faux', 'false', 'no'].includes(t)) return 0;
      const n = Number(text.replace(',', '.').trim());
      if (!Number.isNaN(n)) return n;
    }
    return text;
  }
  const show = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v));

  function dataCell(obj, col, name, value, rowid, editable) {
    const td = h('td', { class: `db-cell${value === null ? ' null' : ''}${typeof value === 'number' ? ' num' : ''}`, text: show(value), title: value === null ? 'NULL' : '' });
    if (!editable || String(value).startsWith('<BLOB')) return td;
    td.contentEditable = 'true';
    td.spellcheck = false;
    td.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); td.blur(); }
      if (e.key === 'Escape') { td.textContent = show(value); td.blur(); }
    });
    td.addEventListener('blur', async () => {
      const text = td.textContent;
      if (text === show(value)) return;
      try {
        await exec(`UPDATE ${q(obj.name)} SET ${q(name)} = ? WHERE rowid = ?`, [convert(text, col), rowid]);
        value = convert(text, col);
        td.classList.toggle('null', value === null);
        td.classList.add('saved');
        setTimeout(() => td.classList.remove('saved'), 700);
      } catch (err) {
        toastError(err.message, 'Modification refusée');
        td.textContent = show(value);
      }
    });
    return td;
  }

  async function deleteRows(ids) {
    if (!ids.length) return;
    if (!(await confirmDialog(`Supprimer ${ids.length} enregistrement(s) ? Cette action est définitive.`, { title: 'Base de données', icon: '🗑️', danger: true }))) return;
    try {
      await exec(`DELETE FROM ${q(state.current)} WHERE rowid IN (${ids.map(() => '?').join(',')})`, ids);
      await refreshSchema();
      renderData();
    } catch (err) { toastError(err.message); }
  }

  // ---------------------------------------------------------------- formulaire
  async function renderForm() {
    const obj = current();
    if (!obj) return;
    const editable = obj.type === 'table' && obj.rowid;
    const [cnt] = await exec(`SELECT count(*) FROM ${q(obj.name)}`);
    const total = cnt.rows[0][0];
    state.formIndex = Math.max(0, Math.min(state.formIndex, total));
    const isNew = state.formIndex >= total;
    let record = null;
    let rowid = null;
    if (!isNew) {
      const [res] = await exec(`SELECT ${editable ? 'rowid AS "__rowid__", ' : ''}* FROM ${q(obj.name)} LIMIT 1 OFFSET ${state.formIndex}`);
      record = Object.fromEntries(res.columns.map((c, i) => [c, res.rows[0][i]]));
      rowid = record.__rowid__;
    }
    const inputs = {};
    const fields = obj.columns.map((col) => {
      const input = h('input', { class: 'input', type: 'text', value: record ? show(record[col.name]) : '', disabled: !editable, placeholder: col.pk && isNew ? '(automatique)' : '' });
      inputs[col.name] = input;
      return h('label', { class: 'db-field' }, h('span', { text: `${col.pk ? '🔑 ' : ''}${col.name}` }), input,
        h('small', { text: TYPES.find(([t]) => (col.type || '').toUpperCase().startsWith(t))?.[1] || col.type || '' }));
    });
    const save = async () => {
      const cols = obj.columns.filter((c) => !(isNew && c.pk && inputs[c.name].value === ''));
      try {
        if (isNew) {
          await exec(`INSERT INTO ${q(obj.name)} (${cols.map((c) => q(c.name)).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
            cols.map((c) => convert(inputs[c.name].value, c)));
        } else {
          await exec(`UPDATE ${q(obj.name)} SET ${cols.map((c) => `${q(c.name)} = ?`).join(', ')} WHERE rowid = ?`,
            [...cols.map((c) => convert(inputs[c.name].value, c)), rowid]);
        }
        toast('Base de données', 'Enregistrement sauvegardé', { icon: '💾', timeout: 1500 });
        await refreshSchema();
        renderForm();
      } catch (err) { toastError(err.message, 'Enregistrement refusé'); }
    };
    const go = (i) => { state.formIndex = i; renderForm(); };
    main.replaceChildren(h('div', { class: 'db-form' },
      h('h3', { text: `${obj.name} — ${isNew ? 'Nouvel enregistrement' : `Enregistrement ${state.formIndex + 1} sur ${total}`}` }),
      h('div', { class: 'db-fields' }, fields),
      h('div', { class: 'db-form-nav' },
        h('button', { class: 'btn', type: 'button', text: '⏮', disabled: state.formIndex === 0, onclick: () => go(0) }),
        h('button', { class: 'btn', type: 'button', text: '◀ Précédent', disabled: state.formIndex === 0, onclick: () => go(state.formIndex - 1) }),
        h('button', { class: 'btn', type: 'button', text: 'Suivant ▶', disabled: isNew, onclick: () => go(state.formIndex + 1) }),
        h('button', { class: 'btn', type: 'button', text: '✱ Nouveau', disabled: !editable, onclick: () => go(total) }),
        h('span', { class: 'db-spacer' }),
        editable && !isNew ? h('button', { class: 'btn danger', type: 'button', text: '🗑️ Supprimer', onclick: async () => { await deleteRows([rowid]); renderForm(); } }) : null,
        editable ? h('button', { class: 'btn primary', type: 'button', text: '💾 Enregistrer', onclick: save }) : null)));
    status.textContent = `${obj.name} · mode formulaire · ${state.path}`;
  }

  // ---------------------------------------------------------------- création / structure
  function fieldRow(field = { name: '', type: 'TEXT', pk: false, notnull: false, def: '' }) {
    const name = h('input', { class: 'input', value: field.name, placeholder: 'Nom du champ' });
    const type = h('select', { class: 'input' }, TYPES.map(([v, l]) => h('option', { value: v, text: l })));
    type.value = field.type;
    const pk = h('input', { type: 'checkbox', checked: field.pk || undefined });
    const nn = h('input', { type: 'checkbox', checked: field.notnull || undefined });
    const def = h('input', { class: 'input', value: field.def, placeholder: 'Valeur par défaut' });
    const row = h('div', { class: 'db-design-row' }, name, type, h('label', {}, pk, ' Clé'), h('label', {}, nn, ' Requis'), def,
      h('button', { class: 'btn icon flat', type: 'button', text: '✕', title: 'Retirer', onclick: () => row.remove() }));
    row.read = () => ({ name: name.value.trim(), type: type.value, pk: pk.checked, notnull: nn.checked, def: def.value.trim() });
    return row;
  }

  function columnSql(f) {
    let sql = `${q(f.name)} ${f.type}`;
    if (f.pk) sql += f.type === 'INTEGER' ? ' PRIMARY KEY AUTOINCREMENT' : ' PRIMARY KEY';
    if (f.notnull) sql += ' NOT NULL';
    if (f.def !== '') sql += ` DEFAULT ${/^-?\d+([.,]\d+)?$/.test(f.def) ? f.def.replace(',', '.') : `'${f.def.replace(/'/g, "''")}'`}`;
    return sql;
  }

  function newTableDesign() {
    state.view = 'newtable';
    const nameInput = h('input', { class: 'input', value: `Table${state.objects.filter((o) => o.type === 'table').length + 1}` });
    const rows = h('div', { class: 'db-design-rows' },
      fieldRow({ name: 'id', type: 'INTEGER', pk: true, notnull: false, def: '' }), fieldRow({ name: 'nom', type: 'TEXT', pk: false, notnull: false, def: '' }));
    main.replaceChildren(h('div', { class: 'db-design' },
      h('h3', { text: 'Nouvelle table' }),
      h('label', { class: 'db-field' }, h('span', { text: 'Nom de la table' }), nameInput),
      h('div', { class: 'db-design-head' }, h('span', { text: 'Champ' }), h('span', { text: 'Type' })),
      rows,
      h('div', { class: 'db-form-nav' },
        h('button', { class: 'btn', type: 'button', text: '➕ Ajouter un champ', onclick: () => rows.append(fieldRow()) }),
        h('span', { class: 'db-spacer' }),
        h('button', { class: 'btn', type: 'button', text: 'Annuler', onclick: () => { state.view = state.current ? 'data' : 'empty'; render(); } }),
        h('button', {
          class: 'btn primary', type: 'button', text: '✔ Créer la table',
          onclick: async () => {
            const fields = [...rows.children].map((r) => r.read()).filter((f) => f.name);
            const tname = nameInput.value.trim();
            if (!tname || !fields.length) { toastError('Indiquez un nom de table et au moins un champ'); return; }
            try {
              await exec(`CREATE TABLE ${q(tname)} (${fields.map(columnSql).join(', ')})`);
              state.current = tname;
              state.view = 'data';
              await refreshSchema();
              render();
            } catch (err) { toastError(err.message, 'Création impossible'); }
          },
        }))));
    nameInput.focus();
    nameInput.select();
  }

  function renderDesign() {
    const obj = current();
    if (!obj) return;
    const rows = obj.columns.map((c) => h('tr', {},
      h('td', { text: `${c.pk ? '🔑 ' : ''}${c.name}` }), h('td', { text: c.type || '—' }), h('td', { text: c.notnull ? 'Oui' : '' }),
      h('td', { text: c.default === null ? '' : String(c.default) }),
      h('td', {}, obj.type === 'table' ? h('button', { class: 'btn flat', type: 'button', text: '✏️', title: 'Renommer le champ', onclick: () => renameColumn(c.name) }) : null,
        obj.type === 'table' && !c.pk ? h('button', { class: 'btn flat', type: 'button', text: '🗑️', title: 'Supprimer le champ', onclick: () => dropColumn(c.name) }) : null)));
    const add = fieldRow();
    add.lastChild.remove();
    main.replaceChildren(h('div', { class: 'db-design' },
      h('h3', { text: `Structure de « ${obj.name} »` }),
      h('table', { class: 'db-table db-struct' }, h('thead', {}, h('tr', {}, ['Champ', 'Type', 'Requis', 'Défaut', ''].map((t) => h('th', { text: t })))), h('tbody', {}, rows)),
      obj.type === 'table' ? h('div', { class: 'db-add-field' }, h('h4', { text: 'Ajouter un champ' }), add,
        h('button', {
          class: 'btn primary', type: 'button', text: '➕ Ajouter',
          onclick: async () => {
            const f = add.read();
            if (!f.name) return;
            f.pk = false;
            try { await exec(`ALTER TABLE ${q(obj.name)} ADD COLUMN ${columnSql(f)}`); await refreshSchema(); renderDesign(); } catch (err) { toastError(err.message); }
          },
        })) : null,
      h('details', { class: 'db-sql-def' }, h('summary', { text: 'Définition SQL' }), h('pre', { text: obj.sql || '' }))));
    status.textContent = `${obj.name} · mode création`;
  }

  async function renameColumn(col) {
    const name = await promptDialog(`Nouveau nom du champ « ${col} » :`, col, { title: 'Renommer le champ', icon: '✏️' });
    if (!name || name === col) return;
    try { await exec(`ALTER TABLE ${q(state.current)} RENAME COLUMN ${q(col)} TO ${q(name.trim())}`); await refreshSchema(); renderDesign(); } catch (err) { toastError(err.message); }
  }
  async function dropColumn(col) {
    if (!(await confirmDialog(`Supprimer le champ « ${col} » et toutes ses données ?`, { title: 'Base de données', icon: '🗑️', danger: true }))) return;
    try { await exec(`ALTER TABLE ${q(state.current)} DROP COLUMN ${q(col)}`); await refreshSchema(); renderDesign(); } catch (err) { toastError(err.message); }
  }
  async function renameTable(name) {
    const nn = await promptDialog('Nouveau nom de la table :', name, { title: 'Renommer', icon: '✏️' });
    if (!nn || nn === name) return;
    try { await exec(`ALTER TABLE ${q(name)} RENAME TO ${q(nn.trim())}`); state.current = nn.trim(); await refreshSchema(); render(); } catch (err) { toastError(err.message); }
  }
  async function dropObject(o) {
    if (!(await confirmDialog(`Supprimer ${o.type === 'view' ? 'la vue' : 'la table'} « ${o.name} » ? Cette action est définitive.`, { title: 'Base de données', icon: '🗑️', danger: true }))) return;
    try { await exec(`DROP ${o.type === 'view' ? 'VIEW' : 'TABLE'} ${q(o.name)}`); await refreshSchema(false); render(); } catch (err) { toastError(err.message); }
  }

  // ---------------------------------------------------------------- SQL
  const sqlBox = h('textarea', { class: 'db-sql', spellcheck: 'false', placeholder: 'SELECT * FROM ...;   (Ctrl+Entrée pour exécuter)' });
  const sqlOut = h('div', { class: 'db-sql-out' });
  const history = [];
  sqlBox.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runSql(); }
    else if (e.key === 'Tab') { e.preventDefault(); sqlBox.setRangeText('  ', sqlBox.selectionStart, sqlBox.selectionEnd, 'end'); }
  });

  function renderSql() {
    if (!sqlBox.value) sqlBox.value = state.current ? `SELECT *\nFROM ${q(state.current)}\nLIMIT 100;` : '';
    main.replaceChildren(h('div', { class: 'db-sqlview' },
      h('div', { class: 'db-toolbar' },
        h('button', { class: 'btn primary', type: 'button', text: '▶ Exécuter', title: 'Ctrl+Entrée', onclick: runSql }),
        h('button', {
          class: 'btn', type: 'button', text: '💾 Enregistrer comme vue…',
          onclick: async () => {
            const name = await promptDialog('Nom de la requête enregistrée (vue) :', 'Requête1', { title: 'Enregistrer la requête', icon: '🔎' });
            if (!name) return;
            try {
              await exec(`CREATE VIEW ${q(name.trim())} AS ${sqlBox.value.trim().replace(/;\s*$/, '')}`);
              await refreshSchema();
              toast('Base de données', `Vue « ${name} » créée`, { icon: '🔎' });
            } catch (err) { toastError(err.message); }
          },
        }),
        h('button', {
          class: 'btn', type: 'button', text: '🕘 Historique',
          onclick: (e) => {
            const r = e.currentTarget.getBoundingClientRect();
            showMenu(r.left, r.bottom + 2, history.length ? history.slice(-15).reverse().map((s) => ({ label: s.replace(/\s+/g, ' ').slice(0, 70), action: () => { sqlBox.value = s; } })) : [{ label: 'Historique vide', disabled: true }]);
          },
        }),
        h('span', { class: 'db-spacer' }),
        h('span', { class: 'db-hint', text: 'SQLite · ATTACH et fichiers externes interdits' })),
      sqlBox, sqlOut));
    sqlBox.focus();
    status.textContent = `Requête SQL · ${state.path}`;
  }

  async function runSql() {
    const sql = sqlBox.value.trim();
    if (!sql) return;
    if (history[history.length - 1] !== sql) history.push(sql);
    sqlOut.replaceChildren(h('div', { class: 'db-hint', text: 'Exécution…' }));
    const t0 = performance.now();
    try {
      const results = await exec(sql);
      const ms = Math.round(performance.now() - t0);
      sqlOut.replaceChildren(...results.map((r) => {
        if (!r.columns.length) return h('div', { class: 'db-msg', text: `✔ ${r.sql.split('\n')[0].slice(0, 80)} — ${r.changes} ligne(s) affectée(s)` });
        return h('div', { class: 'db-result' },
          h('div', { class: 'db-msg', text: `${r.rows.length} ligne(s)${r.truncated ? ' (tronqué à 5000)' : ''} · ${ms} ms` }),
          h('div', { class: 'db-grid' }, h('table', { class: 'db-table' },
            h('thead', {}, h('tr', {}, r.columns.map((c) => h('th', { text: c })))),
            h('tbody', {}, r.rows.map((row) => h('tr', {}, row.map((v) => h('td', { class: `${v === null ? 'null' : ''}${typeof v === 'number' ? ' num' : ''}`, text: show(v) }))))))),
          h('button', { class: 'btn flat', type: 'button', text: '📤 Exporter ce résultat en CSV…', onclick: () => saveCsv(r.columns, r.rows, 'Resultat') }));
      }));
      if (results.some((r) => !r.columns.length)) await refreshSchema();
    } catch (err) {
      sqlOut.replaceChildren(h('div', { class: 'db-error', text: `⛔ ${err.message}` }));
    }
  }

  // ---------------------------------------------------------------- CSV
  async function saveCsv(columns, rows, base) {
    const target = await fileDialog({ mode: 'save', title: 'Exporter en CSV', startDir: dirname(state.path), defaultName: `${base}.csv` });
    if (!target) return;
    const text = [columns, ...rows].map((row) => row.map((v) => escapeCsv(typeof v === 'number' ? String(v).replace('.', ',') : v, ';')).join(';')).join('\r\n');
    try {
      const entry = await api.write(target, text);
      fsChanged([dirname(entry.path)]);
      toast('Base de données', `Exporté : ${entry.name}`, { icon: '📤' });
    } catch (err) { toastError(err.message); }
  }
  async function exportCsv(name) {
    try {
      const [res] = await exec(`SELECT * FROM ${q(name)}`);
      await saveCsv(res.columns, res.rows, name);
    } catch (err) { toastError(err.message); }
  }
  async function importCsv() {
    const src = await fileDialog({ mode: 'open', title: 'Importer un fichier CSV', startDir: '/Documents', filter: ['csv', 'tsv', 'txt'] });
    if (!src) return;
    try {
      const { content } = await api.read(src);
      const { rows } = parseCsv(content);
      if (rows.length < 1) throw new Error('Fichier vide');
      const header = rows[0].map((c, i) => c.trim() || `Champ${i + 1}`);
      const data = rows.slice(1).filter((r) => r.some((v) => v !== ''));
      const numeric = header.map((_, i) => data.length > 0 && data.every((r) => (r[i] ?? '') === '' || /^-?\d+([.,]\d+)?$/.test(r[i].trim())));
      const tname = (await promptDialog('Nom de la nouvelle table :', basename(src).replace(/\.[^.]+$/, ''), { title: 'Importer un CSV', icon: '⬆️' }))?.trim();
      if (!tname) return;
      const cols = header.map((c, i) => `${q(c)} ${numeric[i] ? 'REAL' : 'TEXT'}`).join(', ');
      const values = data.map((r) => `(${header.map((_, i) => {
        const v = r[i] ?? '';
        if (v === '') return 'NULL';
        return numeric[i] ? String(Number(v.replace(',', '.'))) : `'${v.replace(/'/g, "''")}'`;
      }).join(', ')})`);
      let sql = `CREATE TABLE ${q(tname)} (${cols});`;
      for (let i = 0; i < values.length; i += 500) sql += `\nINSERT INTO ${q(tname)} VALUES ${values.slice(i, i + 500).join(', ')};`;
      await exec(sql);
      state.current = tname;
      state.view = 'data';
      await refreshSchema();
      render();
      toast('Base de données', `${data.length} enregistrement(s) importé(s) dans « ${tname} »`, { icon: '⬆️' });
    } catch (err) { toastError(err.message, 'Import impossible'); }
  }

  // ---------------------------------------------------------------- ruban
  const needDb = (fn) => () => { if (!state.path) { toastError('Ouvrez ou créez d\'abord une base de données'); return; } fn(); };
  const setView = (v) => needDb(() => { if (!current() && v !== 'sql') return; state.view = v; state.formIndex = 0; renderSide(); render(); });
  const fileMenu = () => [
    { label: 'Nouvelle base vide…', icon: '📄', action: () => newDb(false) },
    { label: 'Nouvelle base exemple…', icon: '🛒', action: () => newDb(true) },
    { label: 'Ouvrir…', hint: 'Ctrl+O', icon: '📂', action: openDialog },
    { label: 'Nouvelle fenêtre', action: () => launch() },
    { separator: true },
    { label: 'Importer un CSV…', icon: '⬆️', disabled: !state.path, action: importCsv },
    { label: 'Exporter la table en CSV…', icon: '📤', disabled: !state.current, action: () => exportCsv(state.current) },
    { separator: true },
    { label: 'Fermer', action: () => win.close() },
  ];
  const rb = ribbon([
    {
      label: 'Accueil',
      groups: [
        {
          label: 'Affichages',
          items: [rbBtn('▦<br>Feuille de données', 'Mode feuille de données', setView('data'), { big: true }),
            rbBtn('🗂️<br>Formulaire', 'Un enregistrement à la fois', setView('form'), { big: true }),
            rbBtn('📐<br>Création', 'Structure de la table', setView('design'), { big: true })],
        },
        { label: 'Enregistrements', items: [rbBtn('🔄 Actualiser', 'Actualiser', needDb(async () => { await refreshSchema(); render(); }))] },
      ],
    },
    {
      label: 'Créer',
      groups: [
        { label: 'Tables', items: [rbBtn('➕<br>Table', 'Créer une table', needDb(newTableDesign), { big: true })] },
        { label: 'Requêtes', items: [rbBtn('🔎<br>Requête SQL', 'Écrire une requête SQL', needDb(() => { state.view = 'sql'; renderSide(); render(); }), { big: true })] },
      ],
    },
    {
      label: 'Données externes',
      groups: [{
        label: 'CSV',
        items: [rbBtn('⬆️<br>Importer', 'Importer un CSV en nouvelle table', needDb(importCsv), { big: true }),
          rbBtn('📤<br>Exporter', 'Exporter la table en CSV', needDb(() => state.current && exportCsv(state.current)), { big: true })],
      }],
    },
  ], { fileMenu, showMenu, accent: '#a4373a' });

  win.body.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); openDialog(); }
  });
  win.body.append(h('div', { class: 'office-app database' }, rb,
    h('div', { class: 'db-body' }, h('div', { class: 'db-side' }, sideList), main), status));
  renderSide();
  render();
  if (path) openDb(path);
  return win;
}

export default {
  id: 'database', name: 'Base de données', icon: '🗄️', launch, description: 'Bases SQLite (.wdb) : tables, formulaires, SQL',
};
