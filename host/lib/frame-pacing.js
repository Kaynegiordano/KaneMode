// Limites d'images accordées à l'écran (comme le limiteur de SteamOS) : une limite qui divise la
// fréquence de l'écran donne un rythme régulier (40 i/s sur 120 Hz : chaque image dure 3 balayages),
// une autre saccade (45 i/s sur 120 Hz : 2 ou 3 balayages selon l'image). Pour chaque limite, la
// fréquence à mettre pendant le jeu : celle en cours si elle convient, sinon la plus haute qui convient.
'use strict';

const CANDIDATES = [30, 40, 45, 48, 60, 72, 90, 120, 144, 165, 240];
const FALLBACK = [30, 40, 45, 60, 90, 120];

/**
 * rates : fréquences proposées par l'écran (Hz) ; current : celle en cours.
 * Rend [{ fps, hz }] : hz = fréquence pour ce jeu (null si l'écran n'a rien dit).
 */
function alignedLimits(rates, current) {
  const list = [...new Set((rates || []).map(r => Math.round(+r)).filter(r => r >= 30))].sort((a, b) => a - b);
  if (!list.length) return FALLBACK.map(fps => ({ fps, hz: null }));
  const cur = Math.round(+current) || list[list.length - 1];
  const out = [];
  for (const fps of CANDIDATES) {
    if (fps > list[list.length - 1]) break;
    const hz = cur % fps === 0 ? cur : [...list].reverse().find(r => r % fps === 0);
    if (hz) out.push({ fps, hz });
  }
  return out;
}

module.exports = { alignedLimits, CANDIDATES };
