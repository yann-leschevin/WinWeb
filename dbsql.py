"""Bases de données SQLite (.wdb) pour l'application « Base de données ».

Le fichier .wdb est une base SQLite ordinaire stockée dans le VFS. Le SQL
envoyé par le client est exécuté dans une connexion verrouillée :
- ATTACH / VACUUM INTO impossibles (limite SQLITE_LIMIT_ATTACHED = 0), ce
  qui empêche toute lecture ou écriture de fichier hors de la base ouverte ;
- mode « defensive » et schéma non fiable (pas de corruption volontaire via
  writable_schema, pas de fonctions SQL dans le schéma) ;
- extensions non chargeables, PRAGMA limités à une liste blanche ;
- temps d'exécution limité et nombre de lignes renvoyées plafonné.
Bibliothèque standard uniquement.
"""

import sqlite3
import time

MAX_ROWS = 5000
MAX_SQL = 200_000
TIME_LIMIT = 4.0  # secondes par requête

SAFE_PRAGMAS = {
    "table_info", "table_xinfo", "index_list", "index_info", "foreign_key_list",
    "foreign_keys", "user_version", "integrity_check", "quick_check", "table_list",
}

_DENY = {sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH}


class DBError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def _authorizer(action, arg1, _arg2, _db, _trigger):
    if action in _DENY:
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_PRAGMA and (arg1 or "").lower() not in SAFE_PRAGMAS:
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def connect(real_path):
    try:
        conn = sqlite3.connect(real_path, timeout=3, isolation_level=None, check_same_thread=False)
    except sqlite3.Error as exc:
        raise DBError("Base de données illisible : %s" % exc) from exc
    try:
        conn.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
        conn.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
        conn.setconfig(sqlite3.SQLITE_DBCONFIG_TRUSTED_SCHEMA, False)
        if hasattr(conn, "enable_load_extension"):
            conn.enable_load_extension(False)
        # Journal en mémoire : pas de fichier « -journal » visible dans le VFS.
        conn.execute("PRAGMA journal_mode=MEMORY")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
    except sqlite3.DatabaseError as exc:
        conn.close()
        raise DBError("Ce fichier n'est pas une base de données valide : %s" % exc) from exc
    conn.set_authorizer(_authorizer)
    return conn


def split_statements(sql):
    """Découpe un script en instructions complètes (gère chaînes et commentaires)."""
    statements = []
    buf = ""
    for chunk in sql.split(";"):
        buf += chunk + ";"
        if sqlite3.complete_statement(buf):
            stmt = buf.strip()
            if stmt.strip(";").strip():
                statements.append(stmt)
            buf = ""
    rest = buf.rstrip(";").strip()
    if rest:
        statements.append(rest)
    return statements


def _cell(value):
    if isinstance(value, bytes):
        return "<BLOB %d octets>" % len(value)
    if isinstance(value, float) and value != value:  # NaN
        return None
    return value


def _run(conn, sql, params):
    deadline = time.monotonic() + TIME_LIMIT
    conn.set_progress_handler(lambda: 1 if time.monotonic() > deadline else 0, 10000)
    try:
        cur = conn.execute(sql, params)
        result = {"sql": sql, "columns": [], "rows": [], "truncated": False, "changes": 0}
        if cur.description:
            result["columns"] = [d[0] for d in cur.description]
            rows = cur.fetchmany(MAX_ROWS + 1)
            result["truncated"] = len(rows) > MAX_ROWS
            result["rows"] = [[_cell(v) for v in row] for row in rows[:MAX_ROWS]]
        else:
            result["changes"] = cur.rowcount if cur.rowcount >= 0 else 0
            result["lastrowid"] = cur.lastrowid
        return result
    except sqlite3.OperationalError as exc:
        if "interrupted" in str(exc):
            raise DBError("Requête interrompue : durée maximale de %d s dépassée" % TIME_LIMIT) from exc
        raise DBError(str(exc)) from exc
    except sqlite3.Error as exc:
        raise DBError(str(exc)) from exc
    finally:
        conn.set_progress_handler(None, 0)


def execute(real_path, sql, params=None):
    """Exécute une ou plusieurs instructions SQL ; retourne la liste des résultats."""
    if not isinstance(sql, str) or not sql.strip():
        raise DBError("Requête vide")
    if len(sql) > MAX_SQL:
        raise DBError("Requête trop longue")
    if params is not None and not isinstance(params, list):
        raise DBError("Paramètres invalides")
    for p in params or []:
        if p is not None and not isinstance(p, (str, int, float)):
            raise DBError("Type de paramètre non pris en charge")
    statements = split_statements(sql)
    if params and len(statements) != 1:
        raise DBError("Les paramètres ne sont acceptés qu'avec une seule instruction")
    conn = connect(real_path)
    try:
        return [_run(conn, stmt, params or []) for stmt in statements]
    finally:
        conn.close()


def _quote(name):
    return '"%s"' % name.replace('"', '""')


def schema(real_path):
    conn = connect(real_path)
    try:
        objects = []
        rows = conn.execute(
            "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') "
            "AND name NOT LIKE 'sqlite_%' ORDER BY type, name").fetchall()
        for name, kind, sql in rows:
            cols = [{"name": c[1], "type": c[2] or "", "notnull": bool(c[3]), "default": c[4], "pk": int(c[5])}
                    for c in conn.execute("PRAGMA table_info(%s)" % _quote(name)).fetchall()]
            try:
                count = conn.execute("SELECT count(*) FROM %s" % _quote(name)).fetchone()[0]
            except sqlite3.Error:
                count = None
            without_rowid = kind == "table" and "WITHOUT ROWID" in (sql or "").upper()
            objects.append({"name": name, "type": kind, "sql": sql, "columns": cols,
                            "count": count, "rowid": kind == "table" and not without_rowid})
        return objects
    finally:
        conn.close()
