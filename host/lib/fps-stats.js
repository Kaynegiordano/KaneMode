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
  // Fin d'une minute de mesures : sa moyenne devient le « plus bas » du mode si elle est sous l'ancien
  const closeMinute = cur => {
    const s = cur && cur.n >= 6 && data && data[cur.id] && data[cur.id][cur.mode];
    if (!s) return;
    const avg = Math.round(cur.sum / cur.n);
    if (s.low == null || avg < s.low) { s.low = avg; dirty = true; }
  };

  function flush(force = false) {
    // Fin de partie : la minute en cours compte aussi (une partie courte n'avait jamais de « plus bas »)
    if (force) { for (const cur of minute.values()) closeMinute(cur); minute.clear(); }
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
        closeMinute(cur);
        cur = { id, mode: m, sum: 0, n: 0, start: now() };
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
