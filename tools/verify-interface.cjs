// Essais Chromium avec bibliothèque et API simulées : aucune action sur Windows.
// Playwright doit être disponible ; KANEMODE_PLAYWRIGHT / KANEMODE_BROWSER peuvent préciser les chemins.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http=require('node:http');
const {chromium}=require(process.env.KANEMODE_PLAYWRIGHT || 'playwright');
const root=path.resolve(__dirname,'..'), dir=process.env.KANEMODE_UI_OUTPUT;
let dolbyState={available:true,installed:false,appVersion:null,license:null,controllable:true,devices:[{id:'headset',name:'Casque de test',default:true,supported:['off','headphones','sonic'],selected:'off',active:'off'},{id:'tv',name:'TV de test',default:false,supported:['off','homeTheater'],selected:'off',active:'off'}]};
let dolbyRefuse=false;const dolbyActions=[];
let artRequests=0; const apiCalls=[]; let artStyle='';
let launchers=[], libraryVersion=1;
const games=Array.from({length:803},(_,i)=>({id:'fixture:'+i,source:'steam',name:['Horizon — Les terres oubliées','Forza Horizon 5','Sea of Stars','Ori and the Will of the Wisps','Expédition 33','Hades II','Jusant','No Man’s Sky'][i%8]+(i<8?'':' '+i),installed:true,type:'game',lastPlayed:803-i,playtime:0,art:{portrait:'/art/'+i+'/portrait?r=1',hero:'/art/'+i+'/hero?r=1'},meta:{genres:['Action']}}));
const latest={version:'3.2.0',notes:'Version de test',msix:{size:117845231}};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'); const p=url.pathname;
  apiCalls.push({method:req.method,url:req.url}); const json=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x));};
  if(p.startsWith('/api/')) {
    if(p==='/api/dolby' && req.method==='GET') return json(dolbyState);
    if(p==='/api/dolby' && req.method==='POST') {let data='';for await(const chunk of req)data+=chunk;const body=JSON.parse(data);if(dolbyRefuse){res.statusCode=400;return json({error:'Windows n’a pas appliqué ce format. Vérifiez la licence et la configuration dans Dolby Access.'});}const d=dolbyState.devices.find(d=>d.id===body.device);d.selected=d.active=body.mode;return json({...dolbyState,verified:true});}
    if(p==='/api/dolby/open'){let data='';for await(const chunk of req)data+=chunk;dolbyActions.push(JSON.parse(data));return json({ok:true});}
    if(p==='/api/library') return json({games,launchers,collections:[{id:'c1',name:'Coop canapé',ids:['fixture:1','fixture:2']}],version:libraryVersion,stream:{engine:true,hosts:[]}});
    if(p==='/api/system') return json({cpuName:'Processeur simulé',cores:8,cpu:10,memUsed:4e9,memTotal:16e9,os:'Windows test',node:'22',uptime:100,dataDir:'Données simulées'});
    if(p==='/api/update') return json({current:'3.1.0',packaged:true,auto:false,last:{available:true,latest,checked:new Date().toISOString()},job:{phase:'idle'}});
    if(p==='/api/config') { if(req.method==='POST') { let data=''; for await (const chunk of req) data+=chunk; const body=JSON.parse(data||'{}'); if('sgdbStyle' in body) artStyle=body.sgdbStyle; } return json({sgdb:{configured:true,auto:true,preferSteam:true,style:artStyle},emulators:[],romRoots:[]}); }
    if(p==='/api/sgdb/game') return json({game:{id:12,name:'Jeu test'}});
    if(p==='/api/sgdb/assets') {
      await new Promise(r=>setTimeout(r,url.searchParams.has('first') ? 25 : 650));
      return json(Array.from({length:url.searchParams.has('first')?48:96},(_,i)=>({id:i,url:'/art/'+i+'/portrait',thumb:'/art/'+i+'/portrait',width:600,height:900,author:'Test'})));
    }
    if(p==='/api/media') return json([]);
    if(p==='/api/emulation') return json({romRoots:[],emulators:[],systems:[]});
    if(p==='/api/status') return json({version:libraryVersion,entries:games.length});
    if(p==='/api/deals') return json({items:[]});
    if(p==='/api/sys') return json({available:true,volume:45,muted:false,brightness:70,radios:[]});
    if(p==='/api/net') return json({type:'ethernet',online:true});
    return json({});
  }
  if(p.startsWith('/art/')) {
    artRequests++;
    res.setHeader('Content-Type','image/svg+xml'); res.setHeader('Cache-Control','max-age=300');
    const id=Number(p.split('/')[2])||0, hero=p.includes('hero');
    const hue=[186,266,28,210,12,275,36,168][id%8], title=games[id]?.name||'KaneMode';
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="'+(hero?1280:600)+'" height="'+(hero?540:900)+'"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl('+hue+',44%,32%)"/><stop offset="1" stop-color="hsl('+hue+',45%,9%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="75%" cy="34%" r="220" fill="hsl('+hue+',50%,62%)" opacity=".2"/><path d="M0 680 180 270 340 560 500 360 900 850Z" fill="#070c16" opacity=".5"/><text x="8%" y="80%" fill="white" font-family="sans-serif" font-size="'+(hero?40:27)+'" font-weight="700">'+title.replaceAll('&','&amp;')+'</text></svg>');

  }
  const match=p.match(/^\/v\/(current|baseline)\/(.*)$/);
  if(!match){res.writeHead(404);return res.end();}
  const [,kind,relative]=match;
  if(relative.includes('..')) {res.writeHead(403);return res.end();}
  let file=path.join(root,'ui',relative||'index.html');
  try {
    const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream';
    res.setHeader('Content-Type',type);res.end(fs.readFileSync(file));
  }catch{res.writeHead(404);res.end();}
});

(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,...(process.env.KANEMODE_BROWSER ? {executablePath:process.env.KANEMODE_BROWSER} : {})});
  const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    localStorage.setItem('km.settings',JSON.stringify({lang:'fr',bootMode:'none',splash:false,sounds:false,homePins:[{type:'game',id:'fixture:2'},{type:'collection',id:'c1'}]}));
    window.testNativeMessages=[];
    window.chrome.webview={postMessage(message){window.testNativeMessages.push(message);},addEventListener(){}};
  });
  const check=(label)=>console.log('PASS '+label);
  const settled=()=>page.waitForTimeout(300);
  const settingsSection=async(section)=>{
    await page.evaluate(section=>navigation.go('settings',{section}),section);
    await page.waitForFunction(section=>{
      const p=navigation.page('settings'),s=p.wrap?.lastElementChild;
      return p.section===section && s?.querySelector('.settings-section-title h2')?.textContent===p.side.querySelector('[data-key="sec:'+section+'"]').textContent && s.getAttribute('aria-busy')!=='true';
    },section);
    await settled();
  };
  const fit=async(label)=>{
    const failures=await page.evaluate(()=>{
      const root=navigation.currentPage().el,problems=[];
      for(const e of [root,...root.querySelectorAll('.settings-wrap > .settings,.set-row,.library-toolbar')]){
        if(e.scrollWidth>e.clientWidth+2) problems.push(e.className+' '+e.scrollWidth+' > '+e.clientWidth);
      }
      const hints=document.querySelector('#hints');
      if(hints.scrollWidth>hints.clientWidth+2) problems.push('Indications '+hints.scrollWidth+' > '+hints.clientWidth);
      return problems;
    });
    assert.deepEqual(failures,[],label);
  };
  const visibleFocus=async(label)=>{
    const result=await page.evaluate(()=>{
      const f=navigation.focused,r=f.getBoundingClientRect(),b=document.querySelector('#hints').getBoundingClientRect(),top=document.querySelector('#topbar').getBoundingClientRect();
      return {key:f.dataset.key,visible:r.left>=-2&&r.right<=innerWidth+2&&r.top>=top.bottom-2&&r.bottom<=b.top+2,active:document.activeElement===f,inert:!!f.closest('[inert]')};
    });
    assert.equal(result.visible,true,label+' '+JSON.stringify(result));
    assert.equal(result.active,true,label+' focus DOM');assert.equal(result.inert,false,label+' accessible');
  };
  try {
    await page.goto('http://127.0.0.1:'+server.address().port+'/v/current/index.html');
    await page.waitForSelector('#page-home.active [data-key="home-resume"]');
    await page.evaluate(async()=>{window.navigation=await import('./js/nav.js');window.core=await import('./js/core.js');window.widgets=await import('./js/widgets.js');});
    await settled();
    assert.equal(await page.locator('.home-info h1').isVisible(),false,'Pas de titre de reprise dupliqué');
    await page.evaluate(()=>navigation.setFocus(document.querySelector('[data-key="pin-collection:c1"]')));
    assert.equal(await page.locator('.home-info h1').textContent(),'Coop canapé');
    check('Accueil : reprise sans doublon, informations des collections actualisées');
    for(const section of ['personal','dolby','look','access','system']){
      await settingsSection(section);
      assert.equal(await page.evaluate(()=>navigation.focused.dataset.key),'sec:'+section);
    }
    check('Paramètres : cinq changements directs gardent la catégorie demandée');
    await settingsSection('personal');
    await page.keyboard.press('Enter');await settled();
    await visibleFocus('Entrer dans les réglages');
    const original=await page.evaluate(()=>navigation.focused.dataset.key);
    await page.keyboard.press('Tab');await visibleFocus('Tabulation');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>navigation.focused.dataset.key),original);
    await page.evaluate(()=>{window.answer=widgets.dialog({title:'Dialogue de vérification',buttons:[{label:'Annuler',value:false},{label:'Valider',value:true,primary:true}]});});
    assert.equal(await page.evaluate(()=>document.querySelector('#pages').inert),true);
    for(let i=0;i<5;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('#dialog').contains(document.activeElement)),true);}
    await page.keyboard.press('Escape');await settled();
    assert.equal(await page.evaluate(()=>document.querySelector('#pages').inert),false);
    assert.equal(await page.evaluate(()=>navigation.focused.dataset.key),original);
    await visibleFocus('Retour du dialogue');
    check('Clavier : Tab/Maj+Tab, dialogue limité à ses contrôles et retour au focus initial');
    await page.evaluate(()=>navigation.press('view'));await settled();
    assert.equal(await page.locator('#qam').getAttribute('aria-hidden'),'false');
    assert.equal(await page.locator('#qam [data-key="volume"]').getAttribute('aria-valuenow'),'45');
    assert.equal(await page.locator('#qam [data-key="volume"]').getAttribute('aria-label'),'Volume');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.querySelector('#qam').contains(document.activeElement)),true);
    await page.keyboard.press('Escape');await settled();
    assert.equal(await page.evaluate(()=>document.querySelector('#qam').inert),true);
    check('Accès rapide : contrôle de volume accessible et clavier limité au panneau');
    const sw=page.locator('[data-key="homeResume"]');
    await sw.click();assert.equal(await sw.getAttribute('aria-checked'),'false');await sw.click();
    assert.equal(await sw.getAttribute('aria-checked'),'true');
    assert.equal(await page.locator('[data-key="motionStyle-normal"]').getAttribute('aria-pressed'),'true');
    check('Contrôles : noms de jeux, interrupteurs et options exposent leur état accessible');
    await page.evaluate(()=>{
      for(let i=0;i<35;i++) core.lib.collections.push({id:'long'+i,name:'Collection au nom très long '+i,ids:['fixture:0']});
      navigation.go('library',{tab:'col:long34'});
    });await settled();
    const tabs=await page.evaluate(()=>{const strip=document.querySelector('.library-tabs'),tab=strip.querySelector('.active'),r=tab.getBoundingClientRect(),s=strip.getBoundingClientRect();return {scroll:strip.scrollWidth>strip.clientWidth,inside:r.left>=s.left-2&&r.right<=s.right+2,lines:new Set([...strip.querySelectorAll('.tab')].map(t=>t.offsetTop)).size};});
    assert.equal(tabs.scroll,true);assert.equal(tabs.inside,true,JSON.stringify(tabs));assert.equal(tabs.lines,1);
    await fit('Bibliothèque avec 36 collections');
    await page.evaluate(()=>navigation.press('rb'));await settled();
    assert.equal(await page.evaluate(()=>navigation.page('library').tab),'src:steam');
    check('Bibliothèque : 36 collections sur une ligne, onglet actif visible et RB fonctionnel');
    launchers=[{id:'epic',name:'Epic Games',installed:true}];
    games.push({...games[0],id:'epic:fixture',source:'epic',name:'Jeu Epic ajouté après le démarrage'});libraryVersion++;
    await page.evaluate(async()=>{await core.lib.load({background:true});navigation.go('library',{tab:'all'});});await settled();
    assert.equal(await page.locator('[data-key="epic:fixture"]').count(),1);
    await page.evaluate(()=>navigation.go('library',{tab:'src:epic'}));await settled();
    assert.equal(await page.locator('#page-library .card').count(),1);
    assert.equal(await page.evaluate(()=>core.lib.launchers.find(l=>l.id==='epic')?.installed),true);
    check('Nouvelle boutique Epic et jeu installé : visibles dans Tout et dans la catégorie Epic sans redémarrage');
    games.pop();launchers=[];libraryVersion++;
    await page.evaluate(async()=>{await core.lib.load();});
    await settingsSection('power');
    assert.equal(await page.locator('[data-key="preventIdleLock"]').getAttribute('aria-checked'),'true');
    await page.evaluate(()=>{navigation.setFocus(document.querySelector('[data-key="preventIdleLock"]'));navigation.press('a');});
    assert.equal(await page.evaluate(()=>testNativeMessages.filter(m=>m.type==='idle-protection').at(-1).enabled),false);
    await page.evaluate(()=>navigation.press('a'));
    assert.equal(await page.evaluate(()=>testNativeMessages.filter(m=>m.type==='idle-protection').at(-1).enabled),true);
    await page.evaluate(()=>{core.settings.dimAfter=1;core.settings.sleepAfterAC=0;core.settings.sleepAfterBattery=0;core.saveSettings();window.realNow=Date.now;Date.now=()=>realNow()+65000;});
    await page.waitForSelector('body.dimmed');
    await page.evaluate(()=>dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',movementX:0,movementY:0})));
    assert.equal(await page.evaluate(()=>document.body.classList.contains('dimmed')),true);
    await page.evaluate(()=>dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',movementX:1,movementY:0})));
    assert.equal(await page.evaluate(()=>document.body.classList.contains('dimmed')),false);
    await page.evaluate(()=>{Date.now=realNow;core.settings.dimAfter=5;core.saveSettings();});
    check('Protection Windows : activée par défaut, désactivable, sans annuler l’inactivité propre à KaneMode');
    let layouts=0;
    for(const [width,height,scale] of [[1280,720,100],[1280,720,125],[1280,720,150],[1920,1080,100],[1920,1080,150],[960,540,100],[960,540,150],[800,600,125]]){
      await page.setViewportSize({width,height});
      await page.evaluate(scale=>{core.settings.uiScale=scale;core.saveSettings();},scale);
      for(const section of ['personal','look','dolby','power']){
        await settingsSection(section);await fit(width+'×'+height+' '+scale+' % '+section);
        await page.evaluate(()=>navigation.page('settings').enter(navigation.page('settings').section));await settled();
        await visibleFocus(width+' '+scale+' '+section);
        const last=await page.evaluate(()=>navigation.navItems(navigation.page('settings').wrap.lastElementChild).at(-1)?.dataset.key);
        if(last){await page.evaluate(key=>navigation.focusIn(navigation.page('settings').wrap.lastElementChild,key,{scroll:'instant'}),last);await settled();await visibleFocus('Dernier réglage '+width+' '+scale+' '+section);}
        layouts++;
      }
      for(const id of ['home','library','game','search','add','media','emulation','artpicker']){
        await page.evaluate(id=>navigation.go(id,['game','artpicker'].includes(id)?{id:'fixture:0'}:{}),id);await settled();await fit(width+' '+scale+' '+id);layouts++;
      }
    }
    check(layouts+' mises en page : portable/TV, 960×540 à 1920×1080, zoom 100–150 %');
    await page.setViewportSize({width:1280,height:720});
    for(const lang of ['fr','en']){
      await page.evaluate(lang=>{core.settings.lang=lang;core.settings.uiScale=125;core.saveSettings();},lang);await page.reload();await page.waitForSelector('#page-home.active [data-nav]');
      await page.evaluate(async()=>{window.navigation=await import('./js/nav.js');window.core=await import('./js/core.js');window.widgets=await import('./js/widgets.js');});
      await settingsSection('personal');await fit('Traduction '+lang);
      await settingsSection('look');await fit('Traduction '+lang+' apparence');
      await settingsSection('power');await fit('Traduction '+lang+' veille');
    }
    check('Français et anglais : choix des réglages sans débordement');
    await page.evaluate(()=>{core.settings.lang='fr';core.settings.uiScale=100;core.settings.lowFx=true;core.settings.reduceMotion=true;core.saveSettings();navigation.go('home');});await settled();
    assert.equal(await page.evaluate(()=>getComputedStyle(navigation.focused).transitionDuration),'0s');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>{core.settings.reduceMotion=false;core.saveSettings();});
    assert.equal(await page.evaluate(()=>getComputedStyle(navigation.focused).transitionDuration),'0s');
    check('Effets allégés et réduction des mouvements préservés');
    const widget=await browser.newPage({viewport:{width:420,height:720}});
    widget.on('pageerror',e=>errors.push(e.message));
    await widget.addInitScript(()=>localStorage.setItem('km.settings',JSON.stringify({lang:'en',hudFilter:'sound',sounds:false})));
    await widget.goto('http://127.0.0.1:'+server.address().port+'/v/current/widget.html');
    await widget.waitForSelector('[data-key="tile:volume"]');
    await widget.evaluate(async()=>{window.navigation=await import('./js/nav.js');});
    await widget.locator('[data-key="tile:volume"]').click();
    await widget.waitForSelector('[data-key="sheet-slider"]');
    assert.equal(await widget.locator('.hud-sheet').getAttribute('aria-label'),'Volume');
    assert.equal(await widget.locator('[data-key="sheet-slider"]').getAttribute('aria-valuenow'),'45');
    assert.equal(await widget.evaluate(()=>document.querySelector('#hud').inert),true);
    await widget.keyboard.press('Tab');
    assert.equal(await widget.evaluate(()=>document.querySelector('.hud-sheet').contains(document.activeElement)),true);
    await widget.keyboard.press('Escape');await widget.waitForTimeout(300);
    assert.equal(await widget.evaluate(()=>document.querySelector('#hud').inert),false);
    assert.equal(await widget.evaluate(()=>document.activeElement.dataset.key),'tile:volume');
    assert.equal(await widget.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await widget.close();check('Widget : anglais, curseur accessible, dialogue et retour au focus, largeur 420 px');
    if(process.env.KANEMODE_UI_OUTPUT){
      fs.mkdirSync(dir,{recursive:true});await page.emulateMedia({reducedMotion:'no-preference'});
      await page.evaluate(()=>{core.settings.lowFx=false;core.settings.lang='fr';core.saveSettings();});await page.reload();await page.waitForSelector('#page-home.active [data-nav]');
      await page.evaluate(async()=>{window.navigation=await import('./js/nav.js');});
      for(const [id,params] of [['home',{}],['library',{}],['settings',{section:'personal'}],['settings',{section:'dolby'}]]){
        await page.evaluate(({id,params})=>navigation.go(id,params),{id,params});await page.waitForTimeout(500);await page.screenshot({path:path.join(dir,id+(params.section?'-'+params.section:'')+'.png')});
      }
    }
    assert.deepEqual(errors,[],'Aucune exception JavaScript');
    const dangerous=apiCalls.filter(c=>c.method==='POST'&&/^\/api\/(launch(?:\/|$)|power\/mode|sys(?:\/|$)|update\/apply)/.test(c.url));
    assert.deepEqual(dangerous,[],'Aucune action système pendant les essais');
    check('Aucune exception JavaScript ni action sur le système');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
