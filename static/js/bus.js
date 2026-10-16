// Bus d'événements minimal entre modules.
const listeners = new Map();

export function on(event, callback) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(callback);
  return () => listeners.get(event)?.delete(callback);
}

export function emit(event, detail) {
  for (const callback of [...(listeners.get(event) || [])]) {
    try {
      callback(detail);
    } catch (err) {
      console.error(`Erreur dans un écouteur « ${event} »`, err);
    }
  }
}

/** Signale qu'un ou plusieurs dossiers ont changé (explorateurs, bureau...). */
export const fsChanged = (dirs = []) => emit('fs-changed', { dirs });
