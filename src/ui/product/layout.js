// Translate legacy presentation once at the boundary. The visible workspace
// uses these roles, never a second set of source-DOM layout selectors.
export const PRODUCT_DIMENSIONS=Object.freeze({controlHeight:36,textareaMinHeight:96,cardMinWidth:320,fieldMinWidth:200,metricMinWidth:140,metricPadding:8,inlineControlWidth:160,gap:12,sectionGap:16,cardPadding:16,metricMinHeight:64,chartHeight:220});
const transparent='.ai-settings,.ai-service-grid,[data-workspace-contents],[data-ai-modes],[data-custom-media],[data-perception-active],.workspace-metrics';
const cards='.pred-visual-grid,.workspace-grid,.settings-workspace,.income-workspace,.pk-workspace,.pk-overview,.pk-analysis,.anchor-analytics,[data-list],[data-memory-list]';
const fields='.grid,.workspace-filter-fields,.anchor-audience-controls,.income-controls,.pk-broadcast-times';
const metrics='.knowledge-metrics,.pred-metrics,.anchor-session-times,.anchor-metrics,.stats,.overview-metrics,.anchor-exhibition-grid,.income-meta,.pk-prob,.pk-reading,.anchor-kpis';
const rows='.knowledge-heading,.knowledge-section-heading,.row,.actions,.ai-key-actions,.ai-test-row,.ai-card-heading,.anchor-periods,.workspace-filter-controls,.workspace-filter-actions,.workspace-filter-heading,.status,.anchor-pagination,.anchor-section-head,.pk-chart-head,.giveaway-actions,.pk-page-heading,.pk-broadcast-master,.pk-broadcast-option,.row-head,.row-head>div,.inline,.feature-row';
const surfaces='.knowledge-toolbar,.knowledge-section,.pred-card,.workspace-card,.settings-group,.ai-card,.anchor-section,.pk-visual,.pk-overview-main,.pk-outlook,.pk-analysis>details,.giveaway-config,.giveaway-live,.editor-row';
const blocks='div,section,article,main,header,footer,form,fieldset,nav,ul,ol,li,dl';

export const isTransparentLayout=node=>node.matches(transparent);
export function describeCollection(node) {
 if(node.matches('[data-list],[data-memory-list],.anchor-gifts,[data-anchor-fanclub-activities]'))return {mode:'scroll'};
 for(const [selector,label] of [['[data-logs]','运行记录'],['[data-profiles]','主播列表'],['[data-agent-results]','研究任务'],['[data-account-records]','账号资料'],['[data-search-history]','问答来源'],['[data-skill-list]','回复技能']]){
  if(node.matches(selector))return {mode:'records',label};
 }
}
export function describeLayout(node) {
 const surface=node.matches(surfaces) ? 'card' : undefined;
 const dataGrid=node.matches('.grid') && !node.querySelector('input,textarea,select');
 const layout=node.matches('[data-memory-list],[data-web-knowledge-list]') ? 'stack' : node.matches('.pk-scoreboard') ? 'scoreboard' : node.matches(cards) ? 'cards' : dataGrid || node.matches(metrics) ? 'metrics' : node.matches(fields) ? 'fields' : node.matches(rows) ? 'row' : node.matches(blocks) ? 'stack' : undefined;
 const span=node.matches('.workspace-wide,[data-ai-section="models"]>.ai-card:first-child') || node.tagName==='DETAILS' && !node.matches('.pk-visual,.pk-outlook,.pk-analysis>details') ? 'full' : undefined;
 return {layout,surface,span};
}

export function layoutChildren(layout,children) {
 if(layout==='cards'){
  const result=children.map(child=>child.surface==='card' ? child : {...child,span:'full'});
  // Each run uses complete pairs; an unpaired card gets the whole final row.
  let start=0;
  for(let i=0;i<=result.length;i++){
   if(i<result.length && result[i].span!=='full')continue;
   if((i-start)%2===1)result[i-1]={...result[i-1],span:'full'};
   start=i+1;
  }
  return result;
 }
 if(layout==='fields')return children.map(child=>child.kind==='field' && child.type!=='textarea' || child.kind==='group' && child.layout==='stack' ? child : {...child,span:'full'});
 return children;
}

export function gridOptions(node) {
 // Full-width children occupy every track, so auto-fit cannot collapse phantom
 // columns. Cap tracks by actual items and let container queries choose the fit.
 const count=node.children.filter(child=>child.span!=='full').length;
 const cards=node.layout==='cards',minimum=cards ? PRODUCT_DIMENSIONS.cardMinWidth : node.layout==='fields' ? PRODUCT_DIMENSIONS.fieldMinWidth : PRODUCT_DIMENSIONS.metricMinWidth;
 const gap=cards ? PRODUCT_DIMENSIONS.sectionGap : PRODUCT_DIMENSIONS.gap,cols={base:1};
 for(let i=2;i<=Math.min(cards ? 2 : 6,count);i++)cols[`${minimum*i+gap*(i-1)}px`]=i;
 return {cols};
}
