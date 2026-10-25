import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildModules } from '../../scripts/build-modules.mjs';

test('独立脚本构建自动包含引擎新增依赖，PK 默认值在引擎之前初始化且不重复',async()=>{
  const modules = await resolveBuildModules(['core/engine','pk/operations'],new URL('../../src/',import.meta.url));
  assert.ok(modules.indexOf('pk/operations') < modules.indexOf('core/engine'));
  assert.ok(modules.includes('core/moderation'));
  assert.equal(modules.filter(name=>name==='pk/operations').length,1);
});
