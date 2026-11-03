import { AUTO_LIKE_MIN_INTERVAL_SEC } from '../core/auto-like.js';

// LiveLike.401384a2.js -> module 937589.vL -> the page's signed HTTP client.
// A session pins the account and room; each ordered batch can be submitted once.
export class LikeRequests {
  constructor(sender) {
    this.sender = sender; this.session = null; this.pending = false; this.lastAt = -Infinity;
    sender.page.addEventListener('pagehide', () => this.stop(this.session?.token));
  }
  context() {
    const context = this.sender.context(), page = this.sender.page;
    const room = page.__STORE__?.roomStore?.roomInfo?.room;
    const auth = room?.room_auth, style = auth?.SpecialStyle?.Like?.UnableStyle;
    if (!context || !/^[1-9]\d{0,24}$/.test(context.userId || '') || page.navigator?.onLine === false
      || ![2,'2'].includes(room?.status) || ![true,1].includes(auth?.Digg)
      || page.__STORE__?.feedStore?.isActive === false) return null;
    // Mirror the native component's click-like gate. Unknown shapes fail closed.
    if (style != null && style !== '' && style !== 0) {
      if (!Number.isSafeInteger(style) || style < 0 || style % 4 !== 3) return null;
    }
    return context;
  }
  prepare() {
    try {
      const context = this.context(), client = context && this.sender.client();
      if (!context || !client) return {available:false,reason:'请确认已登录、正在直播且本房允许点赞，再重试'};
      if (this.pending || this.session && Date.now()-this.session.at < 3600000) return {available:false,reason:'本页已有点赞任务，请先停止'};
      const token = this.sender.page.crypto.randomUUID();
      this.session = {token,context,client,at:Date.now(),sequence:0,result:null};
      return {available:true,token};
    } catch { return {available:false,reason:'网页点赞能力不可用，请刷新直播页后重试'}; }
  }
  stop(token) {
    if (token && this.session?.token === token) this.session = null;
    return {stopped:true};
  }
  commit(token, count, sequence, signal) {
    const session = this.session;
    if (signal?.aborted || !session || session.token !== token) return Promise.resolve({submitted:false,reason:'点赞任务已停止或失效'});
    if (sequence === session.sequence && session.result) return session.result;
    if (!Number.isInteger(count) || count < 1 || count > 100 || sequence !== session.sequence+1
      || !Number.isSafeInteger(sequence) || this.pending || Date.now()-this.lastAt < AUTO_LIKE_MIN_INTERVAL_SEC*1000) {
      this.stop(token);
      return Promise.resolve({submitted:false,reason:'点赞参数或提交间隔无效，已停止'});
    }
    const context = this.context();
    if (!context || context.path !== session.context.path || context.roomId !== session.context.roomId
      || context.userId !== session.context.userId || Date.now()-session.at >= 3600000) {
      this.stop(token);
      return Promise.resolve({submitted:false,reason:'账号、房间或点赞权限已变化，已停止'});
    }
    session.sequence = sequence; this.pending = true; this.lastAt = Date.now();
    session.result = this.perform(session, count, signal);
    return session.result;
  }
  async perform(session, count, signal) {
    try {
      const response = await session.client.request({url:'/webcast/room/like/',method:'post',data:{},
        params:{room_id:session.context.roomId,count},timeout:8000,...(signal ? {signal} : {})});
      if (response?.data?.status_code === 0) return {submitted:true,count};
      this.stop(session.token);
      if (Number.isInteger(response?.data?.status_code)) return {submitted:false,reason:`平台拒绝点赞（${response.data.status_code}），已停止，请稍后再试`};
    } catch { this.stop(session.token); }
    finally { this.pending = false; }
    return {submitted:false,unknown:true,reason:'点赞结果未知，已停止，不自动重试；请核查直播间'};
  }
}
