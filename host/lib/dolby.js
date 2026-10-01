// Dolby Access et son spatial Windows : lecture WinRT officielle, changement relu par sortie.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const STORE = 'ms-windows-store://pdp/?ProductId=9N0866FS04W8';
const MODES = ['off', 'headphones', 'homeTheater', 'speakers', 'sonic'];
const GUID = /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i;
const ZERO = '{00000000-0000-0000-0000-000000000000}';
const runFile = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout));
});
const toolPath = () => [path.join(ROOT, 'tools', 'soundvolumeview', 'SoundVolumeView.exe'),
  path.join(ROOT, 'native', 'KaneMode.Audio', 'obj', 'soundvolumeview', 'SoundVolumeView.exe')].find(file => fs.existsSync(file));
const normalizeGuid = value => String(value || ZERO).toLowerCase();
function modeOf(guid, formats) {
  const value = normalizeGuid(guid);
  return value === ZERO ? 'off' : Object.keys(formats || {}).find(key => normalizeGuid(formats[key]) === value) || 'other';
}
function publicState(raw, controllable) {
  const { appId, formats, ...state } = raw;
  return { ...state, license: null, controllable: !!raw.available && controllable,
    devices: (raw.devices || []).map(device => ({ ...device, selected: modeOf(device.selectedGuid, formats), active: modeOf(device.activeGuid, formats) })) };
}
function create(options = {}) {
  const readState = options.readState || (async () => JSON.parse((await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'host', 'dolby.ps1')])).replace(/^\uFEFF/, '')));
  const hasTool = options.hasTool || (() => !!toolPath());
  const applyFormat = options.applyFormat || ((id, guid) => {
    const tool = toolPath();
    if (!tool) throw new Error('Commande de son spatial indisponible');
    return runFile(tool, ['/SetSpatial', id, guid]);
  });
  const launch = options.launch || (() => { throw new Error('Ouverture indisponible'); });
  const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let cache = null, pending = null, tail = Promise.resolve();
  async function rawState(force = false) {
    if (pending) return pending;
    if (!force && cache && Date.now() - cache.time < 3000) return cache.value;
    pending = readState().then(value => { cache = { time: Date.now(), value }; return value; }).finally(() => { pending = null; });
    return pending;
  }
  async function state(force = false) {
    try { return publicState(await rawState(force), hasTool()); }
    catch { cache = null; return { available: false, installed: false, license: null, controllable: false, devices: [], reason: 'Son spatial Windows indisponible' }; }
  }
  function set(deviceId, mode) {
    const operation = tail.then(async () => {
      if (!MODES.includes(mode)) throw new Error('Format spatial inconnu');
      const before = await rawState(true);
      const device = (before.devices || []).find(d => d.id === deviceId);
      if (!before.available || !device) throw new Error('Sortie audio indisponible');
      if (!hasTool()) throw new Error('Commande de son spatial indisponible');
      if (!(device.supported || []).includes(mode)) throw new Error('Ce format spatial est indisponible sur cette sortie');
      const requested = mode === 'off' ? '' : before.formats?.[mode];
      if (mode !== 'off' && !GUID.test(requested || '')) throw new Error('Format spatial inconnu');
      if (modeOf(device.selectedGuid, before.formats) === mode) return { ...publicState(before, true), verified: true };
      try {
        await applyFormat(device.id, requested);
        for (let attempt = 0; attempt < 3; attempt++) {
          await delay(attempt ? 400 : 150);
          const after = await rawState(true);
          const changed = (after.devices || []).find(d => d.id === device.id);
          if (changed && normalizeGuid(changed.selectedGuid) === normalizeGuid(requested)) return { ...publicState(after, true), verified: true };
        }
        throw new Error('Windows n’a pas appliqué ce format. Vérifiez la licence et la configuration dans Dolby Access.');
      } catch (error) {
        // Ne pas laisser une tentative refusée remplacer un autre format déjà choisi.
        try { await applyFormat(device.id, normalizeGuid(device.selectedGuid) === ZERO ? '' : device.selectedGuid); } catch {}
        cache = null;
        throw error;
      }
    });
    tail = operation.catch(() => {});
    return operation;
  }
  async function open(action) {
    if (!['app', 'license', 'store', 'sound'].includes(action)) throw new Error('Action Dolby inconnue');
    if (action === 'sound') return launch({ kind: 'uri', target: 'ms-settings:sound' });
    if (action === 'store') return launch({ kind: 'uri', target: STORE });
    const raw = await rawState(true);
    const appId = raw.installed && /^DolbyLaboratories\.DolbyAccess_[a-z0-9]{13}![a-z0-9._-]+$/i.test(raw.appId || '') ? raw.appId : null;
    // L'achat et la restauration de licence se font dans l'application officielle.
    return launch({ kind: 'uri', target: appId ? 'shell:AppsFolder\\' + appId : STORE });
  }
  return { state, set, open };
}
module.exports = { create, modeOf, publicState, STORE };
