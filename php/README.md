# winweb — version en ligne (OVH)

Bureau façon PC dans le navigateur, en ligne sur https://leschevin.com/projets/winweb/.

Portage de https://github.com/yann-leschevin/WinWeb (Python/Flask). L'interface (HTML/CSS/JS)
est la même ; seul le « serveur » change.

## Ce qui change par rapport à la version Python

| Python (Flask)                         | Version en ligne                                                    |
|----------------------------------------|---------------------------------------------------------------------|
| fichiers dans `data/fs/` sur le serveur, partagés | fichiers dans **le navigateur du visiteur** (IndexedDB) : chacun a son propre PC, rien n'est envoyé à OVH |
| API REST `/api/...` (`app.py`, `vfs.py`) | `static/js/api.js` (mêmes fonctions) + `localfs.js`                 |
| `/vfs/<chemin>` servi par Flask        | `vfs/<chemin>` servi par le service worker `sw.js`                   |
| `.wapp` décompressés avec `zipfile`    | `wapp.js` (DecompressionStream, mêmes limites)                       |
| `.html` / `.wapp` en iframe `src=`     | iframe sandbox en `srcdoc` avec ressources intégrées (`inline.js`)   |
| SQLite (`sqlite3`, `dbsql.py`)         | sql.js / WebAssembly dans un worker (`db.js`, `dbworker.js`), 4 s max |
| en-têtes PE (`pe_info.py`)             | `peinfo.js`                                                          |
| mandataire web `/web?url=`             | **désactivé** (pas de proxy ouvert sur OVH) : mode Direct uniquement |
| styles « Windows 10 / 11 »             | renommés « Classique / Moderne » (marques)                           |

PHP ne sert que la page (`index.php`, qui compte la visite pour `stats.php`). Les exemples
(`exemples/`) sont copiés dans *Programmes\Exemples* au premier lancement.

Bibliothèque tierce : **sql.js 1.14.2** (licence MIT), dans `www/static/vendor/sqljs/`.

## Arborescence
- `www/` : **seul dossier à envoyer** (son contenu va dans `www/projets/winweb/` chez OVH).
- `tests/test.sh` : tests locaux — pages servies (curl), syntaxe JS (node) et API complète
  exécutée dans Firefox sans fenêtre (`tests/navigateur/`). Ne pas envoyer.
- `exemples/` : sources des exemples (`make_wapp.py` recrée les `.wapp`).

## Tester en local
```bash
php -S 127.0.0.1:18765 -t www     # puis http://127.0.0.1:18765/
bash tests/test.sh
```
Le service worker exige `https` ou `localhost`/`127.0.0.1` (c'est le cas en local et sur leschevin.com).
En navigation privée, certains navigateurs bloquent IndexedDB ou le service worker : WinWeb le signale.
