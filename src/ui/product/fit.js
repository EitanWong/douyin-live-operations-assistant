// Probe in priority order. Scrolling is the fallback after both natural layouts.
export function chooseWorkspaceFit(measure) {
  for(const density of ['comfortable','compact']) {
    const {required,available}=measure(density);
    if(available<=0)return null;
    if(required<=available+1)return density;
  }
  return 'scroll';
}

export class WorkspaceFit {
  constructor(content) {
    this.content=content;this.owner=content.closest('.product-main');
    this.view=content.ownerDocument.defaultView;this.frame=0;this.observed=new Set();
    this.schedule=()=>{if(!this.frame)this.frame=this.view.requestAnimationFrame(()=>{this.frame=0;this.layout();});};
    this.observer=new this.view.ResizeObserver(this.schedule);
    this.refresh();
  }
  refresh() {
    const nodes=new Set([this.content,...this.content.querySelectorAll('.product-page,.product-card-content')]);
    for(const node of this.observed)if(!nodes.has(node))this.observer.unobserve(node);
    for(const node of nodes)if(!this.observed.has(node))this.observer.observe(node);
    this.observed=nodes;this.schedule();
  }
  layout() {
    const page=this.content.querySelector('.product-page');
    if(!page || !this.content.clientWidth || !this.content.clientHeight)return;
    // Natural-height probes must not reset a scrolled field group or its page.
    const positions=[this.content,...this.content.querySelectorAll('.product-card-body')].map(node=>({node,top:node.scrollTop,left:node.scrollLeft}));
    const fit=chooseWorkspaceFit(density=>{
      this.owner.dataset.fit=density;
      const style=this.view.getComputedStyle(this.content);
      return {required:page.getBoundingClientRect().height+Number.parseFloat(style.paddingTop)+Number.parseFloat(style.paddingBottom),available:this.content.clientHeight};
    });
    if(fit)this.owner.dataset.fit=fit;
    for(const {node,top,left} of positions){if(node.scrollTop!==top)node.scrollTop=top;if(node.scrollLeft!==left)node.scrollLeft=left;}
  }
  destroy() {this.observer.disconnect();this.view.cancelAnimationFrame(this.frame);}
}
