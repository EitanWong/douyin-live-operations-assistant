// CSS Grid fills available column space; measured row spans keep cards at their
// natural height. Controls stay in DOM order and never move between containers.
export function layoutCardFlow(run) {
 if(run.dataset.cardRun==='full' || !run.clientWidth)return;
 const view=run.ownerDocument.defaultView;
 for(const slot of run.children){
  const height=slot.firstElementChild?.getBoundingClientRect().height;
  if(!height)continue;
  const gap=Number.parseFloat(view.getComputedStyle(slot).paddingBottom) || 0;
  const span=`span ${Math.ceil(height+gap)}`;
  if(slot.style.gridRowEnd!==span)slot.style.gridRowEnd=span;
 }
}

export function layoutCardFlows(root) {
 // Inner grids determine the natural height of their enclosing card.
 for(const run of [...root.querySelectorAll('.product-card-run')].reverse())layoutCardFlow(run);
}

export class CardFlow {
 constructor(run){
  this.run=run;this.view=run.ownerDocument.defaultView;this.frame=0;
  this.schedule=()=>{if(!this.frame)this.frame=this.view.requestAnimationFrame(()=>{this.frame=0;layoutCardFlow(run);});};
  this.observer=new this.view.ResizeObserver(this.schedule);
  this.observer.observe(run);
  for(const slot of run.children)if(slot.firstElementChild)this.observer.observe(slot.firstElementChild);
  layoutCardFlow(run);
 }
 destroy(){this.observer.disconnect();this.view.cancelAnimationFrame(this.frame);this.frame=0;}
}
