// Sons d'interface graves et feutrés : fondamentale ronde, sans clic ni tintement aigu.
// Table partagée entre core.js et tools/gen-sounds.js pour le streaming local.
// Chaque note : [fréquence, départ (s), volume, durée]. Le démarrage reste dans boot.js.
export const SOUNDS = {
  move: { notes: [[294, 0, 1, 0.085]], vol: 0.028 },
  key: { notes: [[330, 0, 1, 0.065]], vol: 0.022 },
  tab: { notes: [[311, 0, 1, 0.085]], vol: 0.027 },
  select: { notes: [[220, 0, 0.85, 0.12], [330, 0.055, 1, 0.2]], vol: 0.04 },
  back: { notes: [[262, 0, 0.85, 0.11], [196, 0.055, 1, 0.18]], vol: 0.038 },
  on: { notes: [[247, 0, 0.8, 0.11], [370, 0.06, 1, 0.19]], vol: 0.038 },
  off: { notes: [[370, 0, 0.8, 0.11], [247, 0.06, 1, 0.19]], vol: 0.036 },
  open: { notes: [[196, 0, 0.7, 0.13], [294, 0.05, 0.8, 0.15], [392, 0.1, 0.75, 0.23]], vol: 0.033 },
  launch: { notes: [[165, 0, 0.7, 0.16], [247, 0.075, 0.8, 0.18], [330, 0.15, 0.8, 0.22], [440, 0.23, 0.7, 0.4]], vol: 0.033 },
  connected: { notes: [[220, 0, 0.8, 0.14], [294, 0.1, 0.9, 0.16], [392, 0.2, 0.8, 0.35]], vol: 0.033 },
  notify: { notes: [[262, 0, 0.9, 0.18], [349, 0.15, 0.8, 0.35]], vol: 0.035 },
  error: { notes: [[165, 0, 1, 0.12], [147, 0.12, 0.9, 0.18]], vol: 0.042, dull: true },
};
// Aucune percussion bruitée ; une octave supérieure presque inaudible apporte un peu de matière.
export const SOFT = { attack: 0.01, glide: 0, partials: [[1, 1, 1], [2, 0.012, 0.6]], lowpass: 900, echoDelay: 0.035, echoFeedback: 0.1, echoLowpass: 650, echoWet: 0.1 };
