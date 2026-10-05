// GeForce NOW intégré à KaneMode. C'est le client OpenNOW (libre, MIT, github.com/OpenCloudGaming/OpenNOW)
// au complet, lancé en « mode KaneMode » (KANEMODE_EMBEDDED) : affichage console, couleurs et
// surbrillance de KaneMode, fenêtre « KaneMode · GeForce NOW » que l'app native reconnaît. Il vient du
// sous-module engine/OpenNOW (engine/build-opennow.ps1) et est embarqué dans le paquet.
// La connexion au compte NVIDIA reste entièrement dans OpenNOW : KaneMode ne lit ni ne stocke rien.
'use strict';
const fs = require('fs');

const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** Client : celui du paquet installé, sinon celui compilé en développement. */
function findExe(...candidates) {
  for (const c of candidates) if (c && isFile(c)) return c;
  return null;
}

/** Environnement du mode KaneMode : couleur d'accent et coins de KaneMode. */
function env({ accent, corners } = {}) {
  const e = { KANEMODE_EMBEDDED: '1' };
  if (/^#[0-9a-f]{6}$/i.test(accent || '')) e.KANEMODE_ACCENT = accent;
  if (['square', 'soft', 'round'].includes(corners)) e.KANEMODE_CORNERS = corners;
  return e;
}

module.exports = { findExe, env };
