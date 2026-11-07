// Visuels des jeux Switch et Switch 2 depuis le site officiel de Nintendo Europe, sans compte ni clé :
// la recherche du site (searching.nintendo-europe.com) donne l'image carrée et l'image 16/9 de chaque
// jeu, la page du jeu ses captures. Les images du CDN existent en taille d'origine (le nom sans
// « _image500w ») : c'est elle qui est appliquée, la petite sert de vignette.
// SteamGridDB connaît mal les jeux Switch 2 récents ; ceux-ci y sont tous.
'use strict';
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KaneMode';
const DAY = 24 * 3600e3;
const SEARCH = 'https://searching.nintendo-europe.com/fr/select';
const SITE = 'https://www.nintendo.com';
const CDN = /^https:\/\/www\.nintendo\.com\/eu\/media\/images\//;
const SYSTEMS = { switch: 'Nintendo Switch', switch2: 'Nintendo Switch 2' };

class NintendoError extends Error {}

async function get(url, type = 'text') {
  let r;
  try { r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }); }
  catch { throw new NintendoError('Site de Nintendo injoignable (connexion Internet ?)'); }
  if (r.status === 404) return null;
  if (!r.ok) throw new NintendoError(`Site de Nintendo : erreur ${r.status}`);
  return type === 'json' ? r.json() : r.text();
}

// Comparaison des noms : sans accents, marques, ponctuation ni « Pokémon » en tête
const key = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[™®©]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const original = u => String(u || '').replace(/_image\d+w(?=\.\w+$)/, '');

/** Jeux du site pour ce nom, ceux de la console d'abord. */
async function search(term, sysId) {
  const q = new URLSearchParams({ q: String(term || '').slice(0, 120), fq: 'type:GAME', rows: '24', wt: 'json',
    fl: 'title,url,nsuid_txt,system_names_txt,image_url_sq_s,image_url_h16x9_s,image_url_h2x1_s,image_url,pretty_date_s' });
  const data = await get(`${SEARCH}?${q}`, 'json');
  const docs = (data && data.response && data.response.docs) || [];
  const want = SYSTEMS[sysId];
  const games = docs.map(d => ({
    id: String((d.nsuid_txt || [])[0] || d.url || d.title),
    name: String(d.title || ''),
    systems: d.system_names_txt || [],
    page: d.url ? SITE + d.url : null,
    square: d.image_url_sq_s || null,
    wide: d.image_url_h16x9_s || d.image_url_h2x1_s || null,
    year: (/\d{4}/.exec(d.pretty_date_s || '') || [])[0] || null,
  })).filter(g => g.name && (g.square || g.wide));
  const on = g => (want && g.systems.includes(want) ? 2 : g.systems.some(s => /Switch/.test(s)) ? 1 : 0);
  return games.sort((a, b) => on(b) - on(a));
}

/** Le jeu du site qui correspond le mieux à ce nom (même nom et même console d'abord). */
function best(name, sysId, games) {
  const k = key(name);
  const want = SYSTEMS[sysId];
  const score = g => {
    const gk = key(g.name);
    let s = gk === k ? 10 : gk.endsWith(k) || gk.startsWith(k) ? 6 : k.includes(gk) || gk.includes(k) ? 3 : 0;
    if (!s) return 0;
    if (want && g.systems.includes(want)) s += 4;
    else if (g.systems.some(x => /Switch/.test(x))) s += 1;
    return s;
  };
  const ranked = games.map(g => [score(g), g]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]);
  return ranked.length ? ranked[0][1] : null;
}

function create({ cacheDir }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const matchFile = path.join(cacheDir, 'nintendo-games.json');
  let matches;
  try { matches = JSON.parse(fs.readFileSync(matchFile, 'utf8')); } catch { matches = {}; }
  const saveMatches = () => fs.writeFile(matchFile, JSON.stringify(matches), () => {});
  const pages = new Map();

  /**
   * Jeu du site associé à une entrée de la bibliothèque, cherché une fois et gardé : de nouveau si
   * le nom du jeu a changé, ou après 3 jours sans résultat. Un jeu choisi à la main reste.
   */
  async function gameFor(e) {
    const m = matches[e.id];
    if (m && (m.manual || (m.name === e.name && (m.game || Date.now() - (m.at || 0) < 3 * DAY)))) return m.game;
    const g = best(e.name, e.system, await search(e.name, e.system));
    matches[e.id] = { name: e.name, game: g, at: Date.now() };
    saveMatches();
    return g;
  }
  function setMatch(id, game) {
    matches[id] = { manual: true, game: game && game.name ? game : null, at: Date.now() };
    saveMatches();
  }

  /** Captures de la page du jeu (lue une fois par mois). */
  async function shots(game) {
    if (!game.page) return [];
    const file = path.join(cacheDir, `nintendo-page-${key(game.id).slice(0, 40)}.json`);
    try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); if (Date.now() - c.at < 30 * DAY) return c.v; } catch { /* absent */ }
    if (!pages.has(file)) {
      pages.set(file, (async () => {
        const html = (await get(game.page)) || '';
        const seen = new Set();
        const list = [];
        for (const m of html.matchAll(/https:\/\/www\.nintendo\.com\/eu\/media\/images\/assets\/[^"'\s)]+?\.(?:jpg|png)/g)) {
          const u = original(m[0]);
          if (seen.has(u) || /_TM_Standard|website_elements|Logo|icon|1x1_|2x1_/i.test(u)) continue;
          seen.add(u);
          list.push(u);
        }
        fs.writeFileSync(file, JSON.stringify({ at: Date.now(), v: list.slice(0, 40) }));
        return list.slice(0, 40);
      })().finally(() => pages.delete(file)));
    }
    return pages.get(file);
  }

  /** Visuels d'un type, au format du sélecteur (id, url = taille d'origine, thumb = petite). */
  async function assets(game, kind) {
    if (!game) return [];
    const item = (u, extra = {}) => ({ id: original(u), url: original(u), thumb: u, author: 'Nintendo', ...extra });
    if (kind === 'portrait' || kind === 'icon') return game.square ? [item(game.square, { style: 'carré' })] : [];
    if (kind === 'header') return game.wide ? [item(game.wide)] : [];
    if (kind === 'hero') {
      const list = game.wide ? [item(game.wide)] : [];
      try { for (const u of await shots(game)) if (u !== original(game.wide)) list.push({ id: u, url: u, thumb: u, author: 'Nintendo', style: 'capture' }); }
      catch { /* page illisible : l'image 16/9 suffit */ }
      return list;
    }
    return []; // pas de logo séparé sur le site
  }

  return { search, gameFor, setMatch, assets };
}

// L'image d'origine n'existe pas toujours (Final Fantasy Resonance : seulement « _image500w ») :
// la plus grande taille publiée est prise à défaut
const SIZES = ['1600', '1280', '950', '500'];
async function download(url) {
  if (!CDN.test(String(url || ''))) throw new NintendoError('Adresse d’image non autorisée');
  const tries = /_image\d+w\.\w+$/.test(url) ? [url] : [url, ...SIZES.map(w => url.replace(/(\.\w+)$/, `_image${w}w$1`))];
  for (const u of tries) {
    let r;
    try { r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }); }
    catch { throw new NintendoError('Téléchargement impossible (connexion Internet ?)'); }
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) continue;
    const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg';
    return { ext, data: Buffer.from(await r.arrayBuffer()) };
  }
  throw new NintendoError('Téléchargement impossible');
}

const isNintendoUrl = u => CDN.test(String(u || ''));

module.exports = { create, search, best, download, isNintendoUrl, key, NintendoError, SYSTEMS };
