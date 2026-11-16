// Isolated UI fixture. Loads dialog/Markdown modules only, never the game runtime.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),extracted=path.join(root,'extracted-0.16.27');
process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'tools/font-browser/browsers');
process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS='1';
const {chromium}=require(path.join(root,'tools/font-browser/node_modules/playwright'));
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'src/font-fixer',name+'.json'),'utf8'));
const docs=read('document-translations');
let installer=fs.readFileSync(path.join(root,'src/font-fixer/font-fix.js'),'utf8');
for(const [key,value] of Object.entries({CONFIG:{enabled:true,scanIntervalMs:250},UI_TRANSLATIONS:read('ui-translations'),FONT_ASSETS:[],OBJECTIVE_TRANSLATIONS:read('objective-translations'),DOCUMENT_TRANSLATIONS:docs}))installer=installer.replace('__'+key+'_JSON__',()=>JSON.stringify(value));
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(req.url.split('?')[0]).slice(1);
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
  await page.evaluate(async()=>{
   window.makeDialog=(await import('/game-dialog.js')).createGameDialog;
   window.renderMarkdown=(await import('/game-markdown.js')).renderGameMarkdown;
   window.fixtureLanguage='ru';window.cc={js:{getClassByName:()=>({getString:()=>window.fixtureLanguage==='ru'?'__probe_ru':'__probe_en'})},director:{on(){},off(){},getScene:()=>null}};
  });
  await page.evaluate(installer);
  let translated=0;
  for(const doc of docs.filter(d=>d.version==='0.16.27'))for(const source of doc.sources){
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
   await page.screenshot({path:path.join(root,'dist/native-'+doc.name+'-1.42.png')});
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
  const report={documents:translated,userContentPreserved:true,inputPreserved:true,handlersPreserved:true,languageSwitch:true,disposeRestoresOriginal:true};
  fs.writeFileSync(path.join(root,'dist/native-dialogs-check-1.42.json'),JSON.stringify(report,null,2));console.log(report);
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
