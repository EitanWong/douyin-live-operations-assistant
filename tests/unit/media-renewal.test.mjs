import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRenewingCapture} from '../../src/browser/media-renewal.js';
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
test('会话额度续接复用同一媒体源、保留识别记录，停止和迟到结果不会复活采集',async()=>{
 const sessions=[],rows=[],errors=[],states=[];let sources=0,releases=0;
 const capture=createRenewingCapture({renewDelayMs:0,sourceFactory:async()=>{sources++;return {stream:{},source:'display',stop(){releases++;}};},capture:async options=>{sessions.push(options);return {stop(){}};}});
 const controller=new AbortController(),handle=await capture({config:{inputSource:'direct'},signal:controller.signal,onObservation:r=>rows.push(r),onError:e=>errors.push(e),onProgress:s=>states.push(s)});
 sessions[0].onObservation({text:'主播的故事第一段'});
 sessions[0].onError(Object.assign(new Error('session tokens'),{mediaRenewal:'session'}));await flush();
 assert.equal(sessions.length,2);assert.equal(sources,1);assert.equal(releases,0);
 sessions[0].onObservation({text:'迟到的旧画面'});sessions[1].onObservation({text:'故事第二段'});
 assert.deepEqual(rows.map(r=>r.text),['主播的故事第一段','故事第二段']);assert.equal(errors.length,0);assert.ok(states.some(s=>s.phase==='renewing'));
 controller.abort();handle.stop();assert.equal(releases,1);
 sessions[1].onError(Object.assign(new Error('duration'),{mediaRenewal:'session'}));await flush();assert.equal(sessions.length,2);
});

test('小时限额等窗口恢复自动继续，手动停止取消待续接，真实服务错误不死循环',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:1800000000000});
 const sessions=[];let stopped=0;const errors=[];
 const capture=createRenewingCapture({sourceFactory:async()=>({stream:{},stop(){stopped++;}}),capture:async o=>{sessions.push(o);return {stop(){}};}});
 const handle=await capture({config:{},onObservation(){},onError:e=>errors.push(e)});
 sessions[0].onError(Object.assign(new Error('hourly'),{mediaRenewal:'hour',retryAt:Date.now()+10000}));
 t.mock.timers.tick(9999);await flush();assert.equal(sessions.length,1);
 t.mock.timers.tick(1);await flush();assert.equal(sessions.length,2);
 sessions[1].onError(new Error('服务商余额或鉴权错误'));await flush();assert.equal(errors.length,1);assert.equal(stopped,1);
 handle.stop();t.mock.timers.tick(3600000);await flush();assert.equal(sessions.length,2);
});

test('等待小时窗口期间结束共享源会立即结束任务，不能重新打开已结束的源',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:1800000000000});
 let sourceOptions,session,ended=0,released=0,opened=0;
 const capture=createRenewingCapture({sourceFactory:async o=>{sourceOptions=o;return {stream:{},stop(){released++;}};},capture:async o=>{opened++;session=o;return {stop(){}};}});
 const handle=await capture({config:{},onObservation(){},onEnded(){ended++;}});
 session.onError(Object.assign(new Error('hour'),{mediaRenewal:'hour',retryAt:Date.now()+10000}));
 sourceOptions.onEnded();t.mock.timers.tick(10000);await flush();
 assert.equal(ended,1);assert.equal(opened,1);assert.equal(released,1);handle.stop();
});
