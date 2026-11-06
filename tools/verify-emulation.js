'use strict';
// Émulation 4.13 : dossiers nommés comme la console, cœur RetroArch à télécharger, réglages
// fusionnés sans perdre ceux de l'utilisateur, BIOS et clés reconnus.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const emu = require('../host/lib/emulation');
const setup = require('../host/lib/emu-setup');
const store = require('../host/lib/emu-store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-emu-'));

test('Un dossier « Super Nintendo » est reconnu et RetroArch de KaneMode y prend son cœur au lancement', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'Super Nintendo'));
  fs.writeFileSync(path.join(root, 'Super Nintendo', 'Mon Jeu (Europe).sfc'), 'x');
  fs.mkdirSync(path.join(root, 'PlayStation 4', 'CUSA00001'), { recursive: true });
  fs.writeFileSync(path.join(root, 'PlayStation 4', 'CUSA00001', 'eboot.bin'), 'x');
  const ra = path.join(root, 'ra', 'retroarch.exe');
  fs.mkdirSync(path.dirname(ra));
  fs.writeFileSync(ra, '');
  const roms = emu.scanRoms([root], { retroarch: { path: ra, source: 'kanemode' } }, {});
  const snes = roms.find(r => r.system === 'snes');
  assert.equal(snes.name, 'Mon Jeu');
  assert.equal(snes.emulatorId, 'retroarch');
  assert.match(snes.launch.args, /cores\\snes9x_libretro\.dll/);
  const ps4 = roms.find(r => r.system === 'ps4');
  assert.ok(ps4 && !ps4.launch, 'jeu PS4 trouvé, émulateur pas encore installé');
});

test('Un RetroArch installé par l\'utilisateur sans le cœur n\'est pas choisi', () => {
  const sys = emu.SYSTEMS.find(s => s.id === 'snes');
  const ra = path.join(tmp(), 'retroarch.exe');
  fs.writeFileSync(ra, '');
  assert.equal(emu.launchFor(sys, 'x.sfc', { retroarch: { path: ra, source: 'auto' } }), null);
});

test('Les réglages écrits gardent ceux de l\'utilisateur', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.ini'), '[Main]\r\nTheme = darkfusion\r\n[Display]\r\nScale = 4\r\n');
  setup.prepare('duckstation', dir, { bios: 'C:\\B', saves: dir });
  const ini = fs.readFileSync(path.join(dir, 'settings.ini'), 'utf8');
  assert.match(ini, /Theme = darkfusion/);
  assert.match(ini, /Scale = 4/);
  assert.match(ini, /StartFullscreen = true/);
  assert.match(ini, /PowerOff = SDL-0\/Back & SDL-0\/Start/);
  assert.match(ini, /\[BIOS\]\r\nSearchDirectory = C:\\B/);
  fs.writeFileSync(path.join(dir, 'retroarch.cfg'), 'video_shader_enable = "true"\nvideo_fullscreen = "false"\n');
  setup.prepare('retroarch', dir, { bios: 'C:\\B', saves: dir });
  const cfg = fs.readFileSync(path.join(dir, 'retroarch.cfg'), 'utf8');
  assert.match(cfg, /video_shader_enable = "true"/);
  assert.match(cfg, /video_fullscreen = "true"/);
  assert.doesNotMatch(cfg, /video_fullscreen = "false"/);
});

test('BIOS PS2 de 4 Mo et clés de la Switch 2 copiées dans l\'émulateur', () => {
  const bios = tmp();
  assert.equal(setup.biosStatus(bios, 'ps2').ok, false);
  fs.writeFileSync(path.join(bios, 'scph39001.bin'), Buffer.alloc(4194304));
  assert.equal(setup.biosStatus(bios, 'ps2').ok, true);
  assert.equal(setup.biosStatus(bios, 'snes'), null);
  fs.mkdirSync(path.join(bios, 'Switch 2'));
  fs.writeFileSync(path.join(bios, 'Switch 2', 'prod.keys'), 'k');
  assert.equal(setup.biosStatus(bios, 'switch2').ok, true);
  const dir = tmp();
  setup.prepare('eglantine', dir, { bios, saves: dir });
  assert.ok(fs.existsSync(path.join(dir, 'user', 'keys', 'prod.keys')));
  setup.prepare('pcsx2', dir, { bios, saves: dir });
  assert.match(fs.readFileSync(path.join(dir, 'inis', 'PCSX2.ini'), 'utf8'), /BIOS = scph39001\.bin/);
});

test('Chaque console a un émulateur que KaneMode sait installer', () => {
  for (const s of emu.SYSTEMS) assert.ok(s.emus.some(e => store.CATALOG[e]), s.id);
});

test('Un jeu Master System en .zip est reconnu', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'Master System'));
  fs.writeFileSync(path.join(root, 'Master System', 'Sonic The Hedgehog (USA, Europe).zip'), 'x');
  const roms = emu.scanRoms([root], {}, {});
  assert.equal(roms.length, 1);
  assert.equal(roms[0].system, 'mastersystem');
  assert.equal(roms[0].name, 'Sonic The Hedgehog');
});

test('Même jeu en .zip et .sms : une seule entrée, le format natif', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'Master System'));
  for (const e of ['zip', 'sms']) fs.writeFileSync(path.join(root, 'Master System', `Sonic (Europe).${e}`), 'x');
  const roms = emu.scanRoms([root], {}, {});
  assert.equal(roms.length, 1);
  assert.match(roms[0].romPath, /\.sms$/);
});

test('Disques d\'un jeu PlayStation : une entrée et une liste .m3u', () => {
  const root = tmp(), m3uDir = tmp();
  fs.mkdirSync(path.join(root, 'PlayStation'));
  for (const n of [1, 2, 3]) fs.writeFileSync(path.join(root, 'PlayStation', `Final Fantasy VII (Europe) (Disc ${n}).chd`), 'x');
  const roms = emu.scanRoms([root], {}, {}, { m3uDir });
  assert.equal(roms.length, 1);
  assert.equal(roms[0].name, 'Final Fantasy VII');
  assert.equal(roms[0].discs, 3);
  const list = fs.readFileSync(roms[0].romPath, 'utf8').trim().split(/\r?\n/);
  assert.equal(list.length, 3);
  assert.match(list[2], /Disc 3\)\.chd$/);
});

test('Jaquette libretro : même jeu, région voulue, jamais une bêta', () => {
  const { bestMatch } = require('../host/lib/emu-meta');
  const names = ['Sonic The Hedgehog (USA, Europe, Brazil) (En)', 'Sonic The Hedgehog (Japan) (Beta)', 'Sonic Chaos (Europe, Brazil) (En)'];
  assert.equal(bestMatch('Sonic The Hedgehog (USA, Europe, Brazil) (En)', names), names[0]);
  assert.equal(bestMatch('Sonic The Hedgehog (Europe)', names), names[0]);
  assert.equal(bestMatch('Legend of Zelda, The - A Link to the Past (Europe)', ['Legend of Zelda, The - A Link to the Past (Europe)']), 'Legend of Zelda, The - A Link to the Past (Europe)');
  assert.equal(bestMatch('Ratchet & Clank (Europe)', ['Ratchet _ Clank (Europe)']), 'Ratchet _ Clank (Europe)');
  assert.equal(bestMatch('Inconnu (Europe)', names), null);
});
