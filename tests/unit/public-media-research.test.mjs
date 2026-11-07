import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPublicMediaResearch} from '../../extension/public-media-research.js';

const room='1',anchor='10',sec='author-sec',subject='uid:2',workId='70';
const work={kind:'work',id:workId,subject:sec,url:`https://www.douyin.com/video/${workId}`,text:'公开茶杯作品',observedAt:1800000000000};
function fixture(){
 let epoch=0,enabled=true,version=0,archiving=true;
 let segments=[{kind:'transcript',startMs:0,endMs:4000,text:'这个杯子不能加热。',speaker:'unknown'}];
 const calls=[],saved=[];
 const jobs=new Map();
 const readConfig=async()=>({anchorId:anchor,ai:{enabled:true,assistant:{memoryEnabled:true},contextSources:{audience:true,accounts:true},accountCollection:{enabled},pipeline:{mode:'local-audio'},edge:{enabled:true,audioEnabled:true}}});
 const resolve=async()=>({epoch,sources:[`https://www.douyin.com/user/${sec}`],binding:{subject,epoch,sources:[`https://www.douyin.com/user/${sec}`]}});
 const request=async(action,input)=>{
  assert.equal(action,'public-media');calls.push(structuredClone(input));
  if(input.operation==='sync')return {epoch:input.epoch};
  if(input.operation==='submit'){
   const id=`job-${input.request.epoch}`;
   if(!jobs.has(id))jobs.set(id,{...input.request,id,status:'queued',analysisVersion:'sensevoice-v1',mediaHash:'a'.repeat(64),coverage:{audio:'pending',video:'not-analyzed'},createdAt:1800000000000,updatedAt:1800000000000});
   return jobs.get(id);
  }
  if(input.operation==='list')return [...jobs.values()];
  if(input.operation==='cancel'){const job=jobs.get(input.job);job.status='cancelled';return job;}
  if(input.operation==='ack'){const job=jobs.get(input.job);job.importCursor=input.cursor;job.imported=input.complete;return job;}
  if(input.operation==='evidence')return segments.slice(input.offset,input.offset+8);
  throw Error('unexpected native operation');
 };
 const bridge=createPublicMediaResearch({readConfig,resolveProfile:resolve,checkProfile:async({binding})=>{if(binding.epoch!==epoch)throw Error('已遗忘');},request,
  canArchive:async()=>archiving,worker:{ready:async()=>true,run:async()=>true},knowledge:{handle:async(r,action,input)=>{if(action==='version')return version;if(action==='remember'){saved.push(input);return true;}throw Error(action);}},
  now:()=>1800000001000});
 return {bridge,calls,saved,jobs,pages:rows=>segments=rows,archiveOff:()=>archiving=false,clear:()=>version++,forget:()=>{epoch=1800000000100;version++;},disable:()=>{enabled=false;},complete:()=>{for(const job of jobs.values()){job.status='succeeded';job.coverage={audio:'complete',durationMs:4000,video:'not-analyzed',speaker:'unknown'};}}};
}

test('公开作品按稳定账号绑定原生任务，重试不增加同作品任务；完成后原文进入既有知识库',async()=>{
 const f=fixture();
 await f.bridge.collect({room,anchor,records:[work]});
 await f.bridge.collect({room,anchor,records:[work]});
 assert.equal(f.jobs.size,1);
 assert.deepEqual([...f.jobs.values()].map(j=>[j.subject,j.author,j.workId,j.epoch]),[[subject,sec,workId,0]]);
 f.complete();await f.bridge.wake(room);
 assert.equal(f.saved.length,1);await f.bridge.wake(room);assert.equal(f.saved.length,1,'已确认导入的片段不能重复增加知识批次');
 assert.equal(f.saved[0].subject,subject);assert.equal(f.saved[0].subjectEpoch,0);
 const source=f.saved[0].sources[0];
 assert.match(source.text,/这个杯子不能加热/);assert.match(source.text,/0.*4000/);assert.match(source.coverage,/说话人未确认/);
 assert.equal(source.url,work.url);assert.equal(source.evidenceKind,'public-media');
});

test('浏览器权威遗忘时间戳直接同步；旧任务即使成功也不能恢复原文',async()=>{
 const f=fixture();await f.bridge.collect({room,anchor,records:[work]});f.complete();f.forget();
 await f.bridge.wake(room);
 assert.equal(f.saved.length,0);
 assert.ok(f.calls.some(call=>call.operation==='sync' && call.epoch===1800000000100));
 await f.bridge.collect({room,anchor,records:[work]});
 assert.ok([...f.jobs.values()].some(job=>job.epoch===1800000000100));
});

test('停用公开采集后撤销现有任务，不能提交或导入旧证据',async()=>{
 const f=fixture();await f.bridge.collect({room,anchor,records:[work]});f.complete();f.disable();
 await f.bridge.wake(room);await f.bridge.collect({room,anchor,records:[work]});
 assert.equal(f.saved.length,0);
 assert.ok(f.calls.some(call=>call.operation==='sync' && call.allowed===false));
 assert.equal(f.calls.filter(call=>call.operation==='submit').length,1);
});

test('只清空知识库也会作废旧完成任务，不需要同时遗忘观众',async()=>{
 const f=fixture();await f.bridge.collect({room,anchor,records:[work]});f.complete();f.clear();await f.bridge.wake(room);assert.equal(f.saved.length,0);assert.equal([...f.jobs.values()][0].status,'cancelled');
});

test('关闭本地归档会撤销后台任务，不能绕过归档开关写入原生库',async()=>{
 const f=fixture();await f.bridge.collect({room,anchor,records:[work]});f.complete();f.archiveOff();await f.bridge.wake(room);
 assert.equal(f.saved.length,0);assert.ok(f.calls.some(call=>call.operation==='sync' && call.allowed===false));
 const before=f.calls.filter(call=>call.operation==='submit').length;await f.bridge.collect({room,anchor,records:[work]});assert.equal(f.calls.filter(call=>call.operation==='submit').length,before);
});
test('音轨按八条分页导入直到 EOF，静音段也推进游标，不伪造原文',async()=>{
 const f=fixture();f.pages(Array.from({length:8},(_,i)=>({kind:'transcript',startMs:i*4000,endMs:(i+1)*4000,text:i===0 ? '公开茶杯' : '',speaker:'unknown'})));
 await f.bridge.collect({room,anchor,records:[work]});f.complete();await f.bridge.wake(room);
 assert.equal(f.saved.length,1);assert.equal(f.saved[0].sources.length,1);assert.equal([...f.jobs.values()][0].importCursor,8);assert.equal([...f.jobs.values()][0].imported,false);
 await f.bridge.wake(room);assert.equal([...f.jobs.values()][0].imported,true);assert.equal(f.saved.length,1);
});
test('能力探测后身份解析失败也释放闲置端口',async()=>{
 let released=0;
 const bridge=createPublicMediaResearch({readConfig:async()=>({anchorId:anchor,ai:{enabled:true,pipeline:{mode:'local-audio'},edge:{enabled:true,audioEnabled:true}}}),resolveProfile:async()=>{throw Error('fixture read failure');},
  request:async()=>{},knowledge:{},worker:{ready:async()=>true,release:()=>released++}});
 await assert.rejects(bridge.collect({room,anchor,records:[work]}),/fixture read failure/);assert.equal(released,1);
});
test('下载源再次核对稳定 UID、作品和有效期；不匹配时只提交规范作品地址',async()=>{
 const source={workId,author:sec,authorUid:'2',url:'https://v1.example.douyinvod.com/file?__vid=70',durationMs:4000,observedAt:1800000000000,expiresAt:1800000300000};
 for(const candidate of [source,{...source,authorUid:'3'},{...source,workId:'71'},{...source,expiresAt:1800000001000}]){
  const f=fixture();await f.bridge.collect({room,anchor,records:[work],media:[candidate]});
  const request=f.calls.find(r=>r.operation==='submit').request;
  assert.deepEqual(request.pageMedia,candidate===source ? source : undefined);
 }
});
