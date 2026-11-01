// Presentation boundaries reuse live nodes, so drafts and business listeners keep
// one owner even when controls move between the shared shell and a page.
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
  const broadcast=page.querySelector('.anchor-broadcast-section');
  if(broadcast){
    const view=element(page,'div','','data-anchor-content');view.dataset.anchorContent='broadcast';view.id='anchor-broadcast';view.hidden=true;view.append(broadcast);page.append(view);
    const button=element(page,'button');button.type='button';button.dataset.anchorView='broadcast';button.setAttribute('aria-pressed','false');button.setAttribute('aria-controls',view.id);button.textContent='播报设置';page.querySelector('.anchor-views').append(button);
  }
  for(const shell of [...overview.querySelectorAll('.anchor-metric-workspace,.anchor-live-workspace,.anchor-workspace,.anchor-analytics')].reverse())unwrap(shell);
  const data=element(page,'div','workspace-grid','data-workspace-anchor-data');data.dataset.workspaceGrid='';
  const cards=[...overview.querySelectorAll(':scope>.anchor-section')].sort((a,b)=>Number(a.matches('.anchor-audience-section,.anchor-battles-section'))-Number(b.matches('.anchor-audience-section,.anchor-battles-section')));
  for(const card of cards){card.classList.add('workspace-card');card.dataset.workspaceCard='';if(card.matches('.anchor-audience-section,.anchor-battles-section'))card.classList.add('workspace-wide');data.append(card);}
  overview.append(data);
  const basis=page.querySelector('[data-anchor-basis]');if(basis){const detail=element(page,'details','workspace-help'),summary=element(page,'summary');summary.textContent='数据口径';detail.append(summary,basis);overview.append(detail);}
  const income=page.querySelector('.income-workspace');if(income){income.classList.add('workspace-grid');income.dataset.workspaceGrid='';for(const child of income.children){child.classList.add('workspace-card');child.dataset.workspaceCard='';}}
}
function pageHelp(page){
  const intro=page.querySelector(':scope>.intro');if(!intro)return;
  const help=element(page,'details','workspace-help','data-workspace-help'),summary=element(page,'summary');summary.textContent='使用说明';help.append(summary,intro);page.append(help);
}
export function organizePage(page){
  if(page.dataset.page==='anchor'){organizeAnchor(page);pageHelp(page);return;}
  flattenSettings(page);
  const body=element(page,'div','workspace-grid','data-workspace-body');body.dataset.workspaceGrid='';
  const candidates=[...page.children].filter(child=>child.matches('.settings-group,.workspace-card,.gift-totals,.recent-gifts,.identity,.giveaway-config,.giveaway-live,details.advanced'));
  if(candidates.length){candidates[0].before(body);for(const card of candidates){card.classList.add('workspace-card');card.dataset.workspaceCard='';body.append(card);}}
  // AI sections own their own layouts and visibility, but share the card scale.
  for(const scope of page.querySelectorAll('[data-ai-section]')){
    scope.classList.add('workspace-grid');scope.dataset.workspaceGrid='';
    for(const wrapper of scope.children)if(!wrapper.matches('.ai-card') && wrapper.querySelector(':scope>.ai-card'))wrapper.dataset.workspaceContents='';
    for(const card of scope.querySelectorAll(':scope>.ai-card,:scope>[data-workspace-contents]>.ai-card')){card.dataset.workspaceCard='';card.classList.add('workspace-card');}
  }
  pageHelp(page);
}
