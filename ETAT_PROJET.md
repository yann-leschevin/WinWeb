# État du projet — Clone Windows (WinWeb)

## Objectif
OS de type Windows 11 (thème Windows 10 sélectionnable) dans le navigateur.
Backend Python/Flask (bibliothèque standard uniquement en plus de Flask),
frontend HTML/CSS/JS natifs (modules ES), aucune ressource externe.

## Environnement constaté (2026-10-06)
- Dossier de travail vide au départ.
- Python 3.12.3, Flask 3.1.3 déjà installé (aucune installation lancée).
- Node v22 disponible → utilisé uniquement pour `node --check`.

## Journal des étapes
- [x] 1. Lecture de l'environnement, création de ce fichier de suivi.
- [x] 2. Backend : `vfs.py` (VFS confiné dans data/fs + index data/index.json, corbeille, positions),
        `pe_info.py` (analyse PE avec struct), `wapp.py` (zip sécurisé + manifest), `app.py` (API REST Flask,
        /vfs et /wapp servis avec CSP sandbox, en-tête anti-CSRF X-WinWeb, MAX_CONTENT_LENGTH, 127.0.0.1).
- [x] 3. Frontend cœur : utils, api, bus, settings, icons, contextMenu, notify, dialogs, registry,
        windowManager (snap, resize 8 poignées, z-index), taskbar, startMenu, fileOps, desktop (lasso,
        positions), dragdrop (upload + dossiers + déplacements internes), session (boot/verrou/arrêt), main.
- [x] 4. Applications : explorer, notepad, calculator, settingsApp, taskmgr, imageViewer, cmd,
        sandbox (.wapp/.html/.js), exeInfo (.exe), properties (+ Ouvrir avec, Télécharger).
- [x] 5. CSS : base, desktop, windows, taskbar, startmenu, apps (thèmes clair/sombre, Windows 10/11).
- [x] 6. Exemples : exemples/make_wapp.py → horloge.wapp, serpent.wapp ; bonjour.html ; demo.js.
- [x] 7. Vérifications :
        - `python3 -m py_compile` sur tous les .py : OK.
        - `node --check` sur tous les .js : OK ; contrôle statique imports/exports : 0 problème.
        - Tests API (client de test Flask, données temporaires) : 51/51 OK (CRUD, corbeille, recherche,
          traversées de chemins, lien symbolique, upload + sous-dossiers + `../` neutralisé, 413,
          CSRF, .wapp + zip-slip + zip invalide, PE32/PE32+/MZ sans PE/non-MZ).
        - Démarrage réel du serveur avec `timeout 6` sur le port 5077 : pages, CSS, JS, API répondent 200.
        - Test de fumée du frontend sous Node (DOM factice) : lancement de toutes les applications sans erreur.
        - Aucun navigateur disponible dans l'environnement : pas de test visuel réel.
- [x] 8. README.md (lancement, formats exécutables, sécurité, limites) et .gitignore.

## Phase 2 (2026-10-09) — nouvelles applications
Demande : navigateur web, éditeur de texte type Notepad++, suite bureautique
(traitement de texte, tableur, diaporama, base de données, notes).
- [x] 9. Lecture de ETAT_PROJET.md et du code existant (app.py, registry, apps/*).
- [x] 10a. Backend navigateur : `web_proxy.py` (récupération urllib, anti-SSRF vérifié à la connexion
        → redirections et DNS rebinding couverts, injection <base> + script de navigation postMessage),
        routes `/web?url=` (CSP sandbox allow-scripts allow-forms), `/api/web/info`, `/api/web/download`.
        Variable WINWEB_WEB_PROXY=0 pour désactiver. Testé : 127.0.0.1, localhost, 10/8, ::1, 169.254, 0x7f000001 → 403.
- [x] 12a. Backend base de données : `dbsql.py` (SQLite stdlib, fichiers .wdb du VFS ; ATTACH/VACUUM INTO
        bloqués par SQLITE_LIMIT_ATTACHED=0, mode defensive, PRAGMA en liste blanche, délai max 4 s,
        5000 lignes max), routes `/api/db/schema`, `/api/db/exec`. Testé (attach, vacuum into, pragma, CTE infinie).
- [x] 10b. Frontend navigateur `apps/browser.js` : onglets, historique par onglet, favoris, historique global,
        page d'accueil, moteurs de recherche, zoom, mode Protégé (mandataire) / Direct, fichiers du VFS,
        téléchargement vers /Téléchargements, déroulage des liens DuckDuckGo/Google.
        Ajouts au script injecté : cookies/localStorage en mémoire (origine opaque), meta refresh.
- [x] 11. Éditeur++ (type Notepad++) : `apps/syntax.js` (coloration 11 langages, testée sous Node) +
        `apps/codeEditor.js` (instance unique, onglets, numéros de ligne, recherche regex/mot entier/tous onglets,
        opérations sur les lignes, symboles invisibles, CRLF/LF, refrappe, zoom, session + fichiers récents).
- [x] 12b. Modules partagés : `apps/office/sanitize.js` (assainisseur HTML liste blanche via DOMParser inerte,
        collage sûr), `apps/office/common.js` (contrôleur de document, ruban, couleurs, images, CSV, impression).
- [x] 12c. Traitement de texte `apps/office/writer.js` (.wdoc ; import .html/.txt/.md ; export HTML/TXT ; impression).
- [x] 12d. Tableur : moteur `apps/office/formula.js` (sans eval, ~60 fonctions FR/EN, erreurs Excel, références
        inter-feuilles, réécriture des références) testé sous Node ; interface `apps/office/sheet.js` (.wcalc, CSV).
- [x] 12e. Diaporama `apps/office/slides.js` (.wpres, thèmes, formes, images, transitions, plein écran, export HTML).
- [x] 12f. Base de données `apps/office/database.js` (.wdb SQLite : feuille de données éditable, formulaire,
        mode création, ALTER, requêtes SQL + vues, import/export CSV, base exemple).
- [x] 12g. Notes `apps/office/notes.js` (.wnote type OneNote : sections, pages, tâches, recherche, autosauvegarde
        dans Documents/Mes notes.wnote).
- [x] 13. Intégration : `main.js` (7 applis enregistrées), `registry.js` (associations wdoc/wcalc/wpres/wdb/wnote,
        code → Éditeur++, csv → Tableur, « Ouvrir avec » enrichi, épinglés), `icons.js`, `explorer.js` (types),
        `fileOps.js` + bureau/explorateur (Nouveau > document, classeur, présentation, base, bloc-notes),
        `api.js` (dbSchema, dbExec, webDownload, system), `static/css/office.css`, `index.html`.
- [x] 14. Vérifications :
        - `node --check` sur tous les .js : OK ; contrôle imports/exports (script) : 0 problème réel.
        - `py_compile` : OK ; `python3 -m unittest discover -s tests` : 9/9 OK (nouveau `tests/test_web_db.py`).
        - Tests réels dans Chromium headless (binaire Playwright en cache, piloté par CDP depuis Node, sans
          installation) + captures d'écran : les 7 applis se lancent sans erreur console ; tableur (saisie
          clavier, formules, insertion de ligne → SOMME(D2:D4) devient SOMME(D2:D5), annuler, graphique) ;
          Éditeur++ (Ctrl+D, coloration, Ctrl+S, symboles) ; traitement de texte (titre, gras, enregistrement,
          `<script>` stocké échappé) ; base (feuille de données, SQL GROUP BY) ; diaporama (thème, forme,
          plein écran + Échap) ; notes (autosauvegarde) ; aller-retour enregistrer/rouvrir pour .wdoc .wcalc
          .wpres .wnote ; navigateur : example.com, Wikipédia, recherche DuckDuckGo, clic sur un résultat →
          Wikipédia, bouton Précédente, fichier local C:\Documents\Bienvenue.txt.
        - Bugs trouvés et corrigés pendant ces tests : propriété CSS personnalisée via Object.assign
          (bouton Fichier invisible, couleurs de sections), « null » affiché par replaceChildren,
          sélection des formes étoile/triangle, Entrée après Tab (retour à la colonne de départ, comme Excel),
          erreurs cookie dans les pages en bac à sable, liens de redirection DuckDuckGo.
        - Limite de l'environnement de test : pas de police emoji dans Chromium headless (icônes en carrés
          sur les captures uniquement).
- [x] 15. README.md : fonctionnalités, navigateur web, sécurité, structure, API, limites.

## Statut
Application complète (phase 2 terminée le 2026-10-09). Lancement : `python3 app.py` → http://127.0.0.1:5000

## Phase 3 (2026-10-16) — publication
- [x] 16. Documentation : section « Crédits » du README (développement par Claude / Claude Code,
        autres IA ayant pu contribuer — liste non conservée), lancement via `source.sh`.
- [x] 17. `source.sh` : libellé « HWMonitor V2 » (reste d'un autre projet) remplacé par « WinWeb ».
- [x] 18. `.gitignore` complété (`.venv/`), dépôt Git initialisé et publié sur GitHub :
        https://github.com/yann-leschevin/WinWeb (`data/` exclu : fichiers personnels).
        Tests avant publication : `python3 -m unittest discover -s tests` → 9/9 OK.

## Pistes possibles
- Import/export .docx / .xlsx / .pptx (nécessiterait du zip + XML côté client ou serveur).
- Pagination réelle du traitement de texte ; formules matricielles et mise en forme conditionnelle du tableur.
- Navigateur : relayer aussi les formulaires POST via le mandataire.
- Renommage « en place » des icônes (actuellement via une boîte de dialogue).
