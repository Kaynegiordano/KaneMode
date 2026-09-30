// Informations et actions système : état du mode Xbox, stockage, captures d'écran, sortie vers le bureau.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');

const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const run = (cmd, args) => new Promise(res => execFile(cmd, args, { windowsHide: true }, (err, out) => res(err ? '' : String(out))));

async function regValue(key, name) {
  const out = await run('reg.exe', ['query', key, '/v', name]);
  const m = new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`, 'i').exec(out);
  if (!m) return null;
  const v = m[1].trim();
  return /^0x[0-9a-f]+$/i.test(v) ? parseInt(v, 16) : v;
}

// ---------- Mode Xbox (Full Screen Experience) ----------
const TOOL_DIR = path.join(process.env.ProgramFiles || 'C:\\Program Files', '8bit2qubit', 'Xbox FullScreen Experience Tool');
async function xboxMode() {
  const cv = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';
  const [build, ubr, display, deviceForm] = await Promise.all([
    regValue(cv, 'CurrentBuild'), regValue(cv, 'UBR'), regValue(cv, 'DisplayVersion'), regValue(cv + '\\OEM', 'DeviceForm'),
  ]);
  const b = +build, r = +ubr;
  const native = (b === 26100 || b === 26200) ? r >= 8328 : (b === 26220 ? r >= 7271 : b > 26220);
  const compatible = native || (b === 26100 && r >= 7019) || (b === 26200 && r >= 7015) || b >= 28000;
  const toolExe = path.join(TOOL_DIR, 'XboxFullScreenExperienceTool.exe');
  const toolInstalled = isFile(toolExe);
  const backup = isFile(path.join(TOOL_DIR, 'DeviceForm.bak'));
  return {
    windows: `${display || ''} (build ${build}.${ubr})`.trim(), compatible, native,
    deviceForm, toolInstalled, toolPath: toolInstalled ? toolExe : null,
    enabled: deviceForm === 0x2e && backup,
    enabler: isFile(path.join(__dirname, '..', '..', 'setup', 'bin', 'xfset', 'XboxFullScreenExperienceTool.exe')),
  };
}

// ---------- Stockage ----------
function storage() {
  const drives = [];
  for (let c = 65; c <= 90; c++) {
    const d = String.fromCharCode(c) + ':\\';
    try {
      const s = fs.statfsSync(d);
      if (!s.blocks) continue;
      drives.push({ letter: d.slice(0, 2), total: s.blocks * s.bsize, free: s.bavail * s.bsize });
    } catch { /* lecteur absent */ }
  }
  return drives;
}

// ---------- Captures d'écran ----------
const MEDIA_EXT = { '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.mp4': 'video' };
function mediaRoots(steamUserdata) {
  const home = os.homedir();
  const roots = [
    { dir: path.join(home, 'Videos', 'Captures'), label: 'Xbox Game Bar' },
    { dir: path.join(home, 'Pictures', 'Screenshots'), label: 'Captures Windows' },
    { dir: path.join(home, 'OneDrive', 'Pictures', 'Screenshots'), label: 'Captures Windows' },
    { dir: path.join(home, 'OneDrive', 'Images', 'Captures d’écran'), label: 'Captures Windows' },
    { dir: path.join(home, 'Pictures', 'Captures d’écran'), label: 'Captures Windows' },
  ];
  if (steamUserdata && fs.existsSync(steamUserdata)) {
    for (const uid of fs.readdirSync(steamUserdata)) {
      const remote = path.join(steamUserdata, uid, '760', 'remote');
      if (!fs.existsSync(remote)) continue;
      for (const appid of fs.readdirSync(remote)) roots.push({ dir: path.join(remote, appid, 'screenshots'), label: 'Steam', appid });
    }
  }
  return roots.filter(r => fs.existsSync(r.dir));
}
function listMedia(steamUserdata, limit = 400) {
  const items = [];
  for (const r of mediaRoots(steamUserdata)) {
    let names = [];
    try { names = fs.readdirSync(r.dir); } catch { continue; }
    for (const n of names) {
      const kind = MEDIA_EXT[path.extname(n).toLowerCase()];
      if (!kind) continue;
      const full = path.join(r.dir, n);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      items.push({ path: full, kind, label: r.label, appid: r.appid || null, date: st.mtimeMs, size: st.size, name: n });
    }
  }
  return items.sort((a, b) => b.date - a.date).slice(0, limit);
}
/** Vrai si le fichier fait partie des dossiers de captures connus. */
function isMediaPath(p, steamUserdata) {
  const full = path.resolve(p).toLowerCase();
  return !!MEDIA_EXT[path.extname(full)] && mediaRoots(steamUserdata).some(r => full.startsWith(path.resolve(r.dir).toLowerCase() + path.sep));
}

/**
 * Envoie des captures à la corbeille de Windows (elles restent récupérables). Seuls les fichiers des
 * dossiers de captures connus sont acceptés. Renvoie les chemins réellement supprimés.
 */
async function deleteMedia(paths, steamUserdata) {
  const files = [...new Set(paths)].filter(f => typeof f === 'string' && isMediaPath(f, steamUserdata) && isFile(f));
  if (!files.length) return [];
  // Liste passée par l'environnement : aucun nom de fichier n'est interprété comme du code
  const ps = "Add-Type -AssemblyName Microsoft.VisualBasic; foreach ($f in ($env:KANEMODE_DELETE | ConvertFrom-Json)) { try { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($f, 'OnlyErrorDialogs', 'SendToRecycleBin') } catch {} }";
  await new Promise(res => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { windowsHide: true, env: { ...process.env, KANEMODE_DELETE: JSON.stringify(files) } }, () => res()));
  return files.filter(f => !isFile(f));
}

// ---------- Retour au bureau ----------
async function explorerRunning() {
  const out = await run('tasklist.exe', ['/FI', 'IMAGENAME eq explorer.exe', '/NH']);
  return /explorer\.exe/i.test(out);
}
/** Ferme la fenêtre KaneMode (profil Edge dédié) et s'assure que le bureau Windows est chargé. */
async function toDesktop(profileDir, dry) {
  const steps = [];
  if (!(await explorerRunning())) steps.push('explorer');
  steps.push('close-window');
  if (dry) return steps;
  if (steps.includes('explorer')) spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
  // Ferme uniquement les processus Edge lancés avec le profil de KaneMode.
  const ps = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profileDir.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawn('powershell.exe', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return steps;
}

module.exports = { xboxMode, storage, listMedia, isMediaPath, deleteMedia, toDesktop };
