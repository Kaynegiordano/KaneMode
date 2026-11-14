// Fichiers de données de KaneMode (réglages, état, bibliothèque) : lecture tolérante, écriture sûre.
'use strict';
const fs = require('fs');
const path = require('path');

const parseJsonFile = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
// Fichier abîmé (coupure pendant une écriture d'une ancienne version, disque plein) : la copie de
// secours « .bak » sert à sa place, au lieu de repartir de réglages vides sans rien dire.
const readJson = (f, d) => {
  try { return parseJsonFile(f); }
  catch (e) {
    if (e.code === 'ENOENT') return d;
    try { const v = parseJsonFile(f + '.bak'); console.error(`${path.basename(f)} illisible (${e.message}) : copie de secours utilisée`); return v; }
    catch { return d; }
  }
};
// Écriture sûre : le fichier complet est écrit à côté puis prend la place de l'ancien d'un seul
// coup (une console qui s'éteint en pleine écriture ne laisse plus un fichier tronqué). La version
// précédente est gardée en « .bak », au plus une fois toutes les dix minutes.
const bakAt = new Map();
const writeJson = (f, v) => {
  const text = JSON.stringify(v, null, 2);
  const tmp = f + '.tmp';
  // Seul un fichier lisible devient la copie de secours (jamais un fichier abîmé par-dessus une bonne copie)
  if (Date.now() - (bakAt.get(f) || 0) > 600e3) {
    bakAt.set(f, Date.now());
    try { parseJsonFile(f); fs.copyFileSync(f, f + '.bak'); } catch { /* absent ou illisible : pas de copie */ }
  }
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, f);
  } catch {
    // Remplacement refusé (fichier tenu un instant par un antivirus) : écriture directe, comme avant
    fs.writeFileSync(f, text);
    try { fs.rmSync(tmp, { force: true }); } catch { /* rien */ }
  }
};

module.exports = { readJson, writeJson };
