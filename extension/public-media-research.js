import {accountSource} from '../src/ai/account-context.js';
import {subjectKeySchema} from '../src/ai/audience-profile.js';
import {parsePublicMediaSource} from '../src/services/public-media-source.js';
import {publicMediaEnabled as enabled,publicMediaVisualEnabled,publicMediaHasVisual} from '../src/services/public-media-config.js';

const profileURL=author=>`https://www.douyin.com/user/${author}`;
const bound=(profile,subject,author)=>Boolean(subjectKeySchema.safeParse(subject).success && profile?.binding && profile.binding.subject===subject && profile.binding.sources?.includes(profileURL(author)));

// Native SQLite owns jobs; the existing corpus owns text. This controller only
// bridges their acknowledgements and resolves identity from canonical memory.
export function createPublicMediaResearch({readConfig,resolveProfile,checkProfile,request,worker,knowledge,canArchive=async()=>true,readPrivacy=async()=>undefined,now=Date.now}){
 let tail=Promise.resolve(),scheduled=null,dirty=false;
 const serial=work=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
 const withWorker=async work=>{try{return await work();}finally{worker.release?.();}};
 const native=input=>request('public-media',input);
 const synchronize=async(room,anchor,job)=>{
  const config=await readConfig(room),profile=await resolveProfile({room,anchor,subject:job.subject,author:job.author,ai:config?.ai});
  const allowed=String(config?.anchorId)===anchor && enabled(config) && await canArchive() && bound(profile,job.subject,job.author);
  await native({operation:'sync',room,anchor,subject:job.subject,epoch:profile.epoch,allowed});
  return {profile,allowed};
 };
 const ingest=async(room,anchor,job,profile)=>{
  const version=await knowledge.handle(room,'version',{anchor});
  if(job.knowledgeVersion!==version){await native({operation:'cancel',room,anchor,job:job.id});return;}
  const offset=job.importCursor || 0,rows=await native({operation:'evidence',room,anchor,job:job.id,offset});
  if(!Array.isArray(rows) || rows.length>8)throw Error('原生作品证据分页无效');
  const at=job.updatedAt ?? job.createdAt;
  if(!Number.isFinite(at) || at>now())throw Error('原生作品证据时间无效');
  const sources=rows.filter(r=>['transcript','visual'].includes(r.kind) && typeof r.text==='string' && r.text.trim()).map(row=>({url:job.url,title:row.kind==='visual' ? '公开视频关键帧观察' : '公开视频音轨原文',
   text:JSON.stringify({workId:job.workId,author:job.author,subject:job.subject,mediaHash:job.mediaHash,analysisVersion:job.analysisVersion,kind:row.kind,startMs:row.startMs,endMs:row.endMs,speaker:'unknown',...(row.kind==='visual' ? {model:row.model} : {}),text:row.text}),
   at,expiresAt:at+180*86400000,evidenceKind:'public-media',coverage:row.kind==='visual' ? `单张关键帧 ${row.startMs}ms；全片有界间隔采样，不是连续视频；模型观察待核实，不证明人物身份、心理或帧外事件` : `完整音轨分段转录 ${row.startMs}–${row.endMs}ms；说话人未确认；视频画面${job.coverage.video==='sampled' ? '仅采样' : '未分析'}；机器转录待核实，不是作者本人自述证明` }));
  await checkProfile({room,anchor,subject:job.subject,binding:profile.binding});
  const current=await synchronize(room,anchor,job);
  if(!current.allowed || current.profile.epoch!==job.epoch)return;
  if(sources.length && !await knowledge.handle(room,'remember',{anchor,subject:job.subject,subjectEpoch:job.epoch,version,sources,lifetime:180*86400000}))return;
  await checkProfile({room,anchor,subject:job.subject,binding:profile.binding});
  await native({operation:'ack',room,anchor,job:job.id,cursor:offset+rows.length,complete:rows.length<8});
 };
 const wake=(room,selectedAnchor)=>withWorker(async()=>{
  const config=await readConfig(room),anchor=selectedAnchor ?? String(config?.anchorId || '');
  if(!/^\d{1,30}$/u.test(anchor))return;
  const privacy=await readPrivacy(room,anchor);
  if(privacy!==undefined)await native({operation:'reconcile',room,anchor,privacy:{present:Boolean(privacy),forgetBefore:privacy?.forgetBefore || 0,forgotten:privacy?.forgotten || []},allowed:String(config?.anchorId)===anchor && enabled(config) && await canArchive()});
  const jobs=await native({operation:'list',room,anchor});
  for(const job of jobs){
   if(publicMediaHasVisual(job) && !publicMediaVisualEnabled(config)){await native({operation:'cancel',room,anchor,job:job.id});continue;}
   const {profile,allowed}=await synchronize(room,anchor,job);
   if(!allowed || profile.epoch!==job.epoch || job.status!=='succeeded' || job.imported)continue;
   if(job.coverage?.audio!=='complete' || !/^[a-f0-9]{64}$/u.test(job.mediaHash || ''))continue;
   await ingest(room,anchor,job,profile);
  }
  if(String(config?.anchorId)===anchor && enabled(config) && await canArchive() && jobs.some(job=>['queued','paused'].includes(job.status)) && await worker.ready())await worker.run();
 });
 return {
  collect:input=>serial(()=>withWorker(async()=>{
   const {room,anchor,records,media=[]}=input,config=await readConfig(room);
   if(String(config?.anchorId)!==anchor || !enabled(config) || !await canArchive())return {submitted:0};
   if(!await worker.ready())return {submitted:0,error:'请更新本机组件以支持完整音轨任务'};
   let submitted=0;
   for(const work of records.filter(r=>r.kind==='work').slice(0,2)){
    let source;try{source=accountSource(work.url);}catch{continue;}
    if(source.url!==`https://www.douyin.com/video/${work.id}` || !/^\d{1,30}$/u.test(work.id))continue;
    const profile=await resolveProfile({room,anchor,author:work.subject,ai:config.ai}),subject=profile?.binding?.subject;
    if(!bound(profile,subject,work.subject))continue;
    const gate=await synchronize(room,anchor,{subject,author:work.subject});if(!gate.allowed)continue;
    const knowledgeVersion=await knowledge.handle(room,'version',{anchor});
    await checkProfile({room,anchor,subject,binding:profile.binding});
    const pageMedia=media.map(value=>parsePublicMediaSource(value,{workId:work.id,author:work.subject,subject,epoch:profile.epoch,now:now()})).find(Boolean);
    await native({operation:'submit',request:{room,anchor,subject,epoch:profile.epoch,author:work.subject,workId:work.id,url:source.url,knowledgeVersion,...(publicMediaVisualEnabled(config) ? {visualVersion:1} : {}),...(pageMedia ? {pageMedia} : {})}});submitted++;
   }
   if(submitted)await worker.run();return {submitted};
  })),
  wake:room=>serial(()=>wake(room)),
  wakeAll:()=>{
   dirty=true;if(scheduled)return scheduled;
   scheduled=serial(async()=>{do{dirty=false;let after;while(true){const scopes=await native({operation:'scopes',...(after ? {after} : {})});for(const scope of scopes)await wake(scope.room,scope.anchor);if(scopes.length<64)break;const last=scopes.at(-1);after=[last.room,last.anchor];}}while(dirty);}).finally(()=>{scheduled=null;});return scheduled;
  }
 };
}
