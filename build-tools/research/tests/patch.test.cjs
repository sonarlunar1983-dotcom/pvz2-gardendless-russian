const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const version=process.env.PATCH_VERSION||'0.15.0';
const expected={'0.15.0':{files:285,texts:7215,packVersion:'1.1.0'},'0.16.1':{files:281,texts:7284,packVersion:'1.2.3'},'0.16.15':{files:307,texts:7529,packVersion:'1.3.0'},'0.16.27':{files:308,texts:7566,packVersion:'1.3.1'}}[version];
assert(expected,'Unknown test target');
const output=path.join(root,'build/pack-'+version);
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
const dataFiles=files(output).filter(f=>path.basename(f)!=='pack.json');
function strip(v){if(Array.isArray(v))return v.map(strip);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>k!=='ru'&&k!=='_languages').map(([k,c])=>[k,strip(c)]));return v;}
function texts(v,visit,p=''){if(!v||typeof v!=='object')return;if(!Array.isArray(v)&&['en','zh','ru'].some(k=>typeof v[k]==='string')){visit(v,p);return;}for(const [k,c] of Object.entries(v))if(k!=='_languages')texts(c,visit,p+'/'+k);}
test('every packaged data file preserves all target-version data and array order',()=>{
 assert.equal(dataFiles.length,expected.files);
 for(const file of dataFiles){const rel=path.relative(output,file);assert.deepEqual(strip(read(file)),strip(read(path.join(root,'base-'+version,rel))),rel);}
});
test('all packaged text nodes have Russian text; nonempty source does not become empty',()=>{
 let count=0;for(const file of dataFiles)texts(read(file),(node,p)=>{assert.equal(typeof node.ru,'string',file+p);if((node.en||'').trim()||(node.zh||'').trim())assert(node.ru.trim(),file+p);count++;});
 assert.equal(count,expected.texts);assert.equal(read(path.join(root,'build-report'+(version==='0.15.0'?'':'-'+version)+'.json')).pending.length,0);
});
test('runtime substitution and formatting tokens remain intact',()=>{
 const tokens=s=>(s.match(/<[^<>\s]+>|\{[^{}]+\}|%\d*\$?[sdif]|\[[A-Z][A-Z0-9_]*\]/g)||[]).filter(t=>!['<S>','<ZS>','<TS>'].includes(t)).sort();
 for(const file of dataFiles)texts(read(file),(node,p)=>{if(typeof node.en==='string')assert.deepEqual(tokens(node.ru),tokens(node.en),file+p);});
});
test('manifest targets the requested version and language registration preserves other languages',()=>{
 const manifest=read(path.join(output,'pack.json'));assert.equal(manifest.gameVersion,version);assert.equal(manifest.version,expected.packVersion);assert.equal(manifest.packFormatVersion,1);
 const lang=read(path.join(output,'jsons/lang/lang.json'));const original=read(path.join(root,'base-'+version+'/jsons/lang/lang.json'));
 assert.deepEqual(lang._languages.filter(l=>l.code!=='ru'),(original._languages||[]).filter(l=>l.code!=='ru'));
 assert.deepEqual(lang._languages.filter(l=>l.code==='ru'),[{code:'ru',name:'Русский',isCJK:false}]);
});
test('0.16.1 includes new tutorial and GitHub UI, without restoring retired embedded levels',{skip:version==='0.15.0'},()=>{
 const lang=read(path.join(output,'jsons/lang/lang.json'));
 assert.equal(lang.GitHubLevelWindow.Title.ru,'Уровни GitHub');
 assert.equal(lang.Tutorial['[PREMIUM_TITLE_0]'].ru,'ЗАБЛОКИРОВАНО');
 for(const level of ['bank_theft1','random_egypt','rhythm1'])assert(!fs.existsSync(path.join(output,'jsons/levels/'+level+'.json')));
 assert(fs.existsSync(path.join(output,'jsons/levels/megagatling1.json')));
 const plants=read(path.join(output,'jsons/features/PlantFeatures.json')).PLANTS;
 assert.equal(plants.find(p=>p.CODENAME==='gatling_mgp').PROPS,'RTID(gatling_mgp@PlantProps)');
 assert.deepEqual(read(path.join(root,'base-'+version+'/jsons/lang/lang.json')),read(path.join(root,'base-'+version+'/jsons/multilanguages/InGameLyrics.json')));
});
test('Almanac family labels are shortened without changing quest names',{skip:version==='0.15.0'},()=>{
 const lang=read(path.join(output,'jsons/lang/lang.json'));
 const previous=read(path.join(root,'build/pack-0.15.0/jsons/lang/lang.json'));
 let changed=0;
 for(const [key,value] of Object.entries(previous.PlantFamily)){
  const expected=value.ru.replace(/^Семейство /,'');
  assert.equal(lang.PlantFamily[key].ru,expected,key);
  if(value.ru!==expected)changed++;
 }
 assert.equal(changed,14);
 assert.equal(lang.PlantFamily.Electricity.ru,'Электромяты');
 assert.equal(lang.LevelName['[EPIC_PLANT_ARMA_LEVEL_NAME]'].ru,previous.LevelName['[EPIC_PLANT_ARMA_LEVEL_NAME]'].ru);
});
test('FPS caption and zombie descriptors use the requested wording in their own sections',{skip:version==='0.15.0'},()=>{
 const lang=read(path.join(output,'jsons/lang/lang.json'));
 assert.equal(lang.SettingLyrics.AnimationMaxFrameRate.ru,'Лимит FPS');
 assert.equal(lang.PlantMedals.Description.ru,'Откройте медаль каждого растения,\nиспользовав <TARGETBOOSTCOUNT> усиления.');
 const zombie=read(path.join(output,'jsons/objects/ZombieAlmanac.json'));
 const groups={SPEED:new Map(),TOUGHNESS:new Map()};
 for(const object of zombie.objects)for(const element of object.objdata.Elements||[]){
  if(groups[element.TYPE])groups[element.TYPE].set(element.SORT.ru,(groups[element.TYPE].get(element.SORT.ru)||0)+1);
 }
 for(const [value,count] of Object.entries({'Медленная':6,'Быстрая':62,'Огромная':14,'Обычная':107}))assert.equal(groups.SPEED.get(value),count,value);
 for(const [value,count] of Object.entries({'Огромная':13,'Низкая':51,'Почти высокая':54,'Высокая':25,'Выше средней':71,'Бессмертный':13,'Бессмертный, низкий':1,'Чрезвычайно огромная':4}))assert.equal(groups.TOUGHNESS.get(value),count,value);
 for(const value of ['Ползучий','Голодный','Бешеный','Обычный'])assert(!groups.SPEED.has(value));
 for(const value of ['Огромный','Средний','Защищённый','Механизированный','Плотный','Закалённый','Прочный','Неумирающий'])assert(!groups.TOUGHNESS.has(value));
 assert.equal(groups.SPEED.get('Быстрый'),24);assert.equal(groups.SPEED.get('Медлительный'),16);
 const previous=read(path.join(root,'build/pack-0.15.0/jsons/objects/ZombieAlmanac.json'));
 for(let i=0;i<zombie.objects.length;i++)assert.deepEqual(zombie.objects[i].objdata.Introduction,previous.objects[i].objdata.Introduction);
});
test('new hybrids, new quest and formerly omitted vase instruction are translated',()=>{
 const plants=read(path.join(output,'jsons/features/PlantFeatures.json')).PLANTS;
 const hybrids=plants.filter(p=>p.CODENAME.endsWith('_mgp'));assert.equal(hybrids.length,16);for(const p of hybrids)assert(/[А-Яа-яЁё]/.test(p.NAME.ru));
 for(const level of ['arma5','arma8','lod_274'])assert(fs.existsSync(path.join(output,'jsons/levels/'+level+'.json')));
 const lang=read(path.join(output,'jsons/lang/lang.json'));assert(lang.LoadingTips.some(t=>t.ru.includes('вместе')));
});

test('0.16.15 translates new plants, music packs and decks while preserving reordered tips',{skip:!['0.16.15','0.16.27'].includes(version)},()=>{
 const lang=read(path.join(output,'jsons/lang/lang.json'));
 const previous=read(path.join(root,'build/pack-0.16.1/jsons/lang/lang.json'));
 assert.equal(lang.SettingLyrics.MusicPacks.ru,'Музыкальные наборы');
 assert.equal(lang.LoadingTips.length,52);
 for(const tip of previous.LoadingTips){
  const current=lang.LoadingTips.find(t=>t.en===tip.en&&t.zh===tip.zh);
  assert(current,tip.en);assert.equal(current.ru,tip.ru,tip.en);
 }
 assert(lang.LoadingTips.at(-1).ru.includes('Shift + F8'));
 const plants=read(path.join(output,'jsons/features/PlantFeatures.json')).PLANTS;
 assert.equal(plants.length,235);
 assert.equal(plants.find(p=>p.CODENAME==='aquavine').NAME.ru,'Водная лоза');
 assert.equal(plants.find(p=>p.CODENAME==='buduhboom').NAME.ru,'Маслобум');
 const current=read(path.join(output,'jsons/levels/reinforce7.json'));
 const names=[];texts(current,n=>names.push(n));
 assert.equal(names.find(n=>n.en==='Defensive Wall').ru,'Оборонительная стена');
 for(const retired of ['faq.json','links.json'])assert(!fs.existsSync(path.join(output,'jsons',retired)));
 const originals=files(path.join(root,'base-'+version+'/jsons/levels')).filter(f=>/[/\\]future\d+\.json$/.test(f));
 let decks=0;
 for(const original of originals){let count=0;texts(read(original),(n,p)=>{if(p.includes('/CardDecks/'))count++;});if(count){const packaged=path.join(output,path.relative(path.join(root,'base-'+version),original));assert(fs.existsSync(packaged));texts(read(packaged),(n,p)=>{if(p.includes('/CardDecks/')){assert(n.ru);decks++;}});}}
 assert.equal(decks,230);
});
