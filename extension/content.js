const jsonBytes = value => {
  try { const text = JSON.stringify(value); return typeof text === 'string' ? text.length * 2 : null; }
  catch { return null; }
};
const room = location.pathname.match(/^\/(\d+)\/?$/)?.[1];
if (room) {
  // 面板初始化期间也必须完整保留事件；礼物、进场和弹幕统一按到达顺序回放。
  const events = []; let eventsBytes = 0, initialGaps = 0, receive, panel, incomeChanged, checkpoint;
  // MAIN 观察器的数据只用于直播事件，没有任何密钥/网络请求/DOM发送命令。
  window.addEventListener('message', e => {
    const data = e.data;
    if (e.source !== window || e.origin !== location.origin || data?.source !== 'live-assistant-page-v1' || data.room !== room) return;
    if (data.type === 'event') {
      const event = data.event;
      let valid = true;
      try { valid = Boolean(event) && ['gift','like','chat','enter','end','pk-start','pk-score','pk-end','pk-multiplier','pk-card','pk-contribution','pk-effect','room-state'].includes(event.type) && String(event.user?.name || '').length <= 200 && String(event.text || '').length <= 10000; }
      catch { valid = false; }
      if (!valid) return;
      if (receive) receive(event);
      else {
        const bytes = jsonBytes(event);
        if (bytes != null && events.length < 4096 && eventsBytes + bytes <= 8*1024*1024) { events.push(event); eventsBytes += bytes; }
        else initialGaps++;
      }
    }
    if (data.type === 'status' && data.status) liveStatus = { ...data.status };
  });
  let liveStatus = { hook:false, sockets:0, frames:0, events:0, errors:0, connected:false, lastFrame:0 };
  const message = async payload => {
    const result = await chrome.runtime.sendMessage(payload);
    if (!result?.ok) throw Object.assign(new Error(result?.error || '扩展后台暂不可用，请刷新页面'),{code:result?.code});
    return result.value;
  };
  const values = new Map(Object.entries(await message({ type:'init' })));
  let writes = Promise.resolve();
  const write = (key,value,remove=false) => {
    const previous = values.get(key); if (remove) values.delete(key); else values.set(key,value);
    const previousWrite = writes;
    const task = (async () => {
      try { await previousWrite; } catch {}
      try { return await message({type:remove?'delete':'set',key,value}); }
      catch (error) {
        if (previous === undefined) values.delete(key); else values.set(key,previous);
        panel?.log('error',`保存失败：${error.message}`); throw error;
      }
    })();
    writes=task; void task.catch(()=>{}); return task;
  };
  const set = (key,value) => write(key,value);
  const del = key => write(key,undefined,true);
  const journal = {
    append: (event,id) => message({type:'event-append',event,id}),
    pending: after => message({type:'event-list',after}),
    ack: key => message({type:'event-ack',key}),
    ackMany: keys => message({type:'event-ack-many',keys})
  };
  chrome.runtime.onMessage.addListener((request,sender,reply) => {
    if (request.type === 'prepare-reload') {
      void (async () => {
        try {
          if (!checkpoint) throw new Error('页面正在初始化');
          await checkpoint(); await writes; reply({ok:true});
        } catch (error) { reply({ok:false,error:error.message}); }
      })();
      return true;
    }
    if (request.type === 'storage') { for (const [key,change] of Object.entries(request.changes)) { if (change.newValue === undefined) values.delete(key); else values.set(key,change.newValue); } }
    if (request.type === 'income-updated') incomeChanged?.();
    if (request.type === 'open-panel') { if (panel && !panel.open) panel.toggleOpen(); reply({ok:Boolean(panel)}); }
    if (request.type === 'room-info') reply({ ok:true, endpoint:panel?.readEndpoint?.() || panel?.config.ai.endpoint || '', ready:Boolean(panel) });
  });
  class ExtensionAdapter extends DouyinAdapter {
    constructor(options) {
      super(options); this.replayPromise = null;
      this.inbox = new EventInbox({handle:event=>this.onEvent(event),onStatus:health=>{
        this.ingestion = health; this.sync();
        const paused = Boolean(this.replayPromise) || health.blocked || health.state === 'buffering';
        if (paused !== this.flowPaused) { this.flowPaused = paused; window.postMessage({source:'live-assistant-content-v1',room,type:'flow',paused},location.origin); }
      }});
    }
    get eventQueue() { return this.inbox.queue; }
    get eventHead() { return this.inbox.head; }
    restoreCollection(saved) {
      if (!saved) return;
      this.inbox.health.gaps = Number(saved.gaps) || 0; this.inbox.health.giftGaps = Number(saved.giftGaps) || 0;
      this.priorBridgeGaps = Number(saved.bridgeGaps) || 0; this.priorFrameGaps = Number(saved.frameGaps) || 0;
    }
    dispatch(event) {
      if (this.onEcho?.(event)) return Promise.resolve(true);
      event._journalId ||= crypto.randomUUID();
      if(event.type?.startsWith('pk-'))this.onPK?.(event);
      return this.inbox.admit(event);
    }
    compactEvents() { this.inbox.compact(); }
    drainEvents() { return this.inbox.drain(); }
    async replayJournal() {
      if (this.replayPromise) return this.replayPromise;
      this.replayPromise = (async()=>{
        let after;
        do {
          this.inbox.held = true;
          const records = await journal.pending(after);
          await this.inbox.whenIdle();
          const known = new Set([...this.inbox.queue.slice(this.inbox.head).filter(Boolean),...this.inbox.quarantine].map(item=>item.event._journalKey));
          // Recover durable work before a live head that may need more storage.
          // One reserved slot bounds memory without copying an entire page.
          for (const record of records) if (!known.has(record.key)) {
            const task = this.inbox.admit({...record.event,_journalKey:record.key,_journalSavedAt:record.savedAt},true);
            if (this.inbox.blocked) break;
            this.inbox.held = false; await this.inbox.drain(1); this.inbox.held = true;
            if (this.inbox.blocked || this.inbox.closed) break;
            await task;
          }
          if (this.inbox.blocked || records.length < 256) break;
          const last = records.at(-1); after = {savedAt:last.savedAt,key:last.key};
        } while (!this.inbox.closed);
      })().finally(()=>{this.inbox.held=false;this.replayPromise=null;this.inbox.emit();void this.inbox.drain();});
      return this.replayPromise;
    }
    async recoverEvents() {
      this.inbox.held = true; await this.inbox.whenIdle();
      this.inbox.recover(); await this.replayJournal();
    }
    async exportEvents() {
      const journalRecords = []; let after;
      for (;;) {
        const records = await journal.pending(after); journalRecords.push(...records);
        if (records.length < 256) break;
        const last = records.at(-1); after = {savedAt:last.savedAt,key:last.key};
      }
      return {...this.inbox.export(),journal:journalRecords};
    }
    async checkStorage() {
      this.storage = await message({type:'storage-status'}); this.sync(); return this.storage;
    }
    closeEvents() { this.inbox.close(); }
    hook() {
      receive = event => {
        if (event.type === 'chat') this.lastSocketChat = Date.now();
        void this.dispatch(event);
      };
      if (initialGaps) { this.inbox.health.gaps += initialGaps; this.inbox.health.reason = '初始化缓冲已满，存在采集缺口'; }
      this.sync();
      for (const event of events.splice(0)) receive(event); eventsBytes = 0;
      window.postMessage({source:'live-assistant-content-v1',type:'hello'},location.origin);
    }
    sync() { this.status = {...liveStatus,bridgeGaps:(this.priorBridgeGaps || 0)+(liveStatus.bridgeGaps || 0),frameGaps:(this.priorFrameGaps || 0)+(liveStatus.frameGaps || 0),ingestion:this.inbox.status(),storage:this.storage}; this.emitStatus(); }
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
    recordContribution: contribution => message({ type:'contribution-record', ...contribution }),
    report: (room, month) => message({ type:'income-report', room, month })
  };
  boot({ page:window, get:(key,fallback)=>values.get(key) ?? fallback, set, del, request, repository, journal, adapterFactory:options=>new ExtensionAdapter(options), identityFactory:onIdentity=>new IdentityReader({page:window,room,onIdentity}), onReady:api=>{panel=api.panel; incomeChanged=api.refreshIncome; checkpoint=api.checkpoint; panel.readEndpoint=()=>panel.root.querySelector('[data-field="ai.endpoint"]').value;} });
}
