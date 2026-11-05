import * as radix from '@radix-ui/colors';
import {PALETTES} from './appearance.js';

export function paletteScale(name,dark=false){
  const id=name==='original' ? 'crimson' : PALETTES.some(([key])=>key===name) ? name : 'crimson';
  return Array.from({length:12},(_,index)=>radix[`${id}${dark ? 'Dark' : ''}`][`${id}${index+1}`]);
}
const luminance=hex=>{const values=hex.slice(1).match(/../gu).map(n=>parseInt(n,16)/255).map(n=>n<=.04045 ? n/12.92 : ((n+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722;};
export const onAccent=hex=>luminance(hex)>.179 ? '#111111' : '#ffffff';
export function textAccent(name,dark=false){
 const scale=paletteScale(name,dark),surface=dark ? '#303138' : '#f3f4f6',a=luminance(scale[10]),b=luminance(surface);
 return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5 ? scale[10] : scale[11];
}
function accentTokens(name,dark){
 const colors=paletteScale(name,dark),fill=colors[8],text=textAccent(name,dark);
 return `--sg-brand:${text};--sg-focus:${text};--sg-brand-wash:${colors[2]};--sg-primary:${fill};--sg-primary-hover:${colors[9]};--sg-red:${fill};--sg-on-primary:${onAccent(fill)};`;
}
const selector=(name,condition='')=>`:host([data-palette=${name}]${condition}),:root[data-palette=${name}]${condition}`;
export const THEME_PALETTE_CSS=PALETTES.filter(([name])=>name!=='original').map(([name])=>`${selector(name)}{${accentTokens(name,true)}}\n${selector(name,'[data-theme=light]')}{${accentTokens(name,false)}}\n@media(prefers-color-scheme:light){${selector(name,':not([data-theme=dark])')}{${accentTokens(name,false)}}}`).join('\n')+`
:host([data-palette]:not([data-palette=original])) .primary,:root[data-palette]:not([data-palette=original]) .primary{color:var(--sg-on-primary)}
:host([data-material=solid]) .panel,:root[data-material=solid] .glass-panel{background:var(--sg-solid);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:0 0 0 1px var(--sg-border),0 12px 40px var(--sg-shade)}
`;

export function componentTheme(name,dark){
 const scale=paletteScale(name,dark),colors=[scale[1],scale[2],scale[3],scale[4],scale[6],scale[7],scale[8],scale[9],scale[10],scale[11]];
 if(name==='original'){colors[6]='#e31d47';colors[7]='#ca163c';}
 return {primaryColor:'brand',primaryShade:6,colors:{brand:colors},autoContrast:true,luminanceThreshold:.179,defaultRadius:'md',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',fontSizes:{xs:'12px',sm:'13px',md:'14px'}};
}
export const componentVariables=()=>({variables:{},light:{'--mantine-color-body':'var(--sg-popover)','--mantine-color-text':'var(--sg-foreground)','--mantine-color-dimmed':'var(--sg-muted)','--mantine-color-default-border':'var(--sg-border)','--mantine-color-default':'var(--sg-solid)','--mantine-color-brand-light':'var(--sg-brand-wash)','--mantine-color-brand-light-color':'var(--sg-brand)','--mantine-primary-color-light-color':'var(--sg-brand)','--mantine-primary-color-filled':'var(--sg-primary)','--mantine-primary-color-filled-hover':'var(--sg-primary-hover)'},dark:{'--mantine-color-body':'var(--sg-popover)','--mantine-color-text':'var(--sg-foreground)','--mantine-color-dimmed':'var(--sg-muted)','--mantine-color-default-border':'var(--sg-border)','--mantine-color-default':'var(--sg-solid)','--mantine-color-brand-light':'var(--sg-brand-wash)','--mantine-color-brand-light-color':'var(--sg-brand)','--mantine-primary-color-light-color':'var(--sg-brand)','--mantine-primary-color-filled':'var(--sg-primary)','--mantine-primary-color-filled-hover':'var(--sg-primary-hover)'}});
