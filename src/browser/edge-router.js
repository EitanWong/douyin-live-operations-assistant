export function createEdgeRouter({browser,native,config}){
 const audio=(backend=config().audioBackend)=>backend==='native-sensevoice' ? native : browser;
 return {ready:kind=>kind==='text' ? browser?.ready(kind) || false : audio()?.ready(kind) || false,
  reply:(p,c)=>browser.reply(p,c),classify:(text,signal)=>{if(!browser?.classify)throw new Error('此浏览器未连接中文端侧模型');return browser.classify(text,signal);},transcribe:(sample,signal)=>audio().transcribe(sample,signal),
  prepare:(kind,backend)=>{const owner=kind==='text' ? browser : audio(backend);if(!owner)throw new Error('此端侧方案需要 Chrome 扩展与对应本地组件');return owner.prepare(kind);},
  status:async()=>({...await browser?.status(),...(config().audioBackend==='native-sensevoice' ? {audio:await native?.status() || {phase:'unprepared'}} : {})}),
  release:async()=>{native?.close();await browser?.release();},close:()=>{native?.close();browser?.close();}};
}
