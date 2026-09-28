// Démarrage : logo KaneMode animé, calé sur le pic du son (son KaneMode synthétisé ou son perso), ou vidéo perso.
// Les mêmes sons servent à la mise en veille et au réveil.
import { $, api, settings, saveSettings } from './core.js';
import { inputLock } from './nav.js';

// ---------------------------------------------------------------- sons synthétisés
// Les sons sont calculés à l'avance (OfflineAudioContext) puis joués comme un fichier : leur pic est
// connu à l'échantillon près, et le logo peut s'y caler comme pour un son perso.
let ctx = null;
function audio() {
  if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); }
  return ctx;
}
// Réverbération : bruit qui s'éteint, pour l'impression de grand espace
function reverb(ac, seconds = 3.4, decay = 2.8) {
  const len = Math.floor(ac.sampleRate * seconds), buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  const conv = ac.createConvolver();
  conv.buffer = buf;
  return conv;
}

/** Démarrage : instant de l'éclat (pic du son) et durée de la montée qui le précède. */
const BOOT_HIT = 1.35, BOOT_RISE = 0.5;
const LENGTH = { boot: 7.5, wake: 4, sleep: 3.6 };

/** Construit le son `kind` dans le contexte `ac` (temps réel ou hors ligne). */
function build(ac, kind) {
  const t0 = 0.02;
  const out = ac.createGain();
  const comp = ac.createDynamicsCompressor();
  out.connect(comp).connect(ac.destination);
  const rv = kind === 'boot' ? reverb(ac, 4.6, 3.1) : reverb(ac);
  const wet = ac.createGain(); wet.gain.value = kind === 'boot' ? 0.75 : 0.6; rv.connect(wet).connect(out);
  const dry = ac.createGain(); dry.gain.value = 0.75; dry.connect(out);
  const env = (g, start, attack, dur, peak) => {
    g.gain.setValueAtTime(0.0001, t0 + start);
    g.gain.exponentialRampToValueAtTime(peak, t0 + start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
  };
  const route = (node, pan = 0) => {
    let n = node;
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; node.connect(p); n = p; }
    n.connect(dry); n.connect(rv);
  };
  const tone = (freq, start, dur, { type = 'sine', peak = 0.1, attack = 0.01, detune = 0, pan = 0 } = {}) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    env(g, start, attack, dur, peak);
    o.connect(g);
    route(g, pan);
    o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
  };
  // Cloche : fondamentale + partiels inharmoniques qui s'éteignent plus vite
  const bell = (freq, start, dur, peak, pan = 0) => {
    tone(freq, start, dur, { peak, attack: 0.004, pan });
    tone(freq * 2.76, start, dur * 0.45, { peak: peak * 0.35, attack: 0.003, pan });
    tone(freq * 5.4, start, dur * 0.2, { peak: peak * 0.15, attack: 0.002, pan });
  };
  const whoosh = (start, dur, from, to, peak) => {
    const len = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(from, t0 + start); f.frequency.exponentialRampToValueAtTime(to, t0 + start + dur);
    env(g, start, dur * 0.7, dur, peak);
    src.connect(f).connect(g);
    route(g);
    src.start(t0 + start);
  };

  if (kind === 'boot') {
    // Façon console de salon des années 2000 : un souffle et une nappe grave, sombres, qui gonflent
    // jusqu'à un éclat cristallin (le logo apparaît là), puis des scintillements qui retombent
    // dans une grande réverbération.
    const H = BOOT_HIT;
    whoosh(0, H + 0.08, 160, 7500, 0.24);                              // souffle qui monte
    const lp = ac.createBiquadFilter();                                 // nappe : le filtre s'ouvre jusqu'au pic
    lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(140, t0);
    lp.frequency.exponentialRampToValueAtTime(2800, t0 + H);
    lp.frequency.exponentialRampToValueAtTime(500, t0 + H + 3.2);
    const padGain = ac.createGain();
    padGain.gain.setValueAtTime(0.0001, t0);
    padGain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.35);
    padGain.gain.linearRampToValueAtTime(1, t0 + H);
    padGain.gain.exponentialRampToValueAtTime(0.0001, t0 + H + 4);
    lp.connect(padGain);
    route(padGain);
    for (const [f, d] of [[55, 0], [82.41, -6], [110, 6], [164.81, -4], [246.94, 4], [329.63, 0]]) {
      for (const det of [-9, 9]) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d + det;
        g.gain.value = f < 100 ? 0.05 : 0.022;
        o.connect(g).connect(lp);
        o.start(t0); o.stop(t0 + H + 4.1);
      }
    }
    // Impact grave et doux, sous l'éclat
    const kick = ac.createOscillator(), kg = ac.createGain();
    kick.frequency.setValueAtTime(92, t0 + H); kick.frequency.exponentialRampToValueAtTime(38, t0 + H + 0.6);
    env(kg, H, 0.012, 1.1, 0.3);
    kick.connect(kg); route(kg);
    kick.start(t0 + H); kick.stop(t0 + H + 1.2);
    // Éclat cristallin : accord aigu de cloches et de verre, légèrement étalé
    [1760, 2217.46, 2637.02, 3322.44, 4186.01].forEach((f, i) => bell(f, H + i * 0.011, 3.3 - i * 0.35, 0.075 - i * 0.009, (i - 2) * 0.35));
    bell(880, H, 3.8, 0.09);
    bell(440, H, 3.2, 0.05);
    // Scintillements qui retombent
    [3951.07, 3520, 2959.96, 2637.02, 2349.32, 1975.53, 1760].forEach((f, i) => bell(f, H + 0.28 + i * 0.16, 1.2, 0.034 * (1 - i / 9), i % 2 ? 0.55 : -0.55));
  } else if (kind === 'wake') {
    whoosh(0, 0.5, 400, 4000, 0.12);
    tone(110, 0.05, 1.4, { type: 'triangle', peak: 0.04, attack: 0.35 });
    bell(1318.51, 0.3, 1.3, 0.07, -0.3);
    bell(1760, 0.42, 1.5, 0.07, 0.3);
  } else if (kind === 'sleep') {
    bell(1760, 0, 1.0, 0.06, 0.3);
    bell(1318.51, 0.14, 1.2, 0.06, -0.3);
    tone(110, 0.05, 1.2, { type: 'triangle', peak: 0.035, attack: 0.1 });
  }
}

// Sons calculés une fois pour toutes
const rendered = {};
function renderSound(kind) {
  if (!rendered[kind]) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return Promise.resolve(null);
    const off = new OAC(2, Math.ceil(44100 * LENGTH[kind]), 44100);
    build(off, kind);
    rendered[kind] = off.startRendering().catch(() => null);
  }
  return rendered[kind];
}
// Le son de démarrage se calcule dès le chargement, pendant que l'écran est encore noir
setTimeout(() => renderSound('boot'), 0);

async function ready(volume) {
  const ac = audio();
  if (!ac || volume <= 0) return null;
  if (ac.state !== 'running') { try { await Promise.race([ac.resume(), new Promise(r => setTimeout(r, 150))]); } catch { /* refusé */ } }
  return ac.state === 'running' ? ac : null;
}

/**
 * Joue un son système : « boot » (≈4 s), « wake » (réveil) ou « sleep » (mise en veille).
 * Renvoie false si le navigateur refuse le son (pas encore d'interaction).
 */
export async function chime(kind = 'boot', volume = settings.bootVolume / 100) {
  const ac = await ready(volume);
  const buffer = ac && await renderSound(kind);
  if (!buffer) return false;
  const src = ac.createBufferSource(), g = ac.createGain();
  src.buffer = buffer; g.gain.value = volume;
  src.connect(g).connect(ac.destination);
  src.start();
  return true;
}

// ---------------------------------------------------------------- son perso synchronisé
// Le son choisi est analysé (moment où il éclate) et le logo apparaît pile sur ce pic, calé sur
// l'horloge audio en tenant compte de la latence de sortie.
let custom = null; // { key, buffer, peak, onset }

/** Un son choisi ailleurs (autre profil, installation) est adopté une fois. */
async function adoptSound() {
  try {
    const c = await api.get('/api/config');
    if (c.bootSound && c.bootSoundAt && c.bootSoundAt !== settings.bootSoundAt) {
      settings.bootSoundAt = c.bootSoundAt;
      settings.bootSound = 'custom';
      saveSettings();
    }
    return c;
  } catch { return null; }
}

/** Pic du son : maximum de l'énergie (fenêtres de 20 ms) ; début : quand le son devient audible. */
export function analyseSound(buf) {
  const sr = buf.sampleRate, hop = Math.round(sr * 0.005), win = Math.round(sr * 0.02);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const limit = Math.min(buf.length, sr * 8); // le pic est cherché dans les 8 premières secondes
  const env = [];
  for (let i = 0; i + win <= limit; i += hop) {
    let e = 0;
    for (const d of chans) for (let j = i; j < i + win; j += 2) e += d[j] * d[j];
    env.push(e);
  }
  if (!env.length) return { peak: 0, onset: 0 };
  let pk = 0;
  for (let i = 1; i < env.length; i++) if (env[i] > env[pk]) pk = i;
  let on = pk;
  while (on > 0 && env[on - 1] > env[pk] * 0.02) on--; // ≈ 14 % de l'amplitude du pic
  const t = i => (i * hop + win / 2) / sr;
  return { peak: t(pk), onset: t(on) };
}

async function loadCustom(ac, cfg) {
  const key = cfg ? `${cfg.bootSound}|${cfg.bootSoundAt}` : '?';
  if (custom && custom.key === key) return custom;
  const r = await fetch('/bootsound?t=' + Date.now());
  if (!r.ok) return null;
  const buffer = await ac.decodeAudioData(await r.arrayBuffer());
  custom = { key, buffer, ...analyseSound(buffer) };
  return custom;
}

/**
 * Joue un son et fait apparaître le logo sur son pic (snd : { buffer, peak, onset }). Renvoie
 * { total, stop } dès que tout est programmé, ou null si le son est refusé.
 */
async function playSynced(box, snd) {
  const volume = Math.min(1, settings.bootVolume / 100);
  const ac = await ready(volume);
  if (!ac || !snd) return null;
  // Le logo met « appear » secondes à apparaître et atteint son plein éclat sur le pic
  const appear = Math.min(0.5, Math.max(0.12, snd.peak - snd.onset));
  const lead = Math.max(0, appear - snd.peak); // pic trop tôt : le son attend un peu le logo
  const startAt = ac.currentTime + 0.1 + lead;
  const showAt = startAt + snd.peak - appear;
  const src = ac.createBufferSource(), g = ac.createGain();
  src.buffer = snd.buffer;
  g.gain.value = volume;
  src.connect(g).connect(ac.destination);
  src.start(startAt);
  // Instant réellement entendu : horodatage de sortie (latence comprise), sinon estimation
  const heard = () => {
    const ts = ac.getOutputTimestamp && ac.getOutputTimestamp();
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    return ac.currentTime - (ac.outputLatency || ac.baseLatency || 0);
  };
  let raf = 0, timer = 0, shown = false;
  const show = force => {
    if (shown) return;
    // Une image dure ~16 ms : on insère le logo à la frame la plus proche de l'instant visé
    if (!force && heard() < showAt - 0.008) { raf = requestAnimationFrame(() => show()); return; }
    shown = true;
    cancelAnimationFrame(raf); clearTimeout(timer);
    box.classList.add('sync');
    box.style.setProperty('--appear', appear.toFixed(3) + 's');
    box.insertAdjacentHTML('beforeend', LOGO_HTML);
  };
  raf = requestAnimationFrame(() => show());
  const untilShow = Math.max(0, showAt - heard());
  // Filet de sécurité si les images ne sont pas dessinées (fenêtre masquée) : le logo apparaît quand même
  timer = setTimeout(() => show(true), untilShow * 1000 + 250);
  const tail = (snd.length || snd.buffer.duration) - snd.peak; // son restant après le pic
  return {
    total: untilShow + appear + Math.min(8, Math.max(2.2, tail + 0.15)),
    cancel: () => { cancelAnimationFrame(raf); clearTimeout(timer); }, // fin normale : plus rien à insérer
    stop: () => {
      cancelAnimationFrame(raf); clearTimeout(timer);
      try { g.gain.setTargetAtTime(0, ac.currentTime, 0.08); src.stop(ac.currentTime + 0.4); } catch { /* déjà arrêté */ }
    },
  };
}

/** Son de démarrage choisi : fichier perso analysé, ou son KaneMode (pic connu). */
async function bootSource(cfg) {
  if (settings.bootSound === 'custom') {
    const ac = audio();
    try { const c = ac && await loadCustom(ac, cfg); if (c) return c; } catch { /* fichier illisible : son KaneMode */ }
  }
  const buffer = await renderSound('boot');
  // La réverbération prolonge le son : l'écran de logo s'arrête un peu avant la fin du calcul
  return buffer && { buffer, peak: BOOT_HIT + 0.03, onset: BOOT_HIT + 0.03 - BOOT_RISE, length: BOOT_HIT + 2.6 };
}

// ---------------------------------------------------------------- écran de logo
const LOGO_HTML = `<div class="boot-logo">
  <div class="boot-mark"><svg><use href="#i-brand"/></svg><i class="boot-shine"></i></div>
  <div class="boot-word">KaneMode</div>
</div>`;

/** Logo animé seul (démarrage ou réveil). Se termine tout seul, ou au premier bouton. */
function showLogo(box, kind) {
  return new Promise(async resolve => {
    box.classList.toggle('wake', kind === 'wake');
    let t = 0, stop = () => {}, skipped = false;
    box._skip = () => { skipped = true; clearTimeout(t); stop(); resolve(); };
    if (kind === 'boot' && settings.bootSound !== 'none') {
      const cfg = await adoptSound();
      const synced = await playSynced(box, await bootSource(cfg));
      if (synced) {
        stop = synced.stop;
        if (skipped) return stop();
        t = setTimeout(() => { synced.cancel(); resolve(); }, synced.total * 1000);
        return;
      }
    }
    if (skipped) return;
    box.insertAdjacentHTML('beforeend', LOGO_HTML);
    if (settings.bootSound !== 'none') chime(kind);
    t = setTimeout(resolve, kind === 'wake' ? 1500 : 2900);
  });
}

function playVideo(box) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.playsInline = true;
    box.prepend(v);
    const done = ok => { v.onended = v.onerror = null; resolve(ok); };
    v.onended = () => done(true);
    v.onerror = () => done(false); // pas de vidéo perso : on passe au logo
    box._skip = () => done(true);
    v.src = '/bootvideo?t=' + Date.now();
    v.muted = false;
    // Sans interaction préalable, le navigateur peut refuser le son : on rejoue alors en muet.
    v.play().catch(() => { v.muted = true; v.play().catch(() => done(false)); });
  });
}

/**
 * Séquence de démarrage (ou de réveil) plein écran. N'importe quel bouton la passe.
 * mode : « logo » (par défaut), « video » (vidéo perso) ou « none ».
 */
export function playBoot({ force = false, kind = 'boot', mode = settings.bootMode } = {}) {
  return new Promise(async resolve => {
    if (!force && mode === 'none') return resolve();
    const box = $('#boot');
    box.replaceChildren(Object.assign(document.createElement('div'), { className: 'boot-skip', textContent: 'Appuyez sur un bouton pour passer' }));
    box.hidden = false;
    box.classList.remove('fade', 'sleeping', 'sync');
    box._skip = null;
    inputLock.on = true;
    let done = false, raf = 0;
    const finish = () => {
      if (done) return;
      done = true;
      removeEventListener('keydown', onKey, true);
      box.removeEventListener('click', onSkip);
      cancelAnimationFrame(raf);
      clearTimeout(safety);
      box._skip = null;
      box.classList.add('fade');
      setTimeout(() => { if (box.classList.contains('fade')) { box.hidden = true; box.replaceChildren(); } }, 600);
      // On relâche les entrées un peu après, pour que le bouton qui a passé l'intro n'agisse pas derrière.
      setTimeout(() => { inputLock.on = false; }, 350);
      resolve();
    };
    const onSkip = () => (box._skip ? box._skip() : finish());
    const onKey = e => { e.preventDefault(); e.stopPropagation(); onSkip(); };
    let held = true; // un bouton déjà enfoncé au lancement ne compte pas
    const pollPad = () => {
      const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
      const down = pads.some(p => p.buttons.some(b => b.pressed));
      if (down && !held) { held = true; onSkip(); } else if (!down) held = false;
      raf = requestAnimationFrame(pollPad);
    };
    addEventListener('keydown', onKey, true);
    box.addEventListener('click', onSkip);
    const safety = setTimeout(finish, 30000);
    raf = requestAnimationFrame(pollPad);

    if (kind === 'boot' && mode === 'video' && await playVideo(box)) return finish();
    if (done) return;
    box.querySelector('video')?.remove();
    await showLogo(box, kind);
    finish();
  });
}

/** Voile de mise en veille : l'écran s'éteint en fondu, avec le son de veille. */
export function sleepCurtain() {
  const box = $('#boot');
  box.replaceChildren();
  box.classList.remove('fade', 'wake');
  box.classList.add('sleeping');
  box.hidden = false;
  if (settings.bootSound !== 'none') chime('sleep');
  return new Promise(r => setTimeout(r, 1000));
}
export function clearCurtain() {
  const box = $('#boot');
  if (!box.classList.contains('sleeping')) return;
  box.classList.remove('sleeping');
  box.hidden = true;
}

// Le premier geste de l'utilisateur débloque le son (utile dans un navigateur ordinaire)
const unlock = () => { const ac = audio(); if (ac && ac.state !== 'running') ac.resume().catch(() => {}); };
addEventListener('pointerdown', unlock, { once: true, capture: true });
addEventListener('keydown', unlock, { once: true, capture: true });
