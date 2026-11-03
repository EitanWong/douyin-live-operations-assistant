import {predictionView} from './view.js';
export const predictionsTool={id:'predictions',embeddedIn:'anchor',label:'预测分析',icon:'chart-no-axes-combined',version:'1.0.0',timeoutMs:60000,apiVersion:1,capabilities:[],view:predictionView,
 mount(ctx){
  const client=ctx.services.predictions;let report=null,ai=null,last=0,busy=false,lastScope='',analysis;client?.resume?.();
  const publish=()=>ctx.publish({report,ai});
  const refresh=async()=>{if(!client){ctx.publish({reason:'预测存储尚未连接'});return;}const scope=client.scope?.(),next=await client.report();report=scope===client.scope?.()?next:null;publish();};
  const mutate=async(action,value)=>{if(report?.scope && client.scope?.() && report.scope!==client.scope())throw new Error('主播已变化，请刷新当前分析后操作');const result=await client.call(action,value);ai=null;await refresh();return result;};
  return {actions:{refresh,settings:v=>mutate('settings',v),import:v=>mutate('import',v),forget:v=>mutate('forget',v),clear:()=>mutate('clear'),export:()=>client.call('export'),
   demo:()=>{if(!ctx.services.demo)throw new Error('仅演示页支持模拟数据');return mutate('demo');},
   analyze:async()=>{if(!ctx.services.predictionAI)throw new Error('请先在AI设置中准备本地中文模型');await refresh();const scope=client.scope?.();analysis?.abort();analysis=new AbortController();const result=await ctx.services.predictionAI(report?.samples || [],analysis.signal);if(scope!==client.scope?.())return;ai=result;publish();}},
   tick:async()=>{if(!client || busy)return;const current=client.scope?.() || '';if(current!==lastScope){lastScope=current;last=0;analysis?.abort();report=null;ai=null;publish();}if(Date.now()-last<15000)return;busy=true;last=Date.now();try{await refresh();}finally{busy=false;}},dispose:()=>{analysis?.abort();client?.pause?.();report=null;ai=null;}};
 }
};
