import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSharedKnowledge,SHARED_KNOWLEDGE_KEY} from '../../src/services/shared-knowledge.js';
const at=Date.now();
const entry=(id,content)=>({id,title:id,content,source:'运营补充',updatedAt:at,expiresOn:'',enabled:true});
const config=entries=>({anchorId:'10',ai:{knowledge:'',memory:{enabled:true,entries}}});
function fixture(values){
 const service=createSharedKnowledge({read:async key=>structuredClone(values[key]),all:async()=>structuredClone(values),commit:async rows=>{for(const [k,v] of rows)values[k]=structuredClone(v);}});
 return {values,service};
}
test('两个房间迁入唯一共享资料；同ID冲突不丢失；重启和重复迁移幂等',async()=>{
 const f=fixture({'live-assistant:config:1':config([entry('a','陶瓷')]),'live-assistant:config:2':config([entry('a','茶具')])});
 await f.service.ensure();const a=await f.service.config('1'),b=await f.service.config('2');
 assert.deepEqual(a.ai.memory.entries,b.ai.memory.entries);assert.equal(a.ai.memory.entries.length,2);
 assert.deepEqual(a.ai.memory.entries.map(r=>r.origin.room),['1','2']);
 assert.equal(f.values['live-assistant:config:1'].ai.memory.entries.length,0);
 const before=JSON.stringify(f.values);await fixture(f.values).service.ensure();assert.equal(JSON.stringify(f.values),before);
});
test('跨房间编辑/删除生效；旧草稿只合入自己的修改，不复活已删除资料',async()=>{
 const f=fixture({'live-assistant:config:1':config([entry('a','旧资料')]),'live-assistant:config:2':config([])});
 const a=await f.service.config('1'),b=await f.service.config('2'),edit=structuredClone(a);edit.ai.memory.entries=[];
 await f.service.save('1',edit,a);
 const other=structuredClone(b);other.ai.memory.entries.push(entry('b','新资料'));other.ai.memory.enabled=false;
 const saved=await f.service.save('2',other,b);
 assert.deepEqual(saved.ai.memory.entries.map(r=>r.id),['b']);assert.equal(saved.ai.memory.enabled,false);
 assert.equal((await f.service.config('1')).ai.memory.enabled,true);
 assert.deepEqual((await f.service.config('1')).ai.memory.entries.map(r=>r.id),['b']);
 assert.ok(f.values[SHARED_KNOWLEDGE_KEY]);
});
test('同时更正同一条资料明确冲突；未落盘失败不改变已保存数据',async()=>{
 const f=fixture({'live-assistant:config:1':config([entry('a','原文')])}),a=await f.service.config('1'),b=structuredClone(a);
 const x=structuredClone(a);x.ai.memory.entries[0].content='更正一';await f.service.save('1',x,a);
 b.ai.memory.entries[0].content='更正二';await assert.rejects(f.service.save('1',b,a),/其他窗口/);
 assert.equal((await f.service.config('1')).ai.memory.entries[0].content,'更正一');
});
