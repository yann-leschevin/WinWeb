"""WinWeb — un bureau de type Windows 11 dans le navigateur.

Lancement :  python3 app.py            (http://127.0.0.1:5000)
Options   :  --host 127.0.0.1 --port 5000 --debug

Sécurité : aucun fichier déposé n'est exécuté côté serveur. Les contenus
utilisateur sont servis avec l'en-tête ``Content-Security-Policy: sandbox``
et affichés côté client dans des iframes ``sandbox="allow-scripts"``.
"""

import argparse
import io
import mimetypes
import os
from html import escape as html_escape

from flask import Flask, abort, jsonify, render_template, request, send_file
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

import dbsql
import pe_info
import wapp
import web_proxy
from vfs import TRASH_PATH, VFS, VFSError, is_within, normalize

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("WINWEB_DATA", os.path.join(BASE_DIR, "data"))
MAX_UPLOAD_MB = int(os.environ.get("WINWEB_MAX_UPLOAD_MB", "200"))
# Mandataire du navigateur web : WINWEB_WEB_PROXY=0 pour le désactiver.
WEB_PROXY = os.environ.get("WINWEB_WEB_PROXY", "1") != "0"

for ext, mime in {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".wapp": "application/zip",
    ".json": "application/json",
    ".md": "text/markdown",
    ".wdb": "application/vnd.sqlite3",
}.items():
    mimetypes.add_type(mime, ext)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
app.config["JSON_SORT_KEYS"] = False
vfs = VFS(DATA_DIR)

SANDBOX_CSP = "sandbox allow-scripts"
WEB_CSP = "sandbox allow-scripts allow-forms"


# --------------------------------------------------------------------------- helpers
@app.before_request
def require_custom_header():
    # Les requêtes modifiantes doivent porter un en-tête personnalisé : un site
    # tiers ne peut pas l'ajouter sans pré-vol CORS (refusé), ce qui bloque le CSRF.
    if request.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get("X-WinWeb") != "1":
            return jsonify(error="En-tête X-WinWeb manquant"), 403
    return None


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.errorhandler(VFSError)
def handle_vfs_error(exc):
    return jsonify(error=exc.message), exc.status


@app.errorhandler(dbsql.DBError)
def handle_db_error(exc):
    return jsonify(error=exc.message), exc.status


@app.errorhandler(web_proxy.ProxyError)
def handle_proxy_error(exc):
    return jsonify(error=exc.message), exc.status


@app.errorhandler(RequestEntityTooLarge)
def handle_too_large(_exc):
    return jsonify(error="Fichier trop volumineux (limite : %d Mo)" % MAX_UPLOAD_MB), 413


@app.errorhandler(HTTPException)
def handle_http(exc):
    if request.path.startswith("/api/"):
        return jsonify(error=exc.description or exc.name), exc.code
    return exc


@app.errorhandler(OSError)
def handle_os_error(exc):
    app.logger.warning("Erreur système de fichiers : %s", exc)
    return jsonify(error="Erreur du système de fichiers : %s" % (exc.strerror or "inconnue")), 500


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise VFSError("Corps JSON attendu")
    return data


def path_list(data, key="paths"):
    paths = data.get(key)
    if not isinstance(paths, list) or not paths or len(paths) > 1000:
        raise VFSError("Liste de chemins invalide")
    return [normalize(p) for p in paths]


def send_sandboxed(real, download=False):
    mime = mimetypes.guess_type(real)[0] or "application/octet-stream"
    resp = send_file(real, mimetype=mime, as_attachment=download, conditional=True,
                     download_name=os.path.basename(real))
    resp.headers["Content-Security-Policy"] = SANDBOX_CSP
    resp.headers["Cache-Control"] = "no-cache"
    return resp


# --------------------------------------------------------------------------- pages
@app.get("/")
def index():
    return render_template("index.html", max_upload_mb=MAX_UPLOAD_MB)


@app.get("/vfs/<path:vpath>")
def raw_file(vpath):
    """Sert le contenu brut d'un fichier du VFS (images, pages .html, ressources...)."""
    real = vfs.real_file("/" + vpath)
    return send_sandboxed(real, download=request.args.get("download") == "1")


@app.get("/wapp/<app_id>/<path:rel>")
def wapp_file(app_id, rel):
    return send_sandboxed(wapp.resolve_file(vfs, app_id, rel))


# --------------------------------------------------------------------------- API VFS
@app.get("/api/fs/list")
def api_list():
    path = normalize(request.args.get("path", "/"))
    return jsonify(path=path, entries=vfs.list(path))


@app.get("/api/fs/stat")
def api_stat():
    return jsonify(vfs.stat(request.args.get("path", "/")))


@app.get("/api/fs/read")
def api_read():
    path = normalize(request.args.get("path", ""))
    content, encoding = vfs.read_text(path)
    return jsonify(path=path, content=content, encoding=encoding)


@app.get("/api/fs/search")
def api_search():
    return jsonify(results=vfs.search(request.args.get("q", "")))


@app.post("/api/fs/write")
def api_write():
    data = body()
    return jsonify(vfs.write_text(data.get("path"), data.get("content", "")))


@app.post("/api/fs/create")
def api_create():
    data = body()
    kind = "dir" if data.get("kind") == "dir" else "file"
    content = data.get("content", "")
    if not isinstance(content, str):
        raise VFSError("Contenu invalide")
    return jsonify(vfs.create(data.get("parent", "/"), data.get("name", ""), kind, content))


@app.post("/api/fs/rename")
def api_rename():
    data = body()
    return jsonify(vfs.rename(data.get("path"), data.get("name")))


@app.post("/api/fs/move")
def api_move():
    data = body()
    return jsonify(paths=vfs.move(path_list(data), data.get("dest")))


@app.post("/api/fs/copy")
def api_copy():
    data = body()
    return jsonify(paths=vfs.copy(path_list(data), data.get("dest")))


@app.post("/api/fs/delete")
def api_delete():
    data = body()
    return jsonify(paths=vfs.delete(path_list(data), permanent=bool(data.get("permanent"))))


@app.post("/api/fs/restore")
def api_restore():
    return jsonify(paths=vfs.restore(path_list(body())))


@app.post("/api/fs/empty-trash")
def api_empty_trash():
    return jsonify(count=vfs.empty_trash())


@app.post("/api/fs/upload")
def api_upload():
    dest = request.form.get("dest", "/Bureau")
    files = request.files.getlist("files")
    relpaths = request.form.getlist("relpaths")
    if not files:
        raise VFSError("Aucun fichier reçu")
    items = [(relpaths[i] if i < len(relpaths) else f.filename, f) for i, f in enumerate(files)]
    return jsonify(paths=vfs.upload(dest, items))


@app.get("/api/positions")
def api_get_positions():
    return jsonify(vfs.get_positions())


@app.post("/api/positions")
def api_set_positions():
    return jsonify(vfs.set_positions(body()))


# --------------------------------------------------------------------------- exécutables
@app.post("/api/wapp/open")
def api_wapp_open():
    path = normalize(body().get("path", ""))
    if not path.lower().endswith(".wapp"):
        raise VFSError("Ce n'est pas un fichier .wapp")
    return jsonify(wapp.install(vfs, path))


@app.get("/api/pe")
def api_pe():
    path = normalize(request.args.get("path", ""))
    info = pe_info.analyze_file(vfs.real_file(path))
    info["path"] = path
    return jsonify(info)


# --------------------------------------------------------------------------- navigateur web
def require_proxy():
    if not WEB_PROXY:
        raise web_proxy.ProxyError("Le mandataire web est désactivé (WINWEB_WEB_PROXY=0)", 403)


ERROR_PAGE = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Page inaccessible</title>
<style>body{font:15px system-ui,sans-serif;color:#333;max-width:620px;margin:60px auto;padding:0 20px}
h1{font-size:22px;font-weight:600}code{background:#f0f0f0;padding:2px 6px;border-radius:4px;word-break:break-all}
p.m{color:#666}</style></head><body><h1>&#128533; Impossible d'afficher cette page</h1>
<p>%s</p><p class="m">Adresse : <code>%s</code></p>
<p class="m">Essayez le mode « Direct » ou « Ouvrir dans le navigateur de l'ordinateur ».</p></body></html>"""


@app.get("/web")
def web_page():
    """Page web récupérée par le serveur, servie en bac à sable (origine opaque)."""
    url = request.args.get("url", "")
    try:
        require_proxy()
        final, ctype, data = web_proxy.proxied_page(url)
        status = 200
    except web_proxy.ProxyError as exc:
        final, ctype, status = url, "text/html; charset=utf-8", exc.status
        data = (ERROR_PAGE % (html_escape(exc.message), html_escape(url))).encode("utf-8")
    resp = app.response_class(data, status=status, mimetype=None, content_type=ctype)
    resp.headers["Content-Security-Policy"] = WEB_CSP
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-WinWeb-Url"] = final.encode("ascii", "ignore").decode("ascii")
    return resp


@app.get("/api/web/info")
def api_web_info():
    """Titre et adresse finale d'une page (après redirections)."""
    require_proxy()
    final, ctype, charset, data = web_proxy.fetch(request.args.get("url", ""), max_bytes=web_proxy.MAX_BYTES)
    title = web_proxy.page_title(web_proxy._decode(data, charset)) if ctype == "text/html" else ""
    return jsonify(url=final, content_type=ctype, title=title, size=len(data))


@app.post("/api/web/download")
def api_web_download():
    """Télécharge une ressource web dans un dossier du VFS (par défaut /Téléchargements)."""
    require_proxy()
    data = body()
    dest = normalize(data.get("dest") or "/Téléchargements")
    limit = MAX_UPLOAD_MB * 1024 * 1024
    final, ctype, _charset, payload = web_proxy.fetch(data.get("url", ""), max_bytes=limit)
    name = data.get("name") if isinstance(data.get("name"), str) and data.get("name").strip() else \
        web_proxy.filename_for(final, ctype)
    storage = FileStorage(stream=io.BytesIO(payload), filename=name)
    return jsonify(paths=vfs.upload(dest, [(name, storage)]), size=len(payload), url=final)


# --------------------------------------------------------------------------- bases de données
def db_file(path):
    path = normalize(path)
    if not path.lower().endswith(".wdb"):
        raise VFSError("Ce n'est pas une base de données .wdb")
    return path, vfs.real_file(path)


@app.get("/api/db/schema")
def api_db_schema():
    path, real = db_file(request.args.get("path", ""))
    return jsonify(path=path, objects=dbsql.schema(real))


@app.post("/api/db/exec")
def api_db_exec():
    data = body()
    path, real = db_file(data.get("path", ""))
    if is_within(path, TRASH_PATH):
        raise VFSError("Impossible de modifier une base située dans la corbeille")
    return jsonify(path=path, results=dbsql.execute(real, data.get("sql"), data.get("params")))


@app.get("/api/system")
def api_system():
    return jsonify(max_upload_mb=MAX_UPLOAD_MB, version="1.1", web_proxy=WEB_PROXY)


@app.route("/api/<path:_rest>", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def api_not_found(_rest):
    abort(404)


def main():
    parser = argparse.ArgumentParser(description="WinWeb — bureau Windows dans le navigateur")
    parser.add_argument("--host", default="127.0.0.1", help="adresse d'écoute (défaut : 127.0.0.1)")
    parser.add_argument("--port", type=int, default=5000, help="port (défaut : 5000)")
    parser.add_argument("--debug", action="store_true", help="mode débogage Flask")
    args = parser.parse_args()
    print(" * WinWeb disponible sur http://%s:%d" % (args.host, args.port))
    app.run(host=args.host, port=args.port, debug=args.debug, threaded=True)


if __name__ == "__main__":
    main()
