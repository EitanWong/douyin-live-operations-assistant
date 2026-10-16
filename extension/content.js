const room = location.pathname.match(/^\/(\d+)\/?$/)?.[1];
if (room) {
  // 面板初始化期间也必须完整保留事件；礼物、进场和弹幕统一按到达顺序回放。
  const events = []; let receive, panel, incomeChanged;
  // MAIN 观察器的数据只用于直播事件，没有任何密钥/网络请求/DOM发送命令。
  window.addEventListener('message', e => {
    const data = e.data;
    if (e.source !== window || e.origin !== location.origin || data?.source !== 'live-assistant-page-v1' || data.room !== room) return;
    if (data.type === 'event') {
      const event = data.event;
      if (!event || !['gift','like','chat','enter','end'].includes(event.type) || String(event.user?.name || '').length > 200 || String(event.text || '').length > 10000) return;
      if (receive) receive(event);
      else events.push(event);
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
  const journal = {
    append: event => message({type:'event-append',event}),
    pending: () => message({type:'event-list'}),
    ack: key => message({type:'event-ack',key}),
    ackMany: keys => message({type:'event-ack-many',keys})
  };
  chrome.runtime.onMessage.addListener((request,sender,reply) => {
    if (request.type === 'storage') { for (const [key,change] of Object.entries(request.changes)) { if (change.newValue === undefined) values.delete(key); else values.set(key,change.newValue); } }
    if (request.type === 'income-updated') incomeChanged?.();
    if (request.type === 'open-panel') { if (panel && !panel.open) panel.toggleOpen(); reply({ok:Boolean(panel)}); }
    if (request.type === 'room-info') reply({ ok:true, endpoint:panel?.readEndpoint?.() || panel?.config.ai.endpoint || '', ready:Boolean(panel) });
  });
  class ExtensionAdapter extends DouyinAdapter {
    constructor(options) { super(options); this.eventQueue = []; this.eventHead = 0; this.eventBusy = false; this.holdEvents = false; this.replayPromise = null; }
    dispatch(event) {
      const task = new Promise(resolve=>this.eventQueue.push({event,resolve}));
      void this.drainEvents();
      return task;
    }
    compactEvents() {
      if (!this.eventHead) return;
      if (this.eventHead === this.eventQueue.length) {
        this.eventQueue.length = 0; this.eventHead = 0;
      } else if (this.eventHead >= 1024 && this.eventHead * 2 >= this.eventQueue.length) {
        this.eventQueue = this.eventQueue.slice(this.eventHead); this.eventHead = 0;
      }
    }
    async drainEvents() {
      if (this.eventBusy || this.holdEvents) return;
      this.eventBusy = true;
      try {
        while (this.eventHead < this.eventQueue.length && !this.holdEvents) {
          const item = this.eventQueue[this.eventHead]; this.eventQueue[this.eventHead++] = null;
          const {event,resolve} = item;
        let attempt=0;
        while (true) {
          try { await this.onEvent(event); resolve(); this.compactEvents(); break; }
          catch (error) {
            attempt++;
            if (attempt===1 || attempt%5===0) this.onLog('error', `事件日志交接失败，第 ${attempt} 次重试：${error.message}`);
            await new Promise(resolve=>setTimeout(resolve,Math.min(5000,250*2**Math.min(attempt-1,5))));
          }
        }
        }
      } finally { this.eventBusy = false; this.compactEvents(); }
      if (this.eventHead < this.eventQueue.length && !this.holdEvents) void this.drainEvents();
    }
    async replayJournal() {
      if (this.replayPromise) return this.replayPromise;
      this.holdEvents = true;
      this.replayPromise = (async()=>{
        const records = await journal.pending(), replay = records.map(record=>({event:{...record.event,_journalKey:record.key},resolve:null}));
        const tasks = replay.map(item=>new Promise(resolve=>{item.resolve=resolve;}));
        this.eventQueue = replay.concat(this.eventQueue.slice(this.eventHead)); this.eventHead = 0;
        this.holdEvents = false; void this.drainEvents();
        await Promise.all(tasks);
      })().finally(()=>{this.holdEvents=false;this.replayPromise=null;void this.drainEvents();});
      return this.replayPromise;
    }
    hook() {
      // 单条业务事件异常只能记录诊断，不能中断握手回放或后续实时事件。
      receive = event => {
        if (event.type === 'chat') this.lastSocketChat = Date.now();
        void this.dispatch(event);
      };
      this.status = liveStatus; this.emitStatus();
      for (const event of events.splice(0)) receive(event);
      window.postMessage({source:'live-assistant-content-v1',type:'hello'},location.origin);
    }
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
  const repository = {
    profile: profile => message({ type:'income-profile', profile }),
    profiles: () => message({ type:'income-profiles' }),
    record: record => message({ type:'gift-record', ...record }),
    report: (room, month) => message({ type:'income-report', room, month })
  };
  boot({ page:window, get:(key,fallback)=>values.get(key) ?? fallback, set, del, request, repository, journal, adapterFactory:options=>new ExtensionAdapter(options), identityFactory:onIdentity=>new IdentityReader({page:window,room,onIdentity}), onReady:api=>{panel=api.panel; incomeChanged=api.refreshIncome; panel.readEndpoint=()=>panel.root.querySelector('[data-field="ai.endpoint"]').value;} });
}
