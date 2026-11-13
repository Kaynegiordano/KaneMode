// Recherche : clavier virtuel intégré, résultats en direct (nom, genres, développeur, boutique),
// et au-dessus les rubriques des Paramètres et les actions qui répondent au texte tapé.
import { t, tn } from '../i18n.js';
import { el, esc, icon, lib, normName, sourceOf, sfx } from '../core.js';
import { definePage, focusIn, nav, go, hooks } from '../nav.js';
import { qamShortcuts } from '../qam.js';
import { SECTIONS } from './settings.js';
import { gameCard } from '../cards.js';
import { keyboard, textField, typingHandler } from '../widgets.js';
import { openGame, setBackground, heroUrl } from './game.js';

function matches(g, q) {
  const hay = normName([g.name, sourceOf(g.source).label, ...((g.meta && g.meta.genres) || []), ...((g.meta && g.meta.developers) || [])].join(' '));
  return q.split(' ').every(w => hay.includes(w));
}

// Mots qui mènent à une rubrique des Paramètres, en plus de son nom
const SECTION_WORDS = {
  library: t('jeux dossiers analyse démonstration steam epic gog xbox comptes connexion visuels jaquettes images steamgriddb'),
  emulation: t('roms émulateurs bios consoles'), stream: t('streaming pc sunshine diffusion'),
  look: t('thème ambiance couleurs langue police animations profils démarrage vidéo intro taille'),
  home: t('accueil rangées épingles tuile reprise bons plans'), media: t('son audio casque dolby hdr écran sons volume'),
  pad: t('manette boutons accès rapide raccourcis mode souris'), energy: t('énergie batterie puissance tdp turbo veille verrouillage'),
  access: t('accessibilité taille texte'), system: t('système mises à jour version pilotes bios asus stockage disque espace mode xbox'),
};
/** Rubriques et actions qui répondent à la recherche (texte déjà normalisé). */
function shortcuts(q) {
  if (!q) return [];
  const hit = text => { const hay = normName(text); return q.split(' ').every(w => hay.includes(w)); };
  const out = [];
  for (const [id, ic, label] of SECTIONS) {
    if (hit(label + ' ' + (SECTION_WORDS[id] || ''))) out.push({ key: 'find-set:' + id, icon: ic, label, sub: t('Paramètres'), run: () => go('settings', { section: id }) });
  }
  if (hit(t('Accès rapide') + ' ' + t('luminosité volume wifi bluetooth mode nuit performance batterie'))) {
    out.push({ key: 'find-qam', icon: 'i-grid', label: t('Accès rapide'), sub: t('Réglages rapides'), run: () => hooks.qam && hooks.qam() });
  }
  for (const [ic, label, act, key] of qamShortcuts.list) {
    if (hit(label)) out.push({ key: 'find-' + key, icon: ic, label, sub: t('Action'), run: act });
  }
  if (hit(t('Ajouter un jeu ou une appli'))) out.push({ key: 'find-add', icon: 'i-plus', label: t('Ajouter un jeu ou une appli'), sub: t('Action'), run: () => go('add') });
  return out.slice(0, 6);
}

definePage('search', {
  libBound: true,
  title: () => t('Rechercher'),
  q: '',
  render() {
    const root = this.el;
    this.field = textField(t('Rechercher un jeu, un réglage, une action…'), 'i-search');
    this.count = el('div', 'row-title');
    this.results = el('div', 'results');
    this.results.dataset.zone = 'content';
    const dock = el('div', 'dock');
    dock.append(keyboard({
      onChar: c => this.set(this.q + c),
      onBackspace: () => this.set(this.q.slice(0, -1)),
      onSubmit: () => focusIn(this.results),
      submitLabel: t('Résultats'),
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
    // Rubriques des Paramètres et actions : une rangée au-dessus des jeux, comptée avec eux
    const extra = shortcuts(q);
    this.count.innerHTML = q ? tn(found.length + extra.length, '{n} résultat', '{n} résultats') : t('Récemment joués <small>tapez pour rechercher</small>');
    const grid = el('div', 'grid');
    found.slice(0, 40).forEach(g => grid.append(gameCard(g, 'capsule', openGame)));
    if (extra.length) {
      const row = el('div', 'search-shortcuts');
      for (const s of extra) row.append(nav(el('div', 'chip-btn', `${icon(s.icon)}<span>${esc(s.label)}<small>${esc(s.sub)}</small></span>`), s.run, s.key));
      this.results.replaceChildren(row, grid);
    } else this.results.replaceChildren(grid);
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
  hints: () => [['x', t('Effacer')], ['y', t('Espace')], ['a', t('Sélectionner')], ['b', t('Retour')]],
});
