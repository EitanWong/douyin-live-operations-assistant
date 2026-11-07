export {RELATIONSHIP_STATUS_LABELS} from './relationship-graph.js';
export const NETWORK_COLORS=Object.freeze({verified:'#38d9a9',unverified:'#f5bd62',observed:'#6db8ff',conflicted:'#ff7c9c'});
const validEdges=graph=>{const ids=new Set(graph.entities.map(n=>n.id));return graph.relations.filter(r=>ids.has(r.from) && ids.has(r.to));};
export function projectNetwork(graph,{status='all',predicate='all',focus='',depth=0}={}){
 let relations=validEdges(graph).filter(r=>(status==='all' || r.status===status) && (predicate==='all' || r.predicate===predicate));
 let ids=new Set(graph.entities.map(n=>n.id));
 if(focus && depth){
  ids=new Set([focus]);let frontier=[focus];
  for(let i=0;i<depth;i++){const next=new Set();for(const edge of relations)if(frontier.includes(edge.from) || frontier.includes(edge.to))for(const id of [edge.from,edge.to])if(!ids.has(id))next.add(id);for(const id of next)ids.add(id);frontier=[...next];}
  relations=relations.filter(r=>ids.has(r.from) && ids.has(r.to));
 }
 return {...graph,entities:graph.entities.filter(n=>ids.has(n.id)),relations};
}
// Undirected connectivity is a navigation aid, never a transitive relationship.
export function relationshipPath(graph,from,to){
 if(!graph.entities.some(n=>n.id===from) || !graph.entities.some(n=>n.id===to))return null;
 const adjacency=new Map(graph.entities.map(n=>[n.id,[]]));for(const edge of validEdges(graph)){adjacency.get(edge.from).push([edge.to,edge.id]);adjacency.get(edge.to).push([edge.from,edge.id]);}
 const queue=[from],previous=new Map([[from,null]]);
 for(let i=0;i<queue.length && !previous.has(to);i++)for(const [id,edge] of adjacency.get(queue[i]))if(!previous.has(id)){previous.set(id,{id:queue[i],edge});queue.push(id);}
 if(!previous.has(to))return null;const nodes=[to],edges=[];
 for(let id=to;previous.get(id);){const p=previous.get(id);edges.unshift(p.edge);nodes.unshift(p.id);id=p.id;}
 return {nodes,edges};
}
export function networkElements(graph,{dimension='role'}={}){
 const degree=new Map();for(const edge of graph.relations)for(const id of [edge.from,edge.to])degree.set(id,(degree.get(id)||0)+1);
 const color=n=>dimension==='evidence' ? (n.dossier?.coverage?.records ? '#38d9a9' : '#f5bd62') : dimension==='activity' ? ((degree.get(n.id)||0)>3 ? '#ff81b2' : '#73c9ff') : n.role==='主播' ? '#ff81b2' : n.role==='观众' ? '#73c9ff' : '#ad9bff';
 return [...graph.entities.map(n=>({data:{id:`node:${n.id}`,recordId:n.id,kind:'entity',label:n.name,role:n.role || '人物提及',size:Math.min(44,24+(degree.get(n.id)||0)*2),color:color(n)}})),
 ...graph.relations.map(r=>({data:{id:`edge:${r.id}`,recordId:r.id,kind:'relation',source:`node:${r.from}`,target:`node:${r.to}`,label:`${r.negative ? '不是' : ''}${r.predicate}`,status:r.status,arrow:r.symmetric ? 'none' : 'triangle',color:NETWORK_COLORS[r.status] || NETWORK_COLORS.unverified}}))];
}
