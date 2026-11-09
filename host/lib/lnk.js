// Raccourcis Windows (.lnk) lus sans PowerShell : format « Shell Link » ([MS-SHLLINK]).
// Sert aux portages PC rangés dans le dossier d'une console (Zelda Ocarina of Time recompilé…) :
// le raccourci donne l'exécutable, son dossier de travail et ses arguments.
'use strict';
const fs = require('fs');
const path = require('path');

const F = { IDLIST: 0x1, LINKINFO: 0x2, NAME: 0x4, RELPATH: 0x8, WORKDIR: 0x10, ARGS: 0x20, ICON: 0x40, UNICODE: 0x80 };

const cstr = (b, at, wide) => {
  if (at <= 0 || at >= b.length) return '';
  if (wide) { let e = at; while (e + 1 < b.length && (b[e] || b[e + 1])) e += 2; return b.toString('utf16le', at, e); }
  let e = at; while (e < b.length && b[e]) e++;
  return b.toString('latin1', at, e);
};

/** { target, args, cwd } d'un raccourci, ou null s'il est illisible ou sans chemin local. */
function readLnk(file) {
  let b;
  try { b = fs.readFileSync(file); } catch { return null; }
  if (b.length < 0x4c || b.readUInt32LE(0) !== 0x4c) return null;
  const flags = b.readUInt32LE(0x14);
  let at = 0x4c;
  try {
    if (flags & F.IDLIST) at += 2 + b.readUInt16LE(at);
    let target = '';
    if (flags & F.LINKINFO) {
      const size = b.readUInt32LE(at), head = b.readUInt32LE(at + 4), liFlags = b.readUInt32LE(at + 8);
      if (liFlags & 1) {
        const base = head >= 0x24 ? cstr(b, at + b.readUInt32LE(at + 28), true) : '';
        const suffixU = head >= 0x24 ? cstr(b, at + b.readUInt32LE(at + 32), true) : '';
        target = (base || cstr(b, at + b.readUInt32LE(at + 16), false)) + (suffixU || cstr(b, at + b.readUInt32LE(at + 24), false));
      }
      at += size;
    }
    const wide = !!(flags & F.UNICODE);
    const str = () => { const n = b.readUInt16LE(at); at += 2; const s = wide ? b.toString('utf16le', at, at + n * 2) : b.toString('latin1', at, at + n); at += wide ? n * 2 : n; return s; };
    const name = flags & F.NAME ? str() : '';
    const rel = flags & F.RELPATH ? str() : '';
    const cwd = flags & F.WORKDIR ? str() : '';
    const args = flags & F.ARGS ? str() : '';
    void name;
    if (!target && rel) target = path.resolve(path.dirname(file), rel);
    if (!target) return null;
    return { target, args, cwd: cwd || path.dirname(target) };
  } catch { return null; }
}

module.exports = { readLnk };
