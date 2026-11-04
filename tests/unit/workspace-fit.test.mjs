import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseWorkspaceFit} from '../../src/ui/product/fit.js';

test('有空间时增大到舒展尺寸，保留可读控件和合理间距',()=>{
 const fit=chooseWorkspaceFit(scale=>({required:300+100*scale,available:600}));
 assert.equal(fit.scale,2);assert.equal(fit.density,'comfortable');
});
test('标准尺寸能放下时利用剩余空间，而不是留出大块页尾空白',()=>{
 const fit=chooseWorkspaceFit(scale=>({required:300+100*scale,available:450}));
 assert.ok(fit.scale>=1.45 && fit.scale<=1.51);assert.equal(fit.density,'comfortable');
});
test('只压缩到能放下所需的程度，不直接降到最紧凑档',()=>{
 const fit=chooseWorkspaceFit(scale=>({required:400+200*scale,available:500}));
 assert.ok(fit.scale>=.45 && fit.scale<=.51);assert.equal(fit.density,'compact');
});
test('紧凑仍放不下才滚动，隐藏窗口不重新决定密度',()=>{
 assert.deepEqual(chooseWorkspaceFit(scale=>({required:600+100*scale,available:500})),{scale:0,density:'scroll'});
 assert.equal(chooseWorkspaceFit(()=>({required:400,available:0})),null);
});
