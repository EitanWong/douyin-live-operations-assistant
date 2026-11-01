import {aliEndpoints} from '../services/ai-pipeline.js';
import {MEMORY_LIMITS,validateMemory,retrieveMemories} from '../services/knowledge.js';
import {AI_SETTINGS_SECTIONS} from './ai-settings-template.js';

const fields=[['title','资料标题','text'],['content','背景正文','textarea'],['source','资料来源 / 确认人','text'],['expiresOn','到期日期（可留空，当日仍有效）','date']];
export class AISettings {
  constructor(root,{dirty,start,stop,clear,forget,error}) {
    this.root=root;this.dirty=dirty;this.error=error;
    const navigation=root.querySelector('.ai-section-tabs');
    navigation.addEventListener('click',event=>{const tab=event.target.closest('[data-ai-section-tab]');if(tab)this.showSection(tab.dataset.aiSectionTab);});
    navigation.addEventListener('keydown',event=>this.navigate(event));
    root.addEventListener('change',event=>{
      if(event.target.matches('[data-field^="ai.media."]'))this.syncMedia();
      if(event.target.matches('[data-field^="ai.search."]'))this.syncSearch();
    });
    root.querySelector('[data-field="ai.pipeline.mode"]').addEventListener('change',()=>this.syncPipeline());
    for(const key of ['workspaceId','region'])root.querySelector(`[data-field="ai.pipeline.${key}"]`).addEventListener('input',()=>{root.querySelector('[data-media-key="pipeline"]').value='';});
    const edited=event=>{if(event.target.matches('[data-memory-field],[data-media-key],[data-media-remember]'))dirty();};
    root.addEventListener('input',edited);root.addEventListener('change',edited);
    root.querySelector('[data-memory-add]').addEventListener('click',()=>{
      if(this.list.children.length>=MEMORY_LIMITS.entries){error(new Error('背景记忆最多40条'));return;}
      this.add({id:crypto.randomUUID(),title:'',content:'',source:'用户填写',updatedAt:Date.now(),expiresOn:'',enabled:true});this.empty();dirty();this.list.lastElementChild.querySelector('input').focus();
    });
    root.querySelector('[data-memory-search]').addEventListener('click',()=>{
      try {
        const query=root.querySelector('[data-memory-query]').value.trim();
        if(!query)throw new Error('请先输入要检索的问题');
        const result=retrieveMemories(this.read(),query),target=root.querySelector('[data-memory-matches]');
        target.replaceChildren();
        const summary=document.createElement('p');summary.textContent=`命中 ${result.chunks.length} 个片段，原文 ${result.usedChars} 字${result.truncated ? '（已按预算与去重规则筛选）' : ''}。`;target.append(summary);
        for(const chunk of result.chunks){
          const item=document.createElement('p');item.textContent=`${chunk.title} · ${chunk.source || '未填写来源'} · 核对时间 ${new Date(chunk.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · 原文位置 ${chunk.range.start}–${chunk.range.end}：${chunk.content}`;target.append(item);
        }
      } catch(reason){error(reason);}
    });
    root.querySelector('[data-media-start]').addEventListener('click',()=>{
      try {Promise.resolve(start()).catch(error);}catch(reason){error(reason);}
    });
    root.querySelector('[data-media-stop]').addEventListener('click',()=>stop());
    root.querySelector('[data-media-clear]').addEventListener('click',()=>clear());
    for(const button of root.querySelectorAll('[data-media-forget]'))button.addEventListener('click',()=>{void Promise.resolve(forget(button.dataset.mediaForget)).catch(error);});
    for(const kind of ['vision','audio'])root.querySelector(`[data-field="ai.media.${kind}Endpoint"]`).addEventListener('input',()=>{root.querySelector(`[data-media-key="${kind}"]`).value='';});
  }
  showSection(key){
    for(const tab of this.root.querySelectorAll('[data-ai-section-tab]')){
      const active=tab.dataset.aiSectionTab===key;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active ? 0 : -1;
    }
    for(const section of this.root.querySelectorAll('[data-ai-section]'))section.hidden=section.dataset.aiSection!==key;
    this.root.querySelector('.ai-section-tabs').scrollIntoView?.({block:'start',behavior:'instant'});
  }
  navigate(event){
    const tab=event.target.closest('[data-ai-section-tab]');
    if(!tab || event.altKey || event.ctrlKey || event.metaKey || event.isComposing)return;
    const keys=AI_SETTINGS_SECTIONS.map(([key])=>key),index=keys.indexOf(tab.dataset.aiSectionTab);
    const next=({ArrowRight:(index+1)%keys.length,ArrowLeft:(index+keys.length-1)%keys.length,Home:0,End:keys.length-1})[event.key];
    if(next===undefined)return;event.preventDefault();this.showSection(keys[next]);this.root.querySelector(`[data-ai-section-tab="${keys[next]}"]`).focus();
  }
  reveal(element){const section=element.closest('[data-ai-section]');if(section)this.showSection(section.dataset.aiSection);}
  syncPipeline(){
    const mode=this.root.querySelector('[data-field="ai.pipeline.mode"]').value;
    this.root.querySelector('[data-pipeline-ali]').hidden=['custom','text'].includes(mode);
    this.root.querySelector('[data-custom-media]').hidden=mode!=='custom';
    this.root.querySelector('[data-text-service]').hidden=mode==='omni-only';
    this.root.querySelector('[data-media-start]').hidden=mode==='text';
    this.root.querySelector('[data-perception-off]').hidden=mode!=='text';
    this.root.querySelector('[data-perception-active]').hidden=mode==='text';
    for(const node of this.root.querySelectorAll('[data-ai-modes]'))node.hidden=!node.dataset.aiModes.split(' ').includes(mode);
    this.root.querySelector('[data-pipeline-role]').textContent=mode==='omni-only' ? '感知 + 回复共用' : '仅感知';
    this.root.querySelector('[data-pipeline-description]').textContent=({custom:'回复服务独立配置；可按需开启自定义视觉、语音或 Omni 分段识别。',text:'只用直播数据、弹幕、知识与搜索生成回复，无需配置感知服务。','omni-llm':'Omni 持续理解直播音画，回复由独立配置的文字模型生成。','omni-only':'同一套百炼配置，Omni 负责直播感知和弹幕回复。','ali-split':'视觉与语音分别按间隔识别直播内容，回复使用文字模型。'})[mode];
    this.root.querySelector('[data-perception-description]').textContent=({custom:'在“连接与模型”启用并配置感知服务，再选择共享的直播标签页。',text:'','omni-llm':'使用“连接与模型”中的 Omni 实时模型识别直播音画。','omni-only':'使用“连接与模型”中的 Omni 实时模型识别直播音画。','ali-split':'使用“连接与模型”中的视觉模型与语音模型分段识别。'})[mode];
    this.syncMedia();
  }
  syncMedia(){
    const enabled=key=>this.root.querySelector(`[data-field="ai.media.${key}Enabled"]`).checked;
    this.root.querySelector('[data-custom-service="vision"]').hidden=!enabled('video');
    this.root.querySelector('[data-custom-service="audio"]').hidden=!enabled('audio') || enabled('omni');
    this.root.querySelector('[data-custom-title="vision"]').textContent=enabled('omni') ? 'Omni 音画服务' : '视觉服务';
  }
  syncSearch(){
    const enabled=this.root.querySelector('[data-field="ai.search.enabled"]').checked;
    const local=this.root.querySelector('[data-field="ai.search.provider"]').value==='searxng';
    this.root.querySelector('[data-search-config]').hidden=!enabled;
    this.root.querySelector('[data-search-auth]').open=!local;
    this.root.querySelector('[data-search-auth-title]').hidden=!local;
    this.root.querySelector('[data-searxng-help]').hidden=!local;
    this.root.querySelector('[data-search-endpoint]').open=local;
  }
  pipelineEndpoint(){
    const ai={pipeline:{mode:this.root.querySelector('[data-field="ai.pipeline.mode"]').value,region:this.root.querySelector('[data-field="ai.pipeline.region"]').value,workspaceId:this.root.querySelector('[data-field="ai.pipeline.workspaceId"]').value.trim()}};
    return aliEndpoints(ai).chat;
  }
  get list(){return this.root.querySelector('[data-memory-list]');}
  empty(){this.root.querySelector('[data-memory-empty]').hidden=Boolean(this.list.children.length);}
  add(record){
    const row=document.createElement('div');row.className='editor-row';row.record=structuredClone(record);
    row.innerHTML='<div class="row-head"><b>背景资料</b><button type="button" data-memory-remove>删除这条记忆</button></div>';
    for(const [name,title,type] of fields){
      const label=document.createElement('label');label.className='field';const span=document.createElement('span');span.textContent=title;
      const control=document.createElement(type==='textarea' ? 'textarea' : 'input');if(type!=='textarea')control.type=type;
      control.dataset.memoryField=name;control.value=record[name];control.maxLength=name==='content' ? 2000 : name==='title' ? 80 : 200;label.append(span,control);row.append(label);
    }
    const label=document.createElement('label');label.className='toggle';const enabled=document.createElement('input');enabled.type='checkbox';enabled.dataset.memoryField='enabled';enabled.checked=record.enabled;label.append(enabled,'使用这条资料');row.append(label);
    const checked=document.createElement('small');checked.textContent=`核对时间：${new Date(record.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`;row.append(checked);
    row.querySelector('[data-memory-remove]').addEventListener('click',()=>{row.remove();this.empty();this.dirty();});
    this.list.append(row);
  }
  populate(memory){this.list.replaceChildren();for(const record of memory.entries)this.add(record);this.empty();for(const input of this.root.querySelectorAll('[data-media-key]'))input.value='';this.syncPipeline();this.syncSearch();this.root.querySelector('[data-ali-account]').open=!this.root.querySelector('[data-field="ai.pipeline.workspaceId"]').value.trim();}
  read(){
    const memory={enabled:this.root.querySelector('[data-field="ai.memory.enabled"]').checked,entries:[...this.list.children].map(row=>{
      const result={...row.record};for(const input of row.querySelectorAll('[data-memory-field]'))result[input.dataset.memoryField]=input.type==='checkbox' ? input.checked : input.value.trim();
      if(Object.keys(result).some(key=>result[key]!==row.record[key]))result.updatedAt=Date.now();return result;
    })};
    return validateMemory(memory);
  }
  credentials(){return Object.fromEntries(['vision','audio','pipeline'].map(kind=>[kind,{key:this.root.querySelector(`[data-media-key="${kind}"]`).value.trim(),remember:this.root.querySelector(`[data-media-remember="${kind}"]`).checked}]));}
  state({state,skipped=0,errors=0,totalTokens,lastFinalAt}){
    this.root.querySelector('[data-media-start]').disabled=state!=='idle';this.root.querySelector('[data-media-stop]').disabled=state==='idle';
    this.root.querySelector('[data-media-status]').textContent=`${({idle:'识别已停止',starting:'正在选择直播标签页或等待服务配置确认',running:'正在持续识别所选共享内容'})[state]} · 忙时跳过 ${skipped} 次 · 失败 ${errors} 次${totalTokens!==undefined ? ` · 已用 ${totalTokens} token` : ''}${lastFinalAt ? ` · 最近完成 ${new Date(lastFinalAt).toLocaleTimeString('zh-CN')}` : ''}`;
    if(state==='starting')this.showError('');
  }
  showError(message){const target=this.root.querySelector('[data-media-error]');target.textContent=message;target.hidden=!message;}
  observations(rows){
    const target=this.root.querySelector('[data-media-results]');target.replaceChildren();
    if(!rows.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='当前没有有效识别结果。';target.append(empty);}
    for(const row of rows){const p=document.createElement('p');p.textContent=`${new Date(row.at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · ${row.kind==='omni' ? '音画' : row.kind==='video' ? '画面' : '语音'}：${row.text}`;target.append(p);}
  }
}
