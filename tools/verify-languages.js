// Langues et migration du stockage : essais isolés, sans navigateur ni système Windows.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function language(values = {}, languages = ['fr-FR']) {
  const storage = new Map(Object.entries(values));
  const code = fs.readFileSync(path.join(root, 'ui/js/i18n.js'), 'utf8').replace(/^export /gm, '').replaceAll('import.meta.url', '"http://localhost/js/i18n.js"');
  const result = await vm.runInNewContext('(async()=>{' + code + ';return {LANGS,lang,locale,t,systemLang};})()', {
    URL, Intl, navigator: { languages }, document: { documentElement: {} },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(root, 'ui/i18n', path.basename(url.pathname)), 'utf8')) }),
  });
  return { ...result, storage };
}
test('Seulement français et anglais, avec les formats et textes correspondants', async () => {
  const fr = await language(), en = await language({ 'km.settings': '{"lang":"en"}' });
  assert.deepEqual(Array.from(fr.LANGS, l => l[0]), ['fr', 'en']);
  assert.equal(fr.lang, 'fr'); assert.equal(fr.locale, 'fr-FR'); assert.equal(fr.t('Anglais'), 'Anglais');
  assert.equal(en.lang, 'en'); assert.equal(en.locale, 'en-US'); assert.equal(en.t('Anglais'), 'English');
  assert.deepEqual(fs.readdirSync(path.join(root, 'ui/i18n')), ['en.json']);
});
test('Une langue supprimée migre sans perdre les autres préférences', async () => {
  for (const old of ['de', 'es', 'it', 'pt', 'ja', 'zh']) {
    const r = await language({ 'km.settings': JSON.stringify({ lang: old, soundVolume: 42, homePins: [{ type: 'game', id: 'a' }] }) });
    const saved = JSON.parse(r.storage.get('km.settings'));
    assert.equal(r.lang, 'fr'); assert.equal(saved.lang, 'fr'); assert.equal(saved.soundVolume, 42);
    assert.deepEqual(saved.homePins, [{ type: 'game', id: 'a' }]);
  }
});
test('La langue Windows et celle du widget restent limitées aux deux langues', async () => {
  assert.equal((await language({}, ['en-GB'])).lang, 'en');
  assert.equal((await language({}, ['de-DE', 'fr-CA'])).lang, 'fr');
  assert.equal((await language({}, ['ja-JP'])).lang, 'en');
  const widget = await language({ 'km.lang': 'pt' }, ['en-US']);
  assert.equal(widget.lang, 'en'); assert.equal(widget.storage.get('km.lang'), 'en');
  assert.equal((await language({ 'km.lang': 'fr' }, ['en-US'])).lang, 'fr');
});
