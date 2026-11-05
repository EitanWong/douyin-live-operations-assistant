// Share the React entry with the deferred workspace. Mixing Motion's DOM and
// React barrels lets the bundler defer the shared spring initializer too late.
import {spring} from 'motion/react';

// Motion owns the physics; FloatingWindow owns the one view-bound frame loop.
// Sampling its public generator keeps interruption velocity exact and lets
// hidden tabs, reduced motion and teardown finish without orphaned timelines.
export class WindowPresence {
  constructor(value=1) { this.jump(value); }
  get target() { return this.destination; }
  set target(value) {
    if(value===this.destination)return;
    this.destination=value;
    this.elapsed=0;
    this.animation=spring({keyframes:[this.value,value],velocity:this.velocity,
      stiffness:value ? 460 : 600,damping:value ? 44 : 50,mass:1,
      restDelta:.0001,restSpeed:.001});
  }
  get active() { return Boolean(this.animation); }
  jump(value) { this.value=this.destination=value;this.velocity=0;this.animation=null;this.elapsed=0; }
  step(seconds) {
    if(!this.animation || seconds<=0)return;
    this.elapsed+=seconds*1000;
    const frame=this.animation.next(this.elapsed);
    if(frame.done)this.jump(this.destination);
    else {this.value=frame.value;this.velocity=this.animation.velocity(this.elapsed);}
  }
}

const smoothRange=(from,to,value)=>{
  const p=Math.max(0,Math.min(1,(value-from)/(to-from)));
  return p*p*(3-2*p);
};
export function windowPresentation(progress,reduced=false) {
  const p=Math.max(0,Math.min(1,progress));
  return {scale:reduced ? 1 : .965+.035*p,travel:reduced ? 0 : 8*(1-p),
    material:smoothRange(0,.88,p),content:smoothRange(.16,.94,p)};
}
