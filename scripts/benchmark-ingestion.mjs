// Synthetic CPU measurements only; no live-room, browser IPC or storage latency.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {DouyinAdapter} from '../src/browser/adapter.js';

const now=Date.now(),event={type:'gift',id:'10000'};
const create=()=>({seenProtocolEvents:new Map(Array.from({length:20000},(_,id)=>[`gift:${id}`,{at:now,transport:'socket'}]))});
function reference(event,transport) {
  const now=Date.now(),key=`${event.type}:${event.id}`;
  for(const [id,record] of this.seenProtocolEvents)if(now-record.at>120000)this.seenProtocolEvents.delete(id);
  const previous=this.seenProtocolEvents.get(key);
  if(previous && previous.transport!==transport)return true;
  this.seenProtocolEvents.set(key,{at:now,transport});
  while(this.seenProtocolEvents.size>20000)this.seenProtocolEvents.delete(this.seenProtocolEvents.keys().next().value);
  return false;
}
const methods={reference,ordered:DouyinAdapter.prototype.isDuplicateProtocolEvent};
function measure(name) {
  const state=create(),run=()=>{for(let i=0;i<1000;i++)assert.equal(methods[name].call(state,event,'http-poll'),true);};
  run();const samples=[];
  for(let i=0;i<11;i++){const start=performance.now();run();samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);
  return {medianMs:samples[5],p95Ms:samples[10],remainingEntries:state.seenProtocolEvents.size};
}
const runs=[];
for(let i=0;i<3;i++){const result={};for(const name of i%2?['ordered','reference']:['reference','ordered'])result[name]=measure(name);runs.push(result);}
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,scenario:'1000 cross-transport lookups with 20000 live entries',runs},null,2));
