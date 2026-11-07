import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {createPublicMediaProfileResolver} from '../../extension/public-media-profile.js';
import {checkResearchProfile} from '../../src/ai/research-profile.js';

test('作品通过唯一稳定 UID/secUID 配对找到人物，遗忘后仍返回权威时间戳但不恢复身份',async()=>{
 let at=Date.now();const memory=new AudienceMemory({anchor:'10',now:()=>at});
 memory.observe({type:'chat',source:'socket',id:'one',text:'公开茶杯',user:{id:'2',secUid:'author-sec',name:'同名观众'},receivedAt:at});
 const resolver=createPublicMediaProfileResolver(async()=>({anchor:'10',audience:memory.snapshot()}));
 const input={room:'1',anchor:'10',author:'author-sec',ai:{}};
 assert.equal((await resolver(input)).binding.subject,'uid:2');
 at++;memory.forget('uid:2');const forgotten=await resolver({...input,subject:'uid:2'});
 assert.equal(forgotten.epoch,at);assert.equal(forgotten.binding,null);
});
test('两个同名账号冲突配对同一 secUID 时跳过作品，不选第一条或昵称',async()=>{
 const memory=new AudienceMemory({anchor:'10'}),at=Date.now();
 for(const id of ['2','3'])memory.observe({type:'chat',source:'socket',id,text:'公开茶杯',user:{id,secUid:'author-sec',name:'同名观众'},receivedAt:at});
 const resolver=createPublicMediaProfileResolver(async()=>({anchor:'10',audience:memory.snapshot()}));
 assert.equal((await resolver({room:'1',anchor:'10',author:'author-sec',ai:{}})).binding,null);
});
test('主播未发言时使用房间已保存的稳定身份，改绑与遗忘均撤销旧任务',async()=>{
 let at=Date.now();const memory=new AudienceMemory({anchor:'10',now:()=>at});
 let profile={room:'1',anchorId:'10',secUid:'anchor-sec',name:'主播',updatedAt:at};
 const read=async key=>key==='live-assistant:profile:1' ? profile : {anchor:'10',audience:memory.snapshot()};
 const resolver=createPublicMediaProfileResolver(read),input={room:'1',anchor:'10',author:'anchor-sec',ai:{}};
 const resolved=await resolver(input);assert.equal(resolved.binding?.subject,'uid:10');assert.equal(resolved.tier,'deep');
 const check=()=>checkResearchProfile({room:'1',anchor:'10',subject:'uid:10',binding:resolved.binding,read});
 await check();profile={...profile,secUid:'changed-sec'};await assert.rejects(check(),/身份|人物/);
 profile={...profile,secUid:'anchor-sec',anchorId:'20'};assert.equal((await resolver(input)).binding,null);
 profile={...profile,anchorId:'10'};at++;memory.forget('uid:10');
 assert.equal((await resolver({...input,subject:'uid:10'})).epoch,at);assert.equal((await resolver(input)).binding,null);
 await assert.rejects(check(),/人物|身份/);
 profile={...profile,updatedAt:++at};assert.equal((await resolver(input)).binding.subject,'uid:10');
});
