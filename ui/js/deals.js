// Rangée « Bons plans et nouveautés » de l'accueil : promotions, nouveautés, sorties à venir et jeux
// gratuits de Steam, Epic, GOG et d'autres boutiques (hôte : GET /api/deals, lib/deals.js). La liste
// gardée s'affiche tout de suite ; la rangée avance d'une carte toutes les 5 s tant qu'on ne la
// parcourt pas (pas en effets allégés, ni KaneMode en arrière-plan).
import { el, esc, api, toast, settings, store, native, reduceMotion } from './core.js';
import { nav, focused, input, scrollToPos, currentPage } from './nav.js';

export const STORES = {
  steam: { label: 'Steam', color: '#1a9fff' },
  epic: { label: 'Epic', color: '#3a3a3a' },
  gog: { label: 'GOG', color: '#8f3fd1' },
  gamerpower: { label: 'Offert', color: '#1f9d55' },
};
const KIND = {
  free: ['Gratuit', 'free'], 'soon-free': ['Gratuit bientôt', 'soon'], promo: [null, 'promo'], new: ['Nouveau', 'new'], soon: ['Bientôt', 'soon'],
};
// Ordre : gratuits du moment, meilleures promos, nouveautés, gratuits à venir, sorties à venir
const RANK = { free: 0, promo: 1, new: 2, 'soon-free': 3, soon: 4 };

let data = store.get('deals', null); // dernière liste reçue (affichage immédiat au démarrage)
let loading = null, lastLoad = 0, retries = 0;

const enabled = d => {
  const src = d.store === 'gamerpower' ? settings.dealsOther : settings['deals' + d.store[0].toUpperCase() + d.store.slice(1)];
  const kind = d.kind === 'free' || d.kind === 'soon-free' ? settings.dealsFree : d.kind === 'promo' ? settings.dealsPromo : d.kind === 'new' ? settings.dealsNew : settings.dealsSoon;
  return src !== false && kind !== false;
};
export const dealList = () => ((data && data.items) || []).filter(enabled)
  .sort((a, b) => RANK[a.kind] - RANK[b.kind] || ((b.price && b.price.pct) || 0) - ((a.price && a.price.pct) || 0))
  .slice(0, 24);
export const findDeal = id => ((data && data.items) || []).find(d => d.id === id);

function load() {
  if (loading) return loading;
  lastLoad = Date.now();
  loading = api.get('/api/deals').then(r => {
    if (r && r.items && r.items.length) { data = r; store.set('deals', { t: r.t, items: r.items }); }
    // Liste en cours de préparation par l'hôte (premier lancement) : redemandée un peu plus tard,
    // trois fois au plus (hors ligne, on garde ce qu'on a)
    if (r && r.stale && retries++ < 3) setTimeout(() => load().then(fill), 20000);
    else if (r && !r.stale) retries = 0;
    return data;
  }).catch(() => data).finally(() => { loading = null; });
  return loading;
}

const dateFr = iso => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
/** Ligne d'information d'une offre (panneau de l'accueil). */
export function dealLine(d) {
  const s = STORES[d.store] || {};
  const bits = [`<span class="pill src" style="--src:${s.color}">${esc(d.shop || s.label)}</span>`];
  if (d.price && d.price.final) bits.push(`<span>${d.price.base && d.price.base !== d.price.final ? `<s>${esc(d.price.base)}</s> ` : ''}<b>${esc(d.price.final)}</b>${d.price.pct && d.price.pct < 100 ? ` · −${d.price.pct} %` : ''}</span>`);
  if (d.kind === 'soon-free' && d.from) bits.push(`<span>Gratuit à partir du <b>${dateFr(d.from)}</b></span>`);
  else if (d.until) bits.push(`<span>Jusqu’au <b>${dateFr(d.until)}</b></span>`);
  if (d.kind === 'new') bits.push('<span>Nouveauté</span>');
  if (d.kind === 'soon') bits.push('<span>Sortie à venir</span>');
  return bits.join('');
}

function card(d) {
  const s = STORES[d.store] || {};
  const [kindLabel, kindCls] = KIND[d.kind] || [null, ''];
  const badge = d.kind === 'promo' && d.price && d.price.pct ? `−${d.price.pct} %` : kindLabel;
  const c = el('div', 'card wide deal-card',
    `${d.image ? `<img src="${esc(d.image)}" alt="" loading="lazy" decoding="async">` : ''}` +
    `<span class="deal-store" style="--src:${s.color}">${esc(d.shop || s.label)}</span>` +
    (badge ? `<span class="deal-badge ${kindCls}">${esc(badge)}</span>` : '') +
    `<div class="deal-foot"><b>${esc(d.title)}</b>${d.price && d.price.final ? `<small>${d.price.base && d.price.base !== d.price.final ? `<s>${esc(d.price.base)}</s> ` : ''}${esc(d.price.final)}</small>` : ''}</div>`);
  const img = c.querySelector('img');
  if (img) { img.onload = () => img.classList.add('ready'); img.onerror = () => img.remove(); if (img.complete && img.naturalWidth) img.classList.add('ready', 'instant'); }
  c.dataset.deal = d.id;
  return nav(c, () => openDeal(d), 'deal:' + d.id);
}

async function openDeal(d) {
  const s = STORES[d.store] || {};
  native.send('foreground'); // la boutique pourra passer au premier plan
  try {
    const r = await api.post('/api/deals/open', { id: d.id });
    toast(r.app ? `Ouverture dans ${s.label}…` : `Ouverture de la page ${d.shop || s.label}…`);
  } catch (e) { toast(e.message, { error: true }); }
}

let block = null;
/** Rangée à l'accueil (vide, puis remplie quand la liste arrive). */
export function dealsRow(root) {
  block = el('div', 'deals-block');
  root.append(block);
  fill();
  if ((!data || !data.items || Date.now() - (data.t || 0) > 3600e3) && Date.now() - lastLoad > 60000) load().then(fill);
}

function fill() {
  if (!block || !block.isConnected) return;
  const list = dealList();
  // Déjà affichée et parcourue : on ne la reconstruit pas sous le focus
  if (focused && block.contains(focused)) return;
  if (!list.length) { block.replaceChildren(); return; }
  const free = list.filter(d => d.kind === 'free').length;
  const row = el('div', 'row deals-row');
  list.forEach(d => row.append(card(d)));
  block.replaceChildren(el('h2', 'row-title', `Bons plans et nouveautés <small>${free ? `${free} gratuit${free > 1 ? 's' : ''} · ` : ''}Steam, Epic, GOG et plus</small>`), row);
}

// Avance automatique : une carte toutes les 5 s, seulement sur l'accueil affiché et au repos
setInterval(() => {
  if (!block || !block.isConnected || settings.dealsAuto === false || settings.lowFx || reduceMotion) return;
  if (document.hidden || !document.hasFocus() || !currentPage() || currentPage().id !== 'home') return;
  if (Date.now() - input.last < 4000) return;
  const row = block.querySelector('.deals-row');
  if (!row || (focused && row.contains(focused))) return;
  const cardW = row.firstElementChild ? row.firstElementChild.getBoundingClientRect().width / ((row.getBoundingClientRect().width / row.clientWidth) || 1) + 18 : 300;
  const max = row.scrollWidth - row.clientWidth;
  if (max <= 0) return;
  scrollToPos(row, 'x', row.scrollLeft >= max - 4 ? 0 : row.scrollLeft + cardW);
}, 5000);
