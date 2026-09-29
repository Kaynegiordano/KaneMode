// Réglages système (accès rapide, énergie) : un PowerShell reste ouvert (syscontrol.ps1) et reçoit
// les commandes une par une, pour des réponses rapides. Profils d'énergie sur batterie / secteur.
'use strict';
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'syscontrol.ps1');
const ALLOWED = ['state', 'live', 'policy', 'resolution', 'volume', 'mute', 'brightness', 'powermode', 'refresh', 'hdr', 'radio', 'vendor', 'tdp', 'cpumax', 'boost', 'chargelimit'];

/** Constructeur dont on sait piloter les profils : d'après la console reconnue. */
const vendorOf = handheld => (!handheld ? '' : /^rog-/.test(handheld.id) ? 'asus' : /^legion-/.test(handheld.id) ? 'lenovo' : '');

function create(getVendor) {
  let proc = null, ready = null, nextId = 1, buffer = '';
  const pending = new Map();

  async function start() {
    const vendor = await getVendor();
    proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Vendor', vendor], { windowsHide: true });
    proc.stdout.setEncoding('utf8');
    ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Réglages système indisponibles')), 20000);
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
          const p = pending.get(msg.id);
          if (!p) continue;
          pending.delete(msg.id);
          clearTimeout(p.timer);
          msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error || 'Échec'));
        }
      });
    });
    proc.on('exit', () => {
      proc = null; ready = null; buffer = '';
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Réglages système interrompus')); }
      pending.clear();
    });
    return ready;
  }

  /** Envoie une commande (relance le service au besoin). */
  async function call(cmd, args = {}) {
    if (!ALLOWED.includes(cmd)) throw new Error('Commande inconnue');
    if (!proc) await start(); else await ready;
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Pas de réponse du système')); }, 15000);
      pending.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n');
    });
  }

  // État mis en cache un court instant : l'accès rapide le relit souvent
  let cache = null;
  async function state(force = false) {
    if (!force && cache && Date.now() - cache.t < 1500) return cache.v;
    const v = await call('state');
    cache = { t: Date.now(), v };
    return v;
  }

  /** Applique un profil d'énergie (champs absents : inchangés). */
  async function apply(profile) {
    const done = [], errors = [];
    const step = async (cmd, value) => {
      if (value === undefined || value === null || value === '') return;
      try { await call(cmd, { value }); done.push(cmd); } catch (e) { errors.push(`${cmd} : ${e.message}`); }
    };
    await step('powermode', profile.powerMode);
    await step('vendor', profile.vendor);
    await step('tdp', profile.tdp);
    await step('cpumax', profile.cpuMax);
    await step('boost', profile.boost);
    await step('refresh', profile.refresh);
    await step('brightness', profile.brightness);
    cache = null;
    return { done, errors };
  }

  // policy : lecture rapide du profil en cours (mode tenu), sans vider l'état gardé
  return { call: (c, a) => { cache = null; return call(c, a); }, live: () => call('live'), policy: () => call('policy'), state, apply, stop: () => proc && proc.kill() };
}

module.exports = { create, vendorOf };
