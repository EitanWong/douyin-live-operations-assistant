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
 if(url.origin==='https://wttr.in'){
  const match=/^\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/u.exec(url.pathname);
  if(!match || params.size!==1 || params.get('format')!=='j1')throw new Error('天气备用请求无效');
  coordinates.latitude.parse(Number(match[1]));coordinates.longitude.parse(Number(match[2]));return url.href;
 }
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
 const daily=z.object({time:z.array(z.string().refine(calendarDate)).max(16),weather_code:z.array(z.unknown()).max(16),temperature_2m_min:z.array(z.unknown()).max(16),temperature_2m_max:z.array(z.unknown()).max(16),precipitation_probability_max:z.array(z.unknown()).max(16)}).parse(data.daily);
 const index=daily.time.indexOf(date);
 if(index<0 || Object.values(daily).some(values=>values.length!==daily.time.length))throw new Error('天气数据未覆盖所问日期');
 const code=codeSchema.parse(daily.weather_code[index]),probability=z.number().min(0).max(100).nullable().parse(daily.precipitation_probability_max[index]);
 const min=temperature.parse(daily.temperature_2m_min[index]),max=temperature.parse(daily.temperature_2m_max[index]);if(min>max)throw new Error('天气温度范围无效');
 return `${label(place)}（${place.timezone}）${date}天气预报：${weatherCodes[code]}，${min}至${max}℃。${probability===null ? '' : `最高降水概率${probability}%。`}`;
}
export function createWeatherClient({request}){
 return async(input,{now=Date.now(),signal,timeout=8000}={})=>{
  const plan=weatherPlanSchema.parse(input),deadline=timeout>0 ? Date.now()+timeout : Infinity;
  const get=async(url,budget=Infinity)=>{
   const remaining=deadline-Date.now();if(remaining<=0)throw new Error('天气查询超时');
   const wait=Math.min(remaining,budget);
   return requestJSON(request,{url:validateWeatherURL(url),method:'GET',operation:'weather',timeout:Number.isFinite(wait) ? wait : 0,signal});
  };
  const geo=new URL(GEO);geo.search=new URLSearchParams({name:plan.location,count:20,language:'zh',format:'json'}).toString();
  const location=locate(await get(geo.href),plan);if(location.clarification)return location;
  const {place}=location,date=weatherDate(plan.date,now,place.timezone),url=new URL(FORECAST);
  url.search=new URLSearchParams({latitude:place.latitude,longitude:place.longitude,timezone:'auto',forecast_days:16,current:CURRENT,daily:DAILY}).toString();
  let primaryError;
  try{
   const content=forecastContent(await get(url.href,Math.max(1,(deadline-Date.now())/2)),place,plan,date,now);
   return weatherResult('open-meteo','Open-Meteo',url.href,content,place,date,now);
  }catch(error){if(signal?.aborted)throw error;primaryError=error;}
  // wttr's current_condition often lacks an observation date: it is not safe for realtime answers.
  if(plan.period==='current')throw primaryError;
  const backup=`https://wttr.in/${place.latitude},${place.longitude}?format=j1`;
  try{
   const content=wttrContent(await get(backup),place,date);
   return {...weatherResult('wttr','wttr.in / WorldWeatherOnline',backup,content,place,date,now),fallbackReason:primaryError.message};
  }catch(error){throw new Error(`Open-Meteo：${primaryError.message}；wttr.in：${error.message}`);}
 };
}

function weatherResult(provider,title,url,content,place,date,now){
 return {provider,query:`${label(place)}${date}天气`,searchedAt:now,results:[{index:1,title:`${title} ${label(place)}天气预报`,url,content,publishedAt:null}]};
}
const wttrCodes={113:'晴',116:'多云',119:'阴',122:'阴',143:'薄雾',176:'零星小雨',179:'雨夹雪',182:'雨夹雪',185:'冻毛毛雨',200:'雷雨',227:'风雪',230:'暴风雪',248:'雾',260:'冻雾',263:'小毛毛雨',266:'毛毛雨',281:'冻毛毛雨',284:'强冻毛毛雨',293:'小雨',296:'小雨',299:'中雨',302:'中雨',305:'大雨',308:'大雨',311:'冻雨',314:'强冻雨',317:'雨夹雪',320:'强雨夹雪',323:'小雪',326:'小雪',329:'中雪',332:'中雪',335:'大雪',338:'大雪',350:'冰粒',353:'小阵雨',356:'中到大阵雨',359:'强阵雨',362:'阵性雨夹雪',365:'强阵性雨夹雪',368:'阵雪',371:'强阵雪',374:'冰粒',377:'强冰粒',386:'小雨伴雷',389:'中到大雨伴雷',392:'小雪伴雷',395:'中到大雪伴雷'};
const numericString=schema=>z.string().regex(/^-?\d+(?:\.\d+)?$/u).transform(Number).pipe(schema);
function wttrContent(data,place,date){
 const area=z.object({nearest_area:z.array(z.object({latitude:numericString(coordinates.latitude),longitude:numericString(coordinates.longitude)})).min(1).max(10),weather:z.array(z.object({date:z.string().refine(calendarDate)}).passthrough()).max(16)}).parse(data);
 if(Math.abs(area.nearest_area[0].latitude-place.latitude)>0.05 || Math.abs(area.nearest_area[0].longitude-place.longitude)>0.05)throw new Error('备用天气坐标不匹配');
 const raw=area.weather.find(row=>row.date===date);if(!raw)throw new Error('备用天气未覆盖所问日期');
 const row=z.object({mintempC:numericString(temperature),maxtempC:numericString(temperature),hourly:z.array(z.object({time:z.string().regex(/^(?:0|[1-9]00|1\d00|2[0-3]00)$/u),weatherCode:z.string().refine(code=>Object.hasOwn(wttrCodes,code)),chanceofrain:numericString(z.number().min(0).max(100))})).min(1).max(24)}).parse(raw);
 if(row.mintempC>row.maxtempC)throw new Error('备用天气温度范围无效');
 const conditions=[...new Set(row.hourly.map(hour=>wttrCodes[hour.weatherCode]))].join('、');
 return `${label(place)}（${place.timezone}）${date}天气预报：${conditions}，${row.mintempC}至${row.maxtempC}℃。最高降雨概率${Math.max(...row.hourly.map(hour=>hour.chanceofrain))}%。`;
}
