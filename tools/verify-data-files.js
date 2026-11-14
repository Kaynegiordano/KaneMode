'use strict';
// 4.36 : fichiers de données écrits sans risque (host/lib/jsonfile.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJson, writeJson } = require('../host/lib/jsonfile');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-json-'));
const file = name => path.join(dir, name);

test('Écriture puis lecture, sans fichier temporaire laissé', () => {
  const f = file('a.json');
  writeJson(f, { a: 1 });
  assert.deepEqual(readJson(f, null), { a: 1 });
  assert.equal(fs.existsSync(f + '.tmp'), false);
});

test('Fichier absent : valeur par défaut', () => {
  assert.deepEqual(readJson(file('absent.json'), { d: true }), { d: true });
});

test('Fichier tronqué : la copie de secours sert à sa place', () => {
  const f = file('b.json');
  writeJson(f, { version: 1 });
  writeJson(f, { version: 2 }); // la première écriture n'avait rien à sauvegarder ; pas de seconde copie avant dix minutes
  fs.writeFileSync(f + '.bak', JSON.stringify({ version: 1 }));
  fs.writeFileSync(f, '{"version": 2, "re');
  const errors = [];
  const original = console.error;
  console.error = m => errors.push(m);
  try { assert.deepEqual(readJson(f, {}), { version: 1 }); } finally { console.error = original; }
  assert.equal(errors.length, 1, 'la lecture de secours est signalée dans le journal');
});

test('Fichier tronqué sans copie de secours : valeur par défaut', () => {
  const f = file('c.json');
  fs.writeFileSync(f, '{"x":');
  assert.deepEqual(readJson(f, { vide: true }), { vide: true });
});

test('La copie de secours garde la version précédente, jamais un fichier abîmé', () => {
  const f = file('d.json');
  fs.writeFileSync(f, JSON.stringify({ avant: true }));
  writeJson(f, { apres: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(f + '.bak', 'utf8')), { avant: true });
  const g = file('e.json');
  fs.writeFileSync(g + '.bak', JSON.stringify({ bon: true }));
  fs.writeFileSync(g, '{"abî');
  writeJson(g, { neuf: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(g + '.bak', 'utf8')), { bon: true });
  assert.deepEqual(readJson(g, null), { neuf: true });
});

test('Marque d’ordre des octets en tête (fichier écrit par PowerShell) : lue quand même', () => {
  const f = file('f.json');
  fs.writeFileSync(f, String.fromCharCode(0xFEFF) + '{"ok":true}');
  assert.deepEqual(readJson(f, null), { ok: true });
});
