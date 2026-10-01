// Accès rapide façon SteamOS : de vrais réglages du système (volume, luminosité, Wi-Fi, Bluetooth,
// mode d'alimentation, profil de la console, puissance, fréquence de l'écran, limite de charge),
// en sections que l'utilisateur choisit et ordonne (Paramètres → Accès rapide).
import { t, locale } from './i18n.js';
import { $, el, esc, icon, api, settings, saveSettings, toast, sfx, getNotifications } from './core.js';
import { nav, focusIn } from './nav.js';

/**
 * Raccourcis de l'accès rapide, fournis par la page qui l'affiche : l'interface de KaneMode
 * (main.js) ou le widget Game Bar (widget.js), qui n'agissent pas de la même façon.
 * Chaque entrée : [icône, libellé, action] ; `leave` est appelé avant (quitter le mode par-dessus).
 */
export const qamShortcuts = { list: [], leave: () => {} };

export const QAM_SECTIONS = [
  { id: 'quick', label: t('Réglages rapides'), desc: t('Volume, luminosité, Wi-Fi, Bluetooth, mode nuit') },
  { id: 'perf', label: t('Performance'), desc: t('Mode d’alimentation, profil de la console, puissance, fréquence de l’écran') },
  { id: 'battery', label: t('Batterie'), desc: t('Niveau, source, limite de charge') },
  { id: 'shortcuts', label: t('Raccourcis'), desc: t('Veille, alimentation, streaming local') },
  { id: 'monitor', label: t('Moniteur'), desc: t('Processeur et mémoire en direct') },
  { id: 'notifs', label: t('Notifications'), desc: t('Dernières notifications de KaneMode') },
];
export const QAM_DEFAULT = ['quick', 'perf', 'battery', 'shortcuts', 'monitor', 'notifs'];

/** Sections affichées, dans l'ordre choisi. */
export function qamOrder() {
  const order = Array.isArray(settings.qamOrder) ? settings.qamOrder.filter(id => QAM_SECTIONS.some(s => s.id === id)) : [];
  for (const s of QAM_SECTIONS) if (!order.includes(s.id)) order.push(s.id);
  return order.filter(id => !(settings.qamHidden || []).includes(id));
}

export const VENDOR_LABELS = { silent: t('Silencieux'), quiet: t('Silencieux'), balanced: t('Équilibré'), performance: t('Performance'), turbo: t('Turbo') };

let sys = null;
async function send(cmd, value, extra = {}) {
  try { return await api.post('/api/sys', { cmd, value, ...extra }); }
  catch (e) { toast(e.message, { error: true }); throw e; }
}

// ---------------------------------------------------------------- modes de performance
export const PERF_MODES = [['eco', t('Économie')], ['balanced', t('Équilibré')], ['performance', t('Performance')]];
/** Ce que règle chaque mode (même définition que perfPreset côté hôte). */
export function modeSummary(mode, st = sys) {
  const v = st && st.vendor && st.vendor.modes ? st.vendor.modes : null;
  const pick = (...n) => (v ? n.find(x => v.includes(x)) : null);
  const parts = {
    eco: [t('Windows en économie d’énergie'), t('processeur limité à 70 %'), t('turbo coupé'), pick('silent', 'quiet') && 'profil Silencieux'],
    balanced: [t('Windows équilibré'), t('processeur à 100 %'), t('turbo activé'), pick('performance', 'balanced') && `profil ${VENDOR_LABELS[pick('performance', 'balanced')]}`],
    performance: [t('Windows en performances maximales'), t('processeur à 100 %'), t('turbo activé'), pick('turbo', 'performance') && `profil ${VENDOR_LABELS[pick('turbo', 'performance')]}`],
  }[mode];
  return parts ? parts.filter(Boolean).join(' · ') : '';
}
// Puissance des profils du constructeur, en watts [sur batterie, sur secteur] (valeurs du fabricant)
export const PROFILE_WATTS = {
  'rog-ally': { silent: [10, 10], performance: [15, 15], turbo: [25, 30] },
  'rog-ally-x': { silent: [13, 13], performance: [17, 17], turbo: [25, 30] },
  'legion-go': { quiet: [8, 8], balanced: [15, 15], performance: [20, 20] },
};
let live = null;      // dernières mesures (fréquence, charge, watts)
let applied = null;   // détail du dernier mode appliqué, affiché sous les boutons
export const vendorFor = (mode, st = sys) => {
  const v = st && st.vendor && st.vendor.modes;
  if (!v) return null;
  const want = { eco: ['silent', 'quiet'], balanced: ['performance', 'balanced'], performance: ['turbo', 'performance'] }[mode] || [];
  return want.find(n => v.includes(n)) || null;
};
function profileWatts(vmode, st = sys) {
  const watts = st && PROFILE_WATTS[st.handheld];
  const w = watts && vmode && watts[vmode];
  return w ? w[live && live.discharging === false ? 1 : 0] : null;
}
const fmtW = w => (w == null ? '—' : (Math.round(w * 10) / 10).toLocaleString(locale) + ' W');
const fmtGhz = mhz => (mhz ? (mhz / 1000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' GHz' : '—');

/** Bandeau en direct : consommation (sur batterie), fréquence réelle, limite de puissance. */
function paintLive(flash = false) {
  const strip = $('#qam .live-strip');
  if (!strip || !sys) return;
  const cells = [];
  if (live && live.watts != null && live.discharging) cells.push([fmtW(live.watts), t('Consommation')]);
  else if (live && live.discharging === false) cells.push([t('Secteur'), t('Alimentation')]);
  else cells.push([live && live.load != null ? live.load + ' %' : '—', t('Charge du processeur')]);
  cells.push([fmtGhz(live && live.mhz), t('Fréquence réelle')]);
  const vm = sys.vendor && sys.vendor.mode;
  const tdp = settings.tdpActive && sys.mode === 'custom' ? settings.tdpActive : profileWatts(vm);
  if (tdp) cells.push([fmtW(tdp), settings.tdpActive && sys.mode === 'custom' ? t('Limite réglée') : t('Profil {a}', { a: VENDOR_LABELS[vm] || vm })]);
  else if (sys.cpu) cells.push([sys.cpu.maxAc + ' %' + (sys.cpu.boostAc ? ' · turbo' : ''), t('Limite du processeur')]);
  strip.innerHTML = cells.map(([v, l]) => `<div><b>${esc(v)}</b><small>${esc(l)}</small></div>`).join('');
  if (flash) { strip.classList.remove('flash'); void strip.offsetWidth; strip.classList.add('flash'); }
}
let liveTimer = 0;
/** Mesures en direct tant que l'accès rapide est ouvert (une par seconde). */
export function startLive() {
  stopLive();
  const tick = async () => { try { live = await api.get('/api/sys/live'); paintLive(); } catch { /* hôte occupé */ } };
  tick();
  liveTimer = setInterval(tick, 1000);
}
export function stopLive() { clearInterval(liveTimer); applied = null; }

/** Un réglage de performance changé à la main : le mode passe à « Personnalisé ». */
function markCustom() {
  if (!sys) return;
  sys.mode = 'custom';
  const seg = $('#qam .perf-mode');
  if (seg) seg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  const note = $('#qam .perf-note');
  if (note) note.textContent = t('Personnalisé : réglages ajustés à la main ci-dessous');
  const list = $('#qam .applied');
  if (list) list.remove();
  paintLive(true);
}
const sendPerf = (cmd, value, extra) => send(cmd, value, extra).then(r => { markCustom(); return r; });
const WIN_LABELS = { efficiency: t('Windows : économie d’énergie'), balanced: t('Windows : équilibré'), performance: t('Windows : performances maximales') };
async function applyMode(mode) {
  const name = PERF_MODES.find(m => m[0] === mode)[1];
  try {
    const r = await api.post('/api/power/mode', { mode });
    if (r.state) sys = r.state;
    settings.tdpActive = 0; // le profil du constructeur remplace une puissance réglée à la main
    saveSettings();
    // Ce qui a vraiment été fait, réglage par réglage
    const a = r.applied || {}, done = new Set(r.done || []);
    const items = [];
    if (a.powerMode) items.push([done.has('powermode'), WIN_LABELS[a.powerMode]]);
    if (a.cpuMax != null) items.push([done.has('cpumax'), a.cpuMax < 100 ? t('Processeur limité à {cpuMax} %', { cpuMax: a.cpuMax }) : t('Processeur sans limite')]);
    if (a.boost != null) items.push([done.has('boost'), a.boost ? t('Turbo activé') : t('Turbo coupé')]);
    if (a.vendor) { const w = a.tdp == null && profileWatts(a.vendor); items.push([done.has('vendor'), t('Profil {a}{b}', { a: VENDOR_LABELS[a.vendor] || a.vendor, b: w ? ` · ${w} W` : '' })]); }
    if (a.tdp != null) items.push([done.has('tdp'), t('Puissance fixée à {a} W', { a: typeof a.tdp === 'object' ? a.tdp.spl : a.tdp })]);
    applied = { mode, items };
    if (r.errors && r.errors.length) toast(t('Mode {name} : {a}', { name, a: r.errors[0] }), { error: true });
    else toast(t('Mode {name} appliqué', { name }));
  } catch (e) { toast(e.message, { error: true }); }
  renderQam('mode:' + mode, false);
  paintLive(true);
  // La fréquence met un instant à suivre : nouvelle mesure tout de suite
  setTimeout(async () => { try { live = await api.get('/api/sys/live'); paintLive(); } catch { /* hôte occupé */ } }, 700);
}

// ---------------------------------------------------------------- petits contrôles
function segment(options, current, onPick, key) {
  const s = el('div', 'segmented');
  for (const [value, label] of options) {
    const b = el('button', String(value) === String(current) ? 'active' : '', esc(label));
    nav(b, async () => {
      s.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      sfx('select');
      try { await onPick(value); } catch { /* message déjà affiché */ }
    }, `${key}:${value}`);
    s.append(b);
  }
  return s;
}

/** Curseur : flèches gauche/droite (manette) ou clic. onChange est appelé au plus toutes les 120 ms. */
function slider(iconId, value, { min = 0, max = 100, step = 5, unit = '', onChange, key }) {
  const s = el('div', 'slider', `${icon(iconId)}<div class="track"><div class="fill"></div><div class="knob"></div></div><output></output>`);
  const names = { volume: t('Volume'), brightness: t('Luminosité'), tdp: t('Puissance (TDP)'), 'tdp-spl': t('Soutenue'), 'tdp-sppt': t('Boost court (quelques secondes)'), 'tdp-fppt': t('Boost bref (pics)'), cpumax: t('Limite du processeur') };
  s.setAttribute('role', 'slider');
  s.setAttribute('aria-label', names[key] || key);
  s.setAttribute('aria-valuemin', String(min));
  s.setAttribute('aria-valuemax', String(max));
  let v = value, timer = 0, sent = value;
  const paint = () => {
    const pct = (100 * (v - min)) / (max - min);
    $('.fill', s).style.width = pct + '%';
    $('.knob', s).style.left = pct + '%';
    $('output', s).textContent = v + unit;
    s.setAttribute('aria-valuenow', String(v));
    s.setAttribute('aria-valuetext', v + unit);
  };
  const set = nv => {
    nv = Math.max(min, Math.min(max, Math.round(nv / step) * step));
    if (nv === v) return;
    v = nv;
    paint();
    sfx('move');
    clearTimeout(timer);
    timer = setTimeout(() => { if (v !== sent) { sent = v; onChange(v); } }, 120);
  };
  s._dir = dir => {
    if (dir !== 'left' && dir !== 'right') return false;
    set(v + (dir === 'right' ? step : -step));
    return true;
  };
  s._click = e => {
    const r = $('.track', s).getBoundingClientRect();
    set(min + ((e.clientX - r.left) / r.width) * (max - min));
  };
  paint();
  return nav(s, () => {}, key);
}

function toggle(iconId, label, on, onToggle, key) {
  const tile = el('div', 'toggle' + (on ? ' on' : ''), `${icon(iconId)}<span>${esc(label)}</span>`);
  tile.setAttribute('role', 'switch');
  tile.setAttribute('aria-label', label);
  tile.setAttribute('aria-checked', String(!!on));
  return nav(tile, async () => {
    const next = !tile.classList.contains('on');
    tile.classList.toggle('on', next);
    tile.setAttribute('aria-checked', String(next));
    try { await onToggle(next); } catch { tile.classList.toggle('on', !next); }
    tile.setAttribute('aria-checked', String(tile.classList.contains('on')));
  }, key);
}

const section = (title, ...children) => {
  const s = el('div', 'qam-section');
  s.append(el('h3', '', esc(title)), ...children.filter(Boolean));
  return s;
};
const label = text => el('div', 'seg-label', esc(text));

// ---------------------------------------------------------------- sections
const BUILD = {
  quick() {
    const kids = [];
    const toggles = el('div', 'toggles');
    for (const r of (sys && sys.radios) || []) {
      const name = r.kind === 'WiFi' ? t('Wi-Fi') : t('Bluetooth');
      toggles.append(toggle(r.kind === 'WiFi' ? 'i-wifi' : 'i-bluetooth', name, r.on, on => send('radio', on, { kind: r.kind }), 'radio:' + r.kind));
    }
    if (sys && sys.volume != null) toggles.append(toggle('i-volume', t('Sourdine'), sys.muted, on => send('mute', on), 'mute'));
    toggles.append(toggle('i-moon', t('Mode nuit'), settings.night, on => { settings.night = on; saveSettings(); }, 'night'));
    toggles.append(toggle('i-music', t('Sons de l’interface'), settings.sounds, on => { settings.sounds = on; saveSettings(); }, 'sounds'));
    kids.push(toggles);
    if (sys && sys.volume != null) kids.push(slider('i-volume', sys.volume, { unit: ' %', onChange: v => send('volume', v).catch(() => {}), key: 'volume' }));
    if (sys && sys.brightness != null) kids.push(slider('i-sun', sys.brightness, { unit: ' %', onChange: v => send('brightness', v).catch(() => {}), key: 'brightness' }));
    return section(t('Réglages rapides'), ...kids);
  },

  perf() {
    const kids = [];
    if (!sys) return section(t('Performance'), el('div', 'qam-note', t('Lecture des réglages du système…')));
    // Mode de performance : règle tout d'un coup (Windows, processeur, profil de la console)
    const modeSeg = segment(PERF_MODES, sys.mode, applyMode, 'mode');
    modeSeg.classList.add('perf-mode', 'big');
    // Puissance de chaque mode sur cette console (profil du constructeur)
    [...modeSeg.children].forEach((b, i) => {
      const w = profileWatts(vendorFor(PERF_MODES[i][0]));
      if (w) b.insertAdjacentHTML('beforeend', `<small>${w} W</small>`);
    });
    kids.push(el('div', 'live-strip'), label(t('Mode de performance')), modeSeg,
      el('div', 'qam-note perf-note', sys.mode === 'custom' ? t('Personnalisé : réglages ajustés à la main ci-dessous')
        : sys.mode ? esc(modeSummary(sys.mode)) : t('Choisissez un mode : il règle Windows, le processeur et le profil de la console')));
    // Le mode est tenu par l'hôte ; un autre programme qui impose le sien est signalé
    if (sys.modeConflict) kids.push(el('div', 'qam-note', t('Un autre programme (Armoury Crate SE ?) remet sans cesse son propre profil : désactivez ses profils par jeu. KaneMode reprend la main dès que vous choisissez un mode.')));
    if (applied && applied.mode === sys.mode) {
      kids.push(el('ul', 'applied', applied.items.map(([ok, text]) => `<li class="${ok ? 'ok' : 'ko'}">${ok ? '✓' : '✕'} ${esc(text)}</li>`).join('')));
    }
    const details = el('div', 'toggles');
    details.append(toggle('i-gear', t('Réglages détaillés'), settings.qamPerfDetails !== false, on => { settings.qamPerfDetails = on; saveSettings(); renderQam('perf-details', false); }, 'perf-details'));
    kids.push(details);
    if (settings.qamPerfDetails === false) return section(t('Performance'), ...kids);
    const vendor = sys.vendor;
    if (vendor && vendor.modes) {
      kids.push(label(t('Profil de la console')), segment(vendor.modes.map(m => [m, VENDOR_LABELS[m] || m]), vendor.mode, v => sendPerf('vendor', v).then(st => { if (st && st.modes) sys.vendor = st; settings.tdpActive = 0; saveSettings(); paintLive(true); }), 'vendor'));
    } else if (vendor && vendor.error) {
      kids.push(el('div', 'qam-note', t('Profil de la console indisponible : {a}', { a: esc(vendor.error) })));
    }
    if (vendor && vendor.tdp) {
      // Puissance (TDP) : un curseur, ou les trois limites en mode avancé
      const lim = vendor.tdp;
      const cur = Object.assign({ spl: Math.round((lim.min + lim.max) / 2) }, settings.tdpLimits || {});
      cur.sppt = cur.sppt || cur.spl;
      cur.fppt = cur.fppt || cur.sppt;
      const sendTdp = () => { settings.tdpLimits = { ...cur }; saveSettings(); sendPerf('tdp', settings.tdpAdvanced ? { ...cur } : cur.spl).then(() => { settings.tdpActive = cur.spl; saveSettings(); paintLive(true); }).catch(() => {}); };
      kids.push(label(t('Puissance (TDP, expérimental)')));
      if (!settings.tdpAdvanced) {
        kids.push(slider('i-cpu', cur.spl, { min: lim.min, max: lim.max, step: 1, unit: ' W', key: 'tdp', onChange: v => { cur.spl = cur.sppt = cur.fppt = v; sendTdp(); } }));
      } else {
        kids.push(el('div', 'qam-note', t('Soutenue')), slider('i-cpu', cur.spl, { min: lim.min, max: lim.max, step: 1, unit: ' W', key: 'tdp-spl', onChange: v => { cur.spl = v; cur.sppt = Math.max(cur.sppt, v); cur.fppt = Math.max(cur.fppt, cur.sppt); sendTdp(); } }));
        kids.push(el('div', 'qam-note', t('Boost court (quelques secondes)')), slider('i-cpu', cur.sppt, { min: lim.min, max: lim.boostMax, step: 1, unit: ' W', key: 'tdp-sppt', onChange: v => { cur.sppt = Math.max(v, cur.spl); cur.fppt = Math.max(cur.fppt, cur.sppt); sendTdp(); } }));
        kids.push(el('div', 'qam-note', 'Boost bref (pics)'), slider('i-cpu', cur.fppt, { min: lim.min, max: lim.boostMax, step: 1, unit: ' W', key: 'tdp-fppt', onChange: v => { cur.fppt = Math.max(v, cur.sppt); sendTdp(); } }));
      }
      kids.push(el('div', 'toggles'));
      kids[kids.length - 1].append(toggle('i-gear', t('Réglage avancé'), !!settings.tdpAdvanced, on => { settings.tdpAdvanced = on; saveSettings(); renderQam('tdp-adv'); }, 'tdp-adv'));
    }
    // Processeur : pour tous les PC, par Windows (sans pilote ni droits administrateur)
    if (sys.cpu) {
      kids.push(label(t('Limite du processeur')),
        slider('i-cpu', sys.cpu.maxAc, { min: 30, max: 100, step: 5, unit: ' %', key: 'cpumax', onChange: v => sendPerf('cpumax', v).catch(() => {}) }));
      const tg = el('div', 'toggles');
      tg.append(toggle('i-cpu', t('Turbo du processeur'), sys.cpu.boostAc !== 0, on => sendPerf('boost', on), 'boost'));
      kids.push(tg);
    }
    if (sys.refresh && sys.refresh.available.length > 1) {
      const rates = sys.refresh.available.filter(hz => hz >= 30).slice(-5);
      kids.push(label(t('Fréquence de l’écran')), segment(rates.map(hz => [hz, hz + t(' Hz')]), sys.refresh.current, v => send('refresh', +v), 'refresh'));
    }
    if (!kids.length) kids.push(el('div', 'qam-note', t('Aucun réglage de performance disponible sur ce PC.')));
    return section(t('Performance'), ...kids);
  },

  battery() {
    const box = el('div', 'qam-battery', t('<span class="qam-note">Pas de batterie</span>'));
    if (navigator.getBattery) {
      navigator.getBattery().then(b => {
        if (b.charging && b.level === 1) return; // PC fixe (ou batterie pleine sur secteur)
        const pct = Math.round(b.level * 100);
        box.innerHTML = `<div class="meter"><span>${b.charging ? t('En charge') : t('Sur batterie')}</span><div class="bar"><i style="width:${pct}%"></i></div><output>${pct} %</output></div>`;
      }).catch(() => {});
    }
    const kids = [box];
    const v = sys && sys.vendor;
    if (v && v.chargeLimit != null) {
      kids.push(label(t('Limite de charge (préserve la batterie)')),
        segment([[60, '60 %'], [80, '80 %'], [100, '100 %']], v.chargeLimit, p => send('chargelimit', +p), 'charge'));
    }
    return section(t('Batterie'), ...kids);
  },

  shortcuts() {
    const row = el('div', 'qam-shortcuts');
    // Un raccourci emmène ailleurs : fermer ensuite ne ramène pas à KanePlay
    for (const [iconId, text, act, key] of qamShortcuts.list) {
      row.append(nav(el('div', 'chip-btn', `${icon(iconId)}${esc(text)}`), () => { qamShortcuts.leave(); act(); }, key));
    }
    return section(t('Raccourcis'), row);
  },

  monitor() {
    return section(t('Moniteur'),
      el('div', 'meter', t('<span>Processeur</span><div class="bar"><i id="cpu-bar"></i></div><output id="cpu-val">—</output>')),
      el('div', 'meter', t('<span>Mémoire</span><div class="bar"><i id="mem-bar"></i></div><output id="mem-val">—</output>')));
  },

  notifs() {
    const list = getNotifications();
    const box = el('div', list.length ? '' : 'notif-empty');
    box.id = 'notifs';
    box.innerHTML = list.length
      ? list.map(n => `<div class="notif">${esc(n.msg)}<small>${n.at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('')
      : t('Aucune nouvelle notification');
    return section(t('Notifications'), box);
  },
};

/** Lecture de l'état du système en avance : l'accès rapide s'ouvre directement complet, sans saut. */
export const prefetchQam = () => api.get('/api/sys').then(v => { sys = v; }).catch(() => {});

/** Dessine l'accès rapide ; les réglages du système arrivent juste après (sans bloquer l'ouverture). */
export async function renderQam(focusKey, reload = true) {
  const body = $('#qam-body');
  const draw = key => {
    const top = $('#qam').scrollTop;
    body.replaceChildren(...qamOrder().map(id => BUILD[id]()));
    $('#qam').scrollTop = top;
    if (key) focusIn($('#qam'), key, { scroll: false });
    paintLive();
  };
  draw(focusKey);
  if (!reload) return;
  try {
    sys = await api.get('/api/sys');
    const f = $('#qam .focused');
    const keep = f ? f.dataset.key : focusKey;
    draw(keep);
  } catch { /* hôte injoignable : réglages de l'interface seulement */ }
}
