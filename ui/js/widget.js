// Widget Game Bar de KaneMode (widget.html) : un HUD par-dessus les jeux, façon Winhanced. Profils
// d'énergie avec leur puissance, tuiles de réglages par catégorie (écran, système, son, réseau, mise à
// l'échelle), jeu en cours et raccourcis vers KaneMode. La page tourne dans le widget UWP, qui relaie
// ses requêtes à l'hôte et ses messages à l'app KaneMode (core.js : WIDGET, toApp).
import { $, el, esc, api, toast, settings, saveSettings, applyTheme, WIDGET, toApp, sfx } from './core.js';
import { nav, focusIn, focused } from './nav.js';
import { PERF_MODES, PROFILE_WATTS, VENDOR_LABELS, vendorFor } from './qam.js';

// ---------------------------------------------------------------- icônes (traits, comme la Game Bar)
const PATHS = {
  eco: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  balanced: 'M12 3v18M6 21h12M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z',
  performance: 'M13 2 4 14h7l-1 8 9-12h-7z',
  custom: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  resolution: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  brightness: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  hdr: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M12 8h4M12 12h6M12 16h4',
  boost: 'M7 7h10v10H7zM10 10h4v4h-4zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
  cpumax: 'M4 18a8 8 0 1 1 16 0M12 18l4-6',
  vendor: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 10c0-4 2-6 4-6M14 12c4 0 6 2 6 4M12 14c0 4-2 6-4 6M10 12c-4 0-6-2-6-4',
  tdp: 'M13 2 4 14h7l-1 8 9-12h-7z',
  charge: 'M3 8h15v8H3zM21 11v2M9 9l-2 3h4l-2 3',
  volume: 'M4 9h4l5-4v14l-5-4H4zM17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6',
  wifi: 'M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01',
  bluetooth: 'M7 7l10 10-5 5V2l5 5L7 17',
  lossless: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M9 9h6v6H9z',
  game: 'M6 9h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5 2l-2-2H9l-2 2a3 3 0 0 1-5-2v-1a4 4 0 0 1 4-4zM8 11v4M6 13h4M16 12h.01M18 14h.01',
  power: 'M12 2v10M5.6 6.6a8 8 0 1 0 12.8 0',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l4 1-3 14-4-1z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
  sleep: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  chevron: 'M6 9l6 6 6-6',
};
const svg = id => `<svg class="hud-i" viewBox="0 0 24 24"><path d="${PATHS[id]}"/></svg>`;

// Icônes de marque (logo) : le même jeu de symboles que l'interface de KaneMode, repris d'index.html
async function loadSprite() {
  try {
    const doc = new DOMParser().parseFromString(await (await fetch('index.html')).text(), 'text/html');
    const s = doc.querySelector('body > svg');
    if (s) document.body.prepend(document.importNode(s, true));
  } catch { /* sans logo */ }
}

// ---------------------------------------------------------------- état
let sys = null, live = null, info = null, game = null;
const CATS = [['all', 'Tout'], ['display', 'Écran'], ['system', 'Système'], ['sound', 'Son'], ['network', 'Réseau'], ['scaling', 'Mise à l’échelle']];
const filter = () => (CATS.some(c => c[0] === settings.hudFilter) ? settings.hudFilter : 'all');
const onBattery = () => live && live.discharging === true;
const fmtW = w => String(Math.round(w * 10) / 10).replace('.', ',') + ' W';
const watts = vmode => { const t = sys && PROFILE_WATTS[sys.handheld]; const w = t && vmode && t[vmode]; return w ? w[onBattery() ? 0 : 1] : null; };
const tdpLimits = () => sys && sys.vendor && sys.vendor.tdp;
const tdpValue = () => { const t = tdpLimits(); return t ? Math.max(t.min, Math.min(t.max, settings.hudTdp || Math.round((t.min + t.max) / 2))) : null; };

/** Un réglage du système ; l'état revient de l'hôte et la page se redessine. */
async function send(cmd, value, extra = {}) {
  try {
    const r = await api.post('/api/sys', { cmd, value, ...extra });
    if (cmd === 'radio') { const x = sys.radios.find(o => o.kind === extra.kind); if (x) x.on = !!r.on; }
    else if (cmd === 'refresh') sys.refresh.current = r.refresh;
    else if (cmd === 'resolution') { sys.resolution.current = r.resolution; loadSys(); }
    else if (cmd === 'boost') sys.cpu.boostAc = r.boost ? 2 : 0;
    else if (cmd === 'cpumax') sys.cpu.maxAc = r.cpuMax;
    else if (cmd === 'vendor') sys.vendor = r;
    else if (cmd === 'chargelimit') sys.vendor.chargeLimit = value;
    else if (cmd === 'hdr') sys.hdr = r.hdr;
    else if (cmd === 'mute') sys.muted = r.muted;
    else if (cmd === 'volume') sys.volume = r.volume;
    else if (cmd === 'brightness') sys.brightness = r.brightness;
    if (['vendor', 'tdp', 'cpumax', 'boost'].includes(cmd)) sys.mode = 'custom';
  } catch (e) { toast(e.message, { error: true }); }
  render();
}
/** Valeurs qui changent vite (curseurs) : envoyées 150 ms après le dernier appui. */
const later = {};
function soon(cmd, value, apply) {
  apply(value);
  render();
  clearTimeout(later[cmd]);
  later[cmd] = setTimeout(() => send(cmd, value), 150);
}
const nextOf = (list, cur) => { const i = list.findIndex(v => String(v) === String(cur)); return list[(i + 1) % list.length]; };
const nextAbove = (list, cur) => list.find(v => v > cur + 0.5) ?? list[0];

// ---------------------------------------------------------------- tuiles
function tiles() {
  const out = [];
  const t = (o) => out.push(o);
  if (!sys) return out;
  // Écran
  if (sys.refresh && sys.refresh.available.length > 1) {
    const rates = [...new Set(sys.refresh.available.filter(hz => hz >= 30))].sort((a, b) => a - b);
    t({ key: 'refresh', cat: 'display', icon: 'refresh', title: 'Fréquence', value: `${sys.refresh.current} Hz`, cycle: true, act: () => send('refresh', nextOf(rates, sys.refresh.current)) });
  }
  if (sys.resolution && sys.resolution.available.length > 1) {
    const area = s => s.split('x').reduce((a, b) => a * b, 1);
    const sizes = [...new Set(sys.resolution.available)].sort((a, b) => area(b) - area(a)).slice(0, 6);
    if (!sizes.includes(sys.resolution.current)) sizes.unshift(sys.resolution.current);
    t({ key: 'resolution', cat: 'display', icon: 'resolution', title: 'Résolution', value: sys.resolution.current.replace('x', ' × '), cycle: true, act: () => send('resolution', nextOf(sizes, sys.resolution.current)) });
  }
  if (sys.brightness != null) {
    t({ key: 'brightness', cat: 'display', icon: 'brightness', title: 'Luminosité', value: `${sys.brightness} %`, cycle: true,
      act: () => send('brightness', nextAbove([10, 25, 50, 75, 100], sys.brightness)),
      dir: d => soon('brightness', Math.max(0, Math.min(100, sys.brightness + d * 10)), v => { sys.brightness = v; }) });
  }
  if (sys.hdr >= 0) t({ key: 'hdr', cat: 'display', icon: 'hdr', title: 'HDR', on: sys.hdr === 1, act: () => send('hdr', sys.hdr !== 1) });
  // Système
  const v = sys.vendor;
  if (v && v.modes) t({ key: 'vendor', cat: 'system', icon: 'vendor', title: 'Profil de la console', value: VENDOR_LABELS[v.mode] || v.mode || '—', cycle: true, act: () => send('vendor', nextOf(v.modes.filter(m => m !== 'custom'), v.mode)) });
  if (tdpLimits()) {
    const lim = tdpLimits();
    const setTdp = w => { settings.hudTdp = w; saveSettings(); };
    t({ key: 'tdp', cat: 'system', icon: 'tdp', title: 'Puissance (TDP)', value: `${tdpValue()} W`, cycle: true,
      act: () => { const w = nextAbove([lim.min, 10, 15, 20, 25, lim.max].filter(x => x >= lim.min && x <= lim.max).sort((a, b) => a - b), tdpValue()); setTdp(w); send('tdp', w); },
      dir: d => { const w = Math.max(lim.min, Math.min(lim.max, tdpValue() + d)); setTdp(w); soon('tdp', w, () => { sys.mode = 'custom'; }); } });
  }
  if (sys.cpu) {
    t({ key: 'boost', cat: 'system', icon: 'boost', title: 'Turbo du processeur', on: sys.cpu.boostAc !== 0, act: () => send('boost', sys.cpu.boostAc === 0) });
    t({ key: 'cpumax', cat: 'system', icon: 'cpumax', title: 'Limite du processeur', value: `${sys.cpu.maxAc} %`, cycle: true,
      act: () => send('cpumax', nextOf([100, 85, 70, 50], sys.cpu.maxAc)),
      dir: d => soon('cpumax', Math.max(30, Math.min(100, sys.cpu.maxAc + d * 5)), x => { sys.cpu.maxAc = x; sys.mode = 'custom'; }) });
  }
  if (v && v.chargeLimit != null) t({ key: 'charge', cat: 'system', icon: 'charge', title: 'Limite de charge', value: `${v.chargeLimit} %`, cycle: true, act: () => send('chargelimit', nextOf([60, 80, 100], v.chargeLimit)) });
  // Son
  if (sys.volume != null) {
    t({ key: 'volume', cat: 'sound', icon: 'volume', title: 'Volume', value: `${sys.volume} %`, cycle: true,
      act: () => send('volume', nextAbove([0, 25, 50, 75, 100], sys.volume)),
      dir: d => soon('volume', Math.max(0, Math.min(100, sys.volume + d * 5)), x => { sys.volume = x; }) });
    t({ key: 'mute', cat: 'sound', icon: 'mute', title: 'Sourdine', on: !!sys.muted, act: () => send('mute', !sys.muted) });
  }
  // Réseau
  for (const r of sys.radios || []) {
    const wifi = r.kind === 'WiFi';
    t({ key: 'radio:' + r.kind, cat: 'network', icon: wifi ? 'wifi' : 'bluetooth', title: wifi ? 'Wi-Fi' : 'Bluetooth', on: r.on, act: () => send('radio', !r.on, { kind: r.kind }) });
  }
  // Mise à l'échelle
  if (info && info.lossless) {
    const ls = info.lossless;
    t({ key: 'lossless', cat: 'scaling', icon: 'lossless', title: 'Lossless Scaling', wide: true,
      value: ls.running ? 'Mettre à l’échelle' : 'Lancer', sub: ls.running ? 'Raccourci Ctrl + Alt + S du jeu en cours' : 'Lossless Scaling n’est pas ouvert',
      act: async () => {
        if (ls.running) { await toApp('lossless').catch(() => {}); toast('Mise à l’échelle : Lossless Scaling'); }
        else if (ls.id) { try { await api.post('/api/launch', { id: ls.id }); toast('Ouverture de Lossless Scaling…'); } catch (e) { toast(e.message, { error: true }); } }
      } });
  }
  return out;
}

function tileEl(o) {
  const toggle = o.on !== undefined;
  const d = el('div', `hud-tile${toggle && o.on ? ' on' : ''}${o.wide ? ' wide' : ''}`,
    `<div class="hud-tile-top">${svg(o.icon)}<span>${esc(o.title)}</span>${toggle ? '<i class="hud-dot"></i>' : o.cycle ? svg('chevron') : ''}</div>` +
    (toggle ? `<b>${o.on ? 'Activé' : 'Désactivé'}</b>` : `<b class="hud-value">${esc(o.value)}</b>`) +
    `<small>${esc(o.sub || (toggle ? '' : o.dir ? 'Toucher ou ◀ ▶' : 'Toucher pour changer'))}</small>`);
  nav(d, () => { sfx('select'); o.act(); }, 'tile:' + o.key);
  if (o.dir) d._dir = dir => (dir === 'left' || dir === 'right' ? (o.dir(dir === 'right' ? 1 : -1), true) : false);
  return d;
}

// ---------------------------------------------------------------- page
function render() {
  const body = $('#hud-body');
  const keep = focused && body.contains(focused) ? focused.dataset.key : null;
  const parts = [];

  // Jeu en cours
  const card = el('div', 'hud-card hud-game');
  card.innerHTML = `<div class="hud-game-icon">${svg('game')}</div>` + (game
    ? `<div class="hud-game-text"><small class="now-playing">En cours</small><b>${esc(game.name || 'Jeu')}</b></div>`
    : '<div class="hud-game-text"><span>Aucun jeu en cours. Lancez-en un depuis KaneMode pour le retrouver ici.</span></div>');
  if (game) card.append(stopButton());
  parts.push(card);

  // Profils d'énergie
  if (sys) {
    parts.push(el('h3', 'hud-h', 'Profil d’énergie'));
    const row = el('div', 'hud-profiles');
    const modes = [...PERF_MODES, ['custom', 'Personnalisé']];
    for (const [mode, label] of modes) {
      const w = mode === 'custom' ? (tdpLimits() ? tdpValue() : null) : watts(vendorFor(mode, sys));
      const p = el('div', 'hud-profile' + (sys.mode === mode ? ' active' : ''), `${svg(mode)}<b>${esc(label)}</b><small>${w ? w + ' W' : '&nbsp;'}</small>`);
      nav(p, () => pickMode(mode), 'mode:' + mode);
      row.append(p);
    }
    parts.push(row);
  }

  // Catégories et tuiles
  const chips = el('div', 'hud-chips');
  for (const [id, label] of CATS) {
    const c = el('div', 'hud-chip' + (filter() === id ? ' active' : ''), esc(label));
    nav(c, () => { settings.hudFilter = id; saveSettings(); render(); focusIn($('#hud-body'), 'cat:' + id, { scroll: false }); }, 'cat:' + id);
    chips.append(c);
  }
  parts.push(chips);
  const list = tiles().filter(o => filter() === 'all' || o.cat === filter());
  const grid = el('div', 'hud-grid');
  list.forEach(o => grid.append(tileEl(o)));
  parts.push(list.length ? grid : el('div', 'hud-empty', sys ? 'Rien à régler dans cette catégorie sur ce PC.' : 'Lecture des réglages…'));

  // Raccourcis vers KaneMode
  parts.push(el('h3', 'hud-h', 'KaneMode'));
  const sc = el('div', 'hud-shortcuts');
  for (const [icon, label, act, key] of [
    ['home', 'Ouvrir', () => toApp('show'), 'sc-open'],
    ['library', 'Bibliothèque', () => toApp('show', { page: 'library' }), 'sc-library'],
    ['settings', 'Paramètres', () => toApp('show', { page: 'settings' }), 'sc-settings'],
    ['sleep', 'Veille', () => toApp('power', { action: 'sleep' }), 'sc-sleep'],
  ]) sc.append(nav(el('div', 'hud-short', `${svg(icon)}<span>${esc(label)}</span>`), () => act().catch(e => toast(e.message, { error: true })), key));
  parts.push(sc);

  body.replaceChildren(...parts);
  paintHead();
  if (keep) focusIn(body, keep, { scroll: false });
}

async function pickMode(mode) {
  if (mode === 'custom') {
    // Personnalisé : la puissance réglée dans « Système » (TDP), sinon juste la catégorie
    settings.hudFilter = 'system'; saveSettings();
    if (tdpLimits()) return send('tdp', tdpValue());
    return render();
  }
  try {
    const r = await api.post('/api/power/mode', { mode });
    if (r.state) sys = r.state;
    toast(`Mode ${PERF_MODES.find(m => m[0] === mode)[1]} appliqué`);
  } catch (e) { toast(e.message, { error: true }); }
  render();
}

// Arrêter le jeu : deux appuis (le premier demande confirmation), puis fermeture forcée s'il résiste
let stopArmed = 0, stopAsked = 0;
function stopButton() {
  const forcing = stopAsked && Date.now() - stopAsked > 8000;
  const armed = stopArmed && Date.now() - stopArmed < 4000;
  const b = el('div', 'hud-stop' + (armed || forcing ? ' danger' : ''), `${svg('power')}<span>${forcing ? 'Forcer' : armed ? 'Confirmer' : 'Arrêter'}</span>`);
  return nav(b, async () => {
    if (!forcing && !armed) { stopArmed = Date.now(); render(); setTimeout(render, 4100); return; }
    stopArmed = 0;
    try {
      await toApp('game-stop', { id: game.id, dir: game.dir, force: !!forcing });
      toast(forcing ? 'Fermeture forcée' : `Fermeture de ${game.name || 'jeu'}…`);
      if (!forcing) { stopAsked = Date.now(); setTimeout(render, 8100); }
    } catch (e) { toast(e.message, { error: true }); }
    render();
  }, 'game-stop');
}

function paintHead() {
  $('#hud-version').textContent = info && info.version ? ' ' + info.version : '';
  const pill = $('#hud-watts');
  const w = onBattery() && live.watts != null ? live.watts
    : sys && sys.mode === 'custom' && tdpLimits() ? tdpValue()
      : sys && sys.vendor ? watts(sys.vendor.mode) : null;
  pill.hidden = w == null;
  if (w != null) { pill.textContent = fmtW(w); pill.title = onBattery() ? 'Consommation actuelle' : 'Puissance du profil'; }
}
function status(text) {
  const s = $('#hud-status');
  s.hidden = !text;
  s.textContent = text || '';
}

// ---------------------------------------------------------------- données
async function loadSys() {
  try { sys = await api.get('/api/sys'); status(''); }
  catch (e) { status(WIDGET ? 'KaneMode n’est pas ouvert : ouvrez-le pour régler le système.' : e.message); }
  render();
}
async function loadLive() {
  try { live = await api.get('/api/sys/live'); paintHead(); } catch { /* KaneMode occupé ou fermé */ }
}
async function loadGame() {
  if (!WIDGET) return; // aperçu dans un navigateur : l'état du jeu vient de l'app KaneMode
  try {
    const next = (await toApp('widget-state')).game || null;
    if ((next && next.id) !== (game && game.id)) stopArmed = stopAsked = 0;
    const changed = JSON.stringify(next) !== JSON.stringify(game);
    game = next;
    if (changed) render();
  } catch { /* KaneMode fermé : signalé par loadSys */ }
}
async function loadInfo() {
  try { info = await api.get('/api/widget'); } catch { info = null; }
  // Même couleur d'accent que KaneMode (pour ce widget seulement, sans la renvoyer)
  if (info && info.accent && info.accent !== settings.accent) { settings.accent = info.accent; applyTheme(); }
  render();
}

let timers = [];
function start() {
  stop();
  loadSys(); loadLive(); loadGame(); loadInfo();
  timers = [setInterval(loadLive, 2000), setInterval(loadGame, 3000), setInterval(loadSys, 15000), setInterval(loadInfo, 20000)];
}
function stop() { timers.forEach(clearInterval); timers = []; }
// Game Bar fermée : plus de mesures ni de requêtes
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

(async () => {
  applyTheme();
  await loadSprite();
  render();
  focusIn($('#hud-body'));
  start();
})();
