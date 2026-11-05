export const SETUP_HOST='com.douyin_live_assistant.setup';
export async function requestNativeDeployment(chrome,action){
 if(!['start','status'].includes(action))throw new Error('安装操作无效');
 let result;
 try{result=await chrome.runtime.sendNativeMessage(SETUP_HOST,{action});}catch{
  if(action==='start')throw new Error('请先运行一次 npm run native:install 接入安装代理，之后可在此后台安装');
  return {phase:'unavailable',progress:{stage:'unavailable'}};
 }
 const state=result?.value;
 if(!state || !['unprepared','queued','running','ready','error','interrupted'].includes(state.phase))throw new Error('安装进度暂不可用，请稍后重试');
 const p=state.progress || {};
 return {id:state.id,phase:state.phase,updatedAt:state.updatedAt,error:state.phase==='error' ? '安装失败，请检查网络与磁盘后重试；已完成缓存会复用' : undefined,
  progress:{stage:String(p.stage || state.phase).slice(0,40),loaded:Number.isFinite(p.loaded) && p.loaded>=0 ? p.loaded : undefined,total:Number.isFinite(p.total) && p.total>0 ? p.total : undefined}};
}
