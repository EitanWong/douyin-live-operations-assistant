import {liveMoment} from './live-moment.js';

// Only identical successive visual descriptions collapse. Speech may really repeat.
export function compactMediaContext(media,now){
 if(!media)return null;
 const rows=[];let previousVisual=null,repeatedVisuals=0;
 for(const [index,row] of (media.observations || []).entries()){
  if(row.isFinal===false || !['audio','video','omni'].includes(row.kind) || typeof row.text!=='string' || !row.text.trim())continue;
  const current={...row,id:row.id || `sample:${index}:${row.at}`};
  if(row.kind==='video'){
   if(previousVisual?.text===row.text){rows.splice(rows.indexOf(previousVisual),1);repeatedVisuals++;}
   previousVisual=current;
  }else if(row.kind==='omni')previousVisual=null;
  rows.push(current);
 }
 const latest=kind=>rows.findLast(row=>row.kind===kind)?.id || null;
 const moment=liveMoment({observations:rows},now);
 return {...media,observations:rows,scene:{visualId:latest('video'),speechId:latest('audio'),multimodalId:latest('omni'),policy:media.scene?.policy || 'Sampled model observations; never proof of identity, intent or unobserved activity.'},
  moment:{speechId:moment.speech?.id || null,visualId:moment.visual?.id || null,alignment:moment.alignment,policy:'Link speech and visible activity only when time coverage overlaps and speaker evidence is clear. Audio may contain guests, music or replay; never assume every voice is the anchor.'},
  compaction:{repeatedVisuals,policy:'Only identical successive visual descriptions omitted; latest sample time retained, never continuous coverage. Speech and scene changes retained.'}};
}

export function optionalMediaRows(media){
 const protectedIds=new Set([...Object.values(media?.scene || {}),media?.moment?.speechId,media?.moment?.visualId]);
 return (media?.observations || []).filter(row=>!protectedIds.has(row.id));
}
