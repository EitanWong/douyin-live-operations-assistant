// These are coverage and observed counts, never confidence or personality scores.
export function networkInsights(graph,personId){
 const person=graph.entities.find(n=>n.id===personId),relations=personId ? graph.relations.filter(r=>r.from===personId || r.to===personId) : graph.relations;
 const people=personId ? (person ? [person] : []) : graph.entities,rows=new Map(),statuses={},roles={},neighbors=new Set();
 const add=row=>rows.set(JSON.stringify([row.recordId || '',row.source,row.at,row.text,row.scope]),row);
 for(const edge of relations){statuses[edge.status]=(statuses[edge.status] || 0)+1;for(const id of [edge.from,edge.to])if(id!==personId)neighbors.add(id);for(const row of edge.evidence || [])add(row);}
 for(const node of people){roles[node.role || '人物提及']=(roles[node.role || '人物提及'] || 0)+1;for(const row of [...(node.evidence || []),...(node.dossier?.events || []),...(node.dossier?.leads || [])])add(row);}
 const evidence=[...rows.values()],dossier=person?.dossier;
 return {people:people.length,relations:relations.length,neighbors:neighbors.size,statuses,roles,evidence:evidence.length,sources:new Set(evidence.map(r=>r.source).filter(Boolean)).size,rooms:new Set(evidence.map(r=>r.scope?.room).filter(Boolean)).size,
  dimensions:dossier?.coverage?.dimensions || [...new Set((dossier?.facets || []).map(r=>r.category))],records:dossier?.coverage?.records || 0,
  timeline:evidence.filter(r=>Number.isFinite(r.at)).sort((a,b)=>b.at-a.at).slice(0,6)};
}
