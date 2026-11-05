// DOM projection diagnostics in jsdom, not browser frame rate or extension RSS.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {JSDOM} from 'jsdom';
import {createWorkspaceBridge} from '../src/ui/product/bridge.js';

const dom=new JSDOM('<div id="host"></div>'),host=dom.window.document.querySelector('#host');
const root=host.attachShadow({mode:'open'});
root.innerHTML='<div class="workspace"><button data-tab="charts">图表</button><section data-page="charts"></section><section data-page="background" hidden></section><div class="shell-status"><span>暂停</span></div></div>';
const page=root.querySelector('[data-page=charts]'),status=root.querySelector('.shell-status span');
const data=Array.from({length:1000},(_,i)=>[i,Math.sin(i/30)*100]);let optionReads=0;
const instances=new Map();
for(let i=0;i<6;i++){
  const element=dom.window.document.createElement('div');element.dataset.anchorChart=String(i);page.append(element);
  instances.set(String(i),{getOption(){optionReads++;return {animation:false,series:[{type:'line',data:data.map(point=>[...point])}]};}});
}
const bridge=createWorkspaceBridge({root,host,activeTab:'charts',anchorDashboard:{charts:{instances}}});
try {
  for(let i=0;i<10;i++){status.textContent=`预热 ${i}`;bridge.refresh();}
  await Promise.resolve();globalThis.gc?.();
  const heapBefore=process.memoryUsage().heapUsed,samples=[];let contentChanges=0;
  for(let i=0;i<100;i++){
    const before=bridge.getSnapshot().content,start=performance.now();
    status.textContent=`运行 ${i}`;bridge.refresh();samples.push(performance.now()-start);
    if(bridge.getSnapshot().content!==before)contentChanges++;
  }
  await Promise.resolve();globalThis.gc?.();
  const retainedHeapDeltaBytes=process.memoryUsage().heapUsed-heapBefore;
  assert.equal(bridge.getSnapshot().status,'运行 99');samples.sort((a,b)=>a-b);
  optionReads=0;const background=root.querySelector('[data-page=background]'),start=performance.now();
  for(let i=0;i<100;i++){background.textContent=`后台 ${i}`;await Promise.resolve();}
  console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,
    fixture:{charts:6,pointsPerChart:1000,iterations:100},statusRefresh:{medianMs:samples[50],p95Ms:samples[95],contentChanges,
      retainedHeapDeltaBytes:globalThis.gc ? retainedHeapDeltaBytes : null},hiddenPageUpdates:{optionReads,totalMs:performance.now()-start}},null,2));
}finally{bridge.destroy();dom.window.close();}
