// Démarrage : pages, menus latéraux, accès rapide, barre d'état, synchronisation avec l'hôte.
import { $, $$, api, lib, settings, saveSettings, applyTheme, toast, busy, on, getNotifications, esc, fmt, sfx, native } from './core.js';
import { state, go, refresh, openLayer, closeLayer, topLayer, currentPage, actions, hooks, focusIn, setFocus, resetHistory, input } from './nav.js';
import { swapArt } from './cards.js';
import { confirmDialog } from './widgets.js';
import { playBoot } from './boot.js';
import { sleepNow } from './power.js';
import { renderQam, prefetchQam } from './qam.js';
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
actions.exit = () => { closeLayer(); exitToDesktop(); };
actions['stream-open'] = () => { closeLayer(); openStreaming(); };

// ---------- Menu principal ----------
hooks.menu = () => openLayer({
  el: $('#menu'), name: 'menu', scrim: true, focusKey: state.page,
  hints: () => [['a', 'Sélectionner'], ['b', 'Fermer']],
});
actions['menu-go'] = t => {
  closeLayer();
  const target = t.dataset.page;
  resetHistory();
  if (target !== 'home') state.history.push({ id: 'home', params: {} });
  go(target, {}, { push: false });
};
// Menu d'alimentation au centre de l'écran (menu principal, accès rapide)
export function openPowerMenu() {
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
native.on(m => { if (m.type === 'resume' && !document.hidden) lib.load({ background: true }).catch(() => {}); });
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
  onOpen: () => { renderQam().then(pollSystem); sysTimer = setInterval(pollSystem, 1500); },
  onClose: () => clearInterval(sysTimer),
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
  // Nouvelle version de KaneMode ? (au plus une vérification par jour)
  api.get('/api/update').then(async u => {
    if (!u.auto) return;
    const last = +(localStorage.getItem('km.updateChecked') || 0);
    if (Date.now() - last < 20 * 3600e3) return;
    localStorage.setItem('km.updateChecked', String(Date.now()));
    const r = await api.post('/api/update/check');
    if (r.available) toast(`KaneMode ${r.latest.version} disponible · Paramètres → Système`, { notify: true });
  }).catch(() => {});
  // Première fois sur une console portable : interface agrandie pour son petit écran
  api.get('/api/device').then(d => {
    const hh = d && d.handheld;
    if (!hh || settings.handheldSeen === hh.id) return;
    settings.handheldSeen = hh.id;
    if (settings.uiScale === 100) settings.uiScale = 125;
    saveSettings();
    toast(`${hh.name} détectée · interface adaptée (Paramètres → Console portable)`, { notify: true });
  }).catch(() => {});
})();
