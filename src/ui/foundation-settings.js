import {TEXT_MODELS} from '../ai/device-policy.js';
import {contextInventory} from '../ai/context-policy.js';
import {accountSource} from '../ai/account-context.js';
import {createAccountRefresh,ACCOUNT_COLLECTION_DEFAULTS} from '../services/account-refresh.js';
import {showSetupProgress} from './setup-progress.js';

export class FoundationSettings {
 constructor(root,{edge,activateLocal,deployment,collector,accounts,anchor,changed,onError,accountRefresh,dirty=()=>{},getContext=()=>null,targets=()=>[]}){
  Object.assign(this,{root,edge,deployment,collector,accounts,anchor,changed,onError,dirty,getContext,targets});this.traces=[];this.generation=0;this.closed=false;
  this.ownsRefresh=!accountRefresh;this.accountRefresh=accountRefresh || createAccountRefresh({collector,accounts,scope:anchor,config:()=>ACCOUNT_COLLECTION_DEFAULTS,changed});
  const bind=(selector,fn)=>root.querySelector(selector).addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{await fn();}catch(error){onError(error);}finally{button.disabled=false;}});
  for(const kind of ['text','audio'])bind(`[data-edge-prepare="${kind}"]`,async()=>{
   if(!edge)throw new Error('端侧推理需要 Chrome 扩展版');this.status('模型正在下载、加载与预热，首次可能需要几分钟…');
   const selection=this.field(kind==='text' ? 'textModel' : 'audioBackend').value,result=await edge.prepare(kind,selection);
   this.status(result.phase==='ready' ? `${kind==='text' ? '中文回复' : '中文语音'}已就绪 · ${result.model || result.backend || selection}${result.tokensPerSecond ? ` · ${result.tokensPerSecond.toFixed(1)} token/s · 首 token ${Math.round(result.firstTokenMs)}ms` : ''}` : '设备推理速度不足，实时兜底未启用');
  });
  bind('[data-edge-detect]',()=>this.detect());
  for(const button of root.querySelectorAll('[data-native-install-start]'))button.addEventListener('click',async()=>{button.disabled=true;try{await this.pollDeployment('start');}catch(error){onError(error);}finally{button.disabled=false;}});
  bind('[data-edge-auto]',async()=>{
   this.status('正在保存本地设置并交给后台准备；可继续操作，刷新后仍可查看进度…');
   try{if(!activateLocal)throw new Error('一键启用需要 Chrome 扩展版');this.status(await activateLocal());}
   catch(error){this.status(`本地 AI 未启用：${error.message}`);throw error;}
  });
  bind('[data-edge-release]',async()=>{await edge?.release();this.status('已释放本地模型内存；缓存权重保留');});
  bind('[data-edge-status-refresh]',async()=>{const state=await edge?.status();this.status(state ? Object.entries(state).map(([kind,s])=>`${kind==='text' ? '文字' : '语音'}：${({loading:'准备中',ready:'已就绪',slow:'设备速度不足',error:'加载失败'})[s.phase] || '未准备'}${s.model || s.backend ? ` · ${s.model || s.backend}` : ''}`).join(' · ') || '尚未准备模型' : '端侧推理需要 Chrome 扩展版');});
  bind('[data-account-collect]',async()=>{
   const url=root.querySelector('[data-account-url]').value.trim(),scope=anchor(),generation=++this.generation;
   this.accountStatus('正在读取抖音公开页面，最多等待12秒…');
   try{const rows=await this.accountRefresh.refresh(url);if(scope!==anchor() || generation!==this.generation)return;this.accountStatus(`已采集 ${rows.length} 条公开资料；简介和计数24小时有效，作品描述保留为有日期的历史背景，可刷新或删除。`);}
   finally{this.showAccounts();}
  });
  bind('[data-account-cancel]',async()=>{this.generation++;await this.accountRefresh.cancel();this.accountStatus('已取消采集');});
  bind('[data-account-clear]',async()=>{this.generation++;await this.accountRefresh.cancel();accounts.forget(anchor());await changed();this.showAccounts();this.accountStatus('本主播当前与历史公开资料已清空；停止后续采集请关闭自动更新、重点研究并保存');});
  bind('[data-account-refresh]',()=>this.showAccounts());this.showAccounts();
  bind('[data-account-search]',async()=>{if(!collector?.search)throw new Error('抖音原生搜索需要 Chrome 扩展版');await collector.search(root.querySelector('[data-account-query]').value.trim());});
  bind('[data-account-targets]',()=>this.showTargets());
  root.querySelector('[data-account-target]').addEventListener('change',event=>{if(event.target.value)root.querySelector('[data-account-url]').value=event.target.value;});
  bind('[data-account-watch]',()=>{const url=accountSource(root.querySelector('[data-account-url]').value.trim()).url,field=root.querySelector('[data-field="ai.accountCollection.urls"]'),urls=[...new Set(field.value.split('\n').map(s=>s.trim()).filter(Boolean).concat(url))];if(urls.length>1000)throw new Error('自动更新最多1000个明确来源');field.value=urls.join('\n');dirty();this.accountStatus('已加入自动更新草稿，保存后生效');});
  bind('[data-context-refresh]',()=>this.showContext());this.showContext();
  void this.detect().catch(error=>{if(!this.closed)this.deviceStatus(error.message);});
  this.unsubscribe=edge?.subscribe?.(state=>this.progress(state));
  void edge?.status?.().then(state=>this.progress(state)).catch(()=>{});
  if(deployment)void this.pollDeployment().catch(()=>{});
 }
 progress(state){if(!this.closed)for(const kind of ['text','audio'])showSetupProgress(this.root,kind,state?.[kind]);}
 async pollDeployment(action='status'){
  if(this.closed)return;clearTimeout(this.deploymentTimer);const generation=this.deploymentGeneration=(this.deploymentGeneration || 0)+1;
  try{
   if(!this.deployment)throw new Error('本机自动安装需要 Chrome 扩展版');
   const state=await this.deployment(action);if(this.closed || generation!==this.deploymentGeneration)return;this.nativeState=state;
   showSetupProgress(this.root,'native',state);
   if(['queued','running'].includes(state.phase))this.deploymentTimer=setTimeout(()=>{void this.pollDeployment().catch(()=>{});},1000);
  }catch(error){if(!this.closed && generation===this.deploymentGeneration)showSetupProgress(this.root,'native',{phase:'error',error:error.message});throw error;}
 }
 async prepareNative(){if(!this.deployment)return;if(!this.nativeState)await this.pollDeployment();if(this.nativeState?.phase!=='unavailable')await this.pollDeployment('start');}
 field(key){return this.root.querySelector(`[data-field="ai.edge.${key}"]`);}
 async detect(){
  if(!this.edge?.detect){this.deviceStatus('设备自动检测需要 Chrome 扩展版；当前仍可配置云端与规则回复');return;}
  this.deviceStatus('正在检测 WebGPU、CPU、内存、存储与中文语音组件…');const {device:d,recommendation:r}=await this.edge.detect();if(this.closed)return;
  this.deviceStatus(`WebGPU ${d.webgpu ? '可用' : '不可用'} · CPU ${d.cores || '未知'} 线程 · 内存 ${d.memoryGB ? d.memoryGB+'GB' : '浏览器未提供'} · 可用存储 ${d.storageFreeMB==null ? '未知' : Math.round(d.storageFreeMB)+'MB'}。推荐：${TEXT_MODELS[r.textModel]?.label || '云端回复'}；${r.audioBackend==='native-sensevoice' ? 'SenseVoice int8' : '浏览器 Whisper'}。${r.reasons.join('；')}。准备测速通过后才可兜底。`);
 }
 deviceStatus(text){this.root.querySelector('[data-device-status]').textContent=text;}
 status(text){for(const node of this.root.querySelectorAll('[data-edge-status]'))node.textContent=text;}
 accountStatus(text){this.root.querySelector('[data-account-status]').textContent=text;}
 showTargets(){
  const field=this.root.querySelector('[data-account-target]');field.replaceChildren();const empty=field.ownerDocument.createElement('option');empty.value='';empty.textContent='选择已核对的公开主页';field.append(empty);
  const seen=new Set();for(const row of this.targets())try{const url=accountSource(row.url).url;if(seen.has(url))continue;seen.add(url);const option=field.ownerDocument.createElement('option');option.value=url;option.textContent=String(row.name || '已观测账号').slice(0,80);field.append(option);}catch{}
  this.accountStatus(seen.size ? `列出 ${seen.size} 个有原生主页标识的账号；请选择目标后采集或加入列表` : '暂无可核对的主页标识；可使用抖音原生搜索核对公开链接');
 }
 showContext(){const target=this.root.querySelector('[data-context-overview]');target.replaceChildren(...contextInventory(this.getContext()?.liveContext,this.accounts.list(this.anchor()).length).map(text=>{const p=target.ownerDocument.createElement('p');p.textContent=text;return p;}));}
 showAccounts(){
  const target=this.root.querySelector('[data-account-records]');target.replaceChildren();const rows=this.accounts.list(this.anchor());
  for(const r of rows){const item=target.ownerDocument.createElement('p'),a=target.ownerDocument.createElement('a');a.textContent=r.title;a.href=r.url || r.source;a.target='_blank';a.rel='noopener noreferrer';item.append(a,` · ${r.kind==='profile' ? '主页' : '作品描述'} · ${new Date(r.observedAt).toLocaleString('zh-CN')}：${r.text.slice(0,240)}`);target.append(item);}
  if(!rows.length)target.textContent='尚未采集公开资料。';
  const historical=this.accounts.history(this.anchor()).filter(r=>r.expiresAt<=Date.now()).length;
  if(historical){const note=target.ownerDocument.createElement('p');note.textContent=`另有 ${historical} 条有日期的历史作品描述，按问题和对应账号检索；不代表当前状态或已分析完整视频。`;target.append(note);}
 }
 trace(row){
  this.traces.push(row);this.traces=this.traces.slice(-100);const ok=this.traces.filter(r=>r.status==='ok'),times=ok.map(r=>r.elapsedMs).sort((a,b)=>a-b);
  const target=this.root.querySelector('[data-ai-latency]');target.textContent=`最近 ${ok.length} 次完成 · 最近一次 ${row.provider==='edge' ? '端侧' : '云端'} ${row.elapsedMs}ms · ${row.status}${times.length ? ` · P95 ${times[Math.ceil(times.length*.95)-1]}ms` : ''}`;
 }
 close(){this.closed=true;this.generation++;this.unsubscribe?.();clearTimeout(this.deploymentTimer);if(this.ownsRefresh)this.accountRefresh.close();}
}
