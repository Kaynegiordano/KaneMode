'use strict';
// 4.35 : dernier jeu streamé proposé par la tuile « Reprendre » de l'accueil (fichier écrit par le
// moteur en fin de session), rattaché à son raccourci s'il en a un.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const kaneplay = require('../host/lib/kaneplay');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-resume-'));
const write = (name, data) => { const f = path.join(dir, name); fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data)); return f; };
const HOSTS = [{ uuid: 'PC-1', name: 'Tour', paired: true }, { uuid: 'PC-2', name: 'Salon', paired: false }];

test('Fichier du moteur : lu tel quel, refusé s’il est incomplet ou illisible', () => {
  const ok = kaneplay.lastSession(write('ok.json', { host: 'PC-1', appId: 42, appName: 'Hades II', endedAt: 1763000000000, durationSecs: 1800, issues: ['loss'] }));
  assert.deepEqual(ok, { host: 'PC-1', app: 42, name: 'Hades II', endedAt: 1763000000000, seconds: 1800, issues: ['loss'], recent: [] });
  assert.equal(kaneplay.lastSession(write('sans-appli.json', { host: 'PC-1', appName: 'Hades II' })), null);
  assert.equal(kaneplay.lastSession(write('casse.json', '{"host":')), null);
  assert.equal(kaneplay.lastSession(path.join(dir, 'absent.json')), null);
});

test('Variante d’échelle du bureau : jamais proposée (le moteur la choisit seul)', () => {
  assert.equal(kaneplay.lastSession(write('echelle.json', { host: 'PC-1', appId: 7, appName: 'Desktop [150 %]', endedAt: 1 })), null);
});

test('Jeu sans raccourci : proposé à part, date de partie en secondes', () => {
  const last = { host: 'PC-1', app: 42, name: 'Hades II', endedAt: 1763000000999 };
  assert.deepEqual(kaneplay.resumeFor(last, [], HOSTS), { host: 'PC-1', app: 42, name: 'Hades II', played: 1763000000 });
  assert.deepEqual(kaneplay.resumeFor(last, [{ host: 'PC-1', app: 7, name: 'Autre' }], HOSTS).name, 'Hades II');
});

test('Jeu qui a un raccourci : c’est le raccourci qui reçoit la date de la session', () => {
  const last = { host: 'PC-1', app: 42, name: 'Hades II', endedAt: 1763000000000 };
  assert.deepEqual(kaneplay.resumeFor(last, [{ host: 'PC-1', app: '42', name: 'Hades 2' }], HOSTS), { shortcut: 'stream:PC-1:42', played: 1763000000 });
});

test('PC retiré ou plus appairé, session sans date : rien à reprendre', () => {
  assert.equal(kaneplay.resumeFor({ host: 'PC-2', app: 1, name: 'X', endedAt: 5000 }, [], HOSTS), null);
  assert.equal(kaneplay.resumeFor({ host: 'PC-9', app: 1, name: 'X', endedAt: 5000 }, [], HOSTS), null);
  assert.equal(kaneplay.resumeFor({ host: 'PC-1', app: 1, name: 'X', endedAt: 0 }, [], HOSTS), null);
  assert.equal(kaneplay.resumeFor(null, [], HOSTS), null);
});

test('Interface : l’entrée hors bibliothèque reste invisible ailleurs que sur la tuile', () => {
  const core = fs.readFileSync(path.join(__dirname, '..', 'ui', 'js', 'core.js'), 'utf8');
  assert.match(core, /visible\(\) \{[^}]*!g\.resumeOnly/);
  assert.match(core, /resumable\(\) \{(?![^}]*resumeOnly)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'ui', 'js', 'pages', 'home.js'), 'utf8'), /resumeEntry\(lib\.resumable\(\), running\)/);
});

test('Temps de jeu : chaque session gardée par le moteur est comptée une fois, sous l’identifiant du raccourci', () => {
  const last = kaneplay.lastSession(write('suite.json', { host: 'PC-1', appId: 42, appName: 'Hades II', endedAt: 3000, durationSecs: 600, recent: [
    { host: 'PC-1', appId: 7, endedAt: 1000, durationSecs: 1200 },
    { host: 'PC-1', appId: 42, endedAt: 3000, durationSecs: 600 },
    { host: 'PC-1', appId: 9, endedAt: 2000, durationSecs: 0 },
    { appId: 3, endedAt: 2500, durationSecs: 60 },
  ] }));
  assert.deepEqual(kaneplay.sessionsSince(last, 0), [{ id: 'stream:PC-1:7', minutes: 20, endedAt: 1000 }, { id: 'stream:PC-1:42', minutes: 10, endedAt: 3000 }]);
  assert.deepEqual(kaneplay.sessionsSince(last, 1000).map(s => s.id), ['stream:PC-1:42']);
  assert.deepEqual(kaneplay.sessionsSince(last, 3000), []);
  assert.deepEqual(kaneplay.sessionsSince(null, 0), []);
});

test('Temps de jeu : fichier d’un moteur sans liste, la dernière session compte seule', () => {
  const last = kaneplay.lastSession(write('seule.json', { host: 'PC-1', appId: 42, appName: 'Hades II', endedAt: 5000, durationSecs: 90 }));
  assert.deepEqual(kaneplay.sessionsSince(last, undefined), [{ id: 'stream:PC-1:42', minutes: 1.5, endedAt: 5000 }]);
});

test('Hôte : un jeu streamé n’est plus chronométré par la durée du moteur, la limite du jeu passe avant la générale', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'host', 'server.js'), 'utf8');
  assert.match(server, /e\.source !== 'kaneplay' && e\.source !== 'stream' && m > 0\.2 && addMinutes/);
  assert.match(server, /const want = fpsScope\.front \? 0 : gameFpsLimit\(c\);/);
  assert.match(server, /if \(fpsScope\.game === id\) fpsScope\.game = null;/);
});
