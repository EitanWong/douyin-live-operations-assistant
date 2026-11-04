import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseWorkspaceFit} from '../../src/ui/product/fit.js';

test('标准排版能一页展示时保留标准尺寸，不继续压缩或滚动',()=>{
 const measured=[];
 const result=chooseWorkspaceFit(density=>{measured.push(density);return {required:450,available:500};});
 assert.equal(result,'comfortable');assert.deepEqual(measured,['comfortable']);
});

test('标准排版放不下时，紧凑排版能放下就一页展示',()=>{
 const measured=[];
 const result=chooseWorkspaceFit(density=>{measured.push(density);return {required:density==='comfortable' ? 620 : 440,available:density==='comfortable' ? 500 : 530};});
 assert.equal(result,'compact');assert.deepEqual(measured,['comfortable','compact']);
});

test('只有标准和紧凑排版都放不下，才保留紧凑尺寸并滚动',()=>{
 const result=chooseWorkspaceFit(density=>({required:density==='comfortable' ? 1400 : 1100,available:500}));
 assert.equal(result,'scroll');
});

test('隐藏窗口不重新决定密度，亚像素舍入不制造无意义滚动',()=>{
 assert.equal(chooseWorkspaceFit(()=>({required:400,available:0})),null);
 assert.equal(chooseWorkspaceFit(()=>({required:500.5,available:500})),'comfortable');
});
