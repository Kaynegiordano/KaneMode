// Recherche : clavier virtuel intégré, résultats en direct (nom, genres, développeur, boutique).
import { el, lib, normName, sourceOf, sfx } from '../core.js';
import { definePage, focusIn } from '../nav.js';
import { gameCard } from '../cards.js';
import { keyboard, textField, typingHandler } from '../widgets.js';
import { openGame, setBackground, heroUrl } from './game.js';

function matches(g, q) {
  const hay = normName([g.name, sourceOf(g.source).label, ...((g.meta && g.meta.genres) || []), ...((g.meta && g.meta.developers) || [])].join(' '));
  return q.split(' ').every(w => hay.includes(w));
}

definePage('search', {
  libBound: true,
  title: () => 'Rechercher',
  q: '',
  render() {
    const root = this.el;
    this.field = textField('Rechercher un jeu, une appli, un genre, une boutique…', 'i-search');
    this.count = el('div', 'row-title');
    this.results = el('div', 'results');
    const dock = el('div', 'dock');
    dock.append(keyboard({
      onChar: c => this.set(this.q + c),
      onBackspace: () => this.set(this.q.slice(0, -1)),
      onSubmit: () => focusIn(this.results),
      submitLabel: 'Résultats',
    }));
    dock.querySelector('[data-key="k1-0"]').dataset.autofocus = '';
    root.replaceChildren(this.field, this.count, this.results, dock);
    // Propriété (et non méthode) : le moteur de navigation l'appelle sans contexte.
    this.typing = typingHandler(() => this.q, v => this.set(v), () => focusIn(this.results));
    this.set(this.q);
  },
  set(v) {
    this.q = v;
    this.field.paint(v);
    const q = normName(v);
    const pool = lib.visible();
    const found = q ? pool.filter(g => matches(g, q)) : [...pool].sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 12);
    this.count.innerHTML = q ? `${found.length} résultat${found.length > 1 ? 's' : ''}` : 'Récemment joués <small>tapez pour rechercher</small>';
    const grid = el('div', 'grid');
    found.slice(0, 40).forEach(g => grid.append(gameCard(g, 'capsule', openGame)));
    this.results.replaceChildren(grid);
  },
  onFocus(t) {
    const g = t.dataset.id && lib.byId(t.dataset.id);
    if (g) setBackground(heroUrl(g));
  },
  leave() { this.typing = null; },
  button(k) {
    if (k === 'x') { this.set(this.q.slice(0, -1)); sfx('key'); return true; }
    if (k === 'y') { this.set(this.q + ' '); sfx('key'); return true; }
    return false;
  },
  hints: () => [['x', 'Effacer'], ['y', 'Espace'], ['a', 'Sélectionner'], ['b', 'Retour']],
});
