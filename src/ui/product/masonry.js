import Masonry from 'masonry-layout';

const grids=new WeakMap();
export function mountCardGrid(element) {
  const grid=new Masonry(element,{itemSelector:'.product-card-slot',initLayout:false,resize:false,transitionDuration:0});
  grids.set(element,grid);
  return ()=>{grid.destroy();grids.delete(element);};
}
export function layoutCardGrids(content) {
  // Measure inner groups before their parents. Masonry changes positions only;
  // React and the bridge retain the same controls and their event owners.
  for(const element of [...content.querySelectorAll('.product-masonry')].reverse()) {
    const grid=grids.get(element),width=element.clientWidth;
    if(!grid || !width)continue;
    const style=element.ownerDocument.defaultView.getComputedStyle(element);
    const gap=Number.parseFloat(style.getPropertyValue('--product-section-gap'));
    const minimum=Number.parseFloat(style.getPropertyValue('--product-card-min-width'));
    const count=[...element.children].filter(child=>!child.hasAttribute('data-full')).length;
    const columns=Math.max(1,Math.min(count,Math.floor((width+gap)/(minimum+gap))));
    const columnWidth=(width-gap*(columns-1))/columns;
    for(const child of element.children)child.style.width=`${child.hasAttribute('data-full') ? width : columnWidth}px`;
    grid.options.columnWidth=columnWidth;grid.options.gutter=gap;
    grid.reloadItems();grid.layout();
  }
}
