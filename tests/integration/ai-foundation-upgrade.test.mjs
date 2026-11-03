import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {makeAIRequest} from '../../src/services/ai.js';
import {resolveMediaConfig} from '../../src/services/ai-pipeline.js';
import {validateMediaConfig} from '../../src/services/media.js';
import {AccountContext,accountSource,normalizeAccountPayload} from '../../src/ai/account-context.js';
import {FoundationSettings} from '../../src/ui/foundation-settings.js';
import {Panel} from '../../src/ui/panel.js';
import {awaitingVisual} from '../../src/ai/live-moment.js';
const flush=()=>new Promise(setImmediate);

test('public profile evidence enters the real AI request, and forgetting invalidates queued answers',async()=>{
 const now=Date.now(),url='https://www.douyin.com/user/target';let revision=0;
 const accounts=new AccountContext(),rows=normalizeAccountPayload({user:{sec_uid:'target',nickname:'陶艺主播',signature:'每周六分享陶艺'}},accountSource(url),now);
 accounts.replace('123',url,rows);
 const requests=[];const engine=new Engine({config:mergeConfig({anchorId:'123',ai:{enabled:true,chatEnabled:true}}),evidenceVersion:()=>revision,accountContext:q=>accounts.context('123',q),ai:async p=>{requests.push(makeAIRequest(p,engine.config.ai));return '公开简介写的是每周六分享陶艺。';}});
 engine.start();engine.requestChatAI({type:'chat',user:{id:'viewer',name:'观众'},text:'陶艺什么时候分享？'},true);await flush();
 const data=JSON.parse(requests[0].messages[1].content);assert.match(data.evidence_context.accounts[0].content,/每周六/);assert.equal(data.evidence_context.accounts[0].source,url);
 assert.equal(engine.queue.length,1);accounts.forget('123');revision++;assert.equal(engine.validChatReply(engine.queue[0]),false);engine.stop();
});
test('local Chinese perception needs no cloud ASR model or key; unrelated speech never waits for video',()=>{
 const c=mergeConfig({ai:{pipeline:{mode:'local-audio'}}});const media=resolveMediaConfig(c.ai);
 assert.equal(media.localAudio,true);assert.equal(media.audioEnabled,true);assert.equal(media.videoEnabled,false);assert.doesNotThrow(()=>validateMediaConfig(media,true));
 assert.equal(awaitingVisual({speech:{text:'今天忙了一整天，终于能聊会儿了',receivedAt:1000,endedAt:1000},alignment:'speech-only'},1100,true),false);
 assert.equal(awaitingVisual({speech:{text:'看看这两个杯子哪个好看？',receivedAt:1000,endedAt:1000},alignment:'speech-only'},1100,true),true);
});
test('account evidence expiry invalidates a queued reply before its normal chat freshness expires',async()=>{
 let now=Date.now();const accounts=new AccountContext({now:()=>now}),url='https://www.douyin.com/user/target';
 const rows=normalizeAccountPayload({user:{sec_uid:'target',nickname:'陶艺',signature:'周六开课'}},accountSource(url),now).map(r=>({...r,expiresAt:now+1000}));
 accounts.replace('123',url,rows);
 const engine=new Engine({now:()=>now,config:mergeConfig({anchorId:'123',ai:{enabled:true,chatEnabled:true}}),evidenceVersion:()=>accounts.version('123'),accountContext:q=>accounts.context('123',q),ai:async()=> '简介写的是周六。'});
 try{
  engine.start();engine.requestChatAI({type:'chat',user:{id:'viewer',name:'观众'},text:'陶艺课哪天？'},true);await flush();
  assert.equal(engine.queue.length,1);assert.equal(engine.validChatReply(engine.queue[0]),true);
  now+=2000;assert.equal(engine.validChatReply(engine.queue[0]),false);
 }finally{engine.stop();}
});
test('settings prepare the selected Chinese backend, collect bounded sources and clear stale context',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',pretendToBeVisual:true});
 const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location};
 Object.assign(globalThis,{document:dom.window.document,window:dom.window,location:dom.window.location});
 let panel,settings,failRefresh=false;const calls=[],errors=[],accounts=new AccountContext();
 try{
  panel=new Panel({config:mergeConfig({anchorId:'123'}),callbacks:{}});
  settings=new FoundationSettings(panel.root,{anchor:()=> '123',accounts,changed:async()=>{},onError:e=>errors.push(e),edge:{prepare:async(kind,backend)=>{calls.push([kind,backend]);return {phase:'ready'};}},collector:{collect:async url=>{if(failRefresh)throw Error('页面已不可见');return normalizeAccountPayload({user:{sec_uid:'target',nickname:'陶艺',signature:'<img src=x onerror=alert(1)>作品'}},accountSource(url));},cancel:async()=>{}}});
  panel.root.querySelector('[data-field="ai.edge.audioBackend"]').value='native-sensevoice';panel.root.querySelector('[data-edge-prepare="audio"]').click();await flush();assert.deepEqual(calls,[['audio','native-sensevoice']]);
  panel.root.querySelector('[data-account-url]').value='https://www.douyin.com/user/target';panel.root.querySelector('[data-account-collect]').click();await flush();
  assert.equal(accounts.list('123').length,1);assert.equal(panel.root.querySelector('[data-account-records] img'),null);
  failRefresh=true;panel.root.querySelector('[data-account-collect]').click();await flush();
  assert.match(errors[0].message,/不可见/);assert.equal(accounts.list('123').length,0);assert.deepEqual(accounts.context('123','陶艺'),[]);
  panel.root.querySelector('[data-account-clear]').click();await flush();assert.equal(accounts.list('123').length,0);
 }finally{settings?.close();panel?.destroy();clearTimeout(panel?.toastTimer);dom.window.close();Object.assign(globalThis,previous);}
});
