import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectAccount} from '../../extension/account-collector.js';
function fixture({allowed=true,redirect=false,rows=[]}={}){
 const removed=[],scripts=[];
 const chrome={permissions:{contains:async()=>allowed},tabs:{create:async()=>({id:1}),get:async()=>({url:redirect ? 'https://www.douyin.com/user/other' : 'https://www.douyin.com/user/target'}),remove:async id=>removed.push(id)},
  scripting:{executeScript:async options=>{scripts.push(options);return [{result:rows}];}}};
 return {chrome,removed,scripts};
}
test('native account collector observes the selected page and closes only its own temporary tab',async()=>{
 const f=fixture({rows:[{kind:'work',title:'已采集'}]});
 assert.equal((await collectAccount(f.chrome,'https://www.douyin.com/user/target'))[0].title,'已采集');assert.deepEqual(f.removed,[1]);assert.equal(f.scripts[0].world,'MAIN');
 const denied=fixture({allowed:false});await assert.rejects(collectAccount(denied.chrome,'https://www.douyin.com/user/target'),/权限|允许/);assert.deepEqual(denied.removed,[]);
 const redirect=fixture({redirect:true});await assert.rejects(collectAccount(redirect.chrome,'https://www.douyin.com/user/target'),/跳转/);assert.deepEqual(redirect.removed,[1]);
 const c=new AbortController();c.abort();const cancelled=fixture();await assert.rejects(collectAccount(cancelled.chrome,'https://www.douyin.com/user/target',{signal:c.signal}),/取消/);assert.deepEqual(cancelled.removed,[1]);
});
test('a script result arriving after cancellation is discarded and its temporary page is closed',async()=>{
 const f=fixture(),cancel=new AbortController();
 f.chrome.scripting.executeScript=async()=>{cancel.abort();return [{result:[{kind:'work',title:'late'}]}];};
 await assert.rejects(collectAccount(f.chrome,'https://www.douyin.com/user/target',{signal:cancel.signal}),/取消/);
 assert.deepEqual(f.removed,[1]);
});

test('主页只顺序采样两部已核对作品，等待页面评论，归并回原来源且不混入其他作者',async()=>{
 const removed=[],opened=[];let id=0,clock=0;
 const profile='https://www.douyin.com/user/sec-account-a',urls=new Map(),polls=new Map();
 const chrome={permissions:{contains:async()=>true},tabs:{create:async({url})=>{opened.push(url);urls.set(++id,url);return {id};},get:async id=>({url:urls.get(id)}),remove:async id=>removed.push(id)},scripting:{executeScript:async({target})=>{
  const url=urls.get(target.tabId),n=(polls.get(url)||0)+1;polls.set(url,n);
  if(url===profile)return [{result:[1,2,3].map(i=>({kind:'work',id:String(i),subject:'sec-account-a',url:`https://www.douyin.com/video/${i}`,source:profile}))}];
  return [{result:[{kind:'work',id:url.split('/').at(-1),subject:'sec-account-a',url,source:url},...(n>=2 ? [{kind:'comment',id:`c${target.tabId}`,subject:'sec-account-a',workId:url.split('/').at(-1),url,source:url,text:'实际评论'}] : []),{kind:'comment',id:'foreign',subject:'other',source:url}]}];
 }}};
 const rows=await collectAccount(chrome,profile,{now:()=>clock,pause:async ms=>{clock+=ms;},settleMs:600});
 assert.equal(opened.length,3);assert.equal(removed.length,3);assert.equal(rows.filter(r=>r.kind==='comment').length,2);
 assert.ok(rows.every(r=>r.source===profile));assert.ok(!rows.some(r=>r.id==='foreign'));
});

test('可选本地音画失败不丢弃已读取的公开作品与评论，也会关闭临时页',async()=>{
 const f=fixture({rows:[{kind:'work',id:'70',title:'已读取描述'}]});f.chrome.tabs.get=async()=>({url:'https://www.douyin.com/video/70'});
 const rows=await collectAccount(f.chrome,'https://www.douyin.com/video/70',{settleMs:0,analyze:async()=>{throw Error('音轨不可读');}});
 assert.equal(rows[0].title,'已读取描述');assert.match(rows[0].coverage,/音轨不可读/);assert.deepEqual(f.removed,[1]);
});
