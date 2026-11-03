import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiveMediaAnalyzer} from '../../src/browser/live-media.js';
import {MEDIA_DEFAULTS} from '../../src/services/media.js';
const config={...MEDIA_DEFAULTS,videoEnabled:true,visionModel:'qwen-vl-plus'};
test('停止感知中止正在识别的请求，旧回调不能影响新会话，实例之间状态独立',async()=>{
 let sample,oldEnded,resolve,signal,stops=0;const states=[];
 const a=new LiveMediaAnalyzer({capture:async o=>{sample=o.onSample;oldEnded=o.onEnded;return {stop:()=>stops++};},recognize:(_s,_c,options)=>{signal=options?.signal;return new Promise(r=>resolve=r);},onState:s=>states.push(s.state)});
 const b=new LiveMediaAnalyzer({capture:async()=>({stop(){}}),recognize:async()=>null});
 await a.start(config);const ended=oldEnded,pending=sample({kind:'video'});assert.equal(signal?.aborted,false);
 a.stop();assert.equal(signal.aborted,true);resolve({text:'迟到'});await pending;await a.start(config);ended();
 assert.equal(a.state,'running');assert.equal(b.state,'idle');assert.equal(stops,1);a.stop();assert.deepEqual(states,['starting','running','idle','starting','running','idle']);
});

test('采集启动失败、连续识别错误和来源结束均释放会话，可明确重新启动',async()=>{
 let attempts=0,sample,ended,closed=0;const errors=[];
 const a=new LiveMediaAnalyzer({capture:async o=>{if(++attempts===1)throw new Error('连接失败');sample=o.onSample;ended=o.onEnded;return {stop:()=>closed++};},recognize:async()=>{throw new Error('识别失败');},onError:e=>errors.push(e.message)});
 await assert.rejects(a.start(config),/连接失败/);assert.equal(a.state,'idle');
 await a.start(config);for(let i=0;i<3;i++)await sample({kind:'video'});assert.equal(a.state,'idle');assert.equal(closed,1);
 await a.start(config);ended();assert.equal(a.state,'idle');assert.equal(closed,2);assert.equal(errors.length,4);
});
