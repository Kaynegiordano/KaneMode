// Jeux rangés dans une archive (.zip, .7z, .rar) pour une console dont l'émulateur ne lit pas les
// archives : décompressés au premier lancement dans <dossier d'émulation>\Cache, puis réutilisés.
// Le cache garde les jeux les plus récemment lancés sous une taille maximale.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const DISC = /\s*\((?:disc|disque|cd)\s*(\d+)(?:\s*of\s*\d+)?\)/i;

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const sizeOf = dir => walk(dir).reduce((n, f) => { try { return n + fs.statSync(f).size; } catch { return n; } }, 0);

/**
 * Fichier à donner à l'émulateur : le premier format de la console (un .m3u, puis un .cue avant
 * ses .bin…), le plus gros à format égal. Plusieurs disques sans .m3u : une liste est écrite.
 */
function pick(dir, exts, { m3u = false } = {}) {
  const files = walk(dir).filter(f => exts.includes(path.extname(f).slice(1).toLowerCase()));
  if (!files.length) return null;
  const rank = f => exts.indexOf(path.extname(f).slice(1).toLowerCase());
  const size = f => { try { return fs.statSync(f).size; } catch { return 0; } };
  files.sort((a, b) => rank(a) - rank(b) || size(b) - size(a));
  const best = files[0];
  const bestExt = path.extname(best).toLowerCase();
  const discs = files.filter(f => path.extname(f).toLowerCase() === bestExt && DISC.test(path.basename(f)));
  if (m3u && bestExt !== '.m3u' && discs.length > 1) {
    discs.sort((a, b) => +DISC.exec(path.basename(a))[1] - +DISC.exec(path.basename(b))[1]);
    const list = path.join(dir, path.basename(discs[0]).replace(DISC, '').replace(/\.[^.]+$/, '') + '.m3u');
    fs.writeFileSync(list, discs.map(f => path.relative(dir, f)).join('\r\n') + '\r\n');
    return list;
  }
  return best;
}

function create({ cacheDir, maxBytes = 40e9 }) {
  const jobs = new Map();
  const keyOf = archive => {
    let st = { size: 0, mtimeMs: 0 };
    try { st = fs.statSync(archive); } catch { /* lu plus bas */ }
    return crypto.createHash('sha1').update(`${archive.toLowerCase()}|${st.size}|${Math.floor(st.mtimeMs)}`).digest('hex').slice(0, 16);
  };
  const dirOf = archive => path.join(cacheDir(), keyOf(archive));

  /** Fichier du jeu déjà décompressé, ou null. */
  function ready(archive, exts, opts) {
    const dir = dirOf(archive);
    const done = path.join(dir, '.kanemode');
    if (!fs.existsSync(done)) return null;
    const now = new Date();
    try { fs.utimesSync(done, now, now); } catch { /* ordre du cache seulement */ }
    return pick(dir, exts, opts);
  }

  /** Les jeux lancés il y a le plus longtemps partent quand le cache dépasse sa taille. */
  function trim(keep) {
    let dirs = [];
    try { dirs = fs.readdirSync(cacheDir(), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(cacheDir(), d.name)); } catch { return; }
    const info = dirs.map(d => {
      let at = 0;
      try { at = fs.statSync(path.join(d, '.kanemode')).mtimeMs; } catch { /* décompression interrompue */ }
      return { d, at, size: sizeOf(d) };
    }).sort((a, b) => a.at - b.at);
    let total = info.reduce((n, x) => n + x.size, 0);
    for (const x of info) {
      if (total <= maxBytes) break;
      if (x.d === keep) continue;
      fs.rmSync(x.d, { recursive: true, force: true });
      total -= x.size;
      console.log(`Émulation : cache, ${path.basename(x.d)} retiré`);
    }
  }

  /** Décompresse l'archive (une seule fois, même si on relance pendant la décompression). */
  function extract(id, name, archive, exts, opts) {
    const running = jobs.get(id);
    if (running && running.promise) return running.promise;
    const dir = dirOf(archive);
    const tmp = dir + '.part';
    let total = 0;
    try { total = fs.statSync(archive).size; } catch { return Promise.reject(new Error('Archive introuvable')); }
    const job = { id: 'extract:' + id, name, phase: 'extract', received: 0, total, error: null };
    jobs.set(id, job);
    job.promise = new Promise((resolve, reject) => {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      // Avancement : taille déjà écrite (souvent plus grande que l'archive, d'où le plafond à 99 %)
      const timer = setInterval(() => { job.received = Math.min(sizeOf(tmp), total * 0.99); }, 700);
      execFile(TAR, ['-xf', archive, '-C', tmp], { windowsHide: true, maxBuffer: 16 << 20 }, err => {
        clearInterval(timer);
        try {
          if (err && !walk(tmp).length) throw new Error('Archive illisible ou abîmée');
          fs.rmSync(dir, { recursive: true, force: true });
          fs.renameSync(tmp, dir);
          const file = pick(dir, exts, opts);
          if (!file) throw new Error(`Aucun jeu reconnu dans ${path.basename(archive)}`);
          fs.writeFileSync(path.join(dir, '.kanemode'), JSON.stringify({ archive, at: new Date().toISOString() }));
          job.phase = 'done';
          job.received = total;
          console.log(`Émulation : ${path.basename(archive)} décompressé (${path.basename(file)})`);
          trim(dir);
          resolve(file);
        } catch (e) {
          fs.rmSync(tmp, { recursive: true, force: true });
          job.phase = 'error'; job.error = e.message;
          reject(e);
        } finally {
          delete job.promise;
          setTimeout(() => { if (jobs.get(id) === job) jobs.delete(id); }, 60e3);
        }
      });
    });
    return job.promise;
  }

  function clear() {
    let freed = 0;
    try {
      for (const d of fs.readdirSync(cacheDir(), { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const p = path.join(cacheDir(), d.name);
        freed += sizeOf(p);
        fs.rmSync(p, { recursive: true, force: true });
      }
    } catch { /* cache vide */ }
    return freed;
  }

  const usage = () => { try { return sizeOf(cacheDir()); } catch { return 0; } };
  const jobList = () => [...jobs.values()].map(({ promise, ...j }) => ({ ...j, busy: !!promise }));

  return { ready, extract, clear, usage, jobs: jobList };
}

module.exports = { create, pick };
