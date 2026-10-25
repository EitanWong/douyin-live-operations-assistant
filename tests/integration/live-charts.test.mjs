import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {LiveCharts} from '../../src/ui/live-charts.js';

// Exercise ECharts' actual SVG renderer/event dispatch, including the window
// between replacing a model and the next animation frame.
test('图表重建后立即悬停旧图形不会读取未准备的数据；空图释放实例',async()=>{
  const dom = new JSDOM('<body><div></div></body>',{pretendToBeVisual:true});
  const saved = Object.fromEntries(['window','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  dom.window.HTMLCanvasElement.prototype.getContext=()=>({measureText:text=>({width:String(text).length*8})});
  const host=dom.window.document.querySelector('div'),root=host.attachShadow({mode:'open'});
  root.innerHTML=`<section data-page>${['scores','gap','contributions','activity'].map(name=>`<div data-pk-chart="${name}"></div><p>empty</p>`).join('')}</section>`;
  root.querySelector('section').getBoundingClientRect=()=>({width:650});
  for(const element of root.querySelectorAll('[data-pk-chart]')) {
    Object.defineProperties(element,{clientWidth:{value:650},clientHeight:{value:200}});
  }
  const charts=new LiveCharts(root),at=Date.now();
  const data={key:'test',trend:[{at,selfScore:10,opponentScore:5}]};
  try {
    charts.render(data,true);
    await new Promise(resolve=>setTimeout(resolve,40));
    const chart=charts.instances.get('scores');
    const targets=chart.getZr().storage.getDisplayList().slice();
    assert.ok(targets.length>0);
    for(let i=0;i<5;i++) {
      charts.render({...data,lastScoreAt:at+i},true);
      for(const target of targets) assert.doesNotThrow(()=>chart.getZr().handler.dispatchToElement({target,topTarget:target},'mousemove',{}));
    }
    const multiplayer={key:'multi',competitors:[{anchorId:'a',name:'甲'},{anchorId:'b',name:'乙'},{anchorId:'c',name:'丙'}],trend:[
      {at:at-1000,competitorScores:{a:1,b:2,c:3}},
      {at,competitorScores:{a:10,b:20,c:30}},
      {at,competitorScores:{a:15,b:25,c:35}}
    ]};
    for(let frame=0;frame<3;frame++) {
      charts.render(multiplayer,true);
      const series=chart.getModel().getSeries();
      assert.equal(series.length,3);
      for(const item of series) {
        const points=item.getData(), dimension=points.mapDimension('x');
        // Axis hover uses all indices nearest to x; duplicate timestamps used
        // to return [1,2], producing two tooltip rows per broadcaster.
        assert.deepEqual(item.indicesOfNearest('x',dimension,at),[1]);
        assert.deepEqual(item.indicesOfNearest('x',dimension,at-1000),[0]);
      }
      chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:1});
    }
    charts.render({key:'empty',trend:[]},true);
    assert.equal(charts.instances.size,0);
    assert.equal(chart.isDisposed(),true);
    charts.render(data,true);
    assert.notEqual(charts.instances.get('scores'),chart);
  } finally {
    charts.destroy();dom.window.close();
    for(const [key,descriptor] of Object.entries(saved)) {if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});
