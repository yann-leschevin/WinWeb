"""Génère les applications d'exemple au format .wapp (archive zip + manifest.json).

Usage :  python3 exemples/make_wapp.py
Produit : exemples/horloge.wapp et exemples/serpent.wapp

Un .wapp est une simple archive zip contenant à sa racine :
  - manifest.json : {"name", "icon", "entry", "width", "height", "description", "version"}
  - le point d'entrée HTML (index.html par défaut) et ses ressources (CSS, JS, images).
Les scripts doivent être « classiques » (pas de type="module") : l'application
tourne dans une iframe sandboxée d'origine opaque.
"""

import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------- Horloge
HORLOGE = {
    "manifest.json": json.dumps({
        "name": "Horloge",
        "icon": "icon.svg",
        "entry": "index.html",
        "width": 420,
        "height": 520,
        "version": "1.0",
        "author": "WinWeb",
        "description": "Horloge analogique, heure numérique et chronomètre.",
    }, ensure_ascii=False, indent=2),
    "icon.svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<circle cx="32" cy="32" r="29" fill="#1f6feb" stroke="#0b3d91" stroke-width="3"/>
<circle cx="32" cy="32" r="23" fill="#fff"/>
<path d="M32 14v18l11 7" stroke="#1b1b1b" stroke-width="4" stroke-linecap="round" fill="none"/>
<circle cx="32" cy="32" r="3" fill="#e81123"/></svg>""",
    "index.html": """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Horloge</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
  <canvas id="dial" width="300" height="300" aria-label="Horloge analogique"></canvas>
  <div id="digital">--:--:--</div>
  <div id="date"></div>
  <section class="chrono">
    <div id="chrono">00:00,00</div>
    <div class="buttons">
      <button id="start">Démarrer</button>
      <button id="lap">Tour</button>
      <button id="reset">Réinitialiser</button>
    </div>
    <ol id="laps"></ol>
  </section>
  <script src="app.js"></script>
</body>
</html>""",
    "style.css": """* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center;
  padding: 16px; gap: 6px; font-family: "Segoe UI", system-ui, sans-serif;
  background: radial-gradient(circle at 50% 20%, #23395d, #0d1424); color: #e8eefc;
}
#dial { width: 240px; height: 240px; }
#digital { font-size: 34px; font-weight: 600; letter-spacing: 1px; font-variant-numeric: tabular-nums; }
#date { color: #9fb3d9; text-transform: capitalize; }
.chrono { width: 100%; max-width: 340px; margin-top: 10px; padding: 12px; border-radius: 10px; background: rgba(255,255,255,.07); text-align: center; }
#chrono { font-size: 28px; font-variant-numeric: tabular-nums; }
.buttons { display: flex; gap: 6px; justify-content: center; margin-top: 8px; }
button { border: 0; border-radius: 6px; padding: 6px 12px; background: #3b82f6; color: #fff; font: inherit; cursor: pointer; }
button:hover { background: #2563eb; }
#reset { background: #475569; }
#laps { text-align: left; max-height: 90px; overflow: auto; margin: 8px 0 0; padding-left: 28px; font-variant-numeric: tabular-nums; color: #c7d2fe; }""",
    "app.js": """(function () {
  'use strict';
  var canvas = document.getElementById('dial');
  var ctx = canvas.getContext('2d');
  var digital = document.getElementById('digital');
  var dateEl = document.getElementById('date');

  function hand(angle, length, width, color) {
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 12);
    ctx.lineTo(0, -length);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    var now = new Date();
    var r = canvas.width / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(r, r);
    ctx.beginPath();
    ctx.arc(0, 0, r - 6, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#3b82f6';
    ctx.stroke();
    for (var i = 0; i < 60; i++) {
      ctx.save();
      ctx.rotate(i * Math.PI / 30);
      ctx.beginPath();
      ctx.moveTo(0, -r + 16);
      ctx.lineTo(0, -r + (i % 5 === 0 ? 34 : 24));
      ctx.lineWidth = i % 5 === 0 ? 4 : 1.5;
      ctx.strokeStyle = '#334155';
      ctx.stroke();
      ctx.restore();
    }
    var s = now.getSeconds() + now.getMilliseconds() / 1000;
    var m = now.getMinutes() + s / 60;
    var h = (now.getHours() % 12) + m / 60;
    hand(h * Math.PI / 6, r * 0.5, 8, '#0f172a');
    hand(m * Math.PI / 30, r * 0.72, 5, '#1e293b');
    hand(s * Math.PI / 30, r * 0.8, 2, '#e11d48');
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#e11d48';
    ctx.fill();

    digital.textContent = now.toLocaleTimeString('fr-FR');
    dateEl.textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  // Chronomètre
  var chronoEl = document.getElementById('chrono');
  var lapsEl = document.getElementById('laps');
  var startBtn = document.getElementById('start');
  var running = false, startedAt = 0, elapsed = 0, timer = null;

  function fmt(ms) {
    var cs = Math.floor(ms / 10) % 100, sec = Math.floor(ms / 1000) % 60, min = Math.floor(ms / 60000);
    return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + ',' + String(cs).padStart(2, '0');
  }
  function tick() { chronoEl.textContent = fmt(elapsed + (running ? Date.now() - startedAt : 0)); }
  startBtn.onclick = function () {
    if (running) { elapsed += Date.now() - startedAt; running = false; clearInterval(timer); startBtn.textContent = 'Reprendre'; }
    else { startedAt = Date.now(); running = true; timer = setInterval(tick, 31); startBtn.textContent = 'Pause'; }
    tick();
  };
  document.getElementById('lap').onclick = function () {
    if (!running) return;
    var li = document.createElement('li');
    li.textContent = fmt(elapsed + Date.now() - startedAt);
    lapsEl.prepend(li);
  };
  document.getElementById('reset').onclick = function () {
    running = false; elapsed = 0; clearInterval(timer); startBtn.textContent = 'Démarrer'; lapsEl.innerHTML = ''; tick();
  };

  // Facultatif : demande à WinWeb de mettre à jour le titre de la fenêtre.
  setInterval(function () {
    parent.postMessage({ type: 'winweb:setTitle', title: 'Horloge — ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }, '*');
  }, 1000);
})();""",
}

# --------------------------------------------------------------------------- Serpent
SERPENT = {
    "manifest.json": json.dumps({
        "name": "Serpent",
        "icon": "🐍",
        "entry": "index.html",
        "width": 460,
        "height": 540,
        "version": "1.0",
        "author": "WinWeb",
        "description": "Le jeu du serpent : flèches ou ZQSD pour diriger, Espace pour la pause.",
    }, ensure_ascii=False, indent=2),
    "index.html": """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Serpent</title>
<style>
  body { margin: 0; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
         background: #102018; color: #d9f99d; font-family: "Segoe UI", system-ui, sans-serif; }
  canvas { background: #0b1510; border: 3px solid #3f6212; border-radius: 6px; image-rendering: pixelated; max-width: 96vw; }
  .hud { display: flex; gap: 24px; font-size: 18px; }
  .hint { font-size: 13px; color: #86efac; }
</style>
</head>
<body tabindex="0">
  <div class="hud"><span>Score : <b id="score">0</b></span><span>Record : <b id="best">0</b></span></div>
  <canvas id="game" width="400" height="400"></canvas>
  <div class="hint" id="hint">Cliquez puis appuyez sur une flèche pour commencer</div>
  <script src="game.js"></script>
</body>
</html>""",
    "game.js": """(function () {
  'use strict';
  var N = 20, SIZE = 20;
  var canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  var scoreEl = document.getElementById('score'), bestEl = document.getElementById('best'), hint = document.getElementById('hint');
  var snake, dir, nextDir, food, score, best = 0, timer = null, paused = false, over = false;

  function reset() {
    snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    dir = { x: 1, y: 0 }; nextDir = dir; score = 0; over = false; paused = false;
    placeFood(); scoreEl.textContent = '0'; draw();
  }
  function placeFood() {
    do { food = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) }; }
    while (snake.some(function (s) { return s.x === food.x && s.y === food.y; }));
  }
  function step() {
    if (paused || over) return;
    dir = nextDir;
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N || snake.some(function (s) { return s.x === head.x && s.y === head.y; })) {
      over = true; clearInterval(timer); timer = null;
      hint.textContent = 'Perdu ! Appuyez sur Entrée pour rejouer';
      draw(); return;
    }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 10; scoreEl.textContent = score;
      if (score > best) { best = score; bestEl.textContent = best; }
      placeFood();
      clearInterval(timer); timer = setInterval(step, Math.max(55, 130 - score / 2));
    } else { snake.pop(); }
    draw();
  }
  function draw() {
    ctx.fillStyle = '#0b1510'; ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(food.x * SIZE + 10, food.y * SIZE + 10, 8, 0, Math.PI * 2); ctx.fill();
    snake.forEach(function (s, i) {
      ctx.fillStyle = i === 0 ? '#bef264' : (i % 2 ? '#65a30d' : '#4d7c0f');
      ctx.fillRect(s.x * SIZE + 1, s.y * SIZE + 1, SIZE - 2, SIZE - 2);
    });
    if (over) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, 400, 400); ctx.fillStyle = '#fff'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Partie terminée', 200, 200); }
  }
  var KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], z: [0, -1], s: [0, 1], q: [-1, 0], d: [1, 0], w: [0, -1], a: [-1, 0] };
  document.addEventListener('keydown', function (e) {
    if (e.key === ' ') { paused = !paused; hint.textContent = paused ? 'Pause' : ''; e.preventDefault(); return; }
    if (e.key === 'Enter' && over) { reset(); hint.textContent = 'Appuyez sur une flèche'; return; }
    var k = KEYS[e.key] || KEYS[e.key.toLowerCase()];
    if (!k || over) return;
    e.preventDefault();
    if (k[0] === -dir.x && k[1] === -dir.y) return;
    nextDir = { x: k[0], y: k[1] };
    if (!timer) { hint.textContent = ''; timer = setInterval(step, 130); }
  });
  document.body.addEventListener('click', function () { document.body.focus(); });
  reset();
  document.body.focus();
})();""",
}


def build(name, files):
    path = os.path.join(HERE, name)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for arcname, content in files.items():
            zf.writestr(arcname, content)
    print("créé :", path)
    return path


if __name__ == "__main__":
    build("horloge.wapp", HORLOGE)
    build("serpent.wapp", SERPENT)
