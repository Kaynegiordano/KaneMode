// Accueil : jeux récents, émulation, streaming KanePlay, applications, boutiques, sortie vers le bureau.
import { el, esc, icon, lib, fmt, sourceOf, settings } from '../core.js';
import { definePage, nav, go } from '../nav.js';
import { gameCard } from '../cards.js';
import { openGame, openLauncher, setBackground, heroUrl, exitToDesktop } from './game.js';

const byRecent = (a, b) => b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name, 'fr');

definePage('home', {
  libBound: true,
  render() {
    const root = this.el;
    root.innerHTML = '';
    const vis = lib.visible();
    // Les jeux en streaming n'apparaissent dans les récents qu'une fois lancés depuis KaneMode.
    const games = vis.filter(g => g.type === 'game' && g.installed && g.source !== 'rom' && (g.source !== 'kaneplay' || g.lastPlayed)).sort(byRecent);

    // En-tête : titre + bouton bien visible pour revenir au bureau Windows
    const top = el('div', 'home-top');
    top.append(el('h2', 'row-title', 'Jeux récents'));
    const desk = el('div', 'btn-desktop', `${icon('i-desktop')}Bureau Windows`);
    top.append(nav(desk, exitToDesktop, 'desktop'));
    root.append(top);

    const row = el('div', 'row');
    games.slice(0, 12).forEach(g => row.append(gameCard(g, 'capsule', openGame)));
    const more = el('div', 'card capsule more-card', `${icon('i-grid')}<div>Toute la bibliothèque</div><small>${vis.length} éléments</small>`);
    more.dataset.autofocus = '';
    if (games.length) delete more.dataset.autofocus;
    row.append(nav(more, () => go('library'), 'more'));
    root.append(row);
    // Le premier jeu récent reçoit le focus au démarrage, pas le bouton du haut.
    const first = row.querySelector('.card');
    if (first) first.dataset.autofocus = '';

    this.info = el('div', 'home-info');
    if (!vis.length) this.info.innerHTML = '<h1>Bibliothèque vide</h1><p>Aucun jeu détecté. Ajoutez-en un, ou activez la bibliothèque de démonstration dans les Paramètres.</p>';
    root.append(this.info);

    const roms = vis.filter(g => g.source === 'rom').sort(byRecent);
    if (roms.length) {
      root.append(el('h2', 'row-title', `Émulation <small>${roms.length} jeux · ${new Set(roms.map(r => r.system)).size} consoles</small>`));
      const rrow = el('div', 'row');
      roms.slice(0, 14).forEach(g => rrow.append(gameCard(g, 'capsule', openGame)));
      const all = el('div', 'card capsule more-card', `${icon('i-rom')}<div>Toute l’émulation</div>`);
      rrow.append(nav(all, () => go('library', { tab: 'rom' }), 'more-rom'));
      root.append(rrow);
    }

    // Streaming intégré : jeux des PC appairés, et accès à la page Streaming (PC, appairage, qualité)
    const streams = vis.filter(g => g.source === 'kaneplay').sort(byRecent);
    const st = lib.stream || { engine: false, hosts: [] };
    if (streams.length || st.hosts.length) {
      const paired = st.hosts.filter(h => h.paired).map(h => h.name);
      const waiting = st.hosts.filter(h => !h.paired);
      root.append(el('h2', 'row-title', `Streaming <small>${paired.length ? esc(paired.join(', ')) : 'aucun PC appairé'}</small>`));
      const srow = el('div', 'row');
      streams.slice(0, 14).forEach(g => srow.append(gameCard(g, 'capsule', openGame)));
      for (const h of waiting) {
        const t = el('div', 'card capsule more-card', `${icon('i-link')}<div>Appairer ${esc(h.name)}</div><small>Pour jouer à ses jeux ici</small>`);
        srow.append(nav(t, () => go('stream', { focus: 'pair:' + h.uuid }), 'pair:' + h.uuid));
      }
      const all = el('div', 'card capsule more-card', `${icon('i-wifi')}<div>Streaming</div><small>Vos PC · qualité</small>`);
      srow.append(nav(all, () => go('stream'), 'more-stream'));
      root.append(srow);
    }

    if (settings.homeApps) {
      const apps = vis.filter(g => g.type === 'app' && g.installed && g.source !== 'kaneplay').sort(byRecent);
      root.append(el('h2', 'row-title', `Applications <small>${apps.length}</small>`));
      const arow = el('div', 'row');
      apps.forEach(g => arow.append(gameCard(g, 'wide', openGame)));
      const add = el('div', 'card wide more-card', `${icon('i-plus')}<div>Ajouter un jeu ou une appli</div>`);
      arow.append(nav(add, () => go('add'), 'add'));
      root.append(arow);
    }

    if (settings.homeStores) {
      const installed = lib.launchers.filter(l => l.installed);
      root.append(el('h2', 'row-title', `Boutiques et plateformes <small>${installed.length} détectées sur ce PC</small>`));
      const lrow = el('div', 'row');
      for (const l of installed) {
        const count = vis.filter(g => g.source === l.id).length;
        const t = el('div', 'card tile launcher-tile',
          `${l.icon ? `<img src="${l.icon}" alt="">` : icon('i-store')}<span>${esc(l.name)}<small>${count ? `${count} élément${count > 1 ? 's' : ''} · ` : ''}${esc(l.sub || '')}</small></span>`);
        t.style.setProperty('--src', sourceOf(l.id).color);
        lrow.append(nav(t, () => openLauncher(l), 'launcher:' + l.id));
      }
      const deskTile = el('div', 'card tile launcher-tile', `${icon('i-desktop')}<span>Bureau Windows<small>Fermer KaneMode</small></span>`);
      deskTile.style.setProperty('--src', '#2a7fe0');
      lrow.append(nav(deskTile, exitToDesktop, 'desktop-tile'));
      root.append(lrow);
    }
  },
  onFocus(t) {
    const g = t.dataset.id && lib.byId(t.dataset.id);
    if (!g) return;
    setBackground(heroUrl(g));
    const s = sourceOf(g.source);
    const m = g.meta || {};
    this.info.innerHTML = `<h1>${esc(g.name)}</h1>
      <p><span class="pill src" style="--src:${s.color}">${esc(g.systemName || (g.streamHost ? `KanePlay · ${g.streamHost}` : s.label))}</span>
      ${g.demo ? '<span class="pill demo">Démo</span>' : ''}
      <span>Dernière session : <b>${fmt.played(g.lastPlayed)}</b></span>
      ${g.playtime ? `<span>${icon('i-clock').replace('<svg', '<svg width="14" height="14" style="fill:currentColor;vertical-align:-2px;margin-right:4px"')}${fmt.playtime(g.playtime)}</span>` : ''}
      ${g.sizeOnDisk ? `<span>${fmt.size(g.sizeOnDisk)}</span>` : ''}
      ${m.genres && m.genres.length ? `<span>${esc(m.genres.slice(0, 3).join(' · '))}</span>` : ''}</p>`;
  },
  hints: () => [['y', 'Rechercher'], ['a', 'Ouvrir']],
});
