import {servicePermissionPattern} from './service-permissions.js';

// One coordinator owns permission waits for foreground requests and background Agents.
export function createServiceAccess(chrome,{waitMs=120000}={}){
 const pending=new Map(),declined=new Map();let opening,tabId;
 const notify=()=>{try{void Promise.resolve(chrome.runtime.sendMessage?.({type:'service-access-changed'})).catch(()=>{});}catch{}};
 const failure=row=>new Error(`${row.label}域名 ${row.origin} 尚未授权，请在授权页点击“一键授权并继续”，或点击扩展图标授权服务域名后重试`);
 const finish=(row,error)=>{
  if(error){declined.delete(row.pattern);declined.set(row.pattern,row);while(declined.size>32)declined.delete(declined.keys().next().value);}
  else declined.delete(row.pattern);
  for(const waiter of [...row.waiters])waiter.finish(error);
  notify();
 };
 const state=()=>[...new Map([...declined,...pending]).values()].map(({pattern,origin,label})=>({pattern,origin,label,waiting:pending.has(pattern)}));
 const complete=async(patterns,rejectMissing=true)=>{
  if(!Array.isArray(patterns) || patterns.length>32 || patterns.some(p=>typeof p!=='string'))throw Error('授权范围无效');
  let granted=0;
  for(const pattern of new Set(patterns)){
   const row=pending.get(pattern) || declined.get(pattern);if(!row)continue;
   if(await chrome.permissions.contains({origins:[pattern]})){granted++;finish(row);}
   else if(rejectMissing)finish(row,failure(row));
  }
  return {granted,services:state()};
 };
 const open=()=>opening ||= (async()=>{
  const url=chrome.runtime.getURL('service-access.html');
  const existing=(await chrome.tabs.query?.({url}))?.find(tab=>tab.url===url);
  const tab=existing || await chrome.tabs.create({url,active:true});
  tabId=tab.id;
 })().catch(error=>{opening=undefined;for(const row of [...pending.values()])finish(row,new Error(`无法打开服务授权页：${error.message}`));});
 const onAdded=()=>{void complete([...new Set([...pending.keys(),...declined.keys()])],false).catch(error=>{for(const row of [...pending.values()])finish(row,error);});};
 const onRemoved=id=>{
  if(id!==tabId)return;
  opening=undefined;tabId=undefined;
  for(const row of [...pending.values()])finish(row,new Error('已关闭服务授权页，本次请求未发送；重新授权后可重试'));
 };
 chrome.permissions.onAdded?.addListener(onAdded);chrome.tabs?.onRemoved?.addListener(onRemoved);
 return {
  async ensure(value,{signal,label='AI 服务'}={}){
   const url=new URL(value);
   if(url.username || url.password || !['https:','http:'].includes(url.protocol) || (url.protocol==='http:' && !['localhost','127.0.0.1'].includes(url.hostname)))throw Error('服务授权地址无效');
   const pattern=servicePermissionPattern(url),origin=url.origin;
   if(signal?.aborted)throw Error('请求已取消');
   if(await chrome.permissions.contains({origins:[pattern]}))return;
   if(signal?.aborted)throw Error('请求已取消');
   if(declined.has(pattern) || !chrome.tabs?.create || !chrome.runtime?.getURL)throw failure({origin,label});
   let row=pending.get(pattern);
   if(!row){if(pending.size>=32)throw Error('等待授权的服务过多，请先处理已有授权');row={pattern,origin,label,waiters:new Set()};pending.set(pattern,row);}
   return new Promise((resolve,reject)=>{
    let timer;
    const waiter={finish(error){clearTimeout(timer);signal?.removeEventListener('abort',abort);row.waiters.delete(waiter);if(!row.waiters.size)pending.delete(pattern);error ? reject(error) : resolve();}};
    const abort=()=>{waiter.finish(Error('请求已取消'));notify();};
    row.waiters.add(waiter);signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(row,Error('服务授权等待超时，本次请求未发送；授权后请重试')),waitMs);
    notify();void open();
   });
  },
  async handle(message){
   if(message.type==='service-access-state')return {services:state()};
   if(message.type==='service-access-complete')return complete(message.patterns);
   if(message.type==='service-access-cancel'){
    for(const row of [...pending.values()])finish(row,failure(row));
    return {services:state()};
   }
   throw Error('不支持的服务授权请求');
  },
  close(){chrome.permissions.onAdded?.removeListener(onAdded);chrome.tabs?.onRemoved?.removeListener(onRemoved);for(const row of [...pending.values()])finish(row,Error('服务授权已停止'));declined.clear();}
 };
}
