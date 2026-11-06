// Presentation boundaries reuse live nodes, so drafts and business listeners keep
// one owner even when controls move between the shared shell and a page.
import {appendWorkspaceGuide} from './workspace-help.js';
export function element(parent,tag,className,attribute){
  const node=parent.ownerDocument.createElement(tag);if(className)node.className=className;if(attribute)node.setAttribute(attribute,'');return node;
}
function unwrap(node){node.replaceWith(...node.childNodes);}
function section(parent,title,attribute){
  const node=element(parent,'section','workspace-card',attribute),heading=element(parent,'h3');heading.textContent=title;node.append(heading);return node;
}
function fieldOf(node){return node?.closest('.field') || node;}
function flattenSettings(page){
  for(const column of [...page.querySelectorAll('.settings-column')]){
    if(column.matches('section')){column.classList.remove('settings-column');continue;}
    // Loose diagnostic fields belong to the preceding heading, rather than an
    // anonymous column. Other settings already have their own named sections.
    if(column.querySelector(':scope>.subhead')){
      let current;
      for(const child of [...column.children]){
        if(child.matches('.subhead')){current=section(column,child.textContent);column.insertBefore(current,child);child.remove();}
        else if(child.matches('section.settings-group')){current=null;}
        else if(current)current.append(child);
        else if(child.matches('details,.section'))child.classList.add('workspace-card');
      }
    }
    unwrap(column);
  }
  for(const workspace of [...page.querySelectorAll('.settings-workspace')].reverse()){
    if(workspace.hasAttribute('data-moderation-settings')){workspace.classList.remove('settings-workspace');workspace.classList.add('workspace-grid');workspace.dataset.workspaceGrid='';for(const card of workspace.children){card.dataset.workspaceCard='';card.classList.add('workspace-card');}}
    else unwrap(workspace);
  }
}
function organizeAnchor(page){
  const overview=page.querySelector('[data-anchor-content=overview]');
  if(!overview)return;
  const filters=section(page,'统计范围','data-workspace-anchor-filters');
  const fields=element(page,'div','workspace-filter-fields');
  for(const selector of ['[data-anchor-picker]','[data-anchor-date]','[data-anchor-session-picker]']){
    const field=fieldOf(page.querySelector(selector));if(field)fields.append(field);
  }
  const periods=page.querySelector('.anchor-periods'),actions=element(page,'div','actions workspace-filter-actions');
  for(const selector of ['[data-action="refresh-anchor"]','[data-action="export-anchor"]']){const button=page.querySelector(selector);if(button)actions.append(button);}
  const status=page.querySelector('[data-anchor-report-name]')?.closest('.status');const heading=element(page,'div','workspace-filter-heading');heading.append(filters.querySelector('h3'));if(status)heading.append(status);filters.append(heading,fields);
  const controls=element(page,'div','workspace-filter-controls');if(periods)controls.append(periods);controls.append(actions);filters.append(controls);overview.prepend(filters);
  for(const shell of overview.querySelectorAll('.anchor-controls'))shell.remove();
  for(const shell of [...overview.querySelectorAll('.anchor-session-overview,.anchor-scope-fields')])unwrap(shell);
  const times=page.querySelector('.anchor-session-times'),periodNote=page.querySelector('[data-anchor-period-note]');
  if(times)filters.append(times);if(periodNote)filters.append(periodNote);
  const metrics=element(page,'div','workspace-metrics','data-workspace-anchor-metrics');
  for(const group of [...overview.querySelectorAll('.anchor-metrics')])metrics.append(group);
  filters.after(metrics);
  const incomeNote=page.querySelector('[data-anchor-income-note]');if(incomeNote)metrics.after(incomeNote);
  for(const shell of [...overview.querySelectorAll('.anchor-metric-workspace,.anchor-live-workspace,.anchor-workspace,.anchor-analytics')].reverse())unwrap(shell);
  const data=element(page,'div','workspace-grid','data-workspace-anchor-data');data.dataset.workspaceGrid='';
  const cards=[...overview.querySelectorAll(':scope>.anchor-section')].sort((a,b)=>Number(a.matches('.anchor-audience-section,.anchor-battles-section'))-Number(b.matches('.anchor-audience-section,.anchor-battles-section')));
  for(const card of cards){card.classList.add('workspace-card');card.dataset.workspaceCard='';if(card.matches('.anchor-audience-section,.anchor-battles-section'))card.classList.add('workspace-wide');data.append(card);}
  overview.append(data);
  const basis=page.querySelector('[data-anchor-basis]');if(basis){const detail=element(page,'details','workspace-help'),summary=element(page,'summary');summary.textContent='数据口径';detail.append(summary,basis);overview.append(detail);}
  const income=page.querySelector('.income-workspace');if(income){income.classList.add('workspace-grid');income.dataset.workspaceGrid='';for(const child of income.children){child.classList.add('workspace-card');child.dataset.workspaceCard='';}}
}
function pageHelp(page,key=page.dataset.page || page.dataset.toolPanel,title=page.dataset.toolLabel ? `${page.dataset.toolLabel} · 使用说明` : '使用说明'){
  const intro=page.querySelector(':scope>.intro');
  const help=element(page,'details','workspace-help','data-workspace-help'),summary=element(page,'summary');
  if(!appendWorkspaceGuide(help,key) && !intro)return;
  help.dataset.workspaceUtility='help';summary.textContent=title;help.prepend(summary);if(intro)summary.after(intro);page.append(help);
}
function subviewHelp(page){
  for(const scope of page.querySelectorAll('[data-ai-section],[data-anchor-content],[data-knowledge-section]')){
    const ai=scope.dataset.aiSection,knowledge=scope.dataset.knowledgeSection,key=ai || knowledge || scope.dataset.anchorContent;
    const label=page.querySelector(ai ? `[data-ai-section-tab="${key}"]` : knowledge ? `[data-knowledge-section-tab="${key}"]` : `[data-anchor-view="${key}"]`)?.textContent || key;
    pageHelp(scope,`${ai ? 'ai' : knowledge ? 'knowledge' : 'anchor'}.${key}`,`${label} · 使用说明`);
  }
}
function organizeShortSections(page){
  if(page.dataset.page==='likes'){
    const rules=page.querySelector('[data-field="like.responseMode"]').closest('.settings-group'),copy=page.querySelector('[data-field="like.templates"]').closest('.settings-group');
    rules.querySelector('h3').textContent='感谢方式与话术';copy.querySelector('h3').remove();rules.append(...copy.childNodes);copy.remove();
  }
  if(page.dataset.page==='gift'){
    page.querySelector('.gift-totals')?.classList.add('workspace-wide');
    const recent=page.querySelector('.recent-gifts');
    if(recent){const details=element(page,'details','recent-gifts workspace-card'),summary=element(page,'summary');summary.append(...recent.querySelector('.log-head').childNodes);recent.querySelector('.log-head').remove();details.append(summary,...recent.childNodes);recent.replaceWith(details);}
  }
  if(page.dataset.page==='bot'){
    for(const card of page.querySelectorAll(':scope>.settings-group'))card.classList.add('workspace-wide');
    page.querySelector('.feature-list')?.classList.add('bot-game-options');
  }
}
function organizeAI(page){
  const models=page.querySelector('[data-ai-section=models]');if(!models)return;
  const configuration=models.querySelector('[data-field="ai.pipeline.mode"]').closest('.ai-card');
  for(const selector of ['[data-reply-slider]','[data-action=test-ai]']){
    const card=models.querySelector(selector).closest('.ai-card'),heading=card.querySelector('h3'),label=element(page,'h4');label.textContent=heading.textContent;heading.replaceWith(label);configuration.append(...card.childNodes);card.remove();
  }
  const custom=models.querySelector('[data-field="ai.media.videoEnabled"]').closest('.ai-card'),details=element(page,'details',custom.className),summary=element(page,'summary');summary.textContent=custom.querySelector('h3').textContent;custom.querySelector('h3').remove();details.append(summary,...custom.childNodes);custom.replaceWith(details);
  page.querySelector('[data-media-start]').closest('.ai-card').classList.add('workspace-wide');
}
export function organizePage(page){
  for(const module of page.querySelectorAll('[data-tool-panel]'))pageHelp(module);
  if(page.dataset.page==='anchor'){organizeAnchor(page);subviewHelp(page);pageHelp(page);return;}
  flattenSettings(page);
  organizeShortSections(page);
  if(page.dataset.page==='ai')organizeAI(page);
  const body=element(page,'div','workspace-grid','data-workspace-body');body.dataset.workspaceGrid='';
  const candidates=[...page.children].filter(child=>child.matches('.settings-group,.workspace-card,.gift-totals,.recent-gifts,.identity,.giveaway-config,.giveaway-live,details.advanced'));
  if(candidates.length){candidates[0].before(body);for(const card of candidates){card.classList.add('workspace-card');card.dataset.workspaceCard='';body.append(card);}}
  // AI sections own their own layouts and visibility, but share the card scale.
  for(const scope of page.querySelectorAll('[data-ai-section]')){
    scope.classList.add('workspace-grid');scope.dataset.workspaceGrid='';
    for(const wrapper of scope.children)if(!wrapper.matches('.ai-card') && wrapper.querySelector(':scope>.ai-card'))wrapper.dataset.workspaceContents='';
    for(const card of scope.querySelectorAll(':scope>.ai-card,:scope>[data-workspace-contents]>.ai-card')){card.dataset.workspaceCard='';card.classList.add('workspace-card');}
  }
  subviewHelp(page);if(page.dataset.page!=='knowledge')pageHelp(page);
}
