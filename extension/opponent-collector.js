import {roomFromURL} from '../src/browser/room-context.js';

const STATE_KEY='live-assistant:data-collectors';
const roomURL=value=>{try{const u=new URL(value);return u.origin==='https://live.douyin.com'?roomFromURL(u):null;}catch{return null;}};
const ownerRoom=sender=>{const room=roomURL(sender.tab?.url);if(sender.frameId!==0 || !Number.isInteger(sender.tab?.id) || !room || sender.url && roomURL(sender.url)!==room)throw Error('采集来源无效');return room;};

// Dedicated pages never boot automation. Session storage retains tab ownership
// across worker restarts; navigating a tab away relinquishes ownership.
export function createOpponentCollector(chrome){
 let tail=Promise.resolve();
 const serial=work=>{const task=tail.catch(()=>{}).then(work);tail=task;return task;};
 const read=async()=>chrome.storage.session?(await chrome.storage.session.get(STATE_KEY))[STATE_KEY] || {}:{};
 const write=state=>chrome.storage.session.set({[STATE_KEY]:state});
 const live=async row=>{try{return (await chrome.tabs.get(row.tabId)).url===row.url;}catch{return false;}};
 return {
  context:async sender=>{
   const room=ownerRoom(sender),state=await read(),row=state[sender.tab.id];
   return row && row.room===room?{readOnly:true,room,ownerRoom:row.ownerRoom}:null;
  },
  open:(sender,input)=>serial(async()=>{
   const owner=ownerRoom(sender),room=/^\d{1,30}$/.test(input)?input:roomURL(input);
   if(!room || room===owner)throw Error('请填写另一个有效抖音直播间号或链接');
   if(!chrome.storage.session)throw Error('当前浏览器不支持后台采集页归属');
   const state=await read();
   for(const [id,row] of Object.entries(state)){if(!await live(row))delete state[id];}
   const previous=Object.values(state).find(row=>row.ownerRoom===owner && row.room===room);
   if(previous)return previous;
   if(Object.keys(state).length>=3)throw Error('同时最多打开3个独立采集直播间，请先停止已有采集');
   const url=`https://live.douyin.com/${room}?assistant_data_collector=1`;
   const tab=await chrome.tabs.create({url,active:false});
   const row={tabId:tab.id,url,room,ownerRoom:owner,openedAt:Date.now()};state[tab.id]=row;
   try{await write(state);}catch(error){await chrome.tabs.remove(tab.id);throw error;}
   return row;
  }),
  list:async sender=>{const owner=ownerRoom(sender);return Object.values(await read()).filter(r=>r.ownerRoom===owner);},
  stop:sender=>serial(async()=>{
   const owner=ownerRoom(sender),state=await read();
   for(const [id,row] of Object.entries(state))if(row.ownerRoom===owner){if(await live(row))await chrome.tabs.remove(row.tabId);delete state[id];}
   await write(state);return true;
  })
 };
}
