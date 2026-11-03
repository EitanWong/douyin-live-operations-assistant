import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readPackageLicense} from '../../scripts/dependency-licenses.mjs';

test('依赖许可证按目录实际大小写读取，兼容 Linux 的小写 license',async()=>{
  const root=await mkdtemp(join(tmpdir(),'douyin-licenses-'));
  try {
    for(const [name,file] of [['clsx','license'],['upper','LICENSE'],['markdown','License.md'],['text','license.txt']]) {
      const directory=join(root,'node_modules',name);await mkdir(directory,{recursive:true});
      await writeFile(join(directory,file),`MIT license for ${name}`);
      assert.equal(await readPackageLicense(root,name),`MIT license for ${name}`);
    }
  } finally {await rm(root,{recursive:true,force:true});}
});

test('只为缺许可证的已知依赖使用已保存原文；其他缺失必须阻止构建',async()=>{
  const root=await mkdtemp(join(tmpdir(),'douyin-license-fallback-'));
  try {
    for(const name of ['react-remove-scroll-bar','missing'])await mkdir(join(root,'node_modules',name),{recursive:true});
    const vendor=join(root,'vendor/runtime-licenses/react-remove-scroll-bar');await mkdir(vendor,{recursive:true});
    await writeFile(join(vendor,'LICENSE'),'saved MIT license');
    assert.equal(await readPackageLicense(root,'react-remove-scroll-bar'),'saved MIT license');
    await assert.rejects(readPackageLicense(root,'missing'),/Missing license for missing/);
    await writeFile(join(root,'node_modules/react-remove-scroll-bar/LICENSE'),'upstream license');
    assert.equal(await readPackageLicense(root,'react-remove-scroll-bar'),'upstream license');
  } finally {await rm(root,{recursive:true,force:true});}
});
