// Transitional boundary: the controller owns drafts and actions; React owns
// presentation. Only the active page is projected, never a second config store.
import {describeLayout,describeCollection,isTransparentLayout,layoutChildren,partitionPageUtilities} from './layout.js';
import {APPEARANCE_PREFERENCES} from '../appearance.js';
import {shareView} from './snapshot.js';

const ignored = 'STYLE,SCRIPT,OPTION,SUMMARY,TEMPLATE'.split(',');
const containers = 'DIV,SECTION,ARTICLE,MAIN,HEADER,FOOTER,FORM,FIELDSET,LABEL,NAV,DL,DT,DD'.split(',');
const cleanText = node => node?.textContent.replace(/\s+/gu, ' ').trim() || '';
const shown = node => !node.hidden && node.getAttribute('aria-hidden') !== 'true';
const available = node => { for (let p=node;p;p=p.parentElement) if(p.hidden)return false;return true; };

export function createWorkspaceBridge(panel) {
  const root=panel.root, view=root.ownerDocument.defaultView, ids=new WeakMap(), nodes=new Map(), listeners=new Set();
  let serial=0, snapshot, destroyed=false, focus=null, focusSerial=0;
  function id(node) {
    if(!ids.has(node))ids.set(node,`control-${++serial}`);
    const key=ids.get(node);nodes.set(key,node);return key;
  }
  function children(node) { return [...node.childNodes].flatMap(child=>child.nodeType===1 && shown(child) && isTransparentLayout(child) ? children(child) : [project(child)]).filter(Boolean); }
  function field(input,wrapper=input) {
    const label=wrapper.querySelector(':scope>span') || wrapper.querySelector('.feature-title');
    const textNodes=[...wrapper.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim();
    const labelText=label ? [...label.childNodes].filter(n=>n.nodeName!=='SMALL').map(n=>n.textContent).join(' ').trim() : '';
    const name=input.getAttribute('aria-label') || labelText || wrapper.getAttribute('aria-label') || textNodes || input.name || input.type;
    return {kind:'field',id:id(input),label:name,labelHidden:wrapper===input && input.hasAttribute('aria-label') || wrapper.matches('.switch') && !labelText && !textNodes,description:cleanText(wrapper.querySelector('small')),type:input.tagName==='SELECT' ? 'select' : input.tagName==='TEXTAREA' ? 'textarea' : input.type,
      value:input.type==='checkbox' ? input.checked : input.value,disabled:input.disabled,invalid:input.getAttribute('aria-invalid')==='true',placeholder:input.placeholder,appearance:input.hasAttribute('data-theme-palette') ? 'palette' : undefined,
      min:input.min,max:input.max,step:input.step,valueText:input.getAttribute('aria-valuetext'),autofocus:input.autofocus,maxLength:input.maxLength>0 ? input.maxLength : undefined,readOnly:input.readOnly,
      options:input.tagName==='SELECT' ? [...input.options].filter(o=>!o.hidden).map(o=>({value:o.value,label:o.text,disabled:o.disabled})) : undefined};
  }
  function table(node) {
    const body=node.tBodies[0], headers=[...node.querySelectorAll('thead th')].map(cleanText);
    const rows=[...(body?.rows || [])];
    let scope='loaded';
    for(let parent=node.parentElement;parent && !parent.matches('[data-page]');parent=parent.parentElement)if(parent.querySelector(':scope>.anchor-pagination')){scope='page';break;}
    const heading=node.closest('details')?.querySelector(':scope>summary') || node.closest('section')?.querySelector('h3');
    return {kind:'table',id:id(node),headers,scope,sourceControlled:Boolean(node.closest('[data-collection-source]')),rows:rows.map(row=>[...row.cells].map(cleanText)),cells:rows.map(row=>[...row.cells].map(cell=>({children:children(cell),colSpan:cell.colSpan}))),caption:node.getAttribute('aria-label') || cleanText(node.caption) || cleanText(heading)};
  }
  function project(node) {
    if(!node)return null;
    if(node.nodeType===3)return node.textContent.trim() ? {kind:'text',text:node.textContent} : null;
    if(node.nodeType!==1 || !shown(node) || ignored.includes(node.tagName) || node.matches('.workspace-source-title,h2,[data-knowledge-dialog]'))return null;
    if(node.matches('.feature-row')){const input=node.querySelector('input[type=checkbox]');if(input)return field(input,node);}
    if(node.matches('label') && node.querySelector('input,textarea,select'))return field(node.querySelector('input,textarea,select'),node);
    if(node.matches('input,textarea,select'))return field(node);
    if(node.matches('.stat-progress'))return {kind:'progress',id:id(node),label:node.getAttribute('aria-label'),value:node.hasAttribute('aria-valuenow') ? Number(node.getAttribute('aria-valuenow'))/Number(node.getAttribute('aria-valuemax'))*100 : null};
    if(node.matches('.stat-bars'))return {kind:'bars',id:id(node),label:node.getAttribute('aria-label'),items:[...node.querySelectorAll('.stat-bar')].map(bar=>({label:bar.getAttribute('aria-label'),value:cleanText(bar.querySelector('.stat-bar-value')),scale:Number(bar.querySelector('.stat-bar-fill')?.style.transform.match(/scaleY\(([^)]+)\)/u)?.[1] || 0)*100}))};
    if(node.matches('.stat-distribution'))return {kind:'distribution',id:id(node),label:node.getAttribute('aria-label'),parts:[...node.children].map(part=>({value:Number(part.style.flex),label:part.title,outcome:part.dataset.outcome}))};
    if(node.hasAttribute('data-record-browser'))return {kind:'record-browser',id:id(node),label:node.dataset.recordBrowser,children:[...node.children].filter(child=>child.hasAttribute('data-record-item')).map(project).filter(Boolean)};
    if(node.hasAttribute('data-workspace-chart') && node.chartOption)return {kind:'chart',id:id(node),option:node.chartOption,label:node.getAttribute('aria-label')};
    const predictionName=node.getAttribute('data-pred-chart');
    if(predictionName && panel.predictionCharts?.options[predictionName])return {kind:'chart',id:id(node),option:panel.predictionCharts.options[predictionName],label:node.getAttribute('aria-label')};
    const chartName=node.getAttribute('data-pk-chart') || node.getAttribute('data-anchor-chart');
    if(chartName){const owner=node.hasAttribute('data-pk-chart') ? panel.charts : panel.anchorDashboard?.charts,chart=owner?.instances.get(chartName);if(chart)return {kind:'chart',id:id(node),option:chart.getOption(),label:node.getAttribute('aria-label')};}
    if(node.tagName==='BUTTON')return {kind:'button',id:id(node),text:cleanText(node) || node.getAttribute('aria-label'),label:node.getAttribute('aria-label'),disabled:node.disabled,busy:node.getAttribute('aria-busy')==='true',selected:node.getAttribute('aria-pressed')==='true' || node.getAttribute('aria-selected')==='true',primary:node.matches('.primary'),danger:node.matches('.danger'),icon:node.querySelector('svg')?.outerHTML};
    if(node.tagName==='TABLE')return table(node);
    if(node.tagName==='DETAILS')return {kind:'details',id:id(node),recordKey:node.dataset.recordItem,classes:node.className,...describeLayout(node),utility:['help','manage'].includes(node.dataset.workspaceUtility) ? node.dataset.workspaceUtility : node.matches('.workspace-help') ? 'help' : undefined,open:node.open,title:node.getAttribute('aria-label') || cleanText(node.querySelector(':scope>summary')),children:children(node)};
    if(node.localName==='svg')return {kind:'svg',id:id(node),html:node.outerHTML,label:node.getAttribute('aria-label')};
    if(node.tagName==='A')return /^https?:/u.test(node.href) ? {kind:'link',id:id(node),text:cleanText(node),href:node.href} : {kind:'text',text:cleanText(node)};
    if(node.tagName==='IMG')return {kind:'image',id:id(node),src:node.src,alt:node.alt};
    if(node.tagName==='BR')return {kind:'break'};
    const content=children(node);if(!content.length)return null;
    const classes=[node.className?.baseVal ?? node.className,node.dataset.aiSection ? `product-ai-${node.dataset.aiSection}` : '',node.hasAttribute('data-workspace-contents') ? 'workspace-contents' : ''].filter(Boolean).join(' ');
    const layout=describeLayout(node);
    return {kind:'group',id:id(node),...layout,inspectable:node.matches('.ai-final-answer,.ai-result-section') || undefined,collection:describeCollection(node),tag:node.tagName==='LEGEND' ? 'h3' : containers.includes(node.tagName) ? 'div' : ['H3','H4','P','SPAN','B','STRONG','SMALL','EM','CODE','PRE','DT','DD','OL','UL','LI'].includes(node.tagName) ? node.tagName.toLowerCase() : 'div',classes,children:layoutChildren(layout.layout,content),label:node.getAttribute('aria-label'),role:node.getAttribute('role') || undefined};
  }
  function collect() {
    // Only the projected view owns strong references; IDs survive in the WeakMap
    // when a controller detaches/reuses a control or the user changes pages.
    nodes.clear();
    const key=panel.activeTab, page=[...root.querySelectorAll('[data-page]')].find(p=>p.dataset.page===key);
    const nav=[...root.querySelectorAll('[data-tab]')].filter(n=>!n.hidden).map(n=>({key:n.dataset.tab,label:n.getAttribute('aria-label') || cleanText(n),group:cleanText(n.closest('[data-nav-group]')?.querySelector('.nav-group-title')),icon:n.querySelector('svg')?.outerHTML}));
    const toolbar=[...(root.querySelector('[data-workspace-toolbar] .foot')?.children || [])].filter(shown).flatMap(n=>n.matches('button,small') ? [project(n)] : children(n)).filter(Boolean);
    const subviews=[...root.querySelectorAll('[data-workspace-views] button')].filter(n=>available(n)).map(project);
    const dialog=page?.querySelector('[data-knowledge-dialog]:not([hidden])');
    const pageView=partitionPageUtilities(page ? {kind:'group',id:id(page),layout:'stack',tag:'div',classes:'product-page',children:children(page)} : null);
    return {key,title:nav.find(n=>n.key===key)?.label || cleanText(page?.querySelector('h2')),nav,toolbar,subviews,sidebar:{side:panel.navigation?.side || 'left',collapsed:Boolean(panel.navigation?.collapsed),toggle:project(root.querySelector('[data-sidebar-toggle]'))},
      dialog:dialog ? {id:id(dialog),title:cleanText(dialog.querySelector('[data-memory-dialog-title]')),cancelId:id(dialog.querySelector('[data-memory-cancel]')),children:children(dialog.querySelector('[data-knowledge-dialog-body]'))} : null,
      ...pageView,
      messages:[...(root.querySelector('.workspace-message-list')?.children || [])].filter(shown).map(node=>({...project(node),error:node.classList.contains('error')})).filter(Boolean),status:[...(root.querySelector('.shell-status')?.children || [])].map(cleanText).join(' · '),theme:panel.host.dataset.theme || APPEARANCE_PREFERENCES.theme.fallback,palette:panel.host.dataset.palette || APPEARANCE_PREFERENCES.palette.fallback,material:panel.host.dataset.material || APPEARANCE_PREFERENCES.material.fallback,focus};
  }
  function refresh() {
    if(destroyed)return;
    const next=shareView(snapshot,collect());if(next===snapshot)return;
    snapshot=next;for(const listener of listeners)listener();
  }
  const observer=new view.MutationObserver(records=>{
    const relevant=records.filter(record=>{
      const node=record.target.nodeType===1 ? record.target : record.target.parentElement;
      const page=node?.closest('[data-page]');
      return !page || page.dataset.page===panel.activeTab;
    });
    if(!relevant.length)return;
    const invalid=relevant.find(r=>r.attributeName==='aria-invalid' && r.target.getAttribute('aria-invalid')==='true');
    if(invalid)focus={id:id(invalid.target),serial:++focusSerial};refresh();
  });
  observer.observe(root.querySelector('.workspace') || root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','open','disabled','aria-invalid','aria-pressed','aria-selected','aria-busy','aria-valuenow','aria-valuemax','class','data-nav-collapsed','data-nav-side']});
  const themeObserver=new view.MutationObserver(refresh);themeObserver.observe(panel.host,{attributes:true,attributeFilter:['data-theme','data-palette','data-material']});
  root.addEventListener('input',refresh);root.addEventListener('change',refresh);
  refresh();
  return {
    getSnapshot:()=>snapshot,subscribe(listener){if(destroyed)return ()=>{};listeners.add(listener);return ()=>listeners.delete(listener);},refresh,
    change(key,value){const node=nodes.get(key);if(!node || !root.contains(node) || !available(node) || node.disabled || node.readOnly)return false;
      if(node.type==='checkbox')node.checked=Boolean(value);else node.value=String(value);
      node.dispatchEvent(new view.Event(node.tagName==='SELECT' || ['checkbox','date','month','time','color','range'].includes(node.type) ? 'change' : 'input',{bubbles:true}));refresh();return true;},
    activate(key){const node=nodes.get(key);if(!node || !root.contains(node) || !available(node) || node.disabled)return false;node.click();refresh();return true;},
    chartSelect(key,selection){const node=nodes.get(key);if(!node || !root.contains(node) || !available(node))return false;node.dispatchEvent(new view.CustomEvent('chart-select',{detail:selection}));refresh();return true;},
    toggle(key,open){const node=nodes.get(key);if(!node || !root.contains(node) || node.tagName!=='DETAILS')return false;node.open=open;refresh();return true;},
    reveal(key){const node=nodes.get(key);if(!node || !root.contains(node) || !available(node))return false;for(let parent=node;parent && parent!==root;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;refresh();return true;},
    navigate(key){if(destroyed || !snapshot.nav.some(n=>n.key===key))return;panel.tab(key);refresh();},
    destroy(){destroyed=true;observer.disconnect();themeObserver.disconnect();root.removeEventListener('input',refresh);root.removeEventListener('change',refresh);listeners.clear();nodes.clear();snapshot=null;focus=null;}
  };
}
