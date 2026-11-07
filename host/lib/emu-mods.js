// Mods des jeux Switch et Switch 2 (Eden, Lichii) : un mod est un dossier rangé dans
// <émulateur>\user\load\<identifiant du jeu>\<nom du mod>\, avec ses sous-dossiers exefs (correctifs
// .ips : 60 FPS, résolution…), romfs (fichiers remplacés) ou cheats. L'émulateur les applique tout seul
// au lancement. Ajout depuis une archive (.zip, .7z, .rar) ou un dossier, dans les deux cas copié.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PARTS = ['exefs', 'romfs', 'cheats', 'exefs_patches'];
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/**
 * Identifiant du jeu (16 chiffres hexadécimaux) : dans le nom du fichier (« […][0400486024dec000] »),
 * sinon dans main.npdm à côté de l'exefs lancé (section ACI0, identifiant à +0x10).
 */
function titleIdOf(romPath) {
  const m = /\[([0-9a-f]{16})\]/i.exec(path.basename(String(romPath || '')));
  if (m) return m[1].toUpperCase();
  const npdm = path.join(path.dirname(String(romPath || '')), 'main.npdm');
  try {
    const b = fs.readFileSync(npdm);
    if (b.toString('latin1', 0, 4) !== 'META') return null;
    const aci = b.readUInt32LE(0x70);
    if (b.toString('latin1', aci, aci + 4) !== 'ACI0') return null;
    return b.readBigUInt64LE(aci + 0x10).toString(16).padStart(16, '0').toUpperCase();
  } catch { return null; }
}

/**
 * Dossier des mods d'un jeu. Le dossier « load » peut être réglé ailleurs dans l'émulateur
 * (Data Storage → load_directory : la config de Lichii reprise d'Eglantine pointe encore vers
 * Émulateurs\eglantine\user\load) : c'est celui-là que l'émulateur lit.
 */
function modsDir(emuDir, tid) {
  let root = path.join(emuDir, 'user', 'load');
  try {
    const { iniValue } = require('./emu-pads');
    const text = fs.readFileSync(path.join(emuDir, 'user', 'config', 'qt-config.ini'), 'utf8');
    const v = (iniValue(text, 'Data%20Storage', 'load_directory') || '').replace(/^"|"$/g, '').trim();
    if (v && path.isAbsolute(v)) root = path.normalize(v);
  } catch { /* pas de config : dossier par défaut */ }
  return path.join(root, tid);
}

/** Mods installés pour ce jeu : nom et parties (exefs, romfs, cheats). */
function list(dir) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
  return names.sort((a, b) => a.localeCompare(b, 'fr')).map(name => ({ name, parts: PARTS.filter(p => isDir(path.join(dir, name, p))) }));
}

const isModRoot = d => PARTS.some(p => isDir(path.join(d, p)));

/** Dossiers de mod dans un dossier décompressé (lui-même, ou ses sous-dossiers jusqu'à 3 niveaux). */
function findRoots(dir, depth = 0) {
  if (isModRoot(dir)) return [dir];
  if (depth >= 3) return [];
  let subs = [];
  try { subs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !/^__MACOSX$/i.test(d.name)); } catch { return []; }
  return subs.flatMap(d => findRoots(path.join(dir, d.name), depth + 1));
}

// tar de Windows (libarchive : .zip, .7z, .rar), pas un autre tar du PATH (celui de Git ne lit pas les .zip)
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const extract = (archive, dest) => new Promise((resolve, reject) => {
  execFile(TAR, ['-xf', archive, '-C', dest], { windowsHide: true, timeout: 120000 }, err => (err ? reject(new Error('Archive illisible')) : resolve()));
});
const safeName = s => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'Mod';

/**
 * Ajoute un mod (archive ou dossier) au dossier des mods du jeu. Renvoie les noms ajoutés.
 * Un mod du même nom est remplacé.
 */
async function add(dir, src) {
  const from = String(src || '');
  let tmp = null;
  try {
    let base = from;
    let fallbackName = path.basename(from);
    if (isFile(from)) {
      if (!/\.(zip|7z|rar)$/i.test(from)) throw new Error('Choisissez une archive .zip, .7z ou .rar, ou un dossier');
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-mod-'));
      await extract(from, tmp);
      base = tmp;
      fallbackName = path.basename(from, path.extname(from));
    } else if (!isDir(from)) throw new Error('Fichier introuvable');
    const roots = findRoots(base);
    if (!roots.length) throw new Error('Aucun mod reconnu : il faut un dossier exefs, romfs ou cheats');
    fs.mkdirSync(dir, { recursive: true });
    const added = [];
    for (const r of roots) {
      const name = safeName(r === base ? fallbackName : path.basename(r));
      const dest = path.join(dir, name);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(r, dest, { recursive: true });
      added.push(name);
    }
    return added;
  } finally {
    if (tmp) fs.rm(tmp, { recursive: true, force: true }, () => {});
  }
}

/** Retire un mod (son dossier, copié à l'ajout : l'archive d'origine reste). */
function remove(dir, name) {
  const target = path.join(dir, safeName(name));
  if (path.dirname(target) !== path.resolve(dir) || !isDir(target)) throw new Error('Mod introuvable');
  fs.rmSync(target, { recursive: true, force: true });
}

module.exports = { titleIdOf, modsDir, list, add, remove, findRoots, PARTS };
