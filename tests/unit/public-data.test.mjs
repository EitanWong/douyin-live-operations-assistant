import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAIClient} from '../../src/services/ai.js';
import {mergeConfig} from '../../src/core/engine.js';
import {createPublicDataClient,validatePublicDataURL} from '../../src/services/public-data.js';
import {parseAIIntent} from '../../src/services/intent.js';
const at=Date.parse('2026-11-04T10:00:00Z');
const config=mergeConfig({ai:{search:{enabled:false}}}).ai;
const plans=[
 {intent:'public-data',tool:'exchange-rate',base:'CNY',quote:'USD',amount:100,date:'latest'},
 {intent:'public-data',tool:'holidays',countryCode:'CN',year:2026,date:'2026-10-10'},
 {intent:'public-data',tool:'air-quality',location:'横店',region:'浙江'},
 {intent:'public-data',tool:'geocode',location:'横店'}
];
const responses=[
 {base:'CNY',quote:'USD',date:'2026-11-04',rate:0.14},
 {year:2026,days:[{date:'2026-10-10',name:'国庆节',isOffDay:false}]},
 {timezone:'Asia/Shanghai',utc_offset_seconds:28800,current_units:{us_aqi:'USAQI',pm2_5:'μg/m³',pm10:'μg/m³'},current:{time:'2026-11-04T18:00',us_aqi:42,pm2_5:9.1,pm10:12.2}},
 {results:[{name:'横店',latitude:29.15698,longitude:120.31478,timezone:'Asia/Shanghai',admin1:'浙江',admin2:'金华市',feature_code:'PPLA4'}]}
];
test('命名公共工具直接取得数据与来源，搜索关闭不影响，公共请求不计成模型调用',async()=>{
 for(const [i,plan] of plans.entries()){
  const calls=[],records=[];
  const client=createAIClient({getKey:()=> 'private-model-key',request:d=>{calls.push(d);const output=d.operation==='public-data' ? (i===2 && calls.length===2 ? responses[3] : responses[i]) : {choices:[{message:{content:calls.length===1 ? JSON.stringify({intent:'public-data',call:Object.fromEntries(Object.entries(plan).filter(([key])=>key!=='intent'))}) : '{"answer":"已按来源回答。","sources":[1]}'}}]};d.onload({status:200,responseText:JSON.stringify(output),finalUrl:d.url});},onSearch:r=>records.push(r)});
  const answer=await client({getNow:()=>at,task:{kind:'ai'},target:{text:'查询公开数据'},maxLength:80},config);
  assert.equal(answer,'已按来源回答。');assert.equal(calls.length,i===2 ? 4 : 3);assert.equal(calls[1].operation,'public-data');assert.equal(calls[1].method,'GET');assert.equal(calls[1].headers.Authorization,undefined);assert.equal(calls[1].data,undefined);
  assert.deepEqual(records[0].citationIndices,[1]);assert.ok(records[0].results[0].content.length>0);assert.equal(records[0].tool,plan.tool);
 }
});
test('公共数据拒绝未知工具、额外参数、任意URL、端口、认证与错误计量数据',async()=>{
 for(const call of [{tool:'shell',command:'whoami'},{tool:'exchange-rate',base:'CNY',quote:'USD',url:'https://evil.test'},{tool:'holidays',countryCode:'CN',year:1800},{tool:'air-quality',location:''}])assert.throws(()=>parseAIIntent(JSON.stringify({intent:'public-data',call}),80));
 const valid='https://api.frankfurter.dev/v2/rate/CNY/USD';assert.equal(validatePublicDataURL(valid),valid);
 for(const url of [valid.replace('https:','http:'),valid.replace('.dev/','.dev:444/'),valid+'?key=x',valid+'#x',valid.replace('api.frankfurter.dev','api.frankfurter.dev.evil.test'),'https://raw.githubusercontent.com/other/repo/master/2026.json','https://api.frankfurter.dev/v2/rate/CNY/USD?date=2026-13-01'])assert.throws(()=>validatePublicDataURL(url),url);
 const run=(call,data)=>createPublicDataClient({request:d=>d.onload({status:200,responseText:JSON.stringify(data)})})(call,{now:at});
 const rate={tool:'exchange-rate',base:'CNY',quote:'USD',date:'latest',amount:100};
 for(const data of [{base:'USD',quote:'CNY',date:'2026-11-04',rate:7},{base:'CNY',quote:'USD',date:'2026-01-01',rate:0.14},{base:'CNY',quote:'USD',date:'2026-11-04',rate:null}])await assert.rejects(run(rate,data));
 await assert.rejects(run({tool:'holidays',countryCode:'CN',year:2026,date:''},{year:2025,days:responses[1].days}),/年份/u);
});
test('研究显式不设超时时，公共数据请求正常返回且不附加计时器',async()=>{
 const calls=[];
 const client=createPublicDataClient({request:d=>{calls.push(d);d.onload({status:200,responseText:JSON.stringify(responses[0])});}});
 const found=await client({tool:'exchange-rate',base:'CNY',quote:'USD',date:'latest',amount:100},{now:at,timeout:0});
 assert.match(found.results[0].content,/14 USD/u);assert.equal(calls.length,1);assert.equal(calls[0].timeout,0);
});
test('节假日区分放假与补班，无条目不推断上班，全球数据保留地区和节日类别',async()=>{
 const run=(call,data)=>createPublicDataClient({request:d=>d.onload({status:200,responseText:JSON.stringify(data)})})(call,{now:at});
 const call={tool:'holidays',countryCode:'CN',year:2026,date:'2026-10-10'};
 assert.match((await run(call,responses[1])).results[0].content,/调休上班/u);
 assert.match((await run({...call,date:'2026-11-04'},responses[1])).results[0].content,/未记录不等于|不据此推断/u);
 const usa=await run({tool:'holidays',countryCode:'US',year:2026,date:'2026-04-03'},[{date:'2026-04-03',name:'Good Friday',localName:'Good Friday',countryCode:'US',global:false,counties:['US-CA'],types:['Optional']}]);
 assert.match(usa.results[0].content,/部分地区\(US-CA\).*Optional/u);assert.doesNotMatch(usa.results[0].content,/全国范围/u);
});
test('空气质量自动定位后使用美国AQI单位，取消不继续下一步网络',async()=>{
 const calls=[];const controller=new AbortController();
 const client=createPublicDataClient({request:d=>{calls.push(d);if(calls.length===1)d.onload({status:200,responseText:JSON.stringify(responses[3])});else d.onload({status:200,responseText:JSON.stringify(responses[2])});}});
 const result=await client({tool:'air-quality',location:'横店',region:'浙江'},{now:at});assert.equal(calls.length,2);assert.match(result.results[0].content,/美国标准.*PM2.5.*μg\/m³/u);assert.match(result.results[0].content,/不是中国AQI/u);
 const stopped=createPublicDataClient({request:d=>{controller.abort();return {abort(){}};}});
 await assert.rejects(stopped({tool:'geocode',location:'横店',region:''},{now:at,signal:controller.signal}),/取消/u);
});
