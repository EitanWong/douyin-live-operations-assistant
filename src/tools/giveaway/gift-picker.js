import {giftRules} from '../../core/giveaway.js';
import {formatDiamonds} from '../../core/auto-gift.js';

const views=new WeakMap();
const active=panel=>panel.toolStates.get('giveaway')?.rounds?.at(-1)?.status==='running';
function stateFor(panel) {
  if(!views.has(panel))views.set(panel,{gifts:[],loading:false,message:'读取当前直播间礼物目录，无需先打开网页礼物面板；也可手动填写。'});
  return views.get(panel);
}
function setRules(panel,rules) {
  panel.node('[data-giveaway=gifts]').value=[...new Set(rules)].join(', ');
  updateGiftPicker(panel);
}
export function updateGiftPicker(panel) {
  const state=stateFor(panel),input=panel.node('[data-giveaway=gifts]'),search=panel.node('[data-giveaway-gift-search]');
  const rules=giftRules({gifts:input.value}),query=search.value.trim().toLowerCase(),locked=active(panel);
  input.oninput=()=>updateGiftPicker(panel);search.oninput=()=>updateGiftPicker(panel);search.disabled=locked;
  panel.disabled('[data-action=giveaway-refresh-gifts]',state.loading || locked);
  panel.text('[data-action=giveaway-refresh-gifts]',state.loading ? '正在读取礼物…' : '读取 / 刷新礼物目录');
  const signature=JSON.stringify([rules,query,locked,state.loading,state.message,state.gifts]);
  if(state.signature===signature)return;state.signature=signature;
  const document=panel.root.ownerDocument,selected=panel.node('[data-giveaway-gift-selected]');selected.replaceChildren();
  for(const rule of rules) {
    const gift=state.gifts.find(gift=>gift.id===rule || gift.name===rule),button=document.createElement('button');
    button.type='button';button.className='giveaway-gift-chip';button.textContent=`${gift?.name || rule} · 移除`;
    button.setAttribute('aria-label',`移除礼物 ${gift?.name || rule}`);button.disabled=locked;
    button.onclick=()=>{if(!active(panel)){setRules(panel,rules.filter(value=>value!==rule));input.focus();}};selected.append(button);
  }
  if(!rules.length)selected.textContent='尚未选择礼物，可勾选下方目录或手动填写。';
  const visible=state.gifts.filter(gift=>`${gift.id} ${gift.name}`.toLowerCase().includes(query));
  const list=panel.node('[data-giveaway-gift-list]');list.replaceChildren();
  for(const gift of visible.slice(0,100)) {
    const label=document.createElement('label'),checkbox=document.createElement('input'),text=document.createElement('span');
    label.className='giveaway-gift-option';checkbox.type='checkbox';checkbox.dataset.giveawayGiftId=gift.id;
    checkbox.checked=rules.includes(gift.id) || rules.includes(gift.name);checkbox.disabled=locked;
    text.textContent=`${gift.name} · ${formatDiamonds(gift.priceUnits)} 钻 · ID ${gift.id}`;
    checkbox.onchange=()=>{
      if(active(panel))return;
      const current=giftRules({gifts:input.value}).filter(rule=>rule!==gift.id && rule!==gift.name);
      if(checkbox.checked){current.push(gift.id);panel.node('[data-giveaway=giftEnabled]').checked=true;}
      // Keep keyboard focus on the same option after selection updates.
      setRules(panel,current);panel.root.querySelector(`[data-giveaway-gift-id="${gift.id}"]`)?.focus();
    };
    label.append(checkbox,text);list.append(label);
  }
  panel.text('[data-giveaway-gift-message]',state.loading ? '正在读取当前直播间礼物目录…' : state.message);
  panel.text('[data-giveaway-gift-count]',state.gifts.length ? `已选 ${rules.length} 项 · 共 ${state.gifts.length} 种 · 匹配 ${visible.length} 种${visible.length>100 ? '（显示前 100 种，请搜索缩小范围）' : ''}` : '');
  if(state.gifts.length && !visible.length)list.textContent='没有匹配的礼物，试试其他名称或 ID。';
}
export async function refreshGiftPicker(panel,invoke) {
  const state=stateFor(panel);if(state.loading || active(panel))return;
  state.loading=true;updateGiftPicker(panel);
  try {
    const result=await invoke('gifts');
    if(!result?.available)throw new Error(result?.reason || '礼物目录读取失败，请确认直播页已加载并登录后重试，或手动填写。');
    state.gifts=result.gifts;
    state.message=result.gifts.length ? '勾选可多选；选中后使用礼物 ID 匹配。各类礼物能否赠送以观众账号和平台为准。' : '当前目录为空，请稍后刷新目录，或手动填写。';
  } catch(error) {state.message=`读取失败：${error.message} 已填写的礼物仍保留，可手动继续配置。`;}
  finally {state.loading=false;updateGiftPicker(panel);}
}
