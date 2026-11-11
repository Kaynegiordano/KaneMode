'use strict';
// 4.32 : jeux d'émulation joués en streaming. Select + Start va au PC (il quitte le jeu comme à la
// maison) sans ouvrir le menu du streaming ni le mode souris ; Eden et Lichii gardent une disposition
// par manette ; la console Switch est en français (Europe) ; KaneMode ajouté à Steam n'est plus un jeu.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pads = require('../host/lib/emu-pads');
const setup = require('../host/lib/emu-setup');
const steam = require('../host/lib/steam');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-pads-'));
const read = (...f) => fs.readFileSync(path.join(__dirname, '..', ...f), 'utf8');

// Manette virtuelle de Sunshine pour une Pro Controller ou une DualSense : DualShock 4 (054c:05c4)
const DS4 = '030000004c050000c405000000016800';
const DS4_KEYS = [
  'player_0_button_a\\default=false', `player_0_button_a="engine:sdl,port:0,guid:${DS4},button:1"`,
  'player_0_button_b\\default=false', `player_0_button_b="engine:sdl,port:0,guid:${DS4},button:0"`,
  'player_0_button_plus\\default=false', `player_0_button_plus="engine:sdl,port:0,guid:${DS4},button:6"`,
];
// Manette Xbox 360 virtuelle (manette de l'Ally en streaming)
const X360 = { user: 0, vid: 0x045e, pid: 0x028e, ver: 0x0114, sub: 1 };

function edenDir(lines) {
  const dir = tmp();
  const conf = path.join(dir, 'user', 'config');
  fs.mkdirSync(conf, { recursive: true });
  fs.writeFileSync(path.join(conf, 'qt-config.ini'), ['[Controls]', ...lines, '', '[System]', 'language_index\\default=true', 'language_index=1', 'region_index\\default=true', 'region_index=1', ''].join('\r\n'));
  fs.writeFileSync(path.join(conf, 'kanemode-preset.txt'), 'origin\n');
  return { dir, ini: path.join(conf, 'qt-config.ini') };
}
const prep = (dir, extra) => setup.prepare('eden', dir, { bios: tmp(), pads: [], hidPads: [], lang: 'fr', ...extra });
const buttonA = ini => pads.iniValue(fs.readFileSync(ini, 'utf8'), 'Controls', 'player_0_button_a');

test('Eden : la disposition DualShock 4 faite à la main est retenue et revient avec sa manette', () => {
  const { dir, ini } = edenDir(DS4_KEYS);
  // DualShock 4 branchée : rien ne change
  prep(dir, { hidPads: [{ vid: 0x054c, pid: 0x05c4 }] });
  assert.match(buttonA(ini), new RegExp(DS4));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'user', 'config', 'kanemode-pads.json'), 'utf8'));
  assert.ok(saved['054c:05c4'], 'disposition retenue pour la DualShock 4');
  // Manette Xbox à la place : disposition Xbox de KaneMode
  prep(dir, { pads: [X360] });
  assert.match(buttonA(ini), /guid:[0-9a-f]{28}78[0-9a-f]{2}/, 'identifiant XInput');
  // La DualShock 4 revient : sa disposition à la main revient aussi, sans la refaire
  prep(dir, { hidPads: [{ vid: 0x054c, pid: 0x05c4 }] });
  assert.equal(buttonA(ini), `"engine:sdl,port:0,guid:${DS4},button:1"`);
  assert.equal(pads.iniValue(fs.readFileSync(ini, 'utf8'), 'Controls', 'player_0_button_plus'), `"engine:sdl,port:0,guid:${DS4},button:6"`);
});

test('Eden : aucune manette encore créée (début de streaming) : la disposition ne bouge pas', () => {
  const { dir, ini } = edenDir(DS4_KEYS);
  prep(dir, {});
  assert.match(buttonA(ini), new RegExp(DS4));
});

test('Console Switch en français (Europe) tant que la langue est celle d’origine ; un choix fait reste', () => {
  const { dir, ini } = edenDir(DS4_KEYS);
  prep(dir, {});
  let text = fs.readFileSync(ini, 'utf8');
  assert.equal(pads.iniValue(text, 'System', 'language_index'), '2');
  assert.equal(pads.iniValue(text, 'System', 'region_index'), '2');
  // Allemand choisi dans l'émulateur : gardé
  fs.writeFileSync(ini, text.replace('language_index=2', 'language_index=3'));
  prep(dir, {});
  text = fs.readFileSync(ini, 'utf8');
  assert.equal(pads.iniValue(text, 'System', 'language_index'), '3');
  // Interface en anglais : rien d'imposé
  const other = edenDir(DS4_KEYS);
  prep(other.dir, { lang: 'en' });
  assert.equal(pads.iniValue(fs.readFileSync(other.ini, 'utf8'), 'System', 'language_index'), '1');
});

test('KaneMode ajouté à Steam n’est pas un jeu (proposé aux consoles, il passait par Steam)', () => {
  assert.equal(steam.isKaneMode('C:\\Windows\\explorer.exe', 'shell:AppsFolder\\KaneMode_7gtma5f85sgk8!App'), true);
  assert.equal(steam.isKaneMode('D:\\Apps\\KaneMode.exe', ''), true);
  assert.equal(steam.isKaneMode('D:\\Games\\Hades.exe', ''), false);
});

test('Moteur : Select + Start va au PC, menu par LB + RB + Select + Start, rien de retenu ne revient par la fusion', () => {
  const cpp = read('engine', 'KanePlay', 'app', 'streaming', 'input', 'gamepad.cpp');
  assert.ok(!cpp.includes('menuComboArmed'), 'plus de menu sur Select + Start');
  assert.match(cpp, /#define MENU_COMBO_FLAGS \(COMBO_BASE_FLAGS \| PLAY_FLAG\)/);
  assert.match(cpp, /if \(state->buttons == MENU_COMBO_FLAGS\)/);
  assert.match(cpp, /&m_GamepadState\[i\] == state \? ownButtons/, 'la fusion ne remet pas les boutons retenus');
  assert.match(cpp, /!state->startChord &&/, 'pas de mode souris avec Select + Start');
  assert.match(read('engine', 'KanePlay', 'app', 'gui', 'StreamSegue.qml'), /LB\+RB\+Select\+Start opens the menu/);
});

test('PC hôte : pas de mode souris par Start avec un autre bouton, ni pendant un jeu d’émulateur', () => {
  const nav = read('ui', 'js', 'nav.js');
  assert.match(nav, /chord: down\.size > 1/);
  assert.match(nav, /!startAt\[id\]\.chord && mouseMode\.on/);
  assert.match(read('native', 'KaneMode.App', 'XInputPads.cs'), /\(_mouse \|\| !QuitArmed\)\) CheckHold\(t\);/);
  assert.match(read('ui', 'js', 'pages', 'game.js'), /launch\(g, \{ stream: true \}\)/, 'manette virtuelle attendue');
});
