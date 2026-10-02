// Choix persistants par alimentation, appliqués par l'hôte même pendant un jeu.
'use strict';
const MODES = ['eco', 'balanced', 'performance'];
const PERF_FIELDS = ['mode', 'powerMode', 'vendor', 'tdp', 'cpuMax', 'boost'];
function profiles(config) {
  const p = config.powerProfiles || {};
  return { auto: p.auto !== false, battery: { ...p.battery }, ac: { ...p.ac } };
}
function source(ac) {
  if (typeof ac !== 'boolean') throw new Error('Source d’alimentation indisponible');
  return ac ? 'ac' : 'battery';
}
function effectiveMode(profile) {
  if (PERF_FIELDS.some(k => k !== 'mode' && profile[k] != null)) return 'custom';
  return MODES.includes(profile.mode) ? profile.mode : null;
}
function create({ read, write, policy, expand, apply, applied }) {
  let pending = Promise.resolve(), last = '';
  const serial = work => { const next = pending.catch(() => {}).then(work); pending = next; return next; };
  const key = (src, p) => JSON.stringify([src, p.auto, p[src]]);
  async function perform(src, p) {
    const prof = p[src], expanded = await expand(prof, src);
    const result = await apply(expanded);
    if (!result.errors.length) {
      last = key(src, p);
      if (effectiveMode(prof)) applied(effectiveMode(prof), prof, src);
    }
    return { ...result, source: src, applied: expanded };
  }
  return {
    sync: ({ force = false, requested, refresh = false } = {}) => serial(async () => {
      const p = profiles(read());
      if (!p.auto && !force) return { skipped: true };
      const src = force && ['battery', 'ac'].includes(requested) ? requested : source((await policy()).ac);
      if (!force && !refresh && key(src, p) === last) return { skipped: true, source: src };
      if (!Object.keys(p[src]).length) { last = key(src, p); return { skipped: true, source: src }; }
      return perform(src, p);
    }),
    select: mode => serial(async () => {
      if (!MODES.includes(mode)) throw new Error('Mode inconnu');
      const src = source((await policy()).ac), c = read(), p = profiles(c);
      for (const field of PERF_FIELDS) delete p[src][field];
      p[src].mode = mode; c.powerProfiles = p; write(c);
      return perform(src, p);
    }),
    adjust: (field, value, execute) => serial(async () => {
      const src = source((await policy()).ac);
      const result = await execute();
      const c = read(), p = profiles(c);
      if (field === 'vendor') delete p[src].tdp;
      p[src][field] = field === 'vendor' ? result.mode || value : result[field] ?? value;
      c.powerProfiles = p; write(c);
      // Les réglages viennent d'être appliqués à la main : pas de deuxième application au prochain tick.
      last = key(src, p);
      applied('custom', p[src], src);
      return result;
    }),
  };
}
module.exports = { create, profiles, source, effectiveMode };
