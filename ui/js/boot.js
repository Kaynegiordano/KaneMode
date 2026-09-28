// Démarrage : logo KaneMode animé avec un court carillon (synthétisé, aucun fichier), ou vidéo perso.
// Les mêmes sons servent à la mise en veille et au réveil.
import { $, settings } from './core.js';
import { inputLock } from './nav.js';

// ---------------------------------------------------------------- sons synthétisés
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

/**
 * Joue un son système : « boot » (≈3 s), « wake » (réveil) ou « sleep » (mise en veille).
 * Renvoie false si le navigateur refuse le son (pas encore d'interaction).
 */
export async function chime(kind = 'boot', volume = settings.bootVolume / 100) {
  const ac = audio();
  if (!ac || volume <= 0) return false;
  if (ac.state !== 'running') { try { await Promise.race([ac.resume(), new Promise(r => setTimeout(r, 150))]); } catch { /* refusé */ } }
  if (ac.state !== 'running') return false;
  const t0 = ac.currentTime + 0.04;
  const out = ac.createGain();
  out.gain.value = volume;
  const comp = ac.createDynamicsCompressor();
  out.connect(comp).connect(ac.destination);
  const rv = reverb(ac);
  const wet = ac.createGain(); wet.gain.value = 0.6; rv.connect(wet).connect(out);
  const dry = ac.createGain(); dry.gain.value = 0.75; dry.connect(out);
  const env = (g, start, attack, dur, peak) => {
    g.gain.setValueAtTime(0.0001, t0 + start);
    g.gain.exponentialRampToValueAtTime(peak, t0 + start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
  };
  const tone = (freq, start, dur, { type = 'sine', peak = 0.1, attack = 0.01, detune = 0, pan = 0 } = {}) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    env(g, start, attack, dur, peak);
    o.connect(g);
    let node = g;
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    node.connect(dry); node.connect(rv);
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
    src.connect(f).connect(g); g.connect(dry); g.connect(rv);
    src.start(t0 + start);
  };

  if (kind === 'boot') {
    whoosh(0, 1.0, 220, 5200, 0.22);                                   // montée
    tone(55, 0.15, 2.9, { peak: 0.14, attack: 0.6 });                 // sub
    for (const [f, d] of [[110, -7], [110, 7], [164.81, -5], [220, 5], [277.18, 0]]) {
      tone(f, 0.25, 3.1, { type: 'triangle', peak: 0.035, attack: 0.9, detune: d }); // nappe (la majeur)
    }
    [1318.51, 1760, 2217.46, 2637.02, 3520].forEach((f, i) => bell(f, 0.92 + i * 0.075, 2.0 - i * 0.15, 0.07 - i * 0.008, (i - 2) * 0.3)); // étincelles
    bell(880, 0.9, 2.6, 0.09);                                          // coup de cloche central
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
  return true;
}

/** Son de démarrage selon les réglages : carillon, fichier perso ou rien. */
async function bootSound(kind = 'boot') {
  if (settings.bootSound === 'none') return;
  if (settings.bootSound === 'custom' && kind === 'boot') {
    const a = new Audio('/bootsound?t=' + Date.now());
    a.volume = Math.min(1, settings.bootVolume / 100);
    try { await a.play(); return; } catch { /* fichier absent ou son refusé : carillon */ }
  }
  await chime(kind);
}

// ---------------------------------------------------------------- écran de logo
const LOGO_HTML = `<div class="boot-logo">
  <div class="boot-mark"><svg><use href="#i-brand"/></svg><i class="boot-shine"></i></div>
  <div class="boot-word">KaneMode</div>
</div>`;

/** Logo animé seul (démarrage ou réveil). Se termine tout seul, ou au premier bouton. */
function showLogo(box, kind) {
  return new Promise(resolve => {
    box.classList.toggle('wake', kind === 'wake');
    box.insertAdjacentHTML('beforeend', LOGO_HTML);
    bootSound(kind);
    const t = setTimeout(resolve, kind === 'wake' ? 1500 : 2900);
    box._skip = () => { clearTimeout(t); resolve(); };
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
    box.classList.remove('fade', 'sleeping');
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
