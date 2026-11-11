import {roomFromURL} from './room-context.js';

const CHECK_MS=15000, IDLE_REFRESH_MS=120000, RELOAD_COOLDOWN_MS=60000, STALE_CONNECTION_MS=120000;

// One owner for polling and navigation, shared by page timers and MV3 wakeups.
export class RoomMonitor {
  constructor({page,context,read,checkpoint,now=()=>Date.now(),onStatus=()=>{},onError=()=>{}}) {
    Object.assign(this,{page,context,read,checkpoint,now,onStatus,onError});
    this.startedAt=now();this.nextCheckAt=this.startedAt+CHECK_MS;this.retryAt=0;
    this.failures=0;this.closed=false;this.reloading=false;
    this.key=`live-assistant:room-reload:${roomFromURL(page.location)}`;
    this.lastReloadAt=0;
    try {const saved=Number(page.sessionStorage.getItem(this.key));if(Number.isFinite(saved)&&saved>0)this.lastReloadAt=Math.min(saved,now());} catch {}
    this.status={active:false,state:'stopped',lastCheckAt:0,error:''};
  }
  available(c) {return !this.closed && c.current && !c.suspended && !c.blocked;}
  publish(state,active=false) {
    const next={...this.status,state,active,nextCheckAt:this.nextCheckAt};
    if(JSON.stringify(next)===JSON.stringify(this.status))return;
    this.status=next;this.onStatus({...next});
  }
  tick() {
    if(this.pending)return this.pending;
    this.pending=this.run().finally(()=>{this.pending=null;});return this.pending;
  }
  wake() {
    if(this.pending)return this.pending;
    if(!this.failures)this.nextCheckAt=0;return this.tick();
  }
  async check() {
    if(!this.read || this.now()<this.nextCheckAt)return;
    this.nextCheckAt=this.now()+CHECK_MS;
    try {
      await this.read();this.failures=0;this.status.error='';
    } catch(error) {
      this.failures=Math.min(2,this.failures+1);
      this.nextCheckAt=this.now()+CHECK_MS*2**this.failures;
      this.status.error=String(error.message || error);
    }
    this.status.lastCheckAt=this.now();
  }
  recovery(c) {
    const now=this.now();
    const lastActivity=c.lastActivity>0?c.lastActivity:this.startedAt;
    const connected=c.healthy && now-lastActivity<=STALE_CONNECTION_MS;
    // A data connection failure does not mean the broadcast has ended.
    if(c.live==='live')return {state:connected?'connected':'reconnecting'};
    return {state:'waiting',due:c.live==='ended' && now-this.startedAt>=IDLE_REFRESH_MS,reason:'等待开播，刷新直播间'};
  }
  async run() {
    if(this.closed)return;
    let c=this.context();
    if(!this.available(c)) {this.publish(c.suspended?'suspended':'stopped');return;}
    if(this.page.navigator?.onLine===false) {this.publish('offline',Boolean(c.enabled));return;}
    if(this.reloading)return;
    // The monitoring lease belongs to the enabled lifecycle, not to the room
    // request. A slow request must not leave a waiting tab without protection.
    this.publish(c.enabled ? this.recovery(c).state : 'stopped',Boolean(c.enabled));
    await this.check();
    if(this.closed)return;
    c=this.context();
    if(!this.available(c)) {this.publish(c.suspended?'suspended':'stopped');return;}
    if(!c.enabled) {this.publish('stopped');return;}
    const recovery=this.recovery(c);this.publish(recovery.state,true);
    if(!recovery.due || c.dirty || this.now()<this.retryAt || this.lastReloadAt && this.now()-this.lastReloadAt<RELOAD_COOLDOWN_MS)return;
    await this.reload(recovery.reason);
  }
  async reload(reason) {
    try {
      await this.checkpoint();
      if(this.closed)return;
      const c=this.context();
      if(!this.available(c) || !c.enabled || c.dirty || this.page.navigator?.onLine===false)return;
      // Recheck after async storage: the broadcast may already have started.
      if(!this.recovery(c).due)return;
      this.lastReloadAt=this.now();
      try {this.page.sessionStorage.setItem(this.key,String(this.lastReloadAt));} catch {}
      this.reloading=true;this.publish('refreshing',true);
      this.page.location.reload();
    } catch(error) {
      this.reloading=false;this.retryAt=this.now()+CHECK_MS;
      this.status.error=`${reason}失败：${error.message || error}`;this.onError(error);
    }
  }
  suspend() {this.publish('suspended');}
  close() {this.closed=true;this.publish('stopped');}
}
