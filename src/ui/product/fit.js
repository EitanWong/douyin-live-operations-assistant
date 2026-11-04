// Keep standard spacing when it fits; shrink only when the content needs it.
// Column widths are stable during the probes so the required height is monotone.
export function chooseWorkspaceFit(measure) {
  const fits=scale=>{const {required,available}=measure(scale);return available<=0 ? null : required<=available+1;};
  const comfortable=fits(1);if(comfortable===null)return null;
  if(comfortable)return {scale:1,density:'comfortable'};
  let low=0,high=1;
  if(!fits(0))return {scale:0,density:'scroll'};
  for(let i=0;i<6;i++){const middle=(low+high)/2;if(fits(middle))low=middle;else high=middle;}
  return {scale:low,density:comfortable ? 'comfortable' : 'compact'};
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
    const nodes=new Set([this.content,...this.content.querySelectorAll('.product-page,.product-card-slot,.product-card-content')]);
    for(const node of this.observed)if(!nodes.has(node))this.observer.unobserve(node);
    for(const node of nodes)if(!this.observed.has(node))this.observer.observe(node);
    this.observed=nodes;this.schedule();
  }
  layout() {
    const page=this.content.querySelector('.product-page');
    if(!page || !this.content.clientWidth || !this.content.clientHeight)return;
    // Density probes must not reset a scrolled field group or its page.
    const positions=[this.content,...this.content.querySelectorAll('.product-card-body')].map(node=>({node,top:node.scrollTop,left:node.scrollLeft}));
    this.owner.dataset.measuring='';
    const fit=chooseWorkspaceFit(scale=>{
      this.owner.style.setProperty('--product-density',String(scale));
      const style=this.view.getComputedStyle(this.content);
      return {required:page.getBoundingClientRect().height+Number.parseFloat(style.paddingTop)+Number.parseFloat(style.paddingBottom),available:this.content.clientHeight};
    });
    if(fit){this.owner.dataset.fit=fit.density;this.owner.style.setProperty('--product-density',String(fit.scale));}
    delete this.owner.dataset.measuring;
    for(const {node,top,left} of positions){if(node.scrollTop!==top)node.scrollTop=top;if(node.scrollLeft!==left)node.scrollLeft=left;}
  }
  destroy() {this.observer.disconnect();this.view.cancelAnimationFrame(this.frame);}
}
