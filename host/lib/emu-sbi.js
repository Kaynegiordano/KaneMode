// Jeux PlayStation européens protégés par LibCrypt : l'émulateur a besoin du fichier .sbi (sous-codes
// du disque) à côté du .cue ou du .chd, sinon DuckStation refuse de démarrer. Redump les publie :
// recherche du jeu (consoles PlayStation), puis /disc/<n>/sbi/ dont le nom de fichier doit être
// exactement celui du disque.
'use strict';
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (KaneMode)';
// LibCrypt ne concerne que les versions européennes
const PAL = /\((?:[^)]*\b(?:Europe|France|Germany|Spain|Italy|UK|Netherlands|Sweden|Scandinavia|Australia)\b[^)]*)\)/i;
const DISC_FILE = /\.(cue|chd|ccd|iso|img|pbp)$/i;

async function get(url, method = 'GET') {
  const r = await fetch(url, { method, headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  return r;
}

function create({ cacheFile }) {
  let misses = null;
  const readMisses = () => { if (!misses) { try { misses = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { misses = {}; } } return misses; };
  const saveMisses = () => fs.writeFile(cacheFile, JSON.stringify(misses), () => {});

  /** Disques d'un lancement : le fichier lui-même, ou ceux d'une liste .m3u. */
  function discsOf(file) {
    if (!/\.m3u$/i.test(file)) return [file];
    try {
      return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        .map(l => (path.isAbsolute(l) ? l : path.join(path.dirname(file), l)));
    } catch { return []; }
  }

  async function fetchOne(disc) {
    const base = path.basename(disc, path.extname(disc));
    const target = path.join(path.dirname(disc), base + '.sbi');
    if (fs.existsSync(target) || !PAL.test(base) || !DISC_FILE.test(disc)) return false;
    const m = readMisses();
    if (m[base] && Date.now() - m[base] < 30 * 24 * 3600e3) return false;
    const words = base.replace(/\s*[[(][^\])]*[\])]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
    try {
      const html = await (await get(`http://redump.org/discs/system/psx/quicksearch/${encodeURIComponent(words).replace(/%2D/g, '-')}/`)).text();
      const ids = [...new Set([...html.matchAll(/href="\/disc\/(\d+)\/"/g)].map(x => x[1]))].slice(0, 15);
      for (const id of ids) {
        const head = await get(`http://redump.org/disc/${id}/sbi/`, 'HEAD');
        const name = (/filename="([^"]+)"/i.exec(head.headers.get('content-disposition') || '') || [])[1];
        if (!name || name.toLowerCase() !== (base + '.sbi').toLowerCase()) continue;
        const r = await get(`http://redump.org/disc/${id}/sbi/`);
        if (!r.ok) break;
        fs.writeFileSync(target, Buffer.from(await r.arrayBuffer()));
        console.log(`Émulation : ${name} téléchargé (Redump, disque ${id})`);
        return true;
      }
      m[base] = Date.now(); // pas protégé, ou inconnu de Redump
      saveMisses();
    } catch (e) { console.error('Émulation : fichier .sbi', e.message); } // hors ligne : nouvel essai au prochain lancement
    return false;
  }

  /** Ajoute les .sbi manquants des disques de ce lancement ; ne bloque jamais le jeu. */
  async function ensure(file) {
    let n = 0;
    for (const d of discsOf(file)) if (await fetchOne(d)) n++;
    return n;
  }

  return { ensure };
}

module.exports = { create, PAL };
