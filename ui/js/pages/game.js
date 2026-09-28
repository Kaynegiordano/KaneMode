// Fiche d'un jeu + actions partagées : lancement, favoris, fond d'écran, lanceurs.
import { $, $$, el, esc, icon, api, lib, fmt, favs, saveFavs, sourceOf, toast, native } from '../core.js';
import { definePage, nav, go, back, openLayer, closeLayer, topLayer, currentPage } from '../nav.js';
import { art, badges } from '../cards.js';
import { dialog, confirmDialog, openKeyboard } from '../widgets.js';

// ---------- Fond d'écran dynamique ----------
const layers = $$('.bg-layer');
let bgIdx = 0, bgWanted = '', bgTimer;
export function setBackground(src) {
  if (!src || src === bgWanted) return;
  bgWanted = src;
  clearTimeout(bgTimer);
  bgTimer = setTimeout(() => {
    const img = new Image();
    img.onload = () => {
      if (bgWanted !== src) return;
      const next = layers[bgIdx ^ 1];
      next.style.backgroundImage = `url("${src}")`;
      next.classList.add('show');
      layers[bgIdx].classList.remove('show');
      bgIdx ^= 1;
    };
    img.src = src;
  }, 140);
}
export const heroUrl = g => g.art.hero || g.art.header || g.art.portrait || null;

// ---------- Actions ----------
export const openGame = g => go('game', { id: g.id });

export function toggleFav(g) {
  favs.has(g.id) ? favs.delete(g.id) : favs.add(g.id);
  saveFavs();
  const on = favs.has(g.id);
  $$(`.card[data-id="${CSS.escape(g.id)}"]`).forEach(c => badges(c, g));
  const btn = $('#page-game [data-key="fav"]');
  if (btn) btn.classList.toggle('on', on);
  toast(on ? `★ ${g.name} ajouté aux favoris` : `${g.name} retiré des favoris`);
}

export async function launch(g) {
  if (g.demo) return toast('Entrée de démonstration : il n’y a rien à lancer', { error: true });
  const L = $('#launch');
  $('.launch-bg', L).style.backgroundImage = heroUrl(g) ? `url("${heroUrl(g)}")` : '';
  const bgEl = $('.launch-bg', L);
  bgEl.style.animation = 'none'; void bgEl.offsetWidth; bgEl.style.animation = '';
  const title = $('#launch-title');
  title.innerHTML = `<h2>${esc(g.name)}</h2>`;
  if (g.art.logo) {
    const img = new Image();
    img.onload = () => title.replaceChildren(img);
    img.src = g.art.logo;
  }
  const status = $('#launch-status');
  status.textContent = g.streamHost ? `Connexion à ${g.streamHost}…`
    : !g.installed ? `Ouverture de Steam pour installer ${g.name}…`
    : g.emulator ? `Lancement de ${g.name} avec ${g.emulator}…` : `Lancement de ${g.name}…`;
  const layer = openLayer({ el: L, name: 'launch', noGlobal: true, hints: () => [['b', 'Fermer']] });
  try {
    const r = await api.post('/api/launch', { id: g.id });
    status.textContent = r.ok ? (g.installed ? 'Bon jeu !' : 'Suivez l’installation dans Steam') : `Impossible de lancer : ${r.error || 'erreur inconnue'}`;
    if (r.ok) lib.load({ background: true });
  } catch (e) {
    status.textContent = `Impossible de lancer : ${e.message}`;
  }
  setTimeout(() => { if (topLayer() === layer) closeLayer(layer); }, 2800);
}

/** Ferme KaneMode et revient au bureau Windows (l'hôte s'arrête, la fenêtre se ferme). */
export async function exitToDesktop() {
  if (!await confirmDialog('Quitter vers le bureau Windows ?', 'KaneMode se ferme et le bureau Windows s’affiche. Pour revenir, relancez KaneMode (raccourci ou mode Xbox).', 'Quitter vers le bureau')) return;
  // Dans l'app native, c'est elle qui ferme la fenêtre et arrête l'hôte.
  if (native.available) return native.send('exit');
  try { await api.post('/api/exit'); } catch { /* l'hôte s'arrête peut-être déjà */ }
  const bye = el('div', 'bye', '<svg class="brand-mark"><use href="#i-brand"/></svg><h1>À bientôt</h1><p>KaneMode est fermé, le bureau Windows a repris la main.<br>Vous pouvez fermer cette fenêtre.</p>');
  document.body.append(bye);
  setTimeout(() => window.close(), 600);
}

/**
 * Écran de streaming (KanePlay intégré) : un fondu au noir, puis il prend le relais en plein écran.
 * B sur son accueil ramène ici ; une session en pause y reste prête à reprendre.
 */
export async function openStreaming() {
  document.body.classList.add('handoff');
  setTimeout(() => document.body.classList.remove('handoff'), 2500);
  try { await api.post('/api/stream/open'); }
  catch (e) {
    document.body.classList.remove('handoff');
    toast(e.message, { error: true });
  }
}
export async function openLauncher(l) {
  if (!l.installed) return toast(`${l.name} n’est pas installé sur ce PC`, { error: true });
  toast(`Ouverture de ${l.name}…`);
  try { await api.post('/api/launch', { id: 'launcher:' + l.id }); }
  catch (e) { toast(e.message, { error: true }); }
}

async function openThing(g, what, label) {
  try {
    await api.post('/api/open', { id: g.id, what });
    toast(label);
  } catch (e) { toast(e.message, { error: true }); }
}

/** Ajoute / retire un jeu des collections, ou en crée une nouvelle. */
export async function collectionsDialog(g) {
  const cols = lib.collections;
  const choice = await dialog({
    title: `Collections : ${g.name}`,
    text: 'Choisissez une collection pour y ajouter le jeu, ou l’en retirer.',
    buttons: [
      ...cols.map(c => ({ label: `${c.ids.includes(g.id) ? '✓ ' : ''}${c.name} (${c.ids.length})`, value: c.id, icon: 'i-collection' })),
      { label: 'Nouvelle collection…', value: '__new', icon: 'i-plus', primary: !cols.length },
      { label: 'Fermer', value: null },
    ],
  });
  if (!choice) return;
  if (choice === '__new') {
    const name = await openKeyboard({ title: 'Nom de la nouvelle collection', placeholder: 'Coop canapé, À finir, Rétro…' });
    if (!name || !name.trim()) return;
    await api.post('/api/collections', { action: 'create', name: name.trim(), entryId: g.id });
    toast(`Collection « ${name.trim()} » créée`);
  } else {
    const c = cols.find(x => x.id === choice);
    await api.post('/api/collections', { action: 'toggle', collection: choice, entryId: g.id });
    toast(c.ids.includes(g.id) ? `Retiré de « ${c.name} »` : `Ajouté à « ${c.name} »`);
  }
  await lib.load();
}

async function options(g) {
  const custom = g.source === 'custom' && !g.demo;
  const steamInstalled = g.steamAppId && g.installed && !g.shortcut;
  const choice = await dialog({
    title: g.name,
    buttons: [
      { label: favs.has(g.id) ? 'Retirer des favoris' : 'Ajouter aux favoris', value: 'fav', icon: 'i-star' },
      { label: 'Collections…', value: 'collections', icon: 'i-collection' },
      ...(!g.demo ? [{ label: 'Visuels (SteamGridDB, image perso)…', value: 'art', icon: 'i-image' }] : []),
      ...(steamInstalled ? [{ label: 'Désinstaller (via Steam)', value: 'uninstall', icon: 'i-trash' }] : []),
      { label: g.type === 'app' ? 'Classer comme jeu' : 'Classer comme application', value: 'type', icon: 'i-sort' },
      { label: g.hidden ? 'Réafficher dans la bibliothèque' : 'Masquer de la bibliothèque', value: 'hide', icon: 'i-eye-off' },
      ...(custom ? [{ label: 'Modifier', value: 'edit', icon: 'i-edit' }, { label: 'Supprimer de la bibliothèque', value: 'delete', icon: 'i-trash', danger: true }] : []),
      { label: 'Fermer', value: null },
    ],
  });
  if (choice === 'fav') toggleFav(g);
  if (choice === 'collections') collectionsDialog(g);
  if (choice === 'art') go('artpicker', { id: g.id });
  if (choice === 'uninstall' && await confirmDialog(`Désinstaller ${g.name} ?`, 'Steam va s’ouvrir pour confirmer la désinstallation.', 'Continuer', true)) {
    openThing(g, 'uninstall', 'Ouverture de Steam…');
  }
  if (choice === 'type' || choice === 'hide') {
    const body = choice === 'type' ? { id: g.id, type: g.type === 'app' ? 'game' : 'app' } : { id: g.id, hidden: !g.hidden };
    await api.post('/api/override', body);
    await lib.load();
    toast(choice === 'type' ? `Classé comme ${body.type === 'app' ? 'application' : 'jeu'}` : body.hidden ? 'Masqué (visible dans l’onglet « Masqués »)' : 'Réaffiché');
  }
  if (choice === 'edit') go('details', { editId: g.id, nonce: Math.random() });
  if (choice === 'delete') deleteCustom(g);
}

export async function deleteCustom(g) {
  if (!await confirmDialog(`Supprimer « ${g.name} » ?`, 'L’entrée est retirée de la bibliothèque. Le programme lui-même n’est pas désinstallé.', 'Supprimer', true)) return false;
  await api.del('/api/custom?id=' + encodeURIComponent(g.id));
  await lib.load();
  toast(`${g.name} supprimé`);
  if (currentPage().id === 'game' || currentPage().id === 'details') back();
  return true;
}

// ---------- Page ----------
definePage('game', {
  libBound: true,
  render({ id }) {
    const root = this.el;
    const g = this.g = lib.byId(id);
    if (!g) { root.innerHTML = '<div class="empty" style="padding-top:120px">Cet élément n’existe plus.</div>'; return; }
    const src = sourceOf(g.source);
    const m = g.meta || {};

    const hero = el('div', 'game-hero');
    hero.append(art(g, [g.art.hero, g.art.header], { showName: false }));
    const heroImg = hero.querySelector(':scope > img');
    if (heroImg) Object.assign(heroImg.style, { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' });
    const title = el('h1', 'game-logo');
    title.textContent = g.name;
    hero.append(title);
    if (g.art.logo) {
      const logo = new Image();
      logo.className = 'game-logo';
      logo.alt = g.name;
      logo.onload = () => title.replaceWith(logo);
      logo.src = g.art.logo;
    }

    const bar = el('div', 'game-bar');
    const noEmu = g.source === 'rom' && !g.demo && !g.launch;
    const label = g.demo ? 'DÉMO' : noEmu ? 'ÉMULATEUR MANQUANT' : !g.installed ? 'INSTALLER' : g.streamHost ? 'STREAMER' : g.type === 'app' ? 'LANCER' : 'JOUER';
    const play = el('div', 'btn-play' + (g.demo || noEmu ? ' disabled' : !g.installed ? ' install' : ''), `${icon(!g.installed && !noEmu ? 'i-download2' : 'i-play')}${label}`);
    nav(play, () => (noEmu ? go('emulation') : launch(g)), 'play');
    play.dataset.autofocus = '';
    const fav = el('div', 'btn-icon' + (favs.has(g.id) ? ' on' : ''), icon('i-star'));
    nav(fav, () => toggleFav(g), 'fav');
    const more = el('div', 'btn-icon', icon('i-more'));
    nav(more, () => options(g), 'more');
    const stat = (label, value) => `<div class="stat"><small>${label}</small><b>${value}</b></div>`;
    const stats = el('div', 'stats',
      stat('Dernière session', fmt.played(g.lastPlayed)) +
      (g.playtime ? stat('Temps de jeu', fmt.playtime(g.playtime)) : '') +
      (g.playCount ? stat('Lancements', g.playCount) : '') +
      (g.sizeOnDisk ? stat('Taille', fmt.size(g.sizeOnDisk)) : '') +
      (g.streamHost ? stat('Streaming', `KanePlay · ${esc(g.streamHost)}`) : '') +
      (g.systemName ? stat('Console', esc(g.systemName) + (g.region ? ` · ${esc(g.region)}` : '')) : '') +
      (g.source === 'rom' ? stat('Émulateur', g.emulator ? esc(g.emulator + (g.core ? ` (${g.core})` : '')) : '<span style="color:#ff9a9d">Non trouvé</span>') : '') +
      stat('Boutique', `<span class="pill src" style="--src:${src.color}">${esc(src.label)}${g.shortcut ? ' · non-Steam' : ''}</span>`));
    bar.append(play, fav, more, stats);

    root.replaceChildren(hero, bar);

    if (m.description || (m.genres && m.genres.length) || g.demo) {
      root.append(el('h2', 'row-title', 'À propos'));
      const about = el('div', 'about');
      const facts = [
        m.developers && m.developers.length && ['Développeur', m.developers.join(', ')],
        m.publishers && m.publishers.length && ['Éditeur', m.publishers.join(', ')],
        m.release && ['Sortie', m.release],
        m.controller && ['Manette', m.controller === 'full' ? 'Compatible manette' : 'Compatibilité partielle'],
        m.metacritic && ['Metacritic', `<span class="score">${m.metacritic}</span>`],
      ].filter(Boolean);
      about.innerHTML = `<div>
          <p>${esc(m.description || (g.demo ? 'Entrée de démonstration : elle montre comment un jeu de cette boutique apparaîtrait dans la bibliothèque.' : ''))}</p>
          ${m.genres && m.genres.length ? `<div class="chips">${m.genres.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
        </div>
        <dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${k === 'Metacritic' ? v : esc(v)}</dd>`).join('')}</dl>`;
      root.append(about);
    }

    const links = el('div', 'link-row');
    const link = (iconId, label, sub, act, key, cls = '') => {
      const l = el('div', 'link ' + cls, `${icon(iconId)}<div><span>${esc(label)}</span><small>${esc(sub)}</small></div>`);
      links.append(nav(l, act, key));
    };
    if (g.installDir && !g.demo) link('i-folder', 'Fichiers locaux', g.installDir, () => openThing(g, 'folder', 'Ouverture du dossier…'), 'folder');
    if (m.steamId && !g.demo) link('i-store', 'Page du magasin', 'Boutique Steam : actualités, DLC, avis', () => openThing(g, 'store', 'Ouverture de la boutique Steam…'), 'store');
    const launcher = lib.launcher(g.source);
    if (launcher && launcher.installed && !g.demo) link('i-open', `Ouvrir ${launcher.name}`, 'Lanceur de la boutique', () => openLauncher(launcher), 'launcher');
    if (!g.demo) link('i-image', 'Visuels', g.customArt && g.customArt.length ? 'Personnalisés · SteamGridDB ou image perso' : 'SteamGridDB ou image perso', () => go('artpicker', { id: g.id }), 'art');
    link('i-collection', 'Collections', (lib.collections.filter(c => c.ids.includes(g.id)).map(c => c.name).join(', ')) || 'Ranger ce jeu dans une collection', () => collectionsDialog(g), 'collections');
    if (g.source === 'custom' && !g.demo) {
      link('i-edit', 'Modifier', 'Nom, type, jaquette, arguments', () => go('details', { editId: g.id, nonce: Math.random() }), 'edit');
      link('i-trash', 'Supprimer', 'Retirer de la bibliothèque', () => deleteCustom(g), 'delete', 'danger');
    }
    if (links.children.length) {
      root.append(el('h2', 'row-title', 'Raccourcis'), links);
    }
    if (g.launch && g.source === 'custom') {
      root.append(el('div', 'empty', `Cible : ${esc(g.launch.target)} ${esc(g.launch.args || '')}`));
    }
    if (g.romPath) root.append(el('div', 'empty', `ROM : ${esc(g.romPath)}`));
    setBackground(heroUrl(g));
  },
  hints: () => [['x', 'Favori'], ['a', 'Sélectionner'], ['b', 'Retour']],
  button(k) { if (k === 'x' && this.g) { toggleFav(this.g); return true; } return false; },
});
