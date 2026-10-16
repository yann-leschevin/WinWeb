"""Système de fichiers virtuel persistant.

Les fichiers réels sont stockés sous ``data/fs/``. Un index JSON
(``data/index.json``) conserve les métadonnées que le système de fichiers
hôte ne fournit pas de façon portable : date de création, provenance des
éléments de la corbeille et positions des icônes du bureau.

Tous les chemins reçus de l'API sont des chemins *virtuels* (``/Documents/a.txt``).
Ils sont normalisés puis résolus sous ``data/fs`` ; toute tentative de sortir
de cette racine (``..``, liens symboliques, octet nul...) est refusée.
"""

import json
import os
import shutil
import threading
import time
import unicodedata

DEFAULT_DIRS = ["Bureau", "Documents", "Images", "Téléchargements", "Programmes"]
TRASH = "Corbeille"
TRASH_PATH = "/" + TRASH
PROTECTED = {"/"} | {"/" + d for d in DEFAULT_DIRS} | {TRASH_PATH}

INVALID_NAME_CHARS = set('<>:"/\\|?*')
MAX_NAME_LEN = 255
MAX_TEXT_READ = 5 * 1024 * 1024

WELCOME_TEXT = """Bienvenue dans WinWeb !

Quelques idées pour commencer :
- Glissez-déposez des fichiers depuis votre ordinateur dans la fenêtre du navigateur.
- Double-cliquez sur un fichier .wapp ou .html pour le lancer dans une fenêtre.
- Un fichier .js s'exécute dans un bac à sable et affiche sa console.
- Un fichier .exe n'est jamais exécuté : ses en-têtes PE sont analysés.
- Clic droit sur le bureau pour créer un dossier ou personnaliser l'affichage.

Le dossier « exemples/ » du projet contient une application .wapp et une page .html prêtes à déposer.
"""


class VFSError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def normalize(vpath):
    """Normalise un chemin virtuel en ``/a/b`` ; refuse ``..`` et caractères dangereux."""
    if vpath is None:
        vpath = "/"
    if not isinstance(vpath, str):
        raise VFSError("Chemin invalide")
    if "\x00" in vpath or len(vpath) > 4096:
        raise VFSError("Chemin invalide")
    vpath = unicodedata.normalize("NFC", vpath.replace("\\", "/"))
    parts = []
    for seg in vpath.split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            raise VFSError("Les chemins contenant « .. » sont interdits")
        if any(ord(c) < 32 for c in seg):
            raise VFSError("Chemin invalide")
        parts.append(seg)
    return "/" + "/".join(parts)


def parent_of(vpath):
    vpath = normalize(vpath)
    if vpath == "/":
        return "/"
    return normalize(vpath.rsplit("/", 1)[0] or "/")


def basename(vpath):
    return normalize(vpath).rsplit("/", 1)[-1]


def join(parent, name):
    return normalize(normalize(parent).rstrip("/") + "/" + name)


def is_within(child, parent):
    child, parent = normalize(child), normalize(parent)
    if parent == "/":
        return True
    return child == parent or child.startswith(parent + "/")


def validate_name(name):
    if not isinstance(name, str):
        raise VFSError("Nom invalide")
    name = unicodedata.normalize("NFC", name).strip().rstrip(".")
    if not name or name in (".", ".."):
        raise VFSError("Le nom ne peut pas être vide")
    if len(name) > MAX_NAME_LEN:
        raise VFSError("Nom trop long")
    bad = [c for c in name if c in INVALID_NAME_CHARS or ord(c) < 32]
    if bad:
        raise VFSError('Un nom de fichier ne peut pas contenir : \\ / : * ? " < > |')
    return name


def sanitize_name(name, fallback="fichier"):
    """Version tolérante de validate_name pour les fichiers déposés."""
    if not isinstance(name, str):
        name = ""
    name = unicodedata.normalize("NFC", name.replace("\\", "/").split("/")[-1])
    name = "".join("_" if (c in INVALID_NAME_CHARS or ord(c) < 32) else c for c in name)
    name = name.strip().rstrip(".")[:MAX_NAME_LEN]
    if not name or name in (".", ".."):
        name = fallback
    return name


class VFS:
    def __init__(self, data_dir):
        self.data_dir = os.path.realpath(data_dir)
        self.root = os.path.join(self.data_dir, "fs")
        self.apps_dir = os.path.join(self.data_dir, "apps")
        self.index_path = os.path.join(self.data_dir, "index.json")
        self.lock = threading.RLock()
        os.makedirs(self.root, exist_ok=True)
        os.makedirs(self.apps_dir, exist_ok=True)
        self.index = self._load_index()
        self._ensure_defaults()

    # ------------------------------------------------------------------ index
    def _load_index(self):
        data = {}
        try:
            with open(self.index_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        for key in ("created", "trash", "positions"):
            if not isinstance(data.get(key), dict):
                data[key] = {}
        data["version"] = 1
        return data

    def _save_index(self):
        tmp = self.index_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self.index, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, self.index_path)

    def _ensure_defaults(self):
        with self.lock:
            first_run = not os.path.exists(os.path.join(self.root, "Documents"))
            for d in DEFAULT_DIRS + [TRASH]:
                os.makedirs(os.path.join(self.root, d), exist_ok=True)
                self.index["created"].setdefault("/" + d, time.time())
            if first_run:
                welcome = os.path.join(self.root, "Documents", "Bienvenue.txt")
                with open(welcome, "w", encoding="utf-8") as fh:
                    fh.write(WELCOME_TEXT)
                self.index["created"]["/Documents/Bienvenue.txt"] = time.time()
            self._save_index()

    def _remap_meta(self, old, new):
        for key in ("created", "positions"):
            table = self.index[key]
            for k in list(table.keys()):
                if k == old or k.startswith(old + "/"):
                    table[new + k[len(old):]] = table.pop(k)

    def _drop_meta(self, vpath):
        for key in ("created", "positions"):
            table = self.index[key]
            for k in list(table.keys()):
                if k == vpath or k.startswith(vpath + "/"):
                    del table[k]

    # ------------------------------------------------------------------ paths
    def real(self, vpath):
        vpath = normalize(vpath)
        parts = [p for p in vpath.split("/") if p]
        real = os.path.join(self.root, *parts) if parts else self.root
        resolved = os.path.realpath(real)
        if os.path.commonpath([resolved, self.root]) != self.root:
            raise VFSError("Accès refusé", 403)
        return resolved

    def _existing(self, vpath, kind=None):
        real = self.real(vpath)
        if not os.path.exists(real):
            raise VFSError("Élément introuvable : " + normalize(vpath), 404)
        if kind == "dir" and not os.path.isdir(real):
            raise VFSError("Ce n'est pas un dossier : " + normalize(vpath))
        if kind == "file" and not os.path.isfile(real):
            raise VFSError("Ce n'est pas un fichier : " + normalize(vpath))
        return real

    def real_file(self, vpath):
        return self._existing(vpath, "file")

    @staticmethod
    def _unique(real_dir, name, copy_suffix=False):
        if not os.path.exists(os.path.join(real_dir, name)):
            return name
        is_dir = os.path.isdir(os.path.join(real_dir, name))
        stem, ext = (name, "") if is_dir else os.path.splitext(name)
        if not stem:
            stem, ext = name, ""
        if copy_suffix:
            candidate = f"{stem} - Copie{ext}"
            if not os.path.exists(os.path.join(real_dir, candidate)):
                return candidate
            stem = f"{stem} - Copie"
        i = 2
        while os.path.exists(os.path.join(real_dir, f"{stem} ({i}){ext}")):
            i += 1
        return f"{stem} ({i}){ext}"

    def _check_mutable(self, vpath):
        vpath = normalize(vpath)
        if vpath in PROTECTED:
            raise VFSError("Ce dossier système ne peut pas être modifié", 403)
        return vpath

    # ------------------------------------------------------------------ entries
    def _entry(self, vpath, real):
        st = os.stat(real)
        is_dir = os.path.isdir(real)
        name = basename(vpath) if vpath != "/" else "Ce PC"
        ext = "" if is_dir or "." not in name else name.rsplit(".", 1)[-1].lower()
        entry = {
            "name": name,
            "path": vpath,
            "type": "dir" if is_dir else "file",
            "ext": ext,
            "size": 0 if is_dir else st.st_size,
            "modified": st.st_mtime,
            "created": self.index["created"].get(vpath, st.st_mtime),
            "protected": vpath in PROTECTED,
        }
        if vpath == TRASH_PATH:
            entry["special"] = "trash"
        if parent_of(vpath) == TRASH_PATH and vpath != TRASH_PATH:
            rec = self.index["trash"].get(name)
            if rec:
                entry["original"] = rec.get("original")
                entry["deleted"] = rec.get("deleted")
        return entry

    def list(self, vpath):
        with self.lock:
            vpath = normalize(vpath)
            real = self._existing(vpath, "dir")
            out = []
            for name in os.listdir(real):
                child_real = os.path.join(real, name)
                if os.path.islink(child_real):
                    continue
                try:
                    out.append(self._entry(join(vpath, name), child_real))
                except (OSError, VFSError):
                    continue
            out.sort(key=lambda e: (e["type"] != "dir", e["name"].casefold()))
            return out

    def stat(self, vpath):
        with self.lock:
            vpath = normalize(vpath)
            real = self._existing(vpath)
            entry = self._entry(vpath, real)
            if entry["type"] == "dir":
                files = dirs = size = 0
                for base, dnames, fnames in os.walk(real):
                    dirs += len(dnames)
                    files += len(fnames)
                    for f in fnames:
                        try:
                            size += os.path.getsize(os.path.join(base, f))
                        except OSError:
                            pass
                entry.update({"files": files, "dirs": dirs, "size": size})
            return entry

    # ------------------------------------------------------------------ create / io
    def create(self, parent, name, kind="file", content=""):
        with self.lock:
            parent = normalize(parent)
            if is_within(parent, TRASH_PATH):
                raise VFSError("Impossible de créer un élément dans la corbeille")
            real_parent = self._existing(parent, "dir")
            name = self._unique(real_parent, validate_name(name))
            vpath = join(parent, name)
            real = self.real(vpath)
            if kind == "dir":
                os.makedirs(real)
            else:
                with open(real, "w", encoding="utf-8", newline="") as fh:
                    fh.write(content or "")
            self.index["created"][vpath] = time.time()
            self._save_index()
            return self._entry(vpath, real)

    def read_text(self, vpath):
        real = self._existing(vpath, "file")
        if os.path.getsize(real) > MAX_TEXT_READ:
            raise VFSError("Fichier trop volumineux pour être ouvert comme texte", 413)
        with open(real, "rb") as fh:
            raw = fh.read()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        try:
            return raw.decode("utf-8"), "utf-8"
        except UnicodeDecodeError:
            return raw.decode("latin-1"), "latin-1"

    def write_text(self, vpath, content):
        if not isinstance(content, str):
            raise VFSError("Contenu invalide")
        with self.lock:
            vpath = self._check_mutable(vpath)
            if is_within(vpath, TRASH_PATH):
                raise VFSError("Impossible d'écrire dans la corbeille")
            validate_name(basename(vpath))
            self._existing(parent_of(vpath), "dir")
            real = self.real(vpath)
            if os.path.isdir(real):
                raise VFSError("Un dossier porte déjà ce nom")
            new = not os.path.exists(real)
            with open(real, "w", encoding="utf-8", newline="") as fh:
                fh.write(content)
            if new:
                self.index["created"][vpath] = time.time()
                self._save_index()
            return self._entry(vpath, real)

    # ------------------------------------------------------------------ rename / move / copy
    def rename(self, vpath, new_name):
        with self.lock:
            vpath = self._check_mutable(vpath)
            if parent_of(vpath) == TRASH_PATH:
                raise VFSError("Restaurez l'élément avant de le renommer")
            real = self._existing(vpath)
            new_name = validate_name(new_name)
            new_vpath = join(parent_of(vpath), new_name)
            if new_vpath == vpath:
                return self._entry(vpath, real)
            new_real = self.real(new_vpath)
            # Autorise un simple changement de casse.
            if os.path.exists(new_real) and os.path.realpath(new_real) != real:
                raise VFSError("Un élément portant ce nom existe déjà", 409)
            os.rename(real, new_real)
            self._remap_meta(vpath, new_vpath)
            self._save_index()
            return self._entry(new_vpath, new_real)

    def _transfer(self, paths, dest, copy=False):
        with self.lock:
            dest = normalize(dest)
            if dest == TRASH_PATH and not copy:
                return self.delete(paths)
            if is_within(dest, TRASH_PATH):
                raise VFSError("Destination invalide")
            real_dest = self._existing(dest, "dir")
            results = []
            for p in paths:
                src = normalize(p) if copy else self._check_mutable(p)
                if src == "/":
                    raise VFSError("Opération impossible sur la racine")
                real_src = self._existing(src)
                if is_within(dest, src):
                    raise VFSError("Impossible de placer un dossier dans lui-même")
                if not copy and parent_of(src) == dest:
                    results.append(src)
                    continue
                name = self._unique(real_dest, basename(src), copy_suffix=copy and parent_of(src) == dest)
                new_vpath = join(dest, name)
                new_real = self.real(new_vpath)
                if copy:
                    if os.path.isdir(real_src):
                        shutil.copytree(real_src, new_real, symlinks=False)
                    else:
                        shutil.copy2(real_src, new_real)
                    self.index["created"][new_vpath] = time.time()
                else:
                    shutil.move(real_src, new_real)
                    if parent_of(src) == TRASH_PATH:
                        self.index["trash"].pop(basename(src), None)
                    self._remap_meta(src, new_vpath)
                results.append(new_vpath)
            self._save_index()
            return results

    def move(self, paths, dest):
        return self._transfer(paths, dest, copy=False)

    def copy(self, paths, dest):
        return self._transfer(paths, dest, copy=True)

    # ------------------------------------------------------------------ trash
    def delete(self, paths, permanent=False):
        with self.lock:
            real_trash = self.real(TRASH_PATH)
            done = []
            for p in paths:
                vpath = self._check_mutable(p)
                real = self._existing(vpath)
                in_trash = parent_of(vpath) == TRASH_PATH or is_within(vpath, TRASH_PATH)
                if permanent or in_trash:
                    if os.path.isdir(real) and not os.path.islink(real):
                        shutil.rmtree(real)
                    else:
                        os.remove(real)
                    if parent_of(vpath) == TRASH_PATH:
                        self.index["trash"].pop(basename(vpath), None)
                    self._drop_meta(vpath)
                else:
                    name = self._unique(real_trash, basename(vpath))
                    shutil.move(real, os.path.join(real_trash, name))
                    self.index["trash"][name] = {"original": vpath, "deleted": time.time()}
                    self._drop_meta(vpath)
                done.append(vpath)
            self._save_index()
            return done

    def restore(self, paths):
        with self.lock:
            restored = []
            for p in paths:
                vpath = normalize(p)
                if parent_of(vpath) != TRASH_PATH:
                    raise VFSError("Seuls les éléments de la corbeille peuvent être restaurés")
                real = self._existing(vpath)
                rec = self.index["trash"].get(basename(vpath)) or {}
                try:
                    original = normalize(rec.get("original") or ("/Bureau/" + basename(vpath)))
                except VFSError:
                    original = "/Bureau/" + basename(vpath)
                target_dir = parent_of(original)
                if is_within(target_dir, TRASH_PATH):
                    target_dir = "/Bureau"
                real_dir = self.real(target_dir)
                os.makedirs(real_dir, exist_ok=True)
                name = self._unique(real_dir, basename(original))
                new_vpath = join(target_dir, name)
                shutil.move(real, self.real(new_vpath))
                self.index["trash"].pop(basename(vpath), None)
                self.index["created"].setdefault(new_vpath, time.time())
                restored.append(new_vpath)
            self._save_index()
            return restored

    def empty_trash(self):
        with self.lock:
            real_trash = self.real(TRASH_PATH)
            count = 0
            for name in os.listdir(real_trash):
                real = os.path.join(real_trash, name)
                if os.path.isdir(real) and not os.path.islink(real):
                    shutil.rmtree(real)
                else:
                    os.remove(real)
                count += 1
            self.index["trash"] = {}
            self._save_index()
            return count

    # ------------------------------------------------------------------ search
    def search(self, query, limit=60):
        query = (query or "").strip().casefold()
        if not query:
            return []
        out = []
        real_trash = self.real(TRASH_PATH)
        for base, dnames, fnames in os.walk(self.root):
            if base == self.root:
                dnames[:] = [d for d in dnames if os.path.join(base, d) != real_trash]
            dnames.sort()
            for name in sorted(dnames) + sorted(fnames):
                if query in name.casefold():
                    rel = os.path.relpath(os.path.join(base, name), self.root).replace(os.sep, "/")
                    vpath = normalize(rel)
                    try:
                        out.append(self._entry(vpath, os.path.join(base, name)))
                    except OSError:
                        continue
                    if len(out) >= limit:
                        return out
        return out

    # ------------------------------------------------------------------ upload
    def upload(self, dest, items):
        """``items`` : liste de (chemin_relatif, FileStorage).

        Les chemins relatifs permettent de déposer des dossiers entiers. Chaque
        segment est assaini ; le premier segment est rendu unique dans la
        destination pour ne jamais écraser un élément existant.
        """
        with self.lock:
            dest = normalize(dest)
            if is_within(dest, TRASH_PATH):
                raise VFSError("Impossible de déposer des fichiers dans la corbeille")
            real_dest = self._existing(dest, "dir")
            top_map = {}
            created = []
            for relpath, storage in items:
                rel = (relpath or storage.filename or "").replace("\\", "/")
                segs = [sanitize_name(s) for s in rel.split("/") if s not in ("", ".", "..")]
                if not segs:
                    segs = [sanitize_name(storage.filename)]
                top = segs[0]
                if top not in top_map:
                    top_map[top] = self._unique(real_dest, top)
                    created.append(top_map[top])
                segs[0] = top_map[top]
                vpath = normalize(dest + "/" + "/".join(segs))
                real = self.real(vpath)
                if not is_within(vpath, dest):
                    raise VFSError("Chemin de dépôt invalide", 403)
                os.makedirs(os.path.dirname(real), exist_ok=True)
                if os.path.isdir(real):
                    continue
                storage.save(real)
                now = time.time()
                self.index["created"][vpath] = now
                cur = parent_of(vpath)
                while cur != dest and is_within(cur, dest):
                    self.index["created"].setdefault(cur, now)
                    cur = parent_of(cur)
            self._save_index()
            return [join(dest, n) for n in created]

    # ------------------------------------------------------------------ positions
    def get_positions(self):
        return dict(self.index["positions"])

    def set_positions(self, positions):
        if not isinstance(positions, dict):
            raise VFSError("Positions invalides")
        with self.lock:
            for key, pos in positions.items():
                if not isinstance(key, str) or len(key) > 4096:
                    continue
                if pos is None:
                    self.index["positions"].pop(key, None)
                    continue
                try:
                    x, y = int(pos["x"]), int(pos["y"])
                except (KeyError, TypeError, ValueError):
                    continue
                self.index["positions"][key] = {"x": max(0, min(x, 10000)), "y": max(0, min(y, 10000))}
            self._save_index()
            return self.get_positions()
