// Completed observations are evidence, never instructions from the stream.
export function freshObservations(media,now){
  return (media?.observations || []).filter(row=>{
    const endedAt=row.endedAt ?? row.at;
    return row.isFinal!==false && ['audio','video','omni'].includes(row.kind) && typeof row.text==='string' && row.text.trim()
      && Number.isFinite(row.at) && Number.isFinite(endedAt) && endedAt>=row.at && now>=endedAt && now-endedAt<=30000;
  }).sort((a,b)=>(b.endedAt ?? b.at)-(a.endedAt ?? a.at));
}
export const observationKey=row=>JSON.stringify([row.kind,row.id,row.at,row.endedAt,row.text]);
export const sceneKey=row=>row.text.trim().replace(/\s+/gu,' ');
export function proactiveMode(ai,quietMs){
  if(!ai.enabled)return null;
  if(ai.proactiveEnabled && quietMs>=15000)return 'scene';
  return ai.idleEnabled && ai.chatEnabled && quietMs>=ai.idleSec*1000 ? 'idle' : null;
}
