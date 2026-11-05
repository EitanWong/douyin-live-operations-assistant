import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cardRuns,packPageCards} from '../../src/ui/product/layout.js';

test('显式通栏与普通组件各自成排，不干扰相邻行',()=>{
 const items=[{id:'a'},{id:'b'},{id:'wide',span:'full'},{id:'c'}];
 assert.deepEqual(cardRuns(items).map(run=>run.map(row=>row.id)),[['a','b'],['wide'],['c']]);
 assert.ok(items.every(row=>row.size===undefined));
});
test('礼物概况与配置分别成排，不让空记录随长表单撑高',()=>{
 const items=[{id:'total',band:'summary'},{id:'recent',band:'summary'},{id:'rules'},{id:'copy'}];
 assert.deepEqual(cardRuns(items).map(run=>run.map(item=>item.id)),[['total','recent'],['rules','copy']]);
});
test('页面说明接入共用布局，收起时不占用等高卡片的空壳',()=>{
 const children=[{id:'intro',tag:'p'},{id:'grid',layout:'cards',children:[{id:'a',surface:'card'}]},{id:'help',kind:'details',classes:'workspace-help'}];
 const packed=packPageCards(children);
 assert.deepEqual(packed.map(row=>row.id),['intro','grid']);
 assert.deepEqual(packed[1].children.map(row=>row.id),['a','help']);
 assert.equal(packed[1].children[1].span,'full');
 assert.equal(children[1].children.length,1,'不改变原桥接快照');
});
test('独立折叠操作整行排列，任意展开状态不改变分组和节点顺序',()=>{
 const config={id:'config',surface:'card'},manage={id:'manage',kind:'details',open:false},help={id:'help',kind:'details',open:false},next={id:'next',surface:'card'};
 const rows=items=>cardRuns(items).map(run=>run.map(item=>item.id));
 assert.deepEqual(rows([config,manage,help,next]),[['config'],['manage'],['help'],['next']]);
 assert.deepEqual(rows([config,{...manage,open:true},help,next]),[['config'],['manage'],['help'],['next']]);
 assert.equal(manage.open,false);
});
