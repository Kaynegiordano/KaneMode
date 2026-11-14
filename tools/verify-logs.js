'use strict';
// 4.36 : journal lisible depuis les Paramètres (host/lib/logs.js), sur de faux journaux.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const logs = require('../host/lib/logs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-logs-'));
const APP = [
  '[2026-11-11 10:00:00] KaneMode démarré',
  '[2026-11-11 10:00:05] Premier plan : « Error » (electron)',
  '[2026-11-11 10:00:06] Manette : Orphan (premier plan « Erreur des Dossiers compressés », explorer, #3)',
  '[2026-11-11 10:01:00] [hôte] Sunshine : mise à jour des jeux impossible : EPERM',
  '[2026-11-11 10:02:00] [hôte] Sunshine : mise à jour des jeux impossible : EPERM',
  '[2026-11-11 10:02:37] [hôte:erreur] node:events:505',
  '[2026-11-11 10:02:37] [hôte:erreur]     throw er; // Unhandled \'error\' event',
  '[2026-11-11 10:02:37] [hôte:erreur] Error: write EPIPE',
  '[2026-11-11 10:02:37] [hôte:erreur]     at gpuctl.js:68:16',
  '[2026-11-11 10:02:37] [hôte:erreur] ',
  '[2026-11-11 10:04:51] Arrêt forcé impossible (processus 20980)',
];
fs.writeFileSync(path.join(dir, 'kanemode.log'), APP.join('\r\n') + '\r\n');

test('Erreurs de l’app et de l’hôte : la plus récente d’abord, sans le bruit des titres de fenêtres', () => {
  const list = logs.appErrors(dir);
  assert.deepEqual(list.map(e => e.text), ['Arrêt forcé impossible (processus 20980)', 'Error: write EPIPE', 'Sunshine : mise à jour des jeux impossible : EPERM']);
  assert.deepEqual(list.map(e => e.source), ['app', 'host', 'host']);
});

test('Une trace de l’hôte devient une seule entrée, avec son message et le détail', () => {
  const crash = logs.appErrors(dir).find(e => e.text === 'Error: write EPIPE');
  assert.ok(crash.detail.some(l => l.includes('gpuctl.js:68')));
  assert.ok(crash.detail.includes('node:events:505'), 'la première ligne de la trace reste dans le détail');
});

test('Un message répété est compté, à l’heure de sa dernière apparition', () => {
  const sunshine = logs.appErrors(dir).find(e => e.text.startsWith('Sunshine'));
  assert.equal(sunshine.count, 2);
  assert.equal(sunshine.at, '2026-11-11 10:02:00');
});

test('Journal du moteur : le plus récent, erreurs répétées comptées', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-engine-'));
  fs.writeFileSync(path.join(tmp, 'KanePlay-100.log'), '00:00:01 - SDL Error (0): ancienne\n');
  const recent = path.join(tmp, 'KanePlay-200.log');
  fs.writeFileSync(recent, [
    '00:00:01 - SDL Info (0): Video bitrate: 20000 kbps',
    '00:00:02 - SDL Error (0): Decoder failed',
    '00:00:03 - SDL Error (0): Decoder failed',
    '00:00:09 - Qt Warning: Unable to connect',
  ].join('\n') + '\n');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(recent, later, later);
  const r = logs.engineErrors(logs.engineLog(tmp));
  assert.equal(path.basename(r.file), 'KanePlay-200.log');
  assert.deepEqual(r.errors.map(e => [e.text, e.count]), [['Qt Warning: Unable to connect', 1], ['SDL Error (0): Decoder failed', 2]]);
});

test('Pas de journal du moteur : liste vide, sans erreur', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-noengine-'));
  assert.deepEqual(logs.engineErrors(logs.engineLog(empty)), { file: null, at: null, errors: [] });
});

test('Texte à copier : la fin des deux journaux', () => {
  const text = logs.copyText({ dir, engine: null, lines: 3 });
  assert.match(text, /== App et hôte/);
  assert.ok(text.includes('Arrêt forcé impossible'));
  assert.ok(!text.includes('KaneMode démarré'), 'seulement la fin');
});

test('Hôte : un outil fermé pendant une écriture n’arrête plus Node (EPIPE)', () => {
  for (const f of ['gpuctl.js', 'syscontrol.js']) {
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'host', 'lib', f), 'utf8'), /proc\.stdin\.on\('error'/, f);
  }
});
