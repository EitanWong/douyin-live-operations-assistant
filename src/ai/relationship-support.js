// Derive support from the archive's deduplicated observations, without a second store.
export function supportDocument(viewer,profile,input){
 if(!profile.gifts.count || viewer.key===`uid:${input.anchor}`)return null;
 const support={...profile.gifts,scope:{room:input.room || '',anchor:String(input.anchor)}};
 return {id:`support:${viewer.key}`,text:`${viewer.name}向${input.anchorName || '主播'}送礼支持：近30天观测${support.count}件，已知${support.knownDiamonds ?? '未知'}钻石${support.partial ? '（含未知单价，金额不完整）' : ''}。`,
  at:viewer.gifts.reduce((latest,g)=>g.at<=input.now ? Math.max(latest,g.at) : latest,0),source:'直播礼物协议',trust:'observed',support,
  interaction:{from:{key:viewer.key},to:{key:`uid:${input.anchor}`},predicate:'送礼支持'}};
}

export function selectSupportRankings(graph,seeds,limit=20){
 const boards=new Map();
 for(const relation of graph.relations.values())for(const support of relation.support || []){
  const key=JSON.stringify([relation.to,support.scope]),board=boards.get(key) || {anchor:relation.to,scope:support.scope,from:support.from,through:support.through,rows:[]};
  board.rows.push({person:relation.from,name:graph.nodes.get(relation.from).name,...support});boards.set(key,board);
 }
 return [...boards.values()].filter(board=>seeds.has(board.anchor) || board.rows.some(row=>seeds.has(row.person))).map(board=>{
  board.rows.sort((a,b)=>(b.knownDiamonds ?? -1)-(a.knownDiamonds ?? -1) || b.count-a.count || a.person.localeCompare(b.person));
  let rank=0,last=null;
  const ranked=board.rows.map((row,i)=>{if(row.knownDiamonds!==null && row.knownDiamonds!==last)rank=i+1;last=row.knownDiamonds;return {...row,rank:row.knownDiamonds===null ? null : rank};});
  const rows=ranked.filter((row,i)=>i<limit || seeds.has(row.person));
  return {...board,rows,total:ranked.length,omitted:ranked.length-rows.length,partial:ranked.some(r=>r.partial),basis:'近30天本房已观测送礼，按已知钻石降序；同额并列，未知单价不计零，不代表全平台或终身消费'};
 });
}
