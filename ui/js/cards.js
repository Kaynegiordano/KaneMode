// Cartes de jeux : jaquettes, jaquettes générées quand il n'y a pas de visuel, badges.
import { t } from './i18n.js';
import { el, esc, favs, sourceOf } from './core.js';
import { nav } from './nav.js';

const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const initials = name => String(name).replace(/[™®©]/g, '').split(/[\s:–-]+/).filter(w => /^[\p{L}\p{N}]/u.test(w))
  .slice(0, 2).map(w => w[0]).join('').toUpperCase();

// Couleur dominante d'une icône, pour teinter les jaquettes générées.
const tints = new Map();
function tintFrom(url, target) {
  if (tints.has(url)) return apply(target, tints.get(url));
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
        if (d[i + 3] < 128 || max - min < 30) continue; // ignore transparent et gris
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      const t = n ? [r / n, g / n, b / n].map(Math.round) : null;
      tints.set(url, t);
      apply(target, t);
    } catch { /* image d'une autre origine : pas de teinte */ }
  };
  img.src = url;
}
function apply(target, t) {
  if (!t) return;
  const [r, g, b] = t;
  target.style.setProperty('--c1', `rgb(${r * 0.75 | 0} ${g * 0.75 | 0} ${b * 0.75 | 0})`);
  target.style.setProperty('--c2', `rgb(${r * 0.18 | 0} ${g * 0.18 | 0} ${b * 0.18 | 0})`);
}

export function generated(g, { showName = true } = {}) {
  const d = el('div', 'gen');
  d.style.setProperty('--h', hash(g.name) % 360);
  if (g.art && g.art.icon) {
    d.style.setProperty('--icon', `url("${g.art.icon}")`);
    d.innerHTML = `<img class="gen-icon" src="${g.art.icon}" alt="">`;
    tintFrom(g.art.icon, d);
  } else {
    d.innerHTML = `<div class="gen-initials">${esc(initials(g.name) || '?')}</div>`;
  }
  if (showName) d.insertAdjacentHTML('beforeend', `<div class="gen-name">${esc(g.name)}</div>`);
  return d;
}

/** Image avec repli : essaie chaque URL, puis une jaquette générée. */
export function art(g, urls, opts) {
  const list = urls.filter(Boolean);
  const wrap = document.createDocumentFragment();
  if (!list.length) { wrap.append(generated(g, opts)); return wrap; }
  const img = new Image();
  img.alt = g.name;
  img.decoding = 'async';
  img.loading = 'lazy'; // jaquettes hors de l'écran chargées au dernier moment
  let i = 0;
  // Apparaît en fondu une fois chargée (tout de suite si elle est déjà en cache)
  img.onload = () => img.classList.add('ready');
  img.onerror = () => { i++; if (i < list.length) img.src = list[i]; else img.replaceWith(generated(g, opts)); };
  img.src = list[0];
  if (img.complete && img.naturalWidth) img.classList.add('ready', 'instant');
  wrap.append(img);
  return wrap;
}

const cardUrls = (g, card) => card.classList.contains('capsule') ? [g.art.portrait] : [g.art.header, g.art.hero];

/** Visuel d'une carte changé (SteamGridDB, choix de l'utilisateur) : remplacé sur place, sans à-coup. */
export function swapArt(card, g) {
  const old = card.querySelector(':scope > img, :scope > .gen');
  const urls = cardUrls(g, card).filter(Boolean);
  if (!old || !urls.length) return;
  // On garde l'ancien visuel jusqu'à ce que le nouveau soit prêt
  const probe = new Image();
  probe.onload = () => { if (old.isConnected) old.replaceWith(art(g, urls)); };
  probe.src = urls[0];
}

export function badges(card, g) {
  card.querySelectorAll('.badges, .src-badge, .sys-badge').forEach(b => b.remove());
  card.classList.toggle('uninstalled', !g.installed);
  const b = el('div', 'badges');
  if (g.demo) b.append(el('span', 'badge-demo', t('DÉMO')));
  if (!g.installed) b.append(el('span', 'badge-dl', '<svg><use href="#i-download2"/></svg>'));
  if (favs.has(g.id)) b.append(el('span', 'badge-fav', '★'));
  if (b.children.length) card.append(b);
  if (g.systemName) card.append(el('span', 'sys-badge', esc(g.systemName)));
  const s = sourceOf(g.source);
  const sb = el('span', 'src-badge', esc(g.systemName && g.source === 'rom' ? g.systemName : s.short || s.label));
  sb.style.setProperty('--src', s.color);
  card.append(sb);
}

/** Carte d'un jeu : kind = 'capsule' (portrait) ou 'wide' (bandeau). */
export function gameCard(g, kind, onOpen) {
  const c = el('div', `card ${kind}`);
  nav(c, () => onOpen(g), g.id);
  c.dataset.id = g.id;
  c.append(art(g, cardUrls(g, c)));
  badges(c, g);
  return c;
}
