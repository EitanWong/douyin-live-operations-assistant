import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectAccount} from '../../extension/account-collector.js';
import {createAccountResearch} from '../../extension/account-research.js';

const profile='https://www.douyin.com/user/author';
function browser({fail=new Set(),at=1800000000000}={}){
 let next=0,clock=at;const tabs=new Map(),opened=[],closed=[];
 const chrome={permissions:{contains:async()=>true},tabs:{create:async({url})=>{tabs.set(++next,url);opened.push(url);return {id:next};},get:async id=>({url:tabs.get(id)}),remove:async id=>closed.push(id)},scripting:{executeScript:async({target})=>{
  const url=tabs.get(target.tabId),id=url.split('/').at(-1);
  if(url!==profile && fail.has(id))throw Error('暂时不可用');
  return [{result:(url===profile ? ['1','2','3','4'] : [id]).map(id=>({kind:'work',id,subject:'author',url:`https://www.douyin.com/video/${id}`,source:url,publishedAt:Number(id),text:`作品${id}`}))}];
 }}};
 return {chrome,opened,closed,options:{now:()=>clock,pause:async ms=>{clock+=ms;},settleMs:0},now:()=>clock};
}

test('后台跨重启轮换未访问作品，完成归档后才保存进度，按房间与主播隔离',async()=>{
 let saved,at=1800000000000;const visits=[],archives=[],configs={anchorId:'10',ai:{accountCollection:{enabled:true,maxPerHour:10}}};
 const dependencies={readConfig:async()=>configs,readBudget:async()=>[],writeBudget:async()=>{},readProgress:async()=>saved,writeProgress:async(_room,_anchor,value)=>{saved=structuredClone(value);},archive:async row=>archives.push(row),now:()=>at,
  collect:async(url,options)=>{const b=browser();await collectAccount(b.chrome,url,{...b.options,...options});visits.push(b.opened.slice(1));return [{kind:'profile',id:'author'}];}};
 await createAccountResearch(dependencies).collect('1',profile);
 await createAccountResearch(dependencies).collect('1',profile);
 assert.deepEqual(visits.flat().map(url=>url.split('/').at(-1)),['4','3','2','1']);assert.equal(archives.length,2);
 assert.ok(saved);assert.ok(JSON.stringify(saved).length<10000);
});

test('失败作品在短退避后重试，成功作品不阻塞新作品；采集覆盖不冒充完整视频',async()=>{
 const b=browser({fail:new Set(['4'])}),events=[];
 const rows=await collectAccount(b.chrome,profile,{...b.options,onWork:row=>events.push(row)});
 assert.deepEqual(events.map(r=>[r.id,r.status]),[['4','failed'],['3','complete']]);
 assert.match(rows.find(r=>r.id==='4').coverage,/未完成/);assert.equal(b.closed.length,3);
 const second=browser({at:b.now()}),next=[];
 await collectAccount(second.chrome,profile,{...second.options,visited:events,onWork:row=>next.push(row)});
 assert.deepEqual(next.map(r=>r.id),['2','1']);
 const later=browser(),retried=[];
 await collectAccount(later.chrome,profile,{...later.options,now:()=>b.now()+16*60000,visited:events,onWork:row=>retried.push(row)});
 assert.deepEqual(retried.map(r=>r.id),['4','2']);
});

test('归档失败或采集上下文已变化不确认作品进度，恢复后仍可重新采集',async()=>{
 let writes=0,enabled=true;
 const service=createAccountResearch({readConfig:async()=>({anchorId:'10',ai:{accountCollection:{enabled}}}),readBudget:async()=>[],writeBudget:async()=>{},readProgress:async()=>null,writeProgress:async()=>writes++,
  collect:async(_url,{onWork})=>{await onWork?.({id:'4',status:'complete',at:Date.now()});return [];},archive:async()=>{throw Error('磁盘写入失败');}});
 await assert.rejects(service.collect('1',profile),/磁盘写入失败/);assert.equal(writes,0);
 enabled=false;await assert.rejects(service.collect('1',profile),/上下文/);assert.equal(writes,0);
});

test('同一采集器对不同房间、主播和主页使用独立作品进度',async()=>{
 const saved=new Map(),calls=[];let anchor='10';
 const service=createAccountResearch({readConfig:async()=>({anchorId:anchor,ai:{accountCollection:{enabled:true,maxPerHour:30}}}),readBudget:async()=>[],writeBudget:async()=>{},
  readProgress:async(room,owner)=>saved.get(`${room}:${owner}`),writeProgress:async(room,owner,value)=>saved.set(`${room}:${owner}`,value),archive:async()=>{},
  collect:async(url,{visited,onWork})=>{calls.push([url,visited.length]);onWork({id:'4',at:Date.now(),status:'complete'});return [];}});
 await service.collect('1',profile);await service.collect('1',profile);await service.collect('2',profile);
 anchor='20';await service.collect('1',profile);await service.collect('1','https://www.douyin.com/user/other');
 assert.deepEqual(calls.map(r=>r[1]),[0,1,0,0,0]);assert.equal(saved.size,3);
});

test('不匹配作者的作品详情不会确认完成，保留原主页说明和失败覆盖记录',async()=>{
 const b=browser(),events=[],execute=b.chrome.scripting.executeScript;
 b.chrome.scripting.executeScript=async options=>{
  const result=await execute(options);if(options.target.tabId>1)for(const row of result[0].result)row.subject='other';return result;
 };
 const rows=await collectAccount(b.chrome,profile,{...b.options,onWork:row=>events.push(row)});
 assert.deepEqual(events.map(r=>r.status),['failed','failed']);
 assert.ok(rows.every(r=>r.subject==='author'));assert.match(rows.find(r=>r.id==='4').coverage,/作者与主页不匹配/);
});
test('临时媒体地址只经独立参数交给归档后调度，不混入账号原记录',async()=>{
 const source={workId:'70',url:'https://v1.example.douyinvod.com/file?__vid=70'},records=[{kind:'work',id:'70'}];let archived;
 const service=createAccountResearch({readConfig:async()=>({anchorId:'10',ai:{accountCollection:{enabled:true}}}),readBudget:async()=>[],writeBudget:async()=>{},
  collect:async(_url,{onMedia})=>{onMedia(source);return records;},archive:async input=>archived=input});
 const result=await service.collect('1',profile);
 assert.equal(result,records);assert.deepEqual(archived.media,[source]);assert.equal(JSON.stringify(result).includes('douyinvod'),false);
});
