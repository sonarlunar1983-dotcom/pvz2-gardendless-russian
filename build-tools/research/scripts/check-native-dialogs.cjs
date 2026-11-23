// Isolated UI fixture. Loads dialog/Markdown modules only, never the game runtime.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),version=process.argv[2]||'0.16.31',extracted=path.join(root,'extracted-'+version);
assert(['0.16.27','0.16.31'].includes(version));
process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'tools/font-browser/browsers');
process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS='1';
const {chromium}=require(path.join(root,'tools/font-browser/node_modules/playwright'));
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'src/font-fixer',name+'.json'),'utf8'));
const docs=read('document-translations');
let installer=fs.readFileSync(path.join(root,'src/font-fixer/font-fix.js'),'utf8');
for(const [key,value] of Object.entries({CONFIG:{enabled:true,scanIntervalMs:250},UI_TRANSLATIONS:read('ui-translations'),FONT_ASSETS:[],OBJECTIVE_TRANSLATIONS:read('objective-translations'),DOCUMENT_TRANSLATIONS:docs}))installer=installer.replace('__'+key+'_JSON__',()=>JSON.stringify(value));
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(req.url.split('?')[0]).slice(1);
 if(version==='0.16.31'&&name.startsWith('assets/')){const file=path.join(extracted,name);if(!/^assets\/(game-window-[\w-]+\.css|game-default-[\w-]+\.ttf)$/.test(name)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'font/ttf');res.end(fs.readFileSync(file));return;}
 if(version==='0.16.31'&&name==='game-window.css'){res.writeHead(204);res.end();return;}
 if(!name){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/game-window.css"><body>Isolated UI fixture</body>');return;}
 if(!/^(game-dialog\.js|game-markdown\.js|game-window\.css|vendor\/(marked\.esm|purify\.min)\.js)$/.test(name)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(extracted,name)));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:1000}});
  await page.goto('http://127.0.0.1:'+server.address().port);
  if(version==='0.16.31')await page.evaluate(fs.readFileSync(path.join(root,'build/native-fixture-0.16.31.js'),'utf8'));
  await page.evaluate(async current=>{
   window.electronAPI={playAudio(){}};
   if(!current){
   window.makeDialog=(await import('/game-dialog.js')).createGameDialog;
   window.renderMarkdown=(await import('/game-markdown.js')).renderGameMarkdown;
   }
   window.fixtureLanguage='ru';window.cc={js:{getClassByName:()=>({getString:()=>window.fixtureLanguage==='ru'?'__probe_ru':'__probe_en'})},director:{on(){},off(){},getScene:()=>null}};
  },version==='0.16.31');
  await page.evaluate(installer);
  let translated=0;
  for(const doc of docs.filter(d=>d.version===version))for(const source of doc.sources){
   await page.evaluate(source=>{
    document.querySelectorAll('dialog').forEach(d=>d.remove());
    const api=window.makeDialog('Game document');const dialog=api.dialog||api;
    const article=document.createElement('article');article.className='game-markdown';article.innerHTML=window.renderMarkdown(source);
    article.addEventListener('click',()=>window.fixtureClicks=(window.fixtureClicks||0)+1);
    const status=document.createElement('p');status.className='game-dialog-error';status.hidden=true;article.append(status);
    window.fixtureArticle=article;window.fixtureError=status;window.fixtureOriginal=article.innerHTML;
    const title=dialog.querySelector('h2');const icon=document.createElement('img');icon.className='game-dialog-icon';title.prepend(icon);window.fixtureIcon=icon;
    dialog.append(article);if(!dialog.isConnected)document.body.append(dialog);dialog.showModal();
   },source);
   await page.waitForFunction(title=>document.querySelector('dialog').getAttribute('aria-label')===title,doc.title);
   assert.equal(await page.locator('dialog article h3').count(),doc.name==='about'?9:0);
   assert.equal(await page.locator('dialog article li').count(),(doc.html.match(/<li[ >]/g)||[]).length);
   assert(await page.evaluate(()=>window.fixtureArticle===document.querySelector('article')&&window.fixtureIcon.isConnected&&window.fixtureError.isConnected));
   await page.locator('article h1').click();assert(await page.evaluate(()=>window.fixtureClicks>0));
   await page.screenshot({path:path.join(root,'dist/native-'+doc.name+'-1.43.png')});
   await page.evaluate(()=>window.__pvzRuFontFix.applyConfig({enabled:false}));
   assert(await page.evaluate(()=>window.fixtureArticle.innerHTML===window.fixtureOriginal&&window.fixtureError.isConnected));
   await page.evaluate(()=>window.__pvzRuFontFix.applyConfig({enabled:true}));translated++;
  }
  await page.evaluate(()=>{
   document.querySelectorAll('dialog').forEach(d=>d.remove());
   const api=window.makeDialog('Community levels'),dialog=api.dialog||api;
   const body=document.createElement('div');body.className='game-github';body.innerHTML='<div class="game-github-tools"><input placeholder="Search levels" aria-label="Search levels"><button>Open local level</button></div><div class="game-github-list"><div class="game-github-row"><button class="game-github-name">Play<span class="game-github-record">Cleared</span></button><button data-play="custom.json">Play</button></div></div><section class="game-github-details"><h3>Like</h3><p>Author: Play</p><p class="game-github-path">Play/Like.json</p><article class="game-markdown">Community levels</article><button title="Like" aria-label="Like">👍</button></section>';
   body.querySelector('input').value='user query';window.fixturePlay=body.querySelector('[data-play]');window.fixturePlay.onclick=()=>window.fixturePlayed=true;
   dialog.append(body);if(!dialog.isConnected)document.body.append(dialog);dialog.showModal();
  });
  await page.waitForFunction(()=>document.querySelector('[data-play]').textContent==='Играть');
  assert.equal(await page.locator('input').inputValue(),'user query');
  assert.equal(await page.locator('.game-github-name').evaluate(n=>n.firstChild.nodeValue),'Play');
  assert.equal(await page.locator('.game-github-details h3').textContent(),'Like');
  assert.equal(await page.locator('.game-github-details article').textContent(),'Community levels');
  assert.equal(await page.locator('.game-github-path').textContent(),'Play/Like.json');
  assert.equal(await page.locator('.game-github-details p').first().textContent(),'Автор: Play');
  await page.locator('[data-play]').click();assert(await page.evaluate(()=>window.fixturePlayed));
  await page.evaluate(()=>window.fixtureLanguage='en');await page.waitForFunction(()=>document.querySelector('[data-play]').textContent==='Play');
  await page.evaluate(()=>window.fixtureLanguage='ru');await page.waitForFunction(()=>document.querySelector('[data-play]').textContent==='Играть');
  await page.evaluate(()=>window.__pvzRuFontFix.dispose());
  assert.equal(await page.locator('[data-play]').textContent(),'Play');
  if(version==='0.16.31'){
   await page.evaluate(()=>{
    delete window.__pvzRuFontFix;
    document.querySelectorAll('dialog').forEach(d=>d.remove());
    const dialog=window.makeDialog('GitHub Levels');
    dialog.classList.add('game-github-dialog');
    const header=document.createElement('div');header.className='game-github-header-actions';header.innerHTML='<button aria-label="GitHub repository"><svg></svg></button><button><svg></svg>Play Custom Level</button>';dialog.querySelector('header').append(header);
    const body=document.createElement('div');body.className='game-github';
    body.innerHTML='<p class="game-github-status" role="status">Loading levels (3/9) Play/Ready.json · Offline catalog</p><div class="game-github-tools"><input placeholder="Search levels" value="custom query"></div><nav class="game-github-breadcrumb"><button>All levels</button><button class="game-github-back">← Back</button></nav><section class="game-github-details"><div class="game-github-info"><h3>Play Level</h3><p>Author: Never played</p><p>Last Played: Never played</p><p class="game-github-victory">Last Victory: Not beaten</p><p class="game-github-path"><span class="game-github-info-label">Path:</span><br>Ready/Play.json</p><article class="game-markdown">Select a level to view details</article></div><div class="game-github-footer"><button class="game-github-play"><svg></svg>Play Level</button><div class="game-github-votes"><button title="Like" aria-label="Like" aria-pressed="false">😊</button></div></div></section>';
    for(const svg of [...header.querySelectorAll('svg'),...body.querySelectorAll('svg')]){svg.setAttribute('width','18');svg.setAttribute('height','18');}
    const panes=document.createElement('div');panes.className='game-github-panes';
    const list=document.createElement('div');list.className='game-github-list';
    const details=body.querySelector('.game-github-details');panes.append(list,details);body.append(panes);
    dialog.append(body);window.fixtureVote=body.querySelector('[aria-pressed]');window.fixtureVote.onclick=()=>window.fixtureVote.setAttribute('aria-pressed','true');dialog.showModal();
   });
   await page.evaluate(installer);
   await page.waitForFunction(()=>document.querySelector('.game-github-play').textContent==='Играть');
   assert.equal(await page.locator('.game-github-status').textContent(),'Загрузка уровней (3/9) Play/Ready.json · Локальный каталог');
   assert.deepEqual(await page.locator('.game-github-info > p:not(.game-github-path)').allTextContents(),['Автор: Never played','Последняя игра: Ещё не сыгран','Последняя победа: Не пройден']);
   assert.equal(await page.locator('.game-github-info h3').textContent(),'Play Level');
   assert.equal(await page.locator('.game-github-info article').textContent(),'Select a level to view details');
   assert.equal(await page.locator('input').inputValue(),'custom query');
   assert.equal(await page.locator('dialog').evaluate(n=>n.style.fontFamily),'"Segoe UI", sans-serif');
   const transform=await page.locator('dialog').evaluate(n=>n.style.transform);
   assert.equal(await page.locator('svg').count(),4);
   await page.locator('.game-github-votes button').click();assert.equal(await page.locator('.game-github-votes button').getAttribute('aria-pressed'),'true');
   // New game writes must replace the saved source, and disable must restore them.
   await page.evaluate(()=>document.querySelector('.game-github-status').textContent='Ready');
   await page.waitForFunction(()=>document.querySelector('.game-github-status').textContent==='Готово');
   await page.screenshot({path:path.join(root,'dist/native-github-1.43.png')});
   await page.evaluate(()=>window.__pvzRuFontFix.dispose());
   assert.equal(await page.locator('.game-github-status').textContent(),'Ready');
   assert.equal(await page.locator('.game-github-play').textContent(),'Play Level');
   assert.equal(await page.locator('dialog').evaluate(n=>n.style.fontFamily),'');
   assert.equal(await page.locator('dialog').evaluate(n=>n.style.transform),transform);
  }
  const report={documents:translated,userContentPreserved:true,inputPreserved:true,handlersPreserved:true,languageSwitch:true,disposeRestoresOriginal:true};
  fs.writeFileSync(path.join(root,'dist/native-dialogs-check-1.43.json'),JSON.stringify(report,null,2));console.log(report);
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
