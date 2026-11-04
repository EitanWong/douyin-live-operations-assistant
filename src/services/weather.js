import {z} from 'zod';
import {requestJSON} from './search.js';
import {currentTime,validTimeZone} from './current-facts.js';

const GEO='https://geocoding-api.open-meteo.com/v1/search',FORECAST='https://api.open-meteo.com/v1/forecast';
const CURRENT='temperature_2m,weather_code',DAILY='weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max';
export const calendarDate=value=>/^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
export const weatherPlanSchema=z.strictObject({intent:z.literal('weather'),location:z.string().trim().min(1).max(80),region:z.string().trim().max(80).default(''),date:z.string().refine(value=>['today','tomorrow','day-after-tomorrow'].includes(value) || calendarDate(value)).default('today'),period:z.enum(['current','day']).default('day')});
const coordinates={latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180)};
const placeSchema=z.object({...coordinates,name:z.string().min(1).max(160),timezone:z.string().refine(validTimeZone),feature_code:z.string().optional(),population:z.number().nonnegative().optional(),country:z.string().optional(),admin1:z.string().optional(),admin2:z.string().optional(),admin3:z.string().optional()});
const normalized=value=>value.normalize('NFKC').toLowerCase().replace(/(?:省|市|县|镇|区)$/u,'').trim();
const label=place=>[place.admin1,place.admin2,place.name].filter(Boolean).join('');
const rank=place=>/^PPLC$/u.test(place.feature_code) ? 0 : /^PPLA\d?$/u.test(place.feature_code) ? 1 : 2;
export function locate(data,plan){
 const parsed=z.object({results:z.array(placeSchema).max(100).optional()}).parse(data);
 const places=(parsed.results || []).filter(row=>normalized(row.name)===normalized(plan.location) && (!plan.region || [row.country,row.admin1,row.admin2,row.admin3].some(value=>value && normalized(value).includes(normalized(plan.region)))));
 if(!places.length)throw new Error('未找到匹配地点');
 const best=places.filter(row=>rank(row)===Math.min(...places.map(rank))).sort((a,b)=>(b.population || 0)-(a.population || 0));
 if(best.length===1 || best[0].population>3*(best[1].population || 0))return {place:best[0]};
 return {clarification:`你问的是${[...new Set(best.slice(0,2).map(label))].join('还是')}？`};
}
export function weatherDate(date,now,timeZone='Asia/Shanghai'){
 if(calendarDate(date))return date;
 const today=currentTime({now},timeZone).date,offset={today:0,tomorrow:1,'day-after-tomorrow':2}[date];
 return new Date(Date.parse(`${today}T00:00:00Z`)+offset*86400000).toISOString().slice(0,10);
}
// A fixed public-data capability; never a general URL proxy or credential sink.
export function validateWeatherURL(value){
 const url=new URL(value),base=`${url.origin}${url.pathname}`,params=url.searchParams;
 if(url.username || url.password || url.hash || [...params.keys()].length!==new Set(params.keys()).size)throw new Error('天气地址无效');
 const keys=base===GEO ? ['name','count','language','format'] : base===FORECAST ? ['latitude','longitude','timezone','forecast_days','current','daily'] : [];
 if(!keys.length || [...params.keys()].sort().join()!==keys.sort().join())throw new Error('天气地址无效');
 if(base===GEO){
  if(!params.get('name')?.trim() || params.get('name').length>80 || params.get('count')!=='20' || params.get('language')!=='zh' || params.get('format')!=='json')throw new Error('天气地名请求无效');
 }else{
  coordinates.latitude.parse(Number(params.get('latitude')));coordinates.longitude.parse(Number(params.get('longitude')));
  if(!params.get('latitude') || !params.get('longitude') || params.get('timezone')!=='auto' || params.get('forecast_days')!=='16' || params.get('current')!==CURRENT || params.get('daily')!==DAILY)throw new Error('天气预报请求无效');
 }
 return url.href;
}
const weatherCodes={0:'晴',1:'大部晴朗',2:'多云',3:'阴',45:'雾',48:'雾凇',51:'小毛毛雨',53:'毛毛雨',55:'较强毛毛雨',56:'冻毛毛雨',57:'冻毛毛雨',61:'小雨',63:'中雨',65:'大雨',66:'冻雨',67:'冻雨',71:'小雪',73:'中雪',75:'大雪',77:'米雪',80:'小阵雨',81:'阵雨',82:'强阵雨',85:'小阵雪',86:'强阵雪',95:'雷雨',96:'雷雨伴冰雹',99:'强雷雨伴冰雹'};
const codeSchema=z.number().int().refine(code=>Object.hasOwn(weatherCodes,code)),temperature=z.number().finite().min(-100).max(70);
function forecastContent(data,place,plan,date,now){
 if(data?.timezone!==place.timezone || data?.current_units?.temperature_2m!=='°C' || data?.daily_units?.temperature_2m_max!=='°C' || data?.daily_units?.temperature_2m_min!=='°C')throw new Error('天气时区或单位无效');
 if(plan.period==='current'){
  if(date!==currentTime({now},place.timezone).date)throw new Error('当前天气不能回答其他日期');
  const row=z.object({time:z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u),temperature_2m:temperature,weather_code:codeSchema}).parse(data.current);
  const offset=z.number().finite().min(-50400).max(50400).parse(data.utc_offset_seconds),observed=Date.parse(`${row.time}:00Z`)-offset*1000;
  if(!Number.isFinite(observed) || now-observed>7200000 || observed-now>900000)throw new Error('当前天气数据已过期');
  return `${label(place)}（${place.timezone}）${row.time}当前天气（模型估算）：${weatherCodes[row.weather_code]}，${row.temperature_2m}℃。`;
 }
 const daily=z.object({time:z.array(z.string().refine(calendarDate)).max(16),weather_code:z.array(codeSchema).max(16),temperature_2m_min:z.array(temperature).max(16),temperature_2m_max:z.array(temperature).max(16),precipitation_probability_max:z.array(z.number().min(0).max(100).nullable()).max(16)}).parse(data.daily);
 const index=daily.time.indexOf(date);
 if(index<0 || Object.values(daily).some(values=>values.length!==daily.time.length))throw new Error('天气数据未覆盖所问日期');
 const min=daily.temperature_2m_min[index],max=daily.temperature_2m_max[index];if(min>max)throw new Error('天气温度范围无效');
 return `${label(place)}（${place.timezone}）${date}天气预报：${weatherCodes[daily.weather_code[index]]}，${min}至${max}℃。${daily.precipitation_probability_max[index]===null ? '' : `最高降水概率${daily.precipitation_probability_max[index]}%。`}`;
}
export function createWeatherClient({request}){
 return async(input,{now=Date.now(),signal,timeout=8000}={})=>{
  const plan=weatherPlanSchema.parse(input),deadline=Date.now()+timeout;
  const get=async url=>{
   const remaining=deadline-Date.now();if(remaining<=0)throw new Error('天气查询超时');
   return requestJSON(request,{url:validateWeatherURL(url),method:'GET',operation:'weather',timeout:remaining,signal});
  };
  const geo=new URL(GEO);geo.search=new URLSearchParams({name:plan.location,count:20,language:'zh',format:'json'}).toString();
  const location=locate(await get(geo.href),plan);if(location.clarification)return location;
  const {place}=location,date=weatherDate(plan.date,now,place.timezone),url=new URL(FORECAST);
  url.search=new URLSearchParams({latitude:place.latitude,longitude:place.longitude,timezone:'auto',forecast_days:16,current:CURRENT,daily:DAILY}).toString();
  const content=forecastContent(await get(url.href),place,plan,date,now);
  return {provider:'open-meteo',query:`${label(place)}${date}天气`,searchedAt:now,results:[{index:1,title:`Open-Meteo ${label(place)}天气预报`,url:url.href,content,publishedAt:null}]};
 };
}
