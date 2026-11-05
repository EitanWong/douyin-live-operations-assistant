import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseWorkspaceFit} from '../../src/ui/product/fit.js';

test('有空间时保持标准尺寸，不为填满页面放大间距',()=>{
 const fit=chooseWorkspaceFit(scale=>({required:300+100*scale,available:600}));
 assert.equal(fit.scale,1);assert.equal(fit.density,'comfortable');
});
test('空间充足时保留标准控件密度',()=>{
 const fit=chooseWorkspaceFit(scale=>({required:300+100*scale,available:450}));
 assert.equal(fit.scale,1);assert.equal(fit.density,'comfortable');
});

test('页面有余量时增高共享卡片，恰好利用剩余空间且不产生滚动',()=>{
 const measure=(scale,fill=0)=>({required:300+100*scale+500*fill,available:650});
 const fit=chooseWorkspaceFit(measure);
 assert.equal(fit.scale,1);assert.equal(fit.density,'comfortable');
 assert.ok(fit.fill>.499 && fit.fill<=.5);
 assert.ok(measure(fit.scale,fit.fill).required<=650);
});

test('内容需要压缩或页面空间不足时不增高，隐藏时不重置布局',()=>{
 const fit=chooseWorkspaceFit((scale,fill=0)=>({required:400+200*scale+500*fill,available:500}));
 assert.equal(fit.density,'compact');assert.equal(fit.fill,0);
 assert.equal(chooseWorkspaceFit(()=>({required:700,available:500})).fill,0);
});
test('只压缩到能放下所需的程度，不直接降到最紧凑档',()=>{
 const fit=chooseWorkspaceFit(scale=>({required:400+200*scale,available:500}));
 assert.ok(fit.scale>=.45 && fit.scale<=.51);assert.equal(fit.density,'compact');
});
test('紧凑仍放不下才滚动，隐藏窗口不重新决定密度',()=>{
 assert.deepEqual(chooseWorkspaceFit(scale=>({required:600+100*scale,available:500})),{scale:0,density:'scroll',fill:0});
 assert.equal(chooseWorkspaceFit(()=>({required:400,available:0})),null);
});
