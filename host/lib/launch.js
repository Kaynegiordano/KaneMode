'use strict';
const fs = require('node:fs'), path = require('node:path'), childProcess = require('node:child_process');

// Règles CommandLineToArgvW : les antislashs des chemins et les guillemets échappés sont conservés.
function splitArgs(text = '') {
  const args=[]; let value='', quoted=false, has=false;
  for (let i=0;i<text.length;i++) {
    let ch=text[i];
    if (ch==='\\') {
      let count=1; while(text[i+1]==='\\'){count++;i++;}
      if(text[i+1]==='"') {
        value+='\\'.repeat(Math.floor(count/2)); i++;
        if(count%2) value+='"'; else quoted=!quoted;
      } else value+='\\'.repeat(count);
      has=true; continue;
    }
    if(ch==='"'){quoted=!quoted;has=true;continue;}
    if(/\s/.test(ch)&&!quoted){if(has){args.push(value);value='';has=false;}continue;}
    value+=ch;has=true;
  }
  if(has)args.push(value);
  return args;
}
const isFile = p => {try{return fs.statSync(p).isFile();}catch{return false;}};
const isDir = p => {try{return fs.statSync(p).isDirectory();}catch{return false;}};
function plan(launch, checks={isFile,isDir}) {
  if (!launch || typeof launch.target!=='string' || !launch.target.trim()) throw new Error('Aucune cible de lancement');
  let target=launch.target.trim();
  if(/^"[^"\r\n]+"$/.test(target))target=target.slice(1,-1);
  if(/[\0\r\n]/.test(target))throw new Error('Cible de lancement invalide');
  const windowsPath=path.win32.isAbsolute(target), local=windowsPath||path.isAbsolute(target);
  const paths=/^[A-Za-z]:|^\\\\/.test(target)?path.win32:path;
  if(!local && /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    if(/^shell:/i.test(target)&&!/^shell:AppsFolder\\[\w.-]+![\w.-]+$/i.test(target)) throw new Error('Identifiant d’application Windows invalide');
    return {mode:'shell',target,args:''};
  }
  if(!local)throw new Error('Le chemin de lancement doit être absolu');
  if(launch.kind==='folder') {
    if(!checks.isDir(target))throw new Error('Dossier introuvable');
    return {mode:'shell',target,args:''};
  }
  if(!checks.isFile(target))throw new Error('Fichier de lancement introuvable : '+target);
  const cwd=launch.cwd&&checks.isDir(launch.cwd)?launch.cwd:paths.dirname(target);
  const rawArgs=typeof launch.args==='string'?launch.args:'';
  if(/\.exe$/i.test(target))return {mode:'exe',target,args:splitArgs(rawArgs),rawArgs,cwd,env:launch.env};
  if(launch.kind==='exe')throw new Error('La cible ne désigne pas un exécutable');
  return {mode:'shell',target,args:rawArgs,cwd};
}
function create(options={}) {
  const spawn=options.spawn||childProcess.spawn, checks=options.checks||{isFile,isDir}, now=options.now||Date.now;
  const script=path.join(__dirname,'..','launch.ps1');
  function shell(target) {
    return new Promise(resolve=>{
      const p=spawn('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      let out='',err='',settled=false;
      const done=result=>{if(settled)return;settled=true;clearTimeout(timer);resolve(result);};
      const timer=setTimeout(()=>{p.kill();done({ok:false,error:'Windows n’a pas répondu à la demande de lancement'});},120000);timer.unref();
      p.stdout.on('data',chunk=>out+=chunk);p.stderr.on('data',chunk=>err+=chunk);
      p.on('error',error=>done({ok:false,error:error.message}));
      p.on('close',code=>{try{const result=JSON.parse(out.trim().replace(/^\uFEFF/,''));done(code===0&&result.ok?result:{ok:false,error:result.error||err||'Lancement refusé par Windows'});}catch{done({ok:false,error:err||'Réponse de lancement Windows invalide'});}});
      p.stdin.on('error',()=>{});
      p.stdin.end(JSON.stringify({target:target.target,args:typeof target.args==='string'?target.args:target.rawArgs||'',cwd:target.cwd||''}));
    });
  }
  return async function run(launch,{dry,onExit}={}) {
    let target;try{target=plan(launch,checks);}catch(error){return {ok:false,error:error.message};}
    if(dry)return {ok:true,dry:true,mode:target.mode,cmd:target.mode==='exe'?target.target:'ShellExecute',args:target.args,cwd:target.cwd};
    if(target.mode==='shell')return shell(target);
    return new Promise(resolve=>{
      const started=now();
      const p=spawn(target.target,target.args,{cwd:target.cwd,env:target.env?{...process.env,...target.env}:undefined,detached:true,stdio:'ignore'});
      p.on('spawn',()=>{p.unref();resolve({ok:true});});
      if(onExit)p.on('exit',()=>onExit((now()-started)/60000));
      p.on('error',async error=>{
        // Un fichier absent ou une commande invalide n’est jamais envoyée à l’Explorateur.
        if(['EACCES','EPERM'].includes(error.code)&&checks.isFile(target.target))return resolve(await shell(target));
        resolve({ok:false,error:error.message});
      });
    });
  };
}
module.exports={create,plan,splitArgs};
