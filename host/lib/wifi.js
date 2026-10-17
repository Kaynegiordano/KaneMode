// Wi-Fi (panneau Réseau de la barre d'état) : réseaux visibles, connexion, déconnexion, par netsh.
// Hors du service syscontrol.ps1 : une connexion attend jusqu'à 15 s et ne doit pas retarder les
// réglages d'énergie. netsh répond dans la langue de Windows : seuls les noms de champs stables
// (SSID, Signal, BSSID) et la mise en forme servent à la lecture ; la sortie est forcée en UTF-8.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function netsh(args, timeout = 12000) {
  return new Promise(resolve => {
    // chcp 65001 : noms de réseaux accentués lisibles (sinon page de code OEM)
    // Ligne de commande passée telle quelle : les noms entre guillemets ne sont pas réécrits par Node
    execFile('cmd.exe', [`/d /s /c "chcp 65001 >nul & netsh ${args}"`], { windowsHide: true, windowsVerbatimArguments: true, timeout, encoding: 'utf8', maxBuffer: 4 << 20 },
      (err, out) => resolve({ code: err ? (err.code ?? 1) : 0, out: String(out || '') }));
  });
}
// Valeur après le premier « : » (en français, netsh met une espace insécable avant les deux-points)
const value = line => { const m = /^[^:]*:(.*)$/.exec(line); return m ? m[1].trim() : ''; };
// Nom de réseau ou chemin entre guillemets : guillemets, % et caractères de contrôle retirés (cmd)
const quote = s => '"' + String(s).replace(/["%\x00-\x1f]/g, '') + '"';

/** Authentification lue par netsh → type de profil Windows (null : réseau d'entreprise, non géré). */
function authOf(text) {
  const a = String(text || '').toUpperCase();
  if (/ENTREPRISE|ENTERPRISE|802\.1X/.test(a)) return null;
  if (/WPA3/.test(a)) return 'WPA3SAE';
  if (/WPA2/.test(a)) return 'WPA2PSK';
  if (/WPA/.test(a)) return 'WPAPSK';
  return 'open';
}

function parseInterfaces(out) {
  const lines = out.split(/\r?\n/);
  let adapter = false, ssid = null, signal = null, connected = false, name = null;
  for (const l of lines) {
    const t = l.trim();
    if (/^GUID\s/.test(t)) adapter = true;
    if (/^SSID\s+:/.test(t)) ssid = value(l);
    else if (/^Signal\s+:/.test(t)) signal = parseInt(value(l), 10);
    else if (/^(Nom|Name)\s+:/.test(t) && !name) name = value(l);
    // État / State : « connecté » / « connected » (et non « déconnecté » / « disconnected »)
    else if (/^(État|Etat|State)\s+:/.test(t)) connected = /^(connecté|connected)$/i.test(value(l));
  }
  return { adapter, name, connected: connected && !!ssid, ssid: connected ? ssid : null, signal: connected && Number.isFinite(signal) ? signal : null };
}

function parseNetworks(out) {
  const list = [];
  let cur = null;
  for (const l of out.split(/\r?\n/)) {
    const t = l.trim();
    const m = /^SSID \d+\s*:\s?(.*)$/.exec(t);
    if (m) { cur = { ssid: m[1].trim(), signal: 0, auth: '' }; if (cur.ssid) list.push(cur); continue; }
    if (!cur) continue;
    if (/^Signal\s+:/.test(t)) cur.signal = Math.max(cur.signal, parseInt(value(l), 10) || 0);
    else if (/^Auth/i.test(t) && !cur.auth) cur.auth = value(l);
  }
  // Un même nom sur plusieurs bandes : le meilleur signal
  const best = new Map();
  for (const n of list) if (!best.has(n.ssid) || best.get(n.ssid).signal < n.signal) best.set(n.ssid, n);
  return [...best.values()];
}

// Profils enregistrés : lignes en retrait « <type de profil>   : <nom> » sous les titres soulignés
function parseProfiles(out) {
  return out.split(/\r?\n/).filter(l => /^\s{4}\S/.test(l) && /\s:/.test(l)).map(value).filter(Boolean);
}

async function scan() {
  const [ifs, nets, profs] = await Promise.all([netsh('wlan show interfaces'), netsh('wlan show networks mode=bssid'), netsh('wlan show profiles')]);
  const st = parseInterfaces(ifs.out);
  if (!st.adapter) return { adapter: false, networks: [] };
  const known = new Set(parseProfiles(profs.out));
  const networks = parseNetworks(nets.out).map(n => {
    const kind = authOf(n.auth);
    return { ssid: n.ssid, signal: n.signal, secure: kind !== 'open', enterprise: kind === null, known: known.has(n.ssid), connected: n.ssid === st.ssid };
  }).sort((a, b) => b.connected - a.connected || b.known - a.known || b.signal - a.signal);
  // Windows 11 24H2 : la liste des réseaux demande l'accès à la position (netsh renvoie une erreur
  // qui mène à ms-settings:privacy-location)
  const denied = !networks.length && /privacy-location|position|location/i.test(nets.out);
  return { adapter: true, name: st.name, ssid: st.ssid, signal: st.signal, networks, denied, radioOff: !networks.length && !denied && /off|désactiv/i.test(ifs.out) };
}

const xml = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
function profileXml(ssid, auth, password) {
  const hex = Buffer.from(ssid, 'utf8').toString('hex').toUpperCase();
  const enc = auth === 'open' ? 'none' : 'AES';
  const key = auth === 'open' ? '' : `<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${xml(password)}</keyMaterial></sharedKey>`;
  return `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${xml(ssid)}</name>
  <SSIDConfig><SSID><hex>${hex}</hex><name>${xml(ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>auto</connectionMode>
  <MSM><security><authEncryption><authentication>${auth}</authentication><encryption>${enc}</encryption><useOneX>false</useOneX></authEncryption>${key}</security></MSM>
</WLANProfile>`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(ssid, ms) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    await sleep(1000);
    const st = parseInterfaces((await netsh('wlan show interfaces')).out);
    if (st.connected && st.ssid === ssid) return true;
  }
  return false;
}

/** Connexion : profil enregistré, sinon profil créé avec le mot de passe (réseaux personnels). */
async function connect(ssid, password) {
  ssid = String(ssid || '');
  if (!ssid || ssid.length > 32 * 4 || /["%\x00-\x1f]/.test(ssid)) throw new Error('Nom de réseau non pris en charge');
  const { networks } = await scan();
  const net = networks.find(n => n.ssid === ssid);
  if (!net) throw new Error('Réseau introuvable : il n’est plus visible');
  if (net.enterprise) throw new Error('Réseau d’entreprise : connexion depuis les Paramètres Windows');
  let created = false;
  if (!net.known || password != null) {
    const nets = await netsh('wlan show networks mode=bssid');
    const auth = authOf((parseNetworks(nets.out).find(n => n.ssid === ssid) || {}).auth);
    if (auth !== 'open' && (typeof password !== 'string' || password.length < 8 || password.length > 63)) throw new Error('Mot de passe de 8 à 63 caractères');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-wifi-')), 'profil.xml');
    try {
      fs.writeFileSync(file, profileXml(ssid, auth, password || ''), 'utf8');
      const r = await netsh(`wlan add profile filename=${quote(file)} user=current`);
      if (r.code) throw new Error('Windows a refusé le profil Wi-Fi');
      created = true;
    } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } // le mot de passe ne reste pas sur le disque
  }
  await netsh(`wlan connect name=${quote(ssid)} ssid=${quote(ssid)}`);
  if (await waitFor(ssid, 15000)) return { ok: true, ssid };
  // Mauvais mot de passe : le profil créé est retiré, la prochaine tentative redemande le mot de passe
  if (created) await netsh(`wlan delete profile name=${quote(ssid)}`);
  throw new Error(created ? 'Connexion impossible : mot de passe incorrect ?' : 'Connexion impossible');
}

async function disconnect() { await netsh('wlan disconnect'); return { ok: true }; }
async function forget(ssid) {
  const r = await netsh(`wlan delete profile name=${quote(ssid)}`);
  if (r.code) throw new Error('Réseau non enregistré');
  return { ok: true };
}

module.exports = { scan, connect, disconnect, forget, parseInterfaces, parseNetworks, parseProfiles, authOf };
