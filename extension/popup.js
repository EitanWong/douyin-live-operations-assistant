let tab;
const status=document.querySelector('#status'),open=document.querySelector('#open'),endpoint=document.querySelector('#endpoint');
open.disabled=true;
void(async()=>{
  [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if (!/^https:\/\/live\.douyin\.com\/\d+/.test(tab?.url || '')) { status.textContent='请先打开一个抖音直播间。'; return; }
  try {
    const result=await chrome.tabs.sendMessage(tab.id,{type:'room-info'});
    if (!result?.ready) throw new Error();
    endpoint.value=result.endpoint; status.textContent='直播间已就绪，点击下方打开面板。'; open.disabled=false;
  } catch {status.textContent='扩展已安装，请刷新直播页再打开面板。';}
})();
open.addEventListener('click',async()=>{try{await chrome.tabs.sendMessage(tab.id,{type:'open-panel'});window.close();}catch{status.textContent='请刷新直播页后重试。';}});
document.querySelector('#allow').addEventListener('click',()=>{
  let url;try{url=new URL(endpoint.value);if(!['https:','http:'].includes(url.protocol) || (url.protocol==='http:' && !['localhost','127.0.0.1'].includes(url.hostname)))throw new Error();if(url.username||url.password||url.search||url.hash || !url.pathname.endsWith('/chat/completions'))throw new Error();}catch{status.textContent='请填写完整的 /chat/completions 接口地址；本地服务可用 HTTP。';return;}
  // 保持在用户点击的调用栈内申请可选权限。
  void chrome.permissions.request({origins:[`${url.protocol}//${url.hostname}/*`]}).then(allowed=>{status.textContent=allowed?'已授权，返回直播间测试 AI 连接。':'未授权，AI 服务暂不可访问。';}).catch(()=>{status.textContent='授权失败，请检查接口地址。';});
});
