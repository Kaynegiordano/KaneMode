// Widget Game Bar de KaneMode (widget.html) : un HUD par-dessus les jeux, façon Winhanced. Mesures en
// direct (images par seconde, GPU, processeur, puissance), profils d'énergie, tuiles de réglages par
// catégorie (écran, graphismes AMD, performance, son, réseau, moniteur), jeu en cours et raccourcis
// vers KaneMode. Toucher une tuile l'inverse (interrupteur) ou ouvre un panneau avec un curseur ou une
// liste de choix. Chaque réglage est relu après écriture et la tuile dit s'il est vérifié ; un
// graphique des 60 dernières secondes marque chaque réglage, pour en voir l'effet. La page tourne
// dans le widget UWP, qui relaie ses requêtes à l'hôte et ses messages à l'app KaneMode (core.js :
// WIDGET, toApp).
import { $, el, esc, api, toast, settings, saveSettings, applyTheme, WIDGET, toApp, sfx } from './core.js';
import { nav, focusIn, focused, openLayer, closeLayer, topLayer, hooks } from './nav.js';
import { PERF_MODES, PROFILE_WATTS, VENDOR_LABELS, vendorFor } from './qam.js';
import { MONITOR_ITEMS, monitorPrefs, setMonitorPref, noteChange } from './hud.js';

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
  fps: 'M3 12h4l3-8 4 16 3-8h4',
  rsr: 'M4 4h7v7H4zM13 13h7v7h-7zM14 4h6v6M4 14v6h6',
  afmf: 'M4 7h9M4 12h13M4 17h9M16 5l4 2-4 2M18 15l3 2-3 2',
  antilag: 'M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  ris: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  game: 'M6 9h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5 2l-2-2H9l-2 2a3 3 0 0 1-5-2v-1a4 4 0 0 1 4-4zM8 11v4M6 13h4M16 12h.01M18 14h.01',
  power: 'M12 2v10M5.6 6.6a8 8 0 1 0 12.8 0',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l4 1-3 14-4-1z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
  sleep: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  check: 'M5 12l5 5 9-10',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4M6 12l3-3 3 2 5-5',
  mouse: 'M12 3a6 6 0 0 0-6 6v6a6 6 0 0 0 12 0V9a6 6 0 0 0-6-6zM12 3v7M6 10h12',
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
let sys = null, live = null, info = null, game = null, amd = null, gpu = null, mouse = null;
const CATS = [['all', 'Tout'], ['display', 'Écran'], ['graphics', 'Graphismes'], ['perf', 'Performance'], ['sound', 'Son'], ['network', 'Réseau'], ['pad', 'Manette'], ['monitor', 'Moniteur']];
const filter = () => (CATS.some(c => c[0] === settings.hudFilter) ? settings.hudFilter : 'all');
const onBattery = () => live && live.discharging === true;
const fmtW = w => String(Math.round(w * 10) / 10).replace('.', ',') + ' W';
const watts = vmode => { const t = sys && PROFILE_WATTS[sys.handheld]; const w = t && vmode && t[vmode]; return w ? w[onBattery() ? 0 : 1] : null; };
const tdpLimits = () => sys && sys.vendor && sys.vendor.tdp;
/** Puissance du curseur : celle réglée à la main, sinon celle du profil en cours. */
const tdpValue = () => {
  const t = tdpLimits();
  if (!t) return null;
  const w = sys.customTdp || (sys.vendor && watts(sys.vendor.mode)) || Math.round((t.min + t.max) / 2);
  return Math.max(t.min, Math.min(t.max, w));
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- vérification des réglages
// Après chaque réglage, la valeur relue sur le système ou le pilote est comparée à celle demandée ;
// la tuile l'indique 8 s (✓ vérifié, ✕ différent, ↗ envoyé quand la console ne permet pas de la
// relire), le moniteur en direct aussi, et le graphique des mesures marque l'instant.
const proofs = {};
const marks = [];
function prove(key, ok, text) {
  const title = (tiles().find(o => o.key === key) || {}).title || '';
  proofs[key] = { ok, text, t: Date.now() };
  marks.push({ t: Date.now(), label: title || text });
  noteChange(`${title ? title + ' : ' : ''}${text}${ok === null ? ' (envoyé)' : ''}`, ok !== false);
  setTimeout(render, 8100);
}
const pct1 = v => `${v} %`;
// Relecture de chaque commande : [conforme (null : impossible à relire), valeur relue]
const CHECK = {
  refresh: (r, v) => [r.refresh === v, `${r.refresh} Hz`],
  resolution: (r, v) => [r.resolution === v, String(r.resolution).replace('x', ' × ')],
  boost: (r, v) => [r.boost === !!v, r.boost ? 'activé' : 'coupé'],
  cpumax: (r, v) => [r.cpuMax === v, pct1(r.cpuMax)],
  vendor: (r, v) => [r.readable === false ? null : r.mode === v, VENDOR_LABELS[r.mode] || r.mode || '?'], // Ally X : profil non relisible
  tdp: (r, v) => [null, `${r.tdp ? r.tdp.spl : v} W`], // limites ASUS : écriture seule
  chargelimit: (r, v) => [r.verified ? r.chargeLimit === v : null, pct1(r.chargeLimit)],
  hdr: (r, v) => [(r.hdr === 1) === !!v, r.hdr === 1 ? 'activé' : 'coupé'],
  mute: (r, v) => [r.muted === !!v, r.muted ? 'son coupé' : 'son rétabli'],
  volume: (r, v) => [Math.abs(r.volume - v) <= 1, pct1(r.volume)],
  brightness: (r, v) => [r.verified === false ? null : Math.abs(r.brightness - v) <= 1, pct1(r.brightness)],
  radio: (r, v) => [r.on === !!v, r.on ? 'activé' : 'désactivé'],
};
const tileKey = (cmd, extra) => (cmd === 'radio' ? 'radio:' + extra.kind : cmd === 'chargelimit' ? 'charge' : cmd);

/** Un réglage du système ; l'état revient de l'hôte et la page se redessine. */
async function send(cmd, value, extra = {}) {
  try {
    const r = await api.post('/api/sys', { cmd, value, ...extra });
    if (CHECK[cmd]) { const [ok, read] = CHECK[cmd](r, value); prove(tileKey(cmd, extra), ok, ok === false ? `relu ${read}` : read); }
    if (cmd === 'radio') { const x = sys.radios.find(o => o.kind === extra.kind); if (x) x.on = !!r.on; }
    else if (cmd === 'refresh') sys.refresh.current = r.refresh;
    else if (cmd === 'resolution') { sys.resolution.current = r.resolution; loadSys(); }
    else if (cmd === 'boost') sys.cpu.boostAc = r.boost ? 2 : 0;
    else if (cmd === 'cpumax') sys.cpu.maxAc = r.cpuMax;
    else if (cmd === 'vendor') { sys.vendor = r; sys.customTdp = null; }
    else if (cmd === 'tdp') sys.customTdp = r.tdp ? r.tdp.spl : value;
    else if (cmd === 'chargelimit') sys.vendor.chargeLimit = r.chargeLimit;
    else if (cmd === 'hdr') sys.hdr = r.hdr;
    else if (cmd === 'mute') sys.muted = r.muted;
    else if (cmd === 'volume') sys.volume = r.volume;
    else if (cmd === 'brightness') sys.brightness = r.brightness;
    if (['vendor', 'tdp', 'cpumax', 'boost'].includes(cmd)) sys.mode = 'custom';
  } catch (e) { toast(e.message, { error: true }); prove(tileKey(cmd, extra), false, e.message); loadSys(); }
  render();
}
/** Réglage AMD : l'hôte renvoie l'état complet relu dans le pilote (une fonction peut en couper une autre). */
async function sendAmd(feature, value) {
  const key = feature.replace(/sharp$/, '');
  try {
    amd = await api.post('/api/amd', { feature, value });
    const x = amd[key] || {};
    let ok, read;
    // Limite des jeux : gardée par KaneMode, appliquée au pilote hors de KaneMode seulement
    if (feature === 'fps') { ok = amd.fpsLimit === value && (amd.kanemodeFront || (value > 0 ? x.on && x.value === value : !x.on)); read = amd.fpsLimit ? `${amd.fpsLimit} i/s en jeu` : 'aucune limite'; }
    else if (feature.endsWith('sharp')) { ok = x.sharpness === value; read = `netteté ${x.sharpness} %`; }
    else { ok = !!x.on === !!value; read = x.on ? 'activé' : 'désactivé'; }
    prove(key, ok, (ok ? '' : 'relu ') + read + ' · pilote AMD');
  } catch (e) { toast(e.message, { error: true }); prove(key, false, e.message); loadAmd(true); }
  render();
}
/** Curseurs : la valeur part 150 ms après le dernier mouvement. */
const later = {};
function soon(key, fn) {
  clearTimeout(later[key]);
  later[key] = setTimeout(fn, 150);
}

// ---------------------------------------------------------------- tuiles
// Chaque tuile : { key, cat, icon, title, value, on (interrupteur), act (appui) }, ou un panneau :
// slider { min, max, step, pad, get, fmt, set, onOff? } ; choice { options: [[valeur, libellé, note]], get, set }.
function tiles() {
  const out = [];
  const t = o => out.push(o);
  if (!sys) return out;
  const pct = v => `${v} %`;

  // Écran
  if (sys.refresh && sys.refresh.available.length > 1) {
    const rates = [...new Set(sys.refresh.available.filter(hz => hz >= 30))].sort((a, b) => b - a);
    t({ key: 'refresh', cat: 'display', icon: 'refresh', title: 'Fréquence', value: `${sys.refresh.current} Hz`,
      choice: { options: rates.map(hz => [hz, `${hz} Hz`]), get: () => sys.refresh.current, set: hz => send('refresh', hz) } });
  }
  if (sys.resolution && sys.resolution.available.length > 1) {
    const area = s => s.split('x').reduce((a, b) => a * b, 1);
    const sizes = [...new Set(sys.resolution.available)].sort((a, b) => area(b) - area(a)).slice(0, 8);
    if (!sizes.includes(sys.resolution.current)) sizes.unshift(sys.resolution.current);
    t({ key: 'resolution', cat: 'display', icon: 'resolution', title: 'Résolution', value: sys.resolution.current.replace('x', ' × '),
      choice: { options: sizes.map(s => [s, s.replace('x', ' × ')]), get: () => sys.resolution.current, set: s => send('resolution', s) } });
  }
  if (sys.brightness != null) {
    t({ key: 'brightness', cat: 'display', icon: 'brightness', title: 'Luminosité', value: pct(sys.brightness), bar: sys.brightness,
      slider: { min: 0, max: 100, step: 1, pad: 5, fmt: pct, get: () => sys.brightness,
        set: v => { sys.brightness = v; soon('brightness', () => send('brightness', v)); } } });
  }
  if (sys.hdr >= 0) t({ key: 'hdr', cat: 'display', icon: 'hdr', title: 'HDR', on: sys.hdr === 1, act: () => send('hdr', sys.hdr !== 1) });

  // Graphismes : pilote AMD, puis Lossless Scaling
  if (amd && amd.available) {
    if (amd.fps) {
      const f = amd.fps;
      const top = Math.max(60, (sys.refresh && sys.refresh.current) || 60);
      const limit = amd.fpsLimit || 0;
      const presets = [30, 40, 45, 60, 72, 90, 120, 144, 165].filter(v => v <= top && v >= (f.min || 0) && (!f.max || v <= f.max));
      if (limit && !presets.includes(limit)) presets.push(limit);
      presets.sort((a, b) => a - b);
      // Pour les jeux seulement : KaneMode lui-même garde toute sa fluidité (120 Hz sur la ROG Ally)
      t({ key: 'fps', cat: 'graphics', icon: 'fps', title: 'Limite d’images', value: limit ? `${limit} i/s` : 'Aucune', lit: !!limit, sub: limit ? 'Jeux seulement' : '',
        choice: { options: [[0, 'Aucune'], ...presets.map(v => [v, `${v} i/s`, 'jeux seulement'])], get: () => amd.fpsLimit || 0, set: v => sendAmd('fps', v) } });
    }
    // Les images générées par AFMF ne passent pas par le jeu : le pilote ne les compte pas dans les
    // images par seconde qu'il donne (ADLX)
    if (amd.afmf) t({ key: 'afmf', cat: 'graphics', icon: 'afmf', title: 'AFMF', on: amd.afmf.on, sub: amd.afmf.on ? 'Images ajoutées non comptées' : '', act: () => sendAmd('afmf', !amd.afmf.on) });
    if (amd.antilag) t({ key: 'antilag', cat: 'graphics', icon: 'antilag', title: 'Anti-Lag', on: amd.antilag.on, act: () => sendAmd('antilag', !amd.antilag.on) });
    for (const [key, name, full] of [['rsr', 'Super Resolution', 'Radeon Super Resolution'], ['ris', 'Netteté (RIS)', 'Radeon Image Sharpening']]) {
      const x = amd[key];
      if (!x) continue;
      t({ key, cat: 'graphics', icon: key, title: name, value: x.on ? pct(x.sharpness) : 'Désactivé', lit: x.on,
        slider: { min: x.min || 0, max: x.max || 100, step: 1, pad: 5, fmt: pct, get: () => amd[key].sharpness,
          set: v => { amd[key].sharpness = v; soon(key, () => sendAmd(key + 'sharp', v)); },
          onOff: { label: full, get: () => amd[key].on, set: on => sendAmd(key, on) } } });
    }
  }
  if (info && info.lossless) {
    const ls = info.lossless;
    t({ key: 'lossless', cat: 'graphics', icon: 'lossless', title: 'Lossless Scaling', wide: true,
      value: ls.running ? 'Mettre à l’échelle' : 'Lancer', sub: ls.running ? 'Ctrl + Alt + S sur le jeu en cours' : 'Lossless Scaling n’est pas ouvert',
      act: async () => {
        if (ls.running) { await toApp('lossless').catch(() => {}); toast('Mise à l’échelle : Lossless Scaling'); }
        else if (ls.id) { try { await api.post('/api/launch', { id: ls.id }); toast('Ouverture de Lossless Scaling…'); } catch (e) { toast(e.message, { error: true }); } }
      } });
  }

  // Performance
  const v = sys.vendor;
  if (tdpLimits()) {
    const lim = tdpLimits();
    t({ key: 'tdp', cat: 'perf', icon: 'tdp', title: 'Puissance (TDP)', value: `${tdpValue()} W`, bar: (100 * (tdpValue() - lim.min)) / (lim.max - lim.min),
      slider: { min: lim.min, max: lim.max, step: 1, pad: 1, fmt: w => `${w} W`, get: tdpValue,
        set: w => { sys.customTdp = w; sys.mode = 'custom'; soon('tdp', () => send('tdp', w)); } } });
  }
  if (v && v.modes) {
    const modes = v.modes.filter(m => m !== 'custom');
    t({ key: 'vendor', cat: 'perf', icon: 'vendor', title: 'Profil console', value: VENDOR_LABELS[v.mode] || v.mode || 'Personnalisé',
      choice: { options: modes.map(m => { const w = watts(m); return [m, VENDOR_LABELS[m] || m, w ? `${w} W` : '']; }), get: () => sys.vendor.mode, set: m => send('vendor', m) } });
  }
  if (sys.cpu) {
    t({ key: 'boost', cat: 'perf', icon: 'boost', title: 'Turbo CPU', on: sys.cpu.boostAc !== 0, act: () => send('boost', sys.cpu.boostAc === 0) });
    t({ key: 'cpumax', cat: 'perf', icon: 'cpumax', title: 'Limite CPU', value: pct(sys.cpu.maxAc), bar: sys.cpu.maxAc,
      slider: { min: 30, max: 100, step: 5, pad: 5, fmt: pct, get: () => sys.cpu.maxAc,
        set: x => { sys.cpu.maxAc = x; sys.mode = 'custom'; soon('cpumax', () => send('cpumax', x)); } } });
  }
  if (v && v.chargeLimit != null) {
    t({ key: 'charge', cat: 'perf', icon: 'charge', title: 'Limite de charge', value: pct(v.chargeLimit),
      choice: { options: [60, 70, 80, 90, 100].map(p => [p, pct(p), p === 100 ? 'Pleine charge' : p === 80 ? 'Conseillé sur secteur' : '']), get: () => sys.vendor.chargeLimit, set: p => send('chargelimit', p) } });
  }

  // Son
  if (sys.volume != null) {
    t({ key: 'volume', cat: 'sound', icon: 'volume', title: 'Volume', value: pct(sys.volume), bar: sys.muted ? 0 : sys.volume,
      slider: { min: 0, max: 100, step: 1, pad: 5, fmt: pct, get: () => sys.volume,
        set: x => { sys.volume = x; soon('volume', () => send('volume', x)); } } });
    t({ key: 'mute', cat: 'sound', icon: 'mute', title: 'Sourdine', on: !!sys.muted, act: () => send('mute', !sys.muted) });
  }

  // Réseau
  for (const r of sys.radios || []) {
    const wifi = r.kind === 'WiFi';
    t({ key: 'radio:' + r.kind, cat: 'network', icon: wifi ? 'wifi' : 'bluetooth', title: wifi ? 'Wi-Fi' : 'Bluetooth', on: r.on, act: () => send('radio', !r.on, { kind: r.kind }) });
  }

  // Manette : mode souris (comme Start maintenu 1 s), pour cliquer dans un lanceur ou une fenêtre ;
  // le jeu au premier plan reçoit toujours la manette
  if (mouse !== null) {
    t({ key: 'mouse', cat: 'pad', icon: 'mouse', title: 'Mode souris', on: mouse, sub: mouse ? 'Stick : curseur · A : clic' : 'Ou Start maintenu 1 s',
      act: async () => {
        try {
          mouse = !!(await toApp('mouse-mode', { on: !mouse })).on;
          toast(mouse ? 'Mode souris : stick = curseur, A = clic, B = clic droit' : 'Mode souris désactivé');
        } catch (e) { toast(e.message, { error: true }); }
        render();
      } });
  }

  // Moniteur en direct : autre widget, à épingler sur le jeu ; ses mesures se choisissent ici
  t({ key: 'monitor-open', cat: 'monitor', icon: 'monitor', title: 'Moniteur en direct', wide: true, value: 'Ouvrir',
    sub: 'Puis épinglez-le (punaise) pour le garder sur le jeu', act: openMonitor });
  const prefs = monitorPrefs();
  // Graphique des 60 dernières secondes dans ce widget : léger, mais inutile de le dessiner en jeu
  // si on ne le regarde pas (désactivé par défaut)
  t({ key: 'mon:chart', cat: 'monitor', icon: 'fps', title: 'Graphique (60 s)', on: !!prefs.chart, act: () => { setMonitorPref('chart', !prefs.chart); render(); } });
  for (const [k, label] of MONITOR_ITEMS) {
    t({ key: 'mon:' + k, cat: 'monitor', icon: 'monitor', title: label, on: !!prefs[k], act: () => { setMonitorPref(k, !prefs[k]); render(); } });
  }
  return out;
}

function tileEl(o) {
  const toggle = o.on !== undefined;
  const lit = toggle ? o.on : !!o.lit;
  const d = el('div', `hud-tile${lit ? ' on' : ''}${o.wide ? ' wide' : ''}`,
    `<div class="hud-tile-top">${svg(o.icon)}<span>${esc(o.title)}</span>${toggle ? '<i class="hud-switch"></i>' : ''}</div>` +
    `<b class="hud-value">${esc(toggle ? (o.on ? 'Activé' : 'Désactivé') : o.value)}</b>` +
    proofLine(o) +
    (o.bar != null ? `<i class="hud-bar"><i style="width:${clamp(o.bar, 0, 100)}%"></i></i>` : ''));
  nav(d, () => (o.slider || o.choice ? openSheet(o) : o.act()), 'tile:' + o.key);
  return d;
}

/** Ligne sous la valeur : la vérification du dernier réglage (8 s), sinon le texte de la tuile. */
function proofLine(o) {
  const p = proofs[o.key];
  if (p && Date.now() - p.t < 8000) {
    const cls = p.ok === null ? 'sent' : p.ok ? 'ok' : 'ko';
    return `<small class="hud-proof ${cls}">${p.ok === null ? '↗ Envoyé' : p.ok ? '✓ Vérifié' : '✕'} · ${esc(p.text)}</small>`;
  }
  return o.sub ? `<small>${esc(o.sub)}</small>` : '';
}

function openMonitor() {
  if (!WIDGET) return toast('Dans la Game Bar seulement');
  window.chrome.webview.postMessage({ type: 'open-monitor' });
  toast('Moniteur ouvert : épinglez-le pour le garder sur le jeu');
}

// ---------------------------------------------------------------- panneau d'un réglage
// Un panneau en bas du widget : un curseur à faire glisser (ou gauche / droite à la manette), ou une
// liste de choix. B, un appui hors du panneau ou « Terminé » le ferment.
let sheet = null;
function openSheet(o) {
  if (sheet) closeLayer(sheet);
  const root = el('div', 'hud-sheet');
  const panel = el('div', 'hud-sheet-panel');
  root.append(panel);
  panel.append(el('div', 'hud-sheet-head', `${svg(o.icon)}<b>${esc(o.title)}</b>`));

  if (o.slider) {
    const s = o.slider;
    const big = el('div', 'hud-sheet-value');
    const paintBig = () => { big.textContent = s.fmt(s.get()); };
    if (s.onOff) {
      const sw = el('div', 'hud-sheet-switch');
      // Désactivé : le curseur reste réglable mais paraît en retrait
      const paintSw = () => { const on = !!s.onOff.get(); sw.classList.toggle('on', on); panel.classList.toggle('off', !on); sw.innerHTML = `<span>${esc(s.onOff.label)}</span><i class="hud-switch"></i>`; };
      paintSw();
      nav(sw, async () => { await s.onOff.set(!s.onOff.get()); paintSw(); }, 'sheet-switch');
      panel.append(sw);
    }
    panel.append(big, slider(s, paintBig), el('div', 'hud-sheet-scale', `<span>${esc(s.fmt(s.min))}</span><span>${esc(s.fmt(s.max))}</span>`));
    paintBig();
  } else {
    const c = o.choice;
    const list = el('div', 'hud-options');
    for (const [value, label, note] of c.options) {
      const cur = String(c.get()) === String(value);
      const b = el('div', 'hud-option' + (cur ? ' active' : ''), `<b>${esc(label)}</b>${note ? `<small>${esc(note)}</small>` : ''}${cur ? svg('check') : ''}`);
      nav(b, async () => {
        b.classList.add('pending');
        await c.set(value);
        if (sheet) closeLayer(sheet);
      }, 'opt:' + value);
      list.append(b);
    }
    panel.append(list);
  }
  panel.append(nav(el('div', 'hud-sheet-done', 'Terminé'), () => closeLayer(sheet), 'sheet-done'));
  // Appui hors du panneau : fermé
  root.addEventListener('click', e => { if (e.target === root && sheet) closeLayer(sheet); });
  document.body.append(root);

  const hud = $('#hud'), top = hud.scrollTop; // position gardée à la fermeture
  sheet = openLayer({
    el: root, name: 'sheet',
    focusKey: o.slider ? 'sheet-slider' : 'opt:' + o.choice.get(),
    onClose() {
      sheet = null;
      root.classList.add('closing');
      setTimeout(() => root.remove(), 200);
      render();
      hud.scrollTop = top;
      focusIn($('#hud-body'), 'tile:' + o.key, { scroll: false });
    },
  });
}

/** Curseur du panneau : glissé au doigt ou à la souris, gauche / droite à la manette. */
function slider(s, onPaint) {
  const d = el('div', 'hud-slider', '<div class="hs-track"><div class="hs-fill"></div><div class="hs-knob"></div></div>');
  const track = d.firstChild;
  let v = s.get();
  const paint = () => {
    const p = (100 * (v - s.min)) / (s.max - s.min || 1);
    d.querySelector('.hs-fill').style.width = p + '%';
    d.querySelector('.hs-knob').style.left = p + '%';
    onPaint();
  };
  const set = (nv, sound) => {
    nv = clamp(Math.round(nv / s.step) * s.step, s.min, s.max);
    if (nv === v) return;
    v = nv;
    s.set(v);
    paint();
    if (sound) sfx('move');
  };
  const fromX = e => { const r = track.getBoundingClientRect(); set(s.min + ((e.clientX - r.left) / r.width) * (s.max - s.min)); };
  d.addEventListener('pointerdown', e => { d.setPointerCapture(e.pointerId); d.classList.add('drag'); fromX(e); });
  d.addEventListener('pointermove', e => { if (d.hasPointerCapture(e.pointerId)) fromX(e); });
  const end = e => { if (d.hasPointerCapture(e.pointerId)) d.releasePointerCapture(e.pointerId); d.classList.remove('drag'); };
  d.addEventListener('pointerup', end);
  d.addEventListener('pointercancel', end);
  d._click = () => {}; // la valeur est déjà prise au toucher
  d._dir = dir => {
    if (dir !== 'left' && dir !== 'right') return false;
    set(v + (dir === 'right' ? s.pad : -s.pad), true);
    return true;
  };
  paint();
  return nav(d, () => closeLayer(sheet), 'sheet-slider');
}

// ---------------------------------------------------------------- page
function render() {
  const body = $('#hud-body');
  const keep = focused && body.contains(focused) ? focused.dataset.key : null;
  const oldChips = body.querySelector('.hud-chips');
  const chipScroll = oldChips ? oldChips.scrollLeft : 0;
  const parts = [];

  // Mesures en direct et leur historique
  parts.push(liveStrip(), historyBox());

  // Jeu en cours
  const card = el('div', 'hud-card hud-game');
  card.innerHTML = `<div class="hud-game-icon">${svg('game')}</div>` + (game
    ? `<div class="hud-game-text"><small class="now-playing">En cours</small><b>${esc(game.name || 'Jeu')}</b></div>`
    : '<div class="hud-game-text"><span>Aucun jeu lancé depuis KaneMode</span></div>');
  if (game) card.append(stopButton());
  parts.push(card);

  // Profils d'énergie
  if (sys) {
    parts.push(el('h3', 'hud-h', 'Profil d’énergie'));
    if (sys.modeConflict) parts.push(el('div', 'hud-note', 'Un autre programme (Armoury Crate SE ?) remet sans cesse son propre profil : désactivez ses profils par jeu. KaneMode reprend la main dès que vous choisissez un mode.'));
    const row = el('div', 'hud-profiles');
    for (const [mode, label] of [...PERF_MODES, ['custom', 'Personnalisé']]) {
      const w = mode === 'custom' ? (tdpLimits() && sys.mode === 'custom' ? tdpValue() : null) : watts(vendorFor(mode, sys));
      const p = el('div', 'hud-profile' + (sys.mode === mode ? ' active' : ''), `${svg(mode)}<b>${esc(label)}</b><small>${w ? w + ' W' : '&nbsp;'}</small>`);
      nav(p, () => pickMode(mode), 'mode:' + mode);
      row.append(p);
    }
    parts.push(row);
  }

  // Catégories (une seule ligne, défilante) et tuiles
  const all = tiles();
  const chips = el('div', 'hud-chips');
  for (const [id, label] of CATS) {
    if (id !== 'all' && sys && !all.some(o => o.cat === id)) continue;
    const c = el('div', 'hud-chip' + (filter() === id ? ' active' : ''), esc(label));
    nav(c, () => { settings.hudFilter = id; saveSettings(); render(); focusIn($('#hud-body'), 'cat:' + id, { scroll: false }); }, 'cat:' + id);
    chips.append(c);
  }
  parts.push(chips);
  const list = all.filter(o => (filter() === 'all' ? o.cat !== 'monitor' : o.cat === filter()));
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
  chips.scrollLeft = chipScroll;
  paintHead();
  if (keep && !topLayer()) focusIn(body, keep, { scroll: false });
  // Catégorie choisie à la manette : la pastille reste visible dans sa ligne
  const chip = focused && chips.contains(focused) ? focused : null;
  if (chip) chips.scrollLeft = Math.max(0, Math.min(chips.scrollLeft, chip.offsetLeft - 8), chip.offsetLeft + chip.offsetWidth - chips.clientWidth + 8);
}

// Bandeau des mesures : images par seconde et GPU (pilote AMD), processeur, batterie. Le bandeau et
// le graphique sont créés une fois et mis à jour sur place (par-dessus un jeu, reconstruire la page
// chaque seconde coûtait cher sur la ROG Ally).
let liveEl = null;
function liveStrip() {
  const cells = [];
  if (gpu && gpu.fps != null) cells.push([String(gpu.fps), 'images/s']);
  if (gpu && gpu.gpuUsage != null) cells.push([`${gpu.gpuUsage} %`, gpu.gpuTemp != null ? `GPU · ${gpu.gpuTemp} °C` : 'GPU']);
  if (live && live.mhz) cells.push([(live.mhz / 1000).toFixed(1).replace('.', ',') + ' GHz', live.load != null ? `CPU · ${live.load} %` : 'CPU']);
  if (live && onBattery() && live.watts != null) cells.push([fmtW(live.watts), 'Batterie']);
  else if (gpu && gpu.gpuPower != null) cells.push([fmtW(gpu.gpuPower), 'Puissance GPU']);
  if (!liveEl) { liveEl = el('div', 'hud-live'); liveEl.id = 'hud-live'; }
  const html = cells.map(([v, l]) => `<div><b>${esc(v)}</b><small>${esc(l)}</small></div>`).join('');
  if (liveEl._html !== html) { liveEl._html = html; liveEl.innerHTML = html; }
  liveEl.hidden = !cells.length;
  return liveEl;
}
function paintLive() {
  liveStrip();
  historyBox();
  paintHead();
}

// Historique des 60 dernières secondes : images par seconde et consommation, avec un trait à chaque
// réglage. Un changement de puissance ou de limite d'images se voit tout de suite sur les courbes.
const hist = [];
const HISTORY_MS = 60000;
function record() {
  const w = live && onBattery() && live.watts != null ? live.watts : gpu && gpu.gpuPower != null ? gpu.gpuPower : null;
  hist.push({ t: Date.now(), fps: gpu ? gpu.fps : null, w });
  while (hist.length && Date.now() - hist[0].t > HISTORY_MS) hist.shift();
  while (marks.length && Date.now() - marks[0].t > HISTORY_MS) marks.shift();
}
let histEl = null, histCanvas = null, histLegend = null;
function historyBox() {
  if (!histEl) {
    histEl = el('div', 'hud-history');
    histEl.id = 'hud-history';
    histCanvas = document.createElement('canvas');
    histLegend = el('div', 'hud-history-legend');
    histEl.append(histCanvas, histLegend);
  }
  const hasFps = hist.some(x => x.fps != null), hasW = hist.some(x => x.w != null);
  histEl.hidden = !monitorPrefs().chart || hist.length < 2 || (!hasFps && !hasW);
  if (histEl.hidden) return histEl;
  const wLabel = live && onBattery() ? 'Batterie (W)' : 'GPU (W)';
  const legend = (hasFps ? '<span><i style="background:#7cf29a"></i>Images/s</span>' : '') +
    (hasW ? `<span><i style="background:#ffb35c"></i>${wLabel}</span>` : '') + '<span>60 s</span>';
  if (histLegend.innerHTML !== legend) histLegend.innerHTML = legend;
  requestAnimationFrame(() => drawHistory(histCanvas));
  return histEl;
}
function drawHistory(c) {
  const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (!W) return;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const now = Date.now(), x = t => W - ((now - t) / HISTORY_MS) * W;
  const line = (key, color) => {
    const pts = hist.filter(p => p[key] != null);
    if (pts.length < 2) return;
    const max = Math.max(...pts.map(p => p[key])) * 1.15 || 1;
    g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round';
    g.beginPath();
    pts.forEach((p, i) => { const y = H - 4 - (p[key] / max) * (H - 16); i ? g.lineTo(x(p.t), y) : g.moveTo(x(p.t), y); });
    g.stroke();
  };
  line('w', '#ffb35c');
  line('fps', '#7cf29a');
  // Réglages : trait vertical et nom (les trois derniers)
  g.font = '600 10px system-ui, sans-serif';
  marks.slice(-3).forEach(m => {
    const mx = Math.max(1, x(m.t));
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(mx, 0); g.lineTo(mx, H); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#fff';
    const label = m.label.length > 18 ? m.label.slice(0, 17) + '…' : m.label;
    const tw = g.measureText(label).width;
    g.fillText(label, Math.min(mx + 3, W - tw - 2), 10);
  });
}

async function pickMode(mode) {
  if (mode === 'custom') {
    // Personnalisé : la puissance se règle directement
    const tdp = tiles().find(o => o.key === 'tdp');
    if (tdp) return openSheet(tdp);
    settings.hudFilter = 'perf'; saveSettings();
    return render();
  }
  try {
    const r = await api.post('/api/power/mode', { mode });
    if (r.state) sys = r.state;
    const name = PERF_MODES.find(m => m[0] === mode)[1];
    const a = r.applied || {};
    const w = typeof a.tdp === 'object' && a.tdp ? a.tdp.spl : a.tdp;
    // Le profil de la console est relu après écriture (syscontrol) : il est vérifié s'il a été pris.
    // La ROG Ally X ne permet pas de le relire (readable = false) : « envoyé », pas une erreur.
    const v = (r.state && r.state.vendor) || {};
    const unread = v.readable === false;
    const read = unread ? a.vendor : v.mode;
    const ok = !(r.errors && r.errors.length) && (!a.vendor || read === a.vendor);
    const text = `Mode ${name}${a.vendor ? ` · profil ${VENDOR_LABELS[read] || read || '?'}${unread ? ' (envoyé)' : ''}` : ''}${w ? ` · ${w} W` : ''}`;
    marks.push({ t: Date.now(), label: name });
    noteChange(text, ok);
    if (!ok) toast(`${text} : ${(r.errors && r.errors[0]) || 'profil relu différent'}`, { error: true });
    else toast(`✓ ${text}`);
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
  const w = sys && sys.mode === 'custom' && tdpLimits() ? tdpValue()
    : sys && sys.vendor ? watts(sys.vendor.mode) : null;
  pill.hidden = w == null;
  if (w != null) { pill.textContent = fmtW(w); pill.title = 'Puissance du profil'; }
}
function status(text) {
  const s = $('#hud-status');
  s.hidden = !text;
  s.textContent = text || '';
}

// ---------------------------------------------------------------- données
// Relectures régulières : la page n'est redessinée que si les données ont changé
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function loadSys() {
  let next = sys;
  try { next = await api.get('/api/sys'); status(''); }
  catch (e) { status(WIDGET ? 'KaneMode n’est pas ouvert : ouvrez-le pour régler le système.' : e.message); }
  if (!same(next, sys)) { sys = next; render(); }
}
async function loadAmd(force) {
  let next = null;
  try { next = await api.get('/api/amd' + (force ? '?refresh=1' : '')); } catch { next = null; }
  if (!same(next, amd)) { amd = next; render(); }
}
async function loadLive() {
  // Processeur, batterie et GPU en une requête (l'hôte la partage avec le moniteur)
  const r = await api.get('/api/hud/live').catch(() => null);
  const wasBattery = onBattery();
  live = r && r.live; gpu = r && r.gpu;
  record();
  // Chargeur branché ou débranché : les watts des profils changent (Turbo : 25 ou 30 W)
  if (onBattery() !== wasBattery) render(); else paintLive();
}
async function loadGame() {
  if (!WIDGET) return; // aperçu dans un navigateur : l'état du jeu vient de l'app KaneMode
  try {
    const st = await toApp('widget-state');
    const next = st.game || null;
    if ((next && next.id) !== (game && game.id)) stopArmed = stopAsked = 0;
    const m = typeof st.mouse === 'boolean' ? st.mouse : null;
    const changed = JSON.stringify(next) !== JSON.stringify(game) || m !== mouse;
    game = next;
    mouse = m;
    if (changed) render();
  } catch { /* KaneMode fermé : signalé par loadSys */ }
}
async function loadInfo() {
  let next = null;
  try { next = await api.get('/api/widget'); } catch { next = null; }
  // Même couleur d'accent que KaneMode (pour ce widget seulement, sans la renvoyer)
  if (next && next.accent && next.accent !== settings.accent) { settings.accent = next.accent; applyTheme(); }
  if (!same(next, info)) { info = next; render(); }
}

let timers = [];
function start() {
  stop();
  loadSys(); loadAmd().then(loadLive); loadGame(); loadInfo();
  // Réglages relus seulement quand aucun panneau n'est ouvert (l'utilisateur règle)
  const idle = fn => () => { if (!sheet) fn(); };
  timers = [setInterval(loadLive, 2000), setInterval(loadGame, 5000), setInterval(idle(loadSys), 15000),
    setInterval(idle(() => loadAmd()), 20000), setInterval(idle(loadInfo), 60000)];
}
function stop() { timers.forEach(clearInterval); timers = []; }
// Game Bar fermée : plus de mesures ni de requêtes
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

// B ou rond (Échap au clavier), sans panneau ouvert : la Game Bar se ferme et le jeu reprend
hooks.back = () => {
  if (!WIDGET) return toast('Ferme la Game Bar (dans la Game Bar seulement)');
  toApp('gamebar-close').catch(() => {});
};

(async () => {
  applyTheme();
  await loadSprite();
  render();
  focusIn($('#hud-body'));
  start();
})();
