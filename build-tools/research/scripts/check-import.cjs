const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const version=process.argv[2]||'0.15.0';
assert(['0.15.0','0.16.1','0.16.15','0.16.27'].includes(version));
(async()=>{
 const assets=path.join(root,'extracted-'+version,'assets');
 const loaders=fs.readdirSync(assets).filter(f=>/^pack-snapshot-.*\.js$/.test(f));assert.equal(loaders.length,1);
 let loader;
 if(version==='0.16.27'){
  // The new loader imports unzip from the game bootstrap. Isolate it rather
  // than execute that bootstrap. Reuse the standalone fflate export shipped
  // in 0.16.15; snapshot/path/ZIP validation below remains the NEW loader's.
  const oldAssets=path.join(root,'extracted-0.16.15/assets');
  const oldName=fs.readdirSync(oldAssets).find(f=>/^pack-snapshot-.*\.js$/.test(f));
  globalThis.__snapshotUnzip=(await import(pathToFileURL(path.join(oldAssets,oldName)).href)).o;
  const original=fs.readFileSync(path.join(assets,loaders[0]),'utf8');
  assert(/^import\{d as e,f as t\}from"\.\/game-[^"]+\.js";/.test(original),'Review changed loader dependency');
  const isolated=original.replace(/^import\{d as e,f as t\}from"\.\/game-[^"]+\.js";/,'const t=globalThis.__snapshotUnzip;');
  loader=await import('data:text/javascript;base64,'+Buffer.from(isolated).toString('base64'));
  delete globalThis.__snapshotUnzip;
 }else loader=await import(pathToFileURL(path.join(assets,loaders[0])).href);
 const results=[];
 for(const name of ['PvZ2_Gardendless_Russian_'+version+'_preview.zip','PvZ2_Gardendless_Russian_'+version+'_with_Font_Fixer_preview.zip']){
  try {
   const snapshot=await loader.r(new Uint8Array(fs.readFileSync(path.join(root,'dist',name))));
   const manifestText=snapshot.readText('pack.json');
   const manifest=manifestText?JSON.parse(manifestText):null;
   const result={name,files:snapshot.listPaths().length,hasManifest:!!manifest,manifest,digest:snapshot.digest};
   results.push(result);
  }catch(error){results.push({name,error:error.message});}
 }
 fs.writeFileSync(path.join(root,'import-check'+(version==='0.15.0'?'':'-'+version)+'.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
 assert(results[0].hasManifest,'Standalone patch fails snapshot import');
 assert.equal(results[0].manifest.gameVersion,version);
})();
