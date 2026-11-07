import cytoscape from 'cytoscape';
import {networkElements} from '../relationship-network.js';
const style=[
 {selector:'node',style:{'background-color':'data(color)','width':'data(size)','height':'data(size)','border-width':2,'border-color':'data(color)','border-opacity':.5,'background-opacity':.88,'label':'data(label)','color':'#e9f2ff','font-size':16,'font-weight':600,'text-valign':'bottom','text-margin-y':10,'text-wrap':'wrap','text-max-width':100,'text-background-color':'#101a2e','text-background-opacity':.78,'text-background-padding':3,'text-background-shape':'roundrectangle','overlay-color':'data(color)','overlay-opacity':.07,'overlay-padding':9}},
 {selector:'edge',style:{'width':1.7,'line-color':'data(color)','target-arrow-color':'data(color)','target-arrow-shape':'data(arrow)','arrow-scale':.7,'curve-style':'bezier','label':'data(label)','font-size':12,'color':'data(color)','text-rotation':'autorotate','text-background-color':'#101a2e','text-background-opacity':.93,'text-background-padding':4,'text-margin-y':-8,'opacity':.7}},
 {selector:'edge[status = "unverified"],edge[status = "conflicted"]',style:{'line-style':'dashed'}},
 {selector:'.muted',style:{'opacity':.14,'text-opacity':.15}},
 {selector:'node.selected,node.path',style:{'border-width':4,'border-color':'#ffffff','overlay-opacity':.18,'overlay-padding':15,'z-index':20}},
 {selector:'edge.selected,edge.path',style:{'width':3.5,'opacity':1,'z-index':10,'text-opacity':1}},
 {selector:':active',style:{'overlay-opacity':0}}
];
export function createNetworkView(element,{onSelect,create=cytoscape,headless=false}={}){
 const view=element.ownerDocument.defaultView;
 const cy=create({container:headless ? undefined : element,headless,styleEnabled:true,style,layout:{name:'preset'},minZoom:.15,maxZoom:4,pixelRatio:Math.min(view.devicePixelRatio || 1,2),boxSelectionEnabled:false,autounselectify:true,textureOnViewport:true});
 let topology='',layoutName='',focusId='',frame=0,touched=false,closed=false;
 const fit=()=>{if(cy.elements().length)cy.fit(cy.elements(),24);};
 const touch=()=>{touched=true;};
 element.addEventListener('pointerdown',touch);element.addEventListener('wheel',touch,{passive:true});
 const layout=name=>{touched=false;cy.layout({name,animate:false,fit:false,randomize:false,numIter:180,nodeRepulsion:()=>8000,idealEdgeLength:()=>85,minNodeSpacing:18,spacingFactor:1.05,concentric:n=>focusId ? Number(n.data('recordId')===focusId) : n.degree(),levelWidth:()=>focusId ? 1 : 2}).run();fit();};
 const resize=()=>{if(!frame)frame=view.requestAnimationFrame(()=>{frame=0;if(closed)return;cy.resize();if(!touched && element.clientWidth && element.clientHeight)fit();});};
 const observer=new view.ResizeObserver(resize);observer.observe(element);
 cy.on('tap','node,edge',event=>onSelect?.({kind:event.target.data('kind'),id:event.target.data('recordId')}));
 cy.on('tap',event=>{if(event.target===cy)onSelect?.(null);});
 return {core:cy,update(graph,{layout:nextLayout='concentric',selected,path,dimension}={}){
  const elements=networkElements(graph,{dimension}),nextTopology=JSON.stringify(elements.map(e=>[e.data.id,e.data.source,e.data.target]));
  if(nextTopology!==topology){
   const ids=new Set(elements.map(e=>e.data.id));cy.batch(()=>{cy.elements().filter(e=>!ids.has(e.id())).remove();for(const el of elements){const existing=cy.getElementById(el.data.id);if(existing.length)existing.data(el.data);else cy.add(el);}});
  }else cy.batch(()=>{for(const el of elements)cy.getElementById(el.data.id).data(el.data);});
  focusId=selected?.kind==='entity' ? selected.id : '';
  if(nextTopology!==topology || nextLayout!==layoutName){topology=nextTopology;layoutName=nextLayout;if(elements.length){cy.resize();layout(nextLayout);resize();}}
  cy.batch(()=>{cy.elements().removeClass('muted selected path');if(selected){const item=cy.getElementById(`${selected.kind==='entity' ? 'node' : 'edge'}:${selected.id}`);if(item.length){const context=item.isNode() ? item.closedNeighborhood() : item.union(item.connectedNodes());cy.elements().difference(context).addClass('muted');item.addClass('selected');}}
   for(const id of path?.nodes || [])cy.getElementById(`node:${id}`).addClass('path').removeClass('muted');for(const id of path?.edges || [])cy.getElementById(`edge:${id}`).addClass('path').removeClass('muted');});
 },command(action){touched=true;if(action==='fit')fit();if(action==='layout')layout(layoutName);if(action==='in' || action==='out')cy.zoom({level:cy.zoom()*(action==='in' ? 1.25 : .8),renderedPosition:{x:element.clientWidth/2,y:element.clientHeight/2}});if(action==='image'){const link=element.ownerDocument.createElement('a');link.href=cy.png({bg:'#101a2e',scale:2,full:true});link.download='人物关系图谱.png';link.click();}},
 pan(x,y){touched=true;cy.panBy({x,y});},destroy(){closed=true;observer.disconnect();view.cancelAnimationFrame(frame);element.removeEventListener('pointerdown',touch);element.removeEventListener('wheel',touch);cy.destroy();}};
}
