const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const version=process.argv[2]||'0.16.1';
assert(['0.16.1','0.16.15','0.16.27','0.16.31'].includes(version));
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const lang=read('build/pack-'+version+'/jsons/lang/lang.json');
const templates=Object.values(lang.InGameScene.Challenge).map(({en,ru})=>({en,ru}));
let custom=0;
function visit(v){if(!v||typeof v!=='object')return;
 if(Array.isArray(v.DescriptionsMultilanguage))for(const item of v.DescriptionsMultilanguage){
  if(typeof item.en==='string'&&item.en&&typeof item.ru==='string'){templates.push({en:item.en,ru:item.ru});custom++;}
 }
 for(const child of Object.values(v))visit(child);
}
function files(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
 const file=path.join(dir,entry.name);if(entry.isDirectory())files(file);else if(file.endsWith('.json'))visit(JSON.parse(fs.readFileSync(file,'utf8')));
}}
files(path.join(root,'build/pack-'+version+'/jsons'));
const unique=new Map();for(const t of templates){if(unique.has(t.en))assert.equal(unique.get(t.en),t.ru,'Ambiguous objective');unique.set(t.en,t.ru);}
const worlds={};for(const v of Object.values(lang.WorldMapScene.World))if(v.Name?.en&&v.Name?.ru)worlds[v.Name.en]=v.Name.ru;
const result={templates:[...unique].map(([en,ru])=>({en,ru})),worlds};
fs.writeFileSync(path.join(root,'src/font-fixer/objective-translations.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({objectiveTemplates:result.templates.length,customObjectives:custom}));
