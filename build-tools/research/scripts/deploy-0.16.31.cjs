// Deploys localization plus the official game archive/EXE. Never starts either.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),gameDirectory='E:\\TGames\\pvzge';
const manifestPath=path.join(root,'deployment-0.16.31.json');
const deployment=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
assert.equal(deployment.gameVersion,'0.16.31');assert.equal(deployment.artifacts.length,3);
assert(fs.statSync(gameDirectory).isDirectory());
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const item of deployment.artifacts){
 assert.equal(path.basename(item.name),item.name);
 assert(/^(PvZ2_Gardendless_Russian_0\.16\.31_(preview|with_Font_Fixer_preview)\.zip|PvZ2_Gardendless_Font_Fixer_1\.43\.exe)$/.test(item.name));
 const source=path.join(root,'dist',item.name);
 assert.equal(hash(source),item.sha256,'Source digest mismatch');
 assert.equal(fs.readFileSync(source+'.sha256','utf8').trim().split(/\s+/)[0],item.sha256);
}
for(const item of deployment.artifacts){
 const source=path.join(root,'dist',item.name),destination=path.join(gameDirectory,item.name);
 fs.copyFileSync(source,destination);fs.copyFileSync(source+'.sha256',destination+'.sha256');
 assert.equal(hash(destination),item.sha256,'Deployed digest mismatch');
 console.log('Verified '+item.name);
}
async function deployGame(){
 const url='https://storage.pvzge.com/pvzge-0.16.31.zip';
 const archiveName='pvzge-0.16.31.zip',exeName='pvzge-0.16.31.exe';
 const archive=path.join(gameDirectory,archiveName),exe=path.join(gameDirectory,exeName);
 const expectedArchive='db736dec4448a86da4f47e74f9b1d8fee7a2e7ea2ba8c44c1692c711ec3b382f';
 const expectedExe='ac9a3449c4ba7d310e7ac525e589198a06777dc1c033b39c592d6adeac79c86d';
 const largeHash=async file=>{const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);return digest.digest('hex');};
 if(!fs.existsSync(archive)){
  console.log('Downloading official game archive to '+archive);
  const temporary=archive+'.download';
  execFileSync('curl.exe',['--fail','--location','--retry','2','--connect-timeout','30','--silent','--show-error','--output',temporary,url],{stdio:'inherit'});
  assert.equal(await largeHash(temporary),expectedArchive,'Official archive differs from the verified GitHub distribution');
  fs.renameSync(temporary,archive);
 }
 assert.equal(await largeHash(archive),expectedArchive,'Game archive digest mismatch');
 if(fs.existsSync(exe))assert.equal(await largeHash(exe),expectedExe,'Existing game EXE differs; refusing to overwrite it');
 else execFileSync('C:\\Program Files\\7-Zip\\7z.exe',['e',archive,'-o'+gameDirectory,'-y',exeName,'-bso0','-bsp0'],{stdio:'inherit'});
 assert.equal(await largeHash(exe),expectedExe,'Extracted game EXE digest mismatch');
 for(const [name,digest] of [[archiveName,expectedArchive],[exeName,expectedExe]])fs.writeFileSync(path.join(gameDirectory,name+'.sha256'),digest+'  '+name+'\n');
 deployment.deployment={copiedToGameDirectory:true,gameDirectory,copyVerifiedAt:new Date().toISOString()};
 deployment.gameDeployment={sourceUrl:url,archive:{name:archiveName,sha256:expectedArchive,size:fs.statSync(archive).size},executable:{name:exeName,sha256:expectedExe,size:fs.statSync(exe).size},extractedTo:gameDirectory,verifiedAt:new Date().toISOString(),gameLaunched:false};
 fs.writeFileSync(manifestPath,JSON.stringify(deployment,null,2));
 console.log('Verified game archive and extracted EXE; game was not launched');
}
deployGame().catch(error=>{console.error(error.message);process.exitCode=1;});
