import { RoomContext, roomMatchesStore, roomFromURL } from './room-context.js';
import { ModerationRequests } from './moderation-requests.js';
import { LikeRequests } from './like-requests.js';
import { LotteryRequests } from './lottery-requests.js';
// Reuse the live page's loaded HTTP client so its session and request interceptors
// remain in charge. No cookies, signatures, remote code, or paid endpoints cross
// the extension bridge.
export class PageRequestSender {
  constructor(page) { this.page = page; this.tickets = new Map(); this.moderation = new ModerationRequests(this); this.likes = new LikeRequests(this); this.lotteries = new LotteryRequests(this); }
  prepareLottery(lotteryId,options) { return this.lotteries.prepare(lotteryId,options); }
  commitLottery(token,options) { return this.lotteries.commit(token,options); }
  stopLottery(token) { return this.lotteries.stop(token); }
  prepareLike({signal} = {}) { return signal?.aborted ? {available:false} : this.likes.prepare(); }
  commitLike(token,count,sequence,{signal} = {}) { return this.likes.commit(token,count,sequence,signal); }
  stopLike(token) { return this.likes.stop(token); }
  prepareModeration(action,target) { return this.moderation.prepare(action,target); }
  commitModeration(token) { return this.moderation.commit(token); }
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
    const id = info?.roomId || room?.id_str;
    if (!/^\d+$/.test(id || '') || typeof id !== 'string' || !roomMatchesStore(info,this.page.location)) return null;
    const user = this.page.__STORE__?.userStore?.userInfo;
    return {roomId:id, path:roomFromURL(this.page.location), userId:user?.id_str, admin:[true,1].includes(user?.user_attr?.is_admin)};
  }
  chatDisplay() {
    const messages = this.page.__STORE__?.singletonStore?.message;
    return typeof messages?.queuePush === 'function' ? messages : null;
  }
  displayChat(data, text) {
    // The native page filters the current user's incoming ChatMessage and
    // displays the successful send response through its local IM queue instead.
    // Match its constructChatMsg shape; this local mock is NOT a delivery echo.
    const messages = this.chatDisplay();
    const msg_id_str = typeof data?.msg_id_str === 'string' ? data.msg_id_str
      : typeof data?.msg_id === 'string' ? data.msg_id : '';
    if (!messages || !/^\d+$/.test(msg_id_str) || data.content !== text || !data.user) return false;
    const {content, user, show_identity, identity_label, rtf_content_v2} = data;
    messages.queuePush({is_mock:true, method:'WebcastChatMessage', msg_id:msg_id_str,
      payload:{content, common:{msg_id:msg_id_str}, user, rtf_content_v2}, show_identity, identity_label});
    return true;
  }
  pruneTickets(now = Date.now()) {
    for (const [id,ticket] of this.tickets) if (now-ticket.at > 300000) this.tickets.delete(id);
  }
  available(channel = 'chat') {
    if (!['chat','admin'].includes(channel)) return false;
    try {
      this.pruneTickets();
      const context = this.context();
      return Boolean(context && typeof context.userId === 'string' && /^\d+$/.test(context.userId)
        && this.client() && (channel === 'admin' ? context.admin : this.chatDisplay()) && this.tickets.size < 128);
    } catch { return false; }
  }
  prepare(channel) {
    if (!['chat','admin'].includes(channel)) return {available:false};
    try {
      const context = this.context(), client = context && this.client();
      if (!client || typeof context.userId !== 'string' || !/^\d+$/.test(context.userId)) return {available:false};
      if (channel === 'admin' && !context.admin) return {available:false};
      // Fall back before submitting when we cannot complete the native chat UI
      // flow. Otherwise the server echo is deliberately hidden on this page.
      if (channel === 'chat' && !this.chatDisplay()) return {available:false};
      const now = Date.now();
      this.pruneTickets(now);
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
      if (data?.status_code === 0) {
        if (!admin) {
          let displayed = false;
          try { displayed = this.displayChat(data.data, text); } catch {}
          if (!displayed) return {...result,submitted:true,displayWarning:'平台已接受请求，但本页公屏更新失败；不自动重发'};
        }
        return {...result,submitted:true};
      }
      if (Number.isInteger(data?.status_code)) return {...result,submitted:false,failed:true,reason:`平台拒绝请求（${data.status_code}）：${String(data.data?.prompts || data.data?.message || '').slice(0,160)}`};
      return {...result,submitted:false,reason:'请求响应无法确认，等待公屏回显，不自动重发'};
    } catch {
      return {...result,submitted:false,reason:'请求结果未知，等待公屏回显，不自动重发'};
    }
  }
}

export class RequestBridgeClient {
  constructor(page,send=payload=>page.chrome.runtime.sendMessage(payload)) { this.page=page;this.send=send;this.context=new RoomContext(page);this.room=this.context.room; }
  async call(operation,payload,timeout,{signal}={}) {
    const unavailable=()=>operation.startsWith('prepare')?{available:false}:{submitted:false,unknown:true,clicked:true,transport:'request',reason:'请求结果未知，已停止，不自动重试'};
    if(!this.context.current() || signal?.aborted)return operation.startsWith('prepare')?{available:false}:{submitted:false};
    const id=this.page.crypto.randomUUID();
    let canceled=false;
    const cancel=async()=>{canceled=true;try {await this.send({type:'page-command',command:{type:'cancel',id}});}catch {}};
    signal?.addEventListener('abort',cancel,{once:true});
    const timer=this.page.setTimeout(cancel,timeout);
    try {
      // Await the actual injected request, including after cancellation. Unknown
      // in-flight work continues to block unsafe replacement in the tool host.
      const result=await this.send({type:'page-command',command:{type:'send-api',id,operation,...payload}});
      if(canceled && operation.startsWith('prepare')) {
        // MAIN may have completed preparation before its reply was canceled.
        // Revoke that session before allowing another attempt.
        if(operation==='prepare-like' && result?.ok && typeof result.value?.token==='string')await this.stopLike(result.value.token);
        if(operation==='prepare-lottery' && result?.ok && typeof result.value?.token==='string')await this.stopLottery(result.value.token);
        return unavailable();
      }
      return result?.ok && this.context.current() ? result.value : unavailable();
    } catch { return unavailable(); }
    finally {this.page.clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  prepareModeration(action,target) {return this.call('prepare-moderation',{action,target},800);}
  prepareLike(options) {return this.call('prepare-like',{},10000,options);}
  prepareLottery(lotteryId,{allowPassword=false,signal}={}) {return this.call('prepare-lottery',{lotteryId,allowPassword},10000,{signal});}
  commitLottery(token,options) {return this.call('commit-lottery',{token},20000,options);}
  stopLottery(token) {return this.call('stop-lottery',{token},800);}
  commitLike(token,count,sequence,options) {return this.call('commit-like',{token,count,sequence},10000,options);}
  stopLike(token) {return this.call('stop-like',{token},800);}
  commitModeration(token) {return this.call('commit-moderation',{token},10000);}
  prepare(channel) {return this.call('prepare',{channel},800);}
  commit(token,text) {return this.call('commit',{token,text},10000);}
}
