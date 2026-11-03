import {replyProfile} from './turn-taking.js';
export {freshObservations,liveMoment,awaitingVisual} from './live-moment.js';
export const observationKey=row=>JSON.stringify([row.kind,row.id,row.at,row.endedAt,row.text]);
export const sceneKey=row=>row.text.trim().replace(/\s+/gu,' ');
export function proactiveMode(ai,quietMs){
  if(!ai.enabled || ['off','mentions'].includes(ai.replyFrequency))return null;
  if(ai.proactiveEnabled && quietMs>=replyProfile(ai).quiet)return 'scene';
  return ai.idleEnabled && ai.chatEnabled && quietMs>=ai.idleSec*1000 ? 'idle' : null;
}
