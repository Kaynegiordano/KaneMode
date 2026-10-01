// Vérifications isolées : aucune connexion réseau, installation ou modification du système.
// Lancer : node --test tools/verify-optimizations.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { Writable } = require('node:stream');
const root = path.join(__dirname, '..');
function load(file, fetch, dependencies = {}) {
  const module = { exports: {} };
  const localRequire = id => dependencies[id] || require(id);
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'),
    { module, exports: module.exports, require: localRequire, fetch, Buffer, process, URL, AbortSignal });
  return module.exports;
}

test('SteamGridDB partage les recherches et les pages, puis peut être actualisé', async () => {
  let calls = 0;
  const sgdb = load('host/lib/sgdb.js', async (url, init) => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    const data = url.includes('autocomplete') ? [{ id: 12, name: 'Hades' }] : {
      limit: 48, assets: Array.from({ length: 48 }, (_, i) => ({
        id: JSON.parse(init.body).page * 48 + i + 1, width: 600, height: 900,
        url: 'https://cdn.steamgriddb.com/test.jpg',
      })),
    };
    return { status: 200, json: async () => ({ success: true, data }) };
  });
  await Promise.all(Array.from({ length: 10 }, () => sgdb.search(null, 'Hades')));
  assert.equal(calls, 1);
  assert.equal((await sgdb.assets(null, 12, 'portrait', { firstPage: true })).length, 48);
  assert.equal(calls, 2);
  assert.equal((await sgdb.assets(null, 12, 'portrait')).length, 144);
  assert.equal(calls, 4); // La page déjà lue n'est pas redemandée.
  sgdb.forget(12);
  await sgdb.assets(null, 12, 'portrait', { firstPage: true });
  assert.equal(calls, 5);
});

test('SteamGridDB permet un nouvel essai après une panne et après actualisation en cours', async () => {
  let calls = 0;
  const failure = load('host/lib/sgdb.js', async () => { calls++; throw new Error('hors ligne'); });
  await Promise.all(Array.from({ length: 6 }, () => failure.search(null, 'Test').catch(() => null)));
  assert.equal(calls, 1);
  await assert.rejects(() => failure.search(null, 'Test'));
  assert.equal(calls, 2);
  const replies = [];
  const sgdb = load('host/lib/sgdb.js', () => new Promise(resolve => replies.push(resolve)));
  const old = sgdb.assets(null, 12, 'portrait', { firstPage: true });
  await new Promise(resolve => setImmediate(resolve));
  sgdb.forget(12);
  const fresh = sgdb.assets(null, 12, 'portrait', { firstPage: true });
  await new Promise(resolve => setImmediate(resolve));
  const reply = id => ({ status: 200, json: async () => ({ success: true, data: {
    limit: 48, assets: [{ id, width: 600, height: 900, url: 'https://cdn.steamgriddb.com/test.jpg' }],
  } }) });
  replies[1](reply(2)); await fresh;
  replies[0](reply(1)); await old;
  assert.equal((await sgdb.assets(null, 12, 'portrait', { firstPage: true }))[0].id, 2);
});

test('La mise à jour utilise les octets reçus, vérifie SHA-256 et remonte les erreurs disque', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-verification-'));
  const data = Buffer.alloc(53217, 123);
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  const latest = { version: '3.2.0', msix: { name: 'fixture.msix', url: 'https://github.com/example/fixture.msix', size: 100000000 }, sums: 'https://github.com/example/SHA256SUMS' };
  const fakeFetch = sum => async url => url.endsWith('SHA256SUMS') ? { text: async () => sum + '  fixture.msix' } : new Response(data, { headers: { 'content-length': String(data.length) } });
  const dependencies = { os: { tmpdir: () => directory } };
  try {
    const job = load('host/lib/update.js', fakeFetch(hash), dependencies).job();
    await job.download(latest);
    assert.equal(job.state.phase, 'ready');
    assert.equal(job.state.total, data.length);
    assert.equal(job.state.received, data.length);
    assert.equal(fs.readFileSync(job.state.file).length, data.length);
    const corrupt = load('host/lib/update.js', fakeFetch('0'.repeat(64)), dependencies).job();
    await assert.rejects(() => corrupt.download(latest), /SHA-256/);
    assert.equal(corrupt.state.phase, 'error');
    const failedDisk = { ...fs, createWriteStream: () => new Writable({ write(chunk, encoding, callback) { callback(new Error('Disque plein')); } }) };
    const full = load('host/lib/update.js', fakeFetch(hash), { ...dependencies, fs: failedDisk }).job();
    await assert.rejects(() => full.download(latest), /Disque plein/);
    assert.equal(full.state.phase, 'error');
  } finally {
    // Ne supprimer que le dossier temporaire créé par cette vérification.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('kanemode-verification-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Les tailles conservent leur précision en octets, Ko, Mo et Go', () => {
  const source = fs.readFileSync(path.join(root, 'ui/js/core.js'), 'utf8');
  const method = source.match(/  size\(b\) \{([\s\S]*?)\n  \},/)[0];
  const format = vm.runInNewContext('({' + method + '})', { t: text => text, locale: 'fr-FR' }).size;
  assert.equal(format(0), '0 octets');
  assert.equal(format(53217), '53,22 Ko');
  assert.equal(format(117845231), '117,85 Mo');
  assert.equal(format(1217845231), '1,22 Go');
  assert.equal(format(undefined), '—');
});
