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

// Langue de KaneMode → traduction du moteur (fichiers qml_<langue> de KanePlay)
const ENGINE_LANG = { fr: 'fr', en: 'en', es: 'es', de: 'de', it: 'it', pt: 'pt_BR', ja: 'ja', zh: 'zh_CN' };

/** Environnement du mode intégré : icône, identité, couleur d'accent et langue de KaneMode, commande à exécuter. */
function env(command, { icon, accent, lang } = {}) {
  const e = { KANEPLAY_EMBEDDED: '1', KANEMODE_COMMAND: command };
  if (icon && isFile(icon)) e.KANEMODE_ICON = icon;
  if (/^#[0-9a-f]{6}$/i.test(accent || '')) e.KANEMODE_ACCENT = accent;
  if (ENGINE_LANG[lang]) e.KANEMODE_LANG = ENGINE_LANG[lang];
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

/**
 * Entrée de bibliothèque : le streaming local (moteur KanePlay intégré), avec sa jaquette. Les jeux
 * des PC se choisissent dans le moteur (bibliothèque de chaque PC, reprise d'une session en pause).
 * Nom en français, traduit par l'interface (core.js, lib.load).
 */
function entry(exe, art, opts) {
  if (!exe) return null;
  return {
    id: 'kaneplay', source: 'kaneplay', name: 'Streaming local', type: 'app', installed: true,
    launch: { kind: 'exe', target: exe, args: '', env: env('show', opts) },
    art: art && isFile(art) ? { portrait: art, hero: art } : {},
  };
}
module.exports = { findExe, env, hosts, entry };
