import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSharedKnowledge,SHARED_KNOWLEDGE_KEY} from '../../src/services/shared-knowledge.js';
import {mergeConfig} from '../../src/core/engine.js';

function fixture(values){
 const service=createSharedKnowledge({read:async key=>structuredClone(values[key]),all:async()=>structuredClone(values),commit:async rows=>{for(const [key,value] of rows)values[key]=structuredClone(value);}});
 return {values,service};
}
const room=(frequency,ai={})=>mergeConfig({version:2,ai:{replyFrequency:frequency,...ai}});
test('已有共享服务可增量迁移任务连接，任务开关与模型一起共享，旧草稿不覆盖新路由',async()=>{
 const f=fixture({'live-assistant:config:1':room('quiet'),'live-assistant:config:2':room('every')});
 await f.service.ensure();delete f.values[SHARED_KNOWLEDGE_KEY].services.research;delete f.values[SHARED_KNOWLEDGE_KEY].services.profile;
 const upgraded=fixture(f.values),base=await upgraded.service.config('1'),edit=structuredClone(base);
 edit.ai.taskModels.research={enabled:true,endpoint:'https://deep.example/chat/completions',model:'deep'};
 await upgraded.service.save('1',edit,base);
 assert.deepEqual((await upgraded.service.config('2')).ai.taskModels.research,edit.ai.taskModels.research);
 await upgraded.service.save('2',base,base);
 assert.equal((await upgraded.service.config('1')).ai.taskModels.research.model,'deep');
});
test('服务连接和业务空间跨主播复用，节奏、风格、开关与额度独立',async()=>{
 const a=room('quiet',{endpoint:'https://cloud.example/chat/completions',model:'shared-model',pipeline:{mode:'omni-llm',workspaceId:'workspace-a'},persona:'主播甲风格'});
 const b=room('every',{enabled:true,maxPerHour:80,persona:'主播乙风格'});
 const f=fixture({'live-assistant:config:1':a,'live-assistant:config:2':b});
 const saved=await f.service.config('2');
 assert.equal(saved.ai.pipeline.workspaceId,'workspace-a');assert.equal(saved.ai.endpoint,a.ai.endpoint);assert.equal(saved.ai.model,'shared-model');
 assert.equal(saved.ai.replyFrequency,'every');assert.equal(saved.ai.persona,'主播乙风格');assert.equal(saved.ai.enabled,true);assert.equal(saved.ai.maxPerHour,80);
 assert.equal(saved.ai.pipeline.mode,'custom');assert.equal((await f.service.config('1')).ai.pipeline.mode,'omni-llm');
 const fresh=await f.service.config('3');assert.equal(fresh.ai.pipeline.workspaceId,'workspace-a');
 const restarted=fixture(f.values);assert.equal((await restarted.service.config('2')).ai.endpoint,a.ai.endpoint);
});
test('旧草稿保存主播设置不覆盖新连接，后台身份保存也不改共享连接',async()=>{
 const f=fixture({'live-assistant:config:1':room('quiet'),'live-assistant:config:2':room('every')});
 const a=await f.service.config('1'),b=await f.service.config('2'),edit=structuredClone(a);
 edit.ai.pipeline.workspaceId='new-workspace';edit.ai.search.provider='tavily';edit.ai.search.endpoint='https://api.tavily.com/search';
 await f.service.save('1',edit,a);
 const stale=structuredClone(b);stale.ai.replyFrequency='off';await f.service.save('2',stale,b);
 await f.service.saveRoom('live-assistant:config:1',{...a,anchorId:'123'});
 const next=await f.service.config('2');assert.equal(next.ai.pipeline.workspaceId,'new-workspace');assert.equal(next.ai.replyFrequency,'off');assert.equal(next.ai.search.provider,'tavily');
});
test('同一服务的并发更正明确冲突，互不相关的服务更正可合入，清空后不复活',async()=>{
 const f=fixture({'live-assistant:config:1':room('quiet')});
 const a=await f.service.config('1'),edit=structuredClone(a);edit.ai.pipeline.workspaceId='first';await f.service.save('1',edit,a);
 const conflict=structuredClone(a);conflict.ai.pipeline.workspaceId='second';await assert.rejects(f.service.save('2',conflict,a),/其他窗口.*服务/);
 const other=structuredClone(a);other.ai.model='another-model';await f.service.save('2',other,a);
 const base=await f.service.config('1'),cleared=structuredClone(base);cleared.ai.pipeline.workspaceId='';await f.service.save('1',cleared,base);
 await f.service.save('2',base,base);assert.equal((await f.service.config('2')).ai.pipeline.workspaceId,'');
 assert.equal((await f.service.config('1')).ai.model,'another-model');
});
test('已有共享知识升级时从已配置服务迁移，默认房间不抢占，重复运行不改数据',async()=>{
 const f=fixture({[SHARED_KNOWLEDGE_KEY]:{version:1,entries:[],knowledge:'原有知识'},'live-assistant:config:1':room('quiet'),'live-assistant:config:2':room('every',{pipeline:{workspaceId:'existing-space'},media:{visionEndpoint:'https://vision.example/chat/completions',visionModel:'vision-model'}})});
 const next=await f.service.config('1');assert.equal(next.ai.pipeline.workspaceId,'existing-space');assert.equal(next.ai.media.visionModel,'vision-model');assert.equal(next.ai.knowledge,'原有知识');
 const before=JSON.stringify(f.values);await fixture(f.values).service.ensure();assert.equal(JSON.stringify(f.values),before);
});
