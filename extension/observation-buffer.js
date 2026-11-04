const budget=limit=>({limit,count:0,bytes:0,gaps:0});
function take(queue,limit) {
  let count=0,bytes=0;
  while(count<queue.length && count<limit && (!count || bytes+queue[count].bytes<=1024*1024))bytes+=queue[count++].bytes;
  return {values:queue.splice(0,count).map(item=>item.value),bytes};
}

// One consumer, one retained batch. Reading is repeatable; only acknowledgement
// releases capacity. Queued and in-flight observations share the same budget.
export class ObservationBuffer {
  constructor() {
    this.events=[];this.priority=[];this.captures=[];
    this.eventBudget=budget(4096);this.captureBudget=budget(256);
    this.batch=null;this.sequence=0;
  }
  enqueue(kind,value) {
    let text;try {text=JSON.stringify(value);} catch {}
    const bytes=typeof text==='string'?text.length*2:null,usage=kind==='captures'?this.captureBudget:this.eventBudget;
    if(bytes==null || usage.count>=usage.limit || usage.bytes+bytes>8*1024*1024){usage.gaps++;return false;}
    this[kind].push({value:text,bytes});usage.count++;usage.bytes+=bytes;return true;
  }
  acknowledge(id) {
    if(!this.batch || id!==this.batch.payload.batchId)return;
    const {payload,eventBytes,captureBytes}=this.batch;
    this.eventBudget.count-=payload.events.length+payload.priority.length;this.eventBudget.bytes-=eventBytes;
    this.captureBudget.count-=payload.captures.length;this.captureBudget.bytes-=captureBytes;
    this.batch=null;
  }
  drain({ack,paused=false}={}) {
    this.acknowledge(ack);
    if(!this.batch) {
      const events=take(this.events,paused?0:128),priority=take(this.priority,128),captures=take(this.captures,32);
      if(events.values.length || priority.values.length || captures.values.length)this.batch={
        payload:{batchId:++this.sequence,events:events.values,priority:priority.values,captures:captures.values},
        eventBytes:events.bytes+priority.bytes,captureBytes:captures.bytes
      };
    }
    const payload=this.batch?.payload || {batchId:null,events:[],priority:[],captures:[]};
    // The MAIN facade is page-visible. Return fresh JSON values so a caller
    // cannot mutate retained observations or inject into a future native read.
    return {batchId:payload.batchId,events:payload.events.map(text=>JSON.parse(text)),
      priority:payload.priority.map(text=>JSON.parse(text)),captures:payload.captures.map(text=>JSON.parse(text)),
      more:(!paused && this.events.length>0)||this.priority.length>0||this.captures.length>0,
      status:{bridgeGaps:this.eventBudget.gaps,bridgePending:this.eventBudget.count,
        captureBridgeGaps:this.captureBudget.gaps,captureBridgePending:this.captureBudget.count}};
  }
}
