'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createPathWatch} = require('../host/lib/pathwatch');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i=0;i<80;i++) { if (check()) return; await delay(50); }
  assert.ok(check(), 'La modification du dossier doit être détectée');
}
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kanemode-stores-'));
  t.after(()=>{
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('kanemode-stores-')) throw new Error('Dossier temporaire hors des essais');
    fs.rmSync(root,{recursive:true,force:true});
  });
  return root;
}
test('Epic installé après KaneMode : descente depuis le parent existant puis surveillance des jeux', async t => {
  const root=fixture(t), target=path.join(root,'Epic','EpicGamesLauncher','Data','Manifests');
  let changes=0; const watch=createPathWatch(target,()=>changes++); t.after(()=>watch.close());
  fs.mkdirSync(path.join(root,'Autre')); await delay(100); assert.equal(changes,0);
  for (const segment of ['Epic','EpicGamesLauncher','Data','Manifests']) {
    const previous=changes;
    const dir=segment==='Epic' ? path.join(root,segment) : segment==='EpicGamesLauncher' ? path.join(root,'Epic',segment) : segment==='Data' ? path.join(root,'Epic','EpicGamesLauncher',segment) : target;
    fs.mkdirSync(dir); await until(()=>changes>previous);
  }
  const previous=changes; fs.writeFileSync(path.join(target,'jeu.item'),'{}'); await until(()=>changes>previous);
  await delay(100); const settled=changes;
  fs.writeFileSync(path.join(target,'journal.txt'),'bruit'); await delay(100); assert.equal(changes,settled);
});
test('Epic : création simultanée des dossiers et reprise après remplacement des manifestes', async t => {
  const root=fixture(t), target=path.join(root,'Epic','Data','Manifests');
  let changes=0; const watch=createPathWatch(target,()=>changes++); t.after(()=>watch.close());
  fs.mkdirSync(target,{recursive:true}); fs.writeFileSync(path.join(target,'premier.item'),'{}'); await until(()=>changes>0);
  fs.renameSync(target,target+'-ancien'); watch.refresh();
  fs.mkdirSync(target); watch.refresh(); const previous=changes;
  fs.writeFileSync(path.join(target,'second.item'),'{}'); await until(()=>changes>previous);
});
test('Fermer la surveillance libère les dossiers et arrête les rappels', async t => {
  const root=fixture(t); let changes=0; const watch=createPathWatch(root,()=>changes++);
  watch.close(); fs.writeFileSync(path.join(root,'jeu.item'),'{}'); watch.refresh(); await delay(100); assert.equal(changes,0);
});
test('Le scan Epic reconnaît architectures, chemins et jeux installés', {skip:process.platform!=='win32'}, t => {
  const root=fixture(t);
  const result=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'verify-epic.ps1'),'-TestRoot',root],{encoding:'utf8',timeout:15000});
  assert.match(result,/PASS Epic/);
});
