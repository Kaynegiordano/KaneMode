// Réglages graphiques AMD (Radeon) : limite d'images par seconde, RSR, AFMF, Anti-Lag, netteté, et
// mesures du GPU. Un petit programme natif (native/KaneMode.Amd, kanemode-amd.exe) parle au pilote
// par ADLX ; il reste ouvert et reçoit une commande par ligne, comme syscontrol.ps1.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// app\tools dans le paquet ; en développement, la sortie de native\KaneMode.Amd\build-amd.ps1
const EXE = [
  path.join(__dirname, '..', '..', 'tools', 'kanemode-amd.exe'),
  path.join(__dirname, '..', '..', 'native', 'KaneMode.Amd', 'obj', 'amd', 'kanemode-amd.exe'),
].find(f => fs.existsSync(f));

// Fonctions réglables : valeur entière (0/1 pour activer, images par seconde, netteté)
const FEATURES = ['fps', 'rsr', 'rsrsharp', 'afmf', 'antilag', 'ris', 'rissharp'];

let proc = null, ready = null, buffer = '';
const queue = [];   // une seule commande à la fois : le programme répond dans l'ordre
let busy = null;

function start() {
  proc = spawn(EXE, [], { windowsHide: true });
  proc.stdout.setEncoding('utf8');
  ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Réglages AMD indisponibles')), 15000);
    proc.stdout.on('data', chunk => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.ready) { clearTimeout(t); resolve(); continue; }
        const p = busy;
        busy = null;
        if (p) { clearTimeout(p.timer); msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error || 'Échec')); }
        next();
      }
    });
    proc.on('error', e => { clearTimeout(t); proc = null; ready = null; reject(e); });
  });
  proc.on('exit', () => {
    proc = null; ready = null; buffer = '';
    if (busy) { clearTimeout(busy.timer); busy.reject(new Error('Réglages AMD interrompus')); busy = null; }
    while (queue.length) queue.shift().reject(new Error('Réglages AMD interrompus'));
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
  if (!EXE) throw new Error('Outil AMD absent de cette version');
  if (!proc) await start(); else await ready;
  return new Promise((resolve, reject) => { queue.push({ line, resolve, reject }); next(); });
}

// État gardé un court instant (le widget et l'accès rapide le relisent souvent)
let cache = null;
async function state(force = false) {
  if (!EXE) return { available: false, reason: 'Outil AMD absent de cette version' };
  if (!force && cache && Date.now() - cache.t < 3000) return cache.v;
  const v = await call('state');
  cache = { t: Date.now(), v };
  return v;
}

async function set(feature, value) {
  if (!FEATURES.includes(feature)) throw new Error('Fonction AMD inconnue');
  const n = typeof value === 'boolean' ? +value : Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 1000) throw new Error('Valeur invalide');
  const v = await call(`set ${feature} ${n}`);
  cache = { t: Date.now(), v };
  return v;
}

const live = () => call('live');
const stop = () => { if (proc) proc.kill(); };

module.exports = { state, set, live, stop, FEATURES };
