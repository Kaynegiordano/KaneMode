// Moniteur en direct de KaneMode (monitor.html), widget Game Bar à épingler sur le jeu : images par
// seconde et GPU (pilote AMD), processeur, consommation, puissance du mode, réglages actifs, et un
// rappel de chaque réglage fait dans le widget KaneMode avec sa vérification.
import { $, api, esc, applyTheme, WIDGET } from './core.js';
import { PERF_MODES, PROFILE_WATTS } from './qam.js';
import { monitorPrefs, lastChange } from './hud.js';

let live = null, gpu = null, sys = null, amd = null;
const fmtW = w => String(Math.round(w * 10) / 10).replace('.', ',') + ' W';
const onBattery = () => live && live.discharging === true;

/** Puissance du mode en cours : réglée à la main, sinon celle du profil de la console. */
function limitWatts() {
  if (!sys) return null;
  if (sys.mode === 'custom' && sys.customTdp) return sys.customTdp;
  const t = PROFILE_WATTS[sys.handheld], v = sys.vendor && sys.vendor.mode;
  return t && t[v] ? t[v][onBattery() ? 0 : 1] : null;
}
const modeName = () => (sys && sys.mode === 'custom' ? 'Personnalisé' : ((PERF_MODES.find(m => sys && m[0] === sys.mode) || [])[1] || 'Mode'));

function paint() {
  const p = monitorPrefs();
  const cells = [];
  const afmf = amd && amd.afmf && amd.afmf.on;
  if (p.fps && amd && amd.available) cells.push(['fps', gpu && gpu.fps != null ? String(gpu.fps) : '—', afmf ? 'i/s rendues' : 'i/s']);
  if (p.gpu && gpu && gpu.gpuUsage != null) cells.push(['gpu', `${gpu.gpuUsage} %`, gpu.gpuTemp != null ? `GPU ${gpu.gpuTemp} °C` : 'GPU']);
  if (p.cpu && live && live.mhz) cells.push(['cpu', (live.mhz / 1000).toFixed(1).replace('.', ',') + ' GHz', live.load != null ? `CPU ${live.load} %` : 'CPU']);
  if (p.power) {
    if (onBattery() && live.watts != null) cells.push(['power', fmtW(live.watts), 'Batterie']);
    else if (gpu && gpu.gpuPower != null) cells.push(['power', fmtW(gpu.gpuPower), 'GPU']);
  }
  if (p.limit) { const w = limitWatts(); if (w) cells.push(['limit', `${w} W`, modeName()]); }
  $('#mon-cells').innerHTML = cells.map(([k, v, l]) => `<div class="mon-cell ${k}"><b>${esc(v)}</b><small>${esc(l)}</small></div>`).join('')
    || '<div class="mon-cell"><small>Choisissez les mesures dans le widget KaneMode (Moniteur)</small></div>';

  // Réglages actifs : ce que le pilote AMD applique en ce moment
  const badges = [];
  if (p.badges && amd && amd.available) {
    if (amd.fps && amd.fps.on) badges.push(`≤ ${amd.fps.value} i/s`);
    if (afmf) badges.push('AFMF');
    if (amd.rsr && amd.rsr.on) badges.push('RSR');
    if (amd.antilag && amd.antilag.on) badges.push('Anti-Lag');
    if (amd.ris && amd.ris.on) badges.push('Netteté');
  }
  const b = $('#mon-badges');
  b.hidden = !badges.length;
  b.innerHTML = badges.map(x => `<span>${esc(x)}</span>`).join('');
}

// Dernier réglage fait dans le widget : affiché 6 s, avec sa vérification
let changeTimer = 0;
function showChange() {
  const c = lastChange();
  const box = $('#mon-change');
  if (!c || Date.now() - c.t > 6000) { box.hidden = true; return; }
  box.hidden = false;
  box.className = 'mon-change ' + (c.ok ? 'ok' : 'ko');
  box.textContent = (c.ok ? '✓ ' : '✕ ') + c.text;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => { box.hidden = true; }, 6000 - (Date.now() - c.t));
}
addEventListener('storage', e => {
  if (e.key === 'km.change') showChange();
  if (e.key === 'km.monitor') paint();
  // Un réglage vient d'être fait : l'état est relu tout de suite
  if (e.key === 'km.change') loadState();
});

// État de la Game Bar : épinglé sur le jeu, transparence choisie par l'utilisateur
if (WIDGET) window.chrome.webview.addEventListener('message', e => {
  const m = e.data || {};
  if (m.type === 'opacity') document.documentElement.style.setProperty('--mon-opacity', String(Math.max(0, Math.min(1, +m.value || 0))));
  if (m.type === 'pinned') document.body.classList.toggle('pinned', !!m.value);
});

async function loadLive() {
  const [a, b] = await Promise.all([
    api.get('/api/sys/live').catch(() => null),
    amd && amd.available ? api.get('/api/amd/live').catch(() => null) : null,
  ]);
  live = a; gpu = b;
  paint();
}
async function loadState() {
  [sys, amd] = await Promise.all([api.get('/api/sys').catch(() => sys), api.get('/api/amd').catch(() => amd)]);
  paint();
}

let timers = [];
function start() {
  stop();
  loadState().then(loadLive);
  showChange();
  timers = [setInterval(loadLive, 1000), setInterval(loadState, 10000)];
}
function stop() { timers.forEach(clearInterval); timers = []; }
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

applyTheme();
paint();
start();
