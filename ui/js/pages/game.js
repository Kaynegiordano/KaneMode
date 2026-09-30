// Fiche d'un jeu + actions partagées : lancement, favoris, fond d'écran, lanceurs.
import { t } from '../i18n.js';
import { $, $$, el, esc, icon, api, lib, fmt, favs, saveFavs, sourceOf, toast, native } from '../core.js';
import { definePage, nav, go, back, openLayer, closeLayer, topLayer, currentPage, refresh } from '../nav.js';
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
// KanePlay s'ouvre directement ; les autres entrées ouvrent leur fiche
export const openGame = g => (g.source === 'kaneplay' ? openStreaming() : go('game', { id: g.id }));

export function toggleFav(g) {
  favs.has(g.id) ? favs.delete(g.id) : favs.add(g.id);
  saveFavs();
  const on = favs.has(g.id);
  $$(`.card[data-id="${CSS.escape(g.id)}"]`).forEach(c => badges(c, g));
  const btn = $('#page-game [data-key="fav"]');
  if (btn) btn.classList.toggle('on', on);
  toast(on ? t('★ {name} ajouté aux favoris', { name: g.name }) : t('{name} retiré des favoris', { name: g.name }));
}

// ---------- Fond du lancement : une image du jeu tirée au hasard sur SteamGridDB ----------
const wallpapers = new Map();
/** Tire le fond à l'avance (ouverture de la fiche) pour qu'il soit prêt au lancement. */
export function prepareWallpaper(g) {
  if (g.demo || wallpapers.has(g.id)) return wallpapers.get(g.id);
  const p = api.get(`/api/launch/wallpaper?id=${encodeURIComponent(g.id)}`)
    .then(r => r.url && new Promise(ok => { const i = new Image(); i.onload = () => ok(r.url); i.onerror = () => ok(null); i.src = r.url; }))
    .catch(() => null);
  wallpapers.set(g.id, p);
  return p;
}

// ---------- Jeux en cours (suivis par l'app native) ----------
// « Jouer » devient « Reprendre » et un bouton permet de l'arrêter
export const running = new Set();
const tracked = g => native.available && g.installed && !g.demo && !g.streamHost && g.type !== 'app';
const gameRef = g => ({ id: g.id, steamAppId: g.steamAppId || 0, dir: g.trackDir || null });
function setRunning(id, on) {
  if (running.has(id) === !!on) return;
  on ? running.add(id) : running.delete(id);
  const p = currentPage();
  if (p && p.id === 'game' && p.params.id === id) refresh();
}
/** Demande à l'app native si le jeu tourne (fiche ouverte, retour sur KaneMode). */
export function queryGame(g) { if (tracked(g)) native.send('game-query', gameRef(g)); }

/** « Reprendre » : le jeu en cours repasse devant. */
export function resumeGame(g) { native.send('game-front', gameRef(g)); }

let stopTimer = null;
/** Arrête le jeu : fermeture demandée au jeu, puis proposée de force s'il ne répond pas. */
export async function stopGame(g) {
  if (!(await confirmDialog(t('Arrêter {name} ?', { name: g.name }), t('Le jeu reçoit une demande de fermeture, comme avec la croix de sa fenêtre : il peut sauvegarder ou demander confirmation.'), t('Arrêter')))) return;
  native.send('game-stop', { ...gameRef(g), force: false });
  toast(t('Fermeture de {name}…', { name: g.name }));
  clearTimeout(stopTimer);
  stopTimer = setTimeout(async () => {
    if (!running.has(g.id)) return;
    if (!(await confirmDialog(t('{name} ne s’est pas fermé', { name: g.name }), t('Forcer la fermeture arrête tous ses processus immédiatement. Ce qui n’a pas été sauvegardé est perdu.'), t('Forcer la fermeture')))) return;
    native.send('game-stop', { ...gameRef(g), force: true });
  }, 8000);
}

native.on(m => {
  if (m.type === 'game-state') setRunning(m.id, m.running);
  else if (m.type === 'game-started') setRunning(m.id, true);
  else if (m.type === 'game-ended') {
    // Jeu fermé (vu par l'app native, qui revient ici) : il peut être relancé tout de suite
    clearTimeout(stopTimer);
    setRunning(m.id, false);
    api.post('/api/launch/ended', { id: m.id }).catch(() => {});
    lib.load({ background: true }).catch(() => {});
  } else if (m.type === 'game-stop' && m.force && m.failed) {
    toast(t('Windows a refusé d’arrêter une partie du jeu (anti-triche ou droits administrateur)'), { error: true });
  } else if (m.type === 'game-front-failed') {
    const g = lib.byId(m.id);
    if (g) queryGame(g);
    toast(t('La fenêtre du jeu est introuvable'), { error: true });
  }
});
// Retour sur KaneMode : le jeu de la fiche ouverte tourne-t-il encore ?
native.on(m => {
  if (m.type !== 'resume') return;
  const p = currentPage();
  const g = p && p.id === 'game' && lib.byId(p.params.id);
  if (g) queryGame(g);
});

// Lancement en cours : l'écran reste affiché jusqu'à l'apparition du jeu, un second appui ne relance rien
let launching = null;
native.on(m => {
  if (!launching || m.id !== launching.g.id) return;
  if (m.type === 'game-started') {
    $('#launch-status').textContent = t('Bon jeu !');
    const L = launching.layer;
    launching = null;
    setTimeout(() => { if (topLayer() === L) closeLayer(L); }, 700);
  } else if (m.type === 'launch-timeout') {
    const L = launching.layer;
    launching = null;
    if (topLayer() === L) closeLayer(L);
  }
});

export async function launch(g) {
  if (g.demo) return toast(t('Entrée de démonstration : il n’y a rien à lancer'), { error: true });
  if (launching) return;
  if (running.has(g.id)) return resumeGame(g);
  // Jeu installé : l'écran de lancement cache Steam et reste là jusqu'à ce que le jeu s'affiche
  const cover = tracked(g);
  const L = $('#launch');
  const bgEl = $('.launch-bg', L);
  bgEl.style.backgroundImage = heroUrl(g) ? `url("${heroUrl(g)}")` : '';
  bgEl.style.animation = 'none'; void bgEl.offsetWidth; bgEl.style.animation = '';
  const wanted = g.id;
  Promise.resolve(g.installed && !g.streamHost ? prepareWallpaper(g) : null).then(url => {
    if (url && L.classList.contains('open') && L.dataset.game === wanted) bgEl.style.backgroundImage = `url("${url}")`;
  });
  wallpapers.delete(g.id); // un autre fond la prochaine fois
  L.dataset.game = g.id;
  const title = $('#launch-title');
  title.innerHTML = `<h2>${esc(g.name)}</h2>`;
  if (g.art.logo) {
    const img = new Image();
    img.onload = () => title.replaceChildren(img);
    img.src = g.art.logo;
  }
  const status = $('#launch-status');
  status.textContent = g.streamHost ? t('Connexion à {streamHost}…', { streamHost: g.streamHost })
    : !g.installed ? t('Ouverture de Steam pour installer {name}…', { name: g.name })
    : g.emulator ? t('Lancement de {name} avec {emulator}…', { name: g.name, emulator: g.emulator }) : t('Lancement de {name}…', { name: g.name });
  const layer = openLayer({
    el: L, name: 'launch', noGlobal: true, hints: () => [['b', t('Fermer')]],
    onClose() {
      delete L.dataset.game;
      // Fermé à la main (B) : KaneMode ne reste plus au-dessus, mais suit toujours le jeu
      if (launching && launching.layer === layer) { launching = null; native.send('launch-cancel'); }
    },
  });
  launching = { g, layer };
  let waitForGame = false;
  try {
    native.send('foreground'); // le jeu lancé pourra passer au premier plan
    const r = await api.post('/api/launch', { id: g.id });
    if (r.already || r.running) {
      status.textContent = t('{name} est déjà lancé', { name: g.name });
      if (cover) { queryGame(g); resumeGame(g); }
    } else if (r.ok && cover) {
      native.send('launch', { ...gameRef(g), name: g.name, cover: true });
      waitForGame = true;
    } else {
      status.textContent = r.ok ? (g.installed ? t('Bon jeu !') : t('Suivez l’installation dans Steam')) : t('Impossible de lancer : {a}', { a: r.error || 'erreur inconnue' });
    }
    if (r.ok) lib.load({ background: true });
  } catch (e) {
    status.textContent = t('Impossible de lancer : {message}', { message: e.message });
  }
  if (waitForGame) return; // l'app native dira quand le jeu est là (ou au bout de 25 s)
  // Navigateur, installation, streaming : pas de suivi, l'écran se ferme tout seul
  setTimeout(() => {
    if (launching && launching.layer === layer) launching = null;
    if (topLayer() === layer) closeLayer(layer);
  }, 2800);
}

/**
 * Bureau Windows : en mode Xbox, KaneMode en sort (Windows peut demander confirmation) et reste
 * ouvert ; déjà sur le bureau, il se réduit. Il ne se ferme plus (2.1.0).
 */
export async function exitToDesktop() {
  if (native.available) { toast(t('Bureau Windows · KaneMode reste ouvert')); return native.send('exit'); }
  if (!(await confirmDialog(t('Quitter KaneMode ?'), t('Hors de l’app, l’hôte s’arrête et cette page se ferme.'), t('Quitter')))) return;
  try { await api.post('/api/exit'); } catch { /* l'hôte s'arrête peut-être déjà */ }
  const bye = el('div', 'bye', t('<svg class="brand-mark"><use href="#i-brand"/></svg><h1>À bientôt</h1><p>KaneMode est fermé, le bureau Windows a repris la main.<br>Vous pouvez fermer cette fenêtre.</p>'));
  document.body.append(bye);
  setTimeout(() => window.close(), 600);
}

const KANEPLAY_WINDOW = 'KaneMode · Streaming'; // titre de la fenêtre du moteur intégré (engine/KanePlay, main.qml)
let streamRetry = 0;
/**
 * Écran de streaming (KanePlay intégré) : un fondu au noir, puis il prend le relais en plein écran.
 * B sur son accueil ramène ici ; une session en pause y reste prête à reprendre.
 */
export async function openStreaming({ retry = false } = {}) {
  if (!retry) streamRetry = Date.now();
  document.body.classList.add('handoff');
  setTimeout(() => document.body.classList.remove('handoff'), 2500);
  // KaneMode a le premier plan : il le cède à KanePlay, et guette sa fenêtre pour la mettre
  // lui-même devant (Windows ne la laisse pas toujours passer au premier plan)
  native.send('foreground', { window: KANEPLAY_WINDOW });
  try { await api.post('/api/stream/open'); }
  catch (e) {
    streamRetry = 0; // rien n'a été lancé : pas de nouvelle tentative
    document.body.classList.remove('handoff');
    toast(e.message, { error: true });
  }
}
// KanePlay relancé juste après l'avoir quitté : la commande a pu partir vers l'instance qui se
// fermait. L'app native le détecte (plus aucun KanePlay ne tourne) et on relance, une fois.
native.on(m => {
  if (m.type !== 'foreground-lost' || m.window !== KANEPLAY_WINDOW) return;
  if (!streamRetry || Date.now() - streamRetry > 20000) return;
  streamRetry = 0;
  openStreaming({ retry: true });
});

export async function openLauncher(l) {
  if (!l.installed) return toast(t('{name} n’est pas installé sur ce PC', { name: l.name }), { error: true });
  toast(t('Ouverture de {name}…', { name: l.name }));
  native.send('foreground');
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
    title: t('Collections : {name}', { name: g.name }),
    text: t('Choisissez une collection pour y ajouter le jeu, ou l’en retirer.'),
    buttons: [
      ...cols.map(c => ({ label: `${c.ids.includes(g.id) ? '✓ ' : ''}${c.name} (${c.ids.length})`, value: c.id, icon: 'i-collection' })),
      { label: t('Nouvelle collection…'), value: '__new', icon: 'i-plus', primary: !cols.length },
      { label: t('Fermer'), value: null },
    ],
  });
  if (!choice) return;
  if (choice === '__new') {
    const name = await openKeyboard({ title: t('Nom de la nouvelle collection'), placeholder: t('Coop canapé, À finir, Rétro…') });
    if (!name || !name.trim()) return;
    await api.post('/api/collections', { action: 'create', name: name.trim(), entryId: g.id });
    toast(t('Collection « {trim} » créée', { trim: name.trim() }));
  } else {
    const c = cols.find(x => x.id === choice);
    await api.post('/api/collections', { action: 'toggle', collection: choice, entryId: g.id });
    toast(c.ids.includes(g.id) ? t('Retiré de « {name} »', { name: c.name }) : t('Ajouté à « {name} »', { name: c.name }));
  }
  await lib.load();
}

async function options(g) {
  const custom = g.source === 'custom' && !g.demo;
  const steamInstalled = g.steamAppId && g.installed && !g.shortcut;
  const choice = await dialog({
    title: g.name,
    buttons: [
      { label: favs.has(g.id) ? t('Retirer des favoris') : t('Ajouter aux favoris'), value: 'fav', icon: 'i-star' },
      { label: t('Collections…'), value: 'collections', icon: 'i-collection' },
      ...(!g.demo ? [{ label: t('Visuels (SteamGridDB, image perso)…'), value: 'art', icon: 'i-image' }] : []),
      ...(steamInstalled ? [{ label: t('Désinstaller (via Steam)'), value: 'uninstall', icon: 'i-trash' }] : []),
      { label: g.type === 'app' ? t('Classer comme jeu') : t('Classer comme application'), value: 'type', icon: 'i-sort' },
      { label: g.hidden ? t('Réafficher dans la bibliothèque') : t('Masquer de la bibliothèque'), value: 'hide', icon: 'i-eye-off' },
      ...(custom ? [{ label: t('Modifier'), value: 'edit', icon: 'i-edit' }, { label: t('Supprimer de la bibliothèque'), value: 'delete', icon: 'i-trash', danger: true }] : []),
      { label: t('Fermer'), value: null },
    ],
  });
  if (choice === 'fav') toggleFav(g);
  if (choice === 'collections') collectionsDialog(g);
  if (choice === 'art') go('artpicker', { id: g.id });
  if (choice === 'uninstall' && (await confirmDialog(t('Désinstaller {name} ?', { name: g.name }), t('Steam va s’ouvrir pour confirmer la désinstallation.'), t('Continuer'), true))) {
    openThing(g, 'uninstall', t('Ouverture de Steam…'));
  }
  if (choice === 'type' || choice === 'hide') {
    const body = choice === 'type' ? { id: g.id, type: g.type === 'app' ? 'game' : 'app' } : { id: g.id, hidden: !g.hidden };
    await api.post('/api/override', body);
    await lib.load();
    toast(choice === 'type' ? t('Classé comme {a}', { a: body.type === 'app' ? 'application' : t("jeu") }) : body.hidden ? t('Masqué (visible dans l’onglet « Masqués »)') : t('Réaffiché'));
  }
  if (choice === 'edit') go('details', { editId: g.id, nonce: Math.random() });
  if (choice === 'delete') deleteCustom(g);
}

export async function deleteCustom(g) {
  if (!(await confirmDialog(t('Supprimer « {name} » ?', { name: g.name }), t('L’entrée est retirée de la bibliothèque. Le programme lui-même n’est pas désinstallé.'), t('Supprimer'), true))) return false;
  await api.del('/api/custom?id=' + encodeURIComponent(g.id));
  await lib.load();
  toast(t('{name} supprimé', { name: g.name }));
  if (currentPage().id === 'game' || currentPage().id === 'details') back();
  return true;
}

// ---------- Page ----------
definePage('game', {
  libBound: true,
  render({ id }) {
    const root = this.el;
    const g = this.g = lib.byId(id);
    if (!g) { root.innerHTML = t('<div class="empty" style="padding-top:120px">Cet élément n’existe plus.</div>'); return; }
    const src = sourceOf(g.source);
    const m = g.meta || {};
    if (g.installed && !g.streamHost) prepareWallpaper(g);

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
    queryGame(g);
    const isRunning = running.has(g.id);
    const label = g.demo ? t('DÉMO') : noEmu ? t('ÉMULATEUR MANQUANT') : isRunning ? 'REPRENDRE' : !g.installed ? t('INSTALLER') : g.streamHost ? 'STREAMER' : g.type === 'app' ? t('LANCER') : 'JOUER';
    const play = el('div', 'btn-play' + (g.demo || noEmu ? ' disabled' : isRunning ? ' running' : !g.installed ? ' install' : ''), `${icon(!g.installed && !noEmu ? 'i-download2' : 'i-play')}${label}`);
    nav(play, () => (noEmu ? go('emulation') : isRunning ? resumeGame(g) : launch(g)), 'play');
    play.dataset.autofocus = '';
    // Jeu en cours : l'arrêter (fermeture propre, puis forcée s'il ne répond pas)
    const stop = isRunning ? nav(el('div', 'btn-icon stop', icon('i-power')), () => stopGame(g), 'stop') : null;
    if (stop) stop.title = t('Arrêter le jeu');
    const fav = el('div', 'btn-icon' + (favs.has(g.id) ? ' on' : ''), icon('i-star'));
    nav(fav, () => toggleFav(g), 'fav');
    const more = el('div', 'btn-icon', icon('i-more'));
    nav(more, () => options(g), 'more');
    const stat = (label, value) => `<div class="stat"><small>${label}</small><b>${value}</b></div>`;
    const stats = el('div', 'stats',
      stat(t('Dernière session'), fmt.played(g.lastPlayed)) +
      (g.playtime ? stat(t('Temps de jeu'), fmt.playtime(g.playtime)) : '') +
      (g.playCount ? stat(t('Lancements'), g.playCount) : '') +
      (g.sizeOnDisk ? stat(t('Taille'), fmt.size(g.sizeOnDisk)) : '') +
      (g.streamHost ? stat(t('Streaming'), t('Streaming local · {host}', { host: esc(g.streamHost) })) : '') +
      (g.systemName ? stat(t('Console'), esc(g.systemName) + (g.region ? ` · ${esc(g.region)}` : '')) : '') +
      (g.source === 'rom' ? stat(t('Émulateur'), g.emulator ? esc(g.emulator + (g.core ? ` (${g.core})` : '')) : t('<span style="color:#ff9a9d">Non trouvé</span>')) : '') +
      stat(t('Boutique'), `<span class="pill src" style="--src:${src.color}">${esc(src.label)}${g.shortcut ? t(' · non-Steam') : ''}</span>`));
    bar.append(...[play, stop, fav, more, stats].filter(Boolean));
    if (isRunning) stats.insertAdjacentHTML('afterbegin', stat(t('État'), t('<span class="now-playing">En cours</span>')));

    root.replaceChildren(hero, bar);

    if (m.description || (m.genres && m.genres.length) || g.demo) {
      root.append(el('h2', 'row-title', t('À propos')));
      const about = el('div', 'about');
      const facts = [
        m.developers && m.developers.length && [t('Développeur'), m.developers.join(', ')],
        m.publishers && m.publishers.length && [t('Éditeur'), m.publishers.join(', ')],
        m.release && [t('Sortie'), m.release],
        m.controller && [t('Manette'), m.controller === 'full' ? t('Compatible manette') : t('Compatibilité partielle')],
        m.metacritic && [t('Metacritic'), `<span class="score">${m.metacritic}</span>`],
      ].filter(Boolean);
      about.innerHTML = `<div>
          <p>${esc(m.description || (g.demo ? t('Entrée de démonstration : elle montre comment un jeu de cette boutique apparaîtrait dans la bibliothèque.') : ''))}</p>
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
    if (g.installDir && !g.demo) link('i-folder', t('Fichiers locaux'), g.installDir, () => openThing(g, 'folder', t('Ouverture du dossier…')), 'folder');
    if (m.steamId && !g.demo) link('i-store', t('Page du magasin'), t('Boutique Steam : actualités, DLC, avis'), () => openThing(g, 'store', t('Ouverture de la boutique Steam…')), 'store');
    const launcher = lib.launcher(g.source);
    if (launcher && launcher.installed && !g.demo) link('i-open', t('Ouvrir {name}', { name: launcher.name }), t('Lanceur de la boutique'), () => openLauncher(launcher), 'launcher');
    if (!g.demo) link('i-image', t('Visuels'), g.customArt && g.customArt.length ? t('Personnalisés · SteamGridDB ou image perso') : t('SteamGridDB ou image perso'), () => go('artpicker', { id: g.id }), 'art');
    link('i-collection', t('Collections'), (lib.collections.filter(c => c.ids.includes(g.id)).map(c => c.name).join(', ')) || t('Ranger ce jeu dans une collection'), () => collectionsDialog(g), 'collections');
    if (g.source === 'custom' && !g.demo) {
      link('i-edit', t('Modifier'), t('Nom, type, jaquette, arguments'), () => go('details', { editId: g.id, nonce: Math.random() }), 'edit');
      link('i-trash', t('Supprimer'), t('Retirer de la bibliothèque'), () => deleteCustom(g), 'delete', 'danger');
    }
    if (links.children.length) {
      root.append(el('h2', 'row-title', t('Raccourcis')), links);
    }
    if (g.launch && g.source === 'custom') {
      root.append(el('div', 'empty', t('Cible : {a} {b}', { a: esc(g.launch.target), b: esc(g.launch.args || '') })));
    }
    if (g.romPath) root.append(el('div', 'empty', `ROM : ${esc(g.romPath)}`));
    setBackground(heroUrl(g));
  },
  hints: () => [['x', t('Favori')], ['a', t('Sélectionner')], ['b', t('Retour')]],
  button(k) { if (k === 'x' && this.g) { toggleFav(this.g); return true; } return false; },
});
