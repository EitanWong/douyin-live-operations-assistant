// Reuse the live page's loaded HTTP client so its session and request interceptors
// remain in charge. No cookies, signatures, remote code, or paid endpoints cross
// the extension bridge.
export class PageRequestSender {
  constructor(page) { this.page = page; this.tickets = new Map(); }
  client() {
    const chunks = this.page.webpackChunkdouyin_live_v2;
    if (!Array.isArray(chunks) || !Object.hasOwn(chunks, 'push')) return null;
    if (this.loadedChunks === chunks && this.loadedClient) return this.loadedClient;
    let require;
    const chunk = `live_assistant_request_${this.page.crypto.randomUUID()}`;
    chunks.push([[chunk], {}, value => { require = value; }]);
    if (!require?.m) return null;
    const modules = Object.entries(require.m).filter(([,factory]) => {
      const source = Function.prototype.toString.call(factory);
      return source.includes('API_DOMAIN') && source.includes('interceptors.request.use') && source.includes('/webcast/privilege/subscribe');
    });
    if (modules.length !== 1) return null;
    const exports = require(modules[0][0]);
    const clients = Object.values(exports).filter(value => typeof value?.request === 'function' && value.defaults?.withCredentials === true);
    // The page also exports a secondary client. Select only its default client,
    // which owns security initialization and the normal response handling.
    const client = exports.ZP;
    if (!clients.includes(client)) return null;
    try { if (new URL(client.defaults.baseURL, this.page.location.href).origin !== this.page.location.origin) return null; }
    catch { return null; }
    this.loadedChunks = chunks; this.loadedClient = client;
    return client;
  }
  context() {
    const info = this.page.__STORE__?.roomStore?.roomInfo;
    const room = info?.room;
    const webRid = String(room?.web_rid || info?.web_rid || info?.webRid || '');
    const id = info?.roomId || room?.id_str;
    if (!/^\d+$/.test(id || '') || typeof id !== 'string' || webRid !== this.page.location.pathname.match(/^\/(\d+)\/?$/)?.[1]) return null;
    const user = this.page.__STORE__?.userStore?.userInfo;
    return {roomId:id, path:this.page.location.pathname, userId:user?.id_str, admin:[true,1].includes(user?.user_attr?.is_admin)};
  }
  prepare(channel) {
    if (!['chat','admin'].includes(channel)) return {available:false};
    try {
      const context = this.context(), client = context && this.client();
      if (!client || typeof context.userId !== 'string' || !/^\d+$/.test(context.userId)) return {available:false};
      if (channel === 'admin' && !context.admin) return {available:false};
      const now = Date.now();
      for (const [id,ticket] of this.tickets) if (now-ticket.at > 300000) this.tickets.delete(id);
      if (this.tickets.size >= 128) return {available:false};
      const token = this.page.crypto.randomUUID();
      this.tickets.set(token, {context,client,channel,at:now});
      return {available:true,token};
    } catch { return {available:false}; }
  }
  commit(token, text) {
    const ticket = this.tickets.get(token);
    if (!ticket) return Promise.resolve({submitted:false,reason:'请求准备已失效'});
    if (ticket.result) return ticket.result; // A duplicate bridge delivery never sends twice.
    ticket.result = this.perform(ticket,text);
    return ticket.result;
  }
  async perform(ticket,text) {
    const current = this.context();
    if (!current || current.path !== ticket.context.path || current.roomId !== ticket.context.roomId || current.userId !== ticket.context.userId || Date.now()-ticket.at > 10000) return {submitted:false,reason:'房间、账号或请求准备已变更'};
    if (typeof text !== 'string' || !text.trim() || [...text].length > 50) return {submitted:false,reason:'消息长度无效'};
    if (ticket.channel === 'admin' && !current.admin) return {submitted:false,reason:'管理员身份已变更'};
    const params = {room_id:current.roomId,content:text};
    const admin = ticket.channel === 'admin';
    if (!admin) params.type = 0;
    // These are navigation context fields, not authentication material.
    const query = new URL(this.page.location.href).searchParams;
    if (admin) {
      params.enter_source = query.get('enter_from_merge') || '';
      params.request_id = query.get('request_id') || '';
    }
    const result = {clicked:true,transport:'request',channelUsed:ticket.channel};
    try {
      const response = await ticket.client.request({url:admin?'/webcast/screen_chat/':'/webcast/room/chat/',method:admin?'post':'get',params,timeout:8000});
      const data = response?.data;
      if (data?.status_code === 0) return {...result,submitted:true};
      if (Number.isInteger(data?.status_code)) return {...result,submitted:false,failed:true,reason:`平台拒绝请求（${data.status_code}）：${String(data.data?.prompts || data.data?.message || '').slice(0,160)}`};
      return {...result,submitted:false,reason:'请求响应无法确认，等待公屏回显，不自动重发'};
    } catch {
      return {...result,submitted:false,reason:'请求结果未知，等待公屏回显，不自动重发'};
    }
  }
}

export class RequestBridgeClient {
  constructor(page) { this.page=page; this.room=page.location.pathname.match(/^\/(\d+)\/?$/)?.[1]; }
  call(operation, payload, timeout) {
    return new Promise(resolve=>{
      const id=this.page.crypto.randomUUID();
      const finish = result => { this.page.clearTimeout(timer); this.page.removeEventListener('message',receive); resolve(result); };
      const receive = event => {
        const data=event.data;
        if(event.source===this.page && event.origin===this.page.location.origin && data?.source==='live-assistant-page-v1' && data.type==='send-api-result' && data.room===this.room && data.id===id) finish(data.result);
      };
      const timer=this.page.setTimeout(()=>finish(operation==='prepare'?{available:false}:{submitted:false,clicked:true,transport:'request',reason:'请求响应超时，等待公屏回显，不自动重发'}),timeout);
      this.page.addEventListener('message',receive);
      this.page.postMessage({source:'live-assistant-content-v1',type:'send-api',room:this.room,id,operation,...payload},this.page.location.origin);
    });
  }
  prepare(channel) { return this.call('prepare',{channel},800); }
  commit(token,text) { return this.call('commit',{token,text},10000); }
}
