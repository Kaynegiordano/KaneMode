#!/usr/bin/env node
// Écrit les sons d'interface du streaming local (engine/KanePlay/app/res/sounds/*.wav) d'après la table
// de KaneMode (ui/js/soundtable.js) : même timbre grave et feutré, mêmes notes, même écho discret.
// Format conservé : 48 kHz, mono, 16 bits.
//   node tools/gen-sounds.js
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SR = 48000;
// Le volume du moteur est réglé à 60 % par défaut : on compense pour que, à ce réglage, les sons aient
// le même niveau que dans KaneMode.
const GAIN = 1 / 0.6;
const OUT = path.join(__dirname, '..', 'engine', 'KanePlay', 'app', 'res', 'sounds');

/** Filtre passe-bas du second ordre (RBJ), appliqué en place. */
function lowpass(x, freq, q = 0.5) {
  const w = 2 * Math.PI * freq / SR, alpha = Math.sin(w) / (2 * q), cw = Math.cos(w);
  const b0 = (1 - cw) / 2, b1 = 1 - cw, b2 = b0, a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}

function render(s, SOFT) {
  const end = Math.max(...s.notes.map(([, t0, , dec]) => t0 + dec)) + 0.12;
  const dry = new Float32Array(Math.ceil(end * SR) + Math.ceil(SR * 0.1));
  for (const [f, t0, amp, dec] of s.notes) {
    const start = Math.round(t0 * SR);
    for (const [mult, pa, pd] of s.dull ? [[1, 1, 1]] : SOFT.partials) {
      const d = dec * pd, n = Math.ceil((d + 0.01) * SR);
      let phase = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        // Glissé discret vers la note pendant les 15 premières ms
        const fr = f * mult * (1 + SOFT.glide * Math.max(0, 1 - t / 0.015));
        phase += 2 * Math.PI * fr / SR;
        // Attaque arrondie de 10 ms puis extinction exponentielle jusqu'à 0,0001
        const env = t < SOFT.attack ? t / SOFT.attack : Math.pow(0.0001, (t - SOFT.attack) / Math.max(d - SOFT.attack, 1e-3));
        if (start + i < dry.length) dry[start + i] += Math.sin(phase) * amp * pa * env;
      }
    }
  }
  for (let i = 0; i < dry.length; i++) dry[i] *= s.vol * GAIN;
  // Écho court et étouffé
  const dl = Math.round(SOFT.echoDelay * SR), buf = new Float32Array(dl), wet = new Float32Array(dry.length);
  let lp = 0;
  const a = Math.exp(-2 * Math.PI * SOFT.echoLowpass / SR);
  for (let i = 0; i < dry.length; i++) {
    const inp = dry[i] + buf[i % dl];
    lp = (1 - a) * inp + a * lp;   // passe-bas simple
    buf[i % dl] = lp * SOFT.echoFeedback;
    wet[i] = lp * SOFT.echoWet;
  }
  const mix = new Float32Array(dry.length);
  for (let i = 0; i < mix.length; i++) mix[i] = dry[i] + wet[i];
  lowpass(mix, SOFT.lowpass);
  // Fin fondue sur 15 ms pour éviter tout clic de coupure
  const fade = Math.round(0.015 * SR);
  for (let i = 0; i < fade; i++) mix[mix.length - 1 - i] *= i / fade;
  return mix;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

module.exports = { render, wav };

if (require.main === module) (async () => {
  const { getSoundPalette } = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'js', 'soundtable.js')).href);
  for (const profile of ['round', 'retro', 'soft']) {
    const { SOUNDS, SOFT } = getSoundPalette(profile);
    const folder = profile === 'round' ? OUT : path.join(OUT, profile);
    fs.mkdirSync(folder, { recursive: true });
    for (const name of ['move', 'select', 'back', 'tab', 'on', 'off', 'launch', 'connected', 'notify', 'error']) {
      const pcm = render(SOUNDS[name], SOFT);
      if (pcm.some(v => !Number.isFinite(v) || Math.abs(v) >= 1)) throw new Error('Son invalide : ' + profile + '/' + name);
      fs.writeFileSync(path.join(folder, name + '.wav'), wav(pcm));
    }
    console.log('Sons du streaming : ' + profile);
  }
})();
