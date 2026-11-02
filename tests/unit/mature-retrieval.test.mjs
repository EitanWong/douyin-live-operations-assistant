import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retrieveMemories} from '../../src/services/knowledge.js';
const now=Date.parse('2026-11-02T12:00:00+08:00');
const row=(id,content,extra={})=>({id,title:id,content,source:'主播确认',enabled:true,updatedAt:now,expiresOn:'',...extra});
test('本地索引支持英文前缀与小幅拼写错误，同时排除无关、到期、停用资料',()=>{
 const memory={enabled:true,entries:[row('设备','microphone 使用 USB 接口'),row('排期','每周六八点开播'),row('过期','microphone 旧价格',{expiresOn:'2026-11-01'}),row('撤回','microphone',{enabled:false})]};
 for(const query of ['microph','microphne']){
  const result=retrieveMemories(memory,query,now);
  assert.deepEqual(result.chunks.map(c=>c.entryId),['设备']);
  assert.equal(result.method,'minisearch-bm25');
 }
 assert.equal(retrieveMemories(memory,'火星天气',now).chunks.length,0);
});
test('中文检索保留原文偏移、去重与预算，切片不拆开表情字符',()=>{
 const content='陶瓷茶具'.repeat(149)+'abc😀清洗茶具用温水。'.repeat(80),memory={enabled:true,entries:[row('茶具说明',content)]};
 const result=retrieveMemories(memory,'清洗茶具',now);
 assert.ok(result.chunks.length);
 for(const chunk of result.chunks){assert.equal(content.slice(chunk.range.start,chunk.range.end),chunk.content);assert.equal(chunk.content.isWellFormed(),true);assert.equal(chunk.source,'主播确认');}
 assert.ok(result.usedChars<=result.limits.chars);
});

test('直播知识固定问答语料：原文相关性、指代上下文和跨房间隔离',()=>{
 const memory={enabled:true,entries:[row('排期','每周六晚上八点开播，周日休息。'),row('茶具材质','陶瓷茶具，使用温水清洗，避免骤冷骤热。'),row('茶具价格','茶具价格为99元，以当前商品页结算金额为准。'),row('发货','商品发货预计三天，具体以订单页面为准。'),row('设备','microphone 使用 USB 接口，不支持蓝牙。'),row('旧价格','旧茶具价格1元',{expiresOn:'2026-11-01'})]};
 const cases=[['每周几点开播','排期'],['茶具是什么材质','茶具材质'],['茶具价格多少','茶具价格'],['几天发货','发货'],['USB 接口','设备'],['microphne','设备'],['microph','设备'],['火星天气',null]];
 for(const [query,expected] of cases)assert.equal(retrieveMemories(memory,query,now).chunks[0]?.entryId || null,expected,query);
 assert.equal(retrieveMemories(memory,'这个用什么',now,{contextQuery:'microphone 设备'}).chunks[0].entryId,'设备');
 assert.equal(retrieveMemories({enabled:true,entries:[row('另一个房间','吉他排练')]},'茶具价格',now).chunks.length,0);
});
