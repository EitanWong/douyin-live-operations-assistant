/*
 * Solid Glass material, adapted for native DOM controls and Shadow DOM.
 * Source: https://github.com/deeplethe/solid-glass (src/solid-glass.css,
 * Panel and Tag), retrieved 2026-10-18. Copyright (c) 2026 DeepLethe.
 * MIT license: vendor/solid-glass/LICENSE. No React or Tailwind runtime.
 * Keep the license in this module so standalone userscript copies retain it.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const LIGHT_GLASS_TOKENS = `
  --sg-scheme:light;
  --sg-background:#f3f4f6;
  --sg-foreground:#202126;
  --sg-muted:#60636d;
  --sg-panel:rgb(255 255 255 / 52%);
  --sg-card:rgb(255 255 255 / 70%);
  --sg-popover:rgb(247 248 250 / 97%);
  --sg-border:rgb(30 35 48 / 13%);
  --sg-rim:rgb(255 255 255 / 95%);
  --sg-inner:rgb(255 255 255 / 45%);
  --sg-edge:rgb(30 35 48 / 12%);
  --sg-shade:rgb(25 30 42 / 22%);
  --sg-contact:rgb(25 30 42 / 7%);
  --sg-control:rgb(255 255 255 / 65%);
  --sg-control-rim:rgb(255 255 255 / 90%);
  --sg-field:rgb(255 255 255 / 78%);
  --sg-field-rim:rgb(255 255 255);
  --sg-field-edge:rgb(30 35 48 / 16%);
  --sg-focus:#c91d43;
  --sg-success:#006d70;
  --sg-warning:#805817;
  --sg-danger:#bd2041;
  --sg-brand:#c91d43;
  --sg-brand-wash:rgb(254 44 85 / 7%);
  --sg-hover:rgb(30 35 48 / 6%);
  --sg-hover-border:rgb(30 35 48 / 23%);
  --sg-solid:#f7f8fa;
  --sg-solid-hover:#e9ebef;
  --sg-well:rgb(30 35 48 / 5%);
  --sg-scroll:rgb(30 35 48 / 30%);
  --sg-knob:#fff;
  --sg-knob-off:#858995;
  --sg-option:#fff;
`;

export const SOLID_GLASS_CSS = `
:host,:root {
  color-scheme:var(--sg-scheme);
  --sg-scheme:dark;
  --sg-background:#16171b;
  --sg-foreground:#f5f5f5;
  --sg-muted:#ababaf;
  --sg-panel:rgb(255 255 255 / 4.5%);
  --sg-card:rgb(49 49 49 / 46%);
  --sg-popover:rgb(25 26 31 / 97%);
  --sg-border:rgb(255 255 255 / 11%);
  --sg-rim:rgb(255 255 255 / 16%);
  --sg-inner:rgb(255 255 255 / 4%);
  --sg-edge:rgb(255 255 255 / 6%);
  --sg-shade:rgb(0 0 0 / 60%);
  --sg-contact:rgb(0 0 0 / 10%);
  --sg-control:rgb(255 255 255 / 7%);
  --sg-control-rim:rgb(255 255 255 / 11%);
  --sg-field:rgb(255 255 255 / 6%);
  --sg-field-rim:rgb(255 255 255 / 15%);
  --sg-field-edge:rgb(255 255 255 / 8%);
  --sg-focus:#ff839b;
  --sg-success:#25f4ee;
  --sg-warning:#edc789;
  --sg-danger:#ff9eaa;
  --sg-brand:#ff839b;
  --sg-brand-wash:rgb(254 44 85 / 12%);
  --sg-red:#fe2c55;
  --sg-cyan:#25f4ee;
  --sg-primary:#e31d47;
  --sg-primary-hover:#ca163c;
  --sg-hover:rgb(255 255 255 / 8%);
  --sg-hover-border:rgb(255 255 255 / 18%);
  --sg-solid:#25262c;
  --sg-solid-hover:#303138;
  --sg-well:rgb(0 0 0 / 15%);
  --sg-scroll:rgb(255 255 255 / 25%);
  --sg-knob:#f2f2f2;
  --sg-knob-off:#a3a3a3;
  --sg-option:#28292f;
  --sg-radius:14px;
  --sg-radius-control:9px;
  --sg-font:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  --sg-pane-shadow:inset 0 1px 0 var(--sg-rim),inset 0 0 0 1px var(--sg-inner),0 0 0 1px var(--sg-edge),0 1px 2px var(--sg-contact),0 12px 32px -14px var(--sg-shade);
  --sg-state-shadow:inset 0 1px 0 var(--sg-control-rim),0 0 0 1px var(--sg-edge),0 1px 2px var(--sg-contact);
}
:host([data-theme=light]),:root[data-theme=light]{
${LIGHT_GLASS_TOKENS}}
@media(prefers-color-scheme:light){:host(:not([data-theme=dark])),:root:not([data-theme=dark]){
${LIGHT_GLASS_TOKENS}}}
*{box-sizing:border-box}
::selection{background:var(--sg-brand-wash);color:var(--sg-brand)}
button,input,select,textarea{font:inherit;color:inherit;border:1px solid var(--sg-border);border-radius:var(--sg-radius-control)}
button{cursor:pointer;min-height:38px;padding:8px 12px;background:var(--sg-control);box-shadow:inset 0 1px 0 var(--sg-inner);transition:background-color 140ms,border-color 140ms,transform 140ms}
button:hover:not(:disabled){background:var(--sg-hover);border-color:var(--sg-hover-border);box-shadow:var(--sg-state-shadow)}
button:active:not(:disabled){transform:translateY(1px)}
button:disabled{cursor:default;opacity:.45}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--sg-focus);outline-offset:3px}
input,select,textarea{background:var(--sg-field);border-color:var(--sg-field-edge);box-shadow:inset 0 1px 0 var(--sg-field-rim),0 1px 2px var(--sg-contact);caret-color:var(--sg-foreground)}
input::placeholder,textarea::placeholder{color:var(--sg-muted);opacity:1}
input:focus,select:focus,textarea:focus{border-color:var(--sg-focus)}
select option{background:var(--sg-option);color:var(--sg-foreground)}
input[type=checkbox]{accent-color:var(--sg-primary)}
a{color:var(--sg-foreground);text-underline-offset:3px}
.glass-panel{background:var(--sg-panel);border:0;box-shadow:var(--sg-pane-shadow);border-radius:var(--sg-radius)}
.glass-chosen{background:var(--sg-control);box-shadow:var(--sg-state-shadow)}
.primary{background:var(--sg-primary);color:#fff;border-color:var(--sg-red);font-weight:650;box-shadow:inset 0 1px 0 #ffffff55,inset 0 -1px 0 #00000024,0 1px 2px var(--sg-contact),0 8px 18px -9px var(--sg-shade)}
.primary:hover:not(:disabled){background:var(--sg-primary-hover);color:#fff;border-color:var(--sg-primary-hover);box-shadow:inset 0 1px 0 #ffffff55,0 3px 12px -7px var(--sg-shade)}
[data-slot=tag]{display:inline-flex;align-items:center;gap:6px;width:fit-content;max-width:100%;padding:4px 8px;border-radius:6px;background:var(--sg-control);box-shadow:var(--sg-state-shadow);font-size:11px;line-height:1.5;color:var(--sg-muted)}
[data-slot=tag].live{color:var(--sg-success)}
[data-slot=tag].live::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0}
.danger{color:var(--sg-danger)}
[aria-invalid=true]{border-color:var(--sg-danger)!important}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
@media(forced-colors:active){.glass-panel,.glass-chosen,[data-slot=tag]{border:1px solid CanvasText}.primary{border:1px solid ButtonText}}
`;
