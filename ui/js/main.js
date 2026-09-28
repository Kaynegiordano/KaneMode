// Démarrage : pages, menus latéraux, accès rapide, barre d'état, synchronisation avec l'hôte.
import { $, $$, api, lib, settings, saveSettings, applyTheme, toast, busy, on, getNotifications, esc, fmt, sfx, native } from './core.js';
import { state, go, refresh, openLayer, closeLayer, topLayer, currentPage, actions, hooks, focusIn, setFocus, resetHistory, input } from './nav.js';
import { swapArt } from './cards.js';
import { confirmDialog } from './widgets.js';
import { playBoot } from './boot.js';
import { sleepNow } from './power.js';
import { renderQam, prefetchQam, startLive, stopLive } from './qam.js';
import { exitToDesktop, openStreaming } from './pages/game.js';
import './pages/home.js';
import './pages/library.js';
import './pages/search.js';
import './pages/add.js';
import './pages/settings.js';
import './pages/artpicker.js';
import './pages/media.js';
import './pages/emulation.js';

applyTheme();
// L'écran de démarrage couvre tout dès le chargement.
if (settings.bootMode !== 'none') $('#boot').hidden = false;
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
    overlay.active = false;
    while (topLayer()) closeLayer();
    if (currentPage() && currentPage().id !== 'home') { resetHistory(); go('home', {}, { push: false }); }
  } else if (m.type === 'desktop-failed') {
    toast('Le mode Xbox est resté actif : KaneMode reste ouvert. Réessayez, ou utilisez la touche Windows.', { error: true });
  }
});

actions.exit = () => { actions['overlay-leave'](); closeLayer(); exitToDesktop(); };
actions['stream-open'] = () => { actions['overlay-leave'](); closeLayer(); openStreaming(); };

// ---------- Menu principal ----------
hooks.menu = () => openLayer({
  el: $('#menu'), name: 'menu', scrim: true, focusKey: state.page, onClose: overlayClosed,
  hints: () => [['a', 'Sélectionner'], ['b', 'Fermer']],
});
actions['menu-go'] = t => {
  actions['overlay-leave']();
  closeLayer();
  const target = t.dataset.page;
  resetHistory();
  if (target !== 'home') state.history.push({ id: 'home', params: {} });
  go(target, {}, { push: false });
};
// Menu d'alimentation au centre de l'écran (menu principal, accès rapide)
export function openPowerMenu() {
  actions['overlay-leave']();
  closeLayer();
  if (topLayer()) closeLayer();
  openLayer({ el: $('#power'), name: 'power', scrim: true, focusKey: 'sleep', hints: () => [['a', 'Choisir'], ['b', 'Annuler']] });
}
actions['power-open'] = openPowerMenu;
actions['power-close'] = () => closeLayer();
const SYSTEM = {
  desktop: ['Aller au bureau Windows ?', 'Le mode console se ferme et le bureau s’affiche.', 'Aller au bureau'],
  sleep: ['Mettre en veille ?', 'Le PC passe en veille. Appuyez sur un bouton de la manette pour le réveiller.', 'Mettre en veille'],
  restart: ['Redémarrer le PC ?', 'Pensez à sauvegarder vos parties en cours.', 'Redémarrer'],
  shutdown: ['Éteindre le PC ?', 'Pensez à sauvegarder vos parties en cours.', 'Éteindre'],
};
actions.system = async t => {
  const [title, text, ok] = SYSTEM[t.dataset.system];
  closeLayer();
  // Comme sur SteamOS, la veille est immédiate ; redémarrer et éteindre demandent confirmation.
  if (t.dataset.system === 'sleep') return sleepNow();
  if (!await confirmDialog(title, text, ok, t.dataset.system !== 'desktop')) return;
  // App native : vraie veille / vrai redémarrage / vraie extinction. Navigateur : simulé.
  if (native.available) return native.send('power', { action: t.dataset.system });
  await api.post('/api/action', { action: t.dataset.system });
  toast(`${ok} : simulé dans le prototype (aucune action réelle)`);
};

// Retour sur KaneMode (fin d'un jeu, alt-tab) : la bibliothèque se met à jour (temps de jeu, installations…).
// L'hôte refait aussi l'analyse des boutiques (au plus une fois par minute) : la liste suit d'elle-même.
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
    $('#mem-val').textContent = fmt.gb(s.memUsed).replace(' Go', '') + ' / ' + fmt.gb(s.memTotal);
  } catch { /* hôte injoignable */ }
}
hooks.qam = () => openLayer({
  el: $('#qam'), name: 'qam', scrim: true,
  onOpen: () => { renderQam().then(pollSystem); sysTimer = setInterval(pollSystem, 1500); startLive(); },
  onClose: () => { clearInterval(sysTimer); stopLive(); overlayClosed(); },
  hints: () => [['a', 'Sélectionner'], [['left', 'right'], 'Régler'], ['b', 'Fermer']],
});

on('notifications', list => {
  if (!$('#notifs')) return;
  $('#notifs').className = list.length ? '' : 'notif-empty';
  $('#notifs').innerHTML = list.length
    ? list.map(n => `<div class="notif">${esc(n.msg)}<small>${n.at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('')
    : 'Aucune nouvelle notification';
});

// ---------- Barre d'état ----------
// Horloge : 24 h ou 12 h, secondes au choix (Paramètres → Apparence)
const tick = () => {
  $('#clock').textContent = new Date().toLocaleTimeString(settings.clock24 ? 'fr-FR' : 'en-US', {
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
addEventListener('gamepadconnected', e => toast(`Manette connectée : ${e.gamepad.id.replace(/\(.*?\)/g, '').trim() || 'manette'}`));

// ---------- Synchronisation ----------
function paintMenuFoot() {
  const games = lib.visible().filter(g => g.type === 'game').length;
  $('#menu-foot').innerHTML = `${games} jeux · ${lib.visible().length - games} applis<br>${lib.launchers.filter(l => l.installed).length} boutiques détectées${settings.demo ? '<br>Bibliothèque de démonstration active' : ''}`;
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
  if (v) $('#menu-update span').textContent = `Mise à jour ${v} disponible`;
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
      toast(`KaneMode ${r.latest.version} disponible · Menu → Mise à jour`, { notify: true });
    }
  } catch { /* hors ligne */ }
}
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
  const loading = lib.load().catch(() => toast('Hôte injoignable : lancez « node host/server.js »', { error: true }));
  await playBoot();
  const started = performance.now();
  await loading;
  go('home', {}, { push: false });
  // Après le logo animé, pas de second logo : l'accueil apparaît directement.
  const wait = settings.splash && settings.bootMode === 'none' ? Math.max(0, 1100 - (performance.now() - started)) : 0;
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
    toast(`${hh.name} détectée · interface adaptée (Paramètres → Console portable)`, { notify: true });
  }).catch(() => {});
})();
