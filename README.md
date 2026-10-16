# WinWeb — un bureau Windows 11 / Windows 10 dans le navigateur

> 🤖 **Projet développé par une IA** : le code, les tests et la documentation de WinWeb ont été écrits par
> **Claude** (Anthropic), via **Claude Code**, à partir des demandes de Yann Leschevin.
> Voir [Crédits](#crédits).

WinWeb reproduit un système d'exploitation de type Windows 11 (thème Windows 10
sélectionnable) dans une page web. Le serveur est en **Python + Flask** (bibliothèque
standard uniquement en plus de Flask). L'interface est faite en **HTML, CSS et
JavaScript natifs** (modules ES), sans framework, sans Node.js et sans CDN.

## Lancement

```bash
python3 app.py
```

Ouvrez ensuite **http://127.0.0.1:5000**.

Options :

| Option / variable                | Effet                                                    |
|----------------------------------|----------------------------------------------------------|
| `--host 127.0.0.1` (par défaut)  | adresse d'écoute (laissez 127.0.0.1 sauf besoin réel)    |
| `--port 5000`                    | port d'écoute                                            |
| `--debug`                        | mode débogage Flask                                      |
| `WINWEB_DATA=/chemin`            | dossier de données (par défaut `./data`)                 |
| `WINWEB_MAX_UPLOAD_MB=200`       | taille maximale d'un dépôt (`MAX_CONTENT_LENGTH`)        |
| `WINWEB_WEB_PROXY=0`             | désactive le mandataire du navigateur web (mode direct)  |

Seule dépendance : Flask (déjà présent sur le poste de développement, version 3.1).
Rien n'est installé automatiquement par `app.py`.

Avec un environnement virtuel, le script `source.sh` crée (ou répare) `.venv`, y installe Flask s'il
manque, puis lance le serveur :

```bash
./source.sh
```

## Fonctionnalités

- **Démarrage et verrouillage** : animation de boot, écran de verrouillage avec heure et date
  (clic ou touche pour déverrouiller), arrêt, redémarrage et verrouillage depuis le menu Démarrer.
- **Bureau** : fond d'écran, icônes déplaçables et alignées sur une grille (positions
  mémorisées côté serveur), sélection multiple au lasso ou avec Ctrl, menu contextuel
  (Affichage, Trier par, Actualiser, Coller, Nouveau dossier ou document, Personnaliser, Propriétés),
  raccourcis Suppr / F2 / Entrée / Ctrl+A / Ctrl+C / Ctrl+X / Ctrl+V / F5, corbeille sur le bureau.
- **Barre des tâches** : Démarrer, recherche, applications épinglées et ouvertes (regroupées par
  application, avec un indicateur pour les fenêtres ouvertes et pour la fenêtre active), zone de notification,
  horloge avec calendrier, bouton « Afficher le Bureau ».
- **Menu Démarrer** : applications épinglées, liste de toutes les applications (y compris les
  `.wapp`, `.html` et `.js` du dossier *Programmes*), recherche d'applications et de fichiers,
  boutons Verrouiller / Redémarrer / Arrêter.
- **Gestionnaire de fenêtres** : ouvrir, fermer, réduire, agrandir et restaurer (y compris par double-clic
  sur la barre de titre), déplacer, redimensionner par les 4 bords et les 4 coins, premier plan au clic,
  ancrage (snap) à gauche ou à droite en glissant contre un bord, agrandissement en glissant contre le haut.
- **Applications** : Explorateur de fichiers, Bloc-notes (ouvrir, enregistrer, enregistrer sous),
  Calculatrice, Paramètres (thème clair/sombre, Windows 10/11, fond d'écran, accent), Gestionnaire des
  tâches (fin de tâche), Photos (visionneuse), Invite de commandes simulée
  (`dir cd mkdir del type echo cls start help` + `ren copy move rmdir tree ver date time whoami exit`).
- **Navigateur web** : onglets, barre d'adresse et de recherche (DuckDuckGo, Wikipédia, Bing, Google),
  précédente/suivante/actualiser, page d'accueil, favoris (barre + page), historique, zoom, ouverture des
  fichiers du PC virtuel (`C:\Documents\page.html`), enregistrement d'une page ou d'un fichier dans
  *Téléchargements*. Voir « Navigateur web » plus bas.
- **Éditeur++** (façon Notepad++) : onglets, numéros de ligne, coloration syntaxique (JavaScript/TypeScript,
  Python, HTML/XML, CSS, JSON, Markdown, C/C++/Java/C#/Go/Rust/PHP, SQL, Shell/Batch, INI, YAML), rechercher /
  remplacer (casse, mot entier, expressions régulières, dans tous les onglets), atteindre la ligne,
  dupliquer/supprimer/déplacer des lignes, commenter, trier, casse, espaces de fin, tabulations ↔ espaces,
  symboles invisibles, fins de ligne Windows/Unix, mode refrappe (Inser), zoom (Ctrl+molette), thème sombre,
  fichiers récents et restauration de la session, exécution des `.html` / `.js` en bac à sable.
- **Suite bureautique** (ruban à onglets, Ctrl+N/O/S, « Enregistrer sous », alerte de modifications) :
  - **Traitement de texte** (`.wdoc`) : polices, tailles, gras/italique/souligné/barré, indice/exposant,
    couleurs, surlignage, listes, retraits, alignements, styles (Titre 1-3, Citation, Code), tableaux, images
    (dossier Images ou ordinateur), liens (Ctrl+clic les ouvre dans le navigateur), sauts de page, symboles,
    rechercher/remplacer, orientation, marges, couleur de page, zoom, statistiques, impression,
    export HTML/TXT, ouverture des `.html`, `.txt`, `.md`.
  - **Tableur** (`.wcalc`, ouvre aussi les `.csv`) : plusieurs feuilles, formules avec références relatives,
    absolues (`$A$1`), plages et inter-feuilles (`Feuil2!A1`), ~60 fonctions en français ou en anglais
    (SOMME/SUM, MOYENNE, SI, NB.SI, SOMME.SI, RECHERCHEV, INDEX, EQUIV, ARRONDI, CONCATENER, AUJOURDHUI…),
    erreurs façon Excel (`#DIV/0!`, `#REF!`, `#NOM?`, `#CIRC!`…), saisie « 1,5 » / « 12 % », mise en forme,
    formats de nombre (€, %, décimales), insertion/suppression de lignes et colonnes avec mise à jour des
    formules, tri, somme automatique, recopie (Ctrl+D), copier/coller compatible Excel, annuler/rétablir,
    largeur de colonnes, graphiques (histogramme, courbes, secteurs), export CSV/HTML.
  - **Diaporama** (`.wpres`) : diapositives 16:9, dispositions, zones de texte, images, formes, thèmes,
    couleur de fond, transitions, notes du présentateur, réorganisation par glisser-déposer, présentation
    plein écran (F5), export en page HTML autonome.
  - **Base de données** (`.wdb`, fichier SQLite) : tables, feuille de données modifiable (tri, recherche,
    pagination, ajout/suppression), formulaire, mode création (champs, types, clé, requis, défaut,
    renommer/supprimer), requêtes SQL avec historique, requêtes enregistrées (vues), import/export CSV,
    base exemple (clients, produits, commandes).
  - **Notes** (`.wnote`, façon OneNote) : sections colorées, pages, texte riche, listes de tâches à cocher,
    images, recherche dans toutes les notes, enregistrement automatique dans *Documents\Mes notes.wnote*.
  - Clic droit > **Nouveau** sur le bureau ou dans l'Explorateur : document, classeur, présentation,
    base de données, bloc-notes.
- **Système de fichiers virtuel** : persisté dans `data/fs/` + index JSON `data/index.json`
  (dates de création, origine des éléments de la corbeille, positions des icônes).
  Dossiers par défaut : Bureau, Documents, Images, Téléchargements, Programmes, plus la Corbeille
  (restaurer, supprimer définitivement, vider).

## Glisser-déposer

Déposez des fichiers (ou des dossiers entiers) n'importe où dans la page : un calque apparaît
et indique la destination. Les fichiers sont envoyés au serveur et apparaissent :

- **sur le Bureau**, à l'endroit exact du dépôt ;
- **dans un dossier**, si vous les déposez dans une fenêtre de l'Explorateur, sur une icône de dossier
  ou sur un raccourci de la barre latérale.

Le glisser-déposer fonctionne aussi entre les fenêtres de WinWeb : bureau ↔ explorateur ↔ dossiers ↔
corbeille. Maintenez Ctrl pour copier au lieu de déplacer.

### Exemples prêts à déposer (`exemples/`)

| Fichier          | Type        | Contenu                                                        |
|------------------|-------------|----------------------------------------------------------------|
| `horloge.wapp`   | application | horloge analogique + chronomètre (icône SVG dans l'archive)    |
| `serpent.wapp`   | application | jeu du serpent (icône emoji)                                   |
| `bonjour.html`   | page HTML   | ardoise de dessin                                              |
| `demo.js`        | script      | sortie console, tâches asynchrones, erreur volontaire          |
| `make_wapp.py`   | générateur  | recrée les `.wapp` avec `zipfile` : `python3 exemples/make_wapp.py` |

## Formats « exécutables »

Un navigateur ne peut pas exécuter de binaires natifs. WinWeb définit donc ses propres formats.
Un double-clic lance le fichier avec l'application associée (voir *Paramètres → Applications par défaut*).

### `.wapp` — application WinWeb

Archive **zip** contenant à sa racine (ou dans un unique sous-dossier) :

```json
// manifest.json
{
  "name": "Horloge",
  "icon": "icon.svg",        // chemin d'une image de l'archive OU un emoji ("🐍")
  "entry": "index.html",     // point d'entrée HTML (index.html par défaut)
  "width": 420,              // taille de fenêtre par défaut
  "height": 520,
  "version": "1.0",
  "description": "…"
}
```

Au premier lancement, l'archive est décompressée côté serveur avec `zipfile` dans
`data/apps/<empreinte SHA-256>/`, avec ces protections : chemins absolus, `..`, lettres de lecteur et
liens symboliques refusés, au plus 2 000 fichiers et 100 Mo décompressés, taille réellement lue contrôlée
(contre les zip-bombs), puis vérification `realpath` de chaque fichier écrit. L'application s'ouvre ensuite dans
une fenêtre via une `iframe sandbox="allow-scripts"` (**sans** `allow-same-origin`).

Une application peut, si elle le souhaite, piloter sa fenêtre par `postMessage` :
`parent.postMessage({type: 'winweb:setTitle', title: '…'}, '*')` ou `{type: 'winweb:close'}`.

### `.html` / `.htm`

La page s'ouvre comme une application, dans une fenêtre et avec le même sandbox. Les ressources
relatives (CSS, JS, images du même dossier) sont résolues via `/vfs/…`.

### `.js`

Le script est exécuté dans une iframe sandboxée. Ses `console.log/info/warn/error`, ses erreurs
non interceptées et les promesses rejetées s'affichent dans une fenêtre console. Les boutons permettent de
relancer le script, de l'arrêter, d'effacer la console ou d'afficher la sortie graphique (le DOM de l'iframe).

### `.exe` / `.dll`

**Jamais exécutés.** Une fenêtre « Propriétés de l'exécutable » affiche l'analyse de l'en-tête PE
faite avec `struct` (`pe_info.py`) : signatures MZ et PE, format PE32/PE32+, architecture, sous-système
GUI ou console, type (application ou DLL), nombre et noms des sections avec leurs attributs, horodatage de compilation,
point d'entrée, adresse de base, assemblage .NET, protections ASLR/DEP/CFG. Elle explique aussi que
l'exécution native n'est pas disponible dans le navigateur.

### Autres associations

Images (`png jpg gif webp svg bmp ico avif`) → Photos ; textes (`txt md log`) → Bloc-notes ; code et
configuration (`py ts mjs json xml css c cpp java sql sh bat ini yml…`) → Éditeur++ ;
`csv` → Tableur ; `wdoc` → Traitement de texte ; `wcalc` → Tableur ; `wpres` → Diaporama ;
`wdb` → Base de données ; `wnote` → Notes. Les autres types proposent « Ouvrir avec ».

## Navigateur web

La plupart des sites interdisent l'affichage dans une iframe. En mode **Protégé** (par défaut), le serveur
récupère la page (`GET /web?url=…`, module `web_proxy.py`, bibliothèque standard), y ajoute une balise `<base>`
et un petit script qui renvoie les clics de liens et les formulaires GET au navigateur WinWeb, puis la sert avec
`Content-Security-Policy: sandbox allow-scripts allow-forms` dans une iframe **sans** `allow-same-origin` :
la page tourne dans une origine opaque et n'a aucun accès à WinWeb. Les sites statiques ou peu dynamiques
(Wikipédia, DuckDuckGo, Hacker News, documentation…) fonctionnent bien ; les applications web complexes
(connexion, paiement, sites très JavaScript) peuvent mal fonctionner : utilisez alors le mode **Direct**
(chargement direct de l'iframe, souvent refusé par les sites) ou « Ouvrir dans le navigateur de l'ordinateur ».

Protection SSRF : seules les adresses IP publiques sont joignables ; la vérification a lieu au moment de la
connexion (y compris après chaque redirection), ce qui empêche d'atteindre `127.0.0.1`, le réseau local ou
`169.254.169.254`, même via un nom DNS. Pages limitées à 8 Mo, délai de 12 s, variables `http_proxy` ignorées.

## Sécurité

- **Aucune exécution côté serveur** de contenu déposé : ni `subprocess`, ni `os.system`, ni `exec`, ni `eval`.
- **Chemins** : tous les chemins de l'API sont normalisés (rejet de `..`, de l'octet nul et des caractères
  de contrôle, normalisation Unicode NFC), résolus avec `realpath` et confinés dans `data/fs/`.
  Les liens symboliques sont masqués et ne permettent pas d'en sortir. Les noms déposés sont assainis.
- **Uploads** limités par `MAX_CONTENT_LENGTH`, qui renvoie une erreur 413. Le client vérifie aussi la taille avant l'envoi.
- **Contenus utilisateur** servis avec `Content-Security-Policy: sandbox allow-scripts` et `nosniff` :
  même ouverts directement dans un onglet, ils restent dans une origine opaque, sans accès à l'API.
- **CSRF** : les requêtes modifiantes exigent l'en-tête `X-WinWeb: 1`, qu'un site tiers ne peut pas ajouter
  sans pré-vol CORS. Le serveur n'autorise aucune requête CORS.
- **Documents riches** (traitement de texte, diapositives, notes, collage) : le HTML est analysé dans un
  document inerte (`DOMParser`) puis reconstruit avec une liste blanche de balises, d'attributs et de styles
  (`apps/office/sanitize.js`) ; images limitées aux `data:image` et aux fichiers `/vfs/`.
- **Bases SQLite** : `ATTACH`/`VACUUM INTO` impossibles (`SQLITE_LIMIT_ATTACHED = 0`), mode *defensive*,
  schéma non fiable, extensions non chargeables, `PRAGMA` en liste blanche, 4 s maximum par requête,
  5000 lignes renvoyées au plus. Le tableur évalue ses formules avec son propre analyseur (aucun `eval`).
- Écoute sur **127.0.0.1** par défaut.

## Structure

```
app.py              serveur Flask : pages, API REST, service sandboxé des fichiers
vfs.py              système de fichiers virtuel (data/fs + data/index.json), corbeille
wapp.py             décompression sécurisée et manifest des .wapp
pe_info.py          analyse des en-têtes PE (struct)
web_proxy.py        mandataire du navigateur web (anti-SSRF, réécriture HTML)
dbsql.py            exécution SQL verrouillée sur les fichiers .wdb (sqlite3)
tests/              tests unittest (mandataire web, bases de données)
templates/index.html
static/css/         base, desktop, windows, taskbar, startmenu, apps, office
static/js/          main, windowManager, taskbar, startMenu, desktop, dragdrop, session,
                    registry, fileOps, dialogs, contextMenu, notify, settings, icons, api, bus, utils
static/js/apps/     explorer, notepad, calculator, settingsApp, taskmgr, imageViewer, cmd,
                    sandbox (.wapp/.html/.js), exeInfo, properties, browser, codeEditor, syntax
static/js/apps/office/  writer, sheet, formula, slides, database, notes, common, sanitize
exemples/           horloge.wapp, serpent.wapp, bonjour.html, demo.js, make_wapp.py
data/               créé au premier lancement (fichiers de l'utilisateur)
```

### API REST (extrait)

`GET /api/fs/list|stat|read|search`, `POST /api/fs/create|write|rename|move|copy|delete|restore|empty-trash|upload`,
`GET|POST /api/positions`, `POST /api/wapp/open`, `GET /api/pe`, contenu brut : `GET /vfs/<chemin>`,
navigateur : `GET /web?url=`, `GET /api/web/info`, `POST /api/web/download`,
bases de données : `GET /api/db/schema?path=`, `POST /api/db/exec {path, sql, params}`.

Tests : `python3 -m unittest discover -s tests`.

## Limites connues

- Les `.exe` ne sont pas exécutés (c'est voulu) : seul l'en-tête PE est analysé.
- Les applications sandboxées ont une origine opaque : pas de `localStorage`, de cookies, ni de `fetch`
  vers leurs propres fichiers (le serveur n'envoie pas d'en-tête CORS). Les scripts `type="module"` ne se chargent
  pas non plus : utilisez des scripts classiques.
- Un script `.js` qui boucle à l'infini peut figer l'onglet si le navigateur exécute l'iframe sandboxée
  dans le même processus. Le bouton « Arrêter » retire l'iframe, mais ne peut pas interrompre une boucle synchrone.
- Pas de comptes ni de mots de passe : l'écran de verrouillage est décoratif.
- Les préférences (thème, fond d'écran…) sont stockées dans le `localStorage` du navigateur. Les fichiers
  et les positions d'icônes sont stockés sur le serveur.
- Les touches système (Windows, Alt+Tab, Alt+F4) sont en général interceptées par le système hôte ou le navigateur.
- La mémoire affichée par le Gestionnaire des tâches est une estimation : le navigateur n'expose pas la mémoire de chaque fenêtre.
- Navigateur web : les sites qui exigent cookies, connexion ou beaucoup de JavaScript (requêtes `fetch`
  vers leur propre domaine, redirections par `location.href`) s'affichent mal en mode Protégé ; les formulaires
  POST partent directement vers le site. Les liens des moteurs DuckDuckGo et Google sont « déroulés »
  automatiquement.
- Bureautique : formats propres à WinWeb (JSON / SQLite), pas de lecture ni d'écriture `.docx`, `.xlsx`,
  `.pptx` ; la mise en page du traitement de texte est continue (repères de page, pas de vraie pagination).
- Serveur de développement Flask : il convient à un usage local, pas à une exposition sur Internet.

## Crédits

| Contributeur | Rôle |
|--------------|------|
| **Yann Leschevin** ([@yann-leschevin](https://github.com/yann-leschevin)) | idée, cahier des charges, demandes d'évolution, tests d'usage |
| **Claude** (Anthropic), via **Claude Code** | développement : conception, backend Python/Flask, frontend HTML/CSS/JS, applications, sécurité, tests et documentation |
| Autres assistants IA | d'autres IA ont pu être consultées ponctuellement au fil du projet ; leur liste exacte n'a pas été conservée |

Le journal détaillé du développement (étapes, vérifications, bugs corrigés) se trouve dans
[`ETAT_PROJET.md`](ETAT_PROJET.md).
