// Bases de données .wdb (SQLite) exécutées dans le navigateur.
// Remplace /api/db/schema et /api/db/exec de la version Python : le travail est
// fait par dbworker.js (sql.js), arrêté de force au-delà de 4 s par requête.
import {
  FsError, isWithin, normalize, readBlob, TRASH_PATH, writeBlob,
} from './localfs.js';

const TIME_LIMIT = 4000;
const MAX_SQL = 200000;

let worker = null;
let workerReady = null;
let seq = 0;
const pending = new Map();
let queue = Promise.resolve();

function startWorker() {
  worker = new Worker(new URL('./dbworker.js', import.meta.url));
  workerReady = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const msg = e.data;
      if ('ready' in msg) {
        if (msg.ready) resolve(); else reject(new Error(`SQLite indisponible : ${msg.error}`));
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      p.resolve(msg); // msg.ok / msg.error traités par l'appelant
    };
    worker.onerror = (e) => reject(new Error(`SQLite indisponible : ${e.message || 'erreur de chargement'}`));
  });
}

function stopWorker() {
  worker?.terminate();
  worker = null;
  workerReady = null;
}

async function call(message) {
  if (!worker) startWorker();
  try {
    await workerReady;
  } catch (err) {
    stopWorker();
    throw err;
  }
  return new Promise((resolve, reject) => {
    seq += 1;
    const id = seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      stopWorker(); // seule façon d'interrompre une requête en cours
      reject(new FsError(`Requête interrompue : durée maximale de ${TIME_LIMIT / 1000} s dépassée`));
    }, TIME_LIMIT);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ ...message, id }, [message.bytes]);
  });
}

function dbPath(path) {
  const p = normalize(path);
  if (!p.toLowerCase().endsWith('.wdb')) throw new FsError('Ce n\'est pas une base de données .wdb');
  return p;
}

/** Une opération à la fois : deux écritures simultanées ne s'écrasent pas. */
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

export function schema(path) {
  return serial(async () => {
    const p = dbPath(path);
    const bytes = await (await readBlob(p)).arrayBuffer();
    const msg = await call({ op: 'schema', bytes });
    if (!msg.ok) throw new FsError(msg.error);
    return { path: p, objects: msg.objects };
  });
}

export function exec(path, sql, params) {
  return serial(async () => {
    const p = dbPath(path);
    if (isWithin(p, TRASH_PATH)) throw new FsError('Impossible de modifier une base située dans la corbeille');
    if (typeof sql !== 'string' || !sql.trim()) throw new FsError('Requête vide');
    if (sql.length > MAX_SQL) throw new FsError('Requête trop longue');
    if (params !== undefined && params !== null && !Array.isArray(params)) throw new FsError('Paramètres invalides');
    for (const v of params || []) {
      if (v !== null && !['string', 'number'].includes(typeof v)) throw new FsError('Type de paramètre non pris en charge');
    }
    const bytes = await (await readBlob(p)).arrayBuffer();
    const msg = await call({ op: 'exec', bytes, sql, params: params || [] });
    if (msg.bytes) await writeBlob(p, new Blob([msg.bytes], { type: 'application/vnd.sqlite3' }));
    if (!msg.ok) throw new FsError(msg.error);
    return { path: p, results: msg.results };
  });
}
