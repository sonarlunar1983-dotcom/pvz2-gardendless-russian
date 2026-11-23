const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const version=process.argv[2]||'0.16.1';
assert(['0.16.1','0.16.15','0.16.27','0.16.31'].includes(version));
const core=JSON.parse(fs.readFileSync(path.join(root,'assets/ui-translations-0.16.1.json'),'utf8'));
if(['0.16.15','0.16.27','0.16.31'].includes(version))Object.assign(core,JSON.parse(fs.readFileSync(path.join(root,'assets/ui-translations-0.16.15.json'),'utf8')));
if(['0.16.27','0.16.31'].includes(version))Object.assign(core,JSON.parse(fs.readFileSync(path.join(root,'assets/ui-translations-0.16.27.json'),'utf8')));
if(version==='0.16.31')Object.assign(core,JSON.parse(fs.readFileSync(path.join(root,'assets/ui-translations-0.16.31.json'),'utf8')));
const events=JSON.parse(fs.readFileSync(path.join(root,'build/pack-'+version+'/jsons/features/EventList.json'),'utf8'));
const values=new Map();let nodes=0;
function visit(v){if(!v||typeof v!=='object')return;if(typeof v.en==='string'&&typeof v.ru==='string'){
 nodes++;if(!values.has(v.en))values.set(v.en,new Set());values.get(v.en).add(v.ru);
}for(const c of Object.values(v))visit(c);}
visit(events);
const merged={...core};
for(const [en,translations] of values){assert.equal(translations.size,1,'Ambiguous event translation: '+en);const ru=[...translations][0];if(Object.hasOwn(merged,en))assert.equal(merged[en],ru,'Conflicting UI translation');merged[en]=ru;}
const lang=JSON.parse(fs.readFileSync(path.join(root,'build/pack-'+version+'/jsons/lang/lang.json'),'utf8'));
let arcadeNodes=0;
function arcade(v){if(!v||typeof v!=='object')return;if(typeof v.en==='string'&&typeof v.ru==='string'){
 arcadeNodes++;if(Object.hasOwn(merged,v.en))assert.equal(merged[v.en],v.ru,'Conflicting arcade translation');merged[v.en]=v.ru;
}for(const c of Object.values(v))arcade(c);}
arcade(lang.Arcade);
const prefab=JSON.parse(fs.readFileSync(path.join(root,'extracted-'+version+'/assets/resources/import/08/0873b766d.json'),'utf8'));
const tutorials=new Set();
function findTutorial(v){if(typeof v==='string'&&v.startsWith('Try multiple times, follow the clues,'))tutorials.add(v);else if(v&&typeof v==='object')for(const c of Object.values(v))findTutorial(c);}
findTutorial(prefab);assert.equal(tutorials.size,1,'Arcade tutorial source was not uniquely identified');
const tutorial=[...tutorials][0],tutorialVariants=[...new Set([tutorial,tutorial.replace(/\\n/g,'\n')])];
const translatedTutorial='Пробуйте разные варианты,\nследуйте подсказкам и раскройте шифр растений!\n\nПравая кнопка мыши очищает ячейку.\n\nПервая успешная разгадка за день приносит самоцветы.\n\nЧем меньше попыток и сложнее шифр,\nтем больше награда!';
for(const variant of tutorialVariants)merged[variant]=translatedTutorial;
fs.writeFileSync(path.join(root,'assets/ui-translations-compiled-'+version+'.json'),JSON.stringify(merged,null,2));
fs.writeFileSync(path.join(root,'event-ui-report.json'),JSON.stringify({eventTextNodes:nodes,distinctEventSources:values.size,coreCaptions:Object.keys(core).length,arcadeNodes,tutorialVariants,totalCaptions:Object.keys(merged).length},null,2));
console.log(JSON.stringify({eventTextNodes:nodes,distinctEventSources:values.size,arcadeNodes,totalCaptions:Object.keys(merged).length}));
