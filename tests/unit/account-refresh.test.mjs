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
