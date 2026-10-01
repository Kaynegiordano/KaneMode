// Préférences d'interface : fonctions pures, communes aux réglages et à l'accueil.
export const AMBIENCES = [
  { id: 'calm', accent: '#c5cedb', background: 'dark', corners: 'soft', solidPanels: true, font: 'system', soundTheme: 'round', motionStyle: 'calm' },
  { id: 'retro', accent: '#eeb96a', background: 'gradient', corners: 'square', solidPanels: true, font: 'segoe', soundTheme: 'retro', motionStyle: 'snappy' },
  { id: 'night', accent: '#9588d9', background: 'art', corners: 'round', solidPanels: false, font: 'segoe', soundTheme: 'soft', motionStyle: 'calm' },
];
export const DISPLAY_PROFILES = {
  portable: { uiScale: 110, cardSize: 'm', homeDensity: 'compact', hintsBar: 'compact', lowFx: true },
  tv: { uiScale: 150, cardSize: 'l', homeDensity: 'spacious', hintsBar: 'full', lowFx: false },
};
export const DISPLAY_FIELDS = Object.keys(DISPLAY_PROFILES.portable);
export function activeDisplayProfile(settings, displayId) {
  const id = settings.displayMode === 'auto' ? settings.displayBindings?.[displayId] : settings.displayMode;
  return Object.hasOwn(DISPLAY_PROFILES, id) ? id : 'manual';
}
export function appearance(settings, displayId) {
  const id = activeDisplayProfile(settings, displayId);
  return id === 'manual' ? { ...settings } : { ...settings, ...DISPLAY_PROFILES[id], ...settings.displayProfiles?.[id] };
}
export function normalizePins(pins, visible, collections) {
  const games = new Set(visible.map(g => g.id)), cols = new Set(collections.map(c => c.id));
  const seen = new Set();
  return (Array.isArray(pins) ? pins : []).filter(p => {
    if (!p || !['game', 'collection'].includes(p.type) || typeof p.id !== 'string') return false;
    const key = p.type + ':' + p.id;
    if (seen.has(key) || !(p.type === 'game' ? games : cols).has(p.id)) return false;
    seen.add(key); return true;
  }).slice(0, 32);
}
export function resumeEntry(games, running = new Set()) {
  const candidates = games.filter(g => g.type === 'game' && g.installed && g.source !== 'kaneplay');
  return candidates.find(g => running.has(g.id)) || candidates.filter(g => g.lastPlayed > 0).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || null;
}
export function immersiveAllowed({ enabled, page, layers, locked, busy, hidden }) {
  return !!enabled && ['home', 'library', 'game'].includes(page) && !layers && !locked && !busy && !hidden;
}
