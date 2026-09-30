// Réglages graphiques du pilote (limite d'images par seconde, faible latence, netteté…) et mesures du
// GPU, pour AMD, NVIDIA et Intel. Chaque fabricant a son petit programme natif, qui parle à la
// bibliothèque de son pilote et reste ouvert, une commande par ligne (comme syscontrol.ps1) :
//   - AMD : kanemode-amd.exe (ADLX, native/KaneMode.Amd) ;
//   - NVIDIA : kanemode-nvidia.exe (NVAPI et NVML, native/KaneMode.Gpu) ;
//   - Intel : kanemode-intel.exe (Intel Graphics Control Library, native/KaneMode.Gpu).
// Un seul est utilisé : celui du GPU qui fait tourner les jeux (carte NVIDIA, puis AMD, puis Intel).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
// Outil de chaque fabricant : app\tools dans le paquet ; en développement, la sortie des scripts de build
const TOOLS = {
  nvidia: { pci: '10DE', label: 'NVIDIA', exe: 'kanemode-nvidia.exe', dev: ['native', 'KaneMode.Gpu', 'obj', 'gpu'],
    features: ['fps', 'antilag', 'vsync'] },
  amd: { pci: '1002', label: 'AMD', exe: 'kanemode-amd.exe', dev: ['native', 'KaneMode.Amd', 'obj', 'amd'],
    features: ['fps', 'rsr', 'rsrsharp', 'afmf', 'antilag', 'ris', 'rissharp'] },
  intel: { pci: '8086', label: 'Intel', exe: 'kanemode-intel.exe', dev: ['native', 'KaneMode.Gpu', 'obj', 'gpu'],
    features: ['fps', 'antilag', 'ris', 'rissharp'] },
};
const ORDER = ['nvidia', 'amd', 'intel'];
const exeOf = t => [path.join(ROOT, 'tools', t.exe), path.join(ROOT, ...t.dev, t.exe)].find(f => fs.existsSync(f)) || null;

/** Programme d'un fabricant, lancé à la première commande et gardé ouvert. */
function tool(id) {
  const t = TOOLS[id];
  const exe = exeOf(t);
  let proc = null, ready = null, buffer = '', busy = null;
  const queue = []; // une seule commande à la fois : le programme répond dans l'ordre
  const gone = `Réglages ${t.label} interrompus`;

  function start() {
    proc = spawn(exe, [], { windowsHide: true });
    proc.stdout.setEncoding('utf8');
    ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Réglages ${t.label} indisponibles`)), 15000);
      proc.stdout.on('data', chunk => {
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.ready) { clearTimeout(timer); resolve(); continue; }
          const p = busy;
          busy = null;
          if (p) { clearTimeout(p.timer); msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error || 'Échec')); }
          next();
        }
      });
      proc.on('error', e => { clearTimeout(timer); proc = null; ready = null; reject(e); });
    });
    proc.on('exit', () => {
      proc = null; ready = null; buffer = '';
      if (busy) { clearTimeout(busy.timer); busy.reject(new Error(gone)); busy = null; }
      while (queue.length) queue.shift().reject(new Error(gone));
    });
    return ready;
  }
  function next() {
    if (busy || !queue.length || !proc) return;
    busy = queue.shift();
    busy.timer = setTimeout(() => { if (proc) proc.kill(); }, 10000); // pilote bloqué : on relance
    proc.stdin.write(busy.line + '\n');
  }
  async function call(line) {
    if (!exe) throw new Error(`Outil ${t.label} absent de cette version`);
    if (!proc) await start(); else await ready;
    return new Promise((resolve, reject) => { queue.push({ line, resolve, reject }); next(); });
  }
  return { id, exe, call, stop: () => { if (proc) proc.kill(); } };
}

/**
 * `vendors` : fonction qui donne les identifiants PCI des cartes de la machine (device.info), pour
 * ne lancer que l'outil utile. Sans réponse, les outils présents sont essayés dans l'ordre.
 */
function create({ vendors = async () => null } = {}) {
  const tools = Object.fromEntries(ORDER.map(id => [id, tool(id)]));
  let active = null;         // outil du GPU trouvé
  let picking = null, pickedAt = 0, reason = 'Aucun GPU réglable';

  async function pick() {
    if (active) return active;
    // Aucun trouvé : nouvel essai au plus une fois par minute (pilote installé entre-temps)
    if (picking) return picking;
    if (pickedAt && Date.now() - pickedAt < 60000) return null;
    picking = (async () => {
      const pci = await vendors().catch(() => null);
      const want = ORDER.filter(id => tools[id].exe && (!pci || pci.includes(TOOLS[id].pci)));
      reason = want.length ? reason : pci && pci.length ? 'Carte graphique sans réglages pris en charge' : 'Outils graphiques absents de cette version';
      for (const id of want) {
        try {
          const st = await tools[id].call('state');
          if (st && st.available) { active = tools[id]; return active; }
          reason = (st && st.reason) || reason;
        } catch (e) { reason = e.message; }
        tools[id].stop(); // pas le bon fabricant : programme fermé
      }
      return null;
    })().finally(() => { picking = null; pickedAt = Date.now(); });
    return picking;
  }

  // État gardé un court instant (le widget et l'accès rapide le relisent souvent)
  let cache = null;
  async function state(force = false) {
    const t = await pick();
    if (!t) return { available: false, reason };
    if (!force && cache && Date.now() - cache.t < 3000) return cache.v;
    const v = { vendor: t.id, ...(await t.call('state')) };
    cache = { t: Date.now(), v };
    return v;
  }

  async function set(feature, value) {
    const t = await pick();
    if (!t) throw new Error(reason);
    if (!TOOLS[t.id].features.includes(feature)) throw new Error(`Fonction ${TOOLS[t.id].label} inconnue`);
    const n = typeof value === 'boolean' ? +value : Math.round(Number(value));
    if (!Number.isFinite(n) || n < 0 || n > 1000) throw new Error('Valeur invalide');
    const v = { vendor: t.id, ...(await t.call(`set ${feature} ${n}`)) };
    cache = { t: Date.now(), v };
    return v;
  }

  async function live() {
    const t = await pick();
    if (!t) throw new Error(reason);
    return t.call('live');
  }

  const stop = () => ORDER.forEach(id => tools[id].stop());
  return { state, set, live, stop };
}

module.exports = { create, TOOLS };
