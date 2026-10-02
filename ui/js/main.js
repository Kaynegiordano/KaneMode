// Démarrage : pages, menus latéraux, accès rapide, barre d'état, synchronisation avec l'hôte.
import { t, locale, translateDom } from './i18n.js';
import { $, $$, api, lib, settings, saveSettings, applyTheme, toast, busy, on, getNotifications, esc, fmt, sfx, native, store } from './core.js';
import { state, go, refresh, openLayer, closeLayer, topLayer, currentPage, actions, hooks, focusIn, setFocus, resetHistory, input, setNativePads } from './nav.js';
import { swapArt } from './cards.js';
import { confirmDialog, dialog } from './widgets.js';
import { playBoot } from './boot.js';
import { sleepNow } from './power.js';
import { renderQam, prefetchQam, startLive, stopLive, qamShortcuts } from './qam.js';
import { exitToDesktop, openStreaming } from './pages/game.js';
import './personalization-runtime.js';
import './pages/home.js';
import './pages/library.js';
import './pages/search.js';
import './pages/add.js';
import './pages/settings.js';
import './pages/artpicker.js';
import './pages/media.js';
import './pages/emulation.js';

applyTheme();
// Résolution ou mise à l'échelle changée (widget Game Bar, Paramètres de Windows) : taille de
// l'interface recalculée et page redessinée pour la nouvelle taille d'écran
// Manettes XInput lues par l'app native (voir setNativePads)
native.on(m => { if (m.type === 'xpad') setNativePads(m.pads); });
// Limite d'images du pilote (AMD, NVIDIA, Intel) : jeux seulement, levée tant que KaneMode est au premier plan
native.on(m => {
  if (m.type === 'resume' || m.type === 'background') api.post('/api/graphics/front', { front: m.type === 'resume' }).catch(() => {});
});
if (native.available) api.post('/api/graphics/front', { front: true }).catch(() => {});
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { applyTheme(); refresh(); }, 250);
});
// Textes écrits dans index.html (menus, barre d'état…) : dans la langue choisie
translateDom(document.body);
// L'écran de démarrage couvre tout dès le chargement.
// Interface rechargée par l'app (fermeture de KanePlay) : ni logo ni son de démarrage
const RELOADED = new URLSearchParams(location.search).has('resume');
if (settings.bootMode !== 'none' && !RELOADED) $('#boot').hidden = false;
// ---------- Par-dessus KanePlay ----------
// Dans KanePlay, Select et Start ouvrent le menu et l'accès rapide de KaneMode (l'app native relaie) ;
// les refermer ramène à KanePlay, aller ailleurs dans KaneMode y reste.
const overlay = { active: false };
actions['overlay-leave'] = () => { if (overlay.active) { overlay.active = false; native.send('stay'); } };
function overlayClosed() {
  // Différé : passer du menu à l'accès rapide (Select ↔ Start) n'est pas une fermeture
  setTimeout(() => { if (overlay.active && !topLayer()) { overlay.active = false; native.send('return'); } }, 0);
}
native.on(m => {
  if (m.type !== 'open') return;
  while (topLayer()) closeLayer();
  overlay.active = true;
  (m.panel === 'menu' ? hooks.menu : hooks.qam)();
});
// Boutons de la console (ROG Ally) pressés alors que KaneMode est déjà devant : ouvre ou referme
native.on(m => {
  if (m.type === 'toggle') {
    const top = topLayer();
    if (top && top.name === m.panel) return closeLayer();
    while (topLayer()) closeLayer();
    (m.panel === 'menu' ? hooks.menu : hooks.qam)();
  } else if (m.type === 'home') {
    // Bouton de la console, ou widget Game Bar (« Ouvrir KaneMode », éventuellement sur une page)
    overlay.active = false;
    while (topLayer()) closeLayer();
    const target = m.page || 'home';
    if (target === 'dolby') {
      resetHistory(); state.history.push({ id: 'home', params: {} });
      go('settings', { section: 'dolby' }, { push: false });
      return;
    }
    if (currentPage() && currentPage().id !== target) {
      resetHistory();
      if (target !== 'home') state.history.push({ id: 'home', params: {} });
      go(target, {}, { push: false });
    }
  } else if (m.type === 'desktop-failed') {
    toast(t('Le mode Xbox est resté actif : KaneMode reste ouvert. Réessayez, ou utilisez la touche Windows.'), { error: true });
  }
});

actions.exit = () => { actions['overlay-leave'](); closeLayer(); exitToDesktop(); };
actions['stream-open'] = () => { actions['overlay-leave'](); closeLayer(); openStreaming(); };

// ---------- Menu principal ----------
hooks.menu = () => openLayer({
  el: $('#menu'), name: 'menu', scrim: true, focusKey: state.page, onClose: overlayClosed,
  hints: () => [['a', t('Sélectionner')], ['b', t('Fermer')]],
});
actions['menu-go'] = elm => {
  actions['overlay-leave']();
  closeLayer();
  const target = elm.dataset.page;
  resetHistory();
  if (target !== 'home') state.history.push({ id: 'home', params: {} });
  go(target, {}, { push: false });
};
// Menu d'alimentation au centre de l'écran (menu principal, accès rapide)
export function openPowerMenu() {
  actions['overlay-leave']();
  closeLayer();
  if (topLayer()) closeLayer();
  openLayer({ el: $('#power'), name: 'power', scrim: true, focusKey: 'sleep', hints: () => [['a', t('Choisir')], ['b', t('Annuler')]] });
}
actions['power-open'] = openPowerMenu;
actions['power-close'] = () => closeLayer();
const SYSTEM = {
  sleep: [t('Mettre en veille ?'), t('Le PC passe en veille. Appuyez sur un bouton de la manette pour le réveiller.'), t('Mettre en veille')],
  restart: [t('Redémarrer le PC ?'), t('Pensez à sauvegarder vos parties en cours.'), t('Redémarrer')],
  shutdown: [t('Éteindre le PC ?'), t('Pensez à sauvegarder vos parties en cours.'), t('Éteindre')],
};
actions.system = async elm => {
  const [title, text, ok] = SYSTEM[elm.dataset.system];
  closeLayer();
  // Comme sur SteamOS, la veille est immédiate ; redémarrer et éteindre demandent confirmation.
  if (elm.dataset.system === 'sleep') return sleepNow();
  if (!(await confirmDialog(title, text, ok, elm.dataset.system !== 'desktop'))) return;
  // App native : vraie veille / vrai redémarrage / vraie extinction. Navigateur : simulé.
  if (native.available) return native.send('power', { action: elm.dataset.system });
  await api.post('/api/action', { action: elm.dataset.system });
  toast(t('{ok} : simulé dans le prototype (aucune action réelle)', { ok }));
};

// Retour sur KaneMode (fin d'un jeu, alt-tab) : la bibliothèque se met à jour (temps de jeu, installations…).
  // L'hôte refait aussi l'analyse des boutiques après le retour : la liste suit d'elle-même.
native.on(m => {
  if (m.type !== 'resume' || document.hidden) return;
  lib.load({ background: true }).catch(() => {});
  api.post('/api/library/refresh').catch(() => {});
});
if (native.available) document.documentElement.classList.add('native');

// ---------- Accès rapide ----------
let sysTimer;
async function pollSystem() {
  if (!$('#cpu-bar')) return; // section « Moniteur » masquée
  try {
    const s = await api.get('/api/system');
    $('#cpu-bar').style.width = s.cpu + '%';
    $('#cpu-val').textContent = s.cpu + ' %';
    $('#mem-bar').style.width = Math.round(100 * s.memUsed / s.memTotal) + '%';
    $('#mem-val').textContent = fmt.gb(s.memUsed).replace(t(' Go'), '') + ' / ' + fmt.gb(s.memTotal);
  } catch { /* hôte injoignable */ }
}
// Raccourcis de l'accès rapide dans KaneMode (le widget Game Bar a les siens)
Object.assign(qamShortcuts, {
  leave: () => actions['overlay-leave'](),
  list: [
    ['i-moon', t('Veille'), () => sleepNow(), 'sc-sleep'],
    ['i-power', t('Alimentation'), () => actions['power-open'](), 'sc-power'],
    ['i-gamepad', t('Streaming local'), () => openStreaming(), 'sc-kaneplay'],
    ['i-volume', 'Dolby Atmos', () => go('settings', { section: 'dolby' }), 'sc-dolby'],
    // Manette qui ne répond plus (retour d'une autre application) : déconnexion puis reconnexion
    ['i-refresh', t('Reconnecter les manettes'), () => { native.send('pads-reconnect'); toast(t('Manettes reconnectées')); }, 'sc-pads'],
  ],
});
hooks.qam = () => openLayer({
  el: $('#qam'), name: 'qam', scrim: true,
  onOpen: () => { renderQam().then(pollSystem); sysTimer = setInterval(pollSystem, 1500); startLive(); },
  onClose: () => { clearInterval(sysTimer); stopLive(); overlayClosed(); },
  hints: () => [['a', t('Sélectionner')], [['left', 'right'], t('Régler')], ['b', t('Fermer')]],
});

on('notifications', list => {
  if (!$('#notifs')) return;
  $('#notifs').className = list.length ? '' : 'notif-empty';
  $('#notifs').innerHTML = list.length
    ? list.map(n => `<div class="notif">${esc(n.msg)}<small>${n.at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('')
    : t('Aucune nouvelle notification');
});

// ---------- Barre d'état ----------
// Horloge : 24 h ou 12 h, secondes au choix (Paramètres → Apparence)
const tick = () => {
  $('#clock').textContent = new Date().toLocaleTimeString(locale, {
    hour: settings.clock24 ? '2-digit' : 'numeric', minute: '2-digit', ...(settings.clockSeconds ? { second: '2-digit' } : {}), hour12: !settings.clock24,
  });
  $('#battery span').hidden = !settings.batteryPct;
};
tick();
setInterval(tick, 1000);
if (navigator.getBattery) {
  navigator.getBattery().then(b => {
    const upd = () => {
      $('#battery').hidden = b.charging && b.level === 1;
      $('#battery span').textContent = Math.round(b.level * 100) + ' %';
    };
    b.addEventListener('levelchange', upd);
    b.addEventListener('chargingchange', upd);
    upd();
  }).catch(() => {});
}
// Réseau : câble, Wi-Fi (plus pâle quand le signal est faible) ou hors ligne. Relu toutes les 20 s
// et au retour sur KaneMode ; l'icône Wi-Fi restait affichée même en filaire.
const NET = { ethernet: ['i-ethernet', t('Connecté par câble')], wifi: ['i-wifi', t('Wi-Fi')], none: ['i-wifi-off', t('Hors ligne')] };
async function paintNet() {
  if (document.hidden) return;
  try {
    const n = await api.get('/api/net');
    if (!NET[n.kind]) { setTimeout(paintNet, 3000); return; } // réglages système pas encore prêts
    const [icon, label] = NET[n.kind];
    const el = $('#net-icon');
    el.querySelector('use').setAttribute('href', '#' + icon);
    el.classList.toggle('net-off', n.kind === 'none');
    el.classList.toggle('net-weak', n.kind === 'wifi' && n.signal != null && n.signal < 40);
    el.setAttribute('aria-label', n.kind === 'wifi' && n.signal != null ? `${label} · ${n.signal} %` : label);
  } catch { setTimeout(paintNet, 5000); } // hôte pas encore prêt
}
paintNet();
setInterval(paintNet, 20000);
native.on(m => { if (m.type === 'resume' || m.type === 'wake') paintNet(); });
// Steam (Steam Input) garde les manettes Xbox tant qu'il tourne : hors de KaneMode le curseur ne bouge
// plus. À l'activation du mode souris, on propose de le fermer (une question par activation, et jamais
// pendant un jeu Steam ni si KaneMode n'est pas devant : personne ne verrait la question).
let steamAsked = false;
async function askQuitSteam() {
  if (steamAsked || settings.steamMouseAsk === false || topLayer() || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  try {
    const s = await api.get('/api/steam/state');
    if (!s.running || s.game) return;
    steamAsked = true;
    const choice = await dialog({
      title: t('Quitter Steam ?'),
      text: t('Tant que Steam tourne, il garde la manette : le mode souris ne répond que dans KaneMode. Steam se relance tout seul au prochain jeu Steam lancé depuis KaneMode.'),
      buttons: [{ label: t('Quitter Steam'), value: 'quit', primary: true }, { label: t('Garder Steam'), value: 'keep' }, { label: t('Ne plus demander'), value: 'never' }],
    });
    if (choice === 'never') { settings.steamMouseAsk = false; saveSettings(); }
    if (choice === 'quit') {
      await api.post('/api/steam/quit', {});
      toast(t('Steam se ferme…'));
    }
  } catch (e) { toast(e.message, { error: true }); }
}
// Mode souris (Start maintenu 1 s, comme dans KanePlay) : l'app native déplace la vraie souris
native.on(m => {
  if (m.type !== 'mouse-mode') return;
  $('#mouse-pill').hidden = !m.on;
  steamAsked = false;
  if (m.on) setTimeout(askQuitSteam, 700);
  toast(m.on ? t('Mode souris · stick : curseur · A : clic · B : clic droit · croix : défilement · Start maintenu : quitter') : t('Mode souris désactivé'));
});
addEventListener('gamepadconnected', e => toast(t('Manette connectée : {a}', { a: e.gamepad.id.replace(/\(.*?\)/g, '').trim() || t("manette") })));

// ---------- Synchronisation ----------
function paintMenuFoot() {
  const games = lib.visible().filter(g => g.type === 'game').length;
  $('#menu-foot').innerHTML = t('{games} jeux · {a} applis<br>{length} boutiques détectées{b}', { games, a: lib.visible().length - games, length: lib.launchers.filter(l => l.installed).length, b: settings.demo ? t("<br>Bibliothèque de démonstration active") : '' });
}
// Bibliothèque modifiée. Une action de l'utilisateur redessine tout de suite ; une mise à jour de
// fond attend qu'il ne navigue plus et qu'aucun menu ne soit ouvert, pour ne jamais saccader.
let fullTimer = 0;
function applyLibrary() {
  clearTimeout(fullTimer);
  if (Date.now() - input.last < 1500 || topLayer()) { fullTimer = setTimeout(applyLibrary, 700); return; }
  paintMenuFoot();
  const p = currentPage();
  if (p && p.libBound) refresh();
}
on('library', ({ background } = {}) => {
  if (background) return applyLibrary();
  clearTimeout(fullTimer);
  paintMenuFoot();
  const p = currentPage();
  if (p && p.libBound) refresh();
});

// Données seules (métadonnées, temps de jeu, visuels) : mises à jour sur place, sans redessiner
on('library-soft', ({ art = [] } = {}) => {
  for (const g of art) {
    $$(`.card[data-id="${CSS.escape(g.id)}"]`).forEach(c => swapArt(c, g));
  }
  // Panneau d'information de l'élément sélectionné (description, genres, temps de jeu…)
  const p = currentPage();
  if (p && p.soft) p.soft();
  else if (p && p.onFocus && !topLayer()) {
    const f = p.el.querySelector('.focused[data-id]');
    if (f) p.onFocus(f);
  }
});

// Les métadonnées arrivent en arrière-plan, sans indicateur : on relit quand l'hôte signale du nouveau.
setInterval(async () => {
  if (document.hidden || !document.hasFocus()) return;
  try {
    const s = await api.get('/api/status');
    if (s.version !== lib.version) await lib.load({ background: true });
  } catch { /* hôte injoignable */ }
}, 4000);

// ---------- Mises à jour de KaneMode ----------
function paintUpdate(last) {
  const v = last && last.available && last.latest ? last.latest.version : null;
  $('#menu-update').hidden = !v;
  $('#update-dot').hidden = !v;
  if (v) $('#menu-update span').textContent = t('Mise à jour {v} disponible', { v });
}
async function checkUpdate() {
  try {
    const u = await api.get('/api/update');
    paintUpdate(u.last);
    if (!u.auto) return;
    const last = +(localStorage.getItem('km.updateChecked') || 0);
    // Au plus une fois par heure (GitHub limite les requêtes sans compte)
    if (u.last && Date.now() - last < 3600e3) return;
    localStorage.setItem('km.updateChecked', String(Date.now()));
    const r = await api.post('/api/update/check');
    paintUpdate(r);
    if (r.available && localStorage.getItem('km.updateToast') !== r.latest.version) {
      localStorage.setItem('km.updateToast', r.latest.version);
      toast(t('KaneMode {version} disponible · Menu → Mise à jour', { version: r.latest.version }), { notify: true });
    }
  } catch { /* hors ligne */ }
}
// ---------- Pilotes disponibles ----------
// L'hôte vérifie une fois par jour la carte graphique (NVIDIA, AMD, Intel) et, sur console ASUS, le
// BIOS et les pilotes du constructeur : chaque nouvelle version est signalée une fois
async function checkDrivers() {
  try {
    const r = await api.get('/api/drivers/summary');
    const seen = new Set(store.get('driverNotified', []));
    const fresh = (r.items || []).filter(i => !seen.has(i.key));
    if (!fresh.length) return;
    fresh.forEach(i => seen.add(i.key));
    store.set('driverNotified', [...seen].slice(-50));
    toast(fresh.length === 1 ? t('Nouveau pilote : {title} · Paramètres → Appareil et pilotes', { title: fresh[0].title })
      : t('{length} nouveaux pilotes disponibles · Paramètres → Appareil et pilotes', { length: fresh.length }), { notify: true });
  } catch { /* hôte injoignable */ }
}
setTimeout(checkDrivers, 90e3); // l'hôte vérifie une minute après le démarrage
setInterval(checkDrivers, 3 * 3600e3);

actions['update-open'] = () => {
  actions['overlay-leave']();
  closeLayer();
  resetHistory();
  state.history.push({ id: 'home', params: {} });
  go('settings', { section: 'system', focus: 'upd-check' }, { push: false });
};

// ---------- Démarrage ----------
(async () => {
  // La bibliothèque se charge pendant le logo (ou la vidéo) de démarrage.
  const loading = lib.load().catch(() => toast(t('Hôte injoignable : lancez « node host/server.js »'), { error: true }));
  if (!RELOADED) await playBoot();
  const started = performance.now();
  await loading;
  go('home', {}, { push: false });
  // Après le logo animé, pas de second logo : l'accueil apparaît directement.
  const wait = settings.splash && settings.bootMode === 'none' && !RELOADED ? Math.max(0, 1100 - (performance.now() - started)) : 0;
  setTimeout(() => { $('#splash').classList.add('hide'); focusIn(currentPage().el); }, wait);
  prefetchQam();
  // Nouvelle version de KaneMode ? Vérifiée au démarrage puis toutes les heures (canal choisi
  // dans Paramètres → Système) ; signalée dans le menu et en haut de l'écran.
  checkUpdate();
  setInterval(checkUpdate, 3600e3);
  // KaneMode reste ouvert des jours en mode Xbox : on vérifie aussi au retour d'un jeu et au réveil
  native.on(m => { if (m.type === 'resume' || m.type === 'wake') checkUpdate(); });
  // Première fois sur une console portable : interface agrandie pour son petit écran
  api.get('/api/device').then(d => {
    const hh = d && d.handheld;
    if (!hh || settings.handheldSeen === hh.id) return;
    settings.handheldSeen = hh.id;
    if (settings.uiScale === 100) settings.uiScale = 125;
    settings.lowFx = true; // plus fluide et plus économe sur une console portable
    saveSettings();
    toast(t('{name} détectée · interface adaptée (Paramètres → Appareil et pilotes)', { name: hh.name }), { notify: true });
  }).catch(() => {});
})();
