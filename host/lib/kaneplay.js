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
const ENGINE_LANG = { fr: 'fr', en: 'en' };

/** Environnement du mode intégré : icône, identité, couleur d'accent, coins et langue de KaneMode, commande à exécuter. */
function env(command, { icon, accent, corners, lang, sounds, soundTheme, soundVolume, soundMoves } = {}) {
  const e = { KANEPLAY_EMBEDDED: '1', KANEMODE_COMMAND: command };
  if (icon && isFile(icon)) e.KANEMODE_ICON = icon;
  if (/^#[0-9a-f]{6}$/i.test(accent || '')) e.KANEMODE_ACCENT = accent;
  if (['square', 'soft', 'round'].includes(corners)) e.KANEMODE_CORNERS = corners;
  if (ENGINE_LANG[lang]) e.KANEMODE_LANG = ENGINE_LANG[lang];
  if (typeof sounds === 'boolean') e.KANEMODE_SOUNDS = sounds ? '1' : '0';
  if (typeof soundMoves === 'boolean') e.KANEMODE_SOUND_MOVES = soundMoves ? '1' : '0';
  if (['round', 'retro', 'soft'].includes(soundTheme)) e.KANEMODE_SOUND_THEME = soundTheme;
  if (Number.isFinite(soundVolume)) e.KANEMODE_SOUND_VOLUME = String(Math.max(0, Math.min(100, soundVolume)));
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
 * Entrée de bibliothèque : le streaming (moteur KanePlay intégré), avec sa jaquette. Les jeux
 * des PC se choisissent dans le moteur (bibliothèque de chaque PC, reprise d'une session en pause).
 * Nom en français, traduit par l'interface (core.js, lib.load).
 */
function entry(exe, art, opts) {
  if (!exe) return null;
  return {
    id: 'kaneplay', source: 'kaneplay', name: 'Streaming', type: 'app', installed: true,
    launch: { kind: 'exe', target: exe, args: '', env: env('show', opts) },
    art: art && isFile(art) ? { portrait: art, hero: art } : {},
  };
}
/** Jaquette d'une appli d'un PC, téléchargée par le moteur (cache des jaquettes), ou null. */
function boxArt(uuid, appId) {
  const f = path.join(CACHE, 'boxart', String(uuid), `${+appId}.png`);
  try { return fs.statSync(f).size > 0 ? f : null; } catch { return null; }
}

/**
 * Dernier jeu streamé, écrit par le moteur à la fin de chaque session d'au moins 10 secondes
 * (streamhealth.cpp, « last-session.json » de son cache), ou null. Les variantes d'échelle du
 * bureau ne comptent pas : le moteur les choisit seul.
 */
function lastSession(file = path.join(CACHE, 'last-session.json')) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!j || typeof j.host !== 'string' || !j.host || !Number.isInteger(j.appId) || typeof j.appName !== 'string' || !j.appName) return null;
    if (isScaleVariant(j.appName)) return null;
    const recent = (Array.isArray(j.recent) ? j.recent : [])
      .filter(r => r && typeof r.host === 'string' && r.host && Number.isInteger(r.appId))
      .map(r => ({ host: r.host, app: r.appId, endedAt: +r.endedAt || 0, seconds: +r.durationSecs || 0 }));
    return { host: j.host, app: j.appId, name: j.appName, endedAt: +j.endedAt || 0, seconds: +j.durationSecs || 0,
      issues: Array.isArray(j.issues) ? j.issues.map(String) : [], recent };
  } catch { return null; }
}

/**
 * Sessions streamées terminées après « since » (ms), pour compter leur temps de jeu : le moteur
 * garde les 20 dernières, car plusieurs jeux peuvent se suivre avant le retour sur KaneMode.
 * Le temps est rangé sous l'identifiant du raccourci du jeu (« stream:<PC>:<appli> »).
 */
function sessionsSince(last, since) {
  if (!last) return [];
  const list = last.recent && last.recent.length ? last.recent : [{ host: last.host, app: last.app, endedAt: last.endedAt, seconds: last.seconds }];
  return list.filter(s => s.endedAt > (since || 0) && s.seconds > 0)
    .map(s => ({ id: `stream:${s.host}:${s.app}`, minutes: s.seconds / 60, endedAt: s.endedAt }));
}

/**
 * Ce que l'accueil propose de reprendre après un streaming : le raccourci du jeu s'il en a un
 * (sa date de dernière partie suit la session), sinon le jeu lui-même, hors bibliothèque.
 * Rien si son PC n'est plus appairé. played : en secondes, comme les autres dates de partie.
 */
function resumeFor(last, shortcuts, hosts) {
  if (!last || !last.endedAt || !hosts.some(h => h.uuid === last.host && h.paired)) return null;
  const played = Math.floor(last.endedAt / 1000);
  const sc = (shortcuts || []).find(s => s.host === last.host && +s.app === last.app);
  return sc ? { shortcut: `stream:${sc.host}:${sc.app}`, played } : { host: last.host, app: last.app, name: last.name, played };
}

// Variantes d'échelle du complément PC hôte (« Desktop [150 %] ») : le moteur les choisit seul
const isScaleVariant = name => /^(.+) \[(\d{3}) %\]$/.test(String(name));

module.exports = { findExe, env, hosts, entry, boxArt, isScaleVariant, lastSession, resumeFor, sessionsSince };
