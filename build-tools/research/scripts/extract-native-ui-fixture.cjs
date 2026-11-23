// Extract only the dialog/Markdown dependency graph, never the game bootstrap.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const acorn=require(path.join(root,'tools/code-analysis/node_modules/acorn'));
const scope=require(path.join(root,'tools/code-analysis/node_modules/eslint-scope'));
const assets=path.join(root,'extracted-0.16.31/assets');
const name=fs.readdirSync(assets).find(n=>/^game-.*\.js$/.test(n));
const source=fs.readFileSync(path.join(assets,name),'utf8');
const ast=acorn.parse(source,{ecmaVersion:2022,sourceType:'module',ranges:true});
const variables=scope.analyze(ast,{ecmaVersion:2022,sourceType:'module'}).scopes.find(s=>s.type==='module').variables;
const selected=new Set();
function include(node){
 assert(node,'Expected UI declaration');if(selected.has(node))return;selected.add(node);
 assert.notEqual(node.type,'ImportDeclaration','UI fixture must not import the game runtime');
 for(const variable of variables)if(variable.references.some(ref=>ref.identifier.start>=node.start&&ref.identifier.end<=node.end)){
  const definition=variable.defs[0];
  if(definition){const owner=ast.body.find(n=>n.start<=definition.node.start&&n.end>=definition.node.end);if(owner&&owner!==node)include(owner);}
 }
}
for(const name of ['$t','At','on'])include(ast.body.find(node=>node.id?.name===name));
// marked exposes its parser through this property assignment chain.
const parserSetup=ast.body.filter(n=>n.type==='ExpressionStatement'&&source.slice(n.start,n.end).startsWith('Y.'));
assert.equal(parserSetup.length,2,'Review updated Markdown initialization');parserSetup.forEach(include);
let output=ast.body.filter(n=>selected.has(n)).map(n=>source.slice(n.start,n.end)).join('\n');
assert(!/\b(?:Wr|Br)\(\),/.test(output),'Unexpected bootstrap invocation');
output=output.replaceAll('import.meta.url','document.baseURI');
output='(()=>{\n'+output+'\nwindow.makeDialog=$t;window.renderMarkdown=At;window.appendMarkdown=on;})();';
fs.mkdirSync(path.join(root,'build'),{recursive:true});
fs.writeFileSync(path.join(root,'build/native-fixture-0.16.31.js'),output);
console.log('Extracted '+selected.size+' UI declarations; no game imports or bootstrap');
