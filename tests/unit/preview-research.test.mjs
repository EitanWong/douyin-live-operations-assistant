import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeConfig} from '../../src/core/engine.js';
import {createAIPlayground} from '../../src/services/ai-playground.js';
import {createPreviewResearch} from '../../src/services/preview-research.js';

test('AI关闭时测试页仍使用独立后台模型查询知识，前台只判断和回复，调用分别计数',async()=>{
 const config=mergeConfig({ai:{enabled:false,maxPerHour:2,edge:{enabled:false},model:'fast',taskModels:{research:{enabled:true,endpoint:'https://deep.test/v1/responses',model:'deep'}}}}),before=structuredClone(config),requests=[];
 let lookups=0,plans=0;
 const request=details=>{
  const body=JSON.parse(details.data);requests.push({model:body.model,key:details.headers.Authorization});
  const output=body.model==='deep' ? JSON.stringify(++plans===1 ? {action:'knowledge',query:'杯子材质'} : {action:'finish',answer:'材质暂无核实记录。',citations:[]}) : requests.length===1 ? '{"intent":"research","query":"杯子材质","reply":""}' : '{"answer":"杯子材质还没有核实。","sources":[]}';
  details.onload({status:200,responseText:JSON.stringify(body.model==='deep' ? {status:'completed',output_text:output} : {choices:[{message:{content:output}}]})});
 };
 const research=createPreviewResearch({request,getKey:()=> 'deep-key',getConfig:()=>config,knowledge:async()=>{lookups++;return [];}});
 const service=createAIPlayground({request,research,getKey:()=> 'front-key',getConfig:()=>config,getContext:()=>({context:[]})});
 const result=await service.run({question:'杯子是什么材质'});
 assert.equal(result.status,'succeeded',result.error);assert.equal(result.answer,'杯子材质还没有核实。');
 assert.deepEqual(requests,[{model:'fast',key:'Bearer front-key'},{model:'deep',key:'Bearer deep-key'},{model:'deep',key:'Bearer deep-key'},{model:'fast',key:'Bearer front-key'}]);
 assert.equal(lookups,1);assert.equal(result.calls.cloud,4);assert.equal(result.calls.background,2);assert.deepEqual(config,before);
});
