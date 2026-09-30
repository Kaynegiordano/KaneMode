// Accueil : jeux récents (et KanePlay), émulation, applications, boutiques, sortie vers le bureau.
import { t, tn } from '../i18n.js';
import { el, esc, icon, lib, fmt, sourceOf, settings, mergeOrder } from '../core.js';
import { definePage, nav, go, hooks } from '../nav.js';
import { gameCard } from '../cards.js';
import { openGame, openLauncher, setBackground, heroUrl, exitToDesktop } from './game.js';
import { dealsRow, findDeal, dealLine } from '../deals.js';

const byRecent = (a, b) => b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name, 'fr');

/** Rangées de l'accueil après les jeux récents : ordre et affichage personnalisables. */
export const HOME_ROWS = [
  { id: 'emulation', label: t('Émulation'), desc: t('Vos ROMs, par dernière partie') },
  { id: 'apps', label: t('Applications'), desc: t('Applis et raccourcis ajoutés') },
  { id: 'deals', label: t('Bons plans et nouveautés'), desc: t('Promos, nouveautés et jeux gratuits de Steam, Epic, GOG…') },
  { id: 'stores', label: t('Boutiques et plateformes'), desc: t('Lanceurs détectés et tuile Bureau') },
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
    const deskTile = el('div', 'card tile launcher-tile', t('{a}<span>Bureau Windows<small>KaneMode reste ouvert</small></span>', { a: icon('i-desktop') }));
    deskTile.style.setProperty('--src', '#2a7fe0');
    lrow.append(nav(deskTile, exitToDesktop, 'desktop-tile'));
    root.append(lrow);
  },
};
definePage('home', {
  libBound: true,
  render() {
    const root = this.el;
    root.innerHTML = '';
    const vis = lib.visible();
    // Le streaming local n'est plus un « jeu » : il s'ouvre depuis le menu (et Paramètres → Streaming)
    const games = vis.filter(g => g.type === 'game' && g.installed && g.source !== 'rom' && g.source !== 'kaneplay').sort(byRecent);

    // En-tête : titre + bouton bien visible pour revenir au bureau Windows
    const top = el('div', 'home-top');
    top.append(el('h2', 'row-title', t('Jeux récents')));
    const desk = el('div', 'btn-desktop', t('{a}Bureau Windows', { a: icon('i-desktop') }));
    top.append(nav(desk, exitToDesktop, 'desktop'));
    root.append(top);

    const row = el('div', 'row');
    games.slice(0, 12).forEach(g => row.append(gameCard(g, 'capsule', openGame)));
    const more = el('div', 'card capsule more-card', t('{a}<div>Toute la bibliothèque</div><small>{length} éléments</small>', { a: icon('i-grid'), length: vis.length }));
    more.dataset.autofocus = '';
    if (games.length) delete more.dataset.autofocus;
    row.append(nav(more, () => go('library'), 'more'));
    root.append(row);
    // Le premier jeu récent reçoit le focus au démarrage, pas le bouton du haut.
    const first = row.querySelector('.card');
    if (first) first.dataset.autofocus = '';

    this.info = el('div', 'home-info');
    if (!vis.length) this.info.innerHTML = t('<h1>Bibliothèque vide</h1><p>Aucun jeu détecté. Ajoutez-en un, ou activez la bibliothèque de démonstration dans les Paramètres.</p>');
    root.append(this.info);

    // Rangées suivantes, dans l'ordre et avec l'affichage choisis (Paramètres → Apparence)
    for (const id of homeRows()) ROWS[id](root, vis);
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
    if (!g) return;
    setBackground(heroUrl(g));
    const s = sourceOf(g.source);
    const m = g.meta || {};
    this.info.innerHTML = t('<h1>{a}</h1>\n      <p><span class="pill src" style="--src:{color}">{b}</span>\n      {c}\n      <span>Dernière session : <b>{played}</b></span>\n      {d}\n      {e}\n      {f}</p>', { a: esc(g.name), color: s.color, b: esc(g.systemName || (g.source === 'kaneplay' ? t("Streaming depuis vos PC") : s.label)), c: g.demo ? t("<span class=\"pill demo\">Démo</span>") : '', played: fmt.played(g.lastPlayed), d: g.playtime ? `<span>${icon('i-clock').replace('<svg', '<svg width="14" height="14" style="fill:currentColor;vertical-align:-2px;margin-right:4px"')}${fmt.playtime(g.playtime)}</span>` : '', e: g.sizeOnDisk ? `<span>${fmt.size(g.sizeOnDisk)}</span>` : '', f: m.genres && m.genres.length ? `<span>${esc(m.genres.slice(0, 3).join(' · '))}</span>` : '' });
  },
  // B sur l'accueil (rien derrière) : le menu principal, comme Select
  back() { if (hooks.menu) { hooks.menu(); return true; } return false; },
  hints: () => [['b', t('Menu')], ['y', t('Rechercher')], ['a', t('Ouvrir')]],
});
