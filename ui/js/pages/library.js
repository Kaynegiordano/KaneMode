// Bibliothèque : onglets (installés, types, favoris, émulation, collections, boutiques), tri, grille.
import { el, esc, icon, lib, favs, settings, saveSettings, sourceOf, store, sfx } from '../core.js';
import { definePage, nav, go, focusIn, glyph, renderHints } from '../nav.js';
import { gameCard } from '../cards.js';
import { openGame, setBackground, heroUrl } from './game.js';

const shoulder = k => { const s = el('span', 'shoulder', glyph(k)); s.dataset.glyph = k; return s; };
const clean = n => n.replace(/[™®]/g, '');
/** Initiale d'un jeu pour le tri par nom : lettre sans accent, « # » pour un chiffre ou un symbole. */
const initial = g => {
  const c = clean(g.name).trim().normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

// Comme sur SteamOS : en parcourant une longue liste triée par nom, la lettre en cours s'affiche sur
// le côté, à la hauteur qui correspond à l'endroit où l'on est dans la liste (comme un ascenseur)
const MANY = 40; // en dessous, la liste se parcourt d'un coup d'œil : pas de lettre
let letterEl, letterTimer;
function showLetter(ch, ratio) {
  if (!letterEl) { letterEl = el('div', 'letter-hint'); document.body.append(letterEl); }
  if (letterEl.textContent !== ch) letterEl.textContent = ch;
  letterEl.style.top = `${14 + Math.min(1, Math.max(0, ratio)) * 68}%`;
  letterEl.classList.add('show');
  clearTimeout(letterTimer);
  letterTimer = setTimeout(() => letterEl.classList.remove('show'), 750);
}

const SORTS = [
  { id: 'name', label: 'Nom', fn: (a, b) => clean(a.name).localeCompare(clean(b.name), 'fr') },
  { id: 'recent', label: 'Dernière session', fn: (a, b) => b.lastPlayed - a.lastPlayed },
  { id: 'playtime', label: 'Temps de jeu', fn: (a, b) => b.playtime - a.playtime },
  { id: 'size', label: 'Taille', fn: (a, b) => b.sizeOnDisk - a.sizeOnDisk },
];

function tabs() {
  const vis = lib.visible();
  const has = f => vis.some(f);
  const list = [
    { id: 'installed', label: 'Installés', filter: g => g.installed },
    { id: 'all', label: 'Tout', filter: () => true },
    { id: 'favs', label: 'Favoris', filter: g => favs.has(g.id) },
    { id: 'games', label: 'Jeux', filter: g => g.type === 'game' && g.installed },
    { id: 'apps', label: 'Applications', filter: g => g.type === 'app' },
  ];
  if (has(g => !g.installed)) list.push({ id: 'uninstalled', label: 'Non installés', filter: g => !g.installed });
  // Équivalent de « Great on Deck » : jeux notés compatibles manette par la boutique Steam.
  if (has(g => g.meta && g.meta.controller === 'full')) list.push({ id: 'pad', label: 'Compatibles manette', filter: g => g.installed && g.meta && g.meta.controller === 'full' });
  if (has(g => g.source === 'rom')) list.push({ id: 'rom', label: 'Émulation', color: sourceOf('rom').color, filter: g => g.source === 'rom' });
  for (const c of lib.collections) list.push({ id: 'col:' + c.id, label: c.name, collection: true, filter: g => c.ids.includes(g.id) });
  const sources = [...new Set(vis.map(g => g.source))].filter(s => s !== 'rom')
    .sort((a, b) => (a === 'steam' ? -1 : b === 'steam' ? 1 : a.localeCompare(b)));
  for (const s of sources) list.push({ id: 'src:' + s, label: sourceOf(s).label, color: sourceOf(s).color, filter: g => g.source === s });
  if (lib.games.some(g => g.hidden)) list.push({ id: 'hidden', label: 'Masqués', filter: g => g.hidden, all: true });
  return list;
}

definePage('library', {
  libBound: true,
  title: () => 'Bibliothèque',
  render(params = {}) {
    if (params.tab) { this.tab = params.tab; params.tab = null; }
    this.tab = this.tab || store.get('libtab', 'installed');
    const list = tabs();
    const cur = list.find(t => t.id === this.tab) || list[0];
    this.tab = cur.id;
    store.set('libtab', this.tab);
    const root = this.el;
    root.innerHTML = '';

    const bar = el('div', 'toolbar');
    bar.append(shoulder('lb'));
    for (const t of list) {
      const pool = t.all ? lib.games : lib.visible();
      const b = el('div', 'tab' + (t.id === cur.id ? ' active' : ''),
        `${t.color ? `<span class="dot" style="--src:${t.color}"></span>` : ''}${t.collection ? icon('i-collection') : ''}${esc(t.label)}<span class="count">${pool.filter(t.filter).length}</span>`);
      bar.append(nav(b, () => this.setTab(t.id, true), 'tab:' + t.id));
    }
    bar.append(shoulder('rb'), el('span', 'spacer'));
    const sort = SORTS.find(s => s.id === settings.sort) || SORTS[0];
    const sb = el('div', 'chip-btn', `${icon('i-sort')}Tri : ${sort.label}`);
    bar.append(nav(sb, () => {
      settings.sort = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length].id;
      saveSettings();
      this.render();
      focusIn(this.el, 'sort');
    }, 'sort'));
    const add = el('div', 'chip-btn primary', `${icon('i-plus')}Ajouter`);
    bar.append(nav(add, () => go('add'), 'add'));
    root.append(bar);

    let items = (cur.all ? lib.games : lib.visible()).filter(cur.filter);
    // Émulation : filtre secondaire par console
    if (cur.id === 'rom') {
      const systems = [...new Map(items.map(g => [g.system, g.systemName])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
      if (!systems.some(([id]) => id === this.sys)) this.sys = 'all';
      const sub = el('div', 'subtabs');
      for (const [id, name] of [['all', 'Toutes les consoles'], ...systems]) {
        const n = id === 'all' ? items.length : items.filter(g => g.system === id).length;
        const t = el('div', 'tab' + (this.sys === id ? ' active' : ''), `${esc(name)}<span class="count">${n}</span>`);
        sub.append(nav(t, () => { this.sys = id; this.render(); focusIn(this.el, 'sys:' + id); }, 'sys:' + id));
      }
      root.append(sub);
      if (this.sys !== 'all') items = items.filter(g => g.system === this.sys);
    }
    items.sort(sort.fn);
    const grid = el('div', 'grid');
    items.forEach(g => grid.append(gameCard(g, 'capsule', openGame)));
    root.append(grid);
    if (!items.length) {
      root.append(el('div', 'empty',
        cur.id === 'favs' ? `Aucun favori pour l’instant. Sur la fiche d’un jeu, appuyez sur ${glyph('x')} pour l’ajouter.`
          : cur.collection ? 'Collection vide. Sur la fiche d’un jeu, choisissez « Collections » pour l’y ranger.'
            : 'Rien ici pour le moment.'));
    }
    renderHints(); // « Lettres » selon la taille de la liste affichée
  },
  setTab(id, keepOnTab) {
    if (id === this.tab) return;
    this.tab = id;
    this.render();
    this.el.scrollTop = 0;
    if (keepOnTab) focusIn(this.el, 'tab:' + id);
    else focusIn(this.el.querySelector('.grid') || this.el);
  },
  onFocus(t) {
    const g = t.dataset.id && lib.byId(t.dataset.id);
    if (!g) return;
    setBackground(heroUrl(g));
    // Lettre en cours, seulement quand on change de rangée (pas en allant à gauche ou à droite)
    const grid = t.closest('.grid');
    if (settings.sort === 'name' && grid && grid.children.length >= MANY) {
      const top = t.offsetTop;
      if (this.lastTop !== undefined && top !== this.lastTop) showLetter(initial(g), [...grid.children].indexOf(t) / (grid.children.length - 1));
      this.lastTop = top;
    }
  },
  /** Gâchettes (tri par nom) : début de la lettre suivante, ou de la lettre en cours puis de la précédente. */
  jumpLetter(dir) {
    if (settings.sort !== 'name') return false;
    const cards = [...this.el.querySelectorAll('.grid [data-id]')];
    if (cards.length < MANY) return false;
    const letters = cards.map(c => { const g = lib.byId(c.dataset.id); return g ? initial(g) : '#'; });
    let i = Math.max(0, cards.findIndex(c => c.classList.contains('focused')));
    const start = j => { while (j > 0 && letters[j - 1] === letters[j]) j--; return j; };
    if (dir > 0) {
      const here = letters[i];
      while (i < cards.length && letters[i] === here) i++;
      if (i >= cards.length) return true;
    } else {
      const s = start(i);
      if (s === i && i === 0) return true;
      i = s === i ? start(i - 1) : s;
    }
    sfx('move');
    focusIn(this.el, cards[i].dataset.key);
    this.lastTop = cards[i].offsetTop;
    showLetter(letters[i], i / (cards.length - 1));
    return true;
  },
  button(k) {
    if (k === 'lt' || k === 'rt') return this.jumpLetter(k === 'rt' ? 1 : -1);
    if (k !== 'lb' && k !== 'rb') return false;
    const list = tabs();
    const i = list.findIndex(t => t.id === this.tab);
    const next = list[(i + (k === 'rb' ? 1 : -1) + list.length) % list.length];
    const onTab = this.el.querySelector('.tab.focused');
    sfx('move');
    this.setTab(next.id, !!onTab);
    return true;
  },
  hints() {
    const many = settings.sort === 'name' && this.el.querySelectorAll('.grid [data-id]').length >= MANY;
    return [[['lb', 'rb'], '<span class="label-long">Onglets</span>'], ...(many ? [[['lt', 'rt'], '<span class="label-long">Lettres</span>']] : []), ['y', 'Rechercher'], ['a', 'Ouvrir'], ['b', 'Retour']];
  },
});
