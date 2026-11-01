// Bords de l'écran : la souris poussée contre le bord gauche ouvre le menu, contre le bord droit
// l'accès rapide ; un glissement du doigt depuis ces bords fait pareil. Un panneau ouvert à la
// souris se referme quand elle s'en éloigne ; un glissement vers son bord le referme au doigt.
import { $ } from './core.js';
import { state, hooks, topLayer, closeLayer, inputLock } from './nav.js';

const HOVER_ZONE = 4;      // px contre le bord, pour la souris
const HOVER_DELAY = 220;   // ms à rester au bord avant d'ouvrir (un passage rapide n'ouvre rien)
const LEAVE_GAP = 80;      // px au-delà du panneau avant de le refermer
const TOUCH_ZONE = 36;     // px depuis le bord où un glissement peut commencer (Windows garde le tout bord)
const SWIPE = 56;          // px de glissement horizontal pour ouvrir ou fermer

const NAMES = { left: 'menu', right: 'qam' };

// Seulement sur l'interface plein écran, rien d'autre d'ouvert, ni pendant la vidéo de démarrage
const free = () => !!$('#pages') && !inputLock.on && !state.layers.length;

function openSide(side) {
  if (!free()) return false;
  (side === 'left' ? hooks.menu : hooks.qam)?.();
  const L = topLayer();
  return L && L.name === NAMES[side] ? L : false;
}

// ---------- Souris ----------
let hoverSide = null, hoverTimer = 0, hovered = null;
const sideAt = x => (x <= HOVER_ZONE ? 'left' : x >= innerWidth - 1 - HOVER_ZONE ? 'right' : null);

document.addEventListener('mousemove', e => {
  if (e.sourceCapabilities?.firesTouchEvents) return;
  // Panneau ouvert à la souris : refermé quand elle s'en éloigne
  if (hovered) {
    if (topLayer() !== hovered) hovered = null;
    else {
      // Largeur de mise en page : pendant l'animation d'ouverture, le rectangle affiché est encore hors écran
      const width = hovered.el.offsetWidth;
      const away = hovered.name === 'menu' ? e.clientX > width + LEAVE_GAP : e.clientX < innerWidth - width - LEAVE_GAP;
      if (away) { closeLayer(hovered); hovered = null; }
      return;
    }
  }
  const side = sideAt(e.clientX);
  if (side === hoverSide) return;
  hoverSide = side;
  clearTimeout(hoverTimer);
  if (side) hoverTimer = setTimeout(() => {
    if (hoverSide === side) hovered = openSide(side) || null;
  }, HOVER_DELAY);
}, { passive: true });
document.documentElement.addEventListener('mouseleave', () => { hoverSide = null; clearTimeout(hoverTimer); });

// ---------- Doigt ----------
let swipe = null;
addEventListener('touchstart', e => {
  swipe = null;
  if (e.touches.length !== 1) return;
  const { clientX: x, clientY: y } = e.touches[0];
  const L = topLayer();
  if (L && (L.name === 'menu' || L.name === 'qam')) swipe = { x, y, close: L };
  else if (free() && (x <= TOUCH_ZONE || x >= innerWidth - TOUCH_ZONE)) swipe = { x, y, side: x <= TOUCH_ZONE ? 'left' : 'right' };
}, { passive: true, capture: true });

addEventListener('touchmove', e => {
  if (!swipe || e.touches.length !== 1) return;
  const dx = e.touches[0].clientX - swipe.x, dy = e.touches[0].clientY - swipe.y;
  if (Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dy) > 20) { swipe = null; return; } // défilement vertical
  if (swipe.side) {
    if (swipe.side === 'left' ? dx >= SWIPE : dx <= -SWIPE) { openSide(swipe.side); swipe = null; }
  } else if (swipe.close) {
    // Vers le bord du panneau : à gauche pour le menu, à droite pour l'accès rapide
    if (swipe.close.name === 'menu' ? dx <= -SWIPE : dx >= SWIPE) {
      if (topLayer() === swipe.close) closeLayer(swipe.close);
      swipe = null;
    }
  }
}, { passive: true, capture: true });
addEventListener('touchend', () => { swipe = null; }, { passive: true, capture: true });
addEventListener('touchcancel', () => { swipe = null; }, { passive: true, capture: true });
