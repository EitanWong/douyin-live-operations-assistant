import {installTheme} from './theme.js';
const status=document.querySelector('#access-status'),list=document.querySelector('#access-services'),allow=document.querySelector('#access-allow'),cancel=document.querySelector('#access-cancel');
let services=[],busy=false,heartbeat;
const theme=installTheme({target:document.documentElement,select:document.querySelector('[data-theme-choice]'),onError:error=>{status.textContent=error;}});
const call=async message=>{const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw Error(result?.error || '服务授权暂不可用，请返回直播间重试');return result.value;};
const render=rows=>{
 services=rows;list.replaceChildren(...rows.map(row=>{const item=document.createElement('li');item.textContent=`${row.label}：${row.origin}`;return item;}));
 allow.disabled=busy || !rows.length;cancel.disabled=busy || !rows.some(row=>row.waiting);
 if(rows.some(row=>row.waiting))heartbeat ||= setInterval(()=>{void call({type:'service-access-state'}).catch(()=>{});},15000);
 else{clearInterval(heartbeat);heartbeat=undefined;}
};
const refresh=async()=>{
 if(busy)return;
 try{const value=await call({type:'service-access-state'});render(value.services);status.textContent=services.length ? '刚才的操作需要访问以下服务，请确认授权。' : '当前没有等待授权的服务，可返回直播间继续操作。';}
 catch(error){status.textContent=error.message;allow.disabled=true;}
};
allow.addEventListener('click',async()=>{
 if(busy || !services.length)return;
 const patterns=services.map(row=>row.pattern);busy=true;allow.disabled=true;cancel.disabled=true;
 try{
  // Chrome requires the permission request in this button's synchronous click stack.
  const allowed=await chrome.permissions.request({origins:patterns});
  const value=await call({type:'service-access-complete',patterns});render(value.services);
  status.textContent=allowed ? '已授权，等待中的请求会自动继续。返回直播间即可查看结果。' : '暂未授权，本次请求未发送，原输入保留。可点击上方按钮重新授权。';
 }catch(error){status.textContent=error.message;}
 finally{busy=false;render(services);}
});
cancel.addEventListener('click',async()=>{
 try{const value=await call({type:'service-access-cancel'});render(value.services);status.textContent='已取消本次授权，原输入保留。需要时可点击“一键授权并继续”后重试。';}
 catch(error){status.textContent=error.message;}
});
const changed=message=>{if(message.type==='service-access-changed')void refresh();};
chrome.runtime.onMessage.addListener(changed);
window.addEventListener('pagehide',()=>{clearInterval(heartbeat);chrome.runtime.onMessage.removeListener(changed);theme?.destroy();},{once:true});
void refresh();
