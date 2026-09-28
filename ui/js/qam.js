// Accès rapide façon SteamOS : de vrais réglages du système (volume, luminosité, Wi-Fi, Bluetooth,
// mode d'alimentation, profil de la console, puissance, fréquence de l'écran, limite de charge),
// en sections que l'utilisateur choisit et ordonne (Paramètres → Accès rapide).
import { $, el, esc, icon, api, settings, saveSettings, toast, sfx, getNotifications } from './core.js';
import { nav, focusIn } from './nav.js';
import { sleepNow } from './power.js';
import { openStreaming, exitToDesktop } from './pages/game.js';

export const QAM_SECTIONS = [
  { id: 'quick', label: 'Réglages rapides', desc: 'Volume, luminosité, Wi-Fi, Bluetooth, mode nuit' },
  { id: 'perf', label: 'Performance', desc: 'Mode d’alimentation, profil de la console, puissance, fréquence de l’écran' },
  { id: 'battery', label: 'Batterie', desc: 'Niveau, source, limite de charge' },
  { id: 'shortcuts', label: 'Raccourcis', desc: 'Veille, KanePlay, bureau Windows' },
  { id: 'monitor', label: 'Moniteur', desc: 'Processeur et mémoire en direct' },
  { id: 'notifs', label: 'Notifications', desc: 'Dernières notifications de KaneMode' },
];
export const QAM_DEFAULT = ['quick', 'perf', 'battery', 'shortcuts', 'monitor', 'notifs'];

/** Sections affichées, dans l'ordre choisi. */
export function qamOrder() {
  const order = Array.isArray(settings.qamOrder) ? settings.qamOrder.filter(id => QAM_SECTIONS.some(s => s.id === id)) : [];
  for (const s of QAM_SECTIONS) if (!order.includes(s.id)) order.push(s.id);
  return order.filter(id => !(settings.qamHidden || []).includes(id));
}

const POWER = [['efficiency', 'Économie'], ['balanced', 'Équilibré'], ['performance', 'Performance']];
const VENDOR_LABELS = { silent: 'Silencieux', quiet: 'Silencieux', balanced: 'Équilibré', performance: 'Performance', turbo: 'Turbo' };

let sys = null;
async function send(cmd, value, extra = {}) {
  try { return await api.post('/api/sys', { cmd, value, ...extra }); }
  catch (e) { toast(e.message, { error: true }); throw e; }
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
  let v = value, timer = 0, sent = value;
  const paint = () => {
    const pct = (100 * (v - min)) / (max - min);
    $('.fill', s).style.width = pct + '%';
    $('.knob', s).style.left = pct + '%';
    $('output', s).textContent = v + unit;
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
  const t = el('div', 'toggle' + (on ? ' on' : ''), `${icon(iconId)}<span>${esc(label)}</span>`);
  return nav(t, async () => {
    const next = !t.classList.contains('on');
    t.classList.toggle('on', next);
    try { await onToggle(next); } catch { t.classList.toggle('on', !next); }
  }, key);
}

const section = (title, ...children) => {
  const s = el('div', 'qam-section');
  s.append(el('h3', '', esc(title)), ...children.filter(Boolean));
  return s;
};
const label = t => el('div', 'seg-label', esc(t));

// ---------------------------------------------------------------- sections
const BUILD = {
  quick() {
    const kids = [];
    const toggles = el('div', 'toggles');
    for (const r of (sys && sys.radios) || []) {
      const name = r.kind === 'WiFi' ? 'Wi-Fi' : 'Bluetooth';
      toggles.append(toggle(r.kind === 'WiFi' ? 'i-wifi' : 'i-bluetooth', name, r.on, on => send('radio', on, { kind: r.kind }), 'radio:' + r.kind));
    }
    if (sys && sys.volume != null) toggles.append(toggle('i-volume', 'Sourdine', sys.muted, on => send('mute', on), 'mute'));
    toggles.append(toggle('i-moon', 'Mode nuit', settings.night, on => { settings.night = on; saveSettings(); }, 'night'));
    toggles.append(toggle('i-music', 'Sons de l’interface', settings.sounds, on => { settings.sounds = on; saveSettings(); }, 'sounds'));
    kids.push(toggles);
    if (sys && sys.volume != null) kids.push(slider('i-volume', sys.volume, { unit: ' %', onChange: v => send('volume', v).catch(() => {}), key: 'volume' }));
    if (sys && sys.brightness != null) kids.push(slider('i-sun', sys.brightness, { unit: ' %', onChange: v => send('brightness', v).catch(() => {}), key: 'brightness' }));
    return section('Réglages rapides', ...kids);
  },

  perf() {
    const kids = [];
    if (!sys) return section('Performance', el('div', 'qam-note', 'Lecture des réglages du système…'));
    if (sys.powerMode) {
      kids.push(label('Mode d’alimentation de Windows'), segment(POWER, sys.powerMode, v => send('powermode', v), 'powermode'));
    }
    const vendor = sys.vendor;
    if (vendor && vendor.modes) {
      kids.push(label('Profil de la console'), segment(vendor.modes.map(m => [m, VENDOR_LABELS[m] || m]), vendor.mode, v => send('vendor', v), 'vendor'));
    } else if (vendor && vendor.error) {
      kids.push(el('div', 'qam-note', `Profil de la console indisponible : ${esc(vendor.error)}`));
    }
    if (vendor && vendor.tdp) {
      const w = settings.tdp || Math.round((vendor.tdp.min + vendor.tdp.max) / 2);
      kids.push(label(`Puissance (${vendor.tdp.min} à ${vendor.tdp.max} W, expérimental)`),
        slider('i-cpu', w, { min: vendor.tdp.min, max: vendor.tdp.max, step: 1, unit: ' W', key: 'tdp', onChange: v => { settings.tdp = v; saveSettings(); send('tdp', v).catch(() => {}); } }));
    }
    if (sys.refresh && sys.refresh.available.length > 1) {
      const rates = sys.refresh.available.filter(hz => hz >= 30).slice(-5);
      kids.push(label('Fréquence de l’écran'), segment(rates.map(hz => [hz, hz + ' Hz']), sys.refresh.current, v => send('refresh', +v), 'refresh'));
    }
    if (!kids.length) kids.push(el('div', 'qam-note', 'Aucun réglage de performance disponible sur ce PC.'));
    return section('Performance', ...kids);
  },

  battery() {
    const box = el('div', 'qam-battery', '<span class="qam-note">Pas de batterie</span>');
    if (navigator.getBattery) {
      navigator.getBattery().then(b => {
        if (b.charging && b.level === 1) return; // PC fixe (ou batterie pleine sur secteur)
        const pct = Math.round(b.level * 100);
        box.innerHTML = `<div class="meter"><span>${b.charging ? 'En charge' : 'Sur batterie'}</span><div class="bar"><i style="width:${pct}%"></i></div><output>${pct} %</output></div>`;
      }).catch(() => {});
    }
    const kids = [box];
    const v = sys && sys.vendor;
    if (v && v.chargeLimit != null) {
      kids.push(label('Limite de charge (préserve la batterie)'),
        segment([[60, '60 %'], [80, '80 %'], [100, '100 %']], v.chargeLimit, p => send('chargelimit', +p), 'charge'));
    }
    return section('Batterie', ...kids);
  },

  shortcuts() {
    const row = el('div', 'qam-shortcuts');
    const btn = (iconId, text, act, key) => row.append(nav(el('div', 'chip-btn', `${icon(iconId)}${esc(text)}`), act, key));
    btn('i-moon', 'Veille', () => sleepNow(), 'sc-sleep');
    btn('i-wifi', 'KanePlay', () => openStreaming(), 'sc-kaneplay');
    btn('i-desktop', 'Bureau Windows', () => exitToDesktop(), 'sc-desktop');
    return section('Raccourcis', row);
  },

  monitor() {
    return section('Moniteur',
      el('div', 'meter', '<span>Processeur</span><div class="bar"><i id="cpu-bar"></i></div><output id="cpu-val">—</output>'),
      el('div', 'meter', '<span>Mémoire</span><div class="bar"><i id="mem-bar"></i></div><output id="mem-val">—</output>'));
  },

  notifs() {
    const list = getNotifications();
    const box = el('div', list.length ? '' : 'notif-empty');
    box.id = 'notifs';
    box.innerHTML = list.length
      ? list.map(n => `<div class="notif">${esc(n.msg)}<small>${n.at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('')
      : 'Aucune nouvelle notification';
    return section('Notifications', box);
  },
};

/** Dessine l'accès rapide ; les réglages du système arrivent juste après (sans bloquer l'ouverture). */
export async function renderQam(focusKey) {
  const body = $('#qam-body');
  const draw = key => {
    body.replaceChildren(...qamOrder().map(id => BUILD[id]()));
    if (key) focusIn($('#qam'), key, { scroll: false });
  };
  draw(focusKey);
  try {
    sys = await api.get('/api/sys');
    const f = $('#qam .focused');
    const keep = f ? f.dataset.key : focusKey;
    draw(keep);
  } catch { /* hôte injoignable : réglages de l'interface seulement */ }
}

