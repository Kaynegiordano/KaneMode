'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'), path=require('node:path'), fs=require('node:fs'), os=require('node:os');
const {execFileSync,spawnSync}=require('node:child_process');
const launch=require('../host/lib/launch'), removal=require('../host/lib/library-removal');
const checks={isFile:p=>p.endsWith('.exe')||p.endsWith('.lnk'),isDir:p=>p==='D:\\Jeux\\Mon jeu'};
function processStub(){const p=new EventEmitter();p.unref=()=>{};p.kill=()=>{};p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.stdin=new EventEmitter();return p;}
test('Les URI des boutiques et AppsFolder utilisent ShellExecute, jamais une fenêtre Documents',()=>{
  for(const target of ['steam://rungameid/123','com.epicgames.launcher://apps/ns%3Aid%3Aapp?action=launch&silent=true','uplay://launch/42/0','roblox-player:1+launchmode:app','shell:AppsFolder\\Microsoft.Test_123!App'])assert.equal(launch.plan({kind:'uri',target},checks).mode,'shell');
  assert.throws(()=>launch.plan({target:'shell:AppsFolder\\invalide'},checks));
});
test('Exécutable, fichier absent et dossier : aucune redirection silencieuse vers Explorer',async()=>{
  const run=launch.create({checks,spawn:()=>{throw new Error('Ne doit pas être lancé');}});
  const exe=await run({kind:'uri',target:'D:\\Jeux\\Mon jeu\\jeu.exe',args:'--file "D:\\Données avec espaces\\save.json"'},{dry:true});
  assert.equal(exe.cmd,'D:\\Jeux\\Mon jeu\\jeu.exe');assert.deepEqual(exe.args,['--file','D:\\Données avec espaces\\save.json']);
  for(const target of ['','D:\\Documents','D:\\inconnu.txt','relatif.exe'])assert.equal((await run({kind:'exe',target},{dry:true})).ok,false);
  assert.equal((await run({kind:'folder',target:'D:\\Jeux\\Mon jeu'},{dry:true})).cmd,'ShellExecute');
});
test('Une erreur ENOENT reste une erreur et ne lance aucun second programme',async()=>{
  const calls=[];const run=launch.create({checks,spawn:(cmd)=>{calls.push(cmd);const p=processStub();setImmediate(()=>p.emit('error',Object.assign(new Error('Fichier disparu'),{code:'ENOENT'})));return p;}});
  const result=await run({kind:'exe',target:'D:\\Jeux\\jeu.exe'});assert.equal(result.ok,false);assert.equal(calls.length,1);
});
test('Le recours Windows pour une élévation garde les arguments et remonte le refus',async()=>{
  const calls=[];let payload;
  const args='--save "D:\\Mes données\\a.json" --literal "$(ne-pas-executer)"';
  const run=launch.create({checks,spawn:(cmd,argv)=>{
    calls.push(cmd);const p=processStub();
    if(cmd!=='powershell.exe')setImmediate(()=>p.emit('error',Object.assign(new Error('Élévation'),{code:'EACCES'})));
    else p.stdin.end=value=>{payload=JSON.parse(value);setImmediate(()=>{p.stdout.emit('data','{"ok":false,"error":"Refus Windows"}');p.emit('close',1);});};
    return p;
  }});
  const result=await run({kind:'exe',target:'D:\\Jeux\\jeu.exe',args});
  assert.equal(result.ok,false);assert.equal(result.error,'Refus Windows');assert.equal(payload.args,args);assert.deepEqual(calls,['D:\\Jeux\\jeu.exe','powershell.exe']);
});
test('Le lancement direct conserve environnement et durée, et les guillemets ne détruisent pas les chemins',async()=>{
  let p,options,time=0,minutes;
  const run=launch.create({checks,now:()=>time,spawn:(cmd,args,opts)=>{options=opts;p=processStub();setImmediate(()=>p.emit('spawn'));return p;}});
  assert.equal((await run({target:'D:\\Jeux\\jeu.exe',args:'--test',env:{KANEMODE_TEST:'oui'}},{onExit:m=>minutes=m})).ok,true);
  assert.equal(options.env.KANEMODE_TEST,'oui');time=120000;p.emit('exit');assert.equal(minutes,2);
  assert.deepEqual(launch.splitArgs('--empty "" "D:\\Jeux\\data" --quote "a\\"b"'),['--empty','','D:\\Jeux\\data','--quote','a"b']);
  assert.deepEqual(launch.splitArgs('--path "D:\\Jeux\\Sauvegarde\\\\"'),['--path','D:\\Jeux\\Sauvegarde\\']);
});
test('Retirer puis restaurer un jeu conserve fichiers, collections, visuels et historique',()=>{
  const entry={id:'epic:test',installed:true,source:'epic',installDir:'D:\\Jeux\\Test'};
  const state={played:{'epic:test':{count:3}},artOverrides:{'epic:test':{portrait:'image'}},collections:[{ids:['epic:test']}],overrides:{'epic:test':{hidden:true,type:'game'}}};
  const removed=removal.update(state,entry,true);assert.equal(removed.overrides[entry.id].removed,true);assert.equal(state.overrides[entry.id].removed,undefined);
  assert.equal(removed.played,state.played);assert.equal(removed.artOverrides,state.artOverrides);assert.equal(removed.collections,state.collections);
  const restored=removal.update(JSON.parse(JSON.stringify(removed)),entry,false);assert.deepEqual(restored,state);
  assert.equal(entry.installDir,'D:\\Jeux\\Test');
});
test('Le retrait refuse boutiques, jeux distants, démonstrations et entrées non installées',()=>{
  for(const entry of [null,{id:'launcher:steam',installed:true},{id:'x',installed:false},{id:'x',demo:true},{id:'x',streamHost:'PC'},{id:'kaneplay',source:'kaneplay'}])assert.throws(()=>removal.update({overrides:{}},entry,true));
  assert.throws(()=>removal.update({}, {id:'jeu',installed:true},'oui'));
});
test('Le helper Windows refuse un protocole absent et une application inconnue sans ouvrir Explorer',{skip:process.platform!=='win32'},()=>{
  const script=path.join(__dirname,'..','host','launch.ps1');
  for(const target of ['kanemode-test-absent-728c91:jeu','shell:AppsFolder\\KaneMode.Inconnu_728c91!App']){
    const result=spawnSync('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',script,'-CheckOnly'],{input:JSON.stringify({target,args:''}),encoding:'utf8',timeout:15000});
    assert.equal(JSON.parse(result.stdout.replace(/^\uFEFF/,'').trim()).ok,false);assert.equal(result.status,1);
  }
  const target=process.env.SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const result=spawnSync('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',script,'-CheckOnly'],{input:JSON.stringify({target,args:'--texte "$(ne-pas-executer)"'}),encoding:'utf8',timeout:15000});
  assert.equal(JSON.parse(result.stdout.trim()).ok,true);assert.equal(result.status,0);
});
test('Roblox et Minecraft : installations connues, mises à jour, Store et absence de faux jeux',{skip:process.platform!=='win32'},()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kanemode-known-'));
  try{
    const result=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'verify-known-games.ps1'),'-TestRoot',root],{encoding:'utf8',timeout:15000});assert.match(result,/PASS Jeux connus/);
  }finally{
    if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('kanemode-known-'))throw new Error('Dossier hors essais');
    fs.rmSync(root,{recursive:true,force:true});
  }
});
