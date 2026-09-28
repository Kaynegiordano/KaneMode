// Streaming intégré à KaneMode. C'est l'application KanePlay (dérivée de Moonlight) au complet,
// lancée en « mode intégré » : plein écran, logo et identité de KaneMode, sans intro, B ramène à
// KaneMode. Elle vient du sous-module engine/KanePlay (engine/build-engine.ps1) et est embarquée
// dans le paquet. Une seule instance tourne : chaque lancement lui transmet une commande
// (KANEMODE_COMMAND) : « show » ou « stream <PC> <appli> ».
// Ses réglages sont propres à KaneMode (HKCU\Software\KaneMode\Streaming) ; KaneMode n'en lit
// que les PC et leurs applis (jamais la clé privée du client), pour sa bibliothèque.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const REG = 'HKCU\\Software\\KaneMode\\Streaming';
const CACHE = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'KaneMode', 'Streaming', 'cache');

const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

function reg(args) {
  return new Promise(resolve => execFile('reg.exe', args, { windowsHide: true, maxBuffer: 4 << 20 }, (err, out) => resolve(err ? '' : String(out))));
}

/** Moteur : celui du paquet installé, sinon celui compilé en développement (engine\out). */
function findExe(bundled, dev) {
  for (const c of [bundled, dev]) if (c && isFile(c)) return c;
  return null;
}

/** Environnement du mode intégré : icône et identité de KaneMode, commande à exécuter. */
function env(command, icon) {
  const e = { KANEPLAY_EMBEDDED: '1', KANEMODE_COMMAND: command };
  if (icon && isFile(icon)) e.KANEMODE_ICON = icon;
  if (process.env.KANEMODE_AUMID) e.KANEMODE_AUMID = process.env.KANEMODE_AUMID;
  return e;
}

/** PC appairés dans le streaming et leurs applications (registre, format QSettings). */
async function hosts() {
  const out = await reg(['query', REG + '\\hosts', '/s']);
  const byKey = {};
  let cur = null, last = null;
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) { cur = byKey[line.trim()] = {}; last = null; continue; }
    const m = line.match(/^\s{4}(\S+)\s{4}REG_(?:SZ|DWORD|EXPAND_SZ)\s{4}(.*)$/);
    if (m && cur) { last = m[1]; cur[last] = m[2].startsWith('0x') ? parseInt(m[2], 16) : m[2]; }
    else if (cur && last && line) cur[last] += '\n' + line; // valeur sur plusieurs lignes (certificat)
  }
  const list = [];
  for (const [key, v] of Object.entries(byKey)) {
    const h = key.match(/\\hosts\\(\d+)$/i);
    if (!h || !v.uuid) continue;
    const apps = [];
    for (const [k2, a] of Object.entries(byKey)) {
      if (!k2.toLowerCase().startsWith(key.toLowerCase() + '\\apps\\') || !a.name) continue;
      apps.push({ id: +a.id, name: a.name, hidden: a.hidden === 'true' });
    }
    // Appairé = certificat du serveur enregistré
    const cert = String(v.srvcert || '').match(/BEGIN CERTIFICATE-----([\s\S]*?)-----END/);
    list.push({ uuid: v.uuid, name: v.hostname || v.uuid, paired: !!(cert && cert[1].trim()), apps: apps.sort((a, b) => a.name.localeCompare(b.name)) });
  }
  return list;
}

const boxart = (uuid, appId) => path.join(CACHE, 'boxart', uuid, appId + '.png');

/** Entrées de bibliothèque : une par application de chaque PC appairé, lancée dans le streaming. */
function entries(exe, list, icon) {
  if (!exe) return [];
  const out = [];
  for (const h of list) {
    if (!h.paired) continue;
    for (const a of h.apps) {
      if (a.hidden) continue;
      const art = boxart(h.uuid, a.id);
      out.push({
        id: `kaneplay:${h.uuid}:${a.id}`, source: 'kaneplay', name: a.name, streamHost: h.name, hostUuid: h.uuid,
        type: /^(desktop|bureau)$/i.test(a.name) ? 'app' : 'game', installed: true,
        launch: { kind: 'exe', target: exe, args: '', env: env(`stream\t${h.uuid}\t${a.id}\t${a.name}`, icon) },
        art: isFile(art) ? { portrait: art } : {},
      });
    }
  }
  return out;
}

module.exports = { findExe, env, hosts, entries };
