import { cleanFanclubSnapshot, fanclubId, fanclubCount } from '../data/fanclub.js';

export class AnchorFanclub {
  constructor() {this.anchors=new Map();this.pending=new Map();}
  ingest(event,context={}) {
    const anchorId=fanclubId(event.anchorId || context.anchorId),at=event.receivedAt;
    if (!anchorId || !Number.isFinite(at) || at<=0) return false;
    if (event.type==='anchor-fanclub') return this.ingestSnapshot({...event,anchorId});
    const old=this.anchors.get(anchorId) || {anchorId,members:[],activities:[]};
    if (event.type==='fansclub-statistics') {
      const value=fanclubCount(event.fansCount);
      if (value===null || at<(old.countAt || 0)) return false;
      this.save({...old,fansCount:value,name:String(event.name || old.name || '').slice(0,100),countAt:at,observedAt:Math.max(old.observedAt || 0,at)});
      return true;
    }
    if (!['fansclub','fansclub-push'].includes(event.type)) return false;
    const id=String(event.id || `${event.roomId}:${at}:${event.description || event.content}`).slice(0,200);
    if (old.activities.some(row=>row.id===id)) return false;
    const activity={id,at,action:['join','upgrade'].includes(event.actionName) ? event.actionName : 'notice',name:String(event.user?.name || '').slice(0,80),text:String(event.description || event.content || '').slice(0,400)};
    this.save({...old,activities:[...old.activities,activity].sort((a,b)=>b.at-a.at).slice(0,30)});
    return true;
  }
  ingestSnapshot(event) {
    const value=cleanFanclubSnapshot(event);
    if (!value) return false;
    const old=this.anchors.get(value.anchorId) || {anchorId:value.anchorId,members:[],activities:[]};
    if (value.receivedAt<(old.membersAt || 0)) return false;
    const key=JSON.stringify([value.anchorId,value.roomId,value.snapshotId]);
    const pending=this.pending.get(key) || {chunks:value.chunks,totalRows:value.totalRows,parts:new Map()};
    if (pending.chunks!==value.chunks || pending.totalRows!==value.totalRows) return false;
    pending.parts.set(value.chunk,value.members);this.pending.set(key,pending);
    if (this.pending.size>100) this.pending.delete(this.pending.keys().next().value);
    if (pending.parts.size!==value.chunks) return false;
    const members=Array.from({length:value.chunks},(_,index)=>pending.parts.get(index)).flat();
    if (members.length!==value.totalRows || new Set(members.map(row=>row.position)).size!==members.length) return false;
    this.pending.delete(key);
    const row={...old,roomId:value.roomId,clubId:value.clubId,title:value.title,members,viewer:value.viewer,
      membersAt:value.receivedAt,lightedCount:value.lightedCount,hiddenInactive:value.hiddenInactive,truncated:value.truncated};
    if (value.receivedAt>=(old.countAt || 0)) {row.fansCount=value.fansCount;row.countAt=value.receivedAt;}
    row.observedAt=Math.max(old.observedAt || 0,value.receivedAt);
    this.save(row);return true;
  }
  save(row) {this.anchors.set(row.anchorId,row);if (this.anchors.size>200) this.anchors.delete(this.anchors.keys().next().value);}
  forAnchor(anchorId) {const row=this.anchors.get(anchorId);return row ? JSON.parse(JSON.stringify(row)) : null;}
  snapshot() {return [...this.anchors.keys()].map(id=>this.forAnchor(id));}
  restore(rows) {
    this.anchors.clear();this.pending.clear();
    for (const row of Array.isArray(rows) ? rows.slice(-200) : []) {
      if (!row || !fanclubId(row.anchorId)) continue;
      if (row.membersAt) this.ingestSnapshot({...row,type:'anchor-fanclub',receivedAt:row.membersAt,snapshotId:`restore:${row.membersAt}`});
      this.ingest({...row,type:'fansclub-statistics',receivedAt:row.countAt});
      for (const activity of (Array.isArray(row.activities) ? row.activities : []).slice(0,30)) this.ingest({type:'fansclub',anchorId:row.anchorId,receivedAt:activity.at,id:activity.id,actionName:activity.action,user:{name:activity.name},description:activity.text});
    }
  }
}
