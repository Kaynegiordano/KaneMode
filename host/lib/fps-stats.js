// Images par seconde mesurées sur cette console, par jeu et par mode de performance (comme les
// moyennes des joueurs Steam Deck sur les pages des jeux) : relevées par l'hôte pendant les parties
// (pilote AMD, voir server.js), affichées sur la fiche du jeu et dans « Performance du jeu ».
'use strict';

const MODES = ['eco', 'balanced', 'performance', 'custom'];
const SAVE_EVERY = 60e3;

/**
 * read() / write(data) : fichier des mesures. data = { [jeu]: { [mode]: { sum, n, low } , at } }.
 * low : le plus bas des moyennes par minute (les chutes se voient sans garder chaque mesure).
 */
function create({ read, write, now = Date.now }) {
  let data = null, dirty = false, lastSave = 0;
  const minute = new Map(); // jeu → { mode, sum, n, start } : minute en cours, pour « low »
  const load = () => (data ??= read() || {});

  function flush(force = false) {
    if (!dirty || (!force && now() - lastSave < SAVE_EVERY)) return;
    write(data);
    dirty = false;
    lastSave = now();
  }

  return {
    /** Une mesure (images/s) du jeu au premier plan, dans le mode de performance en cours. */
    record(id, mode, fps) {
      if (!id || !(fps > 0) || fps > 1000) return;
      const m = MODES.includes(mode) ? mode : 'custom';
      const all = load();
      const g = (all[id] ??= {});
      const s = (g[m] ??= { sum: 0, n: 0, low: null });
      s.sum += fps;
      s.n++;
      g.at = new Date(now()).toISOString();
      // Moyenne de chaque minute : la plus basse est gardée
      let cur = minute.get(id);
      if (!cur || cur.mode !== m || now() - cur.start >= 60e3) {
        if (cur && cur.n >= 6) { const avg = cur.sum / cur.n, prev = all[id][cur.mode]; if (prev && (prev.low == null || avg < prev.low)) prev.low = Math.round(avg); }
        cur = { mode: m, sum: 0, n: 0, start: now() };
        minute.set(id, cur);
      }
      cur.sum += fps;
      cur.n++;
      dirty = true;
      flush();
    },
    /** Moyennes d'un jeu, par mode : [{ mode, avg, low, samples }], le plus mesuré d'abord. */
    summary(id) {
      const g = load()[id];
      if (!g) return { modes: [], at: null };
      const modes = MODES.filter(m => g[m] && g[m].n >= 12) // au moins une minute de jeu
        .map(m => ({ mode: m, avg: Math.round(g[m].sum / g[m].n), low: g[m].low, samples: g[m].n }))
        .sort((a, b) => b.samples - a.samples);
      return { modes, at: g.at || null };
    },
    /** Fin de partie ou arrêt de l'hôte : tout est écrit. */
    flush: () => flush(true),
  };
}

module.exports = { create, MODES };
