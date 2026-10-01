'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const accounts=require('../host/lib/accounts');
const provider='10000000-0000-0000-0000-000000000001';
const id=n=>'20000000-0000-0000-0000-'+String(n).padStart(12,'0');
const row=(n,extra={})=>({id:id(n),provider,providerName:'Steam',gameId:String(n),name:'Jeu '+n,installed:false,canInstall:true,playtime:0,art:{},...extra});
const snapshot=games=>({ok:true,schema:1,providers:[{id:provider,name:'Steam',settings:true}],games});
test('Bibliothèque complète : 5000 jeux jamais joués et non installés, aucun échantillon',()=>{
  const data=accounts.normalize(snapshot(Array.from({length:5000},(_,i)=>row(i+1))));
  assert.equal(data.games.length,5000);assert.equal(data.games[4999].id,'steam:5000');
  assert.equal(data.games.every(g=>!g.installed&&g.canInstall),true);
});
test('Les sources futures sont extensibles et les fiches invalides ne deviennent pas des jeux',()=>{
  const data=snapshot([row(1)]);data.providers[0].name='Nouvelle boutique légale';
  assert.match(accounts.normalize(data).games[0].source,/^account_/);
  assert.throws(()=>accounts.normalize({...data,schema:2}));
  assert.throws(()=>accounts.normalize(snapshot([row(1,{installed:'oui'})])));
  assert.throws(()=>accounts.normalize(snapshot([row(1,{provider:id(9)})])));
});
test('Fusion : installations locales prioritaires, identifiants Steam stables, titres identiques distincts',()=>{
  const owned=accounts.normalize(snapshot([row(1),row(2,{name:'Même titre'})])).games;
  const merged=accounts.merge([{id:'steam:1',source:'steam',installed:true,installDir:'D:\\Jeux\\One',name:'Jeu 1',launch:{target:'steam://rungameid/1'},art:{icon:'local'}}],owned);
  assert.equal(merged.length,2);assert.equal(merged[0].installed,true);assert.equal(merged[0].launch.target,'steam://rungameid/1');assert.equal(merged[0].bridge.id,id(1));
  const same=accounts.normalize(snapshot([row(3,{name:'Même titre'}),row(4,{name:'Même titre'})])).games;
  assert.equal(accounts.merge([],same).length,2);
});
test('Fusion par dossier exact : historique et retrait restent attachés après une désinstallation',()=>{
  const remote=accounts.normalize(snapshot([row(1,{gameId:'offre',installDir:'D:\\Games\\One\\',installed:true})])).games[0];
  remote.source='ea';const aliases={};
  const merged=accounts.merge([{id:'ea:registre-original',source:'ea',installed:true,installDir:'d:\\games\\one',name:'One'}],[remote],aliases);
  assert.equal(merged.length,1);assert.equal(merged[0].id,'ea:registre-original');
  assert.equal(accounts.merge([],[{...remote,installed:false}],JSON.parse(JSON.stringify(aliases)))[0].id,'ea:registre-original');
  assert.equal(accounts.merge([{id:'gog:autre',source:'gog',installed:true,installDir:'D:\\Games\\One'}],[remote]).length,2);
});
test('Aucun chemin relatif ou distant arbitraire ne devient un visuel local',()=>{
  const g=accounts.normalize(snapshot([row(1,{installDir:'relatif',art:{portrait:'../../secret',hero:'https://example.org/image',icon:'D:\\Art\\a.png'}})])).games[0];
  assert.equal(g.installDir,null);assert.deepEqual(g.art,{icon:'D:\\Art\\a.png'});
});
test('IPC Windows réel : synchronisation persistante, refus conservant le cache, actions limitées et déconnexion',{skip:process.platform!=='win32'},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kanemode-accounts-'));
  const profile=path.join(root,'playnite'),extensions=path.join(profile,'Extensions'),src=path.join(root,'tools','library-bridge');
  const exe=path.join(profile,'Playnite.DesktopApp.exe');fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(exe,'fixture');
  fs.mkdirSync(src,{recursive:true});for(const name of ['KaneMode.LibraryBridge.dll','extension.yaml'])fs.writeFileSync(path.join(src,name),'fixture');
  const pipe='KaneMode.LibraryBridge.'+crypto.randomBytes(16).toString('hex'),token=crypto.randomBytes(16).toString('hex');
  const commands=[],launches=[];let response=snapshot([row(1),row(2,{canInstall:false})]);
  const server=net.createServer(socket=>{
    let text='';socket.setEncoding('utf8');socket.on('data',part=>{
      text+=part;if(!text.includes('\n'))return;
      const request=JSON.parse(text.trim());assert.equal(request.token,token);commands.push(request);
      socket.end(JSON.stringify(request.action==='snapshot'?response:{ok:true})+'\n');
    });
  });
  await new Promise(r=>server.listen('\\\\.\\pipe\\'+pipe,r));
  try{
    const create=()=>accounts.create(root,{root,run:async request=>{launches.push(request);return {ok:true};},discover:async()=>({exe,extensions})});
    let bridge=create();assert.equal((await bridge.status()).enabled,false);
    await assert.rejects(()=>bridge.sync({start:true}));assert.equal(launches.length,0);
    await bridge.configure({enabled:true});
    fs.writeFileSync(path.join(root,'accounts','connection.json'),JSON.stringify({pipe,token}));
    assert.equal((await bridge.sync()).count,2);assert.equal((await bridge.status()).installable,1);
    assert.deepEqual(Object.keys(await bridge.status()).includes('token'),false);
    await bridge.action(id(1),'install');assert.equal(commands.at(-1).action,'install');
    await assert.rejects(()=>bridge.action(id(1),'uninstall'));await assert.rejects(()=>bridge.action(id(99),'install'));
    response={...response,schema:99};await assert.rejects(()=>bridge.sync());assert.equal(bridge.entries([]).length,2);
    bridge=create();assert.equal(bridge.entries([]).length,2,'Cache relu après redémarrage');
    await bridge.configure({enabled:false});assert.deepEqual(bridge.entries([]),[]);
    assert.equal(fs.existsSync(path.join(root,'accounts','library.json')),true,'Le cache n’est pas détruit');
    assert.equal(launches.length,0,'Aucune ouverture de Playnite pendant la synchronisation de fond');
  }finally{
    await new Promise(r=>server.close(r));
    if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('kanemode-accounts-'))throw new Error('Dossier hors essais');
    fs.rmSync(root,{recursive:true,force:true});
  }
});
