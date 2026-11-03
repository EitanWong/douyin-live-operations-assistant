import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {bundleStandalone} from '../../scripts/standalone-build.mjs';

test('独立构建保留 ESM 多行导入、别名、同名局部量及副作用语义',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'douyin-module-semantics-'));
  try {
    await writeFile(join(dir,'a.js'),'const value=2; export {value};');
    await writeFile(join(dir,'b.js'),'const value=3; export default value; globalThis.order.push("side");');
    await writeFile(join(dir,'entry.js'),'import {\n value as first\n} from "./a.js";\nimport second from "./b.js";\nimport "./b.js";\nglobalThis.result=first+second;');
    const source=await bundleStandalone({entry:join(dir,'entry.js')}),context={order:[]};vm.runInNewContext(source,context);
    assert.equal(context.result,5);assert.deepEqual(context.order,['side']);
  } finally {await rm(dir,{recursive:true,force:true});}
});
