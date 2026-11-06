import {init,use} from 'echarts/core.js';
import {LineChart,BarChart,GraphChart} from 'echarts/charts.js';
import {GridComponent,TooltipComponent,LegendComponent,MarkLineComponent,AriaComponent} from 'echarts/components.js';
import {SVGRenderer} from 'echarts/renderers.js';
use([LineChart,BarChart,GraphChart,GridComponent,TooltipComponent,LegendComponent,MarkLineComponent,AriaComponent,SVGRenderer]);

// Reuse the controller's chart options, including its missing-data semantics.
// The visible ECharts instance owns hover, legend interaction and resizing.
export function createChartView(element,{onSelect}={}) {
  // Product charts can mount while their disclosure is still measuring at
  // zero width. ECharts' graph view cannot build a transform from a zero
  // rectangle, so seed a tiny fallback viewport and let ResizeObserver set the
  // real size on the next layout pass.
  const chart=init(element,null,{renderer:'svg',width:Math.max(1,element.clientWidth),height:Math.max(1,element.clientHeight)}),view=element.ownerDocument.defaultView;
  chart.on('click',event=>{if(event.data?.id)onSelect?.({id:event.data.id,kind:event.dataType==='edge' ? 'relation' : 'entity'});});
  const observer=new view.ResizeObserver(()=>chart.resize({width:Math.max(1,element.clientWidth),height:Math.max(1,element.clientHeight)}));observer.observe(element);
  return {update:option=>chart.setOption(option,option.series?.[0]?.type==='graph' ? {replaceMerge:['series']} : {notMerge:true}),destroy(){observer.disconnect();chart.dispose();}};
}
