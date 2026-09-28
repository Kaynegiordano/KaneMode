// Bibliothèque : onglets (installés, types, favoris, émulation, collections, boutiques), tri, grille.
import { el, esc, icon, lib, favs, settings, saveSettings, sourceOf, store, sfx } from '../core.js';
import { definePage, nav, go, focusIn, glyph } from '../nav.js';
import { gameCard } from '../cards.js';
import { openGame, setBackground, heroUrl } from './game.js';

const shoulder = k => { const s = el('span', 'shoulder', glyph(k)); s.dataset.glyph = k; return s; };
const clean = n => n.replace(/[™®]/g, '');

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
    if (g) setBackground(heroUrl(g));
  },
  button(k) {
    if (k !== 'lb' && k !== 'rb') return false;
    const list = tabs();
    const i = list.findIndex(t => t.id === this.tab);
    const next = list[(i + (k === 'rb' ? 1 : -1) + list.length) % list.length];
    const onTab = this.el.querySelector('.tab.focused');
    sfx('move');
    this.setTab(next.id, !!onTab);
    return true;
  },
  hints: () => [[['lb', 'rb'], '<span class="label-long">Onglets</span>'], ['y', 'Rechercher'], ['a', 'Ouvrir'], ['b', 'Retour']],
});
