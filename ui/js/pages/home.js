// Accueil : jeux récents (et KanePlay), émulation, applications, boutiques.
import { t, tn } from '../i18n.js';
import { el, esc, icon, lib, fmt, sourceOf, settings, mergeOrder, favs } from '../core.js';
import { definePage, nav, go, hooks } from '../nav.js';
import { gameCard } from '../cards.js';
import { openGame, openLauncher, setBackground, heroUrl, running, resumeGame, launch, queryGame } from './game.js';
import { normalizePins, resumeEntry } from '../personalization.js';
import { dealsRow, findDeal, dealLine } from '../deals.js';

const byRecent = (a, b) => b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name, 'fr');

/** Rangées de l'accueil après les jeux récents : ordre et affichage personnalisables. */
export const HOME_ROWS = [
  { id: 'pins', label: t('Épinglés'), desc: t('Vos jeux et collections préférés') },
  { id: 'recent', label: t('Jeux récents'), desc: t('Vos dernières parties') },
  { id: 'favorites', label: t('Favoris'), desc: t('Tous vos jeux marqués d’une étoile') },
  { id: 'emulation', label: t('Émulation'), desc: t('Vos ROMs, par dernière partie') },
  { id: 'apps', label: t('Applications'), desc: t('Applis et raccourcis ajoutés') },
  { id: 'deals', label: t('Bons plans et nouveautés'), desc: t('Promos, nouveautés et jeux gratuits de Steam, Epic, GOG…') },
  { id: 'stores', label: t('Boutiques et plateformes'), desc: t('Lanceurs détectés') },
];
export function homeRows() {
  // Une rangée nouvelle (ex. bons plans) prend sa place par défaut, pas la dernière
  const order = mergeOrder(HOME_ROWS.map(r => r.id), settings.homeRows);
  const hidden = new Set(settings.homeHidden || []);
  if (settings.homeApps === false) hidden.add('apps');
  if (settings.homeStores === false) hidden.add('stores');
  return order.filter(id => !hidden.has(id));
}

const ROWS = {
  recent(root, vis) {
    const games = vis.filter(g => g.type === 'game' && g.installed && g.source !== 'rom' && g.source !== 'kaneplay').sort(byRecent);
    root.append(el('h2', 'row-title', t('Jeux récents')));
    const row = el('div', 'row'); games.slice(0, 12).forEach(g => row.append(gameCard(g, 'capsule', openGame)));
    row.append(nav(el('div', 'card capsule more-card', t('{a}<div>Toute la bibliothèque</div><small>{length} éléments</small>', { a: icon('i-grid'), length: vis.length })), () => go('library'), 'more'));
    root.append(row);
  },
  favorites(root, vis) {
    const games = vis.filter(g => favs.has(g.id)); if (!games.length) return;
    root.append(el('h2', 'row-title', t('Favoris')));
    const row = el('div', 'row'); games.slice(0, 14).forEach(g => row.append(gameCard(g, 'capsule', openGame)));
    root.append(row);
  },
  pins(root, vis) {
    const pins = normalizePins(settings.homePins, vis, lib.collections); if (!pins.length) return;
    root.append(el('h2', 'row-title', t('Épinglés')));
    const row = el('div', 'row');
    for (const pin of pins) {
      if (pin.type === 'game') {
        const card = gameCard(lib.byId(pin.id), 'capsule', openGame); card.dataset.key = 'pin-game:' + pin.id; row.append(card);
      } else {
        const collection = lib.collections.find(c => c.id === pin.id);
        const count = vis.filter(g => collection.ids.includes(g.id)).length;
        row.append(nav(el('div', 'card capsule collection-pin', icon('i-collection') + '<b>' + esc(collection.name) + '</b><small>' + tn(count, '{n} jeu', '{n} jeux') + '</small>'), () => go('library', { tab: 'col:' + collection.id }), 'pin-collection:' + pin.id));
      }
    }
    root.append(row);
  },
  emulation(root, vis) {
    const roms = vis.filter(g => g.source === 'rom').sort(byRecent);
    if (!roms.length) return;
    root.append(el('h2', 'row-title', t('Émulation <small>{length} jeux · {size} consoles</small>', { length: roms.length, size: new Set(roms.map(r => r.system)).size })));
    const rrow = el('div', 'row');
    roms.slice(0, 14).forEach(g => rrow.append(gameCard(g, 'capsule', openGame)));
    const all = el('div', 'card capsule more-card', t('{a}<div>Toute l’émulation</div>', { a: icon('i-rom') }));
    rrow.append(nav(all, () => go('library', { tab: 'rom' }), 'more-rom'));
    root.append(rrow);
  },
  apps(root, vis) {
    const apps = vis.filter(g => g.type === 'app' && g.installed && g.source !== 'kaneplay').sort(byRecent);
    root.append(el('h2', 'row-title', t('Applications <small>{length}</small>', { length: apps.length })));
    const arow = el('div', 'row');
    apps.forEach(g => arow.append(gameCard(g, 'wide', openGame)));
    const add = el('div', 'card wide more-card', t('{a}<div>Ajouter un jeu ou une appli</div>', { a: icon('i-plus') }));
    arow.append(nav(add, () => go('add'), 'add'));
    root.append(arow);
  },
  deals(root) { dealsRow(root); },
  stores(root, vis) {
    const installed = lib.launchers.filter(l => l.installed);
    root.append(el('h2', 'row-title', t('Boutiques et plateformes <small>{length} détectées sur ce PC</small>', { length: installed.length })));
    const lrow = el('div', 'row');
    for (const l of installed) {
      const count = vis.filter(g => g.source === l.id).length;
      const tile = el('div', 'card tile launcher-tile',
        `${l.icon ? `<img src="${l.icon}" alt="">` : icon('i-store')}<span>${esc(l.name)}<small>${count ? `${tn(count, '{n} élément', '{n} éléments')} · ` : ''}${esc(l.sub || '')}</small></span>`);
      tile.style.setProperty('--src', sourceOf(l.id).color);
      lrow.append(nav(tile, () => openLauncher(l), 'launcher:' + l.id));
    }
    root.append(lrow);
  },
};
definePage('home', {
  libBound: true,
  title: () => 'KaneMode',
  render() {
    const root = this.el;
    root.innerHTML = '';
    const vis = lib.visible();
    const game = settings.homeResume && resumeEntry(vis, running);
    root.classList.toggle('has-resume', !!game);
    if (game) {
      queryGame(game);
      const inProgress = running.has(game.id);
      const tile = el('div', 'card resume-tile', '<span class="resume-art"></span><span class="resume-copy"><small>' + esc(inProgress ? t('Partie en cours') : t('Dernière partie')) + '</small><h1>' + esc(game.name) + '</h1><b>' + icon('i-play') + esc(inProgress ? t('Reprendre') : t('Jouer')) + '</b></span>');
      tile.dataset.id = game.id;
      tile.setAttribute('aria-label', (inProgress ? t('Reprendre') : t('Jouer')) + ' · ' + game.name);
      const image = heroUrl(game); if (image) tile.querySelector('.resume-art').style.backgroundImage = 'url(' + JSON.stringify(image) + ')';
      nav(tile, () => inProgress ? resumeGame(game) : launch(game), 'home-resume');
      root.append(tile);
    }
    this.info = el('div', 'home-info');
    if (!vis.length) this.info.innerHTML = t('<h1>Bibliothèque vide</h1><p>Aucun jeu détecté. Ajoutez-en un, ou activez la bibliothèque de démonstration dans les Paramètres.</p>');
    root.append(this.info);

    // Rangées suivantes, dans l'ordre et avec l'affichage choisis (Paramètres → Apparence)
    for (const id of homeRows()) ROWS[id](root, vis);
    if (!root.querySelector('[data-nav]')) root.append(nav(el('div', 'chip-btn home-empty-library', t('Toute la bibliothèque')), () => go('library'), 'more'));
    const first = root.querySelector('[data-nav]'); if (first) first.dataset.autofocus = '';
  },
  onFocus(target) {
    // Offre d'une boutique (rangée des bons plans) : son visuel et ses informations
    const d = target.dataset.deal && findDeal(target.dataset.deal);
    if (d) {
      if (d.image) setBackground(d.image);
      this.info.innerHTML = `<h1>${esc(d.title)}</h1><p>${dealLine(d)}</p>`;
      return;
    }
    const g = target.dataset.id && lib.byId(target.dataset.id);
    if (!g) {
      const collection = target.dataset.key?.startsWith('pin-collection:') && lib.collections.find(c => c.id === target.dataset.key.slice(15));
      const label = target.classList.contains('more-card') ? target.querySelector('div')?.textContent : target.querySelector(':scope > span')?.firstChild?.textContent;
      const detail = target.querySelector('small')?.textContent;
      this.info.innerHTML = collection
        ? '<h1>' + esc(collection.name) + '</h1><p>' + tn(lib.visible().filter(g => collection.ids.includes(g.id)).length, '{n} jeu', '{n} jeux') + '</p>'
        : '<h1>' + esc(label || target.textContent.trim()) + '</h1>' + (detail ? '<p>' + esc(detail) + '</p>' : '');
      return;
    }
    setBackground(heroUrl(g));
    const s = sourceOf(g.source);
    const m = g.meta || {};
    this.info.innerHTML = t('<h1>{a}</h1>\n      <p><span class="pill src" style="--src:{color}">{b}</span>\n      {c}\n      <span>Dernière session : <b>{played}</b></span>\n      {d}\n      {e}\n      {f}</p>', { a: esc(g.name), color: s.color, b: esc(g.systemName || (g.source === 'kaneplay' ? t("Streaming depuis vos PC") : s.label)), c: g.demo ? t("<span class=\"pill demo\">Démo</span>") : '', played: fmt.played(g.lastPlayed), d: g.playtime ? `<span>${icon('i-clock').replace('<svg', '<svg width="14" height="14" style="fill:currentColor;vertical-align:-2px;margin-right:4px"')}${fmt.playtime(g.playtime)}</span>` : '', e: g.sizeOnDisk ? `<span>${fmt.size(g.sizeOnDisk)}</span>` : '', f: m.genres && m.genres.length ? `<span>${esc(m.genres.slice(0, 3).join(' · '))}</span>` : '' });
    if (target.dataset.key === 'home-resume') this.info.querySelector('h1').hidden = true;
  },
  // B sur l'accueil (rien derrière) : le menu principal, comme Select
  back() { if (hooks.menu) { hooks.menu(); return true; } return false; },
  hints: () => [['b', t('Menu')], ['y', t('Rechercher')], ['a', t('Ouvrir')]],
});
