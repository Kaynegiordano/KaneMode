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

// Lanceur ordinaire hors du paquet (4.31.2 : Sunshine ne pouvait pas lancer l'alias du paquet dans son job)
const LAUNCH = { exe: 'C:\\Users\\X\\AppData\\Local\\KaneMode\\bin\\KaneModeStream.exe', aumid: 'KaneMode_7gtma5f85sgk8!App' };

test('Appli Sunshine d’un jeu : petit lanceur hors du paquet, fermeture en fin de session, jaquette', () => {
  const a = sg.appFor('rom:68e9be5f8be9', 'Zelda', 'C:\\x\\z.png', LAUNCH);
  assert.equal(a.name, 'Zelda');
  assert.equal(a.cmd, '"C:\\Users\\X\\AppData\\Local\\KaneMode\\bin\\KaneModeStream.exe" --stream-game "rom:68e9be5f8be9" --app "KaneMode_7gtma5f85sgk8!App"');
  assert.ok(!/WindowsApps/.test(a.cmd), 'jamais l’app du paquet (refusée dans le job de Sunshine)');
  assert.equal(a['working-dir'], 'C:\\Users\\X\\AppData\\Local\\KaneMode\\bin');
  assert.match(a['prep-cmd'][0].undo, /--stop-game "rom:68e9be5f8be9" --app "KaneMode_7gtma5f85sgk8!App"$/);
  assert.equal(a['auto-detach'], false, 'le lanceur reste ouvert pendant la partie');
  assert.equal(a['image-path'], 'C:\\x\\z.png');
  assert.equal(sg.appFor('steam:1', 'X', null, LAUNCH)['image-path'], undefined);
});

test('Fusion : applis de l’utilisateur gardées (variantes d’échelle comprises), jeux remplacés, noms uniques', () => {
  const doc = { env: {}, apps: [
    { name: 'Desktop', 'image-path': 'desktop.png' },
    { name: 'Desktop [150 %]', 'image-path': 'desktop.png' },
    sg.appFor('steam:9', 'Ancien jeu', null, LAUNCH),
    // Jeu publié par la 4.30–4.31.1 (alias du paquet) : remplacé aussi
    { name: 'Vieux Zelda', cmd: '"C:\\Users\\X\\AppData\\Local\\Microsoft\\WindowsApps\\KaneMode.exe" --stream-game "rom:1"' },
  ] };
  const out = sg.merge(doc, [
    { id: 'steam:1', name: 'Hades', source: 'steam' },
    { id: 'epic:1', name: 'Hades', source: 'epic' },
    { id: 'rom:1', name: 'Desktop', source: 'rom' },
  ], LAUNCH);
  assert.deepEqual(out.env, {});
  const names = out.apps.map(a => a.name);
  assert.deepEqual(names, ['Desktop', 'Desktop [150 %]', 'Hades', 'Hades (epic)', 'Desktop (rom)']);
  assert.ok(!names.includes('Ancien jeu'), 'jeu retiré de la bibliothèque : retiré de Sunshine');
  assert.ok(!names.includes('Vieux Zelda'));
  assert.equal(sg.merge(doc, [], LAUNCH).apps.length, 2, 'désactivé : seulement les applis de l’utilisateur');
});

test('Streaming en cours lu dans le journal de Sunshine (mise à jour remise à plus tard)', () => {
  const d = tmp(), log = path.join(d, 'sunshine.log');
  fs.writeFileSync(log, '[a]: Info: CLIENT CONNECTED\n[b]: Info: CLIENT DISCONNECTED\n');
  assert.equal(sg.streamActive(log), false);
  fs.appendFileSync(log, '[c]: Info: CLIENT CONNECTED\n');
  assert.equal(sg.streamActive(log), true);
  // Partie terminée par la fermeture du jeu : Sunshine n'écrit pas « CLIENT DISCONNECTED »
  fs.appendFileSync(log, '[d]: Info: App exited with code [0]\n[e]: Info: Process terminated\n');
  assert.equal(sg.streamActive(log), false);
  assert.equal(sg.streamActive(path.join(d, 'absent.log')), false);
});

test('Synchronisation : pendant un streaming rien n’est écrit ; liste inchangée = pas de réécriture', async () => {
  const d = tmp(), apps = path.join(d, 'apps.json');
  fs.writeFileSync(apps, JSON.stringify({ env: {}, apps: [{ name: 'Desktop' }] }));
  fs.writeFileSync(path.join(d, 'sunshine.log'), 'CLIENT CONNECTED\n'); // streaming en cours
  const lib = sg.create({ appsFile: () => apps, root: d, coversDir: path.join(d, 'covers'), runPs: async () => ({}), log: () => {}, launch: LAUNCH });
  const r = await lib.sync([{ id: 'steam:1', name: 'Hades', source: 'steam', art: null }]);
  assert.equal(r.waiting, 'stream', 'pendant un streaming : attente, fichier intact');
  assert.equal(JSON.parse(fs.readFileSync(apps, 'utf8')).apps.length, 1);
  // Même liste déjà en place : rien à faire, même pendant un streaming
  fs.writeFileSync(apps, JSON.stringify(sg.merge({ env: {}, apps: [{ name: 'Desktop' }] }, [{ id: 'steam:1', name: 'Hades', source: 'steam' }], LAUNCH), null, 2));
  const r2 = await lib.sync([{ id: 'steam:1', name: 'Hades', source: 'steam', art: null }]);
  assert.equal(r2.changed, false);
});

test('4.31.1 : la liste est écrite sans rien créer dans le dossier de Sunshine (seul apps.json est autorisé)', async () => {
  const d = tmp(), cfgDir = path.join(d, 'Sunshine', 'config'), data = path.join(d, 'data');
  fs.mkdirSync(cfgDir, { recursive: true });
  const apps = path.join(cfgDir, 'apps.json');
  fs.writeFileSync(apps, JSON.stringify({ env: {}, apps: [{ name: 'Desktop' }] }));
  fs.writeFileSync(path.join(cfgDir, 'sunshine.log'), 'CLIENT CONNECTED\nCLIENT DISCONNECTED\n');
  let restarted = 0;
  const lib = sg.create({ appsFile: () => apps, root: d, coversDir: path.join(data, 'sunshine-covers'), runPs: async () => ({}), log: () => {}, restart: async () => { restarted++; }, launch: LAUNCH });
  const r = await lib.sync([{ id: 'rom:1', name: 'Zelda', source: 'rom', art: null }]);
  assert.equal(r.changed, true, r.error);
  assert.equal(restarted, 1, 'Sunshine redémarré une fois');
  assert.deepEqual(fs.readdirSync(cfgDir).sort(), ['apps.json', 'sunshine.log'], 'rien de nouveau dans le dossier de Sunshine');
  assert.ok(fs.existsSync(path.join(data, 'sunshine-apps.avant-jeux-kanemode.json')), 'copie de sécurité chez KaneMode');
  assert.deepEqual(JSON.parse(fs.readFileSync(apps, 'utf8')).apps.map(a => a.name), ['Desktop', 'Zelda']);
  assert.equal((await lib.sync([{ id: 'rom:1', name: 'Zelda', source: 'rom', art: null }])).changed, false);
  assert.equal(restarted, 1, 'pas de redémarrage quand rien ne change');
});

test('Hors de l’app installée (pas de lanceur) : rien n’est écrit', async () => {
  const d = tmp(), apps = path.join(d, 'apps.json');
  fs.writeFileSync(apps, JSON.stringify({ env: {}, apps: [] }));
  const lib = sg.create({ appsFile: () => apps, root: d, coversDir: path.join(d, 'covers'), runPs: async () => ({}), log: () => {}, restart: async () => { throw new Error('jamais'); } });
  const saved = process.env.KANEMODE_AUMID;
  delete process.env.KANEMODE_AUMID;
  try { assert.equal((await lib.sync([{ id: 'rom:1', name: 'Zelda', source: 'rom', art: null }])).skipped, 'no-launcher'); }
  finally { if (saved !== undefined) process.env.KANEMODE_AUMID = saved; }
});

test('Console : variantes d’échelle cachées, jaquette lue dans le cache du moteur', () => {
  assert.equal(kaneplay.isScaleVariant('Desktop [150 %]'), true);
  assert.equal(kaneplay.isScaleVariant('Zelda'), false);
  assert.equal(kaneplay.boxArt('00000000-absent', 1), null);
});

test('Serveur, interface, moteur et lanceur branchés', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const srv = read('host/server.js');
  assert.ok(srv.includes('...streamShortcutEntries()'), 'raccourcis dans la bibliothèque');
  assert.ok(srv.includes("env: kaneplay.env(`stream\\t${s.host}\\t${s.app}\\t${s.name}`"), 'Jouer = streaming direct de l’appli');
  assert.ok(srv.includes("'POST /api/stream/sunshine-games'"));
  assert.ok(read('ui/js/cards.js').includes("'badge-stream'"), 'logo dans le coin');
  assert.ok(read('ui/index.html').includes('id="i-stream"'));
  assert.ok(read('ui/js/pages/game.js').includes("m.type !== 'stream-launch'"), 'le PC lance le jeu demandé par Sunshine');
  const launcher = read('native/KaneMode.Stream/KaneModeStream.cs');
  assert.ok(launcher.includes('"\\\\AppContainerNamedObjects\\\\"'), 'canal du widget, même nom que WidgetBridge');
  assert.ok(read('native/build.ps1').includes('KaneModeStream.exe'), 'lanceur compilé dans le paquet');
  // Même fichier d'une version à l'autre (sinon Defender l'analyse à chaque mise à jour : 15 s d'attente)
  const sum = require('crypto').createHash('sha256').update(Buffer.from(launcher.replace(/\r/g, ''), 'utf8')).digest('hex');
  assert.equal(read('native/KaneMode.Stream/KaneModeStream.sha256').trim(), sum, 'lanceur du dépôt à jour avec sa source (lancer native/build.ps1)');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'native/KaneMode.Stream/KaneModeStream.exe')));
  assert.ok(read('setup/hote-echelle/Installer.ps1').includes("-match '--stream-game'"), 'pas de variantes d’échelle pour les jeux');
  assert.ok(read('engine/KanePlay/app/gui/main.qml').includes('returnAfterStream'), 'retour à KaneMode après la partie');
});
