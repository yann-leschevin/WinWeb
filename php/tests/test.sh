#!/usr/bin/env bash
# Tests locaux de WinWeb (version en ligne, stockage dans le navigateur).
#  1) pages et fichiers servis par PHP (curl) ;
#  2) API du navigateur (IndexedDB, SQLite, .wapp, PE, service worker) exécutée
#     dans Firefox sans fenêtre, si Firefox est installé.
# Usage : bash tests/test.sh   (depuis le dossier du projet)
set -u
cd "$(dirname "$0")/.."
PORT="${PORT:-18765}"
BASE="http://127.0.0.1:$PORT"
TMP=$(mktemp -d)
mkdir -p "$TMP/site" && cp -r www/. "$TMP/site/" && cp -r tests/navigateur "$TMP/site/tests"
if curl -s --max-time 5 -o /dev/null "$BASE/"; then echo "Port $PORT déjà utilisé : relancer avec PORT=xxxx bash tests/test.sh"; exit 2; fi
PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:$PORT -t "$TMP/site" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$TMP"' EXIT
for _ in $(seq 50); do curl -s --max-time 5 -o /dev/null "$BASE/" && break; sleep 0.1; done
OK=0; KO=0
check() { if eval "$2" >/dev/null 2>&1; then echo "  OK  $1"; OK=$((OK+1)); else echo "  KO  $1"; KO=$((KO+1)); fi; }
code() { curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$@"; }
body() { curl -s --max-time 10 "$@"; }
echo "WinWeb — serveur"
check "page d'accueil 200"               '[ "$(code $BASE/)" = 200 ]'
check "plus de syntaxe Jinja"            '! body $BASE/ | grep -q "{{"'
check "chemins relatifs (static/)"       'body $BASE/ | grep -q "src=\"static/js/main.js\""'
check "service worker servi"             '[ "$(code $BASE/sw.js)" = 200 ]'
check "sql.js (wasm) servi"              '[ "$(code $BASE/static/vendor/sqljs/sql-wasm.wasm)" = 200 ]'
check "exemples servis"                  '[ "$(code $BASE/exemples/horloge.wapp)" = 200 ]'
check "aucun appel à l'ancienne API"     '! grep -rn "/api/" www/static/js --include=*.js | grep -v "^\S*:\s*//" | grep -q "fetch\|request("'
for f in $(find www/static/js www/sw.js -name '*.js'); do
  check "syntaxe $(basename $f)"         "node --check $f"
done
if command -v firefox >/dev/null; then
  echo "WinWeb — navigateur (Firefox sans fenêtre)"
  PROF="$HOME/snap/firefox/common/winweb-test"; [ -d "$HOME/snap/firefox" ] || PROF="$TMP/profil"
  rm -rf "$PROF"; mkdir -p "$PROF"
  timeout 120 firefox --headless --no-remote --profile "$PROF" --screenshot "$PROF/x.png" "$BASE/tests/runner.html" >/dev/null 2>&1
  rm -rf "$PROF"
  if [ -f "$TMP/site/tests/resultats.json" ]; then
    php -r '$r=json_decode(file_get_contents($argv[1]),true); $ko=0; foreach($r as $t){ echo ($t["ok"]?"  OK  ":"  KO  ").$t["name"].($t["ok"]?"":" : ".$t["error"])."\n"; if(!$t["ok"])$ko++; } exit($ko?1:0);' "$TMP/site/tests/resultats.json"
    n=$(php -r '$r=json_decode(file_get_contents($argv[1]),true); echo count($r), " ", count(array_filter($r, fn($t)=>!$t["ok"]));' "$TMP/site/tests/resultats.json")
    OK=$((OK + ${n% *} - ${n#* })); KO=$((KO + ${n#* }))
  else
    echo "  KO  aucun résultat reçu du navigateur"; KO=$((KO+1))
  fi
fi
echo "$OK réussi(s), $KO échec(s)"; [ $KO -eq 0 ]
