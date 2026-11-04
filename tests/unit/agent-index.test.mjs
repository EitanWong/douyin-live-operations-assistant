import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIndex,serializeIndex,checkIndex,impact,findSymbols} from '../../scripts/lib/agent-index.mjs';

async function fixture(run){
  const root=await mkdtemp(join(tmpdir(),'agent-index-'));
  try {
    for(const dir of ['src','tests/unit','scripts'])await mkdir(join(root,dir),{recursive:true});
    await writeFile(join(root,'src/a.js'),'export function start() { return 1; }\nexport class Queue { close() {} }\n');
    await writeFile(join(root,'src/b.js'),"export {start as run} from './a.js';\nexport const load=()=>import('./c.js');\n");
    await writeFile(join(root,'src/c.js'),"import './b.js';\nexport const value=2;\n");
    await writeFile(join(root,'tests/unit/a.test.mjs'),"import {run} from '../../src/b.js';\n");
    await writeFile(join(root,'tests/unit/bundle.test.mjs'),"const options={entryPoints:['src/a.js']};\n");
    await run(root);
  } finally {await rm(root,{recursive:true,force:true});}
}

test('索引解析真实语法与符号行号，包含重导出、动态依赖与构建引用',()=>fixture(async root=>{
  const index=await createIndex(root),a=index.files.find(file=>file.path==='src/a.js');
  assert.ok(a.symbols.some(symbol=>symbol.name==='Queue.close' && symbol.line===2));
  assert.ok(findSymbols(index,'start').some(hit=>hit.path==='src/a.js' && hit.line===1));
  const b=index.files.find(file=>file.path==='src/b.js');
  assert.ok(b.imports.some(item=>item.target==='src/a.js' && item.kind==='reexport'));
  assert.ok(b.imports.some(item=>item.target==='src/c.js' && item.kind==='dynamic'));
  assert.deepEqual(b.exports,['load','run']);
  assert.ok(index.files.find(file=>file.path.endsWith('bundle.test.mjs')).references.includes('src/a.js'));
  assert.equal(serializeIndex(index),serializeIndex(await createIndex(root)),'重复生成必须逐字一致');
}));

test('影响分析终止于循环依赖，报告直接/间接测试及已删除文件的旧影响',()=>fixture(async root=>{
  const index=await createIndex(root),result=impact(index,['src/a.js']);
  assert.deepEqual(result.tests,['tests/unit/a.test.mjs','tests/unit/bundle.test.mjs']);
  assert.ok(result.affected.includes('src/c.js'));
  await rm(join(root,'src/a.js'));
  assert.deepEqual(impact(index,['src/a.js']).tests,result.tests);
  assert.throws(()=>impact(index,['src/typo.js']),/未收录/);
}));

test('校验发现新增、改动、删除与过期索引，检查模式不写入文件',()=>fixture(async root=>{
  const saved=serializeIndex(await createIndex(root)),path=join(root,'index.json');await writeFile(path,saved);
  assert.equal(await checkIndex(root,path),true);
  await writeFile(join(root,'src/a.js'),'export const replacement=3;\n');
  assert.equal(await checkIndex(root,path),false);assert.equal(await readFile(path,'utf8'),saved);
  await writeFile(path,serializeIndex(await createIndex(root)));
  await writeFile(join(root,'src/new.js'),'export const added=true;');assert.equal(await checkIndex(root,path),false);
  await writeFile(path,serializeIndex(await createIndex(root)));
  await rm(join(root,'src/new.js'));assert.equal(await checkIndex(root,path),false);
}));

test('非字面量加载明确标注，注释和字符串中的伪声明不会变成符号',()=>fixture(async root=>{
  await writeFile(join(root,'src/d.js'),"// function fake() {}\nconst text='export function alsoFake() {}';\nexport function open(path) { return import(path); }\n");
  const index=await createIndex(root),d=index.files.find(file=>file.path==='src/d.js');
  assert.equal(findSymbols(index,'alsoFake').length,0);
  assert.deepEqual(d.dynamicImports,[3]);assert.equal(d.symbols.find(symbol=>symbol.name==='open').line,3);
  await writeFile(join(root,'src/invalid.js'),'export const = ;');
  await assert.rejects(createIndex(root),/src\/invalid.js/);
}));

test('资源创建/回收位置与测试名称可检索，不把普通字符串当成资源调用',()=>fixture(async root=>{
  await writeFile(join(root,'src/timers.js'),"export function start() { return setInterval(()=>{},100); }\nexport function stop(id) { clearInterval(id); }\nconst text='setTimeout';\n");
  await writeFile(join(root,'tests/unit/timers.test.mjs'),"import {test} from 'node:test';\ntest('停止后清理计时器',()=>{});\n");
  const index=await createIndex(root);
  assert.deepEqual(findSymbols(index,'setInterval').filter(hit=>hit.kind==='resource'),[{path:'src/timers.js',name:'setInterval',kind:'resource',line:1}]);
  assert.equal(findSymbols(index,'setTimeout').length,0);
  assert.ok(findSymbols(index,'停止后清理').some(hit=>hit.kind==='test' && hit.line===2));
}));
