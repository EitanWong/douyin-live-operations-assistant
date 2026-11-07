import {z} from 'zod';
import {requestJSON} from './search.js';
import {calendarDate,locate,validateWeatherURL} from './weather.js';
import {validTimeZone} from './current-facts.js';

const dateSchema=z.string().refine(calendarDate),currency=z.string().regex(/^[A-Z]{3}$/u),country=z.string().regex(/^[A-Z]{2}$/u);
const location={location:z.string().trim().min(1).max(80),region:z.string().trim().max(80).default('')};
const schemas=[
 z.strictObject({tool:z.literal('exchange-rate'),base:currency,quote:currency,amount:z.number().finite().min(0).max(1e12).default(1),date:z.union([z.literal('latest'),dateSchema]).default('latest')}),
 z.strictObject({tool:z.literal('holidays'),countryCode:country,year:z.number().int().min(2000).max(2100),date:z.union([z.literal(''),dateSchema]).default(''),name:z.string().trim().max(60).default('')}),
 z.strictObject({tool:z.literal('air-quality'),...location}),
 z.strictObject({tool:z.literal('geocode'),...location})
];
export const publicCallSchema=z.discriminatedUnion('tool',schemas);
export const publicDataIntentSchema=z.strictObject({intent:z.literal('public-data'),call:publicCallSchema});
export const PUBLIC_DATA_TOOLS=Object.freeze([
 {tool:'exchange-rate',example:{tool:'exchange-rate',base:'CNY',quote:'USD',amount:100,date:'latest'},description:'Frankfurter日参考汇率与历史汇率；保留来源日期，不冒充实时成交价。'},
 {tool:'holidays',example:{tool:'holidays',countryCode:'CN',year:2026,date:'2026-10-10',name:''},description:'中国放假/调休工作日或其他国家节假日；date可留空，name可按节日过滤。不是公司个人排班。'},
 {tool:'air-quality',example:{tool:'air-quality',location:'横店',region:'浙江'},description:'先定位再查当前空气质量模型值；明确US AQI标准与微克/立方米，不冒充中国AQI或监测站实测。'},
 {tool:'geocode',example:{tool:'geocode',location:'横店',region:'浙江'},description:'地名坐标、行政区域与时区；同名候选不等于观众位置。'}
]);
export const PUBLIC_DATA_INSTRUCTION=`可直接调用公共数据工具，无需搜索密钥。匹配这些需求时输出{"intent":"public-data","call":工具参数}，不含query或reply。工具清单：${JSON.stringify(PUBLIC_DATA_TOOLS)}。结果仅能支持其日期、地点、计量标准和范围；可见穿着用当前视觉证据。`;
export function publicDataQuery(call){
 if(call.tool==='exchange-rate')return `${call.amount}${call.base}兑${call.quote} ${call.date==='latest' ? '最新' : call.date}参考汇率`;
 if(call.tool==='holidays')return `${call.countryCode} ${call.date || call.year} ${call.name || ''}节假日与调休`;
 return `${call.region || ''}${call.location} ${call.tool==='geocode' ? '地理位置与时区' : '空气质量'}`;
}
const geoURL=call=>{const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.search=new URLSearchParams({name:call.location,count:20,language:'zh',format:'json'}).toString();return url.href;};
const canonical=(input,keys)=>{
 const url=new URL(input);
 if(url.protocol!=='https:' || url.port || url.username || url.password || url.hash || [...url.searchParams.keys()].sort().join()!==keys.sort().join())throw new Error('公共数据地址无效');
 return url;
};
export function validatePublicDataURL(value){
 const url=new URL(value),host=url.hostname,path=url.pathname;
 if(host==='geocoding-api.open-meteo.com')return validateWeatherURL(value);
 if(host==='api.frankfurter.dev'){
  const parsed=canonical(value,url.search ? ['date'] : []);
  if(!/^\/v2\/rate\/[A-Z]{3}\/[A-Z]{3}$/u.test(path) || parsed.search && !calendarDate(parsed.searchParams.get('date')))throw new Error('汇率地址无效');
  return parsed.href;
 }
 if(host==='raw.githubusercontent.com' && /^\/NateScarlet\/holiday-cn\/master\/20\d{2}\.json$/u.test(path))return canonical(value,[]).href;
 if(host==='date.nager.at' && /^\/api\/v3\/PublicHolidays\/20\d{2}\/[A-Z]{2}$/u.test(path))return canonical(value,[]).href;
 if(host==='air-quality-api.open-meteo.com' && path==='/v1/air-quality'){
  const parsed=canonical(value,['latitude','longitude','timezone','current']),p=parsed.searchParams;
  z.number().finite().min(-90).max(90).parse(Number(p.get('latitude')));z.number().finite().min(-180).max(180).parse(Number(p.get('longitude')));
  if(!p.get('latitude') || !p.get('longitude') || p.get('timezone')!=='auto' || p.get('current')!=='us_aqi,pm2_5,pm10')throw new Error('空气质量地址无效');
  return parsed.href;
 }
 throw new Error('公共数据接口不在工具清单中');
}
function rateContent(data,call,now){
 const row=z.object({date:dateSchema,base:currency,quote:currency,rate:z.number().finite().positive()}).parse(data);
 const expected=call.date==='latest' ? now : Date.parse(call.date),observed=Date.parse(row.date);
 if(row.base!==call.base || row.quote!==call.quote || expected>now || observed>expected || expected-observed>10*86400000)throw new Error('汇率币种或日期不匹配，数据可能过期');
 return `${row.date} ${call.base}/${call.quote}日参考汇率：1 ${row.base}=${row.rate} ${row.quote}；${call.amount} ${row.base}约合${Number((call.amount*row.rate).toPrecision(12))} ${row.quote}。来自Frankfurter汇总参考数据，不是实时成交价或银行换汇报价。`;
}
const holiday=z.object({date:dateSchema,name:z.string().min(1).max(120),isOffDay:z.boolean()});
function holidayContent(data,call){
 let rows;
 if(call.countryCode==='CN'){
  const parsed=z.object({year:z.number().int(),days:z.array(holiday).max(400)}).parse(data);
  if(parsed.year!==call.year)throw new Error('节假日年份不匹配');rows=parsed.days;
 }else{
  const parsed=z.array(z.object({date:dateSchema,name:z.string().min(1).max(120),localName:z.string().max(120),countryCode:country,global:z.boolean(),counties:z.array(z.string().max(20)).nullable(),types:z.array(z.string().max(40))})).max(400).parse(data);
  if(parsed.some(row=>row.countryCode!==call.countryCode))throw new Error('节假日国家不匹配');
  rows=parsed.map(row=>({...row,isOffDay:null}));
 }
 if(!rows.length || call.date && Number(call.date.slice(0,4))!==call.year)throw new Error('节假日数据未覆盖所问年份');
 const selected=rows.filter(row=>Number(row.date.slice(0,4))===call.year && (!call.date || row.date===call.date) && (!call.name || row.name.includes(call.name) || row.localName?.includes(call.name)));
 if(!selected.length)return `${call.countryCode} ${call.date || call.year}在该年数据中没有匹配的节假日或调休条目。未记录不等于没有节日，不据此推断工作日或个人排班。`;
 const summary=selected.slice(0,20).map(row=>`${row.date} ${row.name}：${row.isOffDay===true ? '放假' : row.isOffDay===false ? '调休上班' : `${row.global ? '全国范围' : `部分地区(${(row.counties || []).join(',')})`}，类别${row.types.join(',')}`}`).join('；');
 return `${call.countryCode} ${call.year}节假日资料（${selected.length}条匹配，展示前${Math.min(selected.length,20)}条）：${summary}。第三方整理，具体安排以当地公告为准；传统节日与法定放假分开，不代表个人排班。`;
}
function airContent(data,place,now){
 const parsed=z.object({timezone:z.string().refine(validTimeZone),utc_offset_seconds:z.number().finite().min(-50400).max(50400),current_units:z.object({us_aqi:z.literal('USAQI'),pm2_5:z.literal('μg/m³'),pm10:z.literal('μg/m³')}),current:z.object({time:z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u),us_aqi:z.number().finite().min(0).max(1000),pm2_5:z.number().finite().nonnegative(),pm10:z.number().finite().nonnegative()})}).parse(data);
 const observed=Date.parse(`${parsed.current.time}:00Z`)-parsed.utc_offset_seconds*1000;
 if(parsed.timezone!==place.timezone || !Number.isFinite(observed) || now-observed>10800000 || observed-now>3600000)throw new Error('空气质量时间不匹配或过期');
 return `${place.admin1 || ''}${place.admin2 || ''}${place.name} ${parsed.current.time}（${parsed.timezone}）空气质量模型估算：US AQI ${parsed.current.us_aqi}（美国标准），PM2.5 ${parsed.current.pm2_5}μg/m³，PM10 ${parsed.current.pm10}μg/m³。来自Open-Meteo/CAMS，不是中国AQI或当地监测站实测。`;
}
export function createPublicDataClient({request}){
 return async(input,{now=Date.now(),signal,timeout=8000}={})=>{
  const call=publicCallSchema.parse(input),deadline=timeout>0 ? Date.now()+timeout : Infinity,searches=[];
  const get=async inputURL=>{
   const url=validatePublicDataURL(inputURL),remaining=deadline-Date.now();if(remaining<=0)throw new Error('公共数据查询超时');
   const data=await requestJSON(request,{url,method:'GET',operation:'public-data',timeout:Number.isFinite(remaining) ? remaining : 0,signal});searches.push({query:call.tool,count:1,url});return data;
  };
  let url,content;
  if(call.tool==='exchange-rate'){
   url=`https://api.frankfurter.dev/v2/rate/${call.base}/${call.quote}${call.date==='latest' ? '' : `?date=${call.date}`}`;content=rateContent(await get(url),call,now);
  }else if(call.tool==='holidays'){
   url=call.countryCode==='CN' ? `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${call.year}.json` : `https://date.nager.at/api/v3/PublicHolidays/${call.year}/${call.countryCode}`;content=holidayContent(await get(url),call);
  }else{
   const geo=await get(geoURL(call)),resolved=locate(geo,call);if(resolved.clarification)return resolved;
   const place=resolved.place;
   if(call.tool==='geocode'){
    url=geoURL(call);content=`${place.admin1 || ''}${place.admin2 || ''}${place.name}：纬度${place.latitude}，经度${place.longitude}，时区${place.timezone}。地名匹配不证明观众位置。`;
   }else{
    const endpoint=new URL('https://air-quality-api.open-meteo.com/v1/air-quality');endpoint.search=new URLSearchParams({latitude:place.latitude,longitude:place.longitude,timezone:'auto',current:'us_aqi,pm2_5,pm10'}).toString();url=endpoint.href;content=airContent(await get(url),place,now);
   }
  }
  return {provider:'public-data',tool:call.tool,query:publicDataQuery(call),searchedAt:now,searches,results:[{index:1,title:`公共数据：${call.tool}`,url,content:content.length<=1200 ? content : content.slice(0,1100)+'（摘要截断，不代表完整列表）',publishedAt:null}]};
 };
}
