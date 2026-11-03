import {PredictionService} from '../src/analytics/service.js';

// The caller supplies a room derived from the verified top-frame sender URL.
// Content cannot choose another room or a previously visited anchor.
export function createPredictionBackground({readRecord,service=new PredictionService()}={}){
 return {async handle(message,room){
  if(!['event','pulse','report','settings','import','export','forget','clear'].includes(message.action) || JSON.stringify(message).length>800000)throw new Error('预测请求无效或过大');
  const config=await readRecord(`live-assistant:config:${room}`);
  if(!config?.anchorId || String(config.anchorId)!==message.anchor)throw new Error('预测主播范围已变化，请识别并保存当前主播');
  return service.call({room,anchor:message.anchor},message.action,message.value);
 },close:()=>service.close()};
}
