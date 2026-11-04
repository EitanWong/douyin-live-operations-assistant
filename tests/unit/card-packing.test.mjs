import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cardRuns,packPageCards} from '../../src/ui/product/layout.js';

test('显式通栏与普通组件各自成排，不干扰相邻行',()=>{
 const items=[{id:'a'},{id:'b'},{id:'wide',span:'full'},{id:'c'}];
 assert.deepEqual(cardRuns(items).map(run=>run.map(row=>row.id)),[['a','b'],['wide'],['c']]);
 assert.ok(items.every(row=>row.size===undefined));
});
test('页面说明接入同一布局，由短折叠区统一分排',()=>{
 const children=[{id:'intro',tag:'p'},{id:'grid',layout:'cards',children:[{id:'a',surface:'card'}]},{id:'help',kind:'details',classes:'workspace-help'}];
 const packed=packPageCards(children);
 assert.deepEqual(packed.map(row=>row.id),['intro','grid']);
 assert.deepEqual(packed[1].children.map(row=>row.id),['a','help']);
 assert.equal(children[1].children.length,1,'不改变原桥接快照');
});
test('短折叠操作单独成排，不与主配置共用被撑高的行，展开时位置保持稳定',()=>{
 const config={id:'config',surface:'card'},manage={id:'manage',kind:'details',open:false},help={id:'help',kind:'details',open:false},next={id:'next',surface:'card'};
 const rows=items=>cardRuns(items).map(run=>run.map(item=>item.id));
 assert.deepEqual(rows([config,manage,help,next]),[['config'],['manage','help'],['next']]);
 assert.deepEqual(rows([config,{...manage,open:true},help,next]),[['config'],['manage','help'],['next']]);
 assert.equal(manage.open,false);
});
