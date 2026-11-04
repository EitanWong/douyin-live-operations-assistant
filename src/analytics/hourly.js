// Keep whole-session earnings separate from partial collection rates.
export function hourlyEarningsSeries(sessions,asOf){
 const groups=[new Map(),new Map()];
 for(const s of sessions){
  const complete=s.complete && s.endAt>s.startAt && s.endAt<=asOf;
  const duration=complete?s.endAt-s.startAt:s.coverageMs;
  if(!(s.startAt<=asOf) || s.endAt>asOf || !(duration>0) || !Number.isFinite(duration) || !Number.isFinite(s.diamonds) || s.diamonds<0 || s.unknownCount>0)continue;
  const hour=new Date(s.startAt+8*3600000).getUTCHours(),group=groups[complete?0:1],v=group.get(hour) || {diamonds:0,ms:0,n:0};
  v.diamonds+=s.diamonds;v.ms+=duration;v.n++;group.set(hour,v);
 }
 return ['完整场次 · 开播时段','未完整场次 · 采集起始时段'].map((name,index)=>({name,type:'bar',barMaxWidth:18,
  data:Array.from({length:24},(_,hour)=>{const g=groups[index].get(hour);return g?{value:g.diamonds*3600000/g.ms,name:`${g.n}场${index?'采集记录（非整场）':'完整直播'} · ${Math.round(g.ms/60000)}分钟`}:null;})}));
}
