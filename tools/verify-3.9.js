'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const power = require('../host/lib/power-profiles');
function fixture(initial = {}) {
  let config = structuredClone(initial), ac = false, fail = false;
  const actions = [], modes = [];
  const options = { read: () => structuredClone(config), write: c => { config = structuredClone(c); },
    policy: async () => ({ ac }), expand: async (profile, src) => ({ ...profile, actualSource: src }),
    apply: async p => { actions.push(p); return { done: fail ? [] : ['powermode'], errors: fail ? ['Refus simulé'] : [] }; },
    applied: (mode, p, src) => modes.push({ mode, p, src }) };
  return { options, controller: power.create(options), actions, modes,
    config: () => structuredClone(config), ac: v => { ac = v; }, fail: v => { fail = v; } };
}
test('Modes indépendants : sélection sur batterie et secteur, conservation de l’autre source et des réglages écran', async () => {
  const f = fixture({ powerProfiles: { battery: { brightness: 50, tdp: 8 }, ac: { mode: 'balanced' } } });
  await f.controller.select('eco'); f.ac(true); await f.controller.select('performance');
  assert.deepEqual(f.config().powerProfiles.battery, { brightness: 50, mode: 'eco' });
  assert.deepEqual(f.config().powerProfiles.ac, { mode: 'performance' });
  assert.deepEqual(f.actions.map(p => p.actualSource), ['battery', 'ac']);
});
test('Chargeur : application au démarrage, changement de source, persistance après redémarrage et aucune répétition inutile', async () => {
  const f = fixture({ powerProfiles: { battery: { mode: 'eco' }, ac: { mode: 'performance' } } });
  await f.controller.sync(); await f.controller.sync(); f.ac(true); await f.controller.sync(); await f.controller.sync();
  assert.deepEqual(f.actions.map(p => p.mode), ['eco', 'performance']);
  const restarted = power.create(f.options); await restarted.sync();
  assert.equal(f.actions.at(-1).mode, 'performance');
  const before = f.actions.length; await restarted.sync({ refresh: true });
  assert.equal(f.actions.length, before + 1, 'Le réveil réapplique aussi les réglages Windows');
});
test('Profil désactivé, source inconnue et application refusée ne produisent pas de faux succès', async () => {
  const f = fixture({ powerProfiles: { auto: false, battery: { mode: 'eco' } } });
  assert.equal((await f.controller.sync()).skipped, true); assert.equal(f.actions.length, 0);
  f.ac(null); await assert.rejects(f.controller.select('eco'), /Source/); assert.equal(f.actions.length, 0);
  f.ac(false); f.fail(true); await f.controller.sync({ force: true }); assert.equal(f.modes.length, 0);
  f.fail(false); await f.controller.sync({ force: true }); assert.equal(f.modes.length, 1);
});
test('Réglages personnalisés par source : trois limites TDP conservées et un nouveau mode remplace seulement ses réglages de performance', async () => {
  const f = fixture({ powerProfiles: { battery: { mode: 'eco' }, ac: { mode: 'performance' } } });
  const tdp = { spl: 12, sppt: 15, fppt: 20 };
  await f.controller.adjust('tdp', tdp, async () => ({ ok: true }));
  assert.deepEqual(f.config().powerProfiles.battery.tdp, tdp); assert.equal(f.modes.at(-1).mode, 'custom');
  f.ac(true); await f.controller.sync(); f.ac(false); await f.controller.sync();
  assert.deepEqual(f.actions.at(-1).tdp, tdp);
  await f.controller.select('balanced'); assert.equal(f.config().powerProfiles.battery.tdp, undefined);
  assert.equal(f.config().powerProfiles.ac.mode, 'performance');
});
test('Changements concurrents : une seule application à la fois, source relue au moment de chaque opération', async () => {
  const f = fixture(); let release;
  f.options.apply = async p => { f.actions.push(p); if (f.actions.length === 1) await new Promise(r => { release = r; }); return { done: ['powermode'], errors: [] }; };
  const c = power.create(f.options), a = c.select('eco');
  while (!release) await new Promise(r => setImmediate(r));
  f.ac(true); const b = c.select('performance'); assert.equal(f.actions.length, 1); release();
  await Promise.all([a, b]); assert.deepEqual(f.actions.map(p => p.actualSource), ['battery', 'ac']);
});
test('Les limites effectivement acceptées sont mémorisées, un refus ne remplace pas le profil', async () => {
  const f = fixture();
  await f.controller.adjust('cpuMax', 120, async () => ({ cpuMax: 100 }));
  assert.equal(f.config().powerProfiles.battery.cpuMax, 100);
  const before = f.config();
  await assert.rejects(f.controller.adjust('tdp', 40, async () => { throw new Error('Refus'); }), /Refus/);
  assert.deepEqual(f.config(), before);
});
test('Silence après migration et au premier démarrage : carillon préservé, réactivation persistante', async () => {
  const { quietInterfaceDefaults, chimeEnabled } = await import(pathToFileURL(path.join(__dirname, '../ui/js/sound-settings.js')));
  const migrated = quietInterfaceDefaults({ sounds: true, bootSound: 'chime', bootVolume: 70 });
  assert.equal(migrated.sounds, false); assert.equal(migrated.bootSound, 'chime'); assert.equal(migrated.bootVolume, 70);
  assert.equal(quietInterfaceDefaults({}).sounds, false);
  assert.equal(quietInterfaceDefaults({ ...migrated, sounds: true }).sounds, true);
  assert.equal(chimeEnabled(migrated, 'boot'), true);
  assert.equal(chimeEnabled(migrated, 'wake'), false);
  assert.equal(chimeEnabled(migrated, 'sleep'), false);
  assert.equal(chimeEnabled({ ...migrated, sounds: true }, 'wake'), true);
});
test('Passage au streaming : aucune validation en arrière-plan ni pendant l’ouverture, retour explicite', async () => {
  const { createInputGate } = await import(pathToFileURL(path.join(__dirname, '../ui/js/input-gate.js')));
  const gate = createInputGate(); assert.equal(gate.allows(true, true), true);
  gate.suspend(); assert.equal(gate.allows(true, true), false);
  gate.resume(); assert.equal(gate.allows(true, false), false); assert.equal(gate.allows(false, true), false);
  assert.equal(gate.allows(true, true), true);
});
