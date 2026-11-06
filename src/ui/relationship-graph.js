export const RELATIONSHIP_STATUS_LABELS=Object.freeze({verified:'运营核实',unverified:'待核实',observed:'已观察互动',conflicted:'存在冲突'});
const colors={verified:'#20a486',unverified:'#bd8e3e',observed:'#5b9bd5',conflicted:'#df657c'};
export function relationshipChartOption(graph){
 const nodes=graph.entities || [],edges=graph.relations || [],degree=new Map();
 for(const edge of edges)for(const id of [edge.from,edge.to])degree.set(id,(degree.get(id) || 0)+1);
 return {animation:false,aria:{enabled:true,description:`人物关系知识图谱，${nodes.length}个人物，${edges.length}条关系；可用下方列表选择人物并查看证据。`},tooltip:{trigger:'item',confine:true,renderMode:'richText'},
  series:[{id:'relationships',type:'graph',layout:'force',roam:true,draggable:true,scaleLimit:{min:.3,max:5},force:{repulsion:180,edgeLength:[80,150],gravity:.08,layoutAnimation:false},emphasis:{focus:'adjacency',label:{show:true}},label:{show:true,position:'bottom',fontSize:12,color:'#b7b1bb'},edgeSymbol:['none','arrow'],edgeSymbolSize:7,
   data:nodes.map(n=>({id:n.id,name:n.name,symbolSize:Math.min(48,22+(degree.get(n.id) || 0)*3),itemStyle:{color:n.role==='主播' ? '#e96089' : n.role==='观众' ? '#5b9bd5' : '#886bc1'},tooltip:{formatter:()=>`${n.name} · ${n.role || '人物提及'}`}})),
   links:edges.filter(e=>nodes.some(n=>n.id===e.from) && nodes.some(n=>n.id===e.to)).map(e=>({id:e.id,source:e.from,target:e.to,name:`${e.negative ? '不是' : ''}${e.predicate}`,lineStyle:{color:colors[e.status],width:2,type:['verified','observed'].includes(e.status) ? 'solid' : 'dashed',curveness:e.negative ? -.16 : .12},label:{show:true,formatter:`${e.negative ? '不是' : ''}${e.predicate}`,fontSize:10,color:colors[e.status]},tooltip:{formatter:()=>`${e.negative ? '不是' : ''}${e.predicate} · ${RELATIONSHIP_STATUS_LABELS[e.status] || '待核实'}`}}))}]};
}
