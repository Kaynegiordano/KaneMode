'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const GUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PROVIDERS={steam:'Steam',epic:'Epic Games',gog:'GOG',ea:'EA',ubisoft:'Ubisoft Connect',battlenet:'Battle.net',xbox:'Xbox',amazon:'Amazon Games',riot:'Riot Games',itch:'itch.io',humble:'Humble Bundle'};
const names={steam:'steam',epicgames:'epic',epicgamesstore:'epic',gog:'gog',goggalaxy:'gog',origin:'ea',eaapp:'ea',ea:'ea',ubisoftconnect:'ubisoft',uplay:'ubisoft',battlenet:'battlenet',xbox:'xbox',amazon:'amazon',amazongames:'amazon',riotgames:'riot',itchio:'itch',humble:'humble',humblebundle:'humble'};
const clean=x=>typeof x==='string'?x.trim():'';
const load=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
function write(file,value){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value));fs.renameSync(tmp,file);}
const dirKey=p=>clean(p)?path.win32.normalize(p).replace(/[\\/]+$/,'').toLowerCase():'';
function source(provider,name){return names[clean(name).toLowerCase().replace(/[^a-z0-9]/g,'')]||'account_'+provider.toLowerCase();}
function gameKey(row,src) {
  const gid=clean(row.gameId);
  if(['steam','gog','ubisoft'].includes(src)&&/^\d+$/.test(gid))return src+':'+gid;
  if(src==='epic'){
    let id=gid;try{const obj=JSON.parse(gid);id=obj.AppName||obj.appName||obj.app_name||'';}catch{}
    if(/^[\w.-]+$/.test(id))return 'epic:'+id;
  }
  return 'account:'+row.provider.toLowerCase()+':'+encodeURIComponent(gid||row.id);
}
/** Aucune limite de sélection : import de toutes les fiches renvoyées par les connecteurs. */
function normalize(snapshot){
  if(!snapshot||snapshot.schema!==1||!Array.isArray(snapshot.games)||!Array.isArray(snapshot.providers))throw new Error('Bibliothèque de comptes invalide');
  const providers=snapshot.providers.map(p=>{
    if(!GUID.test(p.id)||!clean(p.name))throw new Error('Connecteur de compte invalide');
    return {id:p.id.toLowerCase(),name:clean(p.name),settings:p.settings===true,source:source(p.id,p.name)};
  });
  const byId=new Map(providers.map(p=>[p.id,p])),seen=new Set(),games=[];
  for(const row of snapshot.games){
    if(!GUID.test(row.id)||!GUID.test(row.provider)||!clean(row.name)||typeof row.installed!=='boolean')throw new Error('Fiche de compte invalide');
    const provider=byId.get(row.provider.toLowerCase());if(!provider)throw new Error('Boutique du jeu inconnue');
    const id=gameKey(row,provider.source);if(seen.has(id))continue;seen.add(id);
    const art={};for(const k of ['portrait','hero','icon'])if(clean(row.art?.[k])&&path.win32.isAbsolute(row.art[k]))art[k]=row.art[k];
    games.push({id,source:provider.source,sourceLabel:provider.name,name:clean(row.name),type:'game',installed:row.installed,
      installing:row.installing===true,canInstall:row.canInstall===true,accountHidden:row.hidden===true,
      installDir:path.win32.isAbsolute(clean(row.installDir))?row.installDir:null,
      lastPlayed:Number.isFinite(row.lastPlayed)?Math.max(0,row.lastPlayed):0,playtime:Number.isFinite(row.playtime)?Math.max(0,row.playtime):0,art,
      steamAppId:provider.source==='steam'&&/^\d+$/.test(clean(row.gameId))?+row.gameId:null,
      bridge:{id:row.id.toLowerCase(),provider:provider.id},launch:{kind:'account',target:row.id.toLowerCase()}});
  }
  return {schema:1,updated:Date.now(),providers,games};
}
/** Fusion par identifiant ou dossier exact de la même boutique ; jamais par titre. */
function merge(local,owned,aliases={}){
  const games=local.map(g=>({...g})),byId=new Map(games.map(g=>[g.id,g])),byDir=new Map();
  for(const g of games)if(g.installDir)byDir.set(g.source+'|'+dirKey(g.installDir),g);
  for(const remote of owned){
    const alias=aliases[remote.id];
    let match=byId.get(remote.id)||(alias&&byId.get(alias))||(remote.installed&&remote.installDir&&byDir.get(remote.source+'|'+dirKey(remote.installDir)));
    if(match){
      aliases[remote.id]=match.id;
      match.bridge=remote.bridge;match.sourceLabel=remote.sourceLabel;match.canInstall=remote.canInstall;
      match.art={...remote.art,...match.art};match.playtime=Math.max(match.playtime||0,remote.playtime||0);
      // La détection locale effective est prioritaire sur un ancien cache de compte.
      if(match.installed===false&&remote.installed){match.installed=true;match.installDir=remote.installDir;match.launch=remote.launch;}
    }else{
      const g={...remote,id:alias||remote.id};games.push(g);byId.set(g.id,g);
    }
  }
  return games;
}
function create(dataDir,{run,discover,root,onChange=()=>{},connect=net.createConnection}={}){
  const folder=path.join(dataDir,'accounts');fs.mkdirSync(folder,{recursive:true});
  const files={config:path.join(folder,'settings.json'),cache:path.join(folder,'library.json'),aliases:path.join(folder,'aliases.json'),connection:path.join(folder,'connection.json')};
  const savedConfig=load(files.config,null),savedCache=load(files.cache,null),savedAliases=load(files.aliases,null);
  let cfg={enabled:savedConfig?.enabled===true,exe:typeof savedConfig?.exe==='string'?savedConfig.exe:null};
  let cache=savedCache?.schema===1&&Array.isArray(savedCache.games)&&Array.isArray(savedCache.providers)?savedCache:{providers:[],games:[],updated:0};
  let aliases=savedAliases&&typeof savedAliases==='object'&&!Array.isArray(savedAliases)?savedAliases:{};
  let syncing=null,detected=null,lastDetect=0;
  function exchange(action,id,timeout=20000){
    const connection=load(files.connection,null);
    if(!connection||!/^KaneMode\.LibraryBridge\.[a-f0-9]{32}$/.test(connection.pipe)||!/^\w{32}$/.test(connection.token))return Promise.reject(new Error('Passerelle de comptes fermée. Ouvrez Playnite avec la passerelle KaneMode.'));
    return new Promise((resolve,reject)=>{
      const socket=connect('\\\\.\\pipe\\'+connection.pipe);let body='',done=false;
      const finish=(err,result)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();err?reject(err):resolve(result);};
      const timer=setTimeout(()=>finish(new Error('La passerelle de comptes ne répond pas')),timeout);timer.unref();
      socket.setEncoding('utf8');socket.on('connect',()=>socket.write(JSON.stringify({token:connection.token,action,id})+'\n'));
      socket.on('data',part=>{
        body+=part;if(body.length>32*1024*1024)return finish(new Error('Bibliothèque de comptes trop volumineuse'));
        if(body.includes('\n')){try{const response=JSON.parse(body.slice(0,body.indexOf('\n')));if(!response.ok)return finish(new Error(response.error||'Action de compte refusée'));finish(null,response);}catch(error){finish(error);}}
      });
      socket.on('error',()=>finish(new Error('Passerelle de comptes fermée. Ouvrez Playnite avec la passerelle KaneMode.')));
      socket.on('end',()=>{if(!done)finish(new Error('Réponse de la passerelle incomplète'));});
    });
  }
  async function location(force=false){
    if(force||!detected||Date.now()-lastDetect>60000){detected=await discover(cfg.exe);lastDetect=Date.now();}
    return detected;
  }
  function pluginSource(){
    for(const folder of [path.join(root,'tools','library-bridge'),path.join(root,'native','KaneMode.LibraryBridge','obj','bridge')])if(fs.existsSync(path.join(folder,'KaneMode.LibraryBridge.dll')))return folder;
    throw new Error('Passerelle de comptes absente de cette compilation');
  }
  async function status(){
    const found=await location();
    let online=false;if(cfg.enabled)try{await exchange('ping',null,1200);online=true;}catch{}
    return {enabled:cfg.enabled,installed:!!found?.exe,exe:found?.exe||null,prepared:!!found?.extensions&&fs.existsSync(path.join(found.extensions,'KaneMode.LibraryBridge','extension.yaml')),
      online,updated:cache.updated||0,count:cache.games.length,uninstalled:cache.games.filter(g=>!g.installed).length,installable:cache.games.filter(g=>!g.installed&&g.canInstall).length,
      providers:cache.providers.map(p=>({...p,count:cache.games.filter(g=>g.bridge.provider===p.id).length})),syncing:!!syncing};
  }
  async function configure({enabled,exe}={}){
    if(typeof enabled!=='boolean')throw new Error('Choix de connexion invalide');
    if(exe!==undefined){if(typeof exe!=='string'||!path.win32.isAbsolute(exe)||path.win32.basename(exe).toLowerCase()!=='playnite.desktopapp.exe'||!fs.statSync(exe).isFile())throw new Error('Choisissez Playnite.DesktopApp.exe');cfg={...cfg,exe};}
    if(enabled){
      const found=await location(true);if(!found?.exe||!found.extensions)throw new Error('Installez Playnite ou choisissez son exécutable portable');
      const src=pluginSource(),destination=path.join(found.extensions,'KaneMode.LibraryBridge');fs.mkdirSync(destination,{recursive:true});
      for(const file of ['KaneMode.LibraryBridge.dll','extension.yaml']){
        const from=path.join(src,file),to=path.join(destination,file);
        if(fs.existsSync(to)&&fs.readFileSync(from).equals(fs.readFileSync(to)))continue;
        try{fs.copyFileSync(from,to);}catch{throw new Error('Fermez puis rouvrez Playnite pour charger la passerelle KaneMode');}
      }
      write(path.join(destination,'bridge-config.json'),{data:folder});
    }
    cfg={...cfg,enabled};write(files.config,cfg);onChange();return status();
  }
  async function open(){const found=await location(true);if(!found?.exe)throw new Error('Playnite est introuvable');return run({target:found.exe,kind:'exe',args:'--startdesktop --hidesplashscreen'});}
  async function ready(){
    if(!cfg.enabled)throw new Error('Connectez vos bibliothèques dans Paramètres → Comptes et boutiques');
    try{await exchange('ping',null,1000);return;}catch{}
    const launched=await open();if(!launched.ok)throw new Error(launched.error||'Impossible de lancer Playnite');
    for(let attempt=0;attempt<25;attempt++){try{await exchange('ping',null,1000);return;}catch{}await new Promise(r=>setTimeout(r,1000));}
    throw new Error('Fermez puis rouvrez Playnite pour charger la passerelle KaneMode');
  }
  async function sync({start=false}={}){
    if(!cfg.enabled)throw new Error('Les bibliothèques de comptes sont désactivées');
    if(syncing)return syncing;
    syncing=(async()=>{
      if(start)await ready();
      const snapshot=normalize(await exchange('snapshot',null,90000));write(files.cache,snapshot);cache=snapshot;onChange();return status();
    })().finally(()=>{syncing=null;});return syncing;
  }
  async function action(id,kind){
    if(!GUID.test(id)||!['start','install','settings'].includes(kind))throw new Error('Action de compte invalide');
    if(kind==='settings'?!cache.providers.some(p=>p.id===id):!cache.games.some(g=>g.bridge.id===id))throw new Error('Jeu ou compte inconnu');
    await ready();return exchange(kind,id,30000);
  }
  function entries(local){
    if(!cfg.enabled)return local;
    const before=JSON.stringify(aliases),result=merge(local,cache.games,aliases);if(before!==JSON.stringify(aliases))write(files.aliases,aliases);return result;
  }
  function sources(){return cfg.enabled?Object.fromEntries(cache.providers.map(p=>[p.source,{label:p.name,color:'#7c9eff'}])):{};}
  return {status,configure,open,sync,action,entries,sources};
}
module.exports={create,normalize,merge,gameKey,PROVIDERS};
