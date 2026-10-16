"""Gestion des applications ``.wapp`` (archive zip + manifest.json).

L'archive est décompressée avec ``zipfile`` dans ``data/apps/<empreinte>/``.
Chaque membre est contrôlé : pas de chemin absolu, pas de ``..``, pas de lien
symbolique, nombre de fichiers et taille décompressée limités (anti zip-bomb).
Aucun contenu n'est exécuté côté serveur : les fichiers sont seulement servis
au navigateur, qui les affiche dans une iframe sandboxée.
"""

import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import zipfile
import zlib

from vfs import VFSError

MAX_MEMBERS = 2000
MAX_TOTAL_SIZE = 100 * 1024 * 1024
MAX_MANIFEST_SIZE = 64 * 1024
APP_ID_RE = re.compile(r"^[0-9a-f]{32}$")
ICON_EXTS = (".png", ".svg", ".jpg", ".jpeg", ".gif", ".webp", ".ico")


def _safe_member_path(name):
    """Retourne le chemin relatif nettoyé d'un membre, ou None s'il est dangereux."""
    name = name.replace("\\", "/")
    if name.startswith("/") or "\x00" in name:
        return None
    parts = [p for p in name.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    if ":" in parts[0]:  # lettre de lecteur Windows (C:...)
        return None
    return "/".join(parts)


def _clean_rel(path):
    if not isinstance(path, str):
        return None
    return _safe_member_path(path)


def _sanitize_manifest(raw, fallback_name, files):
    if not isinstance(raw, dict):
        raw = {}

    def text(key, default="", limit=120):
        val = raw.get(key, default)
        return str(val)[:limit] if isinstance(val, (str, int, float)) else default

    def number(key, default, lo, hi):
        try:
            return max(lo, min(int(raw.get(key, default)), hi))
        except (TypeError, ValueError):
            return default

    entry = _clean_rel(raw.get("entry") or raw.get("main") or "index.html")
    if not entry or entry not in files:
        entry = "index.html" if "index.html" in files else None
    if not entry:
        htmls = sorted(f for f in files if f.lower().endswith((".html", ".htm")))
        if not htmls:
            raise VFSError("L'archive .wapp ne contient aucune page HTML à lancer")
        entry = htmls[0]

    icon_text, icon_path = "📦", None
    icon = raw.get("icon")
    if isinstance(icon, str) and icon:
        rel = _clean_rel(icon)
        if rel and rel.lower().endswith(ICON_EXTS) and rel in files:
            icon_path = rel
        elif len(icon) <= 8:
            icon_text = icon

    window = raw.get("window") if isinstance(raw.get("window"), dict) else {}
    return {
        "name": text("name", fallback_name, 80) or fallback_name,
        "description": text("description", "", 400),
        "version": text("version", "", 40),
        "author": text("author", "", 80),
        "entry": entry,
        "icon": icon_text,
        "icon_path": icon_path,
        "width": number("width", window.get("width", 800) if window else 800, 240, 2000),
        "height": number("height", window.get("height", 600) if window else 600, 160, 1400),
        "resizable": raw.get("resizable", True) is not False,
    }


def _extract(zip_path, target):
    with zipfile.ZipFile(zip_path) as zf:
        infos = zf.infolist()
        if len(infos) > MAX_MEMBERS:
            raise VFSError("Archive .wapp trop volumineuse (trop de fichiers)")
        members = []
        declared = 0
        for info in infos:
            if info.is_dir():
                continue
            mode = (info.external_attr >> 16) & 0o170000
            if mode == stat.S_IFLNK:
                continue  # liens symboliques ignorés
            rel = _safe_member_path(info.filename)
            if rel is None:
                raise VFSError("Chemin interdit dans l'archive : " + info.filename[:120])
            declared += info.file_size
            if declared > MAX_TOTAL_SIZE:
                raise VFSError("Archive .wapp trop volumineuse une fois décompressée")
            members.append((info, rel))

        # Si tout est dans un unique dossier racine contenant le manifest, on l'aplatit.
        rels = [r for _, r in members]
        prefix = ""
        if "manifest.json" not in rels:
            tops = {r.split("/", 1)[0] for r in rels if "/" in r}
            if len(tops) == 1 and all("/" in r for r in rels):
                top = tops.pop()
                if top + "/manifest.json" in rels:
                    prefix = top + "/"

        tmp = tempfile.mkdtemp(prefix=".tmp-", dir=os.path.dirname(target))
        real_tmp = os.path.realpath(tmp)
        written = 0
        files = set()
        try:
            for info, rel in members:
                if prefix:
                    if not rel.startswith(prefix):
                        continue
                    rel = rel[len(prefix):]
                out = os.path.realpath(os.path.join(real_tmp, *rel.split("/")))
                if os.path.commonpath([out, real_tmp]) != real_tmp:
                    raise VFSError("Chemin interdit dans l'archive : " + rel[:120])
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with zf.open(info) as src, open(out, "wb") as dst:
                    while True:
                        chunk = src.read(65536)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > MAX_TOTAL_SIZE:
                            raise VFSError("Archive .wapp trop volumineuse une fois décompressée")
                        dst.write(chunk)
                files.add(rel)
            return tmp, files
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise


def install(vfs, vpath):
    """Décompresse (une seule fois, mis en cache par empreinte) et retourne le manifest."""
    real = vfs.real_file(vpath)
    sha = hashlib.sha256()
    with open(real, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            sha.update(chunk)
    app_id = sha.hexdigest()[:32]
    target = os.path.join(vfs.apps_dir, app_id)
    meta_path = os.path.join(vfs.apps_dir, app_id + ".json")

    with vfs.lock:
        if os.path.isdir(target) and os.path.isfile(meta_path):
            with open(meta_path, "r", encoding="utf-8") as fh:
                manifest = json.load(fh)
        else:
            try:
                tmp, files = _extract(real, target)
            except (zipfile.BadZipFile, zlib.error, EOFError, NotImplementedError, RuntimeError):
                raise VFSError("Ce fichier .wapp n'est pas une archive zip valide (ou est chiffré)")
            try:
                raw = {}
                man_file = os.path.join(tmp, "manifest.json")
                if os.path.isfile(man_file):
                    if os.path.getsize(man_file) > MAX_MANIFEST_SIZE:
                        raise VFSError("manifest.json trop volumineux")
                    try:
                        with open(man_file, "r", encoding="utf-8-sig") as fh:
                            raw = json.load(fh)
                    except ValueError:
                        raise VFSError("manifest.json invalide (JSON mal formé)")
                fallback = os.path.splitext(os.path.basename(real))[0]
                manifest = _sanitize_manifest(raw, fallback, files)
                if os.path.isdir(target):
                    shutil.rmtree(target)
                os.replace(tmp, target)
            except BaseException:
                shutil.rmtree(tmp, ignore_errors=True)
                raise
            with open(meta_path, "w", encoding="utf-8") as fh:
                json.dump(manifest, fh, ensure_ascii=False)

    manifest = dict(manifest)
    manifest["id"] = app_id
    manifest["url"] = "/wapp/%s/%s" % (app_id, manifest["entry"])
    manifest["icon_url"] = "/wapp/%s/%s" % (app_id, manifest["icon_path"]) if manifest.get("icon_path") else None
    return manifest


def resolve_file(vfs, app_id, rel):
    if not APP_ID_RE.match(app_id or ""):
        raise VFSError("Application inconnue", 404)
    rel = _safe_member_path(rel or "")
    if rel is None:
        raise VFSError("Chemin interdit", 403)
    base = os.path.realpath(os.path.join(vfs.apps_dir, app_id))
    real = os.path.realpath(os.path.join(base, *rel.split("/")))
    if os.path.commonpath([real, base]) != base or not os.path.isfile(real):
        raise VFSError("Fichier introuvable", 404)
    return real
