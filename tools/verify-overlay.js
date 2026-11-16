'use strict';
// 4.38 : surimpression des performances au-dessus du jeu (native/KaneMode.App/PerfOverlay.cs), niveau
// choisi dans l'accès rapide et gardé par l'hôte (GET/POST /api/overlay).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const server = read('host', 'server.js');
const overlay = read('native', 'KaneMode.App', 'PerfOverlay.cs');
const qam = read('ui', 'js', 'qam.js');

test('Hôte : niveau gardé de 0 à 4, mesures seulement quand la surimpression est affichée', () => {
  assert.match(server, /'GET \/api\/overlay'/);
  assert.match(server, /'POST \/api\/overlay'/);
  assert.match(server, /c\.perfOverlay = Math\.max\(0, Math\.min\(4,/);
  assert.match(server, /level \? \{ level, \.\.\.\(await hudSample\(\)\) \} : \{ level \}/);
  assert.match(server, /perfOverlay: overlayLevel\(\)/, 'niveau lu par l’accès rapide avec /api/sys');
});

test('App : demande l’hôte seulement quand un jeu est devant, fenêtre jamais activée ni cliquable', () => {
  assert.match(overlay, /if \(!_gameInFront\(\) \|\| !Native\.InteractiveDesktop\(\)\) \{ Hide\(\);/);
  assert.match(overlay, /"\/api\/overlay"/);
  assert.match(overlay, /X-KaneMode/);
  assert.match(overlay, /WM_NCHITTEST[\s\S]*HTTRANSPARENT/);
  assert.match(overlay, /NOACTIVATE = 0x8000000/);
  assert.match(read('native', 'KaneMode.App', 'MainWindow.xaml.cs'), /_perf = new PerfOverlay\(/);
});

test('Accès rapide : cinq choix (Non, 1 à 4) et une description par niveau', () => {
  assert.match(qam, /\[\[0, t\('Non'\)\], \[1, '1'\], \[2, '2'\], \[3, '3'\], \[4, '4'\]\]/);
  const levels = /const OVERLAY_LEVELS = \[([\s\S]*?)\];/.exec(qam)[1].match(/t\('/g);
  assert.equal(levels.length, 5);
});
