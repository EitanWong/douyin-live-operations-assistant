// Explicit projections keep protocol payloads and unrelated identities out of
// the archive, and cap work in the extension service worker.
export function predictionPulse({engine,network,identity,connected}){
 const current=engine.pk.current(),active=current?.anchorId===engine.config.anchorId && ['active','ended'].includes(current.phase)?current:null;
 const competitors=(active?.competitors || []).slice(0,8).map(c=>({anchorId:String(c.anchorId),name:String(c.name || '').slice(0,160),isSelf:Boolean(c.isSelf),score:c.score || 0,scoreObserved:Boolean(c.scoreObserved),scoreAgeMs:c.scoreAgeMs ?? 1e12}));
 const pk=active?{key:active.key,phase:active.phase,remainingMs:Math.max(0,active.remainingMs || 0),competitors,dataQuality:{stale:Boolean(active.dataQuality?.stale)},trend:(active.trend || []).slice(-120).map(t=>({at:t.at,selfScore:t.selfScore ?? null,opponentScore:t.opponentScore ?? null,competitorScores:Object.fromEntries(competitors.filter(c=>Number.isFinite(t.competitorScores?.[c.anchorId])).map(c=>[c.anchorId,t.competitorScores[c.anchorId]]))}))}:null;
 const outcomes=[...engine.anchorStats.records.values()].filter(r=>r.anchorId===engine.config.anchorId && r.scoreFinal && ['win','loss','draw'].includes(r.outcome)).slice(-200).map(r=>({battleKey:r.battleKey || r.key,endedAt:r.endedAt,scoreFinal:true,outcome:r.outcome}));
 return {connected:Boolean(connected),roomId:identity.live?.roomId || '',gaps:(network.ingestion?.gaps || 0)+(network.bridgeGaps || 0)+(network.frameGaps || 0)+(network.capture?.gaps || 0),pk,outcomes};
}
export function predictionContext(report,anchor,now){
 if(!report || !anchor || report.scope?.split(':').at(-1)!==anchor || report.asOf>now || now-report.asOf>30000)return null;
 const n=v=>Number.isFinite(v)?v:null;
 const row=r=>r?{status:r.status,point:n(r.point),low:n(r.low),high:n(r.high),unit:r.unit,horizonMinutes:n(r.horizonMinutes),sampleSize:n(r.sampleSize),calibration:r.calibration}:null;
 return {asOf:report.asOf,modelVersion:String(report.modelVersion).slice(0,80),revenue:row(report.revenue),month:{...row(report.month),kind:'scenario'},online:(report.online || []).slice(0,3).map(row),pk:report.pk?.status==='ready'?{status:'ready',probability:n(report.pk.probability),calibration:report.pk.calibration}:null,
  basis:'本机统计模型预测，和实测分开；尚未证明个人准确率，不代表官方收入、结算或必然胜负'};
}
