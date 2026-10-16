// Exemple de script .js pour WinWeb : il s'exécute dans une iframe sandboxée
// et sa sortie console.log / warn / error s'affiche dans la fenêtre console.

console.log('Bonjour depuis un script JavaScript sandboxé !');
console.info('Date :', new Date().toLocaleString('fr-FR'));

function fibonacci(n) {
  const suite = [0, 1];
  while (suite.length < n) suite.push(suite[suite.length - 1] + suite[suite.length - 2]);
  return suite.slice(0, n);
}
console.log('Suite de Fibonacci :', fibonacci(15));

const nombresPremiers = [];
for (let i = 2; nombresPremiers.length < 20; i += 1) {
  if (nombresPremiers.every((p) => i % p !== 0)) nombresPremiers.push(i);
}
console.log('20 premiers nombres premiers :', nombresPremiers.join(', '));
console.log({ objet: 'affiché en JSON', liste: [1, 2, 3], imbriqué: { ok: true } });

console.warn('Ceci est un avertissement.');

// Accès interdits par le bac à sable (origine opaque) :
try {
  console.log('Cookies :', document.cookie);
} catch (err) {
  console.warn('document.cookie inaccessible :', err.message);
}
try {
  console.log('Accès au DOM parent :', parent.document.title);
} catch (err) {
  console.warn('Accès au DOM de WinWeb refusé :', err.name);
}

// Tâches asynchrones : elles continuent après la fin du script principal.
let n = 3;
const minuteur = setInterval(() => {
  console.log(`Compte à rebours : ${n}`);
  n -= 1;
  if (n === 0) {
    clearInterval(minuteur);
    console.log('Terminé ! Une erreur volontaire va suivre :');
    setTimeout(() => {
      throw new Error('Erreur de démonstration (non interceptée)');
    }, 300);
  }
}, 700);

// Sortie graphique (bouton « Sortie graphique » de la console)
document.body.innerHTML = '<h2>Sortie graphique du script</h2><p>Le script peut aussi manipuler le DOM de son iframe.</p>';
