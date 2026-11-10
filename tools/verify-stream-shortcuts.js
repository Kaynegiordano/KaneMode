'use strict';
// 4.30 : jeux d'un PC en raccourcis sur une console (Ally, PC portable) et jeux de KaneMode proposés
// par le PC qui diffuse (applis de Sunshine). Sans Sunshine réel : fichiers temporaires.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sg = require('../host/lib/sunshine-games');
const kaneplay = require('../host/lib/kaneplay');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-sg-'));

test('Appli Sunshine d’un jeu : lanceur KaneMode.exe, fermeture en fin de session, jaquette', () => {
  const a = sg.appFor('rom:68e9be5f8be9', 'Zelda', 'C:\\x\\z.png');
  assert.equal(a.name, 'Zelda');
  assert.match(a.cmd, /WindowsApps\\KaneMode\.exe" --stream-game "rom:68e9be5f8be9"$/);
  assert.match(a['prep-cmd'][0].undo, /--stop-game "rom:68e9be5f8be9"$/);
  assert.equal(a['auto-detach'], false, 'le lanceur reste ouvert pendant la partie');
  assert.equal(a['image-path'], 'C:\\x\\z.png');
  assert.equal(sg.appFor('steam:1', 'X', null)['image-path'], undefined);
});

test('Fusion : applis de l’utilisateur gardées (variantes d’échelle comprises), jeux remplacés, noms uniques', () => {
  const doc = { env: {}, apps: [
    { name: 'Desktop', 'image-path': 'desktop.png' },
    { name: 'Desktop [150 %]', 'image-path': 'desktop.png' },
    sg.appFor('steam:9', 'Ancien jeu', null),
  ] };
  const out = sg.merge(doc, [
    { id: 'steam:1', name: 'Hades', source: 'steam' },
    { id: 'epic:1', name: 'Hades', source: 'epic' },
    { id: 'rom:1', name: 'Desktop', source: 'rom' },
  ]);
  assert.deepEqual(out.env, {});
  const names = out.apps.map(a => a.name);
  assert.deepEqual(names, ['Desktop', 'Desktop [150 %]', 'Hades', 'Hades (epic)', 'Desktop (rom)']);
  assert.ok(!names.includes('Ancien jeu'), 'jeu retiré de la bibliothèque : retiré de Sunshine');
  assert.equal(sg.merge(doc, []).apps.length, 2, 'désactivé : seulement les applis de l’utilisateur');
});

test('Streaming en cours lu dans le journal de Sunshine (mise à jour remise à plus tard)', () => {
  const d = tmp(), log = path.join(d, 'sunshine.log');
  fs.writeFileSync(log, '[a]: Info: CLIENT CONNECTED\n[b]: Info: CLIENT DISCONNECTED\n');
  assert.equal(sg.streamActive(log), false);
  fs.appendFileSync(log, '[c]: Info: CLIENT CONNECTED\n');
  assert.equal(sg.streamActive(log), true);
  assert.equal(sg.streamActive(path.join(d, 'absent.log')), false);
});

test('Synchronisation : rien d’écrit sans autorisation ; liste inchangée = pas de réécriture', async () => {
  const d = tmp(), apps = path.join(d, 'apps.json');
  fs.writeFileSync(apps, JSON.stringify({ env: {}, apps: [{ name: 'Desktop' }] }));
  fs.writeFileSync(path.join(d, 'sunshine.log'), 'CLIENT CONNECTED\n'); // streaming en cours
  const lib = sg.create({ appsFile: () => apps, root: d, coversDir: path.join(d, 'covers'), runPs: async () => ({}), log: () => {} });
  const r = await lib.sync([{ id: 'steam:1', name: 'Hades', source: 'steam', art: null }]);
  assert.equal(r.waiting, 'stream', 'pendant un streaming : attente, fichier intact');
  assert.equal(JSON.parse(fs.readFileSync(apps, 'utf8')).apps.length, 1);
  // Même liste déjà en place : rien à faire, même pendant un streaming
  fs.writeFileSync(apps, JSON.stringify(sg.merge({ env: {}, apps: [{ name: 'Desktop' }] }, [{ id: 'steam:1', name: 'Hades', source: 'steam' }]), null, 2));
  const r2 = await lib.sync([{ id: 'steam:1', name: 'Hades', source: 'steam', art: null }]);
  assert.equal(r2.changed, false);
});

test('Console : variantes d’échelle cachées, jaquette lue dans le cache du moteur', () => {
  assert.equal(kaneplay.isScaleVariant('Desktop [150 %]'), true);
  assert.equal(kaneplay.isScaleVariant('Zelda'), false);
  assert.equal(kaneplay.boxArt('00000000-absent', 1), null);
});

test('Serveur, interface et moteur branchés', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const srv = read('host/server.js');
  assert.ok(srv.includes('...streamShortcutEntries()'), 'raccourcis dans la bibliothèque');
  assert.ok(srv.includes("env: kaneplay.env(`stream\\t${s.host}\\t${s.app}\\t${s.name}`"), 'Jouer = streaming direct de l’appli');
  assert.ok(srv.includes("'POST /api/stream/sunshine-games'"));
  assert.ok(read('ui/js/cards.js').includes("'badge-stream'"), 'logo dans le coin');
  assert.ok(read('ui/index.html').includes('id="i-stream"'));
  assert.ok(read('ui/js/pages/game.js').includes("m.type !== 'stream-launch'"), 'le PC lance le jeu demandé par Sunshine');
  assert.ok(read('native/package/AppxManifest.xml').includes('<uap5:ExecutionAlias Alias="KaneMode.exe" />'));
  assert.ok(read('native/KaneMode.App/App.xaml.cs').includes('StreamHelper.IsHelperCall(e.Args)'));
  assert.ok(read('setup/hote-echelle/Installer.ps1').includes("-match '--stream-game'"), 'pas de variantes d’échelle pour les jeux');
  assert.ok(read('engine/KanePlay/app/gui/main.qml').includes('returnAfterStream'), 'retour à KaneMode après la partie');
});
