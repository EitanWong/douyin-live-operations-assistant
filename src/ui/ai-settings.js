import {REPLY_FREQUENCIES,REPLY_FREQUENCY_HELP} from '../ai/turn-taking.js';
import {validateSkillPack} from '../ai/skills.js';
import {aliEndpoints} from '../services/ai-pipeline.js';
import {AI_SETTINGS_SECTIONS} from './ai-settings-template.js';

export class AISettings {
  constructor(root,{dirty,start,stop,clear,forget,error,checkNative,diagnose}) {
    this.root=root;this.dirty=dirty;this.error=error;this.skills=[];
    root.querySelector('[data-skill-install]').addEventListener('click',()=>{try{const skill=validateSkillPack(JSON.parse(root.querySelector('[data-skill-json]').value));if(this.skills.length>=8 && !this.skills.some(s=>s.id===skill.id))throw new Error('自定义技能最多8个');this.skills=this.skills.filter(s=>s.id!==skill.id).concat(skill);this.showSkills();dirty();}catch(reason){error(reason);}});
    const slider=root.querySelector('[data-reply-slider]');
    const changeFrequency=()=>{root.querySelector('[data-field="ai.replyFrequency"]').value=REPLY_FREQUENCIES[Number(slider.value)][0];this.syncReplyFrequency();dirty();};
    slider.addEventListener('input',changeFrequency);slider.addEventListener('change',changeFrequency);
    const navigation=root.querySelector('.ai-section-tabs');
    navigation.addEventListener('click',event=>{const tab=event.target.closest('[data-ai-section-tab]');if(tab)this.showSection(tab.dataset.aiSectionTab);});
    navigation.addEventListener('keydown',event=>this.navigate(event));
    root.addEventListener('change',event=>{
      if(event.target.matches('[data-field^="ai.media."]'))this.syncMedia();
      if(event.target.matches('[data-field^="ai.search."]'))this.syncSearch();
    });
    root.querySelector('[data-field="ai.pipeline.mode"]').addEventListener('change',()=>this.syncPipeline());
    for(const key of ['workspaceId','region'])root.querySelector(`[data-field="ai.pipeline.${key}"]`).addEventListener('input',()=>{root.querySelector('[data-media-key="pipeline"]').value='';});
    const edited=event=>{if(event.target.matches('[data-media-key],[data-media-remember]'))dirty();};
    root.addEventListener('input',edited);root.addEventListener('change',edited);
    root.querySelector('[data-media-start]').addEventListener('click',()=>{
      try {Promise.resolve(start()).catch(error);}catch(reason){error(reason);}
    });
    root.querySelector('[data-media-stop]').addEventListener('click',()=>stop());
    root.querySelector('[data-ai-diagnose]').addEventListener('click',async event=>{
      const button=event.currentTarget,status=root.querySelector('[data-ai-context-status]');button.disabled=true;status.textContent='正在检查已保存的运行配置…';
      try{const rows=await diagnose();status.replaceChildren(...rows.map(text=>{const p=status.ownerDocument.createElement('p');p.textContent=text;return p;}));}catch(reason){status.textContent=`检查失败：${reason.message}`;}finally{button.disabled=false;}
    });
    root.querySelector('[data-native-check]').addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;this.showError('');
      const status=this.root.querySelector('[data-native-status]');status.textContent='正在检查本地组件…';
      try{status.textContent=await checkNative();}catch(reason){status.textContent=reason.message;}finally{button.disabled=false;}
    });
    root.querySelector('[data-media-clear]').addEventListener('click',()=>clear());
    for(const button of root.querySelectorAll('[data-media-forget]'))button.addEventListener('click',()=>{void Promise.resolve(forget(button.dataset.mediaForget)).catch(error);});
    for(const kind of ['vision','audio'])root.querySelector(`[data-field="ai.media.${kind}Endpoint"]`).addEventListener('input',()=>{root.querySelector(`[data-media-key="${kind}"]`).value='';});
  }
  syncReplyFrequency(){
    const value=this.root.querySelector('[data-field="ai.replyFrequency"]').value;
    const index=REPLY_FREQUENCIES.findIndex(([key])=>key===value),[key,label]=REPLY_FREQUENCIES[index<0 ? 2 : index];
    const slider=this.root.querySelector('[data-reply-slider]');slider.value=String(index<0 ? 2 : index);slider.setAttribute('aria-valuetext',label);slider.setAttribute('aria-label','接话频率 · '+label);
    this.root.querySelector('[data-reply-frequency-label]').textContent=label;
    this.root.querySelector('[data-reply-frequency-status]').textContent=label+'：'+REPLY_FREQUENCY_HELP[key];
  }
  showSection(key){
    for(const tab of this.root.querySelectorAll('[data-ai-section-tab]')){
      const active=tab.dataset.aiSectionTab===key;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active ? 0 : -1;
    }
    for(const section of this.root.querySelectorAll('[data-ai-section]'))section.hidden=section.dataset.aiSection!==key;
    for(const extra of this.root.querySelectorAll('[data-page=ai]>.rule-summary'))extra.hidden=key==='playground';
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
  syncPerception(){
    const text=this.root.querySelector('[data-field="ai.pipeline.mode"]').value==='text',active=this.mediaState && this.mediaState!=='idle';
    this.root.querySelector('[data-media-start]').hidden=text;
    this.root.querySelector('[data-perception-off]').hidden=!text || Boolean(active);
    this.root.querySelector('[data-perception-active]').hidden=text && !active;
  }
  syncPipeline(){
    const mode=this.root.querySelector('[data-field="ai.pipeline.mode"]').value;
    this.root.querySelector('[data-pipeline-ali]').hidden=['custom','text','local-audio'].includes(mode);
    this.root.querySelector('[data-custom-media]').hidden=mode!=='custom';
    this.root.querySelector('[data-text-service]').hidden=mode==='omni-only';
    this.syncPerception();
    for(const node of this.root.querySelectorAll('[data-ai-modes]'))node.hidden=!node.dataset.aiModes.split(' ').includes(mode);
    this.root.querySelector('[data-pipeline-role]').textContent=mode==='omni-only' ? '感知 + 回复共用' : '仅感知';
    this.root.querySelector('[data-pipeline-description]').textContent=({'local-audio':'使用已准备的本地中文语音模型识别直播，回复沿用文字模型及其端侧兜底，无需语音云服务密钥。',custom:'回复服务独立配置；可按需开启自定义视觉、语音或 Omni 分段识别。',text:'只用直播数据、弹幕、知识与搜索生成回复，无需配置感知服务。','omni-llm':'Omni 持续理解直播音画，回复由独立配置的文字模型生成。','omni-only':'同一套百炼配置，Omni 负责直播感知和弹幕回复。','ali-split':'视觉与语音分别按间隔识别直播内容，回复使用文字模型。'})[mode];
    this.root.querySelector('[data-perception-description]').textContent=({'local-audio':'先在连接与模型准备中文识别，保存设置，再启动直播音频采集。',custom:'在“连接与模型”启用并配置感知服务，再启动直播音视频识别。',text:'','omni-llm':'使用“连接与模型”中的 Omni 实时模型识别直播音画。','omni-only':'使用“连接与模型”中的 Omni 实时模型识别直播音画。','ali-split':'使用“连接与模型”中的视觉模型与语音模型分段识别。'})[mode];
    this.syncMedia();
  }
  syncSource(){
    const source=this.root.querySelector('[data-field="ai.media.inputSource"]').value,direct=source!=='display';
    this.root.querySelector('[data-native-install]').hidden=source!=='native';
    this.root.querySelector('[data-media-start]').textContent=source==='native' ? '原生拉流并开始感知' : direct ? '直接拉流并开始识别' : '选择直播标签页并开始识别';
    this.root.querySelector('[data-source-help]').textContent=source==='native' ? 'StreamGet 获取当前房间 CDN 地址，FFmpeg 在本地解码音画，通过 WebSocket 交给 Omni。支持有界重连和静音画面观察；不会自动改用录屏。首次使用请展开安装说明。' : direct ? '自动读取当前直播间原始 FLV / HLS 流并在本机解码，无需选择共享窗口。需流支持 H264/AAC 和跨域读取；失败会提示，不自动改用屏幕共享。' : '请选择直播标签页并勾选“同时分享标签页音频”。仅在你选择此方式后才会请求共享。';
  }
  syncMedia(){
    this.syncSource();
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
  showSkills(){const target=this.root.querySelector('[data-skill-list]');target.replaceChildren();for(const skill of this.skills){const row=target.ownerDocument.createElement('p');row.textContent=skill.name+' · '+skill.scenes.join('、');const button=target.ownerDocument.createElement('button');button.type='button';button.textContent='移除技能';button.addEventListener('click',()=>{this.skills=this.skills.filter(s=>s.id!==skill.id);this.showSkills();this.dirty();});row.append(button);target.append(row);}}
  populate(assistant){this.syncReplyFrequency();this.skills=structuredClone(assistant?.skills || []);this.showSkills();for(const input of this.root.querySelectorAll('[data-media-key]'))input.value='';this.syncPipeline();this.syncSearch();this.root.querySelector('[data-ali-account]').open=!this.root.querySelector('[data-field="ai.pipeline.workspaceId"]').value.trim();}
  credentials(){return Object.fromEntries(['vision','audio','pipeline'].map(kind=>[kind,{key:this.root.querySelector(`[data-media-key="${kind}"]`).value.trim(),remember:this.root.querySelector(`[data-media-remember="${kind}"]`).checked}]));}
  state({state,skipped=0,errors=0,totalTokens,lastFinalAt,phase}){
    this.mediaState=state;this.syncPerception();
    this.mediaPhase=state==='idle' ? undefined : phase || this.mediaPhase;phase=this.mediaPhase;
    this.root.querySelector('[data-media-start]').disabled=state!=='idle';this.root.querySelector('[data-media-stop]').disabled=state==='idle';
    const direct=this.root.querySelector('[data-field="ai.media.inputSource"]').value!=='display';
    this.root.querySelector('[data-media-status]').textContent=`${({idle:'识别已停止',starting:direct ? '正在获取原始流或等待服务配置确认' : '正在选择直播标签页或等待服务配置确认',running:direct ? '正在识别原始直播流' : '正在持续识别所选共享内容'})[state]} · 忙时跳过 ${skipped} 次 · 失败 ${errors} 次${totalTokens!==undefined ? ` · 已用 ${totalTokens} token` : ''}${lastFinalAt ? ` · 最近完成 ${new Date(lastFinalAt).toLocaleTimeString('zh-CN')}` : ''}`;
    const phases={resolving:'正在解析当前房间 CDN 地址',connecting:'正在连接 Omni 并确认配置',decoding:'正在等待原始流音频与画面',observing:'音画已接入 Omni，等待或接收观察结果',recovering:'直播流中断，正在刷新地址并重连',renewing:'正在自动续接实时识别，本场记忆已保留',waiting:'识别小时额度已用完，窗口恢复后自动续接；本场记忆已保留'};
    if(phase && phases[phase])this.root.querySelector('[data-media-status]').textContent=`${phases[phase]}${totalTokens!==undefined ? ` · 已用 ${totalTokens} token` : ''}`;
    if(state==='starting')this.showError('');
  }
  showError(message){const target=this.root.querySelector('[data-media-error]');target.textContent=message;target.hidden=!message;}
  observations(rows){
    const target=this.root.querySelector('[data-media-results]');target.replaceChildren();
    if(!rows.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='当前没有有效识别结果。';target.append(empty);}
    for(const row of rows){const p=document.createElement('p');p.textContent=`${new Date(row.at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · ${row.kind==='omni' ? '音画' : row.kind==='video' ? '画面' : '语音'}：${row.text}`;target.append(p);}
  }
}
