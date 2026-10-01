'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const load = name => import(pathToFileURL(path.join(root, 'ui', 'js', name)));

test('Les profils distinguent deux écrans et préservent le profil personnel', async () => {
  const { appearance, activeDisplayProfile } = await load('personalization.js');
  const settings = { displayMode: 'auto', uiScale: 100, displayBindings: { screenA: 'portable', screenB: 'tv' }, displayProfiles: { portable: { uiScale: 125 } } };
  assert.equal(appearance(settings, 'screenA').uiScale, 125);
  assert.equal(appearance(settings, 'screenB').uiScale, 150);
  assert.equal(appearance(settings, 'unknown').uiScale, 100);
  assert.equal(settings.uiScale, 100);
  assert.equal(activeDisplayProfile({ displayMode: 'toString' }, 'screenA'), 'manual');
});
test('Les épingles filtrent les éléments absents sans doublon ni modification du stockage', async () => {
  const { normalizePins } = await load('personalization.js');
  const pins = [{ type: 'game', id: 'a' }, { type: 'game', id: 'a' }, { type: 'collection', id: 'a' }, { type: 'game', id: 'hidden' }, null];
  assert.deepEqual(normalizePins(pins, [{ id: 'a' }], [{ id: 'a' }]), [{ type: 'game', id: 'a' }, { type: 'collection', id: 'a' }]);
  assert.equal(pins.length, 5);
});
test('La reprise préfère une partie ouverte puis une dernière session installée', async () => {
  const { resumeEntry } = await load('personalization.js');
  const games = [
    { id: 'old', installed: true, type: 'game', lastPlayed: 20 },
    { id: 'new', installed: true, type: 'game', lastPlayed: 40 },
    { id: 'removed', installed: false, type: 'game', lastPlayed: 80 },
    { id: 'never', installed: true, type: 'game', lastPlayed: 0 },
  ];
  assert.equal(resumeEntry(games, new Set(['old'])).id, 'old');
  assert.equal(resumeEntry(games).id, 'new');
  assert.equal(resumeEntry([games.at(-1)]), null);
});
test('Le mode immersif garde les réglages, dialogues et téléchargements lisibles', async () => {
  const { immersiveAllowed } = await load('personalization.js');
  const state = { enabled: true, page: 'home', layers: 0, locked: false, busy: false, hidden: false };
  assert.equal(immersiveAllowed(state), true);
  for (const patch of [{ layers: 1 }, { page: 'settings' }, { locked: true }, { busy: true }, { hidden: true }, { enabled: false }]) assert.equal(immersiveAllowed({ ...state, ...patch }), false);
});
test('Les ambiances restent graves et les WAV du streaming correspondent à la table partagée', async () => {
  const { SOUNDS, getSoundPalette } = await load('soundtable.js');
  const { render, wav } = require('./gen-sounds.js');
  for (const profile of ['round', 'retro', 'soft']) {
    const palette = getSoundPalette(profile);
    for (const [name, sound] of Object.entries(palette.SOUNDS)) {
      assert.ok(sound.notes.every(([frequency]) => frequency <= 440));
      if (profile === 'round') assert.deepEqual(sound.notes, SOUNDS[name].notes);
      if (['key', 'open'].includes(name)) continue;
      const file = path.join(root, 'engine', 'KanePlay', 'app', 'res', 'sounds', ...(profile === 'round' ? [] : [profile]), name + '.wav');
      assert.deepEqual(fs.readFileSync(file), wav(render(sound, palette.SOFT)));
    }
  }
});
test('Le streaming reçoit des préférences sonores bornées sans modifier le volume système', () => {
  const { env } = require('../host/lib/kaneplay.js');
  const prefs = env('show', { sounds: false, soundTheme: 'soft', soundVolume: 1000, soundMoves: false });
  assert.equal(prefs.KANEMODE_SOUNDS, '0');
  assert.equal(prefs.KANEMODE_SOUND_VOLUME, '100');
  assert.equal(prefs.KANEMODE_SOUND_THEME, 'soft');
  assert.equal(prefs.KANEMODE_SOUND_MOVES, '0');
  assert.equal(env('show', { soundTheme: '../../outside' }).KANEMODE_SOUND_THEME, undefined);
});
