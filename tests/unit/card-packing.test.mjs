import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cardRuns,partitionPageUtilities} from '../../src/ui/product/layout.js';

test('显式通栏与普通组件各自成排，不干扰相邻行',()=>{
 const items=[{id:'a'},{id:'b'},{id:'wide',span:'full'},{id:'c'}];
 assert.deepEqual(cardRuns(items).map(run=>run.map(row=>row.id)),[['a','b'],['wide'],['c']]);
 assert.ok(items.every(row=>row.size===undefined));
});
test('礼物概况与配置分别成排，不让空记录随长表单撑高',()=>{
 const items=[{id:'total',band:'summary'},{id:'recent',band:'summary'},{id:'rules'},{id:'copy'}];
 assert.deepEqual(cardRuns(items).map(run=>run.map(item=>item.id)),[['total','recent'],['rules','copy']]);
});
test('管理和说明不占正文布局，清理空包装且不修改原快照',()=>{
 const help={id:'help',utility:'help',children:[{kind:'text',text:'说明'}]},card={id:'a',surface:'card'};
 const content={id:'page',children:[{id:'grid',layout:'cards',children:[card]},{id:'wrapper',children:[help]}]};
 const result=partitionPageUtilities(content);
 assert.deepEqual(result.content.children.map(row=>row.id),['grid']);
 assert.equal(result.utilities.help[0],help);assert.equal(result.content.children[0].children[0],card);
 assert.equal(content.children.length,2,'不改变原桥接快照');
});
test('独立折叠操作整行排列，任意展开状态不改变分组和节点顺序',()=>{
 const config={id:'config',surface:'card'},manage={id:'manage',kind:'details',open:false},help={id:'help',kind:'details',open:false},next={id:'next',surface:'card'};
 const rows=items=>cardRuns(items).map(run=>run.map(item=>item.id));
 assert.deepEqual(rows([config,manage,help,next]),[['config'],['manage'],['help'],['next']]);
 assert.deepEqual(rows([config,{...manage,open:true},help,next]),[['config'],['manage'],['help'],['next']]);
 assert.equal(manage.open,false);
});
