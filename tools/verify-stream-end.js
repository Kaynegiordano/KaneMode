'use strict';
// 4.34 : fin d'un streaming lancé depuis KaneMode. Le moteur cachait sa fenêtre puis restait ouvert
// (nettoyage de la session, jusqu'à 30 s) pendant que KaneMode attendait sa fermeture : écran noir.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (...f) => fs.readFileSync(path.join(__dirname, '..', ...f), 'utf8');

test('Moteur : pas de retour à KaneMode pendant la fermeture du jeu, KaneMode prévenu, sortie en 8 s au plus', () => {
  const main = read('engine', 'KanePlay', 'app', 'gui', 'main.qml');
  assert.match(main, /!\(currentItem instanceof QuitSegue\)/);
  const segue = read('engine', 'KanePlay', 'app', 'gui', 'StreamSegue.qml');
  assert.match(segue, /stackView\.replace\(stackView\.currentItem, component\.createObject/);
  assert.match(segue, /Ending the session\.\.\./, 'un texte à la place de la fenêtre noire');
  assert.match(read('engine', 'KanePlay', 'app', 'backend', 'kanemodebridge.cpp'), /open\\treturn/);
  assert.match(read('engine', 'KanePlay', 'app', 'main.cpp'), /waitForDone\(8000\)/);
  assert.match(read('engine', 'KanePlay', 'app', 'languages', 'qml_fr.ts'), /Fin de la session…/);
});

test('App : KaneMode revient devant dès le signal du moteur, et arrête un moteur resté ouvert', () => {
  const win = read('native', 'KaneMode.App', 'MainWindow.xaml.cs');
  assert.match(win, /parts\[1\] == "return"/);
  assert.match(win, /private async void ReturnFromKanePlay\(\)/);
  assert.match(win, /MainWindowHandle == IntPtr\.Zero/, 'jamais une session relancée');
});

test('Ménage : ancien lanceur par alias retiré, état du jeu streamé hors du journal', () => {
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'native', 'KaneMode.App', 'StreamHelper.cs')));
  assert.ok(!read('native', 'package', 'AppxManifest.xml').includes('ExecutionAlias'));
  assert.match(read('native', 'KaneMode.App', 'MainWindow.xaml.cs'), /type != "stream-game-state"\) Log\.Write/);
});
