const likeIdentity=value=>typeof value==='string' && /^[0-9]{1,30}$/.test(value) ? value : '';

export class RoomLikes {
  constructor() {this.rooms=new Map();}
  ingest(event,context={}) {
    const anchorId=likeIdentity(event.anchorId || context.anchorId),roomId=likeIdentity(event.roomId);
    const total=event.total,observedAt=event.receivedAt;
    if (!anchorId || !roomId || !Number.isSafeInteger(total) || total<0 || !Number.isFinite(observedAt) || observedAt<=0) return false;
    const approximate=event.type==='room-likes' && event.approximate===true;
    const display=approximate && typeof event.display==='string' && /^\d[\d,，]*(?:\.\d+)?[万亿]$/.test(event.display) ? event.display : String(total);
    const key=JSON.stringify([anchorId,roomId]),old=this.rooms.get(key);
    if (old && (observedAt<old.observedAt || total<old.total || total===old.total && approximate && !old.approximate)) return false;
    const row={anchorId,roomId,total,display,approximate,source:event.type==='like' ? 'websocket' : 'native-room',observedAt};
    if (JSON.stringify(old)===JSON.stringify(row)) return false;
    this.rooms.set(key,row);
    if (this.rooms.size>5000) this.rooms.delete(this.rooms.keys().next().value);
    return true;
  }
  forAnchor(anchorId) {return [...this.rooms.values()].filter(row=>row.anchorId===anchorId).sort((a,b)=>b.observedAt-a.observedAt).map(row=>({...row}));}
  snapshot() {return [...this.rooms.values()].map(row=>({...row}));}
  restore(rows) {
    this.rooms.clear();
    for (const row of Array.isArray(rows) ? rows.slice(-5000) : []) if (row) this.ingest({...row,type:row.source==='websocket' ? 'like' : 'room-likes',receivedAt:row.observedAt});
  }
}
