'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create, publicState, STORE } = require('../host/lib/dolby');
const ZERO = '{00000000-0000-0000-0000-000000000000}';
const HEADPHONES = '{1459AC38-3875-49BF-BB59-0FE80F4D395D}';
const SONIC = '{B53D940C-B846-4831-9F76-D102B9B725A0}';
const fixture = () => ({ available: true, installed: true, appId: 'DolbyLaboratories.DolbyAccess_rz1tebttyb220!App',
  formats: { headphones: HEADPHONES, sonic: SONIC },
  devices: ['headset', 'tv'].map(id => ({ id, name: id, supported: ['off', 'headphones', 'sonic'], selectedGuid: ZERO, activeGuid: ZERO })) });
const clone = value => structuredClone(value);

test('Dolby distingue disponibilité, sélection, activité et licence inconnue', () => {
  const raw = fixture(); raw.devices[0].selectedGuid = HEADPHONES; raw.devices[0].activeGuid = SONIC;
  const state = publicState(raw, true);
  assert.equal(state.devices[0].selected, 'headphones'); assert.equal(state.devices[0].active, 'sonic');
  assert.equal(state.license, null); assert.equal(state.appId, undefined); assert.equal(state.formats, undefined);
  assert.equal(publicState({ ...raw, available: false }, true).controllable, false);
});
test('Un changement spatial est relu et limité à la sortie demandée', async () => {
  const raw = fixture(), applied = [];
  const dolby = create({ readState: async () => clone(raw), hasTool: () => true, delay: async () => {},
    applyFormat: async (id, guid) => { applied.push([id, guid]); raw.devices.find(d => d.id === id).selectedGuid = guid; } });
  const result = await dolby.set('headset', 'headphones');
  assert.equal(result.verified, true); assert.equal(result.devices[0].selected, 'headphones');
  assert.equal(result.devices[1].selected, 'off'); assert.deepEqual(applied, [['headset', HEADPHONES]]);
});
test('Les formats absents, sorties inconnues et commandes arbitraires sont refusés', async () => {
  let changes = 0;
  const dolby = create({ readState: async () => fixture(), hasTool: () => true, applyFormat: async () => changes++ });
  await assert.rejects(dolby.set('headset', 'homeTheater'), /indisponible/);
  await assert.rejects(dolby.set('arbitrary', 'off'), /Sortie audio/);
  await assert.rejects(dolby.set('headset', 'cmd.exe'), /inconnu/);
  assert.equal(changes, 0);
});
test('Un refus Windows ne produit pas de faux succès et restaure le format précédent', async () => {
  const raw = fixture(), applied = []; raw.devices[0].selectedGuid = SONIC;
  const dolby = create({ readState: async () => clone(raw), hasTool: () => true, delay: async () => {},
    applyFormat: async (id, guid) => { applied.push([id, guid]); } });
  await assert.rejects(dolby.set('headset', 'headphones'), /Windows n’a pas appliqué/);
  assert.deepEqual(applied, [['headset', HEADPHONES], ['headset', SONIC]]);
});
test('Les réglages concurrents sont exécutés dans l’ordre et relus séparément', async () => {
  const raw = fixture(), applied = [];
  const dolby = create({ readState: async () => clone(raw), hasTool: () => true, delay: async () => {},
    applyFormat: async (id, guid) => { await new Promise(resolve => setImmediate(resolve)); applied.push(guid); raw.devices[0].selectedGuid = guid; } });
  const results = await Promise.all([dolby.set('headset', 'headphones'), dolby.set('headset', 'off')]);
  assert.deepEqual(applied, [HEADPHONES, '']); assert.equal(results[0].devices[0].selected, 'headphones'); assert.equal(results[1].devices[0].selected, 'off');
});
test('La licence ouvre uniquement Dolby Access ou sa fiche Store officielle', async () => {
  const raw = fixture(), launches = [];
  const dolby = create({ readState: async () => clone(raw), launch: async value => { launches.push(value.target); return { ok: true }; } });
  await dolby.open('license'); assert.equal(launches[0], 'shell:AppsFolder\\DolbyLaboratories.DolbyAccess_rz1tebttyb220!App');
  raw.appId = 'OtherApp_family!App'; await dolby.open('app'); assert.equal(launches[1], STORE);
  raw.installed = false; await dolby.open('license'); assert.equal(launches[2], STORE);
  await assert.rejects(dolby.open('https://example.com'), /inconnue/);
});
test('Une lecture Windows en panne peut être réessayée, sans faux état mis en cache', async () => {
  let reads = 0;
  const dolby = create({ readState: async () => { if (++reads === 1) throw Error('Windows'); return fixture(); }, hasTool: () => false });
  assert.equal((await dolby.state()).available, false);
  const state = await dolby.state(); assert.equal(state.available, true); assert.equal(state.controllable, false);
});
