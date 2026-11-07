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

const GAMES = {
  '040074A01BF12000': { name: 'Donkey Kong Bananza', high: { accuracy: 1, pacing: 1, res: 3 }, low: { accuracy: 0, pacing: 1, res: 1 },
    why: 'la vitesse du jeu suit les images : bloqué à 30 i/s' },
  '0400A3A01EE4C000': { name: 'Pokopia', high: { accuracy: 1, pacing: 2, res: 3 }, low: { accuracy: 0, pacing: 2, res: 3 },
    why: 'vise 60 i/s (≈ 45 sur une Ally)' },
  '0400486024DEC000': { name: 'Zelda Ocarina of Time', high: { accuracy: 0, pacing: 2, res: 3 }, low: { accuracy: 0, pacing: 1, res: 3 },
    why: 'limité par le processeur : 60 i/s sur PC, 30 i/s stables sur l’Ally' },
  '0400380020056000': { name: 'Splatoon Raiders', high: { accuracy: 0, pacing: 2, res: 3 }, low: { accuracy: 0, pacing: 1, res: 2 },
    why: '≈ 50 i/s en 1x sur un vieux PC : 60 visés sur PC, 30 sur l’Ally' },
};

const RES = { 1: '0,5x', 2: '0,75x', 3: '1x', 5: '1,5x', 6: '2x' };
const PACE = { 0: 'cadence auto', 1: '30 i/s', 2: '60 i/s' };

/**
 * Valeurs du preset et leur résumé lisible. ctx : { variant: 'eden' | 'lichii', tier, gpu, screenH, titleId }.
 * Renvoie { sections, summary: [lignes], game } (sections au format de mergeIni, sans « \default »).
 */
function iaPreset(ctx = {}) {
  const low = ctx.tier !== 'high';
  // DLSS NVIDIA à la place de celui des jeux : propre à Lichii (Eden-NS2 n'a pas ce réglage)
  const rtx = /geforce rtx|nvidia.*rtx/i.test(ctx.gpu || '') && ctx.variant !== 'edenns2';
  const summary = [];
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
    return { sections: { Renderer: renderer, System: { use_docked_mode: low ? 0 : 1 } }, summary, game: null };
  }
  // Switch 2 (Lichii)
  const game = GAMES[String(ctx.titleId || '').toUpperCase()] || null;
  const g = game ? game[low ? 'low' : 'high'] : { accuracy: 0, pacing: 0, res: 3 };
  const renderer = {
    backend: 1, use_vsync: 1, resolution_setup: g.res, scaling_filter: g.res < 3 || low ? 6 : 1,
    anti_aliasing: low ? 0 : 2, gpu_accuracy: g.accuracy, frame_pacing_mode: g.pacing,
    nvidia_dlss: rtx ? 'true' : 'false', vram_usage_mode: low ? 0 : 1, frame_gen: 'false',
    use_asynchronous_shaders: 'true', use_disk_shader_cache: 'true', use_vulkan_driver_pipeline_cache: 'true',
    accelerate_astc: 1, nvdec_emulation: 2, use_reactive_flushing: 'true', async_presentation: 'true',
  };
  summary.push(low
    ? `ROG Ally X : mode portable, ${RES[g.res]}${g.res < 3 ? ' agrandi par FSR' : ''}, sans anticrénelage, VRAM prudente${ctx.variant === 'edenns2' ? '' : ', upscaler des jeux AMD FSR 3.1'}`
    : `Carte dédiée : mode TV, ${RES[g.res]}, SMAA, VRAM généreuse${rtx ? ', DLSS NVIDIA à la place du DLSS des jeux' : ''}`);
  summary.push(`Précision GPU ${g.accuracy ? 'Accurate' : 'Fast'}, ${PACE[g.pacing]}, génération d’images coupée (vraies images, moins de latence)`);
  if (game) summary.push(`${game.name} : ${game.why}`);
  return { sections: { Renderer: renderer, System: { use_docked_mode: low ? 0 : 1 } }, summary, game: game && game.name };
}

module.exports = { iaPreset, GAMES };
