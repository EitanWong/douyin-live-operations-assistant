const stages={queued:'等待后台执行',restoring:'正在恢复后台任务',starting:'正在启动安装',loading:'正在加载模型',download:'正在下载当前文件',warmup:'正在预热',benchmark:'正在测速','self-test':'正在执行推理自检','vision-self-test':'正在检验画面理解','vision-warmup':'正在预热视觉模型',fallback:'正在改用轻量模型',runtime:'正在准备运行时','runtime-download':'正在下载运行时',python:'正在安装 Python',dependencies:'正在安装推理依赖',model:'正在准备中文语音模型','model-download':'正在下载中文语音模型','model-verify':'正在校验模型',register:'正在接入扩展',ready:'已就绪',slow:'设备测速未达标',released:'已释放，自动恢复已取消',interrupted:'任务中断，请重试',unavailable:'尚未接入本机安装代理（可选）'};
export function setupProgress(kind,state){
 if(!state)return null;
 const label=({text:'中文回复',audio:'浏览器中文语音',native:'本机组件'})[kind],p=state.progress || {};
 const stage=state.phase==='error' ? state.error || '准备失败，请重试' : stages[p.stage || state.phase] || '正在准备';
 const known=Number.isFinite(p.loaded) && Number.isFinite(p.total) && p.loaded>=0 && p.total>0;
 const size=known ? ` · 当前文件 ${(p.loaded/1048576).toFixed(1)} / ${(p.total/1048576).toFixed(1)} MB` : Number.isFinite(p.loaded) ? ` · 已下载 ${(p.loaded/1048576).toFixed(1)} MB` : '';
 return {text:`${label}：${stage}${p.file ? ` · ${p.file}` : ''}${size}`,percent:known ? Math.max(0,Math.min(100,p.loaded/p.total*100)) : null};
}
export function showSetupProgress(root,kind,state){
 const value=setupProgress(kind,state);
 for(const element of root.querySelectorAll(`[data-setup-kind="${kind}"]`)){
  element.hidden=!value;if(!value)continue;
  const text=element.querySelector('[data-setup-text]'),bar=element.querySelector('.stat-progress');
  if(text.textContent!==value.text)text.textContent=value.text;
  bar.hidden=value.percent===null;
  if(value.percent===null)bar.removeAttribute('aria-valuenow');else bar.setAttribute('aria-valuenow',String(value.percent));
 }
}
