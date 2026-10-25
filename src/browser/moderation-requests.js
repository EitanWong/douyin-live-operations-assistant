const uid = value => typeof value==='string' && /^[1-9]\d{0,24}$/.test(value);

// Shapes verified against LiveUserProfile.3679af0c.js and request module
// 937589 in client-entry~1.2eb38c7d.js. These are room management actions.
export class ModerationRequests {
  constructor(sender) { this.sender=sender;this.tickets=new Map(); }
  context(target) {
    const context=this.sender.context(), room=this.sender.page.__STORE__?.roomStore?.roomInfo?.room;
    const admins=room?.admin_user_ids_str;
    const owner=room?.owner?.id_str;
    if (!context || !uid(context.userId) || !uid(owner) || !Array.isArray(admins) || !admins.every(uid)) return null;
    if (context.userId!==owner && !admins.includes(context.userId)) return null;
    if (!uid(target?.id) || target.id===owner || target.id===context.userId || admins.includes(target.id)) return null;
    if (typeof target.secUid!=='string' || !/^[\w-]{1,256}$/.test(target.secUid)) return null;
    return context;
  }
  prepare(action,target) {
    if (!['mute','ban'].includes(action)) return {available:false,reason:'管理动作无效'};
    try {
      const context=this.context(target), client=context && this.sender.client();
      if (!context || !client) return {available:false,reason:'无法确认本房管理权限或目标身份（需 UID 与 secUID）；未执行'};
      const now=Date.now();
      for (const [token,ticket] of this.tickets) if (now-ticket.at>300000) this.tickets.delete(token);
      if (this.tickets.size>=128) return {available:false,reason:'管理请求已达上限'};
      const token=this.sender.page.crypto.randomUUID();
      this.tickets.set(token,{context,client,action,target:{id:target.id,secUid:target.secUid},at:now});
      return {available:true,token};
    } catch { return {available:false,reason:'网页管理能力不可用'}; }
  }
  commit(token) {
    const ticket=this.tickets.get(token);
    if (!ticket) return Promise.resolve({submitted:false,reason:'管理准备已失效'});
    if (!ticket.result) ticket.result=this.perform(ticket);
    return ticket.result;
  }
  async perform(ticket) {
    const context=this.context(ticket.target);
    if (!context || context.path!==ticket.context.path || context.roomId!==ticket.context.roomId || context.userId!==ticket.context.userId || Date.now()-ticket.at>10000) return {submitted:false,reason:'房间、账号或管理权限已变更，未执行'};
    const ban=ticket.action==='ban';
    const params=ban ? {room_id:context.roomId,kick_uid:ticket.target.id,sec_kick_uid:ticket.target.secUid}
      : {room_id:context.roomId,user_id:ticket.target.id,sec_user_id:ticket.target.secUid};
    try {
      const response=await ticket.client.request({url:ban?'/webcast/room/kick/user/':'/webcast/room/silence/',method:'post',data:{},params,timeout:8000});
      if (response?.data?.status_code===0) return {submitted:true};
      if (Number.isInteger(response?.data?.status_code)) return {submitted:false,reason:`平台拒绝管理请求（${response.data.status_code}）`};
    } catch {}
    return {submitted:false,unknown:true,reason:'管理请求结果未知，不自动重试，请在平台核查'};
  }
}
