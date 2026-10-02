// Briques partagées : DOM, stockage, réglages, sons, toasts, API de l'hôte, bibliothèque.
import { t, tx, locale, lang } from './i18n.js';
import { streamingArt } from './streamcover.js';
import { quietInterfaceDefaults } from './sound-settings.js';
import { getSoundPalette } from './soundtable.js';
import { appearance, activeDisplayProfile, DISPLAY_FIELDS } from './personalization.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
export const icon = (id, cls = '') => `<svg${cls ? ` class="${cls}"` : ''}><use href="#${id}"/></svg>`;
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- Événements ----------
const listeners = {};
export const on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
export const emit = (ev, data) => (listeners[ev] || []).forEach(fn => fn(data));

// ---------- Stockage local (préférences par appareil) ----------
/**
 * Ordre choisi par l'utilisateur complété des éléments qu'il n'a jamais vus : chacun est placé avant
 * celui qui le suit dans l'ordre par défaut (une nouvelle rangée ne tombe pas en dernier).
 */
export function mergeOrder(defaults, saved) {
  const order = (Array.isArray(saved) ? saved : []).filter(id => defaults.includes(id));
  defaults.forEach((id, i) => {
    if (order.includes(id)) return;
    const next = defaults.slice(i + 1).find(n => order.includes(n));
    order.splice(next ? order.indexOf(next) : order.length, 0, id);
  });
  return order;
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem('km.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('km.' + k, JSON.stringify(v)); } catch { /* ignoré */ } },
};

export const settings = Object.assign({
  wifi: true, bluetooth: false, night: false, sounds: false, brightness: 70, volume: 45, fps: '0', overlay: 'off',
  accent: '#1a9fff', background: 'art', badges: true, steamMouseAsk: true, splash: true, bootMode: 'logo', bootSound: 'chime', bootVolume: 70, dimAfter: 5, sleepAfterBattery: 15, sleepAfterAC: 0, wakeAnimation: true, cardSize: 'm', corners: 'soft', solidPanels: false, font: 'segoe', clock24: true, clockSeconds: false, batteryPct: true, homeRows: ['recent', 'emulation', 'apps', 'stores'], qamOrder: null, qamHidden: [], tdp: 0, simulateDevice: '', handheldSeen: '', demo: false, hiddenSources: [], sort: 'name',
  uiScale: 100, reduceMotion: false, highContrast: false, padGlyphs: 'auto', padSwap: false, hintsBar: 'full', lowFx: false, notifications: true, homeApps: true, homeStores: true,
  // Boutons de la ROG Ally (Command Center, Armoury Crate) : voir Paramètres → Appareil et pilotes
  btnCC: 'taskview', btnAC: 'gamebar', btnACHold: 'home', blockAsusPrompt: true,
  // Rangée « Bons plans et nouveautés » de l'accueil : sources, catégories, avance automatique
  dealsSteam: true, dealsEpic: true, dealsGog: true, dealsOther: true,
  dealsFree: true, dealsPromo: true, dealsNew: true, dealsSoon: true, dealsAuto: true,
  homePins: [], homeResume: true, homeDensity: 'comfortable', soundTheme: 'round', soundVolume: 100, soundMoves: true,
  motionStyle: 'normal', displayMode: 'manual', displayBindings: {}, displayProfiles: {}, immersive: false, immersiveDelay: 6, preventIdleLock: true,
}, store.get('settings', {}));
// 3.9.0 : silence de l'interface au premier lancement après mise à jour ; démarrage indépendant.
if (!settings.quietInterfaceDefault) {
  Object.assign(settings, quietInterfaceDefaults(settings));
  store.set('settings', settings);
}
// 1.3.1 : Command Center ouvre la vue des tâches, comme un appui long sur la touche Xbox (avant : l'accès rapide)
if (!settings.btnCCTaskView) {
  if (settings.btnCC === 'qam') settings.btnCC = 'taskview';
  settings.btnCCTaskView = true;
  store.set('settings', settings);
}
// 2.6.0 : la boutique de chaque jeu est affichée par défaut sur sa jaquette (demande de l'utilisateur) ;
// les installations existantes avaient enregistré l'ancien choix par défaut
if (!settings.badgesOnDefault) {
  settings.badges = true;
  settings.badgesOnDefault = true;
  store.set('settings', settings);
}
export const favs = new Set(store.get('favs', []));

export const displayState = { id: 'browser:' + screen.width + 'x' + screen.height, name: screen.width + ' × ' + screen.height };
export const effectiveSettings = () => appearance(settings, displayState.id);
export function setAppearance(key, value) {
  const profile = activeDisplayProfile(settings, displayState.id);
  if (profile !== 'manual' && DISPLAY_FIELDS.includes(key)) {
    settings.displayProfiles = { ...settings.displayProfiles, [profile]: { ...settings.displayProfiles?.[profile], [key]: value } };
  } else settings[key] = value;
  saveSettings();
}
export function saveSettings() { store.set('settings', settings); applyTheme(); syncAccent(); syncButtons(); syncSounds(); syncIdleProtection(); emit('settings'); }
function syncIdleProtection() {
  if (!WIDGET) native.send('idle-protection', { enabled: !!settings.preventIdleLock });
}
setTimeout(syncIdleProtection, 0);
let sentSounds = null;
function syncSounds() {
  if (WIDGET) return;
  const values = { sounds: !!settings.sounds, soundTheme: settings.soundTheme, soundVolume: settings.soundVolume, soundMoves: !!settings.soundMoves };
  const signature = JSON.stringify(values);
  if (signature === sentSounds) return;
  sentSounds = signature;
  api.post('/api/config', values).catch(() => { sentSounds = null; });
}
setTimeout(syncSounds, 0);

// Le streaming local reprend la couleur d'accent et les coins de KaneMode : l'hôte les lui transmet au lancement
let sentAccent = null;
function syncAccent() {
  const look = JSON.stringify([settings.accent, settings.corners]);
  if (WIDGET || look === sentAccent) return; // le widget reprend la couleur de KaneMode, il ne l'impose pas
  sentAccent = look;
  api.post('/api/config', { accent: settings.accent, corners: settings.corners }).catch(() => { sentAccent = null; });
}
setTimeout(syncAccent, 0);
// Langue en cours : l'hôte la transmet aux widgets Game Bar et au moteur de streaming
function syncLang() {
  if (WIDGET) return;
  api.post('/api/config', { lang }).catch(() => setTimeout(syncLang, 5000));
}
setTimeout(syncLang, 0);
// L'app native lit les boutons de la console : elle apprend ici ce qu'ils doivent faire
let sentButtons = null;
function syncButtons() {
  const b = { cc: settings.btnCC, ac: settings.btnAC, 'ac-hold': settings.btnACHold, blockPrompt: !!settings.blockAsusPrompt };
  if (JSON.stringify(b) === sentButtons) return;
  sentButtons = JSON.stringify(b);
  native.send('buttons', b);
}
setTimeout(syncButtons, 0);
export function saveFavs() { store.set('favs', [...favs]); }
export function applyTheme(preview = {}) {
  const view = { ...effectiveSettings(), ...preview };
  document.documentElement.style.setProperty('--accent', view.accent);
  document.body.classList.toggle('night', !!view.night);
  document.body.classList.toggle('show-badges', !!view.badges);
  document.body.classList.remove('bg-art', 'bg-gradient', 'bg-dark');
  document.body.classList.add('bg-' + view.background);
  document.body.classList.toggle('reduce-motion', !!view.reduceMotion);
  document.body.classList.toggle('high-contrast', !!view.highContrast);
  // Taille de l'interface : celle choisie (Accessibilité), réduite sur un écran plus petit que
  // 1280 × 720 points (résolution abaissée, forte mise à l'échelle de Windows) pour garder la même
  // mise en page ; le widget Game Bar a sa propre taille
  const fit = /\/(widget|monitor)\.html$/.test(location.pathname) ? 1 : Math.min(1, window.innerWidth / 1280, window.innerHeight / 720);
  const zoom = Math.round(((view.uiScale || 100) / 100) * (fit > 0 ? fit : 1) * 1000) / 1000;
  document.body.style.zoom = zoom !== 1 ? zoom : '';
  // Les hauteurs en vh ne doivent pas grandir avec le zoom de l'interface (voir --vh dans app.css)
  document.documentElement.style.setProperty('--zoom', String(zoom));
  document.body.classList.toggle('hints-compact', view.hintsBar === 'compact');
  document.body.classList.toggle('lowfx', !!view.lowFx);
  document.body.dataset.homeDensity = view.homeDensity;
  document.body.dataset.motionStyle = view.motionStyle;
  // Personnalisation : taille des jaquettes, arrondis, transparence, police
  const cap = { s: 'clamp(180px, calc(30 * var(--vh)), 340px)', m: '', l: 'clamp(250px, calc(44 * var(--vh)), 520px)' }[view.cardSize] || '';
  document.documentElement.style.setProperty('--capsule-h', cap || 'clamp(210px, calc(36 * var(--vh)), 420px)');
  document.documentElement.style.setProperty('--radius', { square: '2px', soft: '6px', round: '14px' }[view.corners] || '6px');
  document.body.classList.toggle('solid', !!view.solidPanels);
  document.body.classList.toggle('font-system', view.font === 'system');
}

// ---------- Sons d'interface ----------
// Sons graves et feutrés : attaque progressive de 10 ms, fondamentale ronde,
// aigus fortement filtrés, sans clic bruité ni glissé. Le démarrage est indépendant.
// Les sons sont calculés une fois (OfflineAudioContext) puis rejoués : bien plus léger que
// de créer des oscillateurs à chaque déplacement.
const SR = 44100;
let ac, lastMoveSound = 0;
const soundBanks = new Map(), rendering = new Map();

function renderSounds(profile) {
  const { SOUNDS, SOFT } = getSoundPalette(profile);
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return Promise.resolve({});
  return Promise.all(Object.entries(SOUNDS).map(async ([name, s]) => {
    const end = Math.max(...s.notes.map(([, t0, , dec]) => t0 + dec)) + 0.12;
    const o = new OAC(1, Math.ceil(end * SR), SR);
    const out = o.createGain();
    out.gain.value = s.vol;
    // Aigus adoucis : plus rond, moins « clic »
    const soft = o.createBiquadFilter();
    soft.type = 'lowpass'; soft.frequency.value = SOFT.lowpass; soft.Q.value = 0.5;
    out.connect(soft).connect(o.destination);
    // Écho court, étouffé, qui s'éteint vite
    const delay = o.createDelay(0.1), fb = o.createGain(), lp = o.createBiquadFilter(), wet = o.createGain();
    delay.delayTime.value = SOFT.echoDelay; fb.gain.value = SOFT.echoFeedback; lp.type = 'lowpass'; lp.frequency.value = SOFT.echoLowpass; wet.gain.value = SOFT.echoWet;
    out.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet); wet.connect(o.destination);
    for (const [f, t0, amp, dec] of s.notes) {
      // Fondamentale dominante ; erreur sans harmonique supplémentaire
      for (const [mult, pa, pd] of s.dull ? [[1, 1, 1]] : SOFT.partials) {
        const osc = o.createOscillator(), g = o.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f * mult * (1 + SOFT.glide), t0);
        osc.frequency.exponentialRampToValueAtTime(f * mult, t0 + 0.015);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(amp * pa, t0 + SOFT.attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec * pd);
        osc.connect(g).connect(out);
        osc.start(t0); osc.stop(t0 + dec * pd + 0.01);
      }
    }
    return [name, await o.startRendering()];
  })).then(Object.fromEntries);
}
function prepareSounds(profile = settings.soundTheme) {
  profile = ['round', 'retro', 'soft'].includes(profile) ? profile : 'round';
  if (!rendering.has(profile)) rendering.set(profile, renderSounds(profile).then(bank => { soundBanks.set(profile, bank); return bank; }).catch(() => ({})));
  return rendering.get(profile);
}
setTimeout(prepareSounds, 0);
export function sfx(type, { preview = false, profile = settings.soundTheme, volume = settings.soundVolume } = {}) {
  if (!preview && (!settings.sounds || (type === 'move' && !settings.soundMoves))) return;
  if (!['round', 'retro', 'soft'].includes(profile)) profile = 'round';
  volume = Math.max(0, Math.min(100, Number(volume) || 0));
  if (!volume) return;
  if (type === 'move' && !preview) {
    const now = performance.now(); if (now - lastMoveSound < 45) return; lastMoveSound = now;
  }
  try { ac = ac || new AudioContext({ latencyHint: 'interactive' }); if (ac.state === 'suspended') ac.resume(); } catch { return; }
  const bank = soundBanks.get(profile);
  if (!bank) { prepareSounds(profile); return; }
  const buffer = bank[type]; if (!buffer) return;
  const source = ac.createBufferSource(), gain = ac.createGain();
  source.buffer = buffer; gain.gain.value = volume / 100;
  source.connect(gain).connect(ac.destination); source.start();
}
let previewSequence = 0;
export async function previewSounds(profile = settings.soundTheme) {
  const sequence = ++previewSequence, volume = settings.soundVolume;
  try { ac = ac || new AudioContext({ latencyHint: 'interactive' }); await ac.resume(); } catch { return; }
  await prepareSounds(profile);
  for (const type of ['move', 'select', 'back', 'notify']) {
    if (sequence !== previewSequence) return;
    if (type !== 'move' || settings.soundMoves) sfx(type, { preview: true, profile, volume });
    await new Promise(resolve => setTimeout(resolve, 420));
  }
}
export function stopSoundPreview() { previewSequence++; }

// ---------- Toasts & notifications ----------
let toastTimer;
const notifications = [];
export function toast(msg, { error = false, notify = false } = {}) {
  msg = tx(msg); // message de l'hôte (en français) : traduit s'il est connu
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), error ? 4000 : 2600);
  if (error) sfx('error');
  if (notify && settings.notifications) {
    sfx('notify');
    notifications.unshift({ msg, at: new Date() });
    notifications.length = Math.min(notifications.length, 8);
    emit('notifications', notifications);
  }
}
export const getNotifications = () => notifications;

export function busy(label) {
  const b = $('#busy');
  if (label) { $('span', b).textContent = label; b.hidden = false; } else b.hidden = true;
}

// ---------- App native (WebView2) ----------
// Présent quand l'interface tourne dans l'app KaneMode : actions réelles (bureau, veille, arrêt…).
const webview = window.chrome && window.chrome.webview;
// Widgets Game Bar (widget.html, monitor.html) : la page tourne dans le widget, isolé du réseau local. Il relaie
// ses requêtes à l'hôte et ses messages à l'app KaneMode (voir native\KaneMode.Widget).
export const WIDGET = !!webview && /\/(widget|monitor)\.html$/.test(location.pathname);
export const native = {
  available: !!webview && !WIDGET,
  send(type, data = {}) { if (webview && !WIDGET) webview.postMessage({ type, ...data }); },
  on(fn) { if (webview && !WIDGET) webview.addEventListener('message', e => fn(e.data || {})); },
};

/** Widget : message à l'app KaneMode (veille, ouvrir KaneMode, état du jeu…), avec sa réponse. */
export const toApp = (type, data = {}) => (WIDGET
  ? relay({ type: 'native', message: { type, ...data } }).then(r => r.body || {})
  : Promise.reject(new Error(t('Hors de la Game Bar'))));

let relayId = 0;
const waiting = new Map();
if (WIDGET) webview.addEventListener('message', e => {
  const m = e.data || {};
  if (m.type !== 'api-result') return;
  const done = waiting.get(m.id);
  if (done) { waiting.delete(m.id); done(m); }
});
function relay(message) {
  return new Promise(resolve => {
    const id = ++relayId;
    waiting.set(id, resolve);
    webview.postMessage({ ...message, id });
    setTimeout(() => { if (waiting.delete(id)) resolve({ status: 504, body: { error: t('KaneMode ne répond pas') } }); }, 20000);
  });
}

// ---------- API de l'hôte ----------
async function request(method, url, body) {
  if (WIDGET) {
    const r = await relay({ type: 'api', method, path: url, body: body || null });
    const j = r.body || {};
    if (!r.status || r.status >= 400) throw Object.assign(new Error(j.error || t('Erreur {status}', { status: r.status })), { data: j });
    return j;
  }
  const r = await fetch(url, {
    method,
    headers: { 'X-KaneMode': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || t('Erreur {status}', { status: r.status })), { data: j });
  return j;
}
export const api = {
  get: url => request('GET', url),
  post: (url, body) => request('POST', url, body || {}),
  del: url => request('DELETE', url),
};

// ---------- Boutiques ----------
export const SOURCES = {
  steam: { label: t('Steam'), color: '#1a9fff' },
  epic: { label: t('Epic Games'), color: '#b8bec6' },
  gog: { label: 'GOG', color: '#a55cf2' },
  ubisoft: { label: t('Ubisoft'), color: '#2b7de8' },
  ea: { label: 'EA', color: '#ff4d4d' },
  battlenet: { label: t('Battle.net'), color: '#00aeff' },
  xbox: { label: t('Xbox'), color: '#22b422' },
  amazon: { label: t('Amazon'), color: '#ff9900' },
  rockstar: { label: t('Rockstar'), color: '#fcaf17' },
  riot: { label: t('Riot'), color: '#eb0029' },
  roblox: { label: 'Roblox', color: '#00a2ff' },
  minecraft: { label: 'Minecraft', color: '#6bb043' },
  custom: { label: t('Ajouts perso'), short: t('Perso'), color: '#f0a030' },
  rom: { label: t('Émulation'), short: t('Émulation'), color: '#e05a2b' },
  kaneplay: { label: t('Streaming local'), short: t('Streaming'), color: 'var(--accent)' },
};
export const sourceOf = id => SOURCES[id] || { label: id, color: '#888' };

// ---------- Formats ----------
export const fmt = {
  played(ts) {
    if (!ts) return t('Jamais joué');
    const d = new Date(ts * 1000), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff <= 0) return t('Aujourd\'hui');
    if (diff === 1) return t('Hier');
    if (diff < 7) return t('Il y a {diff} jours', { diff });
    const opts = { day: 'numeric', month: 'long' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return t('Le {date}', { date: d.toLocaleDateString(locale, opts) });
  },
  size(b) {
    if (!Number.isFinite(b) || b < 0) return '—';
    const [unit, divisor] = b >= 1e9 ? [t(' Go'), 1e9] : b >= 1e6 ? [t(' Mo'), 1e6] : b >= 1e3 ? [t(' Ko'), 1e3] : [t(' octets'), 1];
    return (b / divisor).toLocaleString(locale, { maximumFractionDigits: divisor === 1 ? 0 : 2 }) + unit;
  },
  playtime: m => !m ? null : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`,
  gb: b => (b / 1073741824).toLocaleString(locale, { maximumFractionDigits: 1 }) + t(' Go'),
  duration(s) { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h ${m} min` : `${m} min`; },
};

// ---------- Bibliothèque ----------
// Ce qui change la mise en page (jeux ajoutés ou retirés, noms, rangées, onglets…) : le reste
// (descriptions, temps de jeu, visuels) se met à jour sur place, sans redessiner la page.
const layoutSig = d => JSON.stringify([
  d.games.map(g => [g.id, g.name, g.type, g.hidden, g.removed, g.installed, g.installing, g.canInstall, g.source, g.lastPlayed, g.system]),
  d.launchers.map(l => [l.id, l.installed]), d.collections, d.stream,
]);

export const lib = {
  games: [], index: new Map(), launchers: [], collections: [], version: 0, generated: null, layout: '',
  /**
   * Recharge la bibliothèque. background : rechargement de fond (métadonnées, retour d'un jeu),
   * appliqué sans gêner la navigation.
   */
  async load({ background = false } = {}) {
    const d = await api.get('/api/library' + (settings.demo ? '?demo=1' : ''));
    for (const [id, src] of Object.entries(d.sources || {})) if (!SOURCES[id]) SOURCES[id] = { label: src.label, color: '#7c9eff' };
    const old = new Map(this.games.map(g => [g.id, g]));
    const layout = layoutSig(d);
    const first = !this.games.length;
    // Streaming local : nom donné par l'hôte en français, traduit ici, et jaquette aux couleurs de
    // KaneMode dans la langue de l'interface (sauf visuel choisi par l'utilisateur, « ?v= »)
    for (const g of d.games) {
      if (g.id !== 'kaneplay') continue;
      g.name = t('Streaming local');
      if (!/\?v=/.test((g.art && g.art.portrait) || '')) g.art = { ...g.art, ...streamingArt(settings.accent) };
    }
    Object.assign(this, { games: d.games, index: new Map(d.games.map(g => [g.id, g])), launchers: d.launchers, stream: d.stream || { engine: false, hosts: [] }, collections: d.collections || [], version: d.version, generated: d.generated });
    if (first || layout !== this.layout) {
      this.layout = layout;
      emit('library', { background });
    } else {
      const art = d.games.filter(g => old.has(g.id) && JSON.stringify(old.get(g.id).art) !== JSON.stringify(g.art));
      emit('library-soft', { art });
    }
    return this;
  },
  byId(id) { return this.index.get(id); },
  visible() { return this.games.filter(g => !g.hidden && !g.removed && !settings.hiddenSources.includes(g.source)); },
  launcher(id) { return this.launchers.find(l => l.id === id); },
};

// Windows fournit l'identifiant du moniteur ; aucune supposition fondée sur la résolution.
native.on(message => {
  if (message.type !== 'display' || !message.id) return;
  const changed = displayState.id !== message.id;
  Object.assign(displayState, { id: message.id, name: message.name || message.id });
  if (changed) { applyTheme(); emit('display'); }
});
