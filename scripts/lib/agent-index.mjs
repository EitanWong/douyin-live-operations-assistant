import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {posix,join} from 'node:path';
import {parse} from 'acorn';

// Keep generated data outside these roots; no timestamps, machine paths or
// evaluated application code belong in this portable development index.
export const INDEX_ROOTS=['src','extension','scripts','tests','demo'];
export const INDEX_PATH='docs/development/agent-index.json';
const RESOURCE_APIS=new Set(['setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame',
  'addEventListener','removeEventListener','MutationObserver','ResizeObserver','IntersectionObserver','Worker','WebSocket','AbortController','createObjectURL','revokeObjectURL']);

async function listFiles(root,directory){
  let entries;
  try {entries=await readdir(join(root,directory),{withFileTypes:true});}
  catch(error){if(error.code==='ENOENT')return [];throw error;}
  const files=[];
  for(const entry of entries){
    const path=posix.join(directory,entry.name);
    if(entry.isDirectory())files.push(...await listFiles(root,path));
    else if(entry.isFile() && /\.(?:mjs|js)$/.test(path))files.push(path);
  }
  return files.sort();
}

function literal(node){
  if(node?.type==='Literal' && typeof node.value==='string')return node.value;
  if(node?.type==='TemplateLiteral' && !node.expressions.length)return node.quasis[0].value.cooked;
  return null;
}

function bindingNames(node){
  if(!node)return [];
  if(node.type==='Identifier')return [node.name];
  if(node.type==='RestElement')return bindingNames(node.argument);
  if(node.type==='AssignmentPattern')return bindingNames(node.left);
  if(node.type==='ArrayPattern')return node.elements.flatMap(bindingNames);
  if(node.type==='ObjectPattern')return node.properties.flatMap(property=>bindingNames(property.value || property.argument));
  return [];
}

function declarationSymbols(node){
  if(!node)return [];
  const symbol=(name,kind,at=node)=>({name,kind,line:at.loc.start.line});
  if(node.type==='FunctionDeclaration')return [symbol(node.id?.name || 'default','function')];
  if(node.type==='ClassDeclaration'){
    const name=node.id?.name || 'default';
    return [symbol(name,'class'),...node.body.body.filter(member=>!member.computed && member.key).map(member=>symbol(`${name}.${member.key.name || member.key.value}`,'member',member))];
  }
  if(node.type==='VariableDeclaration')return node.declarations.flatMap(item=>bindingNames(item.id).map(name=>symbol(name,/FunctionExpression$/.test(item.init?.type || '') ? 'function' : node.kind,item)));
  return [];
}

function walk(node,visit){
  if(!node || typeof node!=='object')return;
  if(node.type)visit(node);
  for(const [key,value] of Object.entries(node)){
    if(key==='loc')continue;
    if(Array.isArray(value)){for(const child of value)if(child?.type)walk(child,visit);}
    else if(value?.type)walk(value,visit);
  }
}

function localTarget(path,source,known){
  if(!source)return null;
  const clean=source.split(/[?#]/u)[0];
  const target=source.startsWith('.') ? posix.normalize(posix.join(posix.dirname(path),clean)) : clean;
  return known.has(target) ? target : null;
}

function describeFile(path,source,known){
  let tree;
  try {tree=parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true,allowHashBang:true});}
  catch(error){throw new Error(`${path}: ${error.message}`,{cause:error});}
  const imports=[],exports=new Set(),symbols=[],references=new Set(),dynamicImports=[],resources=[],tests=[];
  const dependency=(source,kind,line)=>{
    const target=localTarget(path,source,known);
    imports.push({source,kind,line,...(target ? {target} : {})});
  };
  for(const node of tree.body){
    const declaration=node.type.startsWith('Export') ? node.declaration : node;
    const declared=declarationSymbols(declaration);symbols.push(...declared);
    if(node.type==='ExportDefaultDeclaration')exports.add('default');
    if(node.type==='ExportNamedDeclaration'){
      for(const item of declared)if(item.kind!=='member')exports.add(item.name);
      for(const item of node.specifiers)exports.add(item.exported.name ?? item.exported.value);
    }
    if(node.type==='ExportAllDeclaration')exports.add(node.exported?.name || '*');
  }
  walk(tree,node=>{
    if(node.type==='CallExpression' || node.type==='NewExpression'){
      const name=node.callee.type==='Identifier' ? node.callee.name : !node.callee.computed ? node.callee.property?.name : null;
      if(RESOURCE_APIS.has(name))resources.push({name,kind:'resource',line:node.loc.start.line});
      const title=literal(node.arguments[0]);
      if(path.startsWith('tests/') && ['test','it'].includes(name) && title)tests.push({name:title,kind:'test',line:node.loc.start.line});
    }
    if(node.type==='ImportDeclaration')dependency(node.source.value,'static',node.loc.start.line);
    if(node.type.startsWith('Export') && node.source)dependency(node.source.value,'reexport',node.loc.start.line);
    if(node.type==='ImportExpression'){
      const source=literal(node.source);
      if(source!==null)dependency(source,'dynamic',node.loc.start.line);
      else dynamicImports.push(node.loc.start.line);
    }
    // Build entryPoints, readFile/new URL fixtures and dist paths are references,
    // not runtime imports. Resolve only literals matching actual indexed files.
    const target=localTarget(path,literal(node),known);
    if(target && target!==path)references.add(target);
  });
  for(const item of imports)if(item.target)references.delete(item.target);
  return {path,sha256:createHash('sha256').update(source).digest('hex'),bytes:Buffer.byteLength(source),lines:source.split('\n').length,
    imports,exports:[...exports].sort(),symbols,references:[...references].sort(),dynamicImports,resources,tests};
}

export async function createIndex(root){
  const paths=(await Promise.all(INDEX_ROOTS.map(directory=>listFiles(root,directory)))).flat().sort(),known=new Set(paths),files=[];
  // Parse one file at a time; do not retain every AST or all source text at once.
  for(const path of paths)files.push(describeFile(path,await readFile(join(root,path),'utf8'),known));
  return {schemaVersion:1,roots:INDEX_ROOTS,files};
}

export function serializeIndex(index){
  // One module per line makes regeneration reviewable without huge nested diffs.
  return `{"schemaVersion":${index.schemaVersion},"roots":${JSON.stringify(index.roots)},"files":[\n${index.files.map(file=>JSON.stringify(file)).join(',\n')}\n]}\n`;
}

export async function checkIndex(root,path=join(root,INDEX_PATH)){
  let saved;
  try {saved=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return false;throw error;}
  return saved===serializeIndex(await createIndex(root));
}

export function findSymbols(index,query){
  const term=query.toLowerCase(),hits=[];
  for(const file of index.files){
    if(file.path.toLowerCase().includes(term))hits.push({path:file.path,line:1,kind:'file',exports:file.exports});
    for(const symbol of [...file.symbols,...file.resources,...file.tests])if(symbol.name.toLowerCase().includes(term))hits.push({path:file.path,...symbol});
  }
  return hits;
}

export function impact(index,paths){
  const known=new Set(index.files.map(file=>file.path)),reverse=new Map();
  for(const path of paths)if(!known.has(path))throw new Error(`索引未收录 ${path}；检查路径或运行 npm run agent:index`);
  for(const file of index.files){
    for(const target of new Set([...file.imports.map(item=>item.target).filter(Boolean),...file.references])){
      if(!reverse.has(target))reverse.set(target,new Set());
      reverse.get(target).add(file.path);
    }
  }
  const visited=new Set(paths),queue=[...visited];
  for(let i=0;i<queue.length;i++)for(const dependent of reverse.get(queue[i]) || [])if(!visited.has(dependent)){visited.add(dependent);queue.push(dependent);}
  const affected=[...visited].sort();
  return {changed:[...new Set(paths)].sort(),affected,tests:affected.filter(path=>/^tests\/.*\.test\.mjs$/.test(path)),
    dynamicImports:index.files.filter(file=>file.dynamicImports.length).map(file=>({path:file.path,lines:file.dynamicImports}))};
}
