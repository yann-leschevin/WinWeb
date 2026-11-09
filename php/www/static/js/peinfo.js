// Analyse statique (lecture seule) des en-têtes PE d'un fichier .exe/.dll.
// Portage JavaScript de pe_info.py : le fichier n'est JAMAIS exécuté,
// seules les structures binaires sont décodées (DataView, petit-boutiste).

const MAX_READ = 4 * 1024 * 1024;
const MAX_SECTIONS = 96;

const MACHINES = {
  0x0000: 'Inconnue',
  0x014C: 'x86 (Intel 386, 32 bits)',
  0x0166: 'MIPS R4000',
  0x01C0: 'ARM (32 bits)',
  0x01C4: 'ARMv7 Thumb-2',
  0x0200: 'Intel Itanium (IA-64)',
  0x5064: 'RISC-V 64',
  0x8664: 'x64 (AMD64, 64 bits)',
  0xAA64: 'ARM64',
  0xEBC: 'EFI Byte Code',
};

const SUBSYSTEMS = {
  1: ['Natif (pilote / noyau)', 'Autre'],
  2: ['Windows GUI (interface graphique)', 'GUI'],
  3: ['Windows Console (CUI)', 'Console'],
  5: ['OS/2 Console', 'Console'],
  7: ['POSIX Console', 'Console'],
  9: ['Windows CE GUI', 'GUI'],
  10: ['Application EFI', 'Autre'],
  11: ['Pilote EFI (services de démarrage)', 'Autre'],
  12: ['Pilote EFI (exécution)', 'Autre'],
  13: ['ROM EFI', 'Autre'],
  14: ['Xbox', 'Autre'],
  16: ['Application de démarrage Windows', 'Autre'],
};

const FILE_CHARACTERISTICS = [
  [0x0001, 'Relocations supprimées'],
  [0x0002, 'Image exécutable'],
  [0x0020, 'Adresses > 2 Go prises en charge'],
  [0x0100, 'Machine 32 bits'],
  [0x0200, 'Symboles de débogage supprimés'],
  [0x1000, 'Fichier système'],
  [0x2000, 'Bibliothèque (DLL)'],
];

const DLL_CHARACTERISTICS = [
  [0x0020, 'ASLR haute entropie'],
  [0x0040, 'ASLR (base dynamique)'],
  [0x0100, 'DEP / NX compatible'],
  [0x0400, 'Pas de SEH'],
  [0x4000, 'Control Flow Guard'],
  [0x8000, 'Compatible Terminal Server'],
];

const SECTION_FLAGS = [
  [0x00000020, 'code'],
  [0x00000040, 'données initialisées'],
  [0x00000080, 'données non initialisées'],
  [0x20000000, 'exécutable'],
  [0x40000000, 'lecture'],
  [0x80000000, 'écriture'],
];

class PEError extends Error {}

const hex = (v, width = 0) => `0x${v.toString(16).toUpperCase().padStart(width, '0')}`;
const flags = (value, table) => table.filter(([bit]) => (value & bit) >>> 0 !== 0).map(([, label]) => label);

function reader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (offset, size) => {
    if (offset < 0 || offset + size > bytes.length) throw new PEError('Fichier tronqué : en-tête incomplet');
  };
  return {
    u8: (o) => { need(o, 1); return view.getUint8(o); },
    u16: (o) => { need(o, 2); return view.getUint16(o, true); },
    u32: (o) => { need(o, 4); return view.getUint32(o, true); },
    u64: (o) => { need(o, 8); return view.getBigUint64(o, true); },
    str: (o, n) => { need(o, n); return String.fromCharCode(...bytes.subarray(o, o + n)); },
  };
}

function analyzeBytes(bytes, fileSize) {
  if (bytes.length < 64) throw new PEError('Fichier trop petit pour être un exécutable Windows');
  const r = reader(bytes);
  if (r.str(0, 2) !== 'MZ') throw new PEError('Signature MZ absente : ce n\'est pas un exécutable Windows');
  const lfanew = r.u32(0x3C);
  if (r.str(lfanew, 4) !== 'PE\0\0') {
    throw new PEError('En-tête MZ présent mais signature PE absente (programme MS-DOS 16 bits ?)');
  }
  const coff = lfanew + 4;
  const machine = r.u16(coff);
  const nsections = r.u16(coff + 2);
  const timestamp = r.u32(coff + 4);
  const optSize = r.u16(coff + 16);
  const characteristics = r.u16(coff + 18);
  const opt = coff + 20;
  const magic = r.u16(opt);
  let fmt;
  if (magic === 0x10B) fmt = 'PE32';
  else if (magic === 0x20B) fmt = 'PE32+';
  else if (magic === 0x107) fmt = 'ROM';
  else throw new PEError(`En-tête optionnel inconnu (magic ${hex(magic, 4)})`);

  const info = {
    valid: true,
    format: fmt,
    bits: fmt === 'PE32+' ? 64 : 32,
    machine_code: hex(machine, 4),
    machine: MACHINES[machine] || `Inconnue (${hex(machine, 4)})`,
    pe_offset: lfanew,
    sections_count: nsections,
    characteristics: flags(characteristics, FILE_CHARACTERISTICS),
    is_dll: Boolean(characteristics & 0x2000),
    file_size: fileSize,
    timestamp,
  };

  const dt = new Date(timestamp * 1000);
  if (Number.isNaN(dt.getTime())) {
    info.timestamp_iso = 'invalide';
    info.timestamp_note = '';
  } else {
    info.timestamp_iso = `${dt.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
    info.timestamp_note = dt > new Date() || dt.getUTCFullYear() < 1990
      ? 'Valeur incohérente : probablement un hachage de build reproductible' : '';
  }

  if ((fmt === 'PE32' || fmt === 'PE32+') && optSize >= 70) {
    const entryPoint = r.u32(opt + 16);
    const imageBase = fmt === 'PE32' ? BigInt(r.u32(opt + 28)) : r.u64(opt + 24);
    const subsystem = r.u16(opt + 68);
    const dllChars = r.u16(opt + 70);
    const [label, kind] = SUBSYSTEMS[subsystem] || [`Inconnu (${subsystem})`, 'Autre'];
    Object.assign(info, {
      linker_version: `${r.u8(opt + 2)}.${r.u8(opt + 3)}`,
      os_version: `${r.u16(opt + 40)}.${r.u16(opt + 42)}`,
      entry_point: hex(entryPoint, 8),
      image_base: `0x${imageBase.toString(16).toUpperCase()}`,
      subsystem_code: subsystem,
      subsystem: label,
      subsystem_kind: kind,
      dll_characteristics: flags(dllChars, DLL_CHARACTERISTICS),
    });
    // Répertoire de données n°14 : en-tête CLR => assemblage .NET
    const [dirsOff, countOff] = fmt === 'PE32' ? [opt + 96, opt + 92] : [opt + 112, opt + 108];
    try {
      const ndirs = r.u32(countOff);
      info.dotnet = ndirs > 14 ? Boolean(r.u32(dirsOff + 14 * 8) && r.u32(dirsOff + 14 * 8 + 4)) : false;
    } catch {
      info.dotnet = false;
    }
  } else {
    Object.assign(info, { subsystem: 'Inconnu', subsystem_kind: 'Autre' });
  }

  const sections = [];
  const secOff = opt + optSize;
  for (let i = 0; i < Math.min(nsections, MAX_SECTIONS); i += 1) {
    const o = secOff + i * 40;
    try {
      const name = r.str(o, 8).replace(/\0+$/, '');
      sections.push({
        name: name || '(sans nom)',
        virtual_size: r.u32(o + 8),
        virtual_address: hex(r.u32(o + 12), 8),
        raw_size: r.u32(o + 16),
        raw_pointer: hex(r.u32(o + 20), 8),
        flags: flags(r.u32(o + 36), SECTION_FLAGS),
      });
    } catch {
      info.warning = 'Table des sections tronquée';
      break;
    }
  }
  info.sections = sections;
  return info;
}

/** Analyse un Blob ; renvoie le même objet que l'API /api/pe de la version Python. */
export async function analyzeBlob(blob) {
  const bytes = new Uint8Array(await blob.slice(0, MAX_READ).arrayBuffer());
  try {
    return analyzeBytes(bytes, blob.size);
  } catch (err) {
    if (err instanceof PEError) return { valid: false, error: err.message, file_size: blob.size };
    throw err;
  }
}
