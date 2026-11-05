// Offline only: field names were checked against the published Douyin web schema.
// This module reads saved captures; it never contacts Douyin or submits entries.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync, inflateSync } from 'node:zlib';
import { wire, decodeFrame } from '../src/browser/protocol.js';

const MAX_BYTES = 8 * 1024 * 1024;
const first = (map, n) => map.get(n)?.[0];
const bytesAt = (map, n) => { const v = first(map,n); return v instanceof Uint8Array ? v : null; };
const textAt = (map, n) => Buffer.from(bytesAt(map,n) || []).toString('utf8');
const idAt = (map, n) => typeof first(map,n) === 'bigint' ? first(map,n).toString() : null;
const nested = (map,n) => wire(bytesAt(map,n) || []);
const rowsAt = (map,n) => (map.get(n) || []).filter(v=>v instanceof Uint8Array).map(wire);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function repeatedInt64(map, field, limit = 1024) {
  const out=[];
  const add=value=>{ if(out.length>=limit)throw new Error('Too many repeated integers'); out.push(BigInt.asIntN(64,value).toString()); };
  for(const v of map.get(field) || []) {
    if(typeof v==='bigint') { add(v); continue; }
    let pos=0;
    while(pos<v.length) {
      let value=0n, done=false;
      for(let byte=0;byte<10;byte++) {
        if(pos>=v.length)throw new Error('Truncated packed int64');
        const b=v[pos++];
        if(byte===9 && b>1)throw new Error('Packed int64 overflow');
        value|=BigInt(b&127)<<BigInt(byte*7);
        if(!(b&128)) { done=true; break; }
      }
      if(!done)throw new Error('Packed int64 overflow');
      add(value);
    }
  }
  return out;
}

export function extractMessages(record) {
  if(record.rawEncoding==='utf8-text')return [];
  if(typeof record.rawBase64!=='string')throw new Error('Raw frame unavailable');
  const raw=Buffer.from(record.rawBase64,'base64');
  if(raw.length>MAX_BYTES || raw.length!==record.rawBytes)throw new Error('Raw frame length mismatch');
  const envelope=wire(raw);
  // Response.field8 can be an integer. Only a length-delimited payload is a PushFrame.
  const payload=bytesAt(envelope,8);
  let response=raw, encoding='';
  if(payload) {
    if(textAt(envelope,7) && textAt(envelope,7)!=='msg')return [];
    const headers=new Map(rowsAt(envelope,5).map(m=>[textAt(m,1),textAt(m,2)]));
    response=payload; encoding=textAt(envelope,6) || headers.get('compress_type') || '';
  }
  if(response[0]===0x1f && response[1]===0x8b || encoding==='gzip')response=gunzipSync(response,{maxOutputLength:MAX_BYTES});
  else if(encoding==='deflate')response=inflateSync(response,{maxOutputLength:MAX_BYTES});
  const out=[];
  for(const item of wire(response).get(1) || []) {
    if(!(item instanceof Uint8Array))continue;
    try {
      const m=wire(item),body=bytesAt(m,2);
      if(body)out.push({method:textAt(m,1),messageId:idAt(m,3),body});
    } catch(error) { out.push({error:error.message}); }
  }
  return out;
}

function displayText(common) {
  const text=nested(common,8),pieces=rowsAt(text,4).map(p=>({type:idAt(p,1),stringValue:textAt(p,11)}));
  const pattern=textAt(text,2);
  // Preserve unknown rich pieces instead of inventing a rendered message.
  let rendered=pattern.replace(/\{(\d+):string\}/g,(match,index)=>pieces[index]?.type==='1' ? pieces[index].stringValue : match);
  if(/\{\d+:/.test(rendered))rendered='';
  return {text:rendered,key:textAt(text,1),pattern,pieces};
}

export function decodeLotteryPayload(method, body, messageId) {
  if(!['WebcastLotteryEventNewMessage','WebcastLotteryCandidateEventMessage','WebcastLotteryDrawResultEventMessage',
    'WebcastCommonToastMessage','WebcastRoomDataSyncMessage','RoomDataSyncMessage'].includes(method))return null;
  const m=wire(body),common=nested(m,1);
  const base={method,messageId:messageId || idAt(common,2),roomId:idAt(common,3),serverCreateTimeRaw:idAt(common,4)};
  if(method==='WebcastLotteryEventNewMessage')return {...base,kind:'lottery-start',lotteryId:idAt(m,2),statusRaw:idAt(m,3),
    startedAtSeconds:idAt(m,4),drawAtSeconds:idAt(m,5),serverNowSeconds:idAt(m,6),prizeTypeRaw:idAt(m,8),
    conditionTypes:repeatedInt64(m,10),conditions:rowsAt(m,21).map(row=>({typeRaw:idAt(row,1),content:textAt(row,2),
      needDiamondCount:idAt(row,3),minFansLevel:idAt(row,4),remarks:textAt(row,5),bizInfo:textAt(row,6)})),
    extra:Object.fromEntries(rowsAt(m,11).map(row=>[textAt(row,1),textAt(row,2)])),
    prizeCount:idAt(m,13),luckyCount:idAt(m,14),awardName:textAt(m,18)};
  if(method==='WebcastLotteryCandidateEventMessage')return {...base,kind:'lottery-candidate',lotteryId:idAt(m,2),userId:idAt(m,3),
    participateSuccess:typeof first(m,4)==='bigint' ? first(m,4)!==0n : null,participateSuccessRaw:idAt(m,4),version:idAt(m,5)};
  if(method==='WebcastLotteryDrawResultEventMessage') {
    const extraRaw=textAt(m,4);let candidateCount=null;
    try {
      const n=JSON.parse(extraRaw)?.candidate_num;
      if(typeof n==='number' && Number.isSafeInteger(n) && n>=0 || typeof n==='string' && /^\d+$/.test(n))candidateCount=String(n);
    }catch{}
    return {...base,kind:'lottery-result',lotteryId:idAt(m,2),reportedUserIds:repeatedInt64(m,3),candidateCount,extraRaw};
  }
  if(method==='WebcastCommonToastMessage')return {...base,kind:'toast',...displayText(common),durationRaw:idAt(m,4),positionRaw:idAt(m,8)};
  if(textAt(m,3)!=='LotteryInfoSyncData')return null;
  const sync=nested(m,5);
  return {...base,kind:'lottery-sync',lotteryId:idAt(sync,1),lotteryTypeRaw:idAt(sync,5),luckyCount:idAt(sync,2),prizeCount:idAt(sync,6),
    candidateCount:idAt(sync,3),startedAtSeconds:idAt(sync,7),drawAtSeconds:idAt(sync,8),
    lastCandidateCountSurgeTimestampRaw:idAt(sync,4)};
}

export async function analyzeLotteryCaptures(captures,{selfUid=null}={}) {
  const evidence=new Map(),errors=[],sources=[],ownComments=[];let frameCount=0,rawMessages=0;
  const admit=event=>{
    const key=`${event.kind}:${event.messageId || event.bodySha256 || JSON.stringify(event)}`;
    const previous=evidence.get(key);
    if(previous) { previous.occurrences.push(...event.occurrences); return; }
    evidence.set(key,event);
  };
  for(let sourceIndex=0;sourceIndex<captures.length;sourceIndex++) {
    const capture=captures[sourceIndex],frames=capture.collection?.protocolFrames || [];
    sources.push({sourceIndex,roomWebId:capture.room || null,savedAt:capture.savedAt || null,frameCount:frames.length});
    for(let frameIndex=0;frameIndex<frames.length;frameIndex++) {
      frameCount++;
      const record=frames[frameIndex].record || frames[frameIndex];
      const occurrence={sourceIndex,frameIndex,receivedAt:record.receivedAt,transport:record.transport,origin:'raw-frame'};
      try {
        for(const message of extractMessages(record)) {
          rawMessages++;
          if(message.error) { errors.push({...occurrence,error:message.error}); continue; }
          try {
            const event=decodeLotteryPayload(message.method,message.body,message.messageId);
            if(event)admit({...event,bodySha256:sha256(message.body),occurrences:[occurrence]});
          }catch(error){errors.push({...occurrence,method:message.method,messageId:message.messageId,error:error.message});}
        }
        if(selfUid)for(const event of await decodeFrame(Buffer.from(record.rawBase64,'base64'))) {
          if(event.type==='chat' && event.user?.id===selfUid)ownComments.push({messageId:event.id,text:event.text,userId:selfUid,...occurrence});
        }
      }catch(error){errors.push({...occurrence,error:error.message});}
    }
    for(const [activityIndex,event] of (capture.runtime?.roomData?.activities || []).entries()) {
      if(event.syncType!=='LotteryInfoSyncData' || !event.syncDetails?.lotteryId)continue;
      const s=event.syncDetails;
      admit({kind:'lottery-sync',method:null,messageId:event.id,roomId:event.roomId,lotteryId:s.lotteryId,
        luckyCount:s.luckyCount || null,prizeCount:s.prizeCount || null,candidateCount:s.candidateCount || null,
        startedAtSeconds:s.startedAt || null,drawAtSeconds:s.drawAt || null,
        occurrences:[{sourceIndex,activityIndex,receivedAt:event.receivedAt,origin:'runtime-snapshot'}]});
    }
  }
  const events=[...evidence.values()].sort((a,b)=>(a.occurrences[0].receivedAt || 0)-(b.occurrences[0].receivedAt || 0));
  const rounds=new Map();
  for(const event of events) {
    if(!event.roomId || !event.lotteryId)continue;
    const key=`${event.roomId}:${event.lotteryId}`;
    let round=rounds.get(key);
    if(!round){round={roomId:event.roomId,lotteryId:event.lotteryId,startedAtSeconds:null,drawAtSeconds:null,prizeCount:null,luckyCount:null,
      evidenceIds:[],candidateCounts:[],selfParticipation:null,selfCandidateVersion:null,hasDrawResult:false,reportedUserCount:null,
      selfListedInResult:null};rounds.set(key,round);}
    round.evidenceIds.push(event.messageId);
    for(const name of ['startedAtSeconds','drawAtSeconds','prizeCount','luckyCount'])if(event[name]!=null)round[name]=event[name];
    if(event.candidateCount!=null)round.candidateCounts.push({count:event.candidateCount,messageId:event.messageId,receivedAt:event.occurrences[0].receivedAt});
    if(event.kind==='lottery-candidate' && selfUid && event.userId===selfUid &&
      (round.selfCandidateVersion===null || event.version!==null && BigInt(event.version)>=BigInt(round.selfCandidateVersion))) {
      round.selfParticipation=event.participateSuccess;round.selfCandidateVersion=event.version;
    }
    if(event.kind==='lottery-result') {
      round.hasDrawResult=true;round.reportedUserCount=event.reportedUserIds.length;
      round.selfListedInResult=selfUid ? event.reportedUserIds.includes(selfUid) : null;
    }
  }
  const successToasts=events.filter(e=>e.kind==='toast'&&e.text==='已成功参与福袋，开奖前勿离开直播间');
  return {formatVersion:1,sources,frameCount,rawMessages,uniqueEvidenceCount:events.length,
    hasSelfUid:Boolean(selfUid),rounds:[...rounds.values()],events,successToastMessageIds:successToasts.map(e=>e.messageId),
    ownComments:[...new Map(ownComments.map(e=>[e.messageId,e])).values()],errors,
    limitations:['Inbound frames and runtime snapshots only; enrollment HTTP requests are not present.',
      'Candidate.version is a version token, not an asserted timestamp.',
      'A toast has no lottery ID and cannot alone identify the round.',
      'Reported result user IDs are preserved; their count is not assumed to equal luckyCount.',
      'No candidate event for the specified user means participation is unknown.']};
}

async function main(args) {
  const inputs=[];let output=null,selfUid=null;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--out')output=args[++i];
    else if(args[i]==='--self-uid')selfUid=args[++i];
    else if(args[i].startsWith('--'))throw new Error(`Unknown option: ${args[i]}`);
    else inputs.push(args[i]);
  }
  if(!inputs.length || !output || selfUid!==null&&!/^\d+$/.test(selfUid))throw new Error('Usage: node scripts/analyze-lottery-capture.mjs capture.json [snapshot.json] --out output/analysis.json [--self-uid UID]');
  const sources=await Promise.all(inputs.map(async file=>{const raw=await readFile(file);return {file:resolve(file),sha256:sha256(raw),capture:JSON.parse(raw)};}));
  const result=await analyzeLotteryCaptures(sources.map(x=>x.capture),{selfUid});
  result.inputFiles=sources.map(({file,sha256})=>({file,sha256}));
  await mkdir(dirname(resolve(output)),{recursive:true});
  await writeFile(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({output:resolve(output),frames:result.frameCount,uniqueEvidence:result.uniqueEvidenceCount,
    rounds:result.rounds.length,selfConfirmedRounds:result.rounds.filter(r=>r.selfParticipation===true).length,
    successToasts:result.successToastMessageIds.length,errors:result.errors.length},null,2));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
