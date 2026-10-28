import { fanclubFrameContext, cleanFanclubSnapshot } from '../src/data/fanclub.js';
import { readFanclubMembers } from '../src/browser/fanclub.js';

const fanclubContext=fanclubFrameContext(location.href);
if (window!==window.top && fanclubContext) {
  let last='',lastAt=0,busy=false,serial=0;
  const poll=async()=>{
    if (busy || !chrome.runtime?.id) return;
    const data=readFanclubMembers(document),now=Date.now(),key=JSON.stringify(data);
    if (!data || key===last && now-lastAt<30000) return;
    busy=true;
    try {
      const snapshotId=`${now}-${++serial}`,chunks=Math.max(1,Math.ceil(data.members.length/10));
      for (let chunk=0;chunk<chunks;chunk++) {
        const event=cleanFanclubSnapshot({...fanclubContext,...data,receivedAt:now,snapshotId,chunk,chunks,
          totalRows:data.members.length,members:data.members.slice(chunk*10,chunk*10+10)});
        const result=await chrome.runtime.sendMessage({type:'fanclub-frame',event});
        if (!result?.ok) return;
      }
      last=key;lastAt=now;
    } catch { /* 扩展更新后保留原生页面，由新脚本重新采集。 */ }
    finally {busy=false;}
  };
  void poll();
  const timer=setInterval(()=>{void poll();},3000);
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
