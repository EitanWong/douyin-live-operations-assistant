import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatAccountEvidence} from '../../src/ai/account-evidence.js';

test('有界公开资料按相关性选择完整原话，保留末尾条件与发言人，不修改原记录',()=>{
 const rows=Array.from({length:40},(_,i)=>({kind:'work',title:`作品${i}`,text:'无关包装介绍。'.repeat(100),id:String(i),subject:'author',source:'https://www.douyin.com/user/author'}));
 rows.push({kind:'comment',title:'茶友',actor:{uid:'3',name:'茶友'},subject:'author',workId:'70',text:'陶瓷茶杯只限冷水，不可加热。',coverage:'实际加载的一条评论',positionMs:1000});
 const original=JSON.stringify(rows),result=formatAccountEvidence(rows,'陶瓷茶杯清洗');
 assert.ok(result.text.length<=6000);const parsed=JSON.parse(result.text),found=parsed.records.find(r=>r.quote.includes('陶瓷茶杯'));
 assert.equal(found.quote,'陶瓷茶杯只限冷水，不可加热。');assert.equal(found.speaker,'uid:3 茶友');assert.match(found.attribution,/不等于发言人/);
 assert.equal(parsed.availableRecords,41);assert.ok(parsed.includedRecords<41);assert.equal(JSON.stringify(rows),original);
});
test('音画保留不确定归属，空资料不产生伪原文，控制字符和长元数据仍生成有效JSON',()=>{
 assert.equal(formatAccountEvidence([],'茶杯').text,'');assert.equal(formatAccountEvidence([{text:''}],'茶杯').text,'');
 const result=formatAccountEvidence([{kind:'visual',text:'画面中有杯子',title:'\u0000'.repeat(1000),coverage:'\u0000'.repeat(1000)},
  {kind:'transcript',text:'茶杯只限冷水',positionMs:4200,coverage:'只识别4秒音轨'}],'茶杯');
 assert.ok(result.text.length<=6000);const rows=JSON.parse(result.text).records;
 assert.ok(rows.every(r=>r.speaker==='说话人未确认'));assert.match(rows.find(r=>r.kind==='visual').attribution,/待核实/);
 assert.equal(rows.find(r=>r.kind==='transcript').positionMs,4200);
});
