const room = location.pathname.match(/^\/(\d+)\/?$/)?.[1];
if (room) {
  const events = []; let receive, panel;
  // MAIN 观察器的数据只用于直播事件，没有任何密钥/网络请求/DOM发送命令。
  window.addEventListener('message', e => {
    const data = e.data;
    if (e.source !== window || e.origin !== location.origin || data?.source !== 'live-assistant-page-v1' || data.room !== room) return;
    if (data.type === 'event') {
      const event = data.event;
      if (!event || !['gift','chat','enter','end'].includes(event.type) || String(event.user?.name || '').length > 200 || String(event.text || '').length > 10000) return;
      if (receive) receive(event); else if (events.length < 100) events.push(event);
    }
    if (data.type === 'status' && data.status) liveStatus = { ...data.status };
  });
  let liveStatus = { hook:false, sockets:0, frames:0, events:0, errors:0, connected:false, lastFrame:0 };
  const message = async payload => {
    const result = await chrome.runtime.sendMessage(payload);
    if (!result?.ok) throw new Error(result?.error || '扩展后台暂不可用，请刷新页面');
    return result.value;
  };
  const values = new Map(Object.entries(await message({ type:'init' })));
  let writes = Promise.resolve();
  const write = (key,value,remove=false) => {
    const previous = values.get(key); if (remove) values.delete(key); else values.set(key,value);
    const task = writes.catch(()=>{}).then(()=>message({type:remove?'delete':'set',key,value})).catch(error=>{
      if (previous === undefined) values.delete(key); else values.set(key,previous);
      panel?.log('error',`保存失败：${error.message}`); throw error;
    });
    writes=task; void task.catch(()=>{}); return task;
  };
  const set = (key,value) => write(key,value);
  const del = key => write(key,undefined,true);
  chrome.runtime.onMessage.addListener((request,sender,reply) => {
    if (request.type === 'storage') { for (const [key,change] of Object.entries(request.changes)) { if (change.newValue === undefined) values.delete(key); else values.set(key,change.newValue); } }
    if (request.type === 'open-panel') { if (panel && !panel.open) panel.toggleOpen(); reply({ok:Boolean(panel)}); }
    if (request.type === 'room-info') reply({ ok:true, endpoint:panel?.readEndpoint?.() || panel?.config.ai.endpoint || '', ready:Boolean(panel) });
  });
  class ExtensionAdapter extends DouyinAdapter {
    hook() { receive = event => { if (event.type === 'chat') this.lastSocketChat = Date.now(); this.onEvent(event); }; this.status = liveStatus; this.emitStatus(); for (const event of events.splice(0)) receive(event); window.postMessage({source:'live-assistant-content-v1',type:'hello'},location.origin); }
    sync() { this.status = liveStatus; this.emitStatus(); }
  }
  const request = details => {
    void (async()=>{
      try {
        await writes;
        const response = await message({type:'ai',url:details.url,headers:details.headers,data:details.data});
        details.onload(response);
      } catch (e) { details.onload({status:0,responseText:'',error:e.message}); }
    })();
  };
  boot({ page:window, get:(key,fallback)=>values.get(key) ?? fallback, set, del, request, adapterFactory:options=>new ExtensionAdapter(options), identityFactory:onIdentity=>new IdentityReader({page:window,room,onIdentity}), onReady:api=>{panel=api.panel; panel.readEndpoint=()=>panel.root.querySelector('[data-field="ai.endpoint"]').value;} });
}
