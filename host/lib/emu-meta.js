// Visuels et fiche des jeux rétro, sans compte :
//   - images de libretro-thumbnails (jaquette, capture, écran-titre, logo), nommées comme les jeux
//     No-Intro / Redump : « Sonic The Hedgehog (USA, Europe, Brazil) (En).png » ;
//   - développeur, éditeur, genre, année, joueurs : metadat de libretro-database ;
//   - description : Wikipédia en français (en anglais à défaut).
'use strict';
const fs = require('fs');
const path = require('path');

const UA = 'KaneMode (emulation)';
const DAY = 24 * 3600e3;

// Nom libretro de chaque console (dossiers de thumbnails.libretro.com et fichiers metadat)
const LIBRETRO = {
  nes: 'Nintendo - Nintendo Entertainment System', snes: 'Nintendo - Super Nintendo Entertainment System', n64: 'Nintendo - Nintendo 64',
  gb: 'Nintendo - Game Boy', gbc: 'Nintendo - Game Boy Color', gba: 'Nintendo - Game Boy Advance', nds: 'Nintendo - Nintendo DS',
  n3ds: 'Nintendo - Nintendo 3DS', gc: 'Nintendo - GameCube', wii: 'Nintendo - Wii', wiiu: 'Nintendo - Wii U',
  psx: 'Sony - PlayStation', ps2: 'Sony - PlayStation 2', ps3: 'Sony - PlayStation 3', ps4: 'Sony - PlayStation 4',
  psvita: 'Sony - PlayStation Vita', psp: 'Sony - PlayStation Portable',
  megadrive: 'Sega - Mega Drive - Genesis', mastersystem: 'Sega - Master System - Mark III', gamegear: 'Sega - Game Gear',
  segacd: 'Sega - Mega-CD - Sega CD', saturn: 'Sega - Saturn', dreamcast: 'Sega - Dreamcast',
  pcengine: 'NEC - PC Engine - TurboGrafx 16', neogeo: 'SNK - Neo Geo', arcade: 'FBNeo - Arcade Games', atari2600: 'Atari - 2600',
  xbox: 'Microsoft - Xbox', xbox360: 'Microsoft - Xbox 360',
};
// Visuel KaneMode → dossier libretro
const KINDS = { portrait: 'Named_Boxarts', hero: 'Named_Snaps', header: 'Named_Titles', logo: 'Named_Logos' };
const FIELDS = ['developer', 'publisher', 'genre', 'releaseyear', 'maxusers'];
// Mots de la console pour départager les pages Wikipédia
const WIKI_HINT = { mastersystem: '8 bits', gamegear: '8 bits', megadrive: 'Mega Drive', snes: 'Super Nintendo', nes: 'NES' };

async function get(url, type = 'text') {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return type === 'json' ? r.json() : type === 'buffer' ? Buffer.from(await r.arrayBuffer()) : r.text();
}

// Clé de comparaison : sans extension, ni étiquettes (région, version), ni ponctuation
const key = s => String(s).replace(/\.[a-z0-9]{1,4}$/i, '').replace(/\s*[[(][^\])]*[\])]/g, '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/^the\s+|,\s*the$/g, '').replace(/[^a-z0-9]+/g, '');
const tags = s => (String(s).match(/\(([^)]*)\)/g) || []).join(' ').toLowerCase();
// libretro remplace ces caractères par « _ » dans les noms de fichiers
const fileSafe = s => s.replace(/[&*/:`<>?\\|"]/g, '_');

/** Meilleur nom de la liste pour ce jeu : nom identique, sinon même jeu, même région, version finale. */
function bestMatch(base, names) {
  if (!names || !names.length) return null;
  const exact = fileSafe(base);
  if (names.includes(exact)) return exact;
  const k = key(base);
  const same = names.filter(n => key(n) === k);
  if (!same.length) return null;
  const want = tags(base);
  const score = n => {
    const t = tags(n);
    let s = 0;
    for (const r of ['europe', 'france', 'usa', 'world', 'japan']) if (want.includes(r) && t.includes(r)) s += 3;
    if (t.includes('europe') || t.includes('france')) s += 1; // à défaut, la version européenne
    if (/beta|proto|demo|sample|hack|pirate|unl/.test(t + n.toLowerCase())) s -= 5;
    return s;
  };
  return same.sort((a, b) => score(b) - score(a))[0];
}

function parseDat(text, field, into) {
  const re = /game \(\s*([\s\S]*?)\n\)/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1];
    const name = (/comment "([^"]*)"/.exec(body) || /name "([^"]*)"/.exec(body) || [])[1];
    const value = (new RegExp(`\\b${field} "([^"]*)"`).exec(body) || [])[1];
    if (name && value) (into[name] = into[name] || {})[field] = value;
  }
}

function create({ cacheDir, artDir }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const metaFile = path.join(cacheDir, 'games.json');
  let metas = null;
  const readMetas = () => { if (!metas) { try { metas = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { metas = {}; } } return metas; };
  const saveMetas = () => fs.writeFile(metaFile, JSON.stringify(metas), () => {});
  const pending = new Map();
  const once = (k, fn) => { if (!pending.has(k)) pending.set(k, fn().finally(() => pending.delete(k))); return pending.get(k); };

  // Contenu d'un fichier de cache s'il a moins de maxAge, sinon fn() puis écrit
  async function cached(file, maxAge, fn) {
    try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); if (Date.now() - c.at < maxAge) return c.v; } catch { /* absent */ }
    const v = await fn();
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), v }));
    return v;
  }

  /** Noms des images libretro d'une console pour un type de visuel (liste du serveur, 30 jours). */
  function thumbNames(sys, kind) {
    const lr = LIBRETRO[sys];
    if (!lr || !KINDS[kind]) return Promise.resolve([]);
    return once(`thumbs:${sys}:${kind}`, () => cached(path.join(cacheDir, `thumbs-${sys}-${kind}.json`), 30 * DAY, async () => {
      const html = await get(`https://thumbnails.libretro.com/${encodeURIComponent(lr)}/${KINDS[kind]}/`);
      if (!html) return [];
      return [...html.matchAll(/href="([^"?/][^"]*)\.png"/g)].map(m => { try { return decodeURIComponent(m[1]); } catch { return m[1]; } });
    }));
  }

  /** Image libretro de ce jeu, téléchargée une fois ; null si libretro ne l'a pas. */
  async function art(e, kind) {
    if (e.source !== 'rom' || !LIBRETRO[e.system] || !KINDS[kind] || !e.romPath) return null;
    const base = path.join(artDir, `retro_${String(e.id).replace(/[^\w.-]+/g, '_')}_${kind}`);
    if (fs.existsSync(base + '.png')) return base + '.png';
    if (fs.existsSync(base + '.miss')) {
      try { if (Date.now() - fs.statSync(base + '.miss').mtimeMs < 7 * DAY) return null; } catch { /* lu à nouveau */ }
    }
    return once('art:' + base, async () => {
      try {
        const romBase = path.basename(e.romPath, path.extname(e.romPath));
        const name = bestMatch(romBase, await thumbNames(e.system, kind));
        const img = name && await get(`https://thumbnails.libretro.com/${encodeURIComponent(LIBRETRO[e.system])}/${KINDS[kind]}/${encodeURIComponent(name)}.png`, 'buffer');
        if (!img) { fs.writeFileSync(base + '.miss', ''); return null; }
        fs.writeFileSync(base + '.png', img);
        return base + '.png';
      } catch { return null; } // hors ligne : nouvel essai au prochain affichage
    });
  }

  /** Développeur, éditeur, genre, année et joueurs de toute une console (metadat, 30 jours). */
  function dat(sys) {
    const lr = LIBRETRO[sys];
    if (!lr) return Promise.resolve({});
    return once('dat:' + sys, () => cached(path.join(cacheDir, `dat-${sys}.json`), 30 * DAY, async () => {
      const games = {};
      for (const f of FIELDS) {
        try {
          const text = await get(`https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/${f}/${encodeURIComponent(lr)}.dat`);
          if (text) parseDat(text, f, games);
        } catch { /* champ absent pour cette console */ }
      }
      return games;
    }));
  }

  /** Résumé Wikipédia : page du jeu (pas de la série ni d'une liste), en français d'abord. */
  async function wiki(name, sys, year) {
    for (const lang of ['fr', 'en']) {
      const q = `${name} ${lang === 'fr' ? 'jeu vidéo' : 'video game'}`;
      const s = await get(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=8&srsearch=${encodeURIComponent(q)}`, 'json').catch(() => null);
      const k = key(name);
      const hint = (WIKI_HINT[sys] || '').toLowerCase();
      const ranked = ((s && s.query && s.query.search) || [])
        .filter(r => !/^(liste|list of)/i.test(r.title) && key(r.title.replace(/\s*\(.*\)$/, '')) === k)
        .map(r => {
          const t = r.title.toLowerCase();
          let sc = 0;
          if (/jeu vidéo|video game/.test(t)) sc += 3;
          if (year && t.includes(year)) sc += 2;
          if (hint && t.includes(hint)) sc += 2;
          return { r, sc };
        }).sort((a, b) => b.sc - a.sc);
      for (const { r } of ranked.slice(0, 3)) {
        const p = await get(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(r.title.replace(/ /g, '_'))}`, 'json').catch(() => null);
        if (!p || p.type === 'disambiguation' || !p.extract) continue;
        if (!/jeu vidéo|jeu d|video game/i.test((p.description || '') + ' ' + p.extract.slice(0, 300))) continue;
        return { text: p.extract, url: p.content_urls && p.content_urls.desktop && p.content_urls.desktop.page, lang };
      }
    }
    return null;
  }

  /** Fiche du jeu, gardée une fois trouvée (description refaite au plus une fois par semaine si absente). */
  async function meta(e) {
    if (e.source !== 'rom' || !e.romPath) return null;
    const all = readMetas();
    const hit = all[e.id];
    if (hit && (hit.description || Date.now() - hit.at < 7 * DAY)) return hit;
    return once('meta:' + e.id, async () => {
      const romBase = path.basename(e.romPath, path.extname(e.romPath));
      const games = await dat(e.system).catch(() => ({}));
      const name = bestMatch(romBase, Object.keys(games));
      const d = (name && games[name]) || {};
      const year = d.releaseyear || null;
      const w = await wiki(e.name, e.system, year).catch(() => null);
      const m = {
        at: Date.now(), developer: d.developer || null, publisher: d.publisher || null, genre: d.genre || null,
        year, players: d.maxusers ? +d.maxusers || null : null,
        description: w ? w.text : null, descriptionUrl: w ? w.url : null, descriptionLang: w ? w.lang : null,
      };
      all[e.id] = m;
      saveMetas();
      return m;
    });
  }

  return { art, meta, thumbNames, LIBRETRO, KINDS };
}

module.exports = { create, bestMatch, key, LIBRETRO };
