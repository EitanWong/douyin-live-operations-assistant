// One scrollbar language for native controls and both workspace shadow roots.
// Native scrollbar thumbs cannot reliably refract a backdrop; translucent tint
// and a subtle inset rim express the selected material without replacing input.
export const SCROLLBAR_CSS=`
:host,:root{--sg-scroll-thumb:var(--sg-scroll);--sg-scroll-track:color-mix(in srgb,var(--sg-foreground) 4%,transparent);--sg-scroll-rim:color-mix(in srgb,var(--sg-rim) 60%,transparent)}
*{scrollbar-width:thin;scrollbar-color:var(--sg-scroll-thumb) var(--sg-scroll-track)}
@supports selector(::-webkit-scrollbar){
 *{scrollbar-width:auto;scrollbar-color:auto}
 ::-webkit-scrollbar{width:8px;height:8px}
 ::-webkit-scrollbar-track{background:var(--sg-scroll-track);border-radius:20px}
 ::-webkit-scrollbar-thumb{border:2px solid transparent;border-radius:20px;background:linear-gradient(135deg,var(--sg-scroll-rim),transparent),var(--sg-scroll-thumb);background-clip:padding-box;box-shadow:inset 0 0 0 1px var(--sg-inner);min-height:32px}
 ::-webkit-scrollbar-thumb:hover{background-color:color-mix(in srgb,var(--sg-foreground) 45%,transparent)}
 ::-webkit-scrollbar-corner{background:transparent}
}
@media(forced-colors:active){*{scrollbar-color:auto;scrollbar-width:auto}::-webkit-scrollbar-thumb{background:ButtonText;box-shadow:none}::-webkit-scrollbar-track{background:Canvas}}
`;
