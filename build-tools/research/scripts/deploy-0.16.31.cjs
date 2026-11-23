// Copies prepared localization artifacts only. Never starts the game or helper.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
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
deployment.deployment={copiedToGameDirectory:true,gameDirectory,copyVerifiedAt:new Date().toISOString()};
fs.writeFileSync(manifestPath,JSON.stringify(deployment,null,2));
