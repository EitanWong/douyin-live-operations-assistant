// Textual cues, not a diagnosis or a claim about the speaker's inner state.
const decline=/(?:不|别|没钱|无法|不能|不再|不会).{0,5}(?:刷|送|消费|打赏|礼物)|(?:刷|送).{0,3}(?:不了|不起)/u;
const support=/(?:我来|我要|我会|准备|给你|帮你).{0,8}(?:送.{0,3}礼物|刷.{0,3}礼物|上票|支持)|(?:送个|送点|送一).{0,4}礼物/u;
const topics=[['gift',/礼物|上票|打赏|刷钱/u],['pk',/PK|pk|比分|对面|偷塔/u],['schedule',/几点|下播|开播|明天/u],['content',/唱歌|跳舞|游戏|故事|音乐/u]];
export function analyzeChat(text){
 const s=String(text || '').slice(0,500),no=decline.test(s),yes=!no && support.test(s);
 const intent=no?'decline':yes?'support':/再见|先走了|睡觉了/u.test(s)?'leave':/[?？]|怎么|为什么|多少/u.test(s)?'question':'other';
 const emotion=/生气|失望|难过|不开心|太差/u.test(s)?'negative':/好开心|太棒|真好听|喜欢这个/u.test(s)?'positive':'uncertain';
 return {intent,emotion,giftIntent:yes,topic:topics.find(([,rule])=>rule.test(s))?.[0] || 'other',method:'local-rules',basis:'仅根据公开文本线索；含反讽或上下文缺失时可能误判'};
}
export function semanticSummary(minutes){
 const intents={},topics={},emotions={};
 for(const m of minutes)for(const [target,values] of [[intents,m.intents],[topics,m.topics],[emotions,m.emotions]])for(const [key,n] of Object.entries(values || {}))target[key]=(target[key] || 0)+n;
 const n=Object.values(intents).reduce((a,b)=>a+b,0);
 return {sampleSize:n,intents,topics,emotions,method:'local-rules',nextIntent:n>=20 ? Object.entries(intents).map(([intent,count])=>({intent,probability:count/n})).sort((a,b)=>b.probability-a.probability):[],
  basis:'最近10分钟已观察弹幕的经验意图分布；是下一短窗的基线，未经时序校准，不预测原话或真实心理'};
}

const intentLabels=['support','decline','leave','question','other'];
export function nextChatIntent(model){
 if(!model || model.total<20 || !model.last)return [];
 const row=model.counts[model.last] || {},n=Object.values(row).reduce((a,b)=>a+b,0);
 if(n<5)return [];
 return intentLabels.map(intent=>({intent,probability:((row[intent] || 0)+1)/(n+intentLabels.length)})).sort((a,b)=>b.probability-a.probability);
}
export function updateChatModel(input,intent,at){
 const model=input || {counts:{},last:null,lastAt:0,total:0,scored:0,logLoss:0};
 if(at<model.lastAt)return model;
 const prior=at-model.lastAt<=300000?model.last:null;
 if(prior){
  const predictions=nextChatIntent(model),p=predictions.find(row=>row.intent===intent)?.probability;
  if(p!=null){model.scored++;model.logLoss-=Math.log(Math.max(1e-9,p));}
  const row=model.counts[prior] ||= {};row[intent]=(row[intent] || 0)+1;
 }
 model.total++;model.last=intent;model.lastAt=at;return model;
}
