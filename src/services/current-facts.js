export const DEFAULT_TIME_ZONE='Asia/Shanghai';
export const validTimeZone=value=>{try{new Intl.DateTimeFormat('zh-CN',{timeZone:value}).format();return typeof value==='string' && value.length<=80;}catch{return false;}};
export function currentTime(prompt={},timeZone=DEFAULT_TIME_ZONE){
 const at=prompt.getNow?.() ?? prompt.now ?? Date.now();
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(at).map(row=>[row.type,row.value]));
 return {at,timeZone,date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}:${parts.second}`,weekday:new Intl.DateTimeFormat('zh-CN',{timeZone,weekday:'long'}).format(at)};
}
export function clockAnswer(prompt,timeZone=DEFAULT_TIME_ZONE){
 const time=currentTime(prompt,timeZone),[year,month,day]=time.date.split('-').map(Number);
 return `${timeZone===DEFAULT_TIME_ZONE ? '北京时间' : timeZone} ${year}年${month}月${day}日${time.weekday} ${time.time}。`;
}
export const CURRENT_FACTS_INSTRUCTION='current_time是运行时钟，默认北京时间Asia/Shanghai；按它理解今天、明天、星期与年份，不凭训练记忆猜日期。接话资格明确后，当前时间/日期/星期用工具意图{"intent":"clock","timeZone":"Asia/Shanghai"}，其他地区使用其IANA时区，不需要搜索。实际天气查询优先用{"intent":"weather","location":"横店","region":"浙江","date":"today","period":"day"}；location只写地名，不含昵称或问题，region填已知省州或国家，无则空字符串。date填today、tomorrow、day-after-tomorrow或YYYY-MM-DD，未指定默认today；查询现在温度用period=current，全天或未指定用day。地点不明且上下文无法确定才clarify，不猜观众位置。具体天气数据由工具取得，不能用chat绕过查证。穿着、手持物等直播画面问题使用当前media_context的视觉证据，不搜索外部网页。';
