import {MINUTE,DAY} from './schema.js';
import {analyzeChat,updateChatModel} from './semantics.js';
import {learnGift} from './math.js';
// Fixtures enter only the explicitly selected demo scope. Every subsequent
// report/export retains the simulated flag; real rooms have no seed route.
export async function seedPredictionDemo(archive,context,now){
 if(context.room!=='demo')throw new Error('模拟数据不能写入真实直播间');
 await archive.clear(context,now);const scope=`demo:${context.anchor}`,sessionKey=`${scope}:simulated`,startAt=Math.floor(now/MINUTE)*MINUTE-20*MINUTE;
 await archive.transaction(async()=>{
  let diamonds=0;const minutes=[];
  for(let i=0;i<20;i++){
   const at=startAt+i*MINUTE,value=180+(i%5)*65;diamonds+=value;const m=await archive.minute(scope,at),sem=analyzeChat('我来送个礼物支持你');
   Object.assign(m,{sessionId:sessionKey,coverageMs:MINUTE,ranges:[[at,at+MINUTE]],cash:[{at:at+10000,diamonds:value,unknown:0}],diamonds:value,giftGroups:3,giftUnits:3,amounts:[20,60,value-80],online:180+i*3+(i%3)*10,onlineAt:at+50000,chats:12,intents:{support:2,question:4,other:6},topics:{gift:3,pk:4,other:5},emotions:{uncertain:10,positive:2},samples:[{at:at+50000,userId:'uid:900',text:'我来送个礼物支持你',...sem}]});minutes.push(m);
  }
  await archive.db.minutes.bulkPut(minutes);
  const session={key:sessionKey,scope,startAt,endAt:0,startKnown:true,complete:false,coverageMs:20*MINUTE,diamonds,giftGroups:60,giftUnits:60,unknownCount:0};
  await archive.db.sessions.put(session);
  for(let i=1;i<=8;i++)await archive.db.sessions.put({...session,key:`${scope}:past:${i}`,startAt:now-i*DAY-3600000,endAt:now-i*DAY,diamonds:12000+i*1500,coverageMs:3600000,complete:true});
  for(let i=0;i<12;i++)await archive.db.users.put({key:`${scope}:uid:${900+i}`,scope,userId:`uid:${900+i}`,name:`模拟观众 ${i+1}`,lastAt:now-1000,diamonds:i*200,giftGroups:i,chats:4+i,sessionId:sessionKey,sessionDiamonds:i*200,sessionGiftGroups:i,lastGiftAt:now-60000,giftTimes:[],intent:i%3?'other':'support'});
  let model={trials:0,positives:0,weights:Array(6).fill(0),brier:0};for(let i=0;i<120;i++)model=learnGift(model,[1,.5,i%2,.4,i%3?0:1,1],Number(i%4===0));
  const meta=await archive.metadata(scope);for(let i=0;i<100;i++)meta.chatModel=updateChatModel(meta.chatModel,i%3?'question':'support',now-100000+i*1000);Object.assign(meta,{sessionKey,lastPulse:now,connected:true,model,simulated:true,pk:{key:'simulated-pk',phase:'active',remainingMs:60000,competitors:[{anchorId:context.anchor,name:'模拟本方',isSelf:true,score:1200,scoreObserved:true,scoreAgeMs:0},{anchorId:'999',name:'模拟对手',isSelf:false,score:1000,scoreObserved:true,scoreAgeMs:0}],trend:Array.from({length:5},(_,i)=>({at:now-(4-i)*5000,competitorScores:{[context.anchor]:800+i*100,'999':700+i*75}})),dataQuality:{stale:false}}});await archive.db.meta.put(meta);
  for(let i=0;i<20;i++)await archive.db.outcomes.put({key:`${scope}:pk:${i}`,scope,battleKey:`simulated-${i}`,scoreFinal:true,endedAt:now-i*DAY,outcome:i%3?'win':'loss'});
 });
 await archive.importHistory(context,[{month:'2026-10',diamonds:220000,hours:80,grade:'黄金',category:'聊天',source:'模拟参考数据',kind:'self'},{month:'2026-09',diamonds:180000,hours:80,grade:'黄金',category:'聊天',source:'模拟参考数据',kind:'self'},{month:'2026-08',diamonds:200000,hours:80,grade:'黄金',category:'聊天',source:'模拟参考数据',kind:'self'}]);
 const settings=await archive.settings(context);await archive.configure(context,{...settings,grade:'黄金',category:'聊天',rankRules:{points:80,promotionPoints:100,winPoints:10,lossPoints:5,plannedBattles:20,source:'模拟赛季规则'}});return true;
}
