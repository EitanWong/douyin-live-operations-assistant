import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWeatherClient,validateWeatherURL} from '../../src/services/weather.js';
import {parseAIIntent} from '../../src/services/intent.js';
const at=Date.parse('2026-11-04T16:05:06Z');
const plan={intent:'weather',location:'横店',region:'浙江',date:'today',period:'day'};
const place={name:'横店',latitude:29.15698,longitude:120.31478,timezone:'Asia/Shanghai',admin1:'浙江',admin2:'金华市',feature_code:'PPLA4'};
const forecast={timezone:'Asia/Shanghai',utc_offset_seconds:28800,current_units:{temperature_2m:'°C'},daily_units:{temperature_2m_min:'°C',temperature_2m_max:'°C'},current:{time:'2026-11-05T00:00',temperature_2m:18,weather_code:61},daily:{time:['2026-11-05','2026-11-06'],weather_code:[61,3],temperature_2m_min:[15,14],temperature_2m_max:[21,22],precipitation_probability_max:[80,0]}};
function fixture({places=[place],data=forecast}={}){
 const calls=[];const weather=createWeatherClient({request:d=>{calls.push(d);d.onload({status:200,responseText:JSON.stringify(calls.length===1 ? {results:places} : data),finalUrl:d.url});}});
 return {weather,calls};
}
test('真实天气客户端定位横店镇坐标，按当地跨日日期回答，全部请求不带密钥或昵称',async()=>{
 const f=fixture({places:[{...place,name:'横山'},place,{...place,admin1:'湖北',latitude:30.85166}]});
 const found=await f.weather(plan,{now:at});assert.match(found.results[0].content,/浙江金华市横店.*2026-11-05.*小雨.*15至21℃.*80%/u);
 assert.equal(f.calls.length,2);assert.equal(new URL(f.calls[1].url).searchParams.get('latitude'),'29.15698');
 assert.ok(f.calls.every(d=>d.method==='GET' && d.data===undefined && !d.headers.Authorization && d.operation==='weather'));
});
test('当前气温和明日预报分开取值，0度/0降水概率是有效数据',async()=>{
 assert.match((await fixture().weather({...plan,period:'current'},{now:at})).results[0].content,/当前天气.*18℃/u);
 assert.match((await fixture().weather({...plan,date:'tomorrow'},{now:at})).results[0].content,/2026-11-06.*阴.*0%/u);
 const data=structuredClone(forecast);data.current.temperature_2m=0;assert.match((await fixture({data}).weather({...plan,period:'current'},{now:at})).results[0].content,/0℃/u);
});
test('研究显式不设超时时，定位与天气请求均不立即过期',async()=>{
 const f=fixture();
 assert.match((await f.weather(plan,{now:at,timeout:0})).results[0].content,/15至21℃/u);
 assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>call.timeout===0));
});
test('同名行政地无法区分就澄清，不回退到错误地点、村庄或第一条模糊结果',async()=>{
 const f=fixture({places:[{...place,admin1:'湖北'},place]});assert.match((await f.weather({...plan,region:''},{now:at})).clarification,/湖北.*浙江/u);assert.equal(f.calls.length,1);
 await assert.rejects(fixture({places:[{...place,name:'横峰'}]}).weather(plan,{now:at}),/匹配地点/u);
 assert.match((await fixture({places:[{...place,admin1:'湖北',feature_code:'PPL'},place]}).weather({...plan,region:''},{now:at})).query,/浙江/u);
});
test('过期实时值、缺日期/错误单位/空值/非法天气码不能变成确定天气',async()=>{
 for(const change of [d=>d.current.time='2026-11-04T12:00',d=>d.current.temperature_2m=null,d=>d.current.weather_code=999,d=>d.current_units.temperature_2m='°F']){
  const data=structuredClone(forecast);change(data);await assert.rejects(fixture({data}).weather({...plan,period:'current'},{now:at}));
 }
 await assert.rejects(fixture().weather({...plan,date:'2026-12-01'},{now:at}),/未覆盖/u);
 const data=structuredClone(forecast);data.daily.temperature_2m_max=[];await assert.rejects(fixture({data}).weather(plan,{now:at}),/未覆盖/u);
});
test('取消实际中断在途网络，取消后不继续查天气',async()=>{
 const controller=new AbortController();let aborted=0,calls=0;
 const weather=createWeatherClient({request:()=>{calls++;return {abort:()=>aborted++};}});
 const pending=weather(plan,{now:at,signal:controller.signal});controller.abort();await assert.rejects(pending,/取消/u);assert.equal(aborted,1);assert.equal(calls,1);
});
test('公共天气能力只接受固定HTTPS接口和有界参数，工具计划拒绝非法时区日期',()=>{
 const valid='https://geocoding-api.open-meteo.com/v1/search?name=横店&count=20&language=zh&format=json';assert.match(validateWeatherURL(valid),/open-meteo/u);
 for(const url of [valid.replace('https:','http:'),valid.replace('open-meteo.com','open-meteo.com.evil.test'),valid+'&key=secret',valid+'&name=上海',valid+'#x',valid.replace('count=20','count=999')])assert.throws(()=>validateWeatherURL(url));
 for(const value of [{intent:'clock',timeZone:'fake/timezone'},{...plan,date:'2026-02-30'},{...plan,location:''}])assert.throws(()=>parseAIIntent(JSON.stringify(value),80));
});
test('所问日期有效时，远期空值和其他日期的坏数据不应阻断今天预报',async()=>{
 const data=structuredClone(forecast);
 data.daily.time.push('2026-11-07');
 for(const key of ['weather_code','temperature_2m_min','temperature_2m_max','precipitation_probability_max'])data.daily[key].push(null);
 assert.match((await fixture({data}).weather(plan,{now:at})).results[0].content,/15至21℃/u);
 data.daily.weather_code[0]=null;
 await assert.rejects(fixture({data}).weather(plan,{now:at}));
});
test('主预报不可用时按已核验坐标查询wttr备用预报，保留日期与来源',async()=>{
 const calls=[];
 const weather=createWeatherClient({request:d=>{
  calls.push(d);const host=new URL(d.url).hostname;
  const data=host.startsWith('geocoding') ? {results:[place]} : host==='wttr.in' ? {nearest_area:[{latitude:'29.158',longitude:'120.310'}],weather:[{date:'2026-11-05',mintempC:'15',maxtempC:'23',hourly:[{time:'1200',weatherCode:'119',chanceofrain:'43'}]}]} : {error:true};
  d.onload({status:200,responseText:JSON.stringify(data),finalUrl:d.url});
 }});
 const found=await weather(plan,{now:at});assert.equal(found.provider,'wttr');assert.match(found.results[0].content,/2026-11-05.*阴.*15至23℃/u);
 assert.equal(new URL(calls[2].url).pathname,'/29.15698,120.31478');
});
test('备用预报拒绝错坐标、过期日期、空温度和未知天气码，不以坏资料回答',async()=>{
 for(const mutate of [d=>d.nearest_area[0].latitude='30.85',d=>d.weather[0].date='2026-11-04',d=>d.weather[0].mintempC=null,d=>d.weather[0].hourly[0].weatherCode='999']){
  const data={nearest_area:[{latitude:'29.158',longitude:'120.310'}],weather:[{date:'2026-11-05',mintempC:'15',maxtempC:'23',hourly:[{time:'1200',weatherCode:'119',chanceofrain:'43'}]}]};mutate(data);
  const weather=createWeatherClient({request:d=>{const host=new URL(d.url).hostname;d.onload({status:200,responseText:JSON.stringify(host.startsWith('geocoding') ? {results:[place]} : host==='wttr.in' ? data : {}),finalUrl:d.url});}});
  await assert.rejects(weather(plan,{now:at}),/wttr.in/u);
 }
});
test('主源超时会留出备用时间，取消不启动备用，不用缺观测日期的备用数据回答实时天气',async()=>{
 const calls=[];
 const weather=createWeatherClient({request:d=>{calls.push(d);if(calls.length===1)d.onload({status:200,responseText:JSON.stringify({results:[place]}),finalUrl:d.url});else d.ontimeout();}});
 await assert.rejects(weather(plan,{now:at}));assert.equal(calls.length,3);assert.ok(calls[1].timeout<calls[2].timeout);
 calls.length=0;await assert.rejects(weather({...plan,period:'current'},{now:at}));assert.equal(calls.length,2);
 const controller=new AbortController();let count=0;
 const cancelled=createWeatherClient({request:d=>{count++;if(count===1)d.onload({status:200,responseText:JSON.stringify({results:[place]}),finalUrl:d.url});else controller.abort();}});
 await assert.rejects(cancelled(plan,{now:at,signal:controller.signal}),/取消/u);assert.equal(count,2);
});
