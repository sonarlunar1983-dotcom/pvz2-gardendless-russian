const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const version=process.argv[2]||'0.15.0';
assert(['0.15.0','0.16.1','0.16.15','0.16.27','0.16.31'].includes(version),'Unsupported build target');
const oldRoot = path.join(root, version==='0.16.31'?'build/pack-0.16.27':version==='0.16.27'?'build/pack-0.16.15':version==='0.15.0'?'ru-0.14.0':version==='0.16.15'?'build/pack-0.16.1':'build/pack-0.15.0');
const baseRoot = path.join(root, 'base-'+version);
const output = path.join(root, 'build', 'pack-'+version);
const reportSuffix=version==='0.15.0'?'':'-'+version;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function files(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]).filter(f => f.endsWith('.json'));
}
function identity(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (v.CODENAME) return 'code=' + v.CODENAME;
  if (v.aliases?.[0]) return 'alias=' + v.aliases[0];
  if (v.objclass) return 'class=' + v.objclass;
  if (v.CommodityName) return 'commodity=' + v.CommodityName;
  if (v.Family) return 'family=' + v.Family;
  return null;
}
function textNodes(data) {
  const nodes = [];
  function visit(value, pointer, stable, context) {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && ['en', 'zh', 'ru'].some(k => typeof value[k] === 'string')) {
      nodes.push({pointer, stable, context, value});
      return;
    }
    if (Array.isArray(value)) {
      const ids = value.map(identity);
      const counts = new Map();
      for (const id of ids) if (id) counts.set(id, (counts.get(id) || 0) + 1);
      value.forEach((child, i) => visit(child, pointer + '/' + i, stable + '/' + (ids[i] && counts.get(ids[i]) === 1 ? '@' + ids[i] : i), context));
    } else {
      const nextContext = value.Character || value.Action ? JSON.stringify([value.Character, value.Action]) : context;
      for (const [key, child] of Object.entries(value)) if (key !== '_languages') visit(child, pointer + '/' + key, stable + '/' + key, nextContext);
    }
  }
  visit(data, '', '', '');
  return nodes;
}
const sourceKey = value => JSON.stringify([value.en, value.zh]);
const globalTranslations = new Map();
const legacyTranslations = new Map();
if(version!=='0.15.0')for(const f of files(path.join(root,'ru-0.14.0'))){
 if(path.basename(f)==='pack.json')continue;
 for(const node of textNodes(read(f)))if(typeof node.value.ru==='string'){
  const key=sourceKey(node.value);if(!legacyTranslations.has(key))legacyTranslations.set(key,new Set());legacyTranslations.get(key).add(node.value.ru);
 }
}
const oldFiles = new Map();
for (const file of files(oldRoot)) {
  const relative = path.relative(oldRoot, file).replaceAll('\\', '/');
  if (relative === 'pack.json') continue;
  const nodes = textNodes(read(file));
  oldFiles.set(relative, nodes);
  for (const node of nodes) {
    if (typeof node.value.ru !== 'string') continue;
    const key = sourceKey(node.value);
    if (!globalTranslations.has(key)) globalTranslations.set(key, new Set());
    globalTranslations.get(key).add(node.value.ru);
  }
}
const overrideFile = path.join(root, 'assets', 'translations-'+version+'.json');
const overrides = fs.existsSync(overrideFile) ? read(overrideFile) : {};
const wordingFile=path.join(root,'assets','wording-'+version+'.json');
const wording=fs.existsSync(wordingFile)?read(wordingFile):null;
const usedOverrides = new Set();
const removedFiles=[...oldFiles.keys()].filter(f=>!fs.existsSync(path.join(baseRoot,f)));
const selected = [...oldFiles.keys()].filter(f=>fs.existsSync(path.join(baseRoot,f)));
for (const file of files(baseRoot)) {
  const relative = path.relative(baseRoot, file).replaceAll('\\', '/');
  if (relative.startsWith('jsons/levels/') && !oldFiles.has(relative) && textNodes(read(file)).length) selected.push(relative);
}
const pending = [], records = [], documents = [];
const unique = candidates => {
  const values = new Set(candidates.filter(n => typeof n.value.ru === 'string').map(n => n.value.ru));
  return values.size === 1 ? [...values][0] : undefined;
};
for (const relative of selected) {
  const original = read(path.join(baseRoot, relative));
  const data = structuredClone(original);
  const nodes = textNodes(data), old = oldFiles.get(relative) || [];
  for (const node of nodes) {
    const key = relative + '#' + node.pointer;
    let ru, method;
    if (overrides[key]) {
      const override = overrides[key];
      assert.equal(override.en, node.value.en, 'Override source changed: ' + key);
      assert.equal(override.zh, node.value.zh, 'Override source changed: ' + key);
      assert.equal(typeof override.ru, 'string');
      ru = override.ru; method = 'reviewed'; usedOverrides.add(key);
    } else {
      const matching = old.filter(n => sourceKey(n.value) === sourceKey(node.value));
      ru = unique(matching.filter(n => n.stable === node.stable && n.context === node.context)); method = 'stable';
      if (ru === undefined) { ru = unique(matching.filter(n => n.context === node.context)); method = 'same-file-context'; }
      if (ru === undefined) { ru = unique(matching); method = 'same-file-source'; }
      if (ru === undefined) {
        const values = globalTranslations.get(sourceKey(node.value));
        if (values?.size === 1) { ru = [...values][0]; method = 'global-source'; }
      }
      if (ru === undefined) {
        const values = legacyTranslations.get(sourceKey(node.value));
        if (values?.size === 1) { ru = [...values][0]; method = 'legacy-source'; }
      }
    }
    if (ru === undefined) pending.push({key, file:relative, pointer:node.pointer, stable:node.stable, context:node.context, en:node.value.en, zh:node.value.zh});
    else {
      const inheritedMethod=method;
      if(wording){
        let replacement;
        if(relative==='jsons/lang/lang.json'&&node.pointer==='/SettingLyrics/AnimationMaxFrameRate') replacement=wording.maxFrameRate;
        if(relative==='jsons/lang/lang.json'&&node.pointer==='/PlantMedals/Description') replacement=wording.plantMedalsDescription;
        if(relative==='jsons/objects/ZombieAlmanac.json'&&/\/Elements\/\d+\/SORT$/.test(node.pointer)){
          const element=node.pointer.split('/').slice(1,-1).reduce((v,k)=>v[k],original);
          const replacements=wording[element.TYPE];
          if(replacements&&Object.hasOwn(replacements,ru))replacement=replacements[ru];
        }
        if(typeof replacement==='string'&&replacement!==ru){ru=replacement;method='editorial';}
      }
      node.value.ru = ru; records.push({key,method,...(method==='editorial'?{inheritedMethod}:{}),ru});
    }
  }
  if (relative === 'jsons/lang/lang.json') {
    data._languages = [...(data._languages || []).filter(l => l.code !== 'ru'), {code:'ru',name:'Русский',isCJK:false}];
  }
  documents.push({relative, original, data});
}
for (const key of Object.keys(overrides)) assert(usedOverrides.has(key), 'Unused override: ' + key);
const report = {version,files:selected.length,translated:records.length,removedFiles,pending,methods:Object.fromEntries([...new Set(records.map(r=>r.method))].map(m=>[m,records.filter(r=>r.method===m).length])),records};
fs.writeFileSync(path.join(root,'build-report'+reportSuffix+'.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(root,'pending-translations'+reportSuffix+'.json'),JSON.stringify(pending,null,2));
if (pending.length) { console.log(JSON.stringify({files:selected.length,translated:records.length,pending:pending.length},null,2)); process.exitCode=2; }
else {
  for (const {relative,data} of documents) {
    const dest=path.join(output,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(data,null,2));
  }
  const manifest=read(path.join(oldRoot,'pack.json'));
  Object.assign(manifest,{name:'Русификатор PvZ2 Gardendless '+version,version:version==='0.16.31'?'1.3.2':version==='0.16.27'?'1.3.1':version==='0.15.0'?'1.1.0':version==='0.16.15'?'1.3.0':'1.2.3',gameVersion:version,description:'Русская локализация '+version+' на основе перевода KRUTONIK для 0.14.0. Пробная сборка.',author:'KRUTONIK (перевод 0.14.0); адаптация '+version});
  fs.writeFileSync(path.join(output,'pack.json'),JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({files:selected.length,translated:records.length,pending:0,output,methods:report.methods},null,2));
}
