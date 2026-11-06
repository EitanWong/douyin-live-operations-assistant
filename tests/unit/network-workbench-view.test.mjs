import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MantineProvider} from '@mantine/core';
import {NetworkWorkbench} from '../../src/ui/product/network-workbench.js';
test('关系工作台明确提示同名歧义与展示上限，不将不可信原话渲染为HTML',()=>{
 const view={graph:{entities:[{id:'a',name:'小雨',role:'观众'},{id:'b',name:'小雨',role:'观众'}],relations:[{id:'r',from:'a',to:'b',predicate:'提及',status:'unverified',evidence:[{text:'<img src=x onerror=bad()>原话',source:'弹幕',at:1800000000000,trust:'unverified'}]}],ambiguities:[{name:'小雨',candidates:['a','b']}],stats:{entities:200,relations:400,truncated:true}},query:'',status:'all',predicate:'all',depth:0,layout:'concentric',selected:{kind:'relation',id:'r'},pathTo:'',question:'',questionStatus:'',error:'',original:null};
 const html=renderToStaticMarkup(h(MantineProvider,null,h(NetworkWorkbench,{node:{id:'network',view},bridge:{networkAction(){}}})));
 assert.match(html,/同名待辨：小雨/);assert.match(html,/当前仅展示部分资料/);assert.match(html,/&lt;img/);assert.ok(!html.includes('<img src=x'));
});
