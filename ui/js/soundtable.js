// Sons d'interface de KaneMode, façon SteamOS / Switch 2 : petits « tocs » ronds et doux.
// Cette table sert deux fois : core.js les calcule dans le navigateur, et tools/gen-sounds.js les écrit
// en .wav pour le streaming local (engine/KanePlay/app/res/sounds) : les deux ont donc la même voix.
// Chaque note : [fréquence, départ (s), volume, durée]. `vol` est le volume général.
export const SOUNDS = {
  move: { notes: [[1175, 0, 1, 0.06]], vol: 0.026 },
  key: { notes: [[1568, 0, 1, 0.04]], vol: 0.02 },
  tab: { notes: [[1397, 0, 1, 0.05]], vol: 0.024 },
  select: { notes: [[988, 0, 0.85, 0.1], [1319, 0.05, 1, 0.17]], vol: 0.04 },
  back: { notes: [[988, 0, 0.85, 0.09], [740, 0.05, 1, 0.15]], vol: 0.038 },
  on: { notes: [[988, 0, 0.8, 0.09], [1480, 0.055, 1, 0.16]], vol: 0.04 },
  off: { notes: [[1480, 0, 0.8, 0.09], [988, 0.055, 1, 0.16]], vol: 0.038 },
  open: { notes: [[784, 0, 0.7, 0.11], [1175, 0.045, 0.8, 0.13], [1568, 0.09, 0.8, 0.2]], vol: 0.034 },
  launch: { notes: [[659, 0, 0.7, 0.14], [988, 0.07, 0.8, 0.16], [1319, 0.14, 0.85, 0.2], [1976, 0.21, 0.8, 0.45]], vol: 0.034 },
  connected: { notes: [[988, 0, 0.8, 0.12], [1319, 0.09, 0.9, 0.14], [1760, 0.18, 0.9, 0.4]], vol: 0.034 },
  notify: { notes: [[1319, 0, 0.9, 0.16], [1760, 0.14, 0.9, 0.42]], vol: 0.036 },
  error: { notes: [[392, 0, 1, 0.11], [330, 0.11, 1, 0.16]], vol: 0.05, dull: true },
};
// Adoucissement des aigus (Hz), écho court et étouffé : communs aux deux moteurs
export const SOFT = { lowpass: 3600, echoDelay: 0.03, echoFeedback: 0.25, echoLowpass: 2200, echoWet: 0.28 };
