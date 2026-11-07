import {snapshotResearchContext} from '../ai/research-context.js';
// Explicit test runs use the background model without enabling live automation
// or saving tasks, knowledge or profile projections into the live workspace.
export function createPreviewResearch({request,getKey,getConfig,knowledge,relationships,readPublicPage}){
 return async({question,prompt,request:previewRequest=request})=>{
  const {createResearchAgent}=await import('../ai/agent.js');
  const config=getConfig(),agent=createResearchAgent({request:previewRequest,getKey,knowledge,relationships,readPublicPage,
   guard:async()=>{if(prompt.signal?.aborted || prompt.isCurrent && !prompt.isCurrent())throw Object.assign(Error('测试已取消'),{name:'AbortError'});}});
  const context=snapshotResearchContext(prompt);
  const anchor=/^\d{1,30}$/u.test(config.anchorId) ? config.anchorId : '0';
  return agent({id:crypto.randomUUID(),scope:`preview:${anchor}`,question,input:{anchor,ai:config.ai,context,sources:[]}},{signal:prompt.signal || new AbortController().signal,checkpoint:async()=>{}});
 };
}
