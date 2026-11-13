// Tests du HDR automatique (host/lib/autohdr.js) avec un faux écran et de faux programmes.
//   node --test tools/verify-autohdr.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const autohdr = require('../host/lib/autohdr.js');

function setup({ cfg = {}, screen = 0, procs = [], games = [] } = {}) {
  const env = { cfg, screen, procs, games, log: [] };
  env.ctl = autohdr.create({
    read: () => JSON.parse(JSON.stringify(env.cfg)),
    write: c => { env.cfg = c; },
    hdr: async () => env.screen,
    setHdr: async on => { env.screen = on ? 1 : 0; env.log.push(on ? 'on' : 'off'); },
    paths: async () => env.procs,
    games: async () => env.games,
  });
  return env;
}
const game = { id: 'steam:1', name: 'Jeu', type: 'game', source: 'steam' };

test('jeu lancé par KaneMode : HDR puis SDR', async () => {
  const e = setup();
  await e.ctl.started(game);
  assert.strictEqual(e.screen, 1);
  assert.strictEqual(e.cfg.autoHdrOwned, true);
  await e.ctl.ended(game.id);
  assert.strictEqual(e.screen, 0);
  assert.deepStrictEqual(e.log, ['on', 'off']);
});

test('HDR déjà allumé par l’utilisateur : jamais coupé', async () => {
  const e = setup({ screen: 1 });
  await e.ctl.started(game);
  await e.ctl.ended(game.id);
  assert.strictEqual(e.screen, 1);
  assert.deepStrictEqual(e.log, []);
});

test('sans écran HDR : rien', async () => {
  const e = setup({ screen: -1 });
  await e.ctl.started(game);
  assert.deepStrictEqual(e.log, []);
});

test('réglage coupé, application, choix par jeu', async () => {
  let e = setup({ cfg: { autoHdr: { games: false } } });
  await e.ctl.started(game);
  assert.deepStrictEqual(e.log, []);
  e = setup({ cfg: { autoHdr: { games: false }, gameHdr: { 'steam:1': 'on' } } });
  await e.ctl.started(game);
  assert.deepStrictEqual(e.log, ['on']);
  e = setup({ cfg: { gameHdr: { 'steam:1': 'off' } } });
  await e.ctl.started(game);
  assert.deepStrictEqual(e.log, []);
  e = setup();
  await e.ctl.started({ ...game, id: 'x', type: 'app' });
  await e.ctl.started({ ...game, id: 'kaneplay', source: 'kaneplay' });
  assert.deepStrictEqual(e.log, []);
});

test('jeu ouvert ailleurs, lecteur vidéo, OBS', async () => {
  const e = setup({ cfg: { autoHdr: { outside: true, videos: true } }, games: [{ id: 'g', name: 'Jeu', dir: 'D:\\Jeux\\Elden Ring' }] });
  e.procs = ['C:\\Windows\\explorer.exe', 'D:\\Jeux\\Elden Ring\\Game\\eldenring.exe'];
  await e.ctl.poll();
  assert.strictEqual(e.screen, 1);
  e.procs.push('C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe');
  await e.ctl.poll();
  assert.strictEqual(e.screen, 0, 'OBS met en pause');
  e.procs = ['C:\\Program Files\\VideoLAN\\VLC\\vlc.exe'];
  await e.ctl.poll();
  assert.strictEqual(e.screen, 1, 'vidéo');
  e.procs = [];
  await e.ctl.poll();
  assert.strictEqual(e.screen, 0);
  assert.ok(!e.cfg.autoHdrOwned);
});

test('dossier voisin au nom proche : pas confondu', async () => {
  const e = setup({ cfg: { autoHdr: { outside: true } }, games: [{ id: 'g', name: 'Jeu', dir: 'D:\\Jeux\\Halo' }] });
  e.procs = ['D:\\Jeux\\Halo Infinite\\halo.exe'];
  await e.ctl.poll();
  assert.deepStrictEqual(e.log, []);
});

test('hôte relancé avec le HDR allumé par KaneMode et plus rien d’ouvert : SDR', async () => {
  const e = setup({ cfg: { autoHdrOwned: true }, screen: 1 });
  assert.ok(e.ctl.needsPoll());
  await e.ctl.poll();
  assert.strictEqual(e.screen, 0);
});

test('dossiers suivis : jeux seulement, jamais une bibliothèque entière', () => {
  const list = autohdr.trackable([
    { id: 'a', type: 'game', dir: 'D:\\SteamLibrary\\steamapps\\common\\Hades' },
    { id: 'b', type: 'game', dir: 'D:\\SteamLibrary\\steamapps\\common' },
    { id: 'c', type: 'game', dir: 'C:\\Jeux' },
    { id: 'd', type: 'app', dir: 'C:\\Program Files\\Steam' },
    { id: 'e', type: 'game', dir: 'D:\\Jeux\\Rom', source: 'rom' },
    { id: 'f', type: 'game', dir: 'D:\\Jeux\\Celeste', installed: false },
  ]);
  assert.deepStrictEqual(list.map(g => g.id), ['a']);
});

test('émulation reconnue : ROM, émulateur par son programme ou son nom, sans confondre les jeux', () => {
  const isEmu = autohdr.emulationTest([/^retroarch\.exe$/i]);
  assert.strictEqual(isEmu({ id: 'rom:1', source: 'rom', name: 'Zelda' }), true);
  assert.strictEqual(isEmu({ id: 'steam:2', source: 'steam', name: 'RetroArch' }), true);
  assert.strictEqual(isEmu({ id: 'custom:3', source: 'custom', name: 'X', launch: { kind: 'exe', target: 'D:\\Emu\\retroarch.exe' } }), true);
  assert.strictEqual(isEmu({ id: 'custom:4', source: 'custom', name: 'Dolphin Emulator' }), true);
  for (const name of ['Ecco the Dolphin', 'Garden of Eden', 'Hades II']) assert.strictEqual(isEmu({ id: 'x', source: 'steam', name }), false, name);
});

test('« Exclure l’émulation » (par défaut) : ni ROM ni émulateur en HDR, sauf « Toujours » pour ce jeu', async () => {
  const rom = { id: 'rom:1', name: 'Zelda', type: 'game', source: 'rom' };
  const steamEmu = { id: 'steam:9', name: 'RetroArch', type: 'game', source: 'steam' };
  const e = setup();
  await e.ctl.started(rom);
  await e.ctl.started(steamEmu);
  assert.strictEqual(e.screen, 0);
  e.cfg.gameHdr = { 'rom:1': 'on' };
  await e.ctl.started(rom);
  assert.strictEqual(e.screen, 1, 'le choix du jeu passe avant l’exclusion');
  await e.ctl.ended(rom.id);
  assert.strictEqual(e.screen, 0);
});

test('« Exclure l’émulation » coupé : l’émulation suit le réglage des jeux', async () => {
  const e = setup({ cfg: { autoHdr: { noEmulation: false } } });
  await e.ctl.started({ id: 'rom:1', name: 'Zelda', type: 'game', source: 'rom' });
  assert.strictEqual(e.screen, 1);
  e.cfg.gameHdr = { 'rom:2': 'off' };
  await e.ctl.started({ id: 'rom:2', name: 'Mario', type: 'game', source: 'rom' });
  assert.deepStrictEqual(e.ctl.state().active, ['Zelda']);
});

test('émulateur de la bibliothèque ouvert ailleurs : ignoré tant que l’émulation est exclue', async () => {
  const emu = { id: 'steam:9', name: 'RetroArch', dir: 'D:\\Steam\\steamapps\\common\\RetroArch', emulation: true };
  const procs = ['D:\\Steam\\steamapps\\common\\RetroArch\\retroarch.exe'];
  const e = setup({ cfg: { autoHdr: { outside: true } }, procs, games: [emu] });
  await e.ctl.poll();
  assert.strictEqual(e.screen, 0);
  e.cfg.autoHdr.noEmulation = false;
  await e.ctl.poll();
  assert.strictEqual(e.screen, 1);
});

test('dossiers suivis : l’émulation y est marquée', () => {
  const [g] = autohdr.trackable([{ id: 'a', type: 'game', dir: 'D:\\Jeux\\RetroArch', source: 'steam', emulation: true }]);
  assert.strictEqual(g.emulation, true);
});
