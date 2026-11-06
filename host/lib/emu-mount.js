// Image disque (.iso) d'un jeu Switch décompressé : montée par Windows comme un lecteur (instantané,
// sans copier des dizaines de Go), puis le fichier exefs/main du lecteur est donné à l'émulateur.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const ps = command => new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
  { windowsHide: true, timeout: 60000 }, (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).split('\n')[0].trim())) : resolve(String(out).trim()))));

/** Lettre du lecteur de l'image, montée si elle ne l'est pas déjà. */
async function mount(image) {
  const letter = await ps(`$i = Get-DiskImage -ImagePath ${q(image)}; if (-not $i.Attached) { $i = Mount-DiskImage -ImagePath ${q(image)} -StorageType ISO -PassThru }; ($i | Get-Volume).DriveLetter`);
  if (!/^[A-Z]$/i.test(letter)) throw new Error('Windows n’a pas monté l’image');
  return letter.toUpperCase() + ':\\';
}

/** Fichier à lancer dans l'image montée (le premier des chemins proposés qui existe). */
async function gameFile(image, inner) {
  const root = await mount(image);
  for (const p of inner) {
    const f = path.join(root, p);
    if (fs.existsSync(f)) return f;
  }
  throw new Error(`Pas de jeu reconnu dans ${path.basename(image)}`);
}

const unmount = image => ps(`Dismount-DiskImage -ImagePath ${q(image)} | Out-Null`).catch(() => {});

module.exports = { mount, gameFile, unmount };
