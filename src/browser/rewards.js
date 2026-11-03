import {rewardActivities, matchRewardActivity, rewardReservation, rewardBlockReason} from '../core/reward-activity.js';

export const REWARDS_DEFAULTS = {
  enabled:false, luckyBag:true, redPacket:true, nativePassword:false,
  entryXPath:'/html/body/div[2]/div[3]/div/main/div[2]/div/div/div/div[1]/div[3]/div/div/div/div/div[16]/div/div[2]/div[2]'
};

const rewardNames = {luckyBag:'福袋',redPacket:'红包'};
const rewardActions = /^(?:立即参与|参与抽奖|参与福袋|参与抢红包|立即抢红包|立即抢|抢红包|免费参与|一键参与|点击参与|参与|立即领取|领取红包|领取|开红包|拆红包|拆开|抢|开|拆)$/;
const rewardConditions = /(?:送礼|赠送|支付|购买|充值|消耗|开通|粉丝团|灯牌|加入会员|关注主播|先关注|发表评论|发送弹幕|口令|分享直播|去完成|完成任务|完成下方|完成以下|参与条件|参与要求|验证|登录)/;
const rewardDone = /^(?:已参与|参与成功|已成功参与|等待开奖|已领取|领取成功|已抢到|已领取红包|已拆开)$/;
const rewardEnded = /(?:已结束|已开奖|已抢完|已领完|来晚了|下次再来)/;
const rewardText = node => String(node?.textContent || '').replace(/\s+/g,' ').trim();
const nativePasswordText = text => /^(?:发送口令|口令|参与口令)\s*[:：]/.test(text) &&
  !/(?:送礼|赠送|支付|购买|充值|消耗|开通|粉丝团|灯牌|会员|关注主播|先关注|分享直播|验证|登录)/.test(text);

// Detection and reservations live in the content world. Lottery requests use a
// scoped transport; red packets retain their native page controls.
export class RewardAutomation {
  constructor({page,room,getConfig,lock,guard=()=>'',changed=()=>{},log=()=>{},now=Date.now,click=node=>node.click(),getAccount=()=>'default',storage,getRoomId=()=>'',getEvents=()=>[],lotteryRequests}) {
    Object.assign(this,{page,room,getConfig,lock,guard,changed,log,now,click,getAccount,getRoomId,getEvents,lotteryRequests});
    this.storage=storage || {get:key=>JSON.parse(page.localStorage.getItem(key) || '[]'),set:(key,value)=>page.localStorage.setItem(key,JSON.stringify(value))};
    this.document=page.document; this.records=[]; this.generation=0; this.nextAt=0;
    this.state={phase:'idle',reason:'自动参与已关闭',submitted:0,confirmed:0,serverConfirmed:0,lottery:null,redPacket:null};
  }
  async loadRecords(account) {
    this.storageKey=`live-assistant:rewards:${this.room}:${account}`;
    const saved=await this.storage.get(this.storageKey);
    this.records=this.cleanRecords(saved);
    this.recordsAccount=account;
    const legacyKey=`douyin-live-assistant:rewards:${this.room}`;
    let legacy;
    try {legacy=JSON.parse(this.page.sessionStorage.getItem(legacyKey) || 'null');} catch {}
    if(Array.isArray(legacy)) {
      // Old records had no account field. Conservatively retain them for the
      // first account observed on this page; delete the old copy only on commit.
      this.records=[...new Map([...this.cleanRecords(legacy),...this.records].map(record=>[record.key,record])).values()];
      await this.saveRecords();this.page.sessionStorage.removeItem(legacyKey);
    }
  }
  cleanRecords(saved) {
    return Array.isArray(saved) ? saved.filter(record=>['luckyBag','redPacket'].includes(record?.kind) &&
      ['submitted','unknown','confirmed','rejected'].includes(record.status) && typeof record.key==='string' && record.key.length<=240 &&
      (record.candidateVersion==null || typeof record.candidateVersion==='string' && /^\d{1,20}$/.test(record.candidateVersion)) &&
      Number.isFinite(record.at) && record.at<=this.now()+60000 && this.now()-record.at<86400000).slice(-100) : [];
  }
  update(values) {
    const next={...this.state,...values};
    if(JSON.stringify(next)===JSON.stringify(this.state))return;
    this.state=next; this.changed({...next});
  }
  visible(node) {
    if(!node?.isConnected || node.closest('#douyin-live-assistant,[hidden],[aria-hidden="true"]'))return false;
    const style=this.page.getComputedStyle(node);
    return style.display!=='none' && style.visibility!=='hidden' && [...node.getClientRects()].some(rect=>rect.width>0 && rect.height>0);
  }
  enabled(kind) {const config=this.getConfig();return config.enabled && config[kind];}
  async saveRecords() {
    this.records=this.records.filter(record=>this.now()-record.at<86400000).slice(-100);
    await this.storage.set(this.storageKey,this.records);
  }
  stop(reason='本页已停止自动参与，保存设置后可恢复') {
    this.requestController?.abort();
    ++this.generation; this.paused=true; this.opened=null; if(!this.busy)this.lock.release();
    this.update({phase:'stopped',reason});
  }
  resume() {++this.generation;this.requestController?.abort();this.paused=false;this.nextAt=0;}
  kind(node) {
    if(node.matches('.gbRklVwV,[data-e2e*="lottery"],[data-testid*="lottery"]'))return 'luckyBag';
    const text=rewardText(node);
    return /福袋/.test(text) ? 'luckyBag' : /红包/.test(text) ? 'redPacket' : null;
  }
  panels() {
    const nodes=new Set(this.document.querySelectorAll('.gbRklVwV,[role="dialog"],[data-e2e*="lottery"],[data-testid*="lottery"],[class*="lottery-panel"],[class*="redpacket-panel"],[class*="redPacketPanel"]'));
    // Some versions use divs with obfuscated classes for both panels and buttons.
    // Only a short, visible activity container with an exact action/status label
    // qualifies; chat rows and the assistant itself are excluded.
    for(const node of this.document.querySelectorAll('button,[role="button"],div,span')) {
      if(node.children.length || !rewardActions.test(rewardText(node)) && !rewardDone.test(rewardText(node)) || !this.visible(node))continue;
      let parent=node.parentElement;
      for(let depth=0;parent && depth<4;depth++,parent=parent.parentElement) {
        if(parent.matches('body,main,[data-e2e*="chat"],[class*="chatroom"],[class*="ChatRoom"]'))break;
        if(rewardText(parent).length>2000)break;
        if(this.kind(parent)) {nodes.add(parent);break;}
      }
    }
    return [...nodes].filter(node=>this.visible(node) && rewardText(node).length<2000 && this.enabled(this.kind(node)))
      .filter((node,_,all)=>!all.some(other=>other!==node && node.contains(other) && this.kind(node)===this.kind(other)));
  }
  controls(panel) {
    return [...panel.querySelectorAll('button,[role="button"],div,span')].filter(node=>this.visible(node) && (node.matches('button,[role="button"]') || !node.children.length));
  }
  hasConditions(panel) {
    const leaves=[...panel.querySelectorAll('*')].filter(node=>!node.children.length && this.visible(node));
    return leaves.some(node=>{
      const text=rewardText(node);
      if(!rewardConditions.test(text) || /^(?:参与条件|参与要求)[:：]?$/.test(text))return false;
      const nativePassword=this.kind(panel)==='luckyBag' && this.getConfig().nativePassword && nativePasswordText(text);
      // Completed requirements can remain visible next to the join button.
      // Inspect each requirement row, so one completed row cannot hide another
      // row that still needs a comment, payment or account action.
      let row=node;
      for(let depth=0;row && depth<3;depth++,row=row.parentElement) {
        const content=rewardText(row);
        if(/未完成|未满足|未达成|未关注|未加入|去完成/.test(content))return !nativePassword;
        if(/已完成|已满足|已达成|已关注|已加入|已点亮/.test(content))return false;
        if(row.parentElement===panel)break;
      }
      // Only the native participation control may submit a lottery password.
      // This does not permit arbitrary comments or completion of other tasks.
      return !nativePassword;
    });
  }
  identity(panel,kind) {
    const holder=panel.closest('[data-lottery-id],[data-redpacket-id],[data-activity-id]') || panel;
    const id=holder.getAttribute('data-lottery-id') || holder.getAttribute('data-redpacket-id') || holder.getAttribute('data-activity-id');
    const clock=rewardText(panel).match(/(?:倒计时\s*)?(\d{1,2})[:：](\d{2})/);
    const deadline=clock ? this.now()+(Number(clock[1])*60+Number(clock[2]))*1000 : null;
    const activity=matchRewardActivity(this.readActivities(),{kind,activityId:id,deadline});
    if(activity)return rewardReservation(activity);
    if(id)return {key:`${kind}:${id.slice(0,200)}`,activityId:id.slice(0,200),deadline:null};
    // The end time survives countdown text changes and React node replacement.
    const old=this.records.findLast(record=>record.kind===kind && (deadline!==null && record.deadline!==null ? Math.abs(record.deadline-deadline)<10000 : deadline===null && record.deadline===null && this.now()-record.at<600000));
    if(old)return {key:old.key,deadline:old.deadline};
    return {key:`${kind}:end:${Math.round((deadline ?? this.now())/1000)}`,deadline};
  }
  async remember(kind,identity,status,details={}) {
    let record=this.findRecord(kind,identity);
    const values={...identity,status,...details};
    if(!record) {record={kind,...values,at:this.now()};this.records.push(record);}
    else {if(Object.entries(values).every(([key,value])=>record[key]===value))return record;Object.assign(record,values);}
    await this.saveRecords();return record;
  }
  readActivities() {
    const activities=rewardActivities(this.getEvents(),{roomId:this.getRoomId(),account:this.getAccount()});
    if(this.recordsAccount!==this.getAccount())return activities;
    for(const activity of activities.lotteries) {
      const saved=this.findRecord('luckyBag',rewardReservation(activity));
      if(saved?.candidateVersion && (!activity.candidateVersion || BigInt(saved.candidateVersion)>BigInt(activity.candidateVersion))) {
        activity.candidateVersion=saved.candidateVersion;
        activity.participation=saved.serverParticipation || (saved.status==='confirmed' ? 'confirmed' : 'rejected');
      }
    }
    return activities;
  }
  detect() {
    const detected=this.readActivities();
    const summary=activity=>activity ? {...activity,remainingSec:activity.deadline==null ? null : Math.max(0,Math.ceil((activity.deadline-this.now())/1000))} : null;
    this.update({lottery:summary(detected.lotteries[0]),redPacket:summary(detected.redPackets[0])});
  }
  findRecord(kind,identity) {
    return this.records.find(record=>record.key===identity.key) || this.records.find(record=>record.kind===kind && !record.activityId &&
      Number.isFinite(record.deadline) && Number.isFinite(identity.deadline) && Math.abs(record.deadline-identity.deadline)<10000);
  }
  blockReason(identity,kind) {
    const activities=this.readActivities(),activity=matchRewardActivity(activities,{kind,activityId:identity.activityId,deadline:identity.deadline});
    if(activity)return rewardBlockReason(activity,this.now());
    const rows=kind==='luckyBag' ? activities.lotteries : activities.redPackets;
    // A drifting countdown must not create a fresh reservation for a known
    // round. Fall back to DOM identity only when recent protocol data is absent.
    return rows.some(row=>row.deadline!=null && row.deadline>=this.now()-120000)
      ? `${rewardNames[kind]}页面与服务器轮次不一致，等待页面更新` : '';
  }
  async reconcileActivities(current) {
    const activities=this.readActivities();
    for(const activity of activities.lotteries) {
      if(!['confirmed','rejected'].includes(activity.participation))continue;
      const identity=rewardReservation(activity),previous=this.findRecord('luckyBag',identity);
      if(previous?.candidateVersion && (!activity.candidateVersion || BigInt(activity.candidateVersion)<=BigInt(previous.candidateVersion)))continue;
      const confirmed=activity.participation==='confirmed';
      const count=confirmed && !previous?.serverConfirmed && activity===activities.lotteries[0];
      await this.remember('luckyBag',identity,activity.participation,{candidateVersion:activity.candidateVersion,serverParticipation:activity.participation,
        serverConfirmed:confirmed || previous?.serverConfirmed===true});
      if(!current())return;
      if(count)this.update({serverConfirmed:this.state.serverConfirmed+1});
    }
  }
  entry(kind) {
    const selector=kind==='redPacket' ? '.redpacket,[data-e2e*="redpacket"],[data-testid*="redpacket"]' : '.QZx73YMI .LMUtLyr9,[data-e2e*="lottery"] img,[data-testid*="lottery"] img';
    const candidates=[...this.document.querySelectorAll(selector)];
    if(kind==='luckyBag' && this.getConfig().entryXPath) {
      try {
        const node=this.document.evaluate(this.getConfig().entryXPath,this.document,null,9,null).singleNodeValue;
        // An absolute XPath can drift onto an unrelated control. Require the
        // observed activity structure or a semantic label before clicking it.
        if(node && (node.matches('.QZx73YMI') && node.querySelector('.LMUtLyr9') || /福袋/.test(node.getAttribute('aria-label') || node.getAttribute('title') || '')))candidates.unshift(node);
      } catch {}
    }
    for(const node of this.document.querySelectorAll('button,[role="button"],[aria-label],[title],img[alt]')) {
      const label=node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('alt') || rewardText(node);
      if(new RegExp(`^(?:查看|打开)?${rewardNames[kind]}(?:\\s*\\d{1,2}[:：]\\d{2})?$`).test(label))candidates.push(node);
    }
    return candidates.map(node=>node.closest('.QZx73YMI') || node.closest('button,[role="button"]') || node).find(node=>this.visible(node) && !node.matches('[disabled],[aria-disabled="true"]'));
  }
  actionable(panel,kind,action,identity) {
    return this.visible(panel) && this.kind(panel)===kind && panel.contains(action) && this.visible(action) &&
      rewardActions.test(rewardText(action)) && !action.closest('[disabled],[aria-disabled="true"]') &&
      !this.hasConditions(panel) && !rewardEnded.test(rewardText(panel)) && !/(?:倒计时\s*)?00[:：]00/.test(rewardText(panel)) &&
      !this.controls(panel).some(node=>rewardDone.test(rewardText(node))) && !this.blockReason(identity,kind) && this.identity(panel,kind).key===identity.key;
  }
  async forget(identity) {
    this.records=this.records.filter(record=>record.key!==identity.key);
    await this.saveRecords();
  }
  lotteryReady(activity,current,allowPassword) {
    const config=this.getConfig(),latest=this.readActivities().lotteries[0];
    return current() && config.luckyBag && config.nativePassword===allowPassword && latest?.activityId===activity.activityId &&
      !rewardBlockReason(latest,this.now());
  }
  lotteryStatus(reason,phase='watching') {
    this.requestReason=reason;
    this.update({phase,reason});
  }
  async dispatchLottery(prepared,identity,signal,current) {
    let result;
    try {result=await this.lotteryRequests.commit(prepared.token,{signal});}
    catch(error) {result={submitted:false,dispatched:error?.dispatched!==false,unknown:true,reason:String(error?.message || error)};}
    if(result?.dispatched===false) {
      await this.forget(identity);
      if(current())this.lotteryStatus(result.reason || '福袋请求未派发，等待重新读取资格','waiting');
      return false;
    }
    if(!result?.submitted)await this.remember('luckyBag',identity,'unknown');
    this.update({submitted:this.state.submitted+1});
    if(current())this.lotteryStatus(result?.submitted ? '福袋请求已提交，等待本人服务器参与回执' : result?.reason || '福袋参与结果未知，本轮不自动重试');
    this.log('system',result?.submitted ? '自动参与福袋：请求已提交，等待服务器确认' : '自动参与福袋：请求结果未知，本轮不重复提交');
    return true;
  }
  async requestLottery(current) {
    if(!this.lotteryRequests || !this.enabled('luckyBag'))return false;
    const activity=this.readActivities().lotteries[0];
    if(!activity)return false;
    const identity=rewardReservation(activity),block=rewardBlockReason(activity,this.now());
    if(block) {this.lotteryStatus(block);return false;}
    const previous=this.findRecord('luckyBag',identity);
    if(previous) {
      if(previous.status==='submitted' && this.now()-previous.at>=15000)await this.remember('luckyBag',identity,'unknown');
      if(current())this.lotteryStatus(previous.status==='submitted' ? '福袋请求已提交，等待本人服务器参与回执' : '福袋本轮参与结果已记录；未确认时不自动重试');
      return false;
    }
    const allowPassword=this.getConfig().nativePassword,key=`${this.getAccount()}:${activity.activityId}:${allowPassword}`;
    if(this.lastLotteryQuery?.key===key && this.now()-this.lastLotteryQuery.at<10000) {
      this.lotteryStatus(this.lastLotteryQuery.reason || '等待重新读取福袋资格','waiting');return false;
    }
    this.lastLotteryQuery={key,at:this.now()};
    const controller=new AbortController();this.requestController=controller;let prepared;
    try {
      prepared=await this.lotteryRequests.prepare(activity.activityId,{allowPassword,signal:controller.signal});
      if(!this.lotteryReady(activity,current,allowPassword))return false;
      if(!prepared?.available || typeof prepared.token!=='string') {
        this.lastLotteryQuery.reason=prepared?.reason || '网页福袋请求能力暂不可用';
        this.lotteryStatus(this.lastLotteryQuery.reason,'waiting');return false;
      }
      await this.remember('luckyBag',identity,'submitted');
      if(!this.lotteryReady(activity,current,allowPassword)) {await this.forget(identity);return false;}
      return await this.dispatchLottery(prepared,identity,controller.signal,current);
    } finally {
      if(prepared?.token)await this.lotteryRequests.stop(prepared.token);
      if(this.requestController===controller)this.requestController=null;
    }
  }
  async tick() {
    if(this.busy)return;
    this.detect();
    const config=this.getConfig(), error=this.guard();
    if(!config.enabled || this.paused || error || !config.luckyBag && !config.redPacket) {
      this.lock.release();
      if(!this.paused)this.update({phase:config.enabled?'waiting':'idle',reason:!config.enabled?'自动参与已关闭':error || '请至少选择福袋或红包'});
      return;
    }
    if(this.now()<this.nextAt)return;
    this.busy=true;this.nextAt=this.now()+1000;const generation=this.generation,account=this.getAccount(),platformRoom=this.getRoomId();
    const current=()=>generation===this.generation && !this.paused && !this.guard() && this.getConfig().enabled && account===this.getAccount() && platformRoom===this.getRoomId();
    try {
      if(!await this.lock.acquire()) {this.update({phase:'waiting',reason:'另一个标签页正在自动参与此直播间活动'});return;}
      if(!current()) {this.lock.release();return;}
      await this.loadRecords(account);
      if(!current())return;
      await this.reconcileActivities(current);
      if(!current())return;
      this.detect();
      this.requestReason='';
      if(await this.requestLottery(current))return;
      if(!current())return;
      const panels=this.panels();
      for(const panel of panels) {
        const kind=this.kind(panel);
        if(kind==='luckyBag' && this.lotteryRequests) {
          if(!this.requestReason)this.lotteryStatus('等待福袋精确轮次和参与资格','waiting');
          continue;
        }
        const name=rewardNames[kind], identity=this.identity(panel,kind), controls=this.controls(panel);
        const previous=this.findRecord(kind,identity),block=this.blockReason(identity,kind);
        if(controls.some(node=>rewardDone.test(rewardText(node)))) {
          const confirmed=previous && !previous.pageConfirmed;
          await this.remember(kind,identity,previous?.serverParticipation==='rejected' ? 'rejected' : 'confirmed',{pageConfirmed:true});
          if(!current())return;
          this.opened=null;
          this.update({phase:'watching',reason:block || `${name}已参与，等待下一轮`,confirmed:this.state.confirmed+(confirmed?1:0)});
          continue;
        }
        if(block) {this.opened=null;this.update({phase:'watching',reason:block});continue;}
        if(rewardEnded.test(rewardText(panel))) {this.opened=null;continue;}
        if(/(?:倒计时\s*)?00[:：]00/.test(rewardText(panel))) {this.update({phase:'watching',reason:`${name}倒计时结束，等待结果`});continue;}
        if(previous) {
          if(previous.status==='submitted' && this.now()-previous.at>=15000)await this.remember(kind,identity,'unknown');
          if(!current())return;
          this.update({phase:'watching',reason:previous.status==='submitted'?`${name}已点击参与，等待页面确认；本轮不会重复点击`:previous.status==='unknown'?`${name}参与结果未确认，本轮不会重复点击`:`${name}本轮已处理，等待下一轮`});
          continue;
        }
        if(this.hasConditions(panel)) {
          this.update({phase:'waiting',reason:`${name}有参与条件，请在页面手动完成；满足条件后自动继续`});continue;
        }
        const action=controls.find(node=>rewardActions.test(rewardText(node)) && !node.matches('[disabled],[aria-disabled="true"]') && !node.closest('[disabled],[aria-disabled="true"]'));
        if(!action) {this.update({phase:'waiting',reason:`${name}等待可用的参与按钮`});continue;}
        if(!current() || !this.enabled(kind))return;
        await this.remember(kind,identity,'submitted'); // Persist the reservation before dispatch.
        if(!current() || !this.enabled(kind) || !this.actionable(panel,kind,action,identity)) {
          this.records=this.records.filter(record=>record.key!==identity.key);await this.saveRecords();return;
        }
        try { await this.click(action); }
        catch(error) {
          if(error?.dispatched===false) {
            this.records=this.records.filter(record=>record.key!==identity.key);await this.saveRecords();
          } else await this.remember(kind,identity,'unknown');
          throw error;
        }
        this.update({submitted:this.state.submitted+1,...(current()?{phase:'watching',reason:`${name}已点击参与，等待页面确认`}:{})});
        this.log('system',`自动参与${name}：已点击网页按钮，等待页面确认`);
        return;
      }
      // Give a newly opened popover time to render. Alternate the two entries so
      // a persistent lucky bag does not starve a newly available red packet.
      if(this.opened && this.now()-this.opened.at<10000) {this.update({phase:'watching',reason:`正在读取${rewardNames[this.opened.kind]}详情`});return;}
      const order=this.lastKind==='luckyBag' ? ['redPacket','luckyBag'] : ['luckyBag','redPacket'];
      for(const kind of order) {
        if(!current())return;
        if(!this.enabled(kind) || panels.some(panel=>this.kind(panel)===kind))continue;
        const entry=this.entry(kind);if(!entry)continue;
        this.opened={kind,at:this.now()};this.lastKind=kind;
        this.update({phase:'watching',reason:`发现${rewardNames[kind]}，正在打开详情`});
        await this.click(entry);return;
      }
      if(panels.length || this.requestReason)return;
      this.opened=null;this.update({phase:'watching',reason:'正在等待本直播间的福袋或红包'});
    } catch(error) {if(current())this.update({phase:'waiting',reason:`活动读取失败：${String(error?.message || error).slice(0,160)}`});}
    finally {this.busy=false;if(this.paused || this.guard() || !this.getConfig().enabled)this.lock.release();}
  }
}
