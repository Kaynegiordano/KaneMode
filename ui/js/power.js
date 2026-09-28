// Veille et réveil façon SteamOS : veille immédiate, écran qui s'éteint en fondu, réveil animé,
// manettes et bibliothèque rafraîchies ; atténuation puis veille automatiques après inactivité.
import { $, api, lib, settings, toast, native } from './core.js';
import { inputLock } from './nav.js';
import { playBoot, sleepCurtain, clearCurtain } from './boot.js';

let state = 'awake'; // awake | sleeping | waking
let lastInput = Date.now();
let onBattery = false;
const listeners = [];

// ---------------------------------------------------------------- veille
/** Met le PC en veille (réelle dans l'app native, simulée dans un navigateur). */
export async function sleepNow() {
  if (state !== 'awake') return;
  state = 'sleeping';
  undim();
  inputLock.on = true;
  await sleepCurtain();
  if (native.available) native.send('power', { action: 'sleep' });
  else {
    await api.post('/api/action', { action: 'sleep' }).catch(() => {});
    $('#boot').dataset.hint = 'Veille simulée · appuyez sur un bouton pour réveiller';
  }
  // Si le PC ne s'endort pas (veille désactivée, navigateur…), n'importe quel bouton réveille l'écran.
  setTimeout(armWakeInputs, 1500);
}

function armWakeInputs() {
  if (state !== 'sleeping') return;
  const stop = () => { removeEventListener('keydown', onKey, true); removeEventListener('pointerdown', onKey, true); cancelAnimationFrame(raf); };
  const onKey = e => { e.preventDefault(); e.stopPropagation(); stop(); wake(); };
  let raf = 0, held = true;
  const poll = () => {
    if (state !== 'sleeping') return stop();
    const down = padsDown();
    if (down && !held) { stop(); return wake(); }
    held = down;
    raf = requestAnimationFrame(poll);
  };
  addEventListener('keydown', onKey, true);
  addEventListener('pointerdown', onKey, true);
  raf = requestAnimationFrame(poll);
  listeners.push(stop);
}

/** Réveil : logo bref et carillon, puis manettes et bibliothèque à jour. */
export async function wake({ fromSystem = false } = {}) {
  if (state === 'waking') return;
  // Réveil système alors que KaneMode n'avait rien demandé (bouton d'alimentation, capot…)
  if (state === 'awake' && !fromSystem) return;
  state = 'waking';
  listeners.splice(0).forEach(f => f());
  delete $('#boot').dataset.hint;
  clearCurtain();
  const before = new Set(padIds());
  if (settings.wakeAnimation && !document.hidden) await playBoot({ force: true, kind: 'wake', mode: 'logo' });
  else inputLock.on = false;
  state = 'awake';
  lastInput = Date.now();
  lib.load().catch(() => {});
  // Les manettes Bluetooth mettent quelques secondes à revenir après la veille
  setTimeout(() => {
    const now = padIds();
    const back = now.filter(id => !before.has(id));
    if (back.length) toast(`Manette reconnectée : ${back[0].replace(/\s*\(.*$/, '')}`);
    else if (!now.length && before.size) toast('Manette non détectée · appuyez sur un bouton de la manette', { error: true });
  }, 4000);
}

// Messages de l'app native : le système part en veille ou se réveille, quelle qu'en soit la cause
native.on(m => {
  if (m.type === 'suspend' && state === 'awake') {
    state = 'sleeping';
    inputLock.on = true;
    sleepCurtain();
  } else if (m.type === 'wake') {
    wake({ fromSystem: true });
  }
});

// ---------------------------------------------------------------- manettes
function pads() { return navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; }
const padIds = () => pads().map(p => p.id);
const padsDown = () => pads().some(p => p.buttons.some(b => b.pressed) || p.axes.some(a => Math.abs(a) > 0.5));

// ---------------------------------------------------------------- inactivité
const mark = () => { lastInput = Date.now(); if (document.body.classList.contains('dimmed')) undim(); };
['keydown', 'pointermove', 'pointerdown', 'wheel'].forEach(t => addEventListener(t, mark, { capture: true, passive: true }));
addEventListener('focus', mark);
document.addEventListener('visibilitychange', mark);

let lastPad = '';
function dim(secondsLeft) {
  const b = document.body;
  if (!b.classList.contains('dimmed')) b.classList.add('dimmed');
  let veil = $('#dim-veil');
  if (!veil) { veil = document.createElement('div'); veil.id = 'dim-veil'; document.body.append(veil); }
  veil.textContent = secondsLeft != null ? `Mise en veille dans ${secondsLeft} s · appuyez sur un bouton pour l’annuler` : '';
}
function undim() {
  document.body.classList.remove('dimmed');
  const veil = $('#dim-veil');
  if (veil) veil.textContent = '';
}

/** Minutes avant la veille automatique selon l'alimentation (0 : jamais). */
const sleepAfter = () => +(onBattery ? settings.sleepAfterBattery : settings.sleepAfterAC) || 0;

setInterval(() => {
  // État des manettes : toute pression ou tout mouvement compte comme une activité
  const snap = pads().map(p => p.buttons.map(b => (b.pressed ? 1 : 0)).join('') + p.axes.map(a => Math.round(a * 4)).join(',')).join('|');
  if (snap !== lastPad) { lastPad = snap; mark(); }
  if (state !== 'awake') return;
  // KaneMode en arrière-plan (un jeu tourne) : c'est Windows qui gère l'inactivité
  if (document.hidden || !document.hasFocus()) { lastInput = Date.now(); return; }
  const idle = (Date.now() - lastInput) / 1000;
  const sleepSec = sleepAfter() * 60;
  const dimSec = (+settings.dimAfter || 0) * 60;
  if (sleepSec && idle >= sleepSec) { sleepNow(); return; }
  if (sleepSec && idle >= sleepSec - 20) return dim(Math.ceil(sleepSec - idle));
  if (dimSec && idle >= dimSec) return dim(null);
}, 500);

// ---------------------------------------------------------------- batterie
(async () => {
  try {
    if (!navigator.getBattery) return;
    const b = await navigator.getBattery();
    const upd = () => { onBattery = !b.charging; }; // PC fixe : « en charge », à 100 %
    upd();
    b.addEventListener('chargingchange', upd);
  } catch { /* pas de batterie */ }
})();

export const powerState = () => ({ state, onBattery, idle: Math.round((Date.now() - lastInput) / 1000) });
