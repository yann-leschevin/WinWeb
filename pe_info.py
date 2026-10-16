"""Analyse statique (lecture seule) des en-têtes PE d'un fichier .exe/.dll.

Le fichier n'est JAMAIS exécuté : on se contente de décoder les structures
binaires avec le module ``struct``.
"""

import datetime
import os
import struct

MAX_READ = 4 * 1024 * 1024
MAX_SECTIONS = 96

MACHINES = {
    0x0000: "Inconnue",
    0x014C: "x86 (Intel 386, 32 bits)",
    0x0166: "MIPS R4000",
    0x01C0: "ARM (32 bits)",
    0x01C4: "ARMv7 Thumb-2",
    0x0200: "Intel Itanium (IA-64)",
    0x5064: "RISC-V 64",
    0x8664: "x64 (AMD64, 64 bits)",
    0xAA64: "ARM64",
    0xEBC: "EFI Byte Code",
}

SUBSYSTEMS = {
    1: ("Natif (pilote / noyau)", "Autre"),
    2: ("Windows GUI (interface graphique)", "GUI"),
    3: ("Windows Console (CUI)", "Console"),
    5: ("OS/2 Console", "Console"),
    7: ("POSIX Console", "Console"),
    9: ("Windows CE GUI", "GUI"),
    10: ("Application EFI", "Autre"),
    11: ("Pilote EFI (services de démarrage)", "Autre"),
    12: ("Pilote EFI (exécution)", "Autre"),
    13: ("ROM EFI", "Autre"),
    14: ("Xbox", "Autre"),
    16: ("Application de démarrage Windows", "Autre"),
}

FILE_CHARACTERISTICS = [
    (0x0001, "Relocations supprimées"),
    (0x0002, "Image exécutable"),
    (0x0020, "Adresses > 2 Go prises en charge"),
    (0x0100, "Machine 32 bits"),
    (0x0200, "Symboles de débogage supprimés"),
    (0x1000, "Fichier système"),
    (0x2000, "Bibliothèque (DLL)"),
]

DLL_CHARACTERISTICS = [
    (0x0020, "ASLR haute entropie"),
    (0x0040, "ASLR (base dynamique)"),
    (0x0100, "DEP / NX compatible"),
    (0x0400, "Pas de SEH"),
    (0x4000, "Control Flow Guard"),
    (0x8000, "Compatible Terminal Server"),
]

SECTION_FLAGS = [
    (0x00000020, "code"),
    (0x00000040, "données initialisées"),
    (0x00000080, "données non initialisées"),
    (0x20000000, "exécutable"),
    (0x40000000, "lecture"),
    (0x80000000, "écriture"),
]


class PEError(ValueError):
    pass


def _unpack(fmt, data, offset):
    size = struct.calcsize(fmt)
    if offset < 0 or offset + size > len(data):
        raise PEError("Fichier tronqué : en-tête incomplet")
    return struct.unpack_from(fmt, data, offset)


def _flags(value, table):
    return [label for bit, label in table if value & bit]


def analyze_bytes(data, file_size=None):
    file_size = len(data) if file_size is None else file_size
    if len(data) < 64:
        raise PEError("Fichier trop petit pour être un exécutable Windows")
    (mz,) = _unpack("<2s", data, 0)
    if mz != b"MZ":
        raise PEError("Signature MZ absente : ce n'est pas un exécutable Windows")
    (e_lfanew,) = _unpack("<I", data, 0x3C)
    (pe_sig,) = _unpack("<4s", data, e_lfanew)
    if pe_sig != b"PE\0\0":
        raise PEError("En-tête MZ présent mais signature PE absente (programme MS-DOS 16 bits ?)")

    coff = e_lfanew + 4
    machine, nsections, timestamp, _symptr, _nsyms, opt_size, characteristics = _unpack(
        "<HHIIIHH", data, coff
    )
    opt = coff + 20
    (magic,) = _unpack("<H", data, opt)
    if magic == 0x10B:
        fmt = "PE32"
    elif magic == 0x20B:
        fmt = "PE32+"
    elif magic == 0x107:
        fmt = "ROM"
    else:
        raise PEError("En-tête optionnel inconnu (magic 0x%04X)" % magic)

    info = {
        "valid": True,
        "format": fmt,
        "bits": 64 if fmt == "PE32+" else 32,
        "machine_code": "0x%04X" % machine,
        "machine": MACHINES.get(machine, "Inconnue (0x%04X)" % machine),
        "pe_offset": e_lfanew,
        "sections_count": nsections,
        "characteristics": _flags(characteristics, FILE_CHARACTERISTICS),
        "is_dll": bool(characteristics & 0x2000),
        "file_size": file_size,
    }

    # Horodatage de compilation (secondes depuis 1970, UTC)
    info["timestamp"] = timestamp
    try:
        dt = datetime.datetime.fromtimestamp(timestamp, tz=datetime.timezone.utc)
        info["timestamp_iso"] = dt.strftime("%Y-%m-%d %H:%M:%S UTC")
        now = datetime.datetime.now(tz=datetime.timezone.utc)
        info["timestamp_note"] = (
            "Valeur incohérente : probablement un hachage de build reproductible"
            if dt > now or dt.year < 1990
            else ""
        )
    except (OverflowError, OSError, ValueError):
        info["timestamp_iso"] = "invalide"
        info["timestamp_note"] = ""

    if fmt in ("PE32", "PE32+") and opt_size >= 70:
        major_link, minor_link = _unpack("<BB", data, opt + 2)
        (entry_point,) = _unpack("<I", data, opt + 16)
        if fmt == "PE32":
            (image_base,) = _unpack("<I", data, opt + 28)
        else:
            (image_base,) = _unpack("<Q", data, opt + 24)
        major_os, minor_os = _unpack("<HH", data, opt + 40)
        subsystem, dll_chars = _unpack("<HH", data, opt + 68)
        label, kind = SUBSYSTEMS.get(subsystem, ("Inconnu (%d)" % subsystem, "Autre"))
        info.update(
            {
                "linker_version": "%d.%d" % (major_link, minor_link),
                "os_version": "%d.%d" % (major_os, minor_os),
                "entry_point": "0x%08X" % entry_point,
                "image_base": "0x%X" % image_base,
                "subsystem_code": subsystem,
                "subsystem": label,
                "subsystem_kind": kind,
                "dll_characteristics": _flags(dll_chars, DLL_CHARACTERISTICS),
            }
        )
        # Répertoire de données n°14 : en-tête CLR => assemblage .NET
        dirs_off, count_off = (opt + 96, opt + 92) if fmt == "PE32" else (opt + 112, opt + 108)
        try:
            (ndirs,) = _unpack("<I", data, count_off)
            if ndirs > 14:
                clr_rva, clr_size = _unpack("<II", data, dirs_off + 14 * 8)
                info["dotnet"] = bool(clr_rva and clr_size)
            else:
                info["dotnet"] = False
        except PEError:
            info["dotnet"] = False
    else:
        info.update({"subsystem": "Inconnu", "subsystem_kind": "Autre"})

    sections = []
    sec_off = opt + opt_size
    for i in range(min(nsections, MAX_SECTIONS)):
        try:
            name, vsize, vaddr, raw_size, raw_ptr, _r, _l, _nr, _nl, chars = _unpack(
                "<8sIIIIIIHHI", data, sec_off + i * 40
            )
        except PEError:
            info["warning"] = "Table des sections tronquée"
            break
        sections.append(
            {
                "name": name.rstrip(b"\0").decode("latin-1") or "(sans nom)",
                "virtual_size": vsize,
                "virtual_address": "0x%08X" % vaddr,
                "raw_size": raw_size,
                "raw_pointer": "0x%08X" % raw_ptr,
                "flags": _flags(chars, SECTION_FLAGS),
            }
        )
    info["sections"] = sections
    return info


def analyze_file(path):
    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        data = fh.read(MAX_READ)
    try:
        return analyze_bytes(data, size)
    except PEError as exc:
        return {"valid": False, "error": str(exc), "file_size": size}
