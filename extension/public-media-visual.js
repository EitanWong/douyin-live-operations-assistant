import {z} from 'zod';
import {subjectKeySchema} from '../src/ai/audience-profile.js';
import {resolveMediaConfig} from '../src/services/ai-pipeline.js';
import {publicMediaVisualEnabled,publicMediaHasVisual} from '../src/services/public-media-config.js';

const decimal=z.string().regex(/^\d{1,30}$/u),hash=z.string().regex(/^[a-f0-9]{64}$/u),time=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const inputSchema=z.strictObject({job:z.strictObject({id:hash,room:decimal,anchor:decimal,subject:subjectKeySchema,epoch:time,workId:decimal,author:z.string().regex(/^[A-Za-z0-9_-]{8,160}$/u),mediaHash:hash,analysisVersion:z.literal('sensevoice-v1+keyframes-v1'),knowledgeVersion:time}),frame:z.strictObject({atMs:time.max(10800000-1),data:z.string().min(8).max(48000).regex(/^[A-Za-z0-9+/]+=*$/u)})});

export function createPublicMediaVisualAnalyzer({readConfig,resolveProfile,checkProfile,recognize,readVersion,canArchive=()=>true,backgroundAllowed=()=>true}){
 return async(input,{signal}={})=>{
  const {job,frame}=inputSchema.parse(input);
  const current=async()=>{
   if(signal?.aborted || !backgroundAllowed() || !await canArchive())throw Error('作品视觉分析已停止');
   const config=await readConfig(job.room);
   if(String(config?.anchorId)!==job.anchor || !publicMediaVisualEnabled(config) || !publicMediaHasVisual(job))throw Error('作品视觉分析未开启');
   const profile=await resolveProfile({room:job.room,anchor:job.anchor,subject:job.subject,author:job.author,ai:config.ai});
   if(profile?.epoch!==job.epoch || profile.binding?.subject!==job.subject || !profile.binding.sources?.includes(`https://www.douyin.com/user/${job.author}`) || await readVersion(job.room,job.anchor)!==job.knowledgeVersion)throw Error('作品身份或知识库已变化');
   await checkProfile({room:job.room,anchor:job.anchor,subject:job.subject,binding:profile.binding});
   return resolveMediaConfig(config.ai);
  };
  const config=await current(),signature=JSON.stringify(config);
  const result=await recognize({kind:'video',at:frame.atMs,endedAt:frame.atMs,data:`data:image/jpeg;base64,${frame.data}`,inputSource:'public-work'},config,{signal});
  if(JSON.stringify(await current())!==signature || signal?.aborted)throw Error('作品视觉配置已变化');
  const text=typeof result?.text==='string' ? Array.from(result.text.trim().replace(/[\uD800-\uDFFF]/gu,'\uFFFD')).slice(0,1200).join('') : '';
  return {text:['[UNKNOWN]','[SILENCE]'].includes(text) ? '' : text,model:config.visionModel};
 };
}
