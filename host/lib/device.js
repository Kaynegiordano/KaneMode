// Appareil : console portable reconnue (ROG Ally, Legion Go, Steam Deck…), écran, batterie,
// cartes graphiques, logiciels constructeur ; mises à jour de pilotes par Windows Update.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOST = path.join(__dirname, '..');

// Consoles portables connues. `match` s'applique à « fabricant | modèle | famille ».
// tool : logiciel du constructeur (mises à jour du BIOS, des pilotes, TDP, boutons…)
const HANDHELDS = [
  { id: 'rog-xbox-ally', name: 'ROG Xbox Ally', maker: 'ASUS', match: /asus.*xbox ally|RC73/i, tool: /armoury crate/i, toolName: 'Armoury Crate SE', support: 'https://rog.asus.com/fr/support/' },
  { id: 'rog-ally-x', name: 'ROG Ally X', maker: 'ASUS', match: /asus.*ally x|RC72/i, tool: /armoury crate/i, toolName: 'Armoury Crate SE', support: 'https://rog.asus.com/fr/support/' },
  { id: 'rog-ally', name: 'ROG Ally', maker: 'ASUS', match: /asus.*ally|RC71/i, tool: /armoury crate/i, toolName: 'Armoury Crate SE', support: 'https://rog.asus.com/fr/support/' },
  { id: 'legion-go-2', name: 'Legion Go 2', maker: 'Lenovo', match: /lenovo.*legion go 2/i, tool: /legion space/i, toolName: 'Legion Space', support: 'https://pcsupport.lenovo.com/fr/fr/' },
  { id: 'legion-go-s', name: 'Legion Go S', maker: 'Lenovo', match: /lenovo.*legion go s/i, tool: /legion space/i, toolName: 'Legion Space', support: 'https://pcsupport.lenovo.com/fr/fr/' },
  { id: 'legion-go', name: 'Legion Go', maker: 'Lenovo', match: /lenovo.*(legion go|83E1)/i, tool: /legion space/i, toolName: 'Legion Space', support: 'https://pcsupport.lenovo.com/fr/fr/' },
  { id: 'msi-claw', name: 'MSI Claw', maker: 'MSI', match: /(micro-star|msi).*claw|claw.*(A1M|A2VM|A8)/i, tool: /msi center/i, toolName: 'MSI Center M', support: 'https://fr.msi.com/support' },
  { id: 'steam-deck', name: 'Steam Deck', maker: 'Valve', match: /valve.*(jupiter|galileo)/i, tool: /steam deck tools|handheld companion/i, toolName: 'Steam Deck Tools', support: 'https://help.steampowered.com/fr/faqs/view/6121-ECCD-D643-BAA8' },
  { id: 'zotac-zone', name: 'ZOTAC Zone', maker: 'ZOTAC', match: /zotac.*zone/i, tool: /zone|command center/i, toolName: 'ZOTAC Zone Command Center', support: 'https://www.zotac.com/fr/support' },
  { id: 'ayaneo', name: 'AYANEO', maker: 'AYANEO', match: /ayaneo|^aya\b/i, tool: /aya ?space/i, toolName: 'AYASpace', support: 'https://www.ayaneo.com/support/download' },
  { id: 'onexplayer', name: 'OneXPlayer', maker: 'ONE-NETBOOK', match: /one-?netbook|onexplayer|onexfly/i, tool: /onexconsole/i, toolName: 'OneXConsole', support: 'https://onexplayerstore.com/pages/support' },
  { id: 'gpd', name: 'GPD Win', maker: 'GPD', match: /^gpd\b|gpd win/i, tool: /gpd/i, toolName: 'GPD Motion Assistant', support: 'https://gpd.hk/' },
  { id: 'aokzoe', name: 'AOKZOE', maker: 'AOKZOE', match: /aokzoe/i, tool: /aokzoe/i, toolName: 'AOKZOE Console', support: 'https://aokzoestore.com/' },
];

// Pilotes graphiques : logiciel à ouvrir, sinon page officielle
const GPU_VENDORS = {
  '1002': { name: 'AMD', tool: /amd software|radeon software/i, toolName: 'AMD Software: Adrenalin', page: 'https://www.amd.com/fr/support/download/drivers.html' },
  '10DE': { name: 'NVIDIA', tool: /nvidia app|geforce experience/i, toolName: 'NVIDIA App', page: 'https://www.nvidia.com/fr-fr/software/nvidia-app/' },
  '8086': { name: 'Intel', tool: /intel.*graphics|arc control|driver & support/i, toolName: 'Intel Graphics Software', page: 'https://www.intel.fr/content/www/fr/fr/support/detect.html' },
};

// Profils fictifs pour tester l'interface sur un PC de bureau (?simulate=…)
const SIMULATED = {
  'rog-ally': { manufacturer: 'ASUSTeK COMPUTER INC.', model: 'ROG Ally RC71L_RC71L', family: 'ROG Ally', chassis: [31], cpu: 'AMD Ryzen Z1 Extreme', battery: { percent: 64, charging: false }, screens: [{ widthCm: 16, heightCm: 9 }], internalScreen: true, gpus: [{ name: 'AMD Radeon Graphics', driver: '31.0.24002.92', date: '2025-11-02', vendor: '1002', width: 1920, height: 1080, hz: 120 }], apps: [{ name: 'Armoury Crate SE', target: 'shell:AppsFolder\\B9ECED6F.ArmouryCrateSE_qmba6cd70vzyy!App' }], modernStandby: true, s3: false, memoryGb: 16 },
  'legion-go': { manufacturer: 'LENOVO', model: '83E1', family: 'Legion Go 8APU1', chassis: [32], cpu: 'AMD Ryzen Z1 Extreme', battery: { percent: 38, charging: true }, screens: [{ widthCm: 18, heightCm: 11 }], internalScreen: true, gpus: [{ name: 'AMD Radeon Graphics', driver: '31.0.21029.3', date: '2025-04-10', vendor: '1002', width: 2560, height: 1600, hz: 144 }], apps: [], modernStandby: true, s3: false, memoryGb: 16 },
  'steam-deck': { manufacturer: 'Valve', model: 'Jupiter', family: 'Aerith', chassis: [30], cpu: 'AMD Custom APU 0405', battery: { percent: 81, charging: false }, screens: [{ widthCm: 15, heightCm: 10 }], internalScreen: true, gpus: [{ name: 'AMD Custom GPU 0405', driver: '31.0.14057.5006', date: '2023-06-30', vendor: '1002', width: 1280, height: 800, hz: 60 }], apps: [], modernStandby: true, s3: false, memoryGb: 16 },
};

function runPs(script, args = [], timeout = 30000) {
  return new Promise(resolve => {
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HOST, script), ...args], { windowsHide: true });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    const t = setTimeout(() => p.kill(), timeout);
    p.on('close', () => { clearTimeout(t); resolve(out); });
    p.on('error', () => { clearTimeout(t); resolve(''); });
  });
}

let cache = null;
async function raw(force = false) {
  if (!force && cache && Date.now() - cache.t < 10 * 60e3) return cache.v;
  let v = null;
  try { v = JSON.parse(await runPs('device.ps1')); } catch { v = null; }
  cache = { t: Date.now(), v };
  return v;
}

const arr = x => (Array.isArray(x) ? x : x ? [x] : []);

/** Description complète de l'appareil, console portable reconnue ou non. */
async function info({ simulate, force } = {}) {
  const d = SIMULATED[simulate] ? { ...SIMULATED[simulate], simulated: true } : await raw(force);
  if (!d) return { ok: false };
  const apps = arr(d.apps);
  const label = `${d.manufacturer} | ${d.model} | ${d.family}`;
  const known = HANDHELDS.find(h => h.match.test(label));
  const chassis = arr(d.chassis).map(Number);
  const screens = arr(d.screens);
  const diag = screens.length ? Math.sqrt(screens[0].widthCm ** 2 + screens[0].heightCm ** 2) / 2.54 : null;
  // Sans modèle connu : châssis portable/tablette + batterie + petit écran intégré
  const generic = !known && !!d.battery && chassis.some(c => [8, 11, 30, 31, 32].includes(c)) && diag && diag < 10;
  const findApp = re => (re ? apps.find(a => re.test(a.name)) || null : null);
  const handheld = known || generic ? {
    id: known ? known.id : 'generic', name: known ? known.name : 'Console portable', maker: known ? known.maker : d.manufacturer,
    tool: known ? { name: known.toolName, app: findApp(known.tool) } : null, support: known ? known.support : null,
  } : null;
  const gpus = arr(d.gpus).map(g => {
    const v = GPU_VENDORS[g.vendor] || null;
    const ageDays = g.date ? Math.round((Date.now() - Date.parse(g.date)) / 864e5) : null;
    return { ...g, maker: v ? v.name : null, tool: v ? { name: v.toolName, app: findApp(v.tool) } : null, page: v ? v.page : null, ageDays };
  });
  return {
    ok: true, simulated: !!d.simulated, handheld,
    manufacturer: d.manufacturer, model: d.model, family: d.family, cpu: d.cpu, memoryGb: d.memoryGb, bios: d.bios || null,
    battery: d.battery || null, screenInches: diag ? Math.round(diag * 10) / 10 : null, internalScreen: !!d.internalScreen,
    modernStandby: !!d.modernStandby, s3: !!d.s3, gpus, apps,
  };
}

/** Cibles que l'interface a le droit de faire ouvrir (logiciels détectés, pages officielles). */
async function allowedTargets(simulate) {
  const i = await info({ simulate });
  const t = new Set();
  if (!i.ok) return t;
  for (const a of i.apps) t.add(a.target);
  if (i.handheld && i.handheld.support) t.add(i.handheld.support);
  for (const g of i.gpus) if (g.page) t.add(g.page);
  for (const h of HANDHELDS) t.add(h.support);
  return t;
}

// ---------------------------------------------------------------- pilotes (Windows Update)
function drivers(dataDir) {
  const file = path.join(dataDir, 'drivers.json');
  const installFile = path.join(dataDir, 'drivers-install.json');
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
  let searching = null, installing = null;
  return {
    status() {
      const last = read(file);
      const inst = read(installFile);
      return { searching: !!searching, installing: !!installing, last, install: inst };
    },
    search() {
      if (searching) return searching;
      searching = runPs('drivers.ps1', ['-Search', '-Out', file], 5 * 60e3).finally(() => { searching = null; });
      return searching;
    },
    /** Installation : PowerShell élevé (Windows demande l'accord de l'administrateur). */
    install(ids) {
      if (installing) return false;
      try { fs.rmSync(installFile, { force: true }); } catch { /* rien */ }
      const script = path.join(HOST, 'drivers.ps1');
      const inner = `-NoProfile -ExecutionPolicy Bypass -File "${script}" -Install -Ids "${ids.join(',')}" -Out "${installFile}"`;
      const p = spawn('powershell.exe', ['-NoProfile', '-Command',
        `$p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ArgumentList '${inner.replace(/'/g, "''")}'; exit $p.ExitCode`], { windowsHide: true });
      installing = new Promise(r => p.on('close', r)).finally(() => { installing = null; });
      return true;
    },
  };
}

module.exports = { info, allowedTargets, drivers, HANDHELDS, SIMULATED };
