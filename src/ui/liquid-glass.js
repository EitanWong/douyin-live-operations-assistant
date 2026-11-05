import {displacementMap} from '../../vendor/liquid-glass-react/displacement.js';

// Adapted from rdev/liquid-glass-react: refract the backdrop, keep content sharp.
// The filter lives in the panel's own shadow root and follows the layer's size.
export function createLiquidGlassFilter(document) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('aria-hidden','true');svg.setAttribute('width','0');svg.setAttribute('height','0');
  svg.style.cssText='position:absolute;pointer-events:none;overflow:hidden';
  svg.innerHTML='<defs><filter id="assistant-liquid-refraction" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feImage href="'+displacementMap+'" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="-24" xChannelSelector="R" yChannelSelector="B"/></filter></defs>';
  return svg;
}

export const LIQUID_GLASS_CSS=`
:host,:root{
 --lg-tint:36%;--lg-brightness:.45;--lg-accent-strength:60%;
 --lg-backdrop:blur(10px) saturate(145%) brightness(var(--lg-brightness));
 --lg-surface:color-mix(in srgb,var(--sg-solid) var(--lg-tint),transparent);
 --lg-card:color-mix(in srgb,var(--sg-solid) 8%,transparent);
 --lg-field:color-mix(in srgb,var(--sg-solid) 14%,transparent);
 --lg-sheen:color-mix(in srgb,var(--sg-rim) 12%,transparent);
 --lg-rim:color-mix(in srgb,var(--sg-rim) 70%,transparent);
 --lg-shadow:inset 0 1px 0 var(--lg-rim),inset 0 -1px 0 var(--sg-inner),0 0 0 1px var(--sg-edge),0 8px 24px -18px var(--sg-shade);
 --lg-muted:color-mix(in srgb,var(--sg-foreground) 82%,transparent);
 --lg-accent:color-mix(in srgb,var(--sg-brand) var(--lg-accent-strength),var(--sg-foreground));
}
:host([data-theme=light]),:root[data-theme=light]{--lg-tint:60%;--lg-brightness:1.15;--lg-accent-strength:40%}
@media(prefers-color-scheme:light){:host(:not([data-theme=dark])),:root:not([data-theme=dark]){--lg-tint:60%;--lg-brightness:1.15;--lg-accent-strength:40%}}
:host([data-material=liquid]) .panel,:root[data-material=liquid] .glass-panel{
 /* Share one tinted backdrop; nested surfaces only add a light wash. */
 --sg-background:transparent;--sg-panel:var(--lg-card);--sg-card:var(--lg-card);--sg-field:var(--lg-field);
 --sg-well:var(--lg-card);--sg-control:var(--lg-field);
 --sg-muted:var(--lg-muted);--sg-brand:var(--lg-accent);--sg-focus:var(--lg-accent);
 --sg-brand-wash:color-mix(in srgb,var(--sg-brand) 12%,transparent);
 background:transparent;border:0;border-radius:22px;
 box-shadow:0 24px 64px -18px var(--window-shade,var(--sg-shade)),0 6px 18px -8px var(--window-contact,var(--sg-contact));
}
@supports not (backdrop-filter:blur(1px)){:root[data-material=liquid] .glass-panel{background:var(--sg-solid)}}
@supports(backdrop-filter:blur(1px)){
 :host([data-material=liquid]) .panel{
  isolation:isolate;background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;
 }
 :host([data-material=liquid]) .panel::before{
  content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;
  background:var(--lg-surface);backdrop-filter:var(--lg-backdrop);-webkit-backdrop-filter:var(--lg-backdrop);
 }
 @supports(backdrop-filter:url("#assistant-liquid-refraction")){
  :host([data-material=liquid]) .panel::before{backdrop-filter:url("#assistant-liquid-refraction") var(--lg-backdrop)}
 }
 :root[data-material=liquid] .glass-panel{background:var(--lg-surface);backdrop-filter:var(--lg-backdrop);-webkit-backdrop-filter:var(--lg-backdrop)}
}
:host([data-material=liquid]) .panel::after{
 content:"";position:absolute;inset:0;z-index:3;pointer-events:none;border-radius:inherit;
 box-shadow:inset 1px 1px 1px var(--lg-rim),inset -1px -1px 1px var(--sg-inner);
}
:host([data-material=liquid]) .head{background:linear-gradient(115deg,var(--lg-sheen),transparent 60%);border-bottom:1px solid var(--sg-border)}
:host([data-material=liquid]) .workspace[data-nav-layout=sidebar]>.nav{background:var(--sg-panel)}
:host([data-material=liquid]) :is(.workspace-card,.settings-group,.income-hero,.pk-scoreboard){background:var(--lg-card);box-shadow:var(--lg-shadow)}
:host([data-material=liquid]) :is(input,select,textarea){background:var(--lg-field)}
@media(prefers-reduced-transparency:reduce),(forced-colors:active){
 :host([data-material=liquid]) .panel,:root[data-material=liquid] .glass-panel{background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none}
 :root[data-material=liquid] .glass-panel{background:var(--sg-solid)}
 :host([data-material=liquid]) .panel::before{display:block;background:var(--sg-solid);backdrop-filter:none;-webkit-backdrop-filter:none}
 :host([data-material=liquid]) .panel::after{box-shadow:none}
}
@media(forced-colors:active){:host([data-material=liquid]) .panel{background:transparent;border:0;box-shadow:none}:host([data-material=liquid]) .panel::before{background:Canvas;border:1px solid CanvasText}}
`;

export const PRODUCT_LIQUID_GLASS_CSS=`
.product-shell[data-material=liquid]{background:transparent;--mantine-color-anchor:var(--sg-brand);--mantine-primary-color-light-hover:color-mix(in srgb,var(--sg-brand) 18%,transparent);--mantine-color-brand-light-hover:var(--mantine-primary-color-light-hover)}
.product-shell[data-material=liquid] ::selection{background:var(--sg-brand-wash);color:var(--sg-brand)}
.product-shell[data-material=liquid] :is(.product-toolbar,.product-subviews,.product-status){background:linear-gradient(115deg,var(--lg-sheen),transparent 70%)}
.product-shell[data-material=liquid] .product-sidebar{background:var(--sg-panel)}
.product-shell[data-material=liquid] .mantine-Paper-root{background:var(--lg-card);border-color:var(--sg-border);box-shadow:var(--lg-shadow);border-radius:16px}
.product-shell[data-material=liquid] .mantine-Input-input{background:var(--lg-field);border-color:var(--sg-field-edge);box-shadow:inset 0 1px 0 var(--sg-field-rim)}
.product-shell[data-material=liquid] .product-table-scroll th{background:var(--lg-field);backdrop-filter:blur(8px)}
.product-shell[data-material=liquid] .mantine-Table-table{--table-striped-color:var(--lg-card);--table-highlight-on-hover-color:var(--lg-field)}
.product-shell[data-material=liquid] .product-nav-button[aria-current=page]{background:linear-gradient(120deg,var(--sg-brand-wash),var(--sg-inner));box-shadow:var(--lg-shadow)}
.product-shell[data-material=liquid] :is(.mantine-Button-root[data-variant=light],.mantine-Tabs-tab[data-active]){box-shadow:inset 0 1px 0 var(--sg-inner),0 1px 2px var(--sg-contact)}
@supports not (backdrop-filter:blur(1px)){.product-shell[data-material=liquid]{background:var(--sg-solid)}}
@media(prefers-reduced-transparency:reduce){
 .product-shell[data-material=liquid],.product-shell[data-material=liquid] :is(.product-sidebar,.mantine-Paper-root,.mantine-Input-input){background:var(--sg-solid)}
}
@media(forced-colors:active){
 .product-shell[data-material=liquid],.product-shell[data-material=liquid] :is(.product-sidebar,.mantine-Paper-root,.mantine-Input-input){background:Canvas;color:CanvasText;box-shadow:none;border-color:CanvasText}
}
`;
