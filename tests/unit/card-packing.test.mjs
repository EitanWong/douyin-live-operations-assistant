import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cardRuns,packPageCards} from '../../src/ui/product/layout.js';

test('通栏前后分别计算实际列数，不把上一组的空列带到下一组',()=>{
 const items=[{id:'a'},{id:'b'},{id:'wide',span:'full'},{id:'c'}];
 assert.deepEqual(cardRuns(items).map(run=>run.map(row=>row.id)),[['a','b'],['wide'],['c']]);
 assert.ok(items.every(row=>row.size===undefined));
});
test('页面说明接入已有卡片流，不在最长卡片后制造整行断层',()=>{
 const children=[{id:'intro',tag:'p'},{id:'grid',layout:'cards',children:[{id:'a',surface:'card'}]},{id:'help',kind:'details',classes:'workspace-help'}];
 const packed=packPageCards(children);
 assert.deepEqual(packed.map(row=>row.id),['intro','grid']);
 assert.deepEqual(packed[1].children.map(row=>row.id),['a','help']);
 assert.equal(children[1].children.length,1,'不改变原桥接快照');
});
