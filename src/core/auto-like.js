export const AUTO_LIKE_DEFAULTS = {batch:20,intervalSec:2,target:1000};
// Product limit, not a verified platform allowance. Keep the native-like 2 s default.
export const AUTO_LIKE_MIN_INTERVAL_SEC = 0.001;
export function validateAutoLike(value) {
  const ranges = {batch:[1,100],intervalSec:[AUTO_LIKE_MIN_INTERVAL_SEC,60],target:[1,1000000]};
  const result = {};
  for (const [key,[min,max]] of Object.entries(ranges)) {
    const number = value?.[key];
    if (key === 'intervalSec') {
      const milliseconds = Math.round(number*1000);
      if (!Number.isFinite(number) || number < min || number > max || Math.abs(number*1000-milliseconds) > 1e-9)
        throw new Error(`点赞间隔需为 ${min}～${max} 秒，精确到毫秒`);
      result[key] = milliseconds/1000;
      continue;
    }
    if (!Number.isInteger(number) || number < min || number > max) throw new Error(`点赞${{batch:'每批数量',intervalSec:'间隔秒数',target:'目标数量'}[key]}需为 ${min}～${max} 的整数`);
    result[key] = number;
  }
  return result;
}

export class AutoLike {
  constructor({transport,lock,guard=()=>'',changed=()=>{},schedule=(fn,ms)=>setTimeout(fn,ms),cancel=timer=>clearTimeout(timer)}) {
    Object.assign(this,{transport,lock,guard,changed,schedule,cancel});
    this.state = {phase:'idle',accepted:0,batches:0,reason:'尚未开始'}; this.generation = 0;
  }
  update(values) { Object.assign(this.state,values); this.changed({...this.state}); }
  async start(value) {
    if (this.busy || ['starting','running','stopping'].includes(this.state.phase)) throw new Error('已有点赞任务正在处理，请稍候');
    const config = validateAutoLike(value), error = this.guard();
    if (error) throw new Error(error);
    const generation = ++this.generation;
    this.busy = true;
    this.config = config; this.update({phase:'starting',accepted:0,batches:0,reason:'正在检查点赞能力…'});
    try {
      if (!await this.lock.acquire()) throw new Error('另一个标签页正在为此直播间点赞');
      if (generation !== this.generation) return;
      const error = this.guard(); if (error) throw new Error(error);
      this.busy = true;
      const prepared = await this.transport.prepareLike();
      if (generation !== this.generation) { if (prepared?.token) await this.transport.stopLike(prepared.token); return; }
      if (!prepared?.available || typeof prepared.token !== 'string') throw new Error(prepared?.reason || '网页点赞能力不可用');
      this.token = prepared.token; this.sequence = 0;
      this.update({phase:'running',reason:'正在自动点赞'});
    } catch (error) {
      if (generation === this.generation) { this.stop(error.message); throw error; }
    } finally {
      this.busy = false;
      if (generation !== this.generation) this.finishStop();
    }
    if (generation === this.generation && this.state.phase === 'running') await this.tick();
  }
  check() {
    if (['starting','running'].includes(this.state.phase)) {
      const error = this.guard(); if (error) this.stop(error);
    }
  }
  stop(reason = '已手动停止') {
    this.stopReason = reason;
    ++this.generation; this.cancel(this.timer); this.timer = null;
    const token = this.token; this.token = null;
    if (token) void Promise.resolve(this.transport.stopLike(token)).catch(()=>{});
    if (!this.busy) this.lock.release();
    this.update({phase:this.busy ? 'stopping':'stopped',reason:this.busy ? `${reason}；正在等待已提交批次结果` : reason});
  }
  finishStop() {
    this.lock.release();
    this.update({phase:this.state.phase === 'completed' ? 'completed':'stopped',reason:this.stopReason});
  }
  async tick() {
    if (this.busy || this.state.phase !== 'running') return;
    const error = this.guard(); if (error) { this.stop(error); return; }
    const generation = this.generation, count = Math.min(this.config.batch,this.config.target-this.state.accepted);
    this.busy = true;
    try {
      const result = await this.transport.commitLike(this.token,count,++this.sequence);
      // A stop cannot recall an in-flight request; account for its response, but
      // never schedule another batch or allow restart until it has settled.
      if (result?.submitted === true && result.count === count) this.update({accepted:this.state.accepted+count,batches:this.state.batches+1});
      if (generation !== this.generation) return;
      if (result?.submitted !== true || result.count !== count) { this.stop(result?.reason || '点赞结果未知，已停止，不自动重试'); return; }
      if (this.state.accepted >= this.config.target) { this.stop('已达到本次目标'); this.update({phase:'completed'}); return; }
      this.timer = this.schedule(()=>{this.timer=null;void this.tick();},Math.round(this.config.intervalSec*1000));
    } catch { if (generation === this.generation) this.stop('点赞请求异常，已停止，不自动重试'); }
    finally {
      this.busy = false;
      if (generation !== this.generation) this.finishStop();
    }
  }
}
