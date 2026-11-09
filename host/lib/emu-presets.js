// « Preset IA » des jeux Switch (Eden) et Switch 2 (Lichii, Lichii modifié) : réglages choisis pour la
// machine (carte dédiée NVIDIA RTX, ou puce intégrée de la ROG Ally X) et, pour les jeux connus, pour le
// jeu lui-même. Écrits dans la config de l'émulateur avant chaque lancement du jeu.
//
// D'où viennent les valeurs (novembre 2026) :
//   - énumérations lues dans les sources de Lichii (settings_enums.h) : résolution 1 = 0,5x, 2 = 0,75x,
//     3 = 1x, 5 = 1,5x, 6 = 2x ; filtre 1 = bilinéaire, 6 = FSR 1 ; anticrénelage 0 aucun, 1 FXAA, 2 SMAA ;
//     précision GPU Lichii 0 Fast / 1 Accurate (Eden 0 Low / 1 Medium / 2 High) ; cadence 0 auto,
//     1 = 30 i/s, 2 = 60 i/s ; VRAM 0 prudente / 1 généreuse ; anisotropie 0 auto, 5 = 16x ;
//   - retours de la communauté réunis par le guide wichforks (30 oct.–7 nov. 2026) :
//       Donkey Kong Bananza : la vitesse du jeu suit les images (sous 30 : ralenti, au-dessus :
//         accéléré) → 30 i/s ; « Accurate » ≈ 30 i/s, « Fast » 40-50 mais plantages possibles ; 0,5x-1x ;
//       Pokopia : viser 60 ; une Ally Z1 Extreme fait ≈ 45 i/s ; la génération d'images donne 60
//         affichées mais moins bien qu'un vrai 60 ;
//       Zelda Ocarina of Time : limité par le processeur (9800X3D : 54-60 i/s) ; mod Dynamic FPS déjà là ;
//       Splatoon Raiders : ≈ 50 i/s en 1x, « Fast » ;
//   - ROG Ally X : puce Radeon 780M partagée avec la mémoire → mode portable (moins de pixels), précision
//     rapide, VRAM prudente, FSR quand l'image est plus petite que l'écran ; pas de DLSS (GeForce RTX seulement).
'use strict';

//   - novembre 2026 (4.27) : trois profils de machine au lieu de deux (« ultra » = carte très haut de gamme,
//     où l'émulation est limitée par le processeur et où la carte a de la marge pour une image plus
//     fine), shaders compilés au chargement (precache_shaders 2 = Always : plus de saccades la première
//     fois qu'un effet apparaît ; premier lancement plus long, bouton Passer), Donkey Kong libre avec le
//     mod intégré Dynamic FPS (vitesse juste de 20 à 60 i/s : plus besoin de bloquer à 30).
//     Énumérations (sources nx2) : FramePacingMode 0 auto 1 30 2 60 ; PrecacheShaders 0 Off 1 Ask 2 Always.
// ultra : réglages de la carte dédiée avec une image plus fine (res) ; dfps : avec le mod Dynamic FPS actif
const GAMES = {
  '040074A01BF12000': { name: 'Donkey Kong Bananza', high: { accuracy: 1, pacing: 1, res: 3 }, low: { accuracy: 0, pacing: 1, res: 1 },
    why: 'la vitesse du jeu suit les images : bloqué à 30 i/s',
    dfps: { pacing: 0, why: 'mod Dynamic FPS actif : images libres, vitesse juste de 20 à 60 i/s' } },
  '0400A3A01EE4C000': { name: 'Pokopia', high: { accuracy: 1, pacing: 2, res: 3 }, low: { accuracy: 0, pacing: 2, res: 3 },
    why: 'vise 60 i/s (≈ 45 sur une Ally)' },
  '0400486024DEC000': { name: 'Zelda Ocarina of Time', high: { accuracy: 0, pacing: 2, res: 3 }, low: { accuracy: 0, pacing: 1, res: 3 },
    ultra: { res: 6 }, why: 'limité par le processeur : 60 i/s sur PC, 30 i/s stables sur l’Ally' },
  '0400380020056000': { name: 'Splatoon Raiders', high: { accuracy: 0, pacing: 2, res: 3 }, low: { accuracy: 0, pacing: 1, res: 2 },
    ultra: { res: 5 }, why: '≈ 50 i/s en 1x sur un vieux PC : 60 visés sur PC, 30 sur l’Ally' },
};

const RES = { 1: '0,5x', 2: '0,75x', 3: '1x', 5: '1,5x', 6: '2x' };
const PACE = { 0: 'images libres', 1: '30 i/s', 2: '60 i/s' };

/**
 * Profil de la machine qui lance le jeu (relevé au démarrage de KaneMode sur cette machine) :
 * « ultra » (GeForce RTX x070 Ti et plus des séries 40/50, Radeon RX 7900 / 9070), « high » (autre
 * carte dédiée), « handheld » (puce intégrée : ROG Ally…).
 */
function machineClass(ctx = {}) {
  if (ctx.tier !== 'high') return 'handheld';
  const g = String(ctx.gpu || '');
  if (/rtx\s*(40|50)(70\s*ti|80|90)|rx\s*(7900|9070)/i.test(g)) return 'ultra';
  return 'high';
}
const shortName = s => String(s || '').replace(/\((R|TM)\)/gi, '').replace(/\b(NVIDIA|AMD|Intel|Processor|\d+-Core|with Radeon Graphics)\b/gi, '').replace(/\s+/g, ' ').trim();

/**
 * Valeurs du preset et leur résumé lisible. ctx : { variant: 'eden' | 'lichii', tier, gpu, cpu, threads,
 * ram, screenH, titleId, dynamicFps }. Renvoie { sections, summary: [lignes], game, machine }
 * (sections au format de mergeIni, sans « \default »).
 */
function iaPreset(ctx = {}) {
  const low = ctx.tier !== 'high';
  const machine = machineClass(ctx);
  const ultra = machine === 'ultra';
  // DLSS NVIDIA à la place de celui des jeux (Lichii)
  const rtx = /geforce rtx|nvidia.*rtx/i.test(ctx.gpu || '');
  const summary = [];
  const hw = [shortName(ctx.gpu), shortName(ctx.cpu), ctx.ram ? `${ctx.ram} Go` : ''].filter(Boolean).join(' · ');
  if (hw) summary.push(`Machine : ${hw}`);
  if (ctx.variant === 'eden') {
    // Switch 1 : la RTX garde de la marge → image calculée en 2x puis réduite à l'écran (plus nette que
    // n'importe quel anticrénelage) ; l'Ally reste en portable 1x agrandi par FSR
    const res = low ? 3 : (ctx.screenH || 1080) > 1100 ? 6 : 5;
    const renderer = {
      backend: 1, use_vsync: 1, resolution_setup: res, scaling_filter: low ? 6 : 1, anti_aliasing: low ? 1 : 0,
      gpu_accuracy: low ? 0 : 1, max_anisotropy: low ? 0 : 5, vram_usage_mode: low ? 0 : 1,
      use_asynchronous_shaders: 'true', use_disk_shader_cache: 'true', use_vulkan_driver_pipeline_cache: 'true',
      accelerate_astc: 1, nvdec_emulation: 2, use_reactive_flushing: 'true', async_presentation: 'true',
    };
    summary.push(low ? 'ROG Ally X : mode portable, image 1x agrandie par FSR, FXAA, précision basse, VRAM prudente'
      : `Carte dédiée : mode TV, image calculée en ${RES[res]} puis réduite à l’écran (sans anticrénelage), précision moyenne, filtrage 16x`);
    return { sections: { Renderer: renderer, System: { use_docked_mode: low ? 0 : 1 } }, summary, game: null, machine };
  }
  // Switch 2 (Lichii, Eglantine)
  const game = GAMES[String(ctx.titleId || '').toUpperCase()] || null;
  let g = game ? { ...game[low ? 'low' : 'high'] } : { accuracy: 0, pacing: 0, res: ultra ? 5 : 3 };
  if (game && ultra && game.ultra) Object.assign(g, game.ultra);
  const dfps = !!(game && game.dfps && ctx.dynamicFps);
  if (dfps) Object.assign(g, game.dfps);
  // Image plus grande que 1x : déjà lissée par le calcul en grand, pas d'anticrénelage en plus
  const aa = low || g.res > 3 ? 0 : 2;
  const renderer = {
    backend: 1, use_vsync: 1, resolution_setup: g.res, scaling_filter: g.res < 3 || low ? 6 : 1,
    anti_aliasing: aa, gpu_accuracy: g.accuracy, frame_pacing_mode: g.pacing,
    nvidia_dlss: rtx ? 'true' : 'false', vram_usage_mode: low ? 0 : 1, frame_gen: 'false',
    use_asynchronous_shaders: 'true', use_disk_shader_cache: 'true', use_vulkan_driver_pipeline_cache: 'true',
    precache_shaders: 2,
    accelerate_astc: 1, nvdec_emulation: 2, use_reactive_flushing: 'true', async_presentation: 'true',
  };
  summary.push(low
    ? `Console portable : mode portable, ${RES[g.res]}${g.res < 3 ? ' agrandi par FSR' : ''}, sans anticrénelage, VRAM prudente, upscaler des jeux AMD FSR 3.1`
    : `${ultra ? 'Carte très haut de gamme' : 'Carte dédiée'} : mode TV, ${RES[g.res]}${g.res > 3 ? ' (image calculée en grand, plus fine)' : ', SMAA'}, VRAM généreuse${rtx ? ', DLSS NVIDIA à la place du DLSS des jeux' : ''}`);
  summary.push(`Précision GPU ${g.accuracy ? 'Accurate' : 'Fast'}, ${PACE[g.pacing]}, shaders compilés au chargement (pas de saccades), génération d’images coupée (vraies images, moins de latence)`);
  if (game) summary.push(`${game.name} : ${dfps ? game.dfps.why : game.why}`);
  return { sections: { Renderer: renderer, System: { use_docked_mode: low ? 0 : 1 } }, summary, game: game && game.name, machine };
}

/**
 * Mod actif pour ce jeu : son dossier est là et l'émulateur ne l'a pas désactivé ([DisabledAddOns] :
 * entrée du jeu par son identifiant en décimal, noms désactivés en « N\disabled\M\d »).
 */
function modActive(qtConfigText, modsDir, tid, folder) {
  const fs = require('fs');
  const path = require('path');
  try { if (!fs.statSync(path.join(modsDir, folder)).isDirectory()) return false; } catch { return false; }
  const dec = BigInt('0x' + tid).toString();
  const lines = String(qtConfigText || '').split(/\r?\n/);
  let inSection = false, entry = null;
  for (const l of lines) {
    const s = /^\[(.*)\]$/.exec(l.trim());
    if (s) { inSection = s[1] === 'DisabledAddOns'; continue; }
    if (!inSection) continue;
    const t = /^(\d+)\\title_id=(\d+)$/.exec(l.trim());
    if (t) { if (t[2] === dec) entry = t[1]; continue; }
    const d = /^(\d+)\\disabled\\\d+\\d=(.*)$/.exec(l.trim());
    if (d && entry !== null && d[1] === entry && d[2] === folder) return false;
  }
  return true;
}

module.exports = { iaPreset, GAMES, machineClass, modActive };
