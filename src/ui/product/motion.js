import {createElement as h,createContext,useContext,useMemo,useCallback,useSyncExternalStore,useLayoutEffect} from 'react';
import {Button as MantineButton} from '@mantine/core';
import {m as motion,MotionConfig,useAnimationControls} from 'motion/react';

// One motion language. Geometry has a single owner: FloatingWindow outside,
// Motion inside. Never fade an ancestor of the window's backdrop-filter.
export const springs={
  control:{type:'spring',stiffness:520,damping:34,mass:.6},
  disclosure:{type:'spring',stiffness:380,damping:38,mass:1},
  layout:{type:'spring',stiffness:420,damping:40,mass:1},
};
export const fade={duration:.16,ease:[.2,.7,.2,1]};
const MotionPreference=createContext(false);
export const useMotionPreference=()=>useContext(MotionPreference);
export function MotionPreferences({view,children}) {
  // Subscribe once per workspace. Motion's current hook snapshots the media
  // preference at mount, so use an external store for live OS changes.
  const query=useMemo(()=>view.matchMedia('(prefers-reduced-motion: reduce)'),[view]);
  const subscribe=useCallback(listener=>{query.addEventListener('change',listener);return ()=>query.removeEventListener('change',listener);},[query]);
  const reduced=useSyncExternalStore(subscribe,()=>query.matches,()=>true);
  return h(MotionPreference.Provider,{value:reduced},h(MotionConfig,{reducedMotion:reduced ? 'always' : 'never',transition:reduced ? {duration:0} : springs.control},children));
}
// Explicitly finish running animations when the OS preference changes. A
// changed transition prop alone does not retarget an unchanged Motion value.
export function useMotionTarget(target,transition) {
  const reduced=useMotionPreference(),controls=useAnimationControls();
  const valueKey=JSON.stringify(target),transitionKey=JSON.stringify(transition);
  useLayoutEffect(()=>{
    if(reduced){controls.stop();controls.set(JSON.parse(valueKey));}
    else controls.start({...JSON.parse(valueKey),transition:JSON.parse(transitionKey)});
  },[controls,reduced,valueKey,transitionKey]);
  return controls;
}
const MotionButton=motion.create(MantineButton);
export function Button({disabled,loading,fullWidth,...props}) {
  const reduced=useMotionPreference(),interactive=!disabled && !loading && !reduced;
  return h(MotionButton,{...props,disabled,loading,fullWidth,initial:false,
    whileHover:interactive ? 'hover' : undefined,whileTap:interactive ? 'press' : undefined,
    animate:reduced ? {scale:1} : undefined,
    variants:{hover:{scale:fullWidth ? 1 : 1.015},press:{scale:fullWidth ? .99 : .975}},transition:reduced ? {duration:0} : springs.control});
}
export function MotionIcon({html}) {
  const reduced=useMotionPreference();
  return h(motion.span,{className:'product-icon','aria-hidden':true,
    variants:reduced ? {} : {hover:{scale:1.06,y:-.5},press:{scale:.94,y:0}},
    animate:reduced ? {scale:1,y:0} : undefined,
    transition:reduced ? {duration:0} : springs.control,dangerouslySetInnerHTML:{__html:html}});
}
export function Chevron({open}) {
  const animation=useMotionTarget({rotate:open ? 180 : 0},springs.control);
  return h(motion.span,{className:'product-chevron','aria-hidden':true,initial:false,
    animate:animation},
  h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round'},h('path',{d:'m6 9 6 6 6-6'})));
}
export function Reveal({open,children,id}) {
  const animation=useMotionTarget({height:open ? 'auto' : 0,opacity:open ? 1 : 0},{...springs.disclosure,opacity:fade});
  // Retain the same fields/drafts during interruptions, but remove closed
  // controls from focus and the accessibility tree immediately.
  return h(motion.div,{id,className:'product-reveal',inert:!open,'aria-hidden':!open,
    initial:{height:open ? 'auto' : 0,opacity:open ? 1 : 0},animate:animation},children);
}
export function PageEntrance({children,distance=5}) {
  const reduced=useMotionPreference();
  const animation=useMotionTarget({opacity:1,y:0},{...springs.layout,opacity:fade});
  return h(motion.div,{className:'product-page-entrance',initial:reduced ? false : {opacity:0,y:distance},
    animate:animation},children);
}
