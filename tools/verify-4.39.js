'use strict';
// 4.39 : idées tirées de SteamOS — images/s mesurées par jeu, limites accordées à l'écran, succès
// Steam lus dans le cache de Steam, écran de veille, HDR du streaming (tests dans verify-autohdr.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fpsStats = require('../host/lib/fps-stats');
const pacing = require('../host/lib/frame-pacing');
const achievements = require('../host/lib/steam-achievements');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('Images/s par jeu : moyenne par mode, au moins une minute de mesures, plus bas par minute', () => {
  let clock = 0, saved = null;
  const s = fpsStats.create({ read: () => null, write: d => { saved = JSON.parse(JSON.stringify(d)); }, now: () => clock });
  for (let i = 0; i < 24; i++) { s.record('steam:1', 'performance', i < 12 ? 60 : 40); clock += 5000; }
  for (let i = 0; i < 5; i++) s.record('steam:1', 'eco', 30); // trop peu : pas affiché
  s.record('steam:1', 'performance', 0); // pas de mesure (aucun jeu 3D devant)
  s.flush();
  const r = s.summary('steam:1');
  assert.deepEqual(r.modes.map(m => [m.mode, m.avg]), [['performance', 50]]);
  assert.equal(r.modes[0].samples, 24);
  assert.ok(saved && saved['steam:1'].performance.n === 24, 'écrit sur disque');
  assert.deepEqual(s.summary('inconnu'), { modes: [], at: null });
});

test('Limites accordées à l’écran : diviseurs de la fréquence, sinon une fréquence qui convient', () => {
  // ROG Ally X : 60 et 120 Hz
  assert.deepEqual(pacing.alignedLimits([60, 120], 120), [{ fps: 30, hz: 120 }, { fps: 40, hz: 120 }, { fps: 60, hz: 120 }, { fps: 120, hz: 120 }]);
  // Écran à 60 Hz en ce moment : 40 i/s demande de passer à 120 Hz
  assert.deepEqual(pacing.alignedLimits([60, 120], 60).find(l => l.fps === 40), { fps: 40, hz: 120 });
  assert.equal(pacing.alignedLimits([60, 120], 120).some(l => l.fps === 45), false, '45 i/s saccade sur 120 Hz');
  // Écran inconnu : l'ancienne liste, sans fréquence
  assert.deepEqual(pacing.alignedLimits([], null)[0], { fps: 30, hz: null });
});

// Faux cache de Steam (KeyValues binaire)
const kv = obj => {
  const parts = [];
  const str = s => Buffer.concat([Buffer.from(String(s), 'utf8'), Buffer.from([0])]);
  const walk = o => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') { parts.push(Buffer.from([0]), str(k)); walk(v); parts.push(Buffer.from([8])); }
      else if (typeof v === 'number') { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(Buffer.from([2]), str(k), b); }
      else parts.push(Buffer.from([1]), str(k), str(v));
    }
  };
  walk(obj);
  parts.push(Buffer.from([8]));
  return Buffer.concat(parts);
};

test('Succès Steam : noms en français, débloqués d’abord (récents en tête), succès caché gardé secret', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-steam-'));
  const dir = path.join(root, 'appcache', 'stats');
  fs.mkdirSync(dir, { recursive: true });
  const ach = (name, fr, extra = {}) => ({ name, display: { name: { english: name, french: fr }, desc: { english: 'Do it', french: 'Fais-le' }, hidden: 0, icon: name + '.jpg', icon_gray: name + '_g.jpg', ...extra } });
  fs.writeFileSync(path.join(dir, 'UserGameStatsSchema_42.bin'), kv({ 42: { stats: { 1: { bits: {}, type: 'ACHIEVEMENTS' }, 2: { bits: {
    0: ach('A', 'Premier pas'), 1: ach('B', 'Deuxième'), 2: ach('C', 'Secret', { hidden: 1 }), 3: ach('D', 'Plus tard'),
  } } } } }));
  // bits 0 et 1 débloqués, le 1 plus récemment
  fs.writeFileSync(path.join(dir, 'UserGameStats_777_42.bin'), kv({ cache: { 2: { data: 3, AchievementTimes: { 0: 1700000000, 1: 1800000000 } } } }));
  const r = achievements.read(root, 42, 'fr');
  assert.equal(r.total, 4);
  assert.equal(r.unlocked, 2);
  assert.deepEqual(r.list.map(a => a.name), ['Deuxième', 'Premier pas', 'Plus tard', null]);
  assert.equal(r.list[0].desc, 'Fais-le');
  assert.match(r.list[0].icon, /\/apps\/42\/B\.jpg$/);
  assert.match(r.list[2].icon, /D_g\.jpg$/, 'pas débloqué : icône grise');
  assert.equal(r.list[3].hidden, true);
  assert.equal(achievements.read(root, 43, 'fr'), null, 'jeu sans succès');
});

test('Écran de veille : délai réglable, premier bouton sans effet, veille qui prend la suite', () => {
  const power = read('ui', 'js', 'power.js');
  assert.match(power, /if \(ssSec && idle >= ssSec && \(!sleepSec \|\| idle < sleepSec - 20\)\) showScreensaver\(\);/);
  assert.match(power, /if \(screensaverShown\(\)\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\(\); \}/);
  assert.match(power, /hideScreensaver\(\{ keepLock: true \}\)/);
  assert.match(read('ui', 'js', 'core.js'), /screensaverAfter: 3/);
});

test('Streaming : le moteur prévient KaneMode (session, HDR), l’app relaie à l’hôte', () => {
  const session = read('engine', 'KanePlay', 'app', 'streaming', 'session.cpp');
  assert.match(session, /KaneModeBridge::notify\(enabled \? QStringLiteral\("hdr\\t1"\)/);
  assert.equal((session.match(/KaneModeBridge::notify\(QStringLiteral\("stream\\t0"\)\)/g) || []).length, 2, 'fin de session et échec de connexion');
  assert.match(read('native', 'KaneMode.App', 'MainWindow.xaml.cs'), /_host\.PostQuiet\("\/api\/hdr\/stream"/);
});
