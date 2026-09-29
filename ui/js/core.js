// Briques partagées : DOM, stockage, réglages, sons, toasts, API de l'hôte, bibliothèque.

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
export const store = {
  get(k, d) { try { const v = localStorage.getItem('km.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('km.' + k, JSON.stringify(v)); } catch { /* ignoré */ } },
};

export const settings = Object.assign({
  wifi: true, bluetooth: false, night: false, sounds: true, brightness: 70, volume: 45, fps: '0', overlay: 'off',
  accent: '#1a9fff', background: 'art', badges: false, splash: true, bootMode: 'logo', bootSound: 'chime', bootVolume: 70, dimAfter: 5, sleepAfterBattery: 15, sleepAfterAC: 0, wakeAnimation: true, cardSize: 'm', corners: 'soft', solidPanels: false, font: 'segoe', clock24: true, clockSeconds: false, batteryPct: true, homeRows: ['recent', 'emulation', 'apps', 'stores'], qamOrder: null, qamHidden: [], tdp: 0, simulateDevice: '', handheldSeen: '', demo: false, hiddenSources: [], sort: 'name',
  uiScale: 100, reduceMotion: false, highContrast: false, padGlyphs: 'auto', padSwap: false, hintsBar: 'full', lowFx: false, notifications: true, homeApps: true, homeStores: true,
  // Boutons de la ROG Ally (Command Center, Armoury Crate) : voir Paramètres → Console portable
  btnCC: 'taskview', btnAC: 'gamebar', btnACHold: 'home', blockAsusPrompt: true,
}, store.get('settings', {}));
// 1.3.1 : Command Center ouvre la vue des tâches, comme un appui long sur la touche Xbox (avant : l'accès rapide)
if (!settings.btnCCTaskView) {
  if (settings.btnCC === 'qam') settings.btnCC = 'taskview';
  settings.btnCCTaskView = true;
  store.set('settings', settings);
}
export const favs = new Set(store.get('favs', []));

export function saveSettings() { store.set('settings', settings); applyTheme(); syncAccent(); syncButtons(); }

// KanePlay reprend la couleur d'accent de KaneMode : l'hôte la lui transmet au lancement
let sentAccent = null;
function syncAccent() {
  if (WIDGET || settings.accent === sentAccent) return; // le widget reprend la couleur de KaneMode, il ne l'impose pas
  sentAccent = settings.accent;
  api.post('/api/config', { accent: settings.accent }).catch(() => { sentAccent = null; });
}
setTimeout(syncAccent, 0);
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
export function applyTheme() {
  document.documentElement.style.setProperty('--accent', settings.accent);
  document.body.classList.toggle('night', !!settings.night);
  document.body.classList.toggle('show-badges', !!settings.badges);
  document.body.classList.remove('bg-art', 'bg-gradient', 'bg-dark');
  document.body.classList.add('bg-' + settings.background);
  document.body.classList.toggle('reduce-motion', !!settings.reduceMotion);
  document.body.classList.toggle('high-contrast', !!settings.highContrast);
  // Taille de l'interface : celle choisie (Accessibilité), réduite sur un écran plus petit que
  // 1280 × 720 points (résolution abaissée, forte mise à l'échelle de Windows) pour garder la même
  // mise en page ; le widget Game Bar a sa propre taille
  const fit = /\/widget\.html$/.test(location.pathname) ? 1 : Math.min(1, window.innerWidth / 1280, window.innerHeight / 720);
  const zoom = Math.round(((settings.uiScale || 100) / 100) * (fit > 0 ? fit : 1) * 1000) / 1000;
  document.body.style.zoom = zoom !== 1 ? zoom : '';
  // Les hauteurs en vh ne doivent pas grandir avec le zoom de l'interface (voir --vh dans app.css)
  document.documentElement.style.setProperty('--zoom', String(zoom));
  document.body.classList.toggle('hints-compact', settings.hintsBar === 'compact');
  document.body.classList.toggle('lowfx', !!settings.lowFx);
  // Personnalisation : taille des jaquettes, arrondis, transparence, police
  const cap = { s: 'clamp(180px, calc(30 * var(--vh)), 340px)', m: '', l: 'clamp(250px, calc(44 * var(--vh)), 520px)' }[settings.cardSize] || '';
  document.documentElement.style.setProperty('--capsule-h', cap || 'clamp(210px, calc(36 * var(--vh)), 420px)');
  document.documentElement.style.setProperty('--radius', { square: '2px', soft: '6px', round: '14px' }[settings.corners] || '6px');
  document.body.classList.toggle('solid', !!settings.solidPanels);
  document.body.classList.toggle('font-system', settings.font === 'system');
}

// ---------- Sons d'interface ----------
// Façon Switch 2, en doux : petits « tocs » ronds et boisés. Chaque note a le timbre d'une lame de
// marimba (fondamentale + un soupçon de partiel à 4 fois la fréquence), une attaque de 5 ms avec un
// léger glissé vers le bas, un clic à peine audible, des aigus filtrés et un écho court et étouffé.
// Les sons sont calculés une fois (OfflineAudioContext) puis rejoués : bien plus léger que
// de créer des oscillateurs à chaque déplacement.
const SOUNDS = {
  //       notes : [fréquence, départ (s), volume, durée]          volume général
  move: { notes: [[1175, 0, 1, 0.055]], vol: 0.03 },
  key: { notes: [[1568, 0, 1, 0.035]], vol: 0.022 },
  select: { notes: [[988, 0, 0.85, 0.09], [1319, 0.045, 1, 0.15]], vol: 0.045 },
  back: { notes: [[988, 0, 0.85, 0.08], [740, 0.045, 1, 0.13]], vol: 0.042 },
  open: { notes: [[784, 0, 0.7, 0.1], [1175, 0.04, 0.8, 0.12], [1568, 0.08, 0.8, 0.18]], vol: 0.036 },
  error: { notes: [[392, 0, 1, 0.1], [330, 0.1, 1, 0.14]], vol: 0.055, dull: true },
};
const SR = 44100;
let ac, sounds = null, rendering = null;

function renderSounds() {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return Promise.resolve({});
  return Promise.all(Object.entries(SOUNDS).map(async ([name, s]) => {
    const end = Math.max(...s.notes.map(([, t0, , dec]) => t0 + dec)) + 0.12;
    const o = new OAC(1, Math.ceil(end * SR), SR);
    const out = o.createGain();
    out.gain.value = s.vol;
    // Aigus adoucis : plus rond, moins « clic »
    const soft = o.createBiquadFilter();
    soft.type = 'lowpass'; soft.frequency.value = 4200; soft.Q.value = 0.5;
    out.connect(soft).connect(o.destination);
    // Écho court, étouffé, qui s'éteint vite
    const delay = o.createDelay(0.1), fb = o.createGain(), lp = o.createBiquadFilter(), wet = o.createGain();
    delay.delayTime.value = 0.03; fb.gain.value = 0.25; lp.type = 'lowpass'; lp.frequency.value = 2400; wet.gain.value = 0.3;
    out.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet); wet.connect(o.destination);
    // Bruit pour le clic d'attaque
    const noise = o.createBuffer(1, Math.ceil(0.006 * SR), SR);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
    for (const [f, t0, amp, dec] of s.notes) {
      // Partiels : marimba (1 et 4) ; son d'erreur plus mat (1 et 3)
      for (const [mult, pa, pd] of s.dull ? [[1, 1, 1], [3, 0.2, 0.5]] : [[1, 1, 1], [4, 0.1, 0.25]]) {
        const osc = o.createOscillator(), g = o.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f * mult * 1.03, t0);
        osc.frequency.exponentialRampToValueAtTime(f * mult, t0 + 0.015);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(amp * pa, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec * pd);
        osc.connect(g).connect(out);
        osc.start(t0); osc.stop(t0 + dec * pd + 0.01);
      }
      const click = o.createBufferSource(), bp = o.createBiquadFilter(), cg = o.createGain();
      click.buffer = noise; bp.type = 'bandpass'; bp.frequency.value = s.dull ? 1000 : 2400; bp.Q.value = 1.2; cg.gain.value = amp * 0.12;
      click.connect(bp).connect(cg).connect(out);
      click.start(t0);
    }
    return [name, await o.startRendering()];
  })).then(Object.fromEntries);
}
function prepareSounds() {
  if (!rendering) rendering = renderSounds().then(b => { sounds = b; }).catch(() => { sounds = {}; });
  return rendering;
}
setTimeout(prepareSounds, 0);

export function sfx(type) {
  if (!settings.sounds) return;
  try { ac = ac || new AudioContext({ latencyHint: 'interactive' }); if (ac.state === 'suspended') ac.resume(); } catch { return; }
  if (!sounds) { prepareSounds(); return; }
  const buf = sounds[type];
  if (!buf) return;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.start();
}

// ---------- Toasts & notifications ----------
let toastTimer;
const notifications = [];
export function toast(msg, { error = false, notify = false } = {}) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), error ? 4000 : 2600);
  if (error) sfx('error');
  if (notify && settings.notifications) {
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
// Widget Game Bar (widget.html) : la page tourne dans le widget, isolé du réseau local. Il relaie
// ses requêtes à l'hôte et ses messages à l'app KaneMode (voir native\KaneMode.Widget).
export const WIDGET = !!webview && /\/widget\.html$/.test(location.pathname);
export const native = {
  available: !!webview && !WIDGET,
  send(type, data = {}) { if (webview && !WIDGET) webview.postMessage({ type, ...data }); },
  on(fn) { if (webview && !WIDGET) webview.addEventListener('message', e => fn(e.data || {})); },
};

/** Widget : message à l'app KaneMode (veille, ouvrir KaneMode, état du jeu…), avec sa réponse. */
export const toApp = (type, data = {}) => (WIDGET
  ? relay({ type: 'native', message: { type, ...data } }).then(r => r.body || {})
  : Promise.reject(new Error('Hors de la Game Bar')));

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
    setTimeout(() => { if (waiting.delete(id)) resolve({ status: 504, body: { error: 'KaneMode ne répond pas' } }); }, 20000);
  });
}

// ---------- API de l'hôte ----------
async function request(method, url, body) {
  if (WIDGET) {
    const r = await relay({ type: 'api', method, path: url, body: body || null });
    const j = r.body || {};
    if (!r.status || r.status >= 400) throw Object.assign(new Error(j.error || 'Erreur ' + r.status), { data: j });
    return j;
  }
  const r = await fetch(url, {
    method,
    headers: { 'X-KaneMode': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Erreur ' + r.status), { data: j });
  return j;
}
export const api = {
  get: url => request('GET', url),
  post: (url, body) => request('POST', url, body || {}),
  del: url => request('DELETE', url),
};

// ---------- Boutiques ----------
export const SOURCES = {
  steam: { label: 'Steam', color: '#1a9fff' },
  epic: { label: 'Epic Games', color: '#b8bec6' },
  gog: { label: 'GOG', color: '#a55cf2' },
  ubisoft: { label: 'Ubisoft', color: '#2b7de8' },
  ea: { label: 'EA', color: '#ff4d4d' },
  battlenet: { label: 'Battle.net', color: '#00aeff' },
  xbox: { label: 'Xbox', color: '#22b422' },
  amazon: { label: 'Amazon', color: '#ff9900' },
  rockstar: { label: 'Rockstar', color: '#fcaf17' },
  riot: { label: 'Riot', color: '#eb0029' },
  custom: { label: 'Ajouts perso', short: 'Perso', color: '#f0a030' },
  rom: { label: 'Émulation', short: 'Émulation', color: '#e05a2b' },
  kaneplay: { label: 'KanePlay', short: 'Streaming', color: '#8a5cff' },
};
export const sourceOf = id => SOURCES[id] || { label: id, color: '#888' };

// ---------- Formats ----------
export const fmt = {
  played(ts) {
    if (!ts) return 'Jamais joué';
    const d = new Date(ts * 1000), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff <= 0) return "Aujourd'hui";
    if (diff === 1) return 'Hier';
    if (diff < 7) return `Il y a ${diff} jours`;
    const opts = { day: 'numeric', month: 'long' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return 'Le ' + d.toLocaleDateString('fr-FR', opts);
  },
  size: b => b ? (b / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: b >= 1e10 ? 0 : 1 }) + ' Go' : '—',
  playtime: m => !m ? null : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`,
  gb: b => (b / 1073741824).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Go',
  duration(s) { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h ${m} min` : `${m} min`; },
};

// ---------- Bibliothèque ----------
// Ce qui change la mise en page (jeux ajoutés ou retirés, noms, rangées, onglets…) : le reste
// (descriptions, temps de jeu, visuels) se met à jour sur place, sans redessiner la page.
const layoutSig = d => JSON.stringify([
  d.games.map(g => [g.id, g.name, g.type, g.hidden, g.installed, g.source, g.lastPlayed, g.system]),
  d.launchers.map(l => [l.id, l.installed]), d.collections, d.stream,
]);

export const lib = {
  games: [], launchers: [], collections: [], version: 0, generated: null, layout: '',
  /**
   * Recharge la bibliothèque. background : rechargement de fond (métadonnées, retour d'un jeu),
   * appliqué sans gêner la navigation.
   */
  async load({ background = false } = {}) {
    const d = await api.get('/api/library' + (settings.demo ? '?demo=1' : ''));
    const old = new Map(this.games.map(g => [g.id, g]));
    const layout = layoutSig(d);
    const first = !this.games.length;
    Object.assign(this, { games: d.games, launchers: d.launchers, stream: d.stream || { engine: false, hosts: [] }, collections: d.collections || [], version: d.version, generated: d.generated });
    if (first || layout !== this.layout) {
      this.layout = layout;
      emit('library', { background });
    } else {
      const art = d.games.filter(g => old.has(g.id) && JSON.stringify(old.get(g.id).art) !== JSON.stringify(g.art));
      emit('library-soft', { art });
    }
    return this;
  },
  byId(id) { return this.games.find(g => g.id === id); },
  visible() { return this.games.filter(g => !g.hidden && !settings.hiddenSources.includes(g.source)); },
  launcher(id) { return this.launchers.find(l => l.id === id); },
};
