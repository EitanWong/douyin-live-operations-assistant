const identifier = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const exactId = value => identifier(value) ? value : Number.isSafeInteger(value) && value > 0 ? String(value) : null;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const seconds = value => typeof value === 'number' || typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : NaN;
const fail = reason => { throw new Error(reason); };
const unavailable = reason => ({available:false,reason});
const unsent = reason => ({submitted:false,dispatched:false,reason});
const accepted = () => ({submitted:true,transport:'request',clicked:true,dispatched:true});
const unknown = reason => ({submitted:false,unknown:true,transport:'request',clicked:true,dispatched:true,reason});
const sameContext = (a,b) => a && b && ['roomId','userId','path','anchorId','lotteryId'].every(key => a[key] === b[key]);
const withSignal = signal => signal ? {signal} : {};

function clock(info) {
  const now = seconds(info?.current_time), end = seconds(info?.draw_time);
  if (info?.status !== 1 || !integer(now) || !integer(end) || now <= 0 || now >= end || !Number.isSafeInteger(end * 1000)) fail('福袋状态或开奖时间无法确认');
  return {now,end};
}
function checkIdentity(info,context) {
  if (info?.lottery_id_str !== context.lotteryId || info.room_id_str !== context.roomId || info.owner_type !== 1
    || exactId(info.anchor_id) !== context.anchorId || exactId(info.owner_user_id) !== context.anchorId) fail('福袋、房间或主播身份不匹配');
}
function conditionState(row,user,allowPassword) {
  if (!row || ![3,6,8].includes(row.type)) fail('福袋包含尚未支持的参与条件，请在原生页面处理');
  if (!integer(row.need_diamond_count)) fail('福袋参与条件无法确认');
  if (row.type === 8) {
    if (!integer(row.min_fans_level) || !integer(user.fans_level) || user.is_fansclub_member !== true
      || user.fansclub_status_active !== true || user.fans_level < row.min_fans_level) fail('请先在原生页面完成粉丝团条件');
    return {complete:true};
  }
  if (row.need_diamond_count !== 0) fail('不自动执行付费参与条件');
  if (row.type === 6) return {complete:user.has_activated};
  if (typeof user.has_command !== 'boolean' || typeof row.content !== 'string' || !row.content.trim() || [...row.content].length > 500) fail('福袋口令无法确认');
  if (!user.has_command && !allowPassword) fail('本轮需要发送口令，请先允许参与口令福袋');
  return {complete:user.has_command,command:user.has_command ? '' : row.content};
}
function conditions(data,allowPassword) {
  const user = data?.user_condition, rows = data?.lottery_info?.conditions;
  if (data?.hit_black_list !== false || user?.is_watching !== true || typeof user.has_activated !== 'boolean') fail('当前账号的福袋参与资格无法确认');
  if (!Array.isArray(rows) || rows.length > 32 || new Set(rows.map(row => row?.type)).size !== rows.length) fail('福袋参与条件不完整或重复');
  if (data.user_customized_condition != null && (!Array.isArray(data.user_customized_condition) || data.user_customized_condition.length)) fail('福袋包含自定义条件，请在原生页面处理');
  if (data.server_participate_biz_data != null && data.server_participate_biz_data !== '') fail('福袋包含尚未支持的参与流程');
  const states = rows.map(row => conditionState(row,user,allowPassword));
  if (states.every(state => state.complete)) fail('本轮适用条件均已完成，请等待参与回执');
  return states.find(state => state.command)?.command || '';
}
function eligibility(response,context,allowPassword,at) {
  const reply = response?.data;
  if (reply?.status_code !== 0) fail('平台未返回可用的福袋参与资格');
  const info = reply.data?.lottery_info;
  checkIdentity(info,context);
  const {now,end} = clock(info);
  if (context.drawTime != null && end !== context.drawTime) fail('福袋开奖时间已变更，请重新读取活动');
  return {command:conditions(reply.data,allowPassword),drawTime:end,deadline:at + (end-now)*1000};
}

// The native lottery module 604509 uses the page's signed HTTP client. Only the
// observed manual/password flow is supported; an HTTP acknowledgement is not a
// participation receipt. Tickets and round reservations stay in this instance.
export class LotteryRequests {
  #tickets = new Map();
  #rounds = new Map();
  #closed = false;
  constructor(sender) {
    this.sender = sender;
    sender.page.addEventListener('pagehide',() => { this.#closed = true; for (const ticket of this.#tickets.values()) this.stop(ticket.token); });
    sender.page.addEventListener('pageshow',event => { if (event.persisted) this.#closed = false; });
  }
  context(lotteryId) {
    try {
      const context = this.sender.context(), page = this.sender.page, store = page.__STORE__;
      const room = store?.roomStore?.roomInfo, current = store?.lotteryStore?.currentLottery;
      if (this.#closed || !identifier(lotteryId) || !context || !identifier(context.roomId) || !identifier(context.userId)
        || !identifier(room?.anchor?.id_str) || ![2,'2'].includes(room?.room?.status)
        || page.navigator?.onLine === false || store?.feedStore?.isActive === false
        || current?.lottery_id_str !== lotteryId || current.room_id_str != null && current.room_id_str !== context.roomId
        || current.status != null && current.status !== 1) return null;
      const drawTime = current.draw_time == null ? null : seconds(current.draw_time);
      if (drawTime != null && (!integer(drawTime) || drawTime <= 0)) return null;
      return {...context,anchorId:room.anchor.id_str,lotteryId,drawTime};
    } catch { return null; }
  }
  remove(ticket) {
    this.#tickets.delete(ticket.token);
    if (this.#rounds.get(ticket.key) === ticket) this.#rounds.delete(ticket.key);
  }
  prune(now) {
    for (const ticket of this.#tickets.values()) {
      if (ticket.pending) continue;
      if (ticket.dispatched ? ticket.deadline <= now : now-ticket.at > 300000) this.remove(ticket);
    }
  }
  current(ticket,signal) {
    const now = Date.now(), context = this.context(ticket.context.lotteryId), drawTime = ticket.drawTime ?? ticket.context.drawTime;
    return !ticket.stopped && !signal?.aborted && now >= ticket.at && now-ticket.at <= 300000
      && (ticket.deadline == null || now < ticket.deadline)
      && sameContext(context,ticket.context) && (context.drawTime == null || drawTime == null || context.drawTime === drawTime);
  }
  async prepare(lotteryId,{allowPassword=false,signal}={}) {
    if (typeof allowPassword !== 'boolean' || signal?.aborted) return unavailable('福袋准备已取消或设置无效');
    let ticket;
    try {
      const context = this.context(lotteryId), client = context && this.sender.client(), at = Date.now();
      if (!context || !client) return unavailable('无法确认当前账号、直播间或福袋轮次');
      this.prune(at);
      const key = `${context.roomId}:${context.userId}:${lotteryId}`;
      if (this.#rounds.has(key)) return unavailable('本轮福袋已有准备或提交记录，不重复参与');
      if (this.#tickets.size >= 128) return unavailable('福袋准备记录已达上限，请等待旧活动结束');
      ticket = {token:this.sender.page.crypto.randomUUID(),key,context,client,at,allowPassword,pending:true};
      this.#tickets.set(ticket.token,ticket);this.#rounds.set(key,ticket);
      const response = await client.request({url:'/webcast/lottery/melon/check_user_right/',method:'get',
        params:{lottery_id:lotteryId,room_id:context.roomId,anchor_id:context.anchorId},timeout:8000,...withSignal(signal)});
      if (!this.current(ticket,signal)) fail('账号、房间或福袋已变化，准备已取消');
      Object.assign(ticket,eligibility(response,context,allowPassword,at));
      if (!this.current(ticket,signal)) fail('福袋准备已过期或取消');
      return {available:true,token:ticket.token};
    } catch (error) {
      if (ticket) this.remove(ticket);
      return unavailable(String(error?.message || '福袋资格查询失败').slice(0,160));
    } finally { if (ticket) ticket.pending = false; }
  }
  stop(token) {
    const ticket = this.#tickets.get(token);
    if (ticket) { ticket.stopped = true; if (!ticket.dispatched) this.remove(ticket); }
    return {stopped:true};
  }
  commit(token,{signal}={}) {
    const ticket = this.#tickets.get(token);
    if (!ticket) return Promise.resolve(unsent('福袋准备已失效'));
    if (ticket.result) return ticket.result;
    if (ticket.pending || !this.current(ticket,signal)) { this.stop(token); return Promise.resolve(unsent('账号、房间、福袋或请求准备已变更')); }
    // Register the promise before entering page code, including synchronous
    // re-entry from a request interceptor.
    let resolve;
    ticket.result = new Promise(done => { resolve = done; });
    ticket.pending = true;
    void (async () => {
      try { resolve(await this.perform(ticket,signal)); }
      finally { ticket.pending = false; }
    })();
    return ticket.result;
  }
  async perform(ticket,signal) {
    ticket.dispatched = true;
    try {
      const response = await ticket.client.request({url:'/webcast/lottery/melon/update_user_condition/',method:'post',
        data:`condition_type=6&lottery_id=${ticket.context.lotteryId}`,headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:8000,...withSignal(signal)});
      const code = response?.data?.status_code;
      if (code !== 0) return Number.isInteger(code)
        ? {submitted:false,dispatched:true,transport:'request',clicked:true,reason:`平台拒绝福袋条件提交（${code}），不自动重发`}
        : unknown('福袋条件提交结果未知，不自动重试');
      if (!ticket.command) return accepted();
      if (!this.current(ticket,signal)) return unknown('福袋条件已提交，口令发送已停止；请在原生页面核查');
      const chat = await ticket.client.request({url:`/webcast/room/special_chat/${ticket.context.roomId}/`,method:'get',
        params:{type:9,room_id:ticket.context.roomId,content:ticket.command},timeout:8000,...withSignal(signal)});
      return chat?.data?.status_code === 0 ? accepted() : unknown('福袋条件已提交，但口令结果未确认；不自动重试');
    } catch { return unknown('福袋请求结果未知，不自动重试；请在原生页面核查'); }
  }
}
