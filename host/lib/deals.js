// Bons plans et nouveautés des boutiques (rangée de l'accueil) : promotions, nouveautés et sorties à
// venir de Steam, jeux gratuits d'Epic, promotions et nouveautés de GOG, jeux offerts ailleurs
// (GamerPower). Uniquement des API publiques sans compte ni clé. Instant Gaming n'en a pas : pas lu.
// Résultat gardé dans DATA/deals.json et rafraîchi toutes les 4 h au plus (voir server.js).
'use strict';
const fs = require('fs');
const path = require('path');

const HEADERS = { 'User-Agent': 'KaneMode (https://github.com/Kaynegiordano/KaneMode)', Accept: 'application/json' };
const MAX_AGE = 4 * 3600e3;

async function getJson(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const euros = cents => (cents == null ? null : (cents / 100).toFixed(2).replace('.', ',') + ' €');
const clean = s => String(s || '').replace(/[™®]/g, '').trim();
const key = s => clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');

// ---------------------------------------------------------------- sources
// Langue des titres et descriptions de chaque boutique (prix et région : France)
const STEAM_LANG = { fr: 'french', en: 'english', es: 'spanish', de: 'german', it: 'italian', pt: 'brazilian', ja: 'japanese', zh: 'schinese' };
const WEB_LANG = { fr: 'fr', en: 'en-US', es: 'es-ES', de: 'de', it: 'it', pt: 'pt-BR', ja: 'ja', zh: 'zh-CN' };
let lang = 'fr';

async function steam() {
  const j = await getJson(`https://store.steampowered.com/api/featuredcategories?cc=fr&l=${STEAM_LANG[lang] || 'french'}`);
  const out = [];
  const add = (list, kind, limit) => {
    for (const x of ((list && list.items) || []).filter(x => x.type === 0).slice(0, limit)) {
      out.push({
        id: 'steam:' + x.id, store: 'steam', kind, title: clean(x.name),
        image: x.large_capsule_image || x.header_image || null,
        price: x.discounted && x.final_price != null ? { final: euros(x.final_price), base: euros(x.original_price), pct: x.discount_percent } : x.final_price ? { final: euros(x.final_price) } : null,
        until: x.discount_expiration ? new Date(x.discount_expiration * 1000).toISOString() : null,
        app: x.id,
      });
    }
  };
  add(j.specials, 'promo', 10);
  add(j.new_releases, 'new', 8);
  add(j.coming_soon, 'soon', 6);
  return out;
}

async function epic() {
  const j = await getJson(`https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=${WEB_LANG[lang] || 'fr'}&country=FR&allowCountries=FR`);
  const out = [];
  for (const e of (j.data && j.data.Catalog && j.data.Catalog.searchStore && j.data.Catalog.searchStore.elements) || []) {
    const p = e.promotions || {};
    const free = offers => (offers || []).flatMap(o => o.promotionalOffers || []).find(o => o.discountSetting && o.discountSetting.discountPercentage === 0);
    const now = free(p.promotionalOffers), soon = free(p.upcomingPromotionalOffers);
    const offer = now || soon;
    if (!offer) continue;
    const slug = ((e.catalogNs && e.catalogNs.mappings) || []).concat(e.offerMappings || []).map(m => m.pageSlug).find(Boolean) || e.productSlug;
    if (!slug) continue;
    const img = (e.keyImages || []).find(i => i.type === 'OfferImageWide') || (e.keyImages || []).find(i => i.type === 'DieselStoreFrontWide') || (e.keyImages || [])[0];
    const base = e.price && e.price.totalPrice && e.price.totalPrice.originalPrice;
    out.push({
      id: 'epic:' + String(slug).replace(/\/.*$/, ''), store: 'epic', kind: now ? 'free' : 'soon-free', title: clean(e.title),
      // Version réduite par le serveur d'images d'Epic : ~40 Ko au lieu de ~3 Mo (image d'origine en 2560 px)
      image: img && /^https:\/\/cdn\d*\.epicgames\.com\//.test(img.url) ? img.url + '?h=360&w=640&resize=1&quality=medium' : img ? img.url : null,
      price: { final: 'Gratuit', base: base ? euros(base) : null, pct: 100 },
      from: offer.startDate, until: offer.endDate,
      slug: String(slug).replace(/\/.*$/, ''),
    });
  }
  return out;
}

async function gog() {
  const q = `productType=in:game,pack&countryCode=FR&locale=${lang === 'fr' ? 'fr-FR' : WEB_LANG[lang] || 'en-US'}&currencyCode=EUR`;
  const [promo, fresh] = await Promise.all([
    getJson(`https://catalog.gog.com/v1/catalog?limit=10&order=desc:trending&discounted=eq:true&${q}`),
    getJson(`https://catalog.gog.com/v1/catalog?limit=6&order=desc:releaseDate&releaseStatuses=in:new-arrival&${q}`).catch(() => ({ products: [] })),
  ]);
  const item = (p, kind) => ({
    id: 'gog:' + p.id, store: 'gog', kind, title: clean(p.title),
    // Variante « _ggvgm » (jpeg ~40 Ko) au lieu du png d'origine (~1,4 Mo)
    image: p.coverHorizontal ? p.coverHorizontal.replace(/\.(png|jpg|webp)$/i, '_ggvgm.jpg') : null,
    price: p.price && p.price.discount ? { final: p.price.final, base: p.price.base, pct: Math.abs(parseInt(p.price.discount, 10)) || null } : p.price ? { final: p.price.final } : null,
    url: /^https:\/\/www\.gog\.com\//.test(p.storeLink || '') ? p.storeLink : null,
  });
  return [...(promo.products || []).map(p => item(p, 'promo')), ...(fresh.products || []).map(p => item(p, 'new'))].filter(x => x.url);
}

// Jeux offerts sur d'autres boutiques (IndieGala, itch.io, Steam, GOG…) ; Epic a sa propre source
async function gamerpower() {
  const list = await getJson('https://www.gamerpower.com/api/giveaways?type=game&platform=pc&sort-by=popularity');
  return (Array.isArray(list) ? list : [])
    .filter(x => x.status === 'Active' && !/epic games/i.test(x.platforms || ''))
    .slice(0, 8)
    .map(x => {
      const m = /^(.*?)\s*\(([^)]+)\)\s*Giveaway$/i.exec(x.title || '');
      return {
        id: 'gp:' + x.id, store: 'gamerpower', kind: 'free', title: clean(m ? m[1] : String(x.title || '').replace(/\s*Giveaway$/i, '')),
        shop: m ? m[2] : null,
        image: x.image || x.thumbnail || null,
        price: { final: 'Gratuit', base: x.worth && x.worth !== 'N/A' ? x.worth : null, pct: 100 },
        until: /^\d{4}-\d\d-\d\d/.test(x.end_date || '') ? new Date(x.end_date.replace(' ', 'T') + 'Z').toISOString() : null,
        url: /^https:\/\/www\.gamerpower\.com\/open\//.test(x.open_giveaway_url || '') ? x.open_giveaway_url : null,
      };
    })
    .filter(x => x.url);
}

const SOURCES = { steam, epic, gog, gamerpower };

// ---------------------------------------------------------------- cache et rafraîchissement
/** opts.lang : langue de l'interface (fonction), pour les titres des offres */
function create(dataDir, opts = {}) {
  const curLang = () => (opts.lang ? opts.lang() : 'fr');
  const FILE = path.join(dataDir, 'deals.json');
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { cache = null; }
  let running = null;

  async function refresh() {
    if (running) return running;
    running = (async () => {
      lang = curLang();
      const results = await Promise.allSettled(Object.entries(SOURCES).map(async ([name, fn]) => [name, await fn()]));
      const items = [], sources = {};
      for (const r of results) {
        if (r.status === 'fulfilled') { const [name, list] = r.value; sources[name] = { ok: true, count: list.length }; items.push(...list); }
      }
      Object.keys(SOURCES).forEach((name, i) => { if (results[i].status === 'rejected') sources[name] = { ok: false, error: results[i].reason && results[i].reason.message }; });
      // Un même jeu vu par deux sources : on garde le premier (Epic avant GamerPower, promo avant nouveauté)
      const seen = new Set();
      const unique = items.filter(x => { const k = x.store + ':' + key(x.title); if (seen.has(k)) return false; seen.add(k); return true; });
      // Rien obtenu (hors ligne) : on garde l'ancienne liste
      if (unique.length || !cache) {
        cache = { t: Date.now(), lang, items: unique, sources };
        try { fs.writeFileSync(FILE, JSON.stringify(cache)); } catch { /* disque plein ou protégé */ }
      }
      return cache;
    })().finally(() => { running = null; });
    return running;
  }

  /** Liste en cache (même ancienne) ; rafraîchie en arrière-plan quand elle a plus de 4 h. */
  function get({ allowRefresh = true } = {}) {
    // Au-delà de 4 h, ou préparée dans une autre langue que celle de l'interface
    const stale = !cache || Date.now() - cache.t > MAX_AGE || (cache.lang || 'fr') !== curLang();
    if (stale && allowRefresh) refresh().catch(() => {});
    return cache ? { ...cache, stale } : { t: 0, items: [], sources: {}, stale: true, loading: !!running };
  }

  const find = id => (cache ? cache.items.find(x => x.id === id) : null);
  return { get, refresh, find };
}

/**
 * Adresse à ouvrir pour un bon plan : l'application de la boutique si elle est installée (Steam,
 * Epic), sinon sa page web. Seules des adresses construites ici, ou vérifiées à la lecture.
 */
function target(item, installed = {}) {
  if (!item) return null;
  if (item.store === 'steam' && Number.isInteger(item.app)) return installed.steam ? `steam://store/${item.app}` : `https://store.steampowered.com/app/${item.app}/`;
  if (item.store === 'epic' && /^[a-z0-9-]+$/i.test(item.slug || '')) return installed.epic ? `com.epicgames.launcher://store/p/${item.slug}` : `https://store.epicgames.com/${WEB_LANG[lang] || 'fr'}/p/${item.slug}`;
  if ((item.store === 'gog' || item.store === 'gamerpower') && item.url) return item.url;
  return null;
}

module.exports = { create, target };
