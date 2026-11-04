import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {AdaptiveLayout} from '../../src/ui/adaptive-layout.js';
import {describeLayout,gridOptions,layoutChildren} from '../../src/ui/product/layout.js';

test('PK 比分、播报控制和并列概览保留各自的排列语义',()=>{
 const dom=new JSDOM('<div class="pk-scoreboard"></div><div class="pk-chart-head"></div><div class="pk-overview"></div><details class="pk-outlook"></details><div class="pk-broadcast-option"></div><div class="pk-broadcast-times"></div>');
 try{
  const nodes=[...dom.window.document.body.children];
  assert.deepEqual(nodes.map(node=>describeLayout(node).layout),['scoreboard','row','cards',undefined,'row','fields']);
  assert.equal(describeLayout(nodes[3]).span,undefined);
 }finally{dom.window.close();}
});

test('整行说明不能创造空列，字段与指标的列数按实际项目封顶',()=>{
 const children=[{kind:'field'},{kind:'field'},{span:'full'},{span:'full'}];
 assert.deepEqual(gridOptions({layout:'fields',children}),{cols:{base:1,'412px':2}});
 assert.deepEqual(gridOptions({layout:'metrics',children:children.slice(0,2)}),{cols:{base:1,'292px':2}});
});

test('卡片保留原顺序与显式通栏，不提前限定双列或把尾项强制换行',()=>{
 const children=[{id:'a',surface:'card'},{id:'b',surface:'card'},{id:'c',surface:'card'},{id:'note',kind:'text'},{id:'d',surface:'card'}];
 const result=layoutChildren('cards',children);
 assert.deepEqual(result.map(node=>node.id),['a','b','c','note','d']);
 assert.deepEqual(result.map(node=>node.span),[undefined,undefined,undefined,'full',undefined]);
 assert.ok(children.every(node=>node.span===undefined),'投影不改变原表单与规则状态');
});

test('长短卡片与普通折叠操作共用尺寸标准，折叠区不强制通栏',()=>{
 const children=[{id:'short',surface:'card',children:[]},{id:'long',surface:'card',children:Array(20).fill({kind:'field'})},{id:'advanced',kind:'details',surface:'card'},{id:'last',surface:'card'}];
 const result=layoutChildren('cards',children);
 assert.deepEqual(result.map(node=>node.size),['tile','tile','tile','tile']);
 assert.deepEqual(result.map(node=>node.span),[undefined,undefined,undefined,undefined]);
 assert.deepEqual(result.map(node=>node.id),children.map(node=>node.id));
 assert.ok(children.every(node=>node.size===undefined && node.span===undefined));
});

test('显式通栏配置与普通卡片保留宽度角色，行高由所在行内容决定',()=>{
 const result=layoutChildren('cards',[{surface:'card',span:'full'},{surface:'card'},{surface:'card'}]);
 assert.deepEqual(result.map(node=>node.size),['section','tile','tile']);
});

test('纯数据网格使用指标宽度，PK 速度与可信度不会占用表单的大列宽',()=>{
 const dom=new JSDOM('<div class="grid"><div><span>近15秒速度</span><p>120 / 100</p></div><div><span>可信度</span><p>70%</p></div></div><div class="grid"><label>间隔<input></label></div>');
 try{assert.deepEqual([...dom.window.document.body.children].map(node=>describeLayout(node).layout),['metrics','fields']);}finally{dom.window.close();}
});

test('可见组件接管后旧宽度观察器不再改折叠状态，回退时恢复默认行为',()=>{
 const dom=new JSDOM('<div id="host"></div>'),root=dom.window.document.querySelector('div').attachShadow({mode:'open'});
 root.innerHTML='<div class="floating-panel"><details data-adaptive-details><summary>分析</summary><input value="草稿"></details></div>';
 const layout=new AdaptiveLayout(root),detail=root.querySelector('details');
 try{
  layout.update(1000);assert.equal(detail.open,true);
  layout.setSuspended(true);layout.update(400);assert.equal(detail.open,true);
  layout.apply();assert.equal(detail.open,true);
  layout.setSuspended(false);assert.equal(detail.open,false);assert.equal(detail.querySelector('input').value,'草稿');
 }finally{layout.destroy();dom.window.close();}
});

test('主播列表每条记录横排资料和操作，不再堆成三层',()=>{
 const dom=new JSDOM('<div class="profile-card"><div><strong>主播 · 当前</strong><small>直播间 123 · UID 456</small></div><a href="https://live.douyin.com/123">打开并配置 ↗</a></div>');
 try{assert.equal(describeLayout(dom.window.document.querySelector('.profile-card')).layout,'row');}finally{dom.window.close();}
});
