import { roomFromURL } from '../src/browser/room-context.js';

// The worker binds Chrome's execution result to the originating document.
// Window messages are never used as commands or as evidence of a result.
export async function accessPage(chrome,sender,command) {
  const room=roomFromURL(sender.url);
  if(sender.frameId!==0 || !Number.isInteger(sender.tab?.id) || typeof sender.documentId!=='string' ||
      !room || new URL(sender.url).origin!=='https://live.douyin.com' || room!==roomFromURL(sender.tab.url) ||
      !['drain','send-api','cancel','collection-pulse','collection-stop'].includes(command?.type) || JSON.stringify(command).length>10000) throw new Error('页面调用来源或参数无效');
  const results=await chrome.scripting.executeScript({target:{tabId:sender.tab.id,documentIds:[sender.documentId]},world:'MAIN',
    func:(room,command)=>{
      const url=new URL(location.href),current=url.pathname.match(/^\/(\d+)\/?$/)?.[1] || url.searchParams.get('room_id');
      if(current!==room)throw new Error('直播间已切换');
      const bridge=Object.getOwnPropertyDescriptor(window,'__douyinAssistantPageV2')?.value;
      if(!bridge || bridge.room!==room)throw new Error('页面采集器尚未就绪');
      return bridge.call(command);
    },args:[room,command]});
  const result=results.find(row=>row.documentId===sender.documentId);
  if(!result || result.error)throw new Error('页面调用失败或文档已失效');
  return result.result;
}
