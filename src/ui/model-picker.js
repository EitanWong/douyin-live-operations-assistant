const CUSTOM=':custom:';
const esc=value=>String(value).replace(/[&<>"']/gu,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const optionTemplate=([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`;
const entries=choices=>[['','请选择模型'],...choices,[CUSTOM,'自定义模型…']];

export function modelPicker(path,label,choices){
  return `<div data-model-picker="${esc(path)}"><label class="field"><span>${esc(label)}</span><select data-model-select="${esc(path)}">${entries(choices).map(optionTemplate).join('')}</select></label><label class="field" data-model-custom hidden><span>自定义模型名称 / 接入点 ID</span><input data-field="${esc(path)}" type="text" spellcheck="false" autocomplete="off" placeholder="填写服务支持的完整模型 ID"></label></div>`;
}

// The existing data-field remains the only stored value, including unlisted IDs.
export class ModelPickers {
  constructor(root){
    this.pickers=new Map([...root.querySelectorAll('[data-model-picker]')].map(node=>{
      const picker={select:node.querySelector('select'),input:node.querySelector('input'),custom:node.querySelector('[data-model-custom]')};
      picker.select.addEventListener('change',()=>{
        const custom=picker.select.value===CUSTOM;
        picker.custom.hidden=!custom;
        if(!custom)picker.input.value=picker.select.value;
        picker.input.dispatchEvent(new picker.input.ownerDocument.defaultView.Event('input',{bubbles:true}));
        if(custom)picker.input.focus();
      });
      return [node.dataset.modelPicker,picker];
    }));
  }
  sync(picker){
    const value=picker.input.value;
    const listed=[...picker.select.options].some(option=>option.value!==CUSTOM && option.value===value);
    picker.select.value=listed ? value : CUSTOM;
    picker.custom.hidden=listed;
  }
  populate(){for(const picker of this.pickers.values())this.sync(picker);}
  setChoices(path,choices){
    const picker=this.pickers.get(path),doc=picker.select.ownerDocument;
    picker.select.replaceChildren(...entries(choices).map(([value,label])=>{const option=doc.createElement('option');option.value=value;option.textContent=label;return option;}));
    this.sync(picker);
  }
}
