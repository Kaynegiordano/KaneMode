#!/usr/bin/env node
// Analyse du JavaScript de KaneMode par TypeScript (sans rien changer au code ni le compiler) :
// noms inconnus, fautes de frappe, variables ou imports sans usage, doublons, usages avant
// déclaration, erreurs de syntaxe. Le reste des remarques de TypeScript (types implicites…) est
// ignoré : le projet est en JavaScript sans annotations.
//
//   node tools/check-code.js        (après « npm install » dans tools/dev, une seule fois)
//
// Code de sortie 1 s'il y a quelque chose à corriger : à lancer avant chaque publication.
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEV = path.join(__dirname, 'dev', 'node_modules');
let TSC;
try { TSC = require.resolve('typescript/lib/tsc.js', { paths: [DEV] }); }
catch {
  console.error('TypeScript manquant : lancez « npm install » dans tools/dev');
  process.exit(2);
}

// Remarques gardées : celles qui signalent une vraie faute dans du JavaScript
const KEEP = new Set([
  2304, 2552, // nom inconnu, nom mal orthographié
  2300, 2451, // déclaré deux fois
  2448, 2454, // utilisé avant sa déclaration
  6133, 6192, 6196, 6198, // déclaré sans être utilisé (variable, imports, type, déstructuration)
]);
const isSyntax = code => code >= 1000 && code < 2000;

const COMMON = ['--allowJs', '--checkJs', '--noEmit', '--pretty', 'false', '--skipLibCheck', '--target', 'es2022', '--noUnusedLocals'];
const RUNS = [
  // Interface et widget Game Bar : modules ES, suivis depuis leurs points d'entrée
  { name: 'interface', args: [...COMMON, '--module', 'esnext', '--moduleResolution', 'bundler', '--lib', 'es2023,dom,dom.iterable',
    path.join(ROOT, 'ui', 'js', 'main.js'), path.join(ROOT, 'ui', 'js', 'widget.js')] },
  // Hôte Node et outils
  { name: 'hôte', args: [...COMMON, '--module', 'commonjs', '--lib', 'es2023', '--typeRoots', path.join(DEV, '@types'), '--types', 'node',
    path.join(ROOT, 'host', 'server.js'), path.join(ROOT, 'tools', 'i18n.js')] },
];

let total = 0;
for (const run of RUNS) {
  const r = spawnSync(process.execPath, [TSC, ...run.args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const lines = String(r.stdout || '').split(/\r?\n/);
  // Option refusée ou fichier introuvable : TypeScript n'a rien analysé, ce n'est pas un succès
  const fatal = lines.filter(l => /^error TS\d+:/.test(l));
  if (fatal.length || (r.status !== 0 && !lines.some(l => /\): error TS/.test(l)))) {
    console.error(`${run.name} : TypeScript n'a pas pu analyser\n  ${(fatal.length ? fatal : [String(r.stderr || '').trim()]).join('\n  ')}`);
    process.exit(2);
  }
  const found = [];
  for (const line of lines) {
    const m = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
    if (!m) continue;
    const code = +m[4];
    if (!KEEP.has(code) && !isSyntax(code)) continue;
    if (m[1].includes('node_modules')) continue;
    found.push(`${path.relative(ROOT, m[1]).replace(/\\/g, '/')}:${m[2]}  ${m[5]}`);
  }
  if (r.error) { console.error(`${run.name} : TypeScript n'a pas pu tourner (${r.error.message})`); process.exit(2); }
  console.log(`${run.name} : ${found.length ? found.length + ' à corriger' : 'rien à signaler'}`);
  for (const f of found) console.log('  ' + f);
  total += found.length;
}
process.exit(total ? 1 : 0);
