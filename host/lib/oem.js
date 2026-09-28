// Mises à jour officielles du constructeur de la console : BIOS et pilotes publiés pour ce modèle
// précis. ASUS (ROG Ally, ROG Ally X, ROG Xbox Ally) : API publique du site d'assistance ROG,
// celle qu'utilisent Armoury Crate et G-Helper. Les versions installées viennent de Windows
// (BIOS, pilotes des périphériques présents) : KaneMode signale ce qui est plus récent et ouvre le
// téléchargement officiel, il n'installe rien lui-même (un BIOS se flashe avec l'outil d'ASUS).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ASUS_API = 'https://rog.asus.com/support/webapi/product';
// Outils qu'on ne propose pas : KaneMode les remplace ou ils n'ont rien à voir avec la console
const ASUS_SKIP = /armou?ry crate|myasus|aura|virtual pet|virtual assistant|smart display control/i;

function inventory() {
  return new Promise(resolve => {
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'inventory.ps1')], { windowsHide: true });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    const t = setTimeout(() => p.kill(), 30000);
    p.on('close', () => { clearTimeout(t); try { resolve(JSON.parse(out) || []); } catch { resolve([]); } });
    p.on('error', () => { clearTimeout(t); resolve([]); });
  });
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KaneMode', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`ASUS : HTTP ${r.status}`);
  return r.json();
}

/** Fichiers publiés par ASUS pour ce modèle (BIOS ou pilotes Windows 11), le plus récent de chaque titre. */
async function asusFiles(kind, model) {
  const url = `${ASUS_API}/${kind === 'bios' ? 'GetPDBIOS' : 'GetPDDrivers'}?website=global&model=${encodeURIComponent(model)}&cpu=${encodeURIComponent(model)}${kind === 'bios' ? '' : '&osid=52'}&systemCode=rog`;
  let j = await getJson(url);
  // L'API renvoie parfois une liste vide : un paramètre en plus contourne son cache
  if (!j.Result || !j.Result.Obj || !j.Result.Obj.length) j = await getJson(url + '&tag=' + (10 + Math.floor(Math.random() * 90)));
  const groups = (j.Result && j.Result.Obj) || [];
  const files = [];
  for (const g of groups) {
    const seen = new Set();
    for (const f of g.Files || []) {
      const title = String(f.Title || '').trim();
      if (!title || seen.has(title) || ASUS_SKIP.test(title)) continue;
      seen.add(title);
      const url = f.DownloadUrl && (f.DownloadUrl.Global || f.DownloadUrl.China);
      files.push({
        category: String(g.Name || ''), title, version: String(f.Version || '').replace(/^V/i, ''),
        date: String(f.ReleaseDate || '').replace(/\//g, '-') || null, size: String(f.FileSize || ''),
        url: typeof url === 'string' && /^https:\/\/[^/]+\.asus\.com(\.cn)?\//i.test(url) ? url : null,
        hardware: (f.HardwareInfoList || []).map(h => String(h.hardwareid || '').replace(/&REV_.*$/i, '')).filter(Boolean),
      });
    }
  }
  return files;
}

const parts = v => String(v || '').split(/[^0-9]+/).filter(Boolean).map(Number);
function compare(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Version installée d'un pilote ASUS : celle des périphériques présents qui correspondent à ses identifiants. */
function installedVersion(file, inv) {
  if (!file.hardware.length) return null;
  const ids = file.hardware.map(h => h.toUpperCase());
  const found = inv.filter(d => ids.some(id => d.ids.some(x => x.startsWith(id)))).map(d => d.version).filter(Boolean);
  if (!found.length) return null;
  // Même version majeure que celle publiée si possible (certains paquets regroupent plusieurs pilotes)
  const major = parts(file.version)[0];
  const same = found.filter(v => parts(v)[0] === major);
  return (same.length ? same : found).sort(compare).pop();
}

/** Code du modèle ASUS (RC71L, RC72LA…) : début de la version du BIOS, sinon dans le nom du modèle. */
function asusModel(dev) {
  const fromBios = /^([A-Z0-9]+)\.(\d+)$/i.exec(String(dev.bios || '').trim());
  if (fromBios) return { model: fromBios[1].toUpperCase(), bios: fromBios[2] };
  const m = /(?:^|[^A-Z0-9])(RC\d{2}[A-Z]{0,2})(?![A-Z0-9])/i.exec(String(dev.model || ''));
  return m ? { model: m[1].toUpperCase(), bios: null } : null;
}

async function checkAsus(dev) {
  const id = asusModel(dev);
  if (!id) throw new Error('Modèle ASUS non reconnu');
  const [bios, drivers, inv] = await Promise.all([asusFiles('bios', id.model), asusFiles('drivers', id.model), dev.simulated ? [] : inventory()]);
  const b = bios.find(f => /bios/i.test(f.category + f.title)) || bios[0] || null;
  const channels = [];
  if (b) {
    channels.push({
      id: 'asus-bios', maker: 'ASUS', title: `BIOS ${id.model}`,
      installed: id.bios, latest: b.version, date: b.date, size: b.size, url: b.url, notes: 'À installer avec l’outil de mise à jour du BIOS fourni dans l’archive, console branchée',
      status: id.bios && b.version ? (compare(b.version, id.bios) > 0 ? 'new' : 'ok') : 'unknown',
    });
  }
  const items = drivers.map(f => {
    const installed = dev.simulated ? null : installedVersion(f, inv);
    return { ...f, hardware: undefined, installed, status: installed ? (compare(f.version, installed) > 0 ? 'new' : 'ok') : 'unknown' };
  });
  channels.push({ id: 'asus-drivers', maker: 'ASUS', title: `Pilotes ${id.model} (Windows 11)`, items });
  return { model: id.model, channels };
}

/**
 * Suivi des canaux officiels : résultat gardé dans DATA/oem.json (lecture immédiate), vérifié à la
 * demande ou une fois par jour quand on ouvre les réglages de la console.
 */
function tracker(dataDir) {
  const file = path.join(dataDir, 'oem.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  let pending = null;
  return {
    status() { return { checking: !!pending, last: read() }; },
    /** Pris en charge automatiquement : consoles ASUS pour l'instant. */
    supported: hh => !!hh && hh.maker === 'ASUS',
    check(dev) {
      if (pending) return pending;
      pending = (async () => {
        let r;
        try { r = { ok: true, ...(await checkAsus(dev)) }; }
        catch (e) { r = { ok: false, error: e.message }; }
        r.checked = new Date().toISOString();
        r.simulated = !!dev.simulated;
        try { fs.writeFileSync(file, JSON.stringify(r)); } catch { /* disque plein ? */ }
        return r;
      })().finally(() => { pending = null; });
      return pending;
    },
    /** Téléchargements officiels trouvés lors de la dernière vérification (pour les ouvrir). */
    allowed(target) {
      const last = read();
      if (!last || !last.ok) return false;
      return last.channels.some(c => c.url === target || (c.items || []).some(i => i.url === target));
    },
  };
}

module.exports = { tracker, compare, asusModel };
