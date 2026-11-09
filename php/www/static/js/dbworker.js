// Worker SQLite (sql.js / WebAssembly) pour l'application « Base de données ».
// Portage de dbsql.py : la base .wdb (fichier SQLite) est ouverte en mémoire,
// les requêtes sont exécutées, et la base modifiée est renvoyée pour être
// réenregistrée dans le PC virtuel. La page principale arrête ce worker si une
// requête dépasse 4 s (équivalent du « progress handler » de la version Python).
/* global initSqlJs */
importScripts('../vendor/sqljs/sql-wasm.js');

const MAX_ROWS = 5000;
const SAFE_PRAGMAS = new Set([
  'table_info', 'table_xinfo', 'index_list', 'index_info', 'foreign_key_list',
  'foreign_keys', 'user_version', 'integrity_check', 'quick_check', 'table_list',
]);

const ready = initSqlJs({ locateFile: (f) => `../vendor/sqljs/${f}` });

function open(SQL, bytes) {
  let db;
  try {
    db = new SQL.Database(new Uint8Array(bytes));
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('SELECT count(*) FROM sqlite_master');
  } catch (err) {
    db?.close();
    throw new Error(`Ce fichier n'est pas une base de données valide : ${err.message}`);
  }
  return db;
}

const scalar = (db, sql) => db.exec(sql)[0]?.values[0][0];

/** Liste blanche : pas d'ATTACH / DETACH, PRAGMA limités (comme l'« authorizer » Python). */
function checkAllowed(text) {
  const head = text.replace(/^(\s+|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, '');
  if (/^(ATTACH|DETACH)\b/i.test(head)) throw new Error('not authorized');
  const m = /^PRAGMA\s+(?:["`[]?\w+["`\]]?\s*\.\s*)?["`[]?(\w+)/i.exec(head);
  if (m && !SAFE_PRAGMAS.has(m[1].toLowerCase())) throw new Error('not authorized');
}

function cell(v) {
  if (v instanceof Uint8Array) return `<BLOB ${v.length} octets>`;
  if (typeof v === 'number' && Number.isNaN(v)) return null;
  return v;
}

function countStatements(SQL, bytes, sql) {
  const tmp = new SQL.Database(new Uint8Array(bytes));
  let n = 0;
  try {
    for (const s of tmp.iterateStatements(sql)) { n += 1; s.free(); if (n > 1) break; }
  } catch {
    if (n >= 1) n = 2; // une 2e instruction existe (même invalide)
  } finally {
    tmp.close();
  }
  return n;
}

function execute(SQL, bytes, sql, params) {
  if (params && params.length && countStatements(SQL, bytes, sql) > 1) {
    throw new Error('Les paramètres ne sont acceptés qu\'avec une seule instruction');
  }
  const db = open(SQL, bytes);
  try {
    const before = `${scalar(db, 'PRAGMA schema_version')}/${scalar(db, 'SELECT total_changes()')}`;
    const results = [];
    let error = null;
    // Comme en Python (mode autocommit), les instructions déjà exécutées sont
    // conservées même si une instruction suivante échoue.
    try {
    for (const stmt of db.iterateStatements(sql)) {
      const text = stmt.getSQL().trim();
      try {
        checkAllowed(text);
        if (params && params.length) stmt.bind(params);
        const res = { sql: text, columns: [], rows: [], truncated: false, changes: 0 };
        const cols = stmt.getColumnNames();
        if (cols.length) {
          res.columns = cols;
          while (stmt.step()) {
            if (res.rows.length >= MAX_ROWS) { res.truncated = true; break; }
            res.rows.push(stmt.get().map(cell));
          }
        } else {
          stmt.step();
          res.changes = db.getRowsModified();
          res.lastrowid = scalar(db, 'SELECT last_insert_rowid()');
        }
        results.push(res);
      } finally {
        stmt.free();
      }
    }
    } catch (err) {
      error = err?.message || String(err);
    }
    const after = `${scalar(db, 'PRAGMA schema_version')}/${scalar(db, 'SELECT total_changes()')}`;
    return { results, error, bytes: before !== after ? db.export() : null };
  } finally {
    db.close();
  }
}

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

function schema(SQL, bytes) {
  const db = open(SQL, bytes);
  try {
    const rows = db.exec(
      "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') "
      + "AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )[0]?.values || [];
    return rows.map(([name, kind, sqlText]) => {
      const info = db.exec(`PRAGMA table_info(${quote(name)})`)[0]?.values || [];
      const columns = info.map((c) => ({
        name: c[1], type: c[2] || '', notnull: Boolean(c[3]), default: c[4], pk: Number(c[5]),
      }));
      let count = null;
      try { count = scalar(db, `SELECT count(*) FROM ${quote(name)}`); } catch { count = null; }
      const withoutRowid = kind === 'table' && /WITHOUT\s+ROWID/i.test(sqlText || '');
      return { name, type: kind, sql: sqlText, columns, count, rowid: kind === 'table' && !withoutRowid };
    });
  } finally {
    db.close();
  }
}

ready.then(() => postMessage({ ready: true }), (err) => postMessage({ ready: false, error: String(err) }));

onmessage = async (e) => {
  const { id, op, bytes, sql, params } = e.data;
  try {
    const SQL = await ready;
    if (op === 'schema') {
      postMessage({ id, ok: true, objects: schema(SQL, bytes) });
    } else {
      const { results, error, bytes: out } = execute(SQL, bytes, sql, params);
      postMessage({ id, ok: !error, error, results, bytes: out }, out ? [out.buffer] : []);
    }
  } catch (err) {
    postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
