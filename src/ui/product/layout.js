// Translate legacy presentation once at the boundary. The visible workspace
// uses these roles, never a second set of source-DOM layout selectors.
const transparent='.ai-settings,.ai-service-grid,[data-workspace-contents],[data-ai-modes],[data-custom-media],[data-perception-active],.workspace-metrics';
const cards='.workspace-grid,.settings-workspace,.income-workspace,.pk-workspace,.anchor-analytics';
const fields='.grid,.workspace-filter-fields,.anchor-audience-controls,.income-controls';
const metrics='.anchor-session-times,.anchor-metrics,.stats,.overview-metrics,.anchor-exhibition-grid,.income-meta,.pk-prob,.pk-reading,.anchor-kpis';
const rows='.row,.actions,.ai-key-actions,.ai-test-row,.ai-card-heading,.anchor-periods,.workspace-filter-controls,.workspace-filter-actions,.workspace-filter-heading,.status,.anchor-pagination,.anchor-section-head,.pk-chart-head,.giveaway-actions';
const surfaces='.workspace-card,.settings-group,.ai-card,.anchor-section,.pk-visual,.giveaway-config,.giveaway-live';
const blocks='DIV,SECTION,ARTICLE,MAIN,HEADER,FOOTER,FORM,FIELDSET,NAV,UL,OL,LI,DL';

export const isTransparentLayout=node=>node.matches(transparent);
export function describeLayout(node) {
 const surface=node.matches(surfaces) ? 'card' : undefined;
 const layout=node.matches(cards) ? 'cards' : node.matches(fields) ? 'fields' : node.matches(metrics) ? 'metrics' : node.matches(rows) ? 'row' : node.matches(blocks) ? 'stack' : undefined;
 const span=node.matches('.workspace-wide,[data-ai-section="models"]>.ai-card:first-child') || node.tagName==='DETAILS' && !node.matches('.pk-visual') ? 'full' : undefined;
 return {layout,surface,span};
}

export function layoutChildren(layout,children) {
 if(layout==='cards')return children.map(child=>child.surface==='card' ? child : {...child,span:'full'});
 if(layout==='fields')return children.map(child=>child.kind==='field' && child.type!=='textarea' || child.kind==='group' && child.layout==='stack' ? child : {...child,span:'full'});
 return children;
}

export function gridOptions(node) {
 // Spanning notes must not reserve an otherwise empty second column.
 if(node.children.filter(child=>child.span!=='full').length<=1)return {cols:1};
 const minimum=({cards:340,fields:200,metrics:140})[node.layout];
 return {minColWidth:`min(100%, ${minimum}px)`,autoFlow:'auto-fit'};
}
