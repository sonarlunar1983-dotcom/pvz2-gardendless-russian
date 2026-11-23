const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const defaults = {fontFamily:'Segoe UI',fontScale:0.9,lineHeightScale:0.95,spacingX:0,onlyCyrillic:true,enabled:true,scanIntervalMs:250};
const newSource = fs.readFileSync(path.join(root,'src/font-fixer/font-fix.js'),'utf8');
const targetVersion=process.env.FONT_FIXER_GAME_VERSION||'0.16.1';
const uiTranslations=JSON.parse(fs.readFileSync(path.join(root,'assets/ui-translations-compiled-'+targetVersion+'.json'),'utf8'));
const objectiveTranslations=JSON.parse(fs.readFileSync(path.join(root,'src/font-fixer/objective-translations.json'),'utf8'));
const documentTranslations=JSON.parse(fs.readFileSync(path.join(root,'src/font-fixer/document-translations.json'),'utf8'));
const originalGo = fs.readFileSync(path.join(root,'../pvz2-gardendless-russian/font-fixer/main.go'),'utf8');
const oldSource = originalGo.match(/return fmt\.Sprintf\(`([\s\S]*?)`, string\(cfgJSON\)\)/)[1];
const pollingSource=fs.readFileSync(path.join(root,'tests/fixtures/font-fix-1.3.js'),'utf8');

function setup(fontAssets=[],fontRuntime={}) {
    class Label {
        constructor(string,parent=null) {
            this._string=string;this.writes=[];
            Object.assign(this,{fontSize:20,lineHeight:24,useSystemFont:false,fontFamily:'Game bitmap font',spacingX:0,isBold:false,isValid:true,enableWrapText:true,overflow:0});
            this.node={parent,getComponent:type=>type===Label?this:null};
        }
        get string(){return this._string;}
        set string(value){this._string=String(value);this.writes.push(this._string);}
        width() { return this.string.length*this.fontSize*(this.useSystemFont?0.5:1)+Math.max(0,this.string.length-1)*this.spacingX; }
        updateRenderData() {}
    }
    Label.Overflow={NONE:0,CLAMP:1,SHRINK:2};
    class RichText {
        constructor() {
            this.node={parent:null,getComponent:type=>type===RichText?this:null}; this._segments=[];
            this.values={fontSize:20,lineHeight:24,useSystemFont:false,fontFamily:'Game bitmap font'};
            this._string='Применение: <color=#ff0000>одноразовое, мгновенное</color>';
            this.layouts=0;
            for(const key of Object.keys(this.values))Object.defineProperty(this,key,{get:()=>this.values[key],set:v=>{if(this.values[key]!==v){this.values[key]=v;this._updateRichText();}}});
            this._updateRichText();
        }
        get string() { return this._string; }
        set string(v) { this._string=v; this._updateRichText(); }
        _applyTextAttribute(segment) {
            const label=segment.node.getComponent(Label);
            for(const key of Object.keys(this.values))label[key]=this.values[key];
        }
        _updateRichText() {
            this.layouts++;this._segments=[];let x=0;
            for(const text of this._string.replace(/<\/color>/g,'').split(/<color=[^>]+>/)){
                const label=new Label(text,this.node),segment={node:label.node,comp:label};
                this._applyTextAttribute(segment);
                segment.x=x; x+=label.width();this._segments.push(segment);
            }
        }
    }
    const rich=new RichText(),plain=new Label('Русское меню'),english=new Label('English menu');
    const richTexts=[rich],extraLabels=[],language={code:'en'};
    let sequence=0;const intervals=new Set(),handlers=new Set();
    const context=vm.createContext({
        window:{},location:{href:'http://tauri.localhost/'},console:{log(){}}, ...fontRuntime,
        setInterval(){const id=++sequence;intervals.add(id);return id;},clearInterval(id){intervals.delete(id);},setTimeout(){},
        cc:{Label,RichText,js:{getClassByName:name=>name==='MultiLanguage'?{getString:values=>values[language.code]}:null},Director:{EVENT_AFTER_SCENE_LAUNCH:'scene'},director:{
            getScene:()=>({getComponentsInChildren:type=>type===RichText?richTexts:[plain,english,...extraLabels,...richTexts.flatMap(r=>r._segments.map(s=>s.comp))]}),
            on(event,fn){handlers.add(fn);},off(event,fn){handlers.delete(fn);}
        }}
    });
    const run=(source,config=defaults)=>vm.runInContext(source.replace('__CONFIG_JSON__',JSON.stringify(config)).replace('__UI_TRANSLATIONS_JSON__',JSON.stringify(uiTranslations)).replace('__FONT_ASSETS_JSON__',JSON.stringify(fontAssets)).replace('__OBJECTIVE_TRANSLATIONS_JSON__',JSON.stringify(objectiveTranslations)).replace('__DOCUMENT_TRANSLATIONS_JSON__',JSON.stringify(documentTranslations)).replace('%s',JSON.stringify(config)),context);
    return {rich,richTexts,extraLabels,RichText,language,plain,english,context,run,intervals,handlers};
}
function gap(rich){return rich._segments[1].x-rich._segments[0].comp.width();}

function documentFixture(env, translation=documentTranslations[0]) {
 const attributeNode=attrs=>({attrs:{...attrs},getAttribute(k){return this.attrs[k]??null;},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}});
 const close=attributeNode({'aria-label':'Close'}),dialog=attributeNode({'aria-label':'Original dialog'});
 dialog.querySelector=()=>close;
 const prefix='<meta charset="utf-8"><base target="_blank"><style>body{font:16px system-ui}</style>';
 const frame={srcdoc:prefix+translation.sources[0],title:'Original title',isConnected:true,closest:()=>dialog};
 const frames=[frame];
 env.context.document={body:{},querySelectorAll:()=>frames};
 return {frame,frames,dialog,close,original:frame.srcdoc,prefix};
}

test('Markdown update/about dialogs translate without accessing sandboxed iframe documents',()=>{
 for(const translation of documentTranslations){
  const env=setup();env.language.code='ru';const fixture=documentFixture(env,translation);
  Object.defineProperty(fixture.frame,'contentDocument',{get(){throw Error('Sandbox must not be accessed');}});
  env.run(newSource);
  assert.equal(fixture.frame.srcdoc,fixture.prefix+translation.html);
  assert.equal(fixture.frame.title,translation.title);assert.equal(fixture.close.getAttribute('aria-label'),'Закрыть');
  env.language.code='en';env.context.window.__pvzRuFontFix.scan();
  assert.equal(fixture.frame.srcdoc,fixture.original);assert.equal(fixture.frame.title,'Original title');
  assert.equal(fixture.dialog.getAttribute('aria-label'),'Original dialog');assert.equal(fixture.close.getAttribute('aria-label'),'Close');
 }
});

test('document translation handles Chinese source, native replacement, disable and disposal without touching unrelated frames',()=>{
 const env=setup();env.language.code='ru';const fixture=documentFixture(env);env.run(newSource);
 const api=env.context.window.__pvzRuFontFix,unrelated={...fixture.frame,srcdoc:'User supplied document'};fixture.frames.push(unrelated);
 fixture.frame.srcdoc=fixture.prefix+documentTranslations[1].sources[1];api.scan();
 assert.equal(fixture.frame.srcdoc,fixture.prefix+documentTranslations[1].html);assert.equal(unrelated.srcdoc,'User supplied document');
 api.applyConfig({enabled:false});assert.equal(fixture.frame.srcdoc,fixture.prefix+documentTranslations[1].sources[1]);
 api.applyConfig({enabled:true});assert.equal(fixture.frame.srcdoc,fixture.prefix+documentTranslations[1].html);
 api.dispose();assert.equal(fixture.frame.srcdoc,fixture.prefix+documentTranslations[1].sources[1]);
});

test('document observer translates newly opened dialogs and disconnects on disposal',()=>{
 const env=setup();env.language.code='ru';const fixture=documentFixture(env);fixture.frames.length=0;
 let observerCallback,disconnected=false;
 env.context.MutationObserver=class {constructor(fn){observerCallback=fn;}observe(){}disconnect(){disconnected=true;}};
 env.run(newSource);fixture.frames.push(fixture.frame);observerCallback();
 assert.equal(fixture.frame.srcdoc,fixture.prefix+documentTranslations[0].html);
 env.context.window.__pvzRuFontFix.dispose();assert(disconnected);assert.equal(fixture.frame.srcdoc,fixture.original);
 observerCallback();assert.equal(fixture.frame.srcdoc,fixture.original);
});

test('0.16.15 music pack caption translates synchronously and follows language changes',{skip:!['0.16.15','0.16.27','0.16.31'].includes(targetVersion)},()=>{
 const env=setup();env.language.code='ru';env.run(newSource);
 env.plain.string='Music Packs';assert.equal(env.plain.string,'Музыкальные наборы');
 env.language.code='en';env.plain.string='Music Packs';assert.equal(env.plain.string,'Music Packs');
 env.language.code='ru';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,'Музыкальные наборы');
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.string,'Music Packs');
});

test('0.16.15 retains the game classes and serialized fields used by the helper',{skip:!['0.16.15','0.16.27','0.16.31'].includes(targetVersion)},()=>{
 const source=fs.readFileSync(path.join(root,'extracted-'+targetVersion+'/assets/main/index.js'),'utf8');
 const moduleSource=name=>{const start=source.indexOf('System.register("chunks:///_virtual/'+name+'.ts"');assert(start>=0,name);const end=source.indexOf('System.register(',start+1);return source.slice(start,end<0?source.length:end);};
 for(const [name,fields] of Object.entries({CardDeckDisplayer:['description_label','title_label'],LevelOfTheDayDisplayer:['today_left_time','next_try_time','description','title'],SettingWindow:['tooltips','SquareTipMode','PocketUI','MusicPacks'],MultiLanguage:['getString']})){
  const text=moduleSource(name);for(const field of fields)assert(text.includes(field),name+'.'+field);
 }
 const engine=path.join(root,'extracted-'+targetVersion+'/cocos-js/_virtual_cc-937a2166.js');
 assert.equal(fs.readFileSync(engine,'utf8').replace(/\r\n/g,'\n'),fs.readFileSync(path.join(root,'extracted-0.16.1/cocos-js/_virtual_cc-937a2166.js'),'utf8').replace(/\r\n/g,'\n'));
});

test('Card deck description moves right five steps and down one and a half without drifting or moving its title',()=>{
 const env=setup([],{document:{createElement:()=>({getContext:()=>({measureText:()=>({width:6})})})}});env.language.code='ru';
 attachComponent(env,'CardDeckDisplayer',{description_label:env.plain,title_label:env.english},[env.plain,env.english]);
 for(const label of [env.plain,env.english]){label.node.position={x:100,y:20,z:3};label.node.setPosition=(x,y,z)=>label.node.position={x,y,z};}
 env.plain.string='Быстро выберите семена!';env.english.string='Колоды повышенной сложности';env.run(newSource);
 for(let i=0;i<20;i++){
  env.plain.string='Быстро выберите семена!';env.context.window.__pvzRuFontFix.scan();
  assert.deepEqual(env.plain.node.position,{x:130,y:11,z:3});assert.deepEqual(env.english.node.position,{x:100,y:20,z:3});
 }
 env.plain.node.setPosition(200,60,3);env.context.window.__pvzRuFontFix.scan();assert.deepEqual(env.plain.node.position,{x:230,y:51,z:3});
 env.language.code='en';env.context.window.__pvzRuFontFix.scan();assert.deepEqual(env.plain.node.position,{x:200,y:60,z:3});
 env.language.code='ru';env.context.window.__pvzRuFontFix.scan();assert.deepEqual(env.plain.node.position,{x:230,y:51,z:3});
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.deepEqual(env.plain.node.position,{x:200,y:60,z:3});
});

test('Pinata titles are fitted synchronously before scan, accounting for glyph width, spacing and outline',()=>{
 const measure={font:'',measureText(text){return {width:[...text].length*parseFloat(this.font)*.65};}};
 const env=setup([],{document:{createElement:()=>({getContext:()=>measure})}});env.language.code='ru';attachComponent(env,'LevelOfTheDayDisplayer',{title:env.plain},[env.plain]);
 const transform=class {};env.context.cc.UITransform=transform;const original=env.plain.node.getComponent,bounds={width:180};env.plain.node.getComponent=t=>t===transform?bounds:original(t);
 env.plain.fontSize=90;env.plain.enableOutline=true;env.plain.outlineWidth=2;env.run(newSource,{...defaults,fontScale:1,spacingX:1});
 const events=JSON.parse(fs.readFileSync(path.join(root,'build/pack-'+targetVersion+'/jsons/features/EventList.json'),'utf8')),titles=new Set();
 function walk(v){if(!v||typeof v!=='object')return;for(const[k,x]of Object.entries(v)){if(/^(Default)?Title(Folded)?$/.test(k)&&x?.ru)titles.add(x.ru);else if(x&&typeof x==='object')walk(x)}}walk(events);
 for(const title of titles){env.plain.string=title;const size=env.plain.fontSize;assert([...title].length*size*.65+([...title].length-1)+4<=bounds.width*.94,title);assert.equal(env.plain.enableWrapText,false);assert.equal(env.plain.overflow,2);env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,size);}
 bounds.width=2000;env.plain.string='Коротко';assert.equal(env.plain.fontSize,51);
 env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.fontSize,90);assert.equal(env.plain.enableWrapText,true);assert.equal(env.plain.overflow,0);
});

test('Pinata event title and active description keep their independent scales',()=>{
 const env=setup();env.language.code='ru';attachComponent(env,'LevelOfTheDayDisplayer',{title:env.plain,description:env.english},[env.plain,env.english]);
 env.plain.fontSize=30;env.english.string='Описание события';env.run(newSource,{...defaults,fontScale:1});
 for(const title of ['Событие пиньяты','Новое событие']){env.plain.string=title;for(let i=0;i<10;i++)env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,17);assert.equal(env.english.fontSize,17);assert.equal(env.plain.string,title);}
 env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.fontSize,30);
});

test('Pinata event description shrinks fifteen percent without drift and restores outside its owner',()=>{
 const env=setup();env.language.code='ru';
 attachComponent(env,'LevelOfTheDayDisplayer',{description:env.plain,title:env.english},[env.plain,env.english]);
 env.plain.fontSize=40;env.plain.string='Try special limited-time level for today!';env.english.string='Событие';
 env.run(newSource,{...defaults,fontScale:1,lineHeightScale:1});
 for(let i=0;i<20;i++){env.plain.string='Try special limited-time level for today!';assert.equal(env.plain.fontSize,34);assert.equal(env.plain.lineHeight,24);assert.equal(env.plain.string,'Попробуйте сегодняшний особый уровень, доступный ограниченное время!');env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,34);}
 env.context.window.__pvzRuFontFix.applyConfig({fontScale:.9});assert.equal(env.plain.fontSize,31);
 env.language.code='en';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,40);
 env.language.code='ru';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,31);
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.fontSize,40);
});

test('Pinata next-event cooldown wraps after colon, shrinks, becomes bold and rises without drifting',()=>{
 const env=setup([],{document:{createElement:()=>({getContext:()=>({measureText:()=>({width:8})})})}});env.language.code='ru';
 attachComponent(env,'LevelOfTheDayDisplayer',{description:env.plain,next_try_time:env.english},[env.plain,env.english]);
 env.plain.node.position={x:10,y:50,z:1};env.plain.node.setPosition=(x,y,z)=>env.plain.node.position={x,y,z};env.english.string='бесплатно через 5 m';env.run(newSource,{...defaults,fontScale:1});
 for(let i=59;i>=0;i--){env.plain.string='до следующего: 1 h 2 m '+i+' s';assert.equal(env.plain.string,'до следующего:\n1 ч. 2 м. '+i+' с.');assert.equal(env.plain.writes.at(-1),env.plain.string);env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,16);assert.equal(env.plain.lineHeight,18);assert.equal(env.plain.isBold,true);assert.equal(env.plain.enableWrapText,true);assert.equal(env.plain.overflow,2);assert.deepEqual(env.plain.node.position,{x:10,y:56,z:1});}
 assert.equal(env.english.fontSize,20);assert.equal(env.english.isBold,false);
 env.plain.string='Описание события';assert.equal(env.plain.fontSize,17);assert.equal(env.plain.isBold,false);assert.equal(env.plain.node.position.y,50);assert.equal(env.plain.overflow,0);
 env.plain.string='3 h 2 m until next';assert.equal(env.plain.string,'до следующего:\n3 ч. 2 м.');env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.fontSize,20);assert.equal(env.plain.node.position.y,50);assert.equal(env.plain.string,'3 h 2 m until next');
});

test('New plant reward Continue moves down half its current font size without drift', () => {
    const env = setup();
    env.language.code = 'ru';
    attachComponent(env, 'awardScene', {continueLabel: env.plain, titleLabel: env.english}, [env.plain, env.english]);
    env.plain.node.position = {x: 7, y: 50, z: 2};
    env.plain.node.setPosition = (x, y, z) => { env.plain.node.position = {x, y, z}; };
    env.plain.string = "Продолжить";
    env.english.string = "Вы получили новое РАСТЕНИЕ!";
    env.run(newSource, {...defaults, fontScale: 1});
    const api = env.context.window.__pvzRuFontFix;
    for (let i = 0; i < 5; i++) api.scan();
    assert.deepEqual(env.plain.node.position, {x: 7, y: 40, z: 2});
    api.applyConfig({fontScale: .8});
    assert.deepEqual(env.plain.node.position, {x: 7, y: 42, z: 2});
    env.english.string = "Вы получили Ключ от мира!";
    api.scan();
    assert.deepEqual(env.plain.node.position, {x: 7, y: 50, z: 2});
    env.english.string = '?? ???????? ????? ????????!';
    api.scan();
    api.applyConfig({enabled: false});
    assert.deepEqual(env.plain.node.position, {x: 7, y: 50, z: 2});
});

test('World Key reward Continue shrinks fifteen percent without resizing other award text',()=>{
 const env=setup();env.language.code='ru';const award={continueLabel:env.plain,titleLabel:env.english};attachComponent(env,'awardScene',award,[env.plain,env.english]);
 env.plain.string='ПРОДОЛЖИТЬ';env.english.string='Вы получили Ключ от мира!';env.run(newSource,{...defaults,fontScale:1});
 for(let i=0;i<10;i++){env.plain.string='ПРОДОЛЖИТЬ';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,17);assert.equal(env.english.fontSize,20);}
 env.english.string='Вы получили новое РАСТЕНИЕ!';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,20);
 env.english.string='Вы получили Ключ от мира!';env.context.window.__pvzRuFontFix.scan();env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.fontSize,20);
});

test('all upgrade card titles shrink a further fifteen percent without changing their descriptions',()=>{
 const env=setup();env.language.code='ru';
 attachComponent(env,'AlmanacUpgradeDisplay',{titleLabel:env.plain,descriptionLabel:env.english},[env.plain,env.english]);
 env.english.string='Описание усиления';env.run(newSource,{...defaults,fontScale:1,lineHeightScale:1});
 for(const title of ['Солнечный бонус','Другое усиление','Новая карточка']){env.plain.string=title;for(let i=0;i<10;i++)env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,15);assert.equal(env.plain.lineHeight,24);assert.equal(env.plain.string,title);assert.equal(env.english.fontSize,20);}
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.fontSize,20);
});

test('shop discount caption gets one percent sign and twenty percent font reduction',()=>{
 const env=setup();env.language.code='ru';attachComponent(env,'StoreCommodity',{discountLabel:env.plain},[env.plain]);env.run(newSource,{...defaults,fontScale:1});
 for(const source of ['СКИДКА 25','СКИДКА 25%','СКИДКА 25 %']){for(let i=0;i<5;i++){env.plain.string=source;env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,'СКИДКА 25%');assert.equal(env.plain.fontSize,16);}}
 env.plain.string='СКИДКА 0';assert.equal(env.plain.string,'СКИДКА 0%');env.plain.string='СКИДКА 12,5';assert.equal(env.plain.string,'СКИДКА 12,5%');
 env.english.string='СКИДКА 25';assert.equal(env.english.string,'СКИДКА 25');
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.string,'СКИДКА 12,5');assert.equal(env.plain.fontSize,20);
});

test('shop countdown translates every native write and shrinks thirty percent only in the shop field',()=>{
 const env=setup();env.language.code='ru';attachComponent(env,'StoreCommodity',{leftTimeLabel:env.plain},[env.plain]);env.run(newSource,{...defaults,fontScale:1});
 for(let i=59;i>=0;i--){env.plain.string='ОСТАЛОСЬ 2 d 3 h 4 m '+i+' s';assert.equal(env.plain.string,'ОСТАЛОСЬ 2 д. 3 ч. 4 м.');assert.equal(env.plain.writes.at(-1),env.plain.string);assert.equal(env.plain.fontSize,14);env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,14);}
 env.plain.string='ОСТАЛОСЬ 59 s';assert.equal(env.plain.string,'ОСТАЛОСЬ < 1 м.');
 env.plain.string='ОСТАЛОСЬ 0 d 0 h 0 m 59 s';assert.equal(env.plain.string,'ОСТАЛОСЬ < 1 м.');
 env.plain.string='ОСТАЛОСЬ 1 d 0 h 5 s';assert.equal(env.plain.string,'ОСТАЛОСЬ 1 д. 0 ч.');
 env.english.string='ОСТАЛОСЬ 1 d 0 h 5 s';assert.equal(env.english.fontSize,20);assert.equal(env.english.string,'ОСТАЛОСЬ 1 д. 0 ч. 5 с.');
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.fontSize,20);assert.equal(env.plain.string,'ОСТАЛОСЬ 1 d 0 h 5 s');
});

test('garden shovel boost warning rises two spaces without moving ordinary removal or buttons',()=>{
 const env=setup([],{document:{createElement:()=>({getContext:()=>({measureText:()=>({width:8})})})}});env.language.code='ru';
 attachComponent(env,'zenGardenScene',{shovelWindowDescriptionLabel:env.plain,shovelWindowCancelLabel:env.english},[env.plain,env.english]);
 for(const label of [env.plain,env.english]){label.node.position={x:10,y:50,z:1};label.node.setPosition=(x,y,z)=>label.node.position={x,y,z};}
 env.plain.string='Вы потеряете Подсолнух, но получите за него УСИЛЕНИЕ!';env.english.string='ОТМЕНА';env.run(newSource);
 for(const name of ['Подсолнух','Горохострел']){env.plain.string='Вы потеряете '+name+', но получите за него УСИЛЕНИЕ!';for(let i=0;i<10;i++)env.context.window.__pvzRuFontFix.scan();assert.deepEqual(env.plain.node.position,{x:10,y:66,z:1});assert.equal(env.english.node.position.y,50);}
 env.plain.string='Вы потеряете Подсолнух и ничего не получите!';assert.equal(env.plain.node.position.y,50);
 env.plain.string='Вы потеряете Подсолнух, но получите за него УСИЛЕНИЕ!';env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.node.position.y,50);
});

test('settings sound effects and dynamic music speed shrink independently without affecting pause audio',()=>{
 const env=setup();env.language.code='ru';
 attachComponent(env,'SettingWindow',{tooltips:{SoundFX:env.plain},musicTitleLabel:env.english},[env.plain,env.english]);
 const pause=new env.context.cc.Label('Звук. эффекты');env.extraLabels.push(pause);attachComponent(env,'PauseScreen',{tooltips:{SoundFX:pause}},[pause]);
 env.plain.string='Звуковые эффекты';env.english.string='Скорость музыки (1 ~ 1)';env.run(newSource,{...defaults,fontScale:1,lineHeightScale:1});
 for(const range of ['1 ~ 1','0.5 ~ 2','1.25 ~ 1.75']){env.plain.string='Звуковые эффекты';env.english.string='Скорость музыки ('+range+')';for(let i=0;i<5;i++)env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,17);assert.equal(env.english.fontSize,16);assert.equal(env.english.string,'Скорость музыки ('+range+')');assert.equal(env.plain.lineHeight,24);assert.equal(env.english.lineHeight,24);assert.equal(pause.fontSize,18);}
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.fontSize,20);assert.equal(env.english.fontSize,20);
});

test('defeat exit button becomes Exit without changing confirmation questions or unrelated labels',()=>{
 const env=setup();env.language.code='ru';attachComponent(env,'UIInGame',{toolTips:{EXIT_TO_MAP:env.plain}},[env.plain,env.english]);env.run(newSource);
 for(const [input,output] of [['ВЫЙТИ ИЗ УРОВНЯ','ВЫЙТИ'],['Выйти из уровня','Выйти'],['EXIT LEVEL','ВЫЙТИ']]){for(let i=0;i<3;i++){env.plain.string=input;env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,output);}}
 env.english.string='Выйти из уровня?';assert.equal(env.english.string,'Выйти из уровня?');env.english.string='ВЫЙТИ ИЗ УРОВНЯ';assert.equal(env.english.string,'ВЫЙТИ ИЗ УРОВНЯ');
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.string,'EXIT LEVEL');
});

test('Pinata opening description shrinks five percent without changing the title or line spacing',()=>{
 const env=setup();env.language.code='ru';
 attachComponent(env,'PinataPrizeDisplayer',{DescriptionLabel:env.plain,TitleLabel:env.english},[env.plain,env.english]);
 const text='НАЖМИТЕ, чтобы открыть и узнать, какие сокровища внутри.';
 env.plain.string=text;env.english.string='Пиньята';env.run(newSource,{...defaults,fontScale:1,lineHeightScale:1});
 for(let i=0;i<10;i++){env.plain.string=text;env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,19);assert.equal(env.plain.lineHeight,24);assert.equal(env.plain.string,text);assert.equal(env.english.fontSize,20);}
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.fontSize,20);
});

test('all fourteen mint plant titles shrink five percent and never wrap, without affecting other plants',()=>{
 const env=setup();env.language.code='ru';attachComponent(env,'AlmanacPlantPage',{plantNameLabel:env.plain},[env.plain,env.english]);
 const names=[];function walk(v){if(v&&typeof v==='object'){if(v.NAME?.ru&&/мята$/i.test(v.NAME.ru))names.push(v.NAME.ru);for(const x of Object.values(v))if(x&&typeof x==='object')walk(x);}}
 const dir=path.join(root,'build/pack-'+targetVersion+'/jsons/features');for(const file of fs.readdirSync(dir))walk(JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')));
 assert.equal(names.length,14);env.run(newSource,{...defaults,fontScale:1});
 for(const name of names){env.plain.string=name.replace(' ','\n');for(let i=0;i<3;i++)env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,name);assert.equal(env.plain.fontSize,19);assert.equal(env.plain.enableWrapText,false);assert.equal(env.plain.overflow,2);}
 env.english.string='Перечная мята';assert.equal(env.english.fontSize,20);assert.equal(env.english.enableWrapText,true);
 env.plain.string='Подсолнух';assert.equal(env.plain.fontSize,20);assert.equal(env.plain.enableWrapText,true);assert.equal(env.plain.overflow,0);
 env.plain.string=names[0];env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.fontSize,20);assert.equal(env.plain.enableWrapText,true);
});

test('vanilla interface setting caption shrinks twenty percent only in its own field',()=>{
 const env=setup();env.language.code='ru';
 attachComponent(env,'SettingWindow',{tooltips:{PocketUI:env.plain}},[env.plain,env.english]);
 env.plain.string=env.english.string='Интерфейс в стиле оригинальной игры';env.run(newSource,{...defaults,fontScale:1});
 for(let i=0;i<10;i++){env.plain.string='Интерфейс в стиле оригинальной игры';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,16);assert.equal(env.english.fontSize,20);}
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.fontSize,20);
});

test('Settings title fits one line and tile caption shrinks thirty percent with requested break',()=>{
 const env=setup();env.language.code='ru';
 attachComponent(env,'SettingWindow',{tooltips:{Title:env.plain,SquareTipMode:env.english}},[env.plain,env.english]);
 env.plain.string='Настройки';env.english.string='Отметки клеток для растений';env.run(newSource,{...defaults,fontScale:1});
 for(let i=0;i<10;i++){env.plain.string='Настройки';env.english.string='Отметки клеток для растений';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.enableWrapText,false);assert.equal(env.plain.overflow,2);assert.equal(env.plain.string,'Настройки');assert.equal(env.english.fontSize,14);assert.equal(env.english.string,'Отметки клеток\nдля растений');}
 assert.equal(env.english.enableWrapText,true);assert.equal(env.english.overflow,2);assert.equal(env.english.string.length,27);
 env.rich.string='Каждая клетка';assert.equal(env.rich.fontSize,20);
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.enableWrapText,true);assert.equal(env.plain.overflow,0);assert.equal(env.english.string,'Отметки клеток для растений');assert.equal(env.english.fontSize,20);assert.equal(env.english.overflow,0);
});

test('all fourteen medal families share the size that fits the longest name, without per-page shrink',()=>{
 const measure={font:'',measureText(text){return {width:text.length*parseFloat(this.font)*.6};}};
 const env=setup([],{document:{createElement:()=>({getContext:()=>measure})}});env.language.code='ru';
 attachComponent(env,'PlantMedalDisplayer',{FamilyNameLabel:env.plain},[env.plain]);
 const transform=class {};env.context.cc.UITransform=transform;
 const original=env.plain.node.getComponent,bounds={width:140};env.plain.node.getComponent=t=>t===transform?bounds:original(t);
 const families=Object.values(JSON.parse(fs.readFileSync(path.join(root,'build/pack-'+targetVersion+'/jsons/lang/lang.json'),'utf8')).PlantFamily).map(x=>x.ru).filter(x=>x!=='Нет');
 assert.equal(families.length,14);env.run(newSource,{...defaults,fontScale:1});
 const sizes=new Set();
 for(const text of families){env.plain.string=text;env.context.window.__pvzRuFontFix.scan();sizes.add(env.plain.fontSize);assert.equal(env.plain.enableWrapText,false);assert.equal(env.plain.overflow,1);assert(text.length*env.plain.fontSize*.6<=bounds.width*.94);}
 const previousSize=Math.min(16,Math.floor(bounds.width*.94/(Math.max(...families.map(x=>x.length))*.6)));
 assert.equal(sizes.size,1);assert.equal([...sizes][0],Math.round(Math.round(previousSize*.75)*.8));
 bounds.width=300;env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,10);
 env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.fontSize,20);assert.equal(env.plain.overflow,0);
});

test('Pinata event play moves down half a space on repeated writes without moving retry',()=>{
 const env=setup([],{document:{createElement:()=>({getContext:()=>({measureText:()=>({width:8})})})}});env.language.code='ru';
 attachComponent(env,'LevelOfTheDayDisplayer',{play:env.plain,retry:env.english},[env.plain,env.english]);
 for(const label of [env.plain,env.english]){label.string='Играть';label.node.position={x:10,y:50,z:1};label.node.setPosition=(x,y,z)=>label.node.position={x,y,z};}
 env.run(newSource);for(let i=0;i<10;i++){env.plain.string='Играть событие';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.node.position.y,46);assert.equal(env.english.node.position.y,50);}
 env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.node.position.y,50);
});

test('scene-wide controller lookup shifts sibling Play and Lets Rock labels but not unrelated text',()=>{
 for(const name of ['levelController','mainScene']){
  const env=setup([],{document:{createElement:()=>({getContext:()=>({measureText:()=>({width:8})})})}});env.language.code='ru';
  const type=class {},lookup=env.context.cc.js.getClassByName;
  env.context.cc.js.getClassByName=n=>n===name?type:lookup(n);
  const controller=name==='mainScene'?{tooltips:{Play:env.plain}}:{buttonToolTips:{LetsRock:env.plain}};
  const oldScene=env.context.cc.director.getScene();
  env.context.cc.director.getScene=()=>({getComponentsInChildren:t=>t===type?[controller]:oldScene.getComponentsInChildren(t)});
  for(const label of [env.plain,env.english]){
   label.string=name==='mainScene'?'ИГРАТЬ':'Зажжём!';label.node.position={x:10,y:50,z:1};label.node.setPosition=(x,y,z)=>label.node.position={x,y,z};
  }
  env.run(newSource);for(let i=0;i<10;i++){env.context.window.__pvzRuFontFix.scan();assert.deepEqual(env.plain.node.position,{x:10,y:name==='mainScene'?42:50-env.plain.fontSize*1.3,z:1});assert.equal(env.english.node.position.y,50);}
  env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.node.position.y,50);
 }
});

test('boost counter gains scoped spacing and restores spacing on reuse',()=>{
 const env=setup();env.language.code='ru';env.plain.string='ОСТАЛОСЬ УСИЛЕНИЙ: 1';env.run(newSource,{...defaults,spacingX:.5});
 for(let i=0;i<10;i++){env.plain.string='ОСТАЛОСЬ УСИЛЕНИЙ: '+i;env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.spacingX,.5+18*.12);}
 env.plain.string='Другая надпись';assert.equal(env.plain.spacingX,.5);
 env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.spacingX,0);
});

test('Almanac family lowers half a space and restores on reused numeric row',()=>{
 const env=setup([],{document:{createElement:()=>({getContext:()=>({measureText:()=>({width:8})})})}});env.language.code='ru';
 attachComponent(env,'AlmanacElementForPlant',{nameLabel:env.english,valueLabel:env.plain},[env.plain,env.english]);
 env.english.string='СЕМЕЙСТВО';env.plain.string='Перечной мяты';env.plain.node.position={x:20,y:40,z:0};env.plain.node.setPosition=(x,y,z)=>env.plain.node.position={x,y,z};
 env.run(newSource);for(let i=0;i<10;i++){env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.node.position.y,36);assert.equal(env.plain.enableWrapText,false);}
 env.english.string='Стоимость';env.plain.string='100';assert.equal(env.plain.node.position.y,40);assert.equal(env.plain.enableWrapText,true);
});

test('objective Continue shrinks fifteen percent without resizing other objective labels',()=>{
 const env=setup();env.language.code='ru';
 attachComponent(env,'LevelObjectiveScreen',{toolTips:{Continue:env.plain}},[env.plain,env.english]);
 env.plain.string='Продолжить';env.english.string='Цели уровня';env.run(newSource,{...defaults,fontScale:1});
 for(let i=0;i<10;i++){env.plain.string='Продолжить';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,16);assert.equal(env.english.fontSize,20);}
 env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.fontSize,20);
});

test('medal family names stay on one line with twenty percent reduction and restore layout',()=>{
 const env=setup();env.language.code='ru';
 attachComponent(env,'PlantMedalDisplayer',{FamilyNameLabel:env.plain},[env.plain,env.english]);
 env.run(newSource,{...defaults,fontScale:1});
 const families=JSON.parse(fs.readFileSync(path.join(root,'build/pack-'+targetVersion+'/jsons/lang/lang.json'),'utf8')).PlantFamily;
 for(const family of Object.values(families)){
  env.plain.string=family.ru.replace(' ','\n');env.context.window.__pvzRuFontFix.scan();
  assert.equal(env.plain.string,family.ru);assert.equal(env.plain.fontSize,10);assert.equal(env.plain.enableWrapText,false);assert.equal(env.plain.overflow,1);
 }
 env.english.string='Перечной мяты';assert.equal(env.english.enableWrapText,true);assert.equal(env.english.fontSize,20);
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.enableWrapText,true);assert.equal(env.plain.overflow,0);assert.equal(env.plain.fontSize,20);
});

test('only pre-battle Lets Rock captions move down by 1.3 times their current font size and restore',()=>{
 const env=setup([],{document:{createElement:()=>({getContext:()=>({measureText:()=>({width:8})})})}});env.language.code='ru';
 attachComponent(env,'levelController',{buttonToolTips:{LetsRock:env.plain}},[env.plain,env.english]);
 for(const label of [env.plain,env.english]){label.string='Зажжём!';label.node.position={x:10,y:50,z:1};label.node.setPosition=(x,y,z)=>label.node.position={x,y,z};}
 env.run(newSource);
 for(let i=0;i<10;i++){env.plain.string='Зажжём!';env.context.window.__pvzRuFontFix.scan();assert.deepEqual(env.plain.node.position,{x:10,y:50-env.plain.fontSize*1.3,z:1});assert.deepEqual(env.english.node.position,{x:10,y:50,z:1});}
 env.context.window.__pvzRuFontFix.dispose();assert.deepEqual(env.plain.node.position,{x:10,y:50,z:1});
});

function attachComponent(env,name,component,labels){
 const type=class {},lookup=env.context.cc.js.getClassByName;
 env.context.cc.js.getClassByName=value=>value===name?type:lookup(value);
 const node={parent:null,getComponent:value=>value===type?component:null};
 for(const label of labels)label.node.parent=node;
 return node;
}

test('all known objective templates translate in pause and introduction, preserving substitutions',()=>{
 assert.equal(objectiveTranslations.templates.length,targetVersion==='0.16.31'?55:targetVersion==='0.16.27'?48:47);
 for(const screen of ['PauseScreen','LevelObjectiveScreen']){
  const env=setup();env.language.code='ru';attachComponent(env,screen,{},[env.plain]);env.run(newSource);
  for(const {en,ru} of objectiveTranslations.templates){
   const fill=value=>value.replace(/<(S|ZS|TS)>/g,'s').replace(/<WORLDNAME>/g,'Ancient Egypt').replace(/<[A-Z]+>/g,'7');
   const expected=fill(ru).replace('Ancient Egypt',objectiveTranslations.worlds['Ancient Egypt']||'Ancient Egypt');
   env.plain.string=fill(en);assert.equal(env.plain.string,expected,en);
  }
  env.plain.string='Kill 1 zombie in 1 second';assert.equal(env.plain.string,'Уничтожьте 1 зомби за 1 секунд');
  env.plain.string='Complete the level within 90.5 seconds';assert.equal(env.plain.string,'Пройдите уровень за 90.5 секунд');
  env.english.string='Survive the zombie attack';assert.equal(env.english.string,'Survive the zombie attack','no out-of-context translation');
  env.language.code='en';env.plain.string='Survive the zombie attack';assert.equal(env.plain.string,'Survive the zombie attack');
 }
});

test('only the three main pause buttons shrink, and exit confirmation keeps its original question',()=>{
 const env=setup();env.language.code='ru';const resume=new env.context.cc.Label('ПРОДОЛЖИТЬ'),question=new env.context.cc.Label('Выйти из уровня?');
 env.extraLabels.push(resume,question);
 attachComponent(env,'PauseScreen',{tooltips:{ExitToMap:env.plain,Restart:env.english,Resume:resume,ExitTitle:question}},[env.plain,env.english,resume,question]);
 env.plain.string='ВЫЙТИ ИЗ УРОВНЯ';env.english.string='ЗАНОВО';env.run(newSource,{...defaults,fontScale:1});
 for(let i=0;i<10;i++){env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,'ВЫЙТИ');assert.equal(env.plain.fontSize,16);assert.equal(env.english.fontSize,16);assert.equal(resume.fontSize,16);}
 assert.equal(question.string,'Выйти из уровня?');assert.equal(question.fontSize,20);
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.string,'ВЫЙТИ ИЗ УРОВНЯ');assert.equal(env.plain.fontSize,20);
});

test('boost counter moves left by ten measured spaces without drifting and restores after a text change',()=>{
 const measure={font:'',measureText:text=>{assert.equal(text,' ');return {width:7};}};
 const env=setup([],{document:{createElement:()=>({getContext:()=>measure})}});env.language.code='ru';
 env.plain.node.position={x:100,y:12,z:0};env.plain.node.setPosition=(x,y,z)=>{env.plain.node.position={x,y,z};};
 env.plain.string='ОСТАЛОСЬ УСИЛЕНИЙ: 1';env.run(newSource);
 for(let i=1;i<20;i++){env.plain.string='ОСТАЛОСЬ УСИЛЕНИЙ: '+i;env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.node.position.x,30);assert.equal(env.plain.node.position.y,12);}
 env.plain.node.setPosition(200,12,0);env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.node.position.x,130);
 env.plain.string='Другая надпись';assert.equal(env.plain.node.position.x,200);
 env.plain.string='ОСТАЛОСЬ УСИЛЕНИЙ: 1';env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.node.position.x,200);
});

test('Almanac family values wrap before mint and shrink ten percent without touching quest text',()=>{
 const env=setup();env.language.code='ru';env.english.string='СЕМЕЙСТВО';
 attachComponent(env,'AlmanacElementForPlant',{valueLabel:env.plain,nameLabel:env.english},[env.plain,env.english]);
 env.run(newSource,{...defaults,fontScale:1});
 const families=JSON.parse(fs.readFileSync(path.join(root,'build/pack-'+targetVersion+'/jsons/lang/lang.json'),'utf8')).PlantFamily;
 for(const family of Object.values(families)){
  env.plain.string=family.ru.replace(' ','\n');assert.equal(env.plain.string,family.ru);
  assert.equal(env.plain.fontSize,14);assert.equal(env.plain.enableWrapText,false);assert.equal(env.plain.overflow,env.context.cc.Label.Overflow.SHRINK);
 }
 env.rich.string='Семейство Перечной мяты — уровень 1';assert.equal(env.rich.string,'Семейство Перечной мяты — уровень 1');assert.equal(env.rich.fontSize,20);
 env.english.string='СТОИМОСТЬ В СОЛНЦЕ';assert.equal(env.english.string,'СТОИМОСТЬ В СОЛНЦАХ');
 env.plain.string='100';assert.equal(env.plain.fontSize,20);assert.equal(env.plain.overflow,0);
});

test('garden boost confirmation becomes Yes without renaming Cancel or unrelated confirmations',()=>{
 const env=setup();env.language.code='ru';attachComponent(env,'zenGardenScene',{shovelWindowConfirmLabel:env.plain},[env.plain,env.english]);
 env.run(newSource);env.plain.string='ПОДТВЕРДИТЬ';assert.equal(env.plain.string,'ДА');
 env.english.string='ОТМЕНА';assert.equal(env.english.string,'ОТМЕНА');
 env.english.string='ПОДТВЕРДИТЬ';assert.equal(env.english.string,'ПОДТВЕРДИТЬ');
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.string,'ПОДТВЕРДИТЬ');
});

test('pause audio captions are scoped and shrink once by ten percent',()=>{
 const env=setup();env.language.code='ru';
 attachComponent(env,'PauseScreen',{tooltips:{SoundFX:env.plain,Music:env.english}},[env.plain,env.english]);
 env.run(newSource,{...defaults,fontScale:1});
 for(let i=0;i<15;i++){
  env.plain.string='Звуковые эффекты';env.english.string='Музыка';
  env.context.window.__pvzRuFontFix.scan();
  assert.equal(env.plain.string,'Звук. эффекты');assert.equal(env.plain.fontSize,18);assert.equal(env.english.fontSize,18);
 }
 env.rich.string='Звуковые эффекты';assert.equal(env.rich.string,'Звуковые эффекты');assert.equal(env.rich.fontSize,20);
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.string,'Звуковые эффекты');assert.equal(env.plain.fontSize,20);
});

test('Active Pinata timer rises two more steps from 1.33 without moving tickets',()=>{
 const env=setup([],{document:{createElement:()=>({getContext:()=>({measureText:()=>({width:6})})})}});env.language.code='ru';
 attachComponent(env,'LevelOfTheDayDisplayer',{today_left_time:env.plain},[env.plain,env.english]);
 for(const label of [env.plain,env.english]){
  label.node.position={x:100,y:20,z:3};label.node.setPosition=(x,y,z)=>label.node.position={x,y,z};
  Object.assign(label,{enableOutline:true,outlineColor:'black',outlineWidth:2,color:'white'});
 }
 env.plain.string='2 h 30 m';env.english.string='Истекает через 2 d 1 h!';env.run(newSource);
 for(let i=0;i<20;i++){
  env.plain.string='2 h '+i+' m';env.context.window.__pvzRuFontFix.scan();
  assert.deepEqual(env.plain.node.position,{x:76,y:80,z:3});assert.equal(env.plain.outlineColor,'white');assert.equal(env.plain.outlineWidth,17*.035);
  assert.equal(env.plain.isBold,true);assert.deepEqual(env.english.node.position,{x:100,y:20,z:3});assert.equal(env.english.outlineWidth,2);
 }
 env.plain.node.setPosition(200,60,3);env.context.window.__pvzRuFontFix.scan();assert.deepEqual(env.plain.node.position,{x:176,y:120,z:3});
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.deepEqual(env.plain.node.position,{x:200,y:60,z:3});
 assert.equal(env.plain.outlineColor,'black');assert.equal(env.plain.outlineWidth,2);assert.equal(env.plain.enableOutline,true);
 env.context.window.__pvzRuFontFix.applyConfig({enabled:true});env.context.window.__pvzRuFontFix.dispose();assert.deepEqual(env.plain.node.position,{x:200,y:60,z:3});assert.equal(env.plain.outlineColor,'black');
});

test('decoding title is ten percent smaller and missed gems wrap after the requested word',()=>{
 const env=setup();env.language.code='ru';env.run(newSource,{...defaults,fontScale:1,lineHeightScale:1});
 for(let i=0;i<20;i++){
  env.plain.string='Plant Decoding';assert.equal(env.plain.string,'Шифр растений');
  assert.equal(env.plain.fontSize,18);assert.equal(env.plain.lineHeight,24);
  env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,18);
 }
 for(const source of ["You've missed the gems today!",'Сегодня вы упустили самоцветы!']){
  env.plain.string=source;assert.equal(env.plain.string,'Сегодня вы упустили\nсамоцветы!');
  assert.equal(env.plain.enableWrapText,true);assert.equal(env.plain.overflow,env.context.cc.Label.Overflow.SHRINK);
  assert.equal(env.plain.fontSize,20);
 }
 env.plain.string='Шифр растений';env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.fontSize,20);
});

test('all short decoding verdicts fit a single line and restore their original layout',()=>{
 const env=setup();env.language.code='ru';env.run(newSource);
 for(const [source,expected] of [['Wrong Slot','Не на месте'],['Partial','Частично верно'],['All Wrong','Всё неверно'],['Correct','Верно'],['Все неверно','Все неверно']]){
  env.plain.string=source;assert.equal(env.plain.string,expected);
  assert.equal(env.plain.enableWrapText,false);assert.equal(env.plain.overflow,env.context.cc.Label.Overflow.SHRINK);
  for(let i=0;i<3;i++)env.context.window.__pvzRuFontFix.scan();
  assert.equal(env.plain.enableWrapText,false);assert.equal(env.plain.fontSize,18);
 }
 env.plain.string='Обычное описание';assert.equal(env.plain.enableWrapText,true);assert.equal(env.plain.overflow,0);
 env.plain.string='Частично верно';env.context.window.__pvzRuFontFix.applyConfig({enabled:false});
 assert.equal(env.plain.enableWrapText,true);assert.equal(env.plain.overflow,0);
});

const trialAssets=[
 {label:'Garden Note RU',family:'GardenNoteRU05',source:'note'},
 {label:'Garden Fright RU',family:'GardenFrightRU05',source:'fright'},
 {label:'Garden Soft RU',family:'GardenSoftRU05',source:'soft'}
];

test('only the Pinata today countdown becomes bold across native writes and restores on disable',()=>{
 const env=setup();env.language.code='ru';
 class PinataDisplayer {}
 const oldLookup=env.context.cc.js.getClassByName;
 env.context.cc.js.getClassByName=name=>name==='LevelOfTheDayDisplayer'?PinataDisplayer:oldLookup(name);
 const owner={today_left_time:env.plain,next_try_time:env.english};
 const parent={parent:null,getComponent:type=>type===PinataDisplayer?owner:null};
 env.plain.node.parent=parent;env.english.node.parent=parent;
 env.plain.string='22 h 2 m';env.english.string='Истекает через 6 d 14 h!';
 env.run(newSource);assert.equal(env.plain.isBold,true);assert.equal(env.english.isBold,false);
 for(let i=59;i>=0;i--){env.plain.string='22 h 2 m '+i+' s';assert.equal(env.plain.isBold,true);assert.equal(env.plain.fontSize,17);}
 env.english.string='бесплатно через 2 m 1 s';assert.equal(env.english.isBold,false);
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.isBold,false);
 env.context.window.__pvzRuFontFix.applyConfig({enabled:true});assert.equal(env.plain.isBold,true);
 env.context.window.__pvzRuFontFix.dispose();assert.equal(env.plain.isBold,false);
});
function trialFontRuntime(fail=false) {
 const loaded=[],added=[];
 class FontFace {
  constructor(family,source){this.family=family;this.source=source;}
  async load(){if(fail)throw Error('font decode failed');loaded.push(this.family);return this;}
 }
 return {runtime:{FontFace,document:{fonts:{add(face){added.push(face.family);}}}},loaded,added};
}
test('embedded fonts load once, trigger reflow, support individual selection and restore system mode',async()=>{
 const fonts=trialFontRuntime(),env=setup(trialAssets,fonts.runtime);env.language.code='ru';
 env.run(newSource,{...defaults,fontFamily:'Garden Soft RU'});
 assert.equal(env.plain.fontFamily,'Segoe UI','custom fonts must not be used before decoding');
 await env.context.window.__pvzRuFontFix.ready;
 assert.equal(fonts.added.length,3);assert.equal(env.context.window.__pvzRuFontFix.getStats().embeddedFonts,3);
 assert.match(env.plain.fontFamily,/^GardenSoftRU05,/);assert.match(env.rich.fontFamily,/^GardenSoftRU05,/);
 const layouts=env.rich.layouts;
 env.context.window.__pvzRuFontFix.applyConfig({fontFamily:'Garden Fright RU'});
 assert.match(env.plain.fontFamily,/^GardenFrightRU05,/);assert(env.rich.layouts>layouts);
 env.run(newSource,{...defaults,fontFamily:'Garden Note RU'});await env.context.window.__pvzRuFontFix.ready;
 assert.equal(fonts.loaded.length,3);assert.match(env.plain.fontFamily,/^GardenNoteRU05,/);
 env.context.window.__pvzRuFontFix.applyConfig({fontFamily:'Segoe UI'});
 assert.equal(env.plain.fontFamily,'Segoe UI');assert.equal(env.rich.fontFamily,'Segoe UI');
});
test('automatic font routing remembers the native asset even when Cocos clears it, and disposal restores it',async()=>{
 const fonts=trialFontRuntime(),env=setup(trialAssets,fonts.runtime);env.language.code='ru';
 const native={_name:'HOUSEOFTERROR',_uuid:'d9ae0370-5e41-44b6-ad66-7bcd2482d9f7'};
 env.plain.font=native;
 let system=false;
 Object.defineProperty(env.plain,'useSystemFont',{get:()=>system,set:v=>{system=v;if(v)env.plain.font=null;}});
 env.rich.font={_name:'PICO12__'};
 env.run(newSource,{...defaults,fontFamily:'Garden Auto RU'});await env.context.window.__pvzRuFontFix.ready;
 assert.equal(env.plain.font,null);assert.match(env.plain.fontFamily,/^GardenFrightRU05,/);
 assert.match(env.rich.fontFamily,/^GardenSoftRU05,/);
 for(let i=0;i<30;i++){env.plain.string='ОБНОВЛЕНИЯ';env.context.window.__pvzRuFontFix.scan();}
 assert.match(env.plain.fontFamily,/^GardenFrightRU05,/);
 env.context.window.__pvzRuFontFix.dispose();
 assert.equal(env.plain.font,native);assert.equal(env.plain.useSystemFont,false);
});
test('font decoding errors keep the working system font and surface a diagnostic',async()=>{
 const fonts=trialFontRuntime(true),env=setup(trialAssets,fonts.runtime);
 env.run(newSource,{...defaults,fontFamily:'Garden Soft RU'});await env.context.window.__pvzRuFontFix.ready;
 const stats=env.context.window.__pvzRuFontFix.scan();
 assert.equal(env.plain.fontFamily,'Segoe UI');assert.match(stats.error,/font decode failed/);
});

test('complete InfoWindow credits and FAQ translate as one RichText with formatting intact',()=>{
    const report=JSON.parse(fs.readFileSync(path.join(root,'info-ui-report.json'),'utf8'));
    const env=setup();env.language.code='ru';env.run(newSource);
    env.rich.string=report.original;
    assert.equal(env.rich.string,report.translated);
    assert.equal(report.questions,9);
    assert.match(env.rich.string,/Частые вопросы/);
    assert.match(env.rich.string,/@南Garden/);
    assert.doesNotMatch(env.rich.string,/undefined|FaQ:|Presented by/);
    assert.deepEqual(env.rich.string.match(/<\/?color[^>]*>/g),report.original.match(/<\/?color[^>]*>/g));
    env.language.code='en';env.rich.string=report.original;
    assert.equal(env.rich.string,report.original);
});

test('original Font Fixer reproduces an artificial gap after the Usage heading',()=>{
    const env=setup();env.run(oldSource);assert(gap(env.rich)>20,'Regression scenario must reproduce old gap');
});
test('RichText fix positions the coloured description immediately after its heading',()=>{
    const env=setup();const result=env.run(newSource);
    assert.equal(result.error,'');assert.equal(result.richText,1);
    assert.equal(gap(env.rich),0);assert.equal(env.rich.fontSize,18);
    assert.equal(env.rich._segments[0].comp.fontSize,18,'RichText child must not be scaled a second time');
    assert.equal(env.plain.fontSize,18);assert.equal(env.english.fontSize,20);
});
test('repeated scans and reused installation do not repeatedly shrink text or add timers',()=>{
    const env=setup();env.run(newSource);const layouts=env.rich.layouts;
    for(let i=0;i<20;i++)env.context.window.__pvzRuFontFix.scan();
    assert.equal(env.rich.fontSize,18);assert.equal(env.rich.layouts,layouts);
    env.run(newSource);assert.equal(env.intervals.size,1);assert.equal(env.handlers.size,1);assert.equal(gap(env.rich),0);
});
test('font scale and character spacing participate in RichText measurement',()=>{
    const env=setup();env.run(newSource);
    env.context.window.__pvzRuFontFix.applyConfig({fontScale:0.8,spacingX:3,fontFamily:'Arial'});
    assert.equal(env.rich.fontSize,16);assert.equal(env.rich.fontFamily,'Arial');
    assert.equal(env.rich._segments[0].comp.spacingX,3);assert.equal(gap(env.rich),0);
});
test('disabling or leaving Cyrillic restores original font, spacing and layout',()=>{
    const env=setup();env.run(newSource,{...defaults,spacingX:3});
    env.context.window.__pvzRuFontFix.applyConfig({enabled:false});
    assert.equal(env.rich.fontSize,20);assert.equal(env.rich.useSystemFont,false);
    assert.equal(env.rich._segments[0].comp.spacingX,0);assert.equal(env.plain.fontSize,20);assert.equal(gap(env.rich),0);
    env.context.window.__pvzRuFontFix.applyConfig({enabled:true});
    env.rich.string='Usage: <color=#ff0000>single use</color>';
    env.context.window.__pvzRuFontFix.scan();assert.equal(env.rich.useSystemFont,false);assert.equal(gap(env.rich),0);
    env.context.window.__pvzRuFontFix.dispose();assert.equal(env.intervals.size,0);assert.equal(env.handlers.size,0);
});
test('required RichText layout and font APIs exist in the inspected 0.16.1 engine',()=>{
    const dir=path.join(root,'extracted-0.16.1/cocos-js');
    const filename=fs.readdirSync(dir).find(f=>/^_virtual_cc-.*\.js$/.test(f));
    const source=fs.readFileSync(path.join(dir,filename),'utf8');
    for(const api of ['cc.RichText','_applyTextAttribute=function','_updateRichText','fontFamily','useSystemFont','spacingX'])assert(source.includes(api),api);
});
test('pooled labels do not retain Cyrillic letter spacing in an English RichText',()=>{
    const env=setup();env.run(newSource,{...defaults,spacingX:3});
    const pooled=env.rich._segments[0];
    const englishRich=new env.RichText();englishRich.string='Usage: <color=#ff0000>single use</color>';
    pooled.node.parent=englishRich.node;pooled.comp.string='Usage: ';
    englishRich._segments[0]=pooled;
    env.rich._segments.shift();env.richTexts.push(englishRich);
    env.context.window.__pvzRuFontFix.scan();
    assert.equal(englishRich._segments[0].comp.spacingX,0);assert.equal(gap(englishRich),0);
});
test('Fast Shovel and release notes translate only while Russian is selected',()=>{
    const env=setup();env.plain.string='Fast Shovel';env.run(newSource);
    assert.equal(env.plain.string,'Fast Shovel');
    env.language.code='ru';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,'Быстрая лопата');
    const links=JSON.parse(fs.readFileSync(path.join(root,'base-0.16.1/jsons/links.json'),'utf8'));
    for(const entry of links.Updates){
        env.plain.string=entry.en;env.context.window.__pvzRuFontFix.scan();
        assert.equal(env.plain.string,uiTranslations[entry.en]);assert(/[А-Яа-яЁё]/.test(env.plain.string));
    }
    const original=links.Updates.at(-1).en;env.language.code='en';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,original);
    env.language.code='zh';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,original);
});
test('Updates heading retains its full text and uses one-line shrink-to-fit',()=>{
    const env=setup();env.language.code='ru';env.plain.string='ОБНОВЛЕНИЯ';env.run(newSource);
    assert.equal(env.plain.string,'ОБНОВЛЕНИЯ');assert.equal(env.plain.enableWrapText,false);
    assert.equal(env.plain.overflow,env.context.cc.Label.Overflow.SHRINK);
    env.plain.string='Другое окно';env.context.window.__pvzRuFontFix.scan();
    assert.equal(env.plain.enableWrapText,true);assert.equal(env.plain.overflow,0);
});
test('UI translation does not overwrite dynamic game changes or player names',()=>{
    const env=setup();env.language.code='ru';env.plain.string='Fast Shovel';env.run(newSource);
    env.plain.string='Different content';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,'Different content');
    env.plain.node.name='PlayerName';env.plain.string='Fast Shovel';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,'Fast Shovel');
});
test('UI map preserves distinct caption casing without abbreviating Updates',()=>{
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(root,'assets/ui-translations-0.16.1.json'),'utf8'))).length,41);
    const env=setup();env.language.code='ru';env.plain.string='Updates';env.run(newSource);
    assert.equal(env.plain.string,'Обновления');
    env.plain.string='UPDATES';env.context.window.__pvzRuFontFix.scan();
    assert.equal(env.plain.string,'ОБНОВЛЕНИЯ');assert.equal(env.plain.enableWrapText,false);
});
test('static FPS tooltip uses the same short caption as the data pack',()=>{
 const env=setup();env.language.code='ru';env.plain.string='Animation Max Frame Rate';env.run(newSource);
 assert.equal(env.plain.string,'Лимит FPS');
});
test('garden medal description wraps into lines and shrinks only as needed',()=>{
 const env=setup();env.language.code='ru';env.plain.enableWrapText=false;
 env.plain.string='Откройте медаль каждого растения,\nиспользовав 3 усилений.';env.run(newSource);
 assert.equal(env.plain.enableWrapText,true);assert.equal(env.plain.overflow,env.context.cc.Label.Overflow.SHRINK);
 assert(env.plain.string.includes('\n'));
 assert(env.plain.string.endsWith('3 усиления.'));assert.equal(env.plain.fontSize,14);
 env.plain.string='Обычная подпись';env.context.window.__pvzRuFontFix.scan();
 assert.equal(env.plain.enableWrapText,false);assert.equal(env.plain.overflow,0);
});
test('polling-only 1.3 reproduces English frames between game writes and the next scan',()=>{
 const env=setup();env.language.code='ru';env.plain.string='Piñata Party Is On! 🎉';env.run(pollingSource);
 assert.notEqual(env.plain.string,'Piñata Party Is On! 🎉');
 env.plain.string='Piñata Party Is On! 🎉';assert.equal(env.plain.string,'Piñata Party Is On! 🎉');
 env.context.window.__pvzRuFontFix.scan();assert.notEqual(env.plain.string,'Piñata Party Is On! 🎉');
});
test('repeated native Pinata writes never reach the renderer in English and keep the font',()=>{
 const env=setup();env.language.code='ru';env.run(newSource);env.plain.writes=[];
 for(let frame=0;frame<180;frame++){
  env.plain.useSystemFont=false;env.plain.fontFamily='Game bitmap font';env.plain.fontSize=20;
  env.plain.string='Piñata Party Is On! 🎉';
  assert.equal(env.plain.string,'Вечеринка с пиньятой началась! 🎉');
  assert.equal(env.plain.writes.at(-1),'Вечеринка с пиньятой началась! 🎉');
  assert.equal(env.plain.fontFamily,'Segoe UI');assert.equal(env.plain.useSystemFont,true);assert.equal(env.plain.fontSize,18);
 }
 assert(!env.plain.writes.includes('Piñata Party Is On! 🎉'));
});
test('native timer writes are translated synchronously with stable font sizes before any scan',()=>{
 const env=setup();env.language.code='ru';env.run(newSource);env.plain.writes=[];
 for(let second=59;second>=0;second--){
  env.plain.string='22 h 2 m '+second+' s';assert.equal(env.plain.string,'22 ч. 2 м. '+second+' с.');
  assert.equal(env.plain.fontSize,18);assert.equal(env.plain.fontFamily,'Segoe UI');
  env.english.string='Истекает через 6 d '+second+' h!';assert.equal(env.english.string,'Истекает через 6 д. '+second+' ч.!');
  assert.equal(env.english.fontSize,14);assert.equal(env.english.fontFamily,'Segoe UI');
 }
 assert(env.plain.writes.every(value=>!/[dhms]/.test(value)));
});
test('setter hooks restore native descriptors on disposal and do not patch RichText segments twice',()=>{
 const env=setup(),nativeSetter=Object.getOwnPropertyDescriptor(env.context.cc.Label.prototype,'string').set;
 env.language.code='ru';env.run(newSource);assert.notEqual(Object.getOwnPropertyDescriptor(env.context.cc.Label.prototype,'string').set,nativeSetter);
 env.rich.string='Применение: <color=#ff0000>одноразовое, мгновенное</color>';
 assert.equal(gap(env.rich),0);assert.equal(env.rich.fontSize,18);assert.equal(env.rich._segments[0].comp.fontSize,18);
 env.context.window.__pvzRuFontFix.dispose();assert.equal(Object.getOwnPropertyDescriptor(env.context.cc.Label.prototype,'string').set,nativeSetter);
 env.plain.string='Fast Shovel';assert.equal(env.plain.string,'Fast Shovel');
 const disposed=env.context.window.__pvzRuFontFix.scan();assert.equal(disposed.disposed,true);assert.equal(env.plain.string,'Fast Shovel');
});
test('Arcade headings, tutorial and reward captions translate before the native write',()=>{
 const env=setup();env.language.code='ru';env.run(newSource);
 for(const [source,expected] of [['Extra Minigames','Дополнительные мини-игры!'],['Plant Decoding','Шифр растений'],["You've earned ",'Заработано: '],[' today.',' за сегодня.'],['Music','Музыка'],['Play','Играть'],["You've earned 10 today!",'Сегодня вы заработали 10!']]){
  env.plain.string=source;assert.equal(env.plain.string,expected);
 }
 const report=JSON.parse(fs.readFileSync(path.join(root,'event-ui-report.json'),'utf8'));
 assert(report.tutorialVariants.length>0);
 for(const source of report.tutorialVariants){env.plain.string=source;assert(env.plain.string.startsWith('Пробуйте разные варианты,'));assert(env.plain.string.includes('Правая кнопка мыши'));assert.equal(env.plain.overflow,env.context.cc.Label.Overflow.SHRINK);}
});
test('medal grammar and extra size reduction apply synchronously without changing the count',()=>{
 const env=setup();env.language.code='ru';env.run(newSource,{...defaults,fontScale:1,lineHeightScale:1});
 env.plain.string='Откройте медаль каждого растения,\nиспользовав 3 усилений.';
 assert(env.plain.string.endsWith('3 усиления.'));assert.equal(env.plain.fontSize,16);assert.equal(env.plain.lineHeight,19);
 for(let i=0;i<20;i++){env.plain.string='Откройте медаль каждого растения,\nиспользовав 3 усилений.';assert.equal(env.plain.fontSize,16);assert(env.plain.string.endsWith('3 усиления.'));}
});
test('all EventList captions have their existing Russian translations at runtime',()=>{
 const env=setup();env.language.code='ru';env.run(newSource);
 const events=JSON.parse(fs.readFileSync(path.join(root,'build/pack-'+targetVersion+'/jsons/features/EventList.json'),'utf8'));
 let count=0;
 function visit(v){if(!v||typeof v!=='object')return;if(typeof v.en==='string'&&typeof v.ru==='string'){
  env.plain.string=v.en;env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,v.ru);count++;
 }for(const c of Object.values(v))visit(c);}
 visit(events);assert.equal(count,targetVersion==='0.16.31'?80:73);
});
test('Pinata and ticket timer units become Russian without changing numeric values',()=>{
 const env=setup();env.language.code='ru';env.run(newSource);
 const examples=new Map([
  ['6 d 14 h','6 д. 14 ч.'],['22 h 2 m 9 s','22 ч. 2 м. 9 с.'],
  ['Истекает через 6 d 14 h!','Истекает через 6 д. 14 ч.!'],
  ['бесплатно через 2 m 1 s','бесплатно через 2 м. 1 с.'],
  ['до следующего: 0 h 15 m 0 s','до следующего: 0 ч. 15 м. 0 с.'],
  ['22h 2min LEFT!','Осталось 22 ч. 2 м.'],['Expire in 3 d 0 h!','Истекает через 3 д. 0 ч.!']
 ]);
 for(const [original,expected] of examples){env.plain.string=original;env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,expected);assert.deepEqual(original.match(/\d+/g),env.plain.string.match(/\d+/g));}
 env.language.code='en';env.plain.string='6 d 14 h';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,'6 d 14 h');
 env.language.code='ru';env.plain.string='Damage 10, speed 5m';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.string,'Damage 10, speed 5m');
});
test('only the red-ticket expiry caption gets an additional 20 percent size reduction',()=>{
 const env=setup();env.language.code='ru';env.plain.string='Истекает через 6 d 14 h!';env.run(newSource,{...defaults,fontScale:1,lineHeightScale:1});
 assert.equal(env.plain.fontSize,16);assert.equal(env.plain.lineHeight,19);
 for(let i=0;i<10;i++)env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,16);
 env.plain.string='22 h 2 m 9 s';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,20);
 env.plain.string='Истекает через 5 d 13 h!';env.context.window.__pvzRuFontFix.scan();assert.equal(env.plain.fontSize,16);
 env.context.window.__pvzRuFontFix.applyConfig({enabled:false});assert.equal(env.plain.fontSize,20);
});
