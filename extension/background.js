import {createKnowledgeCorpus} from '../src/ai/knowledge-corpus.js';
import {createAutomaticKnowledge} from '../src/services/automatic-knowledge.js';
import {validateMemory} from '../src/services/knowledge.js';
import {mergeConfig,validateConfig} from '../src/core/engine.js';
import {createSharedKnowledge,SHARED_KNOWLEDGE_KEY,projectSharedKnowledge} from '../src/services/shared-knowledge.js';
import {AI_SECRET_PREFIXES,isAISecretKey} from '../src/services/shared-ai-services.js';
import {createRelationshipLibrary} from '../src/ai/relationship-library.js';
import {installNativeASRBridge} from './native-asr.js';
import {installEdgeBridge} from './edge-background.js';
import {requestNativeDeployment} from './native-deployment.js';
import {collectAccountWithMedia,createLocalMediaRequest,authorizeLocalMediaEndpoint} from './account-media.js';
import {createPublicMediaVisualAnalyzer} from './public-media-visual.js';
import {createAccountResearch} from './account-research.js';
import {createPublicMediaResearch} from './public-media-research.js';
import {createPublicMediaProfileResolver} from './public-media-profile.js';
import {publicMediaWorkerClient} from './public-media-worker-client.js';
import {checkResearchProfile} from '../src/ai/research-profile.js';
import {installNativePerceptionBridge} from './native-perception.js';
import {createBackgroundAI} from './ai-background.js';
import {APPEARANCE_PREFERENCES} from '../src/ui/appearance.js';
import {validateRealtimeEndpoint,validateSDP} from '../src/services/ai-pipeline.js';
import { roomFromURL } from '../src/browser/room-context.js';
import { accessPage } from './page-access.js';
import { ProtocolCache } from './protocol-cache.js';
import { fanclubFrameContext, cleanFanclubSnapshot } from '../src/data/fanclub.js';
import { validateEndpoint } from '../src/services/ai.js';
import { validateSearchEndpoint, validateSearchBody } from '../src/services/search.js';
import {validateWeatherURL} from '../src/services/weather.js';
import {validatePublicDataURL} from '../src/services/public-data.js';
import {createMediaClient,validateMediaRequest,MEDIA_REQUEST_LIMIT} from '../src/services/media.js';
import { GiftStore } from '../src/data/gifts.js';
import { DurableStorage, isDurableKey } from './durable-storage.js';
import { installCollectionKeeper } from './collection-keeper.js';
import {parseGiveawayState} from '../src/core/giveaway.js';
import {createPredictionBackground} from './prediction-background.js';
import {mergeLiveMemory} from '../src/ai/live-memory.js';
import {persistNativeMemory} from './live-memory.js';
import {LocalDataEngine,nativeDataRequest} from './local-data.js';
import {createOpponentCollector} from './opponent-collector.js';
import {parsePulse} from '../src/analytics/schema.js';

const collectionKeeper = installCollectionKeeper(chrome);
installNativePerceptionBridge(chrome,{onStart:async room=>{await storageReady;return readRecord(`live-assistant:config:${room}`);},onObservation:async(room,row,scope)=>{await storageReady;await persistNativeMemory({room,row,scope,read:readRecord,write:writeRecord,transaction:work=>giftStore.transaction(work)});}});
installEdgeBridge(chrome);
const modelOwnership=installNativeASRBridge(chrome);
const accountCollections=new Map();

const durableStorage = new DurableStorage({ local:chrome.storage.local });
const storageReady = (async()=>{ await chrome.storage.local.setAccessLevel({ accessLevel:'TRUSTED_CONTEXTS' }); await durableStorage.migrate(); })();
void storageReady.catch(()=>{});
const durableKey = isDurableKey;
const rawReadRecord = async key => durableKey(key) ? durableStorage.get(key) : (await chrome.storage.local.get(key))[key];
const readRecord = async key => /^live-assistant:config:\d+$/u.test(key) ? sharedKnowledge.config(key.split(':').at(-1)) : rawReadRecord(key);
const sharedKnowledge=createSharedKnowledge({read:rawReadRecord,all:()=>durableStorage.getAll(['live-assistant:config:']),commit:async rows=>{
 await durableStorage.putRecords(rows);
 await notifyChanges(Object.fromEntries(rows.map(([key,value])=>[key,{newValue:value}])));
}});
let predictionHost;
let localData;
let publicMedia;
const publicMediaPrivacy=new Map();
const dataEngine=()=>localData ||=new LocalDataEngine({request:nativeDataRequest(chrome)});
const opponentCollector=createOpponentCollector(chrome);
const readAll = async () => durableStorage.getAll(['live-assistant:config:','live-assistant:profile:']);
const writeRecord = async (key,value) => {
  if(/^live-assistant:config:\d+$/u.test(key))return sharedKnowledge.saveRoom(key,value);
  if (!durableKey(key)) return writeStorage(key,value);
  await durableStorage.set(key,value);
  await notifyChanges({[key]:{newValue:value}});
};
const knowledgeCorpus=createKnowledgeCorpus({read:readRecord,write:writeRecord,archive:async({room,anchor,at,...payload})=>{await dataEngine().enqueue({id:`knowledge:${room}:${anchor}:${payload.sequence}`,room,anchor,kind:'knowledge',receivedAt:at,payload});void dataEngine().flush();}});
const automaticKnowledge=createAutomaticKnowledge({corpus:knowledgeCorpus,all:()=>durableStorage.getAll(['live-assistant:knowledge:','live-assistant:config:']),readAudience:async(room,anchor)=>(await readRecord(`live-assistant:live-memory:${room}:${anchor}`))?.audience,readProfile:room=>readRecord(`live-assistant:profile:${room}`),readConfig:room=>readRecord(`live-assistant:config:${room}`)});
const mediaVisual=createPublicMediaVisualAnalyzer({authorizeResource:endpoint=>authorizeLocalMediaEndpoint(chrome,endpoint),readConfig:room=>readRecord(`live-assistant:config:${room}`),resolveProfile:createPublicMediaProfileResolver(readRecord),checkProfile:input=>checkResearchProfile({...input,read:readRecord}),readVersion:(room,anchor)=>automaticKnowledge.handle(room,'version',{anchor}),canArchive:()=>dataEngine().enabled(),backgroundAllowed:()=>modelOwnership.backgroundAllowed(),recognize:createMediaClient({request:createLocalMediaRequest(chrome),getKey:()=>''})});
const mediaWorker=publicMediaWorkerClient(chrome,{analyzeVisual:mediaVisual,allowed:()=>modelOwnership.backgroundAllowed(),onResult:()=>{void publicMedia?.wakeAll().catch(()=>{});}});
publicMedia=createPublicMediaResearch({readConfig:room=>readRecord(`live-assistant:config:${room}`),resolveProfile:createPublicMediaProfileResolver(readRecord),checkProfile:input=>checkResearchProfile({...input,read:readRecord}),request:nativeDataRequest(chrome),worker:mediaWorker,knowledge:automaticKnowledge,canArchive:()=>dataEngine().enabled(),readPrivacy:async(room,anchor)=>(await readRecord(`live-assistant:live-memory:${room}:${anchor}`))?.audience ?? null});
const accountResearch=createAccountResearch({readConfig:room=>readRecord(`live-assistant:config:${room}`),readBudget:()=>readRecord('live-assistant:account-budget'),writeBudget:rows=>writeRecord('live-assistant:account-budget',rows),
  readProgress:(room,anchor)=>readRecord(`live-assistant:account-progress:${room}:${anchor}`),writeProgress:(room,anchor,value)=>writeRecord(`live-assistant:account-progress:${room}:${anchor}`,value),
  collect:(url,options)=>collectAccountWithMedia(chrome,url,{...options,readAI:async()=>{const c=await readRecord(`live-assistant:config:${options.room}`);return String(c?.anchorId)===options.anchor && c?.ai?.accountCollection?.enabled!==false ? c.ai : null;}}),archive:async({room,anchor,source,records,media,at})=>{
    await dataEngine().enqueue({id:`account:${crypto.randomUUID()}`,room,anchor,kind:'account',receivedAt:at,payload:{source,records}});void dataEngine().flush();
    try{const result=await publicMedia.collect({room,anchor,records,media});if(result.error)for(const work of records.filter(r=>r.kind==='work'))work.coverage=`${work.coverage || ''}；${result.error}`.slice(0,500);}
    catch{for(const work of records.filter(r=>r.kind==='work'))work.coverage=`${work.coverage || ''}；完整音轨任务未启动，请检查本地数据组件和感知组件`.slice(0,500);}
  }});
const relationshipLibrary=createRelationshipLibrary({all:()=>durableStorage.getAll(['live-assistant:config:','live-assistant:profile:','live-assistant:runtime:','live-assistant:live-memory:','live-assistant:knowledge:'])});
const deleteRecord = async keys => {
  const list = Array.isArray(keys) ? keys : [keys], durable = list.filter(durableKey), local = list.filter(key=>!durableKey(key));
  if (durable.length) await durableStorage.remove(durable);
  if (local.length) await chrome.storage.local.remove(local);
  await notifyChanges(Object.fromEntries(list.filter(isAISecretKey).map(key=>[key,{newValue:undefined}])));
};
const giftStore = new GiftStore({
  get: async (key, fallback) => await readRecord(key) ?? fallback,
  set: async (key, value) => writeRecord(key, value),
  all: readAll
});
const themeKey = APPEARANCE_PREFERENCES.theme.key;
const themeValues = new Set(APPEARANCE_PREFERENCES.theme.values);
const roomFromUrl = value => {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://live.douyin.com') return null;
    return roomFromURL(url);
  } catch { return null; }
};
const isRoom = sender => sender.frameId === 0 && Boolean(roomFromUrl(sender.tab?.url)) && (!sender.url || roomFromUrl(sender.url) === roomFromUrl(sender.tab.url));
const keyAllowed = key => typeof key === 'string' && /^live-assistant:(config:\d+|runtime:\d+|live-memory:\d+:(?:\d{1,40}|unknown)|income-calibration:\d+|event:\d+:[a-z\d-]+|(?:api-key|search-key|media-key):https?:\/\/[^\s/]+)$/.test(key);
const jsonLength = value => {
  try { const text = JSON.stringify(value); return typeof text === 'string' ? text.length : null; }
  catch { return null; }
};
const eventTypes = new Set(['anchor-fanclub','room-likes','gift','like','chat','enter','start','end','pk-start','pk-score','pk-end','pk-multiplier','pk-card','pk-contribution','pk-effect','anchor-pk-tasks','room-state','room-stats','room-audience','social','fansclub','emoji-chat','screen-chat','room-notice','room-rank','rank-update','room-notify','room-sync','audio-chat','highlight-comment','light-gift','live-shopping','product-change','room-banner','rank-award','red-packet','activity-signal','chat-like','fan-ticket','room-activity-state','gift-panel-state','room-indicator','gift-catalog','battle-bonus','battle-property','battle-season-honor','popular-card','fansclub-statistics','group-live-members','group-live-income','room-ticket','linkmic-positions','link-state','guest-link-state','fansclub-push','anchor-exhibition','pk-rank-season']);
const validEvent = (event, maxBytes) => {
  try {
    const size = jsonLength(event);
    return Boolean(event) && eventTypes.has(event.type) && size != null && size <= maxBytes &&
      (event.text == null || typeof event.text === 'string') &&
      (event.user?.name == null || typeof event.user.name === 'string') &&
      (event.user?.fanClubs == null || Array.isArray(event.user.fanClubs));
  } catch { return false; }
};
const validProtocolFrame = record => {
  try {
    const size = jsonLength(record);
    const rawValid = record?.captureError === 'FRAME_TOO_LARGE'
      ? record.rawBase64 == null && record.rawBytes > 512 * 1024
      : record?.rawBytes <= 512 * 1024 && typeof record.rawBase64 === 'string' && record.rawBase64.length === Math.ceil(record.rawBytes / 3) * 4;
    return Boolean(record) && record.protocolVersion === 1 && ['socket','http-poll'].includes(record.transport) &&
      Number.isFinite(record.receivedAt) && record.receivedAt > 0 && Number.isSafeInteger(record.rawBytes) && record.rawBytes >= 0 &&
      size != null && size <= 900000 && Array.isArray(record.messages) && record.messages.length <= 500 &&
      record.messages.every(item => item && typeof item.method === 'string' && /^[A-Za-z0-9_]{1,120}$/.test(item.method) &&
        (item.messageId == null || typeof item.messageId === 'string' && item.messageId.length <= 80) &&
        Array.isArray(item.decodedTypes) && item.decodedTypes.length <= 16 && item.decodedTypes.every(type => typeof type === 'string' && /^[a-z0-9-]{1,64}$/.test(type))) &&
      (record.messagesOmitted == null || Number.isSafeInteger(record.messagesOmitted) && record.messagesOmitted >= 0 && record.messagesOmitted <= 100000) &&
      rawValid && (record.rawBase64 == null || record.rawBase64.length <= 700000 && /^[A-Za-z0-9+/]*={0,2}$/.test(record.rawBase64)) &&
      (record.rawEncoding == null || record.rawEncoding === 'utf8-text') &&
      (record.parseError == null || typeof record.parseError === 'string' && record.parseError.length <= 240) &&
      (record.captureError == null || record.captureError === 'FRAME_TOO_LARGE');
  } catch { return false; }
};
async function storageUsage() {
  const used = chrome.storage.local.getBytesInUse ? await chrome.storage.local.getBytesInUse(null) : null;
  // Chrome 111/112 have a smaller quota; honor the runtime's actual value.
  const quota = chrome.storage.local.QUOTA_BYTES || 5*1024*1024;
  return {used,quota,ratio:used == null ? null : used/quota};
}
// Diagnostic history is disposable. Unacknowledged events, runtime checkpoints,
// settings and income data are never candidates, including from other rooms.
// ProtocolCache owns diagnostic writes and maintenance independently of the ledger.
const protocolCache = new ProtocolCache({local:chrome.storage.local,usage:storageUsage});
const maintainStorage = (reserveBytes=0,force=false) => protocolCache.maintain(reserveBytes,force);
async function storageStatus() {
  const cache = await maintainStorage(), durable = await durableStorage.usage();
  return {...cache,durable};
}
async function writeStorage(key, value) {
  await maintainStorage((key.length + (jsonLength(value) || 0)) * 3);
  try { await chrome.storage.local.set({[key]:value}); }
  catch (error) {
    if (!/quota|配额|QUOTA_BYTES/i.test(error.message)) throw error;
    await maintainStorage((key.length + (jsonLength(value) || 0)) * 3, true);
    await chrome.storage.local.set({[key]:value});
  }
}
let aiBackground;const getAIBackground=()=>aiBackground ||= createBackgroundAI({chrome,readRecord,readConfigs:()=>durableStorage.getAll(['live-assistant:config:']),knowledge:automaticKnowledge,relationships:(room,query,options)=>relationshipLibrary.query(room,query,{},options),collectAccount:(room,url,options)=>accountResearch.collect(room,url,options)});
const activeAIRequests=new Map(),cancelledAIRequests=new Set();
chrome.alarms?.onAlarm?.addListener(alarm=>{if(alarm.name==='ai-task-wake'){void getAIBackground().wake().catch(()=>{});void storageReady.then(()=>publicMedia.wakeAll()).catch(()=>{});}});
chrome.alarms?.create?.('ai-task-wake',{periodInMinutes:1});
void storageReady.then(()=>publicMedia.wakeAll()).catch(()=>{});
chrome.runtime.onMessage.addListener((message,sender,reply) => {
  if(['edge-offscreen','edge-background'].includes(message?.target))return;
  if (message?.type === 'fanclub-frame') {
    void (async()=>{
      try {
        const context=fanclubFrameContext(sender.url),input=message.event;
        if (!context || sender.frameId<=0 || !sender.tab?.id || !roomFromUrl(sender.tab.url)
          || input?.type!=='anchor-fanclub' || input.source!=='native-fanclub'
          || input.anchorId!==context.anchorId || input.roomId!==context.roomId
          || !Array.isArray(input.members) || input.members.length>10) throw new Error('粉丝团来源无效');
        const event=cleanFanclubSnapshot({...input,viewer:context.viewer,clubId:context.clubId});
        if (!event || event.receivedAt>Date.now()+1000 || !validEvent(event,12000)) throw new Error('粉丝团数据无效');
        event.id=`fansclub:frame:${sender.frameId}:${event.snapshotId}:${event.chunk}`;
        const result=await chrome.tabs.sendMessage(sender.tab.id,{type:'fanclub-frame',frameURL:sender.url,event},{frameId:0});
        reply({ok:result?.ok===true});
      } catch {reply({ok:false});}
    })();
    return true;
  }
  if (message?.type === 'exhibition-indicator') {
    void (async()=>{
      try {
        const url = new URL(sender.url), event = message.event;
        if (sender.frameId <= 0 || !sender.tab?.id || !roomFromUrl(sender.tab.url)
          || url.origin !== 'https://lf-normal-gr-sourcecdn.bytegecko.com'
          || url.pathname !== '/obj/byte-gurd-source-gr/webcast/mono/h5/live_pc_indicator_container_douyin/pages/index.html'
          || event?.type !== 'anchor-exhibition-retention' || event.source !== 'native-indicator'
          || event.anchorId !== (url.searchParams.get('anchor_id_str') || url.searchParams.get('anchor_id'))
          || event.roomId !== url.searchParams.get('room_id') || !Number.isSafeInteger(event.remaining) || event.remaining < 0 || event.remaining > 10000
          || typeof event.name !== 'string' || event.name.length > 20 || typeof event.text !== 'string' || event.text.length > 200) throw new Error('指标来源无效');
        const value = await chrome.tabs.sendMessage(sender.tab.id,{type:'exhibition-indicator',frameURL:url.href,event:{
          type:event.type,source:event.source,anchorId:event.anchorId,roomId:event.roomId,name:event.name,text:event.text,remaining:event.remaining,
          id:`retention:frame:${sender.frameId}:${Date.now()}`,receivedAt:Date.now()}},{frameId:0});
        reply({ok:value?.ok === true});
      } catch { reply({ok:false}); }
    })();
    return true;
  }
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL('')) && !sender.tab;
  if (!isRoom(sender) && !extensionPage) { reply({ok:false,error:'请求来源无效'}); return; }
  void (async()=>{
    try {
      await storageReady;
      let value;
      if(message.type==='data-configure' && extensionPage){value=await dataEngine().configure(message.enabled);if(message.enabled)void dataEngine().flush();void publicMedia.wakeAll().catch(()=>{});}
      else if(message.type==='data-flush' && extensionPage){await dataEngine().flush();value=await dataEngine().status();}
      else if(message.type==='data-relocate' && extensionPage){
        if(typeof message.directory!=='string' || message.directory.length>4096 || typeof message.expectedDatabase!=='string' || message.expectedDatabase.length>4096)throw Error('存储位置无效，请刷新状态后重试');
        value=await nativeDataRequest(chrome,120000)('relocate',{directory:message.directory,expectedDatabase:message.expectedDatabase});
        void dataEngine().flush();
      }
      else if(message.type==='data-status' && extensionPage){
        const status=await dataEngine().status();let native=null;
        try{native=await nativeDataRequest(chrome)('status');}catch{ /* Report unavailable explicitly; never enable implicitly. */ }
        value={...status,native};
      }else if(message.type==='data-context' && isRoom(sender))value=await opponentCollector.context(sender);
      else if(message.type==='data-records' && isRoom(sender)){
        if(!await dataEngine().enabled()){value=false;reply({ok:true,value});return;}
        if(!Array.isArray(message.records) || message.records.length>32 || jsonLength(message.records)>650000)throw Error('本地归档批次无效');
        const room=roomFromUrl(sender.tab.url),config=await readRecord(`live-assistant:config:${room}`);
        const collector=await opponentCollector.context(sender);
        for(const row of message.records){
          if(!row || typeof row.id!=='string' || row.id.length>100 || !['event','protocol','coverage'].includes(row.kind) || row.receivedAt>Date.now() || row.kind==='event' && !(validEvent(row.payload,500000) || row.payload?.type==='anchor-exhibition-retention' && jsonLength(row.payload)<12000))throw Error('本地归档事件无效');
          await dataEngine().enqueue({...row,id:`${room}:${sender.documentId || sender.tab.id}:${row.id}`,room,anchor:String(config?.anchorId || ''),payload:row.kind==='coverage' && collector?{...row.payload,ownerRoom:collector.ownerRoom}:row.payload});
        }
        void dataEngine().flush();value=true;
      }else if(['data-opponent-open','data-opponent-stop','data-opponent-list'].includes(message.type) && extensionPage){
        const tab=await chrome.tabs.get(message.tabId),owner={frameId:0,tab,url:tab.url};
        if(message.type==='data-opponent-open'){
          if(!await dataEngine().enabled())throw Error('请先启用本地归档');
          value=await opponentCollector.open(owner,message.room);
        }else value=await opponentCollector[message.type==='data-opponent-stop'?'stop':'list'](owner);
      }else if(message.type==='prediction' && isRoom(sender)){
        predictionHost ||=createPredictionBackground({readRecord});
        value=await predictionHost.handle(message,roomFromUrl(sender.tab.url));
        if(message.action==='pulse' && await dataEngine().enabled()){
          const room=roomFromUrl(sender.tab.url),at=Date.now(),pulse=parsePulse(message.value,at);
          await dataEngine().enqueue({id:`pk-state:${crypto.randomUUID()}`,room,anchor:message.anchor,kind:'pk-state',receivedAt:at,payload:pulse});
          void dataEngine().flush();
        }
        if(message.action==='report' && !value.simulated && await dataEngine().enabled()){
          const room=roomFromUrl(sender.tab.url);
          await dataEngine().enqueue({id:`report:${room}:${message.anchor}:${value.asOf}`,room,anchor:message.anchor,kind:'forecast',receivedAt:value.asOf,payload:value});
          void dataEngine().flush();
          value=await dataEngine().enrich(room,message.anchor,value);
        }
      }else if(message.type==='knowledge-corpus' && isRoom(sender)){
        value=await automaticKnowledge.handle(roomFromUrl(sender.tab.url),message.action,message.input);
      }else if(message.type==='relationship-query' && isRoom(sender)){
        const override={};
        if(message.memory!==undefined)override.memory=validateMemory(message.memory);
        const graphOptions={browse:message.browse===true,overview:message.overview===true,entityIds:Array.isArray(message.entityIds) ? [...new Set(message.entityIds.filter(id=>typeof id==='string' && id.startsWith('person:') && id.length<=4000))].slice(0,6) : [],status:['verified','unverified','observed','conflicted'].includes(message.status) ? message.status : 'all',...(typeof message.recordId==='string' && message.recordId.length<=4000 ? {recordId:message.recordId} : {})};
        await sharedKnowledge.ensure();value=await relationshipLibrary.query(roomFromUrl(sender.tab.url),message.query,override,graphOptions);
      }else if(message.type==='account-search' && isRoom(sender)){
        if(typeof message.query!=='string' || !message.query.trim() || message.query.length>80)throw new Error('请输入80字以内的抖音搜索词');
        await chrome.tabs.create({url:`https://www.douyin.com/search/${encodeURIComponent(message.query.trim())}?type=general`,active:true});value=true;
      }else if(message.type==='account-collect' && isRoom(sender)){
        const key=sender.tab.id;if(accountCollections.has(key))throw new Error('账号采集正在进行');
        const controller=new AbortController();accountCollections.set(key,controller);
        try{
          value=await accountResearch.collect(roomFromUrl(sender.tab.url),message.url,{signal:controller.signal});
        }finally{accountCollections.delete(key);}
      }else if(message.type==='account-cancel' && isRoom(sender)){accountCollections.get(sender.tab.id)?.abort();value=true;}
      else if (message.type === 'page-command' && isRoom(sender)) value = await accessPage(chrome,sender,message.command);
      else if(message.type==='ai-credentials-read' && isRoom(sender))value=await durableStorage.getAll(AI_SECRET_PREFIXES);
      else if (message.type === 'init' && isRoom(sender)) {
        const room=roomFromUrl(sender.tab.url),shared=await sharedKnowledge.ensure();
        const values=await durableStorage.getAll(['live-assistant:config:','live-assistant:runtime:',`live-assistant:live-memory:${room}:`,'live-assistant:income-calibration:',...AI_SECRET_PREFIXES]);
        values[`live-assistant:config:${room}`] ||= {};
        value=Object.fromEntries(Object.entries(values).filter(([key])=>keyAllowed(key) && !key.startsWith('live-assistant:event:')).map(([key,value])=>[key,/^live-assistant:config:\d+$/u.test(key) ? projectSharedKnowledge(value,shared) : value]));
      }
      else if (['rewards-read','rewards-write'].includes(message.type) && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url);
        if (typeof message.key !== 'string' || !new RegExp(`^live-assistant:rewards:${room}:[1-9]\\d{0,24}$`).test(message.key)) throw new Error('活动记录范围无效');
        if (message.type === 'rewards-read') value = await durableStorage.get(message.key) || [];
        else {
          if (!Array.isArray(message.records) || message.records.length > 100 || jsonLength(message.records) > 50000) throw new Error('活动记录无效');
          await durableStorage.set(message.key,message.records);value=true;
        }
      }
      else if (['giveaway-read','giveaway-write'].includes(message.type) && isRoom(sender)) {
        const room=roomFromUrl(sender.tab.url),key=`live-assistant:giveaway:${room}`;
        if(message.key!==key)throw new Error('抽奖记录范围无效');
        if(message.type==='giveaway-read')value=await durableStorage.get(key) ?? null;
        else {
          const size=jsonLength(message.value);if(size==null || size>16*1024*1024)throw new Error('抽奖记录过大，请先导出历史记录');
          const state=parseGiveawayState(message.value,room);await durableStorage.set(key,state);value=true;
        }
      }
      else if(message.type==='native-deployment' && isRoom(sender))value=await requestNativeDeployment(chrome,message.action);
      else if (['agent-submit','agent-list','agent-cancel'].includes(message.type) && isRoom(sender)) value=await getAIBackground().handle(message,roomFromUrl(sender.tab.url));
      else if(message.type==='ai-request-cancel' && isRoom(sender) && typeof message.id==='string' && /^[a-z\d-]{16,80}$/iu.test(message.id)){const key=`${sender.tab.id}:${message.id}`;cancelledAIRequests.add(key);while(cancelledAIRequests.size>128)cancelledAIRequests.delete(cancelledAIRequests.values().next().value);activeAIRequests.get(key)?.abort();value=true;}
      else if (message.type === 'collection-state' && isRoom(sender)) value = await collectionKeeper.update(sender,message.active);
      else if (message.type === 'theme-get' && (isRoom(sender) || extensionPage)) value = await readRecord(themeKey) ?? 'system';
      else if (message.type === 'theme-set' && (isRoom(sender) || extensionPage) && themeValues.has(message.value)) {
        await giftStore.transaction(() => writeRecord(themeKey,message.value)); value=true;
      }
      else if (['appearance-get','appearance-set'].includes(message.type) && ['palette','material'].includes(message.kind) && (isRoom(sender) || extensionPage)) {
        const preference=APPEARANCE_PREFERENCES[message.kind];
        if(message.type==='appearance-get')value=await readRecord(preference.key) ?? preference.fallback;
        else {if(!preference.values.includes(message.value))throw new Error('外观选项无效');await giftStore.transaction(()=>writeRecord(preference.key,message.value));value=true;}
      }
      else if(message.type==='save-config' && isRoom(sender)){
        if(jsonLength(message.config)>1024*1024 || jsonLength(message.base)>1024*1024)throw Error('设置过大');
        value=await sharedKnowledge.save(roomFromUrl(sender.tab.url),validateConfig(mergeConfig(message.config)),validateConfig(mergeConfig(message.base)));
        void getAIBackground().wake().catch(()=>{});
      }
      else if (message.type === 'set' && keyAllowed(message.key) && isRoom(sender)) {
        // Pending delivery state must not be truncated or rejected at the config limit.
        // Database failures retain the event journal for recovery.
        const size = jsonLength(message.value);
        if (size == null) throw Object.assign(new Error('设置无法序列化'),{code:'INVALID_CONFIG'});
        if (!message.key.startsWith('live-assistant:runtime:') && !message.key.startsWith('live-assistant:live-memory:') && size > 1024*1024) throw new Error('设置过大');
        if(message.key.startsWith('live-assistant:live-memory:') && !message.key.startsWith(`live-assistant:live-memory:${roomFromUrl(sender.tab.url)}:`))throw new Error('直播记忆范围无效');
        if(message.key.startsWith('live-assistant:live-memory:') && message.key.split(':').at(-1)!==(message.value?.anchor || 'unknown'))throw new Error('直播记忆归属无效');
        await giftStore.transaction(async() => writeRecord(message.key,message.key.startsWith('live-assistant:live-memory:') ? mergeLiveMemory(await readRecord(message.key),message.value) : message.value));
        if(message.key.startsWith('live-assistant:config:'))void getAIBackground().wake().catch(()=>{});value=true;
      }
      else if (message.type === 'delete' && keyAllowed(message.key) && isRoom(sender)) {
        if(message.key.startsWith('live-assistant:live-memory:'))throw new Error('请通过记忆管理清空内容，保留删除标记');
        await deleteRecord(message.key); value=true;
      }
      else if (message.type === 'event-append' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url), event = message.event;
        if (!validEvent(event, 12000)) throw Object.assign(new Error('直播事件无效'),{code:'INVALID_EVENT'});
        const id = typeof message.id === 'string' && /^[a-z\d-]{16,64}$/i.test(message.id) ? message.id : crypto.randomUUID();
        const key = `live-assistant:event:${room}:${id}`;
        value = await giftStore.transaction(async()=>{
          if (await readRecord(key)) return {key};
          const durableEvent = event.id ? event : {...event,id:`journal:${id}`};
          await writeRecord(key,{event:durableEvent,savedAt:Date.now()}); return {key};
        });
      }
      else if (message.type === 'protocol-append' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url), record = message.record;
        if (!validProtocolFrame(record)) throw Object.assign(new Error('协议帧记录无效或超过单条上限'),{code:'INVALID_PROTOCOL_FRAME'});
        const id = typeof message.id === 'string' && /^[a-z\d-]{16,64}$/i.test(message.id) ? message.id : crypto.randomUUID();
        const key = `live-assistant:protocol:${room}:${id}`;
        value = await protocolCache.append(key,record);
      }
      else if (message.type === 'protocol-list' && isRoom(sender)) {
        value = await protocolCache.list(roomFromUrl(sender.tab.url),message.after,Math.min(100,Math.max(1,Number(message.limit)||100)));
      }
      else if (message.type === 'event-list' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url), prefix = `live-assistant:event:${room}:`;
        value = await durableStorage.listEvents(room,message.after,Math.min(256,Math.max(1,Number(message.limit) || 256)));
      }
      else if (message.type === 'storage-status' && isRoom(sender)) value = await storageStatus();
      else if (message.type === 'storage-clear-cache' && isRoom(sender)) value = await (async()=>{ await protocolCache.clear();return storageStatus(); })();
      else if (message.type === 'event-ack' && isRoom(sender) && typeof message.key === 'string') {
        const room = roomFromUrl(sender.tab.url), prefix = `live-assistant:event:${room}:`;
        if (!message.key.startsWith(prefix) || !keyAllowed(message.key)) throw new Error('事件确认范围无效');
        await deleteRecord(message.key); value=true;
      }
      else if (message.type === 'event-ack-many' && isRoom(sender) && Array.isArray(message.keys) && message.keys.length <= 100) {
        const room = roomFromUrl(sender.tab.url), prefix = `live-assistant:event:${room}:`;
        if (message.keys.some(key => typeof key !== 'string' || !key.startsWith(prefix) || !keyAllowed(key))) throw new Error('事件确认范围无效');
        await deleteRecord(message.keys); value=true;
      }
      else if (message.type === 'income-profiles' && isRoom(sender)) value = await giftStore.profiles();
      else if (message.type === 'income-profile' && isRoom(sender)) value = await giftStore.profile(message.profile);
      else if (message.type === 'income-report' && isRoom(sender)) value = await giftStore.report(String(message.room), message.month, {includeAllSessions:message.includeAllSessions === true});
      else if (message.type === 'income-session' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url);
        value = await giftStore.recordSession({...message, room, type:message.boundaryType});
      }
      else if (message.type === 'contribution-snapshot' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url), config = await readRecord(`live-assistant:config:${room}`);
        value = config?.incomeEnabled === false ? false : await giftStore.recordContributionSnapshot({...message,room});
      }
      else if (message.type === 'contribution-record' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url);
        const config = await readRecord(`live-assistant:config:${room}`);
        value = config?.incomeEnabled === false ? false : await giftStore.recordContribution({...message, room});
      }
      else if (message.type === 'gift-record' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url);
        const event = message.event;
        let valid = validEvent(event, 4000);
        try { valid = valid && (event.unitValue == null || (Number.isFinite(event.unitValue) && event.unitValue >= 0 && event.unitValue <= 1e9)); } catch { valid = false; }
        if (!valid) throw Object.assign(new Error('礼物记录无效'),{code:'INVALID_EVENT'});
        const config = await readRecord(`live-assistant:config:${room}`);
        if (config?.incomeEnabled === false) value = false;
        else value = await giftStore.record({ room, event, userKey: message.userKey, rate: message.rate, capturedAt:message.capturedAt });
      }
      else if(message.type==='media-sdp' && isRoom(sender)){
        const url=validateRealtimeEndpoint(message.url);validateSDP(message.data);
        if(typeof message.headers?.Authorization!=='string' || !/^Bearer [^\s]{1,1000}$/u.test(message.headers.Authorization))throw new Error('百炼实时认证无效');
        if(!await chrome.permissions.contains({origins:[`${new URL(url).origin}/*`]}))throw new Error('请点击扩展图标，授权音视频服务域名后重试');
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
        try{
          const response=await fetch(url,{method:'POST',credentials:'omit',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/sdp',Authorization:message.headers.Authorization},body:message.data});
          const text=await response.text();if(response.status>=200 && response.status<300)validateSDP(text);
          value={status:response.status,responseText:response.status>=200 && response.status<300 ? text : '',finalUrl:response.url};
        }finally{clearTimeout(timeout);}
      }
      else if (['ai','search','media','weather','public-data'].includes(message.type) && isRoom(sender)) {
        const searching=message.type==='search',weather=['weather','public-data'].includes(message.type);
        const provider=message.provider || (String(message.url).endsWith('/web-search') ? 'bocha' : 'tavily');
        const url = weather ? message.type==='weather' ? validateWeatherURL(message.url) : validatePublicDataURL(message.url) : searching ? validateSearchEndpoint(message.url,provider) : validateEndpoint(message.url);
        if (!await chrome.permissions.contains({origins:[`${new URL(url).protocol}//${new URL(url).hostname}/*`]})) throw new Error(`请点击扩展图标，授权当前${searching ? '搜索' : ' AI '}服务域名后重试`);
        if (!weather && (typeof message.data !== 'string' || message.data.length > (message.type==='media' ? MEDIA_REQUEST_LIMIT : 100000))) throw new Error('AI请求过大');
        const form=searching && provider==='searxng';
        const body = weather ? null : form ? Object.fromEntries(new URLSearchParams(message.data)) : JSON.parse(message.data);
        if(searching)validateSearchBody(body,provider);else if(message.type==='media')validateMediaRequest(body);else if (!weather && (!Array.isArray(body.messages) || typeof body.model !== 'string')) throw new Error('AI请求无效');
        const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),searching ? 30000 : 25000);
        const requestKey=typeof message.requestId==='string' && /^[a-z\d-]{16,80}$/iu.test(message.requestId) ? `${sender.tab.id}:${message.requestId}` : null;
        if(requestKey){activeAIRequests.set(requestKey,controller);if(cancelledAIRequests.delete(requestKey))controller.abort();}
        try {
          const response = await fetch(url,{method:weather ? 'GET' : 'POST',credentials:'omit',redirect:'error',signal:controller.signal,headers:weather ? {} : {'Content-Type':form ? 'application/x-www-form-urlencoded' : 'application/json',...(typeof message.headers?.Authorization === 'string' ? {Authorization:message.headers.Authorization} : {})},body:weather ? undefined : message.data});
          const text = await response.text();
          value={status:response.status,responseText:text.slice(0,200000),finalUrl:response.url};
        } finally { clearTimeout(timeout);if(requestKey)activeAIRequests.delete(requestKey); }
      } else throw new Error('不支持的请求');
      reply({ok:true,value});
    } catch (error) { reply({ok:false,error:error.name === 'AbortError' ? 'AI请求超时' : error.message,code:error.code || (/quota|配额|QUOTA_BYTES/i.test(error.message) ? 'STORAGE_QUOTA' : 'TRANSIENT')}); }
  })();
  return true;
});
async function notifyChanges(changes) {
  let mediaChanged=false;
  for(const [key,change] of Object.entries(changes)){
    if(/^live-assistant:config:\d+$/u.test(key))mediaChanged=true;
    else if(/^live-assistant:live-memory:\d+:\d+$/u.test(key)){
      const value=change.newValue?.audience,signature=JSON.stringify([value?.forgetBefore || 0,value?.forgotten || []]);
      if(publicMediaPrivacy.get(key)!==signature){mediaChanged=true;publicMediaPrivacy.delete(key);publicMediaPrivacy.set(key,signature);while(publicMediaPrivacy.size>64)publicMediaPrivacy.delete(publicMediaPrivacy.keys().next().value);}
    }
  }
  if(mediaChanged && publicMedia)void publicMedia.wakeAll().catch(()=>{});
  const credentialsChanged=Object.keys(changes).some(isAISecretKey);
  const relevant = Object.fromEntries(Object.entries(changes).filter(([key]) => /^(live-assistant:(config|income|income-calibration|profile):\d+|douyin-live-assistant:(theme|palette|material))$/.test(key)));
  const shared=changes[SHARED_KNOWLEDGE_KEY]?.newValue || await rawReadRecord(SHARED_KNOWLEDGE_KEY);
  const sharedChanged=Boolean(changes[SHARED_KNOWLEDGE_KEY]);
  if (!Object.keys(relevant).length && !sharedChanged && !credentialsChanged) return;
  // Delivery of change notifications must never turn a committed write into a failure.
  try {
    const tabs = await chrome.tabs.query({url:'https://live.douyin.com/*'});
    for (const tab of tabs) {
      const room = roomFromUrl(tab.url);
      if(credentialsChanged)void chrome.tabs.sendMessage(tab.id,{type:'ai-credentials-changed'}).catch(()=>{});
      const scoped = Object.fromEntries(Object.entries(relevant).filter(([key]) => /:config:/.test(key) && key.endsWith(`:${room}`)));
      const configKey=`live-assistant:config:${room}`;
      if(sharedChanged && !scoped[configKey])scoped[configKey]={newValue:await rawReadRecord(configKey) || {}};
      if(shared)for(const [key,change] of Object.entries(scoped))if(key===configKey)change.newValue=projectSharedKnowledge(change.newValue,shared);
      if (Object.keys(scoped).length) void chrome.tabs.sendMessage(tab.id,{type:'storage',changes:scoped,...(sharedChanged ? {sharedKnowledge:true} : {})}).catch(()=>{});
      if (Object.keys(relevant).some(key => /:(income|income-calibration|profile):/.test(key))) void chrome.tabs.sendMessage(tab.id,{type:'income-updated'}).catch(()=>{});
      if (relevant[themeKey]) void chrome.tabs.sendMessage(tab.id,{type:'theme-changed',value:relevant[themeKey].newValue}).catch(()=>{});
      for(const kind of ['palette','material']){const change=relevant[APPEARANCE_PREFERENCES[kind].key];if(change)void chrome.tabs.sendMessage(tab.id,{type:'appearance-changed',kind,value:change.newValue}).catch(()=>{});}
    }
    if (changes[themeKey]) void chrome.runtime.sendMessage({type:'theme-changed',value:changes[themeKey].newValue}).catch(()=>{});
    for(const kind of ['palette','material']){const change=relevant[APPEARANCE_PREFERENCES[kind].key];if(change)void chrome.runtime.sendMessage({type:'appearance-changed',kind,value:change.newValue}).catch(()=>{});}
  } catch {}
}
chrome.storage.onChanged.addListener(async(changes,area)=>{
  if (area === 'local') await notifyChanges(changes);
});
