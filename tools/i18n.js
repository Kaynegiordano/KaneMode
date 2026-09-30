#!/usr/bin/env node
// Traductions de KaneMode (voir ui/js/i18n.js). Le texte source est le français, écrit dans le code ;
// chaque langue a son dictionnaire ui/i18n/<langue>.json (texte français → traduction).
//
//   node tools/i18n.js           liste les textes (tools/i18n-keys.json) et ce qui manque par langue
//   node tools/i18n.js missing de   textes encore sans traduction allemande (JSON, pour les traduire)
//
// Textes relevés :
//   - interface : t('…'), tn(n, '…', '…') dans ui/js, et les textes écrits dans ui/*.html ;
//   - messages de l'hôte affichés par l'interface (tx) : erreurs de host/*.js, host/*.ps1 et des
//     outils graphiques C++ (native/KaneMode.Amd, native/KaneMode.Gpu). Leurs parties variables
//     (${…}, $x, %s…) deviennent {a}, {b}… ; tx() les reconnaît d'après ce modèle.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'ui', 'i18n');
const LANGS = ['en', 'es', 'de', 'it', 'pt', 'ja', 'zh'];
const walk = (dir, re) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? (['obj', 'bin', 'node_modules'].includes(d.name) ? [] : walk(p, re)) : re.test(d.name) ? [p] : [];
});
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');
const unq = s => s.replace(/\\(['"\\`])/g, '$1').replace(/\\n/g, '\n');

const keys = new Map(); // texte → fichiers
// Relevés à tort (formats, messages techniques jamais affichés)
const IGNORE = new Set(['%.*f', 'HTTP ', 'trop gros']);
const add = (k, file) => {
  if (!k || !/[A-Za-zÀ-ÿ]{2}/.test(k) || IGNORE.has(k)) return;
  if (!keys.has(k)) keys.set(k, new Set());
  keys.get(k).add(rel(file));
};
/** Parties variables d'un message en {a}, {b}… */
const letters = 'abcdefghijklmnopqrstuvwxyz';
const holes = (s, re) => { let i = 0; return s.replace(re, () => `{${letters[i++] || 'z'}}`); };

// ------------------------------------------------------------------ interface
for (const f of walk(path.join(ROOT, 'ui', 'js'), /\.js$/)) {
  const s = fs.readFileSync(f, 'utf8');
  // Texte entre '…' ou "…"
  const q = String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")`;
  const pick = (m, i) => unq(m[i] != null ? m[i] : m[i + 1]);
  for (const m of s.matchAll(new RegExp(String.raw`(?<![\w.$])t\(\s*` + q, 'g'))) add(pick(m, 1), f);
  for (const m of s.matchAll(new RegExp(String.raw`(?<![\w.$])tn\([^,]+,\s*` + q + String.raw`,\s*` + q, 'g'))) { add(pick(m, 1), f); add(pick(m, 3), f); }
}
for (const f of walk(path.join(ROOT, 'ui'), /\.html$/)) {
  const s = fs.readFileSync(f, 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
  for (const m of s.matchAll(/>([^<>]+)</g)) {
    const txt = m[1].replace(/\s+/g, ' ').trim();
    if (txt && /[A-Za-zÀ-ÿ]{2}/.test(txt)) add(txt.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'), f);
  }
  for (const m of s.matchAll(/\s(?:title|placeholder|aria-label)="([^"]+)"/g)) add(m[1], f);
}

// ------------------------------------------------------------------ messages de l'hôte et des outils
for (const f of walk(path.join(ROOT, 'host'), /\.(js|ps1)$/)) {
  const s = fs.readFileSync(f, 'utf8');
  if (f.endsWith('.js')) {
    const lit = `'((?:[^'\\\\]|\\\\.)*)'|\`((?:[^\`\\\\]|\\\\.)*)\``;
    for (const m of s.matchAll(new RegExp(`(?:error|reason|note|detail):\\s*(?:${lit})`, 'g'))) add(m[1] != null ? unq(m[1]) : holes(unq(m[2]), /\$\{[^}]*\}/g), f);
    for (const m of s.matchAll(new RegExp(`new Error\\(\\s*(?:${lit})`, 'g'))) add(m[1] != null ? unq(m[1]) : holes(unq(m[2]), /\$\{[^}]*\}/g), f);
  } else {
    for (const m of s.matchAll(/throw\s+"((?:[^"`]|`.)*)"/g)) add(holes(m[1], /\$\([^)]*\)|\$[\w:.]+/g), f);
    for (const m of s.matchAll(/throw\s+'((?:[^']|'')*)'/g)) add(m[1].replace(/''/g, "'"), f);
  }
}
for (const f of [...walk(path.join(ROOT, 'native', 'KaneMode.Amd'), /\.cpp$/), ...walk(path.join(ROOT, 'native', 'KaneMode.Gpu'), /\.cpp$/)]) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/(?:runtime_error\(|reason = |snprintf\(b, sizeof b, )"((?:[^"\\]|\\.)*)"(\s*\+\s*\w+)?/g)) {
    add(holes(unq(m[1]) + (m[2] ? '%s' : ''), /%(?:\.\*)?[sdXux]/g), f);
  }
}

// Textes affichés sans passer par t() (reconnus par tx() à l'affichage)
for (const k of ['Manette XInput']) add(k, path.join(ROOT, 'ui', 'js', 'pages', 'settings.js'));

// ------------------------------------------------------------------ résultat
fs.mkdirSync(OUT, { recursive: true });
const sorted = [...keys.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
fs.writeFileSync(path.join(ROOT, 'tools', 'i18n-keys.json'), JSON.stringify(Object.fromEntries(sorted.map(k => [k, [...keys.get(k)].sort()])), null, 1) + '\n');
const [cmd, which] = process.argv.slice(2);
const load = l => { try { return JSON.parse(fs.readFileSync(path.join(OUT, l + '.json'), 'utf8')); } catch { return {}; } };
if (cmd === 'missing') {
  const d = load(which);
  process.stdout.write(JSON.stringify(sorted.filter(k => !d[k]), null, 1) + '\n');
} else {
  console.log(`${sorted.length} textes (tools/i18n-keys.json)`);
  for (const l of LANGS) {
    const d = load(l);
    const missing = sorted.filter(k => !d[k]).length, extra = Object.keys(d).filter(k => !keys.has(k)).length;
    // Parties variables oubliées dans une traduction
    const broken = sorted.filter(k => d[k] && (k.match(/\{\w+\}/g) || []).sort().join() !== (d[k].match(/\{\w+\}/g) || []).sort().join());
    console.log(`${l} : ${missing} manquants, ${extra} en trop${broken.length ? `, ${broken.length} avec des {…} différents : ${broken.slice(0, 3).map(k => JSON.stringify(k)).join(', ')}` : ''}`);
  }
}
