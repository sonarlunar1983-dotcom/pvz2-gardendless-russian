const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const version=process.argv[2]||'0.16.1';
assert(['0.16.1','0.16.15','0.16.27'].includes(version));
const read = p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const prefab = read('extracted-0.16.1/assets/resources/import/0d/0de92d8b4.json');
let source;
function visit(v) { if(v && typeof v === 'object') { if(v.GameInfo) {assert.equal(source,undefined);source=v;} for(const c of Object.values(v))visit(c); } }
visit(prefab);
const ru = read('assets/info-ru-0.16.1.json');
assert.equal(ru.GameInfo.length,source.GameInfo.length);
assert.equal(ru.FaQ.length,source.FaQ.length);
// Reproduce InfoWindow.readObject, including its misspelled WritenBy property.
function render(v, translated=false) {
 let out=v.GameInfo.map(t=>'\t'+t+'\n').join('')+'\n\n'+(translated?'Частые вопросы: \n':'FaQ: \n');
 for(const q of v.FaQ)out+='<color=#ff0000>'+(translated?'Вопрос: ':'Q: ')+q.Q+'</color>\n<color=#00a700>'+(translated?'Ответ:\n':'A:\n')+q.A.map(t=>'\t    '+t+'\n').join('')+'\n</color>';
 return out+'\n<color=#ff0000>'+v.AboutSetting.Title+'\n</color>'+v.AboutSetting.Elements.map(t=>t+'\n').join('')+(translated?'':v.WritenBy);
}
// Keep legacy InfoWindow translations for users who select the older game EXE.
const mapPath=path.join(root,'assets/ui-translations-compiled-'+version+'.json');
const map=read('assets/ui-translations-compiled-'+version+'.json');
const original=render(source),translated=render(ru,true);
map[original]=translated;
map[original.replace(/undefined$/,'')]=translated;
map['GAME INFO']='ОБ ИГРЕ';
fs.writeFileSync(mapPath,JSON.stringify(map,null,2));
fs.writeFileSync(path.join(root,'info-ui-report.json'),JSON.stringify({original,translated,questions:ru.FaQ.length},null,2));
console.log('InfoWindow: '+ru.GameInfo.length+' credits/information paragraphs, '+ru.FaQ.length+' FAQ entries');
