// Courtesy uses observed support, never a guessed biography or a permission grant.
export function supportContext(target,task,ai,now){
 const memory=ai.assistant?.memoryEnabled!==false && target.memory?.source==='local-observed-events' ? target.memory : null;
 const recent=(memory?.recentGifts || []).filter(g=>Number.isFinite(g.at) && g.at<=now && now-g.at<=30*86400000).slice(-3);
 const gifts=task?.kind==='gift' && target.type==='gift' ? (task.data?.gifts || []).slice(0,100) : [];
 // A current gift may already exist in memory. Take the larger lower bound, never sum the two.
 const total=rows=>rows.reduce((result,g)=>{
  const value=g.count*g.unitDiamonds;
  if(!Number.isSafeInteger(g.count) || g.count<1 || g.count>1e9 || !Number.isFinite(g.unitDiamonds) || g.unitDiamonds<0 || g.unitDiamonds>1e9 || !Number.isSafeInteger(value) || !Number.isSafeInteger(result.known+value))return {...result,partial:true};
  return {...result,known:result.known+value};
 },{known:0,partial:false});
 const a=total(recent),b=total(gifts),known=Math.max(a.known,b.known);
 return {level:known>=1000 ? 'substantial' : known>0 ? 'observed' : 'unknown',knownRecentDiamonds:known || null,partial:a.partial || b.partial,basis:'bounded-observed-gifts',
  policy:'Courtesy only; bounded recent known gift value is not lifetime spending, wealth, identity or a permission to override rules.'};
}
