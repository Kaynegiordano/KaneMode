// Client SteamGridDB : recherche de jeux, liste des visuels, téléchargement.
// Sans clé : l'accès public du site (celui de ses propres pages). Avec une clé API perso
// (facultative, Paramètres → SteamGridDB → Avancé) : l'API v2 officielle.
'use strict';
const SITE = 'https://www.steamgriddb.com';
const API = SITE + '/api/v2';
const HEADERS = { 'User-Agent': 'KaneMode' };

// Type de visuel KaneMode → type SteamGridDB, dimensions et filtre de forme
const KINDS = {
  portrait: { type: 'grid', ep: 'grids', q: 'dimensions=600x900,342x482,660x930', keep: a => !a.width || a.height > a.width },
  header: { type: 'grid', ep: 'grids', q: 'dimensions=460x215,920x430', keep: a => !a.width || a.width > a.height },
  hero: { type: 'hero', ep: 'heroes', q: '', keep: () => true },
  logo: { type: 'logo', ep: 'logos', q: '', keep: () => true },
  icon: { type: 'icon', ep: 'icons', q: '', keep: () => true },
};

class SgdbError extends Error {}

async function request(url, init = {}) {
  let r;
  try { r = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers || {}) }, signal: AbortSignal.timeout(12000) }); }
  catch { throw new SgdbError('SteamGridDB injoignable (connexion Internet ?)'); }
  if (r.status === 401 || r.status === 403) throw new SgdbError(init.headers && init.headers.Authorization ? 'Clé SteamGridDB refusée' : 'SteamGridDB a refusé la requête');
  if (r.status === 404) return null;
  const j = await r.json().catch(() => null);
  if (!j || !j.success) throw new SgdbError('Réponse SteamGridDB invalide');
  return j.data;
}
const v2 = (key, route) => request(API + route, { headers: { Authorization: 'Bearer ' + key } });
const publicAssets = (type, gameId, page) => remember(`p:${gameId}:${type}:${page}`, () => request(SITE + '/api/public/search/assets', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ asset_type: type, game_id: [gameId], page }),
}));

// Petit cache mémoire : parcourir les onglets ne relance pas les mêmes requêtes
const memo = new Map();
const pending = new Map();
async function remember(k, fn) {
  const hit = memo.get(k);
  if (hit && Date.now() - hit.t < 15 * 60e3) return hit.v;
  if (pending.has(k)) return pending.get(k);
  const promise = Promise.resolve().then(fn).then(v => {
    if (pending.get(k) === promise) memo.set(k, { t: Date.now(), v });
    if (memo.size > 300) memo.delete(memo.keys().next().value);
    return v;
  }).finally(() => { if (pending.get(k) === promise) pending.delete(k); });
  pending.set(k, promise);
  return promise;
}
const forget = gameId => { for (const map of [memo, pending]) for (const k of map.keys()) if (k.includes(`:${gameId}:`)) map.delete(k); };

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function search(key, term) {
  term = String(term || '').trim();
  if (!term) return [];
  const data = await remember('s:' + (key ? 'k' : 'p') + term.toLowerCase(), () => key
    ? v2(key, '/search/autocomplete/' + encodeURIComponent(term))
    : request(SITE + '/api/public/search/autocomplete?term=' + encodeURIComponent(term)));
  return (data || []).map(g => ({
    id: g.id, name: g.name, verified: !!g.verified, types: g.types || [],
    year: g.release_date ? new Date(g.release_date * 1000).getFullYear() : null,
  }));
}

/** Jeu SteamGridDB d'une entrée : par appid Steam (avec clé), sinon par nom. */
async function gameFor(key, entry) {
  if (key && entry.steamAppId) {
    const g = await v2(key, `/games/steam/${entry.steamAppId}`);
    if (g) return { id: g.id, name: g.name };
  }
  const results = await search(key, entry.name);
  if (!results.length) return null;
  const want = norm(entry.name);
  const same = results.filter(r => norm(r.name) === want);
  // À nom égal, on préfère le jeu vendu sur la même boutique
  const store = entry.steamAppId ? 'steam' : entry.source === 'epic' ? 'egs' : entry.source === 'gog' ? 'gog' : null;
  // Sinon, seulement un nom très proche (« Hades II » ≠ « Hades », « HDR » ≠ « HDRezka client »)
  const close = r => { const n = norm(r.name); return (n.startsWith(want) || want.startsWith(n)) && Math.min(n.length, want.length) / Math.max(n.length, want.length) >= 0.8; };
  const g = (store && same.find(r => r.types.includes(store))) || same[0] || results.find(close);
  return g ? { id: g.id, name: g.name } : null;
}

const clean = a => !a.nsfw && !a.humor && !a.epilepsy && !a.is_deleted && !a.is_animated && !String(a.mime || '').includes('webm');
const shape = a => ({
  id: a.id, url: a.url, thumb: a.thumb || a.url, width: a.width || null, height: a.height || null,
  style: a.style, score: a.score != null ? a.score : (a.upvotes || 0) - (a.downvotes || 0),
  author: a.author && a.author.name,
});

async function assets(key, gameId, kind, { style, firstPage = false } = {}) {
  const k = KINDS[kind];
  if (!k) throw new SgdbError('Type de visuel inconnu');
  gameId = +gameId;
  if (!gameId) throw new SgdbError('Jeu SteamGridDB inconnu');
  const list = await remember(`a:${key ? 'k' : 'p'}:${gameId}:${kind}:${firstPage ? 'first' : 'all'}`, async () => {
    if (key) {
      const params = [k.q, 'nsfw=false', 'humor=false', 'types=static'].filter(Boolean).join('&');
      return ((await v2(key, `/${k.ep}/game/${gameId}?${params}`)) || []).map(shape);
    }
    // Accès public : pages de 48 (la première est la page 0), filtres appliqués ici. Les trois pages
    // sont demandées en même temps (l'une après l'autre, il fallait attendre trois allers-retours) ;
    // une page en échec n'empêche pas d'afficher les autres.
    const pages = await Promise.all((firstPage ? [0] : [0, 1, 2]).map(page => publicAssets(k.type, gameId, page).catch(e => (page ? null : Promise.reject(e)))));
    const out = [], seen = new Set();
    for (const d of pages) {
      for (const a of (d && d.assets) || []) if (!seen.has(a.id) && clean(a) && k.keep(a)) { seen.add(a.id); out.push(shape(a)); }
      if (!d || ((d.assets || []).length < (d.limit || 48))) break;
    }
    return out;
  });
  // Style préféré en tête, sans cacher les autres
  return style ? [...list.filter(a => a.style === style), ...list.filter(a => a.style !== style)] : list;
}

/** Accepte uniquement les fichiers servis par SteamGridDB. */
const isSgdbUrl = u => { try { const h = new URL(u).hostname; return h === 'steamgriddb.com' || h.endsWith('.steamgriddb.com'); } catch { return false; } };

async function download(url) {
  if (!isSgdbUrl(url)) throw new SgdbError('Adresse d’image non autorisée');
  let r;
  try { r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) }); }
  catch { throw new SgdbError('Téléchargement impossible (connexion Internet ?)'); }
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.startsWith('image/')) throw new SgdbError('Téléchargement impossible');
  const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : type.includes('icon') ? '.ico' : '.jpg';
  return { ext, data: Buffer.from(await r.arrayBuffer()) };
}

module.exports = { search, gameFor, assets, download, forget, KINDS, SgdbError };
