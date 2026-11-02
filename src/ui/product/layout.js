// Translate legacy presentation once at the boundary. The visible workspace
// uses these roles, never a second set of source-DOM layout selectors.
const transparent='.ai-settings,.ai-service-grid,[data-workspace-contents],[data-ai-modes],[data-custom-media],[data-perception-active],.workspace-metrics';
const cards='.workspace-grid,.settings-workspace,.income-workspace,.pk-workspace,.pk-overview,.pk-analysis,.anchor-analytics,[data-list],[data-memory-list]';
const fields='.grid,.workspace-filter-fields,.anchor-audience-controls,.income-controls,.pk-broadcast-times';
const metrics='.anchor-session-times,.anchor-metrics,.stats,.overview-metrics,.anchor-exhibition-grid,.income-meta,.pk-prob,.pk-reading,.anchor-kpis';
const rows='.row,.actions,.ai-key-actions,.ai-test-row,.ai-card-heading,.anchor-periods,.workspace-filter-controls,.workspace-filter-actions,.workspace-filter-heading,.status,.anchor-pagination,.anchor-section-head,.pk-chart-head,.giveaway-actions,.pk-page-heading,.pk-broadcast-master,.pk-broadcast-option,.row-head,.row-head>div,.inline';
const surfaces='.workspace-card,.settings-group,.ai-card,.anchor-section,.pk-visual,.pk-overview-main,.pk-outlook,.pk-analysis>details,.giveaway-config,.giveaway-live,.editor-row';
const blocks='div,section,article,main,header,footer,form,fieldset,nav,ul,ol,li,dl';

export const isTransparentLayout=node=>node.matches(transparent);
export function describeLayout(node) {
 const surface=node.matches(surfaces) ? 'card' : undefined;
 const dataGrid=node.matches('.grid') && !node.querySelector('input,textarea,select');
 const layout=node.matches('.pk-scoreboard') ? 'scoreboard' : node.matches(cards) ? 'cards' : dataGrid || node.matches(metrics) ? 'metrics' : node.matches(fields) ? 'fields' : node.matches(rows) ? 'row' : node.matches(blocks) ? 'stack' : undefined;
 const span=node.matches('.workspace-wide,[data-ai-section="models"]>.ai-card:first-child') || node.tagName==='DETAILS' && !node.matches('.pk-visual,.pk-outlook,.pk-analysis>details') ? 'full' : undefined;
 return {layout,surface,span};
}

export function layoutChildren(layout,children) {
 if(layout==='cards')return children.map(child=>child.surface==='card' ? child : {...child,span:'full'});
 if(layout==='fields')return children.map(child=>child.kind==='field' && child.type!=='textarea' || child.kind==='group' && child.layout==='stack' ? child : {...child,span:'full'});
 return children;
}

export function gridOptions(node) {
 // Full-width children occupy every track, so auto-fit cannot collapse phantom
 // columns. Cap tracks by actual items and let container queries choose the fit.
 const count=node.children.filter(child=>child.span!=='full').length;
 if(node.layout==='cards')return {style:{columnCount:Math.max(1,Math.min(3,count))}};
 const minimum=node.layout==='fields' ? 200 : 140,cols={base:1};
 for(let i=2;i<=Math.min(6,count);i++)cols[`${minimum*i+12*(i-1)}px`]=i;
 return {cols};
}
