// Complément « PC hôte » de la mise à l'échelle pendant le streaming (setup/hote-echelle), installé
// depuis Paramètres → Streaming sur un PC qui diffuse avec Sunshine. Il ajoute à Sunshine des
// variantes « <appli> [150 %] » que le moteur de streaming lance selon le réglage « Mise à
// l'échelle du PC hôte » (engine/KanePlay/app/backend/kanemodescale.h). L'installation demande les
// droits d'administrateur (fichiers de Sunshine dans Program Files, redémarrage du service).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const VALUES = [100, 125, 150, 175, 200];          // mêmes valeurs que Installer.ps1
const VARIANT = /^(.+) \[(\d{3}) %\]$/;
const SUNSHINE = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Sunshine');
const TARGET = path.join(process.env.ProgramData || 'C:\\ProgramData', 'KaneMode', 'HoteEchelle', 'Echelle.ps1');

const hash = file => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };

// Fichier des applis : réglage file_apps de sunshine.conf, sinon config\apps.json
function appsFile() {
  let file = path.join(SUNSHINE, 'config', 'apps.json');
  try {
    const m = /^\s*file_apps\s*=\s*(.+?)\s*$/m.exec(fs.readFileSync(path.join(SUNSHINE, 'config', 'sunshine.conf'), 'utf8'));
    if (m) file = path.isAbsolute(m[1]) ? m[1] : path.join(SUNSHINE, 'config', m[1]);
  } catch { /* pas de sunshine.conf */ }
  return file;
}

function create(root) {
  const dir = path.join(root, 'setup', 'hote-echelle');

  function status() {
    const file = appsFile();
    let apps;
    try { apps = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).apps || []; }
    catch { return { sunshine: false, bundled: fs.existsSync(dir) }; }
    const names = new Set(apps.map(a => a.name));
    const bases = apps.filter(a => !VARIANT.test(a.name));
    const variants = apps.length - bases.length;
    // Applis ajoutées dans Sunshine depuis l'installation : sans variantes
    const missing = bases.filter(b => !VALUES.every(v => names.has(`${b.name} [${v} %]`))).map(b => b.name);
    const script = fs.existsSync(TARGET);
    const installed = script && variants > 0;
    return {
      sunshine: true, bundled: fs.existsSync(dir), installed, apps: bases.length, variants, missing: installed ? missing : [],
      // Script différent de celui embarqué : KaneMode a été mis à jour depuis
      outdated: installed && hash(TARGET) !== hash(path.join(dir, 'Echelle.ps1')),
    };
  }

  /** Installe (ou met à jour) ou retire le complément. Ouvre la demande d'administrateur de Windows. */
  function run(remove = false) {
    const script = path.join(dir, 'Installer.ps1');
    if (!fs.existsSync(script)) return Promise.reject(new Error('Complément absent de cette version de KaneMode'));
    const q = s => `'${String(s).replace(/'/g, "''")}'`;
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `"${script}"`].concat(remove ? ['-Desinstaller'] : []);
    const cmd = `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ${args.map(q).join(',')}; exit $p.ExitCode`;
    return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true, timeout: 180000 }, (err, out, errOut) => {
      if (!err) return resolve(status());
      // Demande d'administrateur refusée : « L'opération a été annulée par l'utilisateur »
      if (/annul|cancel/i.test(String(errOut))) return reject(new Error('Installation annulée'));
      reject(new Error(remove ? 'Le retrait du complément a échoué' : 'L’installation du complément a échoué'));
    }));
  }

  return { status, install: () => run(false), remove: () => run(true) };
}

module.exports = { create, VALUES };
