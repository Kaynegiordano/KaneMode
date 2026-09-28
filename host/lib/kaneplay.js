// Streaming intégré à KaneMode, avec KanePlay (client dérivé de Moonlight) comme moteur invisible :
// KaneMode affiche les PC hôtes, l'appairage, les applications et la qualité ; KanePlay ne sert
// qu'à la session de streaming elle-même, lancée en ligne de commande.
// Seul le sous-arbre « hosts » des réglages est lu (jamais la clé privée du client).
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');

const REG = 'HKCU\\Software\\KanePlay\\KanePlay';
const RELEASES = 'https://github.com/Kaynegiordano/KanePlay/releases/latest';
// Mode intégré (KanePlay 1.0.9+) : ni intro, ni fenêtre pour l'appairage et l'arrêt,
// écran noir au démarrage d'un stream. Les versions plus anciennes ignorent ces variables.
const ENV = { KANEPLAY_EMBEDDED: '1', KANEPLAY_NO_INTRO: '1' };

const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

function reg(args) {
  return new Promise(resolve => execFile('reg.exe', args, { windowsHide: true, maxBuffer: 4 << 20 }, (err, out) => resolve(err ? '' : String(out))));
}

/** Chemin de KanePlay.exe : choix de l'utilisateur, copie embarquée dans KaneMode, installation. */
async function findExe(configured, bundled) {
  const candidates = [
    configured, bundled,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'KanePlay', 'KanePlay.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'KanePlay', 'KanePlay.exe'),
  ];
  for (const c of candidates) if (c && isFile(c)) return c;
  for (const root of ['HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall']) {
    const out = await reg(['query', root, '/s', '/f', 'KanePlay', '/d']);
    const m = out.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
    if (m && isFile(path.join(m[1].trim(), 'KanePlay.exe'))) return path.join(m[1].trim(), 'KanePlay.exe');
  }
  return null;
}

/** PC hôtes connus et leurs applications, lus dans le registre (format QSettings). */
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
      apps.push({ id: +a.id, name: a.name, hidden: a.hidden === 'true', hdr: a.hdr === 'true' });
    }
    // Appairé = certificat du serveur enregistré (vide tant que l'appairage n'a pas abouti)
    const cert = String(v.srvcert || '').match(/BEGIN CERTIFICATE-----([\s\S]*?)-----END/);
    list.push({
      uuid: v.uuid, name: v.hostname || v.uuid, paired: !!(cert && cert[1].trim()),
      addresses: [v.manualaddress, v.localaddress, v.remoteaddress, v.ipv6address].filter(x => x && x !== '0.0.0.0'),
      apps: apps.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return list;
}

const boxart = (uuid, appId) => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'KanePlay', 'KanePlay', 'cache', 'boxart', uuid, appId + '.png');

/** Entrées de bibliothèque : une par application de chaque PC appairé. */
async function entries(exe, list) {
  if (!exe) return [];
  const out = [];
  for (const h of list || await hosts()) {
    if (!h.paired) continue;
    for (const a of h.apps) {
      if (a.hidden) continue;
      const art = boxart(h.uuid, a.id);
      out.push({
        id: `kaneplay:${h.uuid}:${a.id}`, source: 'kaneplay', name: a.name, streamHost: h.name, hostUuid: h.uuid,
        type: /^(desktop|bureau)$/i.test(a.name) ? 'app' : 'game', installed: true,
        launch: { kind: 'exe', target: exe, args: `stream "${h.uuid}" "${a.name.replace(/"/g, '')}"`, env: ENV },
        art: isFile(art) ? { portrait: art } : {},
      });
    }
  }
  return out;
}

/** Le PC hôte répond-il ? (page publique /serverinfo de Sunshine, Apollo, GeForce Experience) */
async function online(h) {
  const tries = h.addresses.map(addr => {
    const host = addr.includes(':') && !addr.startsWith('[') ? `[${addr}]` : addr;
    return fetch(`http://${host}:47989/serverinfo?uniqueid=0123456789ABCDEF`, { signal: AbortSignal.timeout(1500) })
      .then(r => (r.ok ? addr : Promise.reject(new Error('hors ligne'))));
  });
  if (!tries.length) return null;
  try { return await Promise.any(tries); } catch { return null; }
}

// ---------------------------------------------------------------- qualité du stream
const DEFAULTS = { resolution: 'auto', fps: 'auto', bitrate: 0, hdr: false, overlay: false, audioOnHost: false, quitAfter: false, codec: 'auto' };
const prefs = p => ({ ...DEFAULTS, ...(p || {}) });

/** Options de la ligne de commande « stream » d'après les réglages de KaneMode. */
function streamFlags(p) {
  p = prefs(p);
  const f = [];
  if (p.resolution === 'auto') f.push('--auto-resolution');
  else if (['720', '1080', '1440', '4K'].includes(p.resolution)) f.push('--' + p.resolution);
  if (p.fps === 'auto') f.push('--auto-fps');
  else if (+p.fps) f.push('--fps', String(+p.fps));
  if (+p.bitrate) f.push('--bitrate', String(+p.bitrate));
  f.push(p.hdr ? '--hdr' : '--no-hdr');
  f.push(p.overlay ? '--performance-overlay' : '--no-performance-overlay');
  f.push(p.audioOnHost ? '--audio-on-host' : '--no-audio-on-host');
  f.push(p.quitAfter ? '--quit-after' : '--no-quit-after');
  const codec = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1' }[p.codec];
  if (codec) f.push('--video-codec', codec);
  return f;
}

// ---------------------------------------------------------------- commandes du moteur
function cli(exe, args, timeout = 120000) {
  return new Promise(resolve => {
    const p = spawn(exe, args, { env: { ...process.env, ...ENV }, windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    const t = setTimeout(() => { p.kill(); err += '\nDélai dépassé'; }, timeout);
    p.on('close', code => { clearTimeout(t); resolve({ code, out, err: err.trim() }); });
    p.on('error', e => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
  });
}
// Messages du moteur (en anglais) traduits pour l'interface
function explain(err) {
  const e = String(err || '').split(/\r?\n/).filter(l => l.trim() && !/^(qml|Qt|QQml)/i.test(l)).pop() || '';
  if (/incorrect pin|wrong pin|pin/i.test(e)) return 'Code refusé par le PC hôte';
  if (/already paired/i.test(e)) return 'Ce PC est déjà appairé';
  if (/failed to connect|unable to connect|timed? ?out|Délai/i.test(e)) return 'PC injoignable : allumé, sur le même réseau, Sunshine lancé ?';
  if (/not been paired/i.test(e)) return 'Ce PC n’est pas appairé';
  return e || 'Échec';
}

/** Appairage : le code PIN est saisi sur le PC hôte (Sunshine : page Web → PIN). */
async function pair(exe, host, pin) {
  const r = await cli(exe, ['pair', host, '--pin', pin], 3 * 60e3);
  return r.code === 0 && !/fail|error/i.test(r.err) ? { ok: true } : { ok: false, error: explain(r.err) };
}
/** Ferme le jeu en cours sur le PC hôte. */
async function quit(exe, host) {
  const r = await cli(exe, ['quit', host], 60e3);
  return r.code === 0 ? { ok: true } : { ok: false, error: explain(r.err) };
}
/** Relit la liste des applications sur le PC hôte (le moteur met son cache à jour). */
async function refreshApps(exe, host) {
  const r = await cli(exe, ['list', host, '--csv'], 60e3);
  return r.code === 0 && /Name, ID/.test(r.out) ? { ok: true } : { ok: false, error: explain(r.err) };
}

module.exports = { findExe, hosts, entries, online, streamFlags, prefs, pair, quit, refreshApps, ENV, RELEASES, DEFAULTS };
