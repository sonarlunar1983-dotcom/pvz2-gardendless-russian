const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const documents=['about','update'].map(name=>{
 const html=fs.readFileSync(path.join(root,'assets/documents-0.16.15',name+'.ru.html'),'utf8');
 assert(!/<script|\son\w+\s*=|javascript:/i.test(html),'Unexpected active document content');
 const sources=['en','zh'].map(language=>fs.readFileSync(path.join(root,'extracted-0.16.15/docs',name+'.'+language+'.md'),'utf8'));
 if(name==='about'){
  assert.equal((html.match(/<h3>/g)||[]).length,9);
  const authors=s=>[...s.matchAll(/class="author">([^<]+)</g)].map(m=>m[1]).sort();
  assert.deepEqual(authors(html),authors(sources[0]),'Author credits changed');
  assert.deepEqual([...html.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map(m=>m[1]).sort(),[...sources[0].matchAll(/<kbd>([^<]+)<\/kbd>/g)].map(m=>m[1]).sort(),'Hotkeys changed');
 } else assert.equal((html.match(/<li /g)||[]).length,11);
 return {name,title:name==='about'?'Об игре':'Обновления',html,sources,sourceSha256:sources.map(s=>crypto.createHash('sha256').update(s).digest('hex'))};
});
async function bundle(){
 const fork=path.resolve(root,'../pvz2-gardendless-russian-0.16.15');
 const {marked}=await import(require('node:url').pathToFileURL(path.join(root,'extracted-0.16.27/vendor/marked.esm.js')));
 process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'tools/font-browser/browsers');
 process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS='1';
 const {chromium}=require(path.join(root,'tools/font-browser/node_modules/playwright'));
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  for(const name of ['about','update']){
   const html=fs.readFileSync(path.join(fork,'localization/0.16.27/documents',name+'.ru.html'),'utf8');
   assert(!/<script|\son\w+\s*=|javascript:/i.test(html));
   const sources=['en','zh'].map(language=>fs.readFileSync(path.join(root,'extracted-0.16.27/docs',name+'.'+language+'.md'),'utf8'));
   const textSignatures=[];
   for(const source of sources)textSignatures.push(await page.evaluate(html=>{const node=document.createElement('article');node.innerHTML=html;return node.textContent.replace(/\s+/g,' ').trim();},marked.parse(source,{gfm:true})));
   const authors=s=>[...s.matchAll(/class="author">([^<]+)</g)].map(m=>m[1]).sort();
   if(name==='about')assert.deepEqual(authors(html),authors(sources[0]));
   documents.push({name,version:'0.16.27',title:name==='about'?'Об игре':'Обновления',html,sources,textSignatures,sourceSha256:sources.map(s=>crypto.createHash('sha256').update(s).digest('hex'))});
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(root,'src/font-fixer/document-translations.json'),JSON.stringify(documents,null,2));
 console.log('Bundled legacy and 0.16.27 documents with exact native text signatures');
}
bundle().catch(error=>{console.error(error);process.exitCode=1;});
