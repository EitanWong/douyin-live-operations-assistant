import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AccountContext,accountSource,normalizeAccountPayload} from '../../src/ai/account-context.js';
import {createAccountRefresh,validateAccountCollection} from '../../src/services/account-refresh.js';
const url='https://www.douyin.com/user/target';
test('selected public sources refresh serially with per-hour budget; unchanged sources are not fetched on every question',async()=>{
 let now=Date.now(),calls=0;const accounts=new AccountContext({now:()=>now}),config={enabled:true,autoRefresh:true,intervalMinutes:60,maxPerHour:1,urls:[url]};
 const service=createAccountRefresh({accounts,now:()=>now,scope:()=> 'anchor',config:()=>config,changed:async()=>{},collector:{collect:async()=>{calls++;return normalizeAccountPayload({user:{sec_uid:'target',nickname:'陶艺'}},accountSource(url),now);},cancel:async()=>{}}});
 assert.equal(await service.tick(),true);assert.equal(accounts.list('anchor').length,1);
 await service.tick();now+=60000;await service.tick();assert.equal(calls,1);
 now+=3600000;await service.tick();assert.equal(calls,2);service.close();
 assert.throws(()=>validateAccountCollection({...config,urls:['https://elsewhere.example/user/a']}));
});
test('failed refresh removes previous evidence and a cancelled result never enters a new anchor context',async()=>{
 let anchor='one',now=Date.now(),finish;const accounts=new AccountContext({now:()=>now}),rows=normalizeAccountPayload({user:{sec_uid:'target',nickname:'陶艺'}},accountSource(url),now);accounts.replace(anchor,url,rows);
 const service=createAccountRefresh({accounts,now:()=>now,scope:()=>anchor,config:()=>({enabled:true}),changed:async()=>{},collector:{collect:()=>new Promise(resolve=>finish=resolve),cancel:async()=>{}}});
 const work=service.refresh(url);await new Promise(setImmediate);assert.equal(accounts.list('one').length,0);
 await service.cancel();anchor='two';finish(rows);await assert.rejects(work,/取消|失效/);assert.equal(accounts.list('two').length,0);
 service.close();
});
test('automatic research shares the selected-source budget, prioritizes the anchor and restores cooldowns after restart',async()=>{
 let now=Date.now();const accounts=new AccountContext({now:()=>now}),calls=[];
 const config={enabled:true,autoRefresh:true,autoResearch:true,intervalMinutes:60,maxPerHour:2,urls:[]};
 const targets=()=>[{url,role:'anchor'},{url:'https://www.douyin.com/user/chatty',role:'viewer'}];
 const options={accounts,now:()=>now,scope:()=> 'host',config:()=>config,targets,changed:async()=>{},collector:{collect:async source=>{calls.push(source);return normalizeAccountPayload({user:{sec_uid:accountSource(source).id,nickname:'公开资料'}},accountSource(source),now);},cancel:async()=>{}}};
 let service=createAccountRefresh(options);
 assert.equal(await service.tick(),true);assert.equal(accounts.list('host')[0].role,'anchor');
 now+=60001;assert.equal(await service.tick(),true);assert.deepEqual(calls,[url,targets()[1].url]);
 const saved=service.snapshot();service.close();service=createAccountRefresh({...options,snapshot:saved});
 now+=60001;assert.equal(await service.tick(),false,'restart does not reset the hour budget or source cooldown');
 now+=3600001;assert.equal(await service.tick(),true);assert.equal(calls.at(-1),url);
 service.close();
});
test('removing an automatically selected viewer during collection discards the late result',async()=>{
 let targets=[{url,role:'viewer'}],finish;const accounts=new AccountContext(),config={enabled:true,autoRefresh:true,autoResearch:true,urls:[]};
 const service=createAccountRefresh({accounts,scope:()=> 'host',config:()=>config,targets:()=>targets,changed:async()=>{},collector:{collect:()=>new Promise(resolve=>finish=resolve),cancel:async()=>{}}});
 const work=service.tick();await new Promise(setImmediate);targets=[];await service.tick();finish(normalizeAccountPayload({user:{sec_uid:'target',nickname:'旧目标'}},accountSource(url)));
 assert.equal(await work,false);assert.deepEqual(accounts.list('host'),[]);service.close();
});
