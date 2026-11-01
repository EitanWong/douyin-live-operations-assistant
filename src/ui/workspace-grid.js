// Keep independent cards compact without reordering DOM or stretching small
// cards to the height of a neighboring chart. Native reading/tab order survives.
const cards=grid=>grid.querySelectorAll(':scope>[data-workspace-card],:scope>[data-workspace-contents]>*,:scope>:not([data-workspace-contents]):not([data-workspace-card])');
export class WorkspaceGrid {
  constructor(root){
    this.root=root;this.view=root.host.ownerDocument.defaultView;this.frame=0;
    this.grids=[...root.querySelectorAll('[data-workspace-grid]')];
    this.schedule=()=>{if(!this.frame)this.frame=this.view.requestAnimationFrame(()=>{this.frame=0;this.layout();});};
    if(this.view.ResizeObserver){this.observer=new this.view.ResizeObserver(this.schedule);for(const grid of this.grids){this.observer.observe(grid);for(const card of cards(grid))this.observer.observe(card);}}
    root.addEventListener('toggle',this.schedule,true);this.schedule();
  }
  layout(){
    for(const grid of this.grids){
      if(!grid.getBoundingClientRect().width)continue;
      const style=this.view.getComputedStyle(grid),row=Number.parseFloat(style.gridAutoRows),gap=Number.parseFloat(style.rowGap) || 0;
      for(const card of cards(grid)){
        const span=Number.isFinite(row) && row>0 ? String(Math.max(1,Math.ceil((card.getBoundingClientRect().height+gap)/(row+gap)))) : '';
        if(card.style.getPropertyValue('--workspace-span')!==span){if(span)card.style.setProperty('--workspace-span',span);else card.style.removeProperty('--workspace-span');}
      }
    }
  }
  destroy(){this.observer?.disconnect();this.root.removeEventListener('toggle',this.schedule,true);this.view.cancelAnimationFrame(this.frame);}
}
