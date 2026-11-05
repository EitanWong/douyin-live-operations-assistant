import {calculateQuestion} from '../services/question-math.js';

const normalize=text=>String(text || '').replace(/^\s*@\S+\s*/u,'').replace(/[\s？?。！!，,]/gu,'');
const publicQuestion=text=>/(?:大家|公屏|场控|你们)/u.test(text) && /[？?]|吗|么|多少|怎么|如何/u.test(text);
export function offlineReply({event,task,config,liveContext,unavailable=false}){
 if(task.kind!=='ai' || !event?.text || task.data?.addressedToOther)return null;
 const text=normalize(event.text),direct=task.data?.replyMode==='direct';
 if(event.type==='speech'){
  if(!unavailable || !publicQuestion(event.text))return null;
  return {text:/听得[见到]|听得到|有声音/u.test(text) ? '这段语音已经收到了。' : '提问已收到，AI 暂时不可用，还不能确认。'};
 }
 if(event.type!=='chat')return null;
 if(!direct && config.ai.replyFrequency!=='every')return null;
 const calculation=calculateQuestion(event.text);
 if(calculation)return {text:calculation.answer,shortText:'结果过长，请拆分。'};
 if(!unavailable)return null;
 if(/^(?:场控)?(?:在吗|在不在|你好|您好|嗨|哈喽|hello)$/iu.test(text))return {text:'在的，你好！'};
 const income=liveContext?.income,audience=liveContext?.audience;
 if(/^(?:现在|当前)?(?:在线|直播间)(?:有)?多少人(?:在线)?$/u.test(text))return {text:config.ai.contextSources.audience!==false && audience && !audience.stale && Number.isFinite(audience.online) ? `当前已采集在线${audience.online}人。` : '当前在线人数尚未采集，暂时无法确认。',usesLiveFacts:true,shortText:'请查看在线人数。'};
 if(/^(?:本场|这场)(?:直播)?(?:收了|收到|收获|有)?多少钻石$/u.test(text))return {text:config.ai.contextSources.income!==false && income && !income.stale && Number.isFinite(income.totalDiamonds) ? `本场已采集${income.totalDiamonds}钻${income.pending>0 ? '，还有待入账' : ''}。` : '本场钻石账本尚不可用，暂时无法确认。',usesLiveFacts:true,shortText:'请查看本场账本。'};
 return {text:'AI 暂时不可用，这个问题还不能确认。'};
}
