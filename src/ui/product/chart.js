import {init,use} from 'echarts/core.js';
import {LineChart,BarChart} from 'echarts/charts.js';
import {GridComponent,TooltipComponent,LegendComponent,MarkLineComponent,AriaComponent} from 'echarts/components.js';
import {SVGRenderer} from 'echarts/renderers.js';
use([LineChart,BarChart,GridComponent,TooltipComponent,LegendComponent,MarkLineComponent,AriaComponent,SVGRenderer]);

// Reuse the controller's chart options, including its missing-data semantics.
// The visible ECharts instance owns hover, legend interaction and resizing.
export function createChartView(element) {
  const chart=init(element,null,{renderer:'svg'}),view=element.ownerDocument.defaultView;
  const observer=new view.ResizeObserver(()=>chart.resize());observer.observe(element);
  return {update:option=>chart.setOption(option,{notMerge:true}),destroy(){observer.disconnect();chart.dispose();}};
}
