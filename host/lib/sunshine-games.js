// Jeux de KaneMode proposés aux consoles qui streament ce PC (Ally, PC portable…), activé dans
// Paramètres → Streaming sur le PC qui diffuse. Chaque jeu installé de la bibliothèque devient une
// appli de Sunshine, avec sa jaquette (PNG, seul format que Sunshine envoie) :
//   commande « KaneMode.exe --stream-game <id> » (alias d'exécution du paquet, voir
//   native/KaneMode.App/StreamHelper.cs) : le KaneMode du PC lance le jeu comme depuis sa
//   bibliothèque, et la commande se termine avec le jeu (Sunshine arrête alors le streaming) ;
//   fin de session : « KaneMode.exe --stop-game <id> » ferme le jeu.
// La console choisit ensuite, parmi les applis du PC, celles qui deviennent des raccourcis.
// Sunshine garde ses applis dans Program Files et ne les relit qu'au redémarrage de son service :
// une autorisation d'administrateur, une seule fois (setup/sunshine-jeux/Autoriser.ps1), permet
// ensuite à KaneMode d'écrire ce fichier et de redémarrer le service, jamais pendant un streaming.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const MARK = '--stream-game';
const ALIAS = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'KaneMode.exe');
const SERVICE = 'SunshineService';

const run = (exe, args, timeout = 30000) => new Promise(resolve =>
  execFile(exe, args, { windowsHide: true, timeout, maxBuffer: 4 << 20 }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || (err && err.message) || '') })));

const readApps = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
const ours = a => typeof a.cmd === 'string' && a.cmd.includes(MARK);
const quote = s => `"${String(s).replace(/"/g, '')}"`;

/** Appli Sunshine d'un jeu (cover : PNG de sa jaquette, ou null). */
function appFor(id, name, cover) {
  const app = {
    name,
    cmd: `${quote(ALIAS)} ${MARK} ${quote(id)}`,
    'prep-cmd': [{ do: '', undo: `${quote(ALIAS)} --stop-game ${quote(id)}`, elevated: false }],
    // Le lanceur reste ouvert pendant toute la partie : sa fin est celle du jeu
    'auto-detach': false,
    'wait-all': false,
    'exit-timeout': 5,
    'kanemode-id': id,
  };
  if (cover) app['image-path'] = cover;
  return app;
}

/**
 * Applis de Sunshine : celles de l'utilisateur gardées, les jeux de KaneMode remplacés par `games`
 * ([{ id, name, cover }]). Noms en double (même jeu sur deux boutiques) : la boutique entre parenthèses.
 */
function merge(doc, games) {
  const others = (doc.apps || []).filter(a => !ours(a));
  const taken = new Set(others.map(a => a.name));
  const apps = [];
  for (const g of games) {
    let name = String(g.name || g.id).trim().slice(0, 120);
    if (taken.has(name)) name = `${name} (${g.source || g.id.split(':')[0]})`;
    for (let n = 2; taken.has(name); n++) name = `${String(g.name).trim()} (${n})`;
    taken.add(name);
    apps.push(appFor(g.id, name, g.cover || null));
  }
  return { ...doc, apps: [...others, ...apps] };
}

/** Streaming en cours : dernière connexion d'un client sans déconnexion après (journal de Sunshine). */
function streamActive(logFile) {
  let text = '';
  try {
    const st = fs.statSync(logFile);
    const fd = fs.openSync(logFile, 'r');
    const len = Math.min(st.size, 512 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch { return false; }
  return text.lastIndexOf('CLIENT CONNECTED') > text.lastIndexOf('CLIENT DISCONNECTED');
}

function create({ appsFile, root, coversDir, runPs, log = console.log }) {
  const configDir = () => path.dirname(appsFile());
  let sid = null;
  let last = { at: 0, sig: null, error: null, count: 0, pending: false };

  async function userSid() {
    if (sid) return sid;
    const r = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh']);
    const m = /"(S-1-5-[\d-]+)"/.exec(r.out);
    sid = m ? m[1] : null;
    return sid;
  }

  // Écriture autorisée (droits du fichier, que fs.access ne vérifie pas sous Windows)
  function writable() {
    try { fs.closeSync(fs.openSync(appsFile(), 'r+')); return true; } catch { return false; }
  }
  async function restartable() {
    const s = await userSid();
    if (!s) return false;
    const r = await run('sc.exe', ['sdshow', SERVICE]);
    const ace = new RegExp(`\\(A;;([A-Z]*);;;${s}\\)`).exec(r.out.replace(/\s+/g, ''));
    return !!ace && /RP/.test(ace[1]) && /WP/.test(ace[1]);
  }

  async function status() {
    const file = appsFile();
    if (!fs.existsSync(file)) return { sunshine: false };
    let published = 0;
    try { published = (readApps(file).apps || []).filter(ours).length; } catch { /* fichier abîmé */ }
    return {
      sunshine: true, packaged: fs.existsSync(ALIAS), allowed: writable() && await restartable(),
      published, lastSync: last.at || null, error: last.error, pending: last.pending,
      bundled: fs.existsSync(path.join(root, 'setup', 'sunshine-jeux', 'Autoriser.ps1')),
    };
  }

  /** Autorisation d'administrateur (une fois) : écrire les applis de Sunshine et redémarrer son service. */
  async function allow() {
    const script = path.join(root, 'setup', 'sunshine-jeux', 'Autoriser.ps1');
    if (!fs.existsSync(script)) throw new Error('Autorisation absente de cette version de KaneMode');
    const s = await userSid();
    if (!s) throw new Error('Compte Windows introuvable');
    const q = v => `'${String(v).replace(/'/g, "''")}'`;
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `"${script}"`, '-Sid', s, '-Applis', `"${appsFile()}"`];
    const cmd = `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ${args.map(q).join(',')}; exit $p.ExitCode`;
    const r = await run('powershell.exe', ['-NoProfile', '-Command', cmd], 180000);
    if (!r.ok) throw new Error(/annul|cancel/i.test(r.err) ? 'Autorisation annulée' : 'L’autorisation a échoué');
    return status();
  }

  async function restartService() {
    await run('sc.exe', ['stop', SERVICE]);
    for (let i = 0; i < 40; i++) {
      const q = await run('sc.exe', ['query', SERVICE]);
      if (/STOPPED/.test(q.out)) break;
      await new Promise(r => setTimeout(r, 500));
    }
    const r = await run('sc.exe', ['start', SERVICE]);
    if (!r.ok && !/1056/.test(r.out + r.err)) throw new Error('Redémarrage de Sunshine impossible');
  }

  /**
   * Jaquettes en PNG (Sunshine n'en accepte pas d'autre), recalculées seulement quand l'image
   * change. items : [{ id, art }] → Map id → PNG.
   */
  async function covers(items) {
    fs.mkdirSync(coversDir, { recursive: true });
    const out = new Map(), todo = [];
    for (const it of items) {
      if (!it.art) continue;
      let st;
      try { st = fs.statSync(it.art); } catch { continue; }
      const key = crypto.createHash('sha1').update(`${it.art}|${st.size}|${Math.floor(st.mtimeMs)}`).digest('hex').slice(0, 16);
      const dst = path.join(coversDir, `${it.id.replace(/[^\w.-]+/g, '_')}-${key}.png`);
      out.set(it.id, dst);
      if (!fs.existsSync(dst)) todo.push({ src: it.art, dst });
    }
    if (todo.length) {
      const list = path.join(coversDir, 'a-convertir.json');
      fs.writeFileSync(list, JSON.stringify(todo));
      await runPs('topng.ps1', ['-List', list]);
      try { fs.unlinkSync(list); } catch { /* déjà parti */ }
    }
    for (const [id, f] of out) if (!fs.existsSync(f)) out.delete(id);
    // Anciennes jaquettes (image changée, jeu retiré)
    const keep = new Set([...out.values()].map(f => path.basename(f)));
    try { for (const n of fs.readdirSync(coversDir)) if (n.endsWith('.png') && !keep.has(n)) fs.unlinkSync(path.join(coversDir, n)); } catch { /* dossier absent */ }
    return out;
  }

  /**
   * Met les applis de Sunshine à jour : games = [{ id, name, source, art }] (vide : jeux retirés).
   * Rien n'est écrit si la liste n'a pas changé ; pendant un streaming, la mise à jour attend.
   */
  async function sync(games) {
    const file = appsFile();
    try {
      if (!fs.existsSync(file) || !writable()) return { ok: false, skipped: 'not-allowed' };
      const pngs = await covers(games);
      const list = games.map(g => ({ ...g, cover: pngs.get(g.id) || null }));
      const doc = readApps(file);
      const next = merge(doc, list);
      const sig = JSON.stringify(next.apps.filter(ours));
      if (JSON.stringify((doc.apps || []).filter(ours)) === sig) {
        Object.assign(last, { at: Date.now(), error: null, count: list.length, pending: false });
        return { ok: true, changed: false };
      }
      if (streamActive(path.join(configDir(), 'sunshine.log'))) {
        last.pending = true;
        return { ok: true, changed: false, waiting: 'stream' };
      }
      fs.writeFileSync(file + '.avant-jeux-kanemode', JSON.stringify(doc, null, 2));
      fs.writeFileSync(file, JSON.stringify(next, null, 2));
      await restartService();
      Object.assign(last, { at: Date.now(), error: null, count: list.length, pending: false });
      log(`Sunshine : ${list.length} jeu(x) de KaneMode proposés aux consoles en streaming`);
      return { ok: true, changed: true };
    } catch (e) {
      last.error = e.message;
      log('Sunshine : mise à jour des jeux impossible : ' + e.message);
      return { ok: false, error: e.message };
    }
  }

  return { status, allow, sync, ours };
}

module.exports = { create, appFor, merge, streamActive, ALIAS, MARK };
