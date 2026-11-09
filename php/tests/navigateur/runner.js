// Tests de la version « navigateur » de WinWeb (IndexedDB, sql.js, .wapp, PE, service worker).
// Lancés par tests/test.sh dans Firefox sans fenêtre ; résultats envoyés à results.php.
import { api } from '../static/js/api.js';
import { srcdocForVfs, srcdocForWapp } from '../static/js/inline.js';

const results = [];
async function t(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: String(err?.message || err) });
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion'); };
const rejects = async (p, re) => {
  try { await p; } catch (err) {
    if (re && !re.test(err.message)) throw new Error(`message inattendu : ${err.message}`);
    return;
  }
  throw new Error('aurait dû échouer');
};

async function swReady() {
  const root = new URL('../', import.meta.url);
  await navigator.serviceWorker.register(new URL('sw.js', root), { scope: root.pathname });
  if (!navigator.serviceWorker.controller) {
    await new Promise((r) => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 5000); });
  }
  return Boolean(navigator.serviceWorker.controller);
}

// En-tête PE minimal : MZ + PE32+ x64, 1 section .text
function fakePe() {
  const b = new Uint8Array(1024);
  const v = new DataView(b.buffer);
  b[0] = 0x4d; b[1] = 0x5a; v.setUint32(0x3c, 0x80, true);
  b.set([0x50, 0x45, 0, 0], 0x80);
  const coff = 0x84;
  v.setUint16(coff, 0x8664, true); v.setUint16(coff + 2, 1, true); v.setUint32(coff + 4, 1700000000, true);
  v.setUint16(coff + 16, 240, true); v.setUint16(coff + 18, 0x0022, true);
  const opt = coff + 20;
  v.setUint16(opt, 0x20b, true); v.setUint32(opt + 16, 0x1234, true); v.setBigUint64(opt + 24, 0x140000000n, true);
  v.setUint16(opt + 68, 2, true); v.setUint16(opt + 70, 0x0160, true); v.setUint32(opt + 108, 16, true);
  const sec = opt + 240;
  b.set([0x2e, 0x74, 0x65, 0x78, 0x74], sec); v.setUint32(sec + 36, 0x60000020, true);
  return new Blob([b]);
}

(async () => {
  await t('dossiers par défaut', async () => {
    const names = (await api.list('/')).map((e) => e.name);
    for (const n of ['Bureau', 'Documents', 'Images', 'Téléchargements', 'Programmes', 'Corbeille']) assert(names.includes(n), n);
  });
  await t('fichier Bienvenue.txt', async () => {
    const r = await api.read('/Documents/Bienvenue.txt');
    assert(r.content.includes('Bienvenue dans WinWeb') && r.encoding === 'utf-8');
  });
  await t('exemples installés', async () => {
    const names = (await api.list('/Programmes/Exemples')).map((e) => e.name).sort().join(',');
    assert(names === 'bonjour.html,demo.js,horloge.wapp,serpent.wapp', names);
  });
  await t('créer / écrire / relire (accents, taille en octets)', async () => {
    const e = await api.create('/Documents', 'Été.txt', 'file', 'çà');
    assert(e.path === '/Documents/Été.txt' && e.size === 4, JSON.stringify(e));
    await api.write('/Documents/Été.txt', 'Bonjour é');
    assert((await api.read('/Documents/Été.txt')).content === 'Bonjour é');
    assert((await api.stat('/Documents/Été.txt')).size === 10);
  });
  await t('nom en double -> (2)', async () => {
    const e = await api.create('/Documents', 'Été.txt');
    assert(e.name === 'Été (2).txt', e.name);
  });
  await t('noms interdits et « .. » refusés', async () => {
    await rejects(api.create('/Documents', 'a:b.txt'), /ne peut pas contenir/);
    await rejects(api.read('/Documents/../x'), /interdits/);
  });
  await t('dossiers système protégés', async () => {
    await rejects(api.rename('/Documents', 'Docs'), /système/);
    await rejects(api.remove(['/Bureau']), /système/);
  });
  await t('renommer (et collision)', async () => {
    const e = await api.rename('/Documents/Été (2).txt', 'Hiver.txt');
    assert(e.path === '/Documents/Hiver.txt');
    await rejects(api.rename('/Documents/Hiver.txt', 'Été.txt'), /existe déjà/);
  });
  await t('copier dans le même dossier -> « - Copie »', async () => {
    const [p] = await api.copy(['/Documents/Hiver.txt'], '/Documents');
    assert(p === '/Documents/Hiver - Copie.txt', p);
    assert((await api.read(p)).content === '');
  });
  await t('déplacer (fichier + dossier, pas dans lui-même)', async () => {
    const d = await api.create('/Documents', 'Classeur', 'dir');
    await api.create(d.path, 'note.txt', 'file', 'dedans');
    const [p] = await api.move(['/Documents/Hiver.txt'], d.path);
    assert(p === '/Documents/Classeur/Hiver.txt');
    await rejects(api.move([d.path], `${d.path}/`), /lui-même/);
    const [moved] = await api.move([d.path], '/Bureau');
    assert(moved === '/Bureau/Classeur');
    assert((await api.read('/Bureau/Classeur/note.txt')).content === 'dedans');
    const st = await api.stat('/Bureau/Classeur');
    assert(st.files === 2 && st.dirs === 0, JSON.stringify(st));
  });
  await t('corbeille : supprimer, restaurer, définitif, vider', async () => {
    const [del] = await api.remove(['/Bureau/Classeur']);
    assert(del === '/Bureau/Classeur');
    const trash = await api.list('/Corbeille');
    const item = trash.find((e) => e.name === 'Classeur');
    assert(item && item.original === '/Bureau/Classeur', JSON.stringify(trash));
    const [back] = await api.restore(['/Corbeille/Classeur']);
    assert(back === '/Bureau/Classeur');
    assert((await api.read('/Bureau/Classeur/note.txt')).content === 'dedans');
    await api.remove(['/Bureau/Classeur/note.txt']);
    await api.remove(['/Documents/Hiver - Copie.txt'], true);
    await rejects(api.stat('/Documents/Hiver - Copie.txt'), /introuvable/);
    const r = await api.emptyTrash();
    assert(r.count === 1 && (await api.list('/Corbeille')).length === 0, JSON.stringify(r));
  });
  await t('recherche (hors corbeille)', async () => {
    const res = await api.search('bienvenue');
    assert(res.length === 1 && res[0].path === '/Documents/Bienvenue.txt', JSON.stringify(res));
  });
  await t('dépôt d\'un dossier (chemins relatifs, nom unique)', async () => {
    const items = [
      { file: new File(['a'], 'a.txt'), relpath: 'Projet/a.txt' },
      { file: new File(['bb'], 'b.txt'), relpath: 'Projet/sous/b.txt' },
    ];
    let progress = 0;
    const paths = await api.upload('/Bureau', items, (p) => { progress = p; });
    assert(paths.length === 1 && paths[0] === '/Bureau/Projet' && progress === 1, JSON.stringify(paths));
    const again = await api.upload('/Bureau', [{ file: new File(['x'], 'a.txt'), relpath: 'Projet/a.txt' }]);
    assert(again[0] === '/Bureau/Projet (2)', again[0]);
    assert((await api.read('/Bureau/Projet/sous/b.txt')).content === 'bb');
  });
  await t('positions des icônes (bornées)', async () => {
    const pos = await api.savePositions({ '/Bureau/Projet': { x: 20000, y: -5 }, bad: { x: 'a' } });
    assert(pos['/Bureau/Projet'].x === 10000 && pos['/Bureau/Projet'].y === 0 && !pos.bad);
    await api.rename('/Bureau/Projet', 'Projet1');
    assert((await api.positions())['/Bureau/Projet1'], 'position suivie au renommage');
  });
  await t('analyse PE d\'un .exe', async () => {
    await api.upload('/Téléchargements', [{ file: fakePe(), relpath: 'app.exe' }]);
    const info = await api.pe('/Téléchargements/app.exe');
    assert(info.valid && info.format === 'PE32+' && info.machine.startsWith('x64'), JSON.stringify(info));
    assert(info.subsystem_kind === 'GUI' && info.image_base === '0x140000000' && info.sections[0].name === '.text');
    assert(info.dll_characteristics.includes('DEP / NX compatible'));
    const bad = await api.pe('/Documents/Bienvenue.txt');
    assert(bad.valid === false && /MZ/.test(bad.error));
  });
  await t('application .wapp (zip) + srcdoc autonome', async () => {
    const m = await api.openWapp('/Programmes/Exemples/horloge.wapp');
    assert(m.id.length === 32 && m.entry && m.name, JSON.stringify(m));
    const doc = await srcdocForWapp(m.id, m.entry);
    assert(doc.includes('<html') && doc.length > 500, 'srcdoc vide');
    const m2 = await api.openWapp('/Programmes/Exemples/horloge.wapp');
    assert(m2.id === m.id, 'cache par empreinte');
    await rejects(api.openWapp('/Documents/Bienvenue.txt'), /\.wapp/);
  });
  await t('page .html : srcdoc', async () => {
    const doc = await srcdocForVfs('/Programmes/Exemples/bonjour.html');
    assert(doc.includes('<html') && doc.length > 1000);
  });
  await t('SQLite : créer, insérer (paramètres), lire, schéma', async () => {
    await api.create('/Documents', 'test.wdb', 'file', '');
    await api.dbExec('/Documents/test.wdb', 'CREATE TABLE t(id INTEGER PRIMARY KEY, nom TEXT NOT NULL); CREATE VIEW v AS SELECT nom FROM t;');
    const [ins] = await api.dbExec('/Documents/test.wdb', 'INSERT INTO t(nom) VALUES (?)', ['Zoé']);
    assert(ins.changes === 1 && ins.lastrowid === 1, JSON.stringify(ins));
    const [sel] = await api.dbExec('/Documents/test.wdb', 'SELECT id, nom, x\'00ff\' AS b FROM t');
    assert(sel.columns.join() === 'id,nom,b' && sel.rows[0][1] === 'Zoé' && sel.rows[0][2] === '<BLOB 2 octets>', JSON.stringify(sel));
    const sch = await api.dbSchema('/Documents/test.wdb');
    const tbl = sch.objects.find((o) => o.name === 't');
    assert(tbl && tbl.count === 1 && tbl.columns[1].notnull && tbl.rowid && sch.objects.some((o) => o.type === 'view'), JSON.stringify(sch));
    assert((await api.stat('/Documents/test.wdb')).size > 0, 'base enregistrée');
  });
  await t('SQLite : protections', async () => {
    await rejects(api.dbExec('/Documents/test.wdb', "ATTACH 'x' AS y"), /not authorized/);
    await rejects(api.dbExec('/Documents/test.wdb', 'PRAGMA writable_schema=1'), /not authorized/);
    const [ok] = await api.dbExec('/Documents/test.wdb', 'PRAGMA table_info(t)');
    assert(ok.rows.length === 2);
    await rejects(api.dbExec('/Documents/test.wdb', 'SELECT ?; SELECT 2', [1]), /une seule instruction/);
    await rejects(api.dbExec('/Documents/Bienvenue.txt', 'SELECT 1'), /\.wdb/);
  });
  await t('SQLite : erreur après une écriture -> écriture conservée', async () => {
    await rejects(api.dbExec('/Documents/test.wdb', "INSERT INTO t(nom) VALUES ('B'); SELECT * FROM absente"), /no such table/);
    const [c] = await api.dbExec('/Documents/test.wdb', 'SELECT count(*) FROM t');
    assert(c.rows[0][0] === 2, JSON.stringify(c));
  });
  await t('SQLite : requête infinie coupée à 4 s', async () => {
    const t0 = performance.now();
    await rejects(api.dbExec('/Documents/test.wdb', 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c'), /interrompue/);
    const dt = performance.now() - t0;
    assert(dt > 3500 && dt < 9000, `durée ${dt}`);
    const [after] = await api.dbExec('/Documents/test.wdb', 'SELECT 1');
    assert(after.rows[0][0] === 1, 'le worker redémarre');
  });
  await t('téléchargement web (même origine)', async () => {
    const r = await api.webDownload(new URL('../exemples/demo.js', import.meta.url).href);
    assert(r.paths[0] === '/Téléchargements/demo.js' && r.size > 100, JSON.stringify(r));
  });
  await t('service worker : vfs/ et wapp/', async () => {
    assert(await swReady(), 'service worker inactif');
    const root = new URL('../', import.meta.url);
    const r = await fetch(new URL('vfs/Documents/Bienvenue.txt', root));
    assert(r.ok && (await r.text()).includes('Bienvenue'), `vfs ${r.status}`);
    assert(/sandbox/.test(r.headers.get('content-security-policy') || ''), 'CSP sandbox');
    const dl = await fetch(new URL('vfs/Documents/Bienvenue.txt?download=1', root));
    assert(/attachment/.test(dl.headers.get('content-disposition') || ''), 'téléchargement');
    const miss = await fetch(new URL('vfs/Documents/absent.txt', root));
    assert(miss.status === 404);
  });
  await t('système', async () => {
    const s = await api.system();
    assert(s.web_proxy === false && s.max_upload_mb === 100);
  });

  await fetch('results.php', { method: 'POST', body: JSON.stringify(results) });
  document.body.textContent = results.map((r) => `${r.ok ? 'OK' : 'KO'} ${r.name}${r.error ? ` : ${r.error}` : ''}`).join('\n');
})();
