import {createWorkspaceBridge} from './bridge.js';

// Source controls are a compatibility boundary for existing feature controllers.
// They stay measurable for ECharts, while inert prevents a second keyboard UI.
const SOURCE_CSS='.panel>.workspace.product-source{position:absolute!important;inset:72px 0 0!important;width:100%!important;height:auto!important;transform:translateX(-200vw)!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}.product-surface{display:flex;flex:1;min-width:0;min-height:0;overflow:hidden}';
export function mountProductPanel(panel,{load=()=>import('./runtime.js')}={}) {
  const document=panel.host.ownerDocument,view=document.defaultView;
  if(!view.CSS?.supports?.('container-type','inline-size'))return {ready:Promise.resolve(false),destroy(){},refresh(){}};
  const source=panel.root.querySelector('.workspace'),surface=document.createElement('div'),style=document.createElement('style');
  surface.className='product-surface';style.textContent=SOURCE_CSS;
  let destroyed=false,failed=false,runtime,bridge;
  const restore=()=>{source.classList.remove('product-source');source.inert=false;source.removeAttribute('aria-hidden');surface.remove();style.remove();};
  const fail=()=>{if(failed || destroyed)return;failed=true;bridge?.destroy();restore();view.queueMicrotask(()=>runtime?.destroy());panel.host.dataset.productStatus='fallback';panel.toast('界面组件加载失败，已恢复兼容界面。',true);};
  const ready=load().then(module=>{
    if(destroyed)return false;
    bridge=createWorkspaceBridge(panel);panel.root.querySelector('.panel').append(style,surface);
    runtime=module.mountProductWorkspace({container:surface,bridge,onReady:()=>{
      if(destroyed)return;source.classList.add('product-source');source.inert=true;source.setAttribute('aria-hidden','true');panel.host.dataset.productStatus='ready';
    },onError:fail});return true;
  }).catch(()=>{if(!destroyed)fail();return false;});
  return {ready,refresh:()=>bridge?.refresh(),destroy(){destroyed=true;runtime?.destroy();bridge?.destroy();restore();}};
}
